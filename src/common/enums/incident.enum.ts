export enum IncidentCategory {
  ILLEGAL_DUMPING = 'illegal_dumping',
  WATER_POLLUTION = 'water_pollution',
  AIR_POLLUTION = 'air_pollution',
  DEFORESTATION = 'deforestation',
  WILDLIFE_HAZARD = 'wildlife_hazard',
  OTHER = 'other',
}

export enum IncidentSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

/**
 * No PENDING member: "pending" is represented by `incidents.organisationId IS NULL`
 * (unclaimed, in the pool), not a verificationStatus value — see
 * schema/enums.schema.ts's `verificationStatusEnum` doc comment. Claiming an incident
 * always sets APPROVED; REJECTED/DUPLICATE are terminal post-claim outcomes.
 */
export enum VerificationStatus {
  APPROVED = 'approved',
  REJECTED = 'rejected',
  DUPLICATE = 'duplicate',
}
