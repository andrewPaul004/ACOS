import { describe, expect, it } from 'vitest';

import {
  ACTION_CATALOGUE,
  ACTION_CLASSES,
} from '../../src/kernel/canonicalisation/actionCatalogue.js';
import {
  buildCedarRequest,
  hasPolicyConstruction,
  registeredPolicyConstructionClasses,
} from '../../src/kernel/policy/cedarRequest.js';
import { evaluateWithCedar } from '../../src/kernel/policy/cedarEngine.js';
import { loadPolicyArtifacts } from '../../src/kernel/policy/policyArtifacts.js';
import { PolicyEngine } from '../../src/kernel/policy/policyEngine.js';
import { canonicalEffectAt } from '../support/policyFixture.js';

/**
 * POLICY-SET GAP ANALYSIS.
 *
 * `36 §3`, verbatim:
 *
 *   "Additionally: **policy-set gap analysis.** Enumerate the closed action catalogue and
 *    assert every class has at least one governing policy and at least one test. **An action
 *    class with no policy is a deny by default (SR7) — correct, but silently so**, and a
 *    class that was *meant* to be allowed and silently denies is an availability bug that
 *    will be 'fixed' under pressure by someone adding a permissive policy."
 *
 * S1D governs exactly one class. The mandate is explicit that the other three must NOT be
 * given policies for the sake of completeness:
 *
 *   "Do not implement the remaining mock catalogue merely to make the framework look
 *    complete."
 *
 * So the deliverable here is the second half of `36 §3`'s requirement rather than the first:
 * the silence is removed. Each ungoverned class is asserted, BY EXECUTION, to fail closed,
 * and the status table below is the artifact a reviewer reads.
 */

const artifacts = loadPolicyArtifacts();
const engine = new PolicyEngine(artifacts);

/**
 * The declared status of every catalogue class at S1D. Authored HERE, independently of
 * `cedarRequest.ts`'s registry, and diffed against it below — a table generated from the
 * thing it audits would agree with itself and prove nothing.
 */
const DECLARED_STATUS: Readonly<Record<string, 'GOVERNED' | 'UNGOVERNED_FAILS_CLOSED'>> =
  Object.freeze({
    // The money-bearing class S1D exists for. `51 §3.1`, `26 §8`, `26 §11.2` row 3.
    'refund.create': 'GOVERNED',
    // `26 §11.2` row 6, "REACHABLE" under its own grant — but no constructor (S1B) and no
    // Cedar policy (S1D), so it denies at `26 §7` step C2 long before policy.
    'campaign.pause': 'UNGOVERNED_FAILS_CLOSED',
    // `26 §11.2` row 9, OUTBOUND_GOODS_TO_ADDRESS, IRRECOVERABLE. Same.
    'fulfilment.reship': 'UNGOVERNED_FAILS_CLOSED',
    // `26 §11.2` row 5, the rate class. `26 §8`'s worked policy for it needs the forward
    // integral and window headroom, neither of which S1D implements. Same.
    'campaign.budget.set': 'UNGOVERNED_FAILS_CLOSED',
  });

describe('every class in the closed catalogue has a declared, tested status', () => {
  it('the declared table covers the catalogue EXACTLY — no class unaccounted for', () => {
    expect(Object.keys(DECLARED_STATUS).sort()).toEqual([...ACTION_CLASSES].sort());
  });

  it('and the declaration agrees with the registry it audits', () => {
    for (const actionClass of ACTION_CLASSES) {
      expect(hasPolicyConstruction(actionClass), actionClass).toBe(
        DECLARED_STATUS[actionClass] === 'GOVERNED',
      );
    }
    expect(registeredPolicyConstructionClasses()).toEqual(['refund.create']);
  });

  it('exactly ONE class is governed at S1D, and it is the money-bearing one', () => {
    const governed = ACTION_CLASSES.filter((c) => DECLARED_STATUS[c] === 'GOVERNED');
    expect(governed).toEqual(['refund.create']);
    expect(ACTION_CATALOGUE['refund.create'].carriesVendorMonetaryField).toBe(true);
    expect(ACTION_CATALOGUE['refund.create'].costComponentFree).toBe(false);
  });
});

describe('the GOVERNED class has a reachable permit and a reachable denial — `26 §11` P6', () => {
  it('P6 reachability: a lawful refund PERMITS', () => {
    // `26 §11` P6, verbatim: "For every action class in the catalogue, at least one path is
    // reachable — a policy set that denies everything passes the safety properties trivially
    // and is not a control, it is an outage."
    expect(
      engine.evaluate(canonicalEffectAt({ vendorAmount: '10.00', retainedFee: '1.03' })).decision,
    ).toBe('PERMIT');
  });

  it('P1: and an over-cap refund DENIES PER_ACTION', () => {
    const decision = engine.evaluate(
      canonicalEffectAt({ vendorAmount: '25.00', retainedFee: '1.03' }),
    );
    expect(decision.decision === 'DENY' && decision.code).toBe('PER_ACTION');
  });
});

describe('the UNGOVERNED classes fail closed — asserted by execution, not by comment', () => {
  const ungoverned = ACTION_CLASSES.filter(
    (c) => DECLARED_STATUS[c] === 'UNGOVERNED_FAILS_CLOSED',
  );

  it('there are three of them, so this suite is not vacuous', () => {
    expect(ungoverned).toHaveLength(3);
  });

  it('none has a registered Cedar request construction — the builder refuses', () => {
    const effect = canonicalEffectAt({ vendorAmount: '10.00', retainedFee: '1.03' });
    for (const actionClass of ungoverned) {
      const other = {
        ...effect,
        request: { ...effect.request, actionClass: actionClass as never },
      };
      expect(() => buildCedarRequest(other), actionClass).toThrow(/NO_POLICY_CONSTRUCTION/);
    }
  });

  it('and even reaching Cedar directly, the schema declares no such action', () => {
    // The second, independent barrier. Even if a construction were registered by mistake,
    // Cedar's schema has one action and refuses the rest.
    const request = buildCedarRequest(
      canonicalEffectAt({ vendorAmount: '10.00', retainedFee: '1.03' }),
    );
    for (const actionClass of ungoverned) {
      expect(() =>
        evaluateWithCedar(artifacts, {
          ...request,
          action: { type: 'Acos::Action', id: actionClass },
        }),
        actionClass,
      ).toThrow(/CEDAR_REQUEST_REJECTED/);
    }
  });

  it('a class outside the catalogue entirely is refused too', () => {
    // `36 §2`, verbatim: "For any action class not in the closed catalogue, the result is
    // DENY (SR7). Generate random unrecognised class names; all must deny."
    const effect = canonicalEffectAt({ vendorAmount: '10.00', retainedFee: '1.03' });
    for (const invented of ['refund.creates', 'refund.create ', 'REFUND.CREATE', 'x', '', '../']) {
      const other = { ...effect, request: { ...effect.request, actionClass: invented as never } };
      expect(() => buildCedarRequest(other), JSON.stringify(invented)).toThrow(
        /NO_POLICY_CONSTRUCTION/,
      );
    }
  });

  it('the ungoverned classes are ungoverned because they have NO CONSTRUCTOR either', () => {
    // `26 §7` step C2's terminal is DENY: NOT_CANONICALISABLE, and it fires before policy
    // ever runs. So the gap is two barriers deep, and the reason is recorded rather than
    // discovered: S1B registered one constructor, S1D registered one policy, and they are
    // the same class.
    expect(registeredPolicyConstructionClasses()).toEqual(['refund.create']);
  });
});
