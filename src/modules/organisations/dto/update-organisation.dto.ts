import { Type } from 'class-transformer';
import {
  IsEmail,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  IsServiceAreaRadiusKm,
  ServiceAreaCenterDto,
} from './service-area.dto';

/**
 * Changing the service area only affects future pool queries (SRS 3.1.14) — it does
 * not retroactively touch already-claimed incidents, so there's no side effect to
 * guard against here beyond normal validation.
 */
export class UpdateOrganisationDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEmail()
  contactEmail?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ServiceAreaCenterDto)
  serviceAreaCenter?: ServiceAreaCenterDto;

  @IsOptional()
  @IsServiceAreaRadiusKm()
  serviceAreaRadiusKm?: number;
}
