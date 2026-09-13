-- The schema had exactly one non-key index before this (incidents_location_gist).
-- Paginating a list endpoint only makes its unindexed sequential scan sortable —
-- without these, LIMIT/OFFSET still reads and sorts every matching row before
-- discarding all but one page of them. Each pairs the column a list endpoint
-- filters on with the column it orders by, matching how each is actually queried.
CREATE INDEX IF NOT EXISTS "notifications_user_created_idx"
  ON "notifications" ("user_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "incidents_org_created_idx"
  ON "incidents" ("organisation_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "incidents_reporter_created_idx"
  ON "incidents" ("reported_by_user_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "tasks_org_status_idx"
  ON "tasks" ("organisation_id", "status");
CREATE INDEX IF NOT EXISTS "task_assignments_volunteer_status_idx"
  ON "task_assignments" ("volunteer_user_id", "status");
CREATE INDEX IF NOT EXISTS "events_org_scheduled_idx"
  ON "events" ("organisation_id", "scheduled_at");
CREATE INDEX IF NOT EXISTS "event_rsvps_user_idx"
  ON "event_rsvps" ("user_id");
CREATE INDEX IF NOT EXISTS "audit_logs_org_created_idx"
  ON "audit_logs" ("organisation_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "users_org_role_idx"
  ON "users" ("organisation_id", "role");
