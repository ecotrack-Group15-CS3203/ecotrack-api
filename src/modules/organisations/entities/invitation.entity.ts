import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { MembershipRole } from '../../../common/enums/membership-role.enum';
import { User } from '../../users/entities/user.entity';
import { Organisation } from './organisation.entity';

@Entity('invitations')
export class Invitation extends BaseEntity {
  @Column({ name: 'organisation_id' })
  @Index()
  organisationId: string;

  @ManyToOne(() => Organisation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organisation_id' })
  organisation: Organisation;

  @Column()
  email: string;

  @Column({
    type: 'enum',
    enum: MembershipRole,
    default: MembershipRole.VOLUNTEER,
  })
  role: MembershipRole;

  @Column({ unique: true })
  token: string;

  @Column({ name: 'invited_by_user_id' })
  invitedByUserId: string;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'invited_by_user_id' })
  invitedBy: User;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'accepted_at', type: 'timestamptz', nullable: true })
  acceptedAt: Date | null;
}
