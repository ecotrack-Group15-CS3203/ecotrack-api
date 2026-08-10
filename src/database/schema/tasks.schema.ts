import {
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { baseColumns } from './columns.helpers';
import {
  assignmentStatusEnum,
  taskPriorityEnum,
  taskStatusEnum,
} from './enums.schema';
import { incidents } from './incidents.schema';
import { organisations } from './organisations.schema';
import { users } from './users.schema';

export const tasks = pgTable('tasks', {
  ...baseColumns,
  organisationId: uuid('organisation_id')
    .notNull()
    .references(() => organisations.id, { onDelete: 'cascade' }),
  incidentId: uuid('incident_id')
    .notNull()
    .references(() => incidents.id, { onDelete: 'cascade' }),
  description: text('description').notNull(),
  priority: taskPriorityEnum('priority').notNull().default('medium'),
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
  status: taskStatusEnum('status').notNull().default('pending'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdByUserId: uuid('created_by_user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
});

/**
 * `organisationId` on these three child tables is denormalized from their parent
 * task (a task is always org-owned — unlike incidents, tasks are never "pooled") so
 * each can carry its own straightforward RLS policy instead of a subquery through
 * `tasks`. Kept in sync with the parent by always being set together at insert time
 * in the service layer — there is no independent way to change a task's org after
 * creation, so this can't drift.
 */
export const taskAssignments = pgTable(
  'task_assignments',
  {
    ...baseColumns,
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    volunteerUserId: uuid('volunteer_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: assignmentStatusEnum('status').notNull().default('assigned'),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    declineReason: varchar('decline_reason'),
  },
  (t) => [
    unique('task_assignments_task_volunteer_unique').on(
      t.taskId,
      t.volunteerUserId,
    ),
  ],
);

export const taskNotes = pgTable('task_notes', {
  ...baseColumns,
  organisationId: uuid('organisation_id')
    .notNull()
    .references(() => organisations.id, { onDelete: 'cascade' }),
  taskId: uuid('task_id')
    .notNull()
    .references(() => tasks.id, { onDelete: 'cascade' }),
  authorUserId: uuid('author_user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  note: text('note').notNull(),
});

export const taskPhotos = pgTable('task_photos', {
  ...baseColumns,
  organisationId: uuid('organisation_id')
    .notNull()
    .references(() => organisations.id, { onDelete: 'cascade' }),
  taskId: uuid('task_id')
    .notNull()
    .references(() => tasks.id, { onDelete: 'cascade' }),
  url: varchar('url').notNull(),
  uploadedByUserId: uuid('uploaded_by_user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
});
