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
}
