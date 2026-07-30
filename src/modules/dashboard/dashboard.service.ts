import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { VerificationStatus } from '../../common/enums/incident.enum';
import { MembershipRole } from '../../common/enums/membership-role.enum';
import { TaskStatus } from '../../common/enums/task.enum';
import { Incident } from '../incidents/entities/incident.entity';
import { OrganisationMember } from '../organisations/entities/organisation-member.entity';
import { Task } from '../tasks/entities/task.entity';

@Injectable()
export class DashboardService {
  constructor(
    @InjectRepository(Incident)
    private readonly incidentsRepository: Repository<Incident>,
    @InjectRepository(Task)
    private readonly tasksRepository: Repository<Task>,
    @InjectRepository(OrganisationMember)
    private readonly membersRepository: Repository<OrganisationMember>,
  ) {}

  async getOrgStats(organisationId: string) {
    const [
      totalIncidents,
      pendingIncidents,
      verifiedIncidents,
      resolvedIncidents,
      activeVolunteers,
      completedCleanupTasks,
      categoryBreakdown,
    ] = await Promise.all([
      this.incidentsRepository.count({ where: { organisationId } }),
      this.incidentsRepository.count({
        where: {
          organisationId,
          verificationStatus: VerificationStatus.PENDING,
        },
      }),
      this.incidentsRepository.count({
        where: {
          organisationId,
          verificationStatus: VerificationStatus.APPROVED,
        },
      }),
      this.incidentsRepository
        .createQueryBuilder('incident')
        .innerJoin('incident.currentStage', 'stage')
        .where('incident.organisationId = :organisationId', { organisationId })
        .andWhere('stage.isFinal = true')
        .getCount(),
      this.membersRepository.count({
        where: {
          organisationId,
          role: MembershipRole.VOLUNTEER,
          isActive: true,
        },
      }),
      this.tasksRepository.count({
        where: { organisationId, status: TaskStatus.COMPLETED },
      }),
      this.incidentsRepository
        .createQueryBuilder('incident')
        .select('incident.category', 'category')
        .addSelect('COUNT(*)', 'count')
        .where('incident.organisationId = :organisationId', { organisationId })
        .groupBy('incident.category')
        .getRawMany<{ category: string; count: string }>(),
    ]);

    return {
      totalIncidents,
      pendingIncidents,
      verifiedIncidents,
      resolvedIncidents,
      activeVolunteers,
      completedCleanupTasks,
      incidentsByCategory: categoryBreakdown.map((row) => ({
        category: row.category,
        count: Number(row.count),
      })),
    };
  }

  async getIncidentMap(organisationId: string) {
    return this.incidentsRepository.find({
      where: { organisationId },
      select: {
        id: true,
        title: true,
        latitude: true,
        longitude: true,
        category: true,
        severity: true,
        verificationStatus: true,
      },
    });
  }
}
