-- workflow_stage_rules: one row per org, standard tenant-match policy — same shape
-- as the tasks/workflow_stages loop in 0003_app_role_and_rls.sql. Written by hand in
-- its own migration because RLS isn't representable in Drizzle's TS schema DSL, same
-- reason 0003 exists as a separate migration from the table-creation ones.
ALTER TABLE "workflow_stage_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workflow_stage_rules" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "workflow_stage_rules"
  USING (
    "organisation_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    OR current_setting('app.is_platform_admin', true)::boolean IS TRUE
  )
  WITH CHECK (
    "organisation_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    OR current_setting('app.is_platform_admin', true)::boolean IS TRUE
  );
