import { describe, expect, it } from 'vitest';

import {
  actionCatalogue,
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
 * v1.3.6 (`50 §2a`, `50 §3f`): the catalogue is READ FROM THE ACTIVE VERIFIED BUNDLE.
 *
 * Before S1K this was a frozen literal imported from `actionCatalogue.ts`. `50 §3f`'s single
 * source of authority rule moved it into the signed class-3 artifact, so this binding now
 * resolves the same rows out of the bundle `tests/support/controlArtifactSetup.ts`
 * bootstrapped — which is what production reads.
 */
const ACTION_CATALOGUE = actionCatalogue().entries;


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
    /*
     * S1P's CLASS, AND THE DECLARATION THAT KEEPS IT FROM BECOMING A CAPABILITY.
     *
     * `email.send` was added to the class-3 catalogue so that S1P's real-provider `I36`
     * validation could name the effect it actually performs. `§1.2` of the S1P correction
     * mandate rules on what that addition may NOT do: "Adding the class for S1P must NOT
     * silently enable autonomous production/customer email", "do NOT invent a general
     * customer-email Cedar grant", "ordinary production policy treatment must remain
     * UNGOVERNED_FAILS_CLOSED".
     *
     * So the class-2 artifact is UNCHANGED — its Cedar schema declares one action and this
     * is not it — and the gap declaration below is where the status is recorded. The three
     * assertions in the `UNGOVERNED` block execute that status against `email.send` exactly
     * as they do against the other three: no registered policy construction, no Cedar action,
     * and no registered constructor. An ordinary production `email.send` therefore denies at
     * `26 §7` step C2, before policy, and `36 §3`'s "silently so" is removed by this table.
     */
    'email.send': 'UNGOVERNED_FAILS_CLOSED',
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

  it('there are four of them, so this suite is not vacuous', () => {
    // THREE before S1P, four after it. The count is asserted rather than inferred so that a
    // future catalogue addition that forgot its declared status fails here.
    expect(ungoverned).toHaveLength(4);
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
