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
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { taskPhotoUploadOptions } from '../../common/config/upload.config';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { PLATFORM_ADMIN } from '../../common/enums/app-role.enum';
import { TaskStatus } from '../../common/enums/task.enum';
import { UserRole } from '../../common/enums/user-role.enum';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-request.interface';
import { AddTaskNoteDto } from './dto/add-task-note.dto';
import { AssignVolunteersDto } from './dto/assign-volunteers.dto';
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

  @Roles(UserRole.ORG_ADMIN)
  @Patch(':taskId')
  update(
    @Param('organisationId', ParseUUIDPipe) organisationId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() dto: UpdateTaskDto,
  ) {
    return this.tasksService.update(organisationId, taskId, dto);
  }

  @Roles(UserRole.ORG_ADMIN)
  @Post(':taskId/assignments')
  assignVolunteers(
    @Param('organisationId', ParseUUIDPipe) organisationId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() dto: AssignVolunteersDto,
  ) {
    return this.tasksService.assignVolunteers(
      organisationId,
      taskId,
      dto.volunteerUserIds,
    );
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

  @Roles(UserRole.VOLUNTEER)
  @ApiConsumes('multipart/form-data')
  @Post(':taskId/progress/photos')
  @UseInterceptors(FilesInterceptor('photos', 5, taskPhotoUploadOptions))
  addPhotos(
    @Param('organisationId', ParseUUIDPipe) organisationId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @UploadedFiles() photos: Express.Multer.File[],
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const photoUrls = (photos ?? []).map(
      (file) => `/uploads/tasks/${file.filename}`,
    );
    return this.tasksService.addPhotos(
      organisationId,
      taskId,
      user.id,
      photoUrls,
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
