import {
  BadRequestException,
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
import { PLATFORM_ADMIN } from '../../common/enums/app-role.enum';
import { VerificationStatus } from '../../common/enums/incident.enum';
import { UserRole } from '../../common/enums/user-role.enum';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-request.interface';
import { MarkDuplicateDto } from './dto/mark-duplicate.dto';
import { RejectIncidentDto } from './dto/reject-incident.dto';
import { IncidentsService } from './incidents.service';

/** Actions on incidents already claimed by a specific org — separate from the
 * pool-independent citizen routes in incidents.controller.ts. */
@ApiTags('incidents')
@ApiBearerAuth()
@Controller('organisations/:organisationId/incidents')
export class OrgIncidentsController {
  constructor(private readonly incidentsService: IncidentsService) {}

  @Roles(UserRole.ORG_ADMIN, PLATFORM_ADMIN)
  @Get()
  findAll(
    @Param('organisationId', ParseUUIDPipe) organisationId: string,
    @Query('status') status?: VerificationStatus,
  ) {
    return this.incidentsService.listForOrg(organisationId, status);
  }

  @Roles(UserRole.ORG_ADMIN)
  @HttpCode(HttpStatus.OK)
  @Patch(':incidentId/reject')
  reject(
    @Param('organisationId', ParseUUIDPipe) organisationId: string,
    @Param('incidentId', ParseUUIDPipe) incidentId: string,
    @Body() dto: RejectIncidentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.incidentsService.reject(
      organisationId,
      incidentId,
      user.id,
      dto.reason,
    );
  }

  @Roles(UserRole.ORG_ADMIN)
  @HttpCode(HttpStatus.OK)
  @Patch(':incidentId/duplicate')
  markDuplicate(
    @Param('organisationId', ParseUUIDPipe) organisationId: string,
    @Param('incidentId', ParseUUIDPipe) incidentId: string,
    @Body() dto: MarkDuplicateDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (dto.duplicateOfId === incidentId) {
      throw new BadRequestException('An incident cannot duplicate itself');
    }
    return this.incidentsService.markDuplicate(
      organisationId,
      incidentId,
      user.id,
      dto.duplicateOfId,
    );
  }
}
