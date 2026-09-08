import type { Pool } from '../../src/db/pool.js';

/**
 * TEST-ONLY. A claim that trusts the eligibility recorded at ENQUEUE time.
 *
 * =================================================================================
 * `§37` ITEM 6 AND `§14` OF THE S1I MANDATE:
 *
 *   "1. Effect/outbox becomes eligible while mirror state is NORMAL. 2. Outbox waits.
 *    3. Control enters a state where the effect must HALT/SUSPEND. 4. Claim attempt occurs.
 *    Unsafe implementation trusts `eligible_at_enqueue = true`. It claims. Production
 *    re-evaluates current state and refuses. **Must discriminate.**"
 *
 * THE DEFECT IS THE PARAMETER. Production's claim service has no `eligibleAtEnqueue`
 * argument and the `dispatch_outbox` table has no eligibility column for one to have been
 * written into — `0010` adds none, deliberately — so the shape this function models is not
 * reachable in production at all. That is the strongest form the property can take: the
 * unsafe path is not a production code path with a check removed, it is a production code
 * path that could not be written.
 *
 * WHAT IS THE SAME: real PostgreSQL, the real `dispatch_outbox` row as the subject of the
 * read, the same instant, the same identity.
 *
 * WHAT IS DIFFERENT: exactly one thing. Production calls
 * `mirrorDispatchOperandsOn` + `activeOverrideOn` + `classifyDispatchPrecedence` inside the
 * claim transaction; this reads a boolean the caller carried from the past.
 *
 * IT WRITES TO ITS OWN LEDGER, never to `dispatch_outbox`, for the reason
 * `unsafe-select-then-update-claim.ts` records: `0010`'s state-machine trigger would refuse
 * the write and the control would then be proving that the trigger works rather than that
 * a stale-eligibility claim mechanism claims. A test can therefore run this control and
 * then assert production's row is still `ENQUEUED`.
 * =================================================================================
 */

export async function unsafeStaleEligibilityClaim(
  control: Pool,
  input: {
    readonly companyId: string;
    readonly idempotencyKey: string;
    /** The value recorded when the row was enqueued. Production has no such field. */
    readonly eligibleAtEnqueue: boolean;
    readonly claimedBy: string;
    readonly now: Date;
  },
): Promise<'CLAIMED' | 'REFUSED' | 'NOT_FOUND'> {
  const client = await control.connect();
  try {
    await client.query(
      `CREATE TABLE IF NOT EXISTS unsafe_stale_claim_ledger (
         company_id      TEXT,
         idempotency_key TEXT,
         claimed_by      TEXT,
         claimed_at      TIMESTAMPTZ
       )`,
    );

    const read = await client.query<{ status: string }>(
      `SELECT status FROM dispatch_outbox
        WHERE company_id = $1 AND idempotency_key = $2`,
      [input.companyId, input.idempotencyKey],
    );
    if (read.rows[0] === undefined) return 'NOT_FOUND';
    if (read.rows[0].status !== 'ENQUEUED') return 'REFUSED';

    // THE WHOLE DEFECT. No mirror read, no override read, no classifier, no current state.
    if (!input.eligibleAtEnqueue) return 'REFUSED';

    await client.query(
      `INSERT INTO unsafe_stale_claim_ledger
         (company_id, idempotency_key, claimed_by, claimed_at)
       VALUES ($1, $2, $3, $4)`,
      [input.companyId, input.idempotencyKey, input.claimedBy, input.now],
    );
    return 'CLAIMED';
  } finally {
    client.release();
  }
}
