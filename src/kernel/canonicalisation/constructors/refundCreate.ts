import { add, toDb, type Money } from '../../exposure/money.js';
import {
  projectOptionDescription,
  type OptionDescriptionField,
} from '../../enumeration/contextSpec.js';
import { refundLiveEnumerator } from '../../enumeration/refundEnumeration.js';
import { REASON_CODE_SCOPES, type ReasonCode } from '../actionCatalogue.js';
import { computed } from '../brands.js';
import { canonicalHash, hex } from '../canonicalBytes.js';
import { deny } from '../errors.js';
import { computeIdempotencyKey, refundSemanticParamDigest } from '../idempotency.js';
import { computeOptionId } from '../optionDigest.js';
import type { AuthoritativeRetainedFee } from '../authoritativeCost.js';
import type { ConstructedEffect, ConstructorInput, RegisteredConstructor } from '../registry.js';
import type {
  CostComponent,
  Exposure,
  RefundParameters,
  SelectedAuthoritativeOption,
  SelectedAuthoritativeRefundOption,
} from '../types.js';

/**
 * `refund.create` — the first production constructor, and the discriminating one.
 *
 * It is the discriminating class because vendor-visible money and economic exposure are
 * NOT equal for it. `26 §2.1.1`, verbatim:
 *
 *   "For a $25.00 refund carrying a $1.03 retained processing fee the equality is
 *    unsatisfiable in both readings [...] And the consequence that matters most: no policy
 *    cap intended to bound economic loss may compare only against vendor_amount. §8's
 *    refund policy therefore tests context.exposure.total_exposure <= 25.00, so a $25.00
 *    line refund carrying a $1.03 retained fee denies PER_ACTION."
 *
 * ---------------------------------------------------------------------------------
 * NOTHING BELOW COMES FROM `ProposedIntent`
 *
 * `24 §3` K4, on what AI may not do, verbatim: "Supply an exposure figure, a vendor
 * parameter, a monetary value, a counterparty, a value_direction, a recoverability class,
 * or any field of the dispatched request."
 *
 * The model selects an option IDENTITY and nothing else. Amount, line id, transaction id,
 * instrument, retained fee, currency, customer novelty, counterparty, recoverability,
 * value direction and every vendor parameter come from `context` and `option`, both of
 * which are kernel-owned. The constructor's input type has no path to the intent beyond
 * the four `I21` fields, and `input.permitted` has no `rationale` key.
 * ---------------------------------------------------------------------------------
 */

export const REFUND_CREATE_CONSTRUCTOR_ID = 'ctor.refund.create';

/**
 * `semantic_option_digest` for `refund.create` — DECLARED HERE, with the constructor that
 * computes the effect.  S1B.2, finding 6.
 *
 * `26 §2.2`, the declared row, verbatim:
 *
 *   refund.create | line_id · parent_transaction_id · amount · instrument · reason_code_scope
 *
 * and the rule that governs it, verbatim:
 *
 *   "the digest must cover every field whose change would make the option a different
 *    effect. Declared per class in the action catalogue, and a change to any digest
 *    definition is a semantic constructor bump"
 *
 * and the warning that closes the section, verbatim:
 *
 *   "An option whose digest omits a money-bounding field is a catalogue defect, and
 *    `36 §2.3`'s negative control exists to detect exactly that."
 *
 * ---------------------------------------------------------------------------------
 * THE DEFINITION IS EXACTLY THE ARCHITECTURE'S FIVE FIELDS, UNCHANGED BY S1B.2
 *
 * It moved FILE — out of `optionDigest.ts`, so `EffectCanonicaliser` no longer imports a
 * class-specific digest — and not one field moved with it. Finding 3 was resolved by
 * REMOVING the independently mutable destination field rather than by adding it here,
 * precisely because widening this list would change an architecture-declared digest.
 *
 * `line_refundable_remaining` is NOT a member and S1B.2 does not add it: it is current
 * policy state, not effect identity. It travels on the recorded selected option instead.
 *
 * The declared field order is written out below and is not a property of how the option
 * object was built.
 * ---------------------------------------------------------------------------------
 */
export function refundSemanticOptionDigest(option: SelectedAuthoritativeRefundOption): Buffer {
  return canonicalHash('acos.semantic_option_digest.refund.create.v1', [
    { kind: 'text', value: option.lineId },
    { kind: 'text', value: option.parentTransactionId },
    { kind: 'money', value: option.amount },
    { kind: 'text', value: option.instrument },
    { kind: 'text', value: option.reasonCodeScope },
  ]);
}

/**
 * `refund.create`'s CANDIDATE option-description fields — S1C, `I52`.
 *
 * `26 §2.0.1`, verbatim: an option's `description` is "projected through the task's
 * `context_spec` — see I52", and: "**No field appears in any option `description` that the
 * `context_spec` does not admit**."
 *
 * ---------------------------------------------------------------------------------
 * CANDIDATES, NOT A DESCRIPTION
 *
 * This function returns a labelled field list. It does not render a string, and that is the
 * control rather than a style preference: a constructor that returned finished prose could
 * embed a field the `context_spec` withholds, and `I52`'s "enforced by a projection filter
 * at runtime" would then be enforced by this file remembering to consult the spec. The
 * filter and the rendering both live in `enumeration/contextSpec.ts`, which has no per-class
 * branch and cannot be bypassed by a class.
 *
 * The DECLARED ORDER below is the rendering order — see `projectOptionDescription` — so a
 * `context_spec` edit that reorders an admitted set cannot reorder a description.
 *
 * The field NAMES are the `context_spec`'s admitted-field keys. The S1C fixture spec admits
 * `amount`, `currency`, `line`, `parent_transaction` and `instrument`; the
 * `refundable_remaining` candidate exists precisely so a test can withhold it and assert it
 * cannot appear (S1C-C3).
 *
 * NOTE that this list is NOT the semantic option digest and must not be confused with it.
 * `26 §2.1.2` classes `description_string` as NON-SEMANTIC and the digest's five fields as
 * semantic by definition. Adding or removing a candidate here changes what a task may be
 * shown; it does not and must not change any `option_id`.
 * ---------------------------------------------------------------------------------
 */
export function refundOptionDescriptionFields(
  option: SelectedAuthoritativeRefundOption,
): readonly OptionDescriptionField[] {
  return [
    { name: 'amount', value: toDb(option.amount) },
    { name: 'currency', value: option.currency },
    { name: 'line', value: option.lineId },
    { name: 'parent_transaction', value: option.parentTransactionId },
    { name: 'instrument', value: option.instrument },
    // CURRENT POLICY STATE, not option identity — S1B.2 finding 2. A candidate because a
    // task may legitimately be shown it; withheld by a `context_spec` that does not admit
    // it, which is what `I52`'s runtime half is asserted against.
    { name: 'refundable_remaining', value: toDb(option.lineRefundableRemaining) },
  ];
}

/**
 * The per-class authoritative-input cohesion checks, run BEFORE construction.
 * S1B.2, findings 1C and 1D.
 *
 * ---------------------------------------------------------------------------------
 * 1C — OPTION CURRENCY versus LEDGER CURRENCY
 *
 * `SelectedAuthoritativeRefundOption` carries a `currency` and the constructor writes
 * `context.ledgerCurrency` into the parameters and the payload. If the two disagree the
 * constructor silently REINTERPRETS the option — a EUR option dispatched as USD at the same
 * numeral. `26 §11.2`'s exclusion table puts cross-currency monetary classes out of MVP
 * scope and `51 §5.1` says "Single currency only", so for this MVP the two must be equal
 * and a disagreement fails closed. This is NOT an FX implementation and does not become
 * one: no conversion is performed and no rate is read.
 *
 * It THROWS. Both operands are kernel-owned, so no `ProposedIntent` can produce the pair.
 *
 * 1D — REASON CODE versus REASON CODE SCOPE
 *
 * `reason_code_scope` is a member of this class's `semantic_option_digest`, so it is part of
 * the option's semantic identity. `reason_code` is one of the four fields `I21` lets the
 * model supply. A proposed reason code must therefore belong to the scope of the option the
 * selector addressed, or the request records a reason that contradicts the effect it
 * selected — and `26 §8`'s refund policy reads `context.reason_code in ApprovedReasons`
 * against a scope the model did not choose.
 *
 * It DENIES, because the model CAN produce the pair: a valid reason code, and a validly
 * content-addressed option from another scope. `SELECTOR_INVALID` — see `errors.ts`.
 *
 * The mapping is `REASON_CODE_SCOPES` in `actionCatalogue.ts`, which is the S1B FIXTURE
 * enumeration recorded under clarification S1B-C6. This rule is a fixture-level consistency
 * rule tied to that clarification. It is not a claim that this exact enum, or this exact
 * grouping, is universal production policy — selecting the production reason-code taxonomy
 * belongs to the policy slice, exactly as selecting a processor fee model belongs to the
 * adapter slice (S1B-C3a).
 * ---------------------------------------------------------------------------------
 */
function assertRefundInputCohesion(input: ConstructorInput): void {
  const { context, option, permitted } = input;

  if (option.currency !== context.ledgerCurrency) {
    throw new Error(
      `refund.create: the authoritative option is denominated in ${option.currency}, not the ledger currency ${context.ledgerCurrency}; S1B performs no conversion`,
    );
  }

  // The brand is dropped by assignment, not by a cast: a `PermittedIntentField<ReasonCode>`
  // IS a `ReasonCode`, and the asymmetry brands.ts relies on runs the other way.
  const reasonCode: ReasonCode = permitted.reasonCode;
  if (REASON_CODE_SCOPES[reasonCode] !== option.reasonCodeScope) {
    deny(
      'SELECTOR_INVALID',
      'REASON_CODE_SCOPE_MISMATCH',
      'the proposed reason_code is outside the selected option declared reason_code_scope',
    );
  }
}

/**
 * The retained processing fee, CARRIED — not derived.
 *
 * `51 §5.1`, verbatim: "Settled cost is fully determined pre-dispatch: refund amount plus
 * the processor's published retained fee."
 *
 * ---------------------------------------------------------------------------------
 * S1B.1 — WHY THERE IS NO ARITHMETIC HERE, clarification S1B-C3a
 *
 * The original S1B derived the fee as `round_half_away(vendor_amount × 2.9%) + $0.30` from
 * a `ProcessorFeeSchedule` on the context. That reproduced the architecture's printed
 * `$1.03` exactly and was withdrawn anyway: the architecture establishes that a refund may
 * carry a retained processing fee and that the discriminating fixture is
 * `$25.00 / $1.03 / $26.03`. It establishes no rate, no fixed charge, no rounding rule and
 * no processor fee schedule, and an implementation may not invent an economic rule because
 * the rule reproduces a fixture.
 *
 * So the fee is an authoritative AMOUNT supplied on the context, and this function does one
 * thing: turn it into the `CostComponent` the exposure block declares, naming the record it
 * came from. The constructor ADDS authoritative components. It derives none.
 * ---------------------------------------------------------------------------------
 */
function retainedProcessingFeeComponent(fee: AuthoritativeRetainedFee): CostComponent {
  return {
    kind: 'RETAINED_PROCESSING_FEE',
    amount: fee.amount,
    sourceRef: fee.sourceRef,
  };
}

export function constructRefundCreate(input: ConstructorInput): ConstructedEffect {
  const { context, option } = input;
  // S1B.2 finding 1B: the class row comes from the CLOSED CATALOGUE via the canonicaliser,
  // never from caller-supplied context. There is no catalogue entry on the context to read.
  const catalogue = input.catalogueEntry;

  // --- parameters: COMPUTED from selected_option, never supplied ----------------------
  //
  // `26 §11.2` row 3: the destination is "derived by the canonicaliser from the RECORD-grade
  // transaction, never from the intent". That transaction is `parentTransactionId`, and the
  // instrument it is refunded to is `instrument` — the architecture's two-dimensional refund
  // enumeration, both of them members of the semantic option digest. S1B.2 finding 3 removed
  // the separate `destinationInstrumentRef`: a second, independently mutable destination
  // identifier changed where the money went without changing `option_id`.
  const parameters: RefundParameters = {
    lineId: option.lineId,
    parentTransactionId: option.parentTransactionId,
    amount: option.amount,
    instrument: option.instrument,
    reasonCodeScope: option.reasonCodeScope,
    currency: context.ledgerCurrency,
  };

  // --- exposure: two fields, neither overloaded ---------------------------------------
  const vendorAmount: Money = parameters.amount;
  const retainedFee = context.retainedProcessingFee;
  if (retainedFee === null) {
    // The catalogue declares this class NOT cost-component-free, so an absent authoritative
    // fee is a state-resolution defect upstream, not a licence to emit zero cost components.
    // `26 §2.1.1`: "a developer resolving the contradiction by driving cost_components to
    // zero silently restores the v1.0 defect R1 exists to close."
    throw new Error(
      'refund.create: the authoritative retained processing fee is absent, and the catalogue does not declare this class cost-component-free',
    );
  }
  if (retainedFee.currency !== context.ledgerCurrency) {
    throw new Error(
      `refund.create: the authoritative retained fee is in ${retainedFee.currency}, not the ledger currency ${context.ledgerCurrency}`,
    );
  }
  const costComponents: readonly CostComponent[] = [retainedProcessingFeeComponent(retainedFee)];
  const totalExposure: Money = add(
    vendorAmount,
    ...costComponents.map((component) => component.amount),
  );

  const exposure: Exposure = {
    // I18a: the money in the dispatched request.
    vendorAmount: computed(vendorAmount),
    // I18b: THIS is the reserved quantity. `26 §2.1`: "vendor_amount + Σ cost_components
    // + class-specific economically bounded loss."
    totalExposure: computed(totalExposure),
    currency: computed(context.ledgerCurrency),
    // Single ledger currency, so no conversion occurs and there is no FX rate to bind.
    // `26 §11.2`'s exclusion table puts cross-currency monetary classes out of MVP scope
    // ("Settled cost is not computable pre-dispatch"), so this is not a deferred TODO.
    fxRateRef: null,
    originalAmount: null,
    originalCurrency: null,
    costComponents: computed(costComponents),
    // Not a rate class. `26 §2.1.3`'s forward integral has no referent here.
    forwardIntegral: null,
    // COMPENSABLE, so no irrecoverable unit is consumed. `26 §5`.
    irrecoverableUnits: computed(0),
    irrecoverableClass: null,
  };

  // --- identity ------------------------------------------------------------------------
  const semanticOptionDigest = refundSemanticOptionDigest(option);
  const optionId = computeOptionId('refund.create', option.resourceId, semanticOptionDigest);

  // --- the dispatch payload: FINAL vendor parameters, consumed verbatim ---------------
  const semanticParamDigest = refundSemanticParamDigest(parameters);
  const idempotencyKey = computeIdempotencyKey(
    context.taskId,
    'refund.create',
    context.resource.resourceId,
    semanticParamDigest,
  );

  return {
    // S1B.2 finding 2: a TYPED, CLASS-SPECIFIC PROJECTION, not identity alone.
    //
    // `26 §8`'s worked refund policy reads its operands off `context.selected_option` —
    // `line_refundable_remaining >= amount` and `instrument == "original"`. Recording only
    // the option id and its digest would force the later policy slice to re-derive
    // authoritative state this constructor already computed, which is how a policy comes to
    // evaluate a different refund from the one that was canonicalised.
    //
    // `lineRefundableRemaining` is CURRENT POLICY STATE and is deliberately absent from
    // `semantic_option_digest`: the next C' slice re-enumerates it under the entity lock and
    // the policy evaluates the current value.
    selectedOption: {
      actionClass: 'refund.create',
      optionId,
      semanticOptionDigest: hex(semanticOptionDigest),
      // S1C: THE SAME PROJECTION THE MODEL-FACING ENUMERATION USED.
      //
      // `26 §2.1`: `selected_option` is "the enumerated option whose `option_id` the
      // selector names, **with its full description**". The description recorded on the
      // AuthorizationRequest must therefore BE the one the model saw, not a reconstruction
      // that happens to look like it — and S1B's template literal here was exactly such a
      // reconstruction, correct only because there was no enumeration to disagree with.
      //
      // Both call sites now reach `projectOptionDescription` over the same authoritative
      // option and the same `context_spec`, so equality is by construction rather than by
      // discipline, and `I52`'s admitted-field filter applies to the RECORDED description as
      // well as to the returned one.
      description: projectOptionDescription(
        context.contextSpec,
        'refund.create',
        refundOptionDescriptionFields(option),
      ),
      lineId: parameters.lineId,
      parentTransactionId: parameters.parentTransactionId,
      amount: parameters.amount,
      instrument: parameters.instrument,
      reasonCodeScope: parameters.reasonCodeScope,
      lineRefundableRemaining: option.lineRefundableRemaining,
    },
    parameters,
    exposure,
    // S1B-owner-clarifications.md S1B-C4: `26 §11.2` row 3 prints "n/a" for this class's
    // counterparty. The class creates no payee, supplier or settlement destination; the
    // destination is the customer's own original instrument and is carried as a computed
    // parameter. `26 §1` Corollary 1 is explicit that conflating the two is the error.
    counterparty: null,
    // "the payer of the original transaction, NOT a counterparty" — `26 §2.1`.
    customerNovelty: context.customerNovelty,
    channel: null,
    communicationExposure: null,
    // S1B-C5a: carried from the authoritative grant/window-resolution boundary. NOT read
    // from the catalogue — the catalogue declares no windows, precisely so this line cannot
    // be written the other way. `26 §2.1`: "every named window the matching grants
    // reference"; actual matching-grant derivation is the Cedar/policy slice.
    windowRefs: context.grantWindows.windowRefs,
    // `26 §2.1`: "frozen evidence set, when the action derives from research". This one
    // does not; it derives from an order record.
    evidenceRefs: [],
    dispatchPayload: {
      adapter: computed(catalogue.adapter),
      method: computed(catalogue.method),
      vendorParameters: computed(
        Object.freeze({
          parent_transaction_id: parameters.parentTransactionId,
          line_id: parameters.lineId,
          // The vendor sees the refund amount, at the declared scale. Not the exposure.
          amount: toDb(parameters.amount),
          currency: parameters.currency,
          instrument: parameters.instrument,
        }),
      ),
      idempotencyKey: computed(idempotencyKey),
      // I18a, exactly: the dispatched monetary effect IS vendor_amount, and is NOT
      // total_exposure. `26 §2.1.1`'s first reading — monetary_effect = $26.03 — is the
      // one it calls "vacuous, in exactly the way 36 §0 forbids".
      monetaryEffect: computed(vendorAmount),
      // No adapter and no vendor in S1B; the mock processor exposes no conditional write.
      preconditionToken: null,
      authorisationRef: context.authorisationRef,
    },
  };
}

/**
 * Defence in depth against a future registry edit: every entry point asserts the class it
 * was invoked for rather than trusting the key it was filed under.
 */
function assertRefundOption(option: SelectedAuthoritativeOption): SelectedAuthoritativeRefundOption {
  if (option.actionClass !== 'refund.create') {
    throw new Error('refund.create constructor received an option for another action class');
  }
  return option;
}

/**
 * The registration. S1B.2 finding 6: the per-class option identity and the per-class
 * cohesion checks are REACHED THROUGH THIS OBJECT, so `EffectCanonicaliser` needs no
 * refund-specific import and no refund-specific branch, and a second registered constructor
 * adds one of these rather than editing the core.
 */
export const refundCreateConstructor: RegisteredConstructor = {
  actionClass: 'refund.create',
  constructorId: REFUND_CREATE_CONSTRUCTOR_ID,
  computeSemanticOptionDigest: (option) => refundSemanticOptionDigest(assertRefundOption(option)),
  // S1C. Candidate fields only; the filter and the renderer are contextSpec.ts's.
  optionDescriptionFields: (option) => refundOptionDescriptionFields(assertRefundOption(option)),
  // S1C. `24 §3` K4 items 1–2, for this class. The enumeration core has no commerce import.
  liveEnumerator: refundLiveEnumerator,
  assertInputCohesion: (input) => {
    if (input.permitted.actionClass !== 'refund.create') {
      throw new Error('refund.create constructor invoked for another action class');
    }
    assertRefundOption(input.option);
    assertRefundInputCohesion(input);
  },
  construct: (input) => {
    if (input.permitted.actionClass !== 'refund.create') {
      throw new Error('refund.create constructor invoked for another action class');
    }
    return constructRefundCreate(input);
  },
};
