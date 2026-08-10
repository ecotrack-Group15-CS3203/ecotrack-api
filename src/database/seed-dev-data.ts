import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';
import { toGeographyPoint } from './schema/columns.helpers';

/**
 * Seeds one organisation (with a service area, so pool-claim queries have something
 * to match against) and one mock org_admin user, keyed by a placeholder
 * `authSubject`. This is only useful for exercising DB logic directly (Drizzle
 * Studio, manual SQL, integration tests) — it does NOT let you log in through the
 * actual app, since that requires a real Asgardeo token whose `sub` claim matches a
 * `users.auth_subject` value. Until Milestone 1 (Asgardeo console setup) is done,
 * there is no way to mint such a token. Replaces the old seed-platform-admin.ts,
 * which is obsolete under delegated auth (no passwords to seed).
 */
async function run() {
  // Connects as the migrator (superuser) role, not the RLS-restricted runtime
  // DB_USER — seeding is an administrative operation with no per-request tenant
  // context to set, so it needs to bypass RLS the same way real DDL/migrations do.
  const pool = new Pool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_MIGRATOR_USER ?? process.env.DB_USER,
    password: process.env.DB_MIGRATOR_PASSWORD ?? process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  const db = drizzle(pool, { schema });

  const [org] = await db
    .insert(schema.organisations)
    .values({
      name: 'Kelani River Conservation Society',
      description: 'Dev seed organisation',
      contactEmail: 'admin@example.com',
      serviceAreaCenter: toGeographyPoint(6.9271, 79.8612), // Colombo
      serviceAreaRadiusKm: 10,
    })
    .returning();

  const [admin] = await db
    .insert(schema.users)
    .values({
      authSubject: 'dev-seed-org-admin',
      email: 'admin@example.com',
      fullName: 'Dev Seed Admin',
      role: 'org_admin',
      organisationId: org.id,
    })
    .returning();

  // WorkflowStagesService.seedDefaultStages isn't reachable from a standalone script
  // without spinning up Nest DI, so its 5-stage default set is duplicated here —
  // keep these two lists in sync if the defaults ever change (see
  // modules/workflow/workflow-stages.service.ts's DEFAULT_WORKFLOW_STAGES).
  const stages = [
    { name: 'Reported', color: '#EF4444' },
    { name: 'Claimed', color: '#F59E0B' },
    { name: 'Cleanup Scheduled', color: '#3B82F6' },
    { name: 'Resolved', color: '#22C55E' },
    { name: 'Dismissed', color: '#6B7280' },
  ];
  await db.insert(schema.workflowStages).values(
    stages.map((stage, position) => ({
      organisationId: org.id,
      name: stage.name,
      slug: stage.name.toLowerCase().replace(/\s+/g, '_'),
      color: stage.color,
      position,
      isFinal: stage.name === 'Resolved' || stage.name === 'Dismissed',
    })),
  );

  console.log(
    `Seeded organisation ${org.id} (${org.name}) with admin ${admin.id} (${admin.email}).`,
  );
  console.log(
    'Note: this admin cannot log in until Milestone 1 (Asgardeo) is complete.',
  );
  await pool.end();
}

run().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
