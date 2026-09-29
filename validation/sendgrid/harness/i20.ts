/**
 * `I20` — THE COMPARISON MACHINERY. `§14` OF THE S1P CORRECTION MANDATE.
 *
 * =================================================================================
 * WHAT `I20` COMPARES, AND THE TWO SUBSTITUTIONS THAT ARE FORBIDDEN BY NAME
 *
 * `§14`: "compare provider-reported accepted IRRECOVERABLE effects against the immutable
 * historical legitimate reservation basis for the S1P validation window/scenario set."
 *
 * THE NUMERATOR IS THE PROVIDER'S. It is the number of DISTINCT provider message ids the
 * independent audit read observed, summed over the scenarios in the window. `§14`: "Do not
 * use local invocation count as the numerator." A local count is ACOS's own account of how
 * many times it called a function, and `35 §12.3` is the whole reason that is not the same
 * number: "a mock with a naive idempotency implementation passes while the vendor would not."
 *
 * THE DENOMINATOR IS THE IMMUTABLE HISTORICAL RESERVATION BASIS. `phase2-v1.3.5-errata.md §1`,
 * verbatim and already transcribed into `0013__irrecoverable_units.sql`:
 *
 *     "The **immutable historical authorisation basis** — the set of legitimately committed
 *      irrecoverable reservation units evidenced by the committed reservation, effect and
 *      window rows — and **not** the current value of `reserved_irrecoverable`. The reason is
 *      mechanical: PRESUME and REALISE move units out of that column while leaving the
 *      commitment unchanged, so a bound written against the live column tightens as
 *      presumptions accumulate and **inverts the invariant's own direction**."
 *
 * `§14` repeats it: "Do not use current `reserved_irrecoverable` as the denominator." So the
 * operand this module takes is the SUM OF `reservation_window_instance.irrecoverable_units`
 * over the validation scenario set — a column `0013` made append-only precisely so that a
 * later statement cannot raise `I20`'s bound.
 *
 * =================================================================================
 * THE DIRECTION OF THE BOUND, AND WHY AN EXCESS IS THE FINDING
 *
 * Every provider-accepted irrecoverable effect must stand behind a legitimately committed
 * reservation. So the bound is
 *
 *     provider-accepted irrecoverable effects  <=  historical reservation basis units
 *
 * A count BELOW the basis is not a violation: a scenario that legitimately never dispatched —
 * kill point 2, where the row is CLAIMED and nothing will send it — reserves a unit and
 * produces no accepted message, and `35 §12.3` states that cost openly. A count ABOVE the
 * basis is a provider-side effect no authorisation stands behind, which is exactly what `I20`
 * exists to detect.
 *
 * =================================================================================
 * **AN UNMEASURED SCENARIO IS NOT A ZERO.** CORRECTION 9'S RULE, APPLIED TO THE NUMERATOR
 *
 * If ANY scenario in the set produced no trustworthy provider count — the read was refused,
 * the stabilisation window did not complete, the provider was unreachable — then the sum is
 * not a sum and the comparison is `UNRESOLVED`. Treating an unmeasured scenario as
 * contributing zero would bias the numerator DOWNWARD, which is the direction that makes the
 * bound pass, which is the direction a safety comparison must never fail in.
 *
 * =================================================================================
 * WHAT THIS MODULE DOES NOT DO
 *
 * It performs no I/O, reads no database and calls no provider. It is a pure comparison over
 * operands the driver supplies, so `tests/sendgrid/i20.test.ts` proves the calculation
 * offline and completely. **PROVING THE CALCULATION IS NOT CLOSING THE INVARIANT**: `§14`,
 * "Do not claim provider-side I20 complete until real provider observations exist", and no
 * provider observation exists in this repository.
 * =================================================================================
 */

/** One scenario's contribution to the comparison. */
export interface I20ScenarioOperand {
  /** The scenario label, so an UNRESOLVED verdict can name which one is missing. */
  readonly scenarioLabel: string;
  /**
   * The PROVIDER's distinct accepted-message count for this scenario's correlation, or
   * `null` when the observation did not establish one.
   */
  readonly providerAcceptedCount: number | null;
  /**
   * The units this scenario's authorisation RESERVED, read from the committed
   * `reservation_window_instance` rows. A `bigint` because the column is `BIGINT` and
   * `51 §2.3`'s counts are exact.
   */
  readonly historicalReservationUnits: bigint;
}

export const I20_VERDICTS = [
  /** Every scenario measured, and the bound holds. */
  'WITHIN_BASIS',
  /** Every scenario measured, and the provider accepted more than any authorisation reserved. */
  'EXCEEDS_BASIS',
  /** At least one scenario produced no trustworthy provider count. NOT a pass and NOT a fail. */
  'UNRESOLVED',
] as const;

export type I20Verdict = (typeof I20_VERDICTS)[number];

export interface I20Comparison {
  readonly verdict: I20Verdict;
  /** The provider-side numerator, or `null` when it could not be summed. */
  readonly providerAcceptedIrrecoverableEffects: number | null;
  /** The immutable historical denominator. Always summable: it is committed local evidence. */
  readonly historicalReservationBasisUnits: bigint;
  /** Which scenarios contributed no trustworthy count. Empty on a measured comparison. */
  readonly unmeasuredScenarios: readonly string[];
  /** One sentence a reviewer can check the verdict against. */
  readonly statement: string;
}

/**
 * Compare the provider's accepted irrecoverable effects against the historical reservation
 * basis. PURE and TOTAL.
 */
export function compareI20(operands: readonly I20ScenarioOperand[]): I20Comparison {
  const basis = operands.reduce((total, operand) => total + operand.historicalReservationUnits, 0n);
  const unmeasured = operands
    .filter((operand) => operand.providerAcceptedCount === null)
    .map((operand) => operand.scenarioLabel);

  if (operands.length === 0) {
    return Object.freeze({
      verdict: 'UNRESOLVED' as const,
      providerAcceptedIrrecoverableEffects: null,
      historicalReservationBasisUnits: 0n,
      unmeasuredScenarios: Object.freeze([]),
      statement:
        'no scenario operands were supplied, so there is nothing to compare; an empty ' +
        'comparison is not a passing comparison',
    });
  }

  if (unmeasured.length > 0) {
    return Object.freeze({
      verdict: 'UNRESOLVED' as const,
      /*
       * `null`, NEVER A PARTIAL SUM.
       *
       * Reporting the sum of the scenarios that WERE measured would put a number beside an
       * UNRESOLVED verdict, and the next reader would compare it. The operand does not exist,
       * so the field does not carry one.
       */
      providerAcceptedIrrecoverableEffects: null,
      historicalReservationBasisUnits: basis,
      unmeasuredScenarios: Object.freeze([...unmeasured]),
      statement:
        `I20 is UNRESOLVED: ${String(unmeasured.length)} of ${String(operands.length)} ` +
        'scenarios produced no trustworthy provider accepted count, and an unmeasured ' +
        'scenario is not a zero',
    });
  }

  const accepted = operands.reduce(
    (total, operand) => total + (operand.providerAcceptedCount ?? 0),
    0,
  );
  const withinBasis = BigInt(accepted) <= basis;
  return Object.freeze({
    verdict: withinBasis ? ('WITHIN_BASIS' as const) : ('EXCEEDS_BASIS' as const),
    providerAcceptedIrrecoverableEffects: accepted,
    historicalReservationBasisUnits: basis,
    unmeasuredScenarios: Object.freeze([]),
    statement: withinBasis
      ? `the provider accepted ${String(accepted)} irrecoverable effect(s) against an ` +
        `immutable historical reservation basis of ${String(basis)} unit(s); every accepted ` +
        'effect stands behind a committed reservation'
      : `THE PROVIDER ACCEPTED ${String(accepted)} irrecoverable effect(s) against a basis ` +
        `of only ${String(basis)} unit(s); at least one provider-side effect has no ` +
        'committed authorisation behind it',
  });
}
