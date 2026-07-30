import { IsString, MinLength } from 'class-validator';

export class CreateWorkflowStageDto {
  @IsString()
  @MinLength(1)
  name: string;
}
