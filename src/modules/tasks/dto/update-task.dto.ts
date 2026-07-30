import { IsEnum, IsISO8601, IsOptional } from 'class-validator';
import { TaskPriority } from '../../../common/enums/task.enum';

export class UpdateTaskDto {
  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  @IsOptional()
  @IsISO8601()
  scheduledAt?: string;
}
