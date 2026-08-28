import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLogService } from '../audit/audit-log.service';
import { Incident } from '../incidents/entities/incident.entity';
import { WorkflowStage } from './entities/workflow-stage.entity';

export const DEFAULT_WORKFLOW_STAGES = [
  'Reported',
  'Under Review',
  'Verified',
  'Cleanup Scheduled',
  'In Progress',
  'Resolved',
];

@Injectable()
export class WorkflowStagesService {
  constructor(
    @InjectRepository(WorkflowStage)
    private readonly stagesRepository: Repository<WorkflowStage>,
    private readonly auditLogService: AuditLogService,
  ) {}

  async seedDefaultStages(organisationId: string): Promise<WorkflowStage[]> {
    const stages = DEFAULT_WORKFLOW_STAGES.map((name, position) =>
      this.stagesRepository.create({
        organisationId,
        name,
        position,
        isFinal: position === DEFAULT_WORKFLOW_STAGES.length - 1,
      }),
    );
    return this.stagesRepository.save(stages);
  }

  listStages(organisationId: string): Promise<WorkflowStage[]> {
    return this.stagesRepository.find({
      where: { organisationId },
      order: { position: 'ASC' },
    });
  }

  findFirstStage(organisationId: string): Promise<WorkflowStage | null> {
    return this.stagesRepository.findOne({
      where: { organisationId },
      order: { position: 'ASC' },
    });
  }

  async findNextStage(
    organisationId: string,
    currentStage: WorkflowStage,
  ): Promise<WorkflowStage> {
    const next = await this.stagesRepository.findOne({
      where: { organisationId, position: currentStage.position + 1 },
    });
    return next ?? currentStage;
  }

  async findById(id: string): Promise<WorkflowStage> {
    const stage = await this.stagesRepository.findOne({ where: { id } });
    if (!stage) {
      throw new NotFoundException('Workflow stage not found');
    }
    return stage;
  }

  async findScoped(organisationId: string, id: string): Promise<WorkflowStage> {
    const stage = await this.findById(id);
    if (stage.organisationId !== organisationId) {
      throw new NotFoundException('Workflow stage not found');
    }
    return stage;
  }

  async createStage(data: {
    organisationId: string;
    name: string;
    actingUserId: string;
  }): Promise<WorkflowStage> {
    const stages = await this.listStages(data.organisationId);
    const position = stages.length;
    const stage = this.stagesRepository.create({
      organisationId: data.organisationId,
      name: data.name,
      position,
      isFinal: false,
    });
    const saved = await this.stagesRepository.save(stage);
    await this.auditLogService.record({
      organisationId: data.organisationId,
      actingUserId: data.actingUserId,
      action: 'workflow_stage.created',
      entityType: 'workflow_stage',
      entityId: saved.id,
    });
    return saved;
  }

  async reorderStages(
    organisationId: string,
    orderedStageIds: string[],
    actingUserId: string,
  ): Promise<WorkflowStage[]> {
    const stages = await this.listStages(organisationId);
    if (orderedStageIds.length !== stages.length) {
      throw new BadRequestException(
        'Reorder list must include every existing stage exactly once',
      );
    }
    const byId = new Map(stages.map((stage) => [stage.id, stage]));
    const temporaryPositionOffset = stages.length;
    const saved = await this.stagesRepository.manager.transaction(async (manager) => {
      const repository = manager.getRepository(WorkflowStage);
      stages.forEach((stage, index) => {
        stage.position = index + temporaryPositionOffset;
      });
      await repository.save(stages);
      const updated = orderedStageIds.map((id, position) => {
        const stage = byId.get(id);
        if (!stage) {
          throw new BadRequestException(`Unknown stage id: ${id}`);
        }
        stage.position = position;
        return stage;
      });
      return repository.save(updated);
    });
    await this.auditLogService.record({
      organisationId,
      actingUserId,
      action: 'workflow_stage.reordered',
      entityType: 'workflow_stage',
      metadata: { orderedStageIds },
    });
    return saved;
  }

  async markFinal(
    id: string,
    isFinal: boolean,
    actingUserId: string,
  ): Promise<WorkflowStage> {
    const stage = await this.findById(id);
    stage.isFinal = isFinal;
    const saved = await this.stagesRepository.save(stage);
    await this.auditLogService.record({
      organisationId: stage.organisationId,
      actingUserId,
      action: 'workflow_stage.marked_final',
      entityType: 'workflow_stage',
      entityId: id,
      metadata: { isFinal },
    });
    return saved;
  }

  async updateStage(
    id: string,
    data: { name?: string; isFinal?: boolean },
    actingUserId: string,
  ): Promise<WorkflowStage> {
    const stage = await this.findById(id);
    if (data.name !== undefined) stage.name = data.name.trim();
    if (data.isFinal !== undefined) stage.isFinal = data.isFinal;
    const saved = await this.stagesRepository.save(stage);
    await this.auditLogService.record({
      organisationId: stage.organisationId,
      actingUserId,
      action: 'workflow_stage.updated',
      entityType: 'workflow_stage',
      entityId: id,
      metadata: data,
    });
    return saved;
  }

  async deleteStage(id: string, actingUserId: string): Promise<void> {
    const stage = await this.findById(id);
    const inUse = await this.stagesRepository.manager
      .getRepository(Incident)
      .countBy({ currentStageId: id });
    if (inUse > 0) {
      throw new BadRequestException(
        'Cannot delete a workflow stage that is currently in use by one or more incidents',
      );
    }
    await this.stagesRepository.remove(stage);

    // Renumber remaining stages so positions stay contiguous (0..n-1) and
    // the "advance to next stage" lookup on incident approval keeps working.
    const remaining = await this.listStages(stage.organisationId);
    await this.stagesRepository.save(
      remaining.map((s, position) => ({ ...s, position })),
    );

    await this.auditLogService.record({
      organisationId: stage.organisationId,
      actingUserId,
      action: 'workflow_stage.deleted',
      entityType: 'workflow_stage',
      entityId: id,
    });
  }
}
