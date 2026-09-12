-- events / event_incidents / event_rsvps: unlike invite_links/join_requests, every
-- actor here (org_admin creating/managing, volunteer viewing/RSVPing) already
-- belongs to the org whose data they're touching — there is no citizen-with-no-org
-- case to carve an escape hatch for. Standard tenant-match policy on all three,
-- same shape as the tasks/workflow_stages loop in 0003_app_role_and_rls.sql.
-- organisation_id is denormalized onto event_incidents/event_rsvps from their
-- parent event for the same reason task_assignments denormalizes it from tasks.
ALTER TABLE "events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "events" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "events"
  USING (
    "organisation_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    OR current_setting('app.is_platform_admin', true)::boolean IS TRUE
  )
  WITH CHECK (
    "organisation_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    OR current_setting('app.is_platform_admin', true)::boolean IS TRUE
  );

ALTER TABLE "event_incidents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "event_incidents" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "event_incidents"
  USING (
    "organisation_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    OR current_setting('app.is_platform_admin', true)::boolean IS TRUE
  )
  WITH CHECK (
    "organisation_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    OR current_setting('app.is_platform_admin', true)::boolean IS TRUE
  );

ALTER TABLE "event_rsvps" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "event_rsvps" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "event_rsvps"
  USING (
    "organisation_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    OR current_setting('app.is_platform_admin', true)::boolean IS TRUE
  )
  WITH CHECK (
    "organisation_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    OR current_setting('app.is_platform_admin', true)::boolean IS TRUE
  );

-- Point/SRID-4326 CHECK, matching every other geography column
-- (0002_constraints_and_indexes.sql) — events.location is NOT NULL, unlike the
-- optional service_area_center/home_location, so no IS NULL branch is needed.
ALTER TABLE "events"
  ADD CONSTRAINT "events_location_is_point_4326"
  CHECK (ST_SRID("location") = 4326 AND GeometryType("location") = 'POINT');
