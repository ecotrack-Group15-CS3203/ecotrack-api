import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { UsersModule } from '../users/users.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { InvitationsService } from './invitations.service';
import { OrganisationMembersService } from './organisation-members.service';
import { OrganisationsController } from './organisations.controller';
import { OrganisationsService } from './organisations.service';
import { PlatformController } from './platform.controller';

@Module({
  imports: [UsersModule, WorkflowModule, AuditModule],
  controllers: [OrganisationsController, PlatformController],
  providers: [
    OrganisationsService,
    OrganisationMembersService,
    InvitationsService,
  ],
  exports: [
    OrganisationsService,
    OrganisationMembersService,
    InvitationsService,
  ],
})
export class OrganisationsModule {}
