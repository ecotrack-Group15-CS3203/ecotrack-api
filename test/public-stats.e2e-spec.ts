import 'dotenv/config';
import { Client, Pool } from 'pg';

/**
 * public_platform_stats() (migration 0031) deliberately sees across every tenant, so
 * these tests pin down the two things that make that safe:
 *  - it counts what it should across tenants, and nothing else;
 *  - its platform-admin visibility ends when the call returns, so the rest of the
 *    request's transaction is still tenant-scoped.
 *
 * Like rls.e2e-spec.ts, assertions run as `ecotrack_app` (NOBYPASSRLS). Run as the
 * migrator, a superuser locally, the cross-tenant counts would pass for the wrong
 * reason. Totals are compared as deltas around the fixtures, because the database
 * may already hold dev or seed data.
 */

const migratorConfig = {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 5432),
  user: process.env.DB_MIGRATOR_USER ?? process.env.DB_USER,
  password: process.env.DB_MIGRATOR_PASSWORD ?? process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
};

const appConfig = {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 5432),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
};

const COLOMBO = 'SRID=4326;POINT(79.8612 6.9271)';

interface StatsRow {
  organisations: string;
  incidents_resolved: string;
  claimed_count: string;
  median_claim_minutes: number | null;
}

let migrator: Pool;
const created = {
  orgs: [] as string[],
  users: [] as string[],
  incidents: [] as { id: string; orgId: string }[],
};
let baseline: StatsRow;

/** A session exactly like an unauthenticated request's: every RLS variable empty. */
async function asAnonymous<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client(appConfig);
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.current_tenant', '', true),
              set_config('app.current_user_id', '', true),
              set_config('app.is_org_admin', 'false', true),
              set_config('app.is_platform_admin', 'false', true)`,
    );
    return await run(client);
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    await client.end();
  }
}

/** Fixture writes as a tenant session, so seeding works where the migrator isn't a superuser (RDS). */
async function seedAsTenant(organisationId: string): Promise<void> {
  await migrator.query(
    `SELECT set_config('app.current_tenant', $1, false),
            set_config('app.is_org_admin', 'true', false),
            set_config('app.current_user_id', '', false),
            set_config('app.is_platform_admin', 'false', false)`,
    [organisationId],
  );
}

const readStats = () =>
  asAnonymous(
    async (c) =>
      (await c.query<StatsRow>('SELECT * FROM public_platform_stats()'))
        .rows[0],
  );

beforeAll(async () => {
  migrator = new Pool({ ...migratorConfig, max: 1 });
  baseline = await readStats();

  const org = async (name: string, isActive: boolean) => {
    const id = (
      await migrator.query<{ id: string }>(
        `INSERT INTO organisations (name, slug, contact_email, service_area_center, service_area_radius_km, is_active)
         VALUES ($1, $1, $2, $3, 25, $4) RETURNING id`,
        [name, `${name}@stats.test`, COLOMBO, isActive],
      )
    ).rows[0].id;
    created.orgs.push(id);
    return id;
  };

  const user = async (sub: string, orgId: string | null, role: string) => {
    const id = (
      await migrator.query<{ id: string }>(
        `INSERT INTO users (auth_subject, email, full_name, role, organisation_id)
         VALUES ($1, $2, $1, $3, $4) RETURNING id`,
        [sub, `${sub}@stats.test`, role, orgId],
      )
    ).rows[0].id;
    created.users.push(id);
    return id;
  };

  const stage = async (
    orgId: string,
    slug: string,
    position: number,
    isFinal: boolean,
  ) => {
    await seedAsTenant(orgId);
    return (
      await migrator.query<{ id: string }>(
        `INSERT INTO workflow_stages (organisation_id, name, slug, color, position, is_final)
         VALUES ($1, $2, $2, '#22C55E', $3, $4) RETURNING id`,
        [orgId, slug, position, isFinal],
      )
    ).rows[0].id;
  };

  const incident = async (
    orgId: string,
    reporter: string,
    admin: string,
    stageId: string,
    verification: 'approved' | 'rejected',
  ) => {
    await seedAsTenant(orgId);
    const id = (
      await migrator.query<{ id: string }>(
        `INSERT INTO incidents (organisation_id, reported_by_user_id, title, description, category, severity,
                                location, current_stage_id, verification_status, claimed_by_user_id, claimed_at)
         VALUES ($1, $2, 'stats fixture', 'stats fixture', 'other', 'low', $3, $4, $5, $6, now())
         RETURNING id`,
        [orgId, reporter, COLOMBO, stageId, verification, admin],
      )
    ).rows[0].id;
    created.incidents.push({ id, orgId });
    return id;
  };

  const orgA = await org('stats-org-a', true);
  const orgB = await org('stats-org-b', true);
  await org('stats-org-inactive', false);
  const adminA = await user('stats-admin-a', orgA, 'org_admin');
  const adminB = await user('stats-admin-b', orgB, 'org_admin');
  const reporter = await user('stats-reporter', null, 'citizen');

  const resolvedA = await stage(orgA, 'resolved', 1, true);
  const resolvedB = await stage(orgB, 'resolved', 1, true);
  const dismissedB = await stage(orgB, 'dismissed', 2, true);

  await incident(orgA, reporter, adminA, resolvedA, 'approved');
  await incident(orgB, reporter, adminB, resolvedB, 'approved');
  await incident(orgB, reporter, adminB, dismissedB, 'rejected');
});

afterAll(async () => {
  for (const { id, orgId } of created.incidents) {
    await seedAsTenant(orgId);
    await migrator.query('DELETE FROM incidents WHERE id = $1', [id]);
  }
  // Workflow stages cascade from the organisation.
  await migrator.query('DELETE FROM organisations WHERE id = ANY($1)', [
    created.orgs,
  ]);
  await migrator.query('DELETE FROM users WHERE id = ANY($1)', [created.users]);
  await migrator?.end();
});

describe('public_platform_stats()', () => {
  it('counts across tenants for an anonymous session', async () => {
    const after = await readStats();
    const delta = (key: keyof StatsRow) =>
      Number(after[key]) - Number(baseline[key]);

    // Two active organisations; the inactive one is not counted.
    expect(delta('organisations')).toBe(2);
    // One resolved incident in each tenant; the dismissed one is not a cleanup.
    expect(delta('incidents_resolved')).toBe(2);
    expect(delta('claimed_count')).toBe(3);
  });

  it('returns only aggregate columns', async () => {
    const row = await readStats();
    expect(Object.keys(row).sort()).toEqual([
      'claimed_count',
      'incidents_resolved',
      'median_claim_minutes',
      'organisations',
    ]);
  });

  it('does not leak its platform-admin visibility into the rest of the transaction', async () => {
    const fixtureIds = created.incidents.map((i) => i.id);
    const result = await asAnonymous(async (c) => {
      await c.query('SELECT * FROM public_platform_stats()');
      const setting = (
        await c.query<{ value: string }>(
          `SELECT current_setting('app.is_platform_admin', true) AS value`,
        )
      ).rows[0].value;
      const visible = (
        await c.query<{ id: string }>(
          'SELECT id FROM incidents WHERE id = ANY($1)',
          [fixtureIds],
        )
      ).rows;
      return { setting, visible };
    });

    expect(result.setting).toBe('false');
    expect(result.visible).toHaveLength(0);
  });
});
