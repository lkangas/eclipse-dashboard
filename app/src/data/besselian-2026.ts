// Typed, ready-to-use wrapper around besselian-2026.json -- the loaded
// coefficients plus TT-hours-from-T0 <-> real-Date conversion, shared by
// every store/component that needs the real 2026-08-12 event data.
import besselian from './besselian-2026.json';
import type { BesselianCoefficients } from '../eclipse/elements';

export const coefficients = besselian.coefficients as unknown as BesselianCoefficients;

// besselian.t0_tt ("2026-08-12T18:00:00") is a Terrestrial Time calendar
// reading, not a UTC one. Parsing it as if it were UTC gives the correct
// linear epoch for that TT reading (Date's epoch arithmetic is timezone-
// agnostic calendar math); shifting by the locked ΔT (PLAN.md §14 #5)
// then gives the true UT epoch.
const T0_TT_MS = Date.parse(besselian.t0_tt + 'Z');
const DELTA_T_MS = besselian.delta_t_seconds * 1000;

export function ttHoursToDate(hoursFromT0: number): Date {
  return new Date(T0_TT_MS + hoursFromT0 * 3_600_000 - DELTA_T_MS);
}

export function dateToTtHours(date: Date): number {
  return (date.getTime() - T0_TT_MS + DELTA_T_MS) / 3_600_000;
}
