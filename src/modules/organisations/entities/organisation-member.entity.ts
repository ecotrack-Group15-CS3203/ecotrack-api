import { Column, Entity, Index, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { MembershipRole } from '../../../common/enums/membership-role.enum';
import { User } from '../../users/entities/user.entity';
import { Organisation } from './organisation.entity';

@Entity('organisation_members')
@Unique(['organisationId', 'userId'])
export class OrganisationMember extends BaseEntity {
  @Column({ name: 'organisation_id' })
  @Index()
  organisationId: string;

  @ManyToOne(() => Organisation, (org) => org.members, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organisation_id' })
  organisation: Organisation;

  @Column({ name: 'user_id' })
  @Index()
  userId: string;

  @ManyToOne(() => User, (user) => user.memberships, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({
    type: 'enum',
    enum: MembershipRole,
    default: MembershipRole.COMMUNITY_USER,
  })
  role: MembershipRole;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @Column({ name: 'invited_at', type: 'timestamptz', nullable: true })
  invitedAt: Date | null;

  @Column({ name: 'joined_at', type: 'timestamptz', nullable: true })
  joinedAt: Date | null;
}
