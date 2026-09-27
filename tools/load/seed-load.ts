import 'dotenv/config';
import { Pool } from 'pg';
import { buildPgPoolConfig } from '../../src/database/pg-config';

/**
 * Load-test dataset for SRS 3.4.1 / 3.4.2: 10,000 incidents spread uniformly over
 * Sri Lanka's bounding box, in a dedicated tenant so nothing touches real data.
 * Half are claimed by the load-test organisation (so its incident list is realistic),
 * half stay in the pool (so the public nearby map sees both). 50 tasks give the task
 * list something to page through.
 *
 *   pnpm exec ts-node tools/load/seed-load.ts      # then tools/load/cleanup-load.ts
 *
 * Connects as the migrator role: seeding writes across tenants, which RLS forbids
 * the runtime role (same approach as src/database/seed-dev-data.ts).
 */
export const LOAD = {
  orgSlug: 'load-test-tenant',
  adminSubject: 'load-test-admin',
  reporterSubject: 'load-test-reporter',
  volunteerSubject: 'load-test-volunteer',
  titlePrefix: 'LOADTEST',
  incidents: 10_000,
  tasks: 50,
};

async function main() {
  const pool = new Pool(
    buildPgPoolConfig((k) => process.env[k], { migrator: true }),
  );
  // Every query here returns (a subset of) these columns.
  type Row = { id: string; position: number; n: number };
  const q = (text: string, values?: unknown[]) => pool.query<Row>(text, values);
  try {
    await q('BEGIN');
    const org = await q(
      `INSERT INTO organisations (name, slug, contact_email, service_area_center, service_area_radius_km)
       VALUES ('Load Test Tenant', $1, 'load@e2e.test', 'SRID=4326;POINT(79.8612 6.9271)', 50)
       RETURNING id`,
      [LOAD.orgSlug],
    );
    const orgId: string = org.rows[0].id;
    const user = async (sub: string, role: string, orgRef: string | null) =>
      (
        await q(
          `INSERT INTO users (auth_subject, email, full_name, role, organisation_id)
           VALUES ($1, $2, $1, $3, $4) RETURNING id`,
          [sub, `${sub}@e2e.test`, role, orgRef],
        )
      ).rows[0].id;
    const adminId = await user(LOAD.adminSubject, 'org_admin', orgId);
    const reporterId = await user(LOAD.reporterSubject, 'citizen', null);
    const volunteerId = await user(LOAD.volunteerSubject, 'volunteer', orgId);

    const stage = await q(
      `INSERT INTO workflow_stages (organisation_id, name, slug, color, position, is_final)
       VALUES ($1,'Reported','reported','#9ca3af',0,false), ($1,'Claimed','claimed','#3b82f6',1,false),
              ($1,'Resolved','resolved','#22c55e',2,true)
       RETURNING id, position`,
      [orgId],
    );
    const claimedStage = stage.rows.find((r) => r.position === 1)!.id;

    // Uniform over Sri Lanka's bounding box (lat 5.9-9.9, lng 79.7-81.9).
    await q(
      `INSERT INTO incidents (organisation_id, reported_by_user_id, title, description, category,
                              severity, location, verification_status, current_stage_id, claimed_at)
       SELECT CASE WHEN g % 2 = 0 THEN $1::uuid END, $2, $3 || ' #' || g, 'load-test incident',
              (ARRAY['illegal_dumping','water_pollution','air_pollution','deforestation','other'])[1 + g % 5]::incident_category,
              (ARRAY['low','medium','high'])[1 + g % 3]::incident_severity,
              ST_SetSRID(ST_MakePoint(79.7 + random() * 2.2, 5.9 + random() * 4.0), 4326)::geography,
              CASE WHEN g % 2 = 0 THEN 'approved'::verification_status END,
              CASE WHEN g % 2 = 0 THEN $4::uuid END,
              CASE WHEN g % 2 = 0 THEN now() END
         FROM generate_series(1, $5::int) g`,
      [orgId, reporterId, LOAD.titlePrefix, claimedStage, LOAD.incidents],
    );
    const tasks = await q(
      `INSERT INTO tasks (organisation_id, incident_id, title, priority, due_date, created_by_user_id)
       SELECT $1, i.id, 'Load-test task ' || row_number() OVER (), 'medium', now() + interval '7 days', $2
         FROM incidents i WHERE i.organisation_id = $1 LIMIT $3
       RETURNING id`,
      [orgId, adminId, LOAD.tasks],
    );
    await q(
      `INSERT INTO task_assignments (organisation_id, task_id, volunteer_user_id, status)
       SELECT $1, t, $2, 'assigned' FROM unnest($3::uuid[]) t`,
      [orgId, volunteerId, tasks.rows.map((r) => r.id)],
    );
    await q('COMMIT');
    await q('ANALYZE incidents');
    const counts = await q('SELECT count(*)::int AS n FROM incidents');
    console.log(
      `Seeded org ${orgId}: ${LOAD.incidents} incidents, ${tasks.rowCount} tasks. ` +
        `incidents table now holds ${counts.rows[0].n} rows.`,
    );
    console.log(`ORG_ID=${orgId}`);
  } catch (err) {
    await q('ROLLBACK');
    throw err;
  } finally {
    await pool.end();
  }
}

if (require.main === module) void main();
