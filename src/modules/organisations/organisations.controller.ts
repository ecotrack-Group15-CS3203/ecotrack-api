import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { PLATFORM_ADMIN } from '../../common/enums/app-role.enum';
import { UserRole } from '../../common/enums/user-role.enum';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-request.interface';
import { AcceptInviteLinkDto } from './dto/accept-invite-link.dto';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { CreateOrganisationDto } from './dto/create-organisation.dto';
import { ListMembersQuery } from './dto/list-members.query';
import { SearchOrganisationsQuery } from './dto/search-organisations.query';
import { SubmitJoinRequestDto } from './dto/submit-join-request.dto';
import { UpdateOrganisationDto } from './dto/update-organisation.dto';
import { InviteLinksService } from './invite-links.service';
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
    private readonly inviteLinksService: InviteLinksService,
    private readonly joinRequestsService: JoinRequestsService,
  ) {}

  /**
   * Deliberately has no @Roles: any authenticated user may register an organisation
   * and becomes its first org_admin (SRS 3.1.14). The one-org-per-user rule is
   * enforced in the service against the caller's DB-resolved membership, not here.
   *
   * Rate-limited per SRS 3.4.11 (new-tenant registration is brute-force/enumeration
   * sensitive) — applied locally rather than globally, see app.module.ts.
   */
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post()
  create(
    @Body() dto: CreateOrganisationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.organisationsService.create(
      {
        name: dto.name,
        description: dto.description,
        contactEmail: dto.contactEmail,
        initialAdminEmail: dto.initialAdminEmail,
        serviceArea: {
          center: dto.serviceAreaCenter,
          radiusKm: dto.serviceAreaRadiusKm,
        },
      },
      {
        id: user.id,
        email: user.email,
        organisationId: user.organisationId,
      },
    );
  }

  @Roles(PLATFORM_ADMIN)
  @Get()
  findAll() {
    return this.organisationsService.findAll();
  }

  /** Unauthenticated org picker for mobile registration — name only, active orgs only. */
  @Public()
  @Get('public')
  listPublic(@Query() query: SearchOrganisationsQuery) {
    return this.organisationsService.listPublic(query);
  }

  /** Backs the public /orgs/[slug] web page (SRS 3.1.14) — declared before the
   * :organisationId route below so "by-slug" is never captured as a UUID param. */
  @Public()
  @Get('by-slug/:slug')
  findBySlug(@Param('slug') slug: string) {
    return this.organisationsService.findBySlug(slug);
  }

  @Roles(UserRole.ORG_ADMIN, PLATFORM_ADMIN)
  @Get(':organisationId')
  findOne(@Param('organisationId', ParseUUIDPipe) organisationId: string) {
    return this.organisationsService.findById(organisationId);
  }

  @Roles(UserRole.ORG_ADMIN, PLATFORM_ADMIN)
  @Patch(':organisationId')
  update(
    @Param('organisationId', ParseUUIDPipe) organisationId: string,
    @Body() dto: UpdateOrganisationDto,
  ) {
    return this.organisationsService.updateProfile(organisationId, {
      name: dto.name,
      description: dto.description,
      contactEmail: dto.contactEmail,
      ...(dto.serviceAreaCenter &&
        dto.serviceAreaRadiusKm && {
          serviceArea: {
            center: dto.serviceAreaCenter,
            radiusKm: dto.serviceAreaRadiusKm,
          },
        }),
    });
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

  @Roles(UserRole.ORG_ADMIN, PLATFORM_ADMIN)
  @Get(':organisationId/members')
  listMembers(
    @Param('organisationId', ParseUUIDPipe) organisationId: string,
    @Query() query: ListMembersQuery,
  ) {
    return this.membersService.listMembersPaginated(
      organisationId,
      query,
      query.role,
    );
  }

  @Roles(UserRole.ORG_ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':organisationId/volunteers/:userId')
  removeVolunteer(
    @Param('organisationId', ParseUUIDPipe) organisationId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.membersService.removeVolunteer(organisationId, userId, user.id);
  }

  @Roles(UserRole.ORG_ADMIN)
  @Post(':organisationId/invitations')
  createInvitation(
    @Param('organisationId', ParseUUIDPipe) organisationId: string,
    @Body() dto: CreateInvitationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.invitationsService.create({
      organisationId,
      email: dto.email,
      fullName: dto.fullName,
      invitedByUserId: user.id,
    });
  }

  @Roles(PLATFORM_ADMIN)
  @Get(':organisationId/admin-invitations')
  listAdminInvitations(
    @Param('organisationId', ParseUUIDPipe) organisationId: string,
  ) {
    return this.invitationsService.listForOrganisation(
      organisationId,
      UserRole.ORG_ADMIN,
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

  /**
   * SRS 3.1.11. No @Roles restriction, same reasoning as org registration and
   * invite-link redemption below — a citizen with no membership is the intended
   * caller, but the real business rules (geo-eligibility, already a member,
   * duplicate request) are enforced in the service.
   *
   * Rate-limited per SRS 3.4.11, which names this exact endpoint explicitly.
   */
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('join-request')
  submitJoinRequest(
    @Body() dto: SubmitJoinRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.joinRequestsService.submit(user.id, {
      organisationId: dto.organisationId,
      lat: dto.lat,
      lng: dto.lng,
      message: dto.message,
    });
  }

  /**
   * SRS 3.1.12's invite-link redemption. No @Roles restriction — any authenticated
   * user may attempt this, same reasoning as org registration's create() above:
   * the real business rules (already a member elsewhere, outside the service area)
   * are enforced in the service, not via role gating here.
   *
   * Rate-limited per SRS 3.4.11, same as the public lookup this pairs with.
   */
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('invites/accept')
  acceptInviteLink(
    @Body() dto: AcceptInviteLinkDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.inviteLinksService.accept(dto.token, user.id, {
      lat: dto.lat,
      lng: dto.lng,
    });
  }
}
