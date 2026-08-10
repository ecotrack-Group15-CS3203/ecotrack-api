import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

/**
 * Runs pending Drizzle migrations. Used instead of the `drizzle-kit migrate` CLI,
 * which was found to fail silently (spinner renders, exits 1, prints no error) in
 * this environment — the underlying `drizzle-orm` migrator API used directly here
 * works reliably. Connects with the migrator credentials (falls back to the runtime
 * app credentials if unset — see env.validation.ts).
 */
async function run() {
  const pool = new Pool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_MIGRATOR_USER ?? process.env.DB_USER,
    password: process.env.DB_MIGRATOR_PASSWORD ?? process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  const db = drizzle(pool);
  try {
    await migrate(db, {
      migrationsFolder: './src/database/drizzle/migrations',
    });
    console.log('Migrations applied successfully.');
  } finally {
    await pool.end();
  }
}

run().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
