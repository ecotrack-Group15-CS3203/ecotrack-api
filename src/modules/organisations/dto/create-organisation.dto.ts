import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateOrganisationDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  /** The authenticated creator is assigned as the initial organisation admin. */
  @IsOptional()
  @IsEmail()
  initialAdminEmail?: string;
}
