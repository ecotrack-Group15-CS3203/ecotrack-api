import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { MembershipRole } from '../../common/enums/membership-role.enum';
import { PLATFORM_ADMIN } from '../../common/enums/app-role.enum';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-request.interface';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { CreateOrganisationDto } from './dto/create-organisation.dto';
import { UpdateJoinRequestDto } from './dto/update-join-request.dto';
import { UpdateOrganisationDto } from './dto/update-organisation.dto';
import { InvitationsService } from './invitations.service';
import { JoinRequestsService } from './join-requests.service';
import { OrganisationMembersService } from './organisation-members.service';
import { OrganisationsService } from './organisations.service';

@ApiTags('organisations')
@ApiBearerAuth()
@Controller('organisations')
export class OrganisationsController {
  constructor(
    private readonly organisationsService: OrganisationsService,
    private readonly membersService: OrganisationMembersService,
    private readonly invitationsService: InvitationsService,
    private readonly joinRequestsService: JoinRequestsService,
  ) {}

  @Post()
  create(
    @Body() dto: CreateOrganisationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.organisationsService.create(dto, user.id);
  }

  @Roles(PLATFORM_ADMIN)
  @Get()
  findAll() {
    return this.organisationsService.findAll();
  }

  @Roles(MembershipRole.ORG_ADMIN, PLATFORM_ADMIN)
  @Get(':organisationId')
  findOne(@Param('organisationId', ParseUUIDPipe) organisationId: string) {
    return this.organisationsService.findById(organisationId);
  }

  @Roles(MembershipRole.ORG_ADMIN, PLATFORM_ADMIN)
  @Patch(':organisationId')
  update(
    @Param('organisationId', ParseUUIDPipe) organisationId: string,
    @Body() dto: UpdateOrganisationDto,
  ) {
    return this.organisationsService.updateProfile(organisationId, dto);
  }

  @Roles(PLATFORM_ADMIN)
  @HttpCode(HttpStatus.OK)
  @Patch(':organisationId/activate')
  activate(
    @Param('organisationId', ParseUUIDPipe) organisationId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.organisationsService.setActive(organisationId, true, user.id);
  }

  @Roles(PLATFORM_ADMIN)
  @HttpCode(HttpStatus.OK)
  @Patch(':organisationId/deactivate')
  deactivate(
    @Param('organisationId', ParseUUIDPipe) organisationId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.organisationsService.setActive(organisationId, false, user.id);
  }

  @Roles(MembershipRole.ORG_ADMIN, PLATFORM_ADMIN)
  @Get(':organisationId/members')
  listMembers(
    @Param('organisationId', ParseUUIDPipe) organisationId: string,
    @Query('role') role?: MembershipRole,
  ) {
    return this.membersService.listMembers(organisationId, role);
  }

  @Roles(MembershipRole.ORG_ADMIN, PLATFORM_ADMIN)
  @HttpCode(HttpStatus.OK)
  @Patch(':organisationId/members/:userId/deactivate')
  deactivateMember(
    @Param('organisationId', ParseUUIDPipe) organisationId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.membersService.setMembershipActive(organisationId, userId, false);
  }

  @Roles(MembershipRole.ORG_ADMIN, PLATFORM_ADMIN)
  @Get(':organisationId/join-requests')
  listJoinRequests(@Param('organisationId', ParseUUIDPipe) organisationId: string) {
    return this.joinRequestsService.listForOrganisation(organisationId);
  }

  @Roles(MembershipRole.ORG_ADMIN)
  @Patch(':organisationId/join-requests/:requestId')
  updateJoinRequest(
    @Param('organisationId', ParseUUIDPipe) organisationId: string,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body() dto: UpdateJoinRequestDto,
  ) {
    return this.joinRequestsService.update(organisationId, requestId, dto.status);
  }

  @Roles(MembershipRole.ORG_ADMIN)
  @Post(':organisationId/invitations')
  createInvitation(
    @Param('organisationId', ParseUUIDPipe) organisationId: string,
    @Body() dto: CreateInvitationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.invitationsService.create({
      organisationId,
      email: dto.email,
      invitedByUserId: user.id,
    });
  }

  @Roles(MembershipRole.ORG_ADMIN, PLATFORM_ADMIN)
  @Get(':organisationId/invitations')
  listInvitations(@Param('organisationId', ParseUUIDPipe) organisationId: string) {
    return this.invitationsService.listForOrganisation(organisationId);
  }

  @Roles(PLATFORM_ADMIN)
  @Get(':organisationId/admin-invitations')
  listAdminInvitations(
    @Param('organisationId', ParseUUIDPipe) organisationId: string,
  ) {
    return this.invitationsService.listForOrganisation(
      organisationId,
      MembershipRole.ORG_ADMIN,
    );
  }

  @Roles(PLATFORM_ADMIN)
  @HttpCode(HttpStatus.OK)
  @Post(':organisationId/admin-invitations/:invitationId/resend')
  resendAdminInvitation(
    @Param('organisationId', ParseUUIDPipe) organisationId: string,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
  ) {
    return this.invitationsService.resend(organisationId, invitationId);
  }
}
