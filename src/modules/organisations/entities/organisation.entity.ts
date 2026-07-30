import { Column, Entity, OneToMany } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { OrganisationMember } from './organisation-member.entity';

@Entity('organisations')
export class Organisation extends BaseEntity {
  @Column()
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @OneToMany(() => OrganisationMember, (member) => member.organisation)
  members: OrganisationMember[];
}
