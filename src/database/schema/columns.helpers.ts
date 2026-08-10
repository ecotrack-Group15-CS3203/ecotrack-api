import { customType, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Every table's id/createdAt/updatedAt triple — spread into each pgTable(), replaces TypeORM's BaseEntity. */
export const baseColumns = {
  id: uuid('id').primaryKey().defaultRandom(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
};

/**
 * A PostGIS `geography` column, always holding a Point in SRID 4326.
 *
 * Drizzle's pg-core does not ship a `geography()` column builder, so this uses the
 * documented `customType` escape hatch. The column is declared as bare `geography`
 * (no `(Point, 4326)` type modifier) deliberately: drizzle-kit's SQL generator only
 * recognizes a fixed allowlist of native PostGIS types for unquoted output — it
 * includes `geometry` but NOT `geography` (confirmed against the installed
 * drizzle-kit build), so any modifier syntax like `geography(Point, 4326)` gets
 * wrapped whole in double quotes and becomes invalid SQL. `geography` alone renders
 * as `"geography"`, which IS valid (quoting a plain type name is harmless).
 *
 * The Point/SRID-4326 constraint that the type modifier would normally enforce is
 * instead enforced by an explicit hand-written CHECK constraint per table (see
 * src/database/drizzle/migrations/0001_constraints_and_indexes.sql) — arguably more
 * explicit than a type modifier anyway, and it's DB-engine-enforced either way.
 *
 * Values are written/read as EWKT text (`SRID=4326;POINT(lng lat)`), which
 * Postgres/PostGIS parses and serializes directly on INSERT/UPDATE — no WKB/hex
 * decoding needed on our side for writes.
 *
 * Reads: Postgres returns geography columns as WKB hex by default over the wire, not
 * EWKT, so `fromDriver` intentionally does NOT try to parse it into {lat,lng} — that
 * would require a WKB parser we don't have. Any query that needs the actual
 * coordinates back out (map display, distance text, etc.) should select
 * `ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng` explicitly in a
 * raw SQL fragment instead of relying on this column's automatic deserialization.
 * Spatial predicates (ST_DWithin, ST_Distance) are likewise always raw `sql` fragments
 * in the service layer, not something the ORM abstracts.
 */
export const geographyPoint = (columnName: string) =>
  customType<{ data: string; driverData: string }>({
    dataType() {
      return 'geography';
    },
    toDriver(value: string) {
      return value; // caller passes 'SRID=4326;POINT(lng lat)' directly
    },
    fromDriver(value: string) {
      return value; // raw driver value, not decoded — see doc comment above
    },
  })(columnName);

/** Builds the EWKT string geographyPoint expects from separate lat/lng inputs. */
export function toGeographyPoint(lat: number, lng: number): string {
  return `SRID=4326;POINT(${lng} ${lat})`;
}
