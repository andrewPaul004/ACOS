import { createHash, createPublicKey, verify as edVerify, type KeyObject } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ConstructorVersionResolver,
  type ConstructorVersionRecord,
} from '../../src/kernel/canonicalisation/constructorVersion.js';
import {
  oracleArtifactMessage,
  oracleManifestCore,
  oracleManifestMessage,
  oracleSha256,
  type OracleManifestEntry,
  type OracleManifestHeader,
} from '../../tools/control-artifacts/framing.js';
import {
  RELEASE_LAYOUT,
  readCandidateAndPackage,
  releaseJson,
  type CandidateEntry,
  type ReleaseCandidate,
} from '../../tools/control-release/candidate.js';
import { decodeClass2, decodeClass3 } from '../../tools/control-release/decode.js';
import type { SignerIdentity } from '../../tools/control-release/signerKey.js';

/**
 * THE FOURTEEN TEST-ONLY VULNERABLE RELEASE/DEPLOYMENT CONTROLS OF `§49`.
 *
 * =================================================================================
 * WHY THESE EXIST — the repository's doctrine, applied to the release ceremony
 *
 * **A control that has never failed is indistinguishable from one that cannot.** A test that
 * asserts the real ceremony refuses a forged approval proves nothing on its own: a ceremony
 * that refused everything would pass it. The discriminating form is a SECOND implementation
 * that makes the specific mistake, run against the SAME fixture, which ACCEPTS what the real
 * one refuses.
 *
 * Each of the fourteen below is a REAL BRANCH rather than a flag that skips a check, so the
 * code a reader sees is the code an unlucky implementer would have written.
 *
 * **NOTHING UNDER `src/` IMPORTS THIS FILE**, and `tests/release/release-boundaries.test.ts`
 * asserts that over the whole production tree.
 * =================================================================================
 */

export type UnsafeReleaseControl =
  | 'NON_DETERMINISTIC_CANDIDATE'
  | 'SIGNER_SILENTLY_MODIFIES_CANDIDATE'
  | 'ONE_OPERATION_HOLDS_BOTH_KEYS'
  | 'SECOND_SIGNER_SIGNS_DIFFERENT_MANIFEST'
  | 'PRIVATE_KEY_COPIED_INTO_RELEASE'
  | 'HIGHEST_SIGNED_EPOCH_SELECTED'
  | 'OLD_PACKAGE_ACTIVATED_WITHOUT_PIN'
  | 'PARTIAL_ROLLOUT_REPORTED_JOINTLY_READY'
  | 'DEPLOYMENT_CHECKER_TRUSTS_CONTROL_FOR_AUDIT'
  | 'CALLER_KEY_ADMITS_UNMANIFESTED_CONSTRUCTOR'
  | 'REVIEW_OMITS_AUTHORITY_CHANGING_CLASS_3_FIELD'
  | 'DIFF_MISSES_DEGRADED_THRESHOLD_CHANGE'
  | 'RUNTIME_IMPORTS_SIGNING_TOOL'
  | 'TEST_SIGNED_RELEASE_MISLABELLED_PRODUCTION';

// ---------------------------------------------------------------------------------
// 1. A NON-DETERMINISTIC RELEASE CANDIDATE.
//
// `§6`: "Given identical artifact bytes and identical declared versions: two candidate
// builds must produce byte-identical artifact package; byte-identical manifest core;
// identical artifact digests; identical manifest identity. [...] Do not inject: build
// machine name; process ID; current clock; random UUID; temp path; Git working-directory
// path."
//
// The defect is one line: a build stamp inside the identity. It looks like provenance and it
// destroys reproducibility, because two custodians reviewing "the same release" now review
// two different identities and the second approval can never match the first.
// ---------------------------------------------------------------------------------
export function unsafeNonDeterministicCandidateId(
  candidate: ReleaseCandidate,
  // THE DEFECT: the clock and the process, inside the identity. The parameter exists so a
  // test can supply two build stamps DETERMINISTICALLY — two machines, two moments — rather
  // than racing the millisecond clock to observe a defect that is plainly visible in the
  // default argument.
  buildStamp: string = `${String(Date.now())}:${String(process.pid)}`,
): string {
  const parts: Buffer[] = [
    Buffer.from(candidate.manifestEpoch, 'utf8'),
    Buffer.from(candidate.expectedPrimaryKeyId, 'utf8'),
    Buffer.from(buildStamp, 'utf8'),
  ];
  for (const entry of candidate.entries) parts.push(Buffer.from(entry.contentHash, 'hex'));
  return createHash('sha256').update(Buffer.concat(parts)).digest('hex');
}

// ---------------------------------------------------------------------------------
// 2. A SIGNER THAT SILENTLY RE-DERIVES THE CANDIDATE FROM THE SOURCES.
//
// `§17`: the signer "MUST NOT: modify artifact bytes; change versions; reorder artifacts;
// update manifest identity. **Signing the wrong candidate must create a different release
// that does not match the previously reviewed identity.**"
//
// The defect is a convenience: "re-read the inputs so we always sign the latest". It means
// an edit made after the review is signed without anybody reviewing it, and the approval
// record still names the candidate that WAS reviewed.
// ---------------------------------------------------------------------------------
export function unsafeSignerRederivesFromSources(
  releaseRoot: string,
  sourceDir: string,
  signer: SignerIdentity,
): { readonly claimedCandidateId: string; readonly signatures: Readonly<Record<string, string>> } {
  const { candidate } = readCandidateAndPackage(releaseRoot);
  const signatures: Record<string, string> = {};
  for (const entry of candidate.entries) {
    // THE DEFECT: the digest comes from the SOURCE tree, not from the reviewed package.
    const bytes = readFileSync(join(sourceDir, entry.packageFileName));
    signatures[String(entry.artifactClass)] = signer
      .sign(
        oracleArtifactMessage('PRIMARY', {
          artifactClass: entry.artifactClass,
          artifactId: entry.artifactId,
          artifactVersion: entry.artifactVersion,
          contentSha256: oracleSha256(bytes),
        }),
      )
      .toString('hex');
  }
  // And it still reports the identity that was REVIEWED.
  return { claimedCandidateId: candidate.candidateId, signatures };
}

// ---------------------------------------------------------------------------------
// 3. ONE OPERATION HOLDING BOTH PRIVATE KEYS.
//
// `§14`: "The second signer must not simply call `sign-both` using both private keys in one
// process invocation unless v1.3.6 explicitly permits that operational model."
//
// The package this produces is CRYPTOGRAPHICALLY VALID. That is exactly why it is dangerous:
// the runtime verifier accepts it, and must, because two distinct keys did sign it. What is
// lost is the only thing the second factor was for — a second custodian who looked.
// ---------------------------------------------------------------------------------
export function unsafeSignBothInOneOperation(
  releaseRoot: string,
  primary: SignerIdentity,
  secondFactor: SignerIdentity,
): { readonly manifestId: string; readonly wroteManifest: boolean } {
  const { candidate } = readCandidateAndPackage(releaseRoot);
  const header = headerOf(candidate);
  const coreEntries: OracleManifestEntry[] = candidate.entries.map((entry) => {
    const identity = identityOf(entry);
    return {
      ...identity,
      // THE DEFECT: both private halves, in one process, with no review boundary between.
      primarySignature: primary.sign(oracleArtifactMessage('PRIMARY', identity)),
      secondFactorSignature: secondFactor.sign(oracleArtifactMessage('SECOND_FACTOR', identity)),
    };
  });
  const coreSha256 = oracleSha256(oracleManifestCore(header, coreEntries));
  const manifestId = coreSha256.toString('hex');
  writeFileSync(
    join(releaseRoot, RELEASE_LAYOUT.packageDir, 'manifest.json'),
    releaseJson({
      manifest_format_version: candidate.manifestFormatVersion,
      manifest_epoch: candidate.manifestEpoch,
      expected_primary_key_id: candidate.expectedPrimaryKeyId,
      expected_second_factor_key_id: candidate.expectedSecondFactorKeyId,
      entry_count: candidate.entryCount,
      entries: candidate.entries.map((entry, index) => ({
        artifact_class: entry.artifactClass,
        artifact_id: entry.artifactId,
        artifact_version: entry.artifactVersion,
        content_hash: entry.contentHash,
        primary_signature: coreEntries[index]!.primarySignature.toString('hex'),
        second_factor_signature: coreEntries[index]!.secondFactorSignature.toString('hex'),
      })),
      primary_signature: primary
        .sign(oracleManifestMessage('PRIMARY', header, coreSha256))
        .toString('hex'),
      second_factor_signature: secondFactor
        .sign(oracleManifestMessage('SECOND_FACTOR', header, coreSha256))
        .toString('hex'),
    }),
    'utf8',
  );
  return { manifestId, wroteManifest: true };
}

// ---------------------------------------------------------------------------------
// 4. A SECOND SIGNER THAT SIGNS A DIFFERENT MANIFEST IDENTITY.
//
// `§18`: it "MUST NOT: recalculate a different candidate silently".
//
// The defect edits one entry on the way through — here, the class-3 version — and signs the
// core that results, while recording the reviewed `candidate_id` in its approval.
// ---------------------------------------------------------------------------------
export function unsafeSecondSignerSignsDifferentCore(
  releaseRoot: string,
  secondFactor: SignerIdentity,
  primarySignatures: ReadonlyMap<number, Buffer>,
): { readonly claimedCandidateId: string; readonly manifestId: string } {
  const { candidate } = readCandidateAndPackage(releaseRoot);
  const header = headerOf(candidate);
  const coreEntries: OracleManifestEntry[] = candidate.entries.map((entry) => ({
    ...identityOf(entry),
    // THE DEFECT: a silent edit inside the second approval.
    artifactVersion:
      entry.artifactClass === 3 ? `${entry.artifactVersion}.hotfix` : entry.artifactVersion,
    primarySignature: primarySignatures.get(entry.artifactClass)!,
    secondFactorSignature: secondFactor.sign(
      oracleArtifactMessage('SECOND_FACTOR', identityOf(entry)),
    ),
  }));
  const manifestId = oracleSha256(oracleManifestCore(header, coreEntries)).toString('hex');
  return { claimedCandidateId: candidate.candidateId, manifestId };
}

// ---------------------------------------------------------------------------------
// 5. A PRIVATE KEY COPIED INTO THE RELEASE OUTPUT.
//
// `§35`: "never copy the key into release output". The defect is a helpful one — "record the
// signing material so the release can be reproduced" — and it turns a release directory, the
// one artefact a release is designed to COPY WIDELY, into a key escrow.
// ---------------------------------------------------------------------------------
export function unsafeWritePrivateKeyIntoRelease(releaseRoot: string, privateKey: KeyObject): void {
  const pkcs8 = privateKey.export({ format: 'pem', type: 'pkcs8' });
  writeFileSync(join(releaseRoot, 'signing-key.pem'), pkcs8.toString(), 'utf8');
}

// ---------------------------------------------------------------------------------
// 6. "THE HIGHEST SIGNED EPOCH ON DISK WINS."
//
// `50 §3e`, verbatim: "**'THE HIGHEST EPOCH FOUND ON DISK' IS NOT ROLLBACK PROTECTION AND IS
// NOT USED.** `manifest_epoch` is recorded for lineage and for operator legibility; **the pin
// is what rejects a rollback.**"
//
// The defect reads like an upgrade path and is a promotion mechanism for anything an attacker
// can put on the filesystem with a large enough number in it.
// ---------------------------------------------------------------------------------
export function unsafeSelectHighestEpoch(
  packageRoots: readonly string[],
): { readonly chosenRoot: string; readonly manifestEpoch: string } | null {
  let best: { chosenRoot: string; manifestEpoch: string } | null = null;
  for (const root of packageRoots) {
    try {
      const document = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')) as Record<
        string,
        unknown
      >;
      const epoch = String(document.manifest_epoch);
      // THE DEFECT: an ordering over a field the architecture says is not a selector.
      if (best === null || Number(epoch) > Number(best.manifestEpoch)) {
        best = { chosenRoot: root, manifestEpoch: epoch };
      }
    } catch {
      // A package that does not parse is simply skipped, which is its own quiet defect.
    }
  }
  return best;
}

// ---------------------------------------------------------------------------------
// 7. A DEPLOYER THAT ACTIVATES ANY CORRECTLY DUAL-SIGNED PACKAGE.
//
// `50 §3e`: "**The runtime may verify a manifest only if its computed `manifest_id` equals
// `EXPECTED_ACTIVE_MANIFEST_ID`.** The pin is checked **before** the signatures, because a
// signature check on a manifest the deployment did not intend proves only that someone once
// signed something."
//
// The defect checks the signatures beautifully and never asks whether this is the release the
// deployment meant to run. Every old signed package on the host becomes activatable.
// ---------------------------------------------------------------------------------
export function unsafeActivateWithoutPin(
  packageRoot: string,
  primaryPublicKey: Buffer,
  secondFactorPublicKey: Buffer,
  configuredPin: string,
): { readonly activated: boolean; readonly manifestId: string | null; readonly pinIgnored: string } {
  try {
    const document = JSON.parse(readFileSync(join(packageRoot, 'manifest.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    const header: OracleManifestHeader = {
      manifestFormatVersion: String(document.manifest_format_version),
      manifestEpoch: String(document.manifest_epoch),
      expectedPrimaryKeyId: String(document.expected_primary_key_id),
      expectedSecondFactorKeyId: String(document.expected_second_factor_key_id),
    };
    const entries = (document.entries as Record<string, unknown>[]).map((row) => ({
      artifactClass: Number(row.artifact_class),
      artifactId: String(row.artifact_id),
      artifactVersion: String(row.artifact_version),
      contentSha256: Buffer.from(String(row.content_hash), 'hex'),
      primarySignature: Buffer.from(String(row.primary_signature), 'hex'),
      secondFactorSignature: Buffer.from(String(row.second_factor_signature), 'hex'),
    }));
    const coreSha256 = oracleSha256(oracleManifestCore(header, entries));
    const manifestId = coreSha256.toString('hex');
    const primaryOk = verifyRaw(
      oracleManifestMessage('PRIMARY', header, coreSha256),
      primaryPublicKey,
      Buffer.from(String(document.primary_signature), 'hex'),
    );
    const secondOk = verifyRaw(
      oracleManifestMessage('SECOND_FACTOR', header, coreSha256),
      secondFactorPublicKey,
      Buffer.from(String(document.second_factor_signature), 'hex'),
    );
    // THE DEFECT: `configuredPin` is accepted as a parameter and never compared.
    return { activated: primaryOk && secondOk, manifestId, pinIgnored: configuredPin };
  } catch {
    return { activated: false, manifestId: null, pinIgnored: configuredPin };
  }
}

// ---------------------------------------------------------------------------------
// 8. A PARTIAL ROLLOUT REPORTED AS JOINT READINESS.
//
// `§26`: "each individually verifies its configured/pinned package but the system-wide
// readiness/pre-live gate MUST NOT claim the release is jointly active".
//
// The defect is an `&&` over two booleans. Both planes did verify — each against its own,
// DIFFERENT, release — and the gate reports the system ready for a release only one of them
// is running.
// ---------------------------------------------------------------------------------
export function unsafeJointReadiness(
  controlVerified: boolean,
  auditVerified: boolean,
  _controlManifestId: string | null,
  _auditManifestId: string | null,
): { readonly jointlyReady: boolean } {
  // THE DEFECT: the two manifest identities are taken as parameters and never compared.
  return { jointlyReady: controlVerified && auditVerified };
}

// ---------------------------------------------------------------------------------
// 9. AN AUDIT VERDICT DERIVED FROM THE CONTROL PLANE'S.
//
// `50 §3` property 2: "**The audit plane recomputes independently.** A manifest check run only
// by the control plane is a check the control plane can pass by lying (`30 §5.2`)."
// `§27`: "Do not let 'control verified R2' serve as evidence 'audit verified R2.'"
//
// The defect saves one verification and removes the entire point of having two planes.
// ---------------------------------------------------------------------------------
export function unsafeAuditVerdictFromControl(controlOutcome: {
  readonly verified: boolean;
  readonly manifestId: string | null;
}): { readonly verified: boolean; readonly manifestId: string | null; readonly recomputed: boolean } {
  // THE DEFECT: the audit plane's verdict IS the control plane's verdict.
  return { verified: controlOutcome.verified, manifestId: controlOutcome.manifestId, recomputed: false };
}

// ---------------------------------------------------------------------------------
// 10. A CALLER-SUPPLIED VERIFICATION KEY ADMITTING AN UNMANIFESTED CONSTRUCTOR.
//
// `50 §3i`: "`ConstructorVersionResolver` takes the verifying public key **as a constructor
// argument** [...] **A CALLER-SUPPLIED VERIFICATION KEY IS NOT A TRUST ROOT**".
//
// This is the S1B arrangement, unchanged and unwrapped. It is not a caricature: it is the
// production class, constructed the way `50 §3i` warns against. `§12`'s attacks A and C both
// succeed here and both fail against
// `src/kernel/canonicalisation/constructorAdmission.ts`.
// ---------------------------------------------------------------------------------
export function unsafeCallerKeyConstructorResolver(
  callerSuppliedVerifyingKey: KeyObject | Buffer,
  callerSuppliedRecords: readonly ConstructorVersionRecord[],
): ConstructorVersionResolver {
  // THE DEFECT: no verified class-19 artifact is consulted. Membership is whatever the
  // caller passed, and the signature is checked against whatever key the caller passed.
  return new ConstructorVersionResolver(callerSuppliedVerifyingKey, callerSuppliedRecords);
}

// ---------------------------------------------------------------------------------
// 11. A RELEASE REVIEW THAT OMITS AN AUTHORITY-CHANGING CLASS-3 FIELD.
//
// `§31`: "For class 3 show at least current: action classes; recoverability; **adapter**;
// **external-dispatch setting**; irrecoverable units."
//
// The defect shows a tidy summary. A change of `adapter` from `mock_processor` to
// `internal_only` — which `50 §2f` says "removes an effect from the outbox entirely" — leaves
// this report byte-identical, so the owner approves a change they were never shown.
// ---------------------------------------------------------------------------------
export function unsafeReleaseReviewOmittingAdapter(class3Bytes: Buffer): string {
  const decoded = decodeClass3(class3Bytes);
  const lines = ['CLASS 3 — ACTION CATALOGUE', `version ${decoded.artifactVersion}`];
  for (const entry of decoded.actionClasses) {
    // THE DEFECT: `adapter`, `method` and the derived external-dispatch setting are not shown.
    lines.push(
      `  ${entry.actionClass}: ${entry.recoverability}, units=${entry.irrecoverableUnits}`,
    );
  }
  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------------
// 12. A RELEASE DIFF THAT NEVER LOOKS AT CLASS 27.
//
// `§32`: the diff "should display authority-relevant changes such as: [...] **degraded
// thresholds changed**".
//
// The defect is a scoping decision that sounds reasonable — "diff the policy-bearing
// classes" — and it hides the one quantity that decides whether the company halts when the
// audit plane cannot be reached.
// ---------------------------------------------------------------------------------
export function unsafeDiffIgnoringDegradedConfiguration(
  beforeRoot: string,
  afterRoot: string,
): readonly string[] {
  const before = readCandidateAndPackage(beforeRoot);
  const after = readCandidateAndPackage(afterRoot);
  const changes: string[] = [];
  // THE DEFECT: only classes 2 and 3 are compared. Class 27 is never read.
  for (const artifactClass of [2, 3]) {
    const a = before.bytesByClass.get(artifactClass);
    const b = after.bytesByClass.get(artifactClass);
    if (a === undefined || b === undefined) continue;
    if (!a.equals(b)) changes.push(`class ${String(artifactClass)} changed`);
    if (artifactClass === 2 && decodeClass2(a).policyVersion !== decodeClass2(b).policyVersion) {
      changes.push('policy_version changed');
    }
  }
  return Object.freeze(changes);
}

// ---------------------------------------------------------------------------------
// 13. THE RUNTIME IMPORTING THE SIGNING TOOL.
//
// `§3`: the release tooling "must not be reachable from: application bootstrap; control
// kernel; audit runtime; worker/model surfaces; Effect Gateway; web routes."
//
// The defect cannot be written INSIDE `src/` without failing the boundary test that exists to
// catch it, which is the point. What is provided here is the sample a production module would
// contain, plus the scan the boundary test runs, so the control discriminates: the scan finds
// this module and finds nothing under `src/`.
// ---------------------------------------------------------------------------------
export const UNSAFE_RUNTIME_SIGNER_IMPORT_SAMPLE =
  "import { approvePrimaryArtifacts } from '../../tools/control-release/ceremony.js';";

export function importsReleaseTooling(source: string): boolean {
  // The two offline-tooling directory names, reached by ANY specifier shape — the absolute
  // `tools/control-release/…` a production module would have to write, and the relative
  // `../control-artifacts/…` the tooling uses internally. The runtime's own directory is
  // `src/kernel/controlArtifacts/` (camel case) and is deliberately not matched by this.
  return [...source.matchAll(/from '([^']+)'/g)].some((match) =>
    /(^|\/)(control-release|control-artifacts)\//.test(match[1]!),
  );
}

// ---------------------------------------------------------------------------------
// 14. A TEST-SIGNED RELEASE PRESENTED AS A PRODUCTION ONE.
//
// `§47`: "Do NOT check a release signed with test keys into a path that could be mistaken for
// a production release. **Test fixtures must clearly identify `TEST ONLY`.**"
//
// The defect drops the channel from the deployment document. Note what the LABEL is and is
// not: the decisive separation is that a test key derives a different `key_id`, so a
// test-signed package can never satisfy a deployment pinned to a production manifest. The
// label is legibility, and losing it is how an operator copies the wrong directory.
// ---------------------------------------------------------------------------------
export function unsafeUnlabelledDeploymentDocument(options: {
  readonly primaryPublicKeyHex: string;
  readonly secondFactorPublicKeyHex: string;
  readonly manifestId: string;
}): string {
  // THE DEFECT: no `release_channel`, and nothing saying whose keys these are.
  return releaseJson({
    owner_artifact_root_key: options.primaryPublicKeyHex,
    owner_artifact_second_factor_key: options.secondFactorPublicKeyHex,
    expected_active_manifest_id: options.manifestId,
  });
}

// ---------------------------------------------------------------------------------
// shared helpers — deliberately tiny, so each control above reads as one defect
// ---------------------------------------------------------------------------------

function headerOf(candidate: ReleaseCandidate): OracleManifestHeader {
  return {
    manifestFormatVersion: candidate.manifestFormatVersion,
    manifestEpoch: candidate.manifestEpoch,
    expectedPrimaryKeyId: candidate.expectedPrimaryKeyId,
    expectedSecondFactorKeyId: candidate.expectedSecondFactorKeyId,
  };
}

function identityOf(entry: CandidateEntry): {
  readonly artifactClass: number;
  readonly artifactId: string;
  readonly artifactVersion: string;
  readonly contentSha256: Buffer;
} {
  return {
    artifactClass: entry.artifactClass,
    artifactId: entry.artifactId,
    artifactVersion: entry.artifactVersion,
    contentSha256: Buffer.from(entry.contentHash, 'hex'),
  };
}

function verifyRaw(message: Buffer, rawPublicKey: Buffer, signature: Buffer): boolean {
  if (rawPublicKey.length !== 32 || signature.length !== 64) return false;
  try {
    return edVerify(
      null,
      message,
      createPublicKey({
        key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), rawPublicKey]),
        format: 'der',
        type: 'spki',
      }),
      signature,
    );
  } catch {
    return false;
  }
}
