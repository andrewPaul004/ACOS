import { generateKeyPairSync, sign as signEd25519 } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  SIGNAL_CANONICAL_KIND,
  signalSigningBytes,
  verifyCorroborationSignal,
  type SignalWire,
} from '../../src/kernel/mirror/corroborationSignal.js';
import { signalMaxAgeMs } from '../../src/kernel/mirror/mirrorState.js';
import {
  frameField,
  jcsInt,
  jcsText,
  jcsTimestamp,
  oracleCanonicalBytes,
  stallSignalFields,
} from '../support/jcs1Oracle.js';

/**
 * `30 §5.7.1` — THE CORROBORATION SIGNAL CONTRACT, AND `§7`'s EIGHT ADVERSARIAL ARTIFACTS.
 *
 * =================================================================================
 * `§7` OF THE S1H MANDATE, verbatim:
 *
 *   "Required adversarial tests: 1. unsigned signal; 2. malformed signature; 3. wrong audit
 *    key; 4. wrong company; 5. modified timestamp after signing; 6. modified interval/cause
 *    after signing; 7. control-signed signal; 8. model/caller-created signal. All must fail
 *    closed. **Use real cryptographic verification** if the architecture specifies
 *    signatures. **Do not implement a mock boolean signature.**"
 *
 * Every case below runs real `node:crypto` Ed25519 against real generated keys.
 * =================================================================================
 */

const COMPANY = 'co_s1h';
const OTHER_COMPANY = 'co_s1h_other';
const T0 = new Date('2026-03-01T12:00:00.000Z');
const AUDIT_INSTANCE = 'audit-instance:s1h';

const auditKey = generateKeyPairSync('ed25519');
/** `§7` case 3 and case 7: another key, standing in for both a wrong audit key and the
 * control plane's own. `30 §5.7.1`: the control plane "holds no private key". */
const otherKey = generateKeyPairSync('ed25519');

function fields(over: Partial<Omit<SignalWire, 'signature'>> = {}): Omit<SignalWire, 'signature'> {
  return {
    signalId: 'signal:s1h-1',
    companyId: COMPANY,
    observedAt: T0,
    intervalStart: new Date(T0.getTime() - 60_000),
    lastAttestationSeq: 42n,
    lastAttestationReceivedAt: new Date(T0.getTime() - 16 * 60_000),
    reason: 'ATTESTATION_STALL',
    expiresAt: new Date(T0.getTime() + signalMaxAgeMs()),
    auditInstanceId: AUDIT_INSTANCE,
    ...over,
  };
}

function signedWith(
  f: Omit<SignalWire, 'signature'>,
  key: Parameters<typeof signEd25519>[2],
): SignalWire {
  const bytes = signalSigningBytes({ ...f, signature: Buffer.alloc(64) });
  return { ...f, signature: signEd25519(null, bytes, key) };
}

describe('the SIGNED FIELD SET is `30 §5.7.1`s struct, and the signature is not a member of it', () => {
  it('the signature bytes do not affect the signing bytes', () => {
    // "Ed25519 over `ACOS-JCS-1` canonical bytes **of the fields above**." If `signature`
    // were a member, no signature could ever be constructed.
    const f = fields();
    const a = signalSigningBytes({ ...f, signature: Buffer.alloc(64, 0) });
    const b = signalSigningBytes({ ...f, signature: Buffer.alloc(64, 0xff) });
    expect(a.equals(b)).toBe(true);
  });

  it('and the bytes agree with a HAND-AUTHORED reading of the declared order', () => {
    // `36 §0`: the oracle must not be the implementation. `tests/support/jcs1Oracle.ts`
    // imports nothing from `src/`; this compares production's construction to it.
    const f = fields();
    const production = signalSigningBytes({ ...f, signature: Buffer.alloc(64) });
    const oracle = oracleCanonicalBytes(
      stallSignalFields({
        signalId: f.signalId,
        companyId: f.companyId,
        observedAt: f.observedAt,
        intervalStart: f.intervalStart,
        lastAttestationSeq: f.lastAttestationSeq,
        lastAttestationReceivedAt: f.lastAttestationReceivedAt,
        reason: f.reason,
        expiresAt: f.expiresAt,
        auditInstanceId: f.auditInstanceId,
      }),
    );
    expect(production.equals(oracle)).toBe(true);
  });

  it('the domain tag is framed FIRST, so a signal cannot collide with a journal row', () => {
    // `30 §5.3`: "The kind is framed as a field of its own so two structures with identical
    // field bytes and different meanings do not collide."
    const production = signalSigningBytes({ ...fields(), signature: Buffer.alloc(64) });
    const tag = frameField(jcsText(SIGNAL_CANONICAL_KIND));
    expect(production.subarray(0, tag.length).equals(tag)).toBe(true);
  });

  it('a NULL `last_attestation_received_at` frames as the RESERVED WORD, not as a payload', () => {
    // v1.3.2 erratum JCS-01. `S1H-C5`: the field is null when no attestation has ever been
    // received, and the reserved framing word is what keeps that distinguishable from any
    // timestamp payload.
    const never = signalSigningBytes({
      ...fields({ lastAttestationSeq: 0n, lastAttestationReceivedAt: null }),
      signature: Buffer.alloc(64),
    });
    const oracle = oracleCanonicalBytes(
      stallSignalFields({
        signalId: 'signal:s1h-1',
        companyId: COMPANY,
        observedAt: T0,
        intervalStart: new Date(T0.getTime() - 60_000),
        lastAttestationSeq: 0n,
        lastAttestationReceivedAt: null,
        reason: 'ATTESTATION_STALL',
        expiresAt: new Date(T0.getTime() + signalMaxAgeMs()),
        auditInstanceId: AUDIT_INSTANCE,
      }),
    );
    expect(never.equals(oracle)).toBe(true);
    // And the reserved word is present exactly where the null field is.
    expect(never.includes(Buffer.from([0xff, 0xff, 0xff, 0xff]))).toBe(true);
    // While a non-null instant frames with an ordinary length word, so the two differ.
    expect(never.equals(signalSigningBytes({ ...fields(), signature: Buffer.alloc(64) }))).toBe(
      false,
    );
  });
});

describe('a GENUINE signal verifies', () => {
  it('valid, fresh, right company, right key', () => {
    const result = verifyCorroborationSignal(
      signedWith(fields(), auditKey.privateKey),
      COMPANY,
      auditKey.publicKey,
      T0,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.held.signalId).toBe('signal:s1h-1');
      expect(result.held.companyId).toBe(COMPANY);
    }
  });
});

describe("`§7`'s EIGHT ADVERSARIAL ARTIFACTS — every one fails closed", () => {
  it('1. UNSIGNED — no signature bytes', () => {
    const result = verifyCorroborationSignal(
      { ...fields(), signature: Buffer.alloc(0) },
      COMPANY,
      auditKey.publicKey,
      T0,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection).toBe('SIGNAL_UNSIGNED');
  });

  it('2. MALFORMED SIGNATURE — 64 random bytes', () => {
    const result = verifyCorroborationSignal(
      { ...fields(), signature: Buffer.alloc(64, 0xab) },
      COMPANY,
      auditKey.publicKey,
      T0,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection).toBe('SIGNAL_SIGNATURE_INVALID');
  });

  it('3. WRONG AUDIT KEY — a valid signature under a different key', () => {
    // `50 §2` class 24: "A substituted public key would let a compromised control plane mint
    // its own corroboration, so the key is hashed into the manifest and a mismatch makes the
    // corroborated state **unreachable rather than forgeable**."
    const result = verifyCorroborationSignal(
      signedWith(fields(), otherKey.privateKey),
      COMPANY,
      auditKey.publicKey,
      T0,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection).toBe('SIGNAL_SIGNATURE_INVALID');
  });

  it('4. WRONG COMPANY — genuinely signed, for someone else', () => {
    const result = verifyCorroborationSignal(
      signedWith(fields({ companyId: OTHER_COMPANY }), auditKey.privateKey),
      COMPANY,
      auditKey.publicKey,
      T0,
    );
    expect(result.ok).toBe(false);
    // The SIGNATURE is valid — it is a real signal for a real other company — so the
    // rejection names the scope rather than the cryptography. That distinction is why the
    // company check runs AFTER the signature check.
    if (!result.ok) expect(result.rejection).toBe('SIGNAL_WRONG_COMPANY');
  });

  it('5. MODIFIED TIMESTAMP AFTER SIGNING', () => {
    // `30 §5.7.1`: "Extending a signal's life by rewriting `expires_at` **breaks the
    // signature**." Both timestamps are tried, because moving only `expires_at` would also
    // break the `expires_at = observed_at + max_age` shape check and could be caught for the
    // wrong reason.
    const genuine = signedWith(fields(), auditKey.privateKey);

    const bothMoved: SignalWire = {
      ...genuine,
      observedAt: new Date(T0.getTime() + 10 * 60_000),
      expiresAt: new Date(T0.getTime() + 10 * 60_000 + signalMaxAgeMs()),
    };
    const movedResult = verifyCorroborationSignal(
      bothMoved,
      COMPANY,
      auditKey.publicKey,
      new Date(T0.getTime() + 10 * 60_000),
    );
    expect(movedResult.ok).toBe(false);
    // The SHAPE still holds, so the failure must be cryptographic — which is what proves the
    // signature covers the timestamps.
    if (!movedResult.ok) expect(movedResult.rejection).toBe('SIGNAL_SIGNATURE_INVALID');

    const expiryOnly: SignalWire = {
      ...genuine,
      expiresAt: new Date(T0.getTime() + 24 * 60 * 60 * 1000),
    };
    const expiryResult = verifyCorroborationSignal(
      expiryOnly,
      COMPANY,
      auditKey.publicKey,
      T0,
    );
    expect(expiryResult.ok).toBe(false);
    // Caught by the SHAPE rule first: `expires_at` is no longer `observed_at + max_age`.
    if (!expiryResult.ok) expect(expiryResult.rejection).toBe('SIGNAL_EXPIRY_NOT_MAX_AGE');
  });

  it('6. MODIFIED INTERVAL AND CAUSE AFTER SIGNING', () => {
    const genuine = signedWith(fields(), auditKey.privateKey);

    const intervalMoved: SignalWire = {
      ...genuine,
      intervalStart: new Date(T0.getTime() - 24 * 60 * 60 * 1000),
    };
    const intervalResult = verifyCorroborationSignal(
      intervalMoved,
      COMPANY,
      auditKey.publicKey,
      T0,
    );
    expect(intervalResult.ok).toBe(false);
    if (!intervalResult.ok) expect(intervalResult.rejection).toBe('SIGNAL_SIGNATURE_INVALID');

    const causeChanged: SignalWire = { ...genuine, reason: 'PUSH_PATH_UNREACHABLE' };
    const causeResult = verifyCorroborationSignal(causeChanged, COMPANY, auditKey.publicKey, T0);
    expect(causeResult.ok).toBe(false);
    if (!causeResult.ok) expect(causeResult.rejection).toBe('SIGNAL_SIGNATURE_INVALID');

    // And the attestation reading, which is what the signal claims to have OBSERVED.
    const readingChanged: SignalWire = { ...genuine, lastAttestationSeq: 9_999_999n };
    const readingResult = verifyCorroborationSignal(
      readingChanged,
      COMPANY,
      auditKey.publicKey,
      T0,
    );
    expect(readingResult.ok).toBe(false);
    if (!readingResult.ok) expect(readingResult.rejection).toBe('SIGNAL_SIGNATURE_INVALID');
  });

  it('7. CONTROL-SIGNED — the control plane mints its own corroboration', () => {
    // `52 §1` Path B, and `30 §5.7`'s answer: "Signed under a key held only by the audit
    // plane; the control plane holds the public key and can verify **but not mint or
    // extend**." `otherKey` stands in for a control-plane-held key.
    const forged = signedWith(fields(), otherKey.privateKey);
    const result = verifyCorroborationSignal(forged, COMPANY, auditKey.publicKey, T0);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection).toBe('SIGNAL_SIGNATURE_INVALID');
  });

  it('8. MODEL/CALLER-CREATED — a well-formed struct with no signature at all', () => {
    // The shape a caller can trivially produce: every field plausible, `signature` filled
    // with anything it likes. `30 §5.7.1`: "Structurally unavailable to the control plane: it
    // holds no private key."
    for (const bogus of [
      Buffer.alloc(64, 0),
      Buffer.alloc(64, 1),
      Buffer.from('mirrorInputStall: true'.padEnd(64, ' '), 'utf8'),
    ]) {
      const result = verifyCorroborationSignal(
        { ...fields(), signature: bogus },
        COMPANY,
        auditKey.publicKey,
        T0,
      );
      expect(result.ok).toBe(false);
    }
  });

  it('and an UNDECLARED `reason` is refused before the cryptography runs', () => {
    const result = verifyCorroborationSignal(
      signedWith(
        { ...fields(), reason: 'MIRROR_IS_FINE_TRUST_ME' as SignalWire['reason'] },
        auditKey.privateKey,
      ),
      COMPANY,
      auditKey.publicKey,
      T0,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection).toBe('SIGNAL_REASON_UNDECLARED');
  });
});

describe("`§8`'s FRESHNESS/REPLAY BOUNDARY, on genuinely signed artifacts", () => {
  const genuine = signedWith(fields(), auditKey.privateKey);

  it('just INSIDE `max_age` — accepted', () => {
    const result = verifyCorroborationSignal(
      genuine,
      COMPANY,
      auditKey.publicKey,
      new Date(T0.getTime() + signalMaxAgeMs() - 1),
    );
    expect(result.ok).toBe(true);
  });

  it('EXACTLY at the boundary — REFUSED, because `now < expires_at` is strict', () => {
    const result = verifyCorroborationSignal(
      genuine,
      COMPANY,
      auditKey.publicKey,
      new Date(T0.getTime() + signalMaxAgeMs()),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection).toBe('SIGNAL_STALE');
  });

  it('one millisecond too old — REFUSED', () => {
    const result = verifyCorroborationSignal(
      genuine,
      COMPANY,
      auditKey.publicKey,
      new Date(T0.getTime() + signalMaxAgeMs() + 1),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection).toBe('SIGNAL_STALE');
  });

  it('FUTURE-DATED — REFUSED (`S1H-C6`, an addition strictly stricter than the declared rule)', () => {
    const result = verifyCorroborationSignal(
      genuine,
      COMPANY,
      auditKey.publicKey,
      new Date(T0.getTime() - 1),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection).toBe('SIGNAL_FUTURE_DATED');
  });

  it('a signal not covering its own interval is refused', () => {
    const bad = signedWith(
      fields({ intervalStart: new Date(T0.getTime() + 60_000) }),
      auditKey.privateKey,
    );
    const result = verifyCorroborationSignal(bad, COMPANY, auditKey.publicKey, T0);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection).toBe('SIGNAL_OUTSIDE_ITS_INTERVAL');
  });

  it('DUPLICATE receipt of the same still-valid signal verifies identically', () => {
    // Verification is a pure function of the artifact and the instant, so a duplicate fetch
    // is not itself a rejection. `30 §5.7.1`'s replay protection is the CONSUMED-`signal_id`
    // record, which is durable state — `mirror-state-durability.test.ts` covers it.
    const first = verifyCorroborationSignal(genuine, COMPANY, auditKey.publicKey, T0);
    const second = verifyCorroborationSignal(genuine, COMPANY, auditKey.publicKey, T0);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
  });
});

describe('the framing helpers the oracle and production share are NOT the same code', () => {
  it("the oracle's own primitives round-trip the signal's field types", () => {
    // A sanity check on the ORACLE, so a bug in the oracle cannot silently make every
    // comparison above vacuous.
    expect(frameField(jcsText('x')).length).toBe(5);
    expect(frameField(jcsInt(42n)).length).toBe(6);
    expect(frameField(jcsTimestamp(T0)).length).toBe(4 + 27);
    expect(frameField(null).equals(Buffer.from([0xff, 0xff, 0xff, 0xff]))).toBe(true);
  });
});
