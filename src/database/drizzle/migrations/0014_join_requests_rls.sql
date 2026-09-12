-- join_requests: unlike invite_links/invitations (authorized by a secret token),
-- the submitter here has no secret — they're identified by being the row's own
-- user_id, mirroring incidents' `reported_by_user_id = current_user_id` branch
-- exactly (a citizen with no org can always act as themselves). Org admins get
-- the standard tenant-match branch for reviewing/approving their own org's
-- requests.
ALTER TABLE "join_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "join_requests" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "join_requests"
  USING (
    "organisation_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    OR "user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    OR current_setting('app.is_platform_admin', true)::boolean IS TRUE
  )
  WITH CHECK (
    "organisation_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    OR "user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    OR current_setting('app.is_platform_admin', true)::boolean IS TRUE
  );

-- SRS 3.1.11's "Duplicate Prevention": no second pending/approved request from the
-- same user to the same org. The application layer pre-checks this for a clean
-- error message; this partial unique index is the actual race-condition guard,
-- the same role task_assignments_task_volunteer_unique plays for assignments.
CREATE UNIQUE INDEX "join_requests_org_user_active_unique"
  ON "join_requests" ("organisation_id", "user_id")
  WHERE "status" IN ('pending', 'approved');

-- Closes a gap from migration 0010: every other geography column got this same
-- Point/SRID-4326 CHECK in 0002_constraints_and_indexes.sql when it was created;
-- users.home_location was added later (A9, invite links) and missed it.
ALTER TABLE "users"
  ADD CONSTRAINT "users_home_location_is_point_4326"
  CHECK (
    "home_location" IS NULL
    OR (ST_SRID("home_location") = 4326 AND GeometryType("home_location") = 'POINT')
  );
