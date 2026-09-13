import { Inject, Injectable } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { DRIZZLE_POOL } from './drizzle.provider';
import type { DrizzleDb } from './drizzle.provider';
import * as schema from './schema';

/**
 * A database transaction for work the system initiates outside any HTTP request —
 * the notification dispatch cron. Such code has no CLS context (so
 * TenantDbService.db throws) and no user to derive RLS session variables from, and
 * on a bare pool connection every policy clause evaluates to NULL.
 *
 * Structurally identical to TenantInterceptor.runInTenantTransaction, but acts as
 * the system: `app.is_platform_admin` is the one flag every RLS policy honours, so
 * it is what lets a job write, for example, a notification for any user in any
 * tenant. Set transaction-locally, for the same pooled-connection reason the
 * interceptor gives.
 *
 * Only for jobs the system itself starts. A request handler reaching for this would
 * be bypassing tenant isolation rather than working within it.
 */
@Injectable()
export class SystemDbService {
  constructor(@Inject(DRIZZLE_POOL) private readonly pool: Pool) {}

  async runAsSystem<T>(fn: (db: DrizzleDb) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `SELECT set_config('app.is_platform_admin', 'true', true)`,
      );
      const result = await fn(drizzle(client, { schema }));
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
