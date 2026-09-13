-- incident_images has carried no RLS policy at all since it was created — unlike
-- users/organisations, which are deliberately tenant-agnostic (SRS 3.1.19), this
-- table IS multi-tenant, so its absence here was a gap, not a decision. Without it,
-- a bug anywhere in the application layer could read or write another org's
-- incident photos with nothing at the database level to stop it.
--
-- It carries no organisation_id of its own (unlike tasks' child tables, which
-- denormalize one for exactly this reason), so visibility has to be derived via a
-- subquery against its parent incident — and that subquery must mirror every
-- branch of incidents' own tenant_isolation policy, public_map_read escape
-- included: findNearby's thumbnail subquery (incidents.service.ts) reads this
-- table under that exact flag, and would silently start returning nulls for every
-- cross-tenant pin if this policy were narrower than incidents' own.
ALTER TABLE "incident_images" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "incident_images" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "incident_images"
  USING (
    EXISTS (
      SELECT 1 FROM "incidents" i
      WHERE i.id = "incident_images"."incident_id"
        AND (
          i.organisation_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
          OR (i.organisation_id IS NULL AND current_setting('app.is_org_admin', true)::boolean IS TRUE)
          OR i.reported_by_user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
          OR current_setting('app.is_platform_admin', true)::boolean IS TRUE
          OR current_setting('app.public_map_read', true)::boolean IS TRUE
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
