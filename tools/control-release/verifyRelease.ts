import { createPublicKey, verify as ed25519Verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  oracleArtifactMessage,
  oracleManifestCore,
  oracleManifestMessage,
  oracleSha256,
  oracleKeyId,
  type OracleManifestEntry,
  type OracleManifestHeader,
} from '../control-artifacts/framing.js';
import { RELEASE_LAYOUT } from './candidate.js';
import {
  MANIFEST_FILE_NAME,
  MANIFEST_FORMAT_VERSION,
  PRE_LIVE_INVENTORY,
  RETIRED_ARTIFACT_CLASS,
  inventoryMember,
} from './inventory.js';

/**
 * THE OPERATOR'S OFFLINE RELEASE VERIFIER — `§20` OF THE S1L MANDATE.
 *
 * =================================================================================
 * WHAT IT IS FOR, AND WHAT IT IS EXPLICITLY NOT
 *
 * `§20`: "Provide a verification command [...] that independently recomputes: artifact
 * hashes; manifest identity; all signatures. **This offline verification command is useful
 * for operators. It does NOT replace runtime bootstrap verification.**"
 *
 * So this returns a REPORT rather than a capability. It publishes nothing, it seals nothing,
 * and no `src/` module imports it. `50 §3f`'s occasion-1 ceremony inside the kernel remains
 * the only thing that can make a bundle authoritative, and this tool's verdict has no
 * standing with it whatsoever.
 *
 * =================================================================================
 * THE TWO PUBLIC KEYS ARE AN INPUT, NEVER A READ FROM THE RELEASE
 *
 * `50 §3a`: "**TRUST-ON-FIRST-USE IS FORBIDDEN** [...] The manifest may carry key IDs for
 * consistency checking, but it **CANNOT DEFINE WHICH PUBLIC KEYS ARE TRUSTED.**"
 *
 * `verifyReleaseDirectory` therefore takes the two raw public keys as arguments. It reads
 * `expected_primary_key_id` and `expected_second_factor_key_id` from the core only to CHECK
 * them against the supplied keys' derived ids, in that direction, exactly as the runtime
 * verifier does. Passing the keys out of `deployment.json` is an operator convenience the
 * CLI offers with a printed warning; it is not what makes a verdict meaningful.
 * =================================================================================
 */

export interface ReleaseVerificationFinding {
  readonly code: string;
  readonly detail: string;
}

export interface ReleaseVerificationReport {
  readonly verified: boolean;
  readonly manifestId: string | null;
  readonly manifestEpoch: string | null;
  readonly entries: readonly {
    readonly artifactClass: number;
    readonly artifactId: string;
    readonly artifactVersion: string;
    readonly contentHash: string;
    readonly byteLength: number;
  }[];
  readonly findings: readonly ReleaseVerificationFinding[];
}

function ed25519VerifyRaw(
  message: Buffer,
  rawPublicKey: Buffer,
  signature: Buffer,
): boolean {
  if (rawPublicKey.length !== 32 || signature.length !== 64) return false;
  try {
    const key = createPublicKey({
      key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), rawPublicKey]),
      format: 'der',
      type: 'spki',
    });
    return ed25519Verify(null, message, key, signature);
  } catch {
    return false;
  }
}

function hexBuffer(value: unknown, byteLength: number): Buffer | null {
  if (typeof value !== 'string') return null;
  if (value.length !== byteLength * 2) return null;
  if (!/^[0-9a-f]+$/.test(value)) return null;
  return Buffer.from(value, 'hex');
}

function compareNfcBytes(a: string, b: string): number {
  return Buffer.compare(
    Buffer.from(a.normalize('NFC'), 'utf8'),
    Buffer.from(b.normalize('NFC'), 'utf8'),
  );
}

/**
 * Verify a DEPLOYABLE PACKAGE — the flat directory a plane is pointed at.
 *
 * The same function serves a release directory's `package/` subdirectory and a deployed
 * copy, which is deliberate: an operator checking "is the thing I copied to the host the
 * thing we signed" is running exactly the check the release ceremony ran.
 */
export function verifyPackageDirectory(
  packageRoot: string,
  primaryPublicKey: Buffer,
  secondFactorPublicKey: Buffer,
): ReleaseVerificationReport {
  const findings: ReleaseVerificationFinding[] = [];
  const fail = (code: string, detail: string): ReleaseVerificationReport => {
    findings.push({ code, detail });
    return { verified: false, manifestId: null, manifestEpoch: null, entries: [], findings };
  };

  if (primaryPublicKey.length !== 32 || secondFactorPublicKey.length !== 32) {
    return fail('TRUST_ROOT_MALFORMED', 'a supplied root is not 32 raw Ed25519 public-key bytes');
  }
  if (primaryPublicKey.equals(secondFactorPublicKey)) {
    return fail(
      'TRUST_ROOTS_NOT_DISTINCT',
      'one key was supplied in both root slots; a second signature under the primary key ' +
        'does not satisfy the second-factor requirement (50 §3a)',
    );
  }

  let document: Record<string, unknown>;
  try {
    document = JSON.parse(readFileSync(join(packageRoot, MANIFEST_FILE_NAME), 'utf8')) as Record<
      string,
      unknown
    >;
  } catch (error) {
    return fail('MANIFEST_UNREADABLE', String(error));
  }

  if (document.manifest_format_version !== MANIFEST_FORMAT_VERSION) {
    return fail('MANIFEST_MALFORMED', 'unrecognised manifest_format_version');
  }
  const epoch = document.manifest_epoch;
  const declaredPrimaryKeyId = document.expected_primary_key_id;
  const declaredSecondFactorKeyId = document.expected_second_factor_key_id;
  const rawEntries = document.entries;
  if (
    typeof epoch !== 'string' ||
    typeof declaredPrimaryKeyId !== 'string' ||
    typeof declaredSecondFactorKeyId !== 'string' ||
    typeof document.entry_count !== 'number' ||
    !Array.isArray(rawEntries)
  ) {
    return fail('MANIFEST_MALFORMED', 'the manifest core fields are not well formed');
  }
  if (document.entry_count !== rawEntries.length) {
    return fail(
      'MANIFEST_ENTRY_COUNT_MISMATCH',
      `entry_count is ${String(document.entry_count)} and ${String(rawEntries.length)} ` +
        'entries are present (50 §3d)',
    );
  }

  const header: OracleManifestHeader = {
    manifestFormatVersion: MANIFEST_FORMAT_VERSION,
    manifestEpoch: epoch,
    expectedPrimaryKeyId: declaredPrimaryKeyId,
    expectedSecondFactorKeyId: declaredSecondFactorKeyId,
  };

  // `50 §3a`, and the direction matters: the supplied keys are the anchor and the core's
  // declared ids are checked AGAINST them.
  if (oracleKeyId(primaryPublicKey) !== declaredPrimaryKeyId) {
    return fail(
      'MANIFEST_KEY_ID_MISMATCH',
      'the core names an expected_primary_key_id the supplied primary key does not derive',
    );
  }
  if (oracleKeyId(secondFactorPublicKey) !== declaredSecondFactorKeyId) {
    return fail(
      'MANIFEST_KEY_ID_MISMATCH',
      'the core names an expected_second_factor_key_id the supplied second-factor key does ' +
        'not derive',
    );
  }

  const coreEntries: OracleManifestEntry[] = [];
  const reported: {
    artifactClass: number;
    artifactId: string;
    artifactVersion: string;
    contentHash: string;
    byteLength: number;
  }[] = [];
  const seen = new Set<number>();

  for (const raw of rawEntries) {
    const row = raw as Record<string, unknown>;
    const artifactClass = row.artifact_class;
    const artifactId = row.artifact_id;
    const artifactVersion = row.artifact_version;
    if (
      typeof artifactClass !== 'number' ||
      typeof artifactId !== 'string' ||
      typeof artifactVersion !== 'string'
    ) {
      return fail('MANIFEST_MALFORMED', 'an entry’s identity fields are not well formed');
    }
    if (artifactClass === RETIRED_ARTIFACT_CLASS) {
      return fail(
        'RETIRED_CLASS_PRESENT',
        `the manifest carries a class-${String(RETIRED_ARTIFACT_CLASS)} entry; that class is ` +
          'RETIRED, reserved and deprecated (50 §2d)',
      );
    }
    const member = inventoryMember(artifactClass);
    if (member === undefined) {
      return fail(
        'UNEXPECTED_ARTIFACT_CLASS',
        `class ${String(artifactClass)} is outside 50 §6’s closed pre-live set`,
      );
    }
    if (member.artifactId !== artifactId) {
      return fail(
        'ARTIFACT_IDENTITY_UNEXPECTED',
        `class ${String(artifactClass)} declares artifact_id "${artifactId}"; 50 §6 declares ` +
          `"${member.artifactId}"`,
      );
    }
    if (member.declaredVersion !== null && member.declaredVersion !== artifactVersion) {
      return fail(
        'ARTIFACT_IDENTITY_UNEXPECTED',
        `class ${String(artifactClass)} declares artifact_version "${artifactVersion}"; ` +
          `50 §6 declares "${member.declaredVersion}"`,
      );
    }
    if (seen.has(artifactClass)) {
      return fail(
        'MANIFEST_DUPLICATE_ENTRY',
        `two class-${String(artifactClass)} entries are present`,
      );
    }
    seen.add(artifactClass);

    const contentSha256 = hexBuffer(row.content_hash, 32);
    const primarySignature = hexBuffer(row.primary_signature, 64);
    const secondFactorSignature = hexBuffer(row.second_factor_signature, 64);
    if (contentSha256 === null || primarySignature === null || secondFactorSignature === null) {
      return fail(
        'MANIFEST_MALFORMED',
        `class ${String(artifactClass)} carries a malformed digest or signature`,
      );
    }

    coreEntries.push({
      artifactClass,
      artifactId,
      artifactVersion,
      contentSha256,
      primarySignature,
      secondFactorSignature,
    });
    reported.push({
      artifactClass,
      artifactId,
      artifactVersion,
      contentHash: contentSha256.toString('hex'),
      byteLength: 0,
    });
  }

  for (const member of PRE_LIVE_INVENTORY) {
    if (!seen.has(member.artifactClass)) {
      return fail(
        'REQUIRED_ARTIFACT_MISSING',
        `no class-${String(member.artifactClass)} entry (${member.artifactId}); 50 §6’s set ` +
          'is CLOSED and no member is optional',
      );
    }
  }

  // `50 §3d`'s declared order is normative, and a verifier that SORTED would accept a
  // reordered core it should refuse.
  for (let index = 1; index < coreEntries.length; index += 1) {
    const previous = coreEntries[index - 1]!;
    const current = coreEntries[index]!;
    const ordered =
      previous.artifactClass < current.artifactClass ||
      (previous.artifactClass === current.artifactClass &&
        (compareNfcBytes(previous.artifactId, current.artifactId) < 0 ||
          (previous.artifactId === current.artifactId &&
            compareNfcBytes(previous.artifactVersion, current.artifactVersion) < 0)));
    if (!ordered) {
      return fail(
        'MANIFEST_ORDER_INVALID',
        'the entries are not in 50 §3d’s ascending (class, id, version) order',
      );
    }
  }

  const coreSha256 = oracleSha256(oracleManifestCore(header, coreEntries));
  const manifestId = coreSha256.toString('hex');

  const manifestPrimarySignature = hexBuffer(document.primary_signature, 64);
  const manifestSecondFactorSignature = hexBuffer(document.second_factor_signature, 64);
  if (manifestPrimarySignature === null || manifestSecondFactorSignature === null) {
    return fail('MANIFEST_MALFORMED', 'a manifest signature is malformed');
  }
  if (
    !ed25519VerifyRaw(
      oracleManifestMessage('PRIMARY', header, coreSha256),
      primaryPublicKey,
      manifestPrimarySignature,
    )
  ) {
    return fail(
      'MANIFEST_PRIMARY_SIGNATURE_INVALID',
      'the manifest core carries no valid PRIMARY signature under the supplied root',
    );
  }
  if (
    !ed25519VerifyRaw(
      oracleManifestMessage('SECOND_FACTOR', header, coreSha256),
      secondFactorPublicKey,
      manifestSecondFactorSignature,
    )
  ) {
    return fail(
      'MANIFEST_SECOND_FACTOR_SIGNATURE_INVALID',
      'the manifest core carries no valid SECOND_FACTOR signature; one valid signature is ' +
        'REFUSED and is never reported as verified (50 §4)',
    );
  }

  for (const [index, entry] of coreEntries.entries()) {
    const fileName = packageFileNameFor(entry.artifactClass, packageRoot);
    let bytes: Buffer;
    try {
      bytes = readFileSync(join(packageRoot, fileName));
    } catch {
      return fail(
        'ARTIFACT_BYTES_UNREADABLE',
        `class ${String(entry.artifactClass)}: ${fileName} is missing from the package`,
      );
    }
    const digest = oracleSha256(bytes);
    if (!digest.equals(entry.contentSha256)) {
      return fail(
        'ARTIFACT_CONTENT_HASH_MISMATCH',
        `class ${String(entry.artifactClass)}: the exact bytes at ${fileName} hash to ` +
          `${digest.toString('hex')} and the signed entry declares ` +
          `${entry.contentSha256.toString('hex')} (50 §3c)`,
      );
    }
    reported[index]!.byteLength = bytes.length;

    const identity = {
      artifactClass: entry.artifactClass,
      artifactId: entry.artifactId,
      artifactVersion: entry.artifactVersion,
      contentSha256: entry.contentSha256,
    };
    if (
      !ed25519VerifyRaw(
        oracleArtifactMessage('PRIMARY', identity),
        primaryPublicKey,
        entry.primarySignature,
      )
    ) {
      return fail(
        'ARTIFACT_PRIMARY_SIGNATURE_INVALID',
        `class ${String(entry.artifactClass)} carries no valid PRIMARY signature (50 §3b)`,
      );
    }
    if (
      !ed25519VerifyRaw(
        oracleArtifactMessage('SECOND_FACTOR', identity),
        secondFactorPublicKey,
        entry.secondFactorSignature,
      )
    ) {
      return fail(
        'ARTIFACT_SECOND_FACTOR_SIGNATURE_INVALID',
        `class ${String(entry.artifactClass)} carries no valid SECOND_FACTOR signature; one ` +
          'valid signature is REFUSED (50 §4)',
      );
    }
  }

  return {
    verified: true,
    manifestId,
    manifestEpoch: epoch,
    entries: reported.map((entry) => Object.freeze({ ...entry })),
    findings,
  };
}

/**
 * The package file name for a class.
 *
 * `50 §3d`'s core binds `artifact_class`, `artifact_id`, `artifact_version` and
 * `content_sha256` and does NOT bind a file name, so the mapping is a deployment convention.
 * It is resolved from the package's own `candidate.json` when one is beside it, and
 * otherwise from the fixed naming this repository deploys. **There is no directory scan and
 * no "first matching file wins"** (`§21`): exactly one name is tried, and a miss is a
 * refusal.
 */
function packageFileNameFor(artifactClass: number, packageRoot: string): string {
  const candidatePath = join(packageRoot, '..', RELEASE_LAYOUT.candidateFile);
  try {
    const document = JSON.parse(readFileSync(candidatePath, 'utf8')) as Record<string, unknown>;
    const entries = document.entries;
    if (Array.isArray(entries)) {
      for (const raw of entries) {
        const row = raw as Record<string, unknown>;
        if (row.artifact_class === artifactClass && typeof row.package_file_name === 'string') {
          return row.package_file_name;
        }
      }
    }
  } catch {
    // No candidate beside the package — a deployed copy. Fall through to the convention.
  }
  return DEPLOYED_FILE_NAMES[artifactClass] ?? `class-${String(artifactClass)}.unknown`;
}

/** The repository's deployed package naming. A convention, not an authority binding. */
export const DEPLOYED_FILE_NAMES: Readonly<Record<number, string>> = Object.freeze({
  2: 'class-02.policy-set.json',
  3: 'class-03.action-catalogue.json',
  // v1.3.7, `50 §2g`. The seventh pre-live member.
  5: 'class-05.credential-scopes.json',
  19: 'class-19.effect-constructors.json',
  20: 'class-20.acos-jcs-1.spec.v1.txt',
  24: 'class-24.audit-signing-key.json',
  27: 'class-27.degraded-mode-config.json',
  28: 'class-28.provider-evidence-trust.json',
});

/** Verify a RELEASE directory by verifying the package it carries. */
export function verifyReleaseDirectory(
  releaseRoot: string,
  primaryPublicKey: Buffer,
  secondFactorPublicKey: Buffer,
): ReleaseVerificationReport {
  return verifyPackageDirectory(
    join(releaseRoot, RELEASE_LAYOUT.packageDir),
    primaryPublicKey,
    secondFactorPublicKey,
  );
}
