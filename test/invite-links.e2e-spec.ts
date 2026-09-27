import { createHash } from 'crypto';
import request from 'supertest';
import { Fixtures, FixtureUser } from './support/fixtures';
import { createTestApp, TestApp } from './support/test-app';

/**
 * Invite-link security (SRS 3.4.7) and redemption rules (SRS 3.1.12).
 *
 * The raw token is shown once and never stored — only its SHA-256 hash is — so a
 * database leak does not leak working invite links. Redemptions against a link
 * with `maxUses` must never exceed it, even when they arrive at the same instant.
 *
 * Note: POST /organisations/invites/accept is rate-limited to 10 requests a minute
 * from one IP (SRS 3.4.11), and every request in this suite comes from 127.0.0.1.
 * Keep this file's total accept calls at 10 or fewer, or the last ones will 429.
 */

const COLOMBO = { lat: 6.9271, lng: 79.8612 };
const KANDY = { lat: 7.2906, lng: 80.6337 }; // ~95 km away, outside a 25 km area

type CreatedLink = {
  inviteLink: { id: string; expiresAt: string; maxUses: number | null };
  token: string;
};

describe('Invite links (e2e)', () => {
  let t: TestApp;
  let fx: Fixtures;
  let org: string;
  let admin: FixtureUser;

  beforeAll(async () => {
    t = await createTestApp();
    fx = new Fixtures('invite', t.jwks);
    await fx.setup();
    org = await fx.org('org');
    admin = await fx.user('admin', { role: 'org_admin', organisationId: org });
  });

  afterAll(async () => {
    await fx.close();
    await t.close();
  });

  const createLink = async (body: Record<string, unknown> = {}) => {
    const res = await request(t.server)
      .post(`/organisations/${org}/invites`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send(body);
    expect(res.status).toBe(201);
    return res.body as CreatedLink;
  };

  const accept = (
    user: FixtureUser,
    token: string,
    where: { lat: number; lng: number } = COLOMBO,
  ) =>
    request(t.server)
      .post('/organisations/invites/accept')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ token, ...where });

  const message = (res: request.Response) =>
    String((res.body as { message: unknown }).message);

  describe('token generation and storage (SRS 3.4.7)', () => {
    it('issues a token with 128 bits of entropy', async () => {
      const { token } = await createLink();
      expect(Buffer.from(token, 'base64url')).toHaveLength(16);
    });

    it('stores only the SHA-256 hash of the token, never the token itself', async () => {
      const { inviteLink, token } = await createLink();
      const { rows } = await fx.db.query<Record<string, unknown>>(
        'SELECT * FROM invite_links WHERE id = $1',
        [inviteLink.id],
      );
      const row = rows[0];
      expect(row.token_hash).toBe(
        createHash('sha256').update(token).digest('hex'),
      );
      expect(Object.values(row).map(String)).not.toContain(token);
    });

    it('issues a different token every time', async () => {
      const tokens = await Promise.all([createLink(), createLink()]);
      expect(tokens[0].token).not.toBe(tokens[1].token);
    });

    it('expires links after 7 days by default', async () => {
      const { inviteLink } = await createLink();
      const days =
        (new Date(inviteLink.expiresAt).getTime() - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(6.9);
      expect(days).toBeLessThanOrEqual(7);
    });

    it('lets anyone look up a link by token, revealing only the org name and validity', async () => {
      const { token } = await createLink();
      const res = await request(t.server).get(`/invites/${token}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        organisationName: `invite-org`,
        expired: false,
        revoked: false,
        exhausted: false,
      });
    });

    it('returns 404 for an unknown token', async () => {
      const res = await request(t.server).get('/invites/not-a-real-token');
      expect(res.status).toBe(404);
    });
  });

  describe('redemption', () => {
    it('never exceeds maxUses, even with simultaneous redemptions', async () => {
      const { inviteLink, token } = await createLink({ maxUses: 2 });
      const citizens = await Promise.all(
        [1, 2, 3, 4, 5].map((n) => fx.user(`racer-${n}`)),
      );

      const results = await Promise.all(citizens.map((c) => accept(c, token)));
      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([200, 200, 400, 400, 400]);
      results
        .filter((r) => r.status === 400)
        .forEach((r) => expect(message(r)).toMatch(/usage limit/));

      const { rows } = await fx.db.query<{ uses_count: number }>(
        'SELECT uses_count FROM invite_links WHERE id = $1',
        [inviteLink.id],
      );
      expect(rows[0].uses_count).toBe(2);
      const members = await fx.db.query(
        'SELECT 1 FROM users WHERE organisation_id = $1 AND id = ANY($2)',
        [org, citizens.map((c) => c.id)],
      );
      expect(members.rowCount).toBe(2);
    });

    it('refuses an expired link', async () => {
      const { inviteLink, token } = await createLink();
      await fx.db.query(
        `UPDATE invite_links SET expires_at = now() - interval '1 minute' WHERE id = $1`,
        [inviteLink.id],
      );
      const res = await accept(await fx.user('late'), token);
      expect(res.status).toBe(400);
      expect(message(res)).toMatch(/expired/);
    });

    it('refuses a revoked link', async () => {
      const { inviteLink, token } = await createLink();
      const revoke = await request(t.server)
        .delete(`/organisations/${org}/invites/${inviteLink.id}`)
        .set('Authorization', `Bearer ${admin.token}`);
      expect(revoke.status).toBe(200);

      const res = await accept(await fx.user('after-revoke'), token);
      expect(res.status).toBe(400);
      expect(message(res)).toMatch(/revoked/);
    });

    it("refuses a user outside the organisation's service area", async () => {
      const { token } = await createLink();
      const res = await accept(await fx.user('far-away'), token, KANDY);
      expect(res.status).toBe(422);
      expect(message(res)).toMatch(/outside .* service area/);
    });

    it('refuses a user who already belongs to an organisation', async () => {
      const { token } = await createLink();
      const otherOrg = await fx.org('other');
      const member = await fx.user('member-elsewhere', {
        role: 'volunteer',
        organisationId: otherOrg,
      });
      const res = await accept(member, token);
      expect(res.status).toBe(409);
    });
  });
});
