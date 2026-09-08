import type { Pool } from '../../src/db/pool.js';
import { COMPANY_ID } from '../support/fixture.js';

/**
 * TEST-ONLY. A claim that rebuilds the dispatch payload from LIVE state at claim time.
 *
 * =================================================================================
 * `§37` ITEM 4 AND `§10` OF THE S1I MANDATE. `§10` IS THE DISCRIMINATING TEST:
 *
 *   "1. Produce a valid locally authorised effect. 2. Enqueue its exact canonical dispatch
 *    payload. 3. Mutate underlying source/company/resource state. 4. Claim the outbox row.
 *    5. Inspect the payload returned by the claim.
 *    Production must return the originally authorised payload. A TEST-ONLY vulnerable
 *    implementation that reconstructs the payload at claim time must produce a different
 *    payload. **The test must discriminate.**
 *    This is a direct proof that asynchronous persistence does not change an already-
 *    authorised effect."
 *
 * `§9` names the forbidden sequence in four steps: "1. authorise refund; 2. store only
 * `effect_id`; 3. later query live order state; 4. reconstruct a possibly different refund
 * request." THIS FUNCTION IS THAT SEQUENCE.
 *
 * `33 §1` is what it violates: "Each [adapter] receives the kernel's `dispatch_payload`
 * **verbatim** and does not reinterpret intent into vendor parameters. That is where the
 * unit-price-versus-line-total class of error lives."
 * =================================================================================
 *
 * =================================================================================
 * WHY PRODUCTION IS STRUCTURALLY IMMUNE, WHICH IS WHAT MAKES THE CONTROL WORTH HAVING.
 *
 * The production claim reads `payload_canonical_bytes` off the outbox row and returns it.
 * It holds no reference to `commerce_order_line`, no reference to `commerce_parent_
 * transaction`, and no constructor. There is no live-state read in the claim path to
 * remove — which is why this control cannot be "production with a check deleted", and is
 * instead the alternative DESIGN the mandate asks to be exhibited.
 *
 * The vendor-parameter shape below is `refundCreate`'s, transcribed from
 * `src/kernel/canonicalisation/constructors/refundCreate.ts`'s `dispatchPayload` block, so
 * the reconstruction is a faithful one rather than a straw man: a real reconstructing
 * dispatcher would build exactly these five fields, and it would read `amount` from the
 * line's CURRENT refundable remaining.
 * =================================================================================
 */

export interface ReconstructedPayload {
  readonly parentTransactionId: string;
  readonly lineId: string;
  /** Read from CURRENT commerce state — the whole defect, in one field. */
  readonly amount: string;
  readonly currency: string;
  readonly instrument: string;
}

export async function unsafeReconstructPayloadAtClaim(
  control: Pool,
  input: { readonly lineId: string; readonly parentTransactionId: string },
): Promise<ReconstructedPayload> {
  const client = await control.connect();
  try {
    // "later query live order state" — `§9` step 3.
    const live = await client.query<{
      refundable_remaining: string;
      currency: string;
    }>(
      `SELECT l.refundable_remaining, o.currency
         FROM commerce_order_line l
         JOIN commerce_order o
           ON o.company_id = l.company_id AND o.order_id = l.order_id
        WHERE l.company_id = $1 AND l.line_id = $2`,
      [COMPANY_ID, input.lineId],
    );
    const row = live.rows[0];
    if (row === undefined) throw new Error(`no live line ${input.lineId}`);

    // "reconstruct a possibly different refund request" — `§9` step 4.
    return {
      parentTransactionId: input.parentTransactionId,
      lineId: input.lineId,
      amount: row.refundable_remaining,
      currency: row.currency,
      instrument: 'original',
    };
  } finally {
    client.release();
  }
}
