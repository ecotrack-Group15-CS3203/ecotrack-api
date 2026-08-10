import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';

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
}
