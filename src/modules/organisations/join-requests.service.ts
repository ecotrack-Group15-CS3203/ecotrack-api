import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  Paginated,
  PaginationQueryDto,
} from '../../common/dto/pagination-query.dto';
import { NotificationType } from '../../common/enums/notification.enum';
import { UserRole } from '../../common/enums/user-role.enum';
import { joinRequests, organisations, users } from '../../database/schema';
import { toGeographyPoint } from '../../database/schema/columns.helpers';
import { TenantDbService } from '../../database/tenant-db.service';
import { AuditLogService } from '../audit/audit-log.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UsersService } from '../users/users.service';
import { OrganisationMembersService } from './organisation-members.service';

export type JoinRequestRow = typeof joinRequests.$inferSelect;

export interface JoinRequestWithRequester extends JoinRequestRow {
  requester: { id: string; fullName: string; email: string } | null;
}

/**
 * SRS 3.1.11. Structurally close to InviteLinksService (same geo-eligibility and
 * single-org checks), but with a different RLS anchor: a join request has no
 * secret token to authorize the cross-tenant write, so it's authorized instead by
 * `user_id = current_user_id` (see 0014_join_requests_rls.sql) — a citizen with no
 * org can always insert a row naming themselves, the same way they can always see
 * their own reported incidents regardless of tenant.
 */
@Injectable()
export class JoinRequestsService {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly auditLogService: AuditLogService,
    private readonly usersService: UsersService,
    private readonly membersService: OrganisationMembersService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Narrow, request-scoped escape hatch (see 0015_join_request_cross_org_writes.sql)
   * for the two writes below that are legitimately scoped to the target
   * organisation while the submitting citizen's own tenant is empty: the admin
   * notifications and the audit log entry. Not needed for the join_requests
   * insert itself, which is already authorized by `user_id = current_user_id`.
   */
  private async setCrossOrgWriteFlag(): Promise<void> {
    await this.tenantDb.db.execute(
      sql`SELECT set_config('app.join_request_submission', 'true', true)`,
    );
  }

  async submit(
    userId: string,
    dto: { organisationId: string; lat: number; lng: number; message?: string },
  ): Promise<JoinRequestRow> {
    const org = await this.tenantDb.db.query.organisations.findFirst({
      where: eq(organisations.id, dto.organisationId),
    });
    if (!org) {
      throw new NotFoundException('Organisation not found');
    }
    if (!org.serviceAreaCenter || !org.serviceAreaRadiusKm) {
      throw new BadRequestException(
        "This organisation's service area is not configured.",
      );
    }

    const centerEwkt = toGeographyPoint(
      org.serviceAreaCenter.lat,
      org.serviceAreaCenter.lng,
    );
    const [{ within }] = (
      await this.tenantDb.db.execute<{
        [key: string]: unknown;
        within: boolean;
      }>(sql`
        SELECT ST_DWithin(
          ST_MakePoint(${dto.lng}, ${dto.lat})::geography,
          ${centerEwkt}::geography,
          ${org.serviceAreaRadiusKm * 1000}
        ) AS within
      `)
    ).rows;
    if (!within) {
      throw new UnprocessableEntityException(
        `You are outside ${org.name}'s service area.`,
      );
    }

    const user = await this.usersService.findById(userId);
    if (user?.organisationId) {
      throw new ConflictException('Already a member of another organisation.');
    }

    const existing = await this.tenantDb.db.query.joinRequests.findFirst({
      where: and(
        eq(joinRequests.organisationId, dto.organisationId),
        eq(joinRequests.userId, userId),
      ),
    });
    // The partial unique index only excludes resolved (rejected) rows from
    // conflicting, so an existing pending/approved row is the only case worth a
    // friendly pre-check message here — anything else (rejected, or none) is fine
    // to proceed past, and the index is the backstop if this races anyway.
    if (existing && existing.status !== 'rejected') {
      throw new ConflictException(
        'You already have a pending or approved request to this organisation.',
      );
    }

    const [created] = await this.tenantDb.db
      .insert(joinRequests)
      .values({
        organisationId: dto.organisationId,
        userId,
        message: dto.message ?? null,
      })
      .returning();

    await this.setCrossOrgWriteFlag();

    const admins = await this.membersService.listMembers(
      dto.organisationId,
      UserRole.ORG_ADMIN,
    );
    await Promise.all(
      admins.map((admin) =>
        this.notificationsService.create({
          userId: admin.id,
          organisationId: dto.organisationId,
          type: NotificationType.JOIN_REQUEST_SUBMITTED,
          title: 'New volunteer join request',
          message: `${user?.fullName ?? 'A citizen'} wants to join ${org.name}.`,
          relatedEntityType: 'join_request',
          relatedEntityId: created.id,
        }),
      ),
    );

    await this.auditLogService.record({
      organisationId: dto.organisationId,
      actingUserId: userId,
      action: 'join_request.submitted',
      entityType: 'join_request',
      entityId: created.id,
    });

    // Last, deliberately — same reasoning as InviteLinksService.accept(): this
    // writes through UsersService's separate, immediately-committing pool-wide
    // connection, so a failure anywhere above must not leave it as the only thing
    // that persisted. Consent is implicit in submitting a location-gated request
    // (SRS 3.11.1 — the app prompts specifically for this purpose beforehand).
    await this.usersService.setHomeLocation(userId, {
      lat: dto.lat,
      lng: dto.lng,
    });

    return created;
  }

  /**
   * SRS 3.1.11's "Join Requests" panel needs requester name/email alongside each
   * row — joined here rather than left to the caller, since a pending requester
   * has no organisationId yet and so never appears in
   * OrganisationMembersService.listMembers().
   */
  async listForOrganisation(
    organisationId: string,
    { page, limit }: PaginationQueryDto,
    status?: 'pending' | 'approved' | 'rejected',
  ): Promise<Paginated<JoinRequestWithRequester>> {
    const where = status
      ? and(
          eq(joinRequests.organisationId, organisationId),
          eq(joinRequests.status, status),
        )
      : eq(joinRequests.organisationId, organisationId);

    const [rows, [{ count: total }]] = await Promise.all([
      this.tenantDb.db.query.joinRequests.findMany({
        where,
        orderBy: desc(joinRequests.createdAt),
        limit,
        offset: (page - 1) * limit,
      }),
      this.tenantDb.db
        .select({ count: sql<number>`count(*)::int` })
        .from(joinRequests)
        .where(where),
    ]);
    if (rows.length === 0) return { items: [], total, page, limit };

    const requesterIds = rows.map((r) => r.userId);
    const requesters = await this.tenantDb.db.query.users.findMany({
      where: inArray(users.id, requesterIds),
      columns: { id: true, fullName: true, email: true },
    });
    const requesterById = new Map(requesters.map((u) => [u.id, u]));

    const items = rows.map((r) => ({
      ...r,
      requester: requesterById.get(r.userId) ?? null,
    }));
    return { items, total, page, limit };
  }

  /**
   * Approval re-checks the single-org rule (SAD UC-02's fail condition: "already a
   * member of another organisation... until that membership ends") since time has
   * passed since submission — the requester could have joined elsewhere via a
   * different path meanwhile. On that conflict the request is left pending, not
   * silently rejected, so an admin can retry once resolved.
   */
  async updateStatus(
    organisationId: string,
    requestId: string,
    status: 'approved' | 'rejected',
    actingUserId: string,
  ): Promise<JoinRequestRow> {
    const request = await this.tenantDb.db.query.joinRequests.findFirst({
      where: and(
        eq(joinRequests.id, requestId),
        eq(joinRequests.organisationId, organisationId),
      ),
    });
    if (!request) {
      throw new NotFoundException('Join request not found');
    }
    if (request.status !== 'pending') {
      throw new BadRequestException(
        'This join request has already been resolved.',
      );
    }

    const org = await this.tenantDb.db.query.organisations.findFirst({
      where: eq(organisations.id, organisationId),
    });

    // Re-fetches the requester's current state (not the pre-checks' stale `request`
    // row) since time has passed since submission.
    if (status === 'approved') {
      const user = await this.usersService.findById(request.userId);
      if (user?.organisationId) {
        throw new ConflictException(
          'This user already belongs to another organisation; approval is blocked until that membership ends.',
        );
      }
    }

    // Tenant-scoped writes (this org's own transaction) go first; setMembership()
    // last — see InviteLinksService.accept()'s doc comment for why: it writes
    // through a separate, immediately-committing connection, so ordering it last
    // means a failure there rolls back the status change and notification above
    // together instead of leaving a membership grant with no recorded approval.
    const [updated] = await this.tenantDb.db
      .update(joinRequests)
      .set({ status, updatedAt: new Date() })
      .where(eq(joinRequests.id, requestId))
      .returning();

    await this.notificationsService.create(
      status === 'approved'
        ? {
            userId: request.userId,
            organisationId,
            type: NotificationType.JOIN_REQUEST_APPROVED,
            title: 'Join request approved',
            message: `You are now a volunteer with ${org?.name ?? 'the organisation'}.`,
            relatedEntityType: 'join_request',
            relatedEntityId: request.id,
          }
        : {
            userId: request.userId,
            organisationId,
            type: NotificationType.JOIN_REQUEST_REJECTED,
            title: 'Join request update',
            message: `Your join request to ${org?.name ?? 'the organisation'} was not approved at this time.`,
            relatedEntityType: 'join_request',
            relatedEntityId: request.id,
          },
    );

    await this.auditLogService.record({
      organisationId,
      actingUserId,
      action:
        status === 'approved'
          ? 'join_request.approved'
          : 'join_request.rejected',
      entityType: 'join_request',
      entityId: requestId,
    });

    if (status === 'approved') {
      await this.usersService.setMembership(
        request.userId,
        organisationId,
        UserRole.VOLUNTEER,
      );
    }

    return updated;
  }
}
