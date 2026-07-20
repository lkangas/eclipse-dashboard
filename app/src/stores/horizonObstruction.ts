// Real terrain-horizon obstruction check (docs/HORIZON-PLAN.md): recomputes
// whenever the observer (or its local circumstances) changes, feeding both
// the SkyPanel Wide-view terrain silhouette and the Contacts-panel
// obstruction warning from one shared profile, so they can never show
// inconsistent answers about the same observer.
import { derived } from 'svelte/store';
import { observer } from './observer';
import { localCircumstances } from './localCircumstances';
import { sunAltAzAt } from './skyView';
import { elevationFineAt, elevationFineReady, loadElevationFine } from '../data/elevationFine';
import {
  checkHorizonObstruction,
  terrainHorizonProfile,
  type ContactObstruction,
  type ContactSunPosition,
  type HorizonPoint,
} from '../eclipse/horizon';

// Kick off the (memoized) fine-DEM load as soon as this store is first
// imported -- fire-and-forget; elevationFineReady below is what the
// derived actually reacts to, not this promise.
loadElevationFine();

export interface HorizonObstructionResult {
  profile: HorizonPoint[];
  contacts: ContactObstruction[];
  /** True if any named contact is predicted blocked by terrain. */
  anyObstructed: boolean;
  /** True while the 250m fine DEM is still loading (see data/
   * elevationFine.ts) -- consumers (SkyPanel) show a "Rendering
   * horizon..." indicator during this window rather than an empty
   * profile that looks identical to "no terrain nearby". */
  loading: boolean;
}

// Padding beyond the actual C1..sunset azimuth spread (docs/HORIZON-PLAN.md
// Sec2.1 step 1) -- generous enough to comfortably cover SkyPanel's own
// Wide-view rendering window too (camera FOV + margins, currently ~35deg
// total -- see SkyPanel.svelte), so this one shared profile can serve both
// consumers without either needing its own separate ray-march.
const AZIMUTH_PADDING_DEG = 25;

const CONTACT_KEYS = ['c1', 'c2', 'max', 'c3', 'c4', 'sunset'] as const;

const EMPTY_RESULT: HorizonObstructionResult = {
  profile: [],
  contacts: [],
  anyObstructed: false,
  loading: false,
};

export const horizonObstruction = derived(
  [observer, localCircumstances, elevationFineReady],
  ([$observer, $localCircumstances, $elevationFineReady]): HorizonObstructionResult => {
    if (!$elevationFineReady) {
      return { ...EMPTY_RESULT, loading: true };
    }

    const positions: ContactSunPosition[] = [];
    for (const key of CONTACT_KEYS) {
      const time = $localCircumstances[key];
      if (!time) continue;
      const altAz = sunAltAzAt(time, $observer.lat, $observer.lon, $observer.elevationM);
      positions.push({ key, time, altitudeDeg: altAz.altitude, azimuthDeg: altAz.azimuth });
    }
    if (positions.length === 0) return EMPTY_RESULT;

    // Unwrap every contact's azimuth relative to the first one (valid as
    // long as the whole spread is within 180deg of it, true for this
    // event's real ~10-20deg C1->sunset drift), then pad a plain min/max --
    // simpler and more robust than incrementally growing a running window.
    const refAz = positions[0].azimuthDeg;
    const unwrapped = positions.map((p) => {
      let d = p.azimuthDeg - refAz;
      if (d > 180) d -= 360;
      if (d < -180) d += 360;
      return refAz + d;
    });
    const azMinDeg = (((Math.min(...unwrapped) - AZIMUTH_PADDING_DEG) % 360) + 360) % 360;
    const azMaxDeg = (((Math.max(...unwrapped) + AZIMUTH_PADDING_DEG) % 360) + 360) % 360;

    const profile = terrainHorizonProfile(
      $observer.lat,
      $observer.lon,
      $observer.elevationM,
      azMinDeg,
      azMaxDeg,
      // The 250m Copernicus grid, not data/elevation.ts's coarse default --
      // elevationFineAt only returns null before elevationFineReady flips
      // true, which is already gated above, so the ?? 0 fallback here is
      // unreachable in practice, just satisfying the number-only signature.
      { elevationAt: (lat, lon) => elevationFineAt(lat, lon) ?? 0 },
    );
    const contacts = checkHorizonObstruction(profile, positions);

    return { profile, contacts, anyObstructed: contacts.some((c) => c.obstructed), loading: false };
  },
);
