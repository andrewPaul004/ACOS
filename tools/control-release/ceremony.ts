import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  oracleArtifactMessage,
  oracleManifestCore,
  oracleManifestMessage,
  oracleSha256,
  type OracleManifestEntry,
  type OracleManifestHeader,
} from '../control-artifacts/framing.js';
import {
  RELEASE_LAYOUT,
  parseCandidateDocument,
  readCandidateAndPackage,
  readReleaseMetadata,
  releaseJson,
  type CandidateEntry,
  type ReleaseCandidate,
} from './candidate.js';
import { MANIFEST_FILE_NAME, refuse } from './inventory.js';
import {
  assertSignerMatchesExpectedKeyId,
  type SignerIdentity,
} from './signerKey.js';

/**
 * THE TWO-CUSTODIAN APPROVAL CEREMONY — `§14`, `§17` AND `§18` OF THE S1L MANDATE.
 *
 * =================================================================================
 * WHY THERE ARE THREE OPERATIONS AND NOT TWO
 *
 * `§14`: "The second signer must not simply call `sign-both` using both private keys in one
 * process invocation". `§18`: the second factor "MUST NOT: recalculate a different candidate
 * silently; change artifacts; replace primary signature; alter manifest core."
 *
 * The number of operations is forced by `50 §3d`, not chosen. The manifest CORE carries, per
 * entry, "`primary_signature`" and "`second_factor_signature`", and the manifest signature
 * message binds `manifest_core_sha256`. So:
 *
 *   * `manifest_core_sha256` is undefined until BOTH custodians' ARTIFACT signatures exist;
 *   * therefore neither custodian can sign the MANIFEST first;
 *   * therefore exactly one of them must act twice.
 *
 * The ceremony is:
 *
 *   1. `approvePrimaryArtifacts`     — primary reviews the candidate, signs every artifact
 *                                      under `PRIMARY`.
 *   2. `approveSecondFactorAndManifest`
 *                                    — the second custodian INDEPENDENTLY re-derives the
 *                                      candidate from the package bytes, confirms the same
 *                                      `candidate_id`, signs every artifact under
 *                                      `SECOND_FACTOR`, and — the core now being determined
 *                                      — signs the manifest under `SECOND_FACTOR`.
 *   3. `countersignPrimaryManifest`  — the primary confirms that the core built from its own
 *                                      step-1 signatures plus the second custodian's is the
 *                                      candidate it approved, then signs the manifest under
 *                                      `PRIMARY` and the release completes.
 *
 * **NO STEP EVER HOLDS BOTH PRIVATE KEYS.** Each function takes exactly one `SignerIdentity`
 * and there is no function in this file, or anywhere under `tools/`, that takes two.
 * `tests/release/ceremony.test.ts` asserts that as a property of the module's exported
 * signatures, and `tests/negative-controls/unsafe-release-ceremony.ts` carries the
 * `sign-both` implementation so the difference is visible rather than promised.
 *
 * =================================================================================
 * WHAT NO STEP MAY DO — `§17`
 *
 * "It MUST NOT: modify artifact bytes; change versions; reorder artifacts; update manifest
 * identity."
 *
 * Every step reads the package bytes and RE-DERIVES the candidate identity from them. It
 * never writes into `package/` except at the final step, which writes exactly one new file
 * (`manifest.json`) and touches no artifact. `candidate.json` is never rewritten after
 * `build`. A step that wanted to change an artifact would have to change the candidate, and
 * a changed candidate is a DIFFERENT `candidate_id` — which the next step refuses, because
 * each step carries the identity it approved into its own approval record.
 * =================================================================================
 */

const APPROVAL_FORMAT_VERSION = 'ACOS-CONTROL-RELEASE-APPROVAL-V1';
const DEPLOYMENT_FORMAT_VERSION = 'ACOS-CONTROL-DEPLOYMENT-TRUST-V1';

export type ApprovalRole = 'PRIMARY_ARTIFACTS' | 'SECOND_FACTOR' | 'PRIMARY_MANIFEST';

export interface ArtifactApproval {
  readonly approvalFormatVersion: string;
  readonly approvalRole: ApprovalRole;
  readonly candidateId: string;
  readonly signerKeyId: string;
  /** artifact class -> 128 lowercase hex characters (64 raw Ed25519 signature bytes). */
  readonly artifactSignatures: Readonly<Record<string, string>>;
}

export interface SecondFactorApproval extends ArtifactApproval {
  readonly manifestCoreSha256: string;
  readonly manifestId: string;
  readonly manifestSignature: string;
}

export interface PrimaryManifestApproval {
  readonly approvalFormatVersion: string;
  readonly approvalRole: 'PRIMARY_MANIFEST';
  readonly candidateId: string;
  readonly signerKeyId: string;
  readonly manifestId: string;
  readonly manifestSignature: string;
}

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

function signatureHex(signature: Buffer): string {
  if (signature.length !== 64) {
    refuse('RELEASE_SIGNATURE_MALFORMED', 'an Ed25519 signature is 64 raw bytes (50 §3b)');
  }
  return signature.toString('hex');
}

function readSignatureMap(
  approval: ArtifactApproval,
  candidate: ReleaseCandidate,
  what: string,
): ReadonlyMap<number, Buffer> {
  const out = new Map<number, Buffer>();
  for (const entry of candidate.entries) {
    const hex = approval.artifactSignatures[String(entry.artifactClass)];
    if (hex === undefined || hex.length !== 128 || !/^[0-9a-f]+$/.test(hex)) {
      refuse(
        'RELEASE_APPROVAL_INCOMPLETE',
        `${what} carries no well-formed signature for class ${String(entry.artifactClass)}`,
      );
    }
    out.set(entry.artifactClass, Buffer.from(hex, 'hex'));
  }
  const extra = Object.keys(approval.artifactSignatures).filter(
    (key) => !candidate.entries.some((entry) => String(entry.artifactClass) === key),
  );
  if (extra.length > 0) {
    refuse(
      'RELEASE_APPROVAL_OVERREACH',
      `${what} carries signatures for classes outside the reviewed candidate: ` +
        `${extra.join(', ')}`,
    );
  }
  return out;
}

function approvalPath(releaseRoot: string, file: string): string {
  return join(releaseRoot, RELEASE_LAYOUT.approvalsDir, file);
}

function writeApproval(path: string, value: unknown): void {
  writeFileSync(path, releaseJson(value), 'utf8');
}

function readApproval(path: string, what: string): Record<string, unknown> {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    refuse('RELEASE_APPROVAL_MISSING', `${what} has not been performed`);
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    refuse('RELEASE_APPROVAL_MALFORMED', `${what} is not readable JSON`);
  }
}

function asArtifactApproval(
  raw: Record<string, unknown>,
  expectedRole: ApprovalRole,
  what: string,
): ArtifactApproval {
  if (raw.approval_format_version !== APPROVAL_FORMAT_VERSION) {
    refuse('RELEASE_APPROVAL_MALFORMED', `${what} has an unrecognised approval format`);
  }
  if (raw.approval_role !== expectedRole) {
    refuse(
      'RELEASE_APPROVAL_ROLE_UNEXPECTED',
      `${what} declares role "${String(raw.approval_role)}" and ${expectedRole} was expected`,
    );
  }
  const signatures = raw.artifact_signatures;
  if (typeof signatures !== 'object' || signatures === null) {
    refuse('RELEASE_APPROVAL_MALFORMED', `${what} carries no artifact_signatures map`);
  }
  return {
    approvalFormatVersion: APPROVAL_FORMAT_VERSION,
    approvalRole: expectedRole,
    candidateId: String(raw.candidate_id),
    signerKeyId: String(raw.signer_key_id),
    artifactSignatures: signatures as Readonly<Record<string, string>>,
  };
}

// ---------------------------------------------------------------------------------
// STEP 1 — THE PRIMARY OWNER'S ARTIFACT APPROVAL
// ---------------------------------------------------------------------------------

/**
 * `§17`. The primary custodian reviews the candidate and signs every artifact.
 *
 * It signs the bytes that are IN THE PACKAGE, re-derived and re-digested here, and refuses
 * if the package no longer computes the candidate identity that was reviewed.
 */
export function approvePrimaryArtifacts(
  releaseRoot: string,
  signer: SignerIdentity,
): ArtifactApproval {
  const { candidate } = readCandidateAndPackage(releaseRoot);
  assertSignerMatchesExpectedKeyId(signer, candidate.expectedPrimaryKeyId, 'PRIMARY');

  const artifactSignatures: Record<string, string> = {};
  for (const entry of candidate.entries) {
    artifactSignatures[String(entry.artifactClass)] = signatureHex(
      signer.sign(oracleArtifactMessage('PRIMARY', identityOf(entry))),
    );
  }

  const approval: ArtifactApproval = {
    approvalFormatVersion: APPROVAL_FORMAT_VERSION,
    approvalRole: 'PRIMARY_ARTIFACTS',
    candidateId: candidate.candidateId,
    signerKeyId: signer.keyId,
    artifactSignatures,
  };
  writeApproval(approvalPath(releaseRoot, RELEASE_LAYOUT.primaryArtifactApproval), {
    approval_format_version: approval.approvalFormatVersion,
    approval_role: approval.approvalRole,
    candidate_id: approval.candidateId,
    signer_key_id: approval.signerKeyId,
    artifact_signatures: approval.artifactSignatures,
  });
  return approval;
}

// ---------------------------------------------------------------------------------
// STEP 2 — THE SECOND FACTOR'S INDEPENDENT APPROVAL
// ---------------------------------------------------------------------------------

/**
 * `§18`. The second custodian confirms the SAME reviewed release identity, then signs.
 *
 * `§18`: "Second-factor signer receives the SAME reviewed release identity. It independently
 * confirms: candidate manifest ID; artifact list; artifact digests; versions."
 *
 * Every one of those is confirmed by RE-DERIVATION rather than by trusting the primary's
 * record: `readCandidateAndPackage` recomputes each artifact's digest from the package bytes
 * and `parseCandidateDocument` recomputes `candidate_id` from the candidate's own fields.
 * The primary's approval is then checked to be FOR THAT IDENTITY.
 */
export function approveSecondFactorAndManifest(
  releaseRoot: string,
  signer: SignerIdentity,
): SecondFactorApproval {
  const { candidate } = readCandidateAndPackage(releaseRoot);
  assertSignerMatchesExpectedKeyId(signer, candidate.expectedSecondFactorKeyId, 'SECOND_FACTOR');

  const primaryApproval = asArtifactApproval(
    readApproval(
      approvalPath(releaseRoot, RELEASE_LAYOUT.primaryArtifactApproval),
      "the primary owner's artifact approval",
    ),
    'PRIMARY_ARTIFACTS',
    "the primary owner's artifact approval",
  );
  if (primaryApproval.candidateId !== candidate.candidateId) {
    refuse(
      'RELEASE_APPROVALS_DISAGREE',
      `the primary approved candidate ${primaryApproval.candidateId} and this package ` +
        `computes ${candidate.candidateId}. A changed core means A NEW CEREMONY IS REQUIRED`,
    );
  }
  if (primaryApproval.signerKeyId !== candidate.expectedPrimaryKeyId) {
    refuse(
      'RELEASE_APPROVALS_DISAGREE',
      "the primary approval was produced under a key that is not the candidate's " +
        'expected_primary_key_id',
    );
  }
  if (primaryApproval.signerKeyId === signer.keyId) {
    // `50 §3a`: "**A second signature produced under the primary key does not satisfy the
    // second-factor requirement**, whatever its `signer_role` claims." The ceremony refuses
    // to produce such a package at all.
    refuse(
      'RELEASE_SECOND_FACTOR_NOT_INDEPENDENT',
      'the second-factor key is the same key that produced the primary approval (50 §3a)',
    );
  }

  const primarySignatures = readSignatureMap(
    primaryApproval,
    candidate,
    "the primary owner's artifact approval",
  );

  const artifactSignatures: Record<string, string> = {};
  const coreEntries: OracleManifestEntry[] = [];
  for (const entry of candidate.entries) {
    const identity = identityOf(entry);
    const secondFactorSignature = signer.sign(
      oracleArtifactMessage('SECOND_FACTOR', identity),
    );
    artifactSignatures[String(entry.artifactClass)] = signatureHex(secondFactorSignature);
    coreEntries.push({
      ...identity,
      primarySignature: primarySignatures.get(entry.artifactClass)!,
      secondFactorSignature,
    });
  }

  // The core is determined ONLY NOW: `50 §3d` puts both per-entry signatures inside it.
  const header = headerOf(candidate);
  const core = oracleManifestCore(header, coreEntries);
  const coreSha256 = oracleSha256(core);
  const manifestId = coreSha256.toString('hex');

  const manifestSignature = signatureHex(
    signer.sign(oracleManifestMessage('SECOND_FACTOR', header, coreSha256)),
  );

  const approval: SecondFactorApproval = {
    approvalFormatVersion: APPROVAL_FORMAT_VERSION,
    approvalRole: 'SECOND_FACTOR',
    candidateId: candidate.candidateId,
    signerKeyId: signer.keyId,
    artifactSignatures,
    manifestCoreSha256: manifestId,
    manifestId,
    manifestSignature,
  };
  writeApproval(approvalPath(releaseRoot, RELEASE_LAYOUT.secondFactorApproval), {
    approval_format_version: approval.approvalFormatVersion,
    approval_role: approval.approvalRole,
    candidate_id: approval.candidateId,
    signer_key_id: approval.signerKeyId,
    artifact_signatures: approval.artifactSignatures,
    manifest_core_sha256: approval.manifestCoreSha256,
    manifest_id: approval.manifestId,
    manifest_signature: approval.manifestSignature,
  });
  return approval;
}

// ---------------------------------------------------------------------------------
// STEP 3 — THE PRIMARY'S MANIFEST COUNTERSIGNATURE, AND THE COMPLETED RELEASE
// ---------------------------------------------------------------------------------

export interface CompletedRelease {
  readonly candidateId: string;
  readonly manifestId: string;
  readonly manifestEpoch: string;
  readonly packageRoot: string;
  readonly releaseChannel: string;
  readonly primaryPublicKeyHex: string;
  readonly secondFactorPublicKeyHex: string;
}

/**
 * `§14` and `§33`. The primary countersigns the manifest and the release completes.
 *
 * The primary does NOT re-derive the core from anything the second custodian asserted. It
 * rebuilds the core from ITS OWN step-1 artifact signatures plus the second custodian's, and
 * refuses if that core's identity is not the one the second custodian signed. A second
 * custodian that silently changed an artifact, a version, an order or a digest produces a
 * core the primary cannot reproduce, and the ceremony stops here rather than completing.
 */
export function countersignPrimaryManifest(
  releaseRoot: string,
  signer: SignerIdentity,
): CompletedRelease {
  const { candidate } = readCandidateAndPackage(releaseRoot);
  assertSignerMatchesExpectedKeyId(signer, candidate.expectedPrimaryKeyId, 'PRIMARY');

  const primaryApproval = asArtifactApproval(
    readApproval(
      approvalPath(releaseRoot, RELEASE_LAYOUT.primaryArtifactApproval),
      "the primary owner's artifact approval",
    ),
    'PRIMARY_ARTIFACTS',
    "the primary owner's artifact approval",
  );
  const secondRaw = readApproval(
    approvalPath(releaseRoot, RELEASE_LAYOUT.secondFactorApproval),
    "the second factor's approval",
  );
  const secondApproval = asArtifactApproval(
    secondRaw,
    'SECOND_FACTOR',
    "the second factor's approval",
  );

  for (const [approval, what] of [
    [primaryApproval, "the primary owner's artifact approval"],
    [secondApproval, "the second factor's approval"],
  ] as const) {
    if (approval.candidateId !== candidate.candidateId) {
      refuse(
        'RELEASE_APPROVALS_DISAGREE',
        `${what} approved candidate ${approval.candidateId} and this package computes ` +
          `${candidate.candidateId}. A changed core means A NEW CEREMONY IS REQUIRED`,
      );
    }
  }
  if (primaryApproval.signerKeyId === secondApproval.signerKeyId) {
    refuse(
      'RELEASE_SECOND_FACTOR_NOT_INDEPENDENT',
      'both approvals were produced under one key (50 §3a, 50 §4)',
    );
  }

  const primarySignatures = readSignatureMap(
    primaryApproval,
    candidate,
    "the primary owner's artifact approval",
  );
  const secondSignatures = readSignatureMap(
    secondApproval,
    candidate,
    "the second factor's approval",
  );

  const coreEntries: OracleManifestEntry[] = candidate.entries.map((entry) => ({
    ...identityOf(entry),
    primarySignature: primarySignatures.get(entry.artifactClass)!,
    secondFactorSignature: secondSignatures.get(entry.artifactClass)!,
  }));

  const header = headerOf(candidate);
  const coreSha256 = oracleSha256(oracleManifestCore(header, coreEntries));
  const manifestId = coreSha256.toString('hex');

  const declaredManifestId = String(secondRaw.manifest_id);
  if (declaredManifestId !== manifestId) {
    refuse(
      'RELEASE_MANIFEST_IDENTITY_DISAGREES',
      `the second factor signed manifest_id ${declaredManifestId} and the core assembled ` +
        `from both approvals computes ${manifestId}; the manifest core was altered after the ` +
        'second approval and A NEW CEREMONY IS REQUIRED',
    );
  }

  const manifestSecondFactorSignature = String(secondRaw.manifest_signature);
  const manifestPrimarySignature = signatureHex(
    signer.sign(oracleManifestMessage('PRIMARY', header, coreSha256)),
  );

  writeApproval(approvalPath(releaseRoot, RELEASE_LAYOUT.primaryManifestApproval), {
    approval_format_version: APPROVAL_FORMAT_VERSION,
    approval_role: 'PRIMARY_MANIFEST',
    candidate_id: candidate.candidateId,
    signer_key_id: signer.keyId,
    manifest_id: manifestId,
    manifest_signature: manifestPrimarySignature,
  });

  // `50 §3d`'s manifest document, in the exact CLOSED field set the runtime parser accepts.
  const packageRoot = join(releaseRoot, RELEASE_LAYOUT.packageDir);
  writeFileSync(
    join(packageRoot, MANIFEST_FILE_NAME),
    releaseJson({
      manifest_format_version: candidate.manifestFormatVersion,
      manifest_epoch: candidate.manifestEpoch,
      expected_primary_key_id: candidate.expectedPrimaryKeyId,
      expected_second_factor_key_id: candidate.expectedSecondFactorKeyId,
      entry_count: candidate.entryCount,
      entries: candidate.entries.map((entry) => ({
        artifact_class: entry.artifactClass,
        artifact_id: entry.artifactId,
        artifact_version: entry.artifactVersion,
        content_hash: entry.contentHash,
        primary_signature: primarySignatures.get(entry.artifactClass)!.toString('hex'),
        second_factor_signature: secondSignatures.get(entry.artifactClass)!.toString('hex'),
      })),
      primary_signature: manifestPrimarySignature,
      second_factor_signature: manifestSecondFactorSignature,
    }),
    'utf8',
  );

  // `§22`. The PUBLIC deployment trust values, written from the recorded public keys — whose
  // `key_id`s `readReleaseMetadata` has already re-derived and matched against the signed
  // core's `expected_*_key_id`. No private half is present in this process for the second
  // factor, and the primary's never leaves `signer.sign`.
  const metadata = readReleaseMetadata(releaseRoot, candidate);
  writeDeploymentTrustDocument(releaseRoot, {
    primaryPublicKeyHex: metadata.primaryPublicKeyHex,
    secondFactorPublicKeyHex: metadata.secondFactorPublicKeyHex,
    manifestId,
    manifestEpoch: candidate.manifestEpoch,
    releaseChannel: metadata.releaseChannel,
  });

  return {
    candidateId: candidate.candidateId,
    manifestId,
    manifestEpoch: candidate.manifestEpoch,
    packageRoot,
    releaseChannel: metadata.releaseChannel,
    primaryPublicKeyHex: metadata.primaryPublicKeyHex,
    secondFactorPublicKeyHex: metadata.secondFactorPublicKeyHex,
  };
}

/**
 * `§22`. The PUBLIC deployment trust values, derived without any private key.
 *
 * `§22`: "Do NOT output private key material into the deployment bundle." Nothing here has
 * access to one: the two public keys are supplied as public keys, and `manifest_id` is read
 * from the completed package.
 *
 * `§23`: "deployment must configure each plane through its own trust boundary." The two
 * blocks below carry the SAME public values under DIFFERENT variable names, because that is
 * what makes the audit plane's verification independent rather than derived.
 */
export function deploymentTrustDocument(options: {
  readonly primaryPublicKeyHex: string;
  readonly secondFactorPublicKeyHex: string;
  readonly manifestId: string;
  readonly manifestEpoch: string;
  readonly releaseChannel: string;
}): string {
  return releaseJson({
    deployment_config_version: DEPLOYMENT_FORMAT_VERSION,
    release_channel: options.releaseChannel,
    CONTAINS_NO_PRIVATE_KEY_MATERIAL: true,
    NOTE:
      'These are PUBLIC values. 50 §3a provisions both public keys and 50 §3e provisions ' +
      'EXPECTED_ACTIVE_MANIFEST_ID out of band, through each plane’s own trusted deployment ' +
      'mechanism. The artifact package root is a LOCATION and is not a trust anchor.',
    owner_artifact_root_key: options.primaryPublicKeyHex,
    owner_artifact_second_factor_key: options.secondFactorPublicKeyHex,
    expected_active_manifest_id: options.manifestId,
    manifest_epoch_for_lineage_only: options.manifestEpoch,
    control_plane: {
      ACOS_OWNER_ARTIFACT_ROOT_KEY: options.primaryPublicKeyHex,
      ACOS_OWNER_ARTIFACT_SECOND_FACTOR_KEY: options.secondFactorPublicKeyHex,
      ACOS_EXPECTED_ACTIVE_MANIFEST_ID: options.manifestId,
      ACOS_CONTROL_ARTIFACT_ROOT: '<the control plane’s own copy of this release package>',
    },
    audit_plane: {
      ACOS_AUDIT_OWNER_ARTIFACT_ROOT_KEY: options.primaryPublicKeyHex,
      ACOS_AUDIT_OWNER_ARTIFACT_SECOND_FACTOR_KEY: options.secondFactorPublicKeyHex,
      ACOS_AUDIT_EXPECTED_ACTIVE_MANIFEST_ID: options.manifestId,
      ACOS_AUDIT_CONTROL_ARTIFACT_ROOT: '<the audit plane’s own copy of this release package>',
    },
  });
}

export function writeDeploymentTrustDocument(
  releaseRoot: string,
  options: Parameters<typeof deploymentTrustDocument>[0],
): void {
  writeFileSync(
    join(releaseRoot, RELEASE_LAYOUT.deploymentFile),
    deploymentTrustDocument(options),
    'utf8',
  );
}

/** Read a completed release's candidate without re-reading its package. */
export function readCandidate(releaseRoot: string): ReleaseCandidate {
  return parseCandidateDocument(
    readFileSync(join(releaseRoot, RELEASE_LAYOUT.candidateFile), 'utf8'),
  );
}

export { APPROVAL_FORMAT_VERSION, DEPLOYMENT_FORMAT_VERSION };
