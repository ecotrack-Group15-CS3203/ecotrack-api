import { boundingBox } from './spatial';

/** Point `distance` metres from (lat, lng) along `bearing` degrees, on a sphere. */
function destination(
  lat: number,
  lng: number,
  distance: number,
  bearing: number,
): { lat: number; lng: number } {
  const R = 6_371_008.8;
  const rad = Math.PI / 180;
  const δ = distance / R;
  const θ = bearing * rad;
  const φ1 = lat * rad;
  const λ1 = lng * rad;
  const φ2 = Math.asin(
    Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ),
  );
  const λ2 =
    λ1 +
    Math.atan2(
      Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
      Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2),
    );
  return { lat: φ2 / rad, lng: λ2 / rad };
}

describe('boundingBox', () => {
  // Colombo, Jaffna (Sri Lanka's northernmost city), and a high latitude where a
  // degree of longitude is much shorter.
  const centers = [
    [6.9271, 79.8612],
    [9.6615, 80.0255],
    [60, 10],
  ];
  const radii = [100, 10_000, 50_000];

  it.each(centers)(
    'contains every point on the search circle around (%f, %f)',
    (lat, lng) => {
      for (const radius of radii) {
        const box = boundingBox(lat, lng, radius);
        for (let bearing = 0; bearing < 360; bearing += 5) {
          const p = destination(lat, lng, radius, bearing);
          expect(p.lat).toBeGreaterThanOrEqual(box.minLat);
          expect(p.lat).toBeLessThanOrEqual(box.maxLat);
          expect(p.lng).toBeGreaterThanOrEqual(box.minLng!);
          expect(p.lng).toBeLessThanOrEqual(box.maxLng!);
        }
      }
    },
  );

  it('stays tight enough to be selective: under 2% wider than the circle', () => {
    const box = boundingBox(6.9271, 79.8612, 10_000);
    const north = destination(6.9271, 79.8612, 10_000, 0);
    expect((box.maxLat - 6.9271) / (north.lat - 6.9271)).toBeLessThan(1.02);
  });

  it('drops the longitude filter when the box would cross the antimeridian', () => {
    const box = boundingBox(0, 179.99, 10_000);
    expect(box.minLng).toBeUndefined();
    expect(box.maxLng).toBeUndefined();
  });

  it('drops the longitude filter near a pole, and clamps latitude to ±90', () => {
    const box = boundingBox(89.95, 0, 50_000);
    expect(box.maxLat).toBe(90);
    expect(box.minLng).toBeUndefined();
  });
});
