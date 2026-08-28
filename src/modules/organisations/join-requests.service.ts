import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JoinRequestStatus } from '../../common/enums/join-request.enum';
import { MembershipRole } from '../../common/enums/membership-role.enum';
import { JoinRequest } from './entities/join-request.entity';
import { OrganisationMembersService } from './organisation-members.service';

@Injectable()
export class JoinRequestsService {
  constructor(
    @InjectRepository(JoinRequest) private readonly requestsRepository: Repository<JoinRequest>,
    private readonly membersService: OrganisationMembersService,
  ) {}

  listForOrganisation(organisationId: string): Promise<JoinRequest[]> {
    return this.requestsRepository.find({
      where: { organisationId },
      relations: { requester: true },
      order: { createdAt: 'DESC' },
    });
  }

  async update(
    organisationId: string,
    requestId: string,
    status: JoinRequestStatus,
  ): Promise<JoinRequest> {
    const request = await this.requestsRepository.findOne({
      where: { id: requestId, organisationId },
      relations: { requester: true },
    });
    if (!request) throw new NotFoundException('Join request not found');
    if (request.status !== JoinRequestStatus.PENDING) {
      throw new BadRequestException('This join request has already been decided');
    }

    if (status === JoinRequestStatus.APPROVED) {
      const membership = await this.membersService.findMembership(
        organisationId,
        request.requesterUserId,
      );
      if (membership) {
        membership.isActive = true;
        await this.membersService.save(membership);
      } else {
        await this.membersService.createMembership({
          organisationId,
          userId: request.requesterUserId,
          role: MembershipRole.COMMUNITY_USER,
        });
      }
    }

    request.status = status;
    return this.requestsRepository.save(request);
  }
}