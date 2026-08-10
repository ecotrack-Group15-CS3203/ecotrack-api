import { pgEnum } from 'drizzle-orm/pg-core';

/** Matches the Asgardeo `role` claim vocabulary exactly (renamed from the old `community_user`). */
export const roleEnum = pgEnum('role', ['citizen', 'volunteer', 'org_admin']);

export const incidentCategoryEnum = pgEnum('incident_category', [
  'illegal_dumping',
  'water_pollution',
  'air_pollution',
  'deforestation',
  'wildlife_hazard',
  'other',
]);

export const incidentSeverityEnum = pgEnum('incident_severity', [
  'low',
  'medium',
  'high',
  'critical',
]);

/**
 * No `pending` value: pending == unclaimed, which is represented by
 * `incidents.organisationId IS NULL`, not a verificationStatus value. Claim always
 * sets `approved`; `rejected`/`duplicate` are terminal post-claim outcomes.
 */
export const verificationStatusEnum = pgEnum('verification_status', [
  'approved',
  'rejected',
  'duplicate',
]);

export const taskPriorityEnum = pgEnum('task_priority', [
  'low',
  'medium',
  'high',
]);

export const taskStatusEnum = pgEnum('task_status', [
  'pending',
  'in_progress',
  'completed',
]);

export const assignmentStatusEnum = pgEnum('assignment_status', [
  'assigned',
  'accepted',
  'declined',
]);

/** `incident_approved` renamed `incident_claimed` to match the pool/claim model. */
export const notificationTypeEnum = pgEnum('notification_type', [
  'task_assigned',
  'incident_claimed',
  'incident_rejected',
  'task_status_changed',
  'cleanup_scheduled',
  'task_completed',
]);
