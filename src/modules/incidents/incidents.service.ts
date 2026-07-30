import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { VerificationStatus } from '../../common/enums/incident.enum';
import { AuditLogService } from '../audit/audit-log.service';
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
}
