import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import {
  Paginated,
  PaginationQueryDto,
} from '../../common/dto/pagination-query.dto';
import { UserRole } from '../../common/enums/user-role.enum';
import { DRIZZLE_DB } from '../../database/drizzle.provider';
import type { DrizzleDb } from '../../database/drizzle.provider';
import { users } from '../../database/schema';

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
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

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
}
