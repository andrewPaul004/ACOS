/**
 * `26 §7`'s steps FROM R ONWARD, transcribed once.
 *
 * ---------------------------------------------------------------------------------
 * WHY THIS IS A SECOND TABLE AND NOT AN EXTENSION OF `AUTHORITY_STEPS`
 *
 * `steps.ts`'s `AUTHORITY_STEPS` is the PRE-RESERVATION sequence, and the accepted S1E
 * suite asserts that property directly:
 *
 *   tests/authority/authority-channel-attacks.test.ts, "there is no step R, S, T, U, V, W
 *   or X in the declared sequence" — "The S1E boundary, as a property of the step table
 *   itself."
 *
 * Appending R to that array would delete an accepted assertion, and the assertion is
 * correct: `AUTHORITY_STEPS` is what the pre-reservation pipeline is checked against, and
 * a pipeline that could claim to have evaluated step R would have a step it does not
 * implement. So S1F declares its own table, the accepted one is untouched, and
 * `LOCAL_AUTHORISATION_STEPS` is what the S1F transaction is checked against.
 *
 * The union of the two tables is `26 §7`'s full sequence, and
 * tests/integration/authority/local-authorisation-boundary.test.ts asserts that — the two
 * tables are disjoint, their concatenation is the flowchart, and neither contains X.
 * ---------------------------------------------------------------------------------
 *
 * `26 §7`'s flowchart, reading the edges from R:
 *
 *   R -> S -> T -> U -> V | W -> X
 *
 * with `S -> O2` where an approval tier applies, and `U -> V` where a prior effect with
 * this key is terminal.
 */

/** The steps `26 §7` places at and after RESERVE. */
export const LOCAL_AUTHORISATION_STEPS = [
  /**
   * RESERVE atomically against EVERY referenced named window instance.
   *
   * `26 §7`, as restated by `phase2-v1.3.1-errata.md §1` (E1 / TB-03): the ordinary branch
   * reserves `total_exposure` into `I3` term 1; the rate branch writes a real zero-amount
   * reservation row and puts the economics into `I3` term 2 through
   * `standing_window_exposure`.
   */
  'R',
  /**
   * The approval requirement. `NONE` continues to T; a tier returns
   * `REQUIRE_APPROVAL — reservation held`.
   */
  'S',
  /** Mint/verify the idempotency key. */
  'T',
  /** Prior effect with this key? */
  'U',
  /** RETURN PRIOR RESULT — no new effect. */
  'V',
  /** PERMIT + emit the signed `AuthorizationDecision`. */
  'W',
] as const;

export type LocalAuthorisationStep = (typeof LOCAL_AUTHORISATION_STEPS)[number];

const LOCAL_STEP_INDEX: ReadonlyMap<LocalAuthorisationStep, number> = new Map(
  LOCAL_AUTHORISATION_STEPS.map((step, index) => [step, index] as const),
);

export function localStepPrecedes(
  earlier: LocalAuthorisationStep,
  later: LocalAuthorisationStep,
): boolean {
  return LOCAL_STEP_INDEX.get(earlier)! < LOCAL_STEP_INDEX.get(later)!;
}

/**
 * `26 §7` step X — THE AUDIT WRITE — IS DELIBERATELY NOT IN THE TABLE ABOVE.
 *
 * `26 §7` property 9: "Every path writes an audit record, including every denial." That is
 * the AUDIT PLANE, and it cannot be inside this transaction: `30 §5.1` is explicit that
 * "cross-database atomicity is not attempted, because it does not exist", and its ordering
 * block puts the audit push AFTER `COMMIT`.
 *
 * What S1F commits is the CONTROL-database journal row — `30 §5.1` item 1's "primary
 * journal lives in the control database", with the gap-free `journal_seq` and the local
 * chain. The push to the audit store, the mirror state machine, `JournalAttestation`, the
 * two-sided completeness diff and `mirrored_at` are all OPEN.
 *
 * A denial's audit record is likewise OPEN. A denial rolls this transaction back, so its
 * record cannot be one of the rows the rollback removes; it belongs to the audit-write
 * path S1F does not build.
 */
export const STEP_X_AUDIT_WRITE_IS_NOT_IMPLEMENTED = true;
