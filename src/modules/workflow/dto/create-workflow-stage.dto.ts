import { IsString, Matches, MinLength } from 'class-validator';

export class CreateWorkflowStageDto {
  @IsString()
  @MinLength(1)
  name: string;

  /** Hex color for UI badges (SRS 3.1.13's Workflow Editor stage cards). */
  @IsString()
  @Matches(/^#[0-9a-fA-F]{6}$/, {
    message: 'color must be a 6-digit hex string, e.g. #EF4444',
  })
  color: string;
}
