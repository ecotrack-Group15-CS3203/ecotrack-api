import { TenantDbService } from '../../database/tenant-db.service';
import {
  MIN_CLAIMS_FOR_MEDIAN,
  PublicStatsService,
  toPublicStats,
} from './public-stats.service';

const row = (overrides: Partial<Record<string, unknown>> = {}) => ({
  organisations: '12',
  incidents_resolved: '340',
  claimed_count: String(MIN_CLAIMS_FOR_MEDIAN),
  median_claim_minutes: 9.2345,
  ...overrides,
});

describe('toPublicStats', () => {
  it('turns the bigint strings node-postgres returns into numbers', () => {
    expect(toPublicStats(row())).toEqual({
      organisations: 12,
      incidentsResolved: 340,
      medianClaimMinutes: 9.2,
    });
  });

  it('withholds the median below the minimum number of claims', () => {
    expect(
      toPublicStats(row({ claimed_count: String(MIN_CLAIMS_FOR_MEDIAN - 1) }))
        .medianClaimMinutes,
    ).toBeNull();
  });

  it('reports a null median when nothing has been claimed', () => {
    expect(
      toPublicStats(row({ claimed_count: '0', median_claim_minutes: null })),
    ).toEqual({
      organisations: 12,
      incidentsResolved: 340,
      medianClaimMinutes: null,
    });
  });

  it('returns only the three aggregate fields', () => {
    expect(Object.keys(toPublicStats(row())).sort()).toEqual([
      'incidentsResolved',
      'medianClaimMinutes',
      'organisations',
    ]);
  });
});

describe('PublicStatsService.get', () => {
  it('reads the single row from public_platform_stats()', async () => {
    const execute = jest.fn().mockResolvedValue({ rows: [row()] });
    const service = new PublicStatsService({
      db: { execute },
    } as unknown as TenantDbService);

    await expect(service.get()).resolves.toEqual({
      organisations: 12,
      incidentsResolved: 340,
      medianClaimMinutes: 9.2,
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
