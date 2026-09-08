import type { Money } from '../exposure/money.js';

/**
 * `51 §3.7` and `51 §3.8`, specified in `30 §5.1a` — THE THREE QUANTITIES THE DISPATCH
 * PRECEDENCE RULE READS. S1H, completed under package issue v1.3.3.
 *
 * =================================================================================
 * WHY THIS FILE EXISTS, AND WHAT IT REPLACED.
 *
 * At v1.3.2 none of the three was declared anywhere. `30 §5.1` item 4 row 2 compared
 * against "the per-action approval floor" and item 5 against "threshold" and "a longer
 * threshold", and `51` declared no row for any of them. `§42` of the S1H mandate forbids
 * inventing an undeclared quantity, so S1H took row 2's predicate as a CALLER-SUPPLIED
 * BOOLEAN and did not build the full-halt posture at all — reported as `S1H-C1` and
 * `S1H-C10` and as PARTIAL in `S1H-result.md`.
 *
 * v1.3.3 declares all three. This file is their transcription and the ONLY place in `src/`
 * that carries their values, and the boolean escape hatch is gone: `classifyDispatchPrecedence`
 * derives both predicates here, from operands trusted code owns.
 * =================================================================================
 *
 * =================================================================================
 * THESE ARE READ, NEVER WRITTEN, AND TWO CONTROL-ARTIFACT SIGNATURES ARE OWED.
 *
 * The approval floor is a field of control artifact `50 §2` class 3, whose `content_hash`
 * moves because v1.3.3 gives the field a value for the first time. The two thresholds are
 * class 27, new in v1.3.3. Both need an owner signature with a second factor before any
 * deployment, **and no production owner-signing mechanism and no runtime `I19` verification
 * exist in this implementation.** `S1H-result.md §16` carries all of that forward alongside
 * the class-20 residual, and nothing here claims otherwise.
 * =================================================================================
 */

/**
 * `51 §3.7`, `DESIGN LIMIT — OWNER DECISION`, transcribed from the fixture table.
 *
 * > `degraded_per_action_approval_floor_monetary` | **USD 20.00**
 *
 * In the `Money` scale-2 minor unit, so `$20.00` is `2000n`. `30 §5.3` and
 * `exposure/money.ts` both forbid a monetary value ever being a `number`.
 */
export const DEGRADED_PER_ACTION_APPROVAL_FLOOR: Money = 2000n as Money;

/**
 * `51 §3.8`, `DESIGN LIMIT — OWNER DECISION`, transcribed from the fixture table.
 *
 * > `mirror_lag_critical_threshold` | **15 minutes** | `PT15M`
 * > `audit_unreachable_full_halt_threshold` | **30 minutes** | `PT30M`
 *
 * `PT30M > PT15M` is required by `30 §5.1` item 5's own "a longer threshold" and is asserted
 * as ARITHMETIC on these two constants by `degraded-mode-thresholds.test.ts`, so a future
 * edit to either cannot silently collapse the escalation into the halt.
 */
export const DEGRADED_MODE_TIMING = Object.freeze({
  /** `mirror_lag_critical_threshold` = `PT15M`. */
  mirrorLagCriticalMs: 15 * 60 * 1000,
  /** `audit_unreachable_full_halt_threshold` = `PT30M`. */
  auditUnreachableFullHaltMs: 30 * 60 * 1000,
});

/**
 * `30 §5.1` item 4 row 2's PREDICATE, derived. `51 §3.7`:
 *
 * > **Comparison semantics.** `total_exposure > 20.00` is ABOVE the floor. The comparison is
 * > **strict**, evaluated in minor units of the single ledger currency (`51 §1`), so
 * > `$20.00` exactly is **not** above the floor and `$20.01` — one minor unit above — **is**.
 * > There is no tolerance and no rounding step.
 *
 * ---------------------------------------------------------------------------------
 * THE OPERAND IS `total_exposure` AND THE ARGUMENT'S TYPE IS WHY THAT CANNOT DRIFT.
 *
 * `51 §3.7`: "Not `exposure.vendor_amount`, not a dispatch amount, not a model-supplied
 * amount, not a `rationale` figure, not grant prose." This function takes ONE `Money`, so
 * there is no second monetary argument a caller could confuse it with — and the one caller,
 * `classifyDispatchPrecedence`, reads it out of `PrecedenceOperands.totalExposure`, which is
 * the effect's own `exposure.total_exposure`.
 *
 * `51 §3.1` already declares the same operand for `per_action_max` — "compared against
 * `exposure.total_exposure`, not `exposure.vendor_amount` (SR-C1, `26 §8`)" — for the same
 * reason: the cap bounds economic loss, and economic loss includes the fee that does not
 * come back. `vendor-amount-policy-binding.test.ts` has asserted that for the Cedar bound
 * since S1C; `dispatch-precedence-approval-floor.test.ts` asserts it here.
 *
 * A NON-MONETARY EFFECT IS NOT ABOVE THE FLOOR. `51 §3.7`: a rate class reserves `0.00`
 * (`26 §2.1.3`) and a class with no monetary field carries `total_exposure = 0.00`, so the
 * predicate is false. The floor is a monetary predicate and is exhaustively so.
 * ---------------------------------------------------------------------------------
 */
export function isAboveDegradedApprovalFloor(totalExposure: Money): boolean {
  return totalExposure > DEGRADED_PER_ACTION_APPROVAL_FLOOR;
}

/** `30 §5.1a`'s mirror-lag condition. Two values; there is no third. */
export const MIRROR_LAG_CONDITIONS = ['WITHIN_THRESHOLD', 'CRITICAL'] as const;

export type MirrorLagCondition = (typeof MIRROR_LAG_CONDITIONS)[number];

/**
 * `30 §5.1` item 5's FIRST rule, and `30 §5.1a`'s statement of its boundary.
 *
 * > `mirror_lag >= 15 minutes` **is at or over the threshold** and raises
 * > `AUDIT_MIRROR_DEGRADED` at CRITICAL urgency. `mirror_lag < 15 minutes` does not.
 *
 * The comparison is `>=`, INCLUSIVE, and it is the OPPOSITE convention from the approval
 * floor's `>` — because `51 §3.7` declares one strict and `51 §3.8` declares the other
 * inclusive, and each is transcribed as declared rather than as a house style.
 *
 * ---------------------------------------------------------------------------------
 * WHAT THIS FUNCTION CANNOT DO, WHICH IS THE WHOLE OF `§5.1a`'s "escalation and state
 * input" CLAUSE.
 *
 * It returns a CONDITION. It does not resolve a mirror state, does not construct a
 * `HeldCorroboration`, does not touch `mirror_corroboration`, does not grant or extend a
 * `DegradedModeOverride` and does not read or write any monetary limit — and it takes no
 * argument through which it could. `30 §5.1a`: "It **cannot** create
 * `CORROBORATED_DEGRADED`, **cannot** fabricate or substitute for a
 * `MirrorInputStallSignal`, **cannot** grant or extend a `DegradedModeOverride`, and
 * **cannot** move any monetary limit."
 *
 * `mirror-lag-critical.test.ts` asserts each of those as a property of the resolved state
 * and of the durable tables, not merely of this signature.
 * ---------------------------------------------------------------------------------
 */
export function classifyMirrorLag(lagMs: number): MirrorLagCondition {
  return lagMs >= DEGRADED_MODE_TIMING.mirrorLagCriticalMs ? 'CRITICAL' : 'WITHIN_THRESHOLD';
}

/**
 * `30 §5.1` item 5's SECOND rule, and `30 §5.1a`'s FULL-HALT POSTURE.
 *
 * > `continuous_unreachability >= 30 minutes` **enters the FULL-HALT POSTURE**.
 *
 * ---------------------------------------------------------------------------------
 * THE OPERAND, AND WHY IT IS THE DECLARATION RATHER THAN A TIMER OF ITS OWN.
 *
 * `30 §5.1a`, verbatim:
 *
 *   continuous_unreachability = now() − declaration.opened_at   , for the open declaration
 *   continuous_unreachability = 0                               , when no declaration is open
 *
 *   "**The timer STARTS when a declaration opens and RESETS only when one closes.** It is
 *    not reset by a state change between `UNCORROBORATED_STALL` and
 *    `CORROBORATED_DEGRADED`, by a signal arriving or expiring, by a re-issued signal, by a
 *    restart of either plane, or by the passage of an attestation interval — none of those
 *    closes a declaration."
 *
 * So there is NO TIMER OBJECT and no elapsed counter to reset. The operand is a subtraction
 * over a durable instant that already existed: `mirror_declaration.opened_at`, NOT NULL, with
 * `mirror_declaration_one_open_per_company` making at most one open per company so the
 * interval is single-valued. Every "reset" case in the sentence above is a case that leaves
 * `opened_at` alone, which is why the semantics fall out of the schema rather than needing
 * code — and `full-halt-posture.test.ts` asserts each of them against real PostgreSQL.
 *
 * A MODEL CANNOT SUPPLY, ADVANCE OR RESET IT. `36 §6` makes the control database clock
 * authoritative; `now` is read from it by the caller and `opened_at` is written by the
 * declaration path. No argument here could stand in for either.
 * ---------------------------------------------------------------------------------
 */
export function isFullHaltPosture(continuousUnreachabilityMs: number): boolean {
  return continuousUnreachabilityMs >= DEGRADED_MODE_TIMING.auditUnreachableFullHaltMs;
}
