import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsISO8601,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class EventLocationDto {
  @Type(() => Number)
  @IsNumber()
  @IsLatitude()
  lat: number;

  @Type(() => Number)
  @IsNumber()
  @IsLongitude()
  lng: number;
}

/** SRS 3.1.7: at least one linked incident is required; each must independently
 * satisfy the org's Event Creation minimum stage (validated in the service, not
 * here — it needs a DB lookup per incident). */
export class CreateEventDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  incidentIds: string[];

  @IsString()
  @MinLength(1)
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @ValidateNested()
  @Type(() => EventLocationDto)
  location: EventLocationDto;

  @IsISO8601()
  scheduledAt: string;

  @IsISO8601()
  endsAt: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxAttendees?: number;
}
