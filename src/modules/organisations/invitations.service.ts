import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { Repository } from 'typeorm';
import { MembershipRole } from '../../common/enums/membership-role.enum';
import { Invitation } from './entities/invitation.entity';

const VOLUNTEER_INVITATION_TTL_HOURS = 24 * 7;
const ORG_ADMIN_INVITATION_TTL_HOURS = 72;

@Injectable()
export class InvitationsService {
  constructor(
    @InjectRepository(Invitation)
    private readonly invitationsRepository: Repository<Invitation>,
  ) {}

  private computeExpiry(role: MembershipRole): Date {
    const ttlHours =
      role === MembershipRole.ORG_ADMIN
        ? ORG_ADMIN_INVITATION_TTL_HOURS
        : VOLUNTEER_INVITATION_TTL_HOURS;
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + ttlHours);
    return expiresAt;
  }

  async create(data: {
    organisationId: string;
    email: string;
    role?: MembershipRole;
    invitedByUserId: string;
  }): Promise<Invitation> {
    const role = data.role ?? MembershipRole.VOLUNTEER;
    const invitation = this.invitationsRepository.create({
      organisationId: data.organisationId,
      email: data.email,
      role,
      invitedByUserId: data.invitedByUserId,
      token: randomBytes(24).toString('hex'),
      expiresAt: this.computeExpiry(role),
    });
    return this.invitationsRepository.save(invitation);
  }

  findValidByToken(token: string): Promise<Invitation | null> {
    return this.invitationsRepository.findOne({
      where: { token },
      relations: { organisation: true },
    });
  }

  listForOrganisation(
    organisationId: string,
    role?: MembershipRole,
  ): Promise<Invitation[]> {
    return this.invitationsRepository.find({
      where: role ? { organisationId, role } : { organisationId },
      order: { createdAt: 'DESC' },
    });
  }

  async resend(organisationId: string, invitationId: string): Promise<Invitation> {
    const invitation = await this.invitationsRepository.findOne({
      where: { id: invitationId },
    });
    if (!invitation || invitation.organisationId !== organisationId) {
      throw new NotFoundException('Invitation not found');
    }
    if (invitation.acceptedAt) {
      throw new BadRequestException('This invitation has already been accepted');
    }
    invitation.token = randomBytes(24).toString('hex');
    invitation.expiresAt = this.computeExpiry(invitation.role);
    return this.invitationsRepository.save(invitation);
  }

  markAccepted(invitation: Invitation): Promise<Invitation> {
    invitation.acceptedAt = new Date();
    return this.invitationsRepository.save(invitation);
  }
}
