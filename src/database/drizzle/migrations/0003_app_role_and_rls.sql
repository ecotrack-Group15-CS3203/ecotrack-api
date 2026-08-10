-- Runtime app role: NOBYPASSRLS is the whole point — the docker-compose superuser
-- ("ecotrack") always bypasses RLS regardless of FORCE ROW LEVEL SECURITY, so the
-- app's connection pool must run as this role, not the migrator role, for RLS to mean
-- anything. Password is a dev-only placeholder; override via env in real deployments.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ecotrack_app') THEN
    CREATE ROLE ecotrack_app LOGIN PASSWORD 'ecotrack_app' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO ecotrack_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ecotrack_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ecotrack_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ecotrack_app;

-- organisations and users are deliberately NOT RLS-protected: per SRS 3.1.19, both are
-- tenant-agnostic tables (organisation directory search, cross-org user identity) —
-- privacy for user listings is enforced by the service layer selecting only public
-- columns, not by hiding rows.

-- incidents: the one table with a pool-visibility exception. Unclaimed rows
-- (organisation_id IS NULL) are visible to any org_admin session (to browse the pool)
-- and to the citizen who reported it (so "my reports" works pre-claim). Once claimed,
-- only the owning organisation's session may read/write the row.
ALTER TABLE "incidents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "incidents" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "incidents"
  USING (
    "organisation_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    OR ("organisation_id" IS NULL AND current_setting('app.is_org_admin', true)::boolean IS TRUE)
    OR "reported_by_user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    OR current_setting('app.is_platform_admin', true)::boolean IS TRUE
  )
  WITH CHECK (
    "organisation_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    OR "organisation_id" IS NULL
    OR current_setting('app.is_platform_admin', true)::boolean IS TRUE
  );

-- invitations: like incidents, mostly org-scoped (org_admin listing/creating
-- invitations for their own org) but with one legitimate cross-tenant access path —
-- redeeming an invite by its token has nothing to do with org membership, the secret
-- token itself IS the authorization (128-bit entropy, SRS 3.4.7). InvitationsService's
-- token-lookup methods explicitly set `app.invitation_token_lookup` for that one query
-- (see invitations.service.ts) rather than this being open to every request.
ALTER TABLE "invitations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invitations" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "invitations"
  USING (
    "organisation_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    OR current_setting('app.is_platform_admin', true)::boolean IS TRUE
    OR current_setting('app.invitation_token_lookup', true)::boolean IS TRUE
  )
  WITH CHECK (
    "organisation_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    OR current_setting('app.is_platform_admin', true)::boolean IS TRUE
    -- Also needed for the write side of token redemption (marking accepted_at) —
    -- not just the read side above. Scoped to the same narrow, explicitly-set flag.
    OR current_setting('app.invitation_token_lookup', true)::boolean IS TRUE
  );

-- Straightforward org-match tables: tasks and its three child tables (which carry a
-- denormalized organisation_id specifically so they don't need a subquery through
-- tasks — see tasks.schema.ts), workflow_stages.
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'tasks', 'task_assignments', 'task_notes', 'task_photos',
    'workflow_stages'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING (
           organisation_id = NULLIF(current_setting(''app.current_tenant'', true), '''')::uuid
           OR current_setting(''app.is_platform_admin'', true)::boolean IS TRUE
         )
         WITH CHECK (
           organisation_id = NULLIF(current_setting(''app.current_tenant'', true), '''')::uuid
           OR current_setting(''app.is_platform_admin'', true)::boolean IS TRUE
         )',
      tbl
    );
  END LOOP;
END
$$;

-- notifications: access is per-user (GET /notifications has no :organisationId param
-- at all — a user reads their own notifications regardless of which org they're in),
-- not per-org, so this policy keys on user_id instead of organisation_id.
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notifications" FORCE ROW LEVEL SECURITY;
CREATE POLICY "user_isolation" ON "notifications"
  USING ("user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
  WITH CHECK ("user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

-- audit_logs: organisation_id is nullable (platform-level actions have none) — those
-- rows are only visible to platform admins, same as any cross-org read here.
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "audit_logs"
  USING (
    "organisation_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    OR current_setting('app.is_platform_admin', true)::boolean IS TRUE
  )
  WITH CHECK (
    "organisation_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    OR "organisation_id" IS NULL
    OR current_setting('app.is_platform_admin', true)::boolean IS TRUE
  );
