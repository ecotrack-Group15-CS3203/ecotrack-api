import 'dotenv/config';
import { Pool } from 'pg';
import { buildPgPoolConfig } from '../../src/database/pg-config';
import { LOAD } from './seed-load';

/** Removes everything seed-load.ts created. Safe to run more than once. */
async function main() {
  const pool = new Pool(
    buildPgPoolConfig((k) => process.env[k], { migrator: true }),
  );
  try {
    // Claimed incidents, tasks and stages go with the organisation (ON DELETE CASCADE);
    // pooled ones have no organisation, so they are removed by title.
    const pooled = await pool.query(
      `DELETE FROM incidents WHERE title LIKE $1`,
      [`${LOAD.titlePrefix} #%`],
    );
    await pool.query(`DELETE FROM organisations WHERE slug = $1`, [
      LOAD.orgSlug,
    ]);
    await pool.query(`DELETE FROM users WHERE auth_subject = ANY($1)`, [
      [LOAD.adminSubject, LOAD.reporterSubject, LOAD.volunteerSubject],
    ]);
    console.log(`Removed load-test tenant and ${pooled.rowCount} incidents.`);
  } finally {
    await pool.end();
  }
}

void main();
