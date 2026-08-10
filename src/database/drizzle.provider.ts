import { ConfigService } from '@nestjs/config';
import { Provider } from '@nestjs/common';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export const DRIZZLE_POOL = 'DRIZZLE_POOL';
export const DRIZZLE_DB = 'DRIZZLE_DB';

export type DrizzleDb = NodePgDatabase<typeof schema>;

/**
 * The shared connection pool and a pool-wide (non-tenant-scoped) Drizzle instance.
 * Use DRIZZLE_DB only for genuinely tenant-free queries (e.g. the public organisation
 * directory). Every tenant-scoped query in a request handler should instead go
 * through the request-scoped, RLS-activated instance the TenantInterceptor provides
 * via nestjs-cls (see common/interceptors/tenant.interceptor.ts, Milestone 2.5) —
 * DRIZZLE_DB's connections are never subject to RLS session variables.
 */
export const drizzlePoolProvider: Provider = {
  provide: DRIZZLE_POOL,
  useFactory: (config: ConfigService) =>
    new Pool({
      host: config.get<string>('DB_HOST'),
      port: config.get<number>('DB_PORT'),
      user: config.get<string>('DB_USER'),
      password: config.get<string>('DB_PASSWORD'),
      database: config.get<string>('DB_NAME'),
    }),
  inject: [ConfigService],
};

export const drizzleDbProvider: Provider = {
  provide: DRIZZLE_DB,
  useFactory: (pool: Pool) => drizzle(pool, { schema }),
  inject: [DRIZZLE_POOL],
};
