import { Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import type { DrizzleDb } from '../../../../database/drizzle.provider';
import { incidents } from '../../../../database/schema';
import { toGeographyPoint } from '../../../../database/schema/columns.helpers';
import { NotificationType } from '../../../../common/enums/notification.enum';
import { NotificationsService } from '../../notifications.service';

const SEVERITY_ORDER = ['low', 'medium', 'high', 'critical'] as const;

/** Every threshold an incident of this severity satisfies — e.g. a 'high' incident
 * matches users whose own minimum is 'low', 'medium', or 'high', but not
 * 'critical'. Computed in TS so the SQL side stays a plain ANY() test. */
function thresholdsSatisfiedBy(severity: string): string[] {
  const index = SEVERITY_ORDER.indexOf(
    severity as (typeof SEVERITY_ORDER)[number],
  );
  return index === -1 ? [] : SEVERITY_ORDER.slice(0, index + 1);
}

interface MatchedUser {
  [key: string]: unknown;
  id: string;
}

@Injectable()
export class IncidentProximityHandler {
  constructor(private readonly notificationsService: NotificationsService) {}

  /**
   * SRS 3.1.4: matches users on BOTH radius (against their own alertCenter, never
   * homeLocation) and urgency threshold. Deliberately cross-tenant — proximity has
   * nothing to do with organisation membership — which is exactly why this runs on
   * the system db passed in by NotificationDispatchService, not a tenant session.
   *
   * One NotificationsService.create() per matched user rather than a single
   * sendMany(): create() is also what writes the persisted in-app row (the source
   * of truth per push-notifications.service.ts's own header comment), and at this
   * deployment's scale (SAD 10.3: ~500-1,000 incidents/month) a handful of
   * individual push calls per incident is not a cost worth the extra machinery of
   * splitting "write the rows" from "send the pushes" into two passes.
   */
  async handle(db: DrizzleDb, incidentId: string): Promise<void> {
    const incident = await db.query.incidents.findFirst({
      where: eq(incidents.id, incidentId),
    });
    // Gone by the time this fires (deleted, or — not currently possible, but
    // defensively — some future hard-delete path): nothing to notify about.
    if (!incident) return;

    const thresholds = thresholdsSatisfiedBy(incident.severity);
    if (thresholds.length === 0) return;

    const point = toGeographyPoint(
      incident.location.lat,
      incident.location.lng,
    );
    const thresholdsArray = sql.raw(
      `ARRAY[${thresholds.map((t) => `'${t}'`).join(',')}]::incident_severity[]`,
    );

    const result = await db.execute<MatchedUser>(sql`
      SELECT u.id
      FROM users u
      WHERE u.is_active
        AND u.push_token IS NOT NULL
        AND u.alert_center IS NOT NULL
        AND u.id <> ${incident.reportedByUserId}
        AND ST_DWithin(u.alert_center, ${point}::geography, 50000)
        AND ST_DWithin(u.alert_center, ${point}::geography, u.notification_radius_meters)
        AND u.notification_min_urgency = ANY(${thresholdsArray})
    `);
    if (result.rows.length === 0) return;

    const title = `New ${incident.severity} hazard reported nearby`;
    await Promise.all(
      result.rows.map((user) =>
        this.notificationsService.create(
          {
            userId: user.id,
            organisationId: null,
            type: NotificationType.INCIDENT_PROXIMITY,
            title,
            message: incident.title,
            relatedEntityType: 'incident',
            relatedEntityId: incidentId,
          },
          db,
        ),
      ),
    );
  }
}
