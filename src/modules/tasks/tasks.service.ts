import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
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
import { NotificationsService } from '../notifications/notifications.service';
import { OrganisationMembersService } from '../organisations/organisation-members.service';
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
    private readonly auditLogService: AuditLogService,
  ) {}

  async create(
    organisationId: string,
    createdByUserId: string,
    dto: CreateTaskDto,
  ): Promise<TaskFull> {
    const incident = await this.incidentsService.findScoped(
      organisationId,
      dto.incidentId,
    );
    if (incident.verificationStatus !== VerificationStatus.APPROVED) {
      throw new BadRequestException(
        'A cleanup task can only be created from a claimed incident',
      );
    }

    const [saved] = await this.tenantDb.db
      .insert(tasks)
      .values({
        organisationId,
        incidentId: incident.id,
        description: dto.description,
        priority: dto.priority,
        scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
        createdByUserId,
      })
      .returning();

    await this.auditLogService.record({
      organisationId,
      actingUserId: createdByUserId,
      action: 'task.created',
      entityType: 'task',
      entityId: saved.id,
    });

    return this.findById(saved.id);
  }

  async update(
    organisationId: string,
    taskId: string,
    dto: UpdateTaskDto,
  ): Promise<TaskFull> {
    const task = await this.findScoped(organisationId, taskId);
    const priorityChanged =
      dto.priority !== undefined && task.priority !== dto.priority;
    const scheduleChanged =
      dto.scheduledAt !== undefined &&
      task.scheduledAt?.toISOString() !==
        new Date(dto.scheduledAt).toISOString();

    const [updated] = await this.tenantDb.db
      .update(tasks)
      .set({
        ...(dto.priority !== undefined && { priority: dto.priority }),
        ...(dto.scheduledAt !== undefined && {
          scheduledAt: new Date(dto.scheduledAt),
        }),
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, taskId))
      .returning();

    if (scheduleChanged || priorityChanged) {
      const assignments = await this.tenantDb.db.query.taskAssignments.findMany(
        {
          where: eq(taskAssignments.taskId, taskId),
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
              message: `"${updated.description}" has been scheduled for ${updated.scheduledAt?.toISOString()}.`,
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
              message: `"${updated.description}" priority was changed to ${updated.priority}.`,
              relatedEntityType: 'task',
              relatedEntityId: taskId,
            }),
          ),
        );
      }
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
    const [assignmentRows, notes, photos] = await Promise.all([
      this.tenantDb.db.query.taskAssignments.findMany({
        where: eq(taskAssignments.taskId, id),
      }),
      this.tenantDb.db.query.taskNotes.findMany({
        where: eq(taskNotes.taskId, id),
        orderBy: asc(taskNotes.createdAt),
      }),
      this.tenantDb.db.query.taskPhotos.findMany({
        where: eq(taskPhotos.taskId, id),
      }),
    ]);
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
    status?: TaskStatus,
  ): Promise<TaskFull[]> {
    const rows = await this.tenantDb.db.query.tasks.findMany({
      where: status
        ? and(
            eq(tasks.organisationId, organisationId),
            eq(tasks.status, status),
          )
        : eq(tasks.organisationId, organisationId),
      orderBy: desc(tasks.createdAt),
    });
    return Promise.all(rows.map((t) => this.findById(t.id)));
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

    const matchingTaskIds = await this.tenantDb.db
      .select({
        id: tasks.id,
        scheduledAt: tasks.scheduledAt,
        createdAt: tasks.createdAt,
      })
      .from(taskAssignments)
      .innerJoin(tasks, eq(taskAssignments.taskId, tasks.id))
      .where(where);

    const total = matchingTaskIds.length;
    const sorted =
      options.view === 'upcoming'
        ? [...matchingTaskIds].sort((a, b) => {
            if (a.scheduledAt && b.scheduledAt)
              return a.scheduledAt.getTime() - b.scheduledAt.getTime();
            if (a.scheduledAt) return -1;
            if (b.scheduledAt) return 1;
            return b.createdAt.getTime() - a.createdAt.getTime();
          })
        : [...matchingTaskIds].sort(
            (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
          );

    const pageIds = sorted
      .slice((page - 1) * limit, (page - 1) * limit + limit)
      .map((t) => t.id);
    const items = await Promise.all(pageIds.map((id) => this.findById(id)));
    return { items, total, page, limit };
  }

  async assignVolunteers(
    organisationId: string,
    taskId: string,
    volunteerUserIds: string[],
  ): Promise<TaskFull> {
    const task = await this.findScoped(organisationId, taskId);

    for (const volunteerUserId of volunteerUserIds) {
      const member = await this.membersService.findMembership(
        organisationId,
        volunteerUserId,
      );
      if (!member || !member.isActive || member.role !== UserRole.VOLUNTEER) {
        throw new BadRequestException(
          `User ${volunteerUserId} is not an active volunteer of this organisation`,
        );
      }

      const existing = await this.tenantDb.db.query.taskAssignments.findFirst({
        where: and(
          eq(taskAssignments.taskId, task.id),
          eq(taskAssignments.volunteerUserId, volunteerUserId),
        ),
      });
      if (!existing) {
        await this.tenantDb.db
          .insert(taskAssignments)
          .values({ organisationId, taskId: task.id, volunteerUserId });
        await Promise.all([
          this.auditLogService.record({
            organisationId,
            actingUserId: volunteerUserId,
            action: 'task.volunteer_assigned',
            entityType: 'task',
            entityId: task.id,
            metadata: { volunteerUserId },
          }),
          this.notificationsService.create({
            userId: volunteerUserId,
            organisationId,
            type: NotificationType.TASK_ASSIGNED,
            title: 'New cleanup task assigned',
            message: `You have been assigned to: ${task.description}`,
            relatedEntityType: 'task',
            relatedEntityId: task.id,
          }),
        ]);
      }
    }

    return this.findById(task.id);
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
          ? `${volunteerName} accepted: ${task.description}`
          : `${volunteerName} declined: ${task.description}.${reason ? ` Reason: ${reason}.` : ''} It may need reassigning.`,
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
        message: `"${task.description}" is now in progress.`,
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

    await Promise.all([
      this.auditLogService.record({
        organisationId: task.organisationId,
        actingUserId: volunteerUserId,
        action: 'task.completed',
        entityType: 'task',
        entityId: task.id,
      }),
      task.createdByUserId
        ? this.notificationsService.create({
            userId: task.createdByUserId,
            organisationId: task.organisationId,
            type: NotificationType.TASK_COMPLETED,
            title: 'Cleanup task completed',
            message: `"${task.description}" has been marked complete.`,
            relatedEntityType: 'task',
            relatedEntityId: task.id,
          })
        : Promise.resolve(),
    ]);

    return this.findById(taskId);
  }
}
