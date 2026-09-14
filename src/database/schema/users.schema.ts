import {
  boolean,
  integer,
  jsonb,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { baseColumns, geographyPoint } from './columns.helpers';
import { incidentSeverityEnum, roleEnum } from './enums.schema';
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
  /**
   * SRS 3.1.4's proximity alerts — deliberately a SEPARATE point from
   * `homeLocation` above, not reused. `homeLocation`'s consent is scoped to
   * service-area eligibility only; alertCenter has its own consent moment (set
   * when the user first configures a notification radius on mobile) and is the
   * only location ever matched against new incidents. Never populated at
   * registration, and updated only on an explicit settings change — SRS 3.11.3
   * forbids continuous background tracking.
   */
  notificationRadiusMeters: integer('notification_radius_meters')
    .notNull()
    .default(10_000),
  notificationMinUrgency: incidentSeverityEnum('notification_min_urgency')
    .notNull()
    .default('high'),
  alertCenter: geographyPoint('alert_center'),
  alertCenterUpdatedAt: timestamp('alert_center_updated_at', {
    withTimezone: true,
  }),
});
