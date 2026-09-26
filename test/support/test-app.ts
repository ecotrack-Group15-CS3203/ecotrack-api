import { INestApplication } from '@nestjs/common';
import { Test, TestingModuleBuilder } from '@nestjs/testing';
import type { App } from 'supertest/types';
import { startTestJwksServer, TestJwksServer } from './test-jwks-server';

/**
 * Boots the real AppModule — every global guard, pipe, and interceptor — behind an
 * in-process JWKS server, so a spec exercises the same auth → tenant → RBAC → RLS
 * path a production request takes, with tokens it can mint for any user, role, or
 * expiry.
 *
 * Owns the env-var ordering documented in test-jwks-server.ts: the JWKS server is
 * started and OIDC_JWKS_URI/OIDC_ISSUER pointed at it *before* AppModule is
 * required, because JwtStrategy reads both once, in its constructor. close()
 * restores the original values, since every e2e spec shares one --runInBand
 * process.
 *
 * Note: unlike main.ts this does not set the `v1` global prefix, so routes are
 * requested as `/incidents/...`, not `/v1/incidents/...`.
 */
export interface TestApp {
  app: INestApplication<App>;
  jwks: TestJwksServer;
  /** Pass straight to supertest's `request()`. */
  server: App;
  close(): Promise<void>;
}

export async function createTestApp(options?: {
  /** e.g. `(b) => b.overrideProvider(X).useValue(mockX)` to stub an outbound SDK. */
  configure?: (builder: TestingModuleBuilder) => TestingModuleBuilder;
}): Promise<TestApp> {
  const originalJwksUri = process.env.OIDC_JWKS_URI;
  const originalIssuer = process.env.OIDC_ISSUER;

  const jwks = await startTestJwksServer();
  process.env.OIDC_JWKS_URI = `${jwks.issuer}/jwks`;
  process.env.OIDC_ISSUER = jwks.issuer;

  /* eslint-disable @typescript-eslint/no-require-imports */
  const { AppModule } =
    require('../../src/app.module') as typeof import('../../src/app.module');
  /* eslint-enable @typescript-eslint/no-require-imports */

  let builder = Test.createTestingModule({ imports: [AppModule] });
  if (options?.configure) builder = options.configure(builder);
  const moduleFixture = await builder.compile();

  const app = moduleFixture.createNestApplication<INestApplication<App>>();
  await app.init();

  return {
    app,
    jwks,
    server: app.getHttpServer(),
    close: async () => {
      await app.close();
      await jwks.close();
      process.env.OIDC_JWKS_URI = originalJwksUri;
      process.env.OIDC_ISSUER = originalIssuer;
    },
  };
}
