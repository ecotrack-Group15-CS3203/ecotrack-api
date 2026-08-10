import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { NotificationType } from '../../common/enums/notification.enum';
import { VerificationStatus } from '../../common/enums/incident.enum';
import { incidentImages, incidents } from '../../database/schema';
import { toGeographyPoint } from '../../database/schema/columns.helpers';
import { TenantDbService } from '../../database/tenant-db.service';
import { AuditLogService } from '../audit/audit-log.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateIncidentDto } from './dto/create-incident.dto';

export type IncidentRow = typeof incidents.$inferSelect;

@Injectable()
export class IncidentsService {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly notificationsService: NotificationsService,
    private readonly auditLogService: AuditLogService,
  ) {}

  /**
   * Creates an unclaimed (pooled) incident — no organisationId, no verificationStatus,
   * no currentStageId. Enters the Global Incident Pool immediately; an org_admin
   * claims it later via IncidentPoolService.claim (see incident-pool.service.ts).
   */
  async create(
    reportedByUserId: string,
    dto: CreateIncidentDto,
    imageUrls: string[],
  ): Promise<IncidentRow> {
    if (imageUrls.length === 0) {
      throw new BadRequestException('At least one photograph is required');
    }

    const [saved] = await this.tenantDb.db
      .insert(incidents)
      .values({
        reportedByUserId,
        title: dto.title,
        description: dto.description,
        category: dto.category,
        severity: dto.severity,
        location: toGeographyPoint(dto.latitude, dto.longitude),
        address: dto.address ?? null,
      })
      .returning();

    await this.tenantDb.db
      .insert(incidentImages)
      .values(imageUrls.map((url) => ({ incidentId: saved.id, url })));

    await this.auditLogService.record({
      organisationId: null,
      actingUserId: reportedByUserId,
      action: 'incident.reported',
      entityType: 'incident',
      entityId: saved.id,
    });

    return this.findById(saved.id);
  }

  async findMyReports(
    reportedByUserId: string,
  ): Promise<(IncidentRow & { images: { id: string; url: string }[] })[]> {
    const reports = await this.tenantDb.db.query.incidents.findMany({
      where: eq(incidents.reportedByUserId, reportedByUserId),
      orderBy: desc(incidents.createdAt),
    });
    if (reports.length === 0) return [];
    const images = await this.tenantDb.db.query.incidentImages.findMany({
      where: inArray(
        incidentImages.incidentId,
        reports.map((r) => r.id),
      ),
    });
    return reports.map((report) => ({
      ...report,
      images: images
        .filter((img) => img.incidentId === report.id)
        .map((img) => ({ id: img.id, url: img.url })),
    }));
  }

  /**
   * No manual visibility check needed: RLS (migration 0003) already restricts which
   * rows this query can even see — an org_admin sees their own org's claimed
   * incidents plus the whole pool, a citizen sees their own reports (claimed or not)
   * plus the pool, a platform admin sees everything. A row that isn't visible simply
   * isn't returned, which is exactly "not found" from the caller's perspective.
   */
  async findByIdWithImages(
    id: string,
  ): Promise<IncidentRow & { images: { id: string; url: string }[] }> {
    const incident = await this.findById(id);
    const images = await this.tenantDb.db.query.incidentImages.findMany({
      where: eq(incidentImages.incidentId, id),
    });
    return {
      ...incident,
      images: images.map((img) => ({ id: img.id, url: img.url })),
    };
  }

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

  listForOrg(
    organisationId: string,
    status?: VerificationStatus,
  ): Promise<IncidentRow[]> {
    return this.tenantDb.db.query.incidents.findMany({
      where: status
        ? and(
            eq(incidents.organisationId, organisationId),
            eq(incidents.verificationStatus, status),
          )
        : eq(incidents.organisationId, organisationId),
      orderBy: desc(incidents.createdAt),
    });
  }

  /**
   * Rejection is terminal (a deliberate scope decision — see the plan): the incident
   * stays owned by the claiming org, marked rejected, it does not release back to
   * the pool for another org to re-claim.
   */
  async reject(
    organisationId: string,
    incidentId: string,
    actingUserId: string,
    reason: string,
  ): Promise<IncidentRow> {
    const incident = await this.findScoped(organisationId, incidentId);
    this.assertClaimedAndActive(incident);

    const [updated] = await this.tenantDb.db
      .update(incidents)
      .set({
        verificationStatus: VerificationStatus.REJECTED,
        rejectionReason: reason,
        updatedAt: new Date(),
      })
      .where(eq(incidents.id, incidentId))
      .returning();

    await Promise.all([
      this.auditLogService.record({
        organisationId,
        actingUserId,
        action: 'incident.rejected',
        entityType: 'incident',
        entityId: incidentId,
        metadata: { reason },
      }),
      incident.reportedByUserId
        ? this.notificationsService.create({
            userId: incident.reportedByUserId,
            organisationId,
            type: NotificationType.INCIDENT_REJECTED,
            title: 'Incident rejected',
            message: `Your report "${incident.title}" was rejected: ${reason}`,
            relatedEntityType: 'incident',
            relatedEntityId: incidentId,
          })
        : Promise.resolve(),
    ]);

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
