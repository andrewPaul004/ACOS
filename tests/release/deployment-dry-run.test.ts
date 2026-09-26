import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { verifyAuditPlaneControlArtifacts } from '../../src/audit/controlArtifacts/auditPlaneVerifier.js';
import { verifyPackageDirectory } from '../../tools/control-release/verifyRelease.js';
import { evaluatePreliveReadiness } from '../../tools/prelive/preliveGate.js';
import {
  unsafeActivateWithoutPin,
  unsafeAuditVerdictFromControl,
  unsafeJointReadiness,
  unsafeSelectHighestEpoch,
} from '../negative-controls/unsafe-release-ceremony.js';
import {
  TEST_ONLY_ATTACKER,
  auditPlaneEnv,
  bothPlanesEnv,
  completeReleaseFixture,
  controlPlaneEnv,
  scratchDirectory,
} from '../support/releaseCeremonyFixture.js';

/**
 * `§24`–`§30` — THE COMPLETE RELEASE-TO-DEPLOYMENT DRY RUN.
 *
 * =================================================================================
 * `§24`, VERBATIM, AND EVERY STEP IS THE REAL ONE
 *
 *   "1. build candidate; 2. primary sign; 3. second-factor sign; 4. obtain manifest ID;
 *    5. provision control-plane test deployment config; 6. provision audit-plane test
 *    config; 7. bootstrap control runtime; 8. bootstrap audit runtime; 9. assert same active
 *    manifest ID; 10. exercise representative class-3, class-27, class-20 and Cedar reads.
 *    **No mock-generated unsigned shortcut. Use the real offline signing tool + real runtime
 *    verifier.**"
 *
 * Steps 1–4 run through `tools/control-release/`. Steps 7–8 run through
 * `src/kernel/controlArtifacts/registry.ts` and `src/audit/controlArtifacts/`. Nothing in
 * this file forms a signature, computes a manifest identity or writes a `manifest.json`.
 *
 * =================================================================================
 * A FRESH MODULE GRAPH IS A FRESH KERNEL
 *
 * The active verified bundle lives in module-private state — `50 §3f`'s capability boundary
 * — so `vi.resetModules()` yields a kernel that has never run occasion 1. That is how a
 * deployment is simulated without a production function that can un-publish a bundle, which
 * would itself be a surface for making the kernel not READY.
 * =================================================================================
 */

interface FreshKernel {
  readonly registry: typeof import('../../src/kernel/controlArtifacts/registry.js');
  readonly bundle: typeof import('../../src/kernel/controlArtifacts/bundle.js');
}

/**
 * A fresh, unbootstrapped kernel.
 *
 * The Cedar loader is imported only where a test needs it: `@cedar-policy/cedar-wasm` is
 * instantiated on import, and re-instantiating it on every reset would make this file's
 * runtime a multiple of what the property costs to prove.
 */
async function freshKernel(): Promise<FreshKernel> {
  vi.resetModules();
  return {
    registry: await import('../../src/kernel/controlArtifacts/registry.js'),
    bundle: await import('../../src/kernel/controlArtifacts/bundle.js'),
  };
}

function integrityFailureName(error: unknown): string {
  return typeof error === 'object' && error !== null
    ? String((error as { name?: string }).name)
    : 'NOT AN ERROR';
}

async function expectBootstrapRefusal(run: () => unknown): Promise<string> {
  try {
    run();
  } catch (error) {
    expect(integrityFailureName(error)).toBe('ControlArtifactIntegrityFailure');
    return String((error as { reasonCode?: string }).reasonCode);
  }
  return 'NO REFUSAL';
}

describe('§24 — the full dry run: release ceremony, both planes, representative reads', () => {
  it('bootstraps the control plane and the audit plane on ONE release identity', async () => {
    const fixture = completeReleaseFixture({ dir: scratchDirectory('acos-s1l-dry-') });

    // 7 — the control plane runs 50 §3f occasion 1 against ITS OWN configuration.
    const kernel = await freshKernel();
    expect(kernel.registry.kernelAuthorityReady()).toBe(false);
    const active = kernel.registry.bootstrapControlArtifactAuthority({
      configurationSource: fixture.controlEnv,
    });
    expect(kernel.registry.kernelAuthorityReady()).toBe(true);
    expect(kernel.registry.activeManifestId()).toBe(fixture.completed.manifestId);

    // 8 — the audit plane verifies ITS OWN copy from ITS OWN variables.
    const audit = verifyAuditPlaneControlArtifacts(fixture.auditEnv);
    expect(audit.verified).toBe(true);
    if (!audit.verified) return;

    // 9 — two independently obtained identities, equal.
    expect(audit.manifestId).toBe(kernel.registry.activeManifestId());

    // 10 — representative reads, all from the VERIFIED bundle.
    const catalogue = kernel.bundle.verifiedActionCatalogue(active);
    expect(catalogue.actionClasses).toContain('refund.create');
    expect(catalogue.entries['refund.create']!.recoverability).toBe('COMPENSABLE');
    expect(catalogue.entries['fulfilment.reship']!.irrecoverableUnits).toBe(1n);

    const degraded = kernel.bundle.verifiedDegradedModeConfiguration(active);
    expect(degraded.mirrorLagCriticalThresholdMs).toBe(15 * 60 * 1000);
    expect(degraded.auditUnreachableFullHaltThresholdMs).toBe(30 * 60 * 1000);
    expect(degraded.degradedPerActionApprovalFloorMinorUnits).toBe(2000n);
    expect(degraded.corroborationSignalMaxAgeMs).toBe(5 * 60 * 1000);

    const jcs1 = kernel.bundle.verifiedJcs1Specification(active);
    expect(jcs1.artifactVersion).toBe('ACOS-JCS-1');
    expect(jcs1.byteLength).toBe(13479);

    const { loadPolicyArtifacts } = await import('../../src/kernel/policy/policyArtifacts.js');
    const cedar = loadPolicyArtifacts(active);
    expect(cedar.manifestId).toBe(fixture.completed.manifestId);
    expect(cedar.policyVersion).toMatch(/^[0-9a-f]{64}$/);

    // And the ONE declared cross-plane duplication agrees across both planes.
    expect(audit.corroborationSignalMaxAgeMs).toBe(degraded.corroborationSignalMaxAgeMs);
    expect(audit.jcs1SpecificationContentHash).toBe(jcs1.contentHash);

    // The local pre-live gate, reading both planes' own evidence.
    const readiness = evaluatePreliveReadiness(bothPlanesEnv(fixture.controlEnv, fixture.auditEnv));
    expect(readiness.findings).toEqual([]);
    expect(readiness.status).toBe('READY_FOR_PROVIDER_SANDBOX_CONFIGURATION');
  });
});

describe('§25 — the deployment pin, and the release it was not meant to run', () => {
  it('a fully valid release R deployed against R−1’s pin is REFUSED, then accepted on R’s pin', async () => {
    const previous = completeReleaseFixture({
      dir: scratchDirectory('acos-s1l-r1-'),
      manifestEpoch: '1',
    });
    const current = completeReleaseFixture({
      dir: scratchDirectory('acos-s1l-r2-'),
      manifestEpoch: '2',
    });
    expect(current.completed.manifestId).not.toBe(previous.completed.manifestId);

    // R's package, R−1's pin.
    const wrongPin = controlPlaneEnv(
      current.completed,
      current.controlPackageRoot,
      previous.completed.manifestId,
    );
    const kernel = await freshKernel();
    expect(
      await expectBootstrapRefusal(() =>
        kernel.registry.bootstrapControlArtifactAuthority({ configurationSource: wrongPin }),
      ),
    ).toBe('MANIFEST_IDENTITY_NOT_PINNED');
    // And it did NOT become READY on the way past.
    expect(kernel.registry.kernelAuthorityReady()).toBe(false);

    // The correct pin. Nothing else changes.
    kernel.registry.bootstrapControlArtifactAuthority({
      configurationSource: current.controlEnv,
    });
    expect(kernel.registry.activeManifestId()).toBe(current.completed.manifestId);
  });

  it('VULNERABLE CONTROL 7 — a deployer that never checks the pin activates the old package', async () => {
    const previous = completeReleaseFixture({ dir: scratchDirectory('acos-s1l-vc7-a-'), manifestEpoch: '1' });
    const current = completeReleaseFixture({ dir: scratchDirectory('acos-s1l-vc7-b-'), manifestEpoch: '2' });

    // THE DEFECT: the old package's signatures verify, so it is activated — against a
    // deployment that was pinned to the new release.
    const unsafe = unsafeActivateWithoutPin(
      previous.controlPackageRoot,
      previous.primary.rawPublicKey,
      previous.secondFactor.rawPublicKey,
      current.completed.manifestId,
    );
    expect(unsafe.activated).toBe(true);
    expect(unsafe.manifestId).toBe(previous.completed.manifestId);
    expect(unsafe.manifestId).not.toBe(unsafe.pinIgnored);

    // PRODUCTION: refused on the identity, before any signature is checked.
    const kernel = await freshKernel();
    expect(
      await expectBootstrapRefusal(() =>
        kernel.registry.bootstrapControlArtifactAuthority({
          configurationSource: controlPlaneEnv(
            previous.completed,
            previous.controlPackageRoot,
            current.completed.manifestId,
          ),
        }),
      ),
    ).toBe('MANIFEST_IDENTITY_NOT_PINNED');
  });

  it('VULNERABLE CONTROL 6 — "the highest epoch on disk" promotes whatever has the big number', async () => {
    const low = completeReleaseFixture({ dir: scratchDirectory('acos-s1l-vc6-a-'), manifestEpoch: '2' });
    const high = completeReleaseFixture({ dir: scratchDirectory('acos-s1l-vc6-b-'), manifestEpoch: '99' });

    // THE DEFECT: `manifest_epoch` used as a selector, which `50 §3e` states is NOT
    // rollback protection and is NOT used.
    const chosen = unsafeSelectHighestEpoch([low.controlPackageRoot, high.controlPackageRoot]);
    expect(chosen?.chosenRoot).toBe(high.controlPackageRoot);
    expect(chosen?.manifestEpoch).toBe('99');

    // PRODUCTION: a deployment pinned to the epoch-2 release runs the epoch-2 release, and
    // the epoch-99 package cannot displace it whatever its number says.
    const kernel = await freshKernel();
    kernel.registry.bootstrapControlArtifactAuthority({ configurationSource: low.controlEnv });
    expect(kernel.registry.activeManifestId()).toBe(low.completed.manifestId);
    expect(
      await expectBootstrapRefusal(() =>
        kernel.registry.bootstrapControlArtifactAuthority({
          configurationSource: controlPlaneEnv(
            high.completed,
            high.controlPackageRoot,
            low.completed.manifestId,
          ),
        }),
      ),
    ).toBe('MANIFEST_IDENTITY_NOT_PINNED');
    // And the epoch-2 bundle is STILL the active one: a failed candidate never replaces it.
    expect(kernel.registry.activeManifestId()).toBe(low.completed.manifestId);
  });
});

describe('§29 — failed deploys, and the difference between READY and ACTIVATED', () => {
  it('a failed RELOAD leaves the OLD release active and never reports the candidate deployed', async () => {
    const good = completeReleaseFixture({ dir: scratchDirectory('acos-s1l-reload-a-') });
    const candidate = completeReleaseFixture({
      dir: scratchDirectory('acos-s1l-reload-b-'),
      manifestEpoch: '2',
    });
    // Break the candidate's package after it was signed.
    const path = join(candidate.controlPackageRoot, 'class-03.action-catalogue.json');
    writeFileSync(path, `${readFileSync(path, 'utf8')} `, 'utf8');

    const kernel = await freshKernel();
    kernel.registry.bootstrapControlArtifactAuthority({ configurationSource: good.controlEnv });
    expect(kernel.registry.activeManifestId()).toBe(good.completed.manifestId);

    let reloadFailed = false;
    try {
      await kernel.registry.reloadControlArtifactAuthority({
        configurationSource: candidate.controlEnv,
      });
    } catch (error) {
      reloadFailed = true;
      expect(integrityFailureName(error)).toBe('ControlArtifactIntegrityFailure');
    }
    expect(reloadFailed).toBe(true);

    // PROCESS READY ON THE OLD RELEASE — and NOT "new release activated".
    expect(kernel.registry.kernelAuthorityReady()).toBe(true);
    expect(kernel.registry.activeManifestId()).toBe(good.completed.manifestId);
    expect(kernel.registry.activeManifestId()).not.toBe(candidate.completed.manifestId);
  });

  const deployFailures: readonly (readonly [
    string,
    (fixture: ReturnType<typeof completeReleaseFixture>) => Readonly<Record<string, string>>,
    string,
  ])[] = [
    [
      'the wrong primary key',
      (fixture) =>
        controlPlaneEnv(
          {
            ...fixture.completed,
            primaryPublicKeyHex: TEST_ONLY_ATTACKER().rawPublicKey.toString('hex'),
          },
          fixture.controlPackageRoot,
        ),
      'MANIFEST_PRIMARY_SIGNATURE_INVALID',
    ],
    [
      'the wrong second-factor key',
      (fixture) =>
        controlPlaneEnv(
          {
            ...fixture.completed,
            secondFactorPublicKeyHex: TEST_ONLY_ATTACKER().rawPublicKey.toString('hex'),
          },
          fixture.controlPackageRoot,
        ),
      'MANIFEST_SECOND_FACTOR_SIGNATURE_INVALID',
    ],
    [
      'one key in both slots',
      (fixture) =>
        controlPlaneEnv(
          { ...fixture.completed, secondFactorPublicKeyHex: fixture.completed.primaryPublicKeyHex },
          fixture.controlPackageRoot,
        ),
      'TRUST_ROOTS_NOT_DISTINCT',
    ],
    [
      'the wrong manifest pin',
      (fixture) => controlPlaneEnv(fixture.completed, fixture.controlPackageRoot, 'a'.repeat(64)),
      'MANIFEST_IDENTITY_NOT_PINNED',
    ],
  ];

  for (const [name, configure, expected] of deployFailures) {
    it(`refuses ${name} with ${expected}, and never becomes READY`, async () => {
      const fixture = completeReleaseFixture({ dir: scratchDirectory('acos-s1l-deploy-') });
      const kernel = await freshKernel();
      expect(
        await expectBootstrapRefusal(() =>
          kernel.registry.bootstrapControlArtifactAuthority({
            configurationSource: configure(fixture),
          }),
        ),
      ).toBe(expected);
      expect(kernel.registry.kernelAuthorityReady()).toBe(false);
    });
  }

  const packageFailures: readonly (readonly [
    string,
    (fixture: ReturnType<typeof completeReleaseFixture>) => void,
    string,
  ])[] = [
    [
      'an incompletely copied package',
      (fixture) => rmSync(join(fixture.controlPackageRoot, 'class-19.effect-constructors.json')),
      'ARTIFACT_BYTES_UNREADABLE',
    ],
    [
      'one corrupted artifact',
      (fixture) => {
        const path = join(fixture.controlPackageRoot, 'class-27.degraded-mode-config.json');
        writeFileSync(path, readFileSync(path, 'utf8').replace('PT30M', 'PT6H'), 'utf8');
      },
      'ARTIFACT_CONTENT_HASH_MISMATCH',
    ],
    [
      'a missing Cedar artifact',
      (fixture) => rmSync(join(fixture.controlPackageRoot, 'class-02.policy-set.json')),
      'ARTIFACT_BYTES_UNREADABLE',
    ],
  ];

  for (const [name, break_, expected] of packageFailures) {
    it(`refuses ${name} with ${expected}`, async () => {
      const fixture = completeReleaseFixture({ dir: scratchDirectory('acos-s1l-pkg-') });
      break_(fixture);
      const kernel = await freshKernel();
      expect(
        await expectBootstrapRefusal(() =>
          kernel.registry.bootstrapControlArtifactAuthority({
            configurationSource: fixture.controlEnv,
          }),
        ),
      ).toBe(expected);
      expect(kernel.registry.kernelAuthorityReady()).toBe(false);
    });
  }

  it('a resurrected class 17 in a deployed manifest is refused', async () => {
    const fixture = completeReleaseFixture({ dir: scratchDirectory('acos-s1l-c17-') });
    const path = join(fixture.controlPackageRoot, 'manifest.json');
    const document = JSON.parse(readFileSync(path, 'utf8')) as {
      entries: Record<string, unknown>[];
      entry_count: number;
    };
    // INSERTED IN `50 §3d`'s declared ascending order, so the entry ORDER is still valid and
    // the refusal cannot come from the order check. What is left is the pin, which is the leg
    // this case is about.
    //
    // THE POSITION IS DERIVED, NOT COUNTED. A literal index encoded the inventory's length at
    // the moment it was written, and v1.3.7's class 5 moved it — turning this case into an
    // order failure and silently stopping it from testing the pin at all. Computing the
    // insertion point from the classes actually present keeps the case about what it says.
    insertRetiredClassInOrder(document.entries);
    document.entry_count = document.entries.length;
    writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`, 'utf8');

    const kernel = await freshKernel();
    // The core moved, so the PIN rejects it BEFORE any signature is checked (`50 §3e`), and
    // before the retired class is even reached. Both legs exist; this asserts the first.
    expect(
      await expectBootstrapRefusal(() =>
        kernel.registry.bootstrapControlArtifactAuthority({
          configurationSource: fixture.controlEnv,
        }),
      ),
    ).toBe('MANIFEST_IDENTITY_NOT_PINNED');
  });

  it('and a class-17 entry inside a CORRECTLY pinned manifest is refused as RETIRED', async () => {
    // The second leg. `50 §2d`: class 17 is "reserved and deprecated" and a manifest reviving
    // it is refused rather than ignored — so the release ceremony must never be able to
    // produce one, and the offline verifier refuses it too
    // (`tests/release/release-verify.test.ts`).
    const staged = completeReleaseFixture({ dir: scratchDirectory('acos-s1l-c17b-') });
    const report = verifyPackageDirectory(
      staged.controlPackageRoot,
      staged.primary.rawPublicKey,
      staged.secondFactor.rawPublicKey,
    );
    expect(report.verified).toBe(true);

    const path = join(staged.controlPackageRoot, 'manifest.json');
    const document = JSON.parse(readFileSync(path, 'utf8')) as {
      entries: Record<string, unknown>[];
      entry_count: number;
    };
    insertRetiredClassInOrder(document.entries);
    document.entry_count = document.entries.length;
    writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`, 'utf8');

    const after = verifyPackageDirectory(
      staged.controlPackageRoot,
      staged.primary.rawPublicKey,
      staged.secondFactor.rawPublicKey,
    );
    expect(after.verified).toBe(false);
    expect(after.findings.map((finding) => finding.code)).toContain('RETIRED_CLASS_PRESENT');
  });
});

/**
 * Splice a class-17 entry into a manifest's entry list AT ITS ASCENDING-ORDER POSITION.
 *
 * `50 §3d` declares the manifest order as ascending `artifact_class`, and `50 §2d` retires
 * class 17. A test that wants to prove the RETIREMENT check fires must not trip the ORDER
 * check on the way, so the entry goes exactly where 17 would sort.
 */
function insertRetiredClassInOrder(entries: Record<string, unknown>[]): void {
  const at = entries.findIndex((entry) => Number(entry.artifact_class) > 17);
  const index = at === -1 ? entries.length : at;
  entries.splice(index, 0, { ...entries[0]!, artifact_class: 17 });
}

describe('§23 / §27 — the two planes fail INDEPENDENTLY', () => {
  it('a wrong AUDIT key fails the audit plane and leaves the control plane correct', async () => {
    const fixture = completeReleaseFixture({ dir: scratchDirectory('acos-s1l-ind-a-') });
    const kernel = await freshKernel();
    kernel.registry.bootstrapControlArtifactAuthority({ configurationSource: fixture.controlEnv });
    expect(kernel.registry.kernelAuthorityReady()).toBe(true);

    const brokenAudit = auditPlaneEnv(
      { ...fixture.completed, primaryPublicKeyHex: TEST_ONLY_ATTACKER().rawPublicKey.toString('hex') },
      fixture.auditPackageRoot,
    );
    const audit = verifyAuditPlaneControlArtifacts(brokenAudit);
    expect(audit.verified).toBe(false);

    // And the gate reports NOT READY even though the control plane is perfectly fine.
    const readiness = evaluatePreliveReadiness(bothPlanesEnv(fixture.controlEnv, brokenAudit));
    expect(readiness.control.verified).toBe(true);
    expect(readiness.audit.verified).toBe(false);
    expect(readiness.status).toBe('NOT_READY');
  });

  it('a wrong CONTROL pin fails the control plane and leaves the audit plane correct', () => {
    const fixture = completeReleaseFixture({ dir: scratchDirectory('acos-s1l-ind-b-') });
    const brokenControl = controlPlaneEnv(
      fixture.completed,
      fixture.controlPackageRoot,
      'b'.repeat(64),
    );
    const readiness = evaluatePreliveReadiness(bothPlanesEnv(brokenControl, fixture.auditEnv));
    expect(readiness.control.verified).toBe(false);
    expect(readiness.audit.verified).toBe(true);
    expect(readiness.status).toBe('NOT_READY');
  });

  it('a tampered AUDIT copy is caught by the AUDIT plane against the same manifest', () => {
    const fixture = completeReleaseFixture({ dir: scratchDirectory('acos-s1l-ind-c-') });
    const path = join(fixture.auditPackageRoot, 'class-20.acos-jcs-1.spec.v1.txt');
    writeFileSync(path, `${readFileSync(path, 'utf8')}\n`, 'utf8');
    const audit = verifyAuditPlaneControlArtifacts(fixture.auditEnv);
    expect(audit.verified).toBe(false);
  });

  it('VULNERABLE CONTROL 9 — an audit verdict copied from the control plane misses it entirely', () => {
    const fixture = completeReleaseFixture({ dir: scratchDirectory('acos-s1l-vc9-') });
    // Break ONLY the audit plane's copy.
    const path = join(fixture.auditPackageRoot, 'class-27.degraded-mode-config.json');
    writeFileSync(path, readFileSync(path, 'utf8').replace('PT15M', 'PT16M'), 'utf8');

    // THE DEFECT: the audit verdict IS the control verdict, so a divergence the audit plane
    // exists to find is reported as verified.
    const unsafe = unsafeAuditVerdictFromControl({
      verified: true,
      manifestId: fixture.completed.manifestId,
    });
    expect(unsafe.verified).toBe(true);
    expect(unsafe.recomputed).toBe(false);

    // PRODUCTION: the audit plane recomputes from its OWN copy and refuses.
    const audit = verifyAuditPlaneControlArtifacts(fixture.auditEnv);
    expect(audit.verified).toBe(false);
  });
});

describe('§26 / §27 — a partial rollout cannot masquerade as joint readiness', () => {
  it('control on R2 and audit on R1 is NOT_READY, and each plane still verified its own', async () => {
    const r1 = completeReleaseFixture({ dir: scratchDirectory('acos-s1l-roll-1-'), manifestEpoch: '1' });
    const r2 = completeReleaseFixture({ dir: scratchDirectory('acos-s1l-roll-2-'), manifestEpoch: '2' });

    const controlOnR2 = controlPlaneEnv(r2.completed, r2.controlPackageRoot);
    const auditOnR1 = auditPlaneEnv(r1.completed, r1.auditPackageRoot);

    // Each plane individually verifies its own configured, pinned package. That is true and
    // is asserted, because the finding is about COHERENCE and not about either verification.
    const kernel = await freshKernel();
    kernel.registry.bootstrapControlArtifactAuthority({ configurationSource: controlOnR2 });
    expect(kernel.registry.activeManifestId()).toBe(r2.completed.manifestId);
    const audit = verifyAuditPlaneControlArtifacts(auditOnR1);
    expect(audit.verified).toBe(true);
    if (!audit.verified) return;
    expect(audit.manifestId).toBe(r1.completed.manifestId);

    // THE PRODUCTION GATE: NOT READY, naming the divergence.
    const readiness = evaluatePreliveReadiness(bothPlanesEnv(controlOnR2, auditOnR1));
    expect(readiness.control.verified).toBe(true);
    expect(readiness.audit.verified).toBe(true);
    expect(readiness.manifestIdentitiesEqual).toBe(false);
    expect(readiness.findings.map((finding) => finding.code)).toContain(
      'PLANES_ON_DIFFERENT_RELEASES',
    );
    expect(readiness.status).toBe('NOT_READY');

    // VULNERABLE CONTROL 8 — the `&&` that ignores which release each plane is on.
    expect(
      unsafeJointReadiness(true, true, r2.completed.manifestId, r1.completed.manifestId)
        .jointlyReady,
    ).toBe(true);
  });

  it('completing the rollout — audit moved to R2 — makes the gate READY', () => {
    const r2 = completeReleaseFixture({ dir: scratchDirectory('acos-s1l-roll-3-'), manifestEpoch: '2' });
    const readiness = evaluatePreliveReadiness(bothPlanesEnv(r2.controlEnv, r2.auditEnv));
    expect(readiness.manifestIdentitiesEqual).toBe(true);
    expect(readiness.status).toBe('READY_FOR_PROVIDER_SANDBOX_CONFIGURATION');
  });
});

describe('§30 — rollback is an explicit trusted deployment action, never an automatic one', () => {
  it('copying R1’s package back WITHOUT changing the pin is refused', async () => {
    const r1 = completeReleaseFixture({ dir: scratchDirectory('acos-s1l-rb-1-'), manifestEpoch: '1' });
    const r2 = completeReleaseFixture({ dir: scratchDirectory('acos-s1l-rb-2-'), manifestEpoch: '2' });

    const kernel = await freshKernel();
    kernel.registry.bootstrapControlArtifactAuthority({ configurationSource: r2.controlEnv });
    expect(kernel.registry.activeManifestId()).toBe(r2.completed.manifestId);

    // R1's package under R2's pin. A valid, owner-signed, older release.
    const rolledBackPackageOnly = controlPlaneEnv(
      r1.completed,
      r1.controlPackageRoot,
      r2.completed.manifestId,
    );
    let reloadFailed = false;
    try {
      await kernel.registry.reloadControlArtifactAuthority({
        configurationSource: rolledBackPackageOnly,
      });
    } catch {
      reloadFailed = true;
    }
    expect(reloadFailed).toBe(true);
    // R2 is still active. Nothing silently fell back.
    expect(kernel.registry.activeManifestId()).toBe(r2.completed.manifestId);
  });

  it('an EXPLICIT pin change to R1, with R1’s package, activates R1', async () => {
    // `50 §3a`'s rotation rule in the same shape: "the deployment trust configuration must be
    // changed **explicitly**, out of band; the runtime **restarts and re-bootstraps**".
    // v1.3.6 declares no prohibition on backwards epoch movement under an explicit pin, and
    // none is invented: what it declares is that the PIN decides, and `manifest_epoch` is
    // "recorded for lineage and for operator legibility" and is never a selector.
    const r1 = completeReleaseFixture({ dir: scratchDirectory('acos-s1l-rb-3-'), manifestEpoch: '1' });
    const r2 = completeReleaseFixture({ dir: scratchDirectory('acos-s1l-rb-4-'), manifestEpoch: '2' });

    const kernel = await freshKernel();
    kernel.registry.bootstrapControlArtifactAuthority({ configurationSource: r2.controlEnv });
    expect(kernel.registry.activeManifestId()).toBe(r2.completed.manifestId);

    await kernel.registry.reloadControlArtifactAuthority({
      configurationSource: r1.controlEnv,
    });
    expect(kernel.registry.activeManifestId()).toBe(r1.completed.manifestId);

    // And the audit plane does NOT follow automatically: it is still pinned to R2 and still
    // verifies R2, so the gate reports the rollback as incomplete rather than done.
    const readiness = evaluatePreliveReadiness(bothPlanesEnv(r1.controlEnv, r2.auditEnv));
    expect(readiness.findings.map((finding) => finding.code)).toContain(
      'PLANES_ON_DIFFERENT_RELEASES',
    );
  });
});
