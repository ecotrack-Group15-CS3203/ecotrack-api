import { ArrayMinSize, IsUUID } from 'class-validator';

export class ReorderWorkflowStagesDto {
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  orderedStageIds: string[];
}
