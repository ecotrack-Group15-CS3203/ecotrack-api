import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { NotificationType } from '../../../common/enums/notification.enum';
import { Organisation } from '../../organisations/entities/organisation.entity';
import { User } from '../../users/entities/user.entity';

@Entity('notifications')
export class Notification extends BaseEntity {
  @Column({ name: 'user_id' })
  @Index()
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'organisation_id', type: 'uuid', nullable: true })
  organisationId: string | null;

  @ManyToOne(() => Organisation, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'organisation_id' })
  organisation: Organisation | null;

  @Column({ type: 'enum', enum: NotificationType })
  type: NotificationType;

  @Column()
  title: string;

  @Column({ type: 'text' })
  message: string;

  /** Lets the client link back to the incident/task that triggered this notification. */
  @Column({ name: 'related_entity_type', type: 'varchar', nullable: true })
  relatedEntityType: string | null;

  @Column({ name: 'related_entity_id', type: 'uuid', nullable: true })
  relatedEntityId: string | null;

  @Column({ name: 'is_read', default: false })
  isRead: boolean;
}
