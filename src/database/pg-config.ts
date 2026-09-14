import { readFileSync } from 'fs';
import type { PoolConfig } from 'pg';

/**
 * One place that turns DB_* settings into a node-postgres pool config, shared by the
 * Nest pool (drizzle.provider.ts), the migration runner (migrate.ts) and drizzle-kit
 * (drizzle.config.ts). They previously each built their own, which is how TLS ended
 * up missing from all three at once.
 *
 * Takes a lookup function rather than an env object so the Nest provider can pass
 * ConfigService (Joi-validated, defaults applied) and the standalone scripts can pass
 * process.env.
 */
export type EnvLookup = (key: string) => string | number | boolean | undefined;

/**
 * - `disable`: plain TCP. Local Docker Postgres and CI, which have no certificate.
 * - `require`: encrypted, but the server certificate is not checked.
 * - `verify-full`: encrypted, certificate chain and hostname checked against
 *   DB_SSL_CA. Use this for RDS (CA bundle: global-bundle.pem).
 */
export const DB_SSL_MODES = ['disable', 'require', 'verify-full'] as const;

function read(lookup: EnvLookup, key: string): string | undefined {
  const value = lookup(key);
  return value === undefined || value === '' ? undefined : String(value);
}

export function buildSslOptions(lookup: EnvLookup): PoolConfig['ssl'] {
  const mode = read(lookup, 'DB_SSL') ?? 'disable';
  switch (mode) {
    case 'disable':
      return false;
    case 'require':
      return { rejectUnauthorized: false };
    case 'verify-full': {
      const caPath = read(lookup, 'DB_SSL_CA');
      if (!caPath) {
        throw new Error(
          'DB_SSL=verify-full needs DB_SSL_CA: the path to the server CA bundle (for RDS, global-bundle.pem).',
        );
      }
      // node-postgres passes the host as the TLS servername, so with
      // rejectUnauthorized the hostname is verified as well as the chain.
      return { rejectUnauthorized: true, ca: readFileSync(caPath, 'utf8') };
    }
    default:
      throw new Error(
        `Unknown DB_SSL "${mode}". Use one of: ${DB_SSL_MODES.join(', ')}.`,
      );
  }
}

/**
 * `migrator: true` connects as DB_MIGRATOR_USER (falling back to DB_USER), the role
 * that owns the schema. Everything else must connect as DB_USER, the NOBYPASSRLS
 * runtime role — see migration 0003.
 */
export function buildPgPoolConfig(
  lookup: EnvLookup,
  { migrator = false }: { migrator?: boolean } = {},
): PoolConfig {
  return {
    host: read(lookup, 'DB_HOST'),
    port: Number(read(lookup, 'DB_PORT') ?? 5432),
    user: migrator
      ? (read(lookup, 'DB_MIGRATOR_USER') ?? read(lookup, 'DB_USER'))
      : read(lookup, 'DB_USER'),
    password: migrator
      ? (read(lookup, 'DB_MIGRATOR_PASSWORD') ?? read(lookup, 'DB_PASSWORD'))
      : read(lookup, 'DB_PASSWORD'),
    database: read(lookup, 'DB_NAME'),
    ssl: buildSslOptions(lookup),
  };
}
