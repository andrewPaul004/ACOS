import { createHash, createPublicKey, verify as verifyEd25519, type KeyObject } from 'node:crypto';

import {
  ED25519_PUBLIC_KEY_BYTES,
  ED25519_SIGNATURE_BYTES,
  SHA256_DIGEST_BYTES,
} from './casSig.js';

/**
 * `SHA-256` and Ed25519 — the two primitives at the second level of `50 §3g`'s bootstrap
 * dependency graph, and the only cryptography the control-artifact trust chain uses.
 *
 * =================================================================================
 * ONE ALGORITHM, NO NEGOTIATION — `50 §3a`, verbatim
 *
 *   "**OWNER CONTROL-ARTIFACT SIGNATURES USE Ed25519.** The standard primitive, RFC 8032
 *    PureEdDSA over Curve25519: a 32-byte public key, a 64-byte signature, signing the
 *    message directly with no pre-hash step and no context string. **There is no custom
 *    elliptic-curve construction, no RSA alternative, and NO ALGORITHM NEGOTIATION IN S1.**
 *    A signature presented under any other algorithm identifier, or in any other encoding,
 *    is **REFUSED**; there is no fallback path and no "try the other verifier" branch."
 *
 * The shape of that rule in code is the ABSENCE of a parameter. `verifyControlSignature`
 * takes a message, a public key and a signature. It takes no algorithm argument, no suite
 * identifier, no options bag and no key-type discriminator, so
 * `phase2-v1.3.6-errata.md §1`'s algorithm-confusion attack — "an implementation that
 * selected a verifier from a presented algorithm identifier" — has nothing to select from.
 * =================================================================================
 *
 * =================================================================================
 * THE PUBLIC KEY IS 32 RAW BYTES, AND THE WRAPPER IS BUILT HERE
 *
 * `50 §3a`: `key_id = SHA-256(raw_ed25519_public_key_bytes)`, "over the exact 32 raw
 * public-key bytes — **not a DER or SPKI wrapper, not PEM, not base64**".
 *
 * `node:crypto` needs an SPKI document, so this module wraps the raw bytes in the fixed
 * 12-byte Ed25519 SPKI prefix at the point of use and NEVER lets a wrapped form become the
 * identity. A deployment that provisioned a PEM would therefore produce a different
 * `key_id` from the one the manifest names, which is the failure `§3a` wants rather than a
 * convenience this module should paper over.
 * =================================================================================
 */

/**
 * The fixed ASN.1 DER SPKI prefix for an Ed25519 public key (RFC 8410).
 *
 *   30 2a                       SEQUENCE, 42 bytes
 *      30 05                    SEQUENCE, 5 bytes  (AlgorithmIdentifier)
 *         06 03 2b 65 70        OID 1.3.101.112    (id-Ed25519)
 *      03 21 00                 BIT STRING, 33 bytes, 0 unused bits
 *                               ... then the 32 raw public-key bytes
 *
 * It is a CONSTANT, so no algorithm identifier is ever read from input and no second curve
 * is reachable through this module.
 */
const ED25519_SPKI_PREFIX = Uint8Array.from([
  0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
]);

/** `50 §3c`: `content_hash = SHA-256(EXACT_ARTIFACT_BYTES)`. Raw 32 bytes. */
export function sha256(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(createHash('sha256').update(bytes).digest());
}

/** This architecture's standard lowercase hexadecimal. `50 §3a`. */
export function hexOf(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

/**
 * Decode a lowercase-hex digest or key id. UPPERCASE IS REFUSED, not folded.
 *
 * `50 §3a` declares the rendering "in this architecture's standard **lowercase
 * hexadecimal**, 64 characters". Folding case here would make two spellings of one key id
 * both acceptable, and a comparison that accepts two spellings is a comparison an attacker
 * gets to choose the spelling for.
 */
export function decodeLowercaseHex(value: string, expectedBytes: number): Uint8Array | null {
  if (value.length !== expectedBytes * 2) return null;
  if (!/^[0-9a-f]*$/.test(value)) return null;
  return new Uint8Array(Buffer.from(value, 'hex'));
}

/**
 * `50 §3a`: `key_id = SHA-256(raw_ed25519_public_key_bytes)`, lowercase hex, 64 characters.
 *
 * "**The key ID is not the trust anchor by itself; the actual public-key bytes are.** A key
 * ID that matches proves nothing if the bytes behind it were not the provisioned ones." This
 * function therefore DERIVES a key id from bytes and never accepts one as an input to trust.
 */
export function keyIdOf(rawPublicKey: Uint8Array): string {
  if (rawPublicKey.length !== ED25519_PUBLIC_KEY_BYTES) {
    throw new Error(
      `an Ed25519 public key is ${String(ED25519_PUBLIC_KEY_BYTES)} raw bytes; got ` +
        `${String(rawPublicKey.length)} (50 §3a)`,
    );
  }
  return hexOf(sha256(rawPublicKey));
}

/** Two raw public keys are the same root when their 32 bytes are equal. `50 §3a`. */
export function samePublicKey(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let differing = 0;
  for (let i = 0; i < a.length; i += 1) differing |= a[i]! ^ b[i]!;
  return differing === 0;
}

/** Constant-shape digest comparison. Used for content hashes and manifest identities. */
export function sameDigest(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === SHA256_DIGEST_BYTES && samePublicKey(a, b);
}

/**
 * Build a `node:crypto` verifying key from the 32 RAW bytes, and from nothing else.
 *
 * Returns `null` rather than throwing when the bytes are not a well-formed Ed25519 point, so
 * a malformed deployment root is a fail-closed bootstrap verdict rather than an exception
 * shape a caller might catch and continue past.
 */
export function publicKeyFromRawBytes(rawPublicKey: Uint8Array): KeyObject | null {
  if (rawPublicKey.length !== ED25519_PUBLIC_KEY_BYTES) return null;
  const spki = new Uint8Array(ED25519_SPKI_PREFIX.length + rawPublicKey.length);
  spki.set(ED25519_SPKI_PREFIX, 0);
  spki.set(rawPublicKey, ED25519_SPKI_PREFIX.length);
  try {
    return createPublicKey({ key: Buffer.from(spki), format: 'der', type: 'spki' });
  } catch {
    return null;
  }
}

/**
 * Verify one Ed25519 signature over one message, under one raw public key.
 *
 * NO ALGORITHM ARGUMENT. The `null` first argument to `node:crypto`'s `verify` is how that
 * API spells "Ed25519 signs the message directly, with no pre-hash" — RFC 8032 PureEdDSA —
 * and it is a literal here, never a variable.
 *
 * A signature whose length is not exactly 64 bytes is refused BEFORE the verify call, so a
 * truncated or extended signature can never reach the primitive.
 */
export function verifyControlSignature(
  message: Uint8Array,
  rawPublicKey: Uint8Array,
  signature: Uint8Array,
): boolean {
  if (signature.length !== ED25519_SIGNATURE_BYTES) return false;
  const key = publicKeyFromRawBytes(rawPublicKey);
  if (key === null) return false;
  try {
    return verifyEd25519(null, Buffer.from(message), key, Buffer.from(signature));
  } catch {
    // A verify that throws is a verify that did not succeed. `50 §3f`: fail closed.
    return false;
  }
}
