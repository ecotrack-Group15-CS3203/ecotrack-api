import { sql, SQL } from 'drizzle-orm';

/**
 * Deliberately lower than the true length of a degree anywhere on the WGS84
 * spheroid (110,574 m for latitude at the equator, 111,320·cos φ m for longitude),
 * so a box derived from it is always slightly *larger* than the search circle. The
 * box only pre-filters; ST_DWithin still makes the exact decision, so erring large
 * costs a few extra rows and erring small would silently drop real results.
 */
const METERS_PER_DEGREE_LOWER_BOUND = 110_000;

export interface BoundingBox {
  minLat: number;
  maxLat: number;
  /** Absent when the box spans a pole or the antimeridian: no longitude filter. */
  minLng?: number;
  maxLng?: number;
}

export function boundingBox(
  lat: number,
  lng: number,
  radiusMeters: number,
): BoundingBox {
  const dLat = radiusMeters / METERS_PER_DEGREE_LOWER_BOUND;
  const minLat = Math.max(lat - dLat, -90);
  const maxLat = Math.min(lat + dLat, 90);

  // A degree of longitude is shortest at the box edge farthest from the equator,
  // so size the longitude span there.
  const farthestLat = Math.max(Math.abs(minLat), Math.abs(maxLat));
  if (farthestLat >= 89) return { minLat, maxLat };
  const dLng =
    radiusMeters /
    (METERS_PER_DEGREE_LOWER_BOUND * Math.cos((farthestLat * Math.PI) / 180));
  if (lng - dLng < -180 || lng + dLng > 180) return { minLat, maxLat };

  return { minLat, maxLat, minLng: lng - dLng, maxLng: lng + dLng };
}

/**
 * `AND`-able predicate on migration 0032's `location_lat`/`location_lng` columns.
 * Always pair it with the exact ST_DWithin check — see migration 0032 for why RLS
 * makes this necessary. `alias` is a fixed table alias from the calling query,
 * never user input.
 */
export function withinBoundingBox(
  lat: number,
  lng: number,
  radiusMeters: number,
  alias?: string,
): SQL {
  const box = boundingBox(lat, lng, radiusMeters);
  const col = (name: string) => sql.raw(alias ? `${alias}.${name}` : name);
  const latFilter = sql`${col('location_lat')} BETWEEN ${box.minLat} AND ${box.maxLat}`;
  return box.minLng === undefined
    ? latFilter
    : sql`${latFilter} AND ${col('location_lng')} BETWEEN ${box.minLng} AND ${box.maxLng}`;
}
