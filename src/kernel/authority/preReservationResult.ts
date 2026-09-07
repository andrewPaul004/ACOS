import type { ConstructorVersionIdentity } from '../canonicalisation/constructorVersion.js';
import type { AuthorizationRequest } from '../canonicalisation/types.js';
import type { AutonomyLevel, AutonomyRefusal } from './autonomy.js';
import type { AuthorityDenyCode, AuthorityDenyDetail } from './errors.js';
import type { AuthorityStep } from './steps.js';
import type { PolicyDenyCode } from '../policy/errors.js';
import type {
  DenyCode as CanonicalisationDenyCode,
  DenyDetail as CanonicalisationDenyDetail,
} from '../canonicalisation/errors.js';

/**
 * S1E's terminal. **A PRE-RESERVATION PASS IS NOT AN AUTHORISATION.**
 *
 * ---------------------------------------------------------------------------------
 * WHAT `PRE_RESERVATION_PASS` MEANS, EXACTLY
 *
 * > This canonical effect has passed every authority gate that `26 §7` places before step R,
 * > and is eligible to ATTEMPT economic reservation.
 *
 * It does NOT mean `AUTHORISED`, `RESERVED`, `APPROVED`, `DISPATCHABLE` or "safe to
 * execute". `26 §7` puts six things between here and a dispatch, and S1E implements none of
 * them:
 *
 *   R      reserve atomically against every referenced named window instance, and deny
 *          `WINDOW_EXHAUSTED` if any lacks headroom
 *   S      the approval requirement
 *   T–V    mint or verify the idempotency key, and return a prior result for a duplicate
 *   W      PERMIT, and emit the SIGNED `AuthorizationDecision`
 *   X      the audit write
 *
 * Step W is where an `AuthorizationDecision` exists. This type is not one, is not named one,
 * and a later slice will find the name free.
 *
 * ---------------------------------------------------------------------------------
 * THE BOUNDARY IS STRUCTURAL, NOT DOCUMENTARY
 *
 * `PreReservationQualified` **carries no `DispatchPayload`**.
 *
 * The pipeline holds one — C′ emits the request and the payload together and hashes them
 * together (`26 §2.1`) — and it does not hand it out. What crosses this boundary is the
 * `AuthorizationRequest` and the `dispatch_payload_hash` that binds it to a payload the
 * caller does not have. So an adapter handed an S1E result has nothing to dispatch: no
 * adapter name, no method, no vendor parameters, no idempotency key and no monetary effect.
 * It is not that dispatching would be wrong; it is that there is nothing here to dispatch.
 *
 * `tests/type-negative/prereservation-as-dispatchable.ts` asserts that as a compile failure,
 * the way `I21` is asserted.
 * ---------------------------------------------------------------------------------
 */

export interface PreReservationLineage {
  /** `26 §11`'s content hash over the Cedar schema and policy set, from the S1D engine. */
  readonly policyVersion: string;
  /** `I61`. Recorded on every outcome, pass and denial alike. */
  readonly constructorVersion: ConstructorVersionIdentity;
  /** The Cedar policy ids that determined step M. AUDIT PATH ONLY. */
  readonly determiningPolicies: readonly string[];
  /** Every gate that was evaluated, in the order it ran. AUDIT PATH ONLY. */
  readonly stepsEvaluated: readonly AuthorityStep[];
}

export interface PreReservationQualified {
  readonly outcome: 'PRE_RESERVATION_PASS';
  /**
   * The request the whole sequence was evaluated over, frozen.
   *
   * Returned AFTER every gate, so it is a record of what was evaluated rather than an input
   * a caller could still change — the same device `authorise.ts` uses, extended over the
   * longer span.
   */
  readonly request: AuthorizationRequest;
  /** `26 §2.1`: "binds this request to exactly one dispatch payload". The payload is withheld. */
  readonly dispatchPayloadHash: string;
  /**
   * `26 §2.1`: "window_refs[] — every named window the matching grants reference". Step R's
   * input, carried so the next slice does not re-resolve grants outside the held lease.
   */
  readonly windowRefs: readonly string[];
  /** `26 §13`: L3/L4 effects without approval are `UNGATED_LOGGED`. */
  readonly autonomyLevel: AutonomyLevel;
  readonly gateClass: 'UNGATED_LOGGED';
  readonly lineage: PreReservationLineage;
}

/**
 * `26 §7`'s `O1[REQUIRE_APPROVAL: PROBATION]`.
 *
 * Not a pass and not a denial. S1E creates NO `Approval` object: `26 §12`'s state machine,
 * `I60`'s single-`RESUMING` index, the reservation-before-approval ordering (`26 §7`
 * property 6) and the whole R′ resume path are step-R-and-after machinery. This outcome
 * records that the proposal cannot proceed to step R autonomously, which is the whole of
 * what S1E can establish.
 */
export interface PreReservationApprovalRequired {
  readonly outcome: 'REQUIRE_APPROVAL';
  /** AUDIT PATH ONLY. The worker learns that approval is required and nothing else. */
  readonly reason: AutonomyRefusal;
  /** `26 §4`'s `approval_requirement`, intersected at its highest across matching grants. */
  readonly approvalRequirement: string;
  readonly lineage: PreReservationLineage;
}

/**
 * A denial from any step in the sequence.
 *
 * `step` and `code` together identify the determining gate, which is what makes deterministic
 * ordering assertable: a fixture with a prohibited class AND an engaged kill switch must
 * record step E, not step F.
 *
 * The three code unions are kept SEPARATE rather than merged into one flat enum. Each belongs
 * to the component that raised it — S1C's canonicalisation denials, S1D's policy denials,
 * S1E's authority denials — and merging them would create one place able to say `PER_ACTION`
 * without Cedar having run, or `SELECTOR_STALE` without a live enumeration.
 */
export interface PreReservationDenied {
  readonly outcome: 'DENIED';
  readonly step: AuthorityStep;
  readonly code: AuthorityDenyCode | PolicyDenyCode | CanonicalisationDenyCode;
  /**
   * The internal reason, from a CLOSED enum. AUDIT PATH ONLY, and never projected.
   *
   * ---------------------------------------------------------------------------------
   * THERE IS DELIBERATELY NO FREE-TEXT `auditNote` ON THIS TYPE
   *
   * The accepted S1B rule in `tests/canonicalisation/worker-facing-denial.test.ts` is that
   * NOTHING in `src/` outside the denial types themselves reads `.auditNote`. S1E honours it
   * rather than adding itself to its exemption list, and the design is better for it:
   * `(step, code, detail)` is a closed triple, every member is enumerable, and an audit
   * consumer can render a sentence from it without the kernel having composed one. A free
   * string on the money path is a string that can accidentally acquire an amount, which is
   * the probing oracle `26 §7` names.
   *
   * The full free-text context still exists — on the `AuthorityDenied` exception, on the
   * S1C `CanonicalisationDenied` exception and on the S1D `PolicyDeny` — for the audit-write
   * step that a later slice adds. It simply does not travel on this record.
   * ---------------------------------------------------------------------------------
   */
  readonly detail: AuthorityDenyDetail | CanonicalisationDenyDetail | null;
  readonly lineage: PreReservationLineage | null;
  readonly stepsEvaluated: readonly AuthorityStep[];
}

export type PreReservationOutcome =
  | PreReservationQualified
  | PreReservationApprovalRequired
  | PreReservationDenied;
