import * as http from 'http';
import * as crypto from 'crypto';
import type { AddressInfo } from 'net';

/**
 * In-process equivalent of tools/mock-jwks.js, for integration tests that need
 * JwtStrategy to validate a real signed token rather than mocking the guard
 * away entirely — the whole point of these tests is exercising the real
 * auth-guard-to-database path, so the token has to be real too.
 *
 * Must be started, and OIDC_JWKS_URI/OIDC_ISSUER set from its `.issuer`,
 * before any test loads AppModule — JwtStrategy reads those env vars once,
 * inside its constructor's `super()` call, when Nest instantiates it. A
 * static `import { AppModule }` at the top of a test file is hoisted ahead of
 * any `beforeAll` body by the CommonJS output ts-jest emits, so callers must
 * `require('../src/app.module')` *inside* beforeAll, after calling
 * `startTestJwksServer()` — not a top-level import, and not `await import()`
 * either, which needs `--experimental-vm-modules` under ts-jest's CommonJS
 * runtime that this project doesn't otherwise need.
 */
export interface TestJwksServer {
  issuer: string;
  mintToken(claims: {
    sub: string;
    email: string;
    name?: string;
    expiresInSeconds?: number;
  }): string;
  close(): Promise<void>;
}

const KID = 'test-key-1';

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

export async function startTestJwksServer(): Promise<TestJwksServer> {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const jwk = publicKey.export({ format: 'jwk' }) as Record<string, unknown>;

  const server = http.createServer((req, res) => {
    if (req.url === '/jwks') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          keys: [{ ...jwk, kid: KID, alg: 'RS256', use: 'sig' }],
        }),
      );
      return;
    }
    res.writeHead(404).end();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const issuer = `http://127.0.0.1:${port}`;

  function mintToken(claims: {
    sub: string;
    email: string;
    name?: string;
    expiresInSeconds?: number;
  }): string {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT', kid: KID };
    const payload = {
      sub: claims.sub,
      email: claims.email,
      name: claims.name ?? claims.sub,
      iss: issuer,
      iat: now,
      exp: now + (claims.expiresInSeconds ?? 3600),
    };
    const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
    const signature = crypto
      .sign('RSA-SHA256', Buffer.from(signingInput), privateKey)
      .toString('base64url');
    return `${signingInput}.${signature}`;
  }

  return {
    issuer,
    mintToken,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
