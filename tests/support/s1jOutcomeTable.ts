/**
 * THE HAND-AUTHORED EXPECTED OUTCOME TABLE. THE ORACLE FOR `25 §7.1`'s C4 MATRIX.
 *
 * =================================================================================
 * `§41` OF THE S1J MANDATE — WHY THIS FILE IMPORTS NOTHING
 *
 * "Forbidden: expected outcome read from production recoverability policy; expected state
 *  read from production transition table; [...] Use hand-authored fixtures; separate mock
 *  behavior; direct SQL; separate specification-derived expected state table."
 *
 * `§33` of the continuation mandate repeats it for the v1.3.5 matrix in particular: "Use
 * exact package names. Hand-author test expectations. Do not generate from production
 * transition table."
 *
 * THIS FILE HAS NO IMPORTS AT ALL. Not `outcomePolicy.ts`, not `adapterPort.ts`, not the
 * action catalogue, not a type from `src/`. Every row below was transcribed BY HAND from
 * `25 §7.1`'s printed table and every cell carries the passage it came from, so a reviewer
 * can check the table against the artifacts without reading any production code — which is
 * `36 §0`'s rule ("agreement two implementations obtain from one source is not a
 * cross-implementation check") applied to a policy table.
 *
 * It is the same discipline `tests/support/mirrorPrecedenceTable.ts` uses for `30 §5.1`
 * item 4 and `tests/support/jcs1Oracle.ts` uses for `ACOS-JCS-1`.
 * =================================================================================
 *
 * =================================================================================
 * WHAT v1.3.5 CHANGED IN THIS TABLE, ROW BY ROW
 *
 * The accepted S1J table had SIX rows over three kinds and marked two of the nine cells
 * `UNDECLARED`. v1.3.5 changes four things and this transcription reflects all four:
 *
 *   1. `(IRRECOVERABLE, ADAPTER_RETURNED)` moves from `DISPATCHED_AWAITING_VERIFICATION` to
 *      **`PRESUMED_EXECUTED`** — `25 §7.1`'s own paragraph, OBX-04's second correction.
 *   2. `(IRRECOVERABLE, OUTCOME_UNKNOWN)` moves from `UNDECLARED` (`S1J-C1`) to
 *      **`PRESUMED_EXECUTED`**, because `25 §10.1` (MIE-01) declares the movement the four
 *      artifacts required and none of them defined.
 *   3. A FOURTH KIND, **`NOT_SENT_CONFIRMED`** (OBX-05), reaching the terminal
 *      **`DISPATCH_NOT_SENT_CONFIRMED`** for every class and RELEASING the commitment.
 *   4. `ADAPTER_FAILED` stays `UNDECLARED`, but for the opposite reason: v1.3.4 declared no
 *      state and contradicted itself about retry; v1.3.5 DECLARES that it reaches no state.
 *
 * TWELVE ROWS: three classes × four outcome kinds, written out in full rather than folded,
 * because `30 §5.1`'s AUD-05 is what happens when a policy table's cells are inferred
 * instead of printed.
 * =================================================================================
 */

/** The three declared recoverability classes. `26 §5`'s table. */
export type ExpectedRecoverability = 'REVERSIBLE' | 'COMPENSABLE' | 'IRRECOVERABLE';

/**
 * The four adapter results `25 §7.1` declares, transcribed with its own meanings.
 *
 *   `ADAPTER_RETURNED`    "The call completed and the adapter holds a response. **Not
 *                         evidence that the world changed**."
 *   `OUTCOME_UNKNOWN`     "Timeout or ambiguity. The request **may** have crossed the
 *                         transport boundary."
 *   `NOT_SENT_CONFIRMED`  "The adapter can **positively establish that no external write
 *                         crossed the transport boundary**."
 *   `ADAPTER_FAILED`      "Retained for diagnostics only. **It carries no local outcome
 *                         policy and reaches no local state**."
 */
export type ExpectedOutcomeKind =
  | 'ADAPTER_RETURNED'
  | 'OUTCOME_UNKNOWN'
  | 'NOT_SENT_CONFIRMED'
  | 'ADAPTER_FAILED';

export interface ExpectedRow {
  readonly recoverability: ExpectedRecoverability;
  readonly outcomeKind: ExpectedOutcomeKind;
  /**
   * `RESOLVE` — `25 §7.1` declares a local state for this pair and S1J writes it.
   * `UNDECLARED` — the taxonomy declares that this pair reaches no local state.
   */
  readonly disposition: 'RESOLVE' | 'UNDECLARED';
  /** The exact effect status expected on the committed outcome row, or null. */
  readonly effectStatus: string | null;
  /** What must move in the exposure ledger, transcribed from `25 §10.1` and `25 §7.2`. */
  readonly economicMovement:
    | 'NONE'
    | 'MIE_RESERVED_TO_PRESUMED'
    | 'MIE_RESERVED_RELEASED'
    | 'RESERVATION_RELEASED'
    | null;
  /** `25 §7.1`'s "Same-row redispatch" column. **NO** on every row, without exception. */
  readonly redispatchPermitted: false;
  /**
   * Whether the commitment this effect holds survives the outcome.
   *
   * TRUE everywhere except `NOT_SENT_CONFIRMED`. `25 §7.2`: "**Nothing is released on
   * `OUTCOME_UNKNOWN`.**" A `PRESUMED_EXECUTED` row holds too — the PRESUME movement
   * RELOCATES the unit between terms and does not release it, which is exactly what
   * `25 §10.1`'s "the sum of the three terms does not fall" means.
   */
  readonly commitmentHeld: boolean;
  /** The passage this row was transcribed from. */
  readonly source: string;
}

const HOLD_MONEY =
  '25 §7.1 rows 1–2 (adapter returned → DISPATCHED_AWAITING_VERIFICATION, hold); ' +
  '25 §5 ("A 200 from an API is not evidence that the world changed")';

const UNKNOWN_MONEY =
  '25 §10 row 1 ("Hold and resolve. Reservation held; [...] never a blind retry"); ' +
  '35 §4 ("The exposure reservation remains held. It is not released on timeout")';

const PRESUME =
  '25 §10.1 PRESUME (reserved -= units, presumed += units, three-term sum UNCHANGED, ' +
  'exactly once per outbox identity); 24 §3 K5’s transition table';

const NOT_SENT_TERMINAL =
  '25 §7.1 row 7 (NOT_SENT_CONFIRMED, any class → DISPATCH_NOT_SENT_CONFIRMED); ' +
  '25 §7.2 (terminal, non-reclaimable, a further attempt is a NEW proposal)';

const FAILED_NO_STATE =
  '25 §7.1 ("Retained for diagnostics only. It carries no local outcome policy and ' +
  'reaches no local state") — and K4’s retry is CORRECTED, not reinstated';

export const EXPECTED_OUTCOMES: readonly ExpectedRow[] = Object.freeze([
  // ---------------------------------------------------------------------------------
  // `ADAPTER_RETURNED` — `25 §7.1` rows 1, 2 and 3.
  //
  // ROW 3 IS THE ONE v1.3.5 CORRECTED, and its paragraph gives the reason in full: "An
  // adapter outcome indicating the external request was accepted is **at least as strong as
  // the unknown case** for duplicate-prevention purposes, and `§10`'s reason for assuming
  // execution — that duplication is the expensive error — applies more forcefully when the
  // adapter believes the call succeeded."
  // ---------------------------------------------------------------------------------
  Object.freeze({
    recoverability: 'REVERSIBLE' as const,
    outcomeKind: 'ADAPTER_RETURNED' as const,
    disposition: 'RESOLVE' as const,
    effectStatus: 'DISPATCHED_AWAITING_VERIFICATION',
    economicMovement: 'NONE' as const,
    redispatchPermitted: false as const,
    commitmentHeld: true,
    source: HOLD_MONEY,
  }),
  Object.freeze({
    recoverability: 'COMPENSABLE' as const,
    outcomeKind: 'ADAPTER_RETURNED' as const,
    disposition: 'RESOLVE' as const,
    effectStatus: 'DISPATCHED_AWAITING_VERIFICATION',
    economicMovement: 'NONE' as const,
    redispatchPermitted: false as const,
    commitmentHeld: true,
    source: HOLD_MONEY,
  }),
  Object.freeze({
    recoverability: 'IRRECOVERABLE' as const,
    outcomeKind: 'ADAPTER_RETURNED' as const,
    disposition: 'RESOLVE' as const,
    effectStatus: 'PRESUMED_EXECUTED',
    economicMovement: 'MIE_RESERVED_TO_PRESUMED' as const,
    redispatchPermitted: false as const,
    commitmentHeld: true,
    source: '25 §7.1 row 3 (ADAPTER_RETURNED + IRRECOVERABLE → PRESUMED_EXECUTED, NOT an ' +
      'awaiting-verification state); ' + PRESUME,
  }),

  // ---------------------------------------------------------------------------------
  // `OUTCOME_UNKNOWN` — `25 §10`'s asymmetric table, with `25 §10.1` supplying the movement.
  // ---------------------------------------------------------------------------------
  Object.freeze({
    recoverability: 'REVERSIBLE' as const,
    outcomeKind: 'OUTCOME_UNKNOWN' as const,
    disposition: 'RESOLVE' as const,
    effectStatus: 'DISPATCHED_OUTCOME_UNKNOWN',
    economicMovement: 'NONE' as const,
    redispatchPermitted: false as const,
    commitmentHeld: true,
    source: UNKNOWN_MONEY,
  }),
  Object.freeze({
    recoverability: 'COMPENSABLE' as const,
    outcomeKind: 'OUTCOME_UNKNOWN' as const,
    disposition: 'RESOLVE' as const,
    effectStatus: 'DISPATCHED_OUTCOME_UNKNOWN',
    economicMovement: 'NONE' as const,
    redispatchPermitted: false as const,
    commitmentHeld: true,
    source: UNKNOWN_MONEY,
  }),
  Object.freeze({
    recoverability: 'IRRECOVERABLE' as const,
    outcomeKind: 'OUTCOME_UNKNOWN' as const,
    disposition: 'RESOLVE' as const,
    effectStatus: 'PRESUMED_EXECUTED',
    economicMovement: 'MIE_RESERVED_TO_PRESUMED' as const,
    redispatchPermitted: false as const,
    // THE COMMITMENT IS HELD, AND THIS CELL IS THE WHOLE POINT OF MIE-01.
    // `25 §10.1`: "The sum of the three terms does not fall, so an unknown outcome creates
    // no headroom — which is the whole point of assuming execution."
    commitmentHeld: true,
    source:
      '25 §10 row 2 ("Assume it happened. Never re-dispatch."); ' + PRESUME,
  }),

  // ---------------------------------------------------------------------------------
  // `NOT_SENT_CONFIRMED` — `25 §7.1` row 7 and `25 §7.2`. ONE STATE, TWO RELEASES.
  //
  // "**Because `NOT_SENT_CONFIRMED` proves the external effect did not happen, the existing
  //  commitment is released — in the SAME atomic outcome transaction — according to its
  //  recoverability class.**"
  // ---------------------------------------------------------------------------------
  Object.freeze({
    recoverability: 'REVERSIBLE' as const,
    outcomeKind: 'NOT_SENT_CONFIRMED' as const,
    disposition: 'RESOLVE' as const,
    effectStatus: 'DISPATCH_NOT_SENT_CONFIRMED',
    economicMovement: 'RESERVATION_RELEASED' as const,
    redispatchPermitted: false as const,
    commitmentHeld: false,
    source: NOT_SENT_TERMINAL + '; 25 §7.2 (money released under existing semantics)',
  }),
  Object.freeze({
    recoverability: 'COMPENSABLE' as const,
    outcomeKind: 'NOT_SENT_CONFIRMED' as const,
    disposition: 'RESOLVE' as const,
    effectStatus: 'DISPATCH_NOT_SENT_CONFIRMED',
    economicMovement: 'RESERVATION_RELEASED' as const,
    redispatchPermitted: false as const,
    commitmentHeld: false,
    source: NOT_SENT_TERMINAL + '; 25 §7.2 (money released under existing semantics)',
  }),
  Object.freeze({
    recoverability: 'IRRECOVERABLE' as const,
    outcomeKind: 'NOT_SENT_CONFIRMED' as const,
    disposition: 'RESOLVE' as const,
    effectStatus: 'DISPATCH_NOT_SENT_CONFIRMED',
    economicMovement: 'MIE_RESERVED_RELEASED' as const,
    redispatchPermitted: false as const,
    commitmentHeld: false,
    source:
      NOT_SENT_TERMINAL +
      '; 25 §7.2 ("reserved_irrecoverable -= units, with no presumed and no realised ' +
      'increment. No presumed unit is touched."); 25 §10.1 RELEASE, confirmed-not-sent',
  }),

  // ---------------------------------------------------------------------------------
  // `ADAPTER_FAILED` — no local state, for any class.
  //
  // NOT AN OPEN QUESTION ANY MORE, AND NOT A RETRY. v1.3.5 corrected `24 §3` K4: the
  // bounded retry "applies to retryable workflow and internal failures that occur BEFORE an
  // external-effect claim", and "**a claimed external-effect identity is not retryable**".
  // An adapter that genuinely knows nothing escaped has `NOT_SENT_CONFIRMED` to say so with;
  // one that cannot classify its failure has a failure whose request may have escaped.
  // ---------------------------------------------------------------------------------
  Object.freeze({
    recoverability: 'REVERSIBLE' as const,
    outcomeKind: 'ADAPTER_FAILED' as const,
    disposition: 'UNDECLARED' as const,
    effectStatus: null,
    economicMovement: null,
    redispatchPermitted: false as const,
    commitmentHeld: true,
    source: FAILED_NO_STATE,
  }),
  Object.freeze({
    recoverability: 'COMPENSABLE' as const,
    outcomeKind: 'ADAPTER_FAILED' as const,
    disposition: 'UNDECLARED' as const,
    effectStatus: null,
    economicMovement: null,
    redispatchPermitted: false as const,
    commitmentHeld: true,
    source: FAILED_NO_STATE,
  }),
  Object.freeze({
    recoverability: 'IRRECOVERABLE' as const,
    outcomeKind: 'ADAPTER_FAILED' as const,
    disposition: 'UNDECLARED' as const,
    effectStatus: null,
    economicMovement: null,
    redispatchPermitted: false as const,
    commitmentHeld: true,
    source: FAILED_NO_STATE,
  }),
]);

/** Look one row up. Throws on an unlisted pair, so a new class fails loudly. */
export function expectedOutcomeFor(
  recoverability: ExpectedRecoverability,
  outcomeKind: ExpectedOutcomeKind,
): ExpectedRow {
  const row = EXPECTED_OUTCOMES.find(
    (r) => r.recoverability === recoverability && r.outcomeKind === outcomeKind,
  );
  if (row === undefined) {
    throw new Error(
      `the hand-authored table has no row for (${recoverability}, ${outcomeKind}); it is ` +
        'meant to be exhaustive over 3 classes × 4 outcome kinds',
    );
  }
  return row;
}
