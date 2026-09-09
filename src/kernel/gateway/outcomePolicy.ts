import type { Recoverability } from '../canonicalisation/actionCatalogue.js';
import type { AdapterOutcomeKind } from './adapterPort.js';

/**
 * THE RECOVERABILITY-KEYED OUTCOME POLICY. A PURE FUNCTION OVER TWO TRUSTED OPERANDS.
 *
 * =================================================================================
 * `25 §10`'s TABLE IS THE SPECIFICATION, VERBATIM
 *
 *   "**v1.1: the unknown-outcome policy is keyed on recoverability (R13, DUP-02).** v1.0
 *    had one policy for all classes, and it was right for money and wrong for irrecoverable
 *    actions in the same way.
 *
 *    | Class | On unknown outcome |
 *    | REVERSIBLE / COMPENSABLE (money) | **Hold and resolve.** Reservation held; the
 *      reconciler queries or re-POSTs under the original authorisation; never a blind
 *      retry. |
 *    | IRRECOVERABLE (send, post, reship) | **Assume it happened. Never re-dispatch.** Mark
 *      `PRESUMED_EXECUTED`, consume the irrecoverable unit, and resolve later from the
 *      provider's delivery event matched on the correlation tag. |
 *
 *    The asymmetry is the point. For money the expensive error is duplication, so hold and
 *    ask. For an irrecoverable send the expensive error is *also* duplication [...] so
 *    assume-executed is the safe direction and the missed message is recovered by
 *    **detection rather than by retry**."
 *
 * `35 §4` supplies the money branch's state and its ledger consequence:
 *
 *   "The effect row is in state `DISPATCHED_OUTCOME_UNKNOWN`. This is a distinct state, not
 *    an error — conflating 'failed' with 'unknown' is what produces double execution."
 *   "The exposure reservation **remains held**. It is not released on timeout, because
 *    releasing it would let a retry plus a concurrent proposal collectively exceed the
 *    window."
 * =================================================================================
 *
 * =================================================================================
 * THE TWO OPERANDS, AND WHERE EACH COMES FROM
 *
 *   `recoverability`  `26 §5`: "Assigned per action class in the catalogue, not per
 *                     request, and **never by a model**." The caller of this function reads
 *                     it from the COMMITTED `effect` row inside the outcome transaction —
 *                     never from an adapter result, never from a request field, never from
 *                     the envelope the adapter was handed.
 *
 *   `outcomeKind`     The typed result of the trusted adapter, read from the process-local
 *                     attestation the invocation minted. `§14`: "The adapter is part of the
 *                     TCB. The model must not choose the outcome."
 *
 * `§17`'s SPOOF ATTACK — "authoritative effect = IRRECOVERABLE; attacker says REVERSIBLE",
 * and its reverse — has no surface here: this function has two parameters, both supplied by
 * `outcomeTransaction.ts` from authoritative sources, and the vulnerable control that
 * trusts a caller-supplied recoverability is
 * `tests/negative-controls/unsafe-outcome-policy.ts`.
 *
 * NO ARBITRARY ERROR STRING IS INSPECTED. `§14`: "Do not inspect arbitrary error strings to
 * determine economic outcome." The `reason` on an `OUTCOME_UNKNOWN` and the `failureClass`
 * on an `ADAPTER_FAILED` are not parameters of this function at all.
 * =================================================================================
 */

/**
 * `§20`'s economic movement, as a declared value.
 *
 * `NONE` IS THE ONLY MEMBER, AND IT IS ARCHITECTURE RATHER THAN AN OMISSION:
 *
 *   - `ADAPTER_RETURNED`. `25 §5`: "A 200 from an API is not evidence that the world
 *     changed. Verification is an independent read-back — and for money, it is the
 *     settlement reconciliation, not the API response." `24 §3` K5's realised term is fed
 *     by "settlement events from the finance computation" (`28 §4`), which S1J does not
 *     build. So `§18`'s conditional — "if architecture says success makes it realised" — is
 *     answered in the negative.
 *
 *   - `OUTCOME_UNKNOWN` for money. Holding a reservation is the ABSENCE of a movement.
 *     `I3`'s presumed term is bound by the registry to the `PRESUMED_SETTLED` state, which
 *     is `I32`'s liquidity-override path (`26 §10.3`) and not this one, so an unknown
 *     outcome does not move a reservation into it either.
 *
 * The type exists so that "nothing moved" is a value the outcome row records and a test can
 * assert, rather than an absence a reader has to infer. `0012`'s
 * `dispatch_outcome_economic_movement_declared` CHECK pins the column, so a later slice
 * that moves money on an outcome must change a migration.
 */
export const ECONOMIC_MOVEMENTS = ['NONE'] as const;

export type EconomicMovement = (typeof ECONOMIC_MOVEMENTS)[number];

/** The post-dispatch effect statuses this slice can reach. `0012` holds the same domain. */
export const POST_DISPATCH_EFFECT_STATUSES = [
  /**
   * IMPLEMENTATION DECLARATION — `S1J-C4`.
   *
   * The SEMANTICS are v1.3.4's: `25 §5` moves the work item to `VERIFYING` when the adapter
   * returns, "a 200 from an API is not evidence that the world changed", and `24 §3` K4
   * reaches `VERIFIED` only from an independent read-back. What v1.3.4 declares no
   * IDENTIFIER for is the effect row's own state in that interval — there is no
   * `DISPATCHED` state anywhere in the package, and `no-transport-boundary.test.ts`
   * asserted its absence at S1I.
   *
   * The name shares `35 §4`'s prefix so the two post-dispatch states form one domain, and
   * it is deliberately NEITHER `VERIFIED` (K4's terminal literal, unreachable without a
   * read-back S1J does not perform) NOR `DISPATCHED` (declared nowhere).
   */
  'DISPATCHED_AWAITING_VERIFICATION',
  /** `35 §4`'s own literal for the effect row. Transcribed, not chosen. */
  'DISPATCHED_OUTCOME_UNKNOWN',
] as const;

export type PostDispatchEffectStatus = (typeof POST_DISPATCH_EFFECT_STATUSES)[number];

/** Why a policy is undeclared. Each member cites the artifact that leaves it open. */
export const UNDECLARED_POLICY_REASONS = [
  /**
   * `S1J-C1`. IRRECOVERABLE + unknown outcome.
   *
   * v1.3.4 states the policy in four places and all four state it as one INSEPARABLE pair
   * — mark `PRESUMED_EXECUTED` AND consume the irrecoverable unit (`25 §10`, `24 §3` K4,
   * `34` ADR-026 item 3, `35 §12.3`). What "consume the irrecoverable unit" IS as a ledger
   * mutation is declared nowhere:
   *
   *   - `24 §3` K5 declares three irrecoverable terms and no transition between them;
   *   - the registry binds `I3` term 3 to the `PRESUMED_SETTLED` state, which is `I32`'s
   *     money-reservation override state, not `PRESUMED_EXECUTED`;
   *   - `I20` bounds provider-accepted messages against "Σ **reserved** irrecoverable
   *     units" and its test column wants a window "including a `PRESUMED_EXECUTED` row",
   *     which reads as the reserved term surviving the consumption;
   *   - `26 §7` step R's prose reserves into `I3` term 1 while its flowchart node reserves
   *     "money · irrecoverable-count", and `51 §2` gives the MIE windows both a `max_count`
   *     and a `max_irrecoverable_units` at the same figures;
   *   - and no accepted slice reserves an irrecoverable unit at all —
   *     `stepR.reserveOrdinary` moves `reserved_monetary` and `reserved_count`, so
   *     `reserved_irrecoverable` has no production writer and THERE IS NO RESERVED UNIT TO
   *     CONSUME.
   *
   * `§2` and `§16` of the mandate: "RETURN PARTIAL. Do not invent a counter." So this
   * policy is undeclared, the outcome transaction writes nothing, and `0012`'s
   * `dispatch_outcome_irrecoverable_unknown_undeclared` CHECK makes the row unwritable even
   * if a future code path tried.
   *
   * THE SAFETY HALF STILL HOLDS AND IS NOT AT ISSUE. "Never re-dispatch" is enforced by the
   * committed `CLAIMED` row, `0010`'s trigger and the claim API's `ALREADY_CLAIMED`. What is
   * missing is the ACCOUNTING half.
   */
  'IRRECOVERABLE_UNKNOWN_MIE_TRANSITION_UNDECLARED',
  /**
   * `S1J-C2`. A known adapter failure.
   *
   * `24 §3` K4 declares the RESPONSE — "On adapter failure, bounded retry with jitter
   * against the same idempotency key, then dead-letter to an Incident" — and declares NO
   * effect state for it. `25 §5`'s lifecycle has no edge out of `EXECUTING` for a known
   * failure either: its two edges are "adapter returned" and "timeout / ambiguous".
   *
   * And the declared response CONTRADICTS `25 §7`'s declared state machine: a bounded retry
   * against the same idempotency key needs a second dispatch of a row that is `CLAIMED`,
   * and OBX-01 admits "no transition out of `CLAIMED`, and no second transition into it".
   *
   * `§19`: "Only implement this branch if current v1.3.4 declares one for the immediate
   * adapter result [...] If no immediate known-not-sent state exists, do not invent one."
   * `NEVER_SENT` is explicitly NOT reused: `25 §10` reserves it for delivery-event evidence
   * AFTER `PRESUMED_EXECUTED`, and `35 §12.3` makes it "a new proposal requiring fresh
   * authorisation".
   */
  'KNOWN_FAILURE_STATE_UNDECLARED',
] as const;

export type UndeclaredPolicyReason = (typeof UNDECLARED_POLICY_REASONS)[number];

export type OutcomePolicy =
  | {
      readonly kind: 'RESOLVE';
      readonly effectStatus: PostDispatchEffectStatus;
      readonly economicMovement: EconomicMovement;
      /** `25 §7` / `I36`. False on every branch, and there is no branch where it is true. */
      readonly redispatchPermitted: false;
      /** `35 §4`: the reservation is held on unknown. True on every branch here. */
      readonly reservationHeld: true;
      /** The artifact this row of the policy came from, for the audit trail and the tests. */
      readonly source: string;
    }
  | {
      readonly kind: 'UNDECLARED';
      readonly reason: UndeclaredPolicyReason;
      readonly detail: string;
    };

/**
 * `25 §10`'s table, plus `25 §5`'s success edge, as a total function.
 *
 * WRITTEN AS AN EXHAUSTIVE SWITCH OVER `outcomeKind` AND THEN OVER `recoverability`,
 * deliberately: `noFallthroughCasesInSwitch` and the absence of a `default` mean a new
 * outcome kind or a new recoverability class fails to compile rather than falling into a
 * permissive branch. `30 §5.1`'s AUD-05 is the precedent — an unordered table whose most
 * consequential case had two specified behaviours — and the lesson generalises: a policy
 * table implemented with a default arm has a specified behaviour for cases nobody wrote.
 */
export function outcomePolicyFor(
  recoverability: Recoverability,
  outcomeKind: AdapterOutcomeKind,
): OutcomePolicy {
  switch (outcomeKind) {
    case 'ADAPTER_RETURNED':
      // `25 §5`: "EXECUTING --> VERIFYING: adapter returned". The same answer for all three
      // classes, because `25 §10`'s asymmetry is a property of the UNKNOWN branch only —
      // its table is titled "On unknown outcome" and has no success column.
      return {
        kind: 'RESOLVE',
        effectStatus: 'DISPATCHED_AWAITING_VERIFICATION',
        economicMovement: 'NONE',
        redispatchPermitted: false,
        reservationHeld: true,
        source: '25 §5 (adapter returned); 24 §3 K4 (VERIFIED requires an independent read-back)',
      };

    case 'OUTCOME_UNKNOWN':
      switch (recoverability) {
        case 'REVERSIBLE':
        case 'COMPENSABLE':
          // `25 §10` row 1: "Hold and resolve. Reservation held; the reconciler queries or
          // re-POSTs under the original authorisation; never a blind retry."
          //
          // S1J DOES THE HOLDING AND NONE OF THE RESOLVING. `25 §8.3`'s reconciler is a
          // gateway-dispatched external write under the original authorisation, and it is
          // in the later slice with the vendor. So the effect sits in
          // `DISPATCHED_OUTCOME_UNKNOWN` and `I9` — "no effect is in a non-terminal state
          // past its SLA" — is the detector that it is still sitting there.
          return {
            kind: 'RESOLVE',
            effectStatus: 'DISPATCHED_OUTCOME_UNKNOWN',
            economicMovement: 'NONE',
            redispatchPermitted: false,
            reservationHeld: true,
            source: '25 §10 row 1 (hold and resolve); 35 §4 (reservation remains held)',
          };
        case 'IRRECOVERABLE':
          return {
            kind: 'UNDECLARED',
            reason: 'IRRECOVERABLE_UNKNOWN_MIE_TRANSITION_UNDECLARED',
            detail:
              '25 §10 row 2 requires PRESUMED_EXECUTED and consumption of the ' +
              'irrecoverable unit as one act; v1.3.4 declares no ledger transition for the ' +
              'consumption and no accepted slice reserves an irrecoverable unit ' +
              '(S1J-C1). The claim stays CLAIMED and is never re-dispatched.',
          };
      }
      break;

    case 'ADAPTER_FAILED':
      return {
        kind: 'UNDECLARED',
        reason: 'KNOWN_FAILURE_STATE_UNDECLARED',
        detail:
          '24 §3 K4 declares a bounded retry against the same idempotency key and no ' +
          'effect state; the retry contradicts 25 §7 OBX-01, which admits no second ' +
          'transition into CLAIMED (S1J-C2).',
      };
  }
  // Unreachable: both switches are exhaustive over their union types, and TypeScript
  // narrows `recoverability` to `never` here — which is the proof, not a comment. An
  // assertion rather than a fallback, for the reason the header gives.
  throw new Error(
    `no declared outcome policy for (${String(recoverability)}, ${String(outcomeKind)}); the ` +
      'switch over 25 §10 is exhaustive and reaching this line is a defect',
  );
}
