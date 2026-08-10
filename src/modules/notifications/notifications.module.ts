import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { PushNotificationsService } from './push-notifications.service';

@Module({
  imports: [UsersModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, PushNotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
