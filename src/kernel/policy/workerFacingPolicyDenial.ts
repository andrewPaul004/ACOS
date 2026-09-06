import type { PolicyDenyCode } from './errors.js';
import type { PolicyDecision } from './decision.js';

/**
 * The worker-facing projection of a policy denial — `26 §7`'s coarse category, and nothing
 * else.
 *
 * `26 §7`, verbatim:
 *
 *   "**Denial detail returned to the model is coarse.** The audit record holds the full
 *    reason; the worker receives a category and no near-miss information. A model that
 *    learns 'denied: amount exceeded by $3' has been handed a probing oracle."
 *
 * ---------------------------------------------------------------------------------
 * THE SAME STRUCTURAL DEVICE S1C ACCEPTED, APPLIED TO THE POLICY PATH
 *
 * `enumeration/workerFacingDenial.ts` returns a frozen object with exactly one field built
 * from `code` alone, "and the returned value has no field in which a detail, a note, a
 * message, a count, a nearest valid option, an index range or an 'exceeded by $3' could be
 * placed." This module is that device for `PolicyDecision`.
 *
 * What it must keep out, specifically, is everything the mandate names: raw Cedar
 * diagnostics, the determining policy ids, the policy source, the entity set, the policy
 * version, the constructor version, the audit note, and any amount. `WorkerFacingPolicyOutcome`
 * has one field per variant, and none of them is any of those.
 *
 * THE POLICY VERSION IS DELIBERATELY WITHHELD. It is not secret, but it is a control-artifact
 * identifier, and a worker that can observe the digest changing can detect a policy deploy
 * and time proposals around it. `26 §11` puts `policy_version` on the DECISION RECORD, which
 * is the audit path.
 *
 * ---------------------------------------------------------------------------------
 * WHY BOTH CATEGORIES ARE RETURNED SEPARATELY
 *
 * S1C collapsed four selector codes into one because each distinction was a bit of
 * information about the live option set (`26 §2.0.1`, CAN-05). `PER_ACTION` and `NO_GRANT`
 * are different: `26 §7` declares each as its own terminal returned to the proposer (`D11`
 * and `D7`), and neither is a fact about a hidden set that binary search could enumerate.
 *
 * `PER_ACTION` does tell a worker "there is a per-action bound and you are outside it" —
 * which is exactly the category `26 §7` chose to return, and it carries no magnitude,
 * no limit and no distance. A worker cannot recover `$25.00` from it without proposing
 * options it must first have enumerated, and enumeration is already rate-limited and
 * `context_spec`-scoped (`26 §2.0.1`).
 * ---------------------------------------------------------------------------------
 */

/** Exactly one field. There is nowhere to put a detail. */
export interface WorkerFacingPolicyDenial {
  readonly deny: PolicyDenyCode;
}

/** Exactly one field. It carries no lineage, no version and no policy id. */
export interface WorkerFacingPolicyPermit {
  readonly permit: true;
}

export type WorkerFacingPolicyOutcome = WorkerFacingPolicyPermit | WorkerFacingPolicyDenial;

/**
 * Project a policy decision onto what a worker may see.
 *
 * Built from `decision.code` alone. It does not read `lineage`, and it does not read
 * `auditNote` — which is also what keeps the accepted rule in
 * `tests/canonicalisation/worker-facing-denial.test.ts` ("nothing in src/ returns
 * `.auditNote` … outward") true across the whole tree after S1D.
 */
export function projectPolicyDecisionToWorker(
  decision: PolicyDecision,
): WorkerFacingPolicyOutcome {
  if (decision.decision === 'PERMIT') return Object.freeze({ permit: true as const });
  return Object.freeze({ deny: decision.code });
}

/**
 * Run `fn` and project its policy outcome, keeping the S1C asymmetry.
 *
 * A `PolicyEvaluationDefect` is NOT caught here and NOT projected. `enumeration/
 * workerFacingDenial.ts`, verbatim: "a non-`CanonicalisationDenied` error is RETHROWN, not
 * projected. Those are internal defects […] Swallowing an internal defect into
 * `DENY: SELECTOR` would hide a critical incident behind a routine category."
 *
 * A malformed policy artifact, a Cedar request the schema rejected, or a Cedar evaluation
 * error are control-plane failures. `50 §3`'s I19 mechanism halts the affected halt scope on
 * a control-artifact mismatch. Reporting one to a worker as `DENY: NO_GRANT` would tell the
 * worker to try something else while the policy engine was broken.
 */
export function projectedPolicyOutcome(fn: () => PolicyDecision): WorkerFacingPolicyOutcome {
  return projectPolicyDecisionToWorker(fn());
}
