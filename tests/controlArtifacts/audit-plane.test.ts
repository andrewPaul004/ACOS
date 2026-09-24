import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { verifyAuditPlaneControlArtifacts } from '../../src/audit/controlArtifacts/auditPlaneVerifier.js';
import { verifiedDegradedModeConfiguration } from '../../src/kernel/controlArtifacts/bundle.js';
import { activeVerifiedControlArtifacts } from '../../src/kernel/controlArtifacts/registry.js';
import { unsafeAuditAcceptsControlPlaneVouch } from '../negative-controls/unsafe-bundle-lifecycle.js';
import {
  buildControlArtifactFixture,
  verifyFixtureBundle,
  withArtifactBytes,
} from '../support/controlArtifactFixture.js';

/**
 * `50 §3` PROPERTY 2 — THE AUDIT PLANE RECOMPUTES INDEPENDENTLY.
 *
 * =================================================================================
 * VERBATIM
 *
 *   "**The audit plane recomputes independently.** A manifest check run only by the control
 *    plane is a check the control plane can pass by lying (`30 §5.2`)."
 *
 *   "Independent recomputation: the AUDIT PLANE recomputes every hash from its own copy and
 *    compares to the manifest it holds"
 *
 * `50 §2b` on what that does NOT cost: "**The control plane and the audit plane each hold a
 * BYTE-IDENTICAL COPY of this artifact.** That is not a loss of implementation independence.
 * **Same specification; independent implementations.**"
 * =================================================================================
 */

describe('the audit plane verifies its own copy, from its own configuration', () => {
  it('a valid package verifies on BOTH planes independently', () => {
    const fixture = buildControlArtifactFixture();
    const control = verifyFixtureBundle(fixture);
    const audit = verifyAuditPlaneControlArtifacts(fixture.auditEnv);

    expect(audit.verified).toBe(true);
    if (!audit.verified) return;
    // Two implementations, one manifest identity.
    expect(audit.manifestId).toBe(fixture.manifestId);
    // And they agree on `50 §2c` quantity 4 — the ONE declared duplication in the inventory.
    expect(audit.corroborationSignalMaxAgeMs).toBe(
      verifiedDegradedModeConfiguration(control).corroborationSignalMaxAgeMs,
    );
  });

  it('the audit plane reads its OWN deployment variables and not the control plane’s', () => {
    const fixture = buildControlArtifactFixture();
    // Handed the CONTROL plane's configuration, the audit verifier finds nothing: its
    // variable names are different, so there is no accidental sharing.
    const outcome = verifyAuditPlaneControlArtifacts(fixture.controlEnv);
    expect(outcome.verified).toBe(false);
    if (outcome.verified) return;
    expect(outcome.reason).toBe('AUDIT_TRUST_CONFIG_MISSING');
  });

  it('a tampered AUDIT-PLANE copy is caught BY THE AUDIT PLANE, against the same manifest', () => {
    // `§24` of the S1K mandate's required case: tamper with ONE plane's copy.
    const fixture = buildControlArtifactFixture({
      auditMutate: (artifacts) =>
        withArtifactBytes(artifacts, 27, (bytes) =>
          Buffer.from(
            bytes.toString('utf8').replace('"PT5M"', '"PT45M"'),
            'utf8',
          ),
        ),
    });

    // The CONTROL plane's copy is untouched and verifies.
    expect(() => verifyFixtureBundle(fixture)).not.toThrow();

    // The AUDIT plane hashes ITS OWN bytes and finds they do not match the manifest both
    // planes hold. The control plane's success does not cover for it.
    const audit = verifyAuditPlaneControlArtifacts(fixture.auditEnv);
    expect(audit.verified).toBe(false);
    if (audit.verified) return;
    expect(audit.reason).toBe('AUDIT_ARTIFACT_CONTENT_HASH_MISMATCH');
    expect(audit.detail).toMatch(/class 27/);
  });

  it('and a tampered CONTROL-PLANE copy is caught by the CONTROL plane, not by the audit one', () => {
    const fixture = buildControlArtifactFixture();
    const path = join(fixture.controlRoot, 'class-20.acos-jcs-1.spec.v1.txt');
    writeFileSync(path, Buffer.concat([readFileSync(path), Buffer.from('\n', 'utf8')]));

    expect(() => verifyFixtureBundle(fixture)).toThrow();
    // The audit plane's own copy is intact, so it still verifies — which is the point of
    // two copies: each plane answers for its own bytes.
    expect(verifyAuditPlaneControlArtifacts(fixture.auditEnv).verified).toBe(true);
  });

  it('the audit plane refuses an unpinned manifest on its OWN pin', () => {
    const current = buildControlArtifactFixture({ manifestEpoch: '3' });
    const older = buildControlArtifactFixture({ manifestEpoch: '1' });
    const outcome = verifyAuditPlaneControlArtifacts({
      ...older.auditEnv,
      ACOS_AUDIT_EXPECTED_ACTIVE_MANIFEST_ID: current.manifestId,
    });
    expect(outcome.verified).toBe(false);
    if (outcome.verified) return;
    expect(outcome.reason).toBe('AUDIT_MANIFEST_IDENTITY_NOT_PINNED');
  });

  it('the audit plane requires BOTH signatures too', () => {
    const fixture = buildControlArtifactFixture({
      tamper: { voidManifestSecondFactorSignature: true },
    });
    const outcome = verifyAuditPlaneControlArtifacts(fixture.auditEnv);
    expect(outcome.verified).toBe(false);
    if (outcome.verified) return;
    expect(outcome.reason).toBe('AUDIT_MANIFEST_SECOND_FACTOR_SIGNATURE_INVALID');
  });

  it('and it refuses one key in both of its own root slots', () => {
    const fixture = buildControlArtifactFixture();
    const outcome = verifyAuditPlaneControlArtifacts({
      ...fixture.auditEnv,
      ACOS_AUDIT_OWNER_ARTIFACT_SECOND_FACTOR_KEY:
        fixture.auditEnv.ACOS_AUDIT_OWNER_ARTIFACT_ROOT_KEY!,
    });
    expect(outcome.verified).toBe(false);
    if (outcome.verified) return;
    expect(outcome.reason).toBe('AUDIT_TRUST_ROOTS_NOT_DISTINCT');
  });
});

describe('VULNERABLE CONTROL 17 — the control plane vouching for the audit plane', () => {
  it('the unsafe audit plane believes a control-plane vouch over its own bytes', () => {
    const fixture = buildControlArtifactFixture({
      auditMutate: (artifacts) =>
        withArtifactBytes(artifacts, 27, (bytes) =>
          Buffer.from(bytes.toString('utf8').replace('"PT5M"', '"PT45M"'), 'utf8'),
        ),
    });

    // A control plane that verified ITS copy says everything is fine.
    const vouch = {
      verified: true,
      manifestId: fixture.manifestId,
      artifactDigests: {},
    };
    expect(unsafeAuditAcceptsControlPlaneVouch(vouch).verified).toBe(true);

    // The real audit plane hashes its own bytes and disagrees.
    expect(verifyAuditPlaneControlArtifacts(fixture.auditEnv).verified).toBe(false);
  });
});

describe('the audit plane shares no authority computation with the control plane', () => {
  const AUDIT_SOURCE = join('src', 'audit', 'controlArtifacts', 'auditPlaneVerifier.ts');

  it('it imports nothing from `src/kernel/`', () => {
    const source = readFileSync(AUDIT_SOURCE, 'utf8');
    const imports = [...source.matchAll(/^import .*?from '([^']+)';$/gm)].map((m) => m[1]!);
    expect(imports.sort()).toEqual(['node:crypto', 'node:fs', 'node:path']);
  });

  it('it receives no "verified" flag, bundle or digest from the control plane', () => {
    const source = readFileSync(AUDIT_SOURCE, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    for (const needle of [
      'VerifiedControlArtifactBundle',
      'activeVerifiedControlArtifacts',
      'controlPlane',
      'vouch',
    ]) {
      expect(source, `the audit verifier references ${needle}`).not.toContain(needle);
    }
  });

  it('and it re-derives the framing rather than importing it', () => {
    const source = readFileSync(AUDIT_SOURCE, 'utf8');
    // Its own domain constants, its own field encoder, its own core assembly.
    expect(source).toContain("const ARTIFACT_DOMAIN = 'ACOS-CONTROL-ARTIFACT-SIGNATURE-V1'");
    expect(source).toContain('function field(');
    expect(source).toContain('function u32be(');
  });

  it('no module under `src/audit/` imports the control plane’s trust chain', () => {
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (entry.name.endsWith('.ts')) {
          const source = readFileSync(path, 'utf8');
          if (/from '.*kernel\/controlArtifacts/.test(source)) offenders.push(path);
        }
      }
    };
    walk(join('src', 'audit'));
    expect(offenders).toEqual([]);
  });
});

describe('`50 §2c` — the cross-plane obligation on `corroboration_signal_max_age`', () => {
  it('both planes read PT5M, each from its own verified class-27 copy', () => {
    const fixture = buildControlArtifactFixture();
    const control = verifiedDegradedModeConfiguration(verifyFixtureBundle(fixture));
    const audit = verifyAuditPlaneControlArtifacts(fixture.auditEnv);
    expect(audit.verified).toBe(true);
    if (!audit.verified) return;
    expect(control.corroborationSignalMaxAgeMs).toBe(5 * 60 * 1000);
    expect(audit.corroborationSignalMaxAgeMs).toBe(5 * 60 * 1000);
  });

  it('and the ACTIVE control-plane bundle agrees with both', () => {
    expect(
      verifiedDegradedModeConfiguration(activeVerifiedControlArtifacts()).corroborationSignalMaxAgeMs,
    ).toBe(5 * 60 * 1000);
  });
});
