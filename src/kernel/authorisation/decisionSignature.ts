import { sign as signEd25519, verify as verifyEd25519, type KeyObject } from 'node:crypto';

import { canonicalBytes, canonicalHash, hex } from '../canonicalisation/canonicalBytes.js';
import type { Money } from '../exposure/money.js';

/**
 * `26 §7` step W — "PERMIT + emit signed AuthorizationDecision".
 *
 * `30 §5.3` already specifies the construction this reuses: Ed25519 over `ACOS-JCS-1`
 * canonical bytes. The accepted S1B `ConstructorVersionRecord` verifier is the precedent —
 * real `node:crypto` Ed25519 over `ACOS-JCS-1`-shaped bytes of every field except the
 * signature — and this module is that construction applied to the decision.
 *
 * ---------------------------------------------------------------------------------
 * WHY THE SIGNATURE IS INSIDE THE TRANSACTION
 *
 * The signature is not a wrapper around the row; it is a field OF the row, and the row is
 * one of the four things `33 §1` commits together. A decision signed after the commit would
 * be a committed decision with an absent signature for some interval, and `26 §11`'s
 * reproducibility claim — "same inputs, same version, same verdict, forever" — is a claim
 * about what was SIGNED. So the bytes are built and signed before the INSERT and the
 * signature travels with it.
 *
 * ---------------------------------------------------------------------------------
 * WHAT THIS IS NOT
 *
 * NO KEY MANAGEMENT. The signer is injected, exactly as `ConstructorVersionResolver` takes
 * its verifying key as a parameter. `50 §2`'s owner-signing obligation (O4) is OPEN, the
 * key is a test key at S1, and nothing here rotates, escrows, attests or hardware-protects
 * anything.
 *
 * The signer is a KERNEL-OWNED dependency and not a per-call parameter of the authority
 * pipeline, for the reason `26 §1` Corollary 3 gives: "the request must be built by the
 * ceiling's enforcer, not by its subject." A caller able to pass a signing key per call
 * could sign a decision the kernel did not reach.
 * ---------------------------------------------------------------------------------
 */

/** The fields the signature covers. Declared order; `signature` is not a member. */
export interface DecisionSigningFields {
  readonly decisionId: string;
  readonly companyId: string;
  readonly authorisationId: string;
  readonly effectId: string;
  readonly reservationId: string;
  readonly approvalId: string | null;
  readonly verdict: 'PERMIT' | 'REQUIRE_APPROVAL';
  readonly approvalRequirement: string;
  readonly actionClass: string;
  readonly resourceRef: string;
  readonly idempotencyKey: string;
  readonly dispatchPayloadHash: string;
  readonly vendorAmount: Money | null;
  readonly totalExposure: Money;
  readonly forwardIntegral: Money | null;
  readonly isRateClass: boolean;
  readonly constructorSemanticMajor: number;
  readonly constructorNonSemanticMinor: number;
  readonly policyVersion: string;
  readonly decidedAt: Date;
}

const DECISION_KIND = 'acos.authorisation_decision.v1';

/**
 * The bytes that are signed.
 *
 * Exported so a verifying fixture cannot drift from the signer — the same device
 * `constructorVersionSigningBytes` uses, and for the same reason.
 */
export function decisionSigningBytes(fields: DecisionSigningFields): Buffer {
  return canonicalBytes(DECISION_KIND, [
    { kind: 'text', value: fields.decisionId },
    { kind: 'text', value: fields.companyId },
    { kind: 'text', value: fields.authorisationId },
    { kind: 'text', value: fields.effectId },
    { kind: 'text', value: fields.reservationId },
    { kind: 'text', value: fields.approvalId },
    { kind: 'text', value: fields.verdict },
    { kind: 'text', value: fields.approvalRequirement },
    { kind: 'text', value: fields.actionClass },
    { kind: 'text', value: fields.resourceRef },
    { kind: 'text', value: fields.idempotencyKey },
    { kind: 'text', value: fields.dispatchPayloadHash },
    { kind: 'money', value: fields.vendorAmount },
    { kind: 'money', value: fields.totalExposure },
    { kind: 'money', value: fields.forwardIntegral },
    { kind: 'boolean', value: fields.isRateClass },
    { kind: 'integer', value: BigInt(fields.constructorSemanticMajor) },
    { kind: 'integer', value: BigInt(fields.constructorNonSemanticMinor) },
    { kind: 'text', value: fields.policyVersion },
    { kind: 'timestamp', value: fields.decidedAt },
  ]);
}

export function decisionSignedBytesHash(fields: DecisionSigningFields): string {
  return hex(
    canonicalHash(DECISION_KIND, [{ kind: 'bytes', value: decisionSigningBytes(fields) }]),
  );
}

export interface SignedDecision {
  readonly signature: Buffer;
  readonly signedBytesHash: string;
  readonly signingKeyId: string;
}

/** The kernel's decision signer. One implementation, injected. */
export interface DecisionSigner {
  readonly signingKeyId: string;
  sign(fields: DecisionSigningFields): SignedDecision;
}

export class Ed25519DecisionSigner implements DecisionSigner {
  readonly #privateKey: KeyObject;
  public readonly signingKeyId: string;

  public constructor(privateKey: KeyObject, signingKeyId: string) {
    if (privateKey.asymmetricKeyType !== 'ed25519') {
      // `30 §5.3` names Ed25519. A signer holding another algorithm's key would produce a
      // signature length the schema's CHECK refuses, which is a confusing way to discover
      // a configuration error.
      throw new Error(
        `the decision signer requires an ed25519 key; got ${String(privateKey.asymmetricKeyType)}`,
      );
    }
    this.#privateKey = privateKey;
    this.signingKeyId = signingKeyId;
  }

  public sign(fields: DecisionSigningFields): SignedDecision {
    const bytes = decisionSigningBytes(fields);
    return {
      // Ed25519: the algorithm argument is null, per `node:crypto`.
      signature: signEd25519(null, bytes, this.#privateKey),
      signedBytesHash: decisionSignedBytesHash(fields),
      signingKeyId: this.signingKeyId,
    };
  }
}

/** Verify a committed decision's signature against its persisted fields. */
export function verifyDecisionSignature(
  publicKey: KeyObject,
  fields: DecisionSigningFields,
  signature: Buffer,
): boolean {
  return verifyEd25519(null, decisionSigningBytes(fields), publicKey, signature);
}
