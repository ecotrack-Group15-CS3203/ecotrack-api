import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { DRIZZLE_DB } from '../../database/drizzle.provider';
import type { DrizzleDb } from '../../database/drizzle.provider';
import { organisations } from '../../database/schema';
import { toGeographyPoint } from '../../database/schema/columns.helpers';
import { TenantDbService } from '../../database/tenant-db.service';
import { UserRole } from '../../common/enums/user-role.enum';
import { AuditLogService } from '../audit/audit-log.service';
import { UsersService } from '../users/users.service';
import { WorkflowStagesService } from '../workflow/workflow-stages.service';
import { InvitationRow, InvitationsService } from './invitations.service';

export type OrganisationRow = typeof organisations.$inferSelect;

interface ServiceAreaInput {
  center: { lat: number; lng: number };
  radiusKm: number;
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
    private readonly auditLogService: AuditLogService,
    private readonly usersService: UsersService,
    private readonly invitationsService: InvitationsService,
  ) {}

  findAll(): Promise<OrganisationRow[]> {
    return this.db.query.organisations.findMany({
      orderBy: asc(organisations.name),
    });
  }

  async listPublic(): Promise<{ id: string; name: string }[]> {
    const rows = await this.db.query.organisations.findMany({
      where: eq(organisations.isActive, true),
      orderBy: asc(organisations.name),
      columns: { id: true, name: true },
    });
    return rows;
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
        serviceAreaCenter: toGeographyPoint(
          data.serviceArea.center.lat,
          data.serviceArea.center.lng,
        ),
        serviceAreaRadiusKm: data.serviceArea.radiusKm,
      })
      .returning();

    // Everything below writes through the request's RLS-scoped connection, naming an
    // organisation the caller was not a member of when the request began. Without this
    // the workflow-stage and audit inserts fail their WITH CHECK. See
    // TenantDbService.setTenant.
    await this.tenantDb.setTenant(organisation.id);

    await this.workflowStagesService.seedDefaultStages(organisation.id);
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
          serviceAreaCenter: toGeographyPoint(
            data.serviceArea.center.lat,
            data.serviceArea.center.lng,
          ),
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
