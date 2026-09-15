import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { TenantDbService } from '../../database/tenant-db.service';

/**
 * A median over a handful of claims describes those few incidents, not the platform,
 * so below this many the median is withheld rather than shown.
 */
export const MIN_CLAIMS_FOR_MEDIAN = 5;

export interface PublicStats {
  organisations: number;
  incidentsResolved: number;
  medianClaimMinutes: number | null;
}

/** node-postgres returns bigint columns as strings and double precision as numbers. */
interface PublicPlatformStatsRow {
  [key: string]: unknown;
  organisations: string;
  incidents_resolved: string;
  claimed_count: string;
  median_claim_minutes: number | null;
}

export function toPublicStats(row: PublicPlatformStatsRow): PublicStats {
  const claimed = Number(row.claimed_count);
  const median = row.median_claim_minutes;
  return {
    organisations: Number(row.organisations),
    incidentsResolved: Number(row.incidents_resolved),
    medianClaimMinutes:
      claimed >= MIN_CLAIMS_FOR_MEDIAN && median !== null
        ? Math.round(median * 10) / 10
        : null,
  };
}

@Injectable()
export class PublicStatsService {
  constructor(private readonly tenantDb: TenantDbService) {}

  /**
   * Computed fresh on every call: the landing page asks once per page load, and a
   * reload is the refresh. Goes through the `public_platform_stats()` database
   * function rather than querying the tables here; migration 0031 explains why.
   */
  async get(): Promise<PublicStats> {
    const { rows } = await this.tenantDb.db.execute<PublicPlatformStatsRow>(
      sql`SELECT * FROM public_platform_stats()`,
    );
    return toPublicStats(rows[0]);
  }
}
