/**
 * `§9` — THE SIX KILL POINTS. THE EXISTING ONES, BY THEIR EXISTING NAMES.
 *
 * =================================================================================
 * THESE ARE NOT NEW POINTS AND THEY ARE NOT RENAMED
 *
 * `§9` of the S1P mandate: "First locate their canonical definitions and expected outcomes.
 * Do not rename them unnecessarily. Do not alter their semantic positions merely to make the
 * test easier."
 *
 * The canonical definitions are `§22` of the S1J mandate as
 * `tests/integration/gateway/mock-kill-matrix.test.ts` implements them, and the canonical
 * trigger positions are the `DispatchHooks` members `src/kernel/gateway/effectGateway.ts`
 * declares. **EVERY NAME AND EVERY EXPECTATION BELOW IS COPIED FROM THOSE TWO FILES**, and
 * `tests/sendgrid/kill-point-map.test.ts` asserts the copy against them rather than against a
 * second hand-authored list — so a future change to a hook name or a matrix expectation fails
 * this map rather than silently diverging from it.
 *
 * =================================================================================
 * WHAT THE REAL-PROVIDER RUN ADDS TO THE MOCK MATRIX, AND WHAT IT DOES NOT
 *
 * The mock matrix already proves the LOCAL composition leg, and it says so in capitals:
 * "THIS MOCK MATRIX DOES NOT CLOSE THE REAL I36 VALIDATION GATE." What it cannot supply is
 * the ORACLE — `35 §12.3`: "a mock with a naive idempotency implementation passes while the
 * vendor would not", and the registry's own split: "**An outbox row count is not a provider
 * accepted count.**"
 *
 * So each row below carries a `providerAcceptedCount` expectation ALONGSIDE the local one,
 * and a live run is judged on both. The local half is already proved offline; the provider
 * half has never been measured, and this file does not pretend otherwise —
 * `KILL_POINT_ROWS` is a declaration of what a run would have to show, not a record that one
 * did.
 *
 * =================================================================================
 * POINT 3 IS THE ONE THAT NEEDED A MECHANISM, AND WHY IT IS NOT A HOOK
 *
 * Points 1, 2, 4 and 5 are `DispatchHooks` members: they fire in the CONTROL process, where
 * the harness drives the gateway, and a real provider changes nothing about them.
 *
 * Point 3 — "after mock invocation/request acceptance point, before outcome known" — is
 * INSIDE the adapter, in the INTEGRATION child, and the mock produces it with an
 * `afterAccepted` callback the real adapter has no equivalent of. `§13` of the S1N mandate
 * is why it cannot get one: the dispatch wire carries no control member, so the control
 * plane cannot ask an adapter to crash, and adding a member so it could would be the
 * control channel the whole perimeter exists to deny.
 *
 * The accepted answer is the one `tests/integration-plane/adapterA/` already uses: the
 * behaviour rides on the RUNTIME's own launch configuration, not on a message. So point 3 is
 * produced by launching the integration runtime with `killPointAdapter.js` as its adapter
 * module — a DIFFERENT specifier from `adapter.js`, inside the same runtime root, that wraps
 * the real adapter and exits after the real send returned. `adapter.ts` itself has no such
 * branch and no import of one.
 * =================================================================================
 */

/** The canonical `DispatchHooks` member each control-plane point fires at, or `null`. */
export type KillPointHook =
  | 'afterClaimLock'
  | 'afterClaimCommit'
  | 'beforeOutcomeCommit'
  | 'afterOutcomeCommit'
  | null;

export interface KillPointRow {
  /** The canonical ordinal from `§22` of the S1J mandate. */
  readonly point: 1 | 2 | 3 | 4 | 5 | 6;
  /** The canonical name, verbatim from `mock-kill-matrix.test.ts`. */
  readonly name: string;
  /** Where the kill is produced. A hook, the integration child, or the re-entry itself. */
  readonly trigger: KillPointHook | 'INTEGRATION_CHILD_EXIT_AFTER_SEND' | 'RE_ENTRY';
  /** The outbox row's committed status immediately after the kill. */
  readonly expectedOutboxStatus: 'ENQUEUED' | 'CLAIMED';
  /** Committed rows in `dispatch_outcome` after the kill, IN THE MOCK MATRIX'S composition. */
  readonly expectedOutcomeRows: 0 | 1;
  /**
   * THE SAME COUNT WHEN THE ADAPTER IS IN A **SEPARATE OS PROCESS**. `null` where it is the
   * same number, which is every row but one.
   *
   * =================================================================================
   * THIS FIELD EXISTS BECAUSE THE OFFLINE RUN FOUND A REAL DIFFERENCE, AND `§9` FORBIDS
   * HIDING IT
   *
   * `§9`: "Do not alter their semantic positions merely to make the test easier." So the
   * canonical expectations above are the MOCK MATRIX'S, transcribed unchanged, and this field
   * records — separately and visibly — the one place where the S1N composition legitimately
   * differs.
   *
   * KILL POINT 3 IS THAT PLACE. In `mock-kill-matrix.test.ts` the mock's `afterAccepted`
   * REJECTS, in the CONTROL process, so `dispatchAuthorisedEffect` throws and the outcome
   * transaction never opens: zero outcome rows. `35 §12.3`'s scenario — "The HTTP request
   * leaves; the process dies before the response is recorded" — is one process dying.
   *
   * After S1N there are TWO processes, and the integration child's death is something the
   * control plane OBSERVES rather than shares. `§41`: "after invocation ambiguity ->
   * OUTCOME_UNKNOWN." So the control plane survives, classifies the dead child honestly, and
   * COMMITS an `OUTCOME_UNKNOWN` row. **That is better behaviour, not worse** — the effect is
   * recorded as ambiguous instead of being silently lost — and it is what the accepted S1N
   * integration client already does for every dead child.
   *
   * The row's discriminating property is UNCHANGED and is still the one only a provider can
   * supply: point 2's provider-side count is 0 and point 3's is 1, for the same local
   * `CLAIMED` status and the same `ALREADY_CLAIMED` recovery. What changed is a LOCAL count
   * that the two compositions were always going to report differently, and pretending
   * otherwise would have meant either a false expectation or a driver that killed the control
   * process to reproduce a mock's artefact.
   * =================================================================================
   */
  readonly expectedOutcomeRowsInSeparateProcessComposition: 0 | 1 | null;
  /**
   * The PROVIDER-side accepted-message count for this scenario's correlation, measured by
   * the independent audit read. `§10`'s oracle.
   */
  readonly expectedProviderAcceptedCount: 0 | 1;
  /** What the recovery attempt must do. `§22`'s one production property. */
  readonly expectedRecovery: 'OUTCOME_RESOLVED' | 'CLAIM_REFUSED:ALREADY_CLAIMED';
  /** The provider-side count AFTER recovery. Never one more than before it, except point 1. */
  readonly expectedProviderAcceptedCountAfterRecovery: 0 | 1;
  /** Why this row's provider expectation is what it is. */
  readonly rationale: string;
}

export const KILL_POINT_ROWS: readonly KillPointRow[] = Object.freeze([
  Object.freeze({
    point: 1 as const,
    name: 'before claim COMMIT',
    trigger: 'afterClaimLock' as const,
    expectedOutboxStatus: 'ENQUEUED' as const,
    expectedOutcomeRows: 0 as const,
    expectedOutcomeRowsInSeparateProcessComposition: null,
    expectedProviderAcceptedCount: 0 as const,
    /*
     * THE ONLY POINT WHERE RECOVERY LEGITIMATELY DISPATCHES, and the mock matrix says why:
     * "it is legitimate precisely because nothing was claimed: the row is still `ENQUEUED`,
     * so a later claim is a FIRST claim and not a re-dispatch. `I36` is about `CLAIMED` rows."
     */
    expectedRecovery: 'OUTCOME_RESOLVED' as const,
    expectedProviderAcceptedCountAfterRecovery: 1 as const,
    rationale:
      'the claim transaction rolled back, so no request was ever built; the recovery is a ' +
      'FIRST claim and the single accepted message is its own, not a duplicate',
  }),
  Object.freeze({
    point: 2 as const,
    name: 'after claim COMMIT, before invocation',
    trigger: 'afterClaimCommit' as const,
    expectedOutboxStatus: 'CLAIMED' as const,
    expectedOutcomeRows: 0 as const,
    expectedOutcomeRowsInSeparateProcessComposition: null,
    expectedProviderAcceptedCount: 0 as const,
    expectedRecovery: 'CLAIM_REFUSED:ALREADY_CLAIMED' as const,
    expectedProviderAcceptedCountAfterRecovery: 0 as const,
    rationale:
      "35 §12.3's cost, stated rather than engineered away: the row is CLAIMED, the request " +
      'never left, and NOTHING will send it. A genuinely unsent message is delayed until ' +
      'reconciliation resolves it and a fresh authorisation is obtained',
  }),
  Object.freeze({
    point: 3 as const,
    name: 'after mock ACCEPTED, before outcome known',
    trigger: 'INTEGRATION_CHILD_EXIT_AFTER_SEND' as const,
    expectedOutboxStatus: 'CLAIMED' as const,
    expectedOutcomeRows: 0 as const,
    /*
     * THE ONE ROW WHERE THE TWO COMPOSITIONS DIFFER. See the field's own documentation: the
     * control plane outlives the integration child and commits `OUTCOME_UNKNOWN` for it.
     */
    expectedOutcomeRowsInSeparateProcessComposition: 1 as const,
    expectedProviderAcceptedCount: 1 as const,
    expectedRecovery: 'CLAIM_REFUSED:ALREADY_CLAIMED' as const,
    expectedProviderAcceptedCountAfterRecovery: 1 as const,
    rationale:
      "35 §12.3's own case: the HTTP request leaves; the process dies before the response " +
      'is recorded. SendGrid accepted exactly one message and ACOS holds no outcome for ' +
      'it — the provider-side count is the ONLY evidence that distinguishes this from ' +
      'point 2, which is precisely why the mock matrix cannot close I36',
  }),
  Object.freeze({
    point: 4 as const,
    name: 'after mock RETURNED, before outcome COMMIT',
    trigger: 'beforeOutcomeCommit' as const,
    expectedOutboxStatus: 'CLAIMED' as const,
    expectedOutcomeRows: 0 as const,
    expectedOutcomeRowsInSeparateProcessComposition: null,
    expectedProviderAcceptedCount: 1 as const,
    expectedRecovery: 'CLAIM_REFUSED:ALREADY_CLAIMED' as const,
    expectedProviderAcceptedCountAfterRecovery: 1 as const,
    rationale:
      "both local writes rolled back together (§20's fourth prohibition) while the provider " +
      'had already accepted; recovery must not produce a second accepted message',
  }),
  Object.freeze({
    point: 5 as const,
    name: 'after outcome COMMIT',
    trigger: 'afterOutcomeCommit' as const,
    expectedOutboxStatus: 'CLAIMED' as const,
    expectedOutcomeRows: 1 as const,
    expectedOutcomeRowsInSeparateProcessComposition: null,
    expectedProviderAcceptedCount: 1 as const,
    expectedRecovery: 'CLAIM_REFUSED:ALREADY_CLAIMED' as const,
    expectedProviderAcceptedCountAfterRecovery: 1 as const,
    rationale:
      'the outcome and its journal row both survive because they committed before the kill; ' +
      "the local record and the provider's record agree, and I20's comparison is the one " +
      'this row would supply an operand for',
  }),
  Object.freeze({
    point: 6 as const,
    name: 're-entry, at every point',
    trigger: 'RE_ENTRY' as const,
    expectedOutboxStatus: 'CLAIMED' as const,
    expectedOutcomeRows: 0 as const,
    expectedOutcomeRowsInSeparateProcessComposition: null,
    expectedProviderAcceptedCount: 1 as const,
    expectedRecovery: 'CLAIM_REFUSED:ALREADY_CLAIMED' as const,
    expectedProviderAcceptedCountAfterRecovery: 1 as const,
    rationale:
      "§22's one production property — 'No recovery path invokes the mock a second time for " +
      "an already-claimed effect' — read against the provider instead of against the mock. " +
      'Point 6 is measured at each of points 2 to 5, and the provider count after re-entry ' +
      'is whatever it was before it',
  }),
]);

/**
 * WHAT A LIVE RUN MAY CONCLUDE FROM THE ROWS ABOVE, AND WHAT IT MAY NOT.
 *
 * `§19`: "Do not claim exactly-once delivery. Do not claim distributed exactly-once."
 * `§22` of the S1J mandate is the same prohibition from the other side, and `35 §12.3` gives
 * the reason it survives a passing run: a single account, a single observation window and a
 * bounded number of scenarios establish a property of THESE runs, not a theorem.
 */
export const KILL_POINT_CONCLUSION_LIMITS: readonly string[] = Object.freeze([
  'a passing matrix shows that, for the scenarios run, no recovery path produced a second ' +
    'provider-accepted message for an already-CLAIMED effect',
  'it does NOT show exactly-once delivery, distributed exactly-once, provider idempotency, ' +
    'or that the provider would never accept a duplicate',
  'it does NOT close I17b: a local evidence hash anchors nothing outside this repository',
  'NOT_OBSERVED_WITHIN_BOUND on any row leaves that row UNRESOLVED rather than passing or ' +
    'failing it — provider latency and a message that never left read identically',
]);
