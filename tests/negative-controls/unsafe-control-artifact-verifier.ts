import { createHash, createPublicKey, verify as edVerify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * TEST-ONLY VULNERABLE CONTROL-ARTIFACT VERIFIERS.
 *
 * =================================================================================
 * WHY THESE EXIST — the repository's own doctrine, applied to `50 §3`
 *
 * Every accepted slice in this repository carries `tests/negative-controls/unsafe-*.ts`
 * modules for the same reason: **a control that has never failed is indistinguishable from
 * one that cannot**. A test that asserts the production verifier REFUSES a forged manifest
 * proves nothing on its own — a verifier that refused everything would pass it. The
 * discriminating form is a SECOND implementation that makes the specific mistake, run
 * against the SAME fixture, which must ACCEPT what production refuses.
 *
 * `§57` of the S1K mandate lists eighteen required vulnerable controls. Ten of them are
 * verifier-shaped and live here, each as a real branch rather than a flag that skips a
 * check, so that the code a reader sees is the code an unlucky implementer would have
 * written.
 *
 * NOTHING UNDER `src/` IMPORTS THIS FILE, and
 * `tests/controlArtifacts/boundaries.test.ts` asserts that over the whole production tree.
 * =================================================================================
 */

/** The ten verifier-shaped defects of `§57`. */
export type UnsafeVerifierDefect =
  /** 1. Trust-on-first-use: the first manifest's declared keys become the trusted roots. */
  | 'TOFU_ROOT'
  /** 2. The manifest names its own verification keys, and the verifier believes it. */
  | 'MANIFEST_SUPPLIED_ROOT'
  /** 3. One valid signature is enough; the second factor is "optional". */
  | 'SINGLE_SIGNATURE_ACCEPTED'
  /** 4. One key satisfies both roles, because the roles are only labels. */
  | 'SAME_KEY_SATISFIES_BOTH_ROLES'
  /** 5. The signature envelope omits `artifact_class`. */
  | 'ENVELOPE_OMITS_CLASS'
  /** 6. The signature envelope omits `signer_role`. */
  | 'ENVELOPE_OMITS_SIGNER_ROLE'
  /** 7. The content hash is over a parsed, reserialised object rather than exact bytes. */
  | 'SEMANTIC_NORMALISED_HASH'
  /** 8. Any correctly dual-signed manifest is accepted; there is no deployment pin. */
  | 'NO_DEPLOYMENT_PIN'
  /** 9. Rollback protection is "the highest epoch on disk". */
  | 'HIGHEST_EPOCH_WINS'
  /** 10. A required entry that is missing is simply not checked. */
  | 'MISSING_ENTRY_IGNORED';

export interface UnsafeVerificationResult {
  readonly accepted: boolean;
  readonly reason?: string;
  readonly manifestId?: string;
}

const ARTIFACT_DOMAIN = 'ACOS-CONTROL-ARTIFACT-SIGNATURE-V1';
const MANIFEST_DOMAIN = 'ACOS-CONTROL-MANIFEST-SIGNATURE-V1';
const CORE_DOMAIN = 'ACOS-CONTROL-MANIFEST-CORE-V1';

const REQUIRED_CLASSES: readonly { readonly artifactClass: number; readonly fileName: string }[] =
  Object.freeze([
    { artifactClass: 2, fileName: 'class-02.policy-set.json' },
    { artifactClass: 3, fileName: 'class-03.action-catalogue.json' },
    { artifactClass: 19, fileName: 'class-19.effect-constructors.json' },
    { artifactClass: 20, fileName: 'class-20.acos-jcs-1.spec.v1.txt' },
    { artifactClass: 24, fileName: 'class-24.audit-signing-key.json' },
    { artifactClass: 27, fileName: 'class-27.degraded-mode-config.json' },
  ]);

function u32(length: number): Buffer {
  const out = Buffer.alloc(4);
  out.writeUInt32BE(length, 0);
  return out;
}

function fld(payload: Buffer): Buffer {
  return Buffer.concat([u32(payload.length), payload]);
}

function txt(value: string): Buffer {
  return fld(Buffer.from(value.normalize('NFC'), 'utf8'));
}

function num(value: number): Buffer {
  return txt(String(value));
}

function sha256(bytes: Uint8Array): Buffer {
  return createHash('sha256').update(bytes).digest();
}

function verifyRaw(message: Buffer, rawPublicKey: Buffer, signature: Buffer): boolean {
  try {
    const key = createPublicKey({
      key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), rawPublicKey]),
      format: 'der',
      type: 'spki',
    });
    return edVerify(null, message, key, signature);
  } catch {
    return false;
  }
}

interface RawEntry {
  readonly artifact_class: number;
  readonly artifact_id: string;
  readonly artifact_version: string;
  readonly content_hash: string;
  readonly primary_signature: string;
  readonly second_factor_signature: string;
}

interface RawManifest {
  readonly manifest_format_version: string;
  readonly manifest_epoch: string;
  readonly expected_primary_key_id: string;
  readonly expected_second_factor_key_id: string;
  readonly entry_count: number;
  readonly entries: readonly RawEntry[];
  readonly primary_signature: string;
  readonly second_factor_signature: string;
}

/**
 * THE VULNERABLE ARTIFACT MESSAGE.
 *
 * Defects 5 and 6 are expressed HERE, by leaving a field out of the framing, because that
 * is how the mistake is actually made: the envelope is written from the struct that was
 * handy rather than from `50 §3b`'s printed message, and the fields that were "obviously"
 * redundant are dropped.
 */
function unsafeArtifactMessage(
  defect: UnsafeVerifierDefect,
  role: 'PRIMARY' | 'SECOND_FACTOR',
  entry: RawEntry,
): Buffer {
  const parts: Buffer[] = [txt(ARTIFACT_DOMAIN)];
  if (defect !== 'ENVELOPE_OMITS_SIGNER_ROLE') parts.push(txt(role));
  if (defect !== 'ENVELOPE_OMITS_CLASS') parts.push(num(entry.artifact_class));
  parts.push(txt(entry.artifact_id));
  parts.push(txt(entry.artifact_version));
  parts.push(fld(Buffer.from(entry.content_hash, 'hex')));
  return Buffer.concat(parts);
}

function manifestCore(manifest: RawManifest): Buffer {
  const parts: Buffer[] = [
    txt(CORE_DOMAIN),
    txt(manifest.manifest_format_version),
    txt(manifest.manifest_epoch),
    txt(manifest.expected_primary_key_id),
    txt(manifest.expected_second_factor_key_id),
    num(manifest.entries.length),
  ];
  for (const entry of manifest.entries) {
    parts.push(num(entry.artifact_class));
    parts.push(txt(entry.artifact_id));
    parts.push(txt(entry.artifact_version));
    parts.push(fld(Buffer.from(entry.content_hash, 'hex')));
    parts.push(fld(Buffer.from(entry.primary_signature, 'hex')));
    parts.push(fld(Buffer.from(entry.second_factor_signature, 'hex')));
  }
  return Buffer.concat(parts);
}

function manifestMessage(
  role: 'PRIMARY' | 'SECOND_FACTOR',
  manifest: RawManifest,
  coreSha256: Buffer,
): Buffer {
  return Buffer.concat([
    txt(MANIFEST_DOMAIN),
    txt(role),
    txt(manifest.manifest_format_version),
    txt(manifest.manifest_epoch),
    txt(manifest.expected_primary_key_id),
    txt(manifest.expected_second_factor_key_id),
    fld(coreSha256),
  ]);
}

/**
 * `SEMANTIC_NORMALISED_HASH` — defect 7.
 *
 * `50 §3c` names this exact mistake in its list of what is NEVER hashed: "a parsed semantic
 * object; a **reserialised JSON document**; a pretty-printed object". The unsafe verifier
 * parses the artifact, reserialises it with sorted keys, and hashes that — so two files that
 * differ by whitespace, key order or a trailing newline hash ALIKE and a stale signature
 * keeps verifying over bytes nobody signed.
 *
 * Non-JSON artifacts fall back to the exact bytes, which is what makes the defect specific
 * rather than total: the class-20 specification is a text file and is unaffected, and the
 * discrimination therefore has to come from a JSON artifact.
 */
function unsafeContentDigest(bytes: Buffer): Buffer {
  try {
    const parsed: unknown = JSON.parse(bytes.toString('utf8'));
    return sha256(Buffer.from(JSON.stringify(sortDeep(parsed)), 'utf8'));
  } catch {
    return sha256(bytes);
  }
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortDeep((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

export interface UnsafeVerifierInput {
  /** The package directory. */
  readonly root: string;
  /** What the deployment believes the roots are — ignored by the TOFU and manifest defects. */
  readonly primaryPublicKeyHex?: string;
  readonly secondFactorPublicKeyHex?: string;
  /** The pin — ignored by defects 8 and 9. */
  readonly expectedActiveManifestId?: string;
  /**
   * A directory of OTHER manifests, for `HIGHEST_EPOCH_WINS`: the unsafe verifier picks the
   * highest `manifest_epoch` it can find instead of honouring a pin.
   */
  readonly alternativeRoots?: readonly string[];
  /** A key-id to public-key directory the manifest-supplied-root defect resolves against. */
  readonly keyDirectory?: Readonly<Record<string, string>>;
}

/** Run one deliberately vulnerable verifier over a real package. */
export function unsafeVerifyControlArtifacts(
  defect: UnsafeVerifierDefect,
  input: UnsafeVerifierInput,
): UnsafeVerificationResult {
  const candidateRoots = [input.root, ...(input.alternativeRoots ?? [])];

  let root = input.root;
  let manifest: RawManifest;
  try {
    if (defect === 'HIGHEST_EPOCH_WINS') {
      // THE DEFECT: rollback protection by epoch comparison over whatever is on disk.
      // `50 §3e`: "**"THE HIGHEST EPOCH FOUND ON DISK" IS NOT ROLLBACK PROTECTION AND IS NOT
      // USED.**"
      let best: { root: string; manifest: RawManifest } | null = null;
      for (const candidate of candidateRoots) {
        const parsed = JSON.parse(
          readFileSync(join(candidate, 'manifest.json'), 'utf8'),
        ) as RawManifest;
        if (best === null || Number(parsed.manifest_epoch) > Number(best.manifest.manifest_epoch)) {
          best = { root: candidate, manifest: parsed };
        }
      }
      root = best!.root;
      manifest = best!.manifest;
    } else {
      manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')) as RawManifest;
    }
  } catch (error) {
    return { accepted: false, reason: `unreadable: ${String(error)}` };
  }

  const core = manifestCore(manifest);
  const coreSha256 = sha256(core);
  const manifestId = coreSha256.toString('hex');

  // THE PIN. Defects 1, 2, 8 and 9 do not have one.
  const pinChecked =
    defect !== 'NO_DEPLOYMENT_PIN' && defect !== 'HIGHEST_EPOCH_WINS' && defect !== 'TOFU_ROOT';
  if (pinChecked && input.expectedActiveManifestId !== undefined) {
    if (manifestId !== input.expectedActiveManifestId) {
      return { accepted: false, reason: 'MANIFEST_IDENTITY_NOT_PINNED', manifestId };
    }
  }

  // THE ROOTS. This is where defects 1, 2 and 4 live.
  let primaryKey: Buffer;
  let secondFactorKey: Buffer;
  if (defect === 'TOFU_ROOT') {
    // THE DEFECT: "remember the key that first verified". The first manifest this process
    // sees names its own roots, and they are adopted. `50 §3a`: "**TRUST-ON-FIRST-USE IS
    // FORBIDDEN.**"
    const directory = input.keyDirectory ?? {};
    primaryKey = Buffer.from(directory[manifest.expected_primary_key_id] ?? '', 'hex');
    secondFactorKey = Buffer.from(directory[manifest.expected_second_factor_key_id] ?? '', 'hex');
  } else if (defect === 'MANIFEST_SUPPLIED_ROOT') {
    // THE DEFECT: the manifest's declared key ids SELECT the verifying keys. `50 §3a`:
    // "**The manifest may carry key IDs for consistency checking, but it CANNOT DEFINE WHICH
    // PUBLIC KEYS ARE TRUSTED.**"
    const directory = input.keyDirectory ?? {};
    primaryKey = Buffer.from(directory[manifest.expected_primary_key_id] ?? '', 'hex');
    secondFactorKey = Buffer.from(directory[manifest.expected_second_factor_key_id] ?? '', 'hex');
  } else {
    primaryKey = Buffer.from(input.primaryPublicKeyHex ?? '', 'hex');
    secondFactorKey = Buffer.from(input.secondFactorPublicKeyHex ?? '', 'hex');
    if (defect === 'SAME_KEY_SATISFIES_BOTH_ROLES') {
      // THE DEFECT: the distinctness check is missing, so a deployment that configured one
      // key twice runs happily. `50 §3a`: "A deployment configuring the same key in both
      // slots **fails closed at bootstrap** and never becomes READY."
      secondFactorKey = primaryKey;
    }
  }

  if (primaryKey.length !== 32 || secondFactorKey.length !== 32) {
    return { accepted: false, reason: 'ROOT_KEY_UNRESOLVED', manifestId };
  }

  const requireSecondFactor = defect !== 'SINGLE_SIGNATURE_ACCEPTED';

  if (
    !verifyRaw(
      manifestMessage('PRIMARY', manifest, coreSha256),
      primaryKey,
      Buffer.from(manifest.primary_signature, 'hex'),
    )
  ) {
    return { accepted: false, reason: 'MANIFEST_PRIMARY_SIGNATURE_INVALID', manifestId };
  }
  if (
    requireSecondFactor &&
    !verifyRaw(
      manifestMessage('SECOND_FACTOR', manifest, coreSha256),
      secondFactorKey,
      Buffer.from(manifest.second_factor_signature, 'hex'),
    )
  ) {
    return { accepted: false, reason: 'MANIFEST_SECOND_FACTOR_SIGNATURE_INVALID', manifestId };
  }

  const byClass = new Map<number, RawEntry>();
  for (const entry of manifest.entries) byClass.set(entry.artifact_class, entry);

  for (const required of REQUIRED_CLASSES) {
    const entry = byClass.get(required.artifactClass);
    if (entry === undefined) {
      // THE DEFECT: an absent entry is an absent CHECK rather than a refusal. `50 §3d`: "A
      // deleted row removes a requirement".
      if (defect === 'MISSING_ENTRY_IGNORED') continue;
      return { accepted: false, reason: 'REQUIRED_ARTIFACT_MISSING', manifestId };
    }

    let bytes: Buffer;
    try {
      bytes = readFileSync(join(root, required.fileName));
    } catch {
      if (defect === 'MISSING_ENTRY_IGNORED') continue;
      return { accepted: false, reason: 'ARTIFACT_BYTES_UNREADABLE', manifestId };
    }

    const computed =
      defect === 'SEMANTIC_NORMALISED_HASH' ? unsafeContentDigest(bytes) : sha256(bytes);
    if (computed.toString('hex') !== entry.content_hash) {
      return { accepted: false, reason: 'ARTIFACT_CONTENT_HASH_MISMATCH', manifestId };
    }

    if (
      !verifyRaw(
        unsafeArtifactMessage(defect, 'PRIMARY', entry),
        primaryKey,
        Buffer.from(entry.primary_signature, 'hex'),
      )
    ) {
      return { accepted: false, reason: 'ARTIFACT_PRIMARY_SIGNATURE_INVALID', manifestId };
    }
    if (
      requireSecondFactor &&
      !verifyRaw(
        unsafeArtifactMessage(defect, 'SECOND_FACTOR', entry),
        secondFactorKey,
        Buffer.from(entry.second_factor_signature, 'hex'),
      )
    ) {
      return { accepted: false, reason: 'ARTIFACT_SECOND_FACTOR_SIGNATURE_INVALID', manifestId };
    }
  }

  return { accepted: true, manifestId };
}
