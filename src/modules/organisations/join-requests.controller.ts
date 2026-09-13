import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-request.interface';
import { ListJoinRequestsQuery } from './dto/list-join-requests.query';
import { UpdateJoinRequestStatusDto } from './dto/update-join-request-status.dto';
import { JoinRequestsService } from './join-requests.service';

/** Admin review side of SRS 3.1.11 — submission itself is
 * OrganisationsController.submitJoinRequest, top-level rather than org-scoped
 * since the caller doesn't have a membership in the target org yet. */
@ApiTags('join-requests')
@ApiBearerAuth()
@Roles(UserRole.ORG_ADMIN)
@Controller('organisations/:organisationId/join-requests')
export class JoinRequestsController {
  constructor(private readonly joinRequestsService: JoinRequestsService) {}

  @Get()
  list(
    @Param('organisationId', ParseUUIDPipe) organisationId: string,
    @Query() query: ListJoinRequestsQuery,
  ) {
    return this.joinRequestsService.listForOrganisation(
      organisationId,
      query,
      query.status,
    );
  }

  @HttpCode(HttpStatus.OK)
  @Patch(':requestId')
  updateStatus(
    @Param('organisationId', ParseUUIDPipe) organisationId: string,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body() dto: UpdateJoinRequestStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.joinRequestsService.updateStatus(
      organisationId,
      requestId,
      dto.status,
      user.id,
    );
  }
}
