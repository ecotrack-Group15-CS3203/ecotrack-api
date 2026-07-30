import {
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @IsString()
  @MinLength(1)
  fullName: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  /** Present for volunteers registering off an organisation admin's invite link. */
  @IsOptional()
  @IsString()
  invitationToken?: string;

  /** Present for community users joining an organisation directly. */
  @IsOptional()
  @IsUUID()
  organisationId?: string;
}
