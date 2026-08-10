import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { UserRole } from '../../common/enums/user-role.enum';
import { invitations, organisations } from '../../database/schema';
import { TenantDbService } from '../../database/tenant-db.service';
import { UsersService } from '../users/users.service';

export type InvitationRow = typeof invitations.$inferSelect;

const VOLUNTEER_INVITATION_TTL_HOURS = 24 * 7;
const ORG_ADMIN_INVITATION_TTL_HOURS = 72;

/**
 * All queries go through TenantDbService (the request-scoped, RLS-activated
 * connection) — including the token-based lookups, which are cross-tenant by design.
 * Those explicitly set `app.invitation_token_lookup` on that same connection first
 * (see migration 0003_app_role_and_rls.sql's invitations policy) rather than bypassing
 * RLS some other way — the secret token itself is the authorization, not org
 * membership, mirroring the pool-visibility exception on `incidents`.
 */
@Injectable()
export class InvitationsService {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly usersService: UsersService,
  ) {}

  private computeExpiry(role: UserRole): Date {
    const ttlHours =
      role === UserRole.ORG_ADMIN
        ? ORG_ADMIN_INVITATION_TTL_HOURS
        : VOLUNTEER_INVITATION_TTL_HOURS;
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + ttlHours);
    return expiresAt;
  }

  async create(data: {
    organisationId: string;
    email: string;
    fullName?: string;
    role?: UserRole;
    invitedByUserId: string;
  }): Promise<InvitationRow> {
    const role = data.role ?? UserRole.VOLUNTEER;
    const [invitation] = await this.tenantDb.db
      .insert(invitations)
      .values({
        organisationId: data.organisationId,
        email: data.email,
        invitedFullName: data.fullName ?? null,
        role,
        invitedByUserId: data.invitedByUserId,
        token: randomBytes(24).toString('hex'),
        expiresAt: this.computeExpiry(role),
      })
      .returning();
    return invitation;
  }

  private async setTokenLookupFlag(): Promise<void> {
    await this.tenantDb.db.execute(
      sql`SELECT set_config('app.invitation_token_lookup', 'true', true)`,
    );
  }

  private async findByTokenWithOrg(token: string): Promise<
    | (InvitationRow & {
        organisationName: string;
        organisationIsActive: boolean;
      })
    | undefined
  > {
    await this.setTokenLookupFlag();
    const [row] = await this.tenantDb.db
      .select({
        invitation: invitations,
        organisationName: organisations.name,
        organisationIsActive: organisations.isActive,
      })
      .from(invitations)
      .innerJoin(
        organisations,
        eq(invitations.organisationId, organisations.id),
      )
      .where(eq(invitations.token, token))
      .limit(1);
    if (!row) return undefined;
    return {
      ...row.invitation,
      organisationName: row.organisationName,
      organisationIsActive: row.organisationIsActive,
    };
  }

  listForOrganisation(
    organisationId: string,
    role?: UserRole,
  ): Promise<InvitationRow[]> {
    return this.tenantDb.db.query.invitations.findMany({
      where: role
        ? and(
            eq(invitations.organisationId, organisationId),
            eq(invitations.role, role),
          )
        : eq(invitations.organisationId, organisationId),
      orderBy: desc(invitations.createdAt),
    });
  }

  async resend(
    organisationId: string,
    invitationId: string,
  ): Promise<InvitationRow> {
    const existing = await this.tenantDb.db.query.invitations.findFirst({
      where: and(
        eq(invitations.id, invitationId),
        eq(invitations.organisationId, organisationId),
      ),
    });
    if (!existing) {
      throw new NotFoundException('Invitation not found');
    }
    if (existing.acceptedAt) {
      throw new BadRequestException(
        'This invitation has already been accepted',
      );
    }
    const [updated] = await this.tenantDb.db
      .update(invitations)
      .set({
        token: randomBytes(24).toString('hex'),
        expiresAt: this.computeExpiry(existing.role as UserRole),
        updatedAt: new Date(),
      })
      .where(eq(invitations.id, invitationId))
      .returning();
    return updated;
  }

  async getInvitationInfo(token: string) {
    const invitation = await this.findByTokenWithOrg(token);
    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }
    const existingUser = await this.usersService.findByEmail(invitation.email);
    return {
      email: invitation.email,
      invitedFullName: invitation.invitedFullName,
      organisationName: invitation.organisationName,
      role: invitation.role,
      expired: invitation.expiresAt < new Date(),
      accepted: !!invitation.acceptedAt,
      emailAlreadyRegistered: !!existingUser,
    };
  }

  async acceptForUser(token: string, userId: string) {
    const invitation = await this.findByTokenWithOrg(token);
    if (
      !invitation ||
      invitation.acceptedAt ||
      invitation.expiresAt < new Date()
    ) {
      throw new BadRequestException('Invitation is invalid or has expired');
    }
    const user = await this.usersService.findById(userId);
    if (!user || user.email.toLowerCase() !== invitation.email.toLowerCase()) {
      throw new BadRequestException(
        'This invitation was issued to a different email address',
      );
    }
    if (!invitation.organisationIsActive) {
      throw new BadRequestException('Organisation is not active');
    }

    // Drizzle infers `role` as a plain string-literal union, not the UserRole enum
    // setMembership expects — same reconciliation as tasks.service.ts's TaskFull cast.
    // eslint's type-aware checker disagrees with tsc on this one (claims the cast is
    // a no-op); tsc is authoritative and fails without it, so silencing the lint rule.

    await this.usersService.setMembership(
      userId,
      invitation.organisationId,
      invitation.role as UserRole,
    );

    await this.setTokenLookupFlag();
    await this.tenantDb.db
      .update(invitations)
      .set({ acceptedAt: new Date(), updatedAt: new Date() })
      .where(eq(invitations.id, invitation.id));

    return { organisationId: invitation.organisationId, role: invitation.role };
  }
}
