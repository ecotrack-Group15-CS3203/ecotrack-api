import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { PLATFORM_ADMIN } from '../../common/enums/app-role.enum';
import { TaskStatus } from '../../common/enums/task.enum';
import { UserRole } from '../../common/enums/user-role.enum';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-request.interface';
import { AddTaskNoteDto } from './dto/add-task-note.dto';
import { AddTaskPhotosDto } from './dto/add-task-photos.dto';
import { CreateTaskDto } from './dto/create-task.dto';
import { RespondAssignmentDto } from './dto/respond-assignment.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { TasksService } from './tasks.service';

@ApiTags('tasks')
@ApiBearerAuth()
@Controller('organisations/:organisationId/tasks')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Roles(UserRole.ORG_ADMIN)
  @Post()
  create(
    @Param('organisationId', ParseUUIDPipe) organisationId: string,
    @Body() dto: CreateTaskDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasksService.create(organisationId, user.id, dto);
  }

  @Roles(UserRole.ORG_ADMIN, PLATFORM_ADMIN)
  @Get()
  findAll(
    @Param('organisationId', ParseUUIDPipe) organisationId: string,
    @Query('status') status?: TaskStatus,
  ) {
    return this.tasksService.listForOrg(organisationId, status);
  }

  @Roles(UserRole.VOLUNTEER)
  @Get('mine')
  findMine(
    @CurrentUser() user: AuthenticatedUser,
    @Query('view')
    view?: 'assigned' | 'in_progress' | 'completed' | 'declined' | 'upcoming',
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.tasksService.listAssignedToVolunteer(user.id, {
      view,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Roles(UserRole.ORG_ADMIN, UserRole.VOLUNTEER, PLATFORM_ADMIN)
  @Get(':taskId')
  async findOne(
    @Param('organisationId', ParseUUIDPipe) organisationId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const task = await this.tasksService.findScoped(organisationId, taskId);
    const isOrgAdmin = user.role === UserRole.ORG_ADMIN;
    const isAssignedVolunteer = task.assignments.some(
      (a) => a.volunteerUserId === user.id,
    );
    if (!isOrgAdmin && !isAssignedVolunteer && !user.isPlatformAdmin) {
      throw new ForbiddenException();
    }
    return task;
  }

  /** `assignedTo` here is a reassignment (SRS 3.1.8) — cancels the current
   * assignment and creates a new one; see TasksService.reassign. */
  @Roles(UserRole.ORG_ADMIN)
  @Patch(':taskId')
  update(
    @Param('organisationId', ParseUUIDPipe) organisationId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() dto: UpdateTaskDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasksService.update(organisationId, taskId, dto, user.id);
  }

  @Roles(UserRole.VOLUNTEER)
  @HttpCode(HttpStatus.OK)
  @Patch(':taskId/assignments/respond')
  respondToAssignment(
    @Param('organisationId', ParseUUIDPipe) organisationId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() dto: RespondAssignmentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasksService.respondToAssignment(
      organisationId,
      taskId,
      user.id,
      dto.accept,
      dto.reason,
    );
  }

  @Roles(UserRole.VOLUNTEER)
  @HttpCode(HttpStatus.OK)
  @Patch(':taskId/progress/start')
  startProgress(
    @Param('organisationId', ParseUUIDPipe) organisationId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasksService.markInProgress(organisationId, taskId, user.id);
  }

  @Roles(UserRole.VOLUNTEER)
  @Post(':taskId/progress/notes')
  addNote(
    @Param('organisationId', ParseUUIDPipe) organisationId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() dto: AddTaskNoteDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasksService.addNote(organisationId, taskId, user.id, dto.note);
  }

  /**
   * JSON, not multipart: photos go straight to S3 via POST /v1/media/upload-url and
   * only their URLs arrive here, exactly like incident photos (SRS 3.1.15/3.1.16).
   */
  @Roles(UserRole.VOLUNTEER)
  @Post(':taskId/progress/photos')
  addPhotos(
    @Param('organisationId', ParseUUIDPipe) organisationId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() dto: AddTaskPhotosDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasksService.addPhotos(
      organisationId,
      taskId,
      user.id,
      dto.mediaUrls,
    );
  }

  @Roles(UserRole.VOLUNTEER)
  @HttpCode(HttpStatus.OK)
  @Patch(':taskId/progress/complete')
  complete(
    @Param('organisationId', ParseUUIDPipe) organisationId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasksService.markCompleted(organisationId, taskId, user.id);
  }
}
