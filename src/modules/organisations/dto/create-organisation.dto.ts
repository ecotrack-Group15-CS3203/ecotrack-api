import { IsOptional, IsString, MinLength } from 'class-validator';

export class CreateOrganisationDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;
}
