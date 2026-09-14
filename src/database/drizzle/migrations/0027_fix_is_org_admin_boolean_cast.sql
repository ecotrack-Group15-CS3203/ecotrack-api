-- The same class of bug 0023 fixed, on a flag 0023 missed: `app.is_org_admin` is
-- cast directly (`current_setting(...)::boolean IS TRUE`, no NULLIF guard) in both
-- `incidents.tenant_isolation` (migration 0003, original) and
-- `incident_images.tenant_isolation` (migration 0020, and 0023's own reproduction
-- of it while fixing something else). SystemDbService now explicitly sets this
-- flag to 'false' on every system-initiated transaction, which is the real fix —
-- but this migration closes the same hole at the policy level too, so a future
-- caller of a bare pooled connection that forgets to set the flag degrades to
-- "not an org admin" instead of a 500.
ALTER POLICY "tenant_isolation" ON "incidents"
  USING (
    "organisation_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    OR ("organisation_id" IS NULL AND current_setting('app.is_org_admin', true) = 'true')
    OR "reported_by_user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    OR current_setting('app.is_platform_admin', true)::boolean IS TRUE
  )
  WITH CHECK (
    "organisation_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    OR "organisation_id" IS NULL
    OR current_setting('app.is_platform_admin', true)::boolean IS TRUE
  );

ALTER POLICY "tenant_isolation" ON "incident_images"
  USING (
    EXISTS (
      SELECT 1 FROM "incidents" i
      WHERE i.id = "incident_images"."incident_id"
        AND (
          i.organisation_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
          OR (i.organisation_id IS NULL AND current_setting('app.is_org_admin', true) = 'true')
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
