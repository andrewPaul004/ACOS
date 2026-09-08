import type { Pool } from '../../src/db/pool.js';

/**
 * TEST-ONLY. A conventional job-queue visibility timeout, applied to an outbox claim.
 *
 * =================================================================================
 * `§39` OF THE S1I MANDATE, and it is mandatory:
 *
 *   "Unsafe job-queue-style implementation: `CLAIMED for > N minutes → READY`. Then:
 *    1. claim; 2. simulate crash; 3. advance clock; 4. unsafe path reclaims.
 *    Production: does NOT. This test establishes that ACOS claims are not ordinary
 *    retryable queue leases."
 *
 * THIS IS THE SINGLE MOST IMPORTANT CONTROL IN THE SLICE, because the design it models is
 * the DEFAULT. Every message queue, every job runner and every outbox library published in
 * the last twenty years returns a claimed item to the ready set after a visibility timeout,
 * and doing so is CORRECT for work that is safe to repeat. `25 §7` makes ACOS's claim the
 * opposite kind of object:
 *
 *   "a `CLAIMED` row is never re-dispatched by any path — including recovery, including a
 *    fork, including a manual replay."
 *
 * `35 §4` says what the trade actually is: on recovery the row "is `CLAIMED` and **is never
 * re-dispatched by any path** (I36). It is marked `PRESUMED_EXECUTED`, the irrecoverable
 * unit is consumed, and the provider's delivery event [...] resolves it." ADR-026's
 * consequence, verbatim: "A missed message is now possible and is detected rather than
 * prevented — the correct trade."
 *
 * So a reaper is not a missing feature. It is the defect, and this file exists so that a
 * future contributor who adds one finds a test that already says why.
 * =================================================================================
 *
 * =================================================================================
 * WHY IT OPERATES ON ITS OWN COPY.
 *
 * `0010`'s `dispatch_outbox_state_machine` REFUSES every UPDATE to a `CLAIMED` row, so a
 * reaper pointed at the production table raises `OUTBOX_ROW_ALREADY_CLAIMED` and the test
 * would then be demonstrating the trigger rather than the reaper. That refusal is asserted
 * directly in `outbox-immutability.test.ts`.
 *
 * What THIS control demonstrates is the behaviour of the mechanism when the database is not
 * refusing: the row goes back to READY, a second claim is issued for one intended external
 * effect, and nothing anywhere notices. The production table is never written by this file.
 * =================================================================================
 */

export interface ReaperOutcome {
  /** Did the visibility timeout return the row to the ready set? */
  readonly reclaimed: boolean;
  /** Was a SECOND claim then issued for the same intended effect? */
  readonly secondClaimIssued: boolean;
  readonly claimsForIdentity: number;
}

export async function unsafeReclaimableOutbox(
  control: Pool,
  input: {
    readonly companyId: string;
    readonly idempotencyKey: string;
    /** `N minutes` in `§39`'s wording. A conventional queue's visibility timeout. */
    readonly visibilityTimeoutMs: number;
    readonly now: Date;
  },
): Promise<ReaperOutcome> {
  const client = await control.connect();
  try {
    await client.query(
      `CREATE TABLE IF NOT EXISTS unsafe_leased_outbox (
         company_id      TEXT,
         idempotency_key TEXT,
         status          TEXT,
         claim_id        TEXT,
         claimed_at      TIMESTAMPTZ
       )`,
    );
    await client.query(
      `DELETE FROM unsafe_leased_outbox WHERE company_id = $1 AND idempotency_key = $2`,
      [input.companyId, input.idempotencyKey],
    );

    // Copy the REAL claimed row into the unconstrained store. Read-only against production.
    const real = await client.query<{ status: string; claim_id: string; claimed_at: Date }>(
      `SELECT status, claim_id, claimed_at FROM dispatch_outbox
        WHERE company_id = $1 AND idempotency_key = $2`,
      [input.companyId, input.idempotencyKey],
    );
    const row = real.rows[0];
    if (row === undefined || row.status !== 'CLAIMED') {
      return { reclaimed: false, secondClaimIssued: false, claimsForIdentity: 0 };
    }
    await client.query(
      `INSERT INTO unsafe_leased_outbox
         (company_id, idempotency_key, status, claim_id, claimed_at)
       VALUES ($1, $2, 'CLAIMED', $3, $4)`,
      [input.companyId, input.idempotencyKey, row.claim_id, row.claimed_at],
    );

    // THE REAPER. `CLAIMED` for longer than the visibility timeout → back to `READY`.
    const reaped = await client.query(
      `UPDATE unsafe_leased_outbox
          SET status = 'READY', claim_id = NULL, claimed_at = NULL
        WHERE company_id = $1 AND idempotency_key = $2
          AND status = 'CLAIMED'
          AND claimed_at < $3::TIMESTAMPTZ - make_interval(secs => $4::NUMERIC)`,
      [
        input.companyId,
        input.idempotencyKey,
        input.now,
        String(input.visibilityTimeoutMs / 1000),
      ],
    );
    const reclaimed = (reaped.rowCount ?? 0) > 0;

    // And the second claim the reaper made possible.
    let secondClaimIssued = false;
    if (reclaimed) {
      const second = await client.query(
        `UPDATE unsafe_leased_outbox
            SET status = 'CLAIMED', claim_id = 'unsafe-claim:second', claimed_at = $3
          WHERE company_id = $1 AND idempotency_key = $2 AND status = 'READY'`,
        [input.companyId, input.idempotencyKey, input.now],
      );
      secondClaimIssued = (second.rowCount ?? 0) > 0;
    }

    const counted = await client.query<{ n: string }>(
      `SELECT count(*)::TEXT AS n FROM unsafe_leased_outbox
        WHERE company_id = $1 AND idempotency_key = $2 AND status = 'CLAIMED'`,
      [input.companyId, input.idempotencyKey],
    );

    return {
      reclaimed,
      secondClaimIssued,
      claimsForIdentity: Number(counted.rows[0]!.n),
    };
  } finally {
    client.release();
  }
}
