// Pure phrase-template functions for the sound-warnings feature
// (docs/SOUND-PLAN.md §2.1) -- every countdown rung's exact spoken wording,
// factored out here so a wording change is a one-line diff, not a hunt
// through eligibility.ts's event-construction logic. The specific wording
// (and which rungs drop "seconds"/the "to C1"/"to C2" framing, and which
// don't) is a deliberate choice from the brief, not a mistake to
// normalize away -- see the plan doc's own §2.1 for the exact reasoning.

/** C1's countdown ladder: 5min/1min/30s/10s/5s before C1. The last two
 * rungs drop the "to C1" framing but keep "seconds". */
export function c1Phrase(leadS: number): string {
  switch (leadS) {
    case 300:
      return 'Five minutes to C1.';
    case 60:
      return 'One minute to C1.';
    case 30:
      return 'Thirty seconds to C1.';
    case 10:
      return 'Ten seconds.';
    case 5:
      return 'Five seconds.';
    default:
      throw new Error(`c1Phrase: no wording defined for a ${leadS}s lead`);
  }
}

/** C2's countdown ladder: 10/5/2/1min, 30/15/10/5s before C2. The 15s rung
 * folds in the filter-safety instruction (docs/SOUND-PLAN.md §2.1/§2.3
 * Rule -- there is no separate "Filters off!" event, this rung *is* it).
 * The closest rungs (15/10/5s) drop both "seconds" and the "to C2" framing
 * -- a tighter progression than C1's. */
export function c2Phrase(leadS: number): string {
  switch (leadS) {
    case 600:
      return 'Ten minutes to C2.';
    case 300:
      return 'Five minutes to C2.';
    case 120:
      return 'Two minutes to C2.';
    case 60:
      return 'One minute to C2.';
    case 30:
      return 'Thirty seconds.';
    case 15:
      return 'Fifteen, filters off!';
    case 10:
      return 'Ten.';
    case 5:
      return 'Five.';
    default:
      throw new Error(`c2Phrase: no wording defined for a ${leadS}s lead`);
  }
}

/** C3's countdown ladder: 50/30/15/10/5s before C3 -- starts closer in
 * than C1/C2's (totality itself is only ~1-2 minutes long). Wording is
 * plain throughout; the filters-on call is a separate event (see
 * FILTERS_ON_PHRASE below), not a reworded rung the way C2's 15s rung
 * is. */
export function c3Phrase(leadS: number): string {
  switch (leadS) {
    case 50:
      return 'Fifty seconds.';
    case 30:
      return 'Thirty seconds.';
    case 15:
      return 'Fifteen.';
    case 10:
      return 'Ten.';
    case 5:
      return 'Five.';
    default:
      throw new Error(`c3Phrase: no wording defined for a ${leadS}s lead`);
  }
}

/** Max's single, unconditional at-instant announcement (docs/SOUND-PLAN.md
 * §2.3 Rule 3 -- fires regardless of whether C2/C3 were also observable). */
export const MAX_PHRASE = 'Maximum.';

/** C3's standalone filters-on call, 15s after C3 -- not a countdown rung,
 * no number, just the instruction. */
export const FILTERS_ON_PHRASE = 'Filters on!';
