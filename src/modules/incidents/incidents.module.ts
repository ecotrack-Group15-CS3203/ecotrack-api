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
  // Order matters. Nest registers routes in this order, and Express matches
  // first-wins: IncidentsController owns `GET /incidents/:incidentId`, which would
  // otherwise swallow `GET /incidents/pool` and fail it as "uuid is expected". The
  // literal path must be registered before the parameterised one.
  controllers: [
    IncidentPoolController,
    IncidentsController,
    OrgIncidentsController,
  ],
  providers: [IncidentsService, IncidentPoolService],
  exports: [IncidentsService, IncidentPoolService],
})
export class IncidentsModule {}
