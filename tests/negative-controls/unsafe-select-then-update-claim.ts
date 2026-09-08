import type { Client, Pool } from '../../src/db/pool.js';

/**
 * TEST-ONLY. A claim implemented as `SELECT` then `UPDATE`, with no exclusion.
 *
 * =================================================================================
 * `§37` ITEM 2 AND `§38` OF THE S1I MANDATE. `§38` IS MANDATORY AND ITS WORDING IS EXACT:
 *
 *   "Unsafe implementation: 1. SELECT READY row; 2. barrier; 3. both workers see READY;
 *    4. both mark/return a claim without a correct exclusive DB mechanism. Under targeted
 *    interleaving: unsafe returns two claims. Production: exactly one. **If your unsafe
 *    implementation also returns one because the test accidentally serializes, the test is
 *    invalid.**"
 *
 * SO THIS FUNCTION MUST GENUINELY RETURN TWO CLAIMS, and every line below exists to make
 * sure it does rather than to make the point rhetorically.
 * =================================================================================
 *
 * =================================================================================
 * WHAT IS REMOVED, RELATIVE TO PRODUCTION, AND NOTHING ELSE IS.
 *
 *   1. `FOR UPDATE` on the read. Production takes the row lock, which is what makes the
 *      second transaction BLOCK until the first commits and then re-read the row it left.
 *      This reads the row without a lock, so both transactions proceed on the same value.
 *
 *   2. `AND status = 'ENQUEUED'` on the write. Production's `UPDATE` re-asserts the
 *      predicate, so even without the lock the second writer would match zero rows.
 *
 * EVERYTHING ELSE IS THE SAME: real PostgreSQL, the real `dispatch_outbox` row as the
 * subject of the read, real `READ COMMITTED`, two real backends, the same accepted barrier
 * harness. The difference in outcome is therefore attributable to the two removals and to
 * nothing about the harness — `36 §0`'s requirement that a control isolate the mechanism.
 *
 * ---------------------------------------------------------------------------------
 * WHY THE UNSAFE PATH WRITES TO ITS OWN TABLE.
 *
 * `0010`'s `dispatch_outbox_state_machine` trigger refuses ANY update to a row whose OLD
 * status is `CLAIMED`, so a second `UPDATE` against the production table would ABORT — and
 * the defect would appear as a database error rather than as the duplicate claim it is.
 * That would make the control prove the trigger works, which `outbox-immutability.test.ts`
 * already proves directly, instead of proving what `§38` asks: that a claim mechanism
 * without database exclusion issues two claims.
 *
 * So the writes go to `unsafe_claim_ledger`, an unconstrained table with no primary key, no
 * status CHECK and no trigger — which is how such code is normally written when the
 * database is not the thing enforcing at-most-once. Production's exclusivity is a property
 * of `0010` PLUS the row lock, and this control shows both are load-bearing.
 *
 * THE PRODUCTION ROW IS NEVER WRITTEN BY THIS FILE, so a test can run the control and then
 * assert that `dispatch_outbox` is still `ENQUEUED`.
 * ---------------------------------------------------------------------------------
 * =================================================================================
 */

/**
 * Create the unconstrained ledger. CALLED IN ITS OWN TRANSACTION, BEFORE THE RACE.
 *
 * `CREATE TABLE IF NOT EXISTS` takes an `ACCESS EXCLUSIVE` lock and holds it to commit, so
 * issuing it inside the two racing transactions would make the second one block on the
 * first — which is a lock the test author did not intend, and it would serialise the
 * interleaving that `§38` requires to be genuinely concurrent. Setting the table up first
 * is what keeps the race a race.
 */
export async function ensureUnsafeClaimLedger(control: Pool): Promise<void> {
  const client = await control.connect();
  try {
    await client.query(
      `CREATE TABLE IF NOT EXISTS unsafe_claim_ledger (
         company_id      TEXT,
         idempotency_key TEXT,
         claim_id        TEXT,
         claimed_by      TEXT,
         claimed_at      TIMESTAMPTZ
       )`,
    );
    await client.query('TRUNCATE unsafe_claim_ledger');
  } finally {
    client.release();
  }
}

export async function unsafeSelectThenUpdateClaim(
  client: Client,
  input: {
    readonly companyId: string;
    readonly idempotencyKey: string;
    readonly claimedBy: string;
    readonly now: Date;
    readonly afterRead: () => Promise<void>;
  },
): Promise<'CLAIMED' | 'ALREADY_CLAIMED' | 'NOT_FOUND'> {
  // 1. SELECT the row. NO `FOR UPDATE`.
  const read = await client.query<{ status: string; outbox_id: string }>(
    `SELECT status, outbox_id FROM dispatch_outbox
      WHERE company_id = $1 AND idempotency_key = $2`,
    [input.companyId, input.idempotencyKey],
  );
  const row = read.rows[0];
  if (row === undefined) return 'NOT_FOUND';

  // 2. The barrier. Both workers are here before either writes.
  await input.afterRead();

  // 3. Both saw `ENQUEUED`, so both proceed.
  if (row.status !== 'ENQUEUED') return 'ALREADY_CLAIMED';

  // 4. Mark and return a claim, with nothing excluding the other writer.
  await client.query(
    `INSERT INTO unsafe_claim_ledger
       (company_id, idempotency_key, claim_id, claimed_by, claimed_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      input.companyId,
      input.idempotencyKey,
      `unsafe-claim:${input.claimedBy}`,
      input.claimedBy,
      input.now,
    ],
  );
  return 'CLAIMED';
}

/** How many claims the unconstrained ledger holds for one identity. */
export async function unsafeClaimCount(
  control: Pool,
  companyId: string,
  idempotencyKey: string,
): Promise<number> {
  const client = await control.connect();
  try {
    const result = await client.query<{ n: string }>(
      `SELECT count(*)::TEXT AS n FROM unsafe_claim_ledger
        WHERE company_id = $1 AND idempotency_key = $2`,
      [companyId, idempotencyKey],
    );
    return Number(result.rows[0]!.n);
  } finally {
    client.release();
  }
}
