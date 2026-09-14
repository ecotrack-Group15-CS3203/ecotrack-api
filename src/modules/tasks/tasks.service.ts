import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, count, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import {
  Paginated,
  PaginationQueryDto,
} from '../../common/dto/pagination-query.dto';
import { VerificationStatus } from '../../common/enums/incident.enum';
import { NotificationType } from '../../common/enums/notification.enum';
import {
  AssignmentStatus,
  TaskPriority,
  TaskStatus,
} from '../../common/enums/task.enum';
import { UserRole } from '../../common/enums/user-role.enum';
import {
  taskAssignments,
  taskNotes,
  taskPhotos,
  tasks,
  users,
} from '../../database/schema';
import { TenantDbService } from '../../database/tenant-db.service';
import { AuditLogService } from '../audit/audit-log.service';
import { IncidentsService } from '../incidents/incidents.service';
import { MediaService } from '../media/media.service';
import { NotificationDispatchRepository } from '../notifications/dispatch/notification-dispatch.repository';
import { NotificationsService } from '../notifications/notifications.service';
import { OrganisationMembersService } from '../organisations/organisation-members.service';
import { WorkflowStageRulesService } from '../workflow/workflow-stage-rules.service';
import { WorkflowStagesService } from '../workflow/workflow-stages.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';

/**
 * Remaps `status`/`priority` from Drizzle's inferred plain string-literal union to
 * the TS enum — purely a type-level correction (the runtime values are identical
 * strings either way), needed so status/priority comparisons against
 * TaskStatus/AssignmentStatus/TaskPriority enum members type-check without
 * @typescript-eslint/no-unsafe-enum-comparison firing throughout this file.
 */
export type TaskRow = Omit<typeof tasks.$inferSelect, 'status' | 'priority'> & {
  status: TaskStatus;
  priority: TaskPriority;
};
export type TaskAssignmentRow = Omit<
  typeof taskAssignments.$inferSelect,
  'status'
> & {
  status: AssignmentStatus;
};

export interface TaskFull extends TaskRow {
  assignments: (TaskAssignmentRow & {
    volunteer: { id: string; fullName: string; email: string } | null;
  })[];
  notes: (typeof taskNotes.$inferSelect)[];
  photos: (typeof taskPhotos.$inferSelect)[];
}

@Injectable()
export class TasksService {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly incidentsService: IncidentsService,
    private readonly membersService: OrganisationMembersService,
    private readonly notificationsService: NotificationsService,
    private readonly notificationDispatchRepository: NotificationDispatchRepository,
    private readonly auditLogService: AuditLogService,
    private readonly workflowStagesService: WorkflowStagesService,
    private readonly workflowStageRulesService: WorkflowStageRulesService,
    private readonly mediaService: MediaService,
  ) {}

  /**
   * SRS 3.1.8: 24h-before-dueDate reminder — see NotificationDispatchService. A
   * task due less than 24h out has already missed the moment a "due tomorrow"
   * reminder describes; scheduling one anyway would just fire it almost
   * immediately, which isn't the same notification.
   */
  private scheduleDueReminder(taskId: string, dueDate: Date): Promise<void> {
    const dueAt = new Date(dueDate.getTime() - 24 * 60 * 60 * 1000);
    if (dueAt <= new Date()) return Promise.resolve();
    return this.notificationDispatchRepository.schedule(
      this.tenantDb.db,
      'task_due_reminder',
      'task',
      taskId,
      dueAt,
    );
  }

  private cancelDueReminder(taskId: string): Promise<void> {
    return this.notificationDispatchRepository.cancel(
      this.tenantDb.db,
      'task_due_reminder',
      taskId,
    );
  }

  /**
   * The `verificationStatus === APPROVED` check stays: it's coarser than, and not
   * replaced by, the stage-minimum check below. A rejected/duplicate incident keeps
   * organisationId set and can sit at any stage (including a high-position one, e.g.
   * Dismissed) — position alone can't tell "further along" from "further along AND
   * still active", so this guard against terminal verificationStatus values remains
   * necessary regardless of what minimum stage an org configures.
   */
  async create(
    organisationId: string,
    createdByUserId: string,
    dto: CreateTaskDto,
  ): Promise<TaskFull> {
    const incident = await this.incidentsService.findScoped(
      organisationId,
      dto.incidentId,
    );
    if (
      incident.verificationStatus !== VerificationStatus.APPROVED ||
      !incident.currentStageId
    ) {
      throw new BadRequestException(
        'A cleanup task can only be created from a claimed incident',
      );
    }
    const currentStage = await this.workflowStagesService.findById(
      incident.currentStageId,
    );
    await this.workflowStageRulesService.assertMinimumStageReached(
      organisationId,
      'taskCreation',
      currentStage,
    );

    await this.assertActiveVolunteer(organisationId, dto.assignedTo);

    const [saved] = await this.tenantDb.db
      .insert(tasks)
      .values({
        organisationId,
        incidentId: incident.id,
        title: dto.title,
        description: dto.description,
        priority: dto.priority,
        dueDate: new Date(dto.dueDate),
        createdByUserId,
      })
      .returning();

    await this.tenantDb.db.insert(taskAssignments).values({
      organisationId,
      taskId: saved.id,
      volunteerUserId: dto.assignedTo,
    });

    await this.scheduleDueReminder(saved.id, saved.dueDate);

    // Sequential, not Promise.all: both calls ultimately query tenantDb.db, one
    // dedicated pg Client per request (TenantInterceptor), not a Pool —
    // concurrent queries on it hit node-postgres's deprecated-and-scheduled-for-
    // removal concurrent-query path.
    await this.auditLogService.record({
      organisationId,
      actingUserId: createdByUserId,
      action: 'task.created',
      entityType: 'task',
      entityId: saved.id,
      metadata: { assignedTo: dto.assignedTo },
    });
    await this.notificationsService.create({
      userId: dto.assignedTo,
      organisationId,
      type: NotificationType.TASK_ASSIGNED,
      title: 'New cleanup task assigned',
      message: `You have been assigned to: ${dto.title}`,
      relatedEntityType: 'task',
      relatedEntityId: saved.id,
    });

    const targetStage = await this.workflowStageRulesService.resolveTarget(
      organisationId,
      'taskCreation',
      currentStage,
    );
    if (targetStage && targetStage.id !== currentStage.id) {
      await this.incidentsService.advanceStage(
        organisationId,
        incident.id,
        targetStage.id,
        createdByUserId,
        'task.created',
      );
    }

    return this.findById(saved.id);
  }

  async update(
    organisationId: string,
    taskId: string,
    dto: UpdateTaskDto,
    actingUserId: string,
  ): Promise<TaskFull> {
    const task = await this.findScoped(organisationId, taskId);
    const priorityChanged =
      dto.priority !== undefined && task.priority !== dto.priority;
    const scheduleChanged =
      dto.dueDate !== undefined &&
      task.dueDate.toISOString() !== new Date(dto.dueDate).toISOString();

    if (dto.assignedTo !== undefined) {
      await this.assertActiveVolunteer(organisationId, dto.assignedTo);
    }

    const [updated] = await this.tenantDb.db
      .update(tasks)
      .set({
        ...(dto.priority !== undefined && { priority: dto.priority }),
        ...(dto.dueDate !== undefined && { dueDate: new Date(dto.dueDate) }),
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, taskId))
      .returning();

    if (scheduleChanged) {
      await this.scheduleDueReminder(taskId, updated.dueDate);
    }

    if (scheduleChanged || priorityChanged) {
      // Only the currently active assignee(s) — with a single assignee per task
      // (SRS 3.1.8) now the norm, a schedule/priority change would otherwise also
      // notify whoever a prior reassignment cancelled off this task.
      const assignments = await this.tenantDb.db.query.taskAssignments.findMany(
        {
          where: and(
            eq(taskAssignments.taskId, taskId),
            inArray(taskAssignments.status, [
              AssignmentStatus.ASSIGNED,
              AssignmentStatus.ACCEPTED,
            ]),
          ),
        },
      );
      if (scheduleChanged) {
        await Promise.all(
          assignments.map((a) =>
            this.notificationsService.create({
              userId: a.volunteerUserId,
              organisationId,
              type: NotificationType.CLEANUP_SCHEDULED,
              title: 'Cleanup task scheduled',
              message: `"${updated.title}" is now due ${updated.dueDate.toISOString()}.`,
              relatedEntityType: 'task',
              relatedEntityId: taskId,
            }),
          ),
        );
      }
      if (priorityChanged) {
        await Promise.all(
          assignments.map((a) =>
            this.notificationsService.create({
              userId: a.volunteerUserId,
              organisationId,
              type: NotificationType.TASK_STATUS_CHANGED,
              title: 'Cleanup task priority changed',
              message: `"${updated.title}" priority was changed to ${updated.priority}.`,
              relatedEntityType: 'task',
              relatedEntityId: taskId,
            }),
          ),
        );
      }
    }

    if (dto.assignedTo !== undefined) {
      await this.reassign(
        organisationId,
        updated,
        dto.assignedTo,
        actingUserId,
      );
    }

    return this.findById(taskId);
  }

  async findById(id: string): Promise<TaskFull> {
    const task = await this.tenantDb.db.query.tasks.findFirst({
      where: eq(tasks.id, id),
    });
    if (!task) {
      throw new NotFoundException('Task not found');
    }
    // Sequential, not Promise.all: tenantDb.db is one dedicated pg Client per
    // request (TenantInterceptor), not a Pool — concurrent queries on it hit
    // node-postgres's deprecated-and-scheduled-for-removal concurrent-query path.
    const assignmentRows =
      await this.tenantDb.db.query.taskAssignments.findMany({
        where: eq(taskAssignments.taskId, id),
      });
    const notes = await this.tenantDb.db.query.taskNotes.findMany({
      where: eq(taskNotes.taskId, id),
      orderBy: asc(taskNotes.createdAt),
    });
    const photoRows = await this.tenantDb.db.query.taskPhotos.findMany({
      where: eq(taskPhotos.taskId, id),
    });
    // Private bucket: hand out presigned URLs, not the stored object URLs.
    const photos = await Promise.all(
      photoRows.map(async (photo) => ({
        ...photo,
        url: await this.mediaService.signStoredUrl(photo.url),
      })),
    );
    const volunteerIds = assignmentRows.map((a) => a.volunteerUserId);
    const volunteers = volunteerIds.length
      ? await this.tenantDb.db.query.users.findMany({
          where: inArray(users.id, volunteerIds),
          columns: { id: true, fullName: true, email: true },
        })
      : [];
    const volunteerById = new Map(volunteers.map((v) => [v.id, v]));

    return {
      ...task,
      assignments: assignmentRows.map((a) => ({
        ...a,
        volunteer: volunteerById.get(a.volunteerUserId) ?? null,
      })),
      notes,
      photos,
      // Drizzle infers status/priority as plain string-literal unions, not the
      // TaskStatus/AssignmentStatus enums TaskFull declares them as — see the type
      // aliases above. The runtime values are identical strings; this cast is the
      // single point where that gets reconciled for the whole file.
    } as unknown as TaskFull;
  }

  async findScoped(organisationId: string, taskId: string): Promise<TaskFull> {
    const task = await this.findById(taskId);
    if (task.organisationId !== organisationId) {
      throw new NotFoundException('Task not found');
    }
    return task;
  }

  async listForOrg(
    organisationId: string,
    { page, limit }: PaginationQueryDto,
    status?: TaskStatus,
  ): Promise<Paginated<TaskFull>> {
    const where = status
      ? and(eq(tasks.organisationId, organisationId), eq(tasks.status, status))
      : eq(tasks.organisationId, organisationId);

    // Sequential, not Promise.all: tenantDb.db is one dedicated pg Client per
    // request (TenantInterceptor), not a Pool — concurrent queries on it hit
    // node-postgres's deprecated-and-scheduled-for-removal concurrent-query path.
    const rows = await this.tenantDb.db.query.tasks.findMany({
      where,
      orderBy: desc(tasks.createdAt),
      limit,
      offset: (page - 1) * limit,
    });
    const [{ count: total }] = await this.tenantDb.db
      .select({ count: sql<number>`count(*)::int` })
      .from(tasks)
      .where(where);
    const items: TaskFull[] = [];
    for (const row of rows) {
      items.push(await this.findById(row.id));
    }
    return { items, total, page, limit };
  }

  async listAssignedToVolunteer(
    volunteerUserId: string,
    options: {
      view?: 'assigned' | 'in_progress' | 'completed' | 'declined' | 'upcoming';
      page?: number;
      limit?: number;
    } = {},
  ): Promise<{
    items: TaskFull[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = Math.max(1, options.page ?? 1);
    const limit = Math.min(100, Math.max(1, options.limit ?? 20));

    const filterFor = (view: typeof options.view) => {
      switch (view) {
        case 'in_progress':
          return and(
            eq(taskAssignments.status, AssignmentStatus.ACCEPTED),
            eq(tasks.status, TaskStatus.IN_PROGRESS),
          );
        case 'completed':
          return and(
            eq(taskAssignments.status, AssignmentStatus.ACCEPTED),
            eq(tasks.status, TaskStatus.COMPLETED),
          );
        case 'declined':
          return eq(taskAssignments.status, AssignmentStatus.DECLINED);
        case 'upcoming':
          return and(
            inArray(taskAssignments.status, [
              AssignmentStatus.ASSIGNED,
              AssignmentStatus.ACCEPTED,
            ]),
            inArray(tasks.status, [TaskStatus.PENDING, TaskStatus.IN_PROGRESS]),
          );
        case 'assigned':
        default:
          return and(
            inArray(taskAssignments.status, [
              AssignmentStatus.ASSIGNED,
              AssignmentStatus.ACCEPTED,
            ]),
            eq(tasks.status, TaskStatus.PENDING),
          );
      }
    };

    const where = and(
      eq(taskAssignments.volunteerUserId, volunteerUserId),
      filterFor(options.view),
    );

    // dueDate is required (SRS 3.1.6), so 'upcoming' needs no null-handling the way
    // this did back when it was an optional scheduledAt.
    const orderBy =
      options.view === 'upcoming' ? asc(tasks.dueDate) : desc(tasks.createdAt);

    // Sequential, not Promise.all: tenantDb.db is one dedicated pg Client per
    // request (TenantInterceptor), not a Pool — concurrent queries on it hit
    // node-postgres's deprecated-and-scheduled-for-removal concurrent-query path.
    const pageIds = await this.tenantDb.db
      .select({ id: tasks.id })
      .from(taskAssignments)
      .innerJoin(tasks, eq(taskAssignments.taskId, tasks.id))
      .where(where)
      .orderBy(orderBy)
      .limit(limit)
      .offset((page - 1) * limit);
    const [{ count: total }] = await this.tenantDb.db
      .select({ count: sql<number>`count(*)::int` })
      .from(taskAssignments)
      .innerJoin(tasks, eq(taskAssignments.taskId, tasks.id))
      .where(where);

    const items: TaskFull[] = [];
    for (const pageId of pageIds) {
      items.push(await this.findById(pageId.id));
    }
    return { items, total, page, limit };
  }

  private async assertActiveVolunteer(
    organisationId: string,
    volunteerUserId: string,
  ): Promise<void> {
    const member = await this.membersService.findMembership(
      organisationId,
      volunteerUserId,
    );
    if (!member || !member.isActive || member.role !== UserRole.VOLUNTEER) {
      throw new BadRequestException(
        `User ${volunteerUserId} is not an active volunteer of this organisation`,
      );
    }
  }

  /**
   * SRS 3.1.8: a task has exactly one current assignee, so reassignment cancels
   * whatever's active rather than adding a second row, and notifies both
   * volunteers. Updates (not inserts for) a prior assignment row for the incoming
   * volunteer if one already exists — task_assignments has a UNIQUE(task_id,
   * volunteer_user_id) constraint, so re-assigning someone who was previously
   * cancelled/declined on this same task must reuse their existing row.
   */
  private async reassign(
    organisationId: string,
    task: { id: string; title: string },
    newVolunteerUserId: string,
    actingUserId: string,
  ): Promise<void> {
    const current = await this.tenantDb.db.query.taskAssignments.findFirst({
      where: and(
        eq(taskAssignments.taskId, task.id),
        inArray(taskAssignments.status, [
          AssignmentStatus.ASSIGNED,
          AssignmentStatus.ACCEPTED,
        ]),
      ),
    });
    if (current?.volunteerUserId === newVolunteerUserId) return;

    if (current) {
      await this.tenantDb.db
        .update(taskAssignments)
        .set({
          status: AssignmentStatus.CANCELLED,
          respondedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(taskAssignments.id, current.id));
      await this.notificationsService.create({
        userId: current.volunteerUserId,
        organisationId,
        type: NotificationType.TASK_STATUS_CHANGED,
        title: 'Cleanup task reassigned',
        message: `You have been unassigned from: ${task.title}`,
        relatedEntityType: 'task',
        relatedEntityId: task.id,
      });
    }

    const existingForNewVolunteer =
      await this.tenantDb.db.query.taskAssignments.findFirst({
        where: and(
          eq(taskAssignments.taskId, task.id),
          eq(taskAssignments.volunteerUserId, newVolunteerUserId),
        ),
      });
    if (existingForNewVolunteer) {
      await this.tenantDb.db
        .update(taskAssignments)
        .set({
          status: AssignmentStatus.ASSIGNED,
          respondedAt: null,
          declineReason: null,
          updatedAt: new Date(),
        })
        .where(eq(taskAssignments.id, existingForNewVolunteer.id));
    } else {
      await this.tenantDb.db.insert(taskAssignments).values({
        organisationId,
        taskId: task.id,
        volunteerUserId: newVolunteerUserId,
      });
    }

    // Sequential, not Promise.all: both calls ultimately query tenantDb.db, one
    // dedicated pg Client per request (TenantInterceptor), not a Pool —
    // concurrent queries on it hit node-postgres's deprecated-and-scheduled-for-
    // removal concurrent-query path.
    await this.auditLogService.record({
      organisationId,
      actingUserId,
      action: 'task.reassigned',
      entityType: 'task',
      entityId: task.id,
      metadata: {
        from: current?.volunteerUserId ?? null,
        to: newVolunteerUserId,
      },
    });
    await this.notificationsService.create({
      userId: newVolunteerUserId,
      organisationId,
      type: NotificationType.TASK_ASSIGNED,
      title: 'New cleanup task assigned',
      message: `You have been assigned to: ${task.title}`,
      relatedEntityType: 'task',
      relatedEntityId: task.id,
    });
  }

  /**
   * Every volunteer action re-derives the task through findScoped so a mismatched
   * organisationId 404s exactly like the incidents module does, instead of relying
   * solely on the invariant that an assignment row can only exist within one org
   * (assignVolunteers already enforces that, but this is defense-in-depth).
   */
  private async findOwnAssignment(
    organisationId: string,
    taskId: string,
    volunteerUserId: string,
  ): Promise<{ task: TaskFull; assignment: TaskAssignmentRow }> {
    const task = await this.findScoped(organisationId, taskId);
    const assignment = await this.tenantDb.db.query.taskAssignments.findFirst({
      where: and(
        eq(taskAssignments.taskId, taskId),
        eq(taskAssignments.volunteerUserId, volunteerUserId),
      ),
    });
    if (!assignment) {
      throw new ForbiddenException('You are not assigned to this task');
    }
    // Same status-enum reconciliation as findById's cast above.
    return { task, assignment: assignment as unknown as TaskAssignmentRow };
  }

  async respondToAssignment(
    organisationId: string,
    taskId: string,
    volunteerUserId: string,
    accept: boolean,
    reason?: string,
  ): Promise<TaskFull> {
    const { task, assignment } = await this.findOwnAssignment(
      organisationId,
      taskId,
      volunteerUserId,
    );
    if (assignment.status !== AssignmentStatus.ASSIGNED) {
      throw new BadRequestException(
        'You have already responded to this assignment',
      );
    }
    await this.tenantDb.db
      .update(taskAssignments)
      .set({
        status: accept ? AssignmentStatus.ACCEPTED : AssignmentStatus.DECLINED,
        respondedAt: new Date(),
        declineReason: accept ? null : (reason ?? null),
        updatedAt: new Date(),
      })
      .where(eq(taskAssignments.id, assignment.id));

    const volunteerName =
      task.assignments.find((a) => a.volunteerUserId === volunteerUserId)
        ?.volunteer?.fullName ?? 'A volunteer';
    if (task.createdByUserId) {
      await this.notificationsService.create({
        userId: task.createdByUserId,
        organisationId,
        type: NotificationType.TASK_STATUS_CHANGED,
        title: accept
          ? 'Volunteer accepted a task'
          : 'Volunteer declined a task',
        message: accept
          ? `${volunteerName} accepted: ${task.title}`
          : `${volunteerName} declined: ${task.title}.${reason ? ` Reason: ${reason}.` : ''} It may need reassigning.`,
        relatedEntityType: 'task',
        relatedEntityId: task.id,
      });
    }

    return this.findById(taskId);
  }

  private async assertAcceptedAssignee(
    organisationId: string,
    taskId: string,
    volunteerUserId: string,
  ): Promise<TaskFull> {
    const { task, assignment } = await this.findOwnAssignment(
      organisationId,
      taskId,
      volunteerUserId,
    );
    if (assignment.status !== AssignmentStatus.ACCEPTED) {
      throw new ForbiddenException(
        'You must accept this task before updating its progress',
      );
    }
    return task;
  }

  async markInProgress(
    organisationId: string,
    taskId: string,
    volunteerUserId: string,
  ): Promise<TaskFull> {
    const task = await this.assertAcceptedAssignee(
      organisationId,
      taskId,
      volunteerUserId,
    );
    if (task.status !== TaskStatus.PENDING) {
      throw new BadRequestException(
        'This task has already been started or completed',
      );
    }
    await this.tenantDb.db
      .update(tasks)
      .set({
        status: TaskStatus.IN_PROGRESS,
        startedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, taskId));

    if (task.createdByUserId) {
      await this.notificationsService.create({
        userId: task.createdByUserId,
        organisationId: task.organisationId,
        type: NotificationType.TASK_STATUS_CHANGED,
        title: 'Cleanup task in progress',
        message: `"${task.title}" is now in progress.`,
        relatedEntityType: 'task',
        relatedEntityId: task.id,
      });
    }

    return this.findById(taskId);
  }

  async addNote(
    organisationId: string,
    taskId: string,
    volunteerUserId: string,
    note: string,
  ): Promise<TaskFull> {
    await this.assertAcceptedAssignee(organisationId, taskId, volunteerUserId);
    await this.tenantDb.db
      .insert(taskNotes)
      .values({ organisationId, taskId, authorUserId: volunteerUserId, note });
    return this.findById(taskId);
  }

  async addPhotos(
    organisationId: string,
    taskId: string,
    volunteerUserId: string,
    photoUrls: string[],
  ): Promise<TaskFull> {
    await this.assertAcceptedAssignee(organisationId, taskId, volunteerUserId);
    if (photoUrls.length === 0) {
      throw new BadRequestException('At least one photo is required');
    }
    await this.tenantDb.db.insert(taskPhotos).values(
      photoUrls.map((url) => ({
        organisationId,
        taskId,
        url,
        uploadedByUserId: volunteerUserId,
      })),
    );
    return this.findById(taskId);
  }

  async markCompleted(
    organisationId: string,
    taskId: string,
    volunteerUserId: string,
  ): Promise<TaskFull> {
    const task = await this.assertAcceptedAssignee(
      organisationId,
      taskId,
      volunteerUserId,
    );
    if (task.status !== TaskStatus.IN_PROGRESS) {
      throw new BadRequestException(
        'Mark this task in progress before completing it',
      );
    }
    if (task.photos.length === 0) {
      throw new BadRequestException(
        'At least one completion photo is required before marking this task complete',
      );
    }
    await this.tenantDb.db
      .update(tasks)
      .set({
        status: TaskStatus.COMPLETED,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, taskId));

    await this.cancelDueReminder(taskId);

    // Sequential, not Promise.all: both calls ultimately query tenantDb.db, one
    // dedicated pg Client per request (TenantInterceptor), not a Pool —
    // concurrent queries on it hit node-postgres's deprecated-and-scheduled-for-
    // removal concurrent-query path.
    await this.auditLogService.record({
      organisationId: task.organisationId,
      actingUserId: volunteerUserId,
      action: 'task.completed',
      entityType: 'task',
      entityId: task.id,
    });
    if (task.createdByUserId) {
      await this.notificationsService.create({
        userId: task.createdByUserId,
        organisationId: task.organisationId,
        type: NotificationType.TASK_COMPLETED,
        title: 'Cleanup task completed',
        message: `"${task.title}" has been marked complete.`,
        relatedEntityType: 'task',
        relatedEntityId: task.id,
      });
    }

    // SRS 3.1.21: once every sibling task on the parent incident is complete,
    // advance it per the Task Completion rule. This never blocks the task
    // completion above — only the incident's own advance depends on it — and it's
    // a no-op if the incident has since been rejected (organisationId/
    // currentStageId would still be set, so this only guards a truly pathological
    // state, not the rejected case).
    const [{ incomplete }] = await this.tenantDb.db
      .select({ incomplete: count() })
      .from(tasks)
      .where(
        and(
          eq(tasks.incidentId, task.incidentId),
          ne(tasks.status, TaskStatus.COMPLETED),
        ),
      );
    if (incomplete === 0) {
      const incident = await this.incidentsService.findById(task.incidentId);
      if (incident.organisationId && incident.currentStageId) {
        const currentStage = await this.workflowStagesService.findById(
          incident.currentStageId,
        );
        const targetStage = await this.workflowStageRulesService.resolveTarget(
          task.organisationId,
          'taskCompletion',
          currentStage,
        );
        if (targetStage && targetStage.id !== currentStage.id) {
          await this.incidentsService.advanceStage(
            task.organisationId,
            incident.id,
            targetStage.id,
            volunteerUserId,
            'task.completed',
          );
        }
      }
    }

    return this.findById(taskId);
  }
}
