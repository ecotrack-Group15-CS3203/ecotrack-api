import {
  AnyPgColumn,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { baseColumns, geographyPoint } from './columns.helpers';
import {
  incidentCategoryEnum,
  incidentSeverityEnum,
  verificationStatusEnum,
} from './enums.schema';
import { organisations } from './organisations.schema';
import { users } from './users.schema';
import { workflowStages } from './workflow.schema';

/**
 * Global Incident Pool model: `organisationId IS NULL` means unclaimed/pooled.
 * `claimedByUserId`/`claimedAt` are set atomically together with `organisationId` by
 * the claim endpoint (see incident-pool.service.ts) — never independently.
 * `version` is general optimistic-concurrency defense for concurrent non-claim writes
 * (e.g. two admins editing status at once); it is NOT what makes claiming atomic —
 * that's the `WHERE organization_id IS NULL` predicate in the claim UPDATE.
 */
export const incidents = pgTable('incidents', {
  ...baseColumns,
  organisationId: uuid('organisation_id').references(() => organisations.id, {
    onDelete: 'cascade',
  }),
  reportedByUserId: uuid('reported_by_user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  title: varchar('title').notNull(),
  description: text('description').notNull(),
  category: incidentCategoryEnum('category').notNull(),
  severity: incidentSeverityEnum('severity').notNull(),
  location: geographyPoint('location').notNull(),
  address: text('address'),
  /** null while pooled; set to 'approved' automatically on claim; see enums.schema.ts */
  verificationStatus: verificationStatusEnum('verification_status'),
  currentStageId: uuid('current_stage_id').references(() => workflowStages.id, {
    onDelete: 'set null',
  }),
  rejectionReason: text('rejection_reason'),
  duplicateOfId: uuid('duplicate_of_id').references(
    (): AnyPgColumn => incidents.id,
    {
      onDelete: 'set null',
    },
  ),
  claimedByUserId: uuid('claimed_by_user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  claimedAt: timestamp('claimed_at', { withTimezone: true }),
  version: integer('version').notNull().default(0),
});

/**
 * Deliberately has no `organisationId`/RLS of its own (unlike task_assignments/
 * task_notes/task_photos — see tasks.schema.ts) — its parent incident may still be
 * pooled (organisationId NULL) when images are first attached, which would require
 * duplicating the incidents-table pool exception here for no real security benefit:
 * an image has no sensitive content beyond what's already gated by the parent
 * incident's own RLS-checked read. Access is enforced transitively — the service
 * layer only ever fetches images for an incidentId it already successfully loaded.
 */
export const incidentImages = pgTable('incident_images', {
  ...baseColumns,
  incidentId: uuid('incident_id')
    .notNull()
    .references(() => incidents.id, { onDelete: 'cascade' }),
  url: varchar('url').notNull(),
});
