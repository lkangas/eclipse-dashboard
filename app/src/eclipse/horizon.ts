// Horizon obstruction check (docs/HORIZON-PLAN.md): does real terrain block
// the Sun's low path during the event? Two pure pieces: build a terrain-
// horizon profile around an observer from the bundled DEM
// (terrainHorizonProfile), then compare specific Sun positions against it
// (checkHorizonObstruction). Deliberately no astronomy-engine/Date-math
// dependency here -- the caller (stores/horizonObstruction.ts) supplies
// already-computed Sun alt/az per contact, so this stays pure geometry,
// fully unit-testable with synthetic elevation fixtures (see
// horizon.test.ts) the same way elements.ts/observer.ts are.
import { elevationAt } from '../data/elevation';

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
const EARTH_RADIUS_M = 6_371_000;

// Standard "7/6 effective Earth radius" approximation for combined
// curvature drop + terrestrial refraction, widely used in surveying and
// mountain-visibility calculations for standard atmospheric conditions.
// This is a DIFFERENT effect from the astronomical refraction applied to
// the Sun's own altitude elsewhere (stores/skyView.ts's Horizon(...,
// 'normal') call) -- that's refraction of light entering the atmosphere
// from space over the whole optical path; this is refraction along a much
// shorter, near-ground line of sight to distant terrain. Comparing this
// function's output directly against the Sun's already-refracted apparent
// altitude is still valid: both represent "what a human eye would actually
// see," each with the refraction physics appropriate to its own regime.
const REFRACTION_K = 7 / 6;
const EFFECTIVE_EARTH_RADIUS_M = EARTH_RADIUS_M * REFRACTION_K;

// Standing human eye height above the ground -- added to observerElevationM
// (ground level from the DEM/override) so a nearby low ridge isn't treated
// as if the observer's eye were at literal ground level.
export const EYE_HEIGHT_M = 1.7;

const DEFAULT_STEP_M = 250;
// Past this, only a genuinely enormous, very distant feature could still
// matter at this event's Sun altitudes (docs/HORIZON-PLAN.md Sec2.3's own
// table) -- capping here keeps the ray-march cheap without losing anything
// real for Iberia's terrain.
const DEFAULT_MAX_DISTANCE_M = 50_000;
const DEFAULT_AZIMUTH_STEP_DEG = 1;

/** Apparent elevation angle (degrees, positive = above the observer's true
 * horizontal plane) of a point `distanceM` away and `targetHeightM` above
 * sea level, seen by an observer whose eye is at `observerHeightM` above
 * sea level -- includes Earth's curvature drop and the standard
 * terrestrial-refraction correction described above. */
export function apparentElevationDeg(
  observerHeightM: number,
  targetHeightM: number,
  distanceM: number,
): number {
  const heightDiffM = targetHeightM - observerHeightM;
  const curvatureDropM = (distanceM * distanceM) / (2 * EFFECTIVE_EARTH_RADIUS_M);
  return Math.atan2(heightDiffM - curvatureDropM, distanceM) * RAD2DEG;
}

/** Destination point at `bearingDeg`/`distanceM` from `lat`/`lon`, via the
 * standard spherical direct-geodesic formula (mean Earth radius -- ample
 * precision for a ray-march over tens of km, unlike the shadow/eclipse
 * geometry elsewhere in this app which needs true ellipsoid precision). */
function destinationPoint(
  lat: number,
  lon: number,
  bearingDeg: number,
  distanceM: number,
): { lat: number; lon: number } {
  const angularDistance = distanceM / EARTH_RADIUS_M;
  const bearingRad = bearingDeg * DEG2RAD;
  const lat1 = lat * DEG2RAD;
  const lon1 = lon * DEG2RAD;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance) +
      Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearingRad),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(bearingRad) * Math.sin(angularDistance) * Math.cos(lat1),
      Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2),
    );

  return { lat: lat2 * RAD2DEG, lon: ((lon2 * RAD2DEG + 540) % 360) - 180 };
}

export interface HorizonPoint {
  azimuthDeg: number;
  /** Apparent terrain-horizon elevation angle at this azimuth -- see
   * apparentElevationDeg's own comment for what's included. */
  terrainAltitudeDeg: number;
}

export interface TerrainHorizonOptions {
  /** Ray-march sample spacing along each azimuth, meters. */
  stepM?: number;
  /** Ray-march cutoff distance, meters. */
  maxDistanceM?: number;
  /** Azimuth sample spacing, degrees. */
  azimuthStepDeg?: number;
  /** Ground elevation lookup (meters above sea level) -- defaults to the
   * real bundled DEM (data/elevation.ts's elevationAt), injectable so tests
   * can supply synthetic terrain (a flat plane, a single ring wall, etc.)
   * without needing the real grid. */
  elevationAt?: (lat: number, lon: number) => number;
}

/** Terrain-horizon profile around `lat`/`lon`, spanning `azMinDeg` to
 * `azMaxDeg` (walked in the increasing-azimuth direction, wrapping through
 * 360 if azMaxDeg < azMinDeg). For each azimuth, ray-marches outward and
 * keeps the single steepest apparent angle encountered -- a nearer, smaller
 * hill can beat a farther, taller mountain, so every sampled distance has to
 * be checked, not just the farthest one (docs/HORIZON-PLAN.md Sec2.1). */
export function terrainHorizonProfile(
  lat: number,
  lon: number,
  observerElevationM: number,
  azMinDeg: number,
  azMaxDeg: number,
  options: TerrainHorizonOptions = {},
): HorizonPoint[] {
  const stepM = options.stepM ?? DEFAULT_STEP_M;
  const maxDistanceM = options.maxDistanceM ?? DEFAULT_MAX_DISTANCE_M;
  const azimuthStepDeg = options.azimuthStepDeg ?? DEFAULT_AZIMUTH_STEP_DEG;
  const lookupElevation = options.elevationAt ?? elevationAt;
  const observerHeightM = observerElevationM + EYE_HEIGHT_M;

  const spanDeg = ((azMaxDeg - azMinDeg) % 360 + 360) % 360;
  const steps = Math.max(1, Math.round(spanDeg / azimuthStepDeg));

  const profile: HorizonPoint[] = [];
  for (let i = 0; i <= steps; i++) {
    const azimuthDeg = (((azMinDeg + i * azimuthStepDeg) % 360) + 360) % 360;
    let maxAngle = -90;
    for (let d = stepM; d <= maxDistanceM; d += stepM) {
      const { lat: rayLat, lon: rayLon } = destinationPoint(lat, lon, azimuthDeg, d);
      const terrainElevationM = lookupElevation(rayLat, rayLon);
      const angle = apparentElevationDeg(observerHeightM, terrainElevationM, d);
      if (angle > maxAngle) maxAngle = angle;
    }
    profile.push({ azimuthDeg, terrainAltitudeDeg: maxAngle });
  }
  return profile;
}

/** Interpolated terrain altitude at `queryAzimuthDeg` from `profile`.
 * Profile points are a contiguous walk (as terrainHorizonProfile produces),
 * so this first unwraps them into a monotonic sequence, then linearly
 * interpolates between the bracketing pair. Clamps to the nearest endpoint
 * if the query falls outside the profile's own span -- shouldn't happen
 * when the caller's azimuth window comfortably covers what it's checking,
 * but this avoids a wrong answer (or crash) either way. */
function interpolateTerrainAltitude(profile: HorizonPoint[], queryAzimuthDeg: number): number {
  if (profile.length === 0) return -90;
  if (profile.length === 1) return profile[0].terrainAltitudeDeg;

  const unwrapped: number[] = [profile[0].azimuthDeg];
  for (let i = 1; i < profile.length; i++) {
    let az = profile[i].azimuthDeg;
    while (az < unwrapped[i - 1]) az += 360;
    unwrapped.push(az);
  }

  const first = unwrapped[0];
  const last = unwrapped[unwrapped.length - 1];
  const mid = (first + last) / 2;
  // Bring the query into the same winding as the profile: try it as-is
  // and one full turn either way, keep whichever lands closest to the
  // profile's own midpoint.
  let query = queryAzimuthDeg;
  for (const candidate of [queryAzimuthDeg - 360, queryAzimuthDeg, queryAzimuthDeg + 360]) {
    if (Math.abs(candidate - mid) < Math.abs(query - mid)) query = candidate;
  }
  query = Math.min(last, Math.max(first, query));

  for (let i = 1; i < unwrapped.length; i++) {
    if (query <= unwrapped[i]) {
      const span = unwrapped[i] - unwrapped[i - 1];
      const t = span > 0 ? (query - unwrapped[i - 1]) / span : 0;
      return (
        profile[i - 1].terrainAltitudeDeg + t * (profile[i].terrainAltitudeDeg - profile[i - 1].terrainAltitudeDeg)
      );
    }
  }
  return profile[profile.length - 1].terrainAltitudeDeg;
}

export interface ContactSunPosition {
  /** Caller-supplied label (e.g. 'c1'/'c2'/'max'/'c3'/'c4'/'sunset') --
   * this module doesn't interpret it, just carries it through. */
  key: string;
  time: Date;
  altitudeDeg: number;
  azimuthDeg: number;
}

export interface ContactObstruction extends ContactSunPosition {
  terrainAltitudeDeg: number;
  /** True when the Sun's real altitude is at or below the terrain horizon
   * at its azimuth at this moment. */
  obstructed: boolean;
}

/** For each contact's already-known Sun position, checks it against the
 * terrain profile -- simpler and more directly useful than sampling a
 * continuous track and searching for a crossing (docs/HORIZON-PLAN.md
 * Sec2.2's original framing): the UI only ever needs a per-contact
 * clear/blocked answer ("C3 and C4 predicted blocked"), and every contact
 * time is already known exactly, so there's no need to interpolate *when*
 * obstruction begins -- only whether it's already true at each named
 * moment. */
export function checkHorizonObstruction(
  profile: HorizonPoint[],
  contacts: ContactSunPosition[],
): ContactObstruction[] {
  return contacts.map((c) => {
    const terrainAltitudeDeg = interpolateTerrainAltitude(profile, c.azimuthDeg);
    return { ...c, terrainAltitudeDeg, obstructed: c.altitudeDeg <= terrainAltitudeDeg };
  });
}
