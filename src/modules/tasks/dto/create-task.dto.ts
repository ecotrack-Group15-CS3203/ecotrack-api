import {
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';
import { TaskPriority } from '../../../common/enums/task.enum';

/** SRS 3.1.6: title and dueDate are required at creation; a task always has
 * exactly one assignee from the outset, not zero-or-more added afterward. */
export class CreateTaskDto {
  @IsUUID()
  incidentId: string;

  @IsString()
  @MinLength(1)
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsUUID()
  assignedTo: string;

  @IsISO8601()
  dueDate: string;

  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;
}
