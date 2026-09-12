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

export interface GeographyPoint {
  lat: number;
  lng: number;
}

/**
 * Decodes a (E)WKB-as-hex Point, the wire format Postgres/PostGIS returns geography
 * columns in by default (e.g. "0101000020E6100000..."). Handles both byte orders,
 * though Postgres always emits little-endian in practice; the SRID flag (0x20000000
 * on the type word) is read but not validated against 4326, since that's already
 * DB-engine-enforced by the CHECK constraint in migration 0001.
 *
 * Layout: 1 byte byte-order, 4 bytes type+flags, [4 bytes SRID if flagged],
 * 8 bytes X (lng), 8 bytes Y (lat) — all in the declared byte order.
 */
function parseWkbPoint(hex: string): GeographyPoint {
  const buf = Buffer.from(hex, 'hex');
  const little = buf.readUInt8(0) === 1;
  const typeAndFlags = little ? buf.readUInt32LE(1) : buf.readUInt32BE(1);
  const hasSrid = (typeAndFlags & 0x20000000) !== 0;
  const offset = hasSrid ? 9 : 5;
  const lng = little ? buf.readDoubleLE(offset) : buf.readDoubleBE(offset);
  const lat = little
    ? buf.readDoubleLE(offset + 8)
    : buf.readDoubleBE(offset + 8);
  return { lat, lng };
}

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
 * Writes: `toDriver` expects the EWKT text `toGeographyPoint()` builds
 * (`SRID=4326;POINT(lng lat)`), which Postgres/PostGIS parses directly on
 * INSERT/UPDATE.
 *
 * Reads: Postgres returns geography columns as WKB hex over the wire, not EWKT, so
 * `fromDriver` decodes it with `parseWkbPoint` into `{lat, lng}` — every ORM read of
 * a geography column (e.g. `organisations.serviceAreaCenter`, `incidents.location`)
 * comes back as usable coordinates, not a hex string.
 *
 * This does NOT change how spatial predicates are computed — `ST_DWithin`/
 * `ST_Distance`/`ST_Y`/`ST_X` are still always raw `sql` fragments in the service
 * layer. But it means a `{lat,lng}` value read this way can no longer be
 * re-interpolated as `${value}::geography` in a raw SQL fragment (it's an object, not
 * driver data) — rebuild the EWKT with `toGeographyPoint(value.lat, value.lng)`
 * first. See incident-pool.service.ts and dashboard.service.ts for the two places
 * that do this.
 */
export const geographyPoint = (columnName: string) =>
  customType<{ data: GeographyPoint; driverData: string }>({
    dataType() {
      return 'geography';
    },
    toDriver(value: GeographyPoint) {
      return toGeographyPoint(value.lat, value.lng);
    },
    fromDriver(value: string) {
      return parseWkbPoint(value);
    },
  })(columnName);

/** Builds the EWKT string Postgres expects on write, from separate lat/lng inputs. */
export function toGeographyPoint(lat: number, lng: number): string {
  return `SRID=4326;POINT(${lng} ${lat})`;
}
