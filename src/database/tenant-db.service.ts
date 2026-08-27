import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';
import { CLS_TENANT_DB } from './tenant-db.constants';
import { DrizzleDb } from './drizzle.provider';

/**
 * Gives services the request-scoped, RLS-activated Drizzle instance that
 * TenantInterceptor opens for every request (see
 * common/interceptors/tenant.interceptor.ts). Every tenant-scoped query in a service
 * should go through `this.tenantDb.db`, never the pool-wide DRIZZLE_DB — that
 * instance's connections never have the RLS session variables set, so RLS-protected
 * tables would (correctly, but unhelpfully) return zero rows through it.
 */
@Injectable()
export class TenantDbService {
  constructor(private readonly cls: ClsService) {}

  get db(): DrizzleDb {
    const db = this.cls.get<DrizzleDb>(CLS_TENANT_DB);
    if (!db) {
      throw new Error(
        'No tenant-scoped database session on this request — is TenantInterceptor registered as an APP_INTERCEPTOR?',
      );
    }
    return db;
  }

  /**
   * Re-points the RLS session variables at `organisationId` for the remainder of this
   * request's transaction.
   *
   * Needed exactly once, by self-service organisation registration: TenantInterceptor
   * sets `app.current_tenant` from the caller's *existing* org, which for a citizen
   * creating their first organisation is empty. Anything written afterwards through
   * this same connection into an RLS-protected table naming the brand-new org — the
   * default workflow stages, the audit row — fails its `WITH CHECK` because
   * `NULLIF('', '')::uuid` is NULL and matches nothing. Re-pointing the variable makes
   * the rest of the request behave as a member of the org that was just created.
   *
   * Uses `set_config(..., true)` (transaction-scoped) for the same reason
   * TenantInterceptor does: connections are pooled, and a plain SET would leak this
   * tenant into whichever request borrows the connection next. It reverts at
   * COMMIT/ROLLBACK, so the effect never outlives the request that asked for it.
   *
   * Do not reach for this anywhere else. Any *other* caller wanting to change tenant
   * mid-request is almost certainly working around a missing authorization check
   * rather than fixing one.
   */
  async setTenant(organisationId: string): Promise<void> {
    await this.db.execute(
      sql`SELECT set_config('app.current_tenant', ${organisationId}, true),
                 set_config('app.is_org_admin', 'true', true)`,
    );
  }
}
