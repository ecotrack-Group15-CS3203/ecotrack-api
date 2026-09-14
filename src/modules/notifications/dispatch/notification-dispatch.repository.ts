import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { DrizzleDb } from '../../../database/drizzle.provider';
import type { NotificationDispatchKind } from '../../../database/schema/notification-dispatches.schema';

/**
 * The insert/reschedule/tombstone half of the outbox pattern
 * NotificationDispatchService's cron consumes — shared by TasksService and
 * EventsService rather than duplicated, since both need the identical guarded
 * upsert and the identical tombstone.
 */
@Injectable()
export class NotificationDispatchRepository {
  /**
   * Inserts a pending reminder, or reschedules an existing one's `due_at` (a task's
   * due date edited, say). The `WHERE dispatched_at IS NULL` guard on the update
   * branch is what makes this safe to call on every edit: an already-sent
   * reminder's row is left alone rather than resurrected.
   */
  async schedule(
    db: DrizzleDb,
    kind: NotificationDispatchKind,
    entityType: string,
    entityId: string,
    dueAt: Date,
  ): Promise<void> {
    await db.execute(sql`
      INSERT INTO notification_dispatches (kind, entity_type, entity_id, due_at)
      VALUES (${kind}, ${entityType}, ${entityId}, ${dueAt})
      ON CONFLICT (kind, entity_id) DO UPDATE
        SET due_at = EXCLUDED.due_at, updated_at = now()
        WHERE notification_dispatches.dispatched_at IS NULL
    `);
  }

  /**
   * Marks a pending reminder as already-dispatched without actually sending
   * anything — the terminal-state case (a task completed, an event cancelled)
   * where the reminder is no longer wanted. A no-op if the row was already
   * claimed (or never existed).
   */
  async cancel(
    db: DrizzleDb,
    kind: NotificationDispatchKind,
    entityId: string,
  ): Promise<void> {
    await db.execute(sql`
      UPDATE notification_dispatches
      SET dispatched_at = now(), updated_at = now()
      WHERE kind = ${kind} AND entity_id = ${entityId} AND dispatched_at IS NULL
    `);
  }
}
