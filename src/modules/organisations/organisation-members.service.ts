import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { UserRole } from '../../common/enums/user-role.enum';
import { DRIZZLE_DB } from '../../database/drizzle.provider';
import type { DrizzleDb } from '../../database/drizzle.provider';
import { users } from '../../database/schema';

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
