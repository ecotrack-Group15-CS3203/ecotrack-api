-- A real, previously-latent bug, found live while testing 0018: Postgres custom GUCs
-- (any 'app.*' name, since none of these are registered extension parameters) are
-- session-scoped placeholders, not truly stateless. The FIRST time a name is ever
-- referenced in a session, current_setting(name, true) correctly returns NULL. But
-- once ANYTHING sets it — even via set_config(..., true) ("SET LOCAL", reverting at
-- COMMIT) — the placeholder now exists for the rest of that session, and it reverts
-- to '' (empty string), not back to NULL:
--
--   BEGIN; SELECT set_config('app.probe', 'true', true); COMMIT;
--   BEGIN; SELECT current_setting('app.probe', true);    -- '' , not NULL
--
-- TenantInterceptor's four core flags (app.current_tenant, app.current_user_id,
-- app.is_org_admin, app.is_platform_admin) never hit this: they're set to a real
-- value on EVERY request, unconditionally, so they're never in the "was set once,
-- now reverted" state. The three ad-hoc escape flags are different — they're only
-- set by the specific handful of methods that need them, so any OTHER request that
-- later reuses the same pooled connection sees the leftover '' from underneath.
-- ''::boolean is not NULL, it's a hard error ("invalid input syntax for type
-- boolean"), so any policy checking one of these three flags could 500 on a request
-- that has nothing to do with the feature that flag belongs to, depending entirely
-- on which pooled connection it happened to land on. This is why 0018 (which
-- reproduced it), 0011, 0012, 0015, and 0020 all need the same fix.
--
-- The fix is a plain string comparison instead of a cast: '' = 'true' and
-- NULL = 'true' both evaluate to false/NULL, never an error, so the ambiguity this
-- Postgres quirk introduces stops mattering. Every other clause in each policy is
-- reproduced unchanged.

ALTER POLICY "tenant_isolation" ON "invitations"
  USING (
    "organisation_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    OR current_setting('app.is_platform_admin', true)::boolean IS TRUE
    OR current_setting('app.invitation_token_lookup', true) = 'true'
  )
  WITH CHECK (
    "organisation_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    OR current_setting('app.is_platform_admin', true)::boolean IS TRUE
    OR current_setting('app.invitation_token_lookup', true) = 'true'
  );

ALTER POLICY "tenant_isolation" ON "invite_links"
  USING (
    "organisation_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    OR current_setting('app.is_platform_admin', true)::boolean IS TRUE
    OR current_setting('app.invitation_token_lookup', true) = 'true'
  )
  WITH CHECK (
    "organisation_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    OR current_setting('app.is_platform_admin', true)::boolean IS TRUE
    OR current_setting('app.invitation_token_lookup', true) = 'true'
  );

ALTER POLICY "tenant_isolation" ON "audit_logs"
  USING (
    "organisation_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    OR current_setting('app.is_platform_admin', true)::boolean IS TRUE
    OR current_setting('app.invitation_token_lookup', true) = 'true'
    OR current_setting('app.join_request_submission', true) = 'true'
  )
  WITH CHECK (
    "organisation_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    OR "organisation_id" IS NULL
    OR current_setting('app.is_platform_admin', true)::boolean IS TRUE
    OR current_setting('app.invitation_token_lookup', true) = 'true'
    OR current_setting('app.join_request_submission', true) = 'true'
  );

ALTER POLICY "notifications_insert" ON "notifications"
  WITH CHECK (
    "user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    OR "organisation_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    OR current_setting('app.is_platform_admin', true)::boolean IS TRUE
    OR current_setting('app.join_request_submission', true) = 'true'
  );

ALTER POLICY "incidents_public_map" ON "incidents"
  USING (current_setting('app.public_map_read', true) = 'true');

ALTER POLICY "tenant_isolation" ON "incident_images"
  USING (
    EXISTS (
      SELECT 1 FROM "incidents" i
      WHERE i.id = "incident_images"."incident_id"
        AND (
          i.organisation_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
          OR (i.organisation_id IS NULL AND current_setting('app.is_org_admin', true)::boolean IS TRUE)
          OR i.reported_by_user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
          OR current_setting('app.is_platform_admin', true)::boolean IS TRUE
          OR current_setting('app.public_map_read', true) = 'true'
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "incidents" i
      WHERE i.id = "incident_images"."incident_id"
        AND (
          i.organisation_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
          OR i.organisation_id IS NULL
          OR current_setting('app.is_platform_admin', true)::boolean IS TRUE
        )
    )
  );
