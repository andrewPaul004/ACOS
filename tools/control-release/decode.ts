import { createHash } from 'node:crypto';

import { refuse } from './inventory.js';

/**
 * DECODING THE ARTIFACT BYTES FOR HUMAN REVIEW — `§8`, `§9`, `§10`, `§11` AND `§31`.
 *
 * =================================================================================
 * THE ARTIFACT IS THE AUTHORITY. THIS FILE IS A DISPLAY.
 *
 * `§9`: "**Do NOT hard-code expected values in the release builder as an alternate
 * authority.** A review command may display decoded values for the human approvers. **But
 * the exact artifact bytes remain authority.**"
 *
 * `§8`: "**Do not regenerate authority fields from independent hard-coded production
 * constants.** The artifact itself is the release input."
 *
 * So there is no expected-value table anywhere in this file. Every number and every string
 * printed by the review report is READ OUT OF THE ARTIFACT BYTES the release is built from.
 * The tool has no opinion about whether `PT15M` is the right threshold; it shows the owner
 * what the bytes say, and the owner decides.
 *
 * `§32`: "**Do not let the tool decide whether a release is 'safe.' It informs the human
 * owner.**" Nothing here returns a verdict.
 *
 * =================================================================================
 * IT DOES NOT IMPORT THE PRODUCTION PARSERS
 *
 * `src/kernel/controlArtifacts/artifactParsers.ts` parses the same bytes for the RUNTIME,
 * and a review that reused it would show the owner whatever the runtime's parser believed
 * rather than what the bytes contain. Two independent readings of one artifact disagree
 * loudly; one shared reading cannot disagree at all.
 * =================================================================================
 */

function parseJson(bytes: Buffer, what: string): Record<string, unknown> {
  let document: unknown;
  try {
    document = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    refuse('RELEASE_ARTIFACT_UNREADABLE', `${what} is not readable JSON: ${String(error)}`);
  }
  if (typeof document !== 'object' || document === null || Array.isArray(document)) {
    refuse('RELEASE_ARTIFACT_UNREADABLE', `${what} is not a JSON object`);
  }
  return document as Record<string, unknown>;
}

/** `50 §2a` — the ten per-class fields, exactly as the artifact declares them. */
export interface DecodedActionClass {
  readonly actionClass: string;
  readonly recoverability: string;
  readonly valueDirection: string;
  readonly carriesVendorMonetaryField: boolean;
  readonly costComponentFree: boolean;
  readonly rateBased: boolean;
  readonly irrecoverableUnits: string;
  readonly settlementTolerance: string;
  readonly adapter: string;
  readonly method: string;
  /**
   * `50 §2f`: "**`I66`'s outbox scope is DERIVED FROM `adapter`**, not separately stored;
   * `adapter = internal_only` removes an effect from the outbox entirely."
   *
   * DERIVED, and shown as derived, so a reviewer reads the external-write consequence of an
   * adapter change without having to remember the derivation.
   */
  readonly externalDispatch: 'EXTERNAL_DISPATCH' | 'INTERNAL_ONLY';
}

export interface DecodedClass3 {
  readonly artifactId: string;
  readonly artifactVersion: string;
  readonly actionClasses: readonly DecodedActionClass[];
  readonly reasonCodes: readonly string[];
  readonly reasonCodeScopes: Readonly<Record<string, string>>;
  readonly semanticOptionDigestFields: Readonly<Record<string, readonly string[]>>;
  readonly enumerationMaxAgeSeconds: Readonly<Record<string, number>>;
}

const INTERNAL_ONLY_ADAPTER = 'internal_only';

export function decodeClass3(bytes: Buffer): DecodedClass3 {
  const document = parseJson(bytes, 'the class-3 action catalogue');
  const rawClasses = document.action_classes;
  if (!Array.isArray(rawClasses)) {
    refuse('RELEASE_ARTIFACT_UNREADABLE', 'the class-3 artifact carries no action_classes array');
  }
  const actionClasses = rawClasses.map((raw) => {
    const row = raw as Record<string, unknown>;
    const adapter = String(row.adapter);
    return Object.freeze({
      actionClass: String(row.action_class),
      recoverability: String(row.recoverability),
      valueDirection: String(row.value_direction),
      carriesVendorMonetaryField: row.carries_vendor_monetary_field === true,
      costComponentFree: row.cost_component_free === true,
      rateBased: row.rate_based === true,
      irrecoverableUnits: String(row.irrecoverable_units),
      settlementTolerance: String(row.settlement_tolerance),
      adapter,
      method: String(row.method),
      externalDispatch:
        adapter === INTERNAL_ONLY_ADAPTER
          ? ('INTERNAL_ONLY' as const)
          : ('EXTERNAL_DISPATCH' as const),
    });
  });
  return Object.freeze({
    artifactId: String(document.artifact_id),
    artifactVersion: String(document.artifact_version),
    actionClasses: Object.freeze(
      [...actionClasses].sort((a, b) => (a.actionClass < b.actionClass ? -1 : 1)),
    ),
    reasonCodes: Object.freeze(
      Array.isArray(document.reason_codes) ? document.reason_codes.map(String).sort() : [],
    ),
    reasonCodeScopes: Object.freeze(
      (document.reason_code_scopes ?? {}) as Record<string, string>,
    ),
    semanticOptionDigestFields: Object.freeze(
      (document.semantic_option_digest_fields ?? {}) as Record<string, readonly string[]>,
    ),
    enumerationMaxAgeSeconds: Object.freeze(
      (document.enumeration_max_age_seconds ?? {}) as Record<string, number>,
    ),
  });
}

/** `50 §2c` — EXACTLY FOUR static quantities, read out of the artifact. */
export interface DecodedClass27 {
  readonly artifactId: string;
  readonly artifactVersion: string;
  readonly quantities: Readonly<Record<string, string>>;
}

/**
 * `50 §2c`'s four quantity names, in the order the section prints them.
 *
 * This is a DISPLAY ORDER and a completeness check, not a value table: the tool reports a
 * quantity the artifact does not carry as `ABSENT` and reports any quantity the artifact
 * carries beyond the four, so a reviewer sees both kinds of drift. It states no expected
 * VALUE for any of them.
 */
export const CLASS_27_QUANTITY_NAMES: readonly string[] = Object.freeze([
  'mirror_lag_critical_threshold',
  'audit_unreachable_full_halt_threshold',
  'degraded_per_action_approval_floor_monetary',
  'corroboration_signal_max_age',
]);

export function decodeClass27(bytes: Buffer): DecodedClass27 {
  const document = parseJson(bytes, 'the class-27 degraded-mode configuration');
  const quantities: Record<string, string> = {};
  for (const name of CLASS_27_QUANTITY_NAMES) {
    const value = document[name];
    quantities[name] = value === undefined ? 'ABSENT' : String(value);
  }
  for (const [key, value] of Object.entries(document)) {
    if (key === 'artifact_id' || key === 'artifact_version') continue;
    if (!CLASS_27_QUANTITY_NAMES.includes(key)) {
      quantities[`${key} (OUTSIDE 50 §2c’s CLOSED FOUR)`] = String(value);
    }
  }
  return Object.freeze({
    artifactId: String(document.artifact_id),
    artifactVersion: String(document.artifact_version),
    quantities: Object.freeze(quantities),
  });
}

export interface DecodedClass19Record {
  readonly constructorId: string;
  readonly actionClass: string;
  readonly semanticMajor: number;
  readonly nonSemanticMinor: number;
}

export interface DecodedClass19 {
  readonly artifactId: string;
  readonly artifactVersion: string;
  readonly records: readonly DecodedClass19Record[];
}

export function decodeClass19(bytes: Buffer): DecodedClass19 {
  const document = parseJson(bytes, 'the class-19 effect-constructor set');
  const raw = document.records;
  const records = Array.isArray(raw)
    ? raw.map((entry) => {
        const row = entry as Record<string, unknown>;
        return Object.freeze({
          constructorId: String(row.constructor_id),
          actionClass: String(row.action_class),
          semanticMajor: Number(row.semantic_major),
          nonSemanticMinor: Number(row.non_semantic_minor),
        });
      })
    : [];
  return Object.freeze({
    artifactId: String(document.artifact_id),
    artifactVersion: String(document.artifact_version),
    records: Object.freeze(
      [...records].sort((a, b) => (a.constructorId < b.constructorId ? -1 : 1)),
    ),
  });
}

export interface DecodedClass2Policy {
  readonly id: string;
  /** `SHA-256` over the policy source's UTF-8 bytes. A per-file review aid. */
  readonly sourceDigest: string;
  readonly sourceByteLength: number;
}

export interface DecodedClass2 {
  readonly artifactId: string;
  readonly artifactVersion: string;
  readonly schemaDigest: string;
  readonly schemaByteLength: number;
  readonly policies: readonly DecodedClass2Policy[];
  /**
   * `50 §2e`'s `policy_version` — the loader's content-derived Cedar-set digest.
   *
   * "**`policy_version` is NOT the class-2 content hash, and neither replaces the other.**"
   * The report prints both, side by side and labelled, precisely so a reviewer cannot read
   * one as the other.
   */
  readonly policyVersion: string;
}

function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * An INDEPENDENT transcription of the production loader's `policy_version` digest.
 *
 * `50 §2e` describes it as "the content-derived Cedar-set digest the production loader
 * already computes over a length-framed structure of the schema and the `(id, source)` pairs
 * in sorted id order", with an accepted current value.
 *
 * The framing is `30 §5.3`'s: a 4-byte big-endian length word per field, the structure kind
 * first, with the same rules for text and byte payloads. It is transcribed here rather than
 * imported, for the same reason the inventory is: `tests/release/review-and-diff.test.ts`
 * asserts this transcription reproduces the accepted `47c2849b…c30ff6`, which is a real
 * cross-check only while the two implementations are separate.
 *
 * NOTE WHAT THIS IS NOT: `policy_version` is not an authority value in a release. It is
 * printed so a reviewer can see whether the Cedar decision-record digest moved, alongside
 * the class-2 `content_hash` that the owner actually signs.
 */
export function policyVersionDigest(schema: string, policies: readonly { id: string; source: string }[]): string {
  const sorted = [...policies].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const parts: Buffer[] = [];
  const emit = (payload: Buffer): void => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(payload.byteLength, 0);
    parts.push(length, payload);
  };
  emit(Buffer.from('acos.policy_set.v1'.normalize('NFC'), 'utf8'));
  emit(Buffer.from(schema, 'utf8'));
  emit(Buffer.from(String(sorted.length), 'utf8'));
  for (const policy of sorted) {
    emit(Buffer.from(policy.id.normalize('NFC'), 'utf8'));
    emit(Buffer.from(policy.source, 'utf8'));
  }
  return sha256Hex(Buffer.concat(parts));
}

export function decodeClass2(bytes: Buffer): DecodedClass2 {
  const document = parseJson(bytes, 'the class-2 policy-set bundle');
  const schema = String(document.schema);
  const rawPolicies = document.policies;
  const policies = Array.isArray(rawPolicies)
    ? rawPolicies.map((entry) => {
        const row = entry as Record<string, unknown>;
        return { id: String(row.id), source: String(row.source) };
      })
    : [];
  return Object.freeze({
    artifactId: String(document.artifact_id),
    artifactVersion: String(document.artifact_version),
    schemaDigest: sha256Hex(Buffer.from(schema, 'utf8')),
    schemaByteLength: Buffer.byteLength(schema, 'utf8'),
    policies: Object.freeze(
      [...policies]
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .map((policy) =>
          Object.freeze({
            id: policy.id,
            sourceDigest: sha256Hex(Buffer.from(policy.source, 'utf8')),
            sourceByteLength: Buffer.byteLength(policy.source, 'utf8'),
          }),
        ),
    ),
    policyVersion: policyVersionDigest(schema, policies),
  });
}

/** `50 §2b` — the class-20 specification's identity. The artifact is plain text. */
export interface DecodedClass20 {
  readonly specificationVersionLine: string;
  readonly byteLength: number;
  readonly carriesCarriageReturn: boolean;
  readonly endsWithNewline: boolean;
}

export function decodeClass20(bytes: Buffer): DecodedClass20 {
  const text = bytes.toString('utf8');
  const firstLine = text.split('\n', 1)[0] ?? '';
  return Object.freeze({
    specificationVersionLine: firstLine.trim(),
    byteLength: bytes.length,
    // `50 §2b`: "**LF (`0x0A`) line terminators exclusively; the file contains no `0x0D`
    // byte.** A CRLF copy is a different artifact and fails verification." Shown to the
    // reviewer, because a line-ending change is invisible in a diff viewer and fatal here.
    carriesCarriageReturn: bytes.includes(0x0d),
    endsWithNewline: bytes.length > 0 && bytes[bytes.length - 1] === 0x0a,
  });
}

export interface DecodedClass24 {
  readonly artifactId: string;
  readonly artifactVersion: string;
  readonly publicKeyId: string;
}

export function decodeClass24(bytes: Buffer): DecodedClass24 {
  const document = parseJson(bytes, 'the class-24 audit signing key');
  const publicKey = String(document.public_key);
  return Object.freeze({
    artifactId: String(document.artifact_id),
    artifactVersion: String(document.artifact_version),
    // The PUBLIC key's id. `50 §3a`: `key_id = SHA-256(raw public key bytes)`.
    publicKeyId: /^[0-9a-f]{64}$/.test(publicKey)
      ? sha256Hex(Buffer.from(publicKey, 'hex'))
      : 'MALFORMED',
  });
}
