import { IsInt, IsOptional, Min } from 'class-validator';

export class CreateInviteLinkDto {
  /** Omitted = unlimited (SRS 3.1.12). */
  @IsOptional()
  @IsInt()
  @Min(1)
  maxUses?: number;

  /** Omitted defaults to 7 days, applied in the service. */
  @IsOptional()
  @IsInt()
  @Min(1)
  expiresInDays?: number;
}
