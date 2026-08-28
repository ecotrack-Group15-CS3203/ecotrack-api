import 'dotenv/config';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';
import { toGeographyPoint } from './schema/columns.helpers';

/**
 * Seeds the mid-eval demo dataset:
 *
 *  - a reporter citizen and 3 unclaimed incidents around Colombo, so the org admin's
 *    claimable pool has something in it the moment they register;
 *  - one organisation with a 25 km service area, for exercising org-scoped endpoints
 *    without going through registration.
 *
 * The demo itself does NOT rely on that seeded organisation — the admin registers
 * theirs live on camera (SRS 3.1.14), which is what makes the service-area matching
 * visible. The pooled incidents are the part the demo actually needs.
 *
 * Re-runnable: it deletes its own previous rows first (matched by the marker
 * auth_subjects and org name below), so it can be run repeatedly while rehearsing.
 *
 * Connects as the migrator role, since seeding writes rows across tenant boundaries
 * that no single tenant session could legally create — but it still sets the RLS
 * session variables explicitly rather than relying on that role bypassing RLS, because
 * on RDS it does not. See setSessionTenant below.
 *
 * NOTE: seeded users cannot log in until their `auth_subject` matches a real Asgardeo
 * `sub`. Until then, use them for direct DB/endpoint work; the demo accounts are
 * provisioned just-in-time on first real login instead.
 */

const SEED_SUBJECTS = ['dev-seed-org-admin', 'dev-seed-reporter'];
const SEED_ORG_NAME = 'Kelani River Conservation Society';

/** Colombo. Keep the demo incidents inside the seeded radius. */
const CENTER = { lat: 6.9271, lng: 79.8612 };
const SERVICE_RADIUS_KM = 25;

const DEMO_INCIDENTS = [
  {
    title: 'Illegal dumping near the canal bank',
    description:
      'Household waste and construction debris piled along the canal, partially blocking the water flow.',
    category: 'illegal_dumping' as const,
    severity: 'high' as const,
    offset: { lat: 0.004, lng: 0.003 },
    address: 'Canal Road, Colombo',
  },
  {
    title: 'Oil sheen on the lake surface',
    description:
      'Visible oil film spreading across roughly ten metres of the shoreline near the pumping station.',
    category: 'water_pollution' as const,
    severity: 'critical' as const,
    offset: { lat: -0.008, lng: 0.006 },
    address: 'Lakeside, Colombo',
  },
  {
    title: 'Burning of plastic waste in open lot',
    description:
      'Someone is burning plastic in a vacant lot most evenings; heavy smoke drifts into nearby housing.',
    category: 'air_pollution' as const,
    severity: 'medium' as const,
    offset: { lat: 0.011, lng: -0.007 },
    address: 'Vacant lot, Colombo',
  },
];

async function run() {
  const pool = new Pool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_MIGRATOR_USER ?? process.env.DB_USER,
    password: process.env.DB_MIGRATOR_PASSWORD ?? process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  const client = await pool.connect();

  /**
   * Sets this connection's RLS session variables for the writes that follow.
   *
   * Locally the migrator is a genuine superuser and bypasses RLS outright, so this is
   * a no-op. On Amazon RDS it is not — the master user holds `rds_superuser`, which is
   * not the same thing — and with `FORCE ROW LEVEL SECURITY` on every tenant table it
   * is subject to policies like any other role. Setting the variables explicitly makes
   * the seed behave identically in both places, and avoids depending on `BYPASSRLS`,
   * which cannot be granted on RDS anyway.
   *
   * Session-scoped (`false`), not transaction-scoped: this is a single short-lived
   * connection owned entirely by this script, and the tenant changes partway through
   * once the organisation exists.
   */
  const setSessionTenant = (
    organisationId: string | null,
    isOrgAdmin = false,
  ) =>
    client.query(
      `SELECT set_config('app.current_tenant', $1, false),
              set_config('app.is_org_admin', $2, false),
              set_config('app.current_user_id', '', false),
              set_config('app.is_platform_admin', 'false', false)`,
      [organisationId ?? '', String(isOrgAdmin)],
    );

  const db = drizzle(client, { schema });

  // Deleting a previous run's pooled incidents means SELECTing them first, and the
  // incidents policy only exposes unclaimed rows to an org_admin session.
  await setSessionTenant(null, true);

  // --- clean up a previous run -------------------------------------------------
  const priorUsers = await db.query.users.findMany({
    where: inArray(schema.users.authSubject, SEED_SUBJECTS),
  });
  if (priorUsers.length > 0) {
    // Incidents cascade their images; users' incidents null out reported_by, so the
    // incidents themselves are removed explicitly first.
    await db.delete(schema.incidents).where(
      inArray(
        schema.incidents.reportedByUserId,
        priorUsers.map((u) => u.id),
      ),
    );
    await db.delete(schema.users).where(
      inArray(
        schema.users.id,
        priorUsers.map((u) => u.id),
      ),
    );
  }
  await db
    .delete(schema.organisations)
    .where(eq(schema.organisations.name, SEED_ORG_NAME));

  // --- organisation + admin ----------------------------------------------------
  const [org] = await db
    .insert(schema.organisations)
    .values({
      name: SEED_ORG_NAME,
      description: 'Dev seed organisation',
      contactEmail: 'admin@example.com',
      serviceAreaCenter: toGeographyPoint(CENTER.lat, CENTER.lng),
      serviceAreaRadiusKm: SERVICE_RADIUS_KM,
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

  // `workflow_stages` is RLS-scoped, so the session has to belong to the organisation
  // being seeded before its stages can be written — the same move
  // OrganisationsService.create makes after registering an org (TenantDbService.setTenant).
  await setSessionTenant(org.id, true);

  // WorkflowStagesService.seedDefaultStages isn't reachable from a standalone script
  // without spinning up Nest DI, so its default set is duplicated here — keep these
  // two lists in sync (see modules/workflow/workflow-stages.service.ts).
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

  // --- reporter + pooled incidents ---------------------------------------------
  const [reporter] = await db
    .insert(schema.users)
    .values({
      authSubject: 'dev-seed-reporter',
      email: 'reporter@example.com',
      fullName: 'Dev Seed Reporter',
      role: 'citizen',
    })
    .returning();

  for (const demo of DEMO_INCIDENTS) {
    const [incident] = await db
      .insert(schema.incidents)
      .values({
        // organisationId / verificationStatus / currentStageId all stay null: these
        // are pooled, unclaimed reports (SRS 3.1.21).
        reportedByUserId: reporter.id,
        title: demo.title,
        description: demo.description,
        category: demo.category,
        severity: demo.severity,
        address: demo.address,
        location: toGeographyPoint(
          CENTER.lat + demo.offset.lat,
          CENTER.lng + demo.offset.lng,
        ),
      })
      .returning();

    await db.insert(schema.incidentImages).values({
      incidentId: incident.id,
      // Placeholder: real photos arrive from mobile via the S3 presigned flow.
      url: `${process.env.S3_PUBLIC_URL ?? ''}/seed-placeholder.jpg`,
    });
  }

  console.log(
    `Seeded organisation ${org.id} (${org.name}, ${SERVICE_RADIUS_KM} km radius) with admin ${admin.email}.`,
  );
  console.log(
    `Seeded ${DEMO_INCIDENTS.length} unclaimed incidents in the pool, reported by ${reporter.email}.`,
  );
  console.log(
    'Seeded users cannot log in until their auth_subject matches a real Asgardeo sub.',
  );
  client.release();
  await pool.end();
}

run().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
