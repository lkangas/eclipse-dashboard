// Real local circumstances (PLAN.md §4) for the live observer -- the
// eclipse-core port applied to the real besselian-2026.json data,
// recomputed reactively whenever the observer store changes.
import { derived } from 'svelte/store';
import besselian from '../data/besselian-2026.json';
import { observer } from './observer';
import { findContactTimes, findMaximumTime } from '../eclipse/localCircumstances';
import type { BesselianCoefficients } from '../eclipse/elements';

const coefficients = besselian.coefficients as unknown as BesselianCoefficients;

// besselian.t0_tt ("2026-08-12T18:00:00") is a Terrestrial Time calendar
// reading, not a UTC one. Parsing it as if it were UTC gives the correct
// linear epoch for that TT reading (Date's epoch arithmetic is timezone-
// agnostic calendar math); shifting by the locked ΔT (PLAN.md §14 #5)
// then gives the true UT epoch.
const T0_TT_MS = Date.parse(besselian.t0_tt + 'Z');
function ttHoursToDate(hoursFromT0: number): Date {
  return new Date(T0_TT_MS + hoursFromT0 * 3_600_000 - besselian.delta_t_seconds * 1000);
}

export interface LocalCircumstances {
  max: Date;
  c1: Date | null;
  c2: Date | null;
  c3: Date | null;
  c4: Date | null;
  durationS: number | null;
}

export const localCircumstances = derived(observer, ($observer): LocalCircumstances => {
  const tMax = findMaximumTime(coefficients, $observer.lat, $observer.lon, $observer.elevationM);
  const contacts = findContactTimes(
    coefficients,
    $observer.lat,
    $observer.lon,
    $observer.elevationM,
    tMax,
  );
  const hasTotality = contacts.c2 !== null && contacts.c3 !== null;
  return {
    max: ttHoursToDate(tMax),
    c1: contacts.c1 !== null ? ttHoursToDate(contacts.c1) : null,
    c2: contacts.c2 !== null ? ttHoursToDate(contacts.c2) : null,
    c3: contacts.c3 !== null ? ttHoursToDate(contacts.c3) : null,
    c4: contacts.c4 !== null ? ttHoursToDate(contacts.c4) : null,
    durationS: hasTotality ? (contacts.c3! - contacts.c2!) * 3600 : null,
  };
});
