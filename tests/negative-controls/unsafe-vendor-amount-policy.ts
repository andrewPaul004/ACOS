import { toDb } from '../../src/kernel/exposure/money.js';
import type { CanonicalEffect } from '../../src/kernel/canonicalisation/types.js';
import type { CedarRequest, CedarValue } from '../../src/kernel/policy/cedarRequest.js';
import { evaluateWithCedar } from '../../src/kernel/policy/cedarEngine.js';
import { resolveDenialCategory } from '../../src/kernel/policy/denialCategory.js';
import type { LoadedPolicyArtifacts } from '../../src/kernel/policy/policyArtifacts.js';
import type { PolicyDenyCode } from '../../src/kernel/policy/errors.js';

/**
 * THE MANDATORY VULNERABLE NEGATIVE CONTROL — the economic-binding defect, isolated.
 *
 * TEST-ONLY. Nothing under `src/` imports this file, and
 * `tests/policy/source-rules-s1d.test.ts` asserts that.
 *
 * ---------------------------------------------------------------------------------
 * WHY IT EXISTS
 *
 * `36 §0`'s discipline and `46 R1`: a test that cannot fail for the reason it names is not a
 * test. `36 §2`'s VC-C1 asserts a denial, and a denial can be produced by many things — an
 * unsatisfied grade check, a wrong role, an absent novelty, a policy that denies everything.
 * Without this control, "S1D denies VC-C1" would be compatible with a policy set that never
 * reads an economic quantity at all.
 *
 * `26 §2.1.1`, the defect being reproduced, verbatim:
 *
 *   "**And the consequence that matters most: no policy cap intended to bound economic loss
 *    may compare only against `vendor_amount`.**"
 *
 * `51 §3.1`, verbatim:
 *
 *   "`per_action_max.monetary` is compared against **`exposure.total_exposure`**, not
 *    `exposure.vendor_amount` (SR-C1, `26 §8`). [...] **the cap bounds economic loss, and
 *    economic loss includes the fee that does not come back.**"
 *
 * ---------------------------------------------------------------------------------
 * IT DIFFERS FROM PRODUCTION IN EXACTLY ONE EXPRESSION
 *
 * `unsafeVendorAmountRequest` is `buildRefundCreateCedarRequest` with ONE line changed:
 *
 *   production   total_exposure: decimalOf(request.exposure.totalExposure)
 *   unsafe       total_exposure: decimalOf(request.exposure.vendorAmount)
 *
 * Everything else is identical, and everything DOWNSTREAM is production: the same real Cedar
 * engine, the same loaded artifacts, the same signed policy text, the same `$25.00` limit,
 * the same denial-category resolution. The only variable is which authoritative field is
 * bound into the cap's operand.
 *
 * PRODUCTION IS NOT WEAKENED TO ACCOMMODATE THIS. Nothing was made overridable, no seam was
 * opened and no field was made settable. The control is a whole second request builder
 * sitting in `tests/`, and the cost of that duplication is the point: an implementation that
 * had made the operand configurable would have been a weaker design that happened to be
 * easier to test.
 *
 * The `acos.cedarschema` context declares no `vendor_amount` attribute, which is why the
 * control has to write the vendor amount INTO the `total_exposure` position to express the
 * defect. A defect that has to be smuggled into the one field that exists is a defect that
 * cannot arrive by accident.
 * ---------------------------------------------------------------------------------
 */

const NAMESPACE = 'Acos';

/** `buildRefundCreateCedarRequest`, with `vendorAmount` where `totalExposure` belongs. */
export function unsafeVendorAmountRequest(effect: CanonicalEffect): CedarRequest {
  const request = effect.request;
  const option = request.selectedOption;
  if (option.actionClass !== 'refund.create') {
    throw new Error('the unsafe control is refund.create only');
  }
  const vendorAmount = request.exposure.vendorAmount;
  if (vendorAmount === null) {
    throw new Error('the unsafe control needs a money-carrying class');
  }

  const principalUid = { type: `${NAMESPACE}::Principal`, id: request.principal.id };
  const roleUid = { type: `${NAMESPACE}::Role`, id: request.principal.role };
  const resourceUid = { type: `${NAMESPACE}::Order`, id: request.resource.resourceId };

  const decimalOf = (literal: string): CedarValue => ({
    __extn: { fn: 'decimal', arg: literal },
  });

  return {
    principal: principalUid,
    action: { type: `${NAMESPACE}::Action`, id: 'refund.create' },
    resource: resourceUid,
    context: {
      exposure: {
        // ▼▼▼ THE ONE DIFFERENCE ▼▼▼
        // Production reads `request.exposure.totalExposure`. This reads the money in the
        // dispatched vendor request instead — the field `26 §2.1.1` says a cap must not
        // compare against.
        total_exposure: decimalOf(toDb(vendorAmount)),
        // ▲▲▲ THE ONE DIFFERENCE ▲▲▲
      },
      selected_option: {
        amount: decimalOf(toDb(option.amount)),
        instrument: option.instrument,
        line_refundable_remaining: decimalOf(toDb(option.lineRefundableRemaining)),
      },
      reason_code: request.reasonCode,
      ...(request.customerNovelty === null
        ? {}
        : { customer_novelty: request.customerNovelty as string }),
    },
    entities: [
      {
        uid: principalUid,
        attrs: { kind: request.principal.kind as string, delegation_depth: request.principal.delegationDepth },
        parents: [roleUid],
      },
      { uid: roleUid, attrs: {}, parents: [] },
      {
        uid: resourceUid,
        attrs: { exists: true, grade: request.resource.grade as string },
        parents: [],
      },
    ],
  };
}

export interface UnsafeOutcome {
  readonly decision: 'PERMIT' | 'DENY';
  readonly code: PolicyDenyCode | null;
}

/**
 * The unsafe evaluation, end to end, over PRODUCTION artifacts and the PRODUCTION engine.
 *
 * Only the request construction is substituted.
 */
export function evaluateUnsafely(
  artifacts: LoadedPolicyArtifacts,
  effect: CanonicalEffect,
): UnsafeOutcome {
  const evaluation = evaluateWithCedar(artifacts, unsafeVendorAmountRequest(effect));
  if (evaluation.decision === 'allow') return { decision: 'PERMIT', code: null };
  return { decision: 'DENY', code: resolveDenialCategory(evaluation.determiningPolicies).code };
}
