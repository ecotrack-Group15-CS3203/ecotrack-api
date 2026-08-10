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

export class CreateOrganisationDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsEmail()
  contactEmail: string;

  /**
   * Every organisation needs an admin from the moment it's created, or it's
   * an unreachable empty shell. If this address already has an account, they
   * are added as org_admin directly; otherwise an invitation is created.
   */
  @IsEmail()
  initialAdminEmail: string;

  /** Required at registration per SRS 3.1.14 — governs pool-claim eligibility. */
  @ValidateNested()
  @Type(() => ServiceAreaCenterDto)
  serviceAreaCenter: ServiceAreaCenterDto;

  @IsServiceAreaRadiusKm()
  serviceAreaRadiusKm: number;
}
