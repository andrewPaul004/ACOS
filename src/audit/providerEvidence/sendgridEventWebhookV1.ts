import { createHash, createPublicKey, verify as verifySignature, type KeyObject } from 'node:crypto';

/**
 * `SENDGRID_EVENT_WEBHOOK_V1` — THE ONE CLOSED VERIFICATION PROFILE CLASS 28 MAY NAME.
 *
 * =================================================================================
 * `50 §2h` (v1.3.8, `S1P-W3`), verbatim in substance
 *
 *   "**`ECDSA` names a family of signature schemes. It is not a verification procedure.**"
 *   "**`SENDGRID_EVENT_WEBHOOK_V1` EXPANDS NORMATIVELY TO EXACTLY THIS PROCEDURE, AND TO
 *    NOTHING ELSE**" — P1 to P10.
 *
 * This module is that procedure and nothing else. It is NOT a generic ECDSA verifier:
 *
 *   * there is no algorithm parameter, no digest parameter and no curve parameter anywhere
 *     in its surface, so nothing a caller or a request supplies can select one;
 *   * there is no second verifier, no fallback decoder and no "try the next encoding";
 *   * every malformed input is a REFUSAL, never a repair.
 *
 * `node:crypto` supplies the two standard primitives v1.3.8 needs — SHA-256 and P-256 ECDSA
 * verification — and a SMALL, BOUNDED, STRICT DER reader written here decides structure
 * before either primitive is reached. OpenSSL is never the parser of record for a shape
 * this profile closes, because OpenSSL's tolerance is not this profile's tolerance.
 *
 * =================================================================================
 * THE PROVIDER BASIS, AND THE ONE FACT THE PROSE DOES NOT STATE
 *
 * Headers, `timestamp + payload` over raw bytes, SHA-256, ECDSA, Base64 signature transport
 * and ASN.1 `(r, s)` are SendGrid's documented procedure. The stored key representation —
 * standard Base64 of one DER X.509 `SubjectPublicKeyInfo` — is what SendGrid's official Go,
 * Java and Python helpers all do with the provider-returned `public_key` string. The curve
 * (`prime256v1`) rests on those helpers' published test-fixture key; `50 §2h` records it as a
 * residual provider fact whose failure mode is REFUSAL: a captured key on any other curve is
 * a class-28 record failure, never a widened verifier.
 * =================================================================================
 */

/** `50 §2h` field 5's only defined value. */
export const SENDGRID_EVENT_WEBHOOK_V1 = 'SENDGRID_EVENT_WEBHOOK_V1';

/** The closed set of profile identifiers. ONE member; an unknown profile fails closed. */
export const VERIFICATION_PROFILES: readonly string[] = Object.freeze([SENDGRID_EVENT_WEBHOOK_V1]);

/** P1. Lowercase, because RFC 9110 field-name matching is case-insensitive. */
export const SIGNATURE_HEADER = 'x-twilio-email-event-webhook-signature';
/** P2. */
export const TIMESTAMP_HEADER = 'x-twilio-email-event-webhook-timestamp';

/**
 * The P-256 group order `n`, from SEC 2 / FIPS 186-5. P8 requires `1 <= r, s <= n - 1`.
 */
const P256_ORDER = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');
/** The P-256 field prime and curve coefficient `b`, for the on-curve check of step 4. */
const P256_PRIME = BigInt('0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff');
const P256_B = BigInt('0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604b');

/** `id-ecPublicKey`, 1.2.840.10045.2.1, as DER content octets. */
const OID_EC_PUBLIC_KEY = Buffer.from('2a8648ce3d0201', 'hex');
/** `prime256v1`, 1.2.840.10045.3.1.7, as DER content octets. */
const OID_PRIME256V1 = Buffer.from('2a8648ce3d030107', 'hex');

/**
 * A bound on how long a provider key string may be. A P-256 SPKI is 91 octets, 124 Base64
 * characters; anything an order of magnitude longer is not one, and refusing it early keeps
 * the parser bounded. An ACOS fail-closed restriction, never authority.
 */
const MAX_KEY_TEXT_LENGTH = 1024;
/** A DER P-256 signature is at most 72 octets, 96 Base64 characters. */
const MAX_SIGNATURE_TEXT_LENGTH = 256;
/** A Unix-seconds timestamp needs far fewer than 32 digits. Refusal only. */
const MAX_TIMESTAMP_DIGITS = 32;

// ---------------------------------------------------------------------------------
// P7 — STRICT, CANONICAL, STANDARD BASE64.
// ---------------------------------------------------------------------------------

/**
 * RFC 4648 §4 standard Base64, padded, canonical — or `null`.
 *
 * `Buffer.from(text, 'base64')` alone accepts URL-safe characters, skips whitespace, ignores
 * missing padding and drops trailing garbage. So the alphabet and the padding position are
 * checked FIRST, the length must be a multiple of four, and the decoded octets must
 * RE-ENCODE TO THE IDENTICAL STRING — which is what refuses non-zero pad bits and every
 * other non-canonical spelling of the same octets.
 */
export function decodeStrictStandardBase64(text: string): Buffer | null {
  if (text.length === 0 || text.length % 4 !== 0) return null;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text)) return null;
  const decoded = Buffer.from(text, 'base64');
  if (decoded.length === 0) return null;
  if (decoded.toString('base64') !== text) return null;
  return decoded;
}

// ---------------------------------------------------------------------------------
// A SMALL, STRICT DER READER. Definite lengths only, minimal lengths only, single-octet tags.
// ---------------------------------------------------------------------------------

interface Tlv {
  readonly tag: number;
  readonly value: Buffer;
  /** The offset one past this TLV. */
  readonly end: number;
}

function readTlv(buffer: Buffer, offset: number): Tlv | null {
  if (offset + 2 > buffer.length) return null;
  const tag = buffer[offset]!;
  // High-tag-number form is never used by any structure this profile admits.
  if ((tag & 0x1f) === 0x1f) return null;
  const first = buffer[offset + 1]!;
  let cursor = offset + 2;
  let length: number;
  if (first < 0x80) {
    length = first;
  } else if (first === 0x80) {
    // Indefinite length. BER, never DER.
    return null;
  } else {
    const octets = first & 0x7f;
    // Nothing this profile admits is anywhere near 64 KiB.
    if (octets > 2) return null;
    if (cursor + octets > buffer.length) return null;
    // A leading zero length octet is a non-minimal encoding.
    if (buffer[cursor] === 0) return null;
    length = 0;
    for (let i = 0; i < octets; i += 1) length = length * 256 + buffer[cursor + i]!;
    cursor += octets;
    // A long form for a length the short form could carry is non-minimal.
    if (length < 0x80) return null;
  }
  if (cursor + length > buffer.length) return null;
  return { tag, value: buffer.subarray(cursor, cursor + length), end: cursor + length };
}

/**
 * A DER INTEGER's content octets, as a POSITIVE bigint — or `null`.
 *
 * Refuses an empty integer, a negative integer (high bit set without a 0x00 pad) and an
 * unnecessary leading zero (0x00 followed by an octet whose high bit is clear).
 */
function positiveDerInteger(value: Buffer): bigint | null {
  if (value.length === 0) return null;
  if ((value[0]! & 0x80) !== 0) return null;
  if (value[0] === 0x00 && value.length > 1 && (value[1]! & 0x80) === 0) return null;
  return BigInt(`0x${value.toString('hex')}`);
}

// ---------------------------------------------------------------------------------
// THE CANONICAL VERIFICATION-KEY REPRESENTATION — `50 §2h`, steps 1 to 4.
// ---------------------------------------------------------------------------------

/** Why a `verification_key` is not usable. A closed set; each is a class-28 record failure. */
export const VERIFICATION_KEY_REFUSALS = [
  'KEY_NOT_STRICT_BASE64',
  'KEY_NOT_ONE_DER_SPKI',
  'KEY_NOT_EC_PUBLIC_KEY',
  'KEY_NOT_P256',
  'KEY_POINT_NOT_UNCOMPRESSED',
  'KEY_POINT_NOT_ON_CURVE',
  'KEY_REJECTED_BY_CRYPTO_PROVIDER',
] as const;

export type VerificationKeyRefusal = (typeof VERIFICATION_KEY_REFUSALS)[number];

/** A parsed P-256 key, and the exact DER octets it was parsed from. */
export interface ParsedVerificationKey {
  /** `verification_key_der_octets` — exactly the octets step 1 yields. */
  readonly derOctets: Buffer;
  /** `lowercase_hex(SHA-256(verification_key_der_octets))`. */
  readonly keyIdentity: string;
  /** The key object the verifier uses. Never serialised. */
  readonly key: KeyObject;
}

function mod(value: bigint, modulus: bigint): bigint {
  const r = value % modulus;
  return r < 0n ? r + modulus : r;
}

/**
 * Parse the provider-returned `public_key` string under the ONE representation `50 §2h`
 * declares, and nothing else.
 *
 * There is no PEM path, no raw-DER path, no hex path, no raw-point path and no
 * compressed-point path, and a failure at any step is the answer: `50 §2h`, "**A parse failure
 * is a class-28 record failure, not an invitation to guess**".
 */
export function parseVerificationKey(
  text: string,
): { readonly ok: true; readonly key: ParsedVerificationKey } | { readonly ok: false; readonly refusal: VerificationKeyRefusal } {
  if (text.length > MAX_KEY_TEXT_LENGTH) return { ok: false, refusal: 'KEY_NOT_STRICT_BASE64' };
  // STEP 1 — strict canonical standard Base64.
  const der = decodeStrictStandardBase64(text);
  if (der === null) return { ok: false, refusal: 'KEY_NOT_STRICT_BASE64' };

  // STEP 2 — exactly one DER SubjectPublicKeyInfo, no trailing octets.
  const spki = readTlv(der, 0);
  if (spki === null || spki.tag !== 0x30 || spki.end !== der.length) {
    return { ok: false, refusal: 'KEY_NOT_ONE_DER_SPKI' };
  }
  const algorithm = readTlv(spki.value, 0);
  if (algorithm === null || algorithm.tag !== 0x30) {
    return { ok: false, refusal: 'KEY_NOT_ONE_DER_SPKI' };
  }
  const subjectPublicKey = readTlv(spki.value, algorithm.end);
  if (
    subjectPublicKey === null ||
    subjectPublicKey.tag !== 0x03 ||
    subjectPublicKey.end !== spki.value.length
  ) {
    return { ok: false, refusal: 'KEY_NOT_ONE_DER_SPKI' };
  }

  // STEP 3 — id-ecPublicKey with namedCurve prime256v1, and NOTHING ELSE in the identifier.
  const algorithmOid = readTlv(algorithm.value, 0);
  if (algorithmOid === null || algorithmOid.tag !== 0x06) {
    return { ok: false, refusal: 'KEY_NOT_ONE_DER_SPKI' };
  }
  if (!algorithmOid.value.equals(OID_EC_PUBLIC_KEY)) {
    return { ok: false, refusal: 'KEY_NOT_EC_PUBLIC_KEY' };
  }
  const curveOid = readTlv(algorithm.value, algorithmOid.end);
  // An absent parameter, explicit curve parameters (a SEQUENCE) or a different named curve
  // are all refusals, and so is anything after the parameter.
  if (curveOid === null || curveOid.tag !== 0x06 || curveOid.end !== algorithm.value.length) {
    return { ok: false, refusal: 'KEY_NOT_P256' };
  }
  if (!curveOid.value.equals(OID_PRIME256V1)) return { ok: false, refusal: 'KEY_NOT_P256' };

  // STEP 4 — a valid P-256 point. BIT STRING with zero unused bits, then 0x04 || X || Y.
  //
  // ONE point encoding: uncompressed. The provider's published fixture key is uncompressed,
  // and refusing the compressed form is a fail-closed restriction that can only refuse.
  const bits = subjectPublicKey.value;
  if (bits.length !== 66 || bits[0] !== 0x00) {
    return { ok: false, refusal: 'KEY_POINT_NOT_UNCOMPRESSED' };
  }
  if (bits[1] !== 0x04) return { ok: false, refusal: 'KEY_POINT_NOT_UNCOMPRESSED' };
  const x = BigInt(`0x${bits.subarray(2, 34).toString('hex')}`);
  const y = BigInt(`0x${bits.subarray(34, 66).toString('hex')}`);
  if (x >= P256_PRIME || y >= P256_PRIME) return { ok: false, refusal: 'KEY_POINT_NOT_ON_CURVE' };
  // y^2 = x^3 - 3x + b (mod p). Checked here so the curve membership is this module's own
  // finding rather than an assumption about the crypto provider's import path.
  const left = mod(y * y, P256_PRIME);
  const right = mod(x * x * x - 3n * x + P256_B, P256_PRIME);
  if (left !== right) return { ok: false, refusal: 'KEY_POINT_NOT_ON_CURVE' };

  let key: KeyObject;
  try {
    key = createPublicKey({ key: der, format: 'der', type: 'spki' });
  } catch {
    return { ok: false, refusal: 'KEY_REJECTED_BY_CRYPTO_PROVIDER' };
  }
  // AND THE PROVIDER AGREES. A disagreement is a refusal, never a second interpretation.
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
    return { ok: false, refusal: 'KEY_NOT_P256' };
  }

  return {
    ok: true,
    key: Object.freeze({
      derOctets: der,
      keyIdentity: deriveKeyIdentity(der),
      key,
    }),
  };
}

/**
 * `50 §2h` (`S1P-W4`): `key_identity = lowercase_hex(SHA-256(verification_key_der_octets))`.
 *
 * Over the DER octets the verifier consumes — never the Base64 text, never a PEM rendering,
 * never an extracted point.
 */
export function deriveKeyIdentity(verificationKeyDerOctets: Uint8Array): string {
  return createHash('sha256').update(verificationKeyDerOctets).digest('hex');
}

// ---------------------------------------------------------------------------------
// P1 — P10 over one request.
// ---------------------------------------------------------------------------------

/** Why a request is not evidence. A closed set; a reason code is the whole diagnostic. */
export const SIGNATURE_REFUSALS = [
  'SIGNATURE_HEADER_MISSING',
  'SIGNATURE_HEADER_REPEATED',
  'SIGNATURE_HEADER_EMPTY',
  'TIMESTAMP_HEADER_MISSING',
  'TIMESTAMP_HEADER_REPEATED',
  'TIMESTAMP_HEADER_EMPTY',
  'TIMESTAMP_NOT_DECIMAL_DIGITS',
  'SIGNATURE_NOT_STRICT_BASE64',
  'SIGNATURE_NOT_ONE_DER_SEQUENCE',
  'SIGNATURE_INTEGER_MALFORMED',
  'SIGNATURE_INTEGER_OUT_OF_RANGE',
  'SIGNATURE_DOES_NOT_VERIFY',
] as const;

export type SignatureRefusal = (typeof SIGNATURE_REFUSALS)[number];

/**
 * The raw header list exactly as the HTTP layer received it — `[name, value, name, value, …]`,
 * which is Node's `IncomingMessage.rawHeaders`.
 *
 * P1/P2's "exactly once" is decided HERE, against the raw list, and never against a
 * framework-normalised map — Node's `headers` object joins a repeated unknown header with
 * `", "`, which would turn two signatures into one malformed one and lose the fact that there
 * were two.
 */
export type RawHeaderList = readonly string[];

/** Every value presented under one field name, case-insensitively, in arrival order. */
export function rawHeaderValues(raw: RawHeaderList, lowercaseName: string): readonly string[] {
  const values: string[] = [];
  for (let i = 0; i + 1 < raw.length; i += 2) {
    if (raw[i]!.toLowerCase() === lowercaseName) values.push(raw[i + 1]!);
  }
  return values;
}

/** The successful outcome. Carries no signature octets: no identity is derived from them. */
export interface VerifiedProviderRequest {
  /** The exact timestamp field value — retained as text, never as a re-rendered number. */
  readonly timestampText: string;
  /** `SHA-256(raw_body_octets)`, lowercase hex. The only trace of the raw body kept. */
  readonly rawBodySha256: string;
}

/**
 * P1 — P10. Verify ONE request's exact raw body under the class-28 key, and nothing else.
 *
 * The body is never parsed here, and this function returns no parsed body: `48 §8` G6, "**ONLY
 * AFTER SUCCESSFUL VERIFICATION MAY THE BODY BE PARSED**", is a property of what the caller
 * can reach, and the caller reaches the raw octets it already had and a yes or a no.
 */
export function verifySendGridEventWebhookV1(input: {
  readonly rawHeaders: RawHeaderList;
  readonly rawBody: Buffer;
  readonly verificationKey: ParsedVerificationKey;
}):
  | { readonly verified: true; readonly request: VerifiedProviderRequest }
  | { readonly verified: false; readonly refusal: SignatureRefusal } {
  // P1.
  const signatures = rawHeaderValues(input.rawHeaders, SIGNATURE_HEADER);
  if (signatures.length === 0) return { verified: false, refusal: 'SIGNATURE_HEADER_MISSING' };
  if (signatures.length > 1) return { verified: false, refusal: 'SIGNATURE_HEADER_REPEATED' };
  const signatureText = signatures[0]!;
  if (signatureText.length === 0) return { verified: false, refusal: 'SIGNATURE_HEADER_EMPTY' };

  // P2. Node's raw header values carry no surrounding optional whitespace, so the value is
  // the field value; it must be digits and only digits, and it is never trimmed here.
  const timestamps = rawHeaderValues(input.rawHeaders, TIMESTAMP_HEADER);
  if (timestamps.length === 0) return { verified: false, refusal: 'TIMESTAMP_HEADER_MISSING' };
  if (timestamps.length > 1) return { verified: false, refusal: 'TIMESTAMP_HEADER_REPEATED' };
  const timestampText = timestamps[0]!;
  if (timestampText.length === 0) return { verified: false, refusal: 'TIMESTAMP_HEADER_EMPTY' };
  if (timestampText.length > MAX_TIMESTAMP_DIGITS || !/^[0-9]+$/.test(timestampText)) {
    return { verified: false, refusal: 'TIMESTAMP_NOT_DECIMAL_DIGITS' };
  }

  // P7.
  if (signatureText.length > MAX_SIGNATURE_TEXT_LENGTH) {
    return { verified: false, refusal: 'SIGNATURE_NOT_STRICT_BASE64' };
  }
  const derSignature = decodeStrictStandardBase64(signatureText);
  if (derSignature === null) return { verified: false, refusal: 'SIGNATURE_NOT_STRICT_BASE64' };

  // P8 — EXACTLY one DER SEQUENCE { r INTEGER, s INTEGER }, nothing after it.
  const sequence = readTlv(derSignature, 0);
  if (sequence === null || sequence.tag !== 0x30 || sequence.end !== derSignature.length) {
    return { verified: false, refusal: 'SIGNATURE_NOT_ONE_DER_SEQUENCE' };
  }
  const rTlv = readTlv(sequence.value, 0);
  const sTlv = rTlv === null ? null : readTlv(sequence.value, rTlv.end);
  if (
    rTlv === null ||
    sTlv === null ||
    rTlv.tag !== 0x02 ||
    sTlv.tag !== 0x02 ||
    sTlv.end !== sequence.value.length
  ) {
    return { verified: false, refusal: 'SIGNATURE_NOT_ONE_DER_SEQUENCE' };
  }
  const r = positiveDerInteger(rTlv.value);
  const s = positiveDerInteger(sTlv.value);
  if (r === null || s === null) return { verified: false, refusal: 'SIGNATURE_INTEGER_MALFORMED' };
  if (r < 1n || r >= P256_ORDER || s < 1n || s >= P256_ORDER) {
    return { verified: false, refusal: 'SIGNATURE_INTEGER_OUT_OF_RANGE' };
  }

  // P3, P4, P5 — timestamp octets FIRST, raw body octets SECOND, nothing between or after.
  const signedInput = Buffer.concat([Buffer.from(timestampText, 'ascii'), input.rawBody]);

  // P6 + P10 — SHA-256, ECDSA on the P-256 key. The digest and curve are constants of this
  // call, and the DER octets passed are the ones the strict reader above already admitted.
  let verified: boolean;
  try {
    verified = verifySignature(
      'sha256',
      signedInput,
      { key: input.verificationKey.key, dsaEncoding: 'der' },
      derSignature,
    );
  } catch {
    verified = false;
  }
  if (!verified) return { verified: false, refusal: 'SIGNATURE_DOES_NOT_VERIFY' };

  return {
    verified: true,
    request: Object.freeze({
      timestampText,
      rawBodySha256: createHash('sha256').update(input.rawBody).digest('hex'),
    }),
  };
}
