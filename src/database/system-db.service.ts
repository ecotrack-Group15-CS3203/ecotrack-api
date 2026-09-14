import { Inject, Injectable } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { DRIZZLE_POOL } from './drizzle.provider';
import type { DrizzleDb } from './drizzle.provider';
import * as schema from './schema';

/**
 * A database transaction for work the system initiates outside any HTTP request —
 * the notification dispatch cron. Such code has no CLS context (so
 * TenantDbService.db throws) and no user to derive RLS session variables from.
 *
 * Structurally identical to TenantInterceptor.runInTenantTransaction, and
 * deliberately sets ALL FOUR of the same session variables that interceptor sets on
 * every request — not just `app.is_platform_admin` — even though only that one is
 * "true" here. This matters more than it looks: these are custom Postgres GUCs, and
 * a connection borrowed from the same pool a moment ago by a real HTTP request may
 * have left `app.is_org_admin` (or the others) referenced-but-now-reverted on this
 * exact physical connection. Once a custom GUC name has been touched at all in a
 * session, current_setting(name, true) returns '' after the transaction that set it
 * commits — NOT NULL, an empty string — and `''::boolean` is a hard runtime error,
 * not a falsy value. Explicitly (re)setting all four here, every time, closes that
 * off entirely rather than relying on every RLS policy that references one of them
 * to separately guard against a stale value it was never written expecting.
 * (Found live: `incidents`/`incident_images`'s policies cast `app.is_org_admin`
 * directly, with no NULLIF-style guard, and 500'd exactly this way.)
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
      await client.query(`SELECT
        set_config('app.is_platform_admin', 'true', true),
        set_config('app.is_org_admin', 'false', true),
        set_config('app.current_tenant', '', true),
        set_config('app.current_user_id', '', true)`);
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
