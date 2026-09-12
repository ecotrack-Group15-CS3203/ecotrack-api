import { IsInt, IsOptional, IsUUID, Min } from 'class-validator';

export class UpdateIncidentStageDto {
  @IsUUID()
  stageId: string;

  /**
   * Optimistic-concurrency guard (SRS 3.1.21's "Concurrent Modification"): when
   * supplied, the update is conditioned on incidents.version still matching this
   * value, and a mismatch is a 409. Optional because the manual "Update Status"
   * dropdown may be driven by a client that never fetched the current version; an
   * omitted value still applies the change, it just doesn't guard against a
   * concurrent write racing it.
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  expectedVersion?: number;
}
