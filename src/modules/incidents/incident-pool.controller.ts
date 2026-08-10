import {
  Controller,
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
import { IncidentPoolService } from './incident-pool.service';

/**
 * No `:organisationId` param — with single-org-per-user, "the calling admin's org"
 * is just `user.organisationId`, so there's no ambiguity to resolve the way a
 * multi-org caller would need (see the plan's Milestone 4 notes).
 */
@ApiTags('incidents')
@ApiBearerAuth()
@Roles(UserRole.ORG_ADMIN)
@Controller('incidents/pool')
export class IncidentPoolController {
  constructor(private readonly poolService: IncidentPoolService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.poolService.listPool(user.organisationId!);
  }

  @HttpCode(HttpStatus.OK)
  @Post(':incidentId/claim')
  claim(
    @Param('incidentId', ParseUUIDPipe) incidentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.poolService.claim(incidentId, user.organisationId!, user.id);
  }
}
