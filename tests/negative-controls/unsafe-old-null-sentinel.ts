/**
 * ============================================================================
 * TEST-ONLY UNSAFE CODE. NEVER IMPORTED FROM `src/`. NEVER REGISTERED.
 * ============================================================================
 *
 * `ACOS-JCS-1` AS v1.2 DECLARED IT — the withdrawn one-byte `0x00` NULL sentinel,
 * reconstructed so that v1.3.2 erratum JCS-01 can be shown to close a real defect rather
 * than asserted to.
 *
 * `36 §0`'s negative-control rule, and `phase2-v1.3.2-verification.md §5` restating it:
 *
 *   "A consistency pass that has never failed is indistinguishable from one that cannot."
 *
 * ---------------------------------------------------------------------------------
 * THE WITHDRAWN RULE, VERBATIM FROM `30 §5.3` AS v1.3.1 ISSUED IT
 *
 *   | Nulls vs empty strings | Single `0x00` sentinel byte for null; an empty string is a
 *   |                        | zero-length value. |
 *   | Field framing          | Every field prefixed with its 4-byte big-endian byte
 *   |                        | length, so no separator can be forged by content. |
 *
 * Compose them over a `bytea` field and the encoding is not injective:
 *
 *   SQL NULL            payload = the sentinel, one 0x00 byte    framed 00 00 00 01 00
 *   bytea '\x00'        payload = the value, one 0x00 byte       framed 00 00 00 01 00
 *
 * `text` was accidentally safe, because PostgreSQL `text` cannot hold `U+0000` and owner
 * clarification S1B-C8 excludes it from ACOS canonical text. `bytea` was not, and
 * `30 §5.3`'s rules are declared over FIELDS rather than over column types.
 * ---------------------------------------------------------------------------------
 *
 * THIS FILE IMPORTS NOTHING — not `src/`, not the oracle. It is a self-contained
 * transcription of the withdrawn rule, so the collision it demonstrates cannot be an
 * artefact of shared code with the implementation under test.
 *
 * `old-null-sentinel-collision.test.ts` is the only consumer. Its job is to show the
 * collision here and its absence in all three current implementations; a run in which the
 * collision does NOT appear here means this file has drifted off the withdrawn rule and
 * the regression proof has stopped discriminating.
 */

/** v1.2: "Single `0x00` sentinel byte for null." */
export const OLD_NULL_SENTINEL = Buffer.from([0x00]);

/**
 * v1.2's field encoding: the payload for a NULL is the sentinel BYTE, and the frame is a
 * plain length prefix with no reserved value.
 */
export function unsafeOldFrameField(value: Buffer | null): Buffer {
  const payload = value === null ? OLD_NULL_SENTINEL : value;
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32BE(payload.length, 0);
  return Buffer.concat([prefix, payload]);
}

/** v1.2's `bytea` rule: the bytes themselves, with no exclusion and no escape. */
export function unsafeOldBytes(value: Buffer | null): Buffer {
  return value === null ? OLD_NULL_SENTINEL : value;
}

/** v1.2's text rule: UTF-8, NFC, with the same sentinel for NULL. */
export function unsafeOldText(value: string | null): Buffer {
  return value === null ? OLD_NULL_SENTINEL : Buffer.from(value.normalize('NFC'), 'utf8');
}
