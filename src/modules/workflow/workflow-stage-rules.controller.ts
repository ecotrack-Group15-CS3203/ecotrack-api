import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { PLATFORM_ADMIN } from '../../common/enums/app-role.enum';
import { UserRole } from '../../common/enums/user-role.enum';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-request.interface';
import { UpdateWorkflowStageRulesDto } from './dto/update-workflow-stage-rules.dto';
import { WorkflowStageRulesService } from './workflow-stage-rules.service';

@ApiTags('workflow-stage-rules')
@ApiBearerAuth()
@Roles(UserRole.ORG_ADMIN, PLATFORM_ADMIN)
@Controller('organisations/:organisationId/workflow-stage-rules')
export class WorkflowStageRulesController {
  constructor(private readonly rulesService: WorkflowStageRulesService) {}

  @Get()
  get(@Param('organisationId', ParseUUIDPipe) organisationId: string) {
    return this.rulesService.getRules(organisationId);
  }

  @HttpCode(HttpStatus.OK)
  @Patch()
  update(
    @Param('organisationId', ParseUUIDPipe) organisationId: string,
    @Body() dto: UpdateWorkflowStageRulesDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.rulesService.updateRules(organisationId, dto, user.id);
  }
}
