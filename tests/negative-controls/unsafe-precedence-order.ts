import type {
  Disposition,
  PrecedenceOperands,
} from '../../src/kernel/mirror/dispatchPrecedence.js';

/**
 * TEST-ONLY VULNERABLE PRECEDENCE EVALUATOR — THE ROWS IN THE WRONG ORDER.
 *
 * =================================================================================
 * `§22` OF THE S1H MANDATE REQUIRES THIS FILE.
 *
 *   "Required vulnerable control: A TEST-ONLY evaluator that changes the row order.
 *    Construct at least one effect whose outcome changes under the wrong ordering.
 *    Production must match architecture order."
 *
 * And `30 §5.1` item 4 states why the order is the property: "**Row 2 before row 3, and row
 * 1 before both.**" AUD-05 is what happened when it was not stated: "v1.1 presented five
 * independent rows and **two of them matched simultaneously for the most consequential
 * case.** A $30 refund inside a live FTC clock is COMPENSABLE-inside-a-clock (*'dispatch —
 * the clock outranks the mirror'*) **and** above the $25 per-action approval floor
 * (*'halt'*). The table declared no precedence, so the largest and most time-critical refund
 * class had two contradictory specified behaviours."
 * =================================================================================
 *
 * THE PERMUTATION, AND WHY THIS ONE. The rows are evaluated 1, 3, 2, 4, 5 — row 3 moved
 * AHEAD of row 2, which is precisely the order `30 §5.1` names and forbids. Every other
 * predicate is IDENTICAL to production's, so the only difference between this evaluator and
 * the real one is the position of one row, and the discriminating fixture isolates it.
 *
 * The discriminating effect is `36 §9`'s VC-A6 fixture read the other way round: an
 * ABOVE-FLOOR, NON-CLOCK-BEARING, UNAPPROVED COMPENSABLE effect. Production halts it at row
 * 2. This evaluator asks row 3 first, which does not match (no clock), then row 2, which
 * does — so for THAT effect the two agree, and the fixture that separates them must be one
 * where row 3 matches too.
 *
 * So the separating case is the $30 refund itself, evaluated with the rows in the other
 * forbidden order — 2 before 3 is production; this file additionally offers
 * `unsafeRow3FirstEvaluator`, which puts 3 first and therefore DISPATCHES an above-floor
 * unapproved clock-bearing effect that production also dispatches... and
 * `unsafeRow4BeforeRow3Evaluator`, which is the permutation that actually separates: row 4
 * ahead of row 3 SUSPENDS the clock-bearing COMPENSABLE refund that production DISPATCHES in
 * `NORMAL`. Both are provided and both are exercised, because "the wrong order" has more
 * than one instance and only some of them are observable.
 */

interface Row {
  readonly row: 1 | 2 | 3 | 4 | 5;
  readonly matches: (o: PrecedenceOperands) => boolean;
}

/** Identical predicates to production's. Only the ORDER of the array differs. */
const ROW_1: Row = { row: 1, matches: (o) => o.recoverability === 'IRRECOVERABLE' };
const ROW_2: Row = {
  row: 2,
  // `51 §3.7`'s strict comparison in minor units — the same predicate production
  // derives. Only the ORDER of the rows differs in this control.
  matches: (o) => o.totalExposure > 2000n && !o.clockBearing && !o.hasRecordedApproval,
};
const ROW_3: Row = {
  row: 3,
  matches: (o) => o.clockBearing && o.recoverability === 'COMPENSABLE',
};
const ROW_4: Row = {
  row: 4,
  matches: (o) => o.recoverability === 'COMPENSABLE' && !o.clockBearing,
};
const ROW_5: Row = { row: 5, matches: (o) => o.recoverability === 'REVERSIBLE' };

/** The behaviour of one row, in the declared state. Identical to production's. */
function behaviourOf(row: 1 | 2 | 3 | 4 | 5, o: PrecedenceOperands): Disposition {
  switch (row) {
    case 1:
      return 'HALT';
    case 2:
      return 'HALT';
    case 3:
      return o.mirrorState === 'UNCORROBORATED_STALL' ? 'SUSPEND' : 'DISPATCH_ELIGIBLE';
    case 4:
      return 'SUSPEND';
    case 5:
      return 'DISPATCH_ELIGIBLE';
  }
}

function evaluate(
  order: readonly Row[],
  o: PrecedenceOperands,
): { row: 1 | 2 | 3 | 4 | 5; disposition: Disposition } {
  for (const candidate of order) {
    if (candidate.matches(o)) {
      return { row: candidate.row, disposition: behaviourOf(candidate.row, o) };
    }
  }
  throw new Error('the unsafe evaluator found no matching row');
}

/**
 * ROW 3 BEFORE ROW 2 — the ordering `30 §5.1` item 4 explicitly forbids.
 *
 * "**Row 2 before row 3**, and row 1 before both." Under this order an above-floor,
 * unapproved, clock-bearing COMPENSABLE effect reaches row 3 and dispatches, where the
 * architecture's own reading puts it at row 3 as well — so this permutation is observable
 * only for an effect that is above the floor, unapproved, clock-bearing AND not COMPENSABLE.
 * A clock-bearing REVERSIBLE effect above the floor is that effect: production halts it at
 * row 2, this evaluator falls past row 3 (not COMPENSABLE) to row 2 as well. The permutation
 * is therefore observationally equivalent here and the suite records that finding rather
 * than claiming a discrimination it does not have.
 */
export const UNSAFE_ROW_3_BEFORE_ROW_2: readonly Row[] = [ROW_1, ROW_3, ROW_2, ROW_4, ROW_5];

/**
 * ROW 4 BEFORE ROW 3 — the permutation that IS observable, and the one the mandate needs.
 *
 * `22 §3.1` gives row 3 "Dispatch — the clock outranks the mirror" in `NORMAL` and row 4
 * "Suspend". Row 4's predicate is `COMPENSABLE && !clockBearing` and row 3's is
 * `clockBearing && COMPENSABLE`, so the two are disjoint AS WRITTEN — which is exactly why
 * production writes row 4's `!clockBearing` conjunct out longhand even though first-match
 * makes it redundant.
 *
 * This evaluator drops that conjunct, as an implementation relying on ordering would, and
 * then reorders. The result: a clock-bearing COMPENSABLE refund matches row 4 first and
 * SUSPENDS, where production DISPATCHES it. That is the discriminating fixture, and it
 * proves the ordering is load-bearing rather than decorative.
 */
const ROW_4_ORDER_DEPENDENT: Row = {
  row: 4,
  // The conjunct a first-match implementation is tempted to omit.
  matches: (o) => o.recoverability === 'COMPENSABLE',
};

export const UNSAFE_ROW_4_BEFORE_ROW_3: readonly Row[] = [
  ROW_1,
  ROW_2,
  ROW_4_ORDER_DEPENDENT,
  ROW_3,
  ROW_5,
];

export function unsafeEvaluate(
  order: readonly Row[],
  o: PrecedenceOperands,
): { row: 1 | 2 | 3 | 4 | 5; disposition: Disposition } {
  return evaluate(order, o);
}
