import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MembershipRole } from '../../common/enums/membership-role.enum';
import { OrganisationMember } from './entities/organisation-member.entity';

@Injectable()
export class OrganisationMembersService {
  constructor(
    @InjectRepository(OrganisationMember)
    private readonly membersRepository: Repository<OrganisationMember>,
  ) {}

  findMembership(
    organisationId: string,
    userId: string,
  ): Promise<OrganisationMember | null> {
    return this.membersRepository.findOne({
      where: { organisationId, userId },
      relations: { organisation: true },
    });
  }

  findMembershipsForUser(userId: string): Promise<OrganisationMember[]> {
    return this.membersRepository.find({
      where: { userId, isActive: true },
      relations: { organisation: true },
      order: { createdAt: 'ASC' },
    });
  }

  createMembership(data: {
    organisationId: string;
    userId: string;
    role: MembershipRole;
  }): Promise<OrganisationMember> {
    const member = this.membersRepository.create({
      ...data,
      isActive: true,
      joinedAt: new Date(),
    });
    return this.membersRepository.save(member);
  }

  save(member: OrganisationMember): Promise<OrganisationMember> {
    return this.membersRepository.save(member);
  }

  listMembers(
    organisationId: string,
    role?: MembershipRole,
  ): Promise<OrganisationMember[]> {
    return this.membersRepository.find({
      where: role ? { organisationId, role } : { organisationId },
      relations: { user: true },
      order: { createdAt: 'ASC' },
    });
  }

  listAvailableVolunteers(
    organisationId: string,
  ): Promise<OrganisationMember[]> {
    return this.membersRepository.find({
      where: {
        organisationId,
        role: MembershipRole.VOLUNTEER,
        isActive: true,
      },
      relations: { user: true },
    });
  }
}
