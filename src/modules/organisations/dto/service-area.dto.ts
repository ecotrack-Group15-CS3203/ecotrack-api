import { IsIn, IsLatitude, IsLongitude, IsNumber } from 'class-validator';

export class ServiceAreaCenterDto {
  @IsNumber()
  @IsLatitude()
  lat: number;

  @IsNumber()
  @IsLongitude()
  lng: number;
}

/** Fixed option set per SRS 3.1.4/3.1.14 — matches the proximity-alert radius options. */
export const SERVICE_AREA_RADIUS_OPTIONS_KM = [1, 5, 10, 25, 50] as const;

export function IsServiceAreaRadiusKm() {
  return IsIn(SERVICE_AREA_RADIUS_OPTIONS_KM);
}
