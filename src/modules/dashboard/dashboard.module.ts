import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Incident } from '../incidents/entities/incident.entity';
import { OrganisationMember } from '../organisations/entities/organisation-member.entity';
import { Task } from '../tasks/entities/task.entity';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [TypeOrmModule.forFeature([Incident, Task, OrganisationMember])],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
