-- Enforce Point/SRID-4326 on the geography columns declared as bare `geography` in
-- schema/columns.helpers.ts (see that file's doc comment for why a type modifier
-- couldn't be used directly).
ALTER TABLE "incidents"
  ADD CONSTRAINT "incidents_location_is_point_4326"
  CHECK (ST_SRID("location") = 4326 AND GeometryType("location") = 'POINT');

ALTER TABLE "organisations"
  ADD CONSTRAINT "organisations_service_area_center_is_point_4326"
  CHECK (
    "service_area_center" IS NULL
    OR (ST_SRID("service_area_center") = 4326 AND GeometryType("service_area_center") = 'POINT')
  );

-- Service area radius is one of the fixed options offered in the UI (SRS 3.1.4/3.1.14).
ALTER TABLE "organisations"
  ADD CONSTRAINT "organisations_service_area_radius_km_check"
  CHECK ("service_area_radius_km" IS NULL OR "service_area_radius_km" IN (1, 5, 10, 25, 50));

-- Spatial index backing ST_DWithin radius queries (nearby-incidents, pool claim
-- eligibility) — required for SRS 3.4.1's p95 <= 500ms target at 10k+ incidents.
CREATE INDEX "incidents_location_gist" ON "incidents" USING GIST ("location");
