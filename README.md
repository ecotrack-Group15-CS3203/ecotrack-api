# EcoTrack API

NestJS + Drizzle + PostgreSQL/PostGIS backend for EcoTrack — a multi-tenant platform for
community environmental incident reporting and cleanup coordination. Implements the
functional requirements in the EcoTrack SRS (v1.0): delegated authentication, organisation
(tenant) management, the Global Incident Pool and claiming, configurable workflow stages,
cleanup tasks, volunteer assignment, notifications, dashboards, and audit logging.

## Prerequisites

- Node.js 20+ and pnpm
- Docker (runs Postgres+PostGIS and MinIO locally — neither needs installing natively)

## Setup

```bash
pnpm install
cp .env.example .env          # adjust DB_PORT/PORT if those are taken locally
docker compose up -d          # postgres (:5434) + minio (:9000, console :9001)
pnpm db:migrate
pnpm db:seed                  # optional: an org + 3 unclaimed pool incidents
```

Authentication is delegated to WSO2 Asgardeo, so there is no local login. Until the real
tenant is configured, run the bundled mock issuer in a second terminal:

```bash
pnpm mock:jwks                # serves JWKS on :9999 and mints test tokens
```

```bash
# mint a token for any subject
curl "http://localhost:9999/token?sub=demo-user&email=demo@example.dev&name=Demo+User"
```

Run the app:

```bash
pnpm start:dev
```

The API listens on `http://localhost:4000` and serves everything under the `/v1` prefix
(`PORT` in `.env`). Interactive API docs (Swagger UI) are at `/api-docs`. Health check:
`GET /v1/health` — returns 503 rather than 200 when the database is unreachable, so it
works as a deployment gate.

## Asgardeo configuration

Three settings cause almost all integration failures here, and two of them are silent:

1. **Access tokens default to _opaque_.** Switch the application to issue **JWT** access
   tokens, or JWKS validation has nothing to validate.
2. **Custom claims go under _Access Token Attributes_.** `role` and `organizationId` must
   be added there specifically — the User Attributes tab is a different field, and setting
   it alone leaves the claims missing from the decoded token.
3. **Roles need _Organization_ audience**, not Application, if they're shared between the
   mobile and web clients. This cannot be changed after a role is created.

Point the API at the tenant with `OIDC_JWKS_URI` and `OIDC_ISSUER` (see `.env.example`).

> Note: the API does **not** trust the token's `role`/`organizationId` claims — it
> re-reads them from the `users` table on every request (`JwtStrategy.validate`), so a
> revoked membership takes effect immediately instead of lingering until the token
> expires. Backend-side, only `sub` and `email` need to be correct.

## Architecture

- **Multi-tenancy**: PostgreSQL Row-Level Security is the real boundary, not application
  code. Every request runs inside one transaction whose `app.current_tenant` /
  `app.current_user_id` session variables are set by `TenantInterceptor`; policies key off
  them. The runtime role (`ecotrack_app`) is `NOBYPASSRLS` — if the app ever connects as
  the migrator role, every policy silently stops applying.
- **Global Incident Pool**: `incidents.organisation_id` is nullable; `NULL` means
  unclaimed. Claiming is a single atomic `UPDATE ... WHERE organisation_id IS NULL`, so
  two organisations racing for the same incident resolve without locking — the loser
  matches zero rows and gets a 409.
- **RBAC**: roles are `citizen`, `volunteer`, `org_admin` (one organisation per user, held
  directly on the `users` row) plus a platform-wide `is_platform_admin` flag. Routes
  declare requirements with `@Roles(...)`; a global `RolesGuard` enforces them. Routes are
  protected by default — use `@Public()` to opt out.
- **Auth**: Asgardeo-issued JWTs validated RS256 against the live JWKS endpoint. No
  passwords are stored. Users are provisioned just-in-time on their first valid token.
- **Media**: photos go straight from client to S3 via presigned URLs
  (`POST /v1/media/upload-url`); no binary passes through the API. Local dev uses MinIO
  through the same code path.
- **Workflow**: each organisation gets five default stages on creation (Reported →
  Claimed → Cleanup Scheduled → Resolved / Dismissed); org admins can reorder, add and
  remove them.
- **Migrations**: Drizzle migrations under `src/database/drizzle/migrations`. RLS policies
  and CHECK constraints are hand-written SQL — `drizzle-kit` emits neither, so a new
  tenant-scoped table needs its policy added manually in the same migration.

See `ARCHITECTURE.md` for the full design, including the RLS policy taxonomy and the
conventions for adding tables and modules.

## Useful scripts

```bash
pnpm db:generate       # after changing src/database/schema — generates a migration
pnpm db:migrate        # apply pending migrations
pnpm db:seed           # demo dataset (re-runnable)
pnpm mock:jwks         # local Asgardeo stand-in
pnpm test              # unit tests
pnpm test:integration  # RLS + HTTP integration tests (needs the DB running)
pnpm lint
```

> `pnpm test:integration` connects as `ecotrack_app` on purpose. Running those tests as
> the migrator role would make every isolation assertion pass while proving nothing; the
> suite's first test asserts the role cannot bypass RLS for exactly that reason.

## Module map

| Module | Responsibility |
|---|---|
| `auth` | JWKS validation, JIT provisioning, profile, push token, invite redemption |
| `users` | user accounts and membership |
| `organisations` | tenant registration, service areas, members, invitations, platform endpoints |
| `workflow` | per-org configurable workflow stages |
| `incidents` | reporting, the pool, claiming, org-scoped review |
| `tasks` | cleanup tasks, volunteer assignment, progress tracking |
| `media` | S3 presigned upload/download URLs |
| `notifications` | in-app notification records + push dispatch |
| `audit` | audit log of significant actions |
| `dashboard` | organisation summary stats + incident map data |
| `health` | liveness and database connectivity check |
