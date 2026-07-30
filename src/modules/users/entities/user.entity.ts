import { Column, Entity, OneToMany } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { OrganisationMember } from '../../organisations/entities/organisation-member.entity';

@Entity('users')
export class User extends BaseEntity {
  @Column({ name: 'full_name' })
  fullName: string;

  @Column({ unique: true })
  email: string;

  @Column({ name: 'password_hash', select: false })
  passwordHash: string;

  /**
   * Platform administrators are not scoped to any organisation, so this is
   * a flag on the user rather than a MembershipRole value.
   */
  @Column({ name: 'is_platform_admin', default: false })
  isPlatformAdmin: boolean;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @OneToMany(() => OrganisationMember, (member) => member.user)
  memberships: OrganisationMember[];
}
