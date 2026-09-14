import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  Paginated,
  PaginationQueryDto,
} from '../../common/dto/pagination-query.dto';
import { NotificationType } from '../../common/enums/notification.enum';
import {
  IncidentCategory,
  VerificationStatus,
} from '../../common/enums/incident.enum';
import {
  incidentImages,
  incidents,
  notificationDispatches,
} from '../../database/schema';
import { toGeographyPoint } from '../../database/schema/columns.helpers';
import { TenantDbService } from '../../database/tenant-db.service';
import { AuditLogService } from '../audit/audit-log.service';
import { NotificationsService } from '../notifications/notifications.service';
import { WorkflowStagesService } from '../workflow/workflow-stages.service';
import { CreateIncidentDto } from './dto/create-incident.dto';
import { UpdateIncidentStageDto } from './dto/update-incident-stage.dto';

export type IncidentRow = typeof incidents.$inferSelect;

/**
 * The reduced projection returned by the public map query — deliberately carries no
 * description, address, reporter or organisation id, since this is the one incident
 * read that crosses tenant boundaries.
 */
export interface NearbyIncidentRow {
  [key: string]: unknown;
  id: string;
  title: string;
  category: string;
  severity: string;
  createdAt: Date;
  claimed: boolean;
  lat: number;
  lng: number;
  distanceMeters: number;
  thumbnailUrl: string | null;
}

/** The detail-view counterpart to NearbyIncidentRow's list projection — see
 * findByIdWithImages's public fallback below for what each omission protects. */
export interface PublicIncidentDetail {
  [key: string]: unknown;
  id: string;
  title: string;
  description: string;
  category: string;
  severity: string;
  address: string | null;
  createdAt: Date;
  claimed: boolean;
  lat: number;
  lng: number;
}

@Injectable()
export class IncidentsService {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly notificationsService: NotificationsService,
    private readonly auditLogService: AuditLogService,
    private readonly workflowStagesService: WorkflowStagesService,
  ) {}

  /**
   * Creates an unclaimed (pooled) incident — no organisationId, no verificationStatus,
   * no currentStageId. Enters the Global Incident Pool immediately; an org_admin
   * claims it later via IncidentPoolService.claim (see incident-pool.service.ts).
   */
  async create(
    reportedByUserId: string,
    dto: CreateIncidentDto,
  ): Promise<IncidentRow> {
    if (dto.mediaUrls.length === 0) {
      throw new BadRequestException('At least one photograph is required');
    }

    const [saved] = await this.tenantDb.db
      .insert(incidents)
      .values({
        reportedByUserId,
        title: dto.title,
        // Optional on the wire (SRS 3.1.2) but NOT NULL in the column — an
        // omitted description and a blank one mean the same thing here, so
        // there's nothing a nullable column would distinguish.
        description: dto.description ?? '',
        // The mobile wizard collects no category; `other` keeps the column non-null
        // without inventing a classification nobody supplied.
        category: dto.category ?? IncidentCategory.OTHER,
        // Wire field is `urgency`, column is `severity` — same values, see the DTO.
        severity: dto.urgency,
        location: { lat: dto.location.lat, lng: dto.location.lng },
        address: dto.address ?? null,
      })
      .returning();

    await this.tenantDb.db
      .insert(incidentImages)
      .values(dto.mediaUrls.map((url) => ({ incidentId: saved.id, url })));

    await this.auditLogService.record({
      organisationId: null,
      actingUserId: reportedByUserId,
      action: 'incident.reported',
      entityType: 'incident',
      entityId: saved.id,
    });

    // Outbox, not a fire-and-forget push here: this write is transactional with
    // the incident row above, so a rollback takes the dispatch with it, and the
    // 15s-cadence cron (NotificationDispatchService) does the actual proximity
    // matching and fan-out afterwards, outside this request. See SRS 3.1.4.
    await this.tenantDb.db.insert(notificationDispatches).values({
      kind: 'incident_proximity',
      entityType: 'incident',
      entityId: saved.id,
      dueAt: new Date(),
    });

    return this.findById(saved.id);
  }

  async findMyReports(
    reportedByUserId: string,
    { page, limit }: PaginationQueryDto,
  ): Promise<
    Paginated<IncidentRow & { images: { id: string; url: string }[] }>
  > {
    const where = eq(incidents.reportedByUserId, reportedByUserId);
    // Sequential, not Promise.all: tenantDb.db is one dedicated pg Client per
    // request (TenantInterceptor), not a Pool — concurrent queries on it hit
    // node-postgres's deprecated-and-scheduled-for-removal concurrent-query path.
    const reports = await this.tenantDb.db.query.incidents.findMany({
      where,
      orderBy: desc(incidents.createdAt),
      limit,
      offset: (page - 1) * limit,
    });
    const [{ count: total }] = await this.tenantDb.db
      .select({ count: sql<number>`count(*)::int` })
      .from(incidents)
      .where(where);
    if (reports.length === 0) return { items: [], total, page, limit };
    const images = await this.tenantDb.db.query.incidentImages.findMany({
      where: inArray(
        incidentImages.incidentId,
        reports.map((r) => r.id),
      ),
    });
    const items = reports.map((report) => ({
      ...report,
      images: images
        .filter((img) => img.incidentId === report.id)
        .map((img) => ({ id: img.id, url: img.url })),
    }));
    return { items, total, page, limit };
  }

  /**
   * SRS 3.1.3: the citizen hazard map. Deliberately NOT tenant-filtered — it shows
   * incidents near a point whoever (if anyone) has claimed them.
   *
   * Two things make that safe. First, the projection below is deliberately reduced:
   * no description, address, reporter or organisation id ever leaves this method, so
   * a cross-tenant read surfaces hazard awareness and nothing else. Second, the
   * `app.public_map_read` policy it relies on is SELECT-only (migration 0018), so it
   * cannot be leveraged into a write no matter what else runs in this transaction.
   *
   * Dismissed reports are excluded — a rejected or duplicate report is not a live
   * hazard and has no business on the map.
   */
  async findNearby(
    lat: number,
    lng: number,
    radiusMeters: number,
    limit = 200,
  ): Promise<NearbyIncidentRow[]> {
    const point = toGeographyPoint(lat, lng);

    // Transaction-local (the `true` third argument), so it reverts at COMMIT. This is
    // the last statement in the request, so nothing else runs under the widened read.
    await this.tenantDb.db.execute(
      sql`SELECT set_config('app.public_map_read', 'true', true)`,
    );

    const result = await this.tenantDb.db.execute<NearbyIncidentRow>(sql`
      SELECT
        i.id, i.title, i.category, i.severity, i.created_at AS "createdAt",
        (i.organisation_id IS NOT NULL) AS claimed,
        ST_Y(i.location::geometry) AS lat,
        ST_X(i.location::geometry) AS lng,
        ST_Distance(i.location, ${point}::geography) AS "distanceMeters",
        (
          SELECT url FROM incident_images
          WHERE incident_id = i.id
          ORDER BY created_at ASC
          LIMIT 1
        ) AS "thumbnailUrl"
      FROM incidents i
      WHERE ST_DWithin(i.location, ${point}::geography, ${radiusMeters})
        AND (i.verification_status IS NULL OR i.verification_status = 'approved')
      ORDER BY "distanceMeters" ASC
      LIMIT ${limit}
    `);
    return result.rows;
  }

  /**
   * Tapping a pin on the public map (findNearby, above) needs to open a detail view
   * even for an incident the caller's normal RLS session can't see — that's the
   * whole point of the map showing it in the first place. Falls back to the same
   * public_map_read escape and the same eligibility rule (non-dismissed) findNearby
   * uses, rather than a second, differently-shaped route.
   *
   * The `visibility` discriminator tells the client which shape it got: 'full' is
   * every field the org/reporter view already returned before this method changed;
   * 'public' deliberately omits reportedByUserId, organisationId, claimedByUserId,
   * verificationStatus, rejectionReason, duplicateOfId and version — every field
   * that names or implicates a specific person or tenant. Photos ARE included: each
   * one is independently re-authorized by MediaController's own public_map_read
   * fallback, so withholding the list here would just make the working ones
   * undiscoverable rather than actually protecting anything.
   */
  async findByIdWithImages(id: string): Promise<
    | (IncidentRow & {
        images: { id: string; url: string }[];
        visibility: 'full';
      })
    | (PublicIncidentDetail & { visibility: 'public' })
  > {
    try {
      const incident = await this.findById(id);
      const images = await this.tenantDb.db.query.incidentImages.findMany({
        where: eq(incidentImages.incidentId, id),
      });
      return {
        ...incident,
        images: images.map((img) => ({ id: img.id, url: img.url })),
        visibility: 'full',
      };
    } catch (err) {
      if (!(err instanceof NotFoundException)) throw err;

      await this.tenantDb.db.execute(
        sql`SELECT set_config('app.public_map_read', 'true', true)`,
      );
      const [publicIncident] = (
        await this.tenantDb.db.execute<PublicIncidentDetail>(sql`
          SELECT
            i.id, i.title, i.description, i.category, i.severity, i.address,
            i.created_at AS "createdAt",
            (i.organisation_id IS NOT NULL) AS claimed,
            ST_Y(i.location::geometry) AS lat,
            ST_X(i.location::geometry) AS lng
          FROM incidents i
          WHERE i.id = ${id}
            AND (i.verification_status IS NULL OR i.verification_status = 'approved')
        `)
      ).rows;
      if (!publicIncident) throw err;

      const images = await this.tenantDb.db.query.incidentImages.findMany({
        where: eq(incidentImages.incidentId, id),
      });
      return {
        ...publicIncident,
        images: images.map((img) => ({ id: img.id, url: img.url })),
        visibility: 'public',
      };
    }
  }

  /**
   * No manual visibility check needed: RLS (migration 0003) already restricts which
   * rows this query can even see — an org_admin sees their own org's claimed
   * incidents plus the whole pool, a citizen sees their own reports (claimed or not)
   * plus the pool, a platform admin sees everything. A row that isn't visible simply
   * isn't returned, which is exactly "not found" from the caller's perspective.
   */
  async findById(id: string): Promise<IncidentRow> {
    const incident = await this.tenantDb.db.query.incidents.findFirst({
      where: eq(incidents.id, id),
    });
    if (!incident) {
      throw new NotFoundException('Incident not found');
    }
    return incident;
  }

  /** For actions that only make sense on an already-claimed incident owned by this org. */
  async findScoped(
    organisationId: string,
    incidentId: string,
  ): Promise<IncidentRow> {
    const incident = await this.findById(incidentId);
    if (incident.organisationId !== organisationId) {
      throw new NotFoundException('Incident not found');
    }
    return incident;
  }

  /**
   * The system-triggered counterpart to updateStage() (the admin-facing Manual
   * Status Update): used by TasksService/EventsService when a Task/Event Creation
   * or Completion rule resolves a target stage (SRS 3.1.21's Auto-Advance Rules).
   * No expectedVersion, no no-op short-circuit, no NotFound/Conflict semantics —
   * the caller already has both the incident and the target stage in hand and has
   * already decided an advance is warranted; this just performs it and audits it.
   */
  async advanceStage(
    organisationId: string,
    incidentId: string,
    targetStageId: string,
    actingUserId: string,
    trigger: string,
  ): Promise<void> {
    await this.tenantDb.db
      .update(incidents)
      .set({
        currentStageId: targetStageId,
        version: sql`${incidents.version} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(incidents.id, incidentId));

    await this.auditLogService.record({
      organisationId,
      actingUserId,
      action: 'incident.stage_changed',
      entityType: 'incident',
      entityId: incidentId,
      metadata: { newStageId: targetStageId, trigger },
    });
  }

  async listForOrg(
    organisationId: string,
    { page, limit }: PaginationQueryDto,
    status?: VerificationStatus,
  ): Promise<Paginated<IncidentRow>> {
    const where = status
      ? and(
          eq(incidents.organisationId, organisationId),
          eq(incidents.verificationStatus, status),
        )
      : eq(incidents.organisationId, organisationId);

    // Sequential, not Promise.all: tenantDb.db is one dedicated pg Client per
    // request (TenantInterceptor), not a Pool — concurrent queries on it hit
    // node-postgres's deprecated-and-scheduled-for-removal concurrent-query path.
    const items = await this.tenantDb.db.query.incidents.findMany({
      where,
      orderBy: desc(incidents.createdAt),
      limit,
      offset: (page - 1) * limit,
    });
    const [{ count: total }] = await this.tenantDb.db
      .select({ count: sql<number>`count(*)::int` })
      .from(incidents)
      .where(where);
    return { items, total, page, limit };
  }

  /**
   * Rejection is terminal (a deliberate scope decision — see the plan): the incident
   * stays owned by the claiming org, marked rejected, it does not release back to
   * the pool for another org to re-claim.
   *
   * SRS 3.1.5 treats dismissal as a stage transition, so this also moves
   * currentStageId to the org's Dismissed stage — but that's a bonus on top of the
   * verificationStatus change, not a precondition for it: if the org has deleted
   * their Dismissed stage, rejection still succeeds, it just leaves currentStageId
   * where it was.
   */
  async reject(
    organisationId: string,
    incidentId: string,
    actingUserId: string,
    reason: string,
  ): Promise<IncidentRow> {
    const incident = await this.findScoped(organisationId, incidentId);
    this.assertClaimedAndActive(incident);
    const dismissedStage =
      await this.workflowStagesService.findDismissedStage(organisationId);

    const [updated] = await this.tenantDb.db
      .update(incidents)
      .set({
        verificationStatus: VerificationStatus.REJECTED,
        rejectionReason: reason,
        ...(dismissedStage && { currentStageId: dismissedStage.id }),
        version: sql`${incidents.version} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(incidents.id, incidentId))
      .returning();

    // Sequential, not Promise.all: both calls ultimately query tenantDb.db, one
    // dedicated pg Client per request (TenantInterceptor), not a Pool —
    // concurrent queries on it hit node-postgres's deprecated-and-scheduled-for-
    // removal concurrent-query path.
    await this.auditLogService.record({
      organisationId,
      actingUserId,
      action: 'incident.rejected',
      entityType: 'incident',
      entityId: incidentId,
      metadata: { reason },
    });
    if (incident.reportedByUserId) {
      await this.notificationsService.create({
        userId: incident.reportedByUserId,
        organisationId,
        type: NotificationType.INCIDENT_REJECTED,
        title: 'Incident rejected',
        message: `Your report "${incident.title}" was rejected: ${reason}`,
        relatedEntityType: 'incident',
        relatedEntityId: incidentId,
      });
    }

    return updated;
  }

  async markDuplicate(
    organisationId: string,
    incidentId: string,
    actingUserId: string,
    duplicateOfId: string,
  ): Promise<IncidentRow> {
    const incident = await this.findScoped(organisationId, incidentId);
    this.assertClaimedAndActive(incident);
    await this.findScoped(organisationId, duplicateOfId);

    const [updated] = await this.tenantDb.db
      .update(incidents)
      .set({
        verificationStatus: VerificationStatus.DUPLICATE,
        duplicateOfId,
        updatedAt: new Date(),
      })
      .where(eq(incidents.id, incidentId))
      .returning();

    await this.auditLogService.record({
      organisationId,
      actingUserId,
      action: 'incident.marked_duplicate',
      entityType: 'incident',
      entityId: incidentId,
      metadata: { duplicateOfId },
    });

    return updated;
  }

  /**
   * Manual Status Update (SRS 3.1.21): moves a claimed incident to any of the org's
   * configured stages — forward, backward, or skipping, including into or out of a
   * final stage (reopening). Deliberately does NOT use assertClaimedAndActive: that
   * helper also blocks a second action on an already-rejected/duplicate incident,
   * which is right for reject()/markDuplicate() but wrong here — SRS's "Backward
   * Transitions (Reopening)" explicitly allows moving an incident out of a final
   * stage via this action, so the only precondition is "claimed at all".
   */
  async updateStage(
    organisationId: string,
    incidentId: string,
    dto: UpdateIncidentStageDto,
    actingUserId: string,
  ): Promise<IncidentRow> {
    const incident = await this.findById(incidentId);
    if (incident.organisationId === null) {
      throw new ConflictException(
        'This incident has not been claimed by an organisation yet.',
      );
    }

    const stages = await this.workflowStagesService.listStages(organisationId);
    const targetStage = stages.find((stage) => stage.id === dto.stageId);
    if (!targetStage) {
      throw new UnprocessableEntityException({
        message: `'${dto.stageId}' is not a valid workflow stage for this organisation.`,
        invalidStageId: dto.stageId,
      });
    }

    // No-op: SRS 3.1.21 requires this be accepted (200) without an audit entry or
    // any downstream effect — including the version bump, so it can't itself trip a
    // concurrent caller's optimistic-lock check.
    if (incident.currentStageId === targetStage.id) {
      return incident;
    }

    const versionGuard =
      dto.expectedVersion !== undefined
        ? and(
            eq(incidents.id, incidentId),
            eq(incidents.version, dto.expectedVersion),
          )
        : eq(incidents.id, incidentId);

    const [updated] = await this.tenantDb.db
      .update(incidents)
      .set({
        currentStageId: targetStage.id,
        version: sql`${incidents.version} + 1`,
        updatedAt: new Date(),
      })
      .where(versionGuard)
      .returning();

    if (!updated) {
      throw new ConflictException(
        'Incident status was modified concurrently; please refresh and retry.',
      );
    }

    await this.auditLogService.record({
      organisationId,
      actingUserId,
      action: 'incident.stage_changed',
      entityType: 'incident',
      entityId: incidentId,
      metadata: {
        previousStageId: incident.currentStageId,
        newStageId: targetStage.id,
      },
    });

    return updated;
  }

  /** Renamed from assertPending: claiming auto-verifies (SRS 3.1.5), so "still
   * actionable" now means "claimed and not already rejected/marked-duplicate". */
  private assertClaimedAndActive(incident: IncidentRow): void {
    if (incident.organisationId === null) {
      throw new ForbiddenException(
        'This incident has not been claimed by an organisation yet',
      );
    }
    if (incident.verificationStatus !== VerificationStatus.APPROVED) {
      throw new ForbiddenException(
        'This incident has already been rejected or marked as a duplicate',
      );
    }
  }
}
