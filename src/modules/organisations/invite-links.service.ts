import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { UserRole } from '../../common/enums/user-role.enum';
import { inviteLinks, organisations } from '../../database/schema';
import { toGeographyPoint } from '../../database/schema/columns.helpers';
import { TenantDbService } from '../../database/tenant-db.service';
import { AuditLogService } from '../audit/audit-log.service';
import { UsersService } from '../users/users.service';

export type InviteLinkRow = typeof inviteLinks.$inferSelect;

const DEFAULT_EXPIRES_IN_DAYS = 7;
/** SRS 3.4.7's minimum — 16 bytes of crypto.randomBytes() is 128 bits. */
const TOKEN_BYTES = 16;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Mirrors InvitationsService's token-lookup pattern (see that file's doc comment
 * and migration 0011_invite_links_rls.sql): the secret token is the authorization
 * for the one cross-tenant read/write this needs, not org membership, so the
 * lookup/redeem paths explicitly set `app.invitation_token_lookup` rather than
 * bypassing RLS some other way.
 */
@Injectable()
export class InviteLinksService {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly auditLogService: AuditLogService,
    private readonly usersService: UsersService,
  ) {}

  private async setTokenLookupFlag(): Promise<void> {
    await this.tenantDb.db.execute(
      sql`SELECT set_config('app.invitation_token_lookup', 'true', true)`,
    );
  }

  /** Plaintext token is generated here and returned exactly once — only its hash
   * is ever persisted, per SRS 3.4.7. */
  async generate(
    organisationId: string,
    data: { maxUses?: number; expiresInDays?: number },
    actingUserId: string,
  ): Promise<{ inviteLink: InviteLinkRow; token: string }> {
    const token = randomBytes(TOKEN_BYTES).toString('base64url');
    const expiresAt = new Date();
    expiresAt.setDate(
      expiresAt.getDate() + (data.expiresInDays ?? DEFAULT_EXPIRES_IN_DAYS),
    );

    const [inviteLink] = await this.tenantDb.db
      .insert(inviteLinks)
      .values({
        organisationId,
        tokenHash: hashToken(token),
        maxUses: data.maxUses ?? null,
        expiresAt,
        createdByUserId: actingUserId,
      })
      .returning();

    await this.auditLogService.record({
      organisationId,
      actingUserId,
      action: 'invite_link.created',
      entityType: 'invite_link',
      entityId: inviteLink.id,
      metadata: { maxUses: data.maxUses ?? null, expiresAt },
    });

    return { inviteLink, token };
  }

  listForOrganisation(organisationId: string): Promise<InviteLinkRow[]> {
    return this.tenantDb.db.query.inviteLinks.findMany({
      where: eq(inviteLinks.organisationId, organisationId),
      orderBy: desc(inviteLinks.createdAt),
    });
  }

  async revoke(
    organisationId: string,
    inviteLinkId: string,
    actingUserId: string,
  ): Promise<InviteLinkRow> {
    const existing = await this.tenantDb.db.query.inviteLinks.findFirst({
      where: and(
        eq(inviteLinks.id, inviteLinkId),
        eq(inviteLinks.organisationId, organisationId),
      ),
    });
    if (!existing) {
      throw new NotFoundException('Invite link not found');
    }
    const [updated] = await this.tenantDb.db
      .update(inviteLinks)
      .set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(eq(inviteLinks.id, inviteLinkId))
      .returning();

    await this.auditLogService.record({
      organisationId,
      actingUserId,
      action: 'invite_link.revoked',
      entityType: 'invite_link',
      entityId: inviteLinkId,
    });

    return updated;
  }

  /** Public lookup for the accept screen — org name and validity only, nothing
   * that would help enumerate or guess a link. */
  async getPublicInfo(token: string): Promise<{
    organisationName: string;
    expired: boolean;
    revoked: boolean;
    exhausted: boolean;
  }> {
    const found = await this.findByTokenWithOrg(token);
    if (!found) {
      throw new NotFoundException('Invite link not found');
    }
    return {
      organisationName: found.organisationName,
      expired: found.expiresAt < new Date(),
      revoked: !!found.revokedAt,
      exhausted:
        found.maxUses !== null ? found.usesCount >= found.maxUses : false,
    };
  }

  private async findByTokenWithOrg(token: string): Promise<
    | (InviteLinkRow & {
        organisationName: string;
        serviceAreaCenter: { lat: number; lng: number } | null;
        serviceAreaRadiusKm: number | null;
      })
    | undefined
  > {
    await this.setTokenLookupFlag();
    const [row] = await this.tenantDb.db
      .select({
        inviteLink: inviteLinks,
        organisationName: organisations.name,
        serviceAreaCenter: organisations.serviceAreaCenter,
        serviceAreaRadiusKm: organisations.serviceAreaRadiusKm,
      })
      .from(inviteLinks)
      .innerJoin(
        organisations,
        eq(inviteLinks.organisationId, organisations.id),
      )
      .where(eq(inviteLinks.tokenHash, hashToken(token)))
      .limit(1);
    if (!row) return undefined;
    return {
      ...row.inviteLink,
      organisationName: row.organisationName,
      serviceAreaCenter: row.serviceAreaCenter,
      serviceAreaRadiusKm: row.serviceAreaRadiusKm,
    };
  }

  /**
   * SRS 3.1.12's full redemption sequence. The pre-checks below (expiry, revocation,
   * membership) exist to produce a specific, helpful error — the atomic conditional
   * UPDATE further down is what actually prevents two concurrent redemptions from
   * both succeeding past a maxUses limit, the same pattern IncidentPoolService.claim()
   * uses for claim exclusivity.
   */
  async accept(
    token: string,
    userId: string,
    location: { lat: number; lng: number },
  ): Promise<{ organisationId: string; role: UserRole }> {
    const found = await this.findByTokenWithOrg(token);
    if (!found) {
      throw new NotFoundException('Invite link not found');
    }
    if (found.revokedAt) {
      throw new BadRequestException('This invite link has been revoked.');
    }
    if (found.expiresAt < new Date()) {
      throw new BadRequestException('This invite link has expired.');
    }
    if (found.maxUses !== null && found.usesCount >= found.maxUses) {
      throw new BadRequestException(
        'This invite link has reached its usage limit.',
      );
    }
    if (!found.serviceAreaCenter || !found.serviceAreaRadiusKm) {
      throw new BadRequestException(
        "This organisation's service area is not configured.",
      );
    }

    const centerEwkt = toGeographyPoint(
      found.serviceAreaCenter.lat,
      found.serviceAreaCenter.lng,
    );
    const [{ within }] = (
      await this.tenantDb.db.execute<{
        [key: string]: unknown;
        within: boolean;
      }>(sql`
        SELECT ST_DWithin(
          ST_MakePoint(${location.lng}, ${location.lat})::geography,
          ${centerEwkt}::geography,
          ${found.serviceAreaRadiusKm * 1000}
        ) AS within
      `)
    ).rows;
    if (!within) {
      throw new UnprocessableEntityException(
        `You are outside ${found.organisationName}'s service area.`,
      );
    }

    const user = await this.usersService.findById(userId);
    if (user?.organisationId) {
      throw new ConflictException('Already a member of another organisation.');
    }

    // The atomic gate: a link at its usage limit already, or one that hits the
    // limit in the race between the pre-check above and this UPDATE, matches zero
    // rows either way — the loser gets the same "reached its usage limit" outcome
    // as the pre-check, just via the WHERE clause instead.
    const claimed = await this.tenantDb.db
      .update(inviteLinks)
      .set({
        usesCount: sql`${inviteLinks.usesCount} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(inviteLinks.id, found.id),
          found.maxUses !== null
            ? sql`${inviteLinks.usesCount} < ${found.maxUses}`
            : sql`true`,
        ),
      )
      .returning();
    if (claimed.length === 0) {
      throw new BadRequestException(
        'This invite link has reached its usage limit.',
      );
    }

    await this.auditLogService.record({
      organisationId: found.organisationId,
      actingUserId: userId,
      action: 'invite_link.redeemed',
      entityType: 'invite_link',
      entityId: found.id,
    });

    // Last, deliberately: this writes through UsersService's pool-wide connection
    // (users isn't RLS-protected — see users.service.ts), a separate, immediately-
    // committing connection from the tenant-scoped transaction everything above ran
    // on. Ordering it last means a failure here rolls back the uses_count increment
    // and audit row together (the whole request throws, TenantInterceptor rolls
    // back its transaction) rather than leaving a membership grant committed with
    // no corresponding recorded use — found live: the reverse order let exactly
    // that happen when the audit write 500'd on a since-fixed RLS gap.
    await this.usersService.setMembership(
      userId,
      found.organisationId,
      UserRole.VOLUNTEER,
      location,
    );

    return { organisationId: found.organisationId, role: UserRole.VOLUNTEER };
  }
}
