import type { INestApplication } from '@nestjs/common';
import type { RequestHandler } from 'express';
import helmet from 'helmet';

/** Where main.ts mounts Swagger UI. Local only: nginx proxies nothing but /v1/. */
export const SWAGGER_PATH = 'api/docs';

/**
 * Response security headers (OWASP ZAP baseline findings). The API only ever
 * returns JSON, so its CSP forbids everything: a response can never run script
 * or be framed, even if one were somehow rendered as a page.
 *
 * Helmet also drops `X-Powered-By: Express` and sets nosniff, frame, referrer
 * and cross-origin headers. Two defaults are changed:
 * - HSTS off: nginx terminates TLS and sets it for the whole site, web and API
 *   alike; sending it here too would duplicate the header.
 * - Swagger UI is exempt from the CSP: it is an HTML page with inline scripts.
 *
 * Used by both main.ts and the e2e harness, like body-parsing.ts.
 */
export function registerSecurityHeaders(app: INestApplication): void {
  const strict = helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
    },
    strictTransportSecurity: false,
  });
  const forSwagger = helmet({
    contentSecurityPolicy: false,
    strictTransportSecurity: false,
  });

  const middleware: RequestHandler = (req, res, next) =>
    (req.path.startsWith(`/${SWAGGER_PATH}`) ? forSwagger : strict)(
      req,
      res,
      next,
    );
  app.use(middleware);
}
