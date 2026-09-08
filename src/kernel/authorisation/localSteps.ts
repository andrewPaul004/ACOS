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
 * `26 §7` step X — THE AUDIT WRITE — IS STILL DELIBERATELY NOT IN THE TABLE ABOVE, AND
 * S1G DOES NOT PUT IT THERE.
 *
 * `26 §7` property 9: "Every path writes an audit record, including every denial." That is
 * the AUDIT PLANE, and it cannot be inside this transaction: `30 §5.1` is explicit that
 * "cross-database atomicity is not attempted, because it does not exist", and its ordering
 * block puts the audit push AFTER `COMMIT`.
 *
 * S1F committed the CONTROL-database journal row. **S1G implements step X**, and it
 * implements it exactly where `30 §5.1` puts it — after the commit, in a table of its own:
 *
 *   `LOCAL_AUTHORISATION_STEPS`   inside the transaction   R S T U V W
 *   `POST_COMMIT_STEPS`           after the COMMIT         X
 *
 * The two accepted assertions that neither table contains `X` therefore remain literally
 * true and are asserted unchanged in `local-authorisation-boundary.test.ts`. A step X
 * appended to either table would be a claim that the audit write shares a commit point
 * with the money path, which is the one thing `30 §5.1` says does not exist.
 */
export const POST_COMMIT_STEPS = [
  /**
   * THE AUDIT WRITE. `30 §5.1`'s "push to audit store (async, retried, quota-bounded,
   * idempotent per §5.2)".
   *
   * Implemented by `src/replication/journalPusher.ts` (the control half) and
   * `src/audit/ingress.ts` (the audit half), across two separate PostgreSQL instances
   * under two separate roles, with no transaction spanning them.
   */
  'X',
] as const;

export type PostCommitStep = (typeof POST_COMMIT_STEPS)[number];

/**
 * WHAT IS STILL NOT IMPLEMENTED AFTER STEP X, so the boundary does not drift.
 *
 * `30 §5.1`'s ordering block has a third arrow — "dispatch, per (4)" — and S1G stops
 * before it. Unbuilt:
 *
 *   the mirror state machine    `30 §5.6`'s three states, the `MirrorInputStallSignal`
 *                               (`§5.7.1`) and the `DegradedModeOverride` (`§5.7.2`)
 *   the dispatch precedence     `30 §5.1` item 4's ordered first-match list
 *   the outbox                  `25 §7` layer 4's exclusive claim (`I36`), `37` S4
 *   dispatch                    the adapter, the HTTP call, the vendor's own idempotency
 *   external anchoring          `I17b`, `30 §5.8`, `37` S3
 *   `I8`                        the audit plane's own vendor reads, `30 §5.10`, `37` S3
 *
 * A DENIAL'S audit record also remains OPEN: a denial rolls the S1F transaction back, so
 * there is no committed journal row for the replication backlog to find, and the denial
 * journal row is a separate write this slice does not add.
 */
export const DISPATCH_IS_NOT_IMPLEMENTED = true;
