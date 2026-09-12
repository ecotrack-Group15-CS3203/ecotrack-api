import {
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsString,
  MinLength,
} from 'class-validator';

/** SRS 3.1.12: geographic eligibility is checked the same way as a join request
 * (3.1.11) — the caller's current position, submitted fresh at accept time. */
export class AcceptInviteLinkDto {
  @IsString()
  @MinLength(1)
  token: string;

  @IsNumber()
  @IsLatitude()
  lat: number;

  @IsNumber()
  @IsLongitude()
  lng: number;
}
