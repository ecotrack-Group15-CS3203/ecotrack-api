import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { IncidentsModule } from '../incidents/incidents.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrganisationsModule } from '../organisations/organisations.module';
import { TaskAssignment } from './entities/task-assignment.entity';
import { TaskNote } from './entities/task-note.entity';
import { TaskPhoto } from './entities/task-photo.entity';
import { Task } from './entities/task.entity';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Task, TaskAssignment, TaskNote, TaskPhoto]),
    IncidentsModule,
    OrganisationsModule,
    NotificationsModule,
    AuditModule,
  ],
  controllers: [TasksController],
  providers: [TasksService],
  exports: [TasksService],
})
export class TasksModule {}
