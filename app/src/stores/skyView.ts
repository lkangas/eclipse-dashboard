// Real Sun/Moon/star alt-az for the live observer + clock (PLAN.md §7),
// recomputed reactively whenever either changes. Stars come from the
// bundled src/data/stars.json catalog (HYG, mag<3) -- their J2000
// ra/dec is fed to astronomy-engine's Horizon() directly rather than
// precessed to date first; the resulting sub-degree error is well
// below what this flat, schematic (no photorealism) sky view needs.
//
// Sun/Moon also carry angularRadiusDeg (physical radius / topocentric
// distance -- Equator()'s .dist is already observer-corrected, not
// geocentric, which matters for the Moon specifically) and
// moonSunSeparationDeg (great-circle distance between their apparent
// positions), so the countdown schematic and any other consumer can
// render the *actual* current overlap instead of a fixed placeholder --
// plain two-body geometry, deliberately not astronomy-engine's own
// SearchLocalSolarEclipse: this project's single source of truth for
// eclipse *timing* is the Besselian/eclipse-calc pipeline (PLAN.md §14
// #4), so a second independent "when does the eclipse happen" source
// isn't wanted, even from a library that happens to offer one.
import { derived } from 'svelte/store';
import { Body, Equator, Horizon, Observer } from 'astronomy-engine';
import '../eclipse/astronomyEngineDeltaT';
import { observer } from './observer';
import { effectiveTime } from './clock';
import starsData from '../data/stars.json';

const SUN_RADIUS_KM = 696000;
const MOON_RADIUS_KM = 1737.4;
const KM_PER_AU = 149597870.7;

export interface AltAz {
  altitude: number;
  azimuth: number;
}

export interface BodyPosition extends AltAz {
  angularRadiusDeg: number;
}

export interface StarPosition extends AltAz {
  proper: string | null;
  mag: number;
  ci: number | null;
}

export interface SkyView {
  sun: BodyPosition;
  moon: BodyPosition;
  moonSunSeparationDeg: number;
  stars: StarPosition[];
}

// Small-angle approximation (angularRadius ~= physicalRadius / distance)
// -- well within schematic-view precision needs at these distances.
function angularRadiusDeg(physicalRadiusKm: number, distanceAu: number): number {
  const distanceKm = distanceAu * KM_PER_AU;
  return (physicalRadiusKm / distanceKm) * (180 / Math.PI);
}

function angularSeparationDeg(a: AltAz, b: AltAz): number {
  const toRad = Math.PI / 180;
  const alt1 = a.altitude * toRad,
    alt2 = b.altitude * toRad,
    az1 = a.azimuth * toRad,
    az2 = b.azimuth * toRad;
  const cosSep =
    Math.sin(alt1) * Math.sin(alt2) + Math.cos(alt1) * Math.cos(alt2) * Math.cos(az1 - az2);
  return Math.acos(Math.min(1, Math.max(-1, cosSep))) * (180 / Math.PI);
}

export const skyView = derived([observer, effectiveTime], ([$observer, $now]): SkyView => {
  const astroObserver = new Observer($observer.lat, $observer.lon, $observer.elevationM);

  function bodyPosition(body: Body, physicalRadiusKm: number): BodyPosition {
    const eq = Equator(body, $now, astroObserver, true, true);
    const hor = Horizon($now, astroObserver, eq.ra, eq.dec, 'normal');
    return {
      altitude: hor.altitude,
      azimuth: hor.azimuth,
      angularRadiusDeg: angularRadiusDeg(physicalRadiusKm, eq.dist),
    };
  }

  const stars: StarPosition[] = starsData.stars.map((s) => {
    const hor = Horizon($now, astroObserver, s.ra, s.dec, 'normal');
    return { altitude: hor.altitude, azimuth: hor.azimuth, proper: s.proper, mag: s.mag, ci: s.ci };
  });

  const sun = bodyPosition(Body.Sun, SUN_RADIUS_KM);
  const moon = bodyPosition(Body.Moon, MOON_RADIUS_KM);

  return {
    sun,
    moon,
    moonSunSeparationDeg: angularSeparationDeg(sun, moon),
    stars,
  };
});
