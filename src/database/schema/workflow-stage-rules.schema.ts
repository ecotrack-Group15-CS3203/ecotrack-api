import { pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { organisations } from './organisations.schema';
import { workflowStages } from './workflow.schema';

/**
 * One row per organisation (SRS 3.1.13's Workflow Stage Rules panel). `organisationId`
 * is the primary key directly — not `baseColumns`' generated `id` — matching the SAD's
 * ER diagram (Figure 17: `workflow_stage_rules { uuid organisation_id PK_FK }`).
 *
 * All six stage references are nullable and `onDelete: 'set null'`, mirroring
 * `incidents.currentStageId`'s pattern: the DB-level behavior is a defensive
 * fallback, not the actual guard — WorkflowStagesService.deleteStage() blocks
 * deleting a stage a rule still references with a 409 before it ever reaches here.
 *
 * A null `*_min_stage_id` means "no minimum enforced" (the trigger is allowed the
 * moment an incident is claimed, since every claimed incident already satisfies any
 * lower bound); a null `*_target_stage_id` means "Automatic" — WorkflowStageRulesService
 * resolves it to the next stage by position at the moment the trigger fires, per SRS
 * 3.1.21's Auto-Advance Rules. The event_* columns are written and read from day one,
 * but stay inert until an Events module exists to fire those two triggers.
 */
export const workflowStageRules = pgTable('workflow_stage_rules', {
  organisationId: uuid('organisation_id')
    .primaryKey()
    .references(() => organisations.id, { onDelete: 'cascade' }),
  taskCreationMinStageId: uuid('task_creation_min_stage_id').references(
    () => workflowStages.id,
    { onDelete: 'set null' },
  ),
  taskCreationTargetStageId: uuid('task_creation_target_stage_id').references(
    () => workflowStages.id,
    { onDelete: 'set null' },
  ),
  eventCreationMinStageId: uuid('event_creation_min_stage_id').references(
    () => workflowStages.id,
    { onDelete: 'set null' },
  ),
  eventCreationTargetStageId: uuid('event_creation_target_stage_id').references(
    () => workflowStages.id,
    { onDelete: 'set null' },
  ),
  taskCompletionTargetStageId: uuid(
    'task_completion_target_stage_id',
  ).references(() => workflowStages.id, { onDelete: 'set null' }),
  eventCompletionTargetStageId: uuid(
    'event_completion_target_stage_id',
  ).references(() => workflowStages.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});
