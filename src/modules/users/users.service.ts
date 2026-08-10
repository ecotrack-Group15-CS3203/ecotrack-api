import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { DRIZZLE_DB } from '../../database/drizzle.provider';
import type { DrizzleDb } from '../../database/drizzle.provider';
import { DEFAULT_NOTIFICATION_PREFERENCES, users } from '../../database/schema';
import { UserRole } from '../../common/enums/user-role.enum';

export type UserRow = typeof users.$inferSelect;

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
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

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
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning();
    return updated;
  }

  /** Sets or clears a user's org membership + role — used by join/invite-accept flows. */
  async setMembership(
    userId: string,
    organisationId: string | null,
    role: UserRole,
  ): Promise<UserRow> {
    const [updated] = await this.db
      .update(users)
      .set({ organisationId, role, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
    return updated;
  }
}
