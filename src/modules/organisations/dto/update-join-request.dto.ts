import { IsEnum } from 'class-validator';
import { JoinRequestStatus } from '../../../common/enums/join-request.enum';

export class UpdateJoinRequestDto {
  @IsEnum(JoinRequestStatus)
  status: JoinRequestStatus;
}