import { add, toDb, type Money } from '../../exposure/money.js';
import { computed } from '../brands.js';
import { hex } from '../canonicalBytes.js';
import { computeIdempotencyKey, refundSemanticParamDigest } from '../idempotency.js';
import { computeOptionId, refundSemanticOptionDigest } from '../optionDigest.js';
import type { AuthoritativeRetainedFee } from '../authoritativeCost.js';
import type { ConstructedEffect, ConstructorInput, RegisteredConstructor } from '../registry.js';
import type { CostComponent, Exposure, RefundParameters } from '../types.js';

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
  const catalogue = context.catalogueEntry;

  // --- parameters: COMPUTED from selected_option, never supplied ----------------------
  const parameters: RefundParameters = {
    lineId: option.lineId,
    parentTransactionId: option.parentTransactionId,
    amount: option.amount,
    instrument: option.instrument,
    reasonCodeScope: option.reasonCodeScope,
    // `26 §11.2` row 3: "destination derived by the canonicaliser from the RECORD-grade
    // transaction, never from the intent".
    destinationInstrumentRef: option.destinationInstrumentRef,
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
    selectedOption: {
      optionId,
      semanticOptionDigest: hex(semanticOptionDigest),
      // Kernel-authored. `26 §2.0.1` filters an option's description through the task's
      // context_spec (I52) at enumeration time; that projection is the enumeration slice
      // and no field here is outside what the refund policy already reads.
      description: `refund ${toDb(parameters.amount)} ${parameters.currency} on line ${parameters.lineId} against transaction ${parameters.parentTransactionId} to ${parameters.instrument}`,
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
          destination_instrument_ref: parameters.destinationInstrumentRef,
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

export const refundCreateConstructor: RegisteredConstructor = {
  actionClass: 'refund.create',
  constructorId: REFUND_CREATE_CONSTRUCTOR_ID,
  construct: (input) => {
    // Defence in depth against a future registry edit: the constructor asserts the class
    // it was invoked for rather than trusting the key it was filed under.
    if (input.permitted.actionClass !== 'refund.create') {
      throw new Error('refund.create constructor invoked for another action class');
    }
    return constructRefundCreate(input);
  },
};
