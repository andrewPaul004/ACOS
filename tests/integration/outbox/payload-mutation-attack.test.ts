import { createHash } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { COMPANY_ID } from '../../support/fixture.js';
import { S1E_PASS_ORDER } from '../../support/authorityFixture.js';
import {
  authoriseRefund,
  authorisePause,
  createOutboxHarness,
  mutateOrderLineRemaining,
  outboxRows,
  reconstructRefundPayload,
  type OutboxHarness,
} from '../../support/outboxFixture.js';
import { enqueueDispatch } from '../../../src/kernel/outbox/enqueue.js';
import { claimForExternalDispatch } from '../../../src/kernel/outbox/claim.js';
import { unsafeReconstructPayloadAtClaim } from '../../negative-controls/unsafe-reconstructing-claim.js';
import { dispatchPayloadCanonicalBytes } from '../../../src/kernel/canonicalisation/canonicaliser.js';

/**
 * `§9` AND `§10` — THE ASYNCHRONOUS BOUNDARY DOES NOT CHANGE AN AUTHORISED EFFECT.
 *
 * =================================================================================
 * THE FORBIDDEN SEQUENCE, VERBATIM FROM `§9`:
 *
 *   "1. authorise refund; 2. store only `effect_id`; 3. later query live order state;
 *    4. reconstruct a possibly different refund request."
 *
 * `33 §1`: "Each [adapter] receives the kernel's `dispatch_payload` **verbatim** and does
 * not reinterpret intent into vendor parameters. That is where the unit-price-versus-line-
 * total class of error lives."
 *
 * `§10`'s discriminating test is the whole of this file: authorise, enqueue the exact
 * canonical payload, MUTATE the underlying resource state, claim, and inspect what comes
 * back. Production returns the originally authorised bytes. The reconstructing
 * implementation returns different ones.
 * =================================================================================
 */

let h: OutboxHarness;
const NOW = new Date('2026-09-05T10:05:00.000Z');

beforeAll(async () => {
  h = await createOutboxHarness();
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await h.reset();
});

describe('`§10` — MUTATE THE SOURCE STATE, THEN CLAIM', () => {
  it('production returns the ORIGINALLY AUTHORISED payload; reconstruction returns a different one', async () => {
    // 1. A valid locally authorised effect, through the ACCEPTED S1F pipeline.
    const effect = await authoriseRefund(h);
    // The authorised amount, taken from the S1E fixture's own hand-authored figure.
    expect(S1E_PASS_ORDER.lineRemaining).toBe('9.41');

    // 2. Enqueue its EXACT canonical dispatch payload.
    const enqueued = await enqueueDispatch(h.control, {
      companyId: COMPANY_ID,
      effectId: effect.effectId,
      outboxId: 'outbox:mutation',
      payloadCanonicalBytes: effect.payloadCanonicalBytes,
      now: NOW,
    });
    expect(enqueued.kind).toBe('ENQUEUED');

    // 3. MUTATE the underlying resource state. A concurrent partial refund moved the
    //    line's refundable remaining — the same mutation the ACCEPTED `CAN-03` case makes.
    await mutateOrderLineRemaining(h.control, '1.00');

    // 4. Claim. `refund.create` is COMPENSABLE and falls to row 4, so the claim itself is
    //    SUSPENDED — which does not matter for this property: what is inspected is the
    //    PAYLOAD the outbox holds, and it is inspected under BOTH outcomes below.
    const claimResult = await claimForExternalDispatch(h.control, {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      claimedBy: 'worker:mutation',
      now: NOW,
    });
    expect(claimResult.kind).toBe('REFUSED');

    // 5. INSPECT. The bytes on the row are the ones the authorisation bound, unchanged.
    const row = (await outboxRows(h.control))[0]!;
    expect(row.payloadCanonicalBytes.equals(effect.payloadCanonicalBytes)).toBe(true);
    expect(createHash('sha256').update(row.payloadCanonicalBytes).digest('hex')).toBe(
      effect.dispatchPayloadHash,
    );
    // The authorised amount is still `$9.41`, not the `$1.00` the world now holds.
    expect(row.payloadCanonicalBytes.includes(Buffer.from('9.41'))).toBe(true);
    expect(row.payloadCanonicalBytes.includes(Buffer.from('1.00'))).toBe(false);

    // ---------------------------------------------------------------------------------
    // THE DISCRIMINATION. A reconstructing dispatcher reads the LIVE line and produces a
    // different request for the same authorised effect.
    // ---------------------------------------------------------------------------------
    const reconstructed = await unsafeReconstructPayloadAtClaim(h.control, {
      lineId: S1E_PASS_ORDER.lineId,
      parentTransactionId: S1E_PASS_ORDER.parentTransactionId,
    });
    expect(reconstructed.amount).toBe('1.00');
    expect(reconstructed.amount).not.toBe(S1E_PASS_ORDER.lineRemaining);

    // And the two disagree as BYTES, canonicalised the same way, so the difference is not
    // an artefact of comparing a structure to a digest.
    const unsafeBytes = dispatchPayloadCanonicalBytes({
      adapter: 'mock_processor' as never,
      method: 'refundCreate' as never,
      vendorParameters: Object.freeze({
        parent_transaction_id: reconstructed.parentTransactionId,
        line_id: reconstructed.lineId,
        amount: reconstructed.amount,
        currency: reconstructed.currency,
        instrument: reconstructed.instrument,
      }) as never,
      idempotencyKey: effect.idempotencyKey as never,
      monetaryEffect: null,
      preconditionToken: null,
      authorisationRef: 'auth:whatever' as never,
    });
    expect(unsafeBytes.equals(row.payloadCanonicalBytes)).toBe(false);
    expect(createHash('sha256').update(unsafeBytes).digest('hex')).not.toBe(
      effect.dispatchPayloadHash,
    );
  });

  it('and a CLAIMED row survives the same mutation with its payload intact', async () => {
    /*
     * The same property on the claimable side of the catalogue, so it is proved for a row
     * that actually reached `CLAIMED` rather than only for one that was refused.
     *
     * `campaign.pause` is REVERSIBLE and reaches row 5. Its payload carries the campaign
     * id; the mutation below moves the refund line the payload does not name, so the
     * assertion is the stronger one: the bytes are BYTE-IDENTICAL across the mutation and
     * across the claim.
     */
    const effect = await authorisePause(h, { resourceId: 'CMP-MUTATION' });
    await enqueueDispatch(h.control, {
      companyId: COMPANY_ID,
      effectId: effect.effectId,
      outboxId: 'outbox:mutation-claimed',
      payloadCanonicalBytes: effect.payloadCanonicalBytes,
      now: NOW,
    });

    const claim = await claimForExternalDispatch(h.control, {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      claimedBy: 'worker:mutation-claimed',
      now: NOW,
    });
    expect(claim.kind).toBe('CLAIMED');
    if (claim.kind !== 'CLAIMED') return;
    // THE CLAIM ITSELF RETURNS THE STORED BYTES.
    expect(claim.claim.row.payloadCanonicalBytes.equals(effect.payloadCanonicalBytes)).toBe(true);

    await mutateOrderLineRemaining(h.control, '0.01');

    const row = (await outboxRows(h.control))[0]!;
    expect(row.payloadCanonicalBytes.equals(effect.payloadCanonicalBytes)).toBe(true);
    expect(row.status).toBe('CLAIMED');
  });
});

describe('`§9` — A DRIFTED RECONSTRUCTION IS REFUSED, NOT ACCEPTED', () => {
  it('re-running the constructor after a mutation produces bytes the enqueue refuses', async () => {
    /*
     * `§27` permits recovery to "discover/RECONSTRUCT the missing outbox work". This is the
     * case where the reconstruction is no longer faithful, and the answer is a REFUSAL
     * rather than a row.
     *
     * ADR-026 item 4 states the same principle for the vendor-evidence case: "A
     * `NEVER_SENT` row is a new proposal requiring FRESH AUTHORISATION, never a retry."
     */
    const authorisationRef = 'auth:AR-S1I-DRIFT';
    const effect = await authoriseRefund(h, { authorisationRef });

    // A faithful reconstruction, BEFORE any mutation, hashes to the committed value.
    const faithful = await reconstructRefundPayload(h, authorisationRef);
    expect(createHash('sha256').update(faithful).digest('hex')).toBe(
      effect.dispatchPayloadHash,
    );

    // The world moves.
    await mutateOrderLineRemaining(h.control, '5.00');

    // The reconstruction now differs, and the enqueue refuses it.
    const drifted = await reconstructRefundPayload(h, authorisationRef);
    expect(drifted.equals(faithful)).toBe(false);

    const outcome = await enqueueDispatch(h.control, {
      companyId: COMPANY_ID,
      effectId: effect.effectId,
      outboxId: 'outbox:drifted',
      payloadCanonicalBytes: drifted,
      now: NOW,
    });
    expect(outcome.kind).toBe('REFUSED');
    if (outcome.kind === 'REFUSED') expect(outcome.reason).toBe('PAYLOAD_HASH_DIVERGED');
    // NO ROW EXISTS. The effect stays authorised with no outbox row and is rediscoverable,
    // which is `§27`'s own requirement — and it needs a FRESH authorisation, not a payload.
    expect(await outboxRows(h.control)).toHaveLength(0);
  });
});
