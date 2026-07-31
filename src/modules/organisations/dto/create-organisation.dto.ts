import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateOrganisationDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  /**
   * Every organisation needs an admin from the moment it's created, or it's
   * an unreachable empty shell. If this address already has an account, they
   * are added as org_admin directly; otherwise an invitation is created.
   */
  @IsEmail()
  initialAdminEmail: string;
}
