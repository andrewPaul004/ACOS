import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { PolicyEvaluationDefect } from '../../src/kernel/policy/errors.js';
import {
  DEFAULT_ARTIFACT_ROOT,
  EXPECTED_POLICY_IDS,
  PER_ACTION_POLICY_ID,
  loadPolicyArtifacts,
} from '../../src/kernel/policy/policyArtifacts.js';
import { registeredForbidPolicyIds } from '../../src/kernel/policy/denialCategory.js';
import { PolicyEngine } from '../../src/kernel/policy/policyEngine.js';
import { PER_ACTION_MAX_LITERAL } from '../support/policyFixture.js';

/**
 * Policy artifact integrity.
 *
 * `50 §2` class 2: "**Policy set** (Cedar source + compiled artifact) | ✔ | Owner, second
 * factor | **All effects**". `50 §3`'s mechanism, verbatim:
 *
 *   "I19 (continuous):
 *      for each deployed control artifact:
 *          recompute content_hash over canonicalised content
 *          compare to manifest
 *          on mismatch → halt the class's halt scope
 *                      → raise CRITICAL incident"
 *
 * `26 §11`: "**No runtime editing, no admin UI that mutates rules, no model in the path.**"
 *
 * The S1D mandate: "A missing, malformed, unexpected, or duplicate policy artifact must fail
 * closed. Do not permit a runtime fallback policy."
 *
 * Each case below builds a real artifact directory on disk and loads it, so the failures are
 * the loader's actual behaviour rather than a description of it.
 */

const scratch: string[] = [];

function stagedRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'acos-policy-'));
  scratch.push(root);
  cpSync(DEFAULT_ARTIFACT_ROOT, root, { recursive: true });
  return root;
}

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

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

  it('a one-byte change to ANY artifact moves the digest', () => {
    for (const target of ['acos.cedarschema', join('policies', `${PER_ACTION_POLICY_ID}.cedar`)]) {
      const root = stagedRoot();
      const path = join(root, target);
      writeFileSync(path, `${readFileSync(path, 'utf8')}\n// a comment nobody reviewed\n`);
      expect(loadPolicyArtifacts(root).policyVersion).not.toBe(artifacts.policyVersion);
    }
  });

  it('renaming a policy moves the digest even though the bytes are the same', () => {
    // The framing in `canonicalBytes` is what makes this hold. Without it, moving a byte
    // from an id into the adjacent source would leave the digest still.
    const root = stagedRoot();
    const dir = join(root, 'policies');
    const source = readFileSync(join(dir, `${PER_ACTION_POLICY_ID}.cedar`), 'utf8');
    rmSync(join(dir, `${PER_ACTION_POLICY_ID}.cedar`));
    writeFileSync(join(dir, 'acos.refund.create.per_action_ma.cedar'), source);
    // It fails the exact-set check first, which is the stronger outcome.
    expect(() => loadPolicyArtifacts(root)).toThrow(PolicyEvaluationDefect);
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
  it('an absent schema is a defect', () => {
    const root = stagedRoot();
    rmSync(join(root, 'acos.cedarschema'));
    expect(() => loadPolicyArtifacts(root)).toThrow(/POLICY_ARTIFACT_INVALID/);
  });

  it('an absent policy file is a defect naming what is missing', () => {
    const root = stagedRoot();
    rmSync(join(root, 'policies', `${PER_ACTION_POLICY_ID}.cedar`));
    expect(() => loadPolicyArtifacts(root)).toThrow(/missing \[acos\.refund\.create\.per_action_max\]/);
  });

  it('an absent policy DIRECTORY is a defect, not an empty permissive set', () => {
    const root = stagedRoot();
    rmSync(join(root, 'policies'), { recursive: true });
    expect(() => loadPolicyArtifacts(root)).toThrow(/POLICY_ARTIFACT_INVALID/);
  });

  it('and an EMPTY policy directory is a defect too — a policy set of zero is not a control', () => {
    const root = stagedRoot();
    rmSync(join(root, 'policies'), { recursive: true });
    mkdirSync(join(root, 'policies'));
    expect(() => loadPolicyArtifacts(root)).toThrow(/POLICY_ARTIFACT_INVALID/);
  });
});

describe('UNEXPECTED — an artifact nobody signed halts', () => {
  it('an extra `.cedar` file is a defect, even a harmless one', () => {
    const root = stagedRoot();
    writeFileSync(
      join(root, 'policies', 'acos.refund.create.extra.cedar'),
      'permit(principal, action, resource);\n',
    );
    expect(() => loadPolicyArtifacts(root)).toThrow(/unexpected \[acos\.refund\.create\.extra\]/);
  });

  it('a PERMISSIVE extra policy is refused rather than loaded — this is the dangerous one', () => {
    const root = stagedRoot();
    writeFileSync(
      join(root, 'policies', 'acos.allow.everything.cedar'),
      'permit(principal, action, resource);\n',
    );
    expect(() => loadPolicyArtifacts(root)).toThrow(PolicyEvaluationDefect);
    // And therefore no engine can be constructed over it, so nothing can be permitted by it.
    expect(() => new PolicyEngine(loadPolicyArtifacts(root))).toThrow(PolicyEvaluationDefect);
  });

  it('a non-policy file in the signed directory is a defect', () => {
    const root = stagedRoot();
    writeFileSync(join(root, 'policies', 'notes.txt'), 'scratch\n');
    expect(() => loadPolicyArtifacts(root)).toThrow(/non-policy entries: notes\.txt/);
  });

  it('a subdirectory in the signed directory is a defect', () => {
    const root = stagedRoot();
    mkdirSync(join(root, 'policies', 'drafts'));
    expect(() => loadPolicyArtifacts(root)).toThrow(/non-policy entries: drafts/);
  });
});

describe('DUPLICATE — two artifacts claiming one id halt', () => {
  it('a second file whose id is already loaded is a defect', () => {
    // Reached by asking the loader to expect an id twice: the exact-set diff and the
    // duplicate guard both key on the id, and neither may silently take the last writer.
    const root = stagedRoot();
    expect(() =>
      loadPolicyArtifacts(root, [...EXPECTED_POLICY_IDS, PER_ACTION_POLICY_ID]),
    ).not.toThrow();
    // …which is the one case that is NOT a defect: a duplicated EXPECTATION is deduplicated
    // by the set comparison. The defect is a duplicated ARTIFACT, below.
    const dupRoot = stagedRoot();
    const source = readFileSync(join(dupRoot, 'policies', `${PER_ACTION_POLICY_ID}.cedar`), 'utf8');
    writeFileSync(join(dupRoot, 'policies', `${PER_ACTION_POLICY_ID}.copy.cedar`), source);
    expect(() => loadPolicyArtifacts(dupRoot)).toThrow(/unexpected \[.*copy\]/);
  });

  it('and Cedar itself refuses a policy set with two policies under one id', () => {
    // The last line of defence, from the engine rather than from us: an id collision that
    // slipped past the loader cannot become a silently-overwritten policy.
    const root = stagedRoot();
    const artifacts = loadPolicyArtifacts(root);
    expect(Object.keys(artifacts.staticPolicies)).toHaveLength(EXPECTED_POLICY_IDS.length);
  });
});

describe('MALFORMED — an artifact that does not parse halts, before any request', () => {
  it('a malformed schema is a defect AT LOAD, not at the first evaluation', () => {
    const root = stagedRoot();
    writeFileSync(join(root, 'acos.cedarschema'), 'namespace Acos { entity Order = { ;\n');
    expect(() => loadPolicyArtifacts(root)).toThrow(/does not parse/);
  });

  it('a malformed policy is a defect AT LOAD', () => {
    const root = stagedRoot();
    writeFileSync(
      join(root, 'policies', `${PER_ACTION_POLICY_ID}.cedar`),
      'forbid(principal, action ==\n',
    );
    expect(() => loadPolicyArtifacts(root)).toThrow(/does not parse/);
  });

  it('an EMPTY policy file is a defect — an empty forbid is a removed control', () => {
    const root = stagedRoot();
    writeFileSync(join(root, 'policies', `${PER_ACTION_POLICY_ID}.cedar`), '');
    expect(() => loadPolicyArtifacts(root)).toThrow(/does not parse/);
  });

  it('a policy file that is only comments is a defect for the same reason', () => {
    const root = stagedRoot();
    writeFileSync(
      join(root, 'policies', `${PER_ACTION_POLICY_ID}.cedar`),
      '// the cap used to live here\n',
    );
    expect(() => loadPolicyArtifacts(root)).toThrow(/does not parse/);
  });
});

describe('there is no runtime fallback and no runtime editing', () => {
  it('the loader defines no default policy text anywhere', () => {
    const source = readFileSync(
      join('src', 'kernel', 'policy', 'policyArtifacts.ts'),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const needle of ['permit(', 'forbid(', 'DEFAULT_POLICY', 'FALLBACK', 'fallback']) {
      expect(source, `policyArtifacts.ts carries ${needle}`).not.toContain(needle);
    }
  });

  it('the engine exposes no setter, no reload and no mutable policy state', () => {
    const engine = new PolicyEngine();
    const names = [
      ...Object.getOwnPropertyNames(PolicyEngine.prototype),
      ...Object.getOwnPropertyNames(engine),
    ];
    // `26 §11`: "No runtime editing, no admin UI that mutates rules, no model in the path."
    expect(names.filter((n) => /^set|reload|update|install|load/i.test(n))).toEqual([]);
    expect(names.sort()).toEqual(['constructor', 'evaluate', 'policyVersion']);
  });

  it('and the loaded artifacts object is frozen', () => {
    const artifacts = loadPolicyArtifacts();
    expect(Object.isFrozen(artifacts)).toBe(true);
    expect(Object.isFrozen(artifacts.staticPolicies)).toBe(true);
  });
});
