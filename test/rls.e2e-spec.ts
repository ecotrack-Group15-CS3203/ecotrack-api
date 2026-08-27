import 'dotenv/config';
import { Client, Pool } from 'pg';

/**
 * Row-Level Security regression tests.
 *
 * RLS is the system's actual tenant boundary — the application layer is a convenience
 * on top of it (SRS 3.4.4, SAD 9.2). These tests assert the boundary directly against
 * Postgres rather than through NestJS, because what is being verified is the database's
 * behaviour, not a service's.
 *
 * CRITICAL: assertions run as `ecotrack_app`, the NOBYPASSRLS runtime role. Running
 * them as the migrator (a superuser, which bypasses RLS entirely) would make every one
 * of them pass while proving nothing at all. The "RLS test harness sanity" case below
 * guards against exactly that misconfiguration, and should be the first thing to look
 * at if this suite ever goes suspiciously green.
 *
 * Fixtures are created and torn down as the migrator, since seeding deliberately needs
 * to write rows that no single tenant session could legally create.
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

interface Fixture {
  orgA: string;
  orgB: string;
  userA: string;
  userB: string;
  reporter: string;
  incidentA: string;
  incidentB: string;
  pooled: string;
}

let migrator: Pool;
let fixture: Fixture;

/** Opens a session impersonating one tenant, exactly as TenantInterceptor would. */
async function asTenant<T>(
  vars: {
    tenant?: string;
    userId?: string;
    isOrgAdmin?: boolean;
    isPlatformAdmin?: boolean;
  },
  run: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client(appConfig);
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.current_tenant', $1, true),
              set_config('app.current_user_id', $2, true),
              set_config('app.is_org_admin', $3, true),
              set_config('app.is_platform_admin', $4, true)`,
      [
        vars.tenant ?? '',
        vars.userId ?? '',
        String(vars.isOrgAdmin ?? false),
        String(vars.isPlatformAdmin ?? false),
      ],
    );
    return await run(client);
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    await client.end();
  }
}

beforeAll(async () => {
  migrator = new Pool(migratorConfig);

  const org = async (name: string) =>
    (
      await migrator.query<{ id: string }>(
        `INSERT INTO organisations (name, contact_email, service_area_center, service_area_radius_km)
         VALUES ($1, $2, $3, 25) RETURNING id`,
        [name, `${name}@rls.test`, COLOMBO],
      )
    ).rows[0].id;

  const user = async (sub: string, orgId: string | null, role: string) =>
    (
      await migrator.query<{ id: string }>(
        `INSERT INTO users (auth_subject, email, full_name, role, organisation_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [sub, `${sub}@rls.test`, sub, role, orgId],
      )
    ).rows[0].id;

  const incident = async (
    orgId: string | null,
    reporter: string,
    title: string,
  ) =>
    (
      await migrator.query<{ id: string }>(
        `INSERT INTO incidents (organisation_id, reported_by_user_id, title, description,
                                category, severity, location)
         VALUES ($1, $2, $3, 'rls fixture', 'other', 'low', $4) RETURNING id`,
        [orgId, reporter, title, COLOMBO],
      )
    ).rows[0].id;

  const orgA = await org('rls-org-a');
  const orgB = await org('rls-org-b');
  const userA = await user('rls-admin-a', orgA, 'org_admin');
  const userB = await user('rls-admin-b', orgB, 'org_admin');
  const reporter = await user('rls-reporter', null, 'citizen');

  fixture = {
    orgA,
    orgB,
    userA,
    userB,
    reporter,
    incidentA: await incident(orgA, reporter, 'org A claimed'),
    incidentB: await incident(orgB, reporter, 'org B claimed'),
    pooled: await incident(null, reporter, 'still pooled'),
  };
});

afterAll(async () => {
  if (fixture) {
    // incidents/users cascade or null out from the organisation delete; the pooled
    // incident and the org-less reporter have no organisation to cascade from.
    await migrator.query('DELETE FROM incidents WHERE id = $1', [
      fixture.pooled,
    ]);
    await migrator.query('DELETE FROM organisations WHERE id = ANY($1)', [
      [fixture.orgA, fixture.orgB],
    ]);
    await migrator.query('DELETE FROM users WHERE id = ANY($1)', [
      [fixture.userA, fixture.userB, fixture.reporter],
    ]);
  }
  await migrator?.end();
});

describe('RLS test harness sanity', () => {
  it('runs as a role that cannot bypass RLS', async () => {
    const { rows } = await migrator.query<{
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>('SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1', [
      appConfig.user,
    ]);
    expect(rows).toHaveLength(1);
    // If either of these is true, every assertion below is meaningless.
    expect(rows[0].rolsuper).toBe(false);
    expect(rows[0].rolbypassrls).toBe(false);
  });
});

describe('incidents: cross-tenant isolation', () => {
  it("hides another tenant's claimed incident", async () => {
    const visible = await asTenant(
      { tenant: fixture.orgA, userId: fixture.userA, isOrgAdmin: true },
      async (c) =>
        (
          await c.query<{ id: string }>(
            'SELECT id FROM incidents WHERE id = $1',
            [fixture.incidentB],
          )
        ).rows,
    );
    expect(visible).toHaveLength(0);
  });

  it('shows the tenant its own claimed incident', async () => {
    const visible = await asTenant(
      { tenant: fixture.orgA, userId: fixture.userA, isOrgAdmin: true },
      async (c) =>
        (
          await c.query<{ id: string }>(
            'SELECT id FROM incidents WHERE id = $1',
            [fixture.incidentA],
          )
        ).rows,
    );
    expect(visible).toHaveLength(1);
  });

  it('exposes the unclaimed pool to an org_admin of any tenant', async () => {
    for (const [tenant, userId] of [
      [fixture.orgA, fixture.userA],
      [fixture.orgB, fixture.userB],
    ]) {
      const visible = await asTenant(
        { tenant, userId, isOrgAdmin: true },
        async (c) =>
          (
            await c.query<{ id: string }>(
              'SELECT id FROM incidents WHERE id = $1',
              [fixture.pooled],
            )
          ).rows,
      );
      expect(visible).toHaveLength(1);
    }
  });

  it('lets the reporter see their own report while it is still pooled', async () => {
    const visible = await asTenant(
      { userId: fixture.reporter },
      async (c) =>
        (
          await c.query<{ id: string }>(
            'SELECT id FROM incidents WHERE id = $1',
            [fixture.pooled],
          )
        ).rows,
    );
    expect(visible).toHaveLength(1);
  });

  it("cannot UPDATE another tenant's incident", async () => {
    const updated = await asTenant(
      { tenant: fixture.orgA, userId: fixture.userA, isOrgAdmin: true },
      async (c) =>
        (
          await c.query(
            "UPDATE incidents SET title = 'hijacked' WHERE id = $1",
            [fixture.incidentB],
          )
        ).rowCount,
    );
    // USING hides the row, so the UPDATE simply matches nothing.
    expect(updated).toBe(0);
  });

  it('cannot claim a pooled incident on behalf of another tenant', async () => {
    await expect(
      asTenant(
        { tenant: fixture.orgA, userId: fixture.userA, isOrgAdmin: true },
        (c) =>
          c.query('UPDATE incidents SET organisation_id = $1 WHERE id = $2', [
            fixture.orgB,
            fixture.pooled,
          ]),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('allows claiming a pooled incident for its own tenant', async () => {
    const updated = await asTenant(
      { tenant: fixture.orgA, userId: fixture.userA, isOrgAdmin: true },
      async (c) =>
        (
          await c.query(
            'UPDATE incidents SET organisation_id = $1 WHERE id = $2 AND organisation_id IS NULL',
            [fixture.orgA, fixture.pooled],
          )
        ).rowCount,
    );
    expect(updated).toBe(1);
  });
});

describe('tasks: standard tenant scoping', () => {
  it("hides another tenant's tasks and refuses to write into their org", async () => {
    await asTenant(
      { tenant: fixture.orgA, userId: fixture.userA, isOrgAdmin: true },
      async (c) => {
        const seen = await c.query(
          'SELECT id FROM tasks WHERE organisation_id = $1',
          [fixture.orgB],
        );
        expect(seen.rows).toHaveLength(0);

        await expect(
          c.query(
            `INSERT INTO tasks (organisation_id, incident_id, description)
             VALUES ($1, $2, 'should be refused')`,
            [fixture.orgB, fixture.incidentB],
          ),
        ).rejects.toThrow(/row-level security/i);
      },
    );
  });
});

describe('notifications: per-user isolation', () => {
  it('lets an org_admin notify another user but never read it back', async () => {
    await asTenant(
      { tenant: fixture.orgA, userId: fixture.userA, isOrgAdmin: true },
      async (c) => {
        // Writing FOR the reporter is allowed — this is what claiming an incident does.
        await c.query(
          `INSERT INTO notifications (user_id, organisation_id, type, title, message)
           VALUES ($1, $2, 'incident_claimed', 't', 'm')`,
          [fixture.reporter, fixture.orgA],
        );
        // ...but the writer cannot see the recipient's notification.
        const seen = await c.query(
          'SELECT id FROM notifications WHERE user_id = $1',
          [fixture.reporter],
        );
        expect(seen.rows).toHaveLength(0);
      },
    );
  });

  it('lets the recipient read their own notification', async () => {
    await migrator.query(
      `INSERT INTO notifications (user_id, organisation_id, type, title, message)
       VALUES ($1, $2, 'incident_claimed', 't', 'm')`,
      [fixture.reporter, fixture.orgA],
    );
    const seen = await asTenant(
      { userId: fixture.reporter },
      async (c) =>
        (
          await c.query<{ id: string }>(
            'SELECT id FROM notifications WHERE user_id = $1',
            [fixture.reporter],
          )
        ).rows,
    );
    expect(seen.length).toBeGreaterThanOrEqual(1);
  });
});
