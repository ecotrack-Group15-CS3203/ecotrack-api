import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { IncidentsModule } from '../incidents/incidents.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrganisationsModule } from '../organisations/organisations.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  imports: [
    IncidentsModule,
    OrganisationsModule,
    NotificationsModule,
    AuditModule,
    WorkflowModule,
  ],
  controllers: [TasksController],
  providers: [TasksService],
  exports: [TasksService],
})
export class TasksModule {}
