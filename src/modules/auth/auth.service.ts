import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { MembershipRole } from '../../common/enums/membership-role.enum';
import { AuditLogService } from '../audit/audit-log.service';
import { InvitationsService } from '../organisations/invitations.service';
import { OrganisationMembersService } from '../organisations/organisation-members.service';
import { OrganisationsService } from '../organisations/organisations.service';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';

const SALT_ROUNDS = 10;

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly organisationsService: OrganisationsService,
    private readonly membersService: OrganisationMembersService,
    private readonly invitationsService: InvitationsService,
    private readonly jwtService: JwtService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.usersService.findByEmail(dto.email);
    if (existing) {
      throw new ConflictException('Email is already registered');
    }

    let organisationId: string;
    let role: MembershipRole;

    if (dto.invitationToken) {
      const invitation = await this.invitationsService.findValidByToken(
        dto.invitationToken,
      );
      if (
        !invitation ||
        invitation.acceptedAt ||
        invitation.expiresAt < new Date()
      ) {
        throw new BadRequestException('Invitation is invalid or has expired');
      }
      const invitedOrganisation = await this.organisationsService.findById(
        invitation.organisationId,
      );
      if (!invitedOrganisation.isActive) {
        throw new BadRequestException('Organisation is not active');
      }
      organisationId = invitation.organisationId;
      role = invitation.role;

      const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
      const user = await this.usersService.createUser({
        fullName: dto.fullName,
        email: dto.email,
        passwordHash,
      });
      await this.membersService.createMembership({
        organisationId,
        userId: user.id,
        role,
      });
      await this.invitationsService.markAccepted(invitation);
      return this.buildAuthResponse(user.id, user.email, user.isPlatformAdmin);
    }

    if (dto.organisationId) {
      const organisation = await this.organisationsService.findById(
        dto.organisationId,
      );
      if (!organisation.isActive) {
        throw new BadRequestException('Organisation is not active');
      }
      organisationId = organisation.id;
      role = MembershipRole.COMMUNITY_USER;

      const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
      const user = await this.usersService.createUser({
        fullName: dto.fullName,
        email: dto.email,
        passwordHash,
      });
      await this.membersService.createMembership({
        organisationId,
        userId: user.id,
        role,
      });
      return this.buildAuthResponse(user.id, user.email, user.isPlatformAdmin);
    }

    throw new BadRequestException(
      'Registration requires either an invitationToken or an organisationId',
    );
  }

  async login(dto: LoginDto) {
    const user = await this.usersService.findByEmailWithPassword(dto.email);
    const passwordMatches =
      user && user.isActive
        ? await bcrypt.compare(dto.password, user.passwordHash)
        : false;

    if (!user || !user.isActive || !passwordMatches) {
      await this.auditLogService.record({
        actingUserId: user?.id ?? null,
        action: 'auth.login_failed',
        entityType: 'user',
        entityId: user?.id ?? null,
        metadata: { email: dto.email },
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.auditLogService.record({
      actingUserId: user.id,
      action: 'auth.login_succeeded',
      entityType: 'user',
      entityId: user.id,
    });

    return this.buildAuthResponse(user.id, user.email, user.isPlatformAdmin);
  }

  async getProfile(userId: string) {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new UnauthorizedException();
    }
    const memberships =
      await this.membersService.findMembershipsForUser(userId);
    return {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      isPlatformAdmin: user.isPlatformAdmin,
      memberships: memberships.map((m) => ({
        organisationId: m.organisationId,
        organisationName: m.organisation.name,
        organisationIsActive: m.organisation.isActive,
        role: m.role,
      })),
    };
  }

  private buildAuthResponse(
    userId: string,
    email: string,
    isPlatformAdmin: boolean,
  ) {
    const payload: JwtPayload = { sub: userId, email, isPlatformAdmin };
    return {
      accessToken: this.jwtService.sign(payload),
      user: { id: userId, email, isPlatformAdmin },
    };
  }
}
