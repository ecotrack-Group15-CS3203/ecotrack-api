export enum NotificationType {
  TASK_ASSIGNED = 'task_assigned',
  /** Renamed from INCIDENT_APPROVED — claiming an incident now replaces "approve". */
  INCIDENT_CLAIMED = 'incident_claimed',
  INCIDENT_REJECTED = 'incident_rejected',
  TASK_STATUS_CHANGED = 'task_status_changed',
  CLEANUP_SCHEDULED = 'cleanup_scheduled',
  TASK_COMPLETED = 'task_completed',
}
