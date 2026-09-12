import { IsOptional, IsUUID, ValidateIf } from 'class-validator';

/**
 * Every field is a stage id, or null to reset it, or omitted to leave it unchanged.
 * `@ValidateIf` skips the UUID check specifically for `null` (a real reset,
 * distinct from an absent/undefined key which `@IsOptional` already lets through)
 * while still requiring a well-formed id for any non-null value.
 *
 * A null `*MinStageId` means "no minimum enforced"; a null `*TargetStageId` means
 * "Automatic" (SRS 3.1.13's Workflow Stage Rules panel — both dropdowns default to
 * these). Existence/org-ownership of a non-null id is validated in the service, not
 * here, since it needs a DB lookup.
 */
export class UpdateWorkflowStageRulesDto {
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID('4')
  taskCreationMinStageId?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID('4')
  taskCreationTargetStageId?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID('4')
  eventCreationMinStageId?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID('4')
  eventCreationTargetStageId?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID('4')
  taskCompletionTargetStageId?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID('4')
  eventCompletionTargetStageId?: string | null;
}
