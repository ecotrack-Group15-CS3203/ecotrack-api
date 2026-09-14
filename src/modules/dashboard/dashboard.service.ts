import { Injectable } from '@nestjs/common';
import { and, count, eq, gte, sql } from 'drizzle-orm';
import { UserRole } from '../../common/enums/user-role.enum';
import { TaskStatus } from '../../common/enums/task.enum';
import {
  incidents,
  organisations,
  tasks,
  users,
  workflowStages,
} from '../../database/schema';
import { toGeographyPoint } from '../../database/schema/columns.helpers';
import { TenantDbService } from '../../database/tenant-db.service';

@Injectable()
export class DashboardService {
  constructor(private readonly tenantDb: TenantDbService) {}

  /**
   * Matches SRS 3.1.17's summary cards: claimed this month, awaiting claim within the
   * org's service area, active tasks, volunteers, plus category breakdown and a
   * resolved count. "pendingIncidents"/"verifiedIncidents" from the old model are
   * gone — every claimed incident is verified by definition now (claim = auto-verify,
   * SRS 3.1.5), so that distinction no longer exists.
   */
  async getOrgStats(organisationId: string) {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    // Sequential, not Promise.all: tenantDb.db is one dedicated pg Client per
    // request (TenantInterceptor), not a Pool — concurrent queries on it hit
    // node-postgres's deprecated-and-scheduled-for-removal concurrent-query path.
    const [{ totalIncidents }] = await this.tenantDb.db
      .select({ totalIncidents: count() })
      .from(incidents)
      .where(eq(incidents.organisationId, organisationId));
    const [{ claimedThisMonth }] = await this.tenantDb.db
      .select({ claimedThisMonth: count() })
      .from(incidents)
      .where(
        and(
          eq(incidents.organisationId, organisationId),
          gte(incidents.claimedAt, startOfMonth),
        ),
      );
    const [{ resolvedIncidents }] = await this.tenantDb.db
      .select({ resolvedIncidents: count() })
      .from(incidents)
      .innerJoin(
        workflowStages,
        eq(incidents.currentStageId, workflowStages.id),
      )
      .where(
        and(
          eq(incidents.organisationId, organisationId),
          eq(workflowStages.isFinal, true),
        ),
      );
    const [{ activeVolunteers }] = await this.tenantDb.db
      .select({ activeVolunteers: count() })
      .from(users)
      .where(
        and(
          eq(users.organisationId, organisationId),
          eq(users.role, UserRole.VOLUNTEER),
          eq(users.isActive, true),
        ),
      );
    const [{ completedCleanupTasks }] = await this.tenantDb.db
      .select({ completedCleanupTasks: count() })
      .from(tasks)
      .where(
        and(
          eq(tasks.organisationId, organisationId),
          eq(tasks.status, TaskStatus.COMPLETED),
        ),
      );
    const categoryBreakdown = await this.tenantDb.db
      .select({ category: incidents.category, count: count() })
      .from(incidents)
      .where(eq(incidents.organisationId, organisationId))
      .groupBy(incidents.category);
    const org = await this.tenantDb.db.query.organisations.findFirst({
      where: eq(organisations.id, organisationId),
    });

    let awaitingClaimInServiceArea = 0;
    if (org?.serviceAreaCenter && org.serviceAreaRadiusKm) {
      // org.serviceAreaCenter is {lat,lng} once decoded by fromDriver — rebuild EWKT
      // to interpolate it into the raw ::geography cast below.
      const centerEwkt = toGeographyPoint(
        org.serviceAreaCenter.lat,
        org.serviceAreaCenter.lng,
      );
      const [{ poolCount }] = (
        await this.tenantDb.db.execute<{
          [key: string]: unknown;
          poolCount: number;
        }>(sql`
          SELECT count(*)::int AS "poolCount"
          FROM incidents
          WHERE organisation_id IS NULL
            AND ST_DWithin(location, ${centerEwkt}::geography, ${org.serviceAreaRadiusKm * 1000})
        `)
      ).rows;
      awaitingClaimInServiceArea = poolCount;
    }

    return {
      totalIncidents,
      claimedThisMonth,
      awaitingClaimInServiceArea,
      resolvedIncidents,
      activeVolunteers,
      completedCleanupTasks,
      incidentsByCategory: categoryBreakdown.map((row) => ({
        category: row.category,
        count: row.count,
      })),
    };
  }

  getIncidentMap(organisationId: string) {
    return this.tenantDb.db
      .select({
        id: incidents.id,
        title: incidents.title,
        category: incidents.category,
        severity: incidents.severity,
        verificationStatus: incidents.verificationStatus,
        lat: sql<number>`ST_Y(${incidents.location}::geometry)`,
        lng: sql<number>`ST_X(${incidents.location}::geometry)`,
      })
      .from(incidents)
      .where(eq(incidents.organisationId, organisationId));
  }
}
