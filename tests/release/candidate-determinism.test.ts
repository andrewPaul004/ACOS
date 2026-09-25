import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  RELEASE_LAYOUT,
  buildReleaseCandidate,
  writeReleaseCandidate,
} from '../../tools/control-release/candidate.js';
import { ReleaseRefusal } from '../../tools/control-release/inventory.js';
import { unsafeNonDeterministicCandidateId } from '../negative-controls/unsafe-release-ceremony.js';
import {
  RELEASE_ARTIFACT_SPECS,
  buildCandidateFixture,
  completeReleaseFixture,
  scratchDirectory,
  stageReleaseInputs,
} from '../support/releaseCeremonyFixture.js';

/**
 * `§5`, `§6`, `§7`, `§10` AND `§34` — THE DETERMINISTIC, CLOSED, UNSIGNED CANDIDATE.
 *
 * =================================================================================
 * `§6`, VERBATIM
 *
 *   "Given identical artifact bytes and identical declared versions: two candidate builds
 *    must produce: byte-identical artifact package; byte-identical manifest core; identical
 *    artifact digests; identical manifest identity."
 *
 * `§34`: "clean checkout A and clean checkout B of same commit / exact artifact inputs.
 * Candidate output: byte-identical authority core and same manifest ID."
 *
 * Two separate temporary trees stand in for two clean checkouts: different absolute paths,
 * different temporary directory names, the same artifact bytes. If any path, clock or
 * process value reached an identity, these two would differ.
 * =================================================================================
 */

function refusalCode(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof ReleaseRefusal) return error.code;
    return `UNEXPECTED: ${String(error)}`;
  }
  return 'NO REFUSAL';
}

describe('§6 / §34 — the release candidate is a pure function of its inputs', () => {
  it('two builds in two separate trees produce the SAME candidate identity', () => {
    const a = buildCandidateFixture({ dir: scratchDirectory('acos-s1l-checkout-a-') });
    const b = buildCandidateFixture({ dir: scratchDirectory('acos-s1l-checkout-b-') });

    expect(a.baseDir).not.toBe(b.baseDir);
    expect(b.written.candidate.candidateId).toBe(a.written.candidate.candidateId);
    expect(b.written.candidate.entries).toEqual(a.written.candidate.entries);

    // And byte-identical candidate documents and package files.
    expect(readFileSync(join(b.releaseRoot, RELEASE_LAYOUT.candidateFile), 'utf8')).toBe(
      readFileSync(join(a.releaseRoot, RELEASE_LAYOUT.candidateFile), 'utf8'),
    );
    for (const spec of RELEASE_ARTIFACT_SPECS) {
      expect(readFileSync(join(b.written.packageRoot, spec.fileName))).toEqual(
        readFileSync(join(a.written.packageRoot, spec.fileName)),
      );
    }
  });

  it('two COMPLETE ceremonies over the same inputs produce the same manifest_id', () => {
    // Ed25519 is RFC 8032 PureEdDSA and therefore deterministic: the same key over the same
    // message produces the same 64 bytes. So reproducibility survives signing, and a third
    // party holding the same inputs and the same keys can reproduce the release exactly.
    const a = completeReleaseFixture({ dir: scratchDirectory('acos-s1l-repro-a-') });
    const b = completeReleaseFixture({ dir: scratchDirectory('acos-s1l-repro-b-') });

    expect(b.completed.manifestId).toBe(a.completed.manifestId);
    expect(readFileSync(join(b.completed.packageRoot, 'manifest.json'), 'utf8')).toBe(
      readFileSync(join(a.completed.packageRoot, 'manifest.json'), 'utf8'),
    );
  });

  it('NON-AUTHORITY metadata does not move either identity', () => {
    // `§34`: "Where non-authority review metadata includes timestamps, exclude it from
    // signed identity and label it non-authoritative."
    const plain = completeReleaseFixture({ dir: scratchDirectory('acos-s1l-plain-') });
    const annotated = completeReleaseFixture({
      dir: scratchDirectory('acos-s1l-annotated-'),
      note: 'built 2026-09-24T17:00:00Z on release-host-7 by the duty custodian',
    });

    expect(annotated.written.candidate.candidateId).toBe(plain.written.candidate.candidateId);
    expect(annotated.completed.manifestId).toBe(plain.completed.manifestId);

    const metadata = readFileSync(
      join(annotated.releaseRoot, RELEASE_LAYOUT.metadataFile),
      'utf8',
    );
    expect(metadata).toContain('NOT_AUTHORITATIVE');
    expect(metadata).toContain('release-host-7');
    // And the note is nowhere inside the signed package.
    for (const file of readdirSync(annotated.completed.packageRoot)) {
      expect(readFileSync(join(annotated.completed.packageRoot, file), 'utf8')).not.toContain(
        'release-host-7',
      );
    }
  });

  it('the release channel label does not move either identity either', () => {
    // The decisive separation between a test release and a production one is the KEY, not
    // the label: a different key derives a different `key_id`, which moves the core. The
    // label is legibility, and this test says so by showing it moves nothing.
    const test = completeReleaseFixture({ dir: scratchDirectory('acos-s1l-chan-t-') });
    const production = completeReleaseFixture({
      dir: scratchDirectory('acos-s1l-chan-p-'),
      releaseChannel: 'PRODUCTION',
    });
    expect(production.completed.manifestId).toBe(test.completed.manifestId);
  });

  it('VULNERABLE CONTROL 1 — a candidate identity carrying the clock is not reproducible', () => {
    const a = buildCandidateFixture({ dir: scratchDirectory('acos-s1l-vc1-a-') });
    const b = buildCandidateFixture({ dir: scratchDirectory('acos-s1l-vc1-b-') });

    // PRODUCTION: two builds, two trees, two moments — ONE identity.
    expect(b.written.candidate.candidateId).toBe(a.written.candidate.candidateId);

    // THE DEFECT: the same two builds, with each machine's own build stamp inside the
    // identity, no longer agree — so the second custodian can never approve what the first
    // reviewed, and reproducibility is gone.
    expect(unsafeNonDeterministicCandidateId(b.written.candidate, '1758726000000:4242')).not.toBe(
      unsafeNonDeterministicCandidateId(a.written.candidate, '1758726000001:9191'),
    );

    // And the production identity really is recomputed, not cached.
    expect(buildReleaseCandidate(a.declaration, a.baseDir).candidate.candidateId).toBe(
      a.written.candidate.candidateId,
    );
  });
});

describe('§7 — the artifact inventory is CLOSED, and every violation is a refusal', () => {
  it('a missing required artifact is refused', () => {
    const staged = stageReleaseInputs({ omitClasses: [27] });
    expect(refusalCode(() => buildReleaseCandidate(staged.declaration, staged.baseDir))).toBe(
      'RELEASE_REQUIRED_ARTIFACT_MISSING',
    );
  });

  it('the RETIRED class 17 is refused rather than ignored', () => {
    const staged = stageReleaseInputs({
      extraArtifacts: [
        {
          artifactClass: 17,
          artifactId: 'acos.control.window_registry',
          artifactVersion: 'v1',
          packageFileName: 'class-17.windows.json',
          sourcePath: 'sources/class-27.degraded-mode-config.json',
        },
      ],
    });
    expect(refusalCode(() => buildReleaseCandidate(staged.declaration, staged.baseDir))).toBe(
      'RELEASE_RETIRED_CLASS_PRESENT',
    );
  });

  it('a class outside 50 §6’s closed set is refused', () => {
    const staged = stageReleaseInputs({
      extraArtifacts: [
        {
          artifactClass: 25,
          artifactId: 'acos.control.override_limits',
          artifactVersion: 'v1',
          packageFileName: 'class-25.override-limits.json',
          sourcePath: 'sources/class-27.degraded-mode-config.json',
        },
      ],
    });
    expect(refusalCode(() => buildReleaseCandidate(staged.declaration, staged.baseDir))).toBe(
      'RELEASE_UNKNOWN_CLASS',
    );
  });

  it('a duplicate class is refused — the runtime resolves BY CLASS', () => {
    const staged = stageReleaseInputs({
      extraArtifacts: [
        {
          artifactClass: 27,
          artifactId: 'acos.control.degraded_mode_config',
          artifactVersion: 'acos.degraded_mode_config.2026-09-24',
          packageFileName: 'class-27.alternative.json',
          sourcePath: 'sources/class-27.degraded-mode-config.json',
        },
      ],
    });
    expect(refusalCode(() => buildReleaseCandidate(staged.declaration, staged.baseDir))).toBe(
      'RELEASE_DUPLICATE_CLASS',
    );
  });

  it('two artifacts competing for ONE package file name are refused — no first-match rule', () => {
    const staged = stageReleaseInputs({ omitClasses: [27] });
    const artifacts = [
      ...staged.declaration.artifacts,
      {
        artifactClass: 27,
        artifactId: 'acos.control.degraded_mode_config',
        artifactVersion: 'acos.degraded_mode_config.2026-09-24',
        // The class-3 file name, claimed by a second artifact.
        packageFileName: 'class-03.action-catalogue.json',
        sourcePath: join('sources', 'class-03.action-catalogue.json'),
      },
    ];
    expect(
      refusalCode(() =>
        buildReleaseCandidate({ ...staged.declaration, artifacts }, staged.baseDir),
      ),
    ).toBe('RELEASE_DUPLICATE_PACKAGE_FILE');
  });

  it('an artifact whose own bytes declare a different version is refused', () => {
    const staged = stageReleaseInputs();
    const artifacts = staged.declaration.artifacts.map((artifact) =>
      artifact.artifactClass === 3
        ? { ...artifact, artifactVersion: 'acos.action_catalogue.9999-01-01' }
        : artifact,
    );
    expect(
      refusalCode(() =>
        buildReleaseCandidate({ ...staged.declaration, artifacts }, staged.baseDir),
      ),
    ).toBe('RELEASE_ARTIFACT_SELF_DECLARATION_MISMATCH');
  });

  it('class 20’s version is fixed by 50 §6 and a different one is refused', () => {
    const staged = stageReleaseInputs();
    const artifacts = staged.declaration.artifacts.map((artifact) =>
      artifact.artifactClass === 20 ? { ...artifact, artifactVersion: 'ACOS-JCS-2' } : artifact,
    );
    expect(
      refusalCode(() =>
        buildReleaseCandidate({ ...staged.declaration, artifacts }, staged.baseDir),
      ),
    ).toBe('RELEASE_ARTIFACT_VERSION_UNEXPECTED');
  });

  it('one key in both root slots is refused at BUILD time, not left for the deployment', () => {
    const primary = stageReleaseInputs();
    const declaration = {
      ...primary.declaration,
      secondFactorPublicKeyHex: primary.declaration.primaryPublicKeyHex,
    };
    expect(refusalCode(() => buildReleaseCandidate(declaration, primary.baseDir))).toBe(
      'RELEASE_TRUST_ROOTS_NOT_DISTINCT',
    );
  });
});

describe('§10 — class 20 is hashed as EXACT BYTES, and a line ending is a different artifact', () => {
  it('a CRLF copy of the specification changes the release identity', () => {
    const lf = buildCandidateFixture({ dir: scratchDirectory('acos-s1l-lf-') });
    const original = readFileSync(join(lf.written.packageRoot, 'class-20.acos-jcs-1.spec.v1.txt'));
    const crlf = Buffer.from(original.toString('utf8').replace(/\n/g, '\r\n'), 'utf8');
    expect(crlf.equals(original)).toBe(false);

    const mutated = buildCandidateFixture({
      dir: scratchDirectory('acos-s1l-crlf-'),
      overrides: [{ artifactClass: 20, bytes: crlf }],
    });

    const before = lf.written.candidate.entries.find((entry) => entry.artifactClass === 20)!;
    const after = mutated.written.candidate.entries.find((entry) => entry.artifactClass === 20)!;
    expect(after.contentHash).not.toBe(before.contentHash);
    expect(mutated.written.candidate.candidateId).not.toBe(lf.written.candidate.candidateId);
  });

  it('a trailing-newline change is a different artifact too (§33)', () => {
    const base = buildCandidateFixture({ dir: scratchDirectory('acos-s1l-nl-a-') });
    const original = readFileSync(join(base.written.packageRoot, 'class-27.degraded-mode-config.json'));
    const extraNewline = Buffer.concat([original, Buffer.from('\n', 'utf8')]);

    const mutated = buildCandidateFixture({
      dir: scratchDirectory('acos-s1l-nl-b-'),
      overrides: [{ artifactClass: 27, bytes: extraNewline }],
    });
    expect(mutated.written.candidate.candidateId).not.toBe(base.written.candidate.candidateId);
  });

  it('the release tool copies artifact bytes EXACTLY — no reserialisation, no repair', () => {
    const crlf = Buffer.from(
      readFileSync(join(stageReleaseInputs().baseDir, 'sources', 'class-20.acos-jcs-1.spec.v1.txt'))
        .toString('utf8')
        .replace(/\n/g, '\r\n'),
      'utf8',
    );
    const staged = stageReleaseInputs({ overrides: [{ artifactClass: 20, bytes: crlf }] });
    const releaseRoot = join(staged.baseDir, 'release');
    const written = writeReleaseCandidate(releaseRoot, staged.declaration, staged.baseDir);
    const inPackage = readFileSync(
      join(written.packageRoot, 'class-20.acos-jcs-1.spec.v1.txt'),
    );
    expect(inPackage.equals(crlf)).toBe(true);
    expect(inPackage.includes(0x0d)).toBe(true);
  });
});
