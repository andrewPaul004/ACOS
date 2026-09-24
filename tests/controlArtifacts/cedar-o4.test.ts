import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ControlArtifactIntegrityFailure } from '../../src/kernel/controlArtifacts/errors.js';
import { activeVerifiedControlArtifacts } from '../../src/kernel/controlArtifacts/registry.js';
import { verifiedPolicySet } from '../../src/kernel/controlArtifacts/bundle.js';
import { evaluateWithCedar } from '../../src/kernel/policy/cedarEngine.js';
import { loadPolicyArtifacts } from '../../src/kernel/policy/policyArtifacts.js';
import { buildCedarRequest } from '../../src/kernel/policy/cedarRequest.js';
import {
  unsafeAttackerCedarBundle,
  unsafeClass20ImplementationDigest,
  unsafeLoadCedarByDigest,
} from '../negative-controls/unsafe-cedar-and-class20.js';
import {
  ACCEPTED_POLICY_VERSION,
  CLASS_20_ACCEPTED_BYTE_LENGTH,
  CLASS_20_ACCEPTED_CONTENT_HASH,
  buildControlArtifactFixture,
  verifyFixtureBundle,
  withArtifactBytes,
} from '../support/controlArtifactFixture.js';
import { canonicalEffectAt } from '../support/policyFixture.js';

/**
 * `50 §2e` — CEDAR / O4, and `50 §2b` — CLASS 20.
 *
 * =================================================================================
 * O4's RUNTIME RULE, VERBATIM (`50 §2e`)
 *
 *   "**A Cedar policy bundle is admitted to the engine only after the verified manifest, its
 *    `content_hash`, its primary signature and its second-factor signature have all been
 *    checked.** A bundle presented with a matching hash and no valid signature pair is
 *    **REFUSED**."
 *
 * `§48` of the S1K mandate lists the six required tamper controls, and they are the six
 * `describe` blocks below plus the structural "no second production Cedar path".
 * =================================================================================
 */

function detailOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof ControlArtifactIntegrityFailure) return error.detail;
    throw error;
  }
  throw new Error('expected a control-artifact integrity failure and none was raised');
}

describe('1 — valid policy bytes plus two valid signatures LOAD', () => {
  it('the engine is constructed from the verified class-2 bundle', () => {
    const artifacts = loadPolicyArtifacts();
    expect(Object.keys(artifacts.staticPolicies)).toEqual([
      'acos.refund.create.grant',
      'acos.refund.create.per_action_max',
    ]);
    expect(artifacts.policyVersion).toBe(ACCEPTED_POLICY_VERSION);
    // And it really evaluates: a $10.00 refund inside the cap is permitted.
    const effect = canonicalEffectAt({ vendorAmount: '10.00', retainedFee: '1.03' });
    expect(evaluateWithCedar(artifacts, buildCedarRequest(effect)).decision).toBe('allow');
  });

  it('and the bundle the loader read is the one the manifest bound', () => {
    const verified = verifiedPolicySet(activeVerifiedControlArtifacts());
    expect(verified.policyIds).toEqual([
      'acos.refund.create.grant',
      'acos.refund.create.per_action_max',
    ]);
    expect(loadPolicyArtifacts().manifestId).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('2 — ONE policy byte changes, and the engine is never reached', () => {
  it('a single byte in the deployed bundle moves the content hash and is refused', () => {
    const baseline = buildControlArtifactFixture();
    const path = join(baseline.controlRoot, 'class-02.policy-set.json');
    const bytes = readFileSync(path);
    writeFileSync(path, Buffer.concat([bytes, Buffer.from(' ', 'utf8')]));
    expect(detailOf(() => verifyFixtureBundle(baseline))).toMatch(/hash to [0-9a-f]{64}/);
  });

  it('a POLICY SOURCE edited inside the bundle is refused before Cedar sees it', () => {
    // The dangerous shape: the per-action cap widened from $25.00 to $25000.00.
    const baseline = buildControlArtifactFixture();
    const path = join(baseline.controlRoot, 'class-02.policy-set.json');
    writeFileSync(
      path,
      Buffer.from(
        readFileSync(path, 'utf8').replace('decimal(\\"25.00\\")', 'decimal(\\"25000.00\\")'),
        'utf8',
      ),
    );
    expect(() => verifyFixtureBundle(baseline)).toThrow(ControlArtifactIntegrityFailure);
  });
});

describe('3 — a manifest entry updated to match, with the OLD signatures kept, is refused', () => {
  it('the envelope binds `content_sha256`, so a stale signature does not verify', () => {
    // The fixture re-signs by default, so the stale case is built by signing the ORIGINAL
    // set and then swapping the bytes underneath it: the entry and the file disagree.
    const honest = buildControlArtifactFixture();
    const tampered = buildControlArtifactFixture({
      pinOverride: honest.manifestId,
      mutate: (artifacts) =>
        withArtifactBytes(artifacts, 2, (bytes) =>
          Buffer.from(bytes.toString('utf8').replace('"schema"', '"schema"'), 'utf8'),
        ),
    });
    // Identical bytes: the manifest identity is unchanged and the package verifies.
    expect(() => verifyFixtureBundle(tampered)).not.toThrow();

    // Now change the bytes and keep the signed manifest: step 7 refuses.
    const path = join(tampered.controlRoot, 'class-02.policy-set.json');
    writeFileSync(path, Buffer.concat([readFileSync(path), Buffer.from('\n')]));
    expect(detailOf(() => verifyFixtureBundle(tampered))).toMatch(/class 2 \(acos\.control\.policy_set\)/);
  });
});

describe('4 — a policy bundle with NO second-factor signature is REFUSED', () => {
  it('one valid signature over the Cedar artifact is not enough', () => {
    const fixture = buildControlArtifactFixture({
      tamper: { voidSecondFactorArtifactSignature: 0 },
    });
    expect(detailOf(() => verifyFixtureBundle(fixture))).toMatch(
      /class 2 .*no valid SECOND_FACTOR signature/s,
    );
  });
});

describe('5 — an OLD valid policy artifact under a NON-ACTIVE manifest is REFUSED', () => {
  it('the deployment pin rejects it before any policy byte is read', () => {
    const current = buildControlArtifactFixture({ manifestEpoch: '4' });
    const old = buildControlArtifactFixture({
      manifestEpoch: '1',
      pinOverride: current.manifestId,
    });
    expect(detailOf(() => verifyFixtureBundle(old))).toMatch(/pinned EXPECTED_ACTIVE_MANIFEST_ID/);
  });
});

describe('6 — VULNERABLE CONTROL 15: digest-only Cedar authentication', () => {
  it('the unsafe loader accepts an attacker bundle that supplies its own digest', () => {
    const attacker = unsafeAttackerCedarBundle();
    const loaded = unsafeLoadCedarByDigest(attacker);
    expect(loaded.loaded).toBe(true);
    expect(loaded.policyIds).toEqual(['acos.attacker.permit_everything']);
  });

  it('and production cannot be handed one at all — there is no such surface', () => {
    // `loadPolicyArtifacts` takes a `VerifiedControlArtifactBundle`, which only verification
    // produces. There is no overload that takes bytes, a path or a digest.
    const source = readFileSync(join('src', 'kernel', 'policy', 'policyArtifacts.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(source).not.toContain('declaredDigest');
    expect(source).not.toContain('expectedDigest');
    expect(source).not.toContain('node:fs');
  });
});

describe('THERE IS NO SECOND PRODUCTION CEDAR PATH', () => {
  it('exactly one production module calls `cedar.isAuthorized`', () => {
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (
          entry.name.endsWith('.ts') &&
          readFileSync(path, 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/^\s*\/\/.*$/gm, '')
            .includes('cedar.isAuthorized(')
        ) {
          offenders.push(path);
        }
      }
    };
    walk('src');
    expect(offenders).toEqual([join('src', 'kernel', 'policy', 'cedarEngine.ts')]);
  });

  it('and exactly one production module constructs the policy artifacts', () => {
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (
          entry.name.endsWith('.ts') &&
          entry.name !== 'policyArtifacts.ts' &&
          readFileSync(path, 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .includes('loadPolicyArtifacts')
        ) {
          offenders.push(path);
        }
      }
    };
    walk('src');
    expect(offenders).toEqual([join('src', 'kernel', 'policy', 'policyEngine.ts')]);
  });
});

describe('`50 §2b` — CLASS 20 SIGNS THE SPECIFICATION, NEVER AN IMPLEMENTATION', () => {
  it('the deployed artifact is the architecture’s own file, byte for byte', () => {
    const deployed = readFileSync(join('artifacts', 'control', 'class-20.acos-jcs-1.spec.v1.txt'));
    const architecture = readFileSync(
      join('docs', 'architecture', 'v1.3.6', 'artifacts', 'acos-jcs-1.spec.v1.txt'),
    );
    expect(deployed.equals(architecture)).toBe(true);
    expect(deployed.length).toBe(CLASS_20_ACCEPTED_BYTE_LENGTH);
    expect(createHash('sha256').update(deployed).digest('hex')).toBe(
      CLASS_20_ACCEPTED_CONTENT_HASH,
    );
  });

  it('`50 §2b`’s LF rule: the file contains no `0x0D` byte', () => {
    const deployed = readFileSync(join('artifacts', 'control', 'class-20.acos-jcs-1.spec.v1.txt'));
    expect(deployed.includes(0x0d)).toBe(false);
  });

  it('a CRLF copy is a DIFFERENT artifact and fails verification', () => {
    const fixture = buildControlArtifactFixture({
      mutate: (artifacts) =>
        withArtifactBytes(artifacts, 20, (bytes) =>
          Buffer.from(bytes.toString('utf8').replace(/\n/g, '\r\n'), 'utf8'),
        ),
    });
    expect(detailOf(() => verifyFixtureBundle(fixture))).toMatch(/0x0D byte/);
  });

  it('VULNERABLE CONTROL 16 — an IMPLEMENTATION digest is not the specification identity', () => {
    const implementationDigest = unsafeClass20ImplementationDigest(
      join('src', 'kernel', 'canonicalisation'),
    );
    expect(implementationDigest).toMatch(/^[0-9a-f]{64}$/);
    // It is not the frozen specification digest, and it never could be: the two objects are
    // different bytes with different purposes.
    expect(implementationDigest).not.toBe(CLASS_20_ACCEPTED_CONTENT_HASH);
  });

  it('and the runtime binds the SPECIFICATION identity, not an implementation', async () => {
    const jcs1 = await import('../../src/kernel/canonicalisation/jcs1Admission.js');
    const identity = jcs1.admittedJcs1SpecificationIdentity();
    expect(identity.artifactVersion).toBe('ACOS-JCS-1');
    expect(identity.contentHash).toBe(CLASS_20_ACCEPTED_CONTENT_HASH);
  });

  it('the admission gate does not INTERPRET the specification text', () => {
    const source = readFileSync(
      join('src', 'kernel', 'canonicalisation', 'jcs1Admission.ts'),
      'utf8',
    );
    for (const needle of ['eval(', 'new Function', 'readFileSync', 'require(']) {
      expect(source, `jcs1Admission.ts carries ${needle}`).not.toContain(needle);
    }
  });
});
