import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { WorkflowStage } from './entities/workflow-stage.entity';
import { WorkflowStagesController } from './workflow-stages.controller';
import { WorkflowStagesService } from './workflow-stages.service';

@Module({
  imports: [TypeOrmModule.forFeature([WorkflowStage]), AuditModule],
  controllers: [WorkflowStagesController],
  providers: [WorkflowStagesService],
  exports: [WorkflowStagesService],
})
export class WorkflowModule {}
