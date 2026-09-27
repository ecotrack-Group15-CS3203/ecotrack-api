import request from 'supertest';
import { Fixtures } from './support/fixtures';
import { createTestApp, TestApp } from './support/test-app';

/**
 * The single most important correctness property in the whole system: two
 * organisations racing to claim the same pooled incident must not both
 * succeed. incident-pool.service.ts's claim() relies on a conditional
 * `WHERE organisation_id IS NULL` UPDATE for this, not application-level
 * locking — this test exercises that through the real HTTP path (guard,
 * controller, service, RLS-scoped transaction), not a unit-level mock of the
 * query builder, since a mock would only prove the mock is correct.
 *
 * Uses an in-process JWKS server (via test/support/test-app.ts) so
 * JwtStrategy validates a real signed token end to end, rather than
 * bypassing the auth guard.
 */

describe('Incident pool claim concurrency (e2e)', () => {
  let t: TestApp;
  let fx: Fixtures;

  let orgA: string;
  let orgB: string;
  let tokenA: string;
  let tokenB: string;
  let pooledIncidentId: string;

  beforeAll(async () => {
    t = await createTestApp();
    fx = new Fixtures('claim-race', t.jwks);
    await fx.setup();

    orgA = await fx.org('org-a');
    orgB = await fx.org('org-b');
    tokenA = (
      await fx.user('admin-a', { role: 'org_admin', organisationId: orgA })
    ).token;
    tokenB = (
      await fx.user('admin-b', { role: 'org_admin', organisationId: orgB })
    ).token;

    // The reporter and the incident itself are seeded directly: submitting
    // through POST /incidents would work identically, but a direct insert
    // keeps this test focused on the claim race, not report submission.
    const reporter = await fx.user('reporter');
    pooledIncidentId = await fx.incident({ reporterId: reporter.id });
  });

  afterAll(async () => {
    await fx.close();
    await t.close();
  });

  it('lets exactly one of two simultaneous claims on the same incident succeed', async () => {
    const [resultA, resultB] = await Promise.all([
      request(t.server)
        .post(`/incidents/pool/${pooledIncidentId}/claim`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send(),
      request(t.server)
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

    const { rows } = await fx.db.query<{ organisation_id: string }>(
      'SELECT organisation_id FROM incidents WHERE id = $1',
      [pooledIncidentId],
    );
    // The database agrees with whichever response reported success — not
    // left in some third, inconsistent state.
    expect(rows[0].organisation_id).toBe(winner.body.organisationId);
  });
});
