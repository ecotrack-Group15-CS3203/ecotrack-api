import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-request.interface';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  findMine(@CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.listForUser(user.id);
  }

  @HttpCode(HttpStatus.OK)
  @Patch(':notificationId/read')
  markRead(
    @Param('notificationId', ParseUUIDPipe) notificationId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.notificationsService.markRead(user.id, notificationId);
  }
}
