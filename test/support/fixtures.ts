import 'dotenv/config';
import { Pool } from 'pg';
import type { TestJwksServer } from './test-jwks-server';

/**
 * Seeds and tears down the rows an e2e spec needs, as the migrator role — fixtures
 * routinely need rows no single tenant session could legally write (two orgs, a
 * pooled incident, a platform admin), so they cannot go through RLS.
 *
 * Every row a suite creates is namespaced by its `prefix` (auth subjects, emails,
 * slugs), and cleanup() deletes by that prefix rather than by remembered IDs. A
 * suite that crashed half-way through a previous run therefore still gets cleaned
 * up, which is also why setup() starts with a cleanup(): a leftover unique email
 * or slug would otherwise fail the next run's inserts.
 */

export const migratorConfig = {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 5432),
  user: process.env.DB_MIGRATOR_USER ?? process.env.DB_USER,
  password: process.env.DB_MIGRATOR_PASSWORD ?? process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
};

/** EWKT for Colombo — inside every fixture org's default service area. */
export const COLOMBO = 'SRID=4326;POINT(79.8612 6.9271)';

export type FixtureRole = 'citizen' | 'volunteer' | 'org_admin';

export interface FixtureUser {
  id: string;
  sub: string;
  email: string;
  /** A valid 1-hour token for this user; present when Fixtures was given a JWKS server. */
  token: string;
}

export class Fixtures {
  readonly db: Pool;

  constructor(
    private readonly prefix: string,
    private readonly jwks?: TestJwksServer,
  ) {
    this.db = new Pool({ ...migratorConfig, max: 2 });
  }

  /** Clears leftovers from any earlier aborted run of this suite. */
  async setup(): Promise<void> {
    await this.cleanup();
  }

  async org(
    name: string,
    opts: { center?: string; radiusKm?: number } = {},
  ): Promise<string> {
    const slug = `${this.prefix}-${name}`;
    const { rows } = await this.db.query<{ id: string }>(
      `INSERT INTO organisations (name, slug, contact_email, service_area_center, service_area_radius_km)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [
        slug,
        slug,
        `${slug}@${this.domain}`,
        opts.center ?? COLOMBO,
        opts.radiusKm ?? 25,
      ],
    );
    return rows[0].id;
  }

  async user(
    key: string,
    opts: {
      role?: FixtureRole;
      organisationId?: string | null;
      isPlatformAdmin?: boolean;
      isActive?: boolean;
    } = {},
  ): Promise<FixtureUser> {
    const sub = this.subject(key);
    const email = `${sub}@${this.domain}`;
    const { rows } = await this.db.query<{ id: string }>(
      `INSERT INTO users (auth_subject, email, full_name, role, organisation_id, is_platform_admin, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        sub,
        email,
        key,
        opts.role ?? 'citizen',
        opts.organisationId ?? null,
        opts.isPlatformAdmin ?? false,
        opts.isActive ?? true,
      ],
    );
    return {
      id: rows[0].id,
      sub,
      email,
      token: this.jwks ? this.jwks.mintToken({ sub, email }) : '',
    };
  }

  /** An unclaimed (pooled) incident unless `organisationId` is given. */
  async incident(opts: {
    reporterId: string;
    organisationId?: string | null;
    title?: string;
    location?: string;
    /** NULL (the default) or 'approved' keeps it on the public map; anything else hides it. */
    verificationStatus?: 'approved' | 'rejected' | 'duplicate' | null;
  }): Promise<string> {
    const { rows } = await this.db.query<{ id: string }>(
      `INSERT INTO incidents (organisation_id, reported_by_user_id, title, description,
                              category, severity, location, verification_status)
       VALUES ($1, $2, $3, 'e2e fixture', 'other', 'low', $4, $5)
       RETURNING id`,
      [
        opts.organisationId ?? null,
        opts.reporterId,
        opts.title ?? `${this.prefix} incident`,
        opts.location ?? COLOMBO,
        opts.verificationStatus ?? null,
      ],
    );
    return rows[0].id;
  }

  /** Attaches a stored photo URL to an incident; removed with it by cleanup()'s cascade. */
  async incidentImage(incidentId: string, url: string): Promise<void> {
    await this.db.query(
      `INSERT INTO incident_images (incident_id, url) VALUES ($1, $2)`,
      [incidentId, url],
    );
  }

  /**
   * Auth subject for `key` under this suite's namespace. Also what a spec should
   * use when minting a token for a user it wants JIT-provisioned by JwtStrategy,
   * so cleanup() still catches the row the API creates.
   */
  subject(key: string): string {
    return `${this.prefix}-${key}`;
  }

  get domain(): string {
    return `${this.prefix}.e2e.test`;
  }

  async cleanup(): Promise<void> {
    const like = `${this.prefix}-%`;
    // Incidents first: they reference both users and organisations. Everything
    // hanging off an organisation (tasks, events, stages, invites) cascades from it.
    await this.db.query(
      `DELETE FROM incidents
        WHERE reported_by_user_id IN (SELECT id FROM users WHERE auth_subject LIKE $1)
           OR organisation_id IN (SELECT id FROM organisations WHERE slug LIKE $1)`,
      [like],
    );
    await this.db.query(`DELETE FROM organisations WHERE slug LIKE $1`, [like]);
    await this.db.query(`DELETE FROM users WHERE auth_subject LIKE $1`, [like]);
  }

  async close(): Promise<void> {
    await this.cleanup();
    await this.db.end();
  }
}
