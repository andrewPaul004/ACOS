import {
  DISPOSITIONS,
  type Disposition,
  type OverrideScope,
  type PrecedenceOperands,
} from '../../src/kernel/mirror/dispatchPrecedence.js';
import type { MirrorState } from '../../src/kernel/mirror/mirrorState.js';

/**
 * THE MANDATORY VULNERABLE CONTROL FOR `30 §5.1a`'s FULL-HALT POSTURE.
 *
 * =================================================================================
 * `§14` of the owner-resolution mandate, verbatim:
 *
 *   "Required vulnerable control: an implementation that remains in the ordinary
 *    three-state degraded table indefinitely and ignores prolonged unreachability.
 *
 *    At >=30m: unsafe path continues to mark at least one class future-dispatch eligible;
 *    production enters FULL HALT.
 *
 *    Must discriminate."
 * =================================================================================
 *
 * THIS IS EXACTLY WHAT S1H SHIPPED, and it is not a straw man. `S1H-result.md §16` reported
 * the halt posture NOT IMPLEMENTED because both of its thresholds were undeclared in
 * v1.3.2, so the accepted S1H classifier IS this function: the ordinary three-state table,
 * evaluated forever, with no upper bound on how long a company may keep dispatching
 * REVERSIBLE effects while the record of them cannot be made.
 *
 * The rows below are transcribed from `22 §3.1` and are IDENTICAL to production's, so the
 * only difference between this evaluator and `classifyDispatchPrecedence` is the ABSENCE of
 * `§5.1a`'s reduction. That is what makes the discrimination attributable to the posture and
 * to nothing else.
 *
 * NOT IMPORTED BY `src/`. `no-dispatch-boundary.test.ts` asserts that no file under `src/`
 * imports anything from `tests/`.
 */

export interface UnsafeDecision {
  readonly disposition: Disposition;
  readonly matchedRow: 1 | 2 | 3 | 4 | 5;
  /** Whether this class would be handed to a future dispatcher. `§14`'s own words. */
  readonly futureDispatchEligible: boolean;
}

function overrideCovers(override: OverrideScope, row: number, o: PrecedenceOperands): boolean {
  if (override.status !== 'ACTIVE') return false;
  if (o.now.getTime() < override.startsAt.getTime()) return false;
  if (o.now.getTime() >= override.expiresAt.getTime()) return false;
  if (row !== 3 && row !== 4) return false;
  if (!override.precedenceRows.includes(row)) return false;
  if (!override.recoverabilityClasses.includes(o.recoverability)) return false;
  if (!override.effectClasses.includes(o.actionClass)) return false;
  if (override.effectsDispatched >= override.effectCountCap) return false;
  return true;
}

/**
 * The three-state table, evaluated with NO regard for how long the declaration has been
 * open. `unreachableSince` is accepted and DELIBERATELY IGNORED — which is the defect.
 */
export function unsafeProlongedUnreachabilityEvaluator(
  o: PrecedenceOperands,
): UnsafeDecision {
  const state: MirrorState = o.mirrorState;
  const covered = (row: number): boolean =>
    o.activeOverride !== null && overrideCovers(o.activeOverride, row, o);

  // Row 1 — IRRECOVERABLE.
  if (o.recoverability === 'IRRECOVERABLE') {
    return { disposition: 'HALT', matchedRow: 1, futureDispatchEligible: false };
  }
  // Row 2 — above the floor, not clock-bearing, unapproved. `51 §3.7`'s strict comparison,
  // transcribed in minor units so this control is not weaker than production on row 2.
  if (o.totalExposure > 2000n && !o.clockBearing && !o.hasRecordedApproval) {
    return { disposition: 'HALT', matchedRow: 2, futureDispatchEligible: false };
  }
  // Row 3 — clock-bearing COMPENSABLE.
  if (o.clockBearing && o.recoverability === 'COMPENSABLE') {
    if (state === 'UNCORROBORATED_STALL' && !covered(3)) {
      return { disposition: 'SUSPEND', matchedRow: 3, futureDispatchEligible: false };
    }
    return { disposition: 'DISPATCH_ELIGIBLE', matchedRow: 3, futureDispatchEligible: true };
  }
  // Row 4 — COMPENSABLE discretionary.
  if (o.recoverability === 'COMPENSABLE') {
    if (covered(4)) {
      return { disposition: 'DISPATCH_ELIGIBLE', matchedRow: 4, futureDispatchEligible: true };
    }
    return { disposition: 'SUSPEND', matchedRow: 4, futureDispatchEligible: false };
  }
  // Row 5 — REVERSIBLE. THE DEFECT: it dispatches in every state, for ever, however long
  // the mirror has been unreachable. `30 §5.1` item 5 says this is exactly the class the
  // prolonged-unreachability halt is about — "halts all classes INCLUDING REVERSIBLE".
  return { disposition: 'DISPATCH_ELIGIBLE', matchedRow: 5, futureDispatchEligible: true };
}

/** Asserted by the suite, so a future edit cannot narrow the control's disposition set. */
export const UNSAFE_DISPOSITIONS: readonly Disposition[] = DISPOSITIONS;
