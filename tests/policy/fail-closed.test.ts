import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PolicyEngine } from '../../src/kernel/policy/policyEngine.js';
import { PolicyEvaluationDefect } from '../../src/kernel/policy/errors.js';
import { evaluateWithCedar } from '../../src/kernel/policy/cedarEngine.js';
import { buildCedarRequest, type CedarRequest } from '../../src/kernel/policy/cedarRequest.js';
import {
  loadPolicyArtifacts,
  type LoadedPolicyArtifacts,
} from '../../src/kernel/policy/policyArtifacts.js';
import { parseProposedIntent } from '../../src/kernel/canonicalisation/intent.js';
import { money } from '../../src/kernel/exposure/money.js';
import {
  makeCanonicaliser,
  makeContext,
  makeRawIntent,
  makeRefundOption,
} from '../support/canonicalisationFixture.js';
import { canonicalEffectAt } from '../support/policyFixture.js';
import { stagedPolicyBundle } from '../support/controlArtifactFixture.js';

/**
 * FAIL-CLOSED, on every path the S1D mandate names.
 *
 * The property under test is one sentence: **none of these may become `PERMIT`.**
 *
 * `36 §3` layer 2, verbatim:
 *
 *   "**Layer 2 — request-construction tests.** The authority tuple (`26 §2`) must be built
 *    completely. A test asserts that omitting any tuple field fails closed rather than
 *    defaulting. **This is where real systems break: the policy is fine and `exposure`
 *    arrives as null.**"
 *
 * The two outcomes that count as failing closed are a `DENY` under a `26 §7` terminal and a
 * thrown `PolicyEvaluationDefect`. They are not interchangeable, and each case below asserts
 * WHICH one it expects — collapsing a control-plane defect into a business denial is the
 * error `enumeration/workerFacingDenial.ts` refuses on the S1C path and `errors.ts` refuses
 * here.
 */

const engine = new PolicyEngine();
const artifacts = loadPolicyArtifacts();
/**
 * v1.3.6 (`50 §2e`): a staged policy set is now a SIGNED CLASS-2 BUNDLE, not a directory.
 *
 * `50 §2e`'s O4 rule makes the Cedar bundle an owner-signed artifact admitted only after its
 * content hash and both signatures verify, so "write a broken policy file into a directory"
 * is no longer something a deployment can do and is no longer what these cases should model.
 * Each staged set below is edited, RE-SIGNED by the test-only roots, verified through the
 * full `50 §3f` ceremony, and then handed to the loader — so what is under test remains the
 * POLICY LOADER's behaviour over a set the owner signed, which is the case that can still
 * happen.
 */
function stagedArtifacts(
  edit: (policies: { id: string; source: string }[]) => { id: string; source: string }[],
): LoadedPolicyArtifacts {
  return loadPolicyArtifacts(
    stagedPolicyBundle((document) => ({ ...document, policies: edit(document.policies) })),
  );
}

function replacingPolicy(
  id: string,
  source: string,
): (policies: { id: string; source: string }[]) => { id: string; source: string }[] {
  return (policies) => policies.map((policy) => (policy.id === id ? { id, source } : policy));
}

/** Assert an outcome is not a permit, whichever fail-closed shape it takes. */
function expectNotPermitted(run: () => { decision: string }): void {
  let outcome: { decision: string } | null = null;
  try {
    outcome = run();
  } catch (error) {
    expect(error).toBeInstanceOf(PolicyEvaluationDefect);
    return;
  }
  expect(outcome?.decision).toBe('DENY');
}

describe('UNKNOWN / UNREGISTERED ACTION CLASS', () => {
  it('a catalogue class with no registered policy construction is a DEFECT, not a permit', () => {
    // `campaign.pause` is in the closed catalogue and has no Cedar policy. Getting a
    // canonical effect for it is impossible (no constructor, `26 §7` step C2), so the class
    // is presented to the builder directly through a hand-made effect shape.
    const effect = canonicalEffectAt({ vendorAmount: '10.00', retainedFee: '1.03' });
    const other = {
      ...effect,
      request: { ...effect.request, actionClass: 'campaign.pause' as never },
    };
    expect(() => buildCedarRequest(other)).toThrow(/NO_POLICY_CONSTRUCTION/);
  });

  it('an action Cedar’s schema does not declare is a DEFECT, not a permit', () => {
    const effect = canonicalEffectAt({ vendorAmount: '10.00', retainedFee: '1.03' });
    const request: CedarRequest = {
      ...buildCedarRequest(effect),
      action: { type: 'Acos::Action', id: 'refund.invent' },
    };
    expect(() => evaluateWithCedar(artifacts, request)).toThrow(/CEDAR_REQUEST_REJECTED/);
  });

  it('an unknown ENTITY TYPE is a defect too', () => {
    const effect = canonicalEffectAt({ vendorAmount: '10.00', retainedFee: '1.03' });
    const request: CedarRequest = {
      ...buildCedarRequest(effect),
      resource: { type: 'Acos::Invoice', id: 'inv-1' },
    };
    expect(() => evaluateWithCedar(artifacts, request)).toThrow(/CEDAR_REQUEST_REJECTED/);
  });
});

describe('NO APPLICABLE POLICY', () => {
  it('a principal in another role reaches no permit and denies NO_GRANT', () => {
    // `26 §8`: `permit(principal in Role::"support_reasoner", …)`. Another role satisfies no
    // permit, and no forbid fires, so `26 §7` step I's terminal is the right one.
    const effect = canonicalEffectAt({
      vendorAmount: '10.00',
      retainedFee: '1.03',
      principalRole: 'market_researcher',
    });
    const decision = engine.evaluate(effect);
    expect(decision.decision).toBe('DENY');
    expect(decision.decision === 'DENY' && decision.code).toBe('NO_GRANT');
    expect(decision.lineage.determiningPolicies).toEqual([]);
  });

  it('a policy set with the grant REMOVED cannot even be loaded', () => {
    // The strongest form of "no applicable policy": you cannot quietly ship a policy set
    // missing its grant, because the exact-set check refuses it at load. A control plane
    // whose only remaining policy is the `forbid` would deny every refund — an outage, and
    // `26 §11` P6 is explicit that an outage is not a passing policy set.
    expect(() =>
      stagedArtifacts((policies) =>
        policies.filter((policy) => policy.id !== 'acos.refund.create.grant'),
      ),
    ).toThrow(/missing \[acos\.refund\.create\.grant\]/);
  });
});

describe('MISSING REQUIRED AUTHORITATIVE POLICY STATE — `36 §3` layer 2', () => {
  it('an absent customer_novelty OMITS the attribute and fails the grant closed', () => {
    // The `context has customer_novelty` guard in the grant is what turns an absent operand
    // into a denial rather than into a Cedar evaluation error or a default.
    const { canonicaliser } = makeCanonicaliser();
    const option = makeRefundOption({ amount: money('10.00') });
    const base = makeContext();
    const context = { ...base, customerNovelty: null };
    const intent = parseProposedIntent(makeRawIntent(option));
    const effect = canonicaliser.canonicalise(intent, context, option);
    expect(effect.request.customerNovelty).toBeNull();

    const request = buildCedarRequest(effect);
    expect(Object.keys(request.context)).not.toContain('customer_novelty');

    const decision = engine.evaluate(effect);
    expect(decision.decision).toBe('DENY');
    expect(decision.decision === 'DENY' && decision.code).toBe('NO_GRANT');
  });

  it('an EMPTY principal role is a DEFECT, not a silent no-grant', () => {
    // `26 §3` declares `role`; an empty one means resolution produced nothing, which is a
    // kernel defect rather than a principal who happens to hold no grants.
    const effect = canonicalEffectAt({
      vendorAmount: '10.00',
      retainedFee: '1.03',
      principalRole: '',
    });
    expect(() => engine.evaluate(effect)).toThrow(/AUTHORITATIVE_OPERAND_ABSENT/);
  });

  it('a resource below RECORD grade fails the grant closed', () => {
    // `26 §8`: `resource.grade == "RECORD"`. `24`'s grade model is what makes this the gate.
    for (const grade of ['OBSERVATION', 'CLAIM', 'DECISION_DELEGATED'] as const) {
      const effect = canonicalEffectAt({ vendorAmount: '10.00', retainedFee: '1.03', grade });
      const decision = engine.evaluate(effect);
      expect(decision.decision, `grade ${grade}`).toBe('DENY');
      expect(decision.decision === 'DENY' && decision.code).toBe('NO_GRANT');
    }
  });

  it('a refundable remaining BELOW the amount fails the grant closed', () => {
    // `26 §8`: `line_refundable_remaining >= amount`.
    const effect = canonicalEffectAt({
      vendorAmount: '10.00',
      retainedFee: '1.03',
      lineRefundableRemaining: '9.99',
    });
    expect(engine.evaluate(effect).decision).toBe('DENY');
  });

  it('an instrument other than "original" fails the grant closed', () => {
    // `26 §8`: `context.selected_option.instrument == "original"`, and `26 §8`'s v1.2 note:
    // "an ENUMERATED dimension, not an assertion".
    const effect = canonicalEffectAt({
      vendorAmount: '10.00',
      retainedFee: '1.03',
      instrument: 'store_credit',
    });
    expect(engine.evaluate(effect).decision).toBe('DENY');
  });

  it('EVERY context operand, dropped one at a time, fails closed', () => {
    // The layer-2 property stated generically rather than case by case: remove any single
    // operand from the request and assert no permit survives. A schema that admitted a
    // missing attribute, or a policy that short-circuited past one, would show up here.
    const effect = canonicalEffectAt({ vendorAmount: '10.00', retainedFee: '1.03' });
    const full = buildCedarRequest(effect);
    expect(evaluateWithCedar(artifacts, full).decision).toBe('allow');

    for (const key of Object.keys(full.context)) {
      const { [key]: _dropped, ...rest } = full.context;
      expectNotPermitted(() => {
        const evaluation = evaluateWithCedar(artifacts, { ...full, context: rest });
        return { decision: evaluation.decision === 'allow' ? 'PERMIT' : 'DENY' };
      });
    }
  });

  it('dropping the PRINCIPAL entity fails closed — the role edge goes with it', () => {
    const effect = canonicalEffectAt({ vendorAmount: '10.00', retainedFee: '1.03' });
    const full = buildCedarRequest(effect);
    const entities = full.entities.filter((entity) => entity.uid.type !== 'Acos::Principal');
    expectNotPermitted(() => {
      const evaluation = evaluateWithCedar(artifacts, { ...full, entities });
      return { decision: evaluation.decision === 'allow' ? 'PERMIT' : 'DENY' };
    });
  });

  it('dropping the RESOURCE entity fails closed — `resource.exists` cannot be read', () => {
    const effect = canonicalEffectAt({ vendorAmount: '10.00', retainedFee: '1.03' });
    const full = buildCedarRequest(effect);
    const entities = full.entities.filter((entity) => entity.uid.type !== 'Acos::Order');
    expectNotPermitted(() => {
      const evaluation = evaluateWithCedar(artifacts, { ...full, entities });
      return { decision: evaluation.decision === 'allow' ? 'PERMIT' : 'DENY' };
    });
  });

  it('dropping the standalone ROLE entity does NOT change the decision, and that is correct', () => {
    // Recorded rather than asserted away. `26 §3` makes the role a PARENT EDGE, and Cedar
    // reads that edge off the principal entity, so the standalone `Acos::Role` entity — which
    // carries no attributes — is a declaration rather than an operand. Its absence therefore
    // cannot loosen anything: membership still comes from the principal the kernel built.
    //
    // The test exists so the asymmetry with the two cases above is a documented finding
    // rather than a hole a later reader discovers. A role entity that ever acquires an
    // ATTRIBUTE a policy reads would move it into the operand set, and this test would then
    // have to change with it.
    const effect = canonicalEffectAt({ vendorAmount: '10.00', retainedFee: '1.03' });
    const full = buildCedarRequest(effect);
    const entities = full.entities.filter((entity) => entity.uid.type !== 'Acos::Role');
    expect(evaluateWithCedar(artifacts, { ...full, entities })).toEqual(
      evaluateWithCedar(artifacts, full),
    );
    // …and the role entity really does carry no attributes, which is what makes that safe.
    const role = full.entities.find((entity) => entity.uid.type === 'Acos::Role');
    expect(role?.attrs).toEqual({});
  });

  it('a principal whose role edge is REMOVED fails closed, which is the case that matters', () => {
    // The attack the previous test is NOT about: keep every entity, but strip the parent.
    const effect = canonicalEffectAt({ vendorAmount: '10.00', retainedFee: '1.03' });
    const full = buildCedarRequest(effect);
    const entities = full.entities.map((entity) =>
      entity.uid.type === 'Acos::Principal' ? { ...entity, parents: [] } : entity,
    );
    const evaluation = evaluateWithCedar(artifacts, { ...full, entities });
    expect(evaluation.decision).toBe('deny');
  });
});

describe('MALFORMED CEDAR REQUEST', () => {
  it('an UNDECLARED context attribute is rejected — there is no generic context map', () => {
    // The structural answer to "attempt to populate a generic policy context with $25.00".
    const effect = canonicalEffectAt({ vendorAmount: '10.00', retainedFee: '1.03' });
    const full = buildCedarRequest(effect);
    const smuggled: CedarRequest = {
      ...full,
      context: { ...full.context, per_action_max: { __extn: { fn: 'decimal', arg: '9999.00' } } },
    };
    expect(() => evaluateWithCedar(artifacts, smuggled)).toThrow(/CEDAR_REQUEST_REJECTED/);
  });

  it('an operand of the WRONG TYPE is rejected rather than coerced', () => {
    const effect = canonicalEffectAt({ vendorAmount: '10.00', retainedFee: '1.03' });
    const full = buildCedarRequest(effect);
    // A boolean where the schema declares a decimal.
    expect(() =>
      evaluateWithCedar(artifacts, {
        ...full,
        context: { ...full.context, exposure: { total_exposure: true } },
      }),
    ).toThrow(/CEDAR_REQUEST_REJECTED/);
    // A record where the schema declares a string.
    expect(() =>
      evaluateWithCedar(artifacts, {
        ...full,
        context: { ...full.context, reason_code: { value: 'ITEM_RETURNED' } },
      }),
    ).toThrow(/CEDAR_REQUEST_REJECTED/);
    // A number where the schema declares a decimal — Cedar has no float, and it says so.
    expect(() =>
      evaluateWithCedar(artifacts, {
        ...full,
        context: { ...full.context, exposure: { total_exposure: 26.03 as unknown as string } },
      }),
    ).toThrow(/CEDAR_REQUEST_REJECTED/);
  });

  it('FINDING — Cedar accepts a bare string as an extension value, and it parses IDENTICALLY', () => {
    // Recorded because it surprised the author, and an undocumented accepted form on the cap
    // operand is exactly the sort of thing a later reader must not rediscover as a surprise.
    //
    // `{"total_exposure": "26.03"}` is accepted where `{"__extn":{"fn":"decimal",...}}` was
    // written: Cedar's JSON entity/context format admits the implicit extension constructor
    // for an attribute the schema types as `decimal`. It is a PARSE of the same value, not a
    // coercion to a different one, and the two forms produce byte-identical decisions —
    // which is what this asserts rather than assumes.
    //
    // It is not an authority channel. `cedarRequest.ts` always emits the explicit form, no
    // caller supplies a context, and a string that is not a valid decimal is REJECTED (the
    // test above). The only way to reach the implicit form is to bypass the builder, which
    // requires already being inside the control plane.
    const effect = canonicalEffectAt({ vendorAmount: '25.00', retainedFee: '1.03' });
    const explicit = buildCedarRequest(effect);
    const implicit: CedarRequest = {
      ...explicit,
      context: { ...explicit.context, exposure: { total_exposure: '26.03' } },
    };
    expect(evaluateWithCedar(artifacts, implicit)).toEqual(evaluateWithCedar(artifacts, explicit));
    expect(evaluateWithCedar(artifacts, implicit).decision).toBe('deny');
  });

  it('a malformed decimal is rejected, not repaired', () => {
    const effect = canonicalEffectAt({ vendorAmount: '10.00', retainedFee: '1.03' });
    const full = buildCedarRequest(effect);
    const bad: CedarRequest = {
      ...full,
      context: {
        ...full.context,
        exposure: { total_exposure: { __extn: { fn: 'decimal', arg: 'twenty-six' } } },
      },
    };
    expect(() => evaluateWithCedar(artifacts, bad)).toThrow(/CEDAR_REQUEST_REJECTED/);
  });
});

describe('CEDAR EVALUATION ERROR', () => {
  it('a policy that errors at evaluation is a DEFECT, on DENY as well as on ALLOW', () => {
    // A policy reading an optional attribute without a `has` guard errors at runtime. Cedar
    // then reports a decision AND an error, and a decision taken over an errored policy set
    // is not a decision.
    const errored = stagedArtifacts(
      replacingPolicy(
        'acos.refund.create.grant',
        `permit(principal in Acos::Role::"support_reasoner",
                action == Acos::Action::"refund.create",
                resource is Acos::Order)
         when { context.customer_novelty == "RETURNING" };\n`,
      ),
    );
    const effect = canonicalEffectAt({ vendorAmount: '10.00', retainedFee: '1.03' });
    const { canonicaliser } = makeCanonicaliser();
    const option = makeRefundOption({ amount: money('10.00') });
    const noNovelty = canonicaliser.canonicalise(
      parseProposedIntent(makeRawIntent(option)),
      { ...makeContext(), customerNovelty: null },
      option,
    );
    // With the attribute present the errored policy evaluates fine.
    expect(evaluateWithCedar(errored, buildCedarRequest(effect)).decision).toBe('allow');
    // With it absent, Cedar errors — and the engine refuses rather than reporting the deny
    // it would otherwise have returned.
    expect(() => evaluateWithCedar(errored, buildCedarRequest(noNovelty))).toThrow(
      /CEDAR_EVALUATION_ERROR/,
    );
  });

  it('a FORBID that errors is a defect too — the most dangerous case', () => {
    // If a permit errors, Cedar denies and the outcome is safe by luck. If the FORBID errors
    // the outcome could be a permit, so the error check runs before the decision is read.
    const errored = stagedArtifacts(
      replacingPolicy(
        'acos.refund.create.per_action_max',
        `forbid(principal, action == Acos::Action::"refund.create", resource)
         unless { context.customer_novelty == "NOBODY" };\n`,
      ),
    );
    const { canonicaliser } = makeCanonicaliser();
    const option = makeRefundOption({ amount: money('10.00') });
    const noNovelty = canonicaliser.canonicalise(
      parseProposedIntent(makeRawIntent(option)),
      { ...makeContext(), customerNovelty: null },
      option,
    );
    expect(() => evaluateWithCedar(errored, buildCedarRequest(noNovelty))).toThrow(
      /CEDAR_EVALUATION_ERROR/,
    );
  });

  it('a deployed forbid with NO registered denial terminal is a defect, not a category guess', () => {
    const unmapped = stagedArtifacts(
      replacingPolicy(
        'acos.refund.create.grant',
        `forbid(principal, action == Acos::Action::"refund.create", resource);\n`,
      ),
    );
    const effect = canonicalEffectAt({ vendorAmount: '10.00', retainedFee: '1.03' });
    expect(() => new PolicyEngine(unmapped).evaluate(effect)).toThrow(
      /no registered denial terminal: acos\.refund\.create\.grant/,
    );
  });
});

describe('CURRENCY — canonicalisation rejects first, and Cedar never repairs', () => {
  it('a currency-mismatched effect cannot exist, so it never reaches policy', () => {
    // `refundCreate.ts` throws on a fee whose currency differs from the ledger currency,
    // BEFORE emitting an exposure. `26 §11.2`'s exclusion table puts cross-currency monetary
    // classes outside the MVP catalogue.
    const { canonicaliser } = makeCanonicaliser();
    const option = makeRefundOption({ amount: money('10.00'), currency: 'USD' });
    const context = makeContext({
      retainedProcessingFee: { amount: money('1.03'), sourceRef: 'record:x', currency: 'EUR' },
    });
    expect(() =>
      canonicaliser.canonicalise(parseProposedIntent(makeRawIntent(option)), context, option),
    ).toThrow(/retained fee is in EUR/);
  });

  it('and an option denominated in another currency is refused before construction', () => {
    const { canonicaliser } = makeCanonicaliser();
    const option = makeRefundOption({ amount: money('10.00'), currency: 'EUR' });
    expect(() =>
      canonicaliser.canonicalise(
        parseProposedIntent(makeRawIntent(option)),
        makeContext(),
        option,
      ),
    ).toThrow(/denominated in EUR/);
  });

  it('`src/kernel/policy/` performs no currency conversion, normalisation or repair', () => {
    const files = ['cedarRequest.ts', 'cedarEngine.ts', 'policyEngine.ts'];
    for (const name of files) {
      const code = readSource(join('src', 'kernel', 'policy', name));
      for (const needle of ['convert', 'normalise', 'normalize', 'round', 'fxRate']) {
        expect(code, `${name} carries ${needle}`).not.toContain(needle);
      }
    }
  });
});

function readSource(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}
