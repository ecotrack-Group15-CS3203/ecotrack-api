import { IsEnum } from 'class-validator';
import { EventStatus } from '../../../common/enums/event.enum';

export class UpdateEventStatusDto {
  @IsEnum(EventStatus)
  status: EventStatus;
}