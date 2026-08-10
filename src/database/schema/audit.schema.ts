import { jsonb, pgTable, uuid, varchar } from 'drizzle-orm/pg-core';
import { baseColumns } from './columns.helpers';
import { organisations } from './organisations.schema';
import { users } from './users.schema';

export const auditLogs = pgTable('audit_logs', {
  ...baseColumns,
  organisationId: uuid('organisation_id').references(() => organisations.id, {
    onDelete: 'set null',
  }),
  actingUserId: uuid('acting_user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  action: varchar('action').notNull(),
  entityType: varchar('entity_type').notNull(),
  entityId: uuid('entity_id'),
  metadata: jsonb('metadata'),
});
