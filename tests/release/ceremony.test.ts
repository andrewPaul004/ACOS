import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  RELEASE_LAYOUT,
  readCandidateAndPackage,
} from '../../tools/control-release/candidate.js';
import {
  approvePrimaryArtifacts,
  approveSecondFactorAndManifest,
  countersignPrimaryManifest,
} from '../../tools/control-release/ceremony.js';
import { ReleaseRefusal } from '../../tools/control-release/inventory.js';
import { verifyReleaseDirectory } from '../../tools/control-release/verifyRelease.js';
import {
  unsafeSecondSignerSignsDifferentCore,
  unsafeSignBothInOneOperation,
  unsafeSignerRederivesFromSources,
  unsafeWritePrivateKeyIntoRelease,
} from '../negative-controls/unsafe-release-ceremony.js';
import {
  TEST_ONLY_ATTACKER,
  TEST_ONLY_PRIMARY,
  TEST_ONLY_SECOND_FACTOR,
  buildCandidateFixture,
  completeReleaseFixture,
  scratchDirectory,
} from '../support/releaseCeremonyFixture.js';
import { ed25519FromSeed } from '../../tools/control-artifacts/framing.js';
import {
  TEST_ONLY_PRIMARY_SEED,
  defaultControlArtifactFixture,
} from '../support/controlArtifactFixture.js';

/**
 * `§14`–`§19` AND `§33` — THE TWO-CUSTODIAN CEREMONY.
 *
 * =================================================================================
 * WHAT THE REPOSITORY CAN PROVE, AND WHAT IT CANNOT — `§38`, VERBATIM
 *
 *   "**Do not claim actual human separation from an automated unit test.**
 *    What the repository may prove:
 *      * independent signing operations;
 *      * distinct keys;
 *      * same candidate identity;
 *      * neither operation can substitute the other.
 *    **Actual human custody is operational evidence outside tests.**"
 *
 * Every assertion below is one of those four. None of them claims that two people were in
 * the room, and `tests/release/release-boundaries.test.ts` records the distinction as a
 * documented residual rather than a proved property.
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

function fileState(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of readdirSync(root).sort()) {
    const path = join(root, name);
    if (statSync(path).isDirectory()) continue;
    out[name] = readFileSync(path).toString('base64');
  }
  return out;
}

describe('§14 — three separate operations, and no operation holds two keys', () => {
  it('the whole ceremony completes and the release verifies offline', () => {
    const fixture = completeReleaseFixture();
    const report = verifyReleaseDirectory(
      fixture.releaseRoot,
      fixture.primary.rawPublicKey,
      fixture.secondFactor.rawPublicKey,
    );
    expect(report.findings).toEqual([]);
    expect(report.verified).toBe(true);
    expect(report.manifestId).toBe(fixture.completed.manifestId);
    expect(report.entries.map((entry) => entry.artifactClass)).toEqual([2, 3, 5, 19, 20, 24, 27, 28]);
  });

  it('every ceremony entry point takes EXACTLY ONE signer', () => {
    // `§14`: "The second signer must not simply call `sign-both` using both private keys in
    // one process invocation". The property is asserted over the exported signatures: a
    // function that could hold two keys would have to declare two, and none does.
    expect(approvePrimaryArtifacts.length).toBe(2);
    expect(approveSecondFactorAndManifest.length).toBe(2);
    expect(countersignPrimaryManifest.length).toBe(2);

    // And no module under `tools/control-release/` declares a two-signer entry point.
    for (const file of readdirSync(join('tools', 'control-release'))) {
      if (!file.endsWith('.ts')) continue;
      const source = readFileSync(join('tools', 'control-release', file), 'utf8');
      expect(source, `${file} offers a two-key operation`).not.toMatch(
        /secondFactor\s*:\s*SignerIdentity[\s\S]{0,200}primary\s*:\s*SignerIdentity/,
      );
    }
  });

  it('the manifest identity does not exist until BOTH custodians have approved', () => {
    const fixture = buildCandidateFixture();
    const candidateDocument = readFileSync(
      join(fixture.releaseRoot, RELEASE_LAYOUT.candidateFile),
      'utf8',
    );
    // 50 §3d puts both per-entry signatures inside the core, so nothing in the candidate is
    // or contains a manifest identity.
    expect(candidateDocument).not.toContain('manifest_id');

    approvePrimaryArtifacts(fixture.releaseRoot, TEST_ONLY_PRIMARY());
    // Still no manifest.json: the primary alone cannot determine the core.
    expect(readdirSync(fixture.written.packageRoot)).not.toContain('manifest.json');

    const second = approveSecondFactorAndManifest(fixture.releaseRoot, TEST_ONLY_SECOND_FACTOR());
    expect(second.manifestId).toMatch(/^[0-9a-f]{64}$/);
    // And STILL no package manifest: the primary's countersignature completes the release.
    expect(readdirSync(fixture.written.packageRoot)).not.toContain('manifest.json');

    const completed = countersignPrimaryManifest(fixture.releaseRoot, TEST_ONLY_PRIMARY());
    expect(completed.manifestId).toBe(second.manifestId);
    expect(readdirSync(fixture.written.packageRoot)).toContain('manifest.json');
  });
});

describe('§17 / §18 — the same reviewed identity survives both approvals, unchanged', () => {
  it('neither approval modifies an artifact byte or the candidate document', () => {
    const fixture = buildCandidateFixture();
    const before = fileState(fixture.written.packageRoot);
    const candidateBefore = readFileSync(join(fixture.releaseRoot, RELEASE_LAYOUT.candidateFile));

    const primary = approvePrimaryArtifacts(fixture.releaseRoot, TEST_ONLY_PRIMARY());
    expect(fileState(fixture.written.packageRoot)).toEqual(before);

    const second = approveSecondFactorAndManifest(fixture.releaseRoot, TEST_ONLY_SECOND_FACTOR());
    expect(fileState(fixture.written.packageRoot)).toEqual(before);

    expect(readFileSync(join(fixture.releaseRoot, RELEASE_LAYOUT.candidateFile))).toEqual(
      candidateBefore,
    );
    // Both approvals name the SAME reviewed identity.
    expect(primary.candidateId).toBe(fixture.written.candidate.candidateId);
    expect(second.candidateId).toBe(fixture.written.candidate.candidateId);
    // And they were produced under DISTINCT keys.
    expect(second.signerKeyId).not.toBe(primary.signerKeyId);
  });

  it('a package edited between the two approvals stops the ceremony', () => {
    const fixture = buildCandidateFixture();
    approvePrimaryArtifacts(fixture.releaseRoot, TEST_ONLY_PRIMARY());

    // One byte, in an artifact the primary already approved.
    const path = join(fixture.written.packageRoot, 'class-27.degraded-mode-config.json');
    writeFileSync(path, readFileSync(path, 'utf8').replace('PT30M', 'PT6H'), 'utf8');

    expect(
      refusalCode(() => approveSecondFactorAndManifest(fixture.releaseRoot, TEST_ONLY_SECOND_FACTOR())),
    ).toBe('RELEASE_PACKAGE_DIGEST_MISMATCH');
  });

  it('a hand-edited candidate identity is caught the moment any step opens the file', () => {
    const fixture = buildCandidateFixture();
    const path = join(fixture.releaseRoot, RELEASE_LAYOUT.candidateFile);
    writeFileSync(
      path,
      readFileSync(path, 'utf8').replace(fixture.written.candidate.candidateId, 'f'.repeat(64)),
      'utf8',
    );
    expect(refusalCode(() => approvePrimaryArtifacts(fixture.releaseRoot, TEST_ONLY_PRIMARY()))).toBe(
      'RELEASE_CANDIDATE_IDENTITY_MISMATCH',
    );
  });

  it('VULNERABLE CONTROL 2 — a signer that re-derives from the sources signs an unreviewed edit', () => {
    const fixture = buildCandidateFixture();
    const sourceDir = join(fixture.baseDir, 'sources');

    // An edit made to the SOURCE tree after the candidate was built and reviewed.
    const sourcePath = join(sourceDir, 'class-27.degraded-mode-config.json');
    writeFileSync(sourcePath, readFileSync(sourcePath, 'utf8').replace('PT30M', 'PT6H'), 'utf8');

    // THE DEFECT: it signs the edited bytes and still reports the reviewed candidate id.
    const unsafe = unsafeSignerRederivesFromSources(
      fixture.releaseRoot,
      sourceDir,
      TEST_ONLY_PRIMARY(),
    );
    expect(unsafe.claimedCandidateId).toBe(fixture.written.candidate.candidateId);

    // PRODUCTION: it signs the REVIEWED package bytes, so its class-27 signature differs
    // from the one the unsafe signer produced over the edited source.
    const approval = approvePrimaryArtifacts(fixture.releaseRoot, TEST_ONLY_PRIMARY());
    expect(approval.artifactSignatures['27']).not.toBe(unsafe.signatures['27']);
    // Every other artifact, unedited, signs identically — so the difference is caused by the
    // edit and by nothing else.
    expect(approval.artifactSignatures['20']).toBe(unsafe.signatures['20']);
  });

  it('VULNERABLE CONTROL 4 — a second signer that signs a different core is refused at countersign', () => {
    const fixture = buildCandidateFixture();
    const primaryApproval = approvePrimaryArtifacts(fixture.releaseRoot, TEST_ONLY_PRIMARY());
    const primarySignatures = new Map(
      Object.entries(primaryApproval.artifactSignatures).map(
        ([key, hex]) => [Number(key), Buffer.from(hex, 'hex')] as const,
      ),
    );

    // THE DEFECT: the second custodian silently edits one entry's version and signs THAT
    // core, while recording the reviewed candidate id.
    const unsafe = unsafeSecondSignerSignsDifferentCore(
      fixture.releaseRoot,
      TEST_ONLY_SECOND_FACTOR(),
      primarySignatures,
    );
    expect(unsafe.claimedCandidateId).toBe(fixture.written.candidate.candidateId);

    // PRODUCTION: the honest second approval computes a DIFFERENT manifest identity from the
    // one the unsafe signer produced, because the unsafe core is not the reviewed core.
    const honest = approveSecondFactorAndManifest(fixture.releaseRoot, TEST_ONLY_SECOND_FACTOR());
    expect(honest.manifestId).not.toBe(unsafe.manifestId);

    // And if the unsafe identity is written into the second approval, the primary's
    // countersignature refuses rather than completing a release nobody reviewed.
    const approvalPath = join(
      fixture.releaseRoot,
      RELEASE_LAYOUT.approvalsDir,
      RELEASE_LAYOUT.secondFactorApproval,
    );
    writeFileSync(
      approvalPath,
      // The `manifest_id` FIELD specifically: the document carries the same digest twice and
      // a bare string replace would change `manifest_core_sha256` instead.
      readFileSync(approvalPath, 'utf8').replace(
        `"manifest_id": "${honest.manifestId}"`,
        `"manifest_id": "${unsafe.manifestId}"`,
      ),
      'utf8',
    );
    expect(refusalCode(() => countersignPrimaryManifest(fixture.releaseRoot, TEST_ONLY_PRIMARY()))).toBe(
      'RELEASE_MANIFEST_IDENTITY_DISAGREES',
    );
  });
});

describe('§15 / §19 — signer roles and key identity', () => {
  it('a signer whose key_id is not the candidate’s expected one is refused', () => {
    const fixture = buildCandidateFixture();
    expect(refusalCode(() => approvePrimaryArtifacts(fixture.releaseRoot, TEST_ONLY_ATTACKER()))).toBe(
      'RELEASE_SIGNER_KEY_ID_UNEXPECTED',
    );
  });

  it('the PRIMARY key cannot stand in for the SECOND_FACTOR, whatever the role claims', () => {
    // `50 §3a`: "A second signature produced under the primary key does not satisfy the
    // second-factor requirement, whatever its `signer_role` claims."
    const fixture = buildCandidateFixture();
    approvePrimaryArtifacts(fixture.releaseRoot, TEST_ONLY_PRIMARY());
    expect(
      refusalCode(() => approveSecondFactorAndManifest(fixture.releaseRoot, TEST_ONLY_PRIMARY())),
    ).toBe('RELEASE_SIGNER_KEY_ID_UNEXPECTED');
  });

  it('the second approval refuses to run before the primary’s', () => {
    const fixture = buildCandidateFixture();
    expect(
      refusalCode(() => approveSecondFactorAndManifest(fixture.releaseRoot, TEST_ONLY_SECOND_FACTOR())),
    ).toBe('RELEASE_APPROVAL_MISSING');
  });

  it('the countersignature refuses to run before the second approval', () => {
    const fixture = buildCandidateFixture();
    approvePrimaryArtifacts(fixture.releaseRoot, TEST_ONLY_PRIMARY());
    expect(refusalCode(() => countersignPrimaryManifest(fixture.releaseRoot, TEST_ONLY_PRIMARY()))).toBe(
      'RELEASE_APPROVAL_MISSING',
    );
  });
});

describe('§14 / §38 — VULNERABLE CONTROL 3: one operation holding both private keys', () => {
  it('produces a CRYPTOGRAPHICALLY VALID package with no independent approval boundary', () => {
    const fixture = buildCandidateFixture();

    // THE DEFECT: one call, both private halves, no review between them.
    const unsafe = unsafeSignBothInOneOperation(
      fixture.releaseRoot,
      TEST_ONLY_PRIMARY(),
      TEST_ONLY_SECOND_FACTOR(),
    );
    // It verifies. It MUST verify — two distinct keys really did sign it — which is exactly
    // why the protection cannot be cryptographic and has to be operational.
    const report = verifyReleaseDirectory(
      fixture.releaseRoot,
      TEST_ONLY_PRIMARY().rawPublicKey,
      TEST_ONLY_SECOND_FACTOR().rawPublicKey,
    );
    expect(report.verified).toBe(true);
    expect(report.manifestId).toBe(unsafe.manifestId);

    // WHAT DISCRIMINATES: the real ceremony leaves THREE separate approval records, each
    // naming its own signer key id and each produced by a call that could hold one key. The
    // one-shot defect leaves none of them, so an auditor asking "who approved this, and
    // when did each of them see it" has nothing to read.
    const approvals = readdirSync(join(fixture.releaseRoot, RELEASE_LAYOUT.approvalsDir));
    expect(approvals).toEqual([]);

    const honest = completeReleaseFixture({ dir: scratchDirectory('acos-s1l-honest-') });
    expect(readdirSync(join(honest.releaseRoot, RELEASE_LAYOUT.approvalsDir)).sort()).toEqual([
      RELEASE_LAYOUT.primaryArtifactApproval,
      RELEASE_LAYOUT.primaryManifestApproval,
      RELEASE_LAYOUT.secondFactorApproval,
    ]);
    // The same manifest identity — the ceremony changes the EVIDENCE, not the bytes.
    expect(honest.completed.manifestId).toBe(unsafe.manifestId);
  });

  it('and the repository does NOT claim this proves human custody separation (§38)', () => {
    // What it proves: two independent operations, two distinct keys, one candidate identity,
    // and neither operation able to substitute for the other. Actual custody is operational
    // evidence and is recorded as an open obligation in S1L-result.md.
    const fixture = completeReleaseFixture();
    const primaryApproval = JSON.parse(
      readFileSync(
        join(fixture.releaseRoot, RELEASE_LAYOUT.approvalsDir, RELEASE_LAYOUT.primaryArtifactApproval),
        'utf8',
      ),
    ) as { signer_key_id: string };
    const secondApproval = JSON.parse(
      readFileSync(
        join(fixture.releaseRoot, RELEASE_LAYOUT.approvalsDir, RELEASE_LAYOUT.secondFactorApproval),
        'utf8',
      ),
    ) as { signer_key_id: string };
    expect(primaryApproval.signer_key_id).not.toBe(secondApproval.signer_key_id);
  });
});

describe('§35 — VULNERABLE CONTROL 5: a private key copied into the release output', () => {
  it('the real ceremony writes no private material anywhere in the release', () => {
    const fixture = completeReleaseFixture();
    const seedHex = TEST_ONLY_PRIMARY_SEED.toString('hex');
    const pem = ed25519FromSeed(TEST_ONLY_PRIMARY_SEED)
      .privateKey.export({ format: 'pem', type: 'pkcs8' })
      .toString();

    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory()
          ? walk(join(dir, entry.name))
          : [readFileSync(join(dir, entry.name)).toString('binary')],
      );
    for (const content of walk(fixture.releaseRoot)) {
      expect(content).not.toContain('PRIVATE KEY');
      expect(content).not.toContain(seedHex);
      expect(content).not.toContain(pem.split('\n')[1] ?? 'UNREACHABLE');
    }
  });

  it('VULNERABLE CONTROL 5 — the defect puts it there, and the same scan finds it', () => {
    const fixture = completeReleaseFixture({ dir: scratchDirectory('acos-s1l-leak-') });
    unsafeWritePrivateKeyIntoRelease(
      fixture.releaseRoot,
      ed25519FromSeed(TEST_ONLY_PRIMARY_SEED).privateKey,
    );
    const contents = readdirSync(fixture.releaseRoot)
      .filter((name) => name.endsWith('.pem'))
      .map((name) => readFileSync(join(fixture.releaseRoot, name), 'utf8'));
    expect(contents.some((text) => text.includes('PRIVATE KEY'))).toBe(true);
  });
});

describe('§33 — a byte-changing release needs a whole new ceremony', () => {
  it('a whitespace-only edit produces a different identity and unusable old signatures', () => {
    const base = completeReleaseFixture({ dir: scratchDirectory('acos-s1l-ws-a-') });
    const original = readFileSync(
      join(base.completed.packageRoot, 'class-27.degraded-mode-config.json'),
    );
    const respaced = Buffer.from(original.toString('utf8').replace('{\n', '{\n\n'), 'utf8');

    const edited = completeReleaseFixture({
      dir: scratchDirectory('acos-s1l-ws-b-'),
      overrides: [{ artifactClass: 27, bytes: respaced }],
    });

    expect(edited.written.candidate.candidateId).not.toBe(base.written.candidate.candidateId);
    expect(edited.completed.manifestId).not.toBe(base.completed.manifestId);

    // The old signatures do not carry forward: `50 §3b` binds `content_sha256`.
    const oldManifest = JSON.parse(
      readFileSync(join(base.completed.packageRoot, 'manifest.json'), 'utf8'),
    ) as { entries: { artifact_class: number; primary_signature: string }[] };
    const newManifest = JSON.parse(
      readFileSync(join(edited.completed.packageRoot, 'manifest.json'), 'utf8'),
    ) as { entries: { artifact_class: number; primary_signature: string }[] };
    const oldClass27 = oldManifest.entries.find((entry) => entry.artifact_class === 27)!;
    const newClass27 = newManifest.entries.find((entry) => entry.artifact_class === 27)!;
    expect(newClass27.primary_signature).not.toBe(oldClass27.primary_signature);
  });

  it('a release with an OLD signature spliced in fails offline verification', () => {
    const base = completeReleaseFixture({ dir: scratchDirectory('acos-s1l-splice-a-') });
    const edited = completeReleaseFixture({
      dir: scratchDirectory('acos-s1l-splice-b-'),
      manifestEpoch: '2',
    });

    const oldManifest = JSON.parse(
      readFileSync(join(base.completed.packageRoot, 'manifest.json'), 'utf8'),
    ) as Record<string, unknown>;
    const target = join(edited.completed.packageRoot, 'manifest.json');
    const current = JSON.parse(readFileSync(target, 'utf8')) as Record<string, unknown>;
    // Carry the OLD manifest signatures forward onto the new core.
    current.primary_signature = oldManifest.primary_signature;
    current.second_factor_signature = oldManifest.second_factor_signature;
    writeFileSync(target, `${JSON.stringify(current, null, 2)}\n`, 'utf8');

    const report = verifyReleaseDirectory(
      edited.releaseRoot,
      edited.primary.rawPublicKey,
      edited.secondFactor.rawPublicKey,
    );
    expect(report.verified).toBe(false);
    expect(report.findings[0]?.code).toBe('MANIFEST_PRIMARY_SIGNATURE_INVALID');
  });
});

describe('the S1K one-shot signer and the S1L ceremony agree on the manifest identity', () => {
  it('the same artifacts, epoch and keys produce ONE manifest_id through either assembler', () => {
    // `tests/support/controlArtifactFixture.ts` assembles a package with S1K's
    // `buildSignedManifest` — one call, both keys, no approval records. The S1L ceremony
    // assembles the same release through three separate one-key operations. They share
    // `50 §3b`'s framing oracle and NOTHING else: the entry ordering, the header, the core
    // layout and the signature slots are assembled independently.
    //
    // They agree, which is what `§6`'s determinism means in practice and is also why the
    // ceremony's extra evidence costs nothing at the deployment boundary.
    const ceremony = completeReleaseFixture({ dir: scratchDirectory('acos-s1l-agree-') });
    expect(ceremony.completed.manifestId).toBe(defaultControlArtifactFixture().manifestId);
  });
});

describe('the reviewed package and the deployable package are the same bytes', () => {
  it('the candidate’s digests are the package’s digests, re-derived on every read', () => {
    const fixture = completeReleaseFixture();
    const { candidate, bytesByClass } = readCandidateAndPackage(fixture.releaseRoot);
    for (const entry of candidate.entries) {
      const bytes = bytesByClass.get(entry.artifactClass)!;
      expect(bytes.length).toBe(entry.byteLength);
    }
  });
});
