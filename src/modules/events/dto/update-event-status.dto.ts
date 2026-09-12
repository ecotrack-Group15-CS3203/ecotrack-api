import { IsIn } from 'class-validator';

/** Never 'scheduled' — nothing transitions back to the initial state (SRS 3.1.9's
 * lifecycle: scheduled -> ongoing -> completed, or -> cancelled from either). */
export class UpdateEventStatusDto {
  @IsIn(['ongoing', 'completed', 'cancelled'])
  status: 'ongoing' | 'completed' | 'cancelled';
}
