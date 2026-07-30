import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { User } from '../../users/entities/user.entity';
import { Task } from './task.entity';

@Entity('task_photos')
export class TaskPhoto extends BaseEntity {
  @Column({ name: 'task_id' })
  @Index()
  taskId: string;

  @ManyToOne(() => Task, (task) => task.photos, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'task_id' })
  task: Task;

  @Column()
  url: string;

  @Column({ name: 'uploaded_by_user_id' })
  uploadedByUserId: string;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'uploaded_by_user_id' })
  uploadedBy: User;
}
