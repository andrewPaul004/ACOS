import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import {
  oracleField,
  oracleInteger,
  oracleKeyId,
  oracleSha256,
  oracleText,
} from '../control-artifacts/framing.js';
import {
  MANIFEST_FORMAT_VERSION,
  PRE_LIVE_INVENTORY,
  RETIRED_ARTIFACT_CLASS,
  inventoryMember,
  refuse,
} from './inventory.js';

/**
 * THE RELEASE CANDIDATE — a deterministic, UNSIGNED, reviewable release input.
 *
 * =================================================================================
 * NO PRIVATE KEY IS REQUIRED HERE, AND THAT IS THE POINT — `§5` of the S1L mandate
 *
 *   "At this stage: **NO PRIVATE KEY IS REQUIRED.** The candidate can be reviewed before
 *    signatures exist."
 *
 * The two PUBLIC keys ARE required, because `50 §3d`'s manifest core carries
 * `expected_primary_key_id` and `expected_second_factor_key_id` and those move the signed
 * identity. A public key is not a secret and supplying one is not a signing operation.
 *
 * =================================================================================
 * WHY `candidate_id` IS NOT `manifest_id`, AND WHY IT HAS TO EXIST
 *
 * `50 §3e`: "`manifest_id = SHA-256(exact CORE bytes)`" and `50 §3d`'s CORE carries, per
 * entry, "`primary_signature`" and "`second_factor_signature`". **`manifest_id` therefore
 * CANNOT EXIST BEFORE BOTH SIGNATURES EXIST.** A ceremony in which two custodians review and
 * approve "the same manifest identity" before signing is, read literally, impossible.
 *
 * So this module computes a SEPARATE, EXPLICITLY NON-NORMATIVE **candidate identity** over
 * the part of the release that both signers must agree about before either signs: the
 * header, the exact entry order, and every artifact's identity and content digest. It is
 * framed under its OWN domain separator, `ACOS-CONTROL-RELEASE-CANDIDATE-V1`, so it can
 * never be confused with a manifest core (`ACOS-CONTROL-MANIFEST-CORE-V1`), an artifact
 * signature message or a manifest signature message.
 *
 * **`candidate_id` IS REVIEW TOOLING. IT IS NOT A TRUST ROOT, IT IS NOT SIGNED BY ITSELF,
 * IT IS NEVER `EXPECTED_ACTIVE_MANIFEST_ID`, AND NO RUNTIME READS IT.** The deployment pin
 * remains `50 §3e`'s `manifest_id`, computed after the ceremony completes.
 *
 * =================================================================================
 * DETERMINISM — `§6` AND `§34` OF THE MANDATE
 *
 * Nothing in this file reads the clock, the hostname, the process id, a random source, a
 * temporary path or the git working directory. The candidate is a pure function of
 *
 *   (the declared identities) x (the exact artifact bytes) x (the two public keys)
 *
 * and of nothing else. `release_channel` and an operator's free-text note are carried in
 * `release-metadata.json`, OUTSIDE the candidate core and outside the manifest core, and
 * `tests/release/candidate-determinism.test.ts` proves that moving either leaves both
 * identities unchanged.
 * =================================================================================
 */

const CANDIDATE_DOMAIN = 'ACOS-CONTROL-RELEASE-CANDIDATE-V1';
const CANDIDATE_FORMAT_VERSION = CANDIDATE_DOMAIN;
const RELEASE_INPUT_VERSION = 'ACOS-CONTROL-RELEASE-INPUT-V1';

/** Where a release directory keeps each part. Closed layout; `§21` of the mandate. */
export const RELEASE_LAYOUT = Object.freeze({
  /** The DEPLOYABLE artifact package. Flat, and exactly what the runtime consumes. */
  packageDir: 'package',
  candidateFile: 'candidate.json',
  approvalsDir: 'approvals',
  primaryArtifactApproval: 'primary-artifacts.json',
  secondFactorApproval: 'second-factor.json',
  primaryManifestApproval: 'primary-manifest.json',
  reviewFile: 'release-review.txt',
  deploymentFile: 'deployment.json',
  metadataFile: 'release-metadata.json',
});

export type ReleaseChannel = 'PRODUCTION' | 'TEST_ONLY';

export interface ReleaseInputArtifact {
  readonly artifactClass: number;
  readonly artifactId: string;
  readonly artifactVersion: string;
  readonly packageFileName: string;
  /** Relative to the declaration file's own directory, or absolute. */
  readonly sourcePath: string;
}

export interface ReleaseInputDeclaration {
  readonly manifestEpoch: string;
  readonly releaseChannel: ReleaseChannel;
  /** The 32 raw Ed25519 public-key bytes, lowercase hex. NEVER a private half. */
  readonly primaryPublicKeyHex: string;
  readonly secondFactorPublicKeyHex: string;
  readonly artifacts: readonly ReleaseInputArtifact[];
  /** NON-AUTHORITATIVE operator note. Never enters any identity. */
  readonly note?: string;
}

export interface CandidateEntry {
  readonly artifactClass: number;
  readonly artifactId: string;
  readonly artifactVersion: string;
  readonly contentHash: string;
  readonly packageFileName: string;
  readonly byteLength: number;
}

export interface ReleaseCandidate {
  readonly candidateFormatVersion: string;
  readonly candidateId: string;
  readonly manifestFormatVersion: string;
  readonly manifestEpoch: string;
  readonly expectedPrimaryKeyId: string;
  readonly expectedSecondFactorKeyId: string;
  readonly entryCount: number;
  readonly entries: readonly CandidateEntry[];
}

const HEX32 = /^[0-9a-f]{64}$/;

function rawPublicKey(hex: string, what: string): Buffer {
  if (!HEX32.test(hex)) {
    refuse(
      'RELEASE_KEY_MALFORMED',
      `${what} is not 64 lowercase hex characters; 50 §3a's root is 32 RAW Ed25519 ` +
        'public-key bytes and never a DER, SPKI, PEM or base64 wrapper',
    );
  }
  return Buffer.from(hex, 'hex');
}

/** `50 §3d`'s declared entry order, byte-wise over UTF-8 NFC. */
function compareNfcBytes(a: string, b: string): number {
  return Buffer.compare(
    Buffer.from(a.normalize('NFC'), 'utf8'),
    Buffer.from(b.normalize('NFC'), 'utf8'),
  );
}

function orderEntries(entries: readonly CandidateEntry[]): readonly CandidateEntry[] {
  return [...entries].sort((a, b) => {
    if (a.artifactClass !== b.artifactClass) return a.artifactClass - b.artifactClass;
    const byId = compareNfcBytes(a.artifactId, b.artifactId);
    if (byId !== 0) return byId;
    return compareNfcBytes(a.artifactVersion, b.artifactVersion);
  });
}

/**
 * The candidate's framed identity bytes, under the candidate's OWN domain.
 *
 * Same `ACOS-CAS-SIG-V1` field encoding as `50 §3b` — which is what makes the framing
 * unambiguous — under a DIFFERENT domain separator, which is what makes it impossible to
 * present a candidate identity where a manifest core is expected.
 */
export function candidateCoreBytes(candidate: Omit<ReleaseCandidate, 'candidateId'>): Buffer {
  const parts: Buffer[] = [
    oracleField(oracleText(CANDIDATE_DOMAIN)),
    oracleField(oracleText(candidate.manifestFormatVersion)),
    oracleField(oracleText(candidate.manifestEpoch)),
    oracleField(oracleText(candidate.expectedPrimaryKeyId)),
    oracleField(oracleText(candidate.expectedSecondFactorKeyId)),
    oracleField(oracleInteger(candidate.entryCount)),
  ];
  for (const entry of candidate.entries) {
    parts.push(oracleField(oracleInteger(entry.artifactClass)));
    parts.push(oracleField(oracleText(entry.artifactId)));
    parts.push(oracleField(oracleText(entry.artifactVersion)));
    parts.push(oracleField(Buffer.from(entry.contentHash, 'hex')));
  }
  return Buffer.concat(parts);
}

function declaredVersionInArtifact(bytes: Buffer, artifactClass: number): string | null {
  // Class 20 is a plain-text specification and declares no version inside itself; `50 §6`
  // declares its version LITERALLY as `ACOS-JCS-1`, which is checked from the inventory.
  if (artifactClass === 20) return null;
  let document: unknown;
  try {
    document = JSON.parse(bytes.toString('utf8'));
  } catch {
    return null;
  }
  if (typeof document !== 'object' || document === null) return null;
  const version = (document as Record<string, unknown>).artifact_version;
  return typeof version === 'string' ? version : null;
}

function declaredIdInArtifact(bytes: Buffer, artifactClass: number): string | null {
  if (artifactClass === 20) return null;
  let document: unknown;
  try {
    document = JSON.parse(bytes.toString('utf8'));
  } catch {
    return null;
  }
  if (typeof document !== 'object' || document === null) return null;
  const id = (document as Record<string, unknown>).artifact_id;
  return typeof id === 'string' ? id : null;
}

export interface LoadedArtifact extends CandidateEntry {
  readonly bytes: Buffer;
}

/**
 * Load, validate and digest the declared artifact set.
 *
 * `§7` of the mandate, in order: missing required artifact refused; duplicate class or id
 * refused; unknown entry refused; retired class 17 refused.
 */
export function loadDeclaredArtifacts(
  declaration: ReleaseInputDeclaration,
  baseDir: string,
): readonly LoadedArtifact[] {
  const seenClass = new Set<number>();
  const seenFile = new Set<string>();
  const loaded: LoadedArtifact[] = [];

  for (const artifact of declaration.artifacts) {
    if (artifact.artifactClass === RETIRED_ARTIFACT_CLASS) {
      refuse(
        'RELEASE_RETIRED_CLASS_PRESENT',
        `the declaration carries a class-${String(RETIRED_ARTIFACT_CLASS)} artifact; that ` +
          'class is RETIRED from the deploy-time signed manifest, reserved and deprecated ' +
          '(50 §2d), and per-company window_registry rows are runtime state under 50 §3h',
      );
    }
    const member = inventoryMember(artifact.artifactClass);
    if (member === undefined) {
      refuse(
        'RELEASE_UNKNOWN_CLASS',
        `the declaration carries a class-${String(artifact.artifactClass)} artifact, which ` +
          "is outside 50 §6's closed pre-live set",
      );
    }
    if (artifact.artifactId !== member.artifactId) {
      refuse(
        'RELEASE_ARTIFACT_ID_UNEXPECTED',
        `class ${String(artifact.artifactClass)} declares artifact_id ` +
          `"${artifact.artifactId}"; 50 §6 declares "${member.artifactId}"`,
      );
    }
    if (member.declaredVersion !== null && artifact.artifactVersion !== member.declaredVersion) {
      refuse(
        'RELEASE_ARTIFACT_VERSION_UNEXPECTED',
        `class ${String(artifact.artifactClass)} declares artifact_version ` +
          `"${artifact.artifactVersion}"; 50 §6 declares "${member.declaredVersion}"`,
      );
    }
    if (seenClass.has(artifact.artifactClass)) {
      refuse(
        'RELEASE_DUPLICATE_CLASS',
        `the declaration carries two class-${String(artifact.artifactClass)} artifacts; the ` +
          'runtime resolves an artifact BY CLASS and two candidates would make that a choice',
      );
    }
    seenClass.add(artifact.artifactClass);

    // `§21`: "Authority-bearing filenames/paths must not create ambiguous duplicate artifact
    // selection. [...] Do not support 'first matching file wins.'"
    if (seenFile.has(artifact.packageFileName)) {
      refuse(
        'RELEASE_DUPLICATE_PACKAGE_FILE',
        `two artifacts would be written to ${artifact.packageFileName}; a package file name ` +
          'selects exactly one artifact and there is no first-match rule',
      );
    }
    if (artifact.packageFileName.includes('/') || artifact.packageFileName.includes('\\')) {
      refuse(
        'RELEASE_PACKAGE_FILE_NOT_FLAT',
        `${artifact.packageFileName} is not a flat file name; the deployable package is one ` +
          'directory of named files and a path would make selection ambiguous',
      );
    }
    seenFile.add(artifact.packageFileName);

    const sourcePath = isAbsolute(artifact.sourcePath)
      ? artifact.sourcePath
      : resolve(baseDir, artifact.sourcePath);
    let bytes: Buffer;
    try {
      // NO ENCODING. `50 §3c` hashes the EXACT bytes; reading as utf8 and re-encoding is
      // the commonest way an exact-byte rule becomes an approximately-exact-byte rule.
      bytes = readFileSync(sourcePath);
    } catch (error) {
      refuse(
        'RELEASE_ARTIFACT_SOURCE_UNREADABLE',
        `class ${String(artifact.artifactClass)}: ${sourcePath} could not be read: ` +
          `${String(error)}`,
      );
    }

    const declaredId = declaredIdInArtifact(bytes, artifact.artifactClass);
    if (declaredId !== null && declaredId !== artifact.artifactId) {
      refuse(
        'RELEASE_ARTIFACT_SELF_DECLARATION_MISMATCH',
        `class ${String(artifact.artifactClass)}: the artifact's own bytes declare ` +
          `artifact_id "${declaredId}" and the release declaration says ` +
          `"${artifact.artifactId}"`,
      );
    }
    const declaredVersion = declaredVersionInArtifact(bytes, artifact.artifactClass);
    if (declaredVersion !== null && declaredVersion !== artifact.artifactVersion) {
      refuse(
        'RELEASE_ARTIFACT_SELF_DECLARATION_MISMATCH',
        `class ${String(artifact.artifactClass)}: the artifact's own bytes declare ` +
          `artifact_version "${declaredVersion}" and the release declaration says ` +
          `"${artifact.artifactVersion}"`,
      );
    }

    loaded.push({
      artifactClass: artifact.artifactClass,
      artifactId: artifact.artifactId,
      artifactVersion: artifact.artifactVersion,
      contentHash: oracleSha256(bytes).toString('hex'),
      packageFileName: artifact.packageFileName,
      byteLength: bytes.length,
      bytes,
    });
  }

  for (const member of PRE_LIVE_INVENTORY) {
    if (!seenClass.has(member.artifactClass)) {
      refuse(
        'RELEASE_REQUIRED_ARTIFACT_MISSING',
        `the declaration carries no class-${String(member.artifactClass)} artifact ` +
          `(${member.artifactId}); 50 §6's set is CLOSED and no member is optional`,
      );
    }
  }

  return loaded;
}

export interface BuiltCandidate {
  readonly candidate: ReleaseCandidate;
  readonly artifacts: readonly LoadedArtifact[];
}

/** Build the candidate. Pure over the declaration and the artifact bytes. */
export function buildReleaseCandidate(
  declaration: ReleaseInputDeclaration,
  baseDir: string,
): BuiltCandidate {
  const primary = rawPublicKey(declaration.primaryPublicKeyHex, 'the primary public key');
  const secondFactor = rawPublicKey(
    declaration.secondFactorPublicKeyHex,
    'the second-factor public key',
  );

  // `50 §3a`: "A deployment configuring the same key in both slots **fails closed at
  // bootstrap** and never becomes READY." A release built for such a deployment could never
  // be deployed, so the ceremony refuses to produce one rather than producing a package that
  // will be rejected later.
  if (primary.equals(secondFactor)) {
    refuse(
      'RELEASE_TRUST_ROOTS_NOT_DISTINCT',
      'the primary and second-factor public keys carry the same 32 raw bytes; a second ' +
        'signature under the primary key does not satisfy the second-factor requirement ' +
        '(50 §3a, 50 §4)',
    );
  }
  if (declaration.manifestEpoch === '') {
    refuse('RELEASE_EPOCH_MISSING', 'manifest_epoch is empty');
  }

  const artifacts = loadDeclaredArtifacts(declaration, baseDir);
  const entries = orderEntries(
    artifacts.map((artifact) => ({
      artifactClass: artifact.artifactClass,
      artifactId: artifact.artifactId,
      artifactVersion: artifact.artifactVersion,
      contentHash: artifact.contentHash,
      packageFileName: artifact.packageFileName,
      byteLength: artifact.byteLength,
    })),
  );

  const withoutId = {
    candidateFormatVersion: CANDIDATE_FORMAT_VERSION,
    manifestFormatVersion: MANIFEST_FORMAT_VERSION,
    manifestEpoch: declaration.manifestEpoch,
    expectedPrimaryKeyId: oracleKeyId(primary),
    expectedSecondFactorKeyId: oracleKeyId(secondFactor),
    entryCount: entries.length,
    entries,
  };

  const candidate: ReleaseCandidate = {
    ...withoutId,
    candidateId: oracleSha256(candidateCoreBytes(withoutId)).toString('hex'),
  };

  const order = new Map(entries.map((entry, index) => [entry.artifactClass, index] as const));
  const orderedArtifacts = [...artifacts].sort(
    (a, b) => order.get(a.artifactClass)! - order.get(b.artifactClass)!,
  );

  return { candidate, artifacts: orderedArtifacts };
}

/** Deterministic JSON: fixed key order, two-space indent, one trailing newline. */
export function releaseJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function candidateDocument(candidate: ReleaseCandidate): string {
  return releaseJson({
    candidate_format_version: candidate.candidateFormatVersion,
    candidate_id: candidate.candidateId,
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
      package_file_name: entry.packageFileName,
      byte_length: entry.byteLength,
    })),
  });
}

export function parseCandidateDocument(text: string): ReleaseCandidate {
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch (error) {
    refuse('RELEASE_CANDIDATE_MALFORMED', String(error));
  }
  const raw = document as Record<string, unknown>;
  if (raw.candidate_format_version !== CANDIDATE_FORMAT_VERSION) {
    refuse('RELEASE_CANDIDATE_MALFORMED', 'unrecognised candidate_format_version');
  }
  const entries = raw.entries;
  if (!Array.isArray(entries)) {
    refuse('RELEASE_CANDIDATE_MALFORMED', 'entries is not an array');
  }
  const parsed: ReleaseCandidate = {
    candidateFormatVersion: CANDIDATE_FORMAT_VERSION,
    candidateId: String(raw.candidate_id),
    manifestFormatVersion: String(raw.manifest_format_version),
    manifestEpoch: String(raw.manifest_epoch),
    expectedPrimaryKeyId: String(raw.expected_primary_key_id),
    expectedSecondFactorKeyId: String(raw.expected_second_factor_key_id),
    entryCount: Number(raw.entry_count),
    entries: entries.map((entry) => {
      const row = entry as Record<string, unknown>;
      return Object.freeze({
        artifactClass: Number(row.artifact_class),
        artifactId: String(row.artifact_id),
        artifactVersion: String(row.artifact_version),
        contentHash: String(row.content_hash),
        packageFileName: String(row.package_file_name),
        byteLength: Number(row.byte_length),
      });
    }),
  };

  // The candidate identity is RECOMPUTED from the document's own fields on every read, so a
  // hand-edited `candidate_id` is caught the first time any ceremony step opens the file.
  const recomputed = oracleSha256(
    candidateCoreBytes({
      candidateFormatVersion: parsed.candidateFormatVersion,
      manifestFormatVersion: parsed.manifestFormatVersion,
      manifestEpoch: parsed.manifestEpoch,
      expectedPrimaryKeyId: parsed.expectedPrimaryKeyId,
      expectedSecondFactorKeyId: parsed.expectedSecondFactorKeyId,
      entryCount: parsed.entryCount,
      entries: parsed.entries,
    }),
  ).toString('hex');
  if (recomputed !== parsed.candidateId) {
    refuse(
      'RELEASE_CANDIDATE_IDENTITY_MISMATCH',
      `the candidate document records candidate_id ${parsed.candidateId} and its own fields ` +
        `compute ${recomputed}`,
    );
  }
  if (parsed.entryCount !== parsed.entries.length) {
    refuse('RELEASE_CANDIDATE_MALFORMED', 'entry_count disagrees with the entry list');
  }
  return parsed;
}

export function parseReleaseInputDeclaration(text: string): ReleaseInputDeclaration {
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch (error) {
    refuse('RELEASE_INPUT_MALFORMED', String(error));
  }
  const raw = document as Record<string, unknown>;
  if (raw.release_input_version !== RELEASE_INPUT_VERSION) {
    refuse(
      'RELEASE_INPUT_MALFORMED',
      `release_input_version must be ${RELEASE_INPUT_VERSION}`,
    );
  }
  const channel = raw.release_channel;
  if (channel !== 'PRODUCTION' && channel !== 'TEST_ONLY') {
    refuse(
      'RELEASE_CHANNEL_UNDECLARED',
      'release_channel must be declared as "PRODUCTION" or "TEST_ONLY"; an unlabelled ' +
        'release is how a test-signed package comes to sit in a production path (§47)',
    );
  }
  const artifacts = raw.artifacts;
  if (!Array.isArray(artifacts)) {
    refuse('RELEASE_INPUT_MALFORMED', 'artifacts is not an array');
  }
  const note = raw.note;
  return {
    manifestEpoch: String(raw.manifest_epoch),
    releaseChannel: channel,
    primaryPublicKeyHex: String(raw.primary_public_key),
    secondFactorPublicKeyHex: String(raw.second_factor_public_key),
    artifacts: artifacts.map((entry) => {
      const row = entry as Record<string, unknown>;
      return Object.freeze({
        artifactClass: Number(row.artifact_class),
        artifactId: String(row.artifact_id),
        artifactVersion: String(row.artifact_version),
        packageFileName: String(row.package_file_name),
        sourcePath: String(row.source_path),
      });
    }),
    ...(typeof note === 'string' ? { note } : {}),
  };
}

export interface WrittenCandidate extends BuiltCandidate {
  readonly releaseRoot: string;
  readonly packageRoot: string;
}

/**
 * Write the candidate release directory.
 *
 * The artifact bytes are copied EXACTLY — no reserialisation, no line-ending normalisation,
 * no trailing-newline repair. `50 §2b`: "A CRLF copy is a different artifact and fails
 * verification", and a release tool that quietly repaired one would be manufacturing an
 * artifact the owner never reviewed.
 */
export function writeReleaseCandidate(
  releaseRoot: string,
  declaration: ReleaseInputDeclaration,
  baseDir: string,
): WrittenCandidate {
  const built = buildReleaseCandidate(declaration, baseDir);
  const packageRoot = join(releaseRoot, RELEASE_LAYOUT.packageDir);
  mkdirSync(packageRoot, { recursive: true });
  mkdirSync(join(releaseRoot, RELEASE_LAYOUT.approvalsDir), { recursive: true });

  for (const artifact of built.artifacts) {
    writeFileSync(join(packageRoot, artifact.packageFileName), artifact.bytes);
  }
  writeFileSync(
    join(releaseRoot, RELEASE_LAYOUT.candidateFile),
    candidateDocument(built.candidate),
    'utf8',
  );

  // NON-AUTHORITATIVE metadata, in its own file, outside both identities.
  //
  // The two PUBLIC keys are carried here so `deployment.json` can be produced without a
  // private half (`§22`), and their correctness is CHECKABLE rather than trusted: their
  // `key_id`s are re-derived and compared against the candidate's `expected_*_key_id`
  // before any deployment document is written. A public key is not a secret.
  writeFileSync(
    join(releaseRoot, RELEASE_LAYOUT.metadataFile),
    releaseJson({
      NOT_AUTHORITATIVE:
        'Operator metadata. Outside the candidate core and outside the signed manifest ' +
        'core; no runtime reads it. The deployment trust roots are provisioned out of band ' +
        'under 50 §3a and are never taken from a release output.',
      release_channel: declaration.releaseChannel,
      candidate_id: built.candidate.candidateId,
      primary_public_key: declaration.primaryPublicKeyHex,
      second_factor_public_key: declaration.secondFactorPublicKeyHex,
      ...(declaration.note === undefined ? {} : { note: declaration.note }),
    }),
    'utf8',
  );

  return { ...built, releaseRoot, packageRoot };
}

export interface ReleaseMetadata {
  readonly releaseChannel: ReleaseChannel;
  readonly candidateId: string;
  readonly primaryPublicKeyHex: string;
  readonly secondFactorPublicKeyHex: string;
  readonly note: string | null;
}

/** Read the NON-AUTHORITATIVE metadata and re-derive the two public keys' ids. */
export function readReleaseMetadata(
  releaseRoot: string,
  candidate: ReleaseCandidate,
): ReleaseMetadata {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(
      readFileSync(join(releaseRoot, RELEASE_LAYOUT.metadataFile), 'utf8'),
    ) as Record<string, unknown>;
  } catch {
    refuse('RELEASE_METADATA_MISSING', 'the release carries no release-metadata.json');
  }
  const channel = raw.release_channel;
  if (channel !== 'PRODUCTION' && channel !== 'TEST_ONLY') {
    refuse('RELEASE_CHANNEL_UNDECLARED', 'release-metadata.json declares no release_channel');
  }
  const primary = String(raw.primary_public_key);
  const secondFactor = String(raw.second_factor_public_key);
  const primaryId = oracleKeyId(rawPublicKey(primary, 'the recorded primary public key'));
  const secondFactorId = oracleKeyId(
    rawPublicKey(secondFactor, 'the recorded second-factor public key'),
  );
  if (primaryId !== candidate.expectedPrimaryKeyId) {
    refuse(
      'RELEASE_PUBLIC_KEY_MISMATCH',
      "the recorded primary public key does not derive the candidate's expected_primary_key_id",
    );
  }
  if (secondFactorId !== candidate.expectedSecondFactorKeyId) {
    refuse(
      'RELEASE_PUBLIC_KEY_MISMATCH',
      'the recorded second-factor public key does not derive the candidate’s ' +
        'expected_second_factor_key_id',
    );
  }
  const note = raw.note;
  return {
    releaseChannel: channel,
    candidateId: String(raw.candidate_id),
    primaryPublicKeyHex: primary,
    secondFactorPublicKeyHex: secondFactor,
    note: typeof note === 'string' ? note : null,
  };
}

/** Read a candidate back and re-derive its entries from the package bytes on disk. */
export function readCandidateAndPackage(releaseRoot: string): {
  readonly candidate: ReleaseCandidate;
  readonly bytesByClass: ReadonlyMap<number, Buffer>;
} {
  const candidate = parseCandidateDocument(
    readFileSync(join(releaseRoot, RELEASE_LAYOUT.candidateFile), 'utf8'),
  );
  const packageRoot = join(releaseRoot, RELEASE_LAYOUT.packageDir);
  const bytesByClass = new Map<number, Buffer>();
  for (const entry of candidate.entries) {
    let bytes: Buffer;
    try {
      bytes = readFileSync(join(packageRoot, entry.packageFileName));
    } catch (error) {
      refuse(
        'RELEASE_PACKAGE_INCOMPLETE',
        `class ${String(entry.artifactClass)}: ${entry.packageFileName} is missing from the ` +
          `release package: ${String(error)}`,
      );
    }
    const digest = oracleSha256(bytes).toString('hex');
    if (digest !== entry.contentHash) {
      refuse(
        'RELEASE_PACKAGE_DIGEST_MISMATCH',
        `class ${String(entry.artifactClass)}: ${entry.packageFileName} hashes to ${digest} ` +
          `and the reviewed candidate records ${entry.contentHash}`,
      );
    }
    bytesByClass.set(entry.artifactClass, bytes);
  }
  return { candidate, bytesByClass };
}

export function releaseBaseDir(declarationPath: string): string {
  return dirname(resolve(declarationPath));
}

export { CANDIDATE_DOMAIN, CANDIDATE_FORMAT_VERSION, RELEASE_INPUT_VERSION };
