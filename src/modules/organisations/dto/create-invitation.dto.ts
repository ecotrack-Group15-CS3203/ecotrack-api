import { IsEmail, IsOptional, IsString } from 'class-validator';

export class CreateInvitationDto {
  @IsEmail()
  email: string;

  @IsOptional()
  @IsString()
  fullName?: string;
}
