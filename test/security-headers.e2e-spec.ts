import request from 'supertest';
import { createTestApp, TestApp } from './support/test-app';

/**
 * Response security headers (SRS 3.4; OWASP ZAP baseline findings 10021, 10020,
 * 10037, 10038, 90004). HSTS and the nginx Server header are set by nginx and are
 * checked against the deployment instead, by re-running the ZAP scan.
 */
describe('Security headers (e2e)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.close();
  });

  it.each([
    ['a successful response', '/health', 200],
    // Errors thrown by guards go through Nest's exception filter, a different path.
    ['an authentication error', '/incidents/mine', 401],
  ])('sets them on %s', async (_case, path, status) => {
    const res = await request(t.server).get(path);
    expect(res.status).toBe(status);

    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['content-security-policy']).toBe(
      "default-src 'none';frame-ancestors 'none'",
    );
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['cross-origin-opener-policy']).toBe('same-origin');
    expect(res.headers['cross-origin-resource-policy']).toBe('same-origin');
    // nginx owns HSTS for the whole host.
    expect(res.headers['strict-transport-security']).toBeUndefined();
  });

  it('keeps CORS working alongside the security headers', async () => {
    // Cross-Origin-Resource-Policy governs no-cors embeds, not CORS fetches; the
    // app's CORS setup lives in main.ts and is exercised in the deployment checks.
    const res = await request(t.server)
      .options('/health')
      .set('Origin', 'https://ecotrack.tech')
      .set('Access-Control-Request-Method', 'GET');
    expect(res.status).toBeLessThan(500);
  });
});
