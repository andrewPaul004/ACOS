import type { AuthorityStep } from '../authority/steps.js';
import type { LocalAuthorisationStep } from './localSteps.js';
import type {
  LocalAuthorisationDenyCode,
  LocalAuthorisationDenyDetail,
} from './localAuthorisationErrors.js';
import type {
  PreReservationApprovalRequired,
  PreReservationDenied,
  PreReservationLineage,
} from '../authority/preReservationResult.js';

/**
 * S1F's terminal. **LOCAL AUTHORISATION IS NOT DISPATCH.**
 *
 * ---------------------------------------------------------------------------------
 * WHAT `LOCAL_AUTHORISATION_COMMITTED` MEANS, EXACTLY
 *
 * > `26 §7` steps R through W have completed, and the reservation, the effect, the signed
 * > `AuthorizationDecision` and the control-database journal row committed together in one
 * > PostgreSQL transaction.
 *
 * It does NOT mean `DISPATCHED`, `SENT`, `EXECUTED`, `VERIFIED` or `SETTLED`. `26 §7`
 * step X and everything after it is unbuilt:
 *
 *   X            the AUDIT WRITE — the push to the separate audit store, the mirror state
 *                machine, `JournalAttestation`, the two-sided completeness diff
 *   the outbox   `25 §7` layer 4's exclusive claim (`I36`)
 *   dispatch     the adapter, the HTTP call, the vendor's own idempotency
 *   settlement   `I18d`, the reconcilers, `PRESUMED_SETTLED`
 *
 * ---------------------------------------------------------------------------------
 * THE BOUNDARY IS STRUCTURAL, NOT DOCUMENTARY — THE SAME DEVICE S1E USED
 *
 * Every committed variant below carries IDENTIFIERS AND A LOCAL STATUS. None carries a
 * `DispatchPayload`, an adapter method, a vendor parameter map, a monetary effect, a
 * precondition token or a credential. `26 §7`'s payload exists inside the transaction and
 * is not handed out, exactly as S1E withheld it: an adapter handed an S1F result has
 * nothing to dispatch, and that is a property of the type rather than of a convention.
 *
 * The `idempotencyKey` is likewise WITHHELD. It is the one field a caller could take to a
 * vendor and reuse, `26 §7` step T mints it inside the transaction, and nothing outside
 * the kernel needs it before the outbox exists.
 *
 * `tests/type-negative/local-authorisation-as-dispatchable.ts` asserts that as a compile
 * failure, the way `I21` and the S1E boundary are asserted.
 * ---------------------------------------------------------------------------------
 */

/** The window instance that constrained the effect. No balance, no ceiling, no headroom. */
export interface CommittedWindowInstance {
  readonly windowId: string;
  readonly windowInstanceKey: string;
}

export interface LocalAuthorisationLineage extends PreReservationLineage {
  /** Every local step that was evaluated, in the order it ran. AUDIT PATH ONLY. */
  readonly localStepsEvaluated: readonly LocalAuthorisationStep[];
  /**
   * Serialisation failures absorbed before the transaction committed.
   *
   * `40001` is a declared part of the design (`30 §5.2` / registry `I42` SR-A4) and the
   * count is reported so contention is visible rather than silent. It is NOT worker-facing
   * — `workerFacingLocalDenial.ts` has no field for it.
   */
  readonly serialisationRetries: number;
}

/** `26 §7` step W. PERMIT, with the signed decision committed. */
export interface LocalAuthorisationCommitted {
  readonly outcome: 'LOCAL_AUTHORISATION_COMMITTED';
  readonly verdict: 'PERMIT';
  /** `24 §3` K4's effect row status at the moment of local authorisation. */
  readonly localStatus: 'AUTHORISED';
  readonly authorisationId: string;
  readonly decisionId: string;
  readonly effectId: string;
  readonly reservationId: string;
  /** `30 §5.1`'s gap-free company-scoped sequence, as committed. */
  readonly journalSeq: bigint;
  /** Every referenced window instance the transaction locked and bound. */
  readonly windowInstances: readonly CommittedWindowInstance[];
  readonly lineage: LocalAuthorisationLineage;
}

/**
 * `26 §7` step S's `O2 [REQUIRE_APPROVAL — reservation held]`.
 *
 * The architecture's durable pending-approval state, and the reason it is an S1F terminal
 * rather than a later slice's: `26 §7` property 6 puts the reservation BEFORE the approval,
 * so the reservation and the `Approval` object share a commit point or the headroom is held
 * for an approval that does not yet exist.
 *
 * S1F creates the initial `PENDING` row and NOTHING ELSE. No resume, no verify mode, no
 * `R′`, no `CONSTRUCTOR_SEMANTIC_CHANGE`, no `RemedyObligation`.
 */
export interface LocalAuthorisationPendingApproval {
  readonly outcome: 'LOCAL_AUTHORISATION_PENDING_APPROVAL';
  readonly verdict: 'REQUIRE_APPROVAL';
  readonly localStatus: 'AWAITING_APPROVAL';
  readonly authorisationId: string;
  readonly decisionId: string;
  readonly effectId: string;
  readonly reservationId: string;
  readonly approvalId: string;
  readonly approvalTier: string;
  readonly journalSeq: bigint;
  readonly windowInstances: readonly CommittedWindowInstance[];
  readonly lineage: LocalAuthorisationLineage;
}

/**
 * `26 §7` step V — "RETURN PRIOR RESULT — no new effect".
 *
 * `26 §7` property 8, verbatim: "Idempotency check happens after reservation and before
 * permit (steps T–V), so a duplicate proposal returns the prior result and the reservation
 * is released rather than double-counted."
 *
 * So this outcome is reached AFTER the attempt has taken the money-path locks and inserted
 * a reservation, and the release is the rollback of that inner attempt inside the same
 * transaction. Nothing new is committed: no second reservation, no second effect, no second
 * decision and no new journal row.
 *
 * **THIS IS LOCAL IDEMPOTENCY.** It says a second EFFECT ROW does not exist. It says
 * nothing about the external world, because S1F never reaches it.
 */
export interface LocalAuthorisationDuplicate {
  readonly outcome: 'DUPLICATE_PRIOR_RESULT';
  readonly priorEffectId: string;
  readonly priorAuthorisationId: string;
  readonly priorDecisionId: string | null;
  readonly priorReservationId: string | null;
  readonly priorStatus: string;
  readonly priorJournalSeq: bigint | null;
  readonly lineage: LocalAuthorisationLineage;
}

/** A denial from step R or later. The whole transaction rolled back. */
export interface LocalAuthorisationDenied {
  readonly outcome: 'LOCAL_AUTHORISATION_DENIED';
  readonly step: LocalAuthorisationStep;
  readonly code: LocalAuthorisationDenyCode;
  readonly detail: LocalAuthorisationDenyDetail;
  readonly lineage: LocalAuthorisationLineage;
}

/**
 * The pre-R outcomes, carried through unchanged.
 *
 * S1F composes the ACCEPTED S1E pipeline; it does not reimplement a gate and it does not
 * re-code a denial. A proposal denied at step H′ produces the S1E record, verbatim, and the
 * S1F caller sees the same `(step, code, detail)` triple the accepted suite asserts.
 */
export type LocalAuthorisationOutcome =
  | LocalAuthorisationCommitted
  | LocalAuthorisationPendingApproval
  | LocalAuthorisationDuplicate
  | LocalAuthorisationDenied
  | PreReservationApprovalRequired
  | PreReservationDenied;

/** The pre-R steps, for a caller that wants to know where in `26 §7` an outcome came from. */
export type AnyAuthoritySequenceStep = AuthorityStep | LocalAuthorisationStep;
