import {
  projectPreReservationToWorker,
  type WorkerFacingAuthorityOutcome,
} from '../authority/workerFacingAuthorityDenial.js';
import type { LocalAuthorisationOutcome } from './localAuthorisationResult.js';

/**
 * The worker-facing projection of an S1F outcome. `26 §7`'s coarse category, and nothing
 * else.
 *
 * `26 §7`, verbatim:
 *
 *   "**Denial detail returned to the model is coarse.** The audit record holds the full
 *    reason; the worker receives a category and no near-miss information. A model that
 *    learns 'denied: amount exceeded by $3' has been handed a probing oracle."
 *
 * =====================================================================================
 * WHY STEP R IS THE WORST PLACE IN THE SEQUENCE TO LEAK
 *
 * Every earlier gate's internal reason describes the AUTHORITY SUBSTRATE — which grant
 * matched, which precondition was stale. Step R's internal reason is a BALANCE SHEET. A
 * worker able to see any of the following would hold a probing oracle over the company's
 * money:
 *
 *   the remaining headroom              — the near-miss `26 §7` names explicitly
 *   the window ceiling                  — `26 §10`'s authorised-loss quantity, directly
 *   WHICH of several windows failed      — binary-searches the whole balance sheet, one
 *                                          denial at a time, at zero spend
 *   the standing term                    — the forward exposure of a live campaign
 *   the reserved term                    — the pending-approval queue in money terms
 *   the journal sequence                 — the company's authorisation volume
 *   the idempotency collision             — whether another task already acted on this
 *                                          resource, which is state disclosure
 *   the lock state                        — whether a concurrent authorisation is in flight
 *   the SQL constraint name               — the schema
 *
 * So `WINDOW_EXHAUSTED` is returned with NOTHING attached. Not the window, not the ledger
 * (monetary, count or irrecoverable), not the amount, not the count.
 *
 * =====================================================================================
 * THE STRUCTURAL DEVICE, UNCHANGED FROM S1C, S1D AND S1E
 *
 * Every variant has EXACTLY ONE FIELD and none of them is a string a detail could be
 * written into. There is no `message`, `note`, `step`, `detail`, `reason`, `window`,
 * `windowId`, `ledger`, `headroom`, `balance`, `ceiling`, `journalSeq`, `retries`,
 * `reservationId`, `amount` or `count`.
 *
 * The IDENTIFIERS are withheld too, and that is a change of posture from the internal
 * record rather than an oversight. A worker does not need a `reservation_id` — it has
 * nothing to do with one, because there is no dispatch capability at S1F — and a
 * `journal_seq` handed to a worker is a monotonic company-wide counter, which is a volume
 * oracle. `26 §7`'s coarse rule is applied to the SUCCESS path as well as the denial path
 * for exactly that reason.
 * =====================================================================================
 */

/**
 * Exactly one field, and it is deliberately NOT called `dispatchable`.
 *
 * `26 §7` step W is where a PERMIT exists and S1F reaches it — so unlike S1E's
 * `{ eligible: true }`, this says a local authorisation is in force. It still says nothing
 * about dispatch, because S1F has no dispatch capability at all.
 */
export interface WorkerFacingLocallyAuthorised {
  readonly authorised: true;
}

/** Exactly one field. No tier, no dwell time, no date, no approver, no queue position. */
export interface WorkerFacingApprovalPending {
  readonly approvalPending: true;
}

/**
 * Exactly one field.
 *
 * `26 §7` step V returns the prior result. What the WORKER is told is that its proposal was
 * already acted on — not the prior effect's id, not its status, not when, and not by which
 * task. A worker able to read `priorStatus` would learn the outcome of an effect another
 * principal authorised.
 */
export interface WorkerFacingAlreadyActed {
  readonly alreadyActed: true;
}

/** Exactly one field. `26 §7` D13's category, with nothing attached. */
export interface WorkerFacingLocalDenial {
  readonly deny: 'WINDOW_EXHAUSTED';
}

export type WorkerFacingLocalOutcome =
  | WorkerFacingLocallyAuthorised
  | WorkerFacingApprovalPending
  | WorkerFacingAlreadyActed
  | WorkerFacingLocalDenial
  | WorkerFacingAuthorityOutcome;

/**
 * Project an S1F outcome onto what a worker may see.
 *
 * Built from `outcome` and `code` alone. It does not read `detail`, `lineage`,
 * `localStepsEvaluated`, `serialisationRetries`, `windowInstances`, `journalSeq` or any
 * identifier — which is also what keeps the accepted rule in
 * `tests/canonicalisation/worker-facing-denial.test.ts` true across the whole tree after
 * S1F.
 *
 * Pre-R outcomes are routed through the ACCEPTED `projectPreReservationToWorker` rather
 * than reimplemented, so S1F cannot drift from the S1E collapsing.
 */
export function projectLocalAuthorisationToWorker(
  outcome: LocalAuthorisationOutcome,
): WorkerFacingLocalOutcome {
  switch (outcome.outcome) {
    case 'LOCAL_AUTHORISATION_COMMITTED':
      return Object.freeze({ authorised: true as const });
    case 'LOCAL_AUTHORISATION_PENDING_APPROVAL':
      return Object.freeze({ approvalPending: true as const });
    case 'DUPLICATE_PRIOR_RESULT':
      return Object.freeze({ alreadyActed: true as const });
    case 'LOCAL_AUTHORISATION_DENIED':
      // The three internal details — COMMITMENT_GUARD_REFUSED,
      // REFERENCED_WINDOW_NOT_REGISTERED and NO_REFERENCED_WINDOW — collapse to ONE
      // category. The distinction is exactly the near-miss information `26 §7` forbids:
      // "this window is not registered" versus "this window is full" tells a worker
      // whether the ceiling exists.
      return Object.freeze({ deny: 'WINDOW_EXHAUSTED' as const });
    case 'REQUIRE_APPROVAL':
    case 'DENIED':
      return projectPreReservationToWorker(outcome);
  }
}
