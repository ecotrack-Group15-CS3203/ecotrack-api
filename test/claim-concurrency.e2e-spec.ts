import 'dotenv/config';
import { Pool } from 'pg';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  startTestJwksServer,
  TestJwksServer,
} from './support/test-jwks-server';

/**
 * The single most important correctness property in the whole system: two
 * organisations racing to claim the same pooled incident must not both
 * succeed. incident-pool.service.ts's claim() relies on a conditional
 * `WHERE organisation_id IS NULL` UPDATE for this, not application-level
 * locking — this test exercises that through the real HTTP path (guard,
 * controller, service, RLS-scoped transaction), not a unit-level mock of the
 * query builder, since a mock would only prove the mock is correct.
 *
 * Uses an in-process JWKS server (test/support/test-jwks-server.ts) so
 * JwtStrategy validates a real signed token end to end, rather than
 * bypassing the auth guard.
 */

const migratorConfig = {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 5432),
  user: process.env.DB_MIGRATOR_USER ?? process.env.DB_USER,
  password: process.env.DB_MIGRATOR_PASSWORD ?? process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
};

const COLOMBO = 'SRID=4326;POINT(79.8612 6.9271)';

describe('Incident pool claim concurrency (e2e)', () => {
  let jwks: TestJwksServer;
  let app: INestApplication<App>;
  let migrator: Pool;

  let orgA: string;
  let orgB: string;
  let tokenA: string;
  let tokenB: string;
  let pooledIncidentId: string;

  const originalJwksUri = process.env.OIDC_JWKS_URI;
  const originalIssuer = process.env.OIDC_ISSUER;

  beforeAll(async () => {
    jwks = await startTestJwksServer();
    process.env.OIDC_JWKS_URI = `${jwks.issuer}/jwks`;
    process.env.OIDC_ISSUER = jwks.issuer;

    // require(), not a static top-of-file `import`: JwtStrategy reads
    // OIDC_JWKS_URI/OIDC_ISSUER inside its constructor's super() call, which
    // runs the moment Nest instantiates it during compile() below — a
    // hoisted static `import { AppModule }` would have already read the
    // real .env values before this file's body ever executes. A true
    // `await import()` would work the same way in principle, but ts-jest's
    // CommonJS runtime needs `--experimental-vm-modules` to support that;
    // `require()` inside this function body gets the same "run after env
    // vars are set" ordering without touching Jest's module system at all.

    /* eslint-disable @typescript-eslint/no-require-imports */
    const appModuleExports =
      require('../src/app.module') as typeof import('../src/app.module');
    /* eslint-enable @typescript-eslint/no-require-imports */
    const { AppModule } = appModuleExports;
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();

    migrator = new Pool({ ...migratorConfig, max: 1 });

    const org = async (name: string) =>
      (
        await migrator.query<{ id: string }>(
          `INSERT INTO organisations (name, slug, contact_email, service_area_center, service_area_radius_km)
           VALUES ($1, $2, $3, $4, 25) RETURNING id`,
          [name, name, `${name}@claim-concurrency.test`, COLOMBO],
        )
      ).rows[0].id;

    orgA = await org('claim-race-org-a');
    orgB = await org('claim-race-org-b');

    const adminSubA = 'claim-race-admin-a';
    const adminSubB = 'claim-race-admin-b';
    await migrator.query(
      `INSERT INTO users (auth_subject, email, full_name, role, organisation_id)
       VALUES ($1, $2, $3, 'org_admin', $4)`,
      [adminSubA, `${adminSubA}@claim-concurrency.test`, 'Admin A', orgA],
    );
    await migrator.query(
      `INSERT INTO users (auth_subject, email, full_name, role, organisation_id)
       VALUES ($1, $2, $3, 'org_admin', $4)`,
      [adminSubB, `${adminSubB}@claim-concurrency.test`, 'Admin B', orgB],
    );
    tokenA = jwks.mintToken({
      sub: adminSubA,
      email: `${adminSubA}@claim-concurrency.test`,
    });
    tokenB = jwks.mintToken({
      sub: adminSubB,
      email: `${adminSubB}@claim-concurrency.test`,
    });

    // The reporter and the incident itself are seeded directly: submitting
    // through POST /incidents would work identically, but a direct insert
    // keeps this test focused on the claim race, not report submission.
    const reporter = await migrator.query<{ id: string }>(
      `INSERT INTO users (auth_subject, email, full_name, role)
       VALUES ('claim-race-reporter', 'claim-race-reporter@claim-concurrency.test', 'Reporter', 'citizen')
       RETURNING id`,
    );
    pooledIncidentId = (
      await migrator.query<{ id: string }>(
        `INSERT INTO incidents (organisation_id, reported_by_user_id, title, description,
                                category, severity, location)
         VALUES (NULL, $1, 'claim race fixture', 'racing two orgs', 'other', 'low', $2)
         RETURNING id`,
        [reporter.rows[0].id, COLOMBO],
      )
    ).rows[0].id;
  });

  afterAll(async () => {
    await migrator.query('DELETE FROM incidents WHERE id = $1', [
      pooledIncidentId,
    ]);
    await migrator.query('DELETE FROM organisations WHERE id = ANY($1)', [
      [orgA, orgB],
    ]);
    await migrator.query(
      `DELETE FROM users WHERE auth_subject IN ('claim-race-admin-a', 'claim-race-admin-b', 'claim-race-reporter')`,
    );
    await migrator.end();
    await app.close();
    await jwks.close();

    // Restores the real env vars rather than leaving this file's mock JWKS
    // URL set for the rest of the --runInBand process, which the other
    // e2e-spec files share.
    process.env.OIDC_JWKS_URI = originalJwksUri;
    process.env.OIDC_ISSUER = originalIssuer;
  });

  it('lets exactly one of two simultaneous claims on the same incident succeed', async () => {
    const [resultA, resultB] = await Promise.all([
      request(app.getHttpServer())
        .post(`/incidents/pool/${pooledIncidentId}/claim`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send(),
      request(app.getHttpServer())
        .post(`/incidents/pool/${pooledIncidentId}/claim`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send(),
    ]);

    const statuses = [resultA.status, resultB.status].sort();
    // One winner (200), one loser (409) — never two winners, and never two losers.
    expect(statuses).toEqual([200, 409]);

    const winner = (resultA.status === 200 ? resultA : resultB) as unknown as {
      body: { organisationId: string };
    };
    expect([orgA, orgB]).toContain(winner.body.organisationId);

    const { rows } = await migrator.query<{ organisation_id: string }>(
      'SELECT organisation_id FROM incidents WHERE id = $1',
      [pooledIncidentId],
    );
    // The database agrees with whichever response reported success — not
    // left in some third, inconsistent state.
    expect(rows[0].organisation_id).toBe(winner.body.organisationId);
  });
});
