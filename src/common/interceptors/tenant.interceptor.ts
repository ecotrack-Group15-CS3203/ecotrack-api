import {
  CallHandler,
  ExecutionContext,
  Inject,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { drizzle } from 'drizzle-orm/node-postgres';
import { ClsService } from 'nestjs-cls';
import { Pool } from 'pg';
import { firstValueFrom, from, Observable } from 'rxjs';
import * as schema from '../../database/schema';
import { DRIZZLE_POOL } from '../../database/drizzle.provider';
import { CLS_TENANT_DB } from '../../database/tenant-db.constants';
import { UserRole } from '../enums/user-role.enum';
import { AuthenticatedRequest } from '../interfaces/authenticated-request.interface';

/**
 * Opens one Postgres transaction per HTTP request, sets the RLS session variables
 * that the policies in migration 0003_app_role_and_rls.sql read
 * (`app.current_tenant`, `app.current_user_id`, `app.is_org_admin`,
 * `app.is_platform_admin`), and makes a Drizzle instance bound to that exact
 * connection available to services via TenantDbService/ClsService for the rest of
 * the request. Commits on success, rolls back on any thrown error, always releases
 * the connection back to the pool.
 *
 * Uses `SET LOCAL` via `set_config(..., true)` (transaction-scoped, reverts at
 * COMMIT/ROLLBACK) rather than a plain `SET`, specifically because connections are
 * pooled — a plain SET would leak into whichever request reuses this connection next.
 *
 * Registered as an APP_INTERCEPTOR in app.module.ts, which runs after all guards
 * (so `request.user` is already populated by JwtAuthGuard/JwtStrategy) but before the
 * route handler. Runs on every request, authenticated or not — for @Public() routes
 * with no `request.user`, the session variables are set to '' and the RLS policies
 * correctly resolve to "no rows visible" for any RLS-protected table (public routes
 * only ever touch the tenant-agnostic `organisations`/`users` tables in practice).
 */
@Injectable()
export class TenantInterceptor implements NestInterceptor {
  constructor(
    @Inject(DRIZZLE_POOL) private readonly pool: Pool,
    private readonly cls: ClsService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    return from(this.runInTenantTransaction(request, next));
  }

  private async runInTenantTransaction(
    request: AuthenticatedRequest,
    next: CallHandler,
  ): Promise<unknown> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const isOrgAdmin = request.user?.role === UserRole.ORG_ADMIN;
      await client.query(`SELECT set_config('app.current_tenant', $1, true)`, [
        request.user?.organisationId ?? '',
      ]);
      await client.query(`SELECT set_config('app.current_user_id', $1, true)`, [
        request.user?.id ?? '',
      ]);
      await client.query(`SELECT set_config('app.is_org_admin', $1, true)`, [
        String(isOrgAdmin),
      ]);
      await client.query(
        `SELECT set_config('app.is_platform_admin', $1, true)`,
        [String(request.user?.isPlatformAdmin ?? false)],
      );

      this.cls.set(CLS_TENANT_DB, drizzle(client, { schema }));

      const result: unknown = await firstValueFrom(next.handle(), {
        defaultValue: undefined,
      });
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }
}
