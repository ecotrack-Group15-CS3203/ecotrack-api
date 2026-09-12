import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { InviteLinkLookupController } from './invite-link-lookup.controller';
import { InviteLinksService } from './invite-links.service';
import { InvitationsService } from './invitations.service';
import { JoinRequestsController } from './join-requests.controller';
import { JoinRequestsService } from './join-requests.service';
import { OrgInviteLinksController } from './org-invite-links.controller';
import { OrganisationMembersService } from './organisation-members.service';
import { OrganisationsController } from './organisations.controller';
import { OrganisationsService } from './organisations.service';
import { PlatformController } from './platform.controller';

@Module({
  imports: [UsersModule, WorkflowModule, AuditModule, NotificationsModule],
  controllers: [
    OrganisationsController,
    PlatformController,
    OrgInviteLinksController,
    InviteLinkLookupController,
    JoinRequestsController,
  ],
  providers: [
    OrganisationsService,
    OrganisationMembersService,
    InvitationsService,
    InviteLinksService,
    JoinRequestsService,
  ],
  exports: [
    OrganisationsService,
    OrganisationMembersService,
    InvitationsService,
    InviteLinksService,
    JoinRequestsService,
  ],
})
export class OrganisationsModule {}
