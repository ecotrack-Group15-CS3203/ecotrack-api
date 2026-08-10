import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { PLATFORM_ADMIN } from '../../common/enums/app-role.enum';
import { UserRole } from '../../common/enums/user-role.enum';
import { DashboardService } from './dashboard.service';

@ApiTags('dashboard')
@ApiBearerAuth()
@Roles(UserRole.ORG_ADMIN, PLATFORM_ADMIN)
@Controller('organisations/:organisationId/dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('stats')
  getStats(@Param('organisationId', ParseUUIDPipe) organisationId: string) {
    return this.dashboardService.getOrgStats(organisationId);
  }

  @Get('map')
  getMap(@Param('organisationId', ParseUUIDPipe) organisationId: string) {
    return this.dashboardService.getIncidentMap(organisationId);
  }
}
