import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { buildPgPoolConfig } from './pg-config';

/**
 * The password migration 0003 gives the runtime role when it creates it. Fine for
 * local Docker and CI; never acceptable in a deployment.
 */
const PLACEHOLDER_APP_PASSWORD = 'ecotrack_app';

/**
 * Runs pending Drizzle migrations. Used instead of the `drizzle-kit migrate` CLI,
 * which was found to fail silently (spinner renders, exits 1, prints no error) in
 * this environment — the underlying `drizzle-orm` migrator API used directly here
 * works reliably. Connects with the migrator credentials (falls back to the runtime
 * app credentials if unset — see env.validation.ts).
 */
async function run() {
  const appUser = process.env.DB_USER;
  const appPassword = process.env.DB_PASSWORD;
  if (
    process.env.NODE_ENV === 'production' &&
    appPassword === PLACEHOLDER_APP_PASSWORD
  ) {
    throw new Error(
      'DB_PASSWORD is still the development placeholder. Set a real password before migrating a production database.',
    );
  }

  const poolConfig = buildPgPoolConfig((key) => process.env[key], {
    migrator: true,
  });
  const pool = new Pool(poolConfig);
  const db = drizzle(pool);
  try {
    await migrate(db, {
      migrationsFolder: './src/database/drizzle/migrations',
    });
    console.log('Migrations applied successfully.');

    // Migration 0003 creates the runtime role with a fixed placeholder password, and
    // an applied migration never runs again. Re-asserting the password from
    // DB_PASSWORD on every run makes the env the source of truth: rotating it is
    // "change DB_PASSWORD, re-run migrations, restart the API". Skipped when the
    // migrator and runtime role are the same, since there is nothing to sync.
    if (appUser && appPassword && appUser !== poolConfig.user) {
      const {
        rows: [{ statement }],
      } = await pool.query<{ statement: string }>(
        `SELECT format('ALTER ROLE %I WITH PASSWORD %L', $1::text, $2::text) AS statement`,
        [appUser, appPassword],
      );
      await pool.query(statement);
      console.log(`Password for role "${appUser}" set from DB_PASSWORD.`);
    }
  } finally {
    await pool.end();
  }
}

run().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
