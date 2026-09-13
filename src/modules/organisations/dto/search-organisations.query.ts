import { Type } from 'class-transformer';
import {
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * SRS 3.1.14's public organisation directory: free-text search plus an optional
 * point. `lat`/`lng` are both-or-neither — the service rejects a half-supplied pair
 * rather than silently ignoring it.
 */
export class SearchOrganisationsQuery extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  lat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  lng?: number;

  /**
   * Optional extra ceiling on how far away an organisation's centre may be. Distinct
   * from the coverage test: without it the directory returns every organisation whose
   * own service area reaches the caller, however large that area is.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(50_000)
  radius?: number;
}
