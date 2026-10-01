import { IsEnum, IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { VerificationStatus } from '../../../common/enums/incident.enum';

export class ListOrgIncidentsQuery extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(VerificationStatus)
  status?: VerificationStatus;

  /** Narrows to incidents the Workflow Stage Rules currently allow a task/event
   * to be created from — feeds the Create Task / Create Event pickers. */
  @IsOptional()
  @IsIn(['taskCreation', 'eventCreation'])
  eligibleFor?: 'taskCreation' | 'eventCreation';
}
