import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { PLATFORM_ADMIN } from '../../common/enums/app-role.enum';
import { MembershipRole } from '../../common/enums/membership-role.enum';
import { AuditLogService } from './audit-log.service';

@ApiTags('audit-logs')
@ApiBearerAuth()
@Roles(MembershipRole.ORG_ADMIN, PLATFORM_ADMIN)
@Controller('organisations/:organisationId/audit-logs')
export class AuditLogController {
  constructor(private readonly auditLogService: AuditLogService) {}

  @Get()
  findForOrg(@Param('organisationId', ParseUUIDPipe) organisationId: string) {
    return this.auditLogService.listForOrg(organisationId);
  }
}
