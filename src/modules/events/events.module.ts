import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { IncidentsModule } from '../incidents/incidents.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';

@Module({
  imports: [IncidentsModule, WorkflowModule, NotificationsModule, AuditModule],
  controllers: [EventsController],
  providers: [EventsService],
  exports: [EventsService],
})
export class EventsModule {}
