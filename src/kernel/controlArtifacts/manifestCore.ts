import {
  ED25519_SIGNATURE_BYTES,
  MANIFEST_FORMAT_VERSION,
  SHA256_DIGEST_BYTES,
  manifestCoreBytes,
  type ManifestCoreEntryFields,
  type ManifestCoreHeaderFields,
} from './casSig.js';
import { decodeLowercaseHex, hexOf, sha256 } from './ed25519.js';
import { integrityFailure, quoted } from './errors.js';

/**
 * `50 §3d`'s MANIFEST CORE, and `50 §3e`'s `manifest_id`.
 *
 * =================================================================================
 * WHY A CORE EXISTS AT ALL — `50 §3d`, verbatim
 *
 *   "**Per-artifact signatures authenticate the rows that are present. They do not protect
 *    the ROW SET.** A deleted row removes a requirement; an inserted row adds one; a
 *    reordering or a substitution of a complete, validly signed older set defeats every
 *    per-row signature without forging anything."
 *
 * =================================================================================
 * THE DOCUMENT IS A TRANSPORT. THE CORE IS THE AUTHORITY.
 *
 * The manifest arrives as a JSON document because a deployment needs something to put in a
 * release package, and `50` declares no on-disk container. What is HASHED AND SIGNED is
 * never that document: it is `§3d`'s fixed `ACOS-CAS-SIG-V1` framing over the parsed
 * fields. So `JSON.parse` runs here, `JSON.stringify` never does, and no property order,
 * whitespace choice or duplicate-key resolution of the transport can move `manifest_id`.
 *
 * That is the deliberate difference from `§3c`'s artifact rule. An ARTIFACT's hash is over
 * its EXACT BYTES because the artifact is the thing being protected. The MANIFEST's identity
 * is over a REFRAMING of its fields because the manifest is a set declaration, and a set
 * declaration that changed identity when an operator reformatted the file would be unusable
 * without adding a canonicalisation — which is exactly what `§3b` forbids depending on.
 * =================================================================================
 *
 * =================================================================================
 * UNKNOWN FIELDS ARE REJECTED, NOT IGNORED
 *
 * `50 §3d`: "**Each artifact entry carries exactly:** `artifact_class`; `artifact_id`;
 * `artifact_version`; `content_hash`; `primary_signature`; `second_factor_signature`."
 *
 * "Exactly" is a closed enumeration, and the same rule `50 §2a` applies to class 3's content
 * applies to the manifest's own: a field outside the boundary is either an accident that
 * changes nothing or an instruction nobody reviewed, and the parser cannot tell which. A
 * permissive parser would also let a field be added that a FUTURE reader treats as
 * authoritative while today's `manifest_id` computation ignores it.
 * =================================================================================
 */

/** One parsed manifest entry, in the runtime's own representation. */
export interface ManifestEntry {
  readonly artifactClass: number;
  readonly artifactId: string;
  readonly artifactVersion: string;
  /** Lowercase hex, 64 characters. */
  readonly contentHash: string;
  /** The 32 raw bytes behind `contentHash`. */
  readonly contentSha256: Uint8Array;
  readonly primarySignature: Uint8Array;
  readonly secondFactorSignature: Uint8Array;
}

/** A parsed manifest: the core's fields, its entries, and the two signatures beside it. */
export interface ParsedManifest {
  readonly header: ManifestCoreHeaderFields;
  readonly entries: readonly ManifestEntry[];
  /** `50 §3d`: NOT inside the bytes being signed. Carried beside the core. */
  readonly primarySignature: Uint8Array;
  readonly secondFactorSignature: Uint8Array;
  /** `50 §3e`: `manifest_id = SHA-256(exact CORE bytes)`, lowercase hex. */
  readonly manifestId: string;
  /** The exact CORE bytes, recomputed from the parsed fields by `§3d`'s framing. */
  readonly coreBytes: Uint8Array;
  /** `SHA-256(CORE)`, raw, for `M_manifest`. */
  readonly coreSha256: Uint8Array;
}

const MANIFEST_DOCUMENT_FIELDS = [
  'manifest_format_version',
  'manifest_epoch',
  'expected_primary_key_id',
  'expected_second_factor_key_id',
  'entry_count',
  'entries',
  'primary_signature',
  'second_factor_signature',
] as const;

const MANIFEST_ENTRY_FIELDS = [
  'artifact_class',
  'artifact_id',
  'artifact_version',
  'content_hash',
  'primary_signature',
  'second_factor_signature',
] as const;

function assertExactFields(
  value: Record<string, unknown>,
  allowed: readonly string[],
  where: string,
): void {
  const present = Object.keys(value).sort();
  const unexpected = present.filter((key) => !allowed.includes(key));
  const missing = [...allowed].sort().filter((key) => !present.includes(key));
  if (unexpected.length > 0 || missing.length > 0) {
    integrityFailure(
      unexpected.length > 0 ? 'MANIFEST_UNKNOWN_FIELD' : 'MANIFEST_MALFORMED',
      `${where} carries exactly the declared fields; missing [${missing.join(', ')}], ` +
        `unexpected [${unexpected.join(', ')}] (50 §3d)`,
    );
  }
}

function asObject(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    integrityFailure('MANIFEST_MALFORMED', `${where} is not an object (50 §3d)`);
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, where: string): string {
  if (typeof value !== 'string') {
    integrityFailure('MANIFEST_MALFORMED', `${where} is not a string (50 §3d)`);
  }
  return value;
}

function asNonNegativeInteger(value: unknown, where: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    integrityFailure(
      'MANIFEST_MALFORMED',
      `${where} is not a non-negative integer (50 §3d)`,
    );
  }
  return value;
}

function asHexBytes(value: unknown, byteLength: number, where: string): Uint8Array {
  const decoded = decodeLowercaseHex(asString(value, where), byteLength);
  if (decoded === null) {
    integrityFailure(
      'MANIFEST_MALFORMED',
      `${where} is not ${String(byteLength * 2)} lowercase hex characters (50 §3b)`,
    );
  }
  return decoded;
}

/**
 * `50 §3d`'s ENTRY ORDER, as a total comparison.
 *
 *   1. `artifact_class` — as an **unsigned integer**, ascending;
 *   2. `artifact_id` — **byte-wise lexicographic** over its UTF-8 NFC bytes, with a proper
 *      prefix sorting before its extensions;
 *   3. `artifact_version` — **byte-wise lexicographic** over its UTF-8 NFC bytes.
 *
 * "**The order is a property of the bytes, not of any implementation's map iteration, locale
 * or collation.**" So the string keys are compared through `Buffer.compare` over their UTF-8
 * NFC bytes and NEVER through `String.prototype.localeCompare` or a default `<`, both of
 * which are UTF-16 code-unit or locale comparisons and disagree with a byte-wise one above
 * the BMP.
 *
 * Returns a negative number, zero, or a positive number. ZERO IS A DEFECT at the call site:
 * "Two entries with all three keys equal are a **defect**, not a tie: the manifest fails
 * closed."
 */
function compareEntryOrder(a: ManifestEntry, b: ManifestEntry): number {
  if (a.artifactClass !== b.artifactClass) return a.artifactClass - b.artifactClass;
  const idOrder = Buffer.compare(
    Buffer.from(a.artifactId.normalize('NFC'), 'utf8'),
    Buffer.from(b.artifactId.normalize('NFC'), 'utf8'),
  );
  if (idOrder !== 0) return idOrder;
  return Buffer.compare(
    Buffer.from(a.artifactVersion.normalize('NFC'), 'utf8'),
    Buffer.from(b.artifactVersion.normalize('NFC'), 'utf8'),
  );
}

function coreEntryFields(entry: ManifestEntry): ManifestCoreEntryFields {
  return {
    artifactClass: entry.artifactClass,
    artifactId: entry.artifactId,
    artifactVersion: entry.artifactVersion,
    contentSha256: entry.contentSha256,
    primarySignature: entry.primarySignature,
    secondFactorSignature: entry.secondFactorSignature,
  };
}

/**
 * Parse a manifest document and compute its identity.
 *
 * NOTHING HERE IS TRUSTED YET. This function computes `manifest_id`; it does not check the
 * pin, does not check a signature and does not read a public key. `50 §3e`: "**The pin is
 * checked *before* the signatures**, because a signature check on a manifest the deployment
 * did not intend proves only that someone once signed something" — and both of those happen
 * in `verifier.ts`, in `§3f`'s declared order, against a configuration this module has never
 * seen.
 */
export function parseManifestDocument(documentText: string): ParsedManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(documentText);
  } catch (error) {
    integrityFailure(
      'MANIFEST_MALFORMED',
      `the manifest document is not parseable: ${String(error)}`,
    );
  }

  const document = asObject(parsed, 'the manifest document');
  assertExactFields(document, MANIFEST_DOCUMENT_FIELDS, 'the manifest document');

  const header: ManifestCoreHeaderFields = {
    manifestFormatVersion: asString(
      document.manifest_format_version,
      'manifest_format_version',
    ),
    manifestEpoch: asString(document.manifest_epoch, 'manifest_epoch'),
    expectedPrimaryKeyId: asString(document.expected_primary_key_id, 'expected_primary_key_id'),
    expectedSecondFactorKeyId: asString(
      document.expected_second_factor_key_id,
      'expected_second_factor_key_id',
    ),
  };

  // The framing version the CORE bytes are built under. A document declaring another
  // version is not a document this framing may hash: `50 §3a`'s no-negotiation rule applied
  // to the container.
  if (header.manifestFormatVersion !== MANIFEST_FORMAT_VERSION) {
    integrityFailure(
      'MANIFEST_MALFORMED',
      `manifest_format_version is ${quoted(header.manifestFormatVersion)}; this ` +
        `runtime implements ${MANIFEST_FORMAT_VERSION} and negotiates no other (50 §3d)`,
    );
  }

  const rawEntries = document.entries;
  if (!Array.isArray(rawEntries)) {
    integrityFailure('MANIFEST_MALFORMED', 'entries is not an array (50 §3d)');
  }

  const entries: ManifestEntry[] = rawEntries.map((raw, index) => {
    const where = `entries[${String(index)}]`;
    const entry = asObject(raw, where);
    assertExactFields(entry, MANIFEST_ENTRY_FIELDS, where);
    const contentSha256 = asHexBytes(
      entry.content_hash,
      SHA256_DIGEST_BYTES,
      `${where}.content_hash`,
    );
    return {
      artifactClass: asNonNegativeInteger(entry.artifact_class, `${where}.artifact_class`),
      artifactId: asString(entry.artifact_id, `${where}.artifact_id`),
      artifactVersion: asString(entry.artifact_version, `${where}.artifact_version`),
      contentHash: hexOf(contentSha256),
      contentSha256,
      primarySignature: asHexBytes(
        entry.primary_signature,
        ED25519_SIGNATURE_BYTES,
        `${where}.primary_signature`,
      ),
      secondFactorSignature: asHexBytes(
        entry.second_factor_signature,
        ED25519_SIGNATURE_BYTES,
        `${where}.second_factor_signature`,
      ),
    };
  });

  // `50 §3d`: "`entry_count` is inside the signed bytes **and** the entries follow it, so a
  // deletion is detectable twice over: the count disagrees, and the entry sequence differs."
  // The DOCUMENT's declared count is diffed here against the entries actually parsed, so a
  // document whose two halves disagree never reaches the framing at all.
  const declaredCount = asNonNegativeInteger(document.entry_count, 'entry_count');
  if (declaredCount !== entries.length) {
    integrityFailure(
      'MANIFEST_ENTRY_COUNT_MISMATCH',
      `entry_count declares ${String(declaredCount)} and the document carries ` +
        `${String(entries.length)} entries (50 §3d)`,
    );
  }

  // The declared order, checked element-wise. A manifest whose entries are out of order is
  // refused rather than sorted: sorting it would let two different byte sequences produce
  // one `manifest_id`, which is the injectivity the pin depends on.
  for (let i = 1; i < entries.length; i += 1) {
    const order = compareEntryOrder(entries[i - 1]!, entries[i]!);
    if (order === 0) {
      integrityFailure(
        'MANIFEST_DUPLICATE_ENTRY',
        `entries ${String(i - 1)} and ${String(i)} carry the same ` +
          '(artifact_class, artifact_id, artifact_version); that is a defect, not a tie ' +
          '(50 §3d)',
      );
    }
    if (order > 0) {
      integrityFailure(
        'MANIFEST_ENTRY_ORDER_INVALID',
        `entries ${String(i - 1)} and ${String(i)} are not in the declared ascending ` +
          '(artifact_class, artifact_id, artifact_version) order (50 §3d)',
      );
    }
  }

  const coreBytes = manifestCoreBytes(header, entries.map(coreEntryFields));
  const coreSha256 = sha256(coreBytes);

  return Object.freeze({
    header: Object.freeze(header),
    entries: Object.freeze(entries.map((entry) => Object.freeze(entry))),
    primarySignature: asHexBytes(
      document.primary_signature,
      ED25519_SIGNATURE_BYTES,
      'primary_signature',
    ),
    secondFactorSignature: asHexBytes(
      document.second_factor_signature,
      ED25519_SIGNATURE_BYTES,
      'second_factor_signature',
    ),
    manifestId: hexOf(coreSha256),
    coreBytes,
    coreSha256,
  });
}
