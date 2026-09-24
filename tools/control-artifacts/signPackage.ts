import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { KeyObject } from 'node:crypto';

import {
  ed25519FromSeed,
  oracleArtifactMessage,
  oracleKeyId,
  oracleManifestCore,
  oracleManifestMessage,
  oracleSha256,
  oracleSign,
  type OracleManifestEntry,
  type OracleManifestHeader,
} from './framing.js';

/**
 * THE OFFLINE SIGNER — release tooling and test tooling, outside the runtime trust boundary.
 *
 * =================================================================================
 * WHAT THIS IS, AND WHAT IT IS NOT — `50 §3a` and `§39` of the S1K mandate
 *
 * `50 §3a`, on custody: "**Neither private key exists in application source, in this
 * repository, in any database, in any environment variable available to the runtime, on the
 * runtime filesystem, in the manifest, or in any CI fixture used by production.** Production
 * signing is an **offline release ceremony**."
 *
 * THIS MODULE IS NOT THAT CEREMONY AND DOES NOT CLAIM TO BE. It generates no key, persists
 * no key, and reads no key from anywhere: a caller hands it two `KeyObject`s. What it knows
 * is the FORMAT — `50 §3b`'s envelope and `§3d`'s core — so that a package can be assembled
 * reproducibly by whatever process actually holds the private halves.
 *
 * `§39` of the mandate: an offline signer "must: **never be imported into kernel runtime**;
 * never be reachable from application startup; take explicit private-key material only in
 * offline/test context; not generate or retain production private keys."
 * `tests/controlArtifacts/signer-boundary.test.ts` asserts the first two as a property of
 * the import graph over `src/`, not as a promise.
 *
 * =================================================================================
 * THE ENTRY ORDER IS COMPUTED HERE, AND THE VERIFIER CHECKS IT INDEPENDENTLY
 *
 * `50 §3d` declares ascending `(artifact_class, artifact_id, artifact_version)`, with the
 * two string keys compared "**byte-wise lexicographic** over its UTF-8 NFC bytes". This
 * signer sorts by that rule; `manifestCore.ts` re-checks it element-wise on the way in and
 * REFUSES rather than sorts. A signer that got the order wrong therefore produces a package
 * the runtime rejects, which is the correct direction for the mistake to fail.
 * =================================================================================
 */

export interface PackageArtifactInput {
  readonly artifactClass: number;
  readonly artifactId: string;
  readonly artifactVersion: string;
  /** The file the artifact is written to inside the package. */
  readonly fileName: string;
  /** The EXACT bytes. `50 §3c` hashes precisely these. */
  readonly bytes: Buffer;
}

export interface SigningKeyPair {
  readonly privateKey: KeyObject;
  readonly rawPublicKey: Buffer;
}

export interface BuildSignedManifestOptions {
  readonly manifestEpoch: string;
  readonly primary: SigningKeyPair;
  readonly secondFactor: SigningKeyPair;
  readonly artifacts: readonly PackageArtifactInput[];
  /**
   * TAMPER HOOKS, for the adversarial fixtures. Each one produces a package that is
   * deliberately WRONG in exactly one way, so a test can prove the verifier's refusal is
   * caused by that one thing.
   */
  readonly tamper?: {
    /** Sign the artifact messages under the PRIMARY key in both slots. */
    readonly secondFactorUsesPrimaryKey?: boolean;
    /** Sign the manifest under the PRIMARY key in both slots. */
    readonly manifestSecondFactorUsesPrimaryKey?: boolean;
    /** Put the PRIMARY-role signature bytes into the second-factor slot. */
    readonly transplantPrimaryIntoSecondFactor?: boolean;
    /** Replace the primary artifact signature with 64 zero bytes. */
    readonly voidPrimaryArtifactSignature?: number;
    /** Replace the second-factor artifact signature with 64 zero bytes. */
    readonly voidSecondFactorArtifactSignature?: number;
    /** Replace the manifest's primary signature with 64 zero bytes. */
    readonly voidManifestPrimarySignature?: boolean;
    /** Replace the manifest's second-factor signature with 64 zero bytes. */
    readonly voidManifestSecondFactorSignature?: boolean;
    /** Override `expected_primary_key_id` in the core. */
    readonly declaredPrimaryKeyId?: string;
    /** Override `expected_second_factor_key_id` in the core. */
    readonly declaredSecondFactorKeyId?: string;
    /** Emit `entry_count` as this value instead of the real one. */
    readonly declaredEntryCount?: number;
    /** Emit the entries in reverse order, leaving the signatures correct. */
    readonly reverseEntryOrder?: boolean;
    /** Emit an extra top-level field in the manifest document. */
    readonly extraDocumentField?: string;
  };
}

export interface BuiltManifest {
  readonly manifestDocument: string;
  readonly manifestId: string;
}

const MANIFEST_FORMAT_VERSION = 'ACOS-CONTROL-MANIFEST-CORE-V1';

function compareBytes(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a.normalize('NFC'), 'utf8'), Buffer.from(b.normalize('NFC'), 'utf8'));
}

function sortArtifacts(
  artifacts: readonly PackageArtifactInput[],
): readonly PackageArtifactInput[] {
  return [...artifacts].sort((a, b) => {
    if (a.artifactClass !== b.artifactClass) return a.artifactClass - b.artifactClass;
    const byId = compareBytes(a.artifactId, b.artifactId);
    if (byId !== 0) return byId;
    return compareBytes(a.artifactVersion, b.artifactVersion);
  });
}

const VOID_SIGNATURE = Buffer.alloc(64, 0);

/** Assemble and sign a manifest over a set of artifacts. */
export function buildSignedManifest(options: BuildSignedManifestOptions): BuiltManifest {
  const tamper = options.tamper ?? {};
  const ordered = sortArtifacts(options.artifacts);

  const header: OracleManifestHeader = {
    manifestFormatVersion: MANIFEST_FORMAT_VERSION,
    manifestEpoch: options.manifestEpoch,
    expectedPrimaryKeyId:
      tamper.declaredPrimaryKeyId ?? oracleKeyId(options.primary.rawPublicKey),
    expectedSecondFactorKeyId:
      tamper.declaredSecondFactorKeyId ?? oracleKeyId(options.secondFactor.rawPublicKey),
  };

  const entries: OracleManifestEntry[] = ordered.map((artifact, index) => {
    const contentSha256 = oracleSha256(artifact.bytes);
    const identity = {
      artifactClass: artifact.artifactClass,
      artifactId: artifact.artifactId,
      artifactVersion: artifact.artifactVersion,
      contentSha256,
    };

    const primaryMessage = oracleArtifactMessage('PRIMARY', identity);
    let primarySignature = oracleSign(primaryMessage, options.primary.privateKey);

    const secondFactorKey =
      tamper.secondFactorUsesPrimaryKey === true
        ? options.primary.privateKey
        : options.secondFactor.privateKey;
    let secondFactorSignature =
      tamper.transplantPrimaryIntoSecondFactor === true
        ? primarySignature
        : oracleSign(oracleArtifactMessage('SECOND_FACTOR', identity), secondFactorKey);

    if (tamper.voidPrimaryArtifactSignature === index) primarySignature = VOID_SIGNATURE;
    if (tamper.voidSecondFactorArtifactSignature === index) {
      secondFactorSignature = VOID_SIGNATURE;
    }

    return { ...identity, primarySignature, secondFactorSignature };
  });

  const coreEntries = tamper.reverseEntryOrder === true ? [...entries].reverse() : entries;
  const core = oracleManifestCore(header, coreEntries);
  const coreSha256 = oracleSha256(core);

  const manifestPrimarySignature =
    tamper.voidManifestPrimarySignature === true
      ? VOID_SIGNATURE
      : oracleSign(oracleManifestMessage('PRIMARY', header, coreSha256), options.primary.privateKey);

  const manifestSecondFactorSignature =
    tamper.voidManifestSecondFactorSignature === true
      ? VOID_SIGNATURE
      : oracleSign(
          oracleManifestMessage('SECOND_FACTOR', header, coreSha256),
          tamper.manifestSecondFactorUsesPrimaryKey === true
            ? options.primary.privateKey
            : options.secondFactor.privateKey,
        );

  const document: Record<string, unknown> = {
    manifest_format_version: header.manifestFormatVersion,
    manifest_epoch: header.manifestEpoch,
    expected_primary_key_id: header.expectedPrimaryKeyId,
    expected_second_factor_key_id: header.expectedSecondFactorKeyId,
    entry_count: tamper.declaredEntryCount ?? coreEntries.length,
    entries: coreEntries.map((entry) => ({
      artifact_class: entry.artifactClass,
      artifact_id: entry.artifactId,
      artifact_version: entry.artifactVersion,
      content_hash: entry.contentSha256.toString('hex'),
      primary_signature: entry.primarySignature.toString('hex'),
      second_factor_signature: entry.secondFactorSignature.toString('hex'),
    })),
    primary_signature: manifestPrimarySignature.toString('hex'),
    second_factor_signature: manifestSecondFactorSignature.toString('hex'),
  };
  if (tamper.extraDocumentField !== undefined) {
    document[tamper.extraDocumentField] = 'present';
  }

  return {
    manifestDocument: `${JSON.stringify(document, null, 2)}\n`,
    manifestId: coreSha256.toString('hex'),
  };
}

export interface WrittenPackage extends BuiltManifest {
  readonly root: string;
}

/** Write a package — every artifact file plus `manifest.json` — into one directory. */
export function writeSignedPackage(
  root: string,
  options: BuildSignedManifestOptions,
): WrittenPackage {
  mkdirSync(root, { recursive: true });
  for (const artifact of options.artifacts) {
    writeFileSync(join(root, artifact.fileName), artifact.bytes);
  }
  const built = buildSignedManifest(options);
  writeFileSync(join(root, 'manifest.json'), built.manifestDocument, 'utf8');
  return { ...built, root };
}

export { ed25519FromSeed };
