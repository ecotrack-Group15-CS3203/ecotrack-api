import { pgTable, uuid, varchar } from 'drizzle-orm/pg-core';
import { baseColumns } from './columns.helpers';
import { joinRequestStatusEnum } from './enums.schema';
import { organisations } from './organisations.schema';
import { users } from './users.schema';

/**
 * SRS 3.1.11. Duplicate-prevention (no second pending/approved request to the same
 * org) is enforced by a partial unique index added in
 * 0014_join_requests_rls.sql — Drizzle's schema DSL doesn't express a filtered
 * unique index, same reason RLS itself lives in a hand-written migration.
 */
export const joinRequests = pgTable('join_requests', {
  ...baseColumns,
  organisationId: uuid('organisation_id')
    .notNull()
    .references(() => organisations.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  message: varchar('message'),
  status: joinRequestStatusEnum('status').notNull().default('pending'),
});
