import * as crypto from 'crypto';
import request from 'supertest';
import { Fixtures, FixtureUser } from './support/fixtures';
import { createTestApp, TestApp } from './support/test-app';
import { startTestJwksServer } from './support/test-jwks-server';

/**
 * Authentication and authorisation at the HTTP boundary (SRS 3.4.5, 3.4.6).
 *
 * Every protected request must pass JWT signature → expiry → RBAC, in that order:
 * a bad token is a 401 (with a machine-readable `code` the mobile client branches
 * on), a good token with the wrong role or the wrong organisation is a 403. These
 * run through the real global guard chain against a real database, with tokens
 * signed by an in-process JWKS server standing in for Asgardeo.
 */

type ErrorBody = { code?: string; message?: string | string[] };

describe('Authentication & authorisation (e2e)', () => {
  let t: TestApp;
  let fx: Fixtures;

  let orgA: string;
  let orgB: string;
  let citizen: FixtureUser;
  let volunteerA: FixtureUser;
  let adminA: FixtureUser;
  let platformAdmin: FixtureUser;

  beforeAll(async () => {
    t = await createTestApp();
    fx = new Fixtures('auth', t.jwks);
    await fx.setup();

    orgA = await fx.org('org-a');
    orgB = await fx.org('org-b');
    citizen = await fx.user('citizen');
    volunteerA = await fx.user('volunteer-a', {
      role: 'volunteer',
      organisationId: orgA,
    });
    adminA = await fx.user('admin-a', {
      role: 'org_admin',
      organisationId: orgA,
    });
    platformAdmin = await fx.user('platform-admin', { isPlatformAdmin: true });
  });

  afterAll(async () => {
    await fx.close();
    await t.close();
  });

  const get = (path: string, token?: string) => {
    const req = request(t.server).get(path);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };

  describe('401: the token itself is rejected', () => {
    it('rejects a request with no Authorization header as TOKEN_MISSING', async () => {
      const res = await get('/auth/me');
      expect(res.status).toBe(401);
      expect((res.body as ErrorBody).code).toBe('TOKEN_MISSING');
    });

    it('rejects a malformed bearer token as TOKEN_INVALID', async () => {
      const res = await get('/auth/me', 'not-a-jwt');
      expect(res.status).toBe(401);
      expect((res.body as ErrorBody).code).toBe('TOKEN_INVALID');
    });

    it('rejects an expired token as TOKEN_EXPIRED, the only code that triggers a client refresh', async () => {
      const expired = t.jwks.mintToken({
        sub: citizen.sub,
        email: citizen.email,
        expiresInSeconds: -60,
      });
      const res = await get('/auth/me', expired);
      expect(res.status).toBe(401);
      expect((res.body as ErrorBody).code).toBe('TOKEN_EXPIRED');
    });

    it('rejects a token signed by a key that is not in the JWKS', async () => {
      // Same `kid` and issuer as the trusted server, so the API looks up the
      // trusted public key — and the signature then fails against it.
      const impostor = await startTestJwksServer();
      try {
        const forged = impostor.mintToken({
          sub: citizen.sub,
          email: citizen.email,
          overrides: { iss: t.jwks.issuer },
        });
        const res = await get('/auth/me', forged);
        expect(res.status).toBe(401);
        expect((res.body as ErrorBody).code).toBe('TOKEN_INVALID');
      } finally {
        await impostor.close();
      }
    });

    it('rejects a validly signed token whose payload was altered afterwards', async () => {
      const [header, , signature] = citizen.token.split('.');
      const escalated = Buffer.from(
        JSON.stringify({
          sub: platformAdmin.sub,
          email: platformAdmin.email,
          iss: t.jwks.issuer,
          exp: Math.floor(Date.now() / 1000) + 3600,
        }),
      ).toString('base64url');
      const res = await get('/auth/me', `${header}.${escalated}.${signature}`);
      expect(res.status).toBe(401);
      expect((res.body as ErrorBody).code).toBe('TOKEN_INVALID');
    });

    it('rejects an unsigned token (alg: none)', async () => {
      const enc = (o: object) =>
        Buffer.from(JSON.stringify(o)).toString('base64url');
      const unsigned = `${enc({ alg: 'none', typ: 'JWT' })}.${enc({
        sub: citizen.sub,
        email: citizen.email,
        iss: t.jwks.issuer,
        exp: Math.floor(Date.now() / 1000) + 3600,
      })}.`;
      const res = await get('/auth/me', unsigned);
      expect(res.status).toBe(401);
    });

    it('rejects a token from a different issuer', async () => {
      const foreign = t.jwks.mintToken({
        sub: citizen.sub,
        email: citizen.email,
        overrides: { iss: 'https://evil.example.com/oauth2/token' },
      });
      const res = await get('/auth/me', foreign);
      expect(res.status).toBe(401);
      expect((res.body as ErrorBody).code).toBe('TOKEN_INVALID');
    });

    it('rejects a token whose lifetime exceeds the 1-hour maximum (SRS 3.4.6)', async () => {
      const longLived = t.jwks.mintToken({
        sub: citizen.sub,
        email: citizen.email,
        expiresInSeconds: 24 * 3600,
      });
      const res = await get('/auth/me', longLived);
      expect(res.status).toBe(401);
    });

    it('rejects a token with no email claim, since the user cannot be provisioned', async () => {
      const noEmail = t.jwks.mintToken({ sub: fx.subject('no-email') });
      const res = await get('/auth/me', noEmail);
      expect(res.status).toBe(401);
    });

    it('rejects a valid token belonging to a deactivated account', async () => {
      const inactive = await fx.user('inactive', { isActive: false });
      const res = await get('/auth/me', inactive.token);
      expect(res.status).toBe(401);
    });
  });

  describe('200: valid tokens are accepted', () => {
    it('accepts a valid token and resolves the caller from the database', async () => {
      const res = await get('/auth/me', adminA.token);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        email: adminA.email,
        role: 'org_admin',
        organisation: { id: orgA },
      });
    });

    it('provisions a first-time user as a citizen, ignoring any role claimed in the token', async () => {
      const sub = fx.subject('first-login');
      const token = t.jwks.mintToken({
        sub,
        email: `${sub}@${fx.domain}`,
        overrides: { role: 'org_admin', organizationId: orgA },
      });
      const res = await get('/auth/me', token);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        role: 'citizen',
        isPlatformAdmin: false,
        organisation: null,
      });
    });

    it('serves @Public() routes with no token at all', async () => {
      expect((await get('/health')).status).toBe(200);
      expect((await get('/organisations/public')).status).toBe(200);
    });
  });

  describe('403: authenticated, but not permitted (RBAC)', () => {
    it('forbids a citizen from the org-admin incident pool', async () => {
      const res = await get('/incidents/pool', citizen.token);
      expect(res.status).toBe(403);
    });

    it('forbids a volunteer from creating events, which is org-admin only', async () => {
      const res = await request(t.server)
        .post(`/organisations/${orgA}/events`)
        .set('Authorization', `Bearer ${volunteerA.token}`)
        .send({});
      // 403 — not 400: the role check must run before the body is even validated.
      expect(res.status).toBe(403);
    });

    it('forbids an org admin from the platform-admin organisation list', async () => {
      const res = await get('/organisations', adminA.token);
      expect(res.status).toBe(403);
    });

    it('lets the platform admin list organisations', async () => {
      const res = await get('/organisations', platformAdmin.token);
      expect(res.status).toBe(200);
    });

    it('lets an org admin into the incident pool', async () => {
      const res = await get('/incidents/pool', adminA.token);
      expect(res.status).toBe(200);
    });
  });

  describe('403: authenticated, but the wrong tenant (TenantGuard)', () => {
    it('lets an org admin read their own organisation', async () => {
      const res = await get(`/organisations/${orgA}`, adminA.token);
      expect(res.status).toBe(200);
    });

    it("forbids an org admin from reading another organisation's record", async () => {
      const res = await get(`/organisations/${orgB}`, adminA.token);
      expect(res.status).toBe(403);
    });

    it("forbids an org admin from another organisation's dashboard and audit log", async () => {
      expect(
        (await get(`/organisations/${orgB}/dashboard/stats`, adminA.token))
          .status,
      ).toBe(403);
      expect(
        (await get(`/organisations/${orgB}/audit-logs`, adminA.token)).status,
      ).toBe(403);
    });

    it('does not leak whether an unknown organisation exists', async () => {
      const res = await get(
        `/organisations/${crypto.randomUUID()}`,
        adminA.token,
      );
      expect(res.status).toBe(403);
    });

    it('lets the platform admin read any organisation', async () => {
      const res = await get(`/organisations/${orgB}`, platformAdmin.token);
      expect(res.status).toBe(200);
    });
  });
});
