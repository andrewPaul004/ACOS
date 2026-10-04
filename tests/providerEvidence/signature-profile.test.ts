import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  decodeStrictStandardBase64,
  parseVerificationKey,
  verifySendGridEventWebhookV1,
  type ParsedVerificationKey,
} from '../../src/audit/providerEvidence/sendgridEventWebhookV1.js';
import {
  SENDGRID_HELPER_VECTOR,
  TEST_ONLY_WEBHOOK_SIGNER,
  TEST_ONLY_WEBHOOK_SIGNER_B,
  bodyOf,
  correlationTag,
  processedEvent,
  signWebhook,
} from '../support/providerEvidenceFixture.js';

/**
 * `SENDGRID_EVENT_WEBHOOK_V1` — `50 §2h` P1 to P10, and every way to get one of them wrong.
 *
 * Every case is a single deviation from a request that verifies, so a refusal is attributable to
 * exactly the step it names.
 */

function keyOf(text: string): ParsedVerificationKey {
  const parsed = parseVerificationKey(text);
  if (!parsed.ok) throw new Error(`fixture key refused: ${parsed.refusal}`);
  return parsed.key;
}

const KEY_A = keyOf(TEST_ONLY_WEBHOOK_SIGNER.publicKeyText);
const KEY_B = keyOf(TEST_ONLY_WEBHOOK_SIGNER_B.publicKeyText);
const TIMESTAMP = '1760000123';
const BODY = bodyOf([processedEvent(correlationTag())]);

function headers(signature: string, timestamp: string = TIMESTAMP): string[] {
  return [
    'Host',
    'webhook.example.test',
    'Content-Type',
    'application/json',
    'X-Twilio-Email-Event-Webhook-Signature',
    signature,
    'X-Twilio-Email-Event-Webhook-Timestamp',
    timestamp,
  ];
}

function verify(
  rawHeaders: readonly string[],
  rawBody: Buffer = BODY,
  key: ParsedVerificationKey = KEY_A,
): string {
  const outcome = verifySendGridEventWebhookV1({ rawHeaders, rawBody, verificationKey: key });
  return outcome.verified ? 'VERIFIED' : outcome.refusal;
}

/** The DER signature's parts, so the malformed cases are built from a real signature. */
function derParts(signatureBase64: string): { r: Buffer; s: Buffer } {
  const der = Buffer.from(signatureBase64, 'base64');
  let offset = 2;
  const rLength = der[offset + 1]!;
  const r = der.subarray(offset + 2, offset + 2 + rLength);
  offset += 2 + rLength;
  const sLength = der[offset + 1]!;
  const s = der.subarray(offset + 2, offset + 2 + sLength);
  return { r, s };
}

function integer(content: Buffer): Buffer {
  return Buffer.concat([Buffer.from([0x02, content.length]), content]);
}

function sequence(...members: Buffer[]): Buffer {
  const body = Buffer.concat(members);
  return Buffer.concat([Buffer.from([0x30, body.length]), body]);
}

/** Strip DER's sign padding to get the bare magnitude. */
function magnitude(content: Buffer): Buffer {
  return content[0] === 0x00 ? content.subarray(1) : content;
}

const VALID = signWebhook(TIMESTAMP, BODY);

describe('the provider’s OWN known-answer vector', () => {
  it('SendGrid’s published helper test vector verifies under this profile, byte for byte', () => {
    const key = keyOf(SENDGRID_HELPER_VECTOR.publicKey);
    expect(
      verify(
        headers(SENDGRID_HELPER_VECTOR.signature, SENDGRID_HELPER_VECTOR.timestamp),
        SENDGRID_HELPER_VECTOR.payload,
        key,
      ),
    ).toBe('VERIFIED');
  });

  it('and fails the moment the payload loses its trailing CRLF, or is re-serialised', () => {
    const key = keyOf(SENDGRID_HELPER_VECTOR.publicKey);
    const trimmed = SENDGRID_HELPER_VECTOR.payload.subarray(0, SENDGRID_HELPER_VECTOR.payload.length - 2);
    const reserialised = Buffer.from(
      JSON.stringify(JSON.parse(SENDGRID_HELPER_VECTOR.payload.toString('utf8'))),
      'utf8',
    );
    const pretty = Buffer.from(
      `${JSON.stringify(JSON.parse(SENDGRID_HELPER_VECTOR.payload.toString('utf8')), null, 2)}\r\n`,
      'utf8',
    );
    for (const body of [trimmed, reserialised, pretty]) {
      expect(verify(headers(SENDGRID_HELPER_VECTOR.signature, SENDGRID_HELPER_VECTOR.timestamp), body, key)).toBe(
        'SIGNATURE_DOES_NOT_VERIFY',
      );
    }
  });
});

describe('P1 / P2 — the two headers, exactly once each, decided on the RAW header list', () => {
  it('a valid request verifies', () => {
    expect(verify(headers(VALID))).toBe('VERIFIED');
  });

  it('header-name matching is case-insensitive (RFC 9110)', () => {
    const lower = headers(VALID).map((entry, i) => (i % 2 === 0 ? entry.toLowerCase() : entry));
    expect(verify(lower)).toBe('VERIFIED');
  });

  it('missing signature / missing timestamp', () => {
    expect(verify(headers(VALID).slice(0, 4).concat(headers(VALID).slice(6)))).toBe(
      'SIGNATURE_HEADER_MISSING',
    );
    expect(verify(headers(VALID).slice(0, 6))).toBe('TIMESTAMP_HEADER_MISSING');
  });

  it('a DUPLICATE signature or timestamp is refused — even when both copies are valid', () => {
    expect(
      verify([...headers(VALID), 'X-Twilio-Email-Event-Webhook-Signature', VALID]),
    ).toBe('SIGNATURE_HEADER_REPEATED');
    expect(
      verify([...headers(VALID), 'x-twilio-email-event-webhook-timestamp', TIMESTAMP]),
    ).toBe('TIMESTAMP_HEADER_REPEATED');
  });

  it('empty values are refused', () => {
    expect(verify(headers(''))).toBe('SIGNATURE_HEADER_EMPTY');
    expect(verify(headers(VALID, ''))).toBe('TIMESTAMP_HEADER_EMPTY');
  });

  it.each([' 1760000123', '1760000123 ', '+1760000123', '1760000123.0', '0x68e1', '1,760,000,123', '١٧٦٠'])(
    'a timestamp that is not ASCII decimal digits only is refused: %j',
    (timestamp) => {
      expect(verify(headers(signWebhook(timestamp, BODY), timestamp))).toBe(
        'TIMESTAMP_NOT_DECIMAL_DIGITS',
      );
    },
  );
});

describe('P3 – P6 — exact octets, timestamp FIRST, SHA-256, no conversion', () => {
  it('the wrong timestamp does not verify', () => {
    expect(verify(headers(VALID, '1760000124'))).toBe('SIGNATURE_DOES_NOT_VERIFY');
  });

  it('a timestamp re-rendered from a number (leading zero dropped) does not verify', () => {
    const padded = '01760000123';
    const signature = signWebhook(padded, BODY);
    expect(verify(headers(signature, padded))).toBe('VERIFIED');
    expect(verify(headers(signature, String(Number(padded))))).toBe('SIGNATURE_DOES_NOT_VERIFY');
  });

  it('the REVERSED concatenation (body ‖ timestamp) does not verify', () => {
    const reversed = signWebhook('', Buffer.concat([BODY, Buffer.from(TIMESTAMP, 'ascii')]));
    expect(verify(headers(reversed))).toBe('SIGNATURE_DOES_NOT_VERIFY');
  });

  it('a one-byte whitespace mutation of the raw body does not verify', () => {
    const mutated = Buffer.from(BODY.toString('utf8').replace('[', '[ '), 'utf8');
    expect(verify(headers(VALID), mutated)).toBe('SIGNATURE_DOES_NOT_VERIFY');
  });

  it('a parsed-and-reserialised body does not verify', () => {
    const reserialised = Buffer.from(JSON.stringify(JSON.parse(BODY.toString('utf8'))), 'utf8');
    expect(verify(headers(VALID), reserialised)).toBe('SIGNATURE_DOES_NOT_VERIFY');
  });

  it('verification never parses: a signed body that is not JSON still VERIFIES', () => {
    const notJson = Buffer.from('this is not json {', 'utf8');
    expect(verify(headers(signWebhook(TIMESTAMP, notJson)), notJson)).toBe('VERIFIED');
  });

  it('the wrong key does not verify', () => {
    expect(verify(headers(VALID), BODY, KEY_B)).toBe('SIGNATURE_DOES_NOT_VERIFY');
  });

  it('a signature made with a different digest (SHA-384) does not verify', async () => {
    const { sign } = await import('node:crypto');
    const sha384 = sign('sha384', Buffer.concat([Buffer.from(TIMESTAMP, 'ascii'), BODY]), {
      key: TEST_ONLY_WEBHOOK_SIGNER.privateKey,
      dsaEncoding: 'der',
    }).toString('base64');
    expect(verify(headers(sha384))).toBe('SIGNATURE_DOES_NOT_VERIFY');
  });
});

describe('P7 — strict, canonical, standard Base64 for the signature', () => {
  function signatureMatching(predicate: (text: string) => boolean): string {
    for (let i = 0; i < 400; i += 1) {
      const candidate = signWebhook(TIMESTAMP, BODY);
      if (predicate(candidate)) return candidate;
    }
    throw new Error('no signature with the required shape was produced');
  }

  it('the URL-safe alphabet is refused', () => {
    const signature = signatureMatching((text) => /[+/]/.test(text));
    const urlSafe = signature.replace(/\+/g, '-').replace(/\//g, '_');
    expect(verify(headers(urlSafe))).toBe('SIGNATURE_NOT_STRICT_BASE64');
  });

  it('missing padding is refused, and so is extra padding', () => {
    const padded = signatureMatching((text) => text.endsWith('='));
    expect(verify(headers(padded.replace(/=+$/, '')))).toBe('SIGNATURE_NOT_STRICT_BASE64');
    expect(verify(headers(`${padded}=`))).toBe('SIGNATURE_NOT_STRICT_BASE64');
  });

  it('non-canonical pad bits are refused (the octets decode identically)', () => {
    const padded = signatureMatching((text) => text.endsWith('=') && !text.endsWith('=='));
    const last = padded.length - 2;
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const value = alphabet.indexOf(padded[last]!);
    // A canonical final character before a single '=' has its two low (pad) bits clear, so
    // setting one always yields a DIFFERENT, non-canonical spelling of the same octets.
    expect(value & 0x03).toBe(0);
    const nonCanonical = `${padded.slice(0, last)}${alphabet[value | 0x01]!}=`;
    expect(nonCanonical).not.toBe(padded);
    expect(Buffer.from(nonCanonical, 'base64').equals(Buffer.from(padded, 'base64'))).toBe(true);
    expect(verify(headers(nonCanonical))).toBe('SIGNATURE_NOT_STRICT_BASE64');
  });

  it('whitespace and trailing garbage are refused', () => {
    expect(verify(headers(`${VALID.slice(0, 10)} ${VALID.slice(10)}`))).toBe(
      'SIGNATURE_NOT_STRICT_BASE64',
    );
    expect(verify(headers(`${VALID}!`))).toBe('SIGNATURE_NOT_STRICT_BASE64');
  });

  it('the strict decoder itself', () => {
    expect(decodeStrictStandardBase64('AAAA')).not.toBeNull();
    expect(decodeStrictStandardBase64('AAA')).toBeNull();
    expect(decodeStrictStandardBase64('AA==')).not.toBeNull();
    expect(decodeStrictStandardBase64('AB==')).toBeNull();
    expect(decodeStrictStandardBase64('A===')).toBeNull();
    expect(decodeStrictStandardBase64('')).toBeNull();
  });
});

describe('P8 — exactly one DER ECDSA-Sig-Value, positive minimal integers in [1, n-1]', () => {
  const { r, s } = derParts(VALID);
  const order = Buffer.from(
    'ffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551',
    'hex',
  );

  it('the re-assembled valid signature verifies (the builders are faithful)', () => {
    expect(verify(headers(sequence(integer(r), integer(s)).toString('base64')))).toBe('VERIFIED');
  });

  it('raw r ‖ s (IEEE P1363) is refused', () => {
    const raw = Buffer.concat([
      Buffer.alloc(32 - magnitude(r).length, 0),
      magnitude(r),
      Buffer.alloc(32 - magnitude(s).length, 0),
      magnitude(s),
    ]);
    expect(verify(headers(raw.toString('base64')))).toBe('SIGNATURE_NOT_ONE_DER_SEQUENCE');
  });

  it('a wrong outer tag, trailing octets, a third member and a second object are refused', () => {
    const der = sequence(integer(r), integer(s));
    const wrongTag = Buffer.from(der);
    wrongTag[0] = 0x31;
    expect(verify(headers(wrongTag.toString('base64')))).toBe('SIGNATURE_NOT_ONE_DER_SEQUENCE');
    expect(verify(headers(Buffer.concat([der, Buffer.from([0x00])]).toString('base64')))).toBe(
      'SIGNATURE_NOT_ONE_DER_SEQUENCE',
    );
    expect(
      verify(headers(sequence(integer(r), integer(s), integer(Buffer.from([1]))).toString('base64'))),
    ).toBe('SIGNATURE_NOT_ONE_DER_SEQUENCE');
    expect(verify(headers(Buffer.concat([der, der]).toString('base64')))).toBe(
      'SIGNATURE_NOT_ONE_DER_SEQUENCE',
    );
  });

  it('an indefinite length and a non-minimal long-form length are refused', () => {
    const body = Buffer.concat([integer(r), integer(s)]);
    const indefinite = Buffer.concat([Buffer.from([0x30, 0x80]), body, Buffer.from([0, 0])]);
    expect(verify(headers(indefinite.toString('base64')))).toBe('SIGNATURE_NOT_ONE_DER_SEQUENCE');
    const longForm = Buffer.concat([Buffer.from([0x30, 0x81, body.length]), body]);
    expect(verify(headers(longForm.toString('base64')))).toBe('SIGNATURE_NOT_ONE_DER_SEQUENCE');
  });

  it('a negative integer is refused', () => {
    const negative = Buffer.concat([Buffer.from([0x80]), Buffer.alloc(31, 1)]);
    expect(verify(headers(sequence(integer(negative), integer(s)).toString('base64')))).toBe(
      'SIGNATURE_INTEGER_MALFORMED',
    );
  });

  it('an unnecessary leading zero octet is refused', () => {
    const padded = Buffer.concat([Buffer.from([0x00]), Buffer.from([0x01]), Buffer.alloc(31, 2)]);
    expect(verify(headers(sequence(integer(padded), integer(s)).toString('base64')))).toBe(
      'SIGNATURE_INTEGER_MALFORMED',
    );
  });

  it('r = 0 and s = 0 are refused', () => {
    expect(verify(headers(sequence(integer(Buffer.from([0])), integer(s)).toString('base64')))).toBe(
      'SIGNATURE_INTEGER_OUT_OF_RANGE',
    );
    expect(verify(headers(sequence(integer(r), integer(Buffer.from([0]))).toString('base64')))).toBe(
      'SIGNATURE_INTEGER_OUT_OF_RANGE',
    );
  });

  it('r = n and s = n (out of range) are refused', () => {
    const n = Buffer.concat([Buffer.from([0x00]), order]);
    expect(verify(headers(sequence(integer(n), integer(s)).toString('base64')))).toBe(
      'SIGNATURE_INTEGER_OUT_OF_RANGE',
    );
    expect(verify(headers(sequence(integer(r), integer(n)).toString('base64')))).toBe(
      'SIGNATURE_INTEGER_OUT_OF_RANGE',
    );
  });

  it('NO low-S requirement: the high-S twin (r, n − s) of a valid signature still verifies', () => {
    const sValue = BigInt(`0x${magnitude(s).toString('hex')}`);
    const nValue = BigInt(`0x${order.toString('hex')}`);
    let twin = (nValue - sValue).toString(16);
    if (twin.length % 2 === 1) twin = `0${twin}`;
    let twinBytes = Buffer.from(twin, 'hex');
    if ((twinBytes[0]! & 0x80) !== 0) twinBytes = Buffer.concat([Buffer.from([0]), twinBytes]);
    expect(verify(headers(sequence(integer(r), integer(twinBytes)).toString('base64')))).toBe(
      'VERIFIED',
    );
  });
});

describe('the profile is CLOSED in the source: no negotiation, no fallback, no request-selected algorithm', () => {
  const source = readFileSync(
    join(process.cwd(), 'src', 'audit', 'providerEvidence', 'sendgridEventWebhookV1.ts'),
    'utf8',
  );
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('the digest and the DER encoding are CONSTANTS of the one verify call', () => {
    const calls = code.match(/verifySignature\(/g) ?? [];
    expect(calls).toHaveLength(1);
    expect(code).toMatch(/verifySignature\(\s*'sha256',/);
    expect(code).toContain("dsaEncoding: 'der'");
  });

  it('the verifier never parses the body and imports no JSON path', () => {
    expect(code).not.toContain('JSON.parse');
  });

  it('there is no PEM, hex or alternate-key import path anywhere in the profile', () => {
    expect(code).not.toMatch(/format:\s*'pem'/);
    expect(code).not.toMatch(/'hex'\)\s*;?\s*\/\/\s*key/);
    expect((code.match(/createPublicKey\(/g) ?? []).length).toBe(1);
    expect(code).toMatch(/createPublicKey\(\{ key: der, format: 'der', type: 'spki' \}\)/);
  });
});
