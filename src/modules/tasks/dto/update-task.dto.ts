import { IsEnum, IsISO8601, IsOptional, IsUUID } from 'class-validator';
import { TaskPriority } from '../../../common/enums/task.enum';

/** `assignedTo` here is SRS 3.1.8's reassignment: a new value cancels the
 * current assignment and creates a new one, rather than adding a second. */
export class UpdateTaskDto {
  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  @IsOptional()
  @IsISO8601()
  dueDate?: string;

  @IsOptional()
  @IsUUID()
  assignedTo?: string;
}
