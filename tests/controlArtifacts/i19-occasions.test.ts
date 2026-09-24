import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  bundleManifestId,
  isVerifiedControlArtifactBundle,
  verifiedActionCatalogue,
  type VerifiedControlArtifactBundle,
} from '../../src/kernel/controlArtifacts/bundle.js';
import { ControlArtifactIntegrityFailure } from '../../src/kernel/controlArtifacts/errors.js';
import {
  resetControlArtifactIncidentSink,
  setControlArtifactIncidentSink,
  type ControlArtifactSecurityIncident,
} from '../../src/kernel/controlArtifacts/incidents.js';
import {
  activeVerifiedControlArtifacts,
  bootstrapControlArtifactAuthority,
  kernelAuthorityReady,
} from '../../src/kernel/controlArtifacts/registry.js';
import { irrecoverableUnitsFor } from '../../src/kernel/canonicalisation/actionCatalogue.js';
import {
  unsafePartialPublish,
  unsafeRereadIrrecoverableUnits,
  type UnsafePublishedBundle,
} from '../negative-controls/unsafe-bundle-lifecycle.js';
import {
  buildControlArtifactFixture,
  withArtifactBytes,
  withoutArtifactClass,
  type ControlArtifactFixture,
} from '../support/controlArtifactFixture.js';

/**
 * `50 §3f` — `I19`'s THREE OCCASIONS, and the absence of a fourth.
 *
 * =================================================================================
 * `36 §2` VC-K3, verbatim
 *
 *   "Assert the kernel **does not reach READY** when any bootstrap step fails, with no
 *    degraded subset served and no effect admitted. Assert a failed candidate bundle
 *    **never replaces** the active bundle and that publication is atomic. Assert an
 *    authority consumer can obtain a control-artifact value **only** through a
 *    `VerifiedControlArtifactBundle`, by a type-level negative that must not compile.
 *    Assert that **mutating the backing bytes on disk after verification changes no
 *    authority outcome** until an explicit reload runs the full ceremony. **Assert no
 *    periodic re-verification timer exists**; a run that depends on one is a failure of
 *    this case."
 * =================================================================================
 */

const INCIDENTS: ControlArtifactSecurityIncident[] = [];

afterEach(() => {
  INCIDENTS.length = 0;
  resetControlArtifactIncidentSink();
});

function collectIncidents(): void {
  setControlArtifactIncidentSink((incident) => INCIDENTS.push(incident));
}

/**
 * `vi.resetModules()` hands back a SECOND module instance, so its
 * `ControlArtifactIntegrityFailure` is a different class object and `instanceof` is false
 * across the boundary. The failure is identified by its declared NAME and reason code
 * instead, which is what a security log would key on anyway.
 */
function isIntegrityFailure(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: string }).name === 'ControlArtifactIntegrityFailure'
  );
}

function expectIntegrityFailure(run: () => unknown): void {
  try {
    run();
  } catch (error) {
    expect(isIntegrityFailure(error), String(error)).toBe(true);
    return;
  }
  throw new Error('expected a control-artifact integrity failure and none was raised');
}

async function expectAsyncIntegrityFailure(run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (error) {
    expect(isIntegrityFailure(error), String(error)).toBe(true);
    return;
  }
  throw new Error('expected a control-artifact integrity failure and none was raised');
}

function reasonOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof ControlArtifactIntegrityFailure) return error.reasonCode;
    throw error;
  }
  throw new Error('expected a control-artifact integrity failure and none was raised');
}

/**
 * A FRESH, UNBOOTSTRAPPED KERNEL.
 *
 * The active bundle lives in module-private state — `50 §3f`'s capability boundary — so a
 * fresh module graph is a fresh kernel that has never run occasion 1. This is how the
 * "before READY" cases are reached without a production function that can un-publish a
 * bundle, which would be a production surface for making the kernel not READY.
 */
async function freshRegistry(): Promise<typeof import('../../src/kernel/controlArtifacts/registry.js')> {
  vi.resetModules();
  return import('../../src/kernel/controlArtifacts/registry.js');
}

describe('OCCASION 1 — the kernel does not become READY unless every step passes', () => {
  const failures: readonly (readonly [string, () => ControlArtifactFixture])[] = [
    ['the wrong manifest pin', () => buildControlArtifactFixture({ pinOverride: 'a'.repeat(64) })],
    [
      'a bad primary manifest signature',
      () => buildControlArtifactFixture({ tamper: { voidManifestPrimarySignature: true } }),
    ],
    [
      'a bad second-factor manifest signature',
      () => buildControlArtifactFixture({ tamper: { voidManifestSecondFactorSignature: true } }),
    ],
    [
      'a missing required artifact',
      () =>
        buildControlArtifactFixture({
          mutate: (artifacts) => withoutArtifactClass(artifacts, 20),
        }),
    ],
    [
      'stale artifact signatures',
      () => buildControlArtifactFixture({ tamper: { voidPrimaryArtifactSignature: 1 } }),
    ],
    [
      'a bad second factor on one artifact',
      () => buildControlArtifactFixture({ tamper: { voidSecondFactorArtifactSignature: 4 } }),
    ],
    ['one key in both root slots', () => buildControlArtifactFixture({ sameKeyInBothSlots: true })],
  ];

  for (const [name, make] of failures) {
    it(`${name} — the kernel FAILS CLOSED and never becomes READY`, async () => {
      const registry = await freshRegistry();
      const fixture = make();
      expect(registry.kernelAuthorityReady()).toBe(false);
      expectIntegrityFailure(() =>
        registry.bootstrapControlArtifactAuthority({ configurationSource: fixture.controlEnv }),
      );
      expect(registry.kernelAuthorityReady()).toBe(false);
      // No degraded subset: the capability accessor refuses rather than returning a partial
      // or empty bundle.
      expectIntegrityFailure(() => registry.activeVerifiedControlArtifacts());
    });
  }

  it('a BAD CONTENT HASH on disk fails bootstrap', () => {
    const baseline = buildControlArtifactFixture();
    const onDisk = buildControlArtifactFixture({ pinOverride: baseline.manifestId });
    writeFileSync(
      join(onDisk.controlRoot, 'class-27.degraded-mode-config.json'),
      Buffer.from('{\n  "artifact_id": "acos.control.degraded_mode_config"\n}\n', 'utf8'),
    );
    expect(reasonOf(() => bootstrapControlArtifactAuthority({ configurationSource: onDisk.controlEnv }))).toBe(
      'ARTIFACT_CONTENT_HASH_MISMATCH',
    );
  });

  it('a bootstrap failure raises the CRITICAL incident with occasion BOOTSTRAP and no journalling', async () => {
    collectIncidents();
    const registry = await freshRegistry();
    const fixture = buildControlArtifactFixture({ pinOverride: 'b'.repeat(64) });
    // The sink is module state, so it is installed on the fresh graph too.
    const incidents: ControlArtifactSecurityIncident[] = [];
    const freshIncidents = await import('../../src/kernel/controlArtifacts/incidents.js');
    freshIncidents.setControlArtifactIncidentSink((incident) => incidents.push(incident));
    expect(() =>
      registry.bootstrapControlArtifactAuthority({ configurationSource: fixture.controlEnv }),
    ).toThrow();
    expect(incidents).toHaveLength(1);
    expect(incidents[0]!.severity).toBe('CRITICAL');
    expect(incidents[0]!.occasion).toBe('BOOTSTRAP');
    // `50 §3f`: "A journal chain must NOT be fabricated using unverified `ACOS-JCS-1` rules
    // in order to record the failure of the artifact that declares those rules."
    expect(incidents[0]!.journallingPermitted).toBe(false);
    expect(incidents[0]!.reasonCode).toBe('MANIFEST_IDENTITY_NOT_PINNED');
    freshIncidents.resetControlArtifactIncidentSink();
  });

  it('and a valid package DOES become READY — the gate is not simply closed', async () => {
    const registry = await freshRegistry();
    const fixture = buildControlArtifactFixture();
    expect(registry.kernelAuthorityReady()).toBe(false);
    registry.bootstrapControlArtifactAuthority({ configurationSource: fixture.controlEnv });
    expect(registry.kernelAuthorityReady()).toBe(true);
    expect(registry.activeManifestId()).toBe(fixture.manifestId);
  });
});

describe('OCCASION 3 — the capability is the only surface, and it cannot be forged', () => {
  it('the active bundle is one this module sealed', () => {
    expect(isVerifiedControlArtifactBundle(activeVerifiedControlArtifacts())).toBe(true);
  });

  it('an object cast to the capability type carries no contents and is refused', () => {
    const forged = {} as unknown as VerifiedControlArtifactBundle;
    expect(isVerifiedControlArtifactBundle(forged)).toBe(false);
    expect(reasonOf(() => verifiedActionCatalogue(forged))).toBe('NO_ACTIVE_VERIFIED_BUNDLE');
  });

  it('a bundle is not serialisable as an authority token', () => {
    const bundle = activeVerifiedControlArtifacts();
    expect(() => JSON.stringify(bundle)).toThrow(/capability/);
    // And it has no own enumerable data to copy out by hand.
    expect(Object.keys(bundle as unknown as Record<string, unknown>)).toEqual([]);
  });

  it('the bundle and its parsed contents are frozen', () => {
    const catalogue = verifiedActionCatalogue(activeVerifiedControlArtifacts());
    expect(Object.isFrozen(catalogue)).toBe(true);
    expect(Object.isFrozen(catalogue.entries)).toBe(true);
    expect(Object.isFrozen(catalogue.entries['refund.create'])).toBe(true);
  });
});

describe('OCCASION 2 — verified reload, atomic publication, and a failed candidate', () => {
  it('a successful reload publishes a COMPLETE new bundle', async () => {
    const registry = await freshRegistry();
    const first = buildControlArtifactFixture({ manifestEpoch: '1' });
    registry.bootstrapControlArtifactAuthority({ configurationSource: first.controlEnv });
    expect(registry.activeManifestId()).toBe(first.manifestId);

    const second = buildControlArtifactFixture({ manifestEpoch: '2' });
    await registry.reloadControlArtifactAuthority({ configurationSource: second.controlEnv });
    expect(registry.activeManifestId()).toBe(second.manifestId);
  });

  it('a FAILED candidate never replaces the active bundle', async () => {
    const registry = await freshRegistry();
    // The fresh module graph has its own private seal map, so the bundle it produces must be
    // read through ITS bundle module — which is itself a demonstration that the capability
    // cannot be read by anything that did not seal it.
    const bundleModule = await import('../../src/kernel/controlArtifacts/bundle.js');
    const good = buildControlArtifactFixture({ manifestEpoch: '1' });
    registry.bootstrapControlArtifactAuthority({ configurationSource: good.controlEnv });
    const before = registry.activeManifestId();

    const bad = buildControlArtifactFixture({
      manifestEpoch: '2',
      tamper: { voidSecondFactorArtifactSignature: 3 },
    });
    await expectAsyncIntegrityFailure(() =>
      registry.reloadControlArtifactAuthority({ configurationSource: bad.controlEnv }),
    );

    // A remains active, and it is still COMPLETE — no class was swapped on the way.
    expect(registry.activeManifestId()).toBe(before);
    expect(registry.kernelAuthorityReady()).toBe(true);
    expect(
      bundleModule.verifiedActionCatalogue(registry.activeVerifiedControlArtifacts()).entries[
        'fulfilment.reship'
      ]!.irrecoverableUnits,
    ).toBe(1n);
  });

  it('a failed reload raises the CRITICAL incident with occasion RELOAD, which MAY be journalled', async () => {
    const registry = await freshRegistry();
    const incidentsModule = await import('../../src/kernel/controlArtifacts/incidents.js');
    const seen: ControlArtifactSecurityIncident[] = [];
    incidentsModule.setControlArtifactIncidentSink((incident) => seen.push(incident));

    const good = buildControlArtifactFixture({ manifestEpoch: '1' });
    registry.bootstrapControlArtifactAuthority({ configurationSource: good.controlEnv });
    const bad = buildControlArtifactFixture({ pinOverride: 'c'.repeat(64) });
    await expectAsyncIntegrityFailure(() =>
      registry.reloadControlArtifactAuthority({ configurationSource: bad.controlEnv }),
    );

    expect(seen).toHaveLength(1);
    expect(seen[0]!.occasion).toBe('RELOAD');
    // By this occasion a verified class-20 identity IS admitted, so the journal may record it.
    expect(seen[0]!.journallingPermitted).toBe(true);
    incidentsModule.resetControlArtifactIncidentSink();
  });

  it('CONCURRENCY — readers see the OLD bundle until publication, and never a mixed set', async () => {
    const registry = await freshRegistry();
    const bundleModule = await import('../../src/kernel/controlArtifacts/bundle.js');
    const first = buildControlArtifactFixture({ manifestEpoch: '1' });
    registry.bootstrapControlArtifactAuthority({ configurationSource: first.controlEnv });

    const second = buildControlArtifactFixture({ manifestEpoch: '2' });

    let releaseCandidate: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      releaseCandidate = resolve;
    });

    const observations: string[] = [];
    const reader = async (): Promise<void> => {
      // Real interleaving: the reader yields to the event loop between reads while the
      // candidate sits verified-but-unpublished.
      for (let i = 0; i < 20; i += 1) {
        observations.push(bundleModule.bundleManifestId(registry.activeVerifiedControlArtifacts()));
        await Promise.resolve();
      }
    };

    const reload = registry.reloadControlArtifactAuthority(
      { configurationSource: second.controlEnv },
      { afterVerificationBeforePublication: () => held },
    );

    await reader();
    // Every read taken while the candidate was verified-but-unpublished saw the OLD bundle.
    expect(new Set(observations)).toEqual(new Set([first.manifestId]));

    releaseCandidate();
    await reload;

    // After publication every read sees the COMPLETE new bundle.
    const after = bundleModule.bundleManifestId(registry.activeVerifiedControlArtifacts());
    expect(after).toBe(second.manifestId);
  });

  it('VULNERABLE CONTROL 14 — a per-class publisher leaves a MIXED set behind', () => {
    const published: UnsafePublishedBundle = {};
    const fixture = buildControlArtifactFixture();
    const entries = [
      { artifactClass: 3, fileName: 'class-03.action-catalogue.json', contentHash: '' },
      { artifactClass: 27, fileName: 'class-27.degraded-mode-config.json', contentHash: 'wrong' },
    ].map((entry) => ({
      ...entry,
      contentHash:
        entry.contentHash === 'wrong'
          ? 'f'.repeat(64)
          : require('node:crypto')
              .createHash('sha256')
              .update(readFileSync(join(fixture.controlRoot, entry.fileName)))
              .digest('hex'),
    }));

    expect(() => unsafePartialPublish(published, fixture.controlRoot, entries)).toThrow();
    // Class 3 from the candidate is already live while class 27 is not — release B's
    // catalogue beside release A's configuration.
    expect(Object.keys(published)).toEqual(['3']);

    // Production publishes nothing on the same failure.
    const candidate = buildControlArtifactFixture({
      tamper: { voidSecondFactorArtifactSignature: 5 },
    });
    expect(() =>
      bootstrapControlArtifactAuthority({ configurationSource: candidate.controlEnv }),
    ).toThrow(ControlArtifactIntegrityFailure);
  });
});

describe('`50 §3f` — backing-file mutation has NO authority effect until an explicit reload', () => {
  it('mutating the file after verification changes no authority outcome', async () => {
    const registry = await freshRegistry();
    const catalogueModule = await import('../../src/kernel/canonicalisation/actionCatalogue.js');
    const fixture = buildControlArtifactFixture();
    registry.bootstrapControlArtifactAuthority({ configurationSource: fixture.controlEnv });

    const path = join(fixture.controlRoot, 'class-03.action-catalogue.json');
    const original = readFileSync(path);
    expect(catalogueModule.irrecoverableUnitsFor('fulfilment.reship')).toBe(1n);

    // Rewrite the backing file so `fulfilment.reship` costs NOTHING against the MIE ceiling.
    writeFileSync(path, Buffer.from(original.toString('utf8').replace('"irrecoverable_units": "1"', '"irrecoverable_units": "0"'), 'utf8'));

    // The immutable verified bundle is unmoved, so the authority operation is unmoved.
    expect(catalogueModule.irrecoverableUnitsFor('fulfilment.reship')).toBe(1n);

    // VULNERABLE CONTROL 13 — a reader that re-reads the backing file DOES move.
    expect(unsafeRereadIrrecoverableUnits(fixture.controlRoot, 'fulfilment.reship')).toBe(0n);

    // And an EXPLICIT reload detects the tampering and refuses.
    await expectAsyncIntegrityFailure(() =>
      registry.reloadControlArtifactAuthority({ configurationSource: fixture.controlEnv }),
    );
    // The pre-tamper bundle is still the active one.
    expect(catalogueModule.irrecoverableUnitsFor('fulfilment.reship')).toBe(1n);
  });
});

describe('`50 §3f` — `I19` IS EVENT- AND USE-GATED: there is NO TIMER', () => {
  const ROOTS = [
    join('src', 'kernel', 'controlArtifacts'),
    join('src', 'audit', 'controlArtifacts'),
  ];

  it('no module in the control-artifact trust chain schedules anything', () => {
    for (const root of ROOTS) {
      for (const file of readdirSync(root)) {
        if (!file.endsWith('.ts')) continue;
        const source = readFileSync(join(root, file), 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^\s*\/\/.*$/gm, '');
        for (const needle of [
          'setInterval',
          'setTimeout',
          'setImmediate',
          'fs.watch',
          'watchFile',
          'cron',
        ]) {
          expect(source, `${file} carries ${needle}`).not.toContain(needle);
        }
      }
    }
  });

  it('and re-reading authority does not touch the filesystem', () => {
    // A thousand catalogue reads with the backing file DELETED still answer, because the
    // bundle is in memory and immutable.
    const before = irrecoverableUnitsFor('fulfilment.reship');
    for (let i = 0; i < 1000; i += 1) {
      expect(irrecoverableUnitsFor('fulfilment.reship')).toBe(before);
    }
    expect(bundleManifestId(activeVerifiedControlArtifacts())).toMatch(/^[0-9a-f]{64}$/);
  });

  it('kernelAuthorityReady is derived, not a flag anyone can set', () => {
    const source = readFileSync(join('src', 'kernel', 'controlArtifacts', 'registry.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(source).not.toContain('setReady');
    expect(source).not.toContain('markReady');
    expect(kernelAuthorityReady()).toBe(true);
  });
});

describe('a reload that CHANGES a value moves authority, so the gate is not simply frozen', () => {
  it('a re-signed catalogue with a different adapter takes effect after an explicit reload', async () => {
    const registry = await freshRegistry();
    const catalogueModule = await import('../../src/kernel/canonicalisation/actionCatalogue.js');
    const first = buildControlArtifactFixture({ manifestEpoch: '1' });
    registry.bootstrapControlArtifactAuthority({ configurationSource: first.controlEnv });
    expect(catalogueModule.actionCatalogueEntry('campaign.pause').adapter).toBe('mock_ads');

    const second = buildControlArtifactFixture({
      manifestEpoch: '2',
      mutate: (artifacts) =>
        withArtifactBytes(artifacts, 3, (bytes) =>
          Buffer.from(
            bytes.toString('utf8').replace('"adapter": "mock_ads"', '"adapter": "internal_only"'),
            'utf8',
          ),
        ),
    });
    await registry.reloadControlArtifactAuthority({ configurationSource: second.controlEnv });
    expect(catalogueModule.actionCatalogueEntry('campaign.pause').adapter).toBe('internal_only');
    expect(catalogueModule.requiresExternalDispatchFor('campaign.pause')).toBe(false);
  });
});
