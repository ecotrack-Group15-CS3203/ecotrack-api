import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { VerificationStatus } from '../../common/enums/incident.enum';
import { NotificationType } from '../../common/enums/notification.enum';
import { AuditLogService } from '../audit/audit-log.service';
import { NotificationsService } from '../notifications/notifications.service';
import { WorkflowStagesService } from '../workflow/workflow-stages.service';
import { CreateIncidentDto } from './dto/create-incident.dto';
import { IncidentImage } from './entities/incident-image.entity';
import { Incident } from './entities/incident.entity';

@Injectable()
export class IncidentsService {
  constructor(
    @InjectRepository(Incident)
    private readonly incidentsRepository: Repository<Incident>,
    @InjectRepository(IncidentImage)
    private readonly imagesRepository: Repository<IncidentImage>,
    private readonly workflowStagesService: WorkflowStagesService,
    private readonly notificationsService: NotificationsService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async create(
    organisationId: string,
    reportedByUserId: string,
    dto: CreateIncidentDto,
    imageUrls: string[],
  ): Promise<Incident> {
    if (imageUrls.length === 0) {
      throw new BadRequestException('At least one photograph is required');
    }

    const firstStage =
      await this.workflowStagesService.findFirstStage(organisationId);

    const incident = this.incidentsRepository.create({
      organisationId,
      reportedByUserId,
      title: dto.title,
      description: dto.description,
      category: dto.category,
      severity: dto.severity,
      latitude: dto.latitude,
      longitude: dto.longitude,
      address: dto.address ?? null,
      verificationStatus: VerificationStatus.PENDING,
      currentStageId: firstStage?.id ?? null,
    });
    const saved = await this.incidentsRepository.save(incident);

    const images = imageUrls.map((url) =>
      this.imagesRepository.create({ incidentId: saved.id, url }),
    );
    await this.imagesRepository.save(images);

    await this.auditLogService.record({
      organisationId,
      actingUserId: reportedByUserId,
      action: 'incident.reported',
      entityType: 'incident',
      entityId: saved.id,
    });

    return this.findById(saved.id);
  }

  findMyReports(reportedByUserId: string): Promise<Incident[]> {
    return this.incidentsRepository.find({
      where: { reportedByUserId },
      relations: { images: true, currentStage: true },
      order: { createdAt: 'DESC' },
    });
  }

  async findById(id: string): Promise<Incident> {
    const incident = await this.incidentsRepository.findOne({
      where: { id },
      relations: { images: true, currentStage: true },
    });
    if (!incident) {
      throw new NotFoundException('Incident not found');
    }
    return incident;
  }

  /** Loads an incident and confirms it belongs to the given organisation. */
  async findScoped(
    organisationId: string,
    incidentId: string,
  ): Promise<Incident> {
    const incident = await this.findById(incidentId);
    if (incident.organisationId !== organisationId) {
      throw new NotFoundException('Incident not found');
    }
    return incident;
  }

  listForOrg(
    organisationId: string,
    status?: VerificationStatus,
  ): Promise<Incident[]> {
    return this.incidentsRepository.find({
      where: status
        ? { organisationId, verificationStatus: status }
        : { organisationId },
      relations: { images: true, currentStage: true },
      order: { createdAt: 'DESC' },
    });
  }

  async approve(
    organisationId: string,
    incidentId: string,
    verifiedByUserId: string,
  ): Promise<Incident> {
    const incident = await this.findScoped(organisationId, incidentId);
    this.assertPending(incident);

    incident.verificationStatus = VerificationStatus.APPROVED;
    incident.verifiedByUserId = verifiedByUserId;
    incident.verifiedAt = new Date();

    if (incident.currentStage) {
      const nextStage = await this.workflowStagesService.findNextStage(
        organisationId,
        incident.currentStage,
      );
      // Setting only currentStageId is not enough: TypeORM re-derives the FK
      // from the still-loaded `currentStage` relation object on save, so the
      // relation itself must be updated too.
      incident.currentStage = nextStage;
      incident.currentStageId = nextStage.id;
    }

    await this.incidentsRepository.save(incident);

    await Promise.all([
      this.auditLogService.record({
        organisationId,
        actingUserId: verifiedByUserId,
        action: 'incident.approved',
        entityType: 'incident',
        entityId: incident.id,
      }),
      this.notificationsService.create({
        userId: incident.reportedByUserId,
        organisationId,
        type: NotificationType.INCIDENT_APPROVED,
        title: 'Incident approved',
        message: `Your report "${incident.title}" has been verified and approved.`,
        relatedEntityType: 'incident',
        relatedEntityId: incident.id,
      }),
    ]);

    return this.findById(incident.id);
  }

  async reject(
    organisationId: string,
    incidentId: string,
    verifiedByUserId: string,
    reason: string,
  ): Promise<Incident> {
    const incident = await this.findScoped(organisationId, incidentId);
    this.assertPending(incident);

    incident.verificationStatus = VerificationStatus.REJECTED;
    incident.verifiedByUserId = verifiedByUserId;
    incident.verifiedAt = new Date();
    incident.rejectionReason = reason;

    await this.incidentsRepository.save(incident);

    await Promise.all([
      this.auditLogService.record({
        organisationId,
        actingUserId: verifiedByUserId,
        action: 'incident.rejected',
        entityType: 'incident',
        entityId: incident.id,
        metadata: { reason },
      }),
      this.notificationsService.create({
        userId: incident.reportedByUserId,
        organisationId,
        type: NotificationType.INCIDENT_REJECTED,
        title: 'Incident rejected',
        message: `Your report "${incident.title}" was rejected: ${reason}`,
        relatedEntityType: 'incident',
        relatedEntityId: incident.id,
      }),
    ]);

    return this.findById(incident.id);
  }

  async markDuplicate(
    organisationId: string,
    incidentId: string,
    verifiedByUserId: string,
    duplicateOfId: string,
  ): Promise<Incident> {
    const incident = await this.findScoped(organisationId, incidentId);
    this.assertPending(incident);
    await this.findScoped(organisationId, duplicateOfId);

    incident.verificationStatus = VerificationStatus.DUPLICATE;
    incident.verifiedByUserId = verifiedByUserId;
    incident.verifiedAt = new Date();
    incident.duplicateOfId = duplicateOfId;

    await this.incidentsRepository.save(incident);

    await this.auditLogService.record({
      organisationId,
      actingUserId: verifiedByUserId,
      action: 'incident.marked_duplicate',
      entityType: 'incident',
      entityId: incident.id,
      metadata: { duplicateOfId },
    });

    return this.findById(incident.id);
  }

  private assertPending(incident: Incident): void {
    if (incident.verificationStatus !== VerificationStatus.PENDING) {
      throw new ForbiddenException('This incident has already been verified');
    }
  }
}
