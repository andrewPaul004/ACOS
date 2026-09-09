/**
 * THE HAND-AUTHORED EXPECTED OUTCOME TABLE. THE ORACLE FOR `25 §10`.
 *
 * =================================================================================
 * `§41` OF THE S1J MANDATE — WHY THIS FILE IMPORTS NOTHING
 *
 * "Forbidden: expected outcome read from production recoverability policy; expected state
 *  read from production transition table; [...] Use hand-authored fixtures; separate mock
 *  behavior; direct SQL; separate specification-derived expected state table."
 *
 * THIS FILE HAS NO IMPORTS AT ALL. Not `outcomePolicy.ts`, not `adapterPort.ts`, not the
 * action catalogue, not a type from `src/`. Every row below was transcribed from v1.3.4 by
 * hand and every cell carries the passage it came from, so a reviewer can check the table
 * against the artifacts without reading any production code — which is `36 §0`'s rule
 * ("agreement two implementations obtain from one source is not a cross-implementation
 * check") applied to a policy table.
 *
 * It is the same discipline `tests/support/mirrorPrecedenceTable.ts` uses for `30 §5.1`
 * item 4 and `tests/support/jcs1Oracle.ts` uses for `ACOS-JCS-1`.
 * =================================================================================
 */

/** The three declared recoverability classes. `26 §5`'s table. */
export type ExpectedRecoverability = 'REVERSIBLE' | 'COMPENSABLE' | 'IRRECOVERABLE';

/**
 * The three adapter results v1.3.4 names.
 *
 *   `ADAPTER_RETURNED`  `25 §5`: "EXECUTING --> VERIFYING: adapter returned".
 *   `OUTCOME_UNKNOWN`   `25 §5`: "EXECUTING --> ATTEMPT_UNRESOLVED: timeout / ambiguous",
 *                       and `35 §4`'s "DISPATCHED_OUTCOME_UNKNOWN [...] a distinct state,
 *                       not an error".
 *   `ADAPTER_FAILED`    `24 §3` K4: "On adapter failure, bounded retry with jitter against
 *                       the same idempotency key, then dead-letter to an Incident."
 */
export type ExpectedOutcomeKind = 'ADAPTER_RETURNED' | 'OUTCOME_UNKNOWN' | 'ADAPTER_FAILED';

export interface ExpectedRow {
  readonly recoverability: ExpectedRecoverability;
  readonly outcomeKind: ExpectedOutcomeKind;
  /**
   * `RESOLVE` — v1.3.4 declares a local state for this pair and S1J writes it.
   * `UNDECLARED` — v1.3.4 leaves a load-bearing part of it open, so nothing is written.
   */
  readonly disposition: 'RESOLVE' | 'UNDECLARED';
  /** The exact effect status expected on the committed outcome row, or null. */
  readonly effectStatus: string | null;
  /** What must move in the exposure ledger. `'NONE'` on every declared row. */
  readonly economicMovement: 'NONE' | null;
  /** `25 §7` / `I36`. Never true, on any row. */
  readonly redispatchPermitted: false;
  /** `35 §4`: the reservation is held. True wherever a state is reached. */
  readonly reservationHeld: boolean;
  /** The passage this row was transcribed from. */
  readonly source: string;
}

/**
 * SIX ROWS: three classes × three outcome kinds, minus nothing. Written out in full rather
 * than folded, because `30 §5.1`'s AUD-05 is what happens when a policy table's cells are
 * inferred instead of printed.
 */
export const EXPECTED_OUTCOMES: readonly ExpectedRow[] = Object.freeze([
  // ---------------------------------------------------------------------------------
  // `ADAPTER_RETURNED`. `25 §5` gives ONE edge for it and does not split it by class:
  // "EXECUTING --> VERIFYING: adapter returned", and its own note — "A 200 from an API is
  // not evidence that the world changed. Verification is an independent read-back — and
  // for money, it is the settlement reconciliation, not the API response."
  //
  // SO NO CLASS REACHES A TERMINAL STATE AND NONE REALISES ANYTHING. `24 §3` K4 lists
  // `VERIFIED` among the terminal statuses and it is reached from the read-back, not from
  // the call; `24 §3` K5's realised term is fed by "settlement events from the finance
  // computation".
  // ---------------------------------------------------------------------------------
  Object.freeze({
    recoverability: 'REVERSIBLE' as const,
    outcomeKind: 'ADAPTER_RETURNED' as const,
    disposition: 'RESOLVE' as const,
    effectStatus: 'DISPATCHED_AWAITING_VERIFICATION',
    economicMovement: 'NONE' as const,
    redispatchPermitted: false as const,
    reservationHeld: true,
    source: '25 §5 (adapter returned → VERIFYING); 24 §3 K4 (VERIFIED needs a read-back)',
  }),
  Object.freeze({
    recoverability: 'COMPENSABLE' as const,
    outcomeKind: 'ADAPTER_RETURNED' as const,
    disposition: 'RESOLVE' as const,
    effectStatus: 'DISPATCHED_AWAITING_VERIFICATION',
    economicMovement: 'NONE' as const,
    redispatchPermitted: false as const,
    reservationHeld: true,
    source: '25 §5; 25 §5 note on VERIFYING ("not the API response")',
  }),
  Object.freeze({
    recoverability: 'IRRECOVERABLE' as const,
    outcomeKind: 'ADAPTER_RETURNED' as const,
    disposition: 'RESOLVE' as const,
    effectStatus: 'DISPATCHED_AWAITING_VERIFICATION',
    economicMovement: 'NONE' as const,
    redispatchPermitted: false as const,
    reservationHeld: true,
    // `25 §10`'s asymmetry is declared for the UNKNOWN branch only — its table is titled
    // "On unknown outcome" — so a KNOWN return has no class-specific row.
    source: '25 §5; 25 §10 (its table covers the unknown branch only)',
  }),

  // ---------------------------------------------------------------------------------
  // `OUTCOME_UNKNOWN`. `25 §10`'s table, both rows.
  // ---------------------------------------------------------------------------------
  Object.freeze({
    recoverability: 'REVERSIBLE' as const,
    outcomeKind: 'OUTCOME_UNKNOWN' as const,
    disposition: 'RESOLVE' as const,
    effectStatus: 'DISPATCHED_OUTCOME_UNKNOWN',
    economicMovement: 'NONE' as const,
    redispatchPermitted: false as const,
    reservationHeld: true,
    source:
      '25 §10 row 1 ("Hold and resolve. Reservation held; [...] never a blind retry"); ' +
      '35 §4 ("The exposure reservation remains held. It is not released on timeout")',
  }),
  Object.freeze({
    recoverability: 'COMPENSABLE' as const,
    outcomeKind: 'OUTCOME_UNKNOWN' as const,
    disposition: 'RESOLVE' as const,
    effectStatus: 'DISPATCHED_OUTCOME_UNKNOWN',
    economicMovement: 'NONE' as const,
    redispatchPermitted: false as const,
    reservationHeld: true,
    source: '25 §10 row 1; 35 §4',
  }),
  Object.freeze({
    recoverability: 'IRRECOVERABLE' as const,
    outcomeKind: 'OUTCOME_UNKNOWN' as const,
    // `25 §10` row 2 DOES declare a policy — "Assume it happened. Never re-dispatch. Mark
    // `PRESUMED_EXECUTED`, consume the irrecoverable unit" — and it declares it as ONE
    // act. The consumption's ledger mutation is declared nowhere in v1.3.4, and no
    // accepted slice reserves an irrecoverable unit for it to consume, so the pair cannot
    // be performed. `§2`/`§16`: RETURN PARTIAL rather than invent a counter (`S1J-C1`).
    disposition: 'UNDECLARED' as const,
    effectStatus: null,
    economicMovement: null,
    redispatchPermitted: false as const,
    // Nothing is written, so nothing is released either: the reservation stands because no
    // statement touched it.
    reservationHeld: true,
    source:
      '25 §10 row 2 + 24 §3 K4 + 34 ADR-026 item 3 + 35 §12.3 (all four state ' +
      'PRESUMED_EXECUTED and the unit consumption as one act); 24 §3 K5 (three ' +
      'irrecoverable terms, no declared transition); I3 term 3 (bound to ' +
      'PRESUMED_SETTLED, which is I32’s override state); I20 (bounds against ' +
      'RESERVED units); 26 §7 step R (prose reserves I3 term 1, flowchart says ' +
      '"money · irrecoverable-count")',
  }),

  // ---------------------------------------------------------------------------------
  // `ADAPTER_FAILED`. No declared state, for any class — `S1J-C2`.
  //
  // `24 §3` K4 declares the RESPONSE and no state, `25 §5`'s lifecycle has no edge out of
  // `EXECUTING` for a known failure, and the declared response contradicts `25 §7`
  // OBX-01: a bounded retry against the same idempotency key needs a second dispatch of a
  // row that is `CLAIMED`, and OBX-01 admits "no transition out of `CLAIMED`, and no
  // second transition into it".
  //
  // `NEVER_SENT` IS NOT THE ANSWER. `25 §10` reserves it for delivery-event evidence AFTER
  // `PRESUMED_EXECUTED`, and `35 §12.3` makes it "a new proposal requiring fresh
  // authorisation, never a retry". `§19`: do not misuse it.
  // ---------------------------------------------------------------------------------
  Object.freeze({
    recoverability: 'REVERSIBLE' as const,
    outcomeKind: 'ADAPTER_FAILED' as const,
    disposition: 'UNDECLARED' as const,
    effectStatus: null,
    economicMovement: null,
    redispatchPermitted: false as const,
    reservationHeld: true,
    source: '24 §3 K4 (response, no state) vs 25 §7 OBX-01 (no second claim) — S1J-C2',
  }),
  Object.freeze({
    recoverability: 'COMPENSABLE' as const,
    outcomeKind: 'ADAPTER_FAILED' as const,
    disposition: 'UNDECLARED' as const,
    effectStatus: null,
    economicMovement: null,
    redispatchPermitted: false as const,
    reservationHeld: true,
    source: '24 §3 K4 vs 25 §7 OBX-01 — S1J-C2',
  }),
  Object.freeze({
    recoverability: 'IRRECOVERABLE' as const,
    outcomeKind: 'ADAPTER_FAILED' as const,
    disposition: 'UNDECLARED' as const,
    effectStatus: null,
    economicMovement: null,
    redispatchPermitted: false as const,
    reservationHeld: true,
    source: '24 §3 K4 vs 25 §7 OBX-01 — S1J-C2',
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
        'meant to be exhaustive over 3 classes × 3 outcome kinds',
    );
  }
  return row;
}
