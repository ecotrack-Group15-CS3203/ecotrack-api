import { Type } from 'class-transformer';
import {
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

/**
 * SRS 3.1.3: radius query for the citizen hazard map, capped at 50 km with a 10 km
 * default. `@Type(() => Number)` is what lets the global ValidationPipe's
 * `transform: true` turn the string query params into numbers before validating.
 */
export class NearbyIncidentsQuery {
  @Type(() => Number)
  @IsLatitude()
  lat: number;

  @Type(() => Number)
  @IsLongitude()
  lng: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(50_000)
  radius: number = 10_000;
}
