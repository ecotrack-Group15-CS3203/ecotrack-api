import type { NestApplicationOptions, INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';

/**
 * JSON is the only request body format this API accepts. Nest would otherwise also
 * parse `application/x-www-form-urlencoded` on every route, via `qs`, before any
 * guard runs — parsing no client needs, reachable without authentication, and the
 * source of several `qs` denial-of-service advisories. Media never goes through the
 * API (clients upload straight to S3), so no multipart parser is registered either.
 *
 * Used by both main.ts and the e2e harness, so tests exercise the same parsers
 * production runs.
 */
export const NEST_APP_OPTIONS: NestApplicationOptions = { bodyParser: false };

export function registerBodyParsers(app: INestApplication): void {
  // Same defaults Nest's built-in JSON parser uses (100 kB limit).
  (app as NestExpressApplication).useBodyParser('json');
}
