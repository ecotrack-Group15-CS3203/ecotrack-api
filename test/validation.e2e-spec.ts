import request from 'supertest';
import { Fixtures, FixtureUser } from './support/fixtures';
import { createTestApp, TestApp } from './support/test-app';

/**
 * Input validation and injection prevention (SRS 3.4.10).
 *
 * Every body, query, and path parameter is validated by the global ValidationPipe
 * (whitelist + forbidNonWhitelisted) before a handler runs, and every query is
 * parameterised by Drizzle — so hostile input is either refused with a readable 400
 * or stored as inert text, never executed. Uses the incident endpoints as the
 * representative surface: they take all three input kinds and are open to every
 * signed-in role.
 */

type ErrorBody = { statusCode: number; message: string | string[] };

const SQL_INJECTION = "'); DROP TABLE incidents; --";
const XSS = '<script>alert("xss")</script>';

describe('Input validation & injection prevention (e2e)', () => {
  let t: TestApp;
  let fx: Fixtures;
  let citizen: FixtureUser;

  beforeAll(async () => {
    t = await createTestApp();
    fx = new Fixtures('validation', t.jwks);
    await fx.setup();
    citizen = await fx.user('citizen');
  });

  afterAll(async () => {
    await fx.close();
    await t.close();
  });

  const validIncident = () => ({
    title: 'Oil spill near the canal',
    urgency: 'high',
    location: { lat: 6.9271, lng: 79.8612 },
    mediaUrls: ['http://store.test/bucket/photo.jpg'],
  });

  const report = (body: Record<string, unknown>) =>
    request(t.server)
      .post('/incidents')
      .set('Authorization', `Bearer ${citizen.token}`)
      .send(body);

  const get = (path: string) =>
    request(t.server).get(path).set('Authorization', `Bearer ${citizen.token}`);

  /** A 400 must say what is wrong in plain words — no stack, no exception class. */
  const expectReadable400 = (res: request.Response, field: RegExp) => {
    expect(res.status).toBe(400);
    const body = res.body as ErrorBody;
    const messages = ([] as string[]).concat(body.message);
    expect(messages.some((m) => field.test(m))).toBe(true);
    const raw = JSON.stringify(body);
    expect(raw).not.toMatch(/\bat \w+ \(|Exception|node_modules|\.ts:\d+/);
  };

  describe('request bodies', () => {
    it('accepts a well-formed incident report', async () => {
      expect((await report(validIncident())).status).toBe(201);
    });

    it('rejects a missing required field', async () => {
      const body: Partial<ReturnType<typeof validIncident>> = validIncident();
      delete body.title;
      expectReadable400(await report(body), /title/);
    });

    it('rejects a title over the 120-character limit', async () => {
      expectReadable400(
        await report({ ...validIncident(), title: 'x'.repeat(121) }),
        /title/,
      );
    });

    it('rejects a value outside an enum', async () => {
      expectReadable400(
        await report({ ...validIncident(), urgency: 'apocalyptic' }),
        /urgency/,
      );
    });

    it('validates nested objects', async () => {
      expectReadable400(
        await report({ ...validIncident(), location: { lat: 200, lng: 0 } }),
        /lat/,
      );
    });

    it('rejects an empty photo list', async () => {
      expectReadable400(
        await report({ ...validIncident(), mediaUrls: [] }),
        /mediaUrls/,
      );
    });

    it('rejects unexpected properties, so a client cannot mass-assign server-owned fields', async () => {
      expectReadable400(
        await report({
          ...validIncident(),
          organisationId: '00000000-0000-0000-0000-000000000000',
          verificationStatus: 'approved',
        }),
        /organisationId should not exist/,
      );
    });
  });

  describe('injection payloads', () => {
    it('stores SQL and script payloads as inert text', async () => {
      const res = await report({
        ...validIncident(),
        title: SQL_INJECTION,
        description: XSS,
      });
      expect(res.status).toBe(201);

      const { rows } = await fx.db.query<{
        title: string;
        description: string;
      }>(
        `SELECT title, description FROM incidents
          WHERE reported_by_user_id = $1 AND title = $2`,
        [citizen.id, SQL_INJECTION],
      );
      // Stored verbatim — and the table it tried to drop is evidently still there.
      expect(rows).toEqual([{ title: SQL_INJECTION, description: XSS }]);
    });

    it('rejects injection attempts in query parameters', async () => {
      const res = await get(
        `/incidents/nearby?lat=${encodeURIComponent('6.9 OR 1=1')}&lng=79.86`,
      );
      expectReadable400(res, /lat/);
    });

    it('rejects injection attempts in path parameters', async () => {
      const res = await get(`/incidents/${encodeURIComponent(SQL_INJECTION)}`);
      expectReadable400(res, /uuid/i);
    });
  });

  describe('query parameters', () => {
    it('accepts a valid nearby query', async () => {
      const res = await get('/incidents/nearby?lat=6.9271&lng=79.8612');
      expect(res.status).toBe(200);
    });

    it('rejects a non-numeric coordinate', async () => {
      expectReadable400(
        await get('/incidents/nearby?lat=abc&lng=79.86'),
        /lat/,
      );
    });

    it('enforces the 50 km maximum search radius (SRS 3.1.3)', async () => {
      expectReadable400(
        await get('/incidents/nearby?lat=6.9271&lng=79.8612&radius=60000'),
        /radius/,
      );
    });
  });
});
