import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { WorkflowStagesController } from './workflow-stages.controller';
import { WorkflowStagesService } from './workflow-stages.service';

@Module({
  imports: [AuditModule],
  controllers: [WorkflowStagesController],
  providers: [WorkflowStagesService],
  exports: [WorkflowStagesService],
})
export class WorkflowModule {}
