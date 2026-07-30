import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AssignmentStatus, TaskStatus } from '../../common/enums/task.enum';
import { VerificationStatus } from '../../common/enums/incident.enum';
import { MembershipRole } from '../../common/enums/membership-role.enum';
import { NotificationType } from '../../common/enums/notification.enum';
import { AuditLogService } from '../audit/audit-log.service';
import { IncidentsService } from '../incidents/incidents.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OrganisationMembersService } from '../organisations/organisation-members.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { TaskAssignment } from './entities/task-assignment.entity';
import { TaskNote } from './entities/task-note.entity';
import { TaskPhoto } from './entities/task-photo.entity';
import { Task } from './entities/task.entity';

@Injectable()
export class TasksService {
  constructor(
    @InjectRepository(Task)
    private readonly tasksRepository: Repository<Task>,
    @InjectRepository(TaskAssignment)
    private readonly assignmentsRepository: Repository<TaskAssignment>,
    @InjectRepository(TaskNote)
    private readonly notesRepository: Repository<TaskNote>,
    @InjectRepository(TaskPhoto)
    private readonly photosRepository: Repository<TaskPhoto>,
    private readonly incidentsService: IncidentsService,
    private readonly membersService: OrganisationMembersService,
    private readonly notificationsService: NotificationsService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async create(
    organisationId: string,
    createdByUserId: string,
    dto: CreateTaskDto,
  ): Promise<Task> {
    const incident = await this.incidentsService.findScoped(
      organisationId,
      dto.incidentId,
    );
    if (incident.verificationStatus !== VerificationStatus.APPROVED) {
      throw new BadRequestException(
        'A cleanup task can only be created from a verified (approved) incident',
      );
    }

    const task = this.tasksRepository.create({
      organisationId,
      incidentId: incident.id,
      description: dto.description,
      priority: dto.priority,
      scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
      createdByUserId,
    });
    const saved = await this.tasksRepository.save(task);

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
  ): Promise<Task> {
    const task = await this.findScoped(organisationId, taskId);
    if (dto.priority !== undefined) task.priority = dto.priority;
    const scheduleChanged =
      dto.scheduledAt !== undefined &&
      task.scheduledAt?.toISOString() !==
        new Date(dto.scheduledAt).toISOString();
    if (dto.scheduledAt !== undefined)
      task.scheduledAt = new Date(dto.scheduledAt);
    await this.tasksRepository.save(task);

    if (scheduleChanged) {
      await Promise.all(
        task.assignments.map((assignment) =>
          this.notificationsService.create({
            userId: assignment.volunteerUserId,
            organisationId,
            type: NotificationType.CLEANUP_SCHEDULED,
            title: 'Cleanup task scheduled',
            message: `"${task.description}" has been scheduled for ${task.scheduledAt?.toISOString()}.`,
            relatedEntityType: 'task',
            relatedEntityId: task.id,
          }),
        ),
      );
    }

    return this.findById(task.id);
  }

  async findById(id: string): Promise<Task> {
    const task = await this.tasksRepository.findOne({
      where: { id },
      relations: {
        assignments: { volunteer: true },
        notes: true,
        photos: true,
        incident: true,
      },
      order: { notes: { createdAt: 'ASC' } },
    });
    if (!task) {
      throw new NotFoundException('Task not found');
    }
    return task;
  }

  async findScoped(organisationId: string, taskId: string): Promise<Task> {
    const task = await this.findById(taskId);
    if (task.organisationId !== organisationId) {
      throw new NotFoundException('Task not found');
    }
    return task;
  }

  listForOrg(organisationId: string, status?: TaskStatus): Promise<Task[]> {
    return this.tasksRepository.find({
      where: status ? { organisationId, status } : { organisationId },
      relations: { assignments: { volunteer: true }, incident: true },
      order: { createdAt: 'DESC' },
    });
  }

  async listAssignedToVolunteer(volunteerUserId: string): Promise<Task[]> {
    const assignments = await this.assignmentsRepository.find({
      where: { volunteerUserId },
      select: { taskId: true },
    });
    const taskIds = assignments.map((a) => a.taskId);
    if (taskIds.length === 0) return [];
    return this.tasksRepository.find({
      where: { id: In(taskIds) },
      relations: { assignments: { volunteer: true }, incident: true },
      order: { createdAt: 'DESC' },
    });
  }

  async assignVolunteers(
    organisationId: string,
    taskId: string,
    volunteerUserIds: string[],
  ): Promise<Task> {
    const task = await this.findScoped(organisationId, taskId);

    for (const volunteerUserId of volunteerUserIds) {
      const membership = await this.membersService.findMembership(
        organisationId,
        volunteerUserId,
      );
      if (
        !membership ||
        !membership.isActive ||
        membership.role !== MembershipRole.VOLUNTEER
      ) {
        throw new BadRequestException(
          `User ${volunteerUserId} is not an active volunteer of this organisation`,
        );
      }

      const existing = await this.assignmentsRepository.findOne({
        where: { taskId: task.id, volunteerUserId },
      });
      if (!existing) {
        await this.assignmentsRepository.save(
          this.assignmentsRepository.create({
            taskId: task.id,
            volunteerUserId,
          }),
        );
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

  private async findOwnAssignment(
    taskId: string,
    volunteerUserId: string,
  ): Promise<TaskAssignment> {
    const assignment = await this.assignmentsRepository.findOne({
      where: { taskId, volunteerUserId },
    });
    if (!assignment) {
      throw new ForbiddenException('You are not assigned to this task');
    }
    return assignment;
  }

  async respondToAssignment(
    taskId: string,
    volunteerUserId: string,
    accept: boolean,
  ): Promise<Task> {
    const assignment = await this.findOwnAssignment(taskId, volunteerUserId);
    assignment.status = accept
      ? AssignmentStatus.ACCEPTED
      : AssignmentStatus.DECLINED;
    assignment.respondedAt = new Date();
    await this.assignmentsRepository.save(assignment);
    return this.findById(taskId);
  }

  private async assertAcceptedAssignee(
    taskId: string,
    volunteerUserId: string,
  ): Promise<void> {
    const assignment = await this.findOwnAssignment(taskId, volunteerUserId);
    if (assignment.status !== AssignmentStatus.ACCEPTED) {
      throw new ForbiddenException(
        'You must accept this task before updating its progress',
      );
    }
  }

  async markInProgress(taskId: string, volunteerUserId: string): Promise<Task> {
    await this.assertAcceptedAssignee(taskId, volunteerUserId);
    const task = await this.findById(taskId);
    task.status = TaskStatus.IN_PROGRESS;
    await this.tasksRepository.save(task);

    await this.notificationsService.create({
      userId: task.createdByUserId,
      organisationId: task.organisationId,
      type: NotificationType.TASK_STATUS_CHANGED,
      title: 'Cleanup task in progress',
      message: `"${task.description}" is now in progress.`,
      relatedEntityType: 'task',
      relatedEntityId: task.id,
    });

    return this.findById(taskId);
  }

  async addNote(
    taskId: string,
    volunteerUserId: string,
    note: string,
  ): Promise<Task> {
    await this.assertAcceptedAssignee(taskId, volunteerUserId);
    await this.notesRepository.save(
      this.notesRepository.create({
        taskId,
        authorUserId: volunteerUserId,
        note,
      }),
    );
    return this.findById(taskId);
  }

  async addPhotos(
    taskId: string,
    volunteerUserId: string,
    photoUrls: string[],
  ): Promise<Task> {
    await this.assertAcceptedAssignee(taskId, volunteerUserId);
    if (photoUrls.length === 0) {
      throw new BadRequestException('At least one photo is required');
    }
    await this.photosRepository.save(
      photoUrls.map((url) =>
        this.photosRepository.create({
          taskId,
          url,
          uploadedByUserId: volunteerUserId,
        }),
      ),
    );
    return this.findById(taskId);
  }

  async markCompleted(taskId: string, volunteerUserId: string): Promise<Task> {
    await this.assertAcceptedAssignee(taskId, volunteerUserId);
    const task = await this.findById(taskId);
    task.status = TaskStatus.COMPLETED;
    await this.tasksRepository.save(task);

    await Promise.all([
      this.auditLogService.record({
        organisationId: task.organisationId,
        actingUserId: volunteerUserId,
        action: 'task.completed',
        entityType: 'task',
        entityId: task.id,
      }),
      this.notificationsService.create({
        userId: task.createdByUserId,
        organisationId: task.organisationId,
        type: NotificationType.TASK_COMPLETED,
        title: 'Cleanup task completed',
        message: `"${task.description}" has been marked complete.`,
        relatedEntityType: 'task',
        relatedEntityId: task.id,
      }),
    ]);

    return this.findById(taskId);
  }
}
