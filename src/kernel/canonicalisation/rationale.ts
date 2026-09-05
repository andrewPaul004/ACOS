import { createHash } from 'node:crypto';

/**
 * `rationale` — the one free-text field on the model-facing surface, and the one field
 * that must never reach authority.
 *
 * `26 §2.0`, verbatim:
 *
 *   "rationale         // free text; journaled for the audit record; NEVER parsed,
 *                      //   NEVER interpreted as authority"
 *
 * `26 §2.3`, verbatim:
 *
 *   "Any free text with authority. The engine reads no prose. `rationale` exists for the
 *    audit record and the engine never parses it. This is B3, and it is the property that
 *    makes injection unable to argue with the gate."
 *
 * ADR-006, verbatim: five fields, "of which four reach the authorisation semantics and one
 * is journaled and never parsed."
 *
 * ---------------------------------------------------------------------------------
 * WHY THIS IS A TYPE AND NOT A COMMENT
 *
 * "Never parsed" written as a comment is a rule a future edit breaks silently. Written as
 * a type it is a rule a future edit cannot express. `OpaqueRationale` is not a `string`,
 * is not assignable to one, and carries no character accessor of any kind.
 *
 * `sealRationale` computes the commitment digest and DISCARDS THE TEXT. After sealing,
 * the characters the model submitted are not recoverable by any code path in this
 * process. That is stronger than "never parsed": it is "unparseable".
 *
 * The audit record's own retention of the rationale text (`26 §2.0`, "journaled for the
 * audit record") belongs to the journal slice, which S1B does not implement. When that
 * slice lands it retains the text on the journal row, written straight from the transport
 * boundary — it does not acquire a reader here, because nothing downstream of
 * canonicalisation may read prose.
 *
 * See docs/implementation/S1B-owner-clarifications.md S1B-C1.
 * ---------------------------------------------------------------------------------
 */

declare const OpaqueRationaleBrand: unique symbol;

/**
 * The sealed rationale. Two observable properties, neither of which is its content.
 */
export interface OpaqueRationale {
  readonly [OpaqueRationaleBrand]: 'rationale';
  /** UTF-8 NFC byte length. Used only for the schema bound; not an authority operand. */
  readonly byteLength: number;
}

/** digest, by identity. Never keyed on content, so two equal rationales stay distinct objects. */
const commitments = new WeakMap<OpaqueRationale, Buffer>();

/**
 * Seal free text into an `OpaqueRationale`. Called only by `intent.ts`.
 *
 * The digest is over UTF-8 NFC bytes, matching `30 §5.3`'s Unicode rule, so a rationale
 * differing only in Unicode normalisation form commits identically.
 */
export function sealRationale(text: string): OpaqueRationale {
  const bytes = Buffer.from(text.normalize('NFC'), 'utf8');
  const sealed: OpaqueRationale = Object.freeze({
    byteLength: bytes.byteLength,
  }) as OpaqueRationale;
  commitments.set(sealed, createHash('sha256').update(bytes).digest());
  return sealed;
}

/**
 * The rationale's lineage commitment: a 32-byte SHA-256 digest.
 *
 * This is the ONLY operation defined on an `OpaqueRationale`, and it is called from
 * exactly one place — `lineage.ts`'s full-intent hash. Per S1B-C1, that is the only
 * position the architecture's `intent_hash` field admits rationale into, and it is opaque:
 * a hash is not an operand, cannot be compared for meaning, and cannot be parsed.
 */
export function rationaleCommitment(rationale: OpaqueRationale): Buffer {
  const digest = commitments.get(rationale);
  if (digest === undefined) {
    // An OpaqueRationale that this module did not seal. Fail closed rather than commit to
    // a value of unknown provenance.
    throw new Error('rationale was not sealed by sealRationale');
  }
  return digest;
}
