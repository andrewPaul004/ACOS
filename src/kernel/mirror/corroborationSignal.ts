import { verify as verifyEd25519, type KeyObject } from 'node:crypto';

import { canonicalBytes, type CanonicalStructure } from '../canonicalisation/canonicalBytes.js';
import {
  CORROBORATION_REASONS,
  SIGNAL_MAX_AGE_MS,
  isCorroborationFresh,
  type CorroborationReason,
  type HeldCorroboration,
} from './mirrorState.js';

/**
 * `30 §5.7.1` — THE `MirrorInputStallSignal` CONTRACT, CONTROL SIDE.
 *
 * =================================================================================
 * `30 §5.7.1`, VERBATIM, BECAUSE THIS IS THE ARTIFACT THAT UNLOCKS THE ONLY DISPATCH
 * RELAXATION IN THE ARCHITECTURE
 *
 *     MirrorInputStallSignal {
 *       signal_id          UUID              -- unique per issuance; never reused
 *       company_id
 *       observed_at        timestamptz       -- audit-plane clock, RFC 3339 UTC, 6 digits
 *       interval_start     timestamptz       -- start of the stall interval this covers
 *       last_attestation_seq        BIGINT   -- the newest max_journal_seq received
 *       last_attestation_received_at timestamptz
 *       reason             enum { ATTESTATION_STALL, PUSH_PATH_UNREACHABLE,
 *                                 STORE_WRITE_REJECTED }
 *       expires_at         timestamptz       -- observed_at + max_age
 *       audit_instance_id                    -- which audit-plane instance issued it
 *       signature          bytea             -- Ed25519 over ACOS-JCS-1 canonical bytes
 *     }
 *
 *   | **Signer** | The audit plane, under an Ed25519 key generated on and never leaving the
 *   |            | audit-plane host. The control plane holds **only the public key**,
 *   |            | distributed as control artifact class 24 (`50 §2`) and hashed into the
 *   |            | owner-signed manifest, so a substituted public key is an `I19` mismatch.
 *   | **`max_age`** | **5 minutes** = `attestation_cadence × 1`, `CONFIGURED`.
 *   | **Freshness rule** | `now() − signal.observed_at ≤ max_age` **and**
 *   |            | `now() < signal.expires_at`, evaluated on the **control database clock**.
 *   |            | A signal failing either test **cannot enter the state machine**.
 *   | **Replay protection** | `signal_id` is recorded in the journal on consumption; a
 *   |            | `signal_id` already consumed cannot re-enter the state machine.
 *   | **Minting and extension** | Structurally unavailable to the control plane: it holds
 *   |            | no private key. Extending a signal's life by rewriting `expires_at`
 *   |            | breaks the signature. Extending it by holding it is bounded by
 *   |            | `max_age`, **evaluated at every state evaluation and not only at entry**.
 * =================================================================================
 *
 * ---------------------------------------------------------------------------------
 * THE VERIFIER BUILDS THE BYTES. IT NEVER RECEIVES THEM.
 *
 * The audit store retains `signed_bytes` and its own trigger refuses a row whose
 * `signed_bytes` are not that store's `ACOS-JCS-1` canonicalisation of the structured
 * fields (`A0002`). This module NEVER READS THAT COLUMN. It builds the bytes from the
 * structured fields with the accepted `ACOS-JCS-1` TypeScript implementation and verifies
 * the signature over ITS OWN construction.
 *
 * The reason is `30 §5.9`'s reason, one level over: a signature checked against bytes the
 * signer chose is a signature over the signer's own assertion, and it would let an audit
 * plane — or anyone able to answer the fetch — sign a byte string that does not mean what
 * the fields say. It also makes the two canonicalisers cross-implemented on every single
 * fetch, which is `VC-A3`'s discipline applied to this artifact.
 *
 * There is therefore no `signedBytes` field on `SignalWire`, and
 * `corroboration-signal-contract.test.ts` asserts that as a type-level property.
 * ---------------------------------------------------------------------------------
 *
 * ---------------------------------------------------------------------------------
 * NO KEY MANAGEMENT. The verifying key is a PARAMETER, exactly as it is for
 * `ConstructorVersionResolver` (S1B) and `decisionSignature.ts` (S1F). `50 §2` class 24
 * puts the public key in the owner-signed manifest and `I19`'s runtime hash check is
 * OPEN — `S1H-result.md §16` carries the class-20/class-24 owner-signature residual
 * forward unchanged, and NOTHING HERE CLAIMS IT.
 * ---------------------------------------------------------------------------------
 */

/** `30 §5.7.1`'s domain tag for the signed artifact. `A0002` transcribes the same tag. */
export const SIGNAL_CANONICAL_KIND = 'acos.mirror_input_stall_signal.v1';

/**
 * The signal as it arrives over the fetch path — the ten declared fields, no more.
 *
 * `signature` is present because it is a member of `§5.7.1`'s struct. It is NOT a member of
 * the signed field order, for the same reason `row_hash` is not a member of a journal row's
 * canonical bytes: `§5.7.1` says the signature is "over `ACOS-JCS-1` canonical bytes OF THE
 * FIELDS ABOVE".
 */
export interface SignalWire {
  readonly signalId: string;
  readonly companyId: string;
  readonly observedAt: Date;
  readonly intervalStart: Date;
  readonly lastAttestationSeq: bigint;
  /**
   * `null` means exactly one thing: NO attestation has ever been received from this company.
   * It is not paired with `lastAttestationSeq === 0`, because an attestation over an empty
   * journal legitimately reports `max_journal_seq = 0` with a real arrival instant —
   * `30 §5.4`'s "the empty attestation is the entire point". `S1H-owner-clarifications.md
   * S1H-C5`.
   */
  readonly lastAttestationReceivedAt: Date | null;
  readonly reason: CorroborationReason;
  readonly expiresAt: Date;
  readonly auditInstanceId: string;
  readonly signature: Buffer;
}

/**
 * The DECLARED FIELD ORDER of the signed artifact, and a second implementation of
 * `A0002`'s `audit_mirror_signal_canonical_bytes`.
 *
 * The order is the order `30 §5.7.1` prints the struct in. `A0002` transcribes the same
 * order independently on the audit server; neither reads the other, and
 * `corroboration-signal-cross-implementation.test.ts` judges both against a hand-authored
 * third reading in `tests/support/jcs1Oracle.ts`.
 */
export function signalCanonicalFields(signal: SignalWire): CanonicalStructure {
  return [
    { kind: 'text', value: signal.signalId },
    { kind: 'text', value: signal.companyId },
    { kind: 'timestamp', value: signal.observedAt },
    { kind: 'timestamp', value: signal.intervalStart },
    { kind: 'integer', value: signal.lastAttestationSeq },
    { kind: 'timestamp', value: signal.lastAttestationReceivedAt },
    { kind: 'text', value: signal.reason },
    { kind: 'timestamp', value: signal.expiresAt },
    { kind: 'text', value: signal.auditInstanceId },
  ];
}

/** `ACOS-JCS-1` bytes of the signed field set. This is what Ed25519 covers. */
export function signalSigningBytes(signal: SignalWire): Buffer {
  return canonicalBytes(SIGNAL_CANONICAL_KIND, signalCanonicalFields(signal));
}

/**
 * Every way a fetched signal can fail to enter the state machine.
 *
 * CLOSED, and every member is a REFUSAL. There is no `ACCEPTED_WITH_WARNING`: `30 §5.7.1`
 * says a signal failing a test "**cannot enter the state machine**", so the verifier returns
 * either a `HeldCorroboration` or a reason, and the caller has no third branch to take.
 */
export const SIGNAL_REJECTIONS = [
  /** No signature bytes at all, or not 64 bytes. `§7` case 1 and case 2. */
  'SIGNAL_UNSIGNED',
  /** Ed25519 verification failed: forged, tampered, or signed by the wrong key. */
  'SIGNAL_SIGNATURE_INVALID',
  /** `company_id` is not the company whose state is being resolved. */
  'SIGNAL_WRONG_COMPANY',
  /** `now() − observed_at > max_age`, or `now() >= expires_at`. */
  'SIGNAL_STALE',
  /** `observed_at` is in the future on the control database clock. `S1H-C6`. */
  'SIGNAL_FUTURE_DATED',
  /** `expires_at <> observed_at + max_age`, so the artifact is not `§5.7.1`'s shape. */
  'SIGNAL_EXPIRY_NOT_MAX_AGE',
  /** `reason` is outside `§5.7.1`'s closed enum. */
  'SIGNAL_REASON_UNDECLARED',
  /** `observed_at < interval_start`: the signal does not cover its own interval. */
  'SIGNAL_OUTSIDE_ITS_INTERVAL',
  /** `§5.7.1` replay protection: this `signal_id` has already been consumed. */
  'SIGNAL_REPLAYED',
] as const;

export type SignalRejection = (typeof SIGNAL_REJECTIONS)[number];

export type SignalVerification =
  | { readonly ok: true; readonly held: HeldCorroboration }
  | { readonly ok: false; readonly rejection: SignalRejection; readonly detail: string };

/**
 * Verify a fetched signal against `30 §5.7.1`'s whole contract.
 *
 * ORDER OF CHECKS. Shape first, then cryptography, then freshness. The cryptographic check
 * comes BEFORE the freshness check so a tampered timestamp is reported as a signature
 * failure rather than as staleness — `§7` case 5 of the S1H mandate is "modified timestamp
 * after signing", and a verifier that tested freshness first would report the wrong cause
 * for it and would leave the tamper undetected on a signal that happened to be fresh.
 *
 * THE REPLAY CHECK IS NOT HERE. It is a uniqueness constraint on `mirror_corroboration`
 * and a lookup in the consuming transaction (`mirrorStateMachine.ts`), because "already
 * consumed" is durable state and not a property of the artifact. A pure function that
 * claimed to check it would be a pure function with a hidden database.
 */
export function verifyCorroborationSignal(
  signal: SignalWire,
  expectedCompanyId: string,
  auditPublicKey: KeyObject,
  now: Date,
): SignalVerification {
  // ---- shape -------------------------------------------------------------------
  if (signal.signature.length !== 64) {
    return {
      ok: false,
      rejection: 'SIGNAL_UNSIGNED',
      detail:
        `the signature is ${String(signal.signature.length)} bytes; 30 §5.7.1 declares ` +
        'Ed25519, which is 64',
    };
  }
  if (!(CORROBORATION_REASONS as readonly string[]).includes(signal.reason)) {
    return {
      ok: false,
      rejection: 'SIGNAL_REASON_UNDECLARED',
      detail: `reason ${String(signal.reason)} is outside 30 §5.7.1's closed enum`,
    };
  }
  if (signal.expiresAt.getTime() !== signal.observedAt.getTime() + SIGNAL_MAX_AGE_MS) {
    return {
      ok: false,
      rejection: 'SIGNAL_EXPIRY_NOT_MAX_AGE',
      detail:
        "30 §5.7.1: `expires_at` is `observed_at + max_age`; this artifact's two " +
        'timestamps do not stand in that relation, so it is not the declared shape',
    };
  }
  if (signal.observedAt.getTime() < signal.intervalStart.getTime()) {
    return {
      ok: false,
      rejection: 'SIGNAL_OUTSIDE_ITS_INTERVAL',
      detail: 'observed_at precedes the interval_start the signal claims to cover',
    };
  }
  // ---- cryptography ------------------------------------------------------------
  //
  // Real Ed25519 over bytes THIS SIDE BUILT. `30 §5.7.1`: "Signed under a key held only by
  // the audit plane; the control plane holds the public key and can verify but not mint or
  // extend." A boolean stand-in here would make the load-bearing artifact of the whole
  // mechanism a caller's claim.
  let signatureValid: boolean;
  try {
    signatureValid = verifyEd25519(
      null,
      signalSigningBytes(signal),
      auditPublicKey,
      signal.signature,
    );
  } catch {
    // A malformed key or a malformed signature. The only safe reading of "we could not
    // verify this" is "this is not verified" — the same rule `principal.ts` applies to a
    // delegation hop.
    signatureValid = false;
  }
  if (!signatureValid) {
    return {
      ok: false,
      rejection: 'SIGNAL_SIGNATURE_INVALID',
      detail:
        'Ed25519 verification failed over the control plane’s own ACOS-JCS-1 ' +
        'construction of the declared field set (30 §5.7.1)',
    };
  }

  // ---- company scope ----------------------------------------------------------
  //
  // AFTER the signature, because a genuine signal for another company is a different fact
  // from a forged one and the incident detail should say which. `§5.7.1`: the signal is
  // company-scoped and the endpoint takes `company_id` as a parameter.
  if (signal.companyId !== expectedCompanyId) {
    return {
      ok: false,
      rejection: 'SIGNAL_WRONG_COMPANY',
      detail:
        `the signal is scoped to ${signal.companyId} and the state being resolved is ` +
        `${expectedCompanyId}`,
    };
  }

  // ---- freshness --------------------------------------------------------------
  const held: HeldCorroboration = {
    signalId: signal.signalId,
    companyId: signal.companyId,
    observedAt: signal.observedAt,
    expiresAt: signal.expiresAt,
    intervalStart: signal.intervalStart,
    reason: signal.reason,
  };
  if (now.getTime() < signal.observedAt.getTime()) {
    return {
      ok: false,
      rejection: 'SIGNAL_FUTURE_DATED',
      detail:
        'observed_at is in the future on the control database clock, so the signal has no ' +
        'age to test (S1H-C6, an addition to 30 §5.7.1 and strictly stricter than it)',
    };
  }
  if (!isCorroborationFresh(held, now)) {
    return {
      ok: false,
      rejection: 'SIGNAL_STALE',
      detail:
        `age ${String(now.getTime() - signal.observedAt.getTime())}ms against a declared ` +
        `max_age of ${String(SIGNAL_MAX_AGE_MS)}ms, or now >= expires_at (30 §5.7.1)`,
    };
  }

  return { ok: true, held };
}
