import type { Money } from '../exposure/money.js';
import type { KernelComputed, PermittedIntentField } from './brands.js';
import type {
  ActionClass,
  ReasonCode,
  ReasonCodeScope,
  Recoverability,
  ValueDirection,
} from './actionCatalogue.js';
import type { AuthoritativeRetainedFee } from './authoritativeCost.js';
import type { AuthoritativeGrantWindowContext } from './grantWindows.js';
import type { ConstructorVersionIdentity } from './constructorVersion.js';
import type { ProposedSelector } from './intent.js';
import type { TaskContextSpec } from '../enumeration/contextSpec.js';

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

/**
 * `26 §3`'s declared kinds, verbatim from the printed record:
 *
 *   Principal {
 *     id, kind,            // OWNER | KERNEL_SERVICE | AI_ROLE | ADAPTER | AUDIT_REVIEWER
 *     ...
 *   }
 *
 * S1E CORRECTION. S1B declared this union as `'AGENT' | 'HUMAN' | 'KERNEL_SERVICE'`, which
 * is not the architecture's set. While no code read `kind`, the divergence cost nothing;
 * S1E's step D and `26 §7.1`'s `KERNEL_SERVICE` branch both key on it, so the set has to be
 * the declared one. `AGENT` becomes `AI_ROLE`; `HUMAN` was unused and is replaced by the
 * three remaining declared kinds. Nothing in the Cedar schema constrains `kind` — it is
 * declared there as `String` — so no control artifact moves and no policy digest changes.
 */
export type PrincipalKind =
  | 'OWNER'
  | 'KERNEL_SERVICE'
  | 'AI_ROLE'
  | 'ADAPTER'
  | 'AUDIT_REVIEWER';

export interface ResolvedPrincipal {
  readonly id: string;
  readonly kind: PrincipalKind;
  /**
   * `26 §3`'s declared `Principal.role`, verbatim from the printed record:
   *
   *   Principal {
   *     id, kind,            // OWNER | KERNEL_SERVICE | AI_ROLE | ADAPTER | AUDIT_REVIEWER
   *     role,                // e.g. ceo, support_reasoner, market_researcher
   *     ...
   *   }
   *
   * S1D, and required rather than optional. `26 §8`'s worked refund policy opens
   * `permit(principal in Role::"support_reasoner", …)`, so the role is the operand that
   * decides whether any grant applies at all. An optional field would let an absent role
   * default, and `36 §3` layer 2 is explicitly about the case where "the policy is fine and
   * `exposure` arrives as null" — an absent authority operand must fail closed, not default.
   *
   * It is kernel-resolved like every other field on this record: `24 §3` lists identities
   * and principals as KERNEL-owned state, and no `ProposedIntent` field reaches it.
   */
  readonly role: string;
  /**
   * `26 §3`: "model_binding, // model id + version + prompt version — null for non-AI".
   *
   * S1E. It is here because `26 §13`'s autonomy-ledger key is
   * `(task_type, action_class, model_binding, resource_class)` and step N cannot be
   * evaluated without it, and because SR6's "Model change demotes" is only enforceable if
   * the binding travels with the principal rather than being looked up later from somewhere
   * a compromised component could choose.
   *
   * Kernel-resolved from the `principal` row like every other field on this record.
   */
  readonly modelBinding: string | null;
  /**
   * `26 §7` step D: chain depth ≤ 3.
   *
   * S1E COUNTS this from the principal's `delegation_hop` rows rather than reading a stored
   * figure, so the cap is not evaluated against a number its subject wrote. The field
   * carries the counted value onto the request for the audit record.
   */
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
  /**
   * THERE IS DELIBERATELY NO CATALOGUE ENTRY ON THIS TYPE — S1B.2, finding 1B.
   *
   * The original S1B carried `catalogueEntry: KernelComputed<ActionCatalogueEntry>` here
   * and the canonicaliser trusted it. `recoverability`, `value_direction`, the adapter, the
   * method and the money-carrying / cost-component-free declarations are properties of the
   * CLOSED ACTION CATALOGUE keyed by `action_class` — `26 §5`, `26 §2.1` ("From the
   * catalogue, never null (I59)"), `26 §11.2` — and a caller able to hand over a different
   * row for the same class could give a `refund.create` request `campaign.pause`'s
   * recoverability, its value_direction, its adapter or its method without the catalogue
   * changing at all.
   *
   * So the field is GONE rather than validated. The canonicaliser reads
   * `actionCatalogueEntry(intent.actionClass)` itself, AFTER `action_class` has passed the
   * closed-catalogue check, and hands the row to the constructor on `ConstructorInput`.
   * The substitution is not merely rejected — it has no expressible form.
   */
  /** `26 §2.1`: "the single ledger currency". */
  readonly ledgerCurrency: KernelComputed<string>;
  /**
   * The authoritative retained processing fee for this effect, as an AMOUNT.
   *
   * S1B-owner-clarifications.md S1B-C3a. `null` for a class that carries none. S1B knows no
   * fee schedule and derives no fee — see `authoritativeCost.ts` for why the original
   * S1B-C3 derivation was withdrawn.
   */
  readonly retainedProcessingFee: KernelComputed<AuthoritativeRetainedFee> | null;
  /**
   * The windows the matching grants reference, resolved by a kernel-owned boundary.
   *
   * S1B-owner-clarifications.md S1B-C5a. NOT catalogue membership, and not claimed to be
   * actual Cedar grant resolution — see `grantWindows.ts`.
   */
  readonly grantWindows: KernelComputed<AuthoritativeGrantWindowContext>;
  readonly customerNovelty: KernelComputed<CustomerNovelty> | null;
  /**
   * The task's `context_spec` — S1C, `I52`.
   *
   * `26 §2.0.1`, the field-visibility row, verbatim: "Governed by the task's `context_spec`.
   * **No field appears in any option `description` that the `context_spec` does not admit**
   * (`I52`), enforced by a projection filter at runtime and by spec review in CI."
   *
   * It is here because the RECORDED selected option carries a description (`26 §2.1`:
   * "the enumerated option whose `option_id` the selector names, **with its full
   * description**") and that description must be the one the model saw. S1B authored it
   * from a template literal inside the refund constructor, which was correct while there was
   * no enumeration to agree with and is the second description path the S1C mandate
   * forbids. The constructor now declares candidate fields and this spec decides which are
   * admitted — one projection, two call sites.
   *
   * `KernelComputed` like every other context field, and `23 §5` B9 lists `context_spec`s
   * among the sixteen classes of owner-signed control artifact, so it is not model-editable
   * by construction. `I21` does not move: no `ProposedIntent` field reaches it.
   */
  readonly contextSpec: KernelComputed<TaskContextSpec>;
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
  /**
   * `26 §8`: `context.selected_option.line_refundable_remaining`.
   *
   * CURRENT POLICY STATE, deliberately outside `semantic_option_digest`. The refund policy
   * evaluates `line_refundable_remaining >= amount` against the value CURRENT at decision
   * time, and the next C' increment re-enumerates it under the entity advisory lock.
   * Putting it into option identity would make every change to the line's remaining balance
   * a different `option_id` for the same effect. It is projected onto the recorded selected
   * option instead — see `RecordedRefundSelectedOption`.
   */
  readonly lineRefundableRemaining: KernelComputed<Money>;
  /**
   * THERE IS DELIBERATELY NO `destinationInstrumentRef` ON THIS TYPE — S1B.2, finding 3.
   *
   * The original S1B added one as an independently supplied field and placed it in the mock
   * vendor payload. `26 §2.2` declares this class's semantic option identity as exactly
   * "line_id · parent_transaction_id · amount · instrument · reason_code_scope", and
   * requires the digest to "cover every field whose change would make the option a
   * different effect". An independently mutable destination satisfied neither rule:
   * changing it changed the dispatched destination while `option_id` stayed put.
   *
   * The repair is NOT to widen the architecture-declared digest. It is to remove the second
   * identifier. `26 §11.2` row 3's destination is "derived by the canonicaliser from the
   * RECORD-grade transaction, never from the intent", and that transaction is already named
   * — content-addressed — by `parent_transaction_id` together with `instrument`, which is
   * the architecture's two-dimensional refund enumeration. Which concrete vendor fields a
   * real processor needs for that parent transaction belongs to the adapter /
   * state-resolution slice, and S1B invents no answer to it.
   */
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

/**
 * `26 §2.1`: "parameters — COMPUTED from selected_option — not supplied".
 *
 * S1B.2 finding 3 removed `destinationInstrumentRef`. No remaining architecture requirement
 * needs a second destination identifier: the destination is the RECORD-grade parent
 * transaction's own instrument, and `parentTransactionId` with `instrument` names it.
 */
export interface RefundParameters {
  readonly lineId: string;
  readonly parentTransactionId: string;
  readonly amount: Money;
  readonly instrument: string;
  readonly reasonCodeScope: ReasonCodeScope;
  readonly currency: string;
}

export type ComputedParameters = RefundParameters;

/**
 * `26 §2.1`'s `selected_option` field: "the enumerated option whose option_id the selector
 * names, with its full description".
 *
 * The IDENTITY half, common to every class.
 */
export interface RecordedSelectedOptionIdentity {
  readonly optionId: string;
  readonly semanticOptionDigest: string;
  readonly description: string;
}

/**
 * `refund.create`'s recorded selected option — a TYPED, CLASS-SPECIFIC PROJECTION.
 * S1B.2, finding 2.
 *
 * ---------------------------------------------------------------------------------
 * WHY IDENTITY ALONE WAS NOT ENOUGH
 *
 * `26 §8`'s worked refund policy evaluates its operands off `context.selected_option`,
 * verbatim:
 *
 *   context.selected_option.line_refundable_remaining >= context.selected_option.amount
 *   context.selected_option.instrument == "original"
 *
 * The original S1B recorded only `option_id`, `semantic_option_digest` and `description`,
 * which drops every one of those operands. The later policy slice would then have had to
 * re-derive authoritative state the canonicaliser already held — or read it from somewhere
 * else — which is how a policy comes to evaluate a different refund from the one that was
 * canonicalised.
 *
 * So the recorded option carries the five identity-bearing fields AND the current policy
 * state. Every field is kernel-computed and none is reachable from `ProposedIntent`.
 *
 * `line_refundable_remaining` is deliberately NOT added to `semantic_option_digest`: it is
 * current policy state rather than effect identity, the next C' slice re-enumerates it
 * under the entity lock, and the policy evaluates the CURRENT value. The discriminating
 * pair is asserted directly — changing only the refundable remaining MUST change the
 * recorded option state and MUST NOT change `option_id`.
 * ---------------------------------------------------------------------------------
 */
export interface RecordedRefundSelectedOption extends RecordedSelectedOptionIdentity {
  /** The discriminant. A second class adds a variant; it does not widen this one. */
  readonly actionClass: 'refund.create';

  // --- the five declared semantic_option_digest fields, projected ---------------------
  readonly lineId: string;
  readonly parentTransactionId: string;
  readonly amount: Money;
  readonly instrument: string;
  readonly reasonCodeScope: ReasonCodeScope;

  // --- current authoritative policy state, NOT part of option identity ----------------
  /** `26 §8`: `context.selected_option.line_refundable_remaining`. */
  readonly lineRefundableRemaining: Money;
}

/** A union of one at S1B, exactly as `SelectedAuthoritativeOption` is. */
export type RecordedSelectedOption = RecordedRefundSelectedOption;

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
