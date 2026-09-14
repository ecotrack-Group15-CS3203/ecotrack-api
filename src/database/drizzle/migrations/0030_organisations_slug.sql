-- SRS 3.1.14: public organisation pages need a stable, URL-safe identifier —
-- the UUID id works but isn't something anyone should have to type or share.
-- Backfilled deterministically (slugified name + the first 8 hex chars of the
-- row's own id) so existing organisations get a real slug with zero chance of
-- collision, without needing a PL/pgSQL loop; OrganisationsService.create()
-- does nicer collision-checked slugs (bare slugified name, falling back to
-- name-2/name-3/... only if taken) for organisations created from here on.
ALTER TABLE "organisations" ADD COLUMN "slug" varchar(140);

UPDATE "organisations"
SET "slug" = lower(regexp_replace(trim(both '-' from regexp_replace("name", '[^a-zA-Z0-9]+', '-', 'g')), '-+', '-', 'g'))
             || '-' || substr("id"::text, 1, 8)
WHERE "slug" IS NULL;

ALTER TABLE "organisations" ALTER COLUMN "slug" SET NOT NULL;
ALTER TABLE "organisations" ADD CONSTRAINT "organisations_slug_unique" UNIQUE ("slug");
