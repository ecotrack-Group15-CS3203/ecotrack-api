import { IsBoolean, IsOptional, IsString, Matches } from 'class-validator';

/**
 * Deliberately has no `slug` property. SRS 3.1.13's Slug Immutability rule means
 * there is nothing to validate here — the global ValidationPipe's
 * `forbidNonWhitelisted: true` already 400s any request body that includes one,
 * without this DTO needing a special case for it.
 */
export class UpdateWorkflowStageDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  @Matches(/^#[0-9a-fA-F]{6}$/, {
    message: 'color must be a 6-digit hex string, e.g. #EF4444',
  })
  color?: string;

  @IsOptional()
  @IsBoolean()
  isFinal?: boolean;
}
