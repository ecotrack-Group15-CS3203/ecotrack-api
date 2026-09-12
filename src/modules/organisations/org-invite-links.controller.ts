import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-request.interface';
import { CreateInviteLinkDto } from './dto/create-invite-link.dto';
import { InviteLinksService } from './invite-links.service';

/** Admin management of SRS 3.1.12's shareable invite links — separate from the
 * email-bound single-use `invitations` resource (CreateInvitationDto et al). */
@ApiTags('invite-links')
@ApiBearerAuth()
@Roles(UserRole.ORG_ADMIN)
@Controller('organisations/:organisationId/invites')
export class OrgInviteLinksController {
  constructor(private readonly inviteLinksService: InviteLinksService) {}

  @Post()
  create(
    @Param('organisationId', ParseUUIDPipe) organisationId: string,
    @Body() dto: CreateInviteLinkDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.inviteLinksService.generate(organisationId, dto, user.id);
  }

  @Get()
  list(@Param('organisationId', ParseUUIDPipe) organisationId: string) {
    return this.inviteLinksService.listForOrganisation(organisationId);
  }

  @HttpCode(HttpStatus.OK)
  @Delete(':inviteId')
  revoke(
    @Param('organisationId', ParseUUIDPipe) organisationId: string,
    @Param('inviteId', ParseUUIDPipe) inviteId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.inviteLinksService.revoke(organisationId, inviteId, user.id);
  }
}
