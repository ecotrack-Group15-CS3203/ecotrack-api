-- SRS 3.1.4: proximity alerts. notification_preferences (jsonb) already covers the
-- three feature-specific push toggles; the radius and urgency threshold are
-- per-user scalars checked on every incident-creation match query, so plain typed
-- columns rather than more jsonb keys.
ALTER TABLE "users"
  ADD COLUMN "notification_radius_meters" integer NOT NULL DEFAULT 10000,
  ADD COLUMN "notification_min_urgency" "incident_severity" NOT NULL DEFAULT 'high',
  ADD COLUMN "alert_center" "geography",
  ADD COLUMN "alert_center_updated_at" timestamp with time zone;

-- Fixed option set offered in the UI, same pattern as organisations'
-- service_area_radius_km check in migration 0002.
ALTER TABLE "users"
  ADD CONSTRAINT "users_notification_radius_meters_check"
  CHECK ("notification_radius_meters" IN (1000, 5000, 10000, 25000, 50000));

-- alert_center gets the POINT/4326 CHECK home_location was never given (migration
-- 0010 added it as a bare `geography` column with no constraint) — not fixing that
-- gap here, but not repeating it either.
ALTER TABLE "users"
  ADD CONSTRAINT "users_alert_center_is_point_4326"
  CHECK (
    "alert_center" IS NULL
    OR (ST_SRID("alert_center") = 4326 AND GeometryType("alert_center") = 'POINT')
  );

-- Backs the ST_DWithin prefilter in the proximity-match query (a per-row radius
-- can't use the index directly, so the query tests a constant 50km max first).
CREATE INDEX "users_alert_center_gist" ON "users" USING GIST ("alert_center");
