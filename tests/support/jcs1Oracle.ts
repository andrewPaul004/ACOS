import { createHash } from 'node:crypto';

/**
 * The `VC-A3` ORACLE — a THIRD reading of `30 §5.3`, hand-written here.
 *
 * =================================================================================
 * WHY A THIRD.
 *
 * `36 §0`: "Independent validation must not call the same production function twice and
 * call agreement proof."
 *
 * `VC-A3` compares TWO production implementations — the control database's `acos_jcs1_*`
 * and the audit database's `audit_jcs1_*` — so a test that asserted only their equality
 * would pass if BOTH were wrong in the same way, which is the exact failure mode a
 * transcription-from-one-source pair is prone to. Every fixture in
 * `vc-a3-cross-implementation.test.ts` is therefore judged against THIS file, and the two
 * implementations are judged against it separately rather than against each other.
 *
 * ---------------------------------------------------------------------------------
 * THIS FILE IMPORTS NOTHING FROM `src/`.
 *
 * Not the canonicaliser, not `canonicalBytes.ts`, not `money.ts`. `node:crypto` for
 * SHA-256, and the seven rules below written out from the specification. The S1G source
 * rules test reads this file and fails if an import of `src/` ever appears.
 * ---------------------------------------------------------------------------------
 *
 * `30 §5.3`'s table, transcribed rule by rule:
 *
 *   | NUMERIC scale   | Per-column declared decimal scale, serialised as a string at that
 *   |                 | exact scale. `25.0` and `25.00` are DIFFERENT BYTES, deliberately.
 *   | Timestamp       | RFC 3339, UTC, exactly 6 fractional digits, `Z` suffix.
 *   | Column order    | Fixed, declared per row kind, in the specification.
 *   | Nulls vs empty  | Single `0x00` sentinel byte for null; an empty string is a
 *   |                 | zero-length value.
 *   | Unicode form    | UTF-8, NFC.
 *   | JSON columns    | RFC 8785 (JCS), applied to the field's value.
 *   | Field framing   | Every field prefixed with its 4-byte big-endian byte length.
 *   | On the wire     | The transmitted bytes are what is hashed.
 */

/** "Single `0x00` sentinel byte for null." */
const NULL_SENTINEL = Buffer.from([0x00]);

/** `U+0000`, written as an escape so this file stays plain text. */
const NUL_CODE_POINT = '\u0000';

/** "Every field prefixed with its 4-byte big-endian byte length." */
export function frameField(value: Buffer): Buffer {
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32BE(value.length, 0);
  return Buffer.concat([prefix, value]);
}

/**
 * "UTF-8, NFC."
 *
 * Owner clarification S1B-C8: ACOS canonical text admits no `U+0000`, which is what makes
 * the null sentinel injective over text. Asserted here, not assumed, so the oracle refuses
 * an input the two implementations would refuse rather than quietly encoding it.
 */
export function jcsText(value: string | null): Buffer {
  if (value === null) return NULL_SENTINEL;
  if (value.includes(NUL_CODE_POINT)) {
    throw new Error('ACOS canonical text admits no U+0000 (S1B-C8)');
  }
  return Buffer.from(value.normalize('NFC'), 'utf8');
}

/**
 * "Per-column declared decimal scale, serialised as a string at that exact scale."
 *
 * The declared scale for every money column of both journal row kinds is 2. The oracle
 * takes the value as a STRING and renders it at scale 2 by its own digit arithmetic — it
 * never parses a decimal into a JavaScript number, because `25.10` and `25.1` would become
 * the same number and the hazard this rule exists for would vanish before it was tested.
 */
export function jcsMoney(value: string | null): Buffer {
  if (value === null) return NULL_SENTINEL;
  const match = /^(-?)(\d+)(?:\.(\d*))?$/.exec(value);
  if (!match) throw new Error(`not a decimal literal: ${value}`);
  const [, sign, whole, fraction = ''] = match;
  if (fraction.length > 2) {
    throw new Error(`scale ${String(fraction.length)} exceeds the declared scale 2: ${value}`);
  }
  return Buffer.from(`${sign!}${whole!}.${fraction.padEnd(2, '0')}`, 'utf8');
}

export function jcsInt(value: bigint | number | null): Buffer {
  if (value === null) return NULL_SENTINEL;
  return Buffer.from(value.toString(), 'utf8');
}

export function jcsBool(value: boolean | null): Buffer {
  if (value === null) return NULL_SENTINEL;
  return Buffer.from(value ? 'true' : 'false', 'utf8');
}

/** "RFC 3339, UTC, exactly 6 fractional digits, `Z` suffix." */
export function jcsTimestamp(value: Date | null): Buffer {
  if (value === null) return NULL_SENTINEL;
  const iso = value.toISOString(); // yyyy-mm-ddThh:mm:ss.mmmZ — three fractional digits.
  const withSixDigits = `${iso.slice(0, 23)}000Z`;
  return Buffer.from(withSixDigits, 'utf8');
}

/**
 * Bytes.
 *
 * `30 §5.3` declares the null sentinel generically and declares NO separate rule for a
 * `bytea` value, so a one-byte `0x00` value and SQL NULL frame identically and the
 * specification does not distinguish them. The oracle REFUSES that input rather than
 * choosing an encoding the architecture never declared. See `S1G-owner-clarifications.md`
 * S1G-C1; both production implementations refuse it too, and
 * `vc-a3-cross-implementation.test.ts` asserts all three refusals rather than asserting a
 * representation.
 */
export function jcsBytes(value: Buffer | null): Buffer {
  if (value === null) return NULL_SENTINEL;
  if (value.equals(NULL_SENTINEL)) {
    throw new Error(
      'a one-byte 0x00 bytea is indistinguishable from the null sentinel under 30 §5.3 ' +
        'and is refused rather than encoded (S1G-C1)',
    );
  }
  return value;
}

/**
 * "RFC 8785 (JCS), applied to the field's value."
 *
 * Present because `§8` of the S1G mandate requires every field representation the current
 * specification supports to be exercised, INCLUDING the JSON one and the JSON-literal-null
 * case. Neither journal row kind carries a JSON column — `S1F-C7` records that decision
 * and A0001 repeats it — so this function is exercised by the oracle's own fixtures to
 * settle the carried-forward question, and no production row uses it.
 *
 * The rule it settles: JSON literal `null` canonicalises to the four bytes `null` and
 * frames at length 4; SQL NULL is the one-byte sentinel and frames at length 1. They are
 * distinct under `30 §5.3` as written, and nothing had to be invented to distinguish them.
 */
export function jcsJson(value: unknown): Buffer {
  if (value === undefined) return NULL_SENTINEL; // an ABSENT field, not a JSON value
  return Buffer.from(rfc8785(value), 'utf8');
}

function rfc8785(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) {
      throw new Error('the oracle refuses a non-integer JSON number rather than rounding');
    }
    return value.toString();
  }
  if (typeof value === 'string') return JSON.stringify(value.normalize('NFC'));
  if (Array.isArray(value)) return `[${value.map(rfc8785).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      // RFC 8785 sorts by the UTF-16 code units of the key.
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${rfc8785(v)}`).join(',')}}`;
  }
  throw new Error(`unserialisable JSON value: ${String(value)}`);
}

/** A framed field, tagged by the rule that produced it. */
export type OracleField =
  | { readonly kind: 'text'; readonly value: string | null }
  | { readonly kind: 'money'; readonly value: string | null }
  | { readonly kind: 'int'; readonly value: bigint | number | null }
  | { readonly kind: 'bool'; readonly value: boolean | null }
  | { readonly kind: 'ts'; readonly value: Date | null }
  | { readonly kind: 'bytes'; readonly value: Buffer | null }
  | { readonly kind: 'json'; readonly value: unknown };

export function oracleField(field: OracleField): Buffer {
  switch (field.kind) {
    case 'text':
      return jcsText(field.value);
    case 'money':
      return jcsMoney(field.value);
    case 'int':
      return jcsInt(field.value);
    case 'bool':
      return jcsBool(field.value);
    case 'ts':
      return jcsTimestamp(field.value);
    case 'bytes':
      return jcsBytes(field.value);
    case 'json':
      return jcsJson(field.value);
  }
}

/** "The transmitted bytes are what is hashed": frame every field, concatenate, hash. */
export function oracleCanonicalBytes(fields: readonly OracleField[]): Buffer {
  return Buffer.concat(fields.map((f) => frameField(oracleField(f))));
}

export function oracleRowHash(fields: readonly OracleField[]): Buffer {
  return createHash('sha256').update(oracleCanonicalBytes(fields)).digest();
}

// =====================================================================================
// The two declared field orders, transcribed here from the specification.
//
// `30 §5.3`: "Fixed, declared per row kind, in the specification — never the physical
// column order, which a migration reorders." Written out as a THIRD transcription, so a
// field silently added, moved or dropped in either database's declaration fails VC-A3.
// =====================================================================================

export interface EffectAuthorisationRow {
  readonly companyId: string;
  readonly journalSeq: bigint;
  readonly effectId: string;
  readonly authorisationId: string;
  readonly decisionId: string;
  readonly reservationId: string;
  readonly approvalId: string | null;
  readonly idempotencyKey: string;
  readonly actionClass: string;
  readonly resourceRef: string;
  readonly verdict: string;
  readonly vendorAmount: string | null;
  readonly totalExposure: string;
  readonly forwardIntegral: string | null;
  readonly isRateClass: boolean;
  readonly dispatchPayloadHash: string;
  readonly constructorSemanticMajor: number;
  readonly constructorNonSemanticMinor: number;
  readonly policyVersion: string;
  readonly occurredAt: Date;
  readonly prevHash: Buffer | null;
}

export function effectAuthorisationFields(row: EffectAuthorisationRow): readonly OracleField[] {
  return [
    { kind: 'text', value: 'acos.journal.effect_authorisation.v1' },
    { kind: 'text', value: row.companyId },
    { kind: 'int', value: row.journalSeq },
    { kind: 'text', value: 'EFFECT_AUTHORISATION' },
    { kind: 'text', value: row.effectId },
    { kind: 'text', value: row.authorisationId },
    { kind: 'text', value: row.decisionId },
    { kind: 'text', value: row.reservationId },
    { kind: 'text', value: row.approvalId },
    { kind: 'text', value: row.idempotencyKey },
    { kind: 'text', value: row.actionClass },
    { kind: 'text', value: row.resourceRef },
    { kind: 'text', value: row.verdict },
    { kind: 'money', value: row.vendorAmount },
    { kind: 'money', value: row.totalExposure },
    { kind: 'money', value: row.forwardIntegral },
    { kind: 'bool', value: row.isRateClass },
    { kind: 'text', value: row.dispatchPayloadHash },
    { kind: 'int', value: row.constructorSemanticMajor },
    { kind: 'int', value: row.constructorNonSemanticMinor },
    { kind: 'text', value: row.policyVersion },
    { kind: 'ts', value: row.occurredAt },
    { kind: 'bytes', value: row.prevHash },
  ];
}

export interface AttestationRow {
  readonly companyId: string;
  readonly journalSeq: bigint;
  readonly attestedMaxJournalSeq: bigint;
  readonly attestedRowCount: bigint;
  readonly attestedHeadHash: Buffer;
  readonly attestedAt: Date;
  readonly prevHash: Buffer | null;
}

export function attestationFields(row: AttestationRow): readonly OracleField[] {
  return [
    { kind: 'text', value: 'acos.journal.attestation.v1' },
    { kind: 'text', value: row.companyId },
    { kind: 'int', value: row.journalSeq },
    { kind: 'text', value: 'JOURNAL_ATTESTATION' },
    { kind: 'int', value: row.attestedMaxJournalSeq },
    { kind: 'int', value: row.attestedRowCount },
    { kind: 'bytes', value: row.attestedHeadHash },
    { kind: 'ts', value: row.attestedAt },
    { kind: 'bytes', value: row.prevHash },
  ];
}
