import { Controller, Get } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { PLATFORM_ADMIN } from '../../common/enums/app-role.enum';
import { AuditLogService } from '../audit/audit-log.service';
import { UsersService } from '../users/users.service';
import { OrganisationsService } from './organisations.service';

@Controller('platform')
@Roles(PLATFORM_ADMIN)
export class PlatformController {
  constructor(
    private readonly organisationsService: OrganisationsService,
    private readonly usersService: UsersService,
    private readonly auditLogService: AuditLogService,
  ) {}

  @Get('stats')
  async getStats() {
    const [organisationStats, totalUsers] = await Promise.all([
      this.organisationsService.getPlatformStats(),
      this.usersService.countAll(),
    ]);
    return { ...organisationStats, totalUsers };
  }

  @Get('audit-logs')
  getAuditLogs() {
    return this.auditLogService.listPlatformWide();
  }
}
