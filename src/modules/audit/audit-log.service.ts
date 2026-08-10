import { Injectable } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { auditLogs } from '../../database/schema';
import { TenantDbService } from '../../database/tenant-db.service';

export type AuditLogRow = typeof auditLogs.$inferSelect;

@Injectable()
export class AuditLogService {
  constructor(private readonly tenantDb: TenantDbService) {}

  async record(data: {
    organisationId?: string | null;
    actingUserId?: string | null;
    action: string;
    entityType: string;
    entityId?: string | null;
    metadata?: Record<string, unknown> | null;
  }): Promise<AuditLogRow> {
    const [entry] = await this.tenantDb.db
      .insert(auditLogs)
      .values({
        organisationId: data.organisationId ?? null,
        actingUserId: data.actingUserId ?? null,
        action: data.action,
        entityType: data.entityType,
        entityId: data.entityId ?? null,
        metadata: data.metadata ?? null,
      })
      .returning();
    return entry;
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
