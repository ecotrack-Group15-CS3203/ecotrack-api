import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLogService } from '../audit/audit-log.service';
import { MembershipRole } from '../../common/enums/membership-role.enum';
import { UsersService } from '../users/users.service';
import { WorkflowStagesService } from '../workflow/workflow-stages.service';
import { Invitation } from './entities/invitation.entity';
import { Organisation } from './entities/organisation.entity';
import { InvitationsService } from './invitations.service';
import { OrganisationMembersService } from './organisation-members.service';

@Injectable()
export class OrganisationsService {
  constructor(
    @InjectRepository(Organisation)
    private readonly organisationsRepository: Repository<Organisation>,
    private readonly workflowStagesService: WorkflowStagesService,
    private readonly auditLogService: AuditLogService,
    private readonly usersService: UsersService,
    private readonly membersService: OrganisationMembersService,
    private readonly invitationsService: InvitationsService,
  ) {}

  findAll(): Promise<Organisation[]> {
    return this.organisationsRepository.find({ order: { name: 'ASC' } });
  }

  async findById(id: string): Promise<Organisation> {
    const organisation = await this.organisationsRepository.findOne({
      where: { id },
    });
    if (!organisation) {
      throw new NotFoundException('Organisation not found');
    }
    return organisation;
  }

  async create(
    data: { name: string; description?: string; initialAdminEmail: string },
    actingUserId: string,
  ): Promise<{
    organisation: Organisation;
    adminInvitation: Invitation | null;
    adminAlreadyExisted: boolean;
  }> {
    const organisation = this.organisationsRepository.create({
      name: data.name,
      description: data.description ?? null,
    });
    const saved = await this.organisationsRepository.save(organisation);
    await this.workflowStagesService.seedDefaultStages(saved.id);
    await this.auditLogService.record({
      organisationId: saved.id,
      actingUserId,
      action: 'organisation.created',
      entityType: 'organisation',
      entityId: saved.id,
    });

    const existingUser = await this.usersService.findByEmail(
      data.initialAdminEmail,
    );
    let adminInvitation: Invitation | null = null;
    if (existingUser) {
      await this.membersService.createMembership({
        organisationId: saved.id,
        userId: existingUser.id,
        role: MembershipRole.ORG_ADMIN,
      });
    } else {
      adminInvitation = await this.invitationsService.create({
        organisationId: saved.id,
        email: data.initialAdminEmail,
        role: MembershipRole.ORG_ADMIN,
        invitedByUserId: actingUserId,
      });
    }

    return {
      organisation: saved,
      adminInvitation,
      adminAlreadyExisted: !!existingUser,
    };
  }

  async updateProfile(
    id: string,
    data: { name?: string; description?: string },
  ): Promise<Organisation> {
    const organisation = await this.findById(id);
    if (data.name !== undefined) organisation.name = data.name;
    if (data.description !== undefined)
      organisation.description = data.description;
    return this.organisationsRepository.save(organisation);
  }

  async setActive(
    id: string,
    isActive: boolean,
    actingUserId: string,
  ): Promise<Organisation> {
    const organisation = await this.findById(id);
    organisation.isActive = isActive;
    const saved = await this.organisationsRepository.save(organisation);
    await this.auditLogService.record({
      organisationId: id,
      actingUserId,
      action: isActive ? 'organisation.activated' : 'organisation.deactivated',
      entityType: 'organisation',
      entityId: id,
    });
    return saved;
  }

  async getPlatformStats() {
    const [totalOrganisations, activeOrganisations] = await Promise.all([
      this.organisationsRepository.count(),
      this.organisationsRepository.count({ where: { isActive: true } }),
    ]);
    return { totalOrganisations, activeOrganisations };
  }
}
