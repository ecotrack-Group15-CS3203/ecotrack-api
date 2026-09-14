export enum NotificationType {
  TASK_ASSIGNED = 'task_assigned',
  /** Renamed from INCIDENT_APPROVED — claiming an incident now replaces "approve". */
  INCIDENT_CLAIMED = 'incident_claimed',
  INCIDENT_REJECTED = 'incident_rejected',
  TASK_STATUS_CHANGED = 'task_status_changed',
  CLEANUP_SCHEDULED = 'cleanup_scheduled',
  TASK_COMPLETED = 'task_completed',
  JOIN_REQUEST_SUBMITTED = 'join_request_submitted',
  JOIN_REQUEST_APPROVED = 'join_request_approved',
  JOIN_REQUEST_REJECTED = 'join_request_rejected',
  EVENT_CANCELLED = 'event_cancelled',
  /** SRS 3.1.4 — an incident was reported within a user's configured alert radius
   * and at or above their configured urgency threshold. */
  INCIDENT_PROXIMITY = 'incident_proximity',
  /** SRS 3.1.8 — sent 24h before a task's dueDate. */
  TASK_DUE_REMINDER = 'task_due_reminder',
  /** SRS 3.1.9 — sent 24h before an event's scheduledAt, to everyone RSVPed. */
  EVENT_REMINDER = 'event_reminder',
  /** SRS 3.1.10 — an org_admin removed this user's volunteer membership. */
  VOLUNTEER_REMOVED = 'volunteer_removed',
}
