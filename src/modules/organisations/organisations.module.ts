import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { UsersModule } from '../users/users.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { Invitation } from './entities/invitation.entity';
import { OrganisationMember } from './entities/organisation-member.entity';
import { Organisation } from './entities/organisation.entity';
import { InvitationsService } from './invitations.service';
import { OrganisationMembersService } from './organisation-members.service';
import { OrganisationsController } from './organisations.controller';
import { OrganisationsService } from './organisations.service';
import { PlatformController } from './platform.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Organisation, OrganisationMember, Invitation]),
    UsersModule,
    WorkflowModule,
    AuditModule,
  ],
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
