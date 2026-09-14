import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import {
  Paginated,
  PaginationQueryDto,
} from '../../common/dto/pagination-query.dto';
import { AssignmentStatus, TaskStatus } from '../../common/enums/task.enum';
import { NotificationType } from '../../common/enums/notification.enum';
import { UserRole } from '../../common/enums/user-role.enum';
import { DRIZZLE_DB } from '../../database/drizzle.provider';
import type { DrizzleDb } from '../../database/drizzle.provider';
import {
  eventRsvps,
  events,
  taskAssignments,
  tasks,
  users,
} from '../../database/schema';
import { TenantDbService } from '../../database/tenant-db.service';
import { AuditLogService } from '../audit/audit-log.service';
import { NotificationDispatchRepository } from '../notifications/dispatch/notification-dispatch.repository';
import { NotificationsService } from '../notifications/notifications.service';
import { UsersService } from '../users/users.service';

export interface PublicMemberRow {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  isActive: boolean;
  createdAt: Date;
}

/**
 * Kept as its own class/name (rather than folding into UsersService) to minimize
 * churn in the modules that already depend on it — internally it's now just
 * `users` queries filtered by `organisationId`, since single-org-per-user removed
 * the separate `organisation_members` join table entirely (role/org live directly on
 * `users` — see schema/users.schema.ts). Uses the pool-wide DRIZZLE_DB: `users` isn't
 * RLS-protected (SRS 3.1.19), so the org filter here IS the access boundary — callers
 * must pass an `organisationId` that TenantGuard has already validated against the
 * caller's own org.
 */
@Injectable()
export class OrganisationMembersService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDb,
    private readonly tenantDb: TenantDbService,
    private readonly usersService: UsersService,
    private readonly notificationsService: NotificationsService,
    private readonly notificationDispatchRepository: NotificationDispatchRepository,
    private readonly auditLogService: AuditLogService,
  ) {}

  /** A "membership" is just: does this user belong to this org, and are they active. */
  async findMembership(
    organisationId: string,
    userId: string,
  ): Promise<{ role: UserRole; isActive: boolean } | undefined> {
    const member = await this.db.query.users.findFirst({
      where: and(
        eq(users.id, userId),
        eq(users.organisationId, organisationId),
      ),
      columns: { role: true, isActive: true },
    });
    // Drizzle infers `role` as a plain string-literal union, not the UserRole enum —
    // same reconciliation as tasks.service.ts's TaskFull cast.
    return member as { role: UserRole; isActive: boolean } | undefined;
  }

  /**
   * Unpaginated, deliberately: this is also how JoinRequestsService finds every
   * admin to notify of a new request, and silently notifying only the first page
   * of admins would be a real bug, not a performance optimisation. The HTTP list
   * route uses listMembersPaginated below instead.
   */
  listMembers(organisationId: string, role?: UserRole) {
    return this.db.query.users.findMany({
      where: role
        ? and(eq(users.organisationId, organisationId), eq(users.role, role))
        : eq(users.organisationId, organisationId),
      columns: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
    });
  }

  async listMembersPaginated(
    organisationId: string,
    { page, limit }: PaginationQueryDto,
    role?: UserRole,
  ): Promise<Paginated<PublicMemberRow>> {
    const where = role
      ? and(eq(users.organisationId, organisationId), eq(users.role, role))
      : eq(users.organisationId, organisationId);

    const [items, [{ count: total }]] = await Promise.all([
      this.db.query.users.findMany({
        where,
        orderBy: desc(users.createdAt),
        limit,
        offset: (page - 1) * limit,
        columns: {
          id: true,
          email: true,
          fullName: true,
          role: true,
          isActive: true,
          createdAt: true,
        },
      }),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(users)
        .where(where),
    ]);
    // Same string-literal-union-vs-enum reconciliation as findMembership above.
    return { items: items as PublicMemberRow[], total, page, limit };
  }

  listAvailableVolunteers(organisationId: string) {
    return this.db.query.users.findMany({
      where: and(
        eq(users.organisationId, organisationId),
        eq(users.role, UserRole.VOLUNTEER),
        eq(users.isActive, true),
      ),
      columns: { id: true, email: true, fullName: true },
    });
  }

  /**
   * SRS 3.1.10: disables the volunteer's access to this org without deleting the
   * underlying account (they remain a `citizen` and may join elsewhere or be
   * re-invited later). Runs through the tenant-scoped connection, unlike this
   * service's other methods — cancelling assignments and RSVPs touches
   * `task_assignments`/`tasks`/`event_rsvps`/`events`, which ARE RLS-protected,
   * unlike the bare `users` queries above.
   */
  async removeVolunteer(
    organisationId: string,
    volunteerUserId: string,
    actingUserId: string,
  ): Promise<void> {
    if (volunteerUserId === actingUserId) {
      throw new BadRequestException('You cannot remove yourself this way.');
    }
    const member = await this.findMembership(organisationId, volunteerUserId);
    if (!member) {
      throw new NotFoundException(
        'This user is not a member of this organisation.',
      );
    }
    if (member.role !== UserRole.VOLUNTEER) {
      throw new BadRequestException(
        'Only volunteers can be removed this way — an admin must transfer or step down first.',
      );
    }

    // Cancel any active assignment and return its task to pending — there is no
    // "unassigned" task status (SRS wording notwithstanding); pending + no active
    // assignment is what that already means everywhere else in this codebase (see
    // TasksService.reassign).
    const activeAssignments =
      await this.tenantDb.db.query.taskAssignments.findMany({
        where: and(
          eq(taskAssignments.organisationId, organisationId),
          eq(taskAssignments.volunteerUserId, volunteerUserId),
          inArray(taskAssignments.status, [
            AssignmentStatus.ASSIGNED,
            AssignmentStatus.ACCEPTED,
          ]),
        ),
      });
    for (const assignment of activeAssignments) {
      await this.tenantDb.db
        .update(taskAssignments)
        .set({
          status: AssignmentStatus.CANCELLED,
          respondedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(taskAssignments.id, assignment.id));
      await this.tenantDb.db
        .update(tasks)
        .set({
          status: TaskStatus.PENDING,
          startedAt: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(tasks.id, assignment.taskId),
            // Never resurrect an already-completed task.
            sql`${tasks.status} <> ${TaskStatus.COMPLETED}`,
          ),
        );
      await this.notificationDispatchRepository.cancel(
        this.tenantDb.db,
        'task_due_reminder',
        assignment.taskId,
      );
    }

    // Withdraw RSVPs on events that haven't happened yet — the SRS doesn't mention
    // this, but leaving them would silently leak capacity on events with a cap:
    // the seat stays reserved for someone who no longer has access to see or
    // attend it.
    const futureRsvps = await this.tenantDb.db.query.eventRsvps.findMany({
      where: and(
        eq(eventRsvps.organisationId, organisationId),
        eq(eventRsvps.userId, volunteerUserId),
      ),
    });
    for (const rsvp of futureRsvps) {
      const [event] = await this.tenantDb.db
        .select({ status: events.status })
        .from(events)
        .where(eq(events.id, rsvp.eventId));
      if (
        event &&
        (event.status === 'completed' || event.status === 'cancelled')
      ) {
        continue;
      }
      await this.tenantDb.db
        .delete(eventRsvps)
        .where(
          and(
            eq(eventRsvps.eventId, rsvp.eventId),
            eq(eventRsvps.userId, volunteerUserId),
          ),
        );
      await this.tenantDb.db
        .update(events)
        .set({
          rsvpCount: sql`GREATEST(${events.rsvpCount} - 1, 0)`,
          updatedAt: new Date(),
        })
        .where(and(eq(events.id, rsvp.eventId), gt(events.rsvpCount, 0)));
    }

    await this.usersService.setMembership(
      volunteerUserId,
      null,
      UserRole.CITIZEN,
    );

    // Sequential, not Promise.all: both calls ultimately query tenantDb.db, one
    // dedicated pg Client per request (TenantInterceptor), not a Pool —
    // concurrent queries on it hit node-postgres's deprecated-and-scheduled-for-
    // removal concurrent-query path.
    await this.auditLogService.record({
      organisationId,
      actingUserId,
      action: 'organisation.volunteer_removed',
      entityType: 'user',
      entityId: volunteerUserId,
    });
    await this.notificationsService.create(
      {
        userId: volunteerUserId,
        // The real org id, not null: this insert runs through the acting
        // admin's tenant-scoped session, and notifications_insert's WITH CHECK
        // only allows organisation_id = current_tenant or user_id =
        // current_user_id — by this point the volunteer's own membership has
        // already been cleared, so neither branch would match a null here.
        organisationId,
        type: NotificationType.VOLUNTEER_REMOVED,
        title: 'Membership ended',
        message: 'Your volunteer membership with this organisation has ended.',
        relatedEntityType: 'organisation',
        relatedEntityId: organisationId,
      },
      this.tenantDb.db,
    );
  }
}
