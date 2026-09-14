import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsLatitude,
  IsLongitude,
  IsObject,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { IncidentSeverity } from '../../../common/enums/incident.enum';

class NotificationPreferencesDto {
  @IsOptional()
  @IsBoolean()
  taskAssigned?: boolean;

  @IsOptional()
  @IsBoolean()
  scheduleChanged?: boolean;

  @IsOptional()
  @IsBoolean()
  cleanupScheduled?: boolean;
}

const NOTIFICATION_RADIUS_OPTIONS_METERS = [1000, 5000, 10000, 25000, 50000];

class AlertCenterDto {
  @Type(() => Number)
  @IsLatitude()
  lat: number;

  @Type(() => Number)
  @IsLongitude()
  lng: number;
}

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  fullName?: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => NotificationPreferencesDto)
  notificationPreferences?: NotificationPreferencesDto;

  /** SRS 3.1.4's radius picker — one of the same fixed options the UI offers. */
  @IsOptional()
  @IsIn(NOTIFICATION_RADIUS_OPTIONS_METERS)
  notificationRadiusMeters?: number;

  @IsOptional()
  @IsIn(Object.values(IncidentSeverity))
  notificationMinUrgency?: IncidentSeverity;

  /**
   * Set only when the user explicitly configures/updates their alert radius on
   * mobile (SRS 3.11.3: no continuous background tracking, no capture at
   * registration) — a fresh GPS read at that moment, never `homeLocation`.
   */
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => AlertCenterDto)
  alertCenter?: AlertCenterDto;
}
