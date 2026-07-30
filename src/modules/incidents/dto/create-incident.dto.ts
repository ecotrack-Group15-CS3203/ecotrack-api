import { Type } from 'class-transformer';
import {
  IsEnum,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import {
  IncidentCategory,
  IncidentSeverity,
} from '../../../common/enums/incident.enum';

export class CreateIncidentDto {
  @IsString()
  @MinLength(1)
  title: string;

  @IsString()
  @MinLength(1)
  description: string;

  @IsEnum(IncidentCategory)
  category: IncidentCategory;

  @IsEnum(IncidentSeverity)
  severity: IncidentSeverity;

  @Type(() => Number)
  @IsLatitude()
  latitude: number;

  @Type(() => Number)
  @IsLongitude()
  longitude: number;

  @IsOptional()
  @IsString()
  address?: string;
}
