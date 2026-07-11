// Real local circumstances (PLAN.md §4) for the live observer -- the
// eclipse-core port applied to the real besselian-2026.json data,
// recomputed reactively whenever the observer store changes.
import { derived } from 'svelte/store';
import { Body, Observer, SearchRiseSet } from 'astronomy-engine';
import { coefficients, ttHoursToDate } from '../data/besselian-2026';
import { observer } from './observer';
import { findContactTimes, findMaximumTime } from '../eclipse/localCircumstances';

export interface LocalCircumstances {
  max: Date;
  c1: Date | null;
  c2: Date | null;
  c3: Date | null;
  c4: Date | null;
  durationS: number | null;
  sunset: Date | null;
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
  const maxDate = ttHoursToDate(tMax);
  const c1Date = contacts.c1 !== null ? ttHoursToDate(contacts.c1) : null;

  // Local sunset near the event. This eclipse is sunset-limited for
  // Spain (PLAN.md §1) -- the Besselian shadow-cone geometry above has
  // no concept of the horizon at all, so contacts (especially C3/C4)
  // can and do fall after the observer's own local sunset; astronomy-
  // engine finds the actual horizon crossing independently of that.
  // Search from an hour before C1 (or Max, if there's no partial
  // eclipse here either) so a sunset only slightly ahead of C1 is still
  // found, not skipped past.
  const astroObserver = new Observer($observer.lat, $observer.lon, $observer.elevationM);
  const searchStart = new Date((c1Date ?? maxDate).getTime() - 3_600_000);
  const sunsetTime = SearchRiseSet(Body.Sun, astroObserver, -1, searchStart, 1);

  return {
    max: maxDate,
    c1: c1Date,
    c2: contacts.c2 !== null ? ttHoursToDate(contacts.c2) : null,
    c3: contacts.c3 !== null ? ttHoursToDate(contacts.c3) : null,
    c4: contacts.c4 !== null ? ttHoursToDate(contacts.c4) : null,
    durationS: hasTotality ? (contacts.c3! - contacts.c2!) * 3600 : null,
    sunset: sunsetTime ? sunsetTime.date : null,
  };
});
