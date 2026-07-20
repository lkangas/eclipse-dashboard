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
import { Atmosphere, Body, Equator, Horizon, Illumination, Observer } from 'astronomy-engine';
import '../eclipse/astronomyEngineDeltaT';
import { observer } from './observer';
import { effectiveTime } from './clock';
import starsData from '../data/stars.json';
import constellationLinesData from '../data/constellation-lines.json';

const SUN_RADIUS_KM = 696000;
const MOON_RADIUS_KM = 1737.4;
const KM_PER_AU = 149597870.7;

// Naked-eye planets (Uranus/Neptune never reach naked-eye brightness, so
// left out entirely rather than computed-then-filtered every tick).
// Real apparent magnitude, not a fixed per-body assumption, since it
// varies a lot -- Mercury in particular swings from bright to well below
// naked-eye visibility depending on its position in its orbit right now.
const PLANETS: { body: Body; name: string }[] = [
  { body: Body.Mercury, name: 'Mercury' },
  { body: Body.Venus, name: 'Venus' },
  { body: Body.Mars, name: 'Mars' },
  { body: Body.Jupiter, name: 'Jupiter' },
  { body: Body.Saturn, name: 'Saturn' },
];

// The constant astronomy-engine's own SearchRiseSet uses for the Sun/Moon
// (REFRACTION_NEAR_HORIZON in its source) -- not re-exported by the
// library, so duplicated here deliberately to stay byte-for-byte in sync
// with the convention SearchRiseSet (stores/localCircumstances.ts's
// sunset) actually uses, rather than the altitude-dependent 'normal'
// Horizon() refraction model, which gives a visibly different value at
// the shallow angles right at the horizon (see CountdownPanel.svelte's
// horizon-line comment for why the difference matters).
const REFRACTION_NEAR_HORIZON_DEG = 34 / 60;

export interface AltAz {
  altitude: number;
  azimuth: number;
}

export interface BodyPosition extends AltAz {
  angularRadiusDeg: number;
  /** Geometric (unrefracted) altitude -- see horizonDepressionDeg below. */
  altitudeTrueDeg: number;
}

export interface StarPosition extends AltAz {
  proper: string | null;
  mag: number;
  ci: number | null;
}

export interface PlanetPosition extends AltAz {
  name: string;
  mag: number;
}

export interface ConstellationLine {
  con: string;
  points: AltAz[];
}

export interface SkyView {
  sun: BodyPosition;
  moon: BodyPosition;
  moonSunSeparationDeg: number;
  stars: StarPosition[];
  planets: PlanetPosition[];
  constellationLines: ConstellationLine[];
  /** How far below the true geometric horizon (in degrees) a point needs
   * to be for standard refraction to bring it back up to the visible
   * horizon -- i.e. the Sun's true altitude at official sunset/sunrise is
   * -angularRadiusDeg - horizonDepressionDeg, matching SearchRiseSet's own
   * criterion exactly (same constant, same elevation-dependent atmosphere
   * density scaling). */
  horizonDepressionDeg: number;
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

/** Alt/az/angular-radius for `body` at an arbitrary instant, not just live
 * "now" -- the shared core both the reactive store below and one-off
 * per-event lookups (e.g. ContactsPanel's per-row Sun alt/az at each
 * contact time) go through, so they can't drift apart. */
export function bodyPositionAt(
  date: Date,
  astroObserver: Observer,
  body: Body,
  physicalRadiusKm: number,
): BodyPosition {
  const eq = Equator(body, date, astroObserver, true, true);
  const hor = Horizon(date, astroObserver, eq.ra, eq.dec, 'normal');
  const horTrue = Horizon(date, astroObserver, eq.ra, eq.dec, undefined);
  return {
    altitude: hor.altitude,
    azimuth: hor.azimuth,
    angularRadiusDeg: angularRadiusDeg(physicalRadiusKm, eq.dist),
    altitudeTrueDeg: horTrue.altitude,
  };
}

/** Sun alt/az at an arbitrary instant for a given observer -- e.g. each
 * contact time's own Sun position in ContactsPanel's timetable, as
 * opposed to skyView's live "now" value. */
export function sunAltAzAt(date: Date, lat: number, lon: number, elevationM: number): AltAz {
  const astroObserver = new Observer(lat, lon, elevationM);
  return bodyPositionAt(date, astroObserver, Body.Sun, SUN_RADIUS_KM);
}

/** Moon alt/az at an arbitrary instant for a given observer -- same pattern
 * as sunAltAzAt above, for callers that need the Moon's position at a
 * specific instant rather than skyView's live "now" value. */
export function moonAltAzAt(date: Date, lat: number, lon: number, elevationM: number): AltAz {
  const astroObserver = new Observer(lat, lon, elevationM);
  return bodyPositionAt(date, astroObserver, Body.Moon, MOON_RADIUS_KM);
}

export const skyView = derived([observer, effectiveTime], ([$observer, $now]): SkyView => {
  const astroObserver = new Observer($observer.lat, $observer.lon, $observer.elevationM);

  const stars: StarPosition[] = starsData.stars.map((s) => {
    const hor = Horizon($now, astroObserver, s.ra, s.dec, 'normal');
    return { altitude: hor.altitude, azimuth: hor.azimuth, proper: s.proper, mag: s.mag, ci: s.ci };
  });

  const sun = bodyPositionAt($now, astroObserver, Body.Sun, SUN_RADIUS_KM);
  const moon = bodyPositionAt($now, astroObserver, Body.Moon, MOON_RADIUS_KM);

  // Real apparent magnitude per planet (Illumination(), not a fixed
  // assumption) -- consumers filter by brightness themselves, same as
  // they already do for the pre-filtered (mag<3) star catalog above.
  const planets: PlanetPosition[] = PLANETS.map(({ body, name }) => {
    const eq = Equator(body, $now, astroObserver, true, true);
    const hor = Horizon($now, astroObserver, eq.ra, eq.dec, 'normal');
    return { altitude: hor.altitude, azimuth: hor.azimuth, name, mag: Illumination(body, $now).mag };
  });

  // Traditional IAU constellation stick-figures (All-sky view, direct
  // request), baked at build time from Stellarium's line topology
  // cross-referenced against HYG for ra/dec (tools/build-data/
  // constellations.mjs) -- most of these points are fainter than the
  // mag<3 star catalog above and won't have their own star dot, which is
  // fine: this only needs each point's real position, not its brightness.
  const constellationLines: ConstellationLine[] = constellationLinesData.lines.map((line) => ({
    con: line.con,
    points: line.points.map(([ra, dec]): AltAz => {
      const hor = Horizon($now, astroObserver, ra, dec, 'normal');
      return { altitude: hor.altitude, azimuth: hor.azimuth };
    }),
  }));

  return {
    sun,
    moon,
    moonSunSeparationDeg: angularSeparationDeg(sun, moon),
    stars,
    planets,
    constellationLines,
    horizonDepressionDeg: REFRACTION_NEAR_HORIZON_DEG * Atmosphere($observer.elevationM).density,
  };
});
