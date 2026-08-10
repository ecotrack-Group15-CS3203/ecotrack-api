import { pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { baseColumns } from './columns.helpers';
import { roleEnum } from './enums.schema';
import { organisations } from './organisations.schema';
import { users } from './users.schema';

export const invitations = pgTable('invitations', {
  ...baseColumns,
  organisationId: uuid('organisation_id')
    .notNull()
    .references(() => organisations.id, { onDelete: 'cascade' }),
  email: varchar('email').notNull(),
  invitedFullName: varchar('invited_full_name'),
  role: roleEnum('role').notNull().default('volunteer'),
  token: varchar('token').notNull().unique(),
  invitedByUserId: uuid('invited_by_user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
});
