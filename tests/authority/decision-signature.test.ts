import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  Ed25519DecisionSigner,
  decisionSignedBytesHash,
  decisionSigningBytes,
  verifyDecisionSignature,
  type DecisionSigningFields,
} from '../../src/kernel/authorisation/decisionSignature.js';
import { money } from '../../src/kernel/exposure/money.js';
import { newDecisionSigner } from '../support/localAuthorisationFixture.js';

/**
 * `26 §7` step W — "PERMIT + emit signed AuthorizationDecision".
 *
 * =====================================================================================
 * WHAT THE SIGNATURE IS FOR
 *
 * `26 §11`'s reproducibility claim is "same inputs, same version, same verdict, forever",
 * and it is a claim about what was SIGNED. `26 §2.1.2` puts `constructor_version` on the
 * decision for the same reason: "`I18`'s settlement-side investigation could not determine
 * which constructor computed the exposure it was disputing."
 *
 * So the properties that matter are (a) the signature covers the ECONOMICS and the VERDICT,
 * (b) it is over `ACOS-JCS-1`-shaped bytes with a DECLARED field order, and (c) it is not
 * influenced by anything the kernel did not decide.
 *
 * =====================================================================================
 * NO KEY MANAGEMENT IS CLAIMED
 *
 * The signer takes its key as a parameter, exactly as the accepted S1B
 * `ConstructorVersionResolver` takes its verifying key. `50 §2`'s owner-signing obligation
 * (O4) is OPEN and nothing here closes it.
 * =====================================================================================
 */

/** A complete field set, hand-authored. Every assertion perturbs exactly one member. */
const FIELDS: DecisionSigningFields = Object.freeze({
  decisionId: 'decision:D-1',
  companyId: 'co_fixture',
  authorisationId: 'auth:AR-1',
  effectId: 'effect:E-1',
  reservationId: 'reservation:R-1',
  approvalId: null,
  verdict: 'PERMIT',
  approvalRequirement: 'NONE',
  actionClass: 'refund.create',
  resourceRef: 'order:ORD-1',
  idempotencyKey: 'idem:abc',
  dispatchPayloadHash: 'dph:abc',
  vendorAmount: money('9.41'),
  totalExposure: money('10.00'),
  forwardIntegral: null,
  isRateClass: false,
  constructorSemanticMajor: 1,
  constructorNonSemanticMinor: 0,
  policyVersion: 'pv:abc',
  decidedAt: new Date('2026-09-05T10:00:00.000Z'),
});

describe('the signing bytes are deterministic and field-ordered', () => {
  it('the same fields produce the same bytes, twice', () => {
    expect(decisionSigningBytes(FIELDS).toString('hex')).toBe(
      decisionSigningBytes(FIELDS).toString('hex'),
    );
  });

  it('OBJECT KEY ORDER cannot change the bytes', () => {
    // `30 §5.3`: "Fixed, declared per row kind, in the specification — never the physical
    // column order." The declaration lives in `decisionSigningBytes`, so building the
    // object differently must be invisible.
    const reordered: DecisionSigningFields = {
      decidedAt: FIELDS.decidedAt,
      policyVersion: FIELDS.policyVersion,
      constructorNonSemanticMinor: FIELDS.constructorNonSemanticMinor,
      constructorSemanticMajor: FIELDS.constructorSemanticMajor,
      isRateClass: FIELDS.isRateClass,
      forwardIntegral: FIELDS.forwardIntegral,
      totalExposure: FIELDS.totalExposure,
      vendorAmount: FIELDS.vendorAmount,
      dispatchPayloadHash: FIELDS.dispatchPayloadHash,
      idempotencyKey: FIELDS.idempotencyKey,
      resourceRef: FIELDS.resourceRef,
      actionClass: FIELDS.actionClass,
      approvalRequirement: FIELDS.approvalRequirement,
      verdict: FIELDS.verdict,
      approvalId: FIELDS.approvalId,
      reservationId: FIELDS.reservationId,
      effectId: FIELDS.effectId,
      authorisationId: FIELDS.authorisationId,
      companyId: FIELDS.companyId,
      decisionId: FIELDS.decisionId,
    };
    expect(decisionSigningBytes(reordered).toString('hex')).toBe(
      decisionSigningBytes(FIELDS).toString('hex'),
    );
  });

  it('EVERY field is covered — perturbing any one of them moves the bytes', () => {
    // Field by field, so a member accidentally dropped from the declared order shows up
    // here rather than as a signature that does not commit to the amount.
    const baseline = decisionSigningBytes(FIELDS).toString('hex');
    const perturbations: readonly Partial<DecisionSigningFields>[] = [
      { decisionId: 'decision:D-2' },
      { companyId: 'co_other' },
      { authorisationId: 'auth:AR-2' },
      { effectId: 'effect:E-2' },
      { reservationId: 'reservation:R-2' },
      { approvalId: 'approval:A-1' },
      { verdict: 'REQUIRE_APPROVAL' },
      { approvalRequirement: 'TIER_1' },
      { actionClass: 'campaign.budget.set' },
      { resourceRef: 'order:ORD-2' },
      { idempotencyKey: 'idem:def' },
      { dispatchPayloadHash: 'dph:def' },
      { vendorAmount: money('9.42') },
      { totalExposure: money('10.01') },
      { forwardIntegral: money('186.00') },
      { isRateClass: true },
      { constructorSemanticMajor: 2 },
      { constructorNonSemanticMinor: 1 },
      { policyVersion: 'pv:def' },
      { decidedAt: new Date('2026-09-05T10:00:00.001Z') },
    ];
    expect(perturbations).toHaveLength(20);
    for (const patch of perturbations) {
      const key = Object.keys(patch)[0]!;
      expect(
        decisionSigningBytes({ ...FIELDS, ...patch }).toString('hex'),
        `${key} is not covered by the signature`,
      ).not.toBe(baseline);
    }
  });

  it('THE ONE SUBSTITUTION THE WHOLE SLICE REFUSES moves the bytes', () => {
    // `total_exposure` replaced by `vendor_amount` — the shape `26 §2.1.1` forbids and the
    // shape the S1F multi-window and vendor-amount controls reproduce. A signature that did
    // not commit to the total would let a settlement dispute be answered with the wrong
    // figure.
    expect(
      decisionSigningBytes({ ...FIELDS, totalExposure: FIELDS.vendorAmount! }).toString('hex'),
    ).not.toBe(decisionSigningBytes(FIELDS).toString('hex'));
  });

  it('NULL and an empty string are distinguishable', () => {
    // `30 §5.3`: "Single `0x00` sentinel byte for null; an empty string is a zero-length
    // value", and owner clarification S1B-C8 makes that injective.
    const withNull = decisionSigningBytes({ ...FIELDS, approvalId: null }).toString('hex');
    const withEmpty = decisionSigningBytes({ ...FIELDS, approvalId: '' }).toString('hex');
    expect(withNull).not.toBe(withEmpty);
  });

  it('money is at the DECLARED SCALE, so `10.0` is not expressible', () => {
    // The `Money` type is a `bigint` of minor units, so the hazard `30 §5.3` names —
    // `25.0` versus `25.00` — cannot arise at all: there is no value that renders as
    // `10.0`. Asserted by showing the bytes contain the two-decimal form.
    const bytes = decisionSigningBytes(FIELDS).toString('utf8');
    expect(bytes).toContain('10.00');
    expect(bytes).toContain('9.41');
  });
});

describe('the signature is real Ed25519 and it verifies', () => {
  it('a signature over the fields verifies with the public key', () => {
    const keys = newDecisionSigner('key:test-1');
    const signed = keys.signer.sign(FIELDS);
    expect(signed.signature).toHaveLength(64);
    expect(signed.signingKeyId).toBe('key:test-1');
    expect(signed.signedBytesHash).toBe(decisionSignedBytesHash(FIELDS));
    expect(verifyDecisionSignature(keys.publicKey, FIELDS, signed.signature)).toBe(true);
  });

  it('AND IT DISCRIMINATES — a changed amount, a changed verdict and a wrong key all fail', () => {
    const keys = newDecisionSigner();
    const other = newDecisionSigner();
    const signed = keys.signer.sign(FIELDS);
    expect(
      verifyDecisionSignature(keys.publicKey, { ...FIELDS, totalExposure: money('10.01') }, signed.signature),
    ).toBe(false);
    expect(
      verifyDecisionSignature(
        keys.publicKey,
        { ...FIELDS, verdict: 'REQUIRE_APPROVAL' },
        signed.signature,
      ),
    ).toBe(false);
    expect(verifyDecisionSignature(other.publicKey, FIELDS, signed.signature)).toBe(false);
  });

  it('a signer holding a non-Ed25519 key is REFUSED at construction', async () => {
    // `30 §5.3` names Ed25519. A signer holding another algorithm's key would produce a
    // signature length the schema's CHECK refuses, which is a confusing way to discover a
    // configuration error.
    const { generateKeyPairSync } = await import('node:crypto');
    const { privateKey } = generateKeyPairSync('ed448');
    expect(() => new Ed25519DecisionSigner(privateKey, 'key:wrong')).toThrow('ed25519');
  });
});

describe('nothing the kernel did not decide can reach the signature', () => {
  it('there is no clock read, no random source and no rationale in the signing module', () => {
    const source = readFileSync(
      join(process.cwd(), 'src', 'kernel', 'authorisation', 'decisionSignature.ts'),
      'utf8',
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    for (const forbidden of [
      'Date.now',
      'new Date',
      'randomUUID',
      'randomBytes',
      'Math.random',
      'rationale',
      'JSON.stringify',
      'journal_seq',
      'journalSeq',
    ]) {
      expect(code, `decisionSignature.ts reads ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('and the signing key is a KERNEL dependency, not a per-call parameter', () => {
    // `26 §1` Corollary 3: "the request must be built by the ceiling's enforcer, not by its
    // subject." A caller able to pass a signing key per call could sign a decision the
    // kernel never reached.
    const source = readFileSync(
      join(process.cwd(), 'src', 'kernel', 'authorisation', 'decisionSignature.ts'),
      'utf8',
    );
    // `sign` takes the fields and nothing else.
    expect(source).toMatch(/sign\(fields: DecisionSigningFields\): SignedDecision/);
    // And the S1F transaction takes a `DecisionSigner`, never a key.
    const local = readFileSync(
      join(process.cwd(), 'src', 'kernel', 'authorisation', 'localAuthorisation.ts'),
      'utf8',
    );
    expect(local).toContain('readonly signer: DecisionSigner');
    expect(local).not.toContain('privateKey');
    expect(local).not.toContain('KeyObject');
  });
});
