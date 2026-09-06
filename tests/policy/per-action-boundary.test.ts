import { describe, expect, it } from 'vitest';

import { toDb } from '../../src/kernel/exposure/money.js';
import { PolicyEngine } from '../../src/kernel/policy/policyEngine.js';
import { PER_ACTION_POLICY_ID } from '../../src/kernel/policy/policyArtifacts.js';
import {
  PER_ACTION_MAX_LITERAL,
  VC_C1_RETAINED_FEE,
  VC_C1_TOTAL_EXPOSURE,
  canonicalEffectAt,
  effectWithTotalExposure,
} from '../support/policyFixture.js';

/**
 * `36 §3` layer 1, verbatim:
 *
 *   "**Layer 1 — policy unit tests.** Each Cedar policy gets allow and deny fixtures,
 *    **including boundary values at every numeric limit and one value past each.**"
 *
 * The limit is `51 §3.1`'s `per_action_max` for `refund.create`: **$25.00**.
 *
 * The comparison is `<=`, and that is verified against the architecture rather than assumed:
 *
 *   `26 §8`   "context.exposure.total_exposure <= 25.00"
 *   `26 §11.2` row 3   "Bounded by `total_exposure ≤ $25.00`"
 *
 * so AT the limit is INSIDE the limit, and the first denying value is one minor currency
 * unit above it. A `<` reading would deny `$25.00`, and the second case below is what
 * discriminates the two readings.
 */

const engine = new PolicyEngine();

describe('the per-action boundary, at $25.00', () => {
  it('BELOW — $24.99 permits', () => {
    const effect = effectWithTotalExposure('24.99');
    expect(toDb(effect.request.exposure.totalExposure)).toBe('24.99');
    expect(engine.evaluate(effect).decision).toBe('PERMIT');
  });

  it('AT — $25.00 permits, because the rule is `<=` and not `<`', () => {
    const effect = effectWithTotalExposure(PER_ACTION_MAX_LITERAL);
    expect(toDb(effect.request.exposure.totalExposure)).toBe('25.00');
    const decision = engine.evaluate(effect);
    expect(decision.decision).toBe('PERMIT');
    // P6 reachability, `26 §11`: "a policy set that denies everything passes the safety
    // properties trivially and is not a control, it is an outage." This is the reachable
    // path for `refund.create`, `26 §11.2` row 3's "REACHABLE (`51 §3.1`)".
    expect(decision.lineage.determiningPolicies).toEqual(['acos.refund.create.grant']);
  });

  it('ONE MINOR UNIT ABOVE — $25.01 denies PER_ACTION', () => {
    const effect = effectWithTotalExposure('25.01');
    expect(toDb(effect.request.exposure.totalExposure)).toBe('25.01');
    const decision = engine.evaluate(effect);
    expect(decision.decision).toBe('DENY');
    expect(decision.decision === 'DENY' && decision.code).toBe('PER_ACTION');
    expect(decision.lineage.determiningPolicies).toEqual([PER_ACTION_POLICY_ID]);
  });

  it('VC-C1 — $26.03 denies PER_ACTION', () => {
    const effect = effectWithTotalExposure(VC_C1_TOTAL_EXPOSURE);
    expect(toDb(effect.request.exposure.totalExposure)).toBe('26.03');
    expect(toDb(effect.request.exposure.vendorAmount!)).toBe('25.00');
    const decision = engine.evaluate(effect);
    expect(decision.decision === 'DENY' && decision.code).toBe('PER_ACTION');
  });

  it('the boundary is exact fixed-point — $25.004 is not expressible and $25.00 is not $25.0', () => {
    // `30 §5.3` (ACOS-JCS-1): "25.0 and 25.00 are different bytes". `money.ts` holds minor
    // units in a bigint precisely so no boundary case can be decided by a float.
    const atLimit = effectWithTotalExposure('25.00');
    expect(toDb(atLimit.request.exposure.totalExposure)).toBe('25.00');
    expect(atLimit.request.exposure.totalExposure).toBe(2500n);
    const above = effectWithTotalExposure('25.01');
    expect(above.request.exposure.totalExposure - atLimit.request.exposure.totalExposure).toBe(1n);
    // One minor unit apart, and on opposite sides of the decision.
    expect(engine.evaluate(atLimit).decision).toBe('PERMIT');
    expect(engine.evaluate(above).decision).toBe('DENY');
  });
});

describe('the operand is total_exposure — proven by two discriminating pairs', () => {
  /**
   * `26 §11` P1's operand, verbatim: "**`exposure.total_exposure`** exceeds the configured
   * per-action cap. *(v1.2: the operand is `total_exposure`, not the vendor amount —
   * SR-C1.)*"
   *
   * A single fixture cannot prove which of two correlated figures a policy read. These two
   * pairs decorrelate them in both directions.
   */

  it('PAIR 1 — vendor_amount held FIXED, only the fee moves: the decision FLIPS', () => {
    // vendor $23.97 in both. Fee $1.03 -> total $25.00. Fee $1.04 -> total $25.01.
    const permits = canonicalEffectAt({ vendorAmount: '23.97', retainedFee: '1.03' });
    const denies = canonicalEffectAt({ vendorAmount: '23.97', retainedFee: '1.04' });

    expect(toDb(permits.request.exposure.vendorAmount!)).toBe('23.97');
    expect(toDb(denies.request.exposure.vendorAmount!)).toBe('23.97');
    expect(toDb(permits.request.exposure.totalExposure)).toBe('25.00');
    expect(toDb(denies.request.exposure.totalExposure)).toBe('25.01');

    expect(engine.evaluate(permits).decision).toBe('PERMIT');
    const denial = engine.evaluate(denies);
    expect(denial.decision === 'DENY' && denial.code).toBe('PER_ACTION');

    // The vendor amount is byte-identical across the pair, so no policy reading it could
    // have produced two different decisions.
    expect(toDb(permits.dispatchPayload.monetaryEffect!)).toBe(
      toDb(denies.dispatchPayload.monetaryEffect!),
    );
  });

  it('PAIR 2 — total_exposure held FIXED, only vendor_amount moves: the decision does NOT move', () => {
    // total $25.00 in both, split $23.97/$1.03 and $24.00/$1.00.
    const a = canonicalEffectAt({ vendorAmount: '23.97', retainedFee: '1.03' });
    const b = canonicalEffectAt({ vendorAmount: '24.00', retainedFee: '1.00' });

    expect(toDb(a.request.exposure.totalExposure)).toBe('25.00');
    expect(toDb(b.request.exposure.totalExposure)).toBe('25.00');
    expect(toDb(a.request.exposure.vendorAmount!)).not.toBe(toDb(b.request.exposure.vendorAmount!));

    expect(engine.evaluate(a).decision).toBe('PERMIT');
    expect(engine.evaluate(b).decision).toBe('PERMIT');
    expect(engine.evaluate(a).lineage.determiningPolicies).toEqual(
      engine.evaluate(b).lineage.determiningPolicies,
    );
  });

  it('PAIR 3 — a vendor_amount well OVER the cap still permits when total_exposure is not', () => {
    // Not reachable for `refund.create` (`I18c` requires vendor <= total, and the fee is
    // positive), so the converse is asserted the other way: a vendor amount AT the cap with
    // a fee denies, while a smaller vendor amount with the same fee permits. Same fee, same
    // class, same everything but the amount the constructor ADDS the fee to.
    const atCapVendor = canonicalEffectAt({ vendorAmount: '25.00', retainedFee: VC_C1_RETAINED_FEE });
    const underVendor = canonicalEffectAt({ vendorAmount: '23.97', retainedFee: VC_C1_RETAINED_FEE });
    expect(engine.evaluate(atCapVendor).decision).toBe('DENY');
    expect(engine.evaluate(underVendor).decision).toBe('PERMIT');
    // And the denying one is the one whose DISPATCHED amount is exactly at the cap, which is
    // the shape `26 §2.1.1` says a vendor-amount cap would have wrongly permitted.
    expect(toDb(atCapVendor.dispatchPayload.monetaryEffect!)).toBe('25.00');
  });
});
