// Live linear + area obscuration for the observer at effectiveTime
// (PLAN.md §4). Unlike stores/localCircumstances.ts's contact times
// (fixed events for a given observer, independent of the clock), this
// changes continuously as time passes, so it's keyed on both observer
// and effectiveTime rather than observer alone.
import { derived } from 'svelte/store';
import { coefficients, dateToTtHours } from '../data/besselian-2026';
import { observerPosition } from '../eclipse/observer';
import { obscurationAt, type Obscuration } from '../eclipse/localCircumstances';
import { observer } from './observer';
import { effectiveTime } from './clock';

export const obscuration = derived([observer, effectiveTime], ([$observer, $now]): Obscuration => {
  const { rhoSinPhiPrime, rhoCosPhiPrime } = observerPosition($observer.lat, $observer.elevationM);
  const tHours = dateToTtHours($now);
  return obscurationAt(coefficients, $observer.lon, rhoSinPhiPrime, rhoCosPhiPrime, tHours);
});
