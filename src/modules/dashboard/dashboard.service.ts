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

    const [
      [{ totalIncidents }],
      [{ claimedThisMonth }],
      [{ resolvedIncidents }],
      [{ activeVolunteers }],
      [{ completedCleanupTasks }],
      categoryBreakdown,
      org,
    ] = await Promise.all([
      this.tenantDb.db
        .select({ totalIncidents: count() })
        .from(incidents)
        .where(eq(incidents.organisationId, organisationId)),
      this.tenantDb.db
        .select({ claimedThisMonth: count() })
        .from(incidents)
        .where(
          and(
            eq(incidents.organisationId, organisationId),
            gte(incidents.claimedAt, startOfMonth),
          ),
        ),
      this.tenantDb.db
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
        ),
      this.tenantDb.db
        .select({ activeVolunteers: count() })
        .from(users)
        .where(
          and(
            eq(users.organisationId, organisationId),
            eq(users.role, UserRole.VOLUNTEER),
            eq(users.isActive, true),
          ),
        ),
      this.tenantDb.db
        .select({ completedCleanupTasks: count() })
        .from(tasks)
        .where(
          and(
            eq(tasks.organisationId, organisationId),
            eq(tasks.status, TaskStatus.COMPLETED),
          ),
        ),
      this.tenantDb.db
        .select({ category: incidents.category, count: count() })
        .from(incidents)
        .where(eq(incidents.organisationId, organisationId))
        .groupBy(incidents.category),
      this.tenantDb.db.query.organisations.findFirst({
        where: eq(organisations.id, organisationId),
      }),
    ]);

    let awaitingClaimInServiceArea = 0;
    if (org?.serviceAreaCenter && org.serviceAreaRadiusKm) {
      const [{ poolCount }] = (
        await this.tenantDb.db.execute<{
          [key: string]: unknown;
          poolCount: number;
        }>(sql`
          SELECT count(*)::int AS "poolCount"
          FROM incidents
          WHERE organisation_id IS NULL
            AND ST_DWithin(location, ${org.serviceAreaCenter}::geography, ${org.serviceAreaRadiusKm * 1000})
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
