import { createHash } from 'node:crypto';

import { toDb, type Money } from '../exposure/money.js';

/**
 * Canonical bytes for canonicaliser structures, under the `ACOS-JCS-1` rules.
 *
 * `30 §5.3`, the hazard table, verbatim in its rules column:
 *
 *   NUMERIC scale 25.0 vs 25.00 -> "Per-column declared decimal scale, serialised as a
 *     string at that exact scale. 25.0 and 25.00 are different bytes, deliberately — a
 *     scale change is a semantic change in a money field."
 *   Timestamp precision and zone -> "RFC 3339, UTC, exactly 6 fractional digits, Z suffix."
 *   Column order -> "Fixed, declared per row kind, in the specification — never the
 *     physical column order, which a migration reorders."
 *   Nulls vs empty strings -> "Single 0x00 sentinel byte for null; an empty string is a
 *     zero-length value."
 *   Unicode form -> "UTF-8, NFC."
 *   JSON-valued columns -> "RFC 8785 (JCS), applied to the field's value."
 *   Field framing -> "Every field prefixed with its 4-byte big-endian byte length, so no
 *     separator can be forged by content."
 *
 * ---------------------------------------------------------------------------------
 * WHAT THIS MODULE IS, AND WHAT IT IS NOT
 *
 * It IS the minimum canonical-byte functionality the canonicaliser's own structures need,
 * implementing the rules above. `JSON.stringify` is not used as an authority-bearing byte
 * representation anywhere in it, which `26 §2.1`'s "hashed together" requires to mean
 * something: object property insertion order must be structurally incapable of changing a
 * hash, and `JSON.stringify` preserves insertion order.
 *
 * It is NOT the journal-row serialiser, and S1B does not claim `36 §2` VC-A3. VC-A3 is
 * cross-implementation byte-identity between the control trigger and the AUDIT trigger,
 * and it needs a second independent implementation that S1B does not build. `30 §5.3`,
 * verbatim: "36 §2.6 cross-implements it: the same fixture rows serialised by both
 * triggers must produce byte-identical output." That gate is OPEN after S1B.
 * ---------------------------------------------------------------------------------
 */

/** The null sentinel. `30 §5.3`: "Single 0x00 sentinel byte for null". */
const NULL_SENTINEL = Buffer.from([0x00]);

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/**
 * A field's declared type. The type — not the runtime shape — decides the encoding, which
 * is what "per-column declared decimal scale" and "declared per row kind" mean.
 */
export type CanonicalField =
  | { readonly kind: 'text'; readonly value: string | null }
  | { readonly kind: 'money'; readonly value: Money | null }
  | { readonly kind: 'integer'; readonly value: bigint | null }
  | { readonly kind: 'boolean'; readonly value: boolean | null }
  | { readonly kind: 'timestamp'; readonly value: Date | null }
  | { readonly kind: 'bytes'; readonly value: Buffer | null }
  | { readonly kind: 'json'; readonly value: JsonValue | null };

/**
 * A structure, in its DECLARED field order.
 *
 * An array, never an object: an object's key order is a property of how it was built, and
 * `30 §5.3` requires the order to be a property of the specification. Every caller in this
 * package writes the order out literally.
 */
export type CanonicalStructure = readonly CanonicalField[];

/** RFC 3339, UTC, exactly six fractional digits, `Z`. */
export function rfc3339Micros(value: Date): string {
  const ms = value.getTime();
  if (!Number.isFinite(ms)) throw new Error('not a valid Date');
  // toISOString is RFC 3339 UTC with exactly three fractional digits. The declared format
  // is six, and a Date carries no sub-millisecond precision, so the last three are zeros.
  return `${value.toISOString().slice(0, -1)}000Z`;
}

/**
 * RFC 8785 (JCS). Applied to the field's value, per `30 §5.3`'s JSON-valued-columns rule.
 *
 * Object keys are ordered by UTF-16 code unit, which is what RFC 8785 §3.2.3 specifies and
 * what `Array.prototype.sort`'s default comparator already does for strings.
 *
 * Non-integer numbers are REJECTED rather than serialised. RFC 8785 defines an ES6 double
 * serialisation for them, but no money value in this codebase is ever a `number`
 * (`src/kernel/exposure/money.ts`), so a float appearing in a canonicalised payload is a
 * defect, not a value to preserve. Failing closed here is cheaper than discovering it at
 * settlement.
 */
export function jcs(value: JsonValue): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new Error(
        `JCS: refusing to serialise a non-integer or unsafe number (${value}); money is a decimal string in this codebase`,
      );
    }
    return value.toString(10);
  }
  if (typeof value === 'string') return jcsString(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => jcs(item as JsonValue)).join(',')}]`;
  }
  const object = value as { readonly [key: string]: JsonValue };
  const keys = Object.keys(object).sort();
  const members = keys.map((key) => {
    const member = object[key];
    if (member === undefined) throw new Error(`JCS: undefined is not a JSON value at key ${key}`);
    return `${jcsString(key)}:${jcs(member)}`;
  });
  return `{${members.join(',')}}`;
}

/**
 * RFC 8785 §3.2.2.2 string serialisation, written out rather than delegated to
 * `JSON.stringify`, so that the "no JSON.stringify on a hashing path" rule this package
 * asserts is true without an exception a reader has to hold in their head.
 */
function jcsString(value: string): string {
  const normalised = value.normalize('NFC');
  let out = '"';
  for (const character of normalised) {
    const code = character.codePointAt(0)!;
    switch (character) {
      case '"':
        out += '\\"';
        break;
      case '\\':
        out += '\\\\';
        break;
      case '\b':
        out += '\\b';
        break;
      case '\f':
        out += '\\f';
        break;
      case '\n':
        out += '\\n';
        break;
      case '\r':
        out += '\\r';
        break;
      case '\t':
        out += '\\t';
        break;
      default:
        out += code < 0x20 ? `\\u${code.toString(16).padStart(4, '0')}` : character;
    }
  }
  return `${out}"`;
}

/** The value bytes of one field, before framing. */
function fieldValueBytes(field: CanonicalField): Buffer {
  if (field.value === null) return NULL_SENTINEL;
  switch (field.kind) {
    case 'text':
      // UTF-8, NFC. An empty string is a zero-length value, distinct from the null
      // sentinel's one byte — `30 §5.3`.
      return Buffer.from(field.value.normalize('NFC'), 'utf8');
    case 'money':
      // The declared scale is 2 and `toDb` renders at exactly that scale, so `25.0` is not
      // expressible and `25.00` is the only byte form.
      return Buffer.from(toDb(field.value), 'utf8');
    case 'integer':
      return Buffer.from(field.value.toString(10), 'utf8');
    case 'boolean':
      return Buffer.from(field.value ? 'true' : 'false', 'utf8');
    case 'timestamp':
      return Buffer.from(rfc3339Micros(field.value), 'utf8');
    case 'bytes':
      return Buffer.from(field.value);
    case 'json':
      return Buffer.from(jcs(field.value), 'utf8');
  }
}

/**
 * Serialise a structure: the structure kind first, then every field in declared order,
 * each prefixed with its 4-byte big-endian byte length.
 *
 * The kind is framed as a field of its own so two structures with identical field bytes
 * and different meanings do not collide — the domain separation `30 §5.3`'s "declared per
 * row kind" implies and which a bare concatenation would not have.
 */
export function canonicalBytes(kind: string, fields: CanonicalStructure): Buffer {
  const parts: Buffer[] = [];
  const emit = (value: Buffer): void => {
    const length = Buffer.allocUnsafe(4);
    length.writeUInt32BE(value.byteLength, 0);
    parts.push(length, value);
  };
  emit(Buffer.from(kind.normalize('NFC'), 'utf8'));
  for (const field of fields) {
    emit(fieldValueBytes(field));
  }
  return Buffer.concat(parts);
}

/** SHA-256 over the canonical bytes. */
export function canonicalHash(kind: string, fields: CanonicalStructure): Buffer {
  return createHash('sha256').update(canonicalBytes(kind, fields)).digest();
}

/** Lowercase hex, for recording a hash on a structure. */
export function hex(digest: Buffer): string {
  return digest.toString('hex');
}

/**
 * `H(a ‖ b ‖ ...)` over framed components, for the architecture's concatenation forms —
 * `option_id = H(action_class ‖ resource_id ‖ semantic_option_digest)` (`26 §2.2`) and
 * `H(task_id ‖ action_class ‖ resource_id ‖ semantic_param_digest)` (`25 §7`).
 *
 * The framing matters: unframed concatenation lets a content boundary be forged, which is
 * exactly what `30 §5.3`'s four-byte length prefix exists to prevent.
 */
export function hashConcat(domain: string, components: readonly (string | Buffer)[]): Buffer {
  return canonicalHash(
    domain,
    components.map((component) =>
      typeof component === 'string'
        ? ({ kind: 'text', value: component } as const)
        : ({ kind: 'bytes', value: component } as const),
    ),
  );
}
