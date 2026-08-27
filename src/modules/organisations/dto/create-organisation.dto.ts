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
   * Optional. Omitted (the normal, self-service case per SRS 3.1.14), the caller
   * becomes the organisation's first `org_admin`. Supplied with somebody else's
   * address — a platform admin standing up an organisation on their behalf — that
   * account is promoted directly if it exists, or invited if it doesn't.
   *
   * Either way an organisation always gets an admin at creation; it is never left an
   * unreachable empty shell.
   */
  @IsOptional()
  @IsEmail()
  initialAdminEmail?: string;

  /** Required at registration per SRS 3.1.14 — governs pool-claim eligibility. */
  @ValidateNested()
  @Type(() => ServiceAreaCenterDto)
  serviceAreaCenter: ServiceAreaCenterDto;

  @IsServiceAreaRadiusKm()
  serviceAreaRadiusKm: number;
}
