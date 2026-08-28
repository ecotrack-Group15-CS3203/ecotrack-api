import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateWorkflowStageDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsBoolean()
  isFinal?: boolean;
}
