import { boolean, jsonb, pgTable, uuid, varchar } from 'drizzle-orm/pg-core';
import { baseColumns, geographyPoint } from './columns.helpers';
import { roleEnum } from './enums.schema';
import { organisations } from './organisations.schema';

export interface NotificationPreferences {
  taskAssigned: boolean;
  scheduleChanged: boolean;
  cleanupScheduled: boolean;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  taskAssigned: true,
  scheduleChanged: true,
  cleanupScheduled: false,
};

/**
 * Single-org-per-user model (decision: match the SRS/SAD's ER diagram rather than the
 * old `organisation_members` join table) — `organisationId`/`role` live directly on
 * the user row. No `passwordHash`: auth is fully delegated to Asgardeo, identity is
 * `authSubject` (Asgardeo's `sub`), just-in-time provisioned on first validated token.
 */
export const users = pgTable('users', {
  ...baseColumns,
  authSubject: varchar('auth_subject').notNull().unique(),
  email: varchar('email').notNull().unique(),
  fullName: varchar('full_name').notNull(),
  role: roleEnum('role').notNull().default('citizen'),
  organisationId: uuid('organisation_id').references(() => organisations.id, {
    onDelete: 'set null',
  }),
  isPlatformAdmin: boolean('is_platform_admin').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  pushToken: varchar('push_token'),
  /**
   * Collected only at join-request/invite-accept time (SRS 3.11.1), never at
   * registration — used exclusively to validate service-area eligibility, never
   * for incident proximity or any other feature. NULL for any user who has never
   * joined an organisation this way.
   */
  homeLocation: geographyPoint('home_location'),
  notificationPreferences: jsonb('notification_preferences')
    .notNull()
    .default(DEFAULT_NOTIFICATION_PREFERENCES),
});
