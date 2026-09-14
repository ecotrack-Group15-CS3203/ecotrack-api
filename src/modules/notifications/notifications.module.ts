import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { EventReminderHandler } from './dispatch/dispatch-handlers/event-reminder.handler';
import { IncidentProximityHandler } from './dispatch/dispatch-handlers/incident-proximity.handler';
import { TaskDueReminderHandler } from './dispatch/dispatch-handlers/task-due-reminder.handler';
import { NotificationDispatchRepository } from './dispatch/notification-dispatch.repository';
import { NotificationDispatchService } from './dispatch/notification-dispatch.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { PushNotificationsService } from './push-notifications.service';

@Module({
  imports: [UsersModule],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    PushNotificationsService,
    NotificationDispatchService,
    NotificationDispatchRepository,
    IncidentProximityHandler,
    TaskDueReminderHandler,
    EventReminderHandler,
  ],
  exports: [NotificationsService, NotificationDispatchRepository],
})
export class NotificationsModule {}
