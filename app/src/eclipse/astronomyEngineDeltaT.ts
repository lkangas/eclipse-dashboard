// Makes astronomy-engine (used for real-time Sun/Moon/star positions --
// stores/skyView.ts, stores/localCircumstances.ts's sunset search) evaluate
// time on the SAME ΔT (TT-minus-UTC) as the Besselian/eclipse-calc pipeline,
// instead of its own built-in DeltaT_EspenakMeeus (a 2006 polynomial fit
// that gives ~75.4s for 2026-08-12 -- close to the NASA GSFC SEdata figure
// this project already rejected for the Besselian side, PLAN.md §14 #5).
//
// This matters even though astronomy-engine never touches any Besselian
// data: both pipelines are handed the *same UTC instant* (e.g. the official
// C2), but each independently converts UTC->TT before evaluating Sun/Moon
// orbital motion (which is computed in TT, not UTC). With two different ΔT
// values, "the same UTC instant" silently maps to two TT epochs about 6.3
// seconds apart -- and since the Moon moves ~0.55"/second across the sky,
// that alone displaces astronomy-engine's computed Moon position by several
// arcseconds relative to the Besselian ground truth, for every real-time
// call, not just near contacts. Confirmed empirically (PLAN.md): overriding
// this closes ~70% of the ~6" Sun-Moon separation gap observed at C2/C3;
// the remainder is astronomy-engine's own lower-precision Sun/Moon position
// series (truncated VSOP87 / a 1954 lunar theory) versus eclipse-calc's
// full JPL DE440s ephemeris -- not fixable by a ΔT correction.
//
// SetDeltaTFunction is a one-time global override on astronomy-engine's
// internal module state (there is exactly one loaded instance of the
// library, shared by every importer) -- importing this module anywhere for
// its side effect, before any position is actually computed, is enough.
import { SetDeltaTFunction } from 'astronomy-engine';
import { deltaTSeconds } from '../data/besselian-2026';

SetDeltaTFunction(() => deltaTSeconds);
