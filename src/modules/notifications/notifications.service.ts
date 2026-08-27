import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { NotificationType } from '../../common/enums/notification.enum';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  notifications,
} from '../../database/schema';
import { TenantDbService } from '../../database/tenant-db.service';
import { UsersService } from '../users/users.service';
import { PushNotificationsService } from './push-notifications.service';

export type NotificationRow = typeof notifications.$inferSelect;

/**
 * Maps each notification type to the User.notificationPreferences key that gates its
 * push channel. Types with no entry always push — no profile toggle exists for them.
 */
const PUSH_PREFERENCE_KEY: Partial<
  Record<NotificationType, keyof typeof DEFAULT_NOTIFICATION_PREFERENCES>
> = {
  [NotificationType.TASK_ASSIGNED]: 'taskAssigned',
  [NotificationType.CLEANUP_SCHEDULED]: 'cleanupScheduled',
  [NotificationType.TASK_STATUS_CHANGED]: 'scheduleChanged',
};

@Injectable()
export class NotificationsService {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly usersService: UsersService,
    private readonly pushNotificationsService: PushNotificationsService,
  ) {}

  /**
   * No `.returning()`, deliberately: a notification is almost always created *for*
   * somebody else, and the read policy is strictly `user_id = app.current_user_id`, so
   * the writer cannot see the row it just wrote. Asking for it back would fail the
   * whole request under RLS. Nothing consumes the row, so nothing asks.
   */
  async create(data: {
    userId: string;
    organisationId?: string | null;
    type: NotificationType;
    title: string;
    message: string;
    relatedEntityType?: string;
    relatedEntityId?: string;
  }): Promise<void> {
    await this.tenantDb.db.insert(notifications).values({
      userId: data.userId,
      organisationId: data.organisationId ?? null,
      type: data.type,
      title: data.title,
      message: data.message,
      relatedEntityType: data.relatedEntityType ?? null,
      relatedEntityId: data.relatedEntityId ?? null,
    });

    // Fire-and-forget: push delivery must never block or fail the caller.
    void this.pushIfEligible(
      data.userId,
      data.type,
      data.title,
      data.message,
    ).catch(() => undefined);
  }

  private async pushIfEligible(
    userId: string,
    type: NotificationType,
    title: string,
    body: string,
  ): Promise<void> {
    const user = await this.usersService.findById(userId);
    if (!user?.pushToken) return;

    const preferenceKey = PUSH_PREFERENCE_KEY[type];
    const prefs =
      user.notificationPreferences as typeof DEFAULT_NOTIFICATION_PREFERENCES;
    const enabled = preferenceKey ? prefs[preferenceKey] : true;
    if (!enabled) return;

    await this.pushNotificationsService.send(user.pushToken, title, body);
  }

  listForUser(userId: string): Promise<NotificationRow[]> {
    return this.tenantDb.db.query.notifications.findMany({
      where: eq(notifications.userId, userId),
      orderBy: desc(notifications.createdAt),
    });
  }

  async markRead(userId: string, id: string): Promise<NotificationRow> {
    const notification = await this.tenantDb.db.query.notifications.findFirst({
      where: eq(notifications.id, id),
    });
    if (!notification) {
      throw new NotFoundException('Notification not found');
    }
    if (notification.userId !== userId) {
      throw new ForbiddenException();
    }
    const [updated] = await this.tenantDb.db
      .update(notifications)
      .set({ isRead: true, updatedAt: new Date() })
      .where(eq(notifications.id, id))
      .returning();
    return updated;
  }

  async markAllRead(userId: string): Promise<{ updated: number }> {
    const updated = await this.tenantDb.db
      .update(notifications)
      .set({ isRead: true, updatedAt: new Date() })
      .where(
        and(eq(notifications.userId, userId), eq(notifications.isRead, false)),
      )
      .returning();
    return { updated: updated.length };
  }
}
