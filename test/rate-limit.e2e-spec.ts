import * as crypto from 'crypto';
import request from 'supertest';
import { Fixtures, FixtureUser } from './support/fixtures';
import { createTestApp, TestApp } from './support/test-app';

/**
 * Rate limiting on authentication-sensitive endpoints (SRS 3.4.11): at most 10
 * requests per IP per minute on tenant registration, join requests, and the
 * token-guessable invitation endpoints; no limit anywhere else.
 *
 * The throttle is checked by a guard, before validation runs, so the first ten
 * requests may be any non-429 (a 400 for an empty body, a 404 for an unknown
 * token) — what matters is that the eleventh is refused regardless. Every request
 * here comes from 127.0.0.1, and each route has its own counter.
 */

const LIMIT = 10;

describe('Rate limiting (e2e)', () => {
  let t: TestApp;
  let fx: Fixtures;
  let citizen: FixtureUser;

  beforeAll(async () => {
    t = await createTestApp();
    fx = new Fixtures('rate-limit', t.jwks);
    await fx.setup();
    citizen = await fx.user('citizen');
  });

  afterAll(async () => {
    await fx.close();
    await t.close();
  });

  const unknownToken = () => crypto.randomBytes(16).toString('hex');

  const throttled: Array<[string, () => request.Test]> = [
    [
      'POST /organisations (tenant registration)',
      () =>
        request(t.server)
          .post('/organisations')
          .set('Authorization', `Bearer ${citizen.token}`)
          .send({}),
    ],
    [
      'POST /organisations/join-request',
      () =>
        request(t.server)
          .post('/organisations/join-request')
          .set('Authorization', `Bearer ${citizen.token}`)
          .send({}),
    ],
    [
      'GET /invites/:token (public invite-link lookup)',
      () => request(t.server).get(`/invites/${unknownToken()}`),
    ],
    [
      'GET /auth/invitations/:token (public invitation lookup)',
      () => request(t.server).get(`/auth/invitations/${unknownToken()}`),
    ],
    [
      'POST /organisations/invites/accept (invite-link redemption)',
      () =>
        request(t.server)
          .post('/organisations/invites/accept')
          .set('Authorization', `Bearer ${citizen.token}`)
          .send({}),
    ],
    [
      'POST /auth/invitations/:token/accept',
      () =>
        request(t.server)
          .post(`/auth/invitations/${unknownToken()}/accept`)
          .set('Authorization', `Bearer ${citizen.token}`),
    ],
  ];

  it.each(throttled)(
    '%s allows 10 requests a minute and refuses the 11th with 429',
    async (_route, send) => {
      for (let i = 1; i <= LIMIT; i++) {
        const res = await send();
        expect(res.status).not.toBe(429);
      }
      const blocked = await send();
      expect(blocked.status).toBe(429);
      // Tells a well-behaved client when it may retry.
      expect(blocked.headers['retry-after']).toBeDefined();
    },
  );

  it('does not rate-limit ordinary endpoints', async () => {
    for (let i = 0; i < LIMIT * 2; i++) {
      const res = await request(t.server).get('/health');
      expect(res.status).toBe(200);
    }
  });
});
