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
import { taskPhotoUploadOptions } from '../../common/config/upload.config';
import { CurrentMembership } from '../../common/decorators/current-membership.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { PLATFORM_ADMIN } from '../../common/enums/app-role.enum';
import { MembershipRole } from '../../common/enums/membership-role.enum';
import { TaskStatus } from '../../common/enums/task.enum';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-request.interface';
import { OrganisationMember } from '../organisations/entities/organisation-member.entity';
import { AddTaskNoteDto } from './dto/add-task-note.dto';
import { AssignVolunteersDto } from './dto/assign-volunteers.dto';
import { CreateTaskDto } from './dto/create-task.dto';
import { RespondAssignmentDto } from './dto/respond-assignment.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { TasksService } from './tasks.service';

@Controller('organisations/:organisationId/tasks')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Roles(MembershipRole.ORG_ADMIN)
  @Post()
  create(
    @Param('organisationId', ParseUUIDPipe) organisationId: string,
    @Body() dto: CreateTaskDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasksService.create(organisationId, user.id, dto);
  }

  @Roles(MembershipRole.ORG_ADMIN, PLATFORM_ADMIN)
  @Get()
  findAll(
    @Param('organisationId', ParseUUIDPipe) organisationId: string,
    @Query('status') status?: TaskStatus,
  ) {
    return this.tasksService.listForOrg(organisationId, status);
  }

  @Roles(MembershipRole.VOLUNTEER)
  @Get('mine')
  findMine(@CurrentUser() user: AuthenticatedUser) {
    return this.tasksService.listAssignedToVolunteer(user.id);
  }

  @Roles(MembershipRole.ORG_ADMIN, MembershipRole.VOLUNTEER, PLATFORM_ADMIN)
  @Get(':taskId')
  async findOne(
    @Param('organisationId', ParseUUIDPipe) organisationId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentMembership() membership?: OrganisationMember,
  ) {
    const task = await this.tasksService.findScoped(organisationId, taskId);
    const isOrgAdmin = membership?.role === MembershipRole.ORG_ADMIN;
    const isAssignedVolunteer = task.assignments.some(
      (a) => a.volunteerUserId === user.id,
    );
    if (!isOrgAdmin && !isAssignedVolunteer && !user.isPlatformAdmin) {
      throw new ForbiddenException();
    }
    return task;
  }

  @Roles(MembershipRole.ORG_ADMIN)
  @Patch(':taskId')
  update(
    @Param('organisationId', ParseUUIDPipe) organisationId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() dto: UpdateTaskDto,
  ) {
    return this.tasksService.update(organisationId, taskId, dto);
  }

  @Roles(MembershipRole.ORG_ADMIN)
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

  @Roles(MembershipRole.VOLUNTEER)
  @HttpCode(HttpStatus.OK)
  @Patch(':taskId/assignments/respond')
  respondToAssignment(
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() dto: RespondAssignmentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasksService.respondToAssignment(taskId, user.id, dto.accept);
  }

  @Roles(MembershipRole.VOLUNTEER)
  @HttpCode(HttpStatus.OK)
  @Patch(':taskId/progress/start')
  startProgress(
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasksService.markInProgress(taskId, user.id);
  }

  @Roles(MembershipRole.VOLUNTEER)
  @Post(':taskId/progress/notes')
  addNote(
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() dto: AddTaskNoteDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasksService.addNote(taskId, user.id, dto.note);
  }

  @Roles(MembershipRole.VOLUNTEER)
  @Post(':taskId/progress/photos')
  @UseInterceptors(FilesInterceptor('photos', 5, taskPhotoUploadOptions))
  addPhotos(
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @UploadedFiles() photos: Express.Multer.File[],
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const photoUrls = (photos ?? []).map(
      (file) => `/uploads/tasks/${file.filename}`,
    );
    return this.tasksService.addPhotos(taskId, user.id, photoUrls);
  }

  @Roles(MembershipRole.VOLUNTEER)
  @HttpCode(HttpStatus.OK)
  @Patch(':taskId/progress/complete')
  complete(
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasksService.markCompleted(taskId, user.id);
  }
}
