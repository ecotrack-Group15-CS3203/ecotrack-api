import { Injectable } from '@nestjs/common';
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
}
