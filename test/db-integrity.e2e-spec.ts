import { readFileSync } from 'fs';
import { join } from 'path';
import { Client } from 'pg';
import { boundingBox } from '../src/database/spatial';
import { Fixtures, FixtureUser, migratorConfig } from './support/fixtures';

/**
 * Database integrity (SRS 3.4.4, 3.5.4, 3.10; SAD §9).
 *
 * rls.e2e-spec.ts proves the RLS policies *behave* correctly on the tables it
 * exercises. This suite checks the structure around them: that every table is
 * actually covered, that the runtime role cannot sidestep coverage, that the
 * schema's own constraints reject bad data, and that the geospatial query the
 * performance requirement (SRS 3.4.1) depends on is served by its GiST index.
 *
 * Talks to Postgres directly — no Nest app — since what is under test is the
 * database, not a service.
 */

/**
 * Tables that deliberately carry no RLS policy, and why. Adding a table to the
 * schema without either an RLS policy or an entry here fails this suite — which is
 * the point: a new tenant table must not silently ship unprotected.
 */
const RLS_EXEMPT: Record<string, string> = {
  organisations:
    'Tenant registry itself; public directory reads (SRS 3.1.19, SAD §9.2).',
  users:
    'Tenant-agnostic identity table; scoped in the service layer (SAD §9.2).',
  notification_dispatches:
    'Outbox with no tenant content, read only by the tenantless cron (migration 0025).',
  spatial_ref_sys: 'PostGIS system catalogue.',
};

const APP_ROLE = process.env.DB_USER ?? 'ecotrack_app';

/** Resolves to the Postgres SQLSTATE a statement failed with. */
async function sqlState(run: Promise<unknown>): Promise<string> {
  try {
    await run;
  } catch (err) {
    return (err as { code: string }).code;
  }
  throw new Error('Expected the statement to be rejected, but it succeeded');
}

describe('Database integrity (e2e)', () => {
  let fx: Fixtures;
  let reporter: FixtureUser;

  beforeAll(async () => {
    fx = new Fixtures('db-integrity');
    await fx.setup();
    reporter = await fx.user('reporter');
  });

  afterAll(async () => {
    await fx.close();
  });

  describe('migrations (SRS 3.5.4)', () => {
    it('has applied every migration in the committed journal', async () => {
      const journal = JSON.parse(
        readFileSync(
          join(
            __dirname,
            '../src/database/drizzle/migrations/meta/_journal.json',
          ),
          'utf8',
        ),
      ) as { entries: unknown[] };
      const { rows } = await fx.db.query<{ count: string }>(
        'SELECT count(*) FROM drizzle.__drizzle_migrations',
      );
      expect(Number(rows[0].count)).toBe(journal.entries.length);
    });
  });

  describe('runtime role (SRS 3.4.4)', () => {
    it(`${APP_ROLE} is neither a superuser nor granted BYPASSRLS`, async () => {
      const { rows } = await fx.db.query(
        'SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1',
        [APP_ROLE],
      );
      expect(rows).toEqual([{ rolsuper: false, rolbypassrls: false }]);
    });

    it(`${APP_ROLE} owns no tables, since an owner is exempt from non-forced RLS`, async () => {
      const { rows } = await fx.db.query(
        `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tableowner = $1`,
        [APP_ROLE],
      );
      expect(rows).toEqual([]);
    });

    it(`${APP_ROLE} cannot create objects, so schema changes only arrive via migrations`, async () => {
      const { rows } = await fx.db.query<{ can_create: boolean }>(
        `SELECT has_schema_privilege($1, 'public', 'CREATE') AS can_create`,
        [APP_ROLE],
      );
      expect(rows[0].can_create).toBe(false);
    });

    it(`${APP_ROLE} cannot rewrite or delete audit history`, async () => {
      const app = new Client({
        ...migratorConfig,
        user: APP_ROLE,
        password: process.env.DB_PASSWORD,
      });
      await app.connect();
      try {
        // 42501 = insufficient_privilege: refused before RLS is even consulted.
        expect(
          await sqlState(app.query('UPDATE audit_logs SET action = $1', ['x'])),
        ).toBe('42501');
        expect(await sqlState(app.query('DELETE FROM audit_logs'))).toBe(
          '42501',
        );
      } finally {
        await app.end();
      }
    });
  });

  describe('row-level security coverage (SRS 3.4.4, SAD §9.2)', () => {
    it('enables and forces RLS, with a policy, on every table not explicitly exempt', async () => {
      const { rows } = await fx.db.query<{ relname: string }>(
        `SELECT c.relname
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind = 'r'
            AND NOT (
              c.relrowsecurity AND c.relforcerowsecurity
              AND EXISTS (SELECT 1 FROM pg_policies p
                           WHERE p.schemaname = 'public' AND p.tablename = c.relname)
            )
          ORDER BY c.relname`,
      );
      // Equality, not containment: a table that gains RLS should also leave the
      // exempt list, so the list stays an accurate record of the design.
      expect(rows.map((r) => r.relname)).toEqual(
        Object.keys(RLS_EXEMPT).sort(),
      );
    });
  });

  describe('schema constraints reject invalid data (SRS 3.10)', () => {
    it('refuses an incident location outside SRID 4326', async () => {
      const code = await sqlState(
        fx.db.query(
          `INSERT INTO incidents (reported_by_user_id, title, description, category, severity, location)
           VALUES ($1, 'bad srid', 'x', 'other', 'low', 'SRID=4269;POINT(79.86 6.93)')`,
          [reporter.id],
        ),
      );
      expect(code).toBe('23514'); // check_violation
    });

    it('refuses an incident location that is not a point', async () => {
      // Since migration 0032 the generated location_lat column's ST_Y() rejects a
      // non-point before the CHECK constraint is reached, hence no specific code:
      // what matters is that the row is refused.
      await sqlState(
        fx.db.query(
          `INSERT INTO incidents (reported_by_user_id, title, description, category, severity, location)
           VALUES ($1, 'bad geometry', 'x', 'other', 'low',
                   'SRID=4326;LINESTRING(79.8 6.9, 79.9 7.0)')`,
          [reporter.id],
        ),
      );
      const { rowCount } = await fx.db.query(
        `SELECT 1 FROM incidents WHERE title = 'bad geometry' AND reported_by_user_id = $1`,
        [reporter.id],
      );
      expect(rowCount).toBe(0);
    });

    it('refuses a service-area radius outside the allowed set', async () => {
      const code = await sqlState(
        fx.db.query(
          `INSERT INTO organisations (name, slug, contact_email, service_area_radius_km)
           VALUES ('db-integrity-bad-radius', 'db-integrity-bad-radius', 'r@x.test', 30)`,
        ),
      );
      expect(code).toBe('23514');
    });

    it('refuses an unknown severity value', async () => {
      const code = await sqlState(
        fx.db.query(
          `INSERT INTO incidents (reported_by_user_id, title, description, category, severity, location)
           VALUES ($1, 'bad enum', 'x', 'other', 'apocalyptic', 'SRID=4326;POINT(79.86 6.93)')`,
          [reporter.id],
        ),
      );
      expect(code).toBe('22P02'); // invalid_text_representation
    });

    it('refuses a photo attached to an incident that does not exist', async () => {
      const code = await sqlState(
        fx.db.query(
          `INSERT INTO incident_images (incident_id, url) VALUES (gen_random_uuid(), 'x')`,
        ),
      );
      expect(code).toBe('23503'); // foreign_key_violation
    });

    it('refuses a second account with the same email', async () => {
      const code = await sqlState(
        fx.db.query(
          `INSERT INTO users (auth_subject, email, full_name) VALUES ($1, $2, 'dup')`,
          [fx.subject('duplicate'), reporter.email],
        ),
      );
      expect(code).toBe('23505'); // unique_violation
    });
  });

  describe('geospatial queries at the 10,000-incident scale (SRS 3.4.1, 3.10)', () => {
    // One transaction for the whole block, rolled back at the end: the 10k rows,
    // the ANALYZE, and the role switches never touch the shared database.
    let client: Client;

    beforeAll(async () => {
      client = new Client(migratorConfig);
      await client.connect();
      await client.query('BEGIN');
      // Uniformly across Sri Lanka's bounding box, as SRS 3.4.1's dataset specifies.
      await client.query(
        `INSERT INTO incidents (reported_by_user_id, title, description, category, severity, location)
         SELECT $1, 'db-integrity load ' || g, 'x', 'other', 'low',
                ST_SetSRID(ST_MakePoint(79.7 + random() * 2.2, 5.9 + random() * 3.9), 4326)::geography
           FROM generate_series(1, 10000) g`,
        [reporter.id],
      );
      await client.query('ANALYZE incidents');
    });

    afterAll(async () => {
      await client.query('ROLLBACK');
      await client.end();
    });

    /** findNearby()'s WHERE clause, with the pre-filter optional. */
    const nearbyWhere = (
      lat: number,
      lng: number,
      radius: number,
      prefilter: boolean,
    ) => {
      const box = boundingBox(lat, lng, radius);
      const point = `'SRID=4326;POINT(${lng} ${lat})'::geography`;
      return `${
        prefilter
          ? `i.location_lat BETWEEN ${box.minLat} AND ${box.maxLat}
             AND i.location_lng BETWEEN ${box.minLng} AND ${box.maxLng} AND `
          : ''
      }ST_DWithin(i.location, ${point}, ${radius})`;
    };

    it('has a GiST index on incidents.location for RLS-free callers', async () => {
      const { rows } = await client.query<{ indexdef: string }>(
        `SELECT indexdef FROM pg_indexes
          WHERE schemaname = 'public' AND tablename = 'incidents'
            AND indexdef ILIKE '%USING gist (location)%'`,
      );
      expect(rows).toHaveLength(1);
    });

    it('serves the nearby query from an index under RLS, not a full scan', async () => {
      await client.query('SAVEPOINT as_app');
      try {
        // Planned as the application runs it: as the RLS-bound runtime role, under
        // the public-map read flag findNearby() sets.
        await client.query(`SET LOCAL ROLE ${APP_ROLE}`);
        await client.query(
          `SELECT set_config('app.public_map_read', 'true', true)`,
        );

        const { rows } = await client.query<{
          'QUERY PLAN': [{ Plan: unknown; 'Execution Time': number }];
        }>(
          `EXPLAIN (ANALYZE, FORMAT JSON)
           SELECT i.id FROM incidents i
            WHERE ${nearbyWhere(6.9271, 79.8612, 10_000, true)}
              AND (i.verification_status IS NULL OR i.verification_status = 'approved')
            LIMIT 200`,
        );
        const [explained] = rows[0]['QUERY PLAN'];
        const plan = JSON.stringify(explained.Plan);
        // Without migration 0032's pre-filter this is a Seq Scan over all 10,000
        // rows: PostGIS predicates are not LEAKPROOF, so RLS keeps them out of
        // index scans.
        expect(plan).toContain('incidents_location_lat_lng_idx');
        expect(plan).not.toContain('Seq Scan');
        // One query, well inside the endpoint's 500 ms p95 budget; the k6 load
        // test measures HTTP, auth and concurrency on top of this.
        expect(explained['Execution Time']).toBeLessThan(100);
      } finally {
        await client.query('ROLLBACK TO SAVEPOINT as_app');
      }
    });

    it.each([
      [6.9271, 79.8612, 10_000], // Colombo, default radius
      [9.6615, 80.0255, 50_000], // Jaffna, maximum radius
      [7.2906, 80.6337, 25_000], // Kandy
      [6.0535, 80.221, 1_000], // Galle, smallest service area
    ])(
      'returns exactly the same incidents with and without the pre-filter (%f, %f, %i m)',
      async (lat, lng, radius) => {
        // Points hugging the circle's edge on 8 bearings — 0.1% inside and 0.1%
        // outside, placed on the spheroid by ST_Project — are where a box that is
        // too tight would drop a real result.
        const edge = await client.query<{ id: string; inside: boolean }>(
          `INSERT INTO incidents (reported_by_user_id, title, description, category, severity, location)
           SELECT $1, 'db-integrity edge', 'x', 'other', 'low',
                  ST_Project($2::geography, $3 * f, radians(b))
             FROM generate_series(0, 315, 45) b, unnest(ARRAY[0.999, 1.001]) f
           RETURNING id, ST_DWithin(location, $2::geography, $3) AS inside`,
          [reporter.id, `SRID=4326;POINT(${lng} ${lat})`, radius],
        );
        const insideIds = edge.rows.filter((r) => r.inside).map((r) => r.id);
        expect(insideIds).toHaveLength(8);

        const ids = async (prefilter: boolean) =>
          (
            await client.query<{ id: string }>(
              `SELECT i.id FROM incidents i
                WHERE ${nearbyWhere(lat, lng, radius, prefilter)}
                ORDER BY i.id`,
            )
          ).rows.map((r) => r.id);
        const exact = await ids(false);
        expect(exact).toEqual(expect.arrayContaining(insideIds));
        expect(await ids(true)).toEqual(exact);
      },
    );
  });
});
