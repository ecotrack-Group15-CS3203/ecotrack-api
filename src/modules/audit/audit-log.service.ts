import { Injectable } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { auditLogs } from '../../database/schema';
import { TenantDbService } from '../../database/tenant-db.service';

export type AuditLogRow = typeof auditLogs.$inferSelect;

@Injectable()
export class AuditLogService {
  constructor(private readonly tenantDb: TenantDbService) {}

  /**
   * Deliberately does NOT use `.returning()`.
   *
   * Postgres requires an inserted row to also satisfy the policy's `USING` (read)
   * clause before it will hand it back via RETURNING. This table's `USING` clause has
   * no `organisation_id IS NULL` branch — platform-level audit rows are meant to be
   * readable only by platform admins — so a null-org entry (every action on a pooled,
   * unclaimed incident: `incident.reported` above all) can legitimately be *written*
   * but not *read back* by an ordinary session. With RETURNING that surfaced as
   * `new row violates row-level security policy`, failing the whole request.
   *
   * Nothing consumes the inserted row, so the fix is to stop asking for it rather than
   * to widen the read policy — which would expose every tenant's platform-level audit
   * entries to every other tenant.
   */
  async record(data: {
    organisationId?: string | null;
    actingUserId?: string | null;
    action: string;
    entityType: string;
    entityId?: string | null;
    metadata?: Record<string, unknown> | null;
  }): Promise<void> {
    await this.tenantDb.db.insert(auditLogs).values({
      organisationId: data.organisationId ?? null,
      actingUserId: data.actingUserId ?? null,
      action: data.action,
      entityType: data.entityType,
      entityId: data.entityId ?? null,
      metadata: data.metadata ?? null,
    });
  }

  listForOrg(organisationId: string): Promise<AuditLogRow[]> {
    return this.tenantDb.db.query.auditLogs.findMany({
      where: eq(auditLogs.organisationId, organisationId),
      orderBy: desc(auditLogs.createdAt),
      limit: 200,
    });
  }

  listPlatformWide(): Promise<AuditLogRow[]> {
    return this.tenantDb.db.query.auditLogs.findMany({
      orderBy: desc(auditLogs.createdAt),
      limit: 200,
    });
  }
}
