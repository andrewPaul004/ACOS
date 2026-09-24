import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ControlArtifactIntegrityFailure } from '../../src/kernel/controlArtifacts/errors.js';
import { PolicyEvaluationDefect } from '../../src/kernel/policy/errors.js';
import {
  EXPECTED_POLICY_IDS,
  PER_ACTION_POLICY_ID,
  loadPolicyArtifacts,
} from '../../src/kernel/policy/policyArtifacts.js';
import { registeredForbidPolicyIds } from '../../src/kernel/policy/denialCategory.js';
import { PolicyEngine } from '../../src/kernel/policy/policyEngine.js';
import {
  ACCEPTED_POLICY_VERSION,
  stagedPolicyBundle,
  type Class2BundleDocument,
} from '../support/controlArtifactFixture.js';
import { PER_ACTION_MAX_LITERAL } from '../support/policyFixture.js';

/**
 * Policy artifact integrity — v1.3.6, against the SIGNED CLASS-2 BUNDLE.
 *
 * =================================================================================
 * WHAT CHANGED, AND WHY THE CASES MOVED WITH IT
 *
 * `50 §2e` (v1.3.6) gives class 2 a concrete artifact: "the `acos.control.policy_set`
 * **bundle**: the Cedar schema file and every `.cedar` policy source file, in one immutable
 * byte object", whose `content_hash` is `SHA-256` over its exact bytes. And its O4 rule:
 *
 *   "**A Cedar policy bundle is admitted to the engine only after the verified manifest, its
 *    `content_hash`, its primary signature and its second-factor signature have all been
 *    checked.** A bundle presented with a matching hash and no valid signature pair is
 *    **REFUSED**."
 *
 * S1D's version of this file staged a DIRECTORY on disk and loaded it. That is no longer a
 * thing a deployment can do, so it is no longer the right model for these cases: every
 * staged set below is an EDITED, RE-SIGNED bundle that passes `50 §3f`'s full ceremony, and
 * what is under test is the loader's behaviour over a set the owner actually signed.
 *
 * SOME CASES THEREFORE MOVE LAYER, and that is the point rather than a loss:
 *
 *   an absent schema            was a missing FILE; is now a malformed ARTIFACT, refused by
 *                               the class-2 parser during verification
 *   an empty policy set         was an empty DIRECTORY; is now an artifact the parser refuses
 *   a non-policy file           was a stray file in a signed directory; the bundle has no
 *                               directory, and the equivalent — an unknown field in the
 *                               signed document — is refused by the parser
 *   a duplicate policy id       was two files; is now two entries, which the parser refuses
 *                               because `50 §2e`'s bundle carries them in strict id order
 *
 * `26 §11` is unchanged and still governs: "**No runtime editing, no admin UI that mutates
 * rules, no model in the path.**"
 * =================================================================================
 */

function withPolicies(
  edit: (policies: { id: string; source: string }[]) => { id: string; source: string }[],
): (document: Class2BundleDocument) => Class2BundleDocument {
  return (document) => ({ ...document, policies: edit(document.policies) });
}

function replacing(id: string, source: string) {
  return withPolicies((policies) =>
    policies.map((policy) => (policy.id === id ? { id, source } : policy)),
  );
}

describe('the deployed artifact set loads, and is what the code expects', () => {
  const artifacts = loadPolicyArtifacts();

  it('the policy set is EXACTLY the expected ids', () => {
    expect(Object.keys(artifacts.staticPolicies)).toEqual([...EXPECTED_POLICY_IDS]);
  });

  it('`26 §11`’s policy_version is a content hash over the schema and the whole set', () => {
    expect(artifacts.policyVersion).toMatch(/^[0-9a-f]{64}$/);
    // Deterministic across loads: the digest is a property of the bytes, not of the load.
    expect(loadPolicyArtifacts().policyVersion).toBe(artifacts.policyVersion);
  });

  it('and it is still `50 §2e`’s ACCEPTED CURRENT value — the bundle moved, the bytes did not', () => {
    // `50 §2e`: "its accepted current value is `47c2849b…c30ff6`, and it remains the accepted
    // current digest unless the actual policy bytes change." Moving the schema and the policy
    // sources into a signed byte object is not a change to the policy bytes, and this is the
    // regression that says so.
    expect(artifacts.policyVersion).toBe(ACCEPTED_POLICY_VERSION);
  });

  it('`policy_version` is NOT the class-2 content hash, and the loader carries both facts', () => {
    // `50 §2e`: "**`policy_version` is NOT the class-2 content hash, and neither replaces the
    // other.** [...] Both are content-derived, both are required, and the manifest entry
    // carries the second."
    expect(artifacts.manifestId).toMatch(/^[0-9a-f]{64}$/);
    expect(artifacts.manifestId).not.toBe(artifacts.policyVersion);
  });

  it('a one-byte change to ANY artifact moves the digest', () => {
    const schemaEdited = loadPolicyArtifacts(
      stagedPolicyBundle((document) => ({
        ...document,
        schema: `${document.schema}\n// a comment nobody reviewed\n`,
      })),
    );
    expect(schemaEdited.policyVersion).not.toBe(artifacts.policyVersion);

    const policyEdited = loadPolicyArtifacts(
      stagedPolicyBundle(
        withPolicies((policies) =>
          policies.map((policy) =>
            policy.id === PER_ACTION_POLICY_ID
              ? { ...policy, source: `${policy.source}\n// a comment nobody reviewed\n` }
              : policy,
          ),
        ),
      ),
    );
    expect(policyEdited.policyVersion).not.toBe(artifacts.policyVersion);
  });

  it('renaming a policy moves the digest even though the bytes are the same', () => {
    // The framing in `canonicalBytes` is what makes this hold. Without it, moving a byte
    // from an id into the adjacent source would leave the digest still. It fails the
    // exact-set check first, which is the stronger outcome.
    expect(() =>
      loadPolicyArtifacts(
        stagedPolicyBundle(
          withPolicies((policies) =>
            policies.map((policy) =>
              policy.id === PER_ACTION_POLICY_ID
                ? { ...policy, id: 'acos.refund.create.per_action_ma' }
                : policy,
            ),
          ),
        ),
      ),
    ).toThrow(PolicyEvaluationDefect);
  });

  it('every registered denial terminal names a policy that is actually deployed', () => {
    // A category registered for an id nobody deploys is a terminal that can never fire; a
    // deployed forbid with no registered terminal is a denial nobody can categorise. The
    // second is caught at runtime by `policyEngine.ts`; this catches the first at build.
    for (const id of registeredForbidPolicyIds()) {
      expect(Object.keys(artifacts.staticPolicies)).toContain(id);
    }
  });

  it('the `<= 25.00` term appears in BOTH policies, at the same `51 §3.1` figure', () => {
    // The duplication is deliberate (`26 §8`'s permit conjunct, plus `26 §11` P1's forbid).
    // Deliberate duplication needs a tripwire, or the two drift.
    const occurrences = Object.values(artifacts.staticPolicies).filter((source) =>
      source.includes(`decimal("${PER_ACTION_MAX_LITERAL}")`),
    );
    expect(occurrences).toHaveLength(2);
    // And no OTHER decimal literal is used as a cap anywhere in the set.
    const literals = Object.values(artifacts.staticPolicies)
      .flatMap((source) => [...source.matchAll(/decimal\("([^"]+)"\)/g)].map((m) => m[1]!))
      .sort();
    expect([...new Set(literals)]).toEqual([PER_ACTION_MAX_LITERAL]);
  });
});

describe('MISSING — an absent artifact halts, it does not fall back', () => {
  it('a bundle with no schema is refused DURING VERIFICATION, before any loader runs', () => {
    // `50 §2e` closes class 2's content. A bundle missing a declared field is an artifact the
    // parser refuses, so the failure is a control-artifact integrity failure and the Cedar
    // loader is never reached.
    expect(() =>
      stagedPolicyBundle((document) => {
        const { schema: _schema, ...rest } = document;
        return rest as Class2BundleDocument;
      }),
    ).toThrow(ControlArtifactIntegrityFailure);
  });

  it('an absent policy is a defect naming what is missing', () => {
    expect(() =>
      loadPolicyArtifacts(
        stagedPolicyBundle(
          withPolicies((policies) => policies.filter((p) => p.id !== PER_ACTION_POLICY_ID)),
        ),
      ),
    ).toThrow(/missing \[acos\.refund\.create\.per_action_max\]/);
  });

  it('an EMPTY policy set is refused at verification — a policy set of zero is not a control', () => {
    expect(() => stagedPolicyBundle(withPolicies(() => []))).toThrow(
      ControlArtifactIntegrityFailure,
    );
  });
});

describe('UNEXPECTED — an artifact nobody signed halts', () => {
  it('an extra policy is a defect, even a harmless one', () => {
    expect(() =>
      loadPolicyArtifacts(
        stagedPolicyBundle(
          withPolicies((policies) =>
            [
              ...policies,
              { id: 'acos.refund.create.extra', source: 'permit(principal, action, resource);\n' },
            ].sort((a, b) => (a.id < b.id ? -1 : 1)),
          ),
        ),
      ),
    ).toThrow(/unexpected \[acos\.refund\.create\.extra\]/);
  });

  it('a PERMISSIVE extra policy is refused rather than loaded — this is the dangerous one', () => {
    const bundle = stagedPolicyBundle(
      withPolicies((policies) =>
        [
          ...policies,
          { id: 'acos.allow.everything', source: 'permit(principal, action, resource);\n' },
        ].sort((a, b) => (a.id < b.id ? -1 : 1)),
      ),
    );
    expect(() => loadPolicyArtifacts(bundle)).toThrow(PolicyEvaluationDefect);
    // And therefore no engine can be constructed over it, so nothing can be permitted by it.
    expect(() => new PolicyEngine(loadPolicyArtifacts(bundle))).toThrow(PolicyEvaluationDefect);
  });

  it('an unknown field in the signed bundle is refused at verification', () => {
    // The bundle's replacement for "a stray file in the signed directory". `50 §2e` closes
    // the content, and a field outside the boundary is either an accident that changes
    // nothing or an artifact nobody reviewed — and the parser cannot tell which.
    expect(() =>
      stagedPolicyBundle((document) => ({ ...document, notes: 'scratch' })),
    ).toThrow(ControlArtifactIntegrityFailure);
  });
});

describe('DUPLICATE — two artifacts claiming one id halt', () => {
  it('a duplicated EXPECTATION is deduplicated, and a duplicated ARTIFACT is refused', () => {
    // The expectation list is a structural statement, so naming an id twice changes nothing.
    expect(() =>
      loadPolicyArtifacts(undefined, [...EXPECTED_POLICY_IDS, PER_ACTION_POLICY_ID]),
    ).not.toThrow();

    // A duplicated ARTIFACT is a different matter: `50 §2e`'s bundle carries its policies in
    // strict ascending id order, so a second entry under one id is not representable and the
    // parser refuses it rather than silently taking the last writer.
    expect(() =>
      stagedPolicyBundle(
        withPolicies((policies) => {
          const target = policies.find((p) => p.id === PER_ACTION_POLICY_ID)!;
          return [...policies, { ...target }].sort((a, b) => (a.id < b.id ? -1 : 1));
        }),
      ),
    ).toThrow(ControlArtifactIntegrityFailure);
  });

  it('and the loaded set carries exactly as many policies as the expectation names', () => {
    const artifacts = loadPolicyArtifacts();
    expect(Object.keys(artifacts.staticPolicies)).toHaveLength(EXPECTED_POLICY_IDS.length);
  });
});

describe('MALFORMED — an artifact that does not parse halts, before any request', () => {
  it('a malformed schema is a defect AT LOAD, not at the first evaluation', () => {
    expect(() =>
      loadPolicyArtifacts(
        stagedPolicyBundle((document) => ({
          ...document,
          schema: 'namespace Acos { entity Order = { ;\n',
        })),
      ),
    ).toThrow(/does not parse/);
  });

  it('a malformed policy is a defect AT LOAD', () => {
    expect(() =>
      loadPolicyArtifacts(
        stagedPolicyBundle(replacing(PER_ACTION_POLICY_ID, 'forbid(principal, action ==\n')),
      ),
    ).toThrow(/does not parse/);
  });

  it('an EMPTY policy source is a defect — an empty forbid is a removed control', () => {
    expect(() =>
      loadPolicyArtifacts(stagedPolicyBundle(replacing(PER_ACTION_POLICY_ID, ''))),
    ).toThrow(/does not parse/);
  });

  it('a policy source that is only comments is a defect for the same reason', () => {
    expect(() =>
      loadPolicyArtifacts(
        stagedPolicyBundle(replacing(PER_ACTION_POLICY_ID, '// the cap used to live here\n')),
      ),
    ).toThrow(/does not parse/);
  });
});

describe('there is no runtime fallback, no runtime editing, and no second Cedar path', () => {
  const source = readFileSync(join('src', 'kernel', 'policy', 'policyArtifacts.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('the loader defines no default policy text anywhere', () => {
    for (const needle of ['permit(', 'forbid(', 'DEFAULT_POLICY', 'FALLBACK', 'fallback']) {
      expect(source, `policyArtifacts.ts carries ${needle}`).not.toContain(needle);
    }
  });

  it('and it can no longer read policy bytes from anywhere but the verified bundle', () => {
    // `§25` of the S1K mandate: "Do not load unsigned policy and compare digest afterward.
    // Verification must precede admission." A loader with no filesystem cannot express the
    // forbidden arrangement.
    for (const needle of ['node:fs', 'readFileSync', 'readdirSync', 'artifactRoot']) {
      expect(source, `policyArtifacts.ts carries ${needle}`).not.toContain(needle);
    }
  });
});
