import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { DrizzleDb } from '../../../../database/drizzle.provider';
import { events, eventRsvps } from '../../../../database/schema';
import { NotificationType } from '../../../../common/enums/notification.enum';
import { NotificationsService } from '../../notifications.service';

@Injectable()
export class EventReminderHandler {
  constructor(private readonly notificationsService: NotificationsService) {}

  /**
   * SRS 3.1.9: 24h-before-scheduledAt reminder to everyone RSVPed. Recipients are
   * resolved here, at fire time, rather than captured when the dispatch row was
   * inserted — a late RSVP still gets reminded, a cancelled one doesn't, with no
   * separate bookkeeping needed for either case.
   */
  async handle(db: DrizzleDb, eventId: string): Promise<void> {
    const event = await db.query.events.findFirst({
      where: eq(events.id, eventId),
    });
    if (
      !event ||
      event.status === 'cancelled' ||
      event.status === 'completed'
    ) {
      return;
    }

    const rsvps = await db.query.eventRsvps.findMany({
      where: eq(eventRsvps.eventId, eventId),
    });
    if (rsvps.length === 0) return;

    const title = 'Event tomorrow';
    const message = `"${event.title}" is happening tomorrow.`;
    await Promise.all(
      rsvps.map((rsvp) =>
        this.notificationsService.create(
          {
            userId: rsvp.userId,
            organisationId: event.organisationId,
            type: NotificationType.EVENT_REMINDER,
            title,
            message,
            relatedEntityType: 'event',
            relatedEntityId: eventId,
          },
          db,
        ),
      ),
    );
  }
}
