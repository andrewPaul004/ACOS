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

/**
 * =====================================================================================
 * CANONICAL TEXT — the injectivity rule.  S1B.2, independent-review finding 4.
 * =====================================================================================
 *
 * `30 §5.3` requires the canonical form to be a specification rather than an artefact of
 * the runtime. That is only worth something if the encoding is INJECTIVE over the strings
 * it accepts: two distinct accepted values must never produce identical bytes. Independent
 * review found two ways it was not, and one way object keys could collide.
 *
 * 4A — THE NULL SENTINEL VERSUS NUL TEXT.
 *
 * `null` encodes as the single byte 0x00. A text value containing U+0000 UTF-8 encodes as
 * the single byte 0x00 too, so at a nullable text position `null` and a one-character NUL
 * string are the same bytes. PostgreSQL `text` cannot store U+0000 at all, so nothing is
 * lost by excluding it, and excluding it restores injectivity: `null` is one 0x00 byte, an
 * empty string is a zero-length value, and no accepted text can imitate either.
 *
 * 4B — UNPAIRED UTF-16 SURROGATES.
 *
 * A JavaScript string is a UTF-16 code-unit sequence and may hold a lone surrogate, which
 * is not a Unicode scalar value. Node's UTF-8 encoder replaces each lone surrogate with
 * U+FFFD, so a string holding only U+D800 and a string holding only U+D801 — distinct
 * values — encode to the SAME three bytes. RFC 8785 §3.2.2.2 requires malformed Unicode
 * data to fail rather than be substituted, so a string that is not a well-formed scalar
 * sequence is rejected BEFORE NFC normalisation and before any UTF-8 encoding.
 *
 * Both rules FAIL CLOSED, and both are applied at every position canonical bytes are taken
 * over: text fields, the structure kind, JSON string values and JSON object keys. The
 * model-facing boundary rejects the same inputs earlier and more specifically — see
 * `intent.ts` — so reaching a throw here is an internal defect, not a model-reachable path.
 * =====================================================================================
 */

/** U+0000, which canonical text forbids. */
const NUL = '\u0000';

/**
 * Whether a string is a well-formed Unicode scalar sequence — every high surrogate followed
 * by a low surrogate, and no low surrogate standing alone.
 *
 * Written out rather than delegated to `String.prototype.isWellFormed`, which is not in the
 * declared `ES2022` lib. The rule belongs to this specification, not to the runtime.
 */
export function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = index + 1 < value.length ? value.charCodeAt(index + 1) : 0;
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

/**
 * Whether a string is admissible as ACOS canonical text.
 *
 * Exported so the model-facing parser can fail closed at the wire boundary with a denial,
 * rather than letting an inadmissible string travel as far as a hash.
 */
export function isCanonicalText(value: string): boolean {
  return isWellFormedUnicode(value) && !value.includes(NUL);
}

/**
 * Validate and normalise one canonical string. Throws on an inadmissible value.
 *
 * The error names the POSITION and never echoes the value: a lone surrogate rendered into
 * a message is a lone surrogate travelling further than it should.
 */
export function canonicalText(value: string, position: string): string {
  if (!isWellFormedUnicode(value)) {
    throw new Error(
      `ACOS-JCS-1: ${position} is not a well-formed Unicode scalar sequence (unpaired surrogate)`,
    );
  }
  if (value.includes(NUL)) {
    throw new Error(`ACOS-JCS-1: ${position} contains U+0000, which canonical text forbids`);
  }
  return value.normalize('NFC');
}

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
 *
 * ---------------------------------------------------------------------------------
 * S1B.2, FINDING 4C — NFC-NORMALISED KEY COLLISIONS
 *
 * ACOS adds an NFC rule that RFC 8785 does not have, and adding it creates a case RFC 8785
 * never had to answer: two DISTINCT source keys — a composed and a decomposed spelling of
 * the same accented name, say — normalise to the SAME canonical name. Sorting the
 * pre-normalised keys and normalising only while writing would emit a JSON object carrying
 * that canonical name twice, which is not a JSON object at all.
 *
 * So the order is fixed, and it is: validate every key, normalise every key, REJECT if two
 * normalise alike, sort the NORMALISED keys, serialise the NORMALISED keys. The rejection
 * is the point — an object whose canonical form would be ill-formed has no canonical form,
 * and quietly picking one of the two spellings would make the byte layer non-injective in
 * the other direction.
 * ---------------------------------------------------------------------------------
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
  if (typeof value === 'string') return jcsString(canonicalText(value, 'a JSON string value'));
  if (Array.isArray(value)) {
    return `[${value.map((item) => jcs(item as JsonValue)).join(',')}]`;
  }
  const object = value as { readonly [key: string]: JsonValue };

  // 1–3: validate, normalise, and reject a collision. The map is keyed by the NORMALISED
  // name and holds the original, so the lookup below still reads the right member.
  const byCanonicalName = new Map<string, string>();
  for (const key of Object.keys(object)) {
    const canonical = canonicalText(key, 'a JSON object key');
    if (byCanonicalName.has(canonical)) {
      throw new Error(
        'ACOS-JCS-1: two JSON object keys normalise to the same canonical name; the object has no canonical form',
      );
    }
    byCanonicalName.set(canonical, key);
  }

  // 4–5: sort the NORMALISED names, and serialise those. `Array.prototype.sort`'s default
  // comparator orders by UTF-16 code unit, which is RFC 8785 §3.2.3's ordering.
  const members = [...byCanonicalName.keys()].sort().map((canonical) => {
    const original = byCanonicalName.get(canonical)!;
    const member = object[original];
    if (member === undefined) throw new Error('JCS: undefined is not a JSON value');
    return `${jcsString(canonical)}:${jcs(member)}`;
  });
  return `{${members.join(',')}}`;
}

/**
 * RFC 8785 §3.2.2.2 string serialisation, written out rather than delegated to
 * `JSON.stringify`, so that the "no JSON.stringify on a hashing path" rule this package
 * asserts is true without an exception a reader has to hold in their head.
 *
 * The argument must ALREADY have passed `canonicalText` — validated and NFC-normalised.
 * Normalising here instead would put the NFC step after the collision check in `jcs`, which
 * is the ordering finding 4C prohibits.
 */
function jcsString(normalised: string): string {
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
      // UTF-8, NFC, validated. An empty string is a zero-length value, distinct from the
      // null sentinel's one byte — `30 §5.3` — and U+0000 is inadmissible, so no accepted
      // text can imitate the sentinel (S1B.2 finding 4A).
      return Buffer.from(canonicalText(field.value, 'a canonical text field'), 'utf8');
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
  emit(Buffer.from(canonicalText(kind, 'the structure kind'), 'utf8'));
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
