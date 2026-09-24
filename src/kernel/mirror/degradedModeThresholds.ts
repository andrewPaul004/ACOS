import {
  verifiedDegradedModeConfiguration,
  type VerifiedControlArtifactBundle,
} from '../controlArtifacts/bundle.js';
import { activeVerifiedControlArtifacts } from '../controlArtifacts/registry.js';
import type { Money } from '../exposure/money.js';

/**
 * `50 §2c`'s FOUR STATIC QUANTITIES — read from the SIGNED class-27 artifact, and from
 * nowhere else.
 *
 * =================================================================================
 * WHAT THIS FILE WAS, AND WHAT v1.3.6 REQUIRES IT TO BE
 *
 * S1H wrote this module under package issue v1.3.3, which declared the three quantities for
 * the first time, and said so in its own header: "**THESE ARE READ, NEVER WRITTEN, AND TWO
 * CONTROL-ARTIFACT SIGNATURES ARE OWED.** [...] **no production owner-signing mechanism and
 * no runtime `I19` verification exist in this implementation.**"
 *
 * v1.3.6 closes that. `50 §2c` gives class 27 a CLOSED schema of exactly four quantities —
 * the two timing thresholds, the approval floor moved here from class 3, and
 * `corroboration_signal_max_age`, which "was previously owned by no signed class at all" —
 * and `50 §3f` makes the signed bytes the deployed authority source for it.
 *
 * SO THE THREE `export const`s ARE GONE. `DEGRADED_PER_ACTION_APPROVAL_FLOOR` and
 * `DEGRADED_MODE_TIMING` were exactly the arrangement `50 §3c` forbids: "**A signed control
 * artifact and a separate hard-coded production literal may not both be authority
 * sources**". `tests/negative-controls/unsafe-unsigned-authority-literals.ts` keeps a copy of
 * them with a $500.00 floor and an eight-hour halt threshold, and
 * `tests/controlArtifacts/class-27-authority.test.ts` runs both readers over one fixture to
 * prove which one production uses.
 *
 * =================================================================================
 * THE THREE PREDICATE FUNCTIONS KEEP THEIR SIGNATURES, AND THEIR BOUNDARY SEMANTICS
 *
 * `50 §2c`'s boundary column is transcribed here exactly as declared, and the two
 * conventions remain deliberately different:
 *
 *   quantity 1  `mirror_lag >= PT15M`                       INCLUSIVE
 *   quantity 2  `continuous_unreachability >= PT30M`        INCLUSIVE
 *   quantity 3  `total_exposure > 20.00`                    STRICT
 *   quantity 4  `now() - observed_at <= max_age`            INCLUSIVE
 *
 * Each is transcribed as `50 §2c` declares it rather than as a house style. The ordering
 * coherence `30 §5.1` item 5 depends on — the halt threshold being the LONGER of the two —
 * is now checked over the VERIFIED bytes in `controlArtifacts/artifactParsers.ts`, before a
 * bundle can be sealed, rather than by a test over two constants.
 * =================================================================================
 */

function configuration(bundle?: VerifiedControlArtifactBundle) {
  return verifiedDegradedModeConfiguration(bundle ?? activeVerifiedControlArtifacts());
}

/**
 * `50 §2c` quantity 3 — `degraded_per_action_approval_floor_monetary`, `USD 20.00`.
 *
 * `50 §2c`: "**Row 3 moved from class 3 to class 27, and that is an OWNERSHIP correction, not
 * a value change.** The floor is a **global degraded-mode threshold**, not a per-action
 * catalogue field: one quantity for the whole company, read only by `30 §5.1` item 4 row 2,
 * evaluated only inside a declared mirror state."
 *
 * In the `Money` scale-2 minor unit, so `$20.00` is `2000n`. `30 §5.3` and
 * `exposure/money.ts` both forbid a monetary value ever being a `number`, and the class-27
 * parser reads the artifact's decimal text straight into minor units for the same reason.
 */
export function degradedPerActionApprovalFloor(bundle?: VerifiedControlArtifactBundle): Money {
  return configuration(bundle).degradedPerActionApprovalFloorMinorUnits as Money;
}

/** `50 §2c` quantities 1 and 2, in milliseconds. */
export function degradedModeTiming(bundle?: VerifiedControlArtifactBundle): {
  readonly mirrorLagCriticalMs: number;
  readonly auditUnreachableFullHaltMs: number;
} {
  const config = configuration(bundle);
  return {
    mirrorLagCriticalMs: config.mirrorLagCriticalThresholdMs,
    auditUnreachableFullHaltMs: config.auditUnreachableFullHaltThresholdMs,
  };
}

/** `50 §2c` quantity 4 — `corroboration_signal_max_age`, `PT5M`. */
export function corroborationSignalMaxAgeMs(bundle?: VerifiedControlArtifactBundle): number {
  return configuration(bundle).corroborationSignalMaxAgeMs;
}

/**
 * `30 §5.1` item 4 row 2's PREDICATE, derived from the VERIFIED floor.
 *
 * `51 §3.7`, and `50 §2c` quantity 3's boundary column:
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
 * A NON-MONETARY EFFECT IS NOT ABOVE THE FLOOR. A rate class reserves `0.00` (`26 §2.1.3`)
 * and a class with no monetary field carries `total_exposure = 0.00`, so the predicate is
 * false. The floor is a monetary predicate and is exhaustively so.
 * ---------------------------------------------------------------------------------
 */
export function isAboveDegradedApprovalFloor(
  totalExposure: Money,
  bundle?: VerifiedControlArtifactBundle,
): boolean {
  return totalExposure > degradedPerActionApprovalFloor(bundle);
}

/** `30 §5.1a`'s mirror-lag condition. Two values; there is no third. */
export const MIRROR_LAG_CONDITIONS = ['WITHIN_THRESHOLD', 'CRITICAL'] as const;

export type MirrorLagCondition = (typeof MIRROR_LAG_CONDITIONS)[number];

/**
 * `30 §5.1` item 5's FIRST rule, and `50 §2c` quantity 1's boundary.
 *
 * > `mirror_lag >= 15 minutes` **is at or over the threshold** and raises
 * > `AUDIT_MIRROR_DEGRADED` at CRITICAL urgency. `mirror_lag < 15 minutes` does not.
 *
 * The comparison is `>=`, INCLUSIVE, and it is the OPPOSITE convention from the approval
 * floor's `>` — because `50 §2c` declares one strict and the other inclusive, and each is
 * transcribed as declared.
 *
 * ---------------------------------------------------------------------------------
 * WHAT THIS FUNCTION CANNOT DO, WHICH IS THE WHOLE OF `§5.1a`'s "escalation and state
 * input" CLAUSE.
 *
 * It returns a CONDITION. It does not resolve a mirror state, does not construct a
 * `HeldCorroboration`, does not touch `mirror_corroboration`, does not grant or extend a
 * `DegradedModeOverride` and does not read or write any monetary limit — and it takes no
 * argument through which it could.
 * ---------------------------------------------------------------------------------
 */
export function classifyMirrorLag(
  lagMs: number,
  bundle?: VerifiedControlArtifactBundle,
): MirrorLagCondition {
  return lagMs >= degradedModeTiming(bundle).mirrorLagCriticalMs ? 'CRITICAL' : 'WITHIN_THRESHOLD';
}

/**
 * `30 §5.1` item 5's SECOND rule, and `30 §5.1a`'s FULL-HALT POSTURE, against the VERIFIED
 * threshold.
 *
 * > `continuous_unreachability >= 30 minutes` **enters the FULL-HALT POSTURE**.
 *
 * `50 §2c` on why this quantity is the one that most needs a signature: "The 30-minute
 * quantity is the operand of `30 §5.1a`'s FULL-HALT POSTURE, so widening it removes the halt
 * that stops the company when the record cannot be made, and narrowing it halts a healthy
 * company."
 *
 * ---------------------------------------------------------------------------------
 * THE OPERAND, AND WHY IT IS THE DECLARATION RATHER THAN A TIMER OF ITS OWN.
 *
 * `30 §5.1a`, verbatim:
 *
 *   continuous_unreachability = now() − declaration.opened_at   , for the open declaration
 *   continuous_unreachability = 0                               , when no declaration is open
 *
 *   "**The timer STARTS when a declaration opens and RESETS only when one closes.**"
 *
 * So there is NO TIMER OBJECT and no elapsed counter to reset. The operand is a subtraction
 * over a durable instant that already existed: `mirror_declaration.opened_at`, NOT NULL,
 * with `mirror_declaration_one_open_per_company` making at most one open per company.
 * ---------------------------------------------------------------------------------
 */
export function isFullHaltPosture(
  continuousUnreachabilityMs: number,
  bundle?: VerifiedControlArtifactBundle,
): boolean {
  return continuousUnreachabilityMs >= degradedModeTiming(bundle).auditUnreachableFullHaltMs;
}
