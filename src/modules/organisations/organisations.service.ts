import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { asc, eq, sql } from 'drizzle-orm';
import { DRIZZLE_DB } from '../../database/drizzle.provider';
import type { DrizzleDb } from '../../database/drizzle.provider';
import { organisations } from '../../database/schema';
import { toGeographyPoint } from '../../database/schema/columns.helpers';
import { TenantDbService } from '../../database/tenant-db.service';
import { UserRole } from '../../common/enums/user-role.enum';
import { AuditLogService } from '../audit/audit-log.service';
import { UsersService } from '../users/users.service';
import { WorkflowStageRulesService } from '../workflow/workflow-stage-rules.service';
import { WorkflowStagesService } from '../workflow/workflow-stages.service';
import { InvitationRow, InvitationsService } from './invitations.service';

export type OrganisationRow = typeof organisations.$inferSelect;

interface ServiceAreaInput {
  center: { lat: number; lng: number };
  radiusKm: number;
}

/**
 * A directory row. `distanceMeters`/`eligible` are null when the caller supplied no
 * point — the difference between "we didn't check" and "checked and it's out of
 * range", which the client needs in order to decide whether to show a Join button.
 */
export interface PublicOrganisationRow {
  [key: string]: unknown;
  id: string;
  name: string;
  description: string | null;
  contactEmail: string;
  serviceAreaRadiusKm: number | null;
  distanceMeters: number | null;
  eligible: boolean | null;
}

/**
 * Uses the pool-wide DRIZZLE_DB throughout, not the tenant-scoped connection:
 * `organisations` is deliberately not RLS-protected (SRS 3.1.19 — tenant-agnostic,
 * readable by any authenticated user for directory/search purposes).
 */
@Injectable()
export class OrganisationsService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDb,
    private readonly tenantDb: TenantDbService,
    private readonly workflowStagesService: WorkflowStagesService,
    private readonly workflowStageRulesService: WorkflowStageRulesService,
    private readonly auditLogService: AuditLogService,
    private readonly usersService: UsersService,
    private readonly invitationsService: InvitationsService,
  ) {}

  findAll(): Promise<OrganisationRow[]> {
    return this.db.query.organisations.findMany({
      orderBy: asc(organisations.name),
    });
  }

  /**
   * SRS 3.1.14's public directory — how a citizen finds an organisation to join.
   *
   * The geo filter tests **coverage, not proximity**: which organisations' service
   * areas reach the caller. That is deliberately the same predicate
   * JoinRequestsService re-checks and 422s on, so the directory can mark a row
   * ineligible up front rather than letting someone submit a request that is
   * guaranteed to bounce.
   *
   * `organisations` is intentionally not RLS-protected (see migration 0003), so this
   * runs on the pool-wide connection like every other method here.
   */
  async listPublic(
    filters: {
      q?: string;
      lat?: number;
      lng?: number;
      radius?: number;
    } = {},
  ): Promise<PublicOrganisationRow[]> {
    const { q, lat, lng, radius } = filters;

    if ((lat === undefined) !== (lng === undefined)) {
      throw new BadRequestException(
        'Provide both lat and lng, or neither, when filtering by location',
      );
    }

    const point =
      lat !== undefined && lng !== undefined
        ? toGeographyPoint(lat, lng)
        : null;

    // Interpolated as a whole SQL fragment rather than a bare parameter: with no
    // point supplied there is nothing to measure from, and the geo columns come back
    // null instead of the query failing.
    const distance = point
      ? sql`ST_Distance(o.service_area_center, ${point}::geography)`
      : sql`NULL::double precision`;
    const eligible = point
      ? sql`(
          o.service_area_center IS NOT NULL
          AND o.service_area_radius_km IS NOT NULL
          AND ST_DWithin(
            o.service_area_center,
            ${point}::geography,
            o.service_area_radius_km * 1000
          )
        )`
      : sql`NULL::boolean`;

    const conditions = [sql`o.is_active`];
    if (q?.trim()) {
      conditions.push(sql`o.name ILIKE ${'%' + q.trim() + '%'}`);
    }
    if (point && radius !== undefined) {
      conditions.push(
        sql`ST_DWithin(o.service_area_center, ${point}::geography, ${radius})`,
      );
    }

    const result = await this.db.execute<PublicOrganisationRow>(sql`
      SELECT
        o.id, o.name, o.description, o.contact_email AS "contactEmail",
        o.service_area_radius_km AS "serviceAreaRadiusKm",
        ${distance} AS "distanceMeters",
        ${eligible} AS "eligible"
      FROM organisations o
      WHERE ${sql.join(conditions, sql` AND `)}
      ORDER BY ${point ? sql`"distanceMeters" ASC NULLS LAST,` : sql``} o.name ASC
    `);
    return result.rows;
  }

  async findById(id: string): Promise<OrganisationRow> {
    const organisation = await this.db.query.organisations.findFirst({
      where: eq(organisations.id, id),
    });
    if (!organisation) {
      throw new NotFoundException('Organisation not found');
    }
    return organisation;
  }

  /**
   * Self-service registration (SRS 3.1.14): any authenticated user may register an
   * organisation, and by default becomes its `org_admin`. A platform admin may instead
   * nominate somebody else by passing `initialAdminEmail`, which either promotes that
   * account directly or leaves an invitation for them to redeem.
   */
  async create(
    data: {
      name: string;
      description?: string;
      contactEmail: string;
      initialAdminEmail?: string;
      serviceArea: ServiceAreaInput;
    },
    actingUser: { id: string; email: string; organisationId: string | null },
  ): Promise<{
    organisation: OrganisationRow;
    adminInvitation: InvitationRow | null;
    adminAlreadyExisted: boolean;
  }> {
    // One organisation per user (SRS 2, User Characteristics). Checked against the
    // caller's DB-resolved membership, which JwtStrategy re-reads every request.
    const nominatesSomeoneElse =
      !!data.initialAdminEmail &&
      data.initialAdminEmail.toLowerCase() !== actingUser.email.toLowerCase();
    if (actingUser.organisationId && !nominatesSomeoneElse) {
      throw new ConflictException(
        'You already belong to an organisation. Leave it before registering another.',
      );
    }

    const [organisation] = await this.db
      .insert(organisations)
      .values({
        name: data.name,
        description: data.description ?? null,
        contactEmail: data.contactEmail,
        serviceAreaCenter: data.serviceArea.center,
        serviceAreaRadiusKm: data.serviceArea.radiusKm,
      })
      .returning();

    // Everything below writes through the request's RLS-scoped connection, naming an
    // organisation the caller was not a member of when the request began. Without this
    // the workflow-stage and audit inserts fail their WITH CHECK. See
    // TenantDbService.setTenant.
    await this.tenantDb.setTenant(organisation.id);

    await this.workflowStagesService.seedDefaultStages(organisation.id);
    // Seeds the default rules row now rather than lazily on first read, so a freshly
    // registered org's workflow settings page has something to show immediately.
    await this.workflowStageRulesService.getRules(organisation.id);
    await this.auditLogService.record({
      organisationId: organisation.id,
      actingUserId: actingUser.id,
      action: 'organisation.created',
      entityType: 'organisation',
      entityId: organisation.id,
    });

    if (!nominatesSomeoneElse) {
      await this.usersService.setMembership(
        actingUser.id,
        organisation.id,
        UserRole.ORG_ADMIN,
      );
      return {
        organisation,
        adminInvitation: null,
        adminAlreadyExisted: true,
      };
    }

    const existingUser = await this.usersService.findByEmail(
      data.initialAdminEmail!,
    );
    let adminInvitation: InvitationRow | null = null;
    if (existingUser) {
      await this.usersService.setMembership(
        existingUser.id,
        organisation.id,
        UserRole.ORG_ADMIN,
      );
    } else {
      adminInvitation = await this.invitationsService.create({
        organisationId: organisation.id,
        email: data.initialAdminEmail!,
        role: UserRole.ORG_ADMIN,
        invitedByUserId: actingUser.id,
      });
    }

    return {
      organisation,
      adminInvitation,
      adminAlreadyExisted: !!existingUser,
    };
  }

  async updateProfile(
    id: string,
    data: {
      name?: string;
      description?: string;
      contactEmail?: string;
      serviceArea?: ServiceAreaInput;
    },
  ): Promise<OrganisationRow> {
    await this.findById(id);
    const [updated] = await this.db
      .update(organisations)
      .set({
        ...(data.name !== undefined && { name: data.name }),
        ...(data.description !== undefined && {
          description: data.description,
        }),
        ...(data.contactEmail !== undefined && {
          contactEmail: data.contactEmail,
        }),
        ...(data.serviceArea !== undefined && {
          serviceAreaCenter: data.serviceArea.center,
          serviceAreaRadiusKm: data.serviceArea.radiusKm,
        }),
        updatedAt: new Date(),
      })
      .where(eq(organisations.id, id))
      .returning();
    return updated;
  }

  async setActive(
    id: string,
    isActive: boolean,
    actingUserId: string,
  ): Promise<OrganisationRow> {
    await this.findById(id);
    const [updated] = await this.db
      .update(organisations)
      .set({ isActive, updatedAt: new Date() })
      .where(eq(organisations.id, id))
      .returning();
    await this.auditLogService.record({
      organisationId: id,
      actingUserId,
      action: isActive ? 'organisation.activated' : 'organisation.deactivated',
      entityType: 'organisation',
      entityId: id,
    });
    return updated;
  }

  async getPlatformStats() {
    const all = await this.db.query.organisations.findMany({
      columns: { isActive: true },
    });
    return {
      totalOrganisations: all.length,
      activeOrganisations: all.filter((o) => o.isActive).length,
    };
  }
}
