import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { UsersModule } from '../users/users.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { Invitation } from './entities/invitation.entity';
import { JoinRequest } from './entities/join-request.entity';
import { OrganisationMember } from './entities/organisation-member.entity';
import { Organisation } from './entities/organisation.entity';
import { InvitationsService } from './invitations.service';
import { JoinRequestsService } from './join-requests.service';
import { OrganisationMembersService } from './organisation-members.service';
import { OrganisationsController } from './organisations.controller';
import { OrganisationsService } from './organisations.service';
import { PlatformController } from './platform.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Organisation, OrganisationMember, Invitation, JoinRequest]),
    UsersModule,
    WorkflowModule,
    AuditModule,
  ],
  controllers: [OrganisationsController, PlatformController],
  providers: [
    OrganisationsService,
    OrganisationMembersService,
    InvitationsService,
    JoinRequestsService,
  ],
  exports: [
    OrganisationsService,
    OrganisationMembersService,
    InvitationsService,
    JoinRequestsService,
  ],
})
export class OrganisationsModule {}
