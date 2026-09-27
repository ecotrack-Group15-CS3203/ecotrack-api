import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { Pool } from 'pg';
import {
  DRIZZLE_POOL,
  drizzleDbProvider,
  drizzlePoolProvider,
} from './drizzle.provider';
import { SystemDbService } from './system-db.service';
import { TenantDbService } from './tenant-db.service';

@Global()
@Module({
  providers: [
    drizzlePoolProvider,
    drizzleDbProvider,
    TenantDbService,
    SystemDbService,
  ],
  exports: [
    drizzlePoolProvider,
    drizzleDbProvider,
    TenantDbService,
    SystemDbService,
  ],
})
export class DrizzleModule implements OnApplicationShutdown {
  constructor(@Inject(DRIZZLE_POOL) private readonly pool: Pool) {}

  /**
   * Drains the pool on app.close() / SIGTERM. Without it, idle connections outlive
   * the app — a redeploy leaves them for RDS to time out, and every e2e suite keeps
   * Jest alive after its last test.
   */
  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
