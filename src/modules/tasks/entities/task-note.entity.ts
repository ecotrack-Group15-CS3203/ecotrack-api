import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { User } from '../../users/entities/user.entity';
import { Task } from './task.entity';

@Entity('task_notes')
export class TaskNote extends BaseEntity {
  @Column({ name: 'task_id' })
  @Index()
  taskId: string;

  @ManyToOne(() => Task, (task) => task.notes, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'task_id' })
  task: Task;

  @Column({ name: 'author_user_id' })
  authorUserId: string;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'author_user_id' })
  author: User;

  @Column({ type: 'text' })
  note: string;
}
