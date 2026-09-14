import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { SystemDbService } from '../../../database/system-db.service';
import type { DrizzleDb } from '../../../database/drizzle.provider';
import type { NotificationDispatchKind } from '../../../database/schema/notification-dispatches.schema';
import { EventReminderHandler } from './dispatch-handlers/event-reminder.handler';
import { IncidentProximityHandler } from './dispatch-handlers/incident-proximity.handler';
import { TaskDueReminderHandler } from './dispatch-handlers/task-due-reminder.handler';

interface ClaimedDispatch {
  [key: string]: unknown;
  id: string;
  kind: string;
  entityId: string;
}

const BATCH_SIZE = 100;

/**
 * The single scheduler behind three SRS-mandated deferred/fan-out triggers:
 * incident-proximity alerts (3.1.4, fired ~immediately), task due-date reminders
 * (3.1.8, 24h before dueDate), and event reminders (3.1.9, 24h before
 * scheduledAt). One mechanism instead of three, because all three share the same
 * shape — "notify some set of people about an entity, once, at or after a
 * due_at" — and the same idempotency requirement.
 *
 * No Redis/queue: Appendix C excludes both, and this deployment is a single
 * process on one small box (SRS 3.6.5), so a plain outbox table polled on an
 * interval is the right size. The 15s cadence bounds proximity-alert latency
 * without a queue; task/event reminders have a full day of slack either way.
 *
 * Idempotency is two things together. First, `notification_dispatches` has
 * UNIQUE(kind, entity_id) — one reminder per kind per entity, ever; rescheduling
 * is an upsert guarded so it can never resurrect an already-sent row (see the
 * ON CONFLICT clauses in TasksService/EventsService/IncidentsService). Second,
 * this method marks a batch `dispatched_at` — under `FOR UPDATE SKIP LOCKED`,
 * so two overlapping ticks (a slow one plus a new one starting) never claim the
 * same row — BEFORE running any handler, not after. That gives at-most-once: a
 * crash mid-batch loses at most that batch's pushes, never duplicates them,
 * which is the correct failure mode here (a missed "task due tomorrow" is
 * better than two). The persisted `notifications` row each handler writes is
 * the durable record either way.
 */
@Injectable()
export class NotificationDispatchService {
  private readonly logger = new Logger(NotificationDispatchService.name);

  constructor(
    private readonly systemDb: SystemDbService,
    private readonly incidentProximityHandler: IncidentProximityHandler,
    private readonly taskDueReminderHandler: TaskDueReminderHandler,
    private readonly eventReminderHandler: EventReminderHandler,
  ) {}

  @Cron('*/15 * * * * *')
  async runDueDispatches(): Promise<void> {
    await this.systemDb.runAsSystem(async (db) => {
      const claimed = await this.claimBatch(db);
      for (const dispatch of claimed) {
        // Best-effort per row: one bad entity (deleted, malformed) must not stop
        // the rest of the batch from being processed.
        try {
          await this.route(db, dispatch);
        } catch (err) {
          this.logger.warn(
            `Dispatch ${dispatch.id} (${dispatch.kind}) failed: ${(err as Error).message}`,
          );
        }
      }
    });
  }

  private async claimBatch(db: DrizzleDb): Promise<ClaimedDispatch[]> {
    const result = await db.execute<ClaimedDispatch>(sql`
      UPDATE notification_dispatches
      SET dispatched_at = now(), attempts = attempts + 1, updated_at = now()
      WHERE id IN (
        SELECT id FROM notification_dispatches
        WHERE dispatched_at IS NULL AND due_at <= now()
        ORDER BY due_at
        FOR UPDATE SKIP LOCKED
        LIMIT ${BATCH_SIZE}
      )
      RETURNING id, kind, entity_id AS "entityId"
    `);
    return result.rows;
  }

  private async route(db: DrizzleDb, dispatch: ClaimedDispatch): Promise<void> {
    const kind = dispatch.kind as NotificationDispatchKind;
    switch (kind) {
      case 'incident_proximity':
        return this.incidentProximityHandler.handle(db, dispatch.entityId);
      case 'task_due_reminder':
        return this.taskDueReminderHandler.handle(db, dispatch.entityId);
      case 'event_reminder':
        return this.eventReminderHandler.handle(db, dispatch.entityId);
      default:
        this.logger.warn(`Unknown dispatch kind: ${dispatch.kind}`);
    }
  }
}
