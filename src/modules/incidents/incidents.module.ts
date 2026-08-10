import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { IncidentPoolController } from './incident-pool.controller';
import { IncidentPoolService } from './incident-pool.service';
import { IncidentsController } from './incidents.controller';
import { IncidentsService } from './incidents.service';
import { OrgIncidentsController } from './org-incidents.controller';

@Module({
  imports: [WorkflowModule, NotificationsModule, AuditModule],
  controllers: [
    IncidentsController,
    IncidentPoolController,
    OrgIncidentsController,
  ],
  providers: [IncidentsService, IncidentPoolService],
  exports: [IncidentsService, IncidentPoolService],
})
export class IncidentsModule {}
