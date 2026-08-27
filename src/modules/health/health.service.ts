import { Inject, Injectable, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { DRIZZLE_POOL } from '../../database/drizzle.provider';

export interface HealthReport {
  status: 'ok' | 'degraded';
  uptimeSeconds: number;
  timestamp: string;
  checks: { database: 'up' | 'down' };
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(@Inject(DRIZZLE_POOL) private readonly pool: Pool) {}

  /**
   * Deliberately uses the raw pool rather than TenantDbService: the health check runs
   * unauthenticated, so there is no tenant context to bind, and RLS is irrelevant to
   * `SELECT 1`. Checking real connectivity (not just "the process is alive") is the
   * point — the CI deploy gate and the uptime monitor both key off this endpoint, and
   * an API that cannot reach its database is not healthy however well Node is running.
   */
  async check(): Promise<HealthReport> {
    let database: 'up' | 'down' = 'up';
    try {
      await this.pool.query('SELECT 1');
    } catch (err) {
      database = 'down';
      this.logger.error('Health check: database unreachable', err as Error);
    }

    return {
      status: database === 'up' ? 'ok' : 'degraded',
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      checks: { database },
    };
  }
}
