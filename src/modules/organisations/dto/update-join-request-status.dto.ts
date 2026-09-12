import { IsIn } from 'class-validator';

/** Only these two — 'pending' is the initial state, never a target to set back to. */
export class UpdateJoinRequestStatusDto {
  @IsIn(['approved', 'rejected'])
  status: 'approved' | 'rejected';
}
