-- GET /v1/organisations/public (SRS 3.1.14) filters by whether an organisation's
-- service area covers the caller — an ST_DWithin against service_area_center on
-- every active organisation. Without a spatial index that is a sequential scan
-- computing a geography distance per row, which is exactly the shape
-- incidents_location_gist already exists to avoid on the incident side.
CREATE INDEX IF NOT EXISTS "organisations_service_area_center_gist"
  ON "organisations" USING GIST ("service_area_center");

-- The same endpoint's ?q= filter is a leading-wildcard ILIKE, which no btree index
-- can serve. At prototype scale (tens of organisations) the seq scan is irrelevant,
-- but pg_trgm keeps it that way as the directory grows and costs nothing now.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS "organisations_name_trgm"
  ON "organisations" USING GIN ("name" gin_trgm_ops);
