import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  COARSE_CONTROL_ARTIFACT_DENIAL,
  CONTROL_ARTIFACT_REASON_CODES,
  ControlArtifactIntegrityFailure,
  coarseControlArtifactDenial,
} from '../../src/kernel/controlArtifacts/errors.js';
import { activeVerifiedControlArtifacts } from '../../src/kernel/controlArtifacts/registry.js';
import { unsafeMayDispatch } from '../negative-controls/unsafe-bundle-lifecycle.js';
import { buildControlArtifactFixture, verifyFixtureBundle } from '../support/controlArtifactFixture.js';

/**
 * THE BOUNDARIES — key hygiene, signer confinement, the pre-live external-effect gate, and
 * the coarse worker-facing surface.
 *
 * =================================================================================
 * `50 §3a`'s CUSTODY RULE, VERBATIM
 *
 *   "**Neither private key exists in application source, in this repository, in any
 *    database, in any environment variable available to the runtime, on the runtime
 *    filesystem, in the manifest, or in any CI fixture used by production.** Production
 *    signing is an **offline release ceremony**."
 *
 * `§39` of the S1K mandate, on the offline signer: it "must never be imported into kernel
 * runtime; never be reachable from application startup; take explicit private-key material
 * only in offline/test context; not generate or retain production private keys."
 * =================================================================================
 */

const SRC = 'src';

function walkSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walkSources(path, out);
    else if (entry.name.endsWith('.ts')) out.push(path);
  }
  return out;
}

const PRODUCTION_SOURCES = walkSources(SRC);

function codeOf(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('NO PRODUCTION PRIVATE SIGNING KEY EXISTS ANYWHERE UNDER `src/`', () => {
  it('no production module generates or holds an owner signing key', () => {
    for (const path of PRODUCTION_SOURCES) {
      const code = codeOf(path);
      for (const needle of ['generateKeyPair', 'createPrivateKey', 'PRIVATE KEY', 'pkcs8']) {
        expect(code, `${path} carries ${needle}`).not.toContain(needle);
      }
    }
  });

  it('the control-artifact trust chain never SIGNS — it only verifies', () => {
    for (const root of [
      join('src', 'kernel', 'controlArtifacts'),
      join('src', 'audit', 'controlArtifacts'),
    ]) {
      for (const file of readdirSync(root)) {
        if (!file.endsWith('.ts')) continue;
        const code = codeOf(join(root, file));
        expect(code, `${file} signs`).not.toMatch(/\bsign\s*\(/);
        expect(code, `${file} imports a signer`).not.toContain("sign as ");
      }
    }
  });

  it('no artifact in the deployed package carries private key material', () => {
    for (const file of readdirSync(join('artifacts', 'control'))) {
      const bytes = readFileSync(join('artifacts', 'control', file), 'utf8');
      // "seed" is deliberately absent from this list: the class-20 SPECIFICATION is 13479
      // bytes of English and uses the word in its ordinary sense. What matters is that no
      // artifact carries KEY MATERIAL.
      for (const needle of ['PRIVATE KEY', 'private_key', 'privateKey', 'BEGIN EC', 'BEGIN RSA']) {
        expect(bytes.includes(needle), `${file} carries ${needle}`).toBe(false);
      }
    }
  });
});

describe('THE OFFLINE SIGNER IS OUTSIDE THE RUNTIME TRUST BOUNDARY', () => {
  it('nothing under `src/` imports anything under `tools/`', () => {
    for (const path of PRODUCTION_SOURCES) {
      const source = readFileSync(path, 'utf8');
      const imports = [...source.matchAll(/from '([^']+)'/g)].map((m) => m[1]!);
      for (const specifier of imports) {
        expect(specifier, `${path} imports ${specifier}`).not.toMatch(/tools\//);
      }
    }
  });

  it('nothing under `src/` imports anything under `tests/`', () => {
    for (const path of PRODUCTION_SOURCES) {
      const source = readFileSync(path, 'utf8');
      const imports = [...source.matchAll(/from '([^']+)'/g)].map((m) => m[1]!);
      for (const specifier of imports) {
        expect(specifier, `${path} imports ${specifier}`).not.toMatch(/tests\//);
      }
    }
  });

  it('and the signer itself imports nothing from `src/`', () => {
    for (const file of readdirSync(join('tools', 'control-artifacts'))) {
      if (!file.endsWith('.ts')) continue;
      const source = readFileSync(join('tools', 'control-artifacts', file), 'utf8');
      const imports = [...source.matchAll(/from '([^']+)'/g)].map((m) => m[1]!);
      for (const specifier of imports) {
        expect(specifier, `${file} imports ${specifier}`).not.toMatch(/src\//);
      }
    }
  });

  it('the test keys are test-only and are named as such', () => {
    const fixture = readFileSync(join('tests', 'support', 'controlArtifactFixture.ts'), 'utf8');
    expect(fixture).toContain('TEST-ONLY');
    // And they are unreachable from production: no production module imports the fixture.
    for (const path of PRODUCTION_SOURCES) {
      // Comments stripped: `requiredSet.ts` NAMES the fixture in prose to say where the
      // accepted class-20 digest lives, which is the opposite of importing it.
      expect(codeOf(path), `${path} reaches the test fixture`).not.toContain(
        'controlArtifactFixture',
      );
    }
  });
});

describe('`50 §3f` — THE PRE-LIVE EXTERNAL-EFFECT GATE', () => {
  it('`DispatchEnvironment` REQUIRES the verified capability', () => {
    const source = readFileSync(join('src', 'kernel', 'gateway', 'effectGateway.ts'), 'utf8');
    expect(source).toContain('readonly controlArtifacts: VerifiedControlArtifactBundle;');
    // Not optional, not nullable: `50 §3f` says dispatch "cannot proceed if the verified
    // bundle is unavailable", and an optional field is a field a composition can omit.
    expect(source).not.toContain('controlArtifacts?:');
    expect(source).not.toContain('controlArtifacts: VerifiedControlArtifactBundle | null');
  });

  it('the outbox claim asserts an active verified bundle before it can commit', () => {
    const code = codeOf(join('src', 'kernel', 'outbox', 'claim.ts'));
    expect(code).toContain('activeVerifiedControlArtifacts()');
  });

  it('VULNERABLE CONTROL 18 — a dispatcher with an OPTIONAL bundle proceeds without one', () => {
    expect(unsafeMayDispatch({})).toBe(true);
    // Production has no such shape: the environment type has no optional capability, so the
    // vulnerable composition does not typecheck and is not expressible.
    const source = readFileSync(join('src', 'kernel', 'gateway', 'effectGateway.ts'), 'utf8');
    expect(source).not.toMatch(/controlArtifacts\?\s*:/);
  });

  it('and there is still NO real transport anywhere in the gateway', () => {
    const gateway = join('src', 'kernel', 'gateway');
    for (const file of readdirSync(gateway)) {
      if (!file.endsWith('.ts')) continue;
      const code = codeOf(join(gateway, file));
      for (const needle of ['fetch(', 'node:http', 'node:https', 'axios', 'undici', 'node:net']) {
        expect(code, `${file} carries ${needle}`).not.toContain(needle);
      }
    }
  });

  it('S1K adds no network or credential surface to `src/` at all', () => {
    // v1.3.8, `48 §8` row I1 — the ONE declared inbound listener, and only its exact inbound
    // import line. It is not an S1K surface and it carries no outbound member; every needle
    // below — `node:https`, `node:net`, `node:tls`, any HTTP client — stays forbidden in it too.
    const INGRESS = join('audit', 'providerEvidence', 'ingressMain.ts');
    const INBOUND_IMPORT =
      "import { createServer, type IncomingMessage, type Server } from 'node:http';";
    for (const path of PRODUCTION_SOURCES) {
      const raw = codeOf(path);
      const code = path.endsWith(INGRESS) ? raw.replace(INBOUND_IMPORT, '') : raw;
      for (const needle of ['node:http', 'node:https', 'axios', 'undici', 'node:net', 'node:tls']) {
        expect(code, `${path} carries ${needle}`).not.toContain(needle);
      }
    }
  });
});

describe('`50 §3f` — THE WORKER-FACING SURFACE STAYS COARSE', () => {
  it('the message is ONE fixed sentence, identical for every reason code', () => {
    expect(coarseControlArtifactDenial()).toBe(COARSE_CONTROL_ARTIFACT_DENIAL);
    // It names no artifact, no key, no signature, no hash and no manifest difference.
    for (const needle of ['signature', 'key', 'hash', 'manifest', 'class', 'Cedar']) {
      expect(
        COARSE_CONTROL_ARTIFACT_DENIAL.toLowerCase(),
        `the coarse denial carries ${needle}`,
      ).not.toContain(needle.toLowerCase());
    }
  });

  it('the thrown error’s MESSAGE is the coarse one, so `String(error)` leaks nothing', () => {
    const failure = new ControlArtifactIntegrityFailure(
      'ARTIFACT_PRIMARY_SIGNATURE_INVALID',
      'class 3 carries no valid PRIMARY signature under the provisioned root 0xdeadbeef',
    );
    expect(failure.message).toBe(COARSE_CONTROL_ARTIFACT_DENIAL);
    expect(String(failure)).not.toContain('deadbeef');
    // The detail is a SEPARATE property, for the security log, and it is not the message.
    expect(failure.detail).toContain('deadbeef');
    expect(failure.detail).not.toBe(failure.message);
  });

  it('a real refusal carries a structured reason code from the closed set', () => {
    const fixture = buildControlArtifactFixture({ pinOverride: 'e'.repeat(64) });
    try {
      verifyFixtureBundle(fixture);
      throw new Error('expected a refusal');
    } catch (error) {
      expect(error).toBeInstanceOf(ControlArtifactIntegrityFailure);
      const failure = error as ControlArtifactIntegrityFailure;
      expect([...CONTROL_ARTIFACT_REASON_CODES]).toContain(failure.reasonCode);
      expect(failure.message).toBe(COARSE_CONTROL_ARTIFACT_DENIAL);
    }
  });

  it('and no worker-facing denial module mentions a control artifact at all', () => {
    for (const file of [
      join('src', 'kernel', 'authority', 'workerFacingAuthorityDenial.ts'),
      join('src', 'kernel', 'policy', 'workerFacingPolicyDenial.ts'),
      join('src', 'kernel', 'authorisation', 'workerFacingLocalDenial.ts'),
    ]) {
      const code = codeOf(file);
      for (const needle of ['manifest', 'signature', 'content_hash', 'VerifiedControlArtifact']) {
        expect(code, `${file} carries ${needle}`).not.toContain(needle);
      }
    }
  });
});

describe('`50 §3f` OCCASION 3 — no raw loader is reachable from an authority consumer', () => {
  it('`verifyControlArtifactBundle` has exactly one production call site', () => {
    const offenders = PRODUCTION_SOURCES.filter(
      (path) =>
        !path.endsWith(join('controlArtifacts', 'verifier.ts')) &&
        codeOf(path).includes('verifyControlArtifactBundle'),
    );
    expect(offenders).toEqual([join('src', 'kernel', 'controlArtifacts', 'registry.ts')]);
  });

  it('`sealVerifiedBundle` has exactly one production call site', () => {
    const offenders = PRODUCTION_SOURCES.filter(
      (path) =>
        !path.endsWith(join('controlArtifacts', 'bundle.ts')) &&
        codeOf(path).includes('sealVerifiedBundle'),
    );
    expect(offenders).toEqual([join('src', 'kernel', 'controlArtifacts', 'verifier.ts')]);
  });

  it('`readDeploymentTrustConfiguration` is reached only from the registry', () => {
    const offenders = PRODUCTION_SOURCES.filter(
      (path) =>
        !path.endsWith(join('controlArtifacts', 'trustConfig.ts')) &&
        codeOf(path).includes('readDeploymentTrustConfiguration'),
    );
    expect(offenders).toEqual([join('src', 'kernel', 'controlArtifacts', 'registry.ts')]);
  });

  it('and `filesystemArtifactPackage` is reached only from the registry', () => {
    const offenders = PRODUCTION_SOURCES.filter(
      (path) =>
        !path.endsWith(join('controlArtifacts', 'artifactPackage.ts')) &&
        codeOf(path).includes('filesystemArtifactPackage'),
    );
    expect(offenders).toEqual([join('src', 'kernel', 'controlArtifacts', 'registry.ts')]);
  });

  it('no authority consumer takes a verification KEY as a parameter', () => {
    // `50 §3i`: "A CALLER-SUPPLIED VERIFICATION KEY IS NOT A TRUST ROOT, and it must not
    // become the general S1K pattern." Nothing in the control-artifact chain accepts one.
    for (const file of readdirSync(join('src', 'kernel', 'controlArtifacts'))) {
      if (!file.endsWith('.ts')) continue;
      const code = codeOf(join('src', 'kernel', 'controlArtifacts', file));
      expect(code, `${file} takes a public key parameter`).not.toMatch(
        /publicKey\s*:\s*KeyObject/,
      );
    }
  });

  it('the active bundle is the one every authority accessor resolves', () => {
    expect(activeVerifiedControlArtifacts()).toBe(activeVerifiedControlArtifacts());
  });
});

describe('`50 §2b` — SIGNING IS NOT CONFORMANCE: VC-A3 is untouched', () => {
  it('the cross-implementation conformance suite still exists and is separate', () => {
    const files = walkSources('tests').map((path) => path.toLowerCase());
    expect(files.some((path) => path.includes('jcs') || path.includes('a3'))).toBe(true);
  });

  it('the independent JCS-1 test oracle does not import the production canonicaliser', () => {
    const oracle = readFileSync(join('tests', 'support', 'jcs1Oracle.ts'), 'utf8');
    const imports = [...oracle.matchAll(/from '([^']+)'/g)].map((m) => m[1]!);
    for (const specifier of imports) {
      expect(specifier, `the oracle imports ${specifier}`).not.toMatch(/canonicalBytes/);
    }
  });

  it('and the class-20 signature makes no conformance claim in code or comment', () => {
    const admission = readFileSync(
      join('src', 'kernel', 'canonicalisation', 'jcs1Admission.ts'),
      'utf8',
    );
    expect(admission).toContain('DOES NOT PROVE THAT ANY IMPLEMENTATION CONFORMS');
    expect(codeOf(join('src', 'kernel', 'canonicalisation', 'jcs1Admission.ts'))).not.toContain(
      'conform',
    );
  });
});
