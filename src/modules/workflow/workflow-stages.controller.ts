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
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { PLATFORM_ADMIN } from '../../common/enums/app-role.enum';
import { MembershipRole } from '../../common/enums/membership-role.enum';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-request.interface';
import { CreateWorkflowStageDto } from './dto/create-workflow-stage.dto';
import { MarkFinalDto } from './dto/mark-final.dto';
import { ReorderWorkflowStagesDto } from './dto/reorder-workflow-stages.dto';
import { WorkflowStagesService } from './workflow-stages.service';

@Roles(MembershipRole.ORG_ADMIN, PLATFORM_ADMIN)
@Controller('organisations/:organisationId/workflow-stages')
export class WorkflowStagesController {
  constructor(private readonly stagesService: WorkflowStagesService) {}

  @Get()
  list(@Param('organisationId', ParseUUIDPipe) organisationId: string) {
    return this.stagesService.listStages(organisationId);
  }

  @Post()
  create(
    @Param('organisationId', ParseUUIDPipe) organisationId: string,
    @Body() dto: CreateWorkflowStageDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.stagesService.createStage({
      organisationId,
      name: dto.name,
      actingUserId: user.id,
    });
  }

  @HttpCode(HttpStatus.OK)
  @Patch('reorder')
  reorder(
    @Param('organisationId', ParseUUIDPipe) organisationId: string,
    @Body() dto: ReorderWorkflowStagesDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.stagesService.reorderStages(
      organisationId,
      dto.orderedStageIds,
      user.id,
    );
  }

  @HttpCode(HttpStatus.OK)
  @Patch(':stageId/final')
  async markFinal(
    @Param('organisationId', ParseUUIDPipe) organisationId: string,
    @Param('stageId', ParseUUIDPipe) stageId: string,
    @Body() dto: MarkFinalDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.stagesService.findScoped(organisationId, stageId);
    return this.stagesService.markFinal(stageId, dto.isFinal, user.id);
  }

  @Delete(':stageId')
  async remove(
    @Param('organisationId', ParseUUIDPipe) organisationId: string,
    @Param('stageId', ParseUUIDPipe) stageId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.stagesService.findScoped(organisationId, stageId);
    await this.stagesService.deleteStage(stageId, user.id);
    return { success: true };
  }
}
