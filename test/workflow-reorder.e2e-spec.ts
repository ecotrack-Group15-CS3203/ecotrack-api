import request from 'supertest';
import { Fixtures, FixtureUser } from './support/fixtures';
import { createTestApp, TestApp } from './support/test-app';

/**
 * SRS 3.1.13 / 3.2.6: reordering and deleting workflow stages. Regression test for a
 * defect found by the Cypress suite - any real reorder returned 500, because
 * positions were rewritten one row at a time against a UNIQUE (org, position)
 * constraint checked per row. Fixed by deferring the constraint (migration 0033).
 */
describe('Workflow stage reorder (e2e)', () => {
  let t: TestApp;
  let fx: Fixtures;
  let org: string;
  let admin: FixtureUser;

  beforeAll(async () => {
    t = await createTestApp();
    fx = new Fixtures('wf-reorder', t.jwks);
    await fx.setup();
    org = await fx.org('org');
    await fx.workflowStages(org);
    admin = await fx.user('admin', { role: 'org_admin', organisationId: org });
  });

  afterAll(async () => {
    await fx.close();
    await t.close();
  });

  const stages = async () =>
    (
      await request(t.server)
        .get(`/organisations/${org}/workflow-stages`)
        .set('Authorization', `Bearer ${admin.token}`)
    ).body as { id: string; name: string; position: number }[];

  it('swaps two stages without violating the unique position constraint', async () => {
    const before = await stages();
    const ids = before.map((s) => s.id);
    // Move the last stage to the front: every position changes.
    const reordered = [ids[ids.length - 1], ...ids.slice(0, -1)];

    const res = await request(t.server)
      .patch(`/organisations/${org}/workflow-stages/reorder`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ orderedStageIds: reordered });
    expect(res.status).toBe(200);

    const after = await stages();
    expect(after.map((s) => s.id)).toEqual(reordered);
    expect(after.map((s) => s.position)).toEqual(reordered.map((_, i) => i));
  });

  it('keeps positions contiguous after deleting a stage that is not last', async () => {
    const [first] = await stages();
    const res = await request(t.server)
      .delete(`/organisations/${org}/workflow-stages/${first.id}`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBeLessThan(300);

    const after = await stages();
    expect(after.map((s) => s.position)).toEqual(after.map((_, i) => i));
  });
});
