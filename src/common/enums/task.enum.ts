export enum TaskPriority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
}

export enum TaskStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
}

export enum AssignmentStatus {
  ASSIGNED = 'assigned',
  ACCEPTED = 'accepted',
  DECLINED = 'declined',
  /** Superseded by a reassignment (SRS 3.1.8) — distinct from DECLINED, which
   * means the volunteer themselves refused it. */
  CANCELLED = 'cancelled',
}
