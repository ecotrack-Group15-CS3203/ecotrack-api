import {
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';
import { TaskPriority } from '../../../common/enums/task.enum';

export class CreateTaskDto {
  @IsUUID()
  incidentId: string;

  @IsString()
  @MinLength(1)
  description: string;

  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  @IsOptional()
  @IsISO8601()
  scheduledAt?: string;
}
