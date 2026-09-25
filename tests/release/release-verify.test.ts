import { createHash } from 'node:crypto';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { verifyPackageDirectory, verifyReleaseDirectory } from '../../tools/control-release/verifyRelease.js';
import {
  TEST_ONLY_ATTACKER,
  completeReleaseFixture,
  scratchDirectory,
} from '../support/releaseCeremonyFixture.js';

/**
 * `§20` — THE OPERATOR'S INDEPENDENT OFFLINE VERIFICATION.
 *
 * =================================================================================
 * IT RECOMPUTES EVERYTHING, AND IT REPLACES NOTHING
 *
 * `§20`: it "independently recomputes: artifact hashes; manifest identity; all signatures.
 * **This offline verification command is useful for operators. It does NOT replace runtime
 * bootstrap verification.**"
 *
 * `tests/release/deployment-dry-run.test.ts` is where the RUNTIME verifier is exercised
 * against the same packages. The two are deliberately separate: an operator's pre-flight
 * check and the kernel's occasion-1 ceremony are different obligations, and neither may be
 * reported as the other.
 * =================================================================================
 */

describe('a completed release verifies offline against the EXTERNALLY SUPPLIED public keys', () => {
  it('accepts the real release', () => {
    const fixture = completeReleaseFixture();
    const report = verifyReleaseDirectory(
      fixture.releaseRoot,
      fixture.primary.rawPublicKey,
      fixture.secondFactor.rawPublicKey,
    );
    expect(report.verified).toBe(true);
    expect(report.manifestEpoch).toBe('1');
  });

  it('the deployed COPY of the package verifies the same way', () => {
    // `§29`: an operator asking "is what I copied to the host what we signed" runs exactly
    // this check, against the flat deployed directory with no release scaffolding beside it.
    const fixture = completeReleaseFixture();
    const report = verifyPackageDirectory(
      fixture.controlPackageRoot,
      fixture.primary.rawPublicKey,
      fixture.secondFactor.rawPublicKey,
    );
    expect(report.verified).toBe(true);
    expect(report.manifestId).toBe(fixture.completed.manifestId);
  });

  it('REFUSES under an attacker’s public key — the keys are an input, never a read', () => {
    const fixture = completeReleaseFixture();
    const report = verifyReleaseDirectory(
      fixture.releaseRoot,
      TEST_ONLY_ATTACKER().rawPublicKey,
      fixture.secondFactor.rawPublicKey,
    );
    expect(report.verified).toBe(false);
    // It fails on the KEY ID consistency check, before any signature: the core names a
    // primary key id the supplied key does not derive. `50 §3a`, and the direction matters.
    expect(report.findings[0]?.code).toBe('MANIFEST_KEY_ID_MISMATCH');
  });

  it('REFUSES one key in both slots', () => {
    const fixture = completeReleaseFixture();
    const report = verifyReleaseDirectory(
      fixture.releaseRoot,
      fixture.primary.rawPublicKey,
      fixture.primary.rawPublicKey,
    );
    expect(report.verified).toBe(false);
    expect(report.findings[0]?.code).toBe('TRUST_ROOTS_NOT_DISTINCT');
  });
});

describe('§29 — every failed-deploy shape is refused, and each one by its own check', () => {
  const cases: readonly (readonly [
    string,
    (fixture: ReturnType<typeof completeReleaseFixture>) => void,
    string,
  ])[] = [
    [
      'a package copied incompletely',
      (fixture) => rmSync(join(fixture.completed.packageRoot, 'class-27.degraded-mode-config.json')),
      'ARTIFACT_BYTES_UNREADABLE',
    ],
    [
      'one corrupted artifact',
      (fixture) => {
        const path = join(fixture.completed.packageRoot, 'class-03.action-catalogue.json');
        writeFileSync(path, readFileSync(path, 'utf8').replace('REVERSIBLE', 'IRRECOVERABLE'), 'utf8');
      },
      'ARTIFACT_CONTENT_HASH_MISMATCH',
    ],
    [
      'a deleted manifest entry',
      (fixture) => {
        const path = join(fixture.completed.packageRoot, 'manifest.json');
        const document = JSON.parse(readFileSync(path, 'utf8')) as {
          entries: { artifact_class: number }[];
          entry_count: number;
        };
        document.entries = document.entries.filter((entry) => entry.artifact_class !== 27);
        document.entry_count = document.entries.length;
        writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
      },
      'REQUIRED_ARTIFACT_MISSING',
    ],
    [
      'a resurrected class 17',
      (fixture) => {
        const path = join(fixture.completed.packageRoot, 'manifest.json');
        const document = JSON.parse(readFileSync(path, 'utf8')) as {
          entries: Record<string, unknown>[];
          entry_count: number;
        };
        document.entries.push({ ...document.entries[0]!, artifact_class: 17 });
        document.entry_count = document.entries.length;
        writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
      },
      'RETIRED_CLASS_PRESENT',
    ],
    [
      'reordered entries with correct signatures',
      (fixture) => {
        const path = join(fixture.completed.packageRoot, 'manifest.json');
        const document = JSON.parse(readFileSync(path, 'utf8')) as {
          entries: Record<string, unknown>[];
        };
        document.entries.reverse();
        writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
      },
      'MANIFEST_ORDER_INVALID',
    ],
    [
      'an entry_count that disagrees with the entries',
      (fixture) => {
        const path = join(fixture.completed.packageRoot, 'manifest.json');
        const document = JSON.parse(readFileSync(path, 'utf8')) as { entry_count: number };
        document.entry_count = 99;
        writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
      },
      'MANIFEST_ENTRY_COUNT_MISMATCH',
    ],
    [
      'a missing Cedar artifact',
      (fixture) => rmSync(join(fixture.completed.packageRoot, 'class-02.policy-set.json')),
      'ARTIFACT_BYTES_UNREADABLE',
    ],
  ];

  for (const [name, break_, expected] of cases) {
    it(`refuses ${name} with ${expected}`, () => {
      const fixture = completeReleaseFixture({ dir: scratchDirectory('acos-s1l-fail-') });
      break_(fixture);
      const report = verifyReleaseDirectory(
        fixture.releaseRoot,
        fixture.primary.rawPublicKey,
        fixture.secondFactor.rawPublicKey,
      );
      expect(report.verified).toBe(false);
      expect(report.findings.map((finding) => finding.code)).toContain(expected);
    });
  }

  it('an artifact edited AND its entry updated to match is still refused — on the signature', () => {
    // `50 §3e`'s attack table, row 7: step 7 now passes and step 8 fails, because `§3b`'s
    // envelope binds `content_sha256` and a signature over the old digest does not verify
    // over the new one.
    const fixture = completeReleaseFixture({ dir: scratchDirectory('acos-s1l-resign-') });
    const artifactPath = join(fixture.completed.packageRoot, 'class-27.degraded-mode-config.json');
    const mutated = readFileSync(artifactPath, 'utf8').replace('PT30M', 'PT31M');
    writeFileSync(artifactPath, mutated, 'utf8');

    const digest = createHash('sha256').update(Buffer.from(mutated, 'utf8')).digest('hex');

    const manifestPath = join(fixture.completed.packageRoot, 'manifest.json');
    const document = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      entries: { artifact_class: number; content_hash: string }[];
    };
    document.entries.find((entry) => entry.artifact_class === 27)!.content_hash = digest;
    writeFileSync(manifestPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');

    const report = verifyReleaseDirectory(
      fixture.releaseRoot,
      fixture.primary.rawPublicKey,
      fixture.secondFactor.rawPublicKey,
    );
    expect(report.verified).toBe(false);
    // The core moved, so the MANIFEST signature fails first — which is the second, separate
    // leg `50 §3e` says is required alongside the per-artifact one.
    expect(report.findings[0]?.code).toBe('MANIFEST_PRIMARY_SIGNATURE_INVALID');
  });
});
