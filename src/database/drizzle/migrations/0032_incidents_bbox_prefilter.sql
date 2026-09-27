-- Bounding-box pre-filter columns for spatial queries on incidents.
--
-- Found by test/db-integrity.e2e-spec.ts: under RLS, the planner never uses
-- incidents_location_gist. Postgres only lets a query's own predicates into an index
-- scan ahead of the RLS policy's filter if they are LEAKPROOF, and PostGIS's
-- ST_DWithin / && are not. So the nearby map, the claimable pool and the dashboard
-- pool count each ran a sequential scan over every incident (10,000 rows read to
-- return ~40), whatever the index says.
--
-- Plain float8 comparisons are LEAKPROOF. These generated columns and their btree
-- index let those queries narrow to a lat/lng box first (see src/database/spatial.ts)
-- and apply the exact ST_DWithin check only to the rows inside it. The GiST index
-- stays: RLS-free callers (migrator, system jobs) still use it.
--
-- STORED generated columns: computed by Postgres on every insert/update of
-- `location`, so no application write path has to maintain them.
ALTER TABLE "incidents"
  ADD COLUMN "location_lat" double precision
    GENERATED ALWAYS AS (ST_Y("location"::geometry)) STORED,
  ADD COLUMN "location_lng" double precision
    GENERATED ALWAYS AS (ST_X("location"::geometry)) STORED;
--> statement-breakpoint
CREATE INDEX "incidents_location_lat_lng_idx"
  ON "incidents" ("location_lat", "location_lng");
