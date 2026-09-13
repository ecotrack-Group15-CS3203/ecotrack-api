import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Body,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-request.interface';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { CreateIncidentDto } from './dto/create-incident.dto';
import { NearbyIncidentsQuery } from './dto/nearby-incidents.query';
import { IncidentsService } from './incidents.service';

/**
 * No `:organisationId` in these routes — incidents enter the Global Incident Pool
 * unowned (SRS 3.1.2/3.1.21). Org-scoped actions on already-claimed incidents
 * (list, reject, mark-duplicate) live in org-incidents.controller.ts instead; pool
 * browsing/claiming lives in incident-pool.controller.ts.
 */
@ApiTags('incidents')
@ApiBearerAuth()
@Controller('incidents')
export class IncidentsController {
  constructor(private readonly incidentsService: IncidentsService) {}

  /**
   * JSON, not multipart: photos are uploaded straight to S3 beforehand via
   * POST /v1/media/upload-url, and only their URLs arrive here (SRS 3.1.15).
   */
  @Roles(UserRole.CITIZEN, UserRole.VOLUNTEER, UserRole.ORG_ADMIN)
  @Post()
  create(
    @Body() dto: CreateIncidentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.incidentsService.create(user.id, dto);
  }

  @Get('mine')
  findMine(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PaginationQueryDto,
  ) {
    return this.incidentsService.findMyReports(user.id, query);
  }

  /**
   * SRS 3.1.3's citizen hazard map. No @Roles — every authenticated role may see
   * nearby hazards, which is the point. Must stay declared above the `:incidentId`
   * route below: Nest matches in declaration order, so registering it after would
   * let ParseUUIDPipe claim 'nearby' and 400 on it.
   */
  @Get('nearby')
  findNearby(@Query() query: NearbyIncidentsQuery) {
    return this.incidentsService.findNearby(query.lat, query.lng, query.radius);
  }

  /**
   * Visibility is entirely RLS-enforced (see incidents.service.ts's findById doc
   * comment) — no role restriction needed here, every authenticated role can hit this
   * route, the database decides what's actually visible to them.
   */
  @Get(':incidentId')
  findOne(@Param('incidentId', ParseUUIDPipe) incidentId: string) {
    return this.incidentsService.findByIdWithImages(incidentId);
  }
}
