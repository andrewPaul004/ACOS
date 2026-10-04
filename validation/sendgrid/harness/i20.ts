/**
 * `I20` — THE COMPARISON MACHINERY. `§14` OF THE S1P CORRECTION MANDATE.
 *
 * =================================================================================
 * WHAT `I20` COMPARES, AND THE TWO SUBSTITUTIONS THAT ARE FORBIDDEN BY NAME
 *
 * `§14`: "compare provider-reported accepted IRRECOVERABLE effects against the immutable
 * historical legitimate reservation basis for the S1P validation window/scenario set."
 *
 * THE NUMERATOR IS THE PROVIDER'S. It is the number of DISTINCT provider message IDENTITIES
 * observed over the WHOLE scenario set — the size of the UNION of every scenario's message-id
 * set, never a sum of per-scenario counts: one message seen under two correlations is ONE
 * accepted effect. This is the audit store's `i20ProviderOperand` definition (a `Set` of
 * `sg_message_id` across the correlation set), so the two cannot differ. `§14`: "Do not
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

/**
 * One scenario's contribution to the comparison.
 *
 * STRUCTURALLY, AN EXACT COUNT CARRIES ITS IDENTITIES. A non-null `providerAcceptedCount` is
 * only representable together with the message-id set it counts, so the numerator is always
 * computable as a union; the count is retained for legibility and is CHECKED against the set
 * (a disagreement makes the comparison UNRESOLVED — neither is chosen silently).
 */
export type I20ScenarioOperand = {
  /** The scenario label, so an UNRESOLVED verdict can name which one is missing. */
  readonly scenarioLabel: string;
  /**
   * The units this scenario's authorisation RESERVED, read from the committed
   * `reservation_window_instance` rows. A `bigint` because the column is `BIGINT` and
   * `51 §2.3`'s counts are exact.
   */
  readonly historicalReservationUnits: bigint;
} & (
  | {
      /** EXACT: the observation settled absence. Must equal the size of the id set below. */
      readonly providerAcceptedCount: number;
      /** The provider message identities this exact count counts. */
      readonly observedProviderMessageIds: readonly string[];
    }
  | {
      /** No exact count: the observation could not settle absence, or none was made. */
      readonly providerAcceptedCount: null;
      /**
       * v1.3.8 — the provider message identities OBSERVED for this correlation (positive
       * evidence: each was seen accepted), copied from `ObservationResult.providerMessageIds`.
       * A LOWER BOUND that can only PROVE an excess. `null` when no trustworthy observation
       * exists — a scenario that never observed, or evidence the oracle refused to read.
       */
      readonly observedProviderMessageIds: readonly string[] | null;
    }
);

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
  /**
   * Scenarios whose exact count disagrees with — or lacks — the message-id set it claims to
   * count. Any member makes the comparison UNRESOLVED.
   */
  readonly inconsistentScenarios: readonly string[];
  /**
   * v1.3.8 — the size of the UNION of every scenario's OBSERVED provider message identities: a
   * LOWER BOUND on the distinct accepted messages, `null` when any scenario carried no
   * trustworthy identity set. Never the exact numerator above, and never a per-scenario sum.
   */
  readonly observedDistinctAcceptedMessagesLowerBound: number | null;
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
      inconsistentScenarios: Object.freeze([]),
      observedDistinctAcceptedMessagesLowerBound: null,
      statement:
        'no scenario operands were supplied, so there is nothing to compare; an empty ' +
        'comparison is not a passing comparison',
    });
  }

  /*
   * AN EXACT COUNT MUST BE THE SIZE OF ITS OWN IDENTITY SET. A count with no set, or a count
   * the set disagrees with, is not chosen between: the comparison is UNRESOLVED.
   */
  const inconsistent = operands
    .filter(
      (operand) =>
        operand.providerAcceptedCount !== null &&
        (!Array.isArray(operand.observedProviderMessageIds) ||
          new Set(operand.observedProviderMessageIds).size !== operand.providerAcceptedCount),
    )
    .map((operand) => operand.scenarioLabel);
  if (inconsistent.length > 0) {
    return Object.freeze({
      verdict: 'UNRESOLVED' as const,
      providerAcceptedIrrecoverableEffects: null,
      historicalReservationBasisUnits: basis,
      unmeasuredScenarios: Object.freeze([...unmeasured]),
      inconsistentScenarios: Object.freeze([...inconsistent]),
      observedDistinctAcceptedMessagesLowerBound: null,
      statement:
        `I20 is UNRESOLVED: ${String(inconsistent.length)} scenario(s) carry an exact provider ` +
        'count that is not the size of the message-identity set it claims to count; neither ' +
        'figure is chosen',
    });
  }

  /*
   * THE GLOBAL UNION. One provider message identity counts ONCE however many scenario
   * correlations it was seen under — the audit store's `i20ProviderOperand` definition.
   */
  const identitySets = operands.map((operand) => operand.observedProviderMessageIds);
  const complete = identitySets.every((set): set is readonly string[] => Array.isArray(set));
  const lowerBound = complete ? distinctIdentities(identitySets as readonly (readonly string[])[]) : null;

  if (unmeasured.length > 0) {
    /*
     * v1.3.8 — A LOWER BOUND CAN PROVE AN EXCESS, AND ONLY AN EXCESS.
     *
     * Messages SEEN were accepted. If the observed messages alone already exceed the immutable
     * basis, an accepted effect has no reservation behind it, and that needs no completeness
     * guarantee (ADR-027 decision 6). A lower bound at or under the basis proves nothing.
     */
    if (lowerBound !== null && BigInt(lowerBound) > basis) {
      return Object.freeze({
        verdict: 'EXCEEDS_BASIS' as const,
        providerAcceptedIrrecoverableEffects: null,
        historicalReservationBasisUnits: basis,
        unmeasuredScenarios: Object.freeze([...unmeasured]),
        inconsistentScenarios: Object.freeze([]),
        observedDistinctAcceptedMessagesLowerBound: lowerBound,
        statement:
          `THE PROVIDER IS OBSERVED TO HAVE ACCEPTED AT LEAST ${String(lowerBound)} ` +
          `irrecoverable effect(s) against a basis of only ${String(basis)} unit(s). Observed ` +
          'messages are positive evidence, so this excess stands although the exact numerator ' +
          'is unestablished',
      });
    }
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
      inconsistentScenarios: Object.freeze([]),
      observedDistinctAcceptedMessagesLowerBound: lowerBound,
      statement:
        `I20 is UNRESOLVED: ${String(unmeasured.length)} of ${String(operands.length)} ` +
        'scenarios produced no exact provider accepted count — an observation under a bound ' +
        'that cannot settle absence is a LOWER BOUND' +
        (lowerBound === null ? '' : ` (observed at least ${String(lowerBound)})`) +
        ', and an unmeasured scenario is not a zero',
    });
  }

  /*
   * EVERY OPERAND EXACT AND CONSISTENT: the numerator is the size of the GLOBAL UNION of their
   * identity sets — NOT the sum of their counts, which would count one message seen under two
   * correlations twice. Every set is present here: an exact count structurally carries one, and
   * the consistency check above refused any that did not.
   */
  const accepted = distinctIdentities(identitySets as readonly (readonly string[])[]);
  const withinBasis = BigInt(accepted) <= basis;
  return Object.freeze({
    verdict: withinBasis ? ('WITHIN_BASIS' as const) : ('EXCEEDS_BASIS' as const),
    providerAcceptedIrrecoverableEffects: accepted,
    historicalReservationBasisUnits: basis,
    unmeasuredScenarios: Object.freeze([]),
    inconsistentScenarios: Object.freeze([]),
    observedDistinctAcceptedMessagesLowerBound: lowerBound,
    statement: withinBasis
      ? `the provider accepted ${String(accepted)} irrecoverable effect(s) against an ` +
        `immutable historical reservation basis of ${String(basis)} unit(s); every accepted ` +
        'effect stands behind a committed reservation'
      : `THE PROVIDER ACCEPTED ${String(accepted)} irrecoverable effect(s) against a basis ` +
        `of only ${String(basis)} unit(s); at least one provider-side effect has no ` +
        'committed authorisation behind it',
  });
}

/** The number of DISTINCT provider message identities across every set: a union, never a sum. */
function distinctIdentities(sets: readonly (readonly string[])[]): number {
  const all = new Set<string>();
  for (const set of sets) for (const id of set) all.add(id);
  return all.size;
}
