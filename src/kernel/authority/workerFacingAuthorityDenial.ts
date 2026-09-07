import { projectDenialToWorker } from '../enumeration/workerFacingDenial.js';
import type { WorkerFacingDenyCategory } from '../enumeration/workerFacingDenial.js';
import { CanonicalisationDenied } from '../canonicalisation/errors.js';
import type { AuthorityDenyCode } from './errors.js';
import type { PolicyDenyCode } from '../policy/errors.js';
import type { PreReservationOutcome } from './preReservationResult.js';

/**
 * The worker-facing projection of an S1E outcome. `26 §7`'s coarse category, and nothing
 * else.
 *
 * `26 §7`, verbatim:
 *
 *   "**Denial detail returned to the model is coarse.** The audit record holds the full
 *    reason; the worker receives a category and no near-miss information. A model that
 *    learns 'denied: amount exceeded by $3' has been handed a probing oracle."
 *
 * ---------------------------------------------------------------------------------
 * THE SAME STRUCTURAL DEVICE S1C AND S1D ACCEPTED, EXTENDED OVER THE WHOLE SEQUENCE
 *
 * Each variant below has EXACTLY ONE FIELD, and none of them is a string a detail could be
 * written into. There is no `message`, no `note`, no `step`, no `detail`, no `reason`, no
 * `policyVersion`, no `constructorVersion`, no `determiningPolicies`, no `windowRefs`, no
 * `evidenceRefs`, no `grantId`, no `factId`, no `linkId`, no amount and no count.
 *
 * In particular the STEP IS WITHHELD. The kernel records which gate determined the denial —
 * that is the whole point of `PreReservationDenied.step` and of the deterministic-ordering
 * suite — and the worker does not receive it. A worker that could see "denied at step H′"
 * would learn that an open contradiction exists on a fact it is not entitled to read, which
 * is state disclosure dressed as a category.
 *
 * ---------------------------------------------------------------------------------
 * WHY THE CATEGORIES ARE `26 §7`'s OWN AND ARE NOT COLLAPSED FURTHER
 *
 * `26 §7`'s flowchart names each terminal — `DENY: PRINCIPAL`, `DENY: PROHIBITED`,
 * `DENY: PLATFORM_SUSPENDED`, `DENY: NO_GRANT` and the rest — as what is returned. S1C
 * collapsed the SELECTOR family because each distinction there was a bit of information
 * about the live option set (CAN-05), and `workerFacingDenial.ts` still owns that collapsing;
 * S1E does not re-open it and routes canonicalisation denials through the accepted function.
 *
 * The families S1E collapses are the ones the architecture did not name separately:
 *
 *   step D — six internal reasons, one category. "Session expired" versus "chain too deep"
 *            is a description of the identity substrate.
 *   step F — three, one category, and the important one is that a MISSING platform-status
 *            row is indistinguishable from an ENGAGED kill switch. Otherwise deleting the
 *            row would be a discoverably productive attack.
 *   step I — five, one category. "Your grant expired" versus "that resource is out of your
 *            grant's scope" is a map of the grant set.
 *   step L — five, one category, carrying no evidence id and no count.
 * ---------------------------------------------------------------------------------
 */

/** `26 §7`'s terminals, plus S1C's collapsed `SELECTOR` family, as one closed union. */
export type WorkerFacingAuthorityCategory =
  | AuthorityDenyCode
  | PolicyDenyCode
  | WorkerFacingDenyCategory;

/** Exactly one field. There is nowhere to put a detail. */
export interface WorkerFacingAuthorityDenial {
  readonly deny: WorkerFacingAuthorityCategory;
}

/**
 * Exactly one field, and it is deliberately NOT called `permit`.
 *
 * `26 §7` step W is where a PERMIT exists. This says only what S1E established: the proposal
 * reached the edge that enters step R. A worker receiving `{ eligible: true }` has been told
 * nothing about reservation, approval, idempotency or dispatch, because nothing about them
 * has been established.
 */
export interface WorkerFacingPreReservationEligible {
  readonly eligible: true;
}

/** Exactly one field. It carries no reason, no tier, no dwell time and no date. */
export interface WorkerFacingApprovalRequired {
  readonly approvalRequired: true;
}

export type WorkerFacingAuthorityOutcome =
  | WorkerFacingPreReservationEligible
  | WorkerFacingApprovalRequired
  | WorkerFacingAuthorityDenial;

/**
 * Project an S1E outcome onto what a worker may see.
 *
 * Built from `outcome` and `code` alone. It does not read `detail`, does not read
 * `auditNote`, does not read `lineage` and does not read `stepsEvaluated` — which is also
 * what keeps the accepted rule in `tests/canonicalisation/worker-facing-denial.test.ts`
 * ("nothing in src/ returns `.auditNote` … outward") true across the whole tree after S1E.
 */
export function projectPreReservationToWorker(
  outcome: PreReservationOutcome,
): WorkerFacingAuthorityOutcome {
  switch (outcome.outcome) {
    case 'PRE_RESERVATION_PASS':
      return Object.freeze({ eligible: true as const });
    case 'REQUIRE_APPROVAL':
      return Object.freeze({ approvalRequired: true as const });
    case 'DENIED':
      return Object.freeze({ deny: collapse(outcome.code) });
  }
}

/**
 * The S1C selector family stays collapsed.
 *
 * Routed through the ACCEPTED `projectDenialToWorker` rather than reimplemented, so there is
 * one definition of which selector codes collapse and S1E cannot drift from it.
 */
function collapse(
  code: AuthorityDenyCode | PolicyDenyCode | string,
): WorkerFacingAuthorityCategory {
  switch (code) {
    case 'MALFORMED':
    case 'UNKNOWN_ACTION':
    case 'NOT_CANONICALISABLE':
    case 'SELECTOR_MALFORMED':
    case 'SELECTOR_INVALID':
    case 'SELECTOR_STALE':
    case 'SELECTOR_ENUMERATION_STALE':
      return projectDenialToWorker(
        new CanonicalisationDenied(code, 'NOT_AN_OBJECT', ''),
      ).deny;
    default:
      return code as AuthorityDenyCode | PolicyDenyCode;
  }
}
