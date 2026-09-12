import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { WorkflowStageRulesController } from './workflow-stage-rules.controller';
import { WorkflowStageRulesService } from './workflow-stage-rules.service';
import { WorkflowStagesController } from './workflow-stages.controller';
import { WorkflowStagesService } from './workflow-stages.service';

@Module({
  imports: [AuditModule],
  controllers: [WorkflowStagesController, WorkflowStageRulesController],
  providers: [WorkflowStagesService, WorkflowStageRulesService],
  exports: [WorkflowStagesService, WorkflowStageRulesService],
})
export class WorkflowModule {}
