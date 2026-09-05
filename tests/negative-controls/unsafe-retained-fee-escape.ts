import { computed } from '../../src/kernel/canonicalisation/brands.js';
import { toDb } from '../../src/kernel/exposure/money.js';
import { hex } from '../../src/kernel/canonicalisation/canonicalBytes.js';
import { computeIdempotencyKey, refundSemanticParamDigest } from '../../src/kernel/canonicalisation/idempotency.js';
import {
  computeOptionId,
  refundSemanticOptionDigest,
} from '../../src/kernel/canonicalisation/optionDigest.js';
import type {
  ConstructedEffect,
  ConstructorInput,
  RegisteredConstructor,
} from '../../src/kernel/canonicalisation/registry.js';
import type { CostComponent, Exposure, RefundParameters } from '../../src/kernel/canonicalisation/types.js';

/**
 * ============================================================================
 * TEST-ONLY UNSAFE CODE. NEVER REGISTERED IN PRODUCTION. DO NOT IMPORT FROM src/.
 * ============================================================================
 *
 * The retained-fee escape, written out deliberately, so that VC-C1's fixture can be shown
 * to detect it. Without this file a passing VC-C1 is indistinguishable from a fixture that
 * cannot detect the defect VC-C1 exists for — `36 §0`'s negative-control rule.
 *
 * The defect, named by `26 §2.1.1`, verbatim:
 *
 *   "And a developer resolving the contradiction by driving cost_components to zero
 *    silently restores the v1.0 defect R1 exists to close — 42 §8.2 row 12, compensator
 *    cost unreserved."
 *
 * and catalogued by `26 §2.2` as its own error class, verbatim:
 *
 *   "Retained fee escaping the per-action cap (v1.2) | The cap is compared against
 *    total_exposure, never vendor_amount (§8)"
 *
 * The ONLY difference from `src/kernel/canonicalisation/constructors/refundCreate.ts` is
 * two lines: `costComponents` is empty and `totalExposure` is `vendorAmount`. Everything
 * else — the dispatch payload, the idempotency key, the option identity, I18a — is
 * identical and correct, which is precisely why the defect is dangerous rather than
 * obvious.
 *
 * S1B.1 sharpens it. The authoritative retained fee is now sitting right there on
 * `context.retainedProcessingFee`, as an amount, requiring no derivation at all. This
 * constructor ignores it. That is a starker form of the same defect and the fixture still
 * has to catch it.
 *
 * This mirrors S1A's `tests/negative-controls/unsafe-schema.ts`, which carries a
 * deliberately weakened guard for the same reason.
 */

export const UNSAFE_CONSTRUCTOR_ID = 'ctor.refund.create.unsafe-retained-fee-escape';

export function constructRefundCreateUnsafely(input: ConstructorInput): ConstructedEffect {
  const { context, option } = input;
  const catalogue = context.catalogueEntry;

  const parameters: RefundParameters = {
    lineId: option.lineId,
    parentTransactionId: option.parentTransactionId,
    amount: option.amount,
    instrument: option.instrument,
    reasonCodeScope: option.reasonCodeScope,
    destinationInstrumentRef: option.destinationInstrumentRef,
    currency: context.ledgerCurrency,
  };

  const vendorAmount = parameters.amount;

  // >>> THE DEFECT, both halves of it. <<<
  const costComponents: readonly CostComponent[] = [];
  const totalExposure = vendorAmount;
  // >>> END OF THE DEFECT. Everything below is identical to the correct constructor. <<<

  const exposure: Exposure = {
    vendorAmount: computed(vendorAmount),
    totalExposure: computed(totalExposure),
    currency: computed(context.ledgerCurrency),
    fxRateRef: null,
    originalAmount: null,
    originalCurrency: null,
    costComponents: computed(costComponents),
    forwardIntegral: null,
    irrecoverableUnits: computed(0),
    irrecoverableClass: null,
  };

  const semanticOptionDigest = refundSemanticOptionDigest(option);
  const semanticParamDigest = refundSemanticParamDigest(parameters);

  return {
    selectedOption: {
      optionId: computeOptionId('refund.create', option.resourceId, semanticOptionDigest),
      semanticOptionDigest: hex(semanticOptionDigest),
      description: `refund ${toDb(parameters.amount)} ${parameters.currency} on line ${parameters.lineId} against transaction ${parameters.parentTransactionId} to ${parameters.instrument}`,
    },
    parameters,
    exposure,
    counterparty: null,
    customerNovelty: context.customerNovelty,
    channel: null,
    communicationExposure: null,
    windowRefs: context.grantWindows.windowRefs,
    evidenceRefs: [],
    dispatchPayload: {
      adapter: computed(catalogue.adapter),
      method: computed(catalogue.method),
      vendorParameters: computed(
        Object.freeze({
          parent_transaction_id: parameters.parentTransactionId,
          line_id: parameters.lineId,
          amount: toDb(parameters.amount),
          currency: parameters.currency,
          instrument: parameters.instrument,
          destination_instrument_ref: parameters.destinationInstrumentRef,
        }),
      ),
      idempotencyKey: computed(
        computeIdempotencyKey(
          context.taskId,
          'refund.create',
          context.resource.resourceId,
          semanticParamDigest,
        ),
      ),
      monetaryEffect: computed(vendorAmount),
      preconditionToken: null,
      authorisationRef: context.authorisationRef,
    },
  };
}

export const unsafeRetainedFeeEscapeConstructor: RegisteredConstructor = {
  actionClass: 'refund.create',
  constructorId: UNSAFE_CONSTRUCTOR_ID,
  construct: constructRefundCreateUnsafely,
};
