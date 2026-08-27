import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  IncidentCategory,
  IncidentSeverity,
} from '../../../common/enums/incident.enum';

export class IncidentLocationDto {
  @Type(() => Number)
  @IsLatitude()
  lat: number;

  @Type(() => Number)
  @IsLongitude()
  lng: number;
}

/**
 * Mirrors the payload the mobile client already ships (see the mid-eval handoff): a
 * nested `location`, an `urgency` level, and S3 URLs obtained beforehand from
 * `POST /v1/media/upload-url`. No multipart — binary goes straight to S3.
 */
export class CreateIncidentDto {
  @IsString()
  @MinLength(1)
  title: string;

  @IsString()
  @MinLength(1)
  description: string;

  /**
   * The wire field is `urgency` because that is the client's vocabulary; it is stored
   * in the `incidents.severity` column, whose name is unchanged. Same values, same
   * ordering — the rename is presentational only and needs no migration.
   */
  @IsEnum(IncidentSeverity)
  urgency: IncidentSeverity;

  /** Optional: the mobile reporting wizard doesn't collect one. Defaults to `other`. */
  @IsOptional()
  @IsEnum(IncidentCategory)
  category?: IncidentCategory;

  @ValidateNested()
  @Type(() => IncidentLocationDto)
  location: IncidentLocationDto;

  @IsOptional()
  @IsString()
  address?: string;

  /** `mediaUrl` values returned by POST /v1/media/upload-url. */
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  mediaUrls: string[];
}
