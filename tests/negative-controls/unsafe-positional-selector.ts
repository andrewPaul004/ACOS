import { computed } from '../../src/kernel/canonicalisation/brands.js';
import type { EffectCanonicaliser } from '../../src/kernel/canonicalisation/canonicaliser.js';
import type { ProposedIntent } from '../../src/kernel/canonicalisation/intent.js';
import type {
  AuthoritativeCanonicalisationContext,
  CanonicalEffect,
} from '../../src/kernel/canonicalisation/types.js';
import type { TaskContextSpec } from '../../src/kernel/enumeration/contextSpec.js';
import type { HeldEntityLease } from '../../src/kernel/enumeration/entityLease.js';
import type { EffectEnumerator } from '../../src/kernel/enumeration/enumerateEffects.js';
import { findEnumerationRecord } from '../../src/kernel/enumeration/enumerationRecord.js';
import type { KernelSuppliedContext } from '../../src/kernel/enumeration/liveSelector.js';

/**
 * ============================================================================
 * TEST-ONLY UNSAFE CODE. NEVER IMPORTED FROM `src/`. NEVER REGISTERED.
 * ============================================================================
 *
 * v1.1's POSITIONAL selector, reconstructed, so that VC-C3 can be shown to detect the defect
 * it exists for.
 *
 * `36 §0`'s negative-control rule, and the S1C mandate restating it:
 *
 *   "This negative control is mandatory. Do not weaken production code to create it. If the
 *    unsafe positional fixture does not substitute B, the test does not discriminate the
 *    architecture's CAN-03 failure."
 *
 * `26 §2.0.1` constructs the failure precisely, and this file is that construction in
 * executable form, verbatim:
 *
 *   "v1.1's `selector` was an index into a kernel-enumerated option set, and
 *    `DENY: SELECTOR_INVALID` fired when the selector did not index a live option. That
 *    guard catches the option set *shrinking past* the index, which is the benign case.
 *    **The dangerous case is reordering, and reordering is undetectable by an ordinal.**
 *    `53 §1` constructed it: order 123 carries refundable lines `[A: $10.00, B: $20.00]`;
 *    the model reads the enumeration and submits index 0 for line A; a concurrent partial
 *    refund exhausts line A; step C′ re-enumerates to `[B: $20.00]`; index 0 is valid and
 *    denotes B; the kernel computes $20.00, every policy check passes, and **a refund of
 *    line B dispatches with `I18`, `I21`, `I2`, `I3`, `I29` and `I31` all holding.** The
 *    executed effect was economically different from the selected one and no invariant
 *    fired."
 *
 * ---------------------------------------------------------------------------------
 * WHAT IS UNSAFE HERE — exactly one thing, named
 *
 * The selector is an INTEGER INDEX, and the option is chosen by `liveOptions[index]`.
 *
 * That is the whole difference. Everything else is the production path:
 *
 *   - the same `EffectEnumerator`, so the live set is the real live set;
 *   - the same entity execution lease, so the re-enumeration is genuinely under the lock;
 *   - the same enumeration record, the same `max_age` check, the same binding checks;
 *   - the same accepted S1B `EffectCanonicaliser`, unmodified, computing the same exposure.
 *
 * So when this substitutes line B, it does so with every OTHER control in place — which is
 * the architecture's point: the substitution is not caught by exposure, by `I18a`–`I18d`, by
 * `I21` or by the canonicaliser. Only the content address catches it.
 *
 * NO PRODUCTION CODE IS WEAKENED. This file imports the production components and uses them
 * as they are. `src/` contains no integer selector, no index compatibility layer and no
 * fallback that could reach this behaviour — asserted by
 * `tests/canonicalisation/positional-selector-rejected.test.ts` and by
 * `tests/type-negative/positional-selector.ts`.
 *
 * This mirrors S1A's `unsafe-schema.ts` and S1B's `unsafe-retained-fee-escape.ts`, which
 * carry deliberately weakened implementations for the same reason.
 * ---------------------------------------------------------------------------------
 */

/**
 * v1.1's model-facing intent: a `selector` that is an INTEGER.
 *
 * `26 §2.0`'s v1.2 note, verbatim: "`selector` remains **one** field for `I21`'s purposes;
 * it is a pair rather than an integer." This is the superseded shape.
 */
export interface UnsafePositionalIntent {
  readonly actionClass: 'refund.create';
  readonly resourceRef: string;
  /** THE DEFECT. An ordinal into the enumerated option set. */
  readonly selector: number;
  readonly enumerationId: string;
  readonly reasonCode: ProposedIntent['reasonCode'];
  readonly rationale: ProposedIntent['rationale'];
}

export interface UnsafePositionalResult {
  readonly effect: CanonicalEffect;
  /** The line the unsafe path actually canonicalised. The observable of the control. */
  readonly dispatchedLineId: string;
  /** The amount it computed. */
  readonly dispatchedAmount: string;
}

export interface UnsafePositionalDeps {
  readonly enumerator: EffectEnumerator;
  readonly canonicaliser: EffectCanonicaliser;
}

/**
 * Step C′ under a POSITIONAL selector — the pre-SR-C3 implementation.
 *
 * Note what it still does correctly, because it matters: it re-enumerates under the held
 * lease, it checks the enumeration binding, and it bounds-checks the index. v1.1's
 * `SELECTOR_INVALID` "catches the option set shrinking past the index, which is the benign
 * case". The bounds check is present here precisely so the test cannot be dismissed as
 * having removed a check the architecture had; the set shrank from 2 to 1 and index 0 is
 * still in range.
 */
export async function unsafeCanonicaliseByPosition(
  deps: UnsafePositionalDeps,
  lease: HeldEntityLease,
  intent: UnsafePositionalIntent,
  spec: TaskContextSpec,
  supplied: KernelSuppliedContext,
): Promise<UnsafePositionalResult> {
  lease.assertHeld();

  const record = await findEnumerationRecord(lease.client, supplied.companyId, intent.enumerationId);
  if (record === null) throw new Error('unsafe control: unknown enumeration');

  // Re-enumerate the LIVE set — the same call the production boundary makes.
  const live = await deps.enumerator.reEnumerate(lease, {
    actionClass: intent.actionClass,
    resourceRef: intent.resourceRef,
    spec,
  });

  // v1.1's guard, faithfully: the index must be in range. It is — and that is the point.
  if (!Number.isInteger(intent.selector) || intent.selector < 0) {
    throw new Error('unsafe control: selector is not a non-negative integer');
  }
  if (intent.selector >= live.set.options.length) {
    throw new Error('unsafe control: DENY SELECTOR_INVALID — the index is out of range');
  }

  // ==========================================================================
  // THE DEFECT, IN ONE LINE. The option is chosen BY POSITION.
  // ==========================================================================
  const chosen = live.authoritative[intent.selector]!;

  const resourceState = live.resourceState;
  if (resourceState === null) throw new Error('unsafe control: resource did not resolve');

  const context: AuthoritativeCanonicalisationContext = {
    companyId: computed(supplied.companyId),
    taskId: computed(spec.taskId),
    principal: supplied.principal,
    resource: computed(resourceState.resource),
    enumerationRef: computed({
      enumerationId: record.enumerationId,
      computedAt: record.computedAt,
    }),
    ledgerCurrency: computed(resourceState.ledgerCurrency),
    retainedProcessingFee:
      chosen.retainedProcessingFee === null ? null : computed(chosen.retainedProcessingFee),
    grantWindows: computed(supplied.grantWindows),
    customerNovelty:
      resourceState.customerNovelty === null ? null : computed(resourceState.customerNovelty),
    contextDigest: computed(supplied.contextDigest),
    authorisationRef: computed(supplied.authorisationRef),
    contextSpec: computed(spec),
  };

  // The PRODUCTION canonicaliser, unmodified.
  //
  // Its own `option_id` check compares the selector against the option — and under a
  // positional selector there is no `option_id` in the selector to compare, so the intent
  // handed to it is synthesised from the option that was CHOSEN. That is exactly the v1.1
  // situation: with no content address in the proposal, the canonicaliser has nothing to
  // detect the substitution with.
  const optionId = live.set.options[intent.selector]!.optionId;
  const syntheticIntent: ProposedIntent = {
    actionClass: intent.actionClass,
    resourceRef: intent.resourceRef,
    selector: { enumerationId: record.enumerationId, optionId },
    reasonCode: intent.reasonCode,
    rationale: intent.rationale,
  };

  const effect = deps.canonicaliser.canonicalise(syntheticIntent, context, chosen.option);
  return {
    effect,
    dispatchedLineId: effect.request.parameters.lineId,
    dispatchedAmount: effect.dispatchPayload.vendorParameters['amount']!,
  };
}
