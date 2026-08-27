/**
 * Dev-only mock of Asgardeo's JWKS + token endpoints, so the API can be exercised
 * locally before the real tenant exists (Track A). Mints RS256 tokens signed by a
 * keypair generated fresh at startup and published at /jwks.
 *
 *   node mock-jwks.js
 *   GET /jwks
 *   GET /token?sub=<id>&email=<email>&name=<name>[&exp=<seconds-from-now>]
 */
const http = require('http');
const crypto = require('crypto');

const PORT = 9999;
const ISSUER = `http://localhost:${PORT}`;
const KID = 'mock-key-1';

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const jwk = publicKey.export({ format: 'jwk' });

const b64url = (input) =>
  Buffer.from(input).toString('base64url');

function mintToken({ sub, email, name, expiresIn }) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT', kid: KID };
  const payload = {
    sub,
    email,
    name,
    iss: ISSUER,
    iat: now,
    exp: now + expiresIn,
  };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(
    JSON.stringify(payload),
  )}`;
  const signature = crypto
    .sign('RSA-SHA256', Buffer.from(signingInput), privateKey)
    .toString('base64url');
  return `${signingInput}.${signature}`;
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, ISSUER);

    if (url.pathname === '/jwks') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          keys: [{ ...jwk, kid: KID, alg: 'RS256', use: 'sig' }],
        }),
      );
      return;
    }

    if (url.pathname === '/token') {
      const sub = url.searchParams.get('sub') || 'mock-user';
      const token = mintToken({
        sub,
        email: url.searchParams.get('email') || `${sub}@example.dev`,
        name: url.searchParams.get('name') || sub,
        // Negative values are allowed on purpose: minting an already-expired token is
        // how the TOKEN_EXPIRED path gets exercised.
        expiresIn: Number(url.searchParams.get('exp') ?? 3600),
      });
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(token);
      return;
    }

    res.writeHead(404).end();
  })
  .listen(PORT, () => console.log(`mock JWKS on ${ISSUER}/jwks`));
