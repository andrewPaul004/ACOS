import type { Money } from '../exposure/money.js';
import type { KernelComputed, PermittedIntentField } from './brands.js';
import type {
  ActionCatalogueEntry,
  ActionClass,
  ProcessorFeeSchedule,
  ReasonCode,
  ReasonCodeScope,
  Recoverability,
  ValueDirection,
} from './actionCatalogue.js';
import type { ConstructorVersionIdentity } from './constructorVersion.js';
import type { ProposedSelector } from './intent.js';

/**
 * The canonicaliser's types: three kernel-owned INPUTS and two kernel-computed OUTPUTS.
 *
 * `26 §2.1`, on the AuthorizationRequest block, verbatim: "every field below is
 * kernel-computed", and:
 *
 *   "AuthorizationRequest and DispatchPayload are emitted together and hashed together.
 *    The adapter receives the payload verbatim and constructs nothing — it does not
 *    reinterpret intent into vendor parameters, which is where the unit-price-versus-line-
 *    total class of error lives."
 *
 * ---------------------------------------------------------------------------------
 * WHY THE INPUTS ARE THREE TYPES AND NOT ONE
 *
 * `PermittedIntentFields`, `AuthoritativeCanonicalisationContext` and
 * `SelectedAuthoritativeOption` are kept separate deliberately. Merged into one
 * convenience object, `I21` becomes a code-review property again: nothing in the type
 * system would then distinguish "the model chose this" from "the kernel resolved this",
 * and the fields that bound money would be back on the same side of the boundary as the
 * fields the model supplies. That is the exact defect `47 §1` ranked first of ten and
 * ADR-021 exists to close.
 * ---------------------------------------------------------------------------------
 */

// =====================================================================================
// INPUT 1 — the four permitted intent fields.  See `intent.ts`.
// =====================================================================================

// =====================================================================================
// INPUT 2 — the authoritative context.  Kernel-owned, every field.
// =====================================================================================

export type PrincipalKind = 'AGENT' | 'HUMAN' | 'KERNEL_SERVICE';

export interface ResolvedPrincipal {
  readonly id: string;
  readonly kind: PrincipalKind;
  /** `26 §7` step D: chain depth ≤ 3. Recorded here; step D is policy and is not in S1B. */
  readonly delegationDepth: number;
}

/**
 * `26 §2.1`: "resource — resolved from resource_ref, under the entity advisory lock".
 *
 * S1B does not take the C′ entity advisory lock — that is the enumeration/selector
 * increment. The resource here is a resolved authoritative fixture, and the contract says
 * so rather than implying the lock was taken.
 */
export interface ResolvedResource {
  readonly resourceRef: string;
  readonly resourceId: string;
  /** `26 §8`: `resource.grade == "RECORD"`. Carried for the later policy slice. */
  readonly grade: 'RECORD' | 'OBSERVATION' | 'CLAIM' | 'DECISION_DELEGATED';
}

/** `26 §2.1`: "enumeration_ref — the enumeration_id and its computed_at, for lineage". */
export interface EnumerationRef {
  readonly enumerationId: string;
  readonly computedAt: Date;
}

/** `26 §2.1`: "NEW | RETURNING | null — the payer of the original transaction, NOT a counterparty". */
export type CustomerNovelty = 'NEW' | 'RETURNING';

export interface AuthoritativeCanonicalisationContext {
  readonly companyId: KernelComputed<string>;
  /** `25 §7`'s idempotency key input `task_id`. */
  readonly taskId: KernelComputed<string>;
  readonly principal: KernelComputed<ResolvedPrincipal>;
  readonly resource: KernelComputed<ResolvedResource>;
  readonly enumerationRef: KernelComputed<EnumerationRef>;
  readonly catalogueEntry: KernelComputed<ActionCatalogueEntry>;
  /** `26 §2.1`: "the single ledger currency". */
  readonly ledgerCurrency: KernelComputed<string>;
  /** RECORD-grade, per S1B-owner-clarifications.md S1B-C3. */
  readonly feeSchedule: KernelComputed<ProcessorFeeSchedule>;
  readonly customerNovelty: KernelComputed<CustomerNovelty> | null;
  /** `26 §2.1`: "context_digest — hash of the assembled context the proposer saw". */
  readonly contextDigest: KernelComputed<string>;
  /**
   * `26 §2.1`, on DispatchPayload: `authorisation_ref`.
   *
   * Allocated by the gateway at step W, which S1B does not implement. It is a kernel-owned
   * value threaded through the canonicaliser, never derived from the intent and never
   * derived from `rationale` — so a rationale-only change cannot reach it.
   */
  readonly authorisationRef: KernelComputed<string>;
}

// =====================================================================================
// INPUT 3 — the selected authoritative option.  Kernel-owned, every field.
// =====================================================================================

/**
 * `26 §2.2`'s `semantic_option_digest` row for `refund.create`, verbatim:
 *
 *   refund.create | line_id · parent_transaction_id · amount · instrument · reason_code_scope
 *
 * The first five fields below are exactly that set. The remainder are authoritative
 * fields the constructor needs which do not change the identity of the effect.
 *
 * NONE of these may come from `ProposedIntent`. `24 §3` K4, verbatim, on what AI may not
 * do: "Supply an exposure figure, a vendor parameter, a monetary value, a counterparty, a
 * value_direction, a recoverability class, or any field of the dispatched request."
 */
export interface SelectedAuthoritativeRefundOption {
  readonly actionClass: KernelComputed<'refund.create'>;
  readonly resourceId: KernelComputed<string>;

  // --- the five declared semantic_option_digest fields --------------------------------
  readonly lineId: KernelComputed<string>;
  readonly parentTransactionId: KernelComputed<string>;
  readonly amount: KernelComputed<Money>;
  readonly instrument: KernelComputed<string>;
  readonly reasonCodeScope: KernelComputed<ReasonCodeScope>;

  // --- authoritative, but not identity-bearing -----------------------------------------
  /** `26 §8`: `context.selected_option.line_refundable_remaining`. */
  readonly lineRefundableRemaining: KernelComputed<Money>;
  /** `26 §11.2` row 3: "destination derived by the canonicaliser from the RECORD-grade transaction". */
  readonly destinationInstrumentRef: KernelComputed<string>;
  readonly currency: KernelComputed<string>;
}

/** A union of one at S1B. Adding a class adds a variant; it does not widen the refund one. */
export type SelectedAuthoritativeOption = SelectedAuthoritativeRefundOption;

// =====================================================================================
// OUTPUT — AuthorizationRequest and DispatchPayload
// =====================================================================================

/** `26 §2.1`: "cost_components[] — retained processing fee · freight · COGS · compensator cost". */
export type CostComponentKind =
  | 'RETAINED_PROCESSING_FEE'
  | 'FREIGHT'
  | 'COGS'
  | 'COMPENSATOR_COST';

export interface CostComponent {
  readonly kind: CostComponentKind;
  readonly amount: Money;
  /** The authoritative record the component was computed from. */
  readonly sourceRef: string;
}

/**
 * `26 §2.1`'s exposure block, split per SR-C1.
 *
 * `26 §2.1.1`, verbatim: "The repair is a type correction, not a relaxation. Two fields,
 * four assertions." — `vendor_amount` is the money in the dispatched request;
 * `total_exposure` is the economic loss and IS the reserved quantity. Neither field is
 * overloaded with the other's meaning, and nothing in this codebase reads one for the
 * other.
 */
export interface Exposure {
  /** `26 §2.1`: "NULL where the request carries no monetary field (e.g. fulfilment.reship)". */
  readonly vendorAmount: KernelComputed<Money> | null;
  /** `I18b`: `reservation.amount == exposure.total_exposure`, exactly, no tolerance. */
  readonly totalExposure: KernelComputed<Money>;
  readonly currency: KernelComputed<string>;
  /** `26 §2.1`: "RECORD-grade, staleness_policy = BLOCK". Null in the single-currency case. */
  readonly fxRateRef: KernelComputed<string> | null;
  readonly originalAmount: KernelComputed<Money> | null;
  readonly originalCurrency: KernelComputed<string> | null;
  readonly costComponents: KernelComputed<readonly CostComponent[]>;
  /**
   * `26 §2.1.3`, verbatim: "for rate classes this is the ENTIRE economic exposure and it is
   * carried by I3 term 2, never by the reservation." Null for a non-rate class.
   */
  readonly forwardIntegral: KernelComputed<Money> | null;
  /** `26 §2.1`: "COMPUTED from the class, not supplied". */
  readonly irrecoverableUnits: KernelComputed<number>;
  readonly irrecoverableClass: KernelComputed<'DISCRETIONARY' | 'ORDER_DRIVEN'> | null;
}

/**
 * `26 §2.1`: "counterparty { id, novelty } — a payee/supplier/settlement destination".
 *
 * `26 §1` Corollary 1, verbatim: "'counterparty' means a payee, supplier or settlement
 * destination — not a customer." Null for a class that creates none — see
 * S1B-owner-clarifications.md S1B-C4 for `refund.create`.
 */
export interface Counterparty {
  readonly id: string;
  readonly novelty: 'EXISTING' | 'ALLOWLISTED' | 'NOVEL';
}

/** `26 §2.1`: "parameters — COMPUTED from selected_option — not supplied". */
export interface RefundParameters {
  readonly lineId: string;
  readonly parentTransactionId: string;
  readonly amount: Money;
  readonly instrument: string;
  readonly reasonCodeScope: ReasonCodeScope;
  readonly destinationInstrumentRef: string;
  readonly currency: string;
}

export type ComputedParameters = RefundParameters;

/**
 * `26 §2.1`'s `selected_option` field: "the enumerated option whose option_id the selector
 * names, with its full description".
 */
export interface RecordedSelectedOption {
  readonly optionId: string;
  readonly semanticOptionDigest: string;
  readonly description: string;
}

export interface AuthorizationRequest {
  readonly principal: KernelComputed<ResolvedPrincipal>;

  // --- the four fields I21 permits to cross ------------------------------------------
  readonly actionClass: PermittedIntentField<ActionClass>;
  readonly reasonCode: PermittedIntentField<ReasonCode>;
  readonly selector: PermittedIntentField<ProposedSelector>;
  readonly resourceRef: PermittedIntentField<string>;

  // --- everything else, kernel-computed -----------------------------------------------
  readonly resource: KernelComputed<ResolvedResource>;
  readonly selectedOption: KernelComputed<RecordedSelectedOption>;
  readonly enumerationRef: KernelComputed<EnumerationRef>;
  readonly constructorVersion: KernelComputed<ConstructorVersionIdentity>;
  readonly parameters: KernelComputed<ComputedParameters>;
  readonly exposure: KernelComputed<Exposure>;
  readonly recoverability: KernelComputed<Recoverability>;
  readonly valueDirection: KernelComputed<ValueDirection>;
  readonly counterparty: KernelComputed<Counterparty> | null;
  readonly customerNovelty: KernelComputed<CustomerNovelty> | null;
  readonly channel: KernelComputed<string> | null;
  readonly communicationExposure: KernelComputed<Money> | null;
  readonly windowRefs: KernelComputed<readonly string[]>;
  readonly evidenceRefs: KernelComputed<readonly string[]>;
  readonly contextDigest: KernelComputed<string>;
  /** Lineage only. Commits to `rationale`; see `lineage.ts` and S1B-C1. */
  readonly intentHash: KernelComputed<string>;
  /** `26 §2.1`: "binds this request to exactly one dispatch payload". */
  readonly dispatchPayloadHash: KernelComputed<string>;
}

export interface DispatchPayload {
  readonly adapter: KernelComputed<string>;
  readonly method: KernelComputed<string>;
  /**
   * The FINAL vendor parameters. `26 §2.1`: "The adapter receives the payload verbatim and
   * constructs nothing." No adapter exists in S1B; this field is what a future one
   * consumes without reconstruction.
   */
  readonly vendorParameters: KernelComputed<Readonly<Record<string, string>>>;
  readonly idempotencyKey: KernelComputed<string>;
  /** `I18a`: `== exposure.vendor_amount`, or NULL where the vendor request carries no money. */
  readonly monetaryEffect: KernelComputed<Money> | null;
  /**
   * `26 §2.1` (v1.2, CAN-10): "the vendor's optimistic-concurrency token where the vendor
   * supports conditional writes; NULL and recorded as unsupported per class where it does
   * not." NULL at S1B: the mock adapter supports none.
   */
  readonly preconditionToken: KernelComputed<string> | null;
  readonly authorisationRef: KernelComputed<string>;
}

/** `26 §2.1`: emitted together. */
export interface CanonicalEffect {
  readonly request: AuthorizationRequest;
  readonly dispatchPayload: DispatchPayload;
}
