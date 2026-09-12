import {
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

/** SRS 3.1.11: geographic eligibility is checked against a location submitted
 * fresh with the request, not a stored one. */
export class SubmitJoinRequestDto {
  @IsUUID()
  organisationId: string;

  @IsNumber()
  @IsLatitude()
  lat: number;

  @IsNumber()
  @IsLongitude()
  lng: number;

  @IsOptional()
  @IsString()
  message?: string;
}
