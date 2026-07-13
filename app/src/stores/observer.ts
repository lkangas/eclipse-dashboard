// PLAN.md §5: one observer store, fed by manual entry, map click/drag,
// device geolocation, or serial GPS.
import { writable } from 'svelte/store';
import { elevationAt, isWithinElevationBounds } from '../data/elevation';

// 'gps' (serial NMEA, serial/connection.ts) and 'browser'
// (navigator.geolocation) are both wired up in TopBar's location-mode
// toggle group; 'manual' covers BOTH typed coordinates and map
// click/drag (merged into one "Manual (map)" mode, direct request);
// 'preset' is a named site picked from TopBar's dropdown.
export type ObserverSource = 'gps' | 'browser' | 'manual' | 'preset';

export interface Observer {
  lat: number;
  lon: number;
  elevationM: number;
  // True when lat/lon falls outside the bundled ETOPO grid (elevation.ts)
  // -- elevationM was defaulted to 0 rather than an edge-clamped guess,
  // and the UI should let the elevation box be hand-edited regardless of
  // source. Recomputed fresh on every setObserver() call (see there), so
  // it never lingers stale across a source switch or a repeat
  // geolocation request.
  elevationOutOfBounds: boolean;
  // True once the user has typed a real figure into that now-editable
  // box (setObserverElevation, below) -- the UI's out-of-bounds warning
  // shows only while this is false, since once they've supplied their
  // own number there's nothing left to warn about (elevationOutOfBounds
  // itself stays true so the box stays editable). Reset to false by
  // every setObserver() call, same as elevationOutOfBounds, so a fresh
  // location -- even a repeat one -- starts the warning over.
  elevationManuallySet: boolean;
  source: ObserverSource;
}

// Calamocha — this project's fixed default reference site, and the app's
// starting location-mode source: both gps and browser are opt-in
// (require the user to click their button and, for gps, pick/grant a
// serial port), so this is what's active until then (direct request).
// Elevation comes from the same bundled DEM lookup every other location
// uses (not a separate hardcoded constant), so it can't drift from the
// grid.
const CALAMOCHA: Observer = {
  lat: 40.92,
  lon: -1.3,
  elevationM: elevationAt(40.92, -1.3),
  elevationOutOfBounds: false,
  elevationManuallySet: false,
  source: 'preset',
};

export const observer = writable<Observer>(CALAMOCHA);

// Elevation is always looked up from lat/lon here -- the single choke
// point manual entry (TopBar), map click/drag (MapPanel), and browser
// geolocation (TopBar's useBrowserLocation) all call through -- rather
// than passed in, so every caller gets a real ground-level elevation for
// free instead of the previous hardcoded 0. This offline DEM lookup is
// the best available estimate for sources with no altitude reading of
// their own (manual, map, preset, browser geolocation -- whose own
// altitude, when present at all, is typically far less reliable than a
// real GPS fix and is deliberately not used, see TopBar's
// useBrowserLocation).
//
// Coordinates outside the bundled grid's own bbox (elevation.ts's
// isWithinElevationBounds -- e.g. browser geolocation firing from
// somewhere that isn't Spain) do NOT get elevationAt()'s edge-clamped
// guess here (direct request -- that value is nonsense relative to the
// real location, not a useful estimate). elevationM defaults to 0 and
// elevationOutOfBounds flags it so the UI can warn and open up the
// elevation box for a manual figure even outside Manual mode. Always
// recomputed fresh from the lat/lon THIS call was given, never carried
// over from the previous observer state, so switching source (which
// always calls this with the new source's own coordinates) and re-
// requesting geolocation both naturally redo the check rather than
// reusing a stale flag.
//
// gpsAltitudeM (serial/connection.ts's GGA altitude, already MSL-
// corrected -- see nmea.ts) skips all of the above entirely: a real
// altitude reading is never a guess, so it's used as-is and
// elevationOutOfBounds is forced false even if the fix itself happens
// to be outside the bundled Spain/W. Mediterranean grid -- there's
// nothing to warn about when the number came from real hardware, not a
// DEM lookup.
export function setObserver(
  lat: number,
  lon: number,
  source: ObserverSource = 'manual',
  gpsAltitudeM?: number,
): void {
  const outOfBounds = !isWithinElevationBounds(lat, lon);
  observer.update((o) => ({
    ...o,
    lat,
    lon,
    source,
    elevationM: gpsAltitudeM !== undefined ? gpsAltitudeM : outOfBounds ? 0 : elevationAt(lat, lon),
    elevationOutOfBounds: gpsAltitudeM === undefined && outOfBounds,
    elevationManuallySet: false,
  }));
}

// Direct elevation override (TopBar's elevation box -- Manual mode, or
// any source currently flagged elevationOutOfBounds above) -- bypasses
// the DEM lookup without touching lat/lon/source/elevationOutOfBounds.
// Only "sticks" until the next setObserver() call (any lat/lon change --
// typing, map drag, picking a preset, a fresh geolocation fix -- goes
// back to the real DEM value, or 0 again if still out of bounds), which
// is the simpler of two options directly requested over having the
// override persist across a later move to a different spot. Also flags
// elevationManuallySet so the out-of-bounds warning (TopBar) clears the
// moment the user supplies their own figure, without touching
// elevationOutOfBounds itself -- the box needs to stay editable for
// further tweaks even after the warning's gone.
export function setObserverElevation(elevationM: number): void {
  observer.update((o) => ({ ...o, elevationM, elevationManuallySet: true }));
}
