import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { activeManifestId } from '../../src/kernel/controlArtifacts/registry.js';
import { runPreliveCli } from '../../tools/prelive/cli.js';
import {
  evaluatePreliveReadiness,
  renderPreliveResult,
} from '../../tools/prelive/preliveGate.js';
import {
  auditPlaneEnv,
  bothPlanesEnv,
  completeReleaseFixture,
  controlPlaneEnv,
  scratchDirectory,
} from '../support/releaseCeremonyFixture.js';

/**
 * `§39` AND `§40` — THE LOCAL PRE-LIVE READINESS GATE.
 *
 * =================================================================================
 * PRECISE NAMING IS THE POINT OF `§40`
 *
 * The gate may report `READY_FOR_PROVIDER_SANDBOX_CONFIGURATION` and nothing broader. The
 * two broader launch claims `§40` forbids are held HERE, in the test, and asserted absent
 * from the module, its status union and its rendered output — so the prohibition is checked
 * against the source rather than restated inside it.
 * =================================================================================
 */

/** The two claims `§40` forbids. Held in the test so the module need not carry them. */
const FORBIDDEN_CLAIMS = ['PRODUCTION_READY', 'SAFE_TO_LAUNCH'] as const;

function preliveSources(): readonly string[] {
  return readdirSync(join('tools', 'prelive'))
    .filter((name) => name.endsWith('.ts'))
    .map((name) => readFileSync(join('tools', 'prelive', name), 'utf8'));
}

/** Source with comments stripped: the prohibitions below are about CODE, not about prose. */
function preliveCode(): readonly string[] {
  return preliveSources().map((source) =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''),
  );
}

describe('§40 — the gate makes ONE readiness claim, and never a broader one', () => {
  it('neither forbidden claim appears anywhere in the pre-live tooling', () => {
    for (const source of preliveSources()) {
      for (const claim of FORBIDDEN_CLAIMS) {
        expect(source, `the pre-live tooling contains ${claim}`).not.toContain(claim);
      }
    }
  });

  it('nor in a rendered READY result', () => {
    const fixture = completeReleaseFixture({ dir: scratchDirectory('acos-s1l-gate-a-') });
    const result = evaluatePreliveReadiness(bothPlanesEnv(fixture.controlEnv, fixture.auditEnv));
    expect(result.status).toBe('READY_FOR_PROVIDER_SANDBOX_CONFIGURATION');
    const rendered = renderPreliveResult(result);
    for (const claim of FORBIDDEN_CLAIMS) expect(rendered).not.toContain(claim);
    // And it says, on the face of the report, what the claim does NOT mean.
    expect(rendered).toContain('does NOT mean the');
    expect(rendered).toContain('many obligations remain open');
  });

  it('the status union has exactly the two declared members', () => {
    const fixture = completeReleaseFixture({ dir: scratchDirectory('acos-s1l-gate-b-') });
    const ready = evaluatePreliveReadiness(
      bothPlanesEnv(fixture.controlEnv, fixture.auditEnv),
    ).status;
    const notReady = evaluatePreliveReadiness(
      bothPlanesEnv(
        controlPlaneEnv(fixture.completed, fixture.controlPackageRoot, 'c'.repeat(64)),
        fixture.auditEnv,
      ),
    ).status;
    expect([ready, notReady].sort()).toEqual([
      'NOT_READY',
      'READY_FOR_PROVIDER_SANDBOX_CONFIGURATION',
    ]);
  });
});

describe('§39 — it evaluates LOCAL evidence, from each plane’s own trust boundary', () => {
  it('reports both planes’ independently obtained manifest identities', () => {
    const fixture = completeReleaseFixture({ dir: scratchDirectory('acos-s1l-gate-c-') });
    const result = evaluatePreliveReadiness(bothPlanesEnv(fixture.controlEnv, fixture.auditEnv));
    expect(result.control.manifestId).toBe(fixture.completed.manifestId);
    expect(result.audit.manifestId).toBe(fixture.completed.manifestId);
    expect(result.manifestIdentitiesEqual).toBe(true);
  });

  it('a missing AUDIT configuration is NOT covered for by the control plane', () => {
    const fixture = completeReleaseFixture({ dir: scratchDirectory('acos-s1l-gate-d-') });
    // The control plane alone. The audit plane's variables are simply absent.
    const result = evaluatePreliveReadiness(fixture.controlEnv);
    expect(result.control.verified).toBe(true);
    expect(result.audit.verified).toBe(false);
    expect(result.findings.map((finding) => finding.code)).toContain('AUDIT_PLANE_NOT_VERIFIED');
    expect(result.status).toBe('NOT_READY');
  });

  it('a Cedar bundle that does not load is a finding, not a silent pass', () => {
    // `50 §5`: "the manifest proves the deployed artifact is the one the owner signed. It
    // says nothing about whether signing it was a good idea." A validly signed bundle that
    // does not parse is exactly that case, and it must not pass the gate.
    const reference = completeReleaseFixture({ dir: scratchDirectory('acos-s1l-gate-e-') });
    const bundle = JSON.parse(
      readFileSync(join(reference.controlPackageRoot, 'class-02.policy-set.json'), 'utf8'),
    ) as { artifact_id: string; artifact_version: string; schema: string; policies: unknown };
    bundle.policies = [{ id: 'acos.not.a.real.policy', source: 'permit(' }];

    const broken = completeReleaseFixture({
      dir: scratchDirectory('acos-s1l-gate-f-'),
      overrides: [
        {
          artifactClass: 2,
          bytes: Buffer.from(`${JSON.stringify(bundle, null, 2)}
`, 'utf8'),
        },
      ],
    });
    const result = evaluatePreliveReadiness(bothPlanesEnv(broken.controlEnv, broken.auditEnv));
    expect(result.control.verified).toBe(true);
    expect(result.findings.map((finding) => finding.code)).toContain('CEDAR_BUNDLE_NOT_LOADABLE');
    expect(result.status).toBe('NOT_READY');
  });

  it('a cross-plane class-20 divergence is a finding', () => {
    // `50 §2b`: "The control plane and the audit plane each hold a BYTE-IDENTICAL COPY".
    const fixture = completeReleaseFixture({ dir: scratchDirectory('acos-s1l-gate-g-') });
    const path = join(fixture.auditPackageRoot, 'class-20.acos-jcs-1.spec.v1.txt');
    writeFileSync(path, `${readFileSync(path, 'utf8')} `, 'utf8');
    const result = evaluatePreliveReadiness(bothPlanesEnv(fixture.controlEnv, fixture.auditEnv));
    // The audit plane's own verification fails first — which is the right order, because a
    // divergent copy is not a coherence question, it is an integrity failure on that plane.
    expect(result.audit.verified).toBe(false);
    expect(result.status).toBe('NOT_READY');
  });

  it('and the CLI exits non-zero when the gate is not satisfied', () => {
    const fixture = completeReleaseFixture({ dir: scratchDirectory('acos-s1l-gate-h-') });
    expect(runPreliveCli(bothPlanesEnv(fixture.controlEnv, fixture.auditEnv))).toBe(0);
    expect(
      runPreliveCli(
        bothPlanesEnv(
          fixture.controlEnv,
          auditPlaneEnv(fixture.completed, fixture.auditPackageRoot, 'd'.repeat(64)),
        ),
      ),
    ).toBe(1);
  });
});

describe('§39 — the things the gate must NOT do', () => {
  it('makes no network or vendor call, and carries no credential surface', () => {
    // The word "credential" DOES appear, once, in the sentence the report prints saying it
    // tests none. The prohibition is about a credential SURFACE, so the scan looks for the
    // shapes one would take.
    for (const source of preliveCode()) {
      for (const needle of [
        'node:http',
        'node:https',
        'node:net',
        'node:tls',
        'fetch(',
        'axios',
        'undici',
        'apiKey',
        'api_key',
        'Authorization',
        'Bearer',
      ]) {
        expect(source.toLowerCase(), `the gate carries ${needle}`).not.toContain(
          needle.toLowerCase(),
        );
      }
    }
  });

  it('claims nothing about I36, I20 or I8', () => {
    const fixture = completeReleaseFixture({ dir: scratchDirectory('acos-s1l-gate-i-') });
    const rendered = renderPreliveResult(
      evaluatePreliveReadiness(bothPlanesEnv(fixture.controlEnv, fixture.auditEnv)),
    );
    expect(rendered).toContain('says nothing about provider readiness, I36, I20 or I8');
  });

  it('does NOT displace a bundle this process is already running on', () => {
    // The gate performs `50 §3f` occasion 1 only when NOTHING is active, so that a CLI run
    // can answer `§39`'s "Cedar verified" question. Inside a process that already has an
    // active bundle — a test worker, or a host running the kernel — it verifies WITHOUT
    // publishing, and the running bundle is untouched.
    const before = activeManifestId();
    // A DIFFERENT release from the one this worker bootstrapped on — different epoch, so a
    // different core and a different identity. (At the same epoch the two would be equal,
    // which is `§6`'s determinism rather than a coincidence: see `ceremony.test.ts`.)
    const fixture = completeReleaseFixture({
      dir: scratchDirectory('acos-s1l-gate-k-'),
      manifestEpoch: '77',
    });
    expect(fixture.completed.manifestId).not.toBe(before);

    const result = evaluatePreliveReadiness(bothPlanesEnv(fixture.controlEnv, fixture.auditEnv));
    expect(result.status).toBe('READY_FOR_PROVIDER_SANDBOX_CONFIGURATION');
    expect(result.control.manifestId).toBe(fixture.completed.manifestId);

    // …and this worker is still running the bundle it bootstrapped on.
    expect(activeManifestId()).toBe(before);
  });

  it('is read-only: running it twice leaves the release and both packages byte-identical', () => {
    const fixture = completeReleaseFixture({ dir: scratchDirectory('acos-s1l-gate-j-') });
    const snapshot = (root: string): Record<string, string> => {
      const out: Record<string, string> = {};
      for (const name of readdirSync(root).sort()) {
        out[name] = readFileSync(join(root, name)).toString('base64');
      }
      return out;
    };
    const before = {
      control: snapshot(fixture.controlPackageRoot),
      audit: snapshot(fixture.auditPackageRoot),
    };
    evaluatePreliveReadiness(bothPlanesEnv(fixture.controlEnv, fixture.auditEnv));
    evaluatePreliveReadiness(bothPlanesEnv(fixture.controlEnv, fixture.auditEnv));
    expect({
      control: snapshot(fixture.controlPackageRoot),
      audit: snapshot(fixture.auditPackageRoot),
    }).toEqual(before);
  });
});
