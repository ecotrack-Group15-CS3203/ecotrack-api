import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, inArray, sql } from 'drizzle-orm';
import { DRIZZLE_DB } from '../../database/drizzle.provider';
import type { DrizzleDb } from '../../database/drizzle.provider';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  events,
  eventRsvps,
  taskAssignments,
  tasks,
  users,
} from '../../database/schema';
import { IncidentSeverity } from '../../common/enums/incident.enum';
import { AssignmentStatus, TaskStatus } from '../../common/enums/task.enum';
import { UserRole } from '../../common/enums/user-role.enum';
import { TenantDbService } from '../../database/tenant-db.service';

export type UserRow = typeof users.$inferSelect;

/** SRS 3.11.1: history stays attached to a real row even after the account behind
 * it is gone. Seeded by migration 0029. */
const DELETED_USER_SENTINEL_ID = '00000000-0000-0000-0000-000000000000';

/**
 * Deliberately uses the pool-wide DRIZZLE_DB, not the request-scoped tenant db:
 * (1) `users` is not RLS-protected (tenant-agnostic per SRS 3.1.19), so there's
 * nothing to gain from routing through a tenant transaction, and (2)
 * `findOrProvisionByAuthSubject` is called from JwtStrategy.validate() during the
 * guard phase, before TenantInterceptor has opened a tenant transaction for this
 * request — the tenant-scoped db genuinely isn't available yet at that point.
 */
@Injectable()
export class UsersService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDb,
    private readonly tenantDb: TenantDbService,
  ) {}

  findByAuthSubject(authSubject: string): Promise<UserRow | undefined> {
    return this.db.query.users.findFirst({
      where: eq(users.authSubject, authSubject),
    });
  }

  findById(id: string): Promise<UserRow | undefined> {
    return this.db.query.users.findFirst({ where: eq(users.id, id) });
  }

  /** Used only for the org-admin-bootstrap "does this email already have an account"
   * check (organisations.service.ts) — matching a pre-existing JIT-provisioned user
   * by email so they can be promoted to org_admin directly instead of invited. */
  findByEmail(email: string): Promise<UserRow | undefined> {
    return this.db.query.users.findFirst({ where: eq(users.email, email) });
  }

  async countAll(): Promise<number> {
    const [{ count }] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(users);
    return count;
  }

  /**
   * Just-in-time provisioning: the first time a validated Asgardeo token for an
   * unseen `authSubject` hits the API, create the local user row from its claims.
   * On subsequent requests, just returns the existing row — this is also where a
   * changed Asgardeo email/fullName would get picked up (kept in sync on every
   * request, cheap since it's a single indexed upsert).
   */
  async findOrProvisionByAuthSubject(claims: {
    authSubject: string;
    email: string;
    fullName: string;
  }): Promise<UserRow> {
    const existing = await this.findByAuthSubject(claims.authSubject);
    if (existing) {
      if (
        existing.email !== claims.email ||
        existing.fullName !== claims.fullName
      ) {
        const [updated] = await this.db
          .update(users)
          .set({
            email: claims.email,
            fullName: claims.fullName,
            updatedAt: new Date(),
          })
          .where(eq(users.id, existing.id))
          .returning();
        return updated;
      }
      return existing;
    }

    const [created] = await this.db
      .insert(users)
      .values({
        authSubject: claims.authSubject,
        email: claims.email,
        fullName: claims.fullName,
        role: UserRole.CITIZEN,
      })
      .returning();
    return created;
  }

  async updateProfile(
    userId: string,
    data: {
      fullName?: string;
      pushToken?: string | null;
      notificationPreferences?: Partial<
        typeof DEFAULT_NOTIFICATION_PREFERENCES
      >;
      notificationRadiusMeters?: number;
      notificationMinUrgency?: IncidentSeverity;
      alertCenter?: { lat: number; lng: number };
    },
  ): Promise<UserRow> {
    const current = await this.findById(userId);
    if (!current) {
      throw new Error(`User ${userId} not found`);
    }
    const [updated] = await this.db
      .update(users)
      .set({
        ...(data.fullName !== undefined && { fullName: data.fullName }),
        ...(data.pushToken !== undefined && { pushToken: data.pushToken }),
        ...(data.notificationPreferences && {
          notificationPreferences: {
            ...(current.notificationPreferences as typeof DEFAULT_NOTIFICATION_PREFERENCES),
            ...data.notificationPreferences,
          },
        }),
        ...(data.notificationRadiusMeters !== undefined && {
          notificationRadiusMeters: data.notificationRadiusMeters,
        }),
        ...(data.notificationMinUrgency !== undefined && {
          notificationMinUrgency: data.notificationMinUrgency,
        }),
        ...(data.alertCenter !== undefined && {
          alertCenter: data.alertCenter,
          alertCenterUpdatedAt: new Date(),
        }),
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning();
    return updated;
  }

  /**
   * Sets or clears a user's org membership + role — used by join/invite-accept
   * flows. `homeLocation` is optional and only ever passed by the invite-link
   * accept flow (SRS 3.11.1): a single UPDATE keeps the membership change and the
   * location write atomic at the row level without needing an explicit
   * transaction.
   */
  async setMembership(
    userId: string,
    organisationId: string | null,
    role: UserRole,
    homeLocation?: { lat: number; lng: number },
  ): Promise<UserRow> {
    const [updated] = await this.db
      .update(users)
      .set({
        organisationId,
        role,
        ...(homeLocation !== undefined && { homeLocation }),
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning();
    return updated;
  }

  /**
   * The join-request flow's counterpart to setMembership()'s homeLocation param:
   * SRS 3.1.11 saves the location at *submission* time (once geo-eligibility has
   * already been checked against it), well before approval decides membership, so
   * it can't ride along on a setMembership() call the way invite-link accept does.
   */
  async setHomeLocation(
    userId: string,
    homeLocation: { lat: number; lng: number },
  ): Promise<void> {
    await this.db
      .update(users)
      .set({ homeLocation, updatedAt: new Date() })
      .where(eq(users.id, userId));
  }

  /**
   * SRS 3.11.1's right to erasure via `DELETE /v1/auth/me` (this codebase's
   * `/auth/me`, not a separate `/users/me` route — same reasoning as keeping the
   * British `/organisations` spelling: the document names change, the working
   * route doesn't).
   *
   * Deliberately database-local: this does not call Asgardeo's SCIM API to delete
   * the identity there too, so the same person signing in again afterwards would
   * be JIT-provisioned a fresh, empty citizen row for the same `sub`. Documenting
   * that limitation here rather than silently leaving it unaddressed.
   *
   * Order matters, and mirrors OrganisationMembersService.removeVolunteer(): the
   * tenant-scoped side effects (which need the caller's own RLS context — this is
   * always the caller deleting their own account, so that context is exactly
   * right) happen first, the row deletion happens last, so a failure partway
   * through never leaves the user row gone with orphaned references still
   * pointing at it.
   */
  async deleteAccount(userId: string): Promise<void> {
    const user = await this.findById(userId);
    if (!user) return;

    // Drizzle infers `role` as a plain string-literal union, not the UserRole enum —
    // same reconciliation as OrganisationMembersService.findMembership.
    if ((user.role as UserRole) === UserRole.ORG_ADMIN && user.organisationId) {
      const [{ count: remainingAdmins }] = await this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(users)
        .where(
          and(
            eq(users.organisationId, user.organisationId),
            eq(users.role, UserRole.ORG_ADMIN),
            eq(users.isActive, true),
            sql`${users.id} <> ${userId}`,
          ),
        );
      if (remainingAdmins === 0) {
        throw new ConflictException(
          'You are the last admin of an active organisation — transfer ownership or deactivate it before deleting your account.',
        );
      }
    }

    if (user.organisationId) {
      await this.reassignTaskAssignments(userId);
      await this.withdrawFutureRsvps(user.organisationId, userId);
    }

    // Must run on the same connection/transaction as the reassignment above, not
    // the pool-wide `this.db`: TenantInterceptor holds this request's tenant
    // transaction open (uncommitted) until the handler returns, so a delete issued
    // on a second pooled connection would block waiting for the row lock that
    // transaction holds on the very task_assignments rows it just reassigned —
    // which never resolves, since that transaction only commits *after* this
    // handler returns. Reproduced live as a hung request; `users` has no RLS, so
    // running the delete through tenantDb.db changes nothing about its semantics.
    await this.tenantDb.db.delete(users).where(eq(users.id, userId));
  }

  /**
   * Repoints every task_assignments row to the sentinel first (preserving "who
   * completed this task" per SRS 3.1.20), then — for whichever of those were
   * still active on a non-completed task — cancels the assignment and returns the
   * task to pending, since no real person is working it once the account is gone.
   * The repoint has to run before the cancel: cancelling first would leave the
   * about-to-be-deleted user's id on the row for CASCADE to sweep away with them.
   */
  private async reassignTaskAssignments(userId: string): Promise<void> {
    // A plain UPDATE would violate task_assignments_task_volunteer_unique if the
    // sentinel already holds a row on the same task (another deleted user having
    // worked it previously) — rare, but the anti-join guard makes it impossible
    // rather than assumed away. The handful of rows that do collide are deleted
    // outright instead: their task-level history already lives on the task row,
    // this assignment record specifically just can't keep referencing a
    // volunteer slot the sentinel already occupies.
    await this.tenantDb.db.execute(sql`
      UPDATE task_assignments
      SET volunteer_user_id = ${DELETED_USER_SENTINEL_ID}, updated_at = now()
      WHERE volunteer_user_id = ${userId}
        AND NOT EXISTS (
          SELECT 1 FROM task_assignments ta2
          WHERE ta2.task_id = task_assignments.task_id
            AND ta2.volunteer_user_id = ${DELETED_USER_SENTINEL_ID}
        )
    `);
    await this.tenantDb.db
      .delete(taskAssignments)
      .where(eq(taskAssignments.volunteerUserId, userId));

    const activeOnSentinel =
      await this.tenantDb.db.query.taskAssignments.findMany({
        where: and(
          eq(taskAssignments.volunteerUserId, DELETED_USER_SENTINEL_ID),
          inArray(taskAssignments.status, [
            AssignmentStatus.ASSIGNED,
            AssignmentStatus.ACCEPTED,
          ]),
        ),
      });
    for (const assignment of activeOnSentinel) {
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
            sql`${tasks.status} <> ${TaskStatus.COMPLETED}`,
          ),
        );
    }
  }

  /** Same reasoning as EventsService.cancelRsvp: withdrawing is fine to do
   * unconditionally, but the counter only needs correcting on events that
   * haven't already run their course. */
  private async withdrawFutureRsvps(
    organisationId: string,
    userId: string,
  ): Promise<void> {
    const rsvps = await this.tenantDb.db.query.eventRsvps.findMany({
      where: and(
        eq(eventRsvps.organisationId, organisationId),
        eq(eventRsvps.userId, userId),
      ),
    });
    for (const rsvp of rsvps) {
      const [event] = await this.tenantDb.db
        .select({ status: events.status })
        .from(events)
        .where(eq(events.id, rsvp.eventId));
      await this.tenantDb.db
        .delete(eventRsvps)
        .where(
          and(
            eq(eventRsvps.eventId, rsvp.eventId),
            eq(eventRsvps.userId, userId),
          ),
        );
      if (
        event &&
        (event.status === 'completed' || event.status === 'cancelled')
      ) {
        continue;
      }
      await this.tenantDb.db
        .update(events)
        .set({
          rsvpCount: sql`GREATEST(${events.rsvpCount} - 1, 0)`,
          updatedAt: new Date(),
        })
        .where(and(eq(events.id, rsvp.eventId), gt(events.rsvpCount, 0)));
    }
  }
}
