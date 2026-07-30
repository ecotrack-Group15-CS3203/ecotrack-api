import { Column, Entity, Index, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { AssignmentStatus } from '../../../common/enums/task.enum';
import { User } from '../../users/entities/user.entity';
import { Task } from './task.entity';

@Entity('task_assignments')
@Unique(['taskId', 'volunteerUserId'])
export class TaskAssignment extends BaseEntity {
  @Column({ name: 'task_id' })
  @Index()
  taskId: string;

  @ManyToOne(() => Task, (task) => task.assignments, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'task_id' })
  task: Task;

  @Column({ name: 'volunteer_user_id' })
  @Index()
  volunteerUserId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'volunteer_user_id' })
  volunteer: User;

  @Column({
    type: 'enum',
    enum: AssignmentStatus,
    default: AssignmentStatus.ASSIGNED,
  })
  status: AssignmentStatus;

  @Column({ name: 'responded_at', type: 'timestamptz', nullable: true })
  respondedAt: Date | null;
}
