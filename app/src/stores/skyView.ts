// Real Sun/Moon/star alt-az for the live observer + clock (PLAN.md §7),
// recomputed reactively whenever either changes. Stars come from the
// bundled src/data/stars.json catalog (HYG, mag<3) -- their J2000
// ra/dec is fed to astronomy-engine's Horizon() directly rather than
// precessed to date first; the resulting sub-degree error is well
// below what this flat, schematic (no photorealism) sky view needs.
import { derived } from 'svelte/store';
import { Body, Equator, Horizon, Observer } from 'astronomy-engine';
import { observer } from './observer';
import { effectiveTime } from './clock';
import starsData from '../data/stars.json';

export interface AltAz {
  altitude: number;
  azimuth: number;
}

export interface StarPosition extends AltAz {
  proper: string | null;
  mag: number;
  ci: number | null;
}

export interface SkyView {
  sun: AltAz;
  moon: AltAz;
  stars: StarPosition[];
}

export const skyView = derived([observer, effectiveTime], ([$observer, $now]): SkyView => {
  const astroObserver = new Observer($observer.lat, $observer.lon, $observer.elevationM);

  function bodyAltAz(body: Body): AltAz {
    const eq = Equator(body, $now, astroObserver, true, true);
    const hor = Horizon($now, astroObserver, eq.ra, eq.dec, 'normal');
    return { altitude: hor.altitude, azimuth: hor.azimuth };
  }

  const stars: StarPosition[] = starsData.stars.map((s) => {
    const hor = Horizon($now, astroObserver, s.ra, s.dec, 'normal');
    return { altitude: hor.altitude, azimuth: hor.azimuth, proper: s.proper, mag: s.mag, ci: s.ci };
  });

  return {
    sun: bodyAltAz(Body.Sun),
    moon: bodyAltAz(Body.Moon),
    stars,
  };
});
