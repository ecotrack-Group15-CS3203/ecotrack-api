import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class RespondAssignmentDto {
  @IsBoolean()
  accept: boolean;

  /** Only meaningful when accept is false. */
  @IsOptional()
  @IsString()
  reason?: string;
}
