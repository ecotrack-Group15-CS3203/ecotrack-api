# EcoTrack API

NestJS + TypeORM + PostgreSQL/PostGIS backend for EcoTrack — a multi-tenant platform for
community environmental incident reporting and cleanup coordination. Implements the
functional requirements in the EcoTrack SRS (v1.0): registration/auth, organisation
(tenant) management, incident reporting/verification, configurable workflow stages,
cleanup tasks, volunteer assignment, notifications, dashboards, and audit logging.

## Prerequisites

- Node.js 20+ and pnpm
- Docker Desktop (runs the local Postgres+PostGIS database — you do not need Postgres installed natively)

## Setup

```bash
pnpm install
cp .env.example .env   # adjust DB_PORT if 5432/5433 are already in use locally
docker compose up -d postgres
pnpm migration:run
```

Bootstrap the first platform administrator (only platform admins can create tenant
organisations, and public registration never creates one):

```bash
pnpm seed:platform-admin -- --email=admin@ecotrack.dev --password=changeme --name="Platform Admin"
```

Run the app:

```bash
pnpm start:dev
```

The API listens on `http://localhost:3000` (see `PORT` in `.env`). Uploaded incident/task
photos are served from `/uploads/...`. Interactive API docs (Swagger UI) are served at
`/api-docs`.

## Architecture

- **Multi-tenancy**: every organisation-scoped table carries an `organisation_id`. All
  organisation-scoped routes are nested under `/organisations/:organisationId/...`; a
  global `TenantGuard` re-validates the caller's membership (and that both the
  membership and the organisation are active) against the database on every request —
  nothing is trusted from the JWT beyond identity.
- **RBAC**: roles are `community_user`, `volunteer`, `org_admin` (per-organisation,
  via `OrganisationMember`) and a platform-wide `platform_admin` flag on `User`. Routes
  declare required roles with `@Roles(...)`; a global `RolesGuard` enforces them.
- **Auth**: JWT bearer tokens (`Authorization: Bearer <token>`), bcrypt-hashed
  passwords. Routes are protected by default — use `@Public()` to opt out.
- **Workflow**: each organisation gets a default set of workflow stages (Reported →
  Under Review → Verified → Cleanup Scheduled → In Progress → Resolved) on creation;
  org admins can reorder/add/remove stages. Incident verification is a separate gate
  (pending/approved/rejected/duplicate) from workflow stage progression.
- **Migrations**: schema changes are TypeORM migrations under
  `src/database/migrations` — never edit the schema via `synchronize`. See scripts
  below.

## Useful scripts

```bash
pnpm migration:generate src/database/migrations/SomeName   # after changing entities
pnpm migration:run
pnpm migration:revert
pnpm test          # unit tests
pnpm test:e2e       # e2e tests (needs the DB running)
pnpm lint
```

## Module map

| Module | Responsibility |
|---|---|
| `auth` | register/login/logout, JWT strategy |
| `users` | user accounts |
| `organisations` | tenants, memberships, invitations, platform admin endpoints |
| `workflow` | per-org configurable workflow stages |
| `incidents` | incident reporting, viewing, verification |
| `tasks` | cleanup tasks, volunteer assignment, progress tracking |
| `notifications` | in-app notification records |
| `audit` | audit log of significant actions |
| `dashboard` | organisation summary stats + incident map data |
