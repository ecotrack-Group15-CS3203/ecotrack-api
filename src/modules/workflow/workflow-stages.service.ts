import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, count, eq, ne } from 'drizzle-orm';
import { incidents, workflowStages } from '../../database/schema';
import { TenantDbService } from '../../database/tenant-db.service';
import { AuditLogService } from '../audit/audit-log.service';

export type WorkflowStageRow = typeof workflowStages.$inferSelect;

export const DEFAULT_WORKFLOW_STAGES: { name: string; color: string }[] = [
  { name: 'Reported', color: '#EF4444' },
  { name: 'Claimed', color: '#F59E0B' },
  { name: 'Cleanup Scheduled', color: '#3B82F6' },
  { name: 'Resolved', color: '#22C55E' },
  { name: 'Dismissed', color: '#6B7280' },
];

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s_-]/g, '')
    .replace(/[\s-]+/g, '_');
}

@Injectable()
export class WorkflowStagesService {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly auditLogService: AuditLogService,
  ) {}

  listStages(organisationId: string): Promise<WorkflowStageRow[]> {
    return this.tenantDb.db.query.workflowStages.findMany({
      where: eq(workflowStages.organisationId, organisationId),
      orderBy: asc(workflowStages.position),
    });
  }

  findFirstStage(
    organisationId: string,
  ): Promise<WorkflowStageRow | undefined> {
    return this.tenantDb.db.query.workflowStages.findFirst({
      where: eq(workflowStages.organisationId, organisationId),
      orderBy: asc(workflowStages.position),
    });
  }

  /**
   * The stage an incident lands on immediately after being claimed. Per SRS 3.1.13,
   * position 0 ("Reported") is the fixed, shared Global Incident Pool stage — it's
   * seeded per-org for the workflow editor's display purposes only, no incident's
   * `currentStageId` ever actually points at it (pool incidents have `currentStageId
   * IS NULL`). The default post-claim landing spot is position 1; falls back to
   * position 0 if an org has somehow deleted down to a single stage.
   */
  async findDefaultClaimStage(
    organisationId: string,
  ): Promise<WorkflowStageRow | undefined> {
    const stages = await this.listStages(organisationId);
    return stages[1] ?? stages[0];
  }

  async findNextStage(
    organisationId: string,
    currentStage: WorkflowStageRow,
  ): Promise<WorkflowStageRow> {
    const next = await this.tenantDb.db.query.workflowStages.findFirst({
      where: and(
        eq(workflowStages.organisationId, organisationId),
        eq(workflowStages.position, currentStage.position + 1),
      ),
    });
    return next ?? currentStage;
  }

  async findById(id: string): Promise<WorkflowStageRow> {
    const stage = await this.tenantDb.db.query.workflowStages.findFirst({
      where: eq(workflowStages.id, id),
    });
    if (!stage) {
      throw new NotFoundException('Workflow stage not found');
    }
    return stage;
  }

  async findScoped(
    organisationId: string,
    id: string,
  ): Promise<WorkflowStageRow> {
    const stage = await this.findById(id);
    if (stage.organisationId !== organisationId) {
      throw new NotFoundException('Workflow stage not found');
    }
    return stage;
  }

  /** Appends a numeric suffix on conflict, per SRS 3.1.13's "Duplicate Slug Handling". */
  private async uniqueSlug(
    organisationId: string,
    name: string,
  ): Promise<string> {
    const base = slugify(name);
    let candidate = base;
    let suffix = 2;
    while (
      await this.tenantDb.db.query.workflowStages.findFirst({
        where: and(
          eq(workflowStages.organisationId, organisationId),
          eq(workflowStages.slug, candidate),
        ),
      })
    ) {
      candidate = `${base}_${suffix}`;
      suffix += 1;
    }
    return candidate;
  }

  async seedDefaultStages(organisationId: string): Promise<WorkflowStageRow[]> {
    const values = await Promise.all(
      DEFAULT_WORKFLOW_STAGES.map(async (stage, position) => ({
        organisationId,
        name: stage.name,
        slug: await this.uniqueSlug(organisationId, stage.name),
        color: stage.color,
        position,
        isFinal:
          position === DEFAULT_WORKFLOW_STAGES.length - 1 ||
          stage.name === 'Resolved',
      })),
    );
    return this.tenantDb.db.insert(workflowStages).values(values).returning();
  }

  async createStage(data: {
    organisationId: string;
    name: string;
    color: string;
    actingUserId: string;
  }): Promise<WorkflowStageRow> {
    const stages = await this.listStages(data.organisationId);
    const slug = await this.uniqueSlug(data.organisationId, data.name);
    const [saved] = await this.tenantDb.db
      .insert(workflowStages)
      .values({
        organisationId: data.organisationId,
        name: data.name,
        slug,
        color: data.color,
        position: stages.length,
        isFinal: false,
      })
      .returning();
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
  ): Promise<WorkflowStageRow[]> {
    const stages = await this.listStages(organisationId);
    if (orderedStageIds.length !== stages.length) {
      throw new BadRequestException(
        'Reorder list must include every existing stage exactly once',
      );
    }
    const byId = new Map(stages.map((stage) => [stage.id, stage]));
    for (const id of orderedStageIds) {
      if (!byId.has(id)) {
        throw new BadRequestException(`Unknown stage id: ${id}`);
      }
    }
    const updated = await Promise.all(
      orderedStageIds.map((id, position) =>
        this.tenantDb.db
          .update(workflowStages)
          .set({ position, updatedAt: new Date() })
          .where(eq(workflowStages.id, id))
          .returning()
          .then(([row]) => row),
      ),
    );
    await this.auditLogService.record({
      organisationId,
      actingUserId,
      action: 'workflow_stage.reordered',
      entityType: 'workflow_stage',
      metadata: { orderedStageIds },
    });
    return updated.sort((a, b) => a.position - b.position);
  }

  async markFinal(
    id: string,
    isFinal: boolean,
    actingUserId: string,
  ): Promise<WorkflowStageRow> {
    const stage = await this.findById(id);
    const [saved] = await this.tenantDb.db
      .update(workflowStages)
      .set({ isFinal, updatedAt: new Date() })
      .where(eq(workflowStages.id, id))
      .returning();
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

  async deleteStage(id: string, actingUserId: string): Promise<void> {
    const stage = await this.findById(id);
    const [{ inUse }] = await this.tenantDb.db
      .select({ inUse: count() })
      .from(incidents)
      .where(eq(incidents.currentStageId, id));
    if (inUse > 0) {
      throw new BadRequestException(
        'Cannot delete a workflow stage that is currently in use by one or more incidents',
      );
    }
    await this.tenantDb.db
      .delete(workflowStages)
      .where(eq(workflowStages.id, id));

    // Renumber remaining stages so positions stay contiguous (0..n-1).
    const remaining = await this.tenantDb.db.query.workflowStages.findMany({
      where: and(
        eq(workflowStages.organisationId, stage.organisationId),
        ne(workflowStages.id, id),
      ),
      orderBy: asc(workflowStages.position),
    });
    await Promise.all(
      remaining.map((s, position) =>
        position === s.position
          ? Promise.resolve()
          : this.tenantDb.db
              .update(workflowStages)
              .set({ position })
              .where(eq(workflowStages.id, s.id)),
      ),
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
