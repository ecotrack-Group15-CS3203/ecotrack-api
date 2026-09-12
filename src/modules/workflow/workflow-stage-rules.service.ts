import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { workflowStageRules } from '../../database/schema';
import { TenantDbService } from '../../database/tenant-db.service';
import { AuditLogService } from '../audit/audit-log.service';
import {
  WorkflowStageRow,
  WorkflowStagesService,
} from './workflow-stages.service';

export type WorkflowStageRuleRow = typeof workflowStageRules.$inferSelect;

/**
 * The four triggers SRS 3.1.13's Workflow Stage Rules panel configures. Only
 * `taskCreation`/`eventCreation` carry a minimum-stage precondition — Task/Event
 * Completion are consequences of something that must always succeed on its own
 * terms, so those settings only ever affect the downstream advance (SRS 3.1.13,
 * "Only Task Creation and Event Creation carry a minimum-stage precondition").
 */
export type StageRuleTrigger =
  'taskCreation' | 'eventCreation' | 'taskCompletion' | 'eventCompletion';

const MIN_STAGE_COLUMN: Record<
  'taskCreation' | 'eventCreation',
  keyof WorkflowStageRuleRow
> = {
  taskCreation: 'taskCreationMinStageId',
  eventCreation: 'eventCreationMinStageId',
};

const TARGET_STAGE_COLUMN: Record<
  StageRuleTrigger,
  keyof WorkflowStageRuleRow
> = {
  taskCreation: 'taskCreationTargetStageId',
  eventCreation: 'eventCreationTargetStageId',
  taskCompletion: 'taskCompletionTargetStageId',
  eventCompletion: 'eventCompletionTargetStageId',
};

const TRIGGER_LABEL: Record<'taskCreation' | 'eventCreation', string> = {
  taskCreation: 'task',
  eventCreation: 'event',
};

@Injectable()
export class WorkflowStageRulesService {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly auditLogService: AuditLogService,
    private readonly workflowStagesService: WorkflowStagesService,
  ) {}

  /**
   * Every organisation gets a rules row at creation time (see
   * OrganisationsService.create), but this defensively creates one on first read for
   * any org that predates that seeding — e.g. one created before this migration.
   * Default: both creation minimums point at the org's post-claim landing stage
   * (position 1, "Claimed" by default), every target left NULL ("Automatic").
   */
  async getRules(organisationId: string): Promise<WorkflowStageRuleRow> {
    const existing = await this.tenantDb.db.query.workflowStageRules.findFirst({
      where: eq(workflowStageRules.organisationId, organisationId),
    });
    if (existing) return existing;

    const claimStage =
      await this.workflowStagesService.findDefaultClaimStage(organisationId);
    const [created] = await this.tenantDb.db
      .insert(workflowStageRules)
      .values({
        organisationId,
        taskCreationMinStageId: claimStage?.id ?? null,
        eventCreationMinStageId: claimStage?.id ?? null,
      })
      .returning();
    return created;
  }

  async updateRules(
    organisationId: string,
    dto: {
      taskCreationMinStageId?: string | null;
      taskCreationTargetStageId?: string | null;
      eventCreationMinStageId?: string | null;
      eventCreationTargetStageId?: string | null;
      taskCompletionTargetStageId?: string | null;
      eventCompletionTargetStageId?: string | null;
    },
    actingUserId: string,
  ): Promise<WorkflowStageRuleRow> {
    await this.getRules(organisationId); // ensures a row exists to update
    await this.assertBelongsToOrg(organisationId, dto);

    const [updated] = await this.tenantDb.db
      .update(workflowStageRules)
      .set({ ...dto, updatedAt: new Date() })
      .where(eq(workflowStageRules.organisationId, organisationId))
      .returning();

    await this.auditLogService.record({
      organisationId,
      actingUserId,
      action: 'workflow_stage_rules.updated',
      entityType: 'workflow_stage_rules',
      entityId: organisationId,
      metadata: dto,
    });

    return updated;
  }

  private async assertBelongsToOrg(
    organisationId: string,
    dto: Record<string, string | null | undefined>,
  ): Promise<void> {
    const stages = await this.workflowStagesService.listStages(organisationId);
    const ids = new Set(stages.map((s) => s.id));
    for (const [field, value] of Object.entries(dto)) {
      if (value != null && !ids.has(value)) {
        throw new UnprocessableEntityException({
          message: `'${value}' is not a valid workflow stage for this organisation.`,
          field,
          invalidStageId: value,
        });
      }
    }
  }

  /**
   * SRS 3.1.21's minimum-stage precondition for Task/Event Creation. A null minimum
   * means no precondition is configured — every claimed incident already satisfies
   * "no minimum", so the trigger is unconditionally allowed.
   */
  async assertMinimumStageReached(
    organisationId: string,
    trigger: 'taskCreation' | 'eventCreation',
    currentStage: WorkflowStageRow,
  ): Promise<void> {
    const rules = await this.getRules(organisationId);
    const minStageId = rules[MIN_STAGE_COLUMN[trigger]] as string | null;
    if (!minStageId) return;

    const minStage = await this.workflowStagesService.findById(minStageId);
    if (currentStage.position < minStage.position) {
      throw new UnprocessableEntityException(
        `This incident must reach the '${minStage.name}' stage before a ${TRIGGER_LABEL[trigger]} can be created. It is currently at '${currentStage.name}'.`,
      );
    }
  }

  /**
   * SRS 3.1.21's Auto-Advance Rules: the configured target if one is set, else the
   * next stage by position ("Automatic"). Returns undefined — and callers must treat
   * that as "do nothing, silently" — when the incident is already on a final stage,
   * or there's no next stage to advance to.
   */
  async resolveTarget(
    organisationId: string,
    trigger: StageRuleTrigger,
    currentStage: WorkflowStageRow,
  ): Promise<WorkflowStageRow | undefined> {
    if (currentStage.isFinal) return undefined;

    const rules = await this.getRules(organisationId);
    const targetStageId = rules[TARGET_STAGE_COLUMN[trigger]] as string | null;
    if (targetStageId) {
      return this.workflowStagesService.findById(targetStageId);
    }
    return this.workflowStagesService.findNextStage(
      organisationId,
      currentStage,
    );
  }
}
