import { Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import type { DrizzleDb } from '../../../../database/drizzle.provider';
import { taskAssignments, tasks } from '../../../../database/schema';
import { AssignmentStatus } from '../../../../common/enums/task.enum';
import { NotificationType } from '../../../../common/enums/notification.enum';
import { NotificationsService } from '../../notifications.service';

const ACTIVE_ASSIGNMENT_STATUSES = [
  AssignmentStatus.ASSIGNED,
  AssignmentStatus.ACCEPTED,
];

@Injectable()
export class TaskDueReminderHandler {
  constructor(private readonly notificationsService: NotificationsService) {}

  /**
   * SRS 3.1.8: 24h-before-dueDate reminder. Re-reads the task at fire time rather
   * than trusting whatever was true when the dispatch row was inserted — a task
   * completed early, or reassigned, needs the reminder to reflect that, which is
   * exactly why TasksService tombstones/reschedules this row on those events
   * instead of leaving the fire-time check to do all the work alone. This handler
   * being defensive too means a missed tombstone fails safe (silently skips)
   * rather than reminding the wrong person.
   */
  async handle(db: DrizzleDb, taskId: string): Promise<void> {
    const task = await db.query.tasks.findFirst({
      where: eq(tasks.id, taskId),
    });
    if (!task || task.status === 'completed') return;

    const assignment = await db.query.taskAssignments.findFirst({
      where: and(
        eq(taskAssignments.taskId, taskId),
        inArray(taskAssignments.status, ACTIVE_ASSIGNMENT_STATUSES),
      ),
    });
    if (!assignment) return;

    await this.notificationsService.create(
      {
        userId: assignment.volunteerUserId,
        organisationId: task.organisationId,
        type: NotificationType.TASK_DUE_REMINDER,
        title: 'Task due tomorrow',
        message: `"${task.title}" is due tomorrow.`,
        relatedEntityType: 'task',
        relatedEntityId: taskId,
      },
      db,
    );
  }
}
