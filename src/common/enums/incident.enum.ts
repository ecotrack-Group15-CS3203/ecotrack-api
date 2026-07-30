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

export enum VerificationStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  DUPLICATE = 'duplicate',
}
