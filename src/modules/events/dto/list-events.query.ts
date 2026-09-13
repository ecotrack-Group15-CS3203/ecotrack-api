import { IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import type { EventStatus } from '../events.service';

const EVENT_STATUSES: EventStatus[] = [
  'scheduled',
  'ongoing',
  'completed',
  'cancelled',
];

export class ListEventsQuery extends PaginationQueryDto {
  @IsOptional()
  @IsIn(EVENT_STATUSES)
  status?: EventStatus;
}
