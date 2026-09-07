import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import * as cedar from '@cedar-policy/cedar-wasm/nodejs';
import { describe, expect, it } from 'vitest';

import {
  PINNED_CEDAR_VERSION,
  evaluateWithCedar,
  linkedCedarVersion,
} from '../../src/kernel/policy/cedarEngine.js';
import { loadPolicyArtifacts } from '../../src/kernel/policy/policyArtifacts.js';
import { buildCedarRequest } from '../../src/kernel/policy/cedarRequest.js';
import { canonicalEffectAt } from '../support/policyFixture.js';

/**
 * "Is a REAL Cedar engine evaluating the production decision, or is Cedar merely represented
 * by test/mocking glue?"
 *
 * The S1D mandate answers that question by forbidding four things: a home-grown policy
 * language, a boolean-returning function, a mocked Cedar, and `cedar-policy-symcc`. This
 * file asserts each of the four rather than declaring them.
 *
 * ADR-005, verbatim: "**Cedar (Apache-2.0) linked in-process**". `32 §…`: "Cedar is linked
 * in-process as a library".
 */

describe('the engine is real Cedar, at the version the architecture names', () => {
  it('the linked runtime reports a Cedar version, and it is the pinned one', () => {
    // Not a package name and not a mock: `getCedarVersion` is compiled into the Cedar WASM
    // module itself, so a stub would have to reimplement the engine to answer it.
    expect(linkedCedarVersion()).toBe(PINNED_CEDAR_VERSION);
  });

  it('and that version is on the minor line `31 §…` names — Cedar v4.11.0', () => {
    // `31-technology-options.md`: "| **Cedar** | **Apache-2.0**, v4.11.0 (2026-05-18),
    // OpenSSF badge | ... | **PRIMARY** |". The binding is pinned to 4.11.2, the patch head
    // of that minor line.
    expect(linkedCedarVersion().startsWith('4.11.')).toBe(true);
  });

  it('it reports a Cedar policy-language version too', () => {
    expect(cedar.getCedarLangVersion()).toMatch(/^\d+\.\d+$/);
  });

  it('the dependency is pinned exactly, not by range', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
      dependencies: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    // A range would let a control artifact's evaluator change under a lockfile refresh, and
    // `26 §11`'s reproducibility claim — "same inputs, same policy_version, same
    // constructor_version, same verdict, forever" — quietly stops holding.
    expect(pkg.dependencies['@cedar-policy/cedar-wasm']).toBe(PINNED_CEDAR_VERSION);
  });

  it('Cedar is a PRODUCTION dependency, not a devDependency', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
      dependencies: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies)).toContain('@cedar-policy/cedar-wasm');
    expect(Object.keys(pkg.devDependencies ?? {})).not.toContain('@cedar-policy/cedar-wasm');
  });

  it('`cedar-policy-symcc` is NOT installed — DP3 and `45 §3` defer the gate past S1', () => {
    // `22` DP3, verbatim: "**v1.1: symcc is deferred as an S1 gate** per `45 §3` [...] The
    // deferral is recorded as an **amendment to `11 E6` under `28 §9.2`**".
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
      dependencies: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const all = { ...pkg.dependencies, ...(pkg.devDependencies ?? {}) };
    expect(Object.keys(all).some((name) => name.includes('symcc'))).toBe(false);
  });
});

describe('the decision path actually runs Cedar — not a branch that could bypass it', () => {
  const artifacts = loadPolicyArtifacts();

  it('the policy set is real Cedar source that the real parser accepts', () => {
    // If this were a mock, `checkParsePolicySet` would be a mock too. It is not: it is the
    // Cedar parser, and it rejects the policy text below.
    expect(cedar.checkParsePolicySet({ staticPolicies: artifacts.staticPolicies }).type).toBe(
      'success',
    );
    expect(
      cedar.checkParsePolicySet({ staticPolicies: { broken: 'permit(principal' } }).type,
    ).toBe('failure');
  });

  it('the schema is real Cedar schema source', () => {
    expect(cedar.checkParseSchema(artifacts.schema).type).toBe('success');
    expect(cedar.checkParseSchema('namespace { entity').type).toBe('failure');
  });

  it('the production request reaches Cedar and Cedar answers with a determining policy id', () => {
    const effect = canonicalEffectAt({ vendorAmount: '10.00', retainedFee: '1.03' });
    const evaluation = evaluateWithCedar(artifacts, buildCedarRequest(effect));
    // The id comes out of Cedar's own diagnostics keyed by the filename we loaded. A
    // hand-rolled evaluator would have had to invent this plumbing.
    expect(evaluation.determiningPolicies).toEqual(['acos.refund.create.grant']);
  });

  it('and Cedar’s own forbid-overrides-permit semantics are what produce the denial', () => {
    // The grant's `<= 25.00` conjunct ALSO fails at $26.03. If the engine were a hand-rolled
    // conjunction evaluator there would be no way to tell which clause denied. Cedar's
    // semantics are what make the `forbid` determining, and that is observable.
    const effect = canonicalEffectAt({ vendorAmount: '25.00', retainedFee: '1.03' });
    const evaluation = evaluateWithCedar(artifacts, buildCedarRequest(effect));
    expect(evaluation.decision).toBe('deny');
    expect(evaluation.determiningPolicies).toEqual(['acos.refund.create.per_action_max']);

    // And with the forbid removed, the SAME request denies with NO determining policy —
    // Cedar reporting "nothing permitted" rather than "something forbade". Two different
    // Cedar outcomes over the same operands, which only a real evaluator produces.
    const grantOnly = {
      ...artifacts,
      staticPolicies: {
        'acos.refund.create.grant': artifacts.staticPolicies['acos.refund.create.grant']!,
      },
    };
    const withoutForbid = evaluateWithCedar(grantOnly, buildCedarRequest(effect));
    expect(withoutForbid.decision).toBe('deny');
    expect(withoutForbid.determiningPolicies).toEqual([]);
  });
});

describe('no home-grown policy language, and no boolean-returning stand-in', () => {
  const policySource = sourceFiles(join('src', 'kernel', 'policy'));

  it('there is no policy parser, matcher, interpreter or evaluator in the tree', () => {
    for (const file of policySource) {
      const code = strip(readFileSync(file, 'utf8'));
      for (const needle of [
        'parsePolicy',
        'evaluatePolicy',
        'matchPolicy',
        'policyMatches',
        'interpretPolicy',
        'PolicyLanguage',
        'evaluateRule',
      ]) {
        expect(code, `${file} carries ${needle}`).not.toContain(needle);
      }
    }
  });

  it('exactly ONE module reaches the Cedar binding, and it is `cedarEngine.ts`', () => {
    // Two call sites would be two places a bypass could be introduced. `policyArtifacts.ts`
    // uses the binding only for parse checking, which is why it is named as the second
    // permitted importer rather than left as an unexplained exception.
    const importers = policySource.filter((file) =>
      strip(readFileSync(file, 'utf8')).includes('@cedar-policy/cedar-wasm'),
    );
    expect(importers.map((f) => f.replace(/\\/g, '/')).sort()).toEqual([
      'src/kernel/policy/cedarEngine.ts',
      'src/kernel/policy/policyArtifacts.ts',
    ]);
  });

  it('and only `cedarEngine.ts` calls `isAuthorized`', () => {
    const callers = policySource.filter((file) =>
      strip(readFileSync(file, 'utf8')).includes('isAuthorized'),
    );
    expect(callers.map((f) => f.replace(/\\/g, '/'))).toEqual(['src/kernel/policy/cedarEngine.ts']);
  });

  it('the per-action limit appears in the POLICY ARTIFACT and nowhere in the code', () => {
    // A limit duplicated into TypeScript is a limit that can drift from the policy without a
    // control-artifact change. `51 §3.1`'s figure lives in the `.cedar` text only.
    for (const file of policySource) {
      const code = strip(readFileSync(file, 'utf8'));
      expect(code, `${file} carries the per-action limit as a code constant`).not.toMatch(
        /25\.00|2500n/,
      );
    }
    const forbid = readFileSync(
      join('src', 'kernel', 'policy', 'artifacts', 'policies', 'acos.refund.create.per_action_max.cedar'),
      'utf8',
    );
    expect(strip(forbid)).toContain('decimal("25.00")');
  });
});

function strip(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sourceFiles(join(dir, entry.name))
      : entry.name.endsWith('.ts')
        ? [join(dir, entry.name)]
        : [],
  );
}
