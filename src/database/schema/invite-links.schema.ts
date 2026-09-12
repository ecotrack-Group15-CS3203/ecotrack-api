import {
  integer,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { baseColumns } from './columns.helpers';
import { organisations } from './organisations.schema';
import { users } from './users.schema';

/**
 * SRS 3.1.12's shareable, multi-use invite links — a separate mechanism from
 * `invitations` (which stays email-bound and single-use, still used for the
 * initialAdminEmail org-bootstrap path). `tokenHash` is a SHA-256 hex digest, never
 * the raw token: the plaintext (16 bytes from crypto.randomBytes(), SRS 3.4.7's
 * 128-bit minimum) is generated, returned to the admin exactly once, and never
 * stored — InviteLinksService hashes an incoming redemption token the same way to
 * look it up.
 */
export const inviteLinks = pgTable('invite_links', {
  ...baseColumns,
  organisationId: uuid('organisation_id')
    .notNull()
    .references(() => organisations.id, { onDelete: 'cascade' }),
  tokenHash: varchar('token_hash').notNull().unique(),
  /** NULL = unlimited (SRS 3.1.12). */
  maxUses: integer('max_uses'),
  usesCount: integer('uses_count').notNull().default(0),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdByUserId: uuid('created_by_user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});
