import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { Repository } from 'typeorm';
import { MembershipRole } from '../../common/enums/membership-role.enum';
import { Invitation } from './entities/invitation.entity';

const INVITATION_TTL_DAYS = 7;

@Injectable()
export class InvitationsService {
  constructor(
    @InjectRepository(Invitation)
    private readonly invitationsRepository: Repository<Invitation>,
  ) {}

  async create(data: {
    organisationId: string;
    email: string;
    role?: MembershipRole;
    invitedByUserId: string;
  }): Promise<Invitation> {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + INVITATION_TTL_DAYS);

    const invitation = this.invitationsRepository.create({
      organisationId: data.organisationId,
      email: data.email,
      role: data.role ?? MembershipRole.VOLUNTEER,
      invitedByUserId: data.invitedByUserId,
      token: randomBytes(24).toString('hex'),
      expiresAt,
    });
    return this.invitationsRepository.save(invitation);
  }

  findValidByToken(token: string): Promise<Invitation | null> {
    return this.invitationsRepository.findOne({ where: { token } });
  }

  markAccepted(invitation: Invitation): Promise<Invitation> {
    invitation.acceptedAt = new Date();
    return this.invitationsRepository.save(invitation);
  }
}
