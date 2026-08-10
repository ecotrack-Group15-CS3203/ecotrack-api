import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { NotificationType } from '../../common/enums/notification.enum';
import { incidents, organisations } from '../../database/schema';
import { TenantDbService } from '../../database/tenant-db.service';
import { AuditLogService } from '../audit/audit-log.service';
import { NotificationsService } from '../notifications/notifications.service';
import { WorkflowStagesService } from '../workflow/workflow-stages.service';

export interface PoolIncidentRow {
  [key: string]: unknown;
  id: string;
  title: string;
  description: string;
  category: string;
  severity: string;
  address: string | null;
  createdAt: Date;
  lat: number;
  lng: number;
  distanceMeters: number;
}

@Injectable()
export class IncidentPoolService {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly workflowStagesService: WorkflowStagesService,
    private readonly notificationsService: NotificationsService,
    private readonly auditLogService: AuditLogService,
  ) {}

  /**
   * Unclaimed incidents within the given org's service area, nearest first. Uses
   * ST_DWithin against the pre-built GiST index (incidents_location_gist) — see
   * SRS 3.4.1's p95<=500ms performance target, the reason that index exists at all.
   */
  async listPool(organisationId: string): Promise<PoolIncidentRow[]> {
    const org = await this.tenantDb.db.query.organisations.findFirst({
      where: eq(organisations.id, organisationId),
    });
    if (!org?.serviceAreaCenter || !org.serviceAreaRadiusKm) {
      throw new BadRequestException(
        'This organisation has no service area configured yet',
      );
    }

    const result = await this.tenantDb.db.execute<PoolIncidentRow>(sql`
      SELECT
        id, title, description, category, severity, address, created_at AS "createdAt",
        ST_Y(location::geometry) AS lat,
        ST_X(location::geometry) AS lng,
        ST_Distance(location, ${org.serviceAreaCenter}::geography) AS "distanceMeters"
      FROM incidents
      WHERE organisation_id IS NULL
        AND ST_DWithin(location, ${org.serviceAreaCenter}::geography, ${org.serviceAreaRadiusKm * 1000})
      ORDER BY "distanceMeters" ASC
    `);
    return result.rows;
  }

  /**
   * Atomic claim. The `WHERE organisation_id IS NULL` predicate on the UPDATE is
   * what actually prevents a double-claim race — whichever of two concurrent
   * requests reaches Postgres first wins, the loser's UPDATE matches zero rows. The
   * pre-checks below exist only to produce a specific, helpful error (404 vs 409 vs
   * 422), not to guarantee atomicity themselves.
   */
  async claim(
    incidentId: string,
    organisationId: string,
    actingUserId: string,
  ) {
    const incident = await this.tenantDb.db.query.incidents.findFirst({
      where: eq(incidents.id, incidentId),
    });
    if (!incident) {
      throw new NotFoundException('Incident not found');
    }
    if (incident.organisationId !== null) {
      throw new ConflictException(
        'This incident has already been claimed by another organisation',
      );
    }

    const org = await this.tenantDb.db.query.organisations.findFirst({
      where: eq(organisations.id, organisationId),
    });
    if (!org?.serviceAreaCenter || !org.serviceAreaRadiusKm) {
      throw new BadRequestException(
        'This organisation has no service area configured yet',
      );
    }
    const [{ within }] = (
      await this.tenantDb.db.execute<{
        [key: string]: unknown;
        within: boolean;
      }>(sql`
        SELECT ST_DWithin(
          (SELECT location FROM incidents WHERE id = ${incidentId}),
          ${org.serviceAreaCenter}::geography,
          ${org.serviceAreaRadiusKm * 1000}
        ) AS within
      `)
    ).rows;
    if (!within) {
      throw new UnprocessableEntityException(
        "This incident is outside your organisation's service area",
      );
    }

    const claimStage =
      await this.workflowStagesService.findDefaultClaimStage(organisationId);

    const result = await this.tenantDb.db
      .update(incidents)
      .set({
        organisationId,
        claimedByUserId: actingUserId,
        claimedAt: new Date(),
        verificationStatus: 'approved',
        currentStageId: claimStage?.id ?? null,
        version: sql`${incidents.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        sql`${incidents.id} = ${incidentId} AND ${incidents.organisationId} IS NULL`,
      )
      .returning();

    if (result.length === 0) {
      throw new ConflictException(
        'This incident was just claimed by another organisation',
      );
    }
    const claimed = result[0];

    await Promise.all([
      this.auditLogService.record({
        organisationId,
        actingUserId,
        action: 'incident.claimed',
        entityType: 'incident',
        entityId: incidentId,
      }),
      claimed.reportedByUserId
        ? this.notificationsService.create({
            userId: claimed.reportedByUserId,
            organisationId,
            type: NotificationType.INCIDENT_CLAIMED,
            title: 'Your report was claimed',
            message: `"${claimed.title}" has been claimed and is being handled.`,
            relatedEntityType: 'incident',
            relatedEntityId: incidentId,
          })
        : Promise.resolve(),
    ]);

    return claimed;
  }
}
