import type { Recoverability } from '../canonicalisation/actionCatalogue.js';
import type { AdapterOutcomeKind } from './adapterPort.js';

/**
 * THE RECOVERABILITY-KEYED OUTCOME POLICY. A PURE FUNCTION OVER TWO TRUSTED OPERANDS.
 *
 * =================================================================================
 * `25 §7.1`'s TABLE IS THE SPECIFICATION, VERBATIM — v1.3.5 (OBX-04, OBX-05)
 *
 *   | Adapter outcome      | Recoverability | Local effect state                | Commitment action                        |
 *   | `ADAPTER_RETURNED`   | REVERSIBLE     | `DISPATCHED_AWAITING_VERIFICATION` | hold, until settlement/verification      |
 *   | `ADAPTER_RETURNED`   | COMPENSABLE    | `DISPATCHED_AWAITING_VERIFICATION` | hold, until later resolution             |
 *   | `ADAPTER_RETURNED`   | IRRECOVERABLE  | **`PRESUMED_EXECUTED`**            | `reserved → presumed` (`25 §10.1`)       |
 *   | `OUTCOME_UNKNOWN`    | REVERSIBLE     | `DISPATCHED_OUTCOME_UNKNOWN`       | hold the reservation                     |
 *   | `OUTCOME_UNKNOWN`    | COMPENSABLE    | `DISPATCHED_OUTCOME_UNKNOWN`       | hold the reservation                     |
 *   | `OUTCOME_UNKNOWN`    | IRRECOVERABLE  | **`PRESUMED_EXECUTED`**            | `reserved → presumed` (`25 §10.1`)       |
 *   | `NOT_SENT_CONFIRMED` | any            | **`DISPATCH_NOT_SENT_CONFIRMED`**  | release the commitment (`25 §7.2`)       |
 *
 * and the sentence that decides the third row against the obvious reading:
 *
 *   "**`ADAPTER_RETURNED` FOR AN IRRECOVERABLE EFFECT REACHES `PRESUMED_EXECUTED`, NOT AN
 *    AWAITING-VERIFICATION STATE.** An adapter outcome indicating the external request was
 *    accepted is **at least as strong as the unknown case** for duplicate-prevention
 *    purposes [...] The unit moves `reserved → presumed` **exactly once**, on whichever of
 *    the two outcomes arrives."
 *
 * AND EVERY STATE IN THE TABLE IS NON-TERMINAL EXCEPT THE LAST. `25 §7.1`: "**AN ADAPTER
 * RESPONSE IS NEVER INDEPENDENT VERIFICATION.** [...] `VERIFIED` still requires the
 * independent read-back `§5` describes." There is no `VERIFIED` member below, and no branch
 * realises anything.
 * =================================================================================
 *
 * =================================================================================
 * WHAT CHANGED FROM THE ACCEPTED S1J POLICY, AND WHY IT IS NOT A LOOSENING
 *
 * The accepted implementation returned `UNDECLARED` for `(IRRECOVERABLE, OUTCOME_UNKNOWN)`
 * — `S1J-C1` — because `25 §10` row 2 required "mark `PRESUMED_EXECUTED`, consume the
 * irrecoverable unit" as one act and **no artifact said what the consumption was**, while
 * no slice reserved a unit for it to consume. `phase2-v1.3.5-errata.md §1` records that the
 * implementation "returned PARTIAL rather than inventing a counter", and MIE-01 is the
 * declaration that closes it. So the branch now RESOLVES because the architecture declares
 * the movement, not because the implementation chose one:
 *
 *   `25 §10.1`'s PRESUME row   `reserved -= units`, `presumed += units`, sum UNCHANGED
 *   `51 §2.3`                  the units, catalogue-owned, `1` for every IRRECOVERABLE class
 *   `24 §3` K5                 the three-term guard the movement runs against
 *
 * `ADAPTER_FAILED` STILL REACHES NO STATE, AND NOW BY DECLARATION. `25 §7.1`: "Retained
 * for diagnostics only. **It carries no local outcome policy and reaches no local state**,
 * because a failure the adapter cannot classify as confirmed-not-sent is a failure whose
 * request may have escaped." That is no longer an open architecture question, so its arm
 * below is `NO_DECLARED_LOCAL_STATE` rather than an `S1J-C2` gap — and, decisively, it is
 * NOT a retry: `25 §7.1` corrects `24 §3` K4 to "**ONCE A ROW IS `CLAIMED`, THE SAME OUTBOX
 * IDENTITY IS NEVER RETRIED OR REDISPATCHED, ON ANY OUTCOME.**"
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
 * determine economic outcome." The `reason` on an `OUTCOME_UNKNOWN`, the `basis` on a
 * `NOT_SENT_CONFIRMED` and the `failureClass` on an `ADAPTER_FAILED` are not parameters of
 * this function at all. `25 §7.2`: "**THE CLASSIFICATION MAY NOT BE MADE FROM ARBITRARY
 * ERROR-MESSAGE STRINGS.** [...] a string is a vendor's prose, and an economic release
 * decided by prose is a release decided by the vendor's changelog."
 * =================================================================================
 */

/**
 * `§20`'s economic movement, as a declared value — widened by v1.3.5.
 *
 *   `NONE`                      No ledger term moves. `35 §4`: "The exposure reservation
 *                               **remains held**. It is not released on timeout, because
 *                               releasing it would let a retry plus a concurrent proposal
 *                               collectively exceed the window." Holding is the ABSENCE of
 *                               a movement, and this member is how the absence is asserted.
 *
 *   `MIE_RESERVED_TO_PRESUMED`  `25 §10.1`'s PRESUME row, on every bound MIE window
 *                               instance: `reserved_irrecoverable -= units`,
 *                               `presumed_irrecoverable += units`. **THE THREE-TERM SUM IS
 *                               UNCHANGED, SO NO HEADROOM IS CREATED** — `24 §3` K5: "a
 *                               window whose units are presumed rather than reserved admits
 *                               no further commitment than before."
 *
 *   `MIE_RESERVED_RELEASED`     `25 §10.1`'s confirmed-not-sent RELEASE row:
 *                               `reserved_irrecoverable -= units`, **with no presumed and
 *                               no realised increment**. The sum FALLS, which is correct
 *                               precisely because the effect provably did not happen.
 *
 *   `RESERVATION_RELEASED`      `25 §7.2`'s money release at `NOT_SENT_CONFIRMED`: "the
 *                               still-held reservation is released under the existing
 *                               reservation-release semantics."
 *
 * THERE IS STILL NO `REALISED` MEMBER, ON ANY BRANCH. `24 §3` K5's realised term is fed by
 * "settlement events from the finance computation" (`28 §4`), and `25 §10.1`'s REALISE row
 * is reached only from independent provider evidence. Neither exists. `0013`'s
 * `dispatch_outcome_economic_movement_declared` CHECK pins the column to these four, so a
 * later slice that realises anything must change a migration.
 */
export const ECONOMIC_MOVEMENTS = [
  'NONE',
  'MIE_RESERVED_TO_PRESUMED',
  'MIE_RESERVED_RELEASED',
  'RESERVATION_RELEASED',
] as const;

export type EconomicMovement = (typeof ECONOMIC_MOVEMENTS)[number];

/**
 * The post-dispatch effect statuses. `25 §7.1`'s declared set, and `0013` holds the same
 * domain.
 *
 * "The declared non-terminal post-dispatch statuses are `DISPATCHED_AWAITING_VERIFICATION`,
 *  `DISPATCHED_OUTCOME_UNKNOWN` and `PRESUMED_EXECUTED`; the declared terminal one is
 *  `DISPATCH_NOT_SENT_CONFIRMED`."
 */
export const POST_DISPATCH_EFFECT_STATUSES = [
  /**
   * IMPLEMENTATION DECLARATION carried forward from the accepted S1J, and now confirmed by
   * `25 §7.1`'s own table, which prints this literal for the two money classes on
   * `ADAPTER_RETURNED`.
   *
   * The SEMANTICS are unchanged: `25 §5` moves the work item to `VERIFYING` when the
   * adapter returns, "a 200 from an API is not evidence that the world changed", and
   * `24 §3` K4 reaches `VERIFIED` only from an independent read-back.
   */
  'DISPATCHED_AWAITING_VERIFICATION',
  /** `35 §4`'s own literal for the effect row. Transcribed, not chosen. */
  'DISPATCHED_OUTCOME_UNKNOWN',
  /**
   * `24 §3` K4's own literal, reached by an IRRECOVERABLE effect on EITHER informative
   * adapter outcome — `25 §7.1`'s two IRRECOVERABLE rows.
   *
   * IT IS NOT TERMINAL AND IT IS NOT `VERIFIED`. `25 §10.1`: "`PRESUMED_EXECUTED` reached
   * from `ADAPTER_RETURNED` and `PRESUMED_EXECUTED` reached from `OUTCOME_UNKNOWN` are the
   * same state and are resolved by the same provider evidence." That resolution is the
   * later slice's.
   */
  'PRESUMED_EXECUTED',
  /**
   * `25 §7.2`'s literal, and the ONLY terminal status this slice can reach.
   *
   * DELIBERATELY NOT `NEVER_SENT`. `25 §7.2`: "**`DISPATCH_NOT_SENT_CONFIRMED` is immediate
   * trusted-adapter proof at the dispatch attempt**, while **`NEVER_SENT` is later
   * independent provider reconciliation after a possible or presumed execution**. One is
   * evidence that nothing happened; the other is evidence, obtained afterwards, that a
   * thing which was assumed to have happened did not." Conflating them would let one
   * literal carry two evidentiary meanings.
   */
  'DISPATCH_NOT_SENT_CONFIRMED',
] as const;

export type PostDispatchEffectStatus = (typeof POST_DISPATCH_EFFECT_STATUSES)[number];

/** Why a pair reaches no local state. Each member cites the artifact that says so. */
export const UNDECLARED_POLICY_REASONS = [
  /**
   * `ADAPTER_FAILED`, for every class — `25 §7.1` (v1.3.5, OBX-04).
   *
   * THIS IS NO LONGER AN ARCHITECTURE GAP. The accepted S1J returned
   * `KNOWN_FAILURE_STATE_UNDECLARED` because v1.3.4 declared a RESPONSE ("bounded retry
   * with jitter against the same idempotency key") and no state, and the response
   * contradicted `25 §7` OBX-01. v1.3.5 resolves both halves:
   *
   *   - the retry is CORRECTED — it "applies to retryable workflow and internal failures
   *     that occur **before** an external-effect claim", and "**a claimed external-effect
   *     identity is not retryable**";
   *   - the state is DECLARED ABSENT — "**Retained for diagnostics only. It carries no
   *     local outcome policy and reaches no local state**, because a failure the adapter
   *     cannot classify as confirmed-not-sent is a failure whose request may have escaped."
   *
   * So nothing is written, the claim stays committed and non-reclaimable, and an adapter
   * that genuinely knows no write escaped has `NOT_SENT_CONFIRMED` to say so with.
   * `0013`'s `dispatch_outcome_kind_declared` CHECK keeps the literal unwritable.
   */
  'ADAPTER_FAILED_REACHES_NO_LOCAL_STATE',
] as const;

export type UndeclaredPolicyReason = (typeof UNDECLARED_POLICY_REASONS)[number];

export type OutcomePolicy =
  | {
      readonly kind: 'RESOLVE';
      readonly effectStatus: PostDispatchEffectStatus;
      readonly economicMovement: EconomicMovement;
      /**
       * `25 §7.1` / `I36`. FALSE ON EVERY BRANCH, AND THERE IS NO BRANCH WHERE IT IS TRUE.
       *
       * The type is the literal `false`, so a future edit that tried to make one branch
       * retryable would not compile. `25 §7.1`: "ONCE A ROW IS `CLAIMED`, THE SAME OUTBOX
       * IDENTITY IS NEVER RETRIED OR REDISPATCHED, ON ANY OUTCOME."
       */
      readonly redispatchPermitted: false;
      /**
       * Whether the commitment this effect holds survives the outcome.
       *
       * TRUE on every branch except `NOT_SENT_CONFIRMED`, which is the ONLY outcome
       * `25 §7.2` releases anything for: "**Nothing is released on `OUTCOME_UNKNOWN`.**"
       * A `PRESUMED_EXECUTED` branch holds too — the PRESUME movement relocates the unit
       * between terms and does not release it, which is what "no headroom" means.
       */
      readonly commitmentHeld: boolean;
      /** The artifact this row of the policy came from, for the audit trail and the tests. */
      readonly source: string;
    }
  | {
      readonly kind: 'UNDECLARED';
      readonly reason: UndeclaredPolicyReason;
      readonly detail: string;
    };

/**
 * `25 §7.1`'s table as a total function.
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
      switch (recoverability) {
        case 'REVERSIBLE':
        case 'COMPENSABLE':
          // `25 §7.1` rows 1 and 2: "hold, until settlement/verification" / "hold, until
          // later resolution". `25 §5`: "A 200 from an API is not evidence that the world
          // changed. Verification is an independent read-back — and for money, it is the
          // settlement reconciliation, not the API response."
          return {
            kind: 'RESOLVE',
            effectStatus: 'DISPATCHED_AWAITING_VERIFICATION',
            economicMovement: 'NONE',
            redispatchPermitted: false,
            commitmentHeld: true,
            source:
              '25 §7.1 rows 1–2 (adapter returned, money holds); 25 §5 (a 200 is not ' +
              'evidence); 24 §3 K4 (VERIFIED requires an independent read-back)',
          };
        case 'IRRECOVERABLE':
          // `25 §7.1` row 3, and the paragraph beneath it. THE SAME STATE AND THE SAME
          // MOVEMENT AS THE UNKNOWN CASE, on purpose: "An adapter outcome indicating the
          // external request was accepted is at least as strong as the unknown case for
          // duplicate-prevention purposes."
          return {
            kind: 'RESOLVE',
            effectStatus: 'PRESUMED_EXECUTED',
            economicMovement: 'MIE_RESERVED_TO_PRESUMED',
            redispatchPermitted: false,
            commitmentHeld: true,
            source:
              '25 §7.1 row 3 (ADAPTER_RETURNED + IRRECOVERABLE reaches PRESUMED_EXECUTED, ' +
              'not an awaiting-verification state); 25 §10.1 PRESUME (reserved → presumed, ' +
              'sum unchanged); 24 §3 K5',
          };
      }
      break;

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
            commitmentHeld: true,
            source: '25 §10 row 1 (hold and resolve); 35 §4 (reservation remains held)',
          };
        case 'IRRECOVERABLE':
          // `25 §10` row 2, with `25 §10.1` supplying the movement the four artifacts
          // required and none of them declared: "**`consume the irrecoverable unit` IS THE
          // PRESUME ROW, AND NOTHING ELSE.**"
          //
          // THE SUM DOES NOT FALL, SO AN UNKNOWN OUTCOME CREATES NO HEADROOM. That is the
          // whole reason the movement is `reserved → presumed` rather than a release, and
          // it is why `unsafe-mie-release-on-unknown.ts` and
          // `unsafe-mie-direct-to-realised.ts` are discriminating controls rather than
          // stylistic variants.
          return {
            kind: 'RESOLVE',
            effectStatus: 'PRESUMED_EXECUTED',
            economicMovement: 'MIE_RESERVED_TO_PRESUMED',
            redispatchPermitted: false,
            commitmentHeld: true,
            source:
              '25 §10 row 2 (assume it happened, never re-dispatch); 25 §10.1 PRESUME ' +
              '(reserved → presumed, sum unchanged, exactly once per effect identity); ' +
              '24 §3 K5 (the three-term guard)',
          };
      }
      break;

    case 'NOT_SENT_CONFIRMED':
      // `25 §7.1` row 7 — ONE ROW FOR ALL THREE CLASSES on the state, and a class-keyed
      // release on the ledger. `25 §7.2`: "**Because `NOT_SENT_CONFIRMED` proves the
      // external effect did not happen, the existing commitment is released — in the SAME
      // atomic outcome transaction — according to its recoverability class.**"
      switch (recoverability) {
        case 'REVERSIBLE':
        case 'COMPENSABLE':
          // "For REVERSIBLE and COMPENSABLE money, the still-held reservation is released
          // under the existing reservation-release semantics."
          return {
            kind: 'RESOLVE',
            effectStatus: 'DISPATCH_NOT_SENT_CONFIRMED',
            economicMovement: 'RESERVATION_RELEASED',
            redispatchPermitted: false,
            commitmentHeld: false,
            source: '25 §7.1 row 7; 25 §7.2 (money released under existing semantics)',
          };
        case 'IRRECOVERABLE':
          // "For IRRECOVERABLE, `reserved_irrecoverable -= units`, **with no presumed and
          // no realised increment**. **No presumed unit is touched**, because
          // `NOT_SENT_CONFIRMED` is admissible only before an uncertain or executed
          // classification has been reached."
          return {
            kind: 'RESOLVE',
            effectStatus: 'DISPATCH_NOT_SENT_CONFIRMED',
            economicMovement: 'MIE_RESERVED_RELEASED',
            redispatchPermitted: false,
            commitmentHeld: false,
            source:
              '25 §7.1 row 7; 25 §7.2 (reserved_irrecoverable -= units, no presumed and ' +
              'no realised increment); 25 §10.1 RELEASE, confirmed-not-sent',
          };
      }
      break;

    case 'ADAPTER_FAILED':
      return {
        kind: 'UNDECLARED',
        reason: 'ADAPTER_FAILED_REACHES_NO_LOCAL_STATE',
        detail:
          '25 §7.1 retains ADAPTER_FAILED for diagnostics only: it carries no local ' +
          'outcome policy and reaches no local state, because a failure the adapter ' +
          'cannot classify as confirmed-not-sent is a failure whose request may have ' +
          'escaped. The claim stays CLAIMED and is never re-dispatched (OBX-01, I36).',
      };
  }
  // Unreachable: both switches are exhaustive over their union types, and TypeScript
  // narrows `recoverability` to `never` here — which is the proof, not a comment. An
  // assertion rather than a fallback, for the reason the header gives.
  throw new Error(
    `no declared outcome policy for (${String(recoverability)}, ${String(outcomeKind)}); the ` +
      'switch over 25 §7.1 is exhaustive and reaching this line is a defect',
  );
}

/**
 * Whether a resolved policy requires the outcome transaction to take the money-path lock
 * order — `30 §5.1`'s ordering block, v1.3.5.
 *
 * "**The outcome transaction takes the money-path lock order where — and only where — it
 *  moves the ledger.** An outcome that reaches `PRESUMED_EXECUTED` or
 *  `DISPATCH_NOT_SENT_CONFIRMED` moves `window_balance` (`25 §10.1`, `24 §3` K5) and
 *  therefore takes step 1 of `§5.2`'s order first and the journal counter last, exactly as
 *  the authorising transaction does. [...] An outcome reaching an awaiting-verification or
 *  outcome-unknown state moves no ledger term and takes no balance lock."
 *
 * DERIVED FROM THE MOVEMENT AND NOT FROM THE STATE, so the two cannot drift: `0013`'s
 * `dispatch_outcome_movement_matches_status` CHECK is the database's own reading of the
 * same biconditional.
 */
export function movesLedger(movement: EconomicMovement): boolean {
  return movement !== 'NONE';
}
