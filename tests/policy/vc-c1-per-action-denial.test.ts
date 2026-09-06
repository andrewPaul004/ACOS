import { describe, expect, it } from 'vitest';

import { toDb } from '../../src/kernel/exposure/money.js';
import { PolicyEngine } from '../../src/kernel/policy/policyEngine.js';
import { PER_ACTION_POLICY_ID } from '../../src/kernel/policy/policyArtifacts.js';
import { projectPolicyDecisionToWorker } from '../../src/kernel/policy/workerFacingPolicyDenial.js';
import {
  VC_C1_RETAINED_FEE,
  VC_C1_TOTAL_EXPOSURE,
  VC_C1_VENDOR_AMOUNT,
  canonicalEffectAt,
} from '../support/policyFixture.js';

/**
 * VC-C1 — THE DENIAL HALF.
 *
 * `36 §2`, verbatim:
 *
 *   "**VC-C1** additionally asserts the *negative* case the retirement was about: a $25.00
 *    line refund with a $1.03 retained fee computes `total_exposure = $26.03` and **denies
 *    `PER_ACTION`** against a $25.00 cap. Under v1.1's I18 the same fixture was
 *    unsatisfiable in both readings."
 *
 * `37 §3`, verbatim:
 *
 *   "including VC-C1's negative case: a $25.00 line refund carrying a $1.03 retained fee
 *    must deny `PER_ACTION` against a $25.00 cap."
 *
 * `26 §2.1.1`, the sentence the whole slice exists for, verbatim:
 *
 *   "**And the consequence that matters most: no policy cap intended to bound economic loss
 *    may compare only against `vendor_amount`.**"
 *
 * S1B proved the construction half and its `errors.ts` recorded the gap: "PER_ACTION is a
 * POLICY denial and no code path here can produce it." This file closes it, with the real
 * Cedar engine.
 */

const engine = new PolicyEngine();

describe('VC-C1 — $25.00 vendor / $1.03 retained fee / $26.03 total exposure', () => {
  const effect = canonicalEffectAt({
    vendorAmount: VC_C1_VENDOR_AMOUNT,
    retainedFee: VC_C1_RETAINED_FEE,
  });

  it('the canonicaliser still constructs the accepted S1B economics, unchanged', () => {
    // The construction half, re-asserted here so this file stands alone as evidence and so a
    // regression in S1B cannot make the denial below pass for the wrong reason.
    expect(toDb(effect.request.exposure.vendorAmount!)).toBe('25.00');
    expect(toDb(effect.request.exposure.totalExposure)).toBe('26.03');
    expect(toDb(effect.dispatchPayload.monetaryEffect!)).toBe('25.00');
    expect(effect.request.exposure.costComponents).toHaveLength(1);
    expect(toDb(effect.request.exposure.costComponents[0]!.amount)).toBe('1.03');
  });

  it('DENIES, and the code is PER_ACTION', () => {
    const decision = engine.evaluate(effect);
    expect(decision.decision).toBe('DENY');
    expect(decision.decision === 'DENY' && decision.code).toBe('PER_ACTION');
  });

  it('and the denial is attributed to the per-action policy, not to an unsatisfied grant', () => {
    // The distinction is load-bearing. `total_exposure = $26.03` ALSO fails the `<= 25.00`
    // conjunct inside `26 §8`'s permit, so a denial could arrive as "no policy permitted".
    // `26 §11` P1 requires the stronger property — "no policy path PERMITS" — which only a
    // `forbid` carries, and it is the `forbid` that must be determining here.
    const decision = engine.evaluate(effect);
    expect(decision.lineage.determiningPolicies).toEqual([PER_ACTION_POLICY_ID]);
  });

  it('the dispatched $25.00 is NOT what was tested — the same effect carries both figures', () => {
    // `$25.00` is present on the very object the policy evaluated, as `vendor_amount` and as
    // `dispatch_payload.monetary_effect`, and it is inside the $25.00 cap. The denial
    // therefore cannot have come from the vendor amount, because the vendor amount permits.
    expect(toDb(effect.request.exposure.vendorAmount!)).toBe(VC_C1_VENDOR_AMOUNT);
    expect(VC_C1_VENDOR_AMOUNT <= '25.00').toBe(true);
    expect(toDb(effect.request.exposure.totalExposure)).toBe(VC_C1_TOTAL_EXPOSURE);
    expect(engine.evaluate(effect).decision).toBe('DENY');
  });

  it('the worker sees the coarse category and nothing else', () => {
    const worker = projectPolicyDecisionToWorker(engine.evaluate(effect));
    expect(worker).toEqual({ deny: 'PER_ACTION' });
    expect(Object.keys(worker)).toEqual(['deny']);
    expect(Object.isFrozen(worker)).toBe(true);
    // No amount, no limit, no distance, no policy id, no version.
    expect(JSON.stringify(worker)).not.toMatch(/25|26|1\.03|acos\.|policy/i);
  });

  it('every decision records `26 §11`’s policy_version and constructor_version', () => {
    const decision = engine.evaluate(effect);
    expect(decision.lineage.policyVersion).toMatch(/^[0-9a-f]{64}$/);
    expect(decision.lineage.constructorVersion.constructorId).toBe('ctor.refund.create');
    expect(decision.lineage.constructorVersion.semanticMajor).toBe(1);
  });

  it('is deterministic — `26 §11`: same inputs, same versions, same verdict, forever', () => {
    // Run repeatedly rather than once. Cedar is deterministic by design, and a policy path
    // that depended on set iteration order, on `readdir` order, or on a clock would show up
    // here rather than in production.
    const first = engine.evaluate(effect);
    for (let i = 0; i < 50; i += 1) {
      const again = engine.evaluate(effect);
      expect(again).toEqual(first);
    }
    // And across a freshly loaded engine, so the digest is a property of the artifacts
    // rather than of one load.
    const second = new PolicyEngine().evaluate(effect);
    expect(second).toEqual(first);
  });
});
