import {
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { baseColumns } from './columns.helpers';

/**
 * The three kinds this table currently carries — see
 * notifications/dispatch/notification-dispatch.service.ts's handler registry.
 */
export type NotificationDispatchKind =
  'incident_proximity' | 'task_due_reminder' | 'event_reminder';

/** No RLS — see the migration's header comment for why. */
export const notificationDispatches = pgTable('notification_dispatches', {
  ...baseColumns,
  kind: varchar('kind').notNull(),
  entityType: varchar('entity_type').notNull(),
  entityId: uuid('entity_id').notNull(),
  dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
  dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
});
