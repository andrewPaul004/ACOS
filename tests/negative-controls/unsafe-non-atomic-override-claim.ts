import type { Client, Pool } from '../../src/db/pool.js';

/**
 * TEST-ONLY. An override allowance taken WITHOUT locking the counter row.
 *
 * =================================================================================
 * `§37` ITEM 8 OF THE S1I MANDATE: "owner-override final count raced non-atomically."
 * `§32`: "Expected: at most one receives the final override-backed claim. [...] **No N+1.
 * Do not test this with process memory.**"
 *
 * `30 §5.7.2` item 3: "`effects_dispatched` and `monetary_dispatched` are incremented in
 * the dispatching transaction; reaching either cap moves the override to `EXHAUSTED`
 * immediately." `I63(a)` is the invariant, and its registry enforcement is "DB (CHECK on
 * the per-override counters + trigger on the rolling aggregate, evaluated in the granting
 * **and the dispatching** transaction) + RUNTIME".
 * =================================================================================
 *
 * =================================================================================
 * WHAT IS REMOVED, AND IT IS ONE THING.
 *
 * The ACCEPTED S1H `claimOverrideAllowanceOn` opens with `SELECT ... FOR UPDATE` on the
 * override row, and every subsequent check — the time box, the count cap, the monetary cap,
 * `I63(b)`'s rolling aggregate — runs under that lock. This function issues the same
 * `SELECT` WITHOUT `FOR UPDATE`.
 *
 * That single removal turns the sequence into a read-modify-write: under a targeted
 * interleaving both transactions read `effects_dispatched = cap - 1`, both conclude one
 * allowance remains, and both increment. `cap + 1` effects become claimable under a cap of
 * `cap`, which is `§32`'s N+1.
 *
 * IT WRITES TO ITS OWN COUNTER, for the reason the other controls do: the ACCEPTED
 * `degraded_mode_override_exhausts` trigger and `I63(b)`'s composition trigger would refuse
 * the over-consumption on the real row, and the control would then be demonstrating THOSE
 * triggers — which `vc-a2f-override-composition.test.ts` already does — instead of
 * demonstrating that a non-atomic count check over-issues. The production override row is
 * read but never written by this file.
 * =================================================================================
 */

/**
 * Create the unconstrained counter. CALLED IN ITS OWN TRANSACTION, BEFORE THE RACE.
 *
 * `CREATE TABLE IF NOT EXISTS` takes an `ACCESS EXCLUSIVE` lock and holds it to commit, so
 * issuing it inside the racing transactions would make the second block on the first and
 * would serialise the interleaving `§32` requires to be concurrent.
 */
export async function ensureUnsafeOverrideCounter(control: Pool): Promise<void> {
  const client = await control.connect();
  try {
    await client.query(
      `CREATE TABLE IF NOT EXISTS unsafe_override_counter (
         company_id  TEXT,
         override_id TEXT,
         claimed_by  TEXT
       )`,
    );
    await client.query('TRUNCATE unsafe_override_counter');
  } finally {
    client.release();
  }
}

export async function unsafeNonAtomicOverrideClaim(
  client: Client,
  input: {
    readonly companyId: string;
    readonly overrideId: string;
    readonly claimedBy: string;
    readonly afterRead: () => Promise<void>;
  },
): Promise<boolean> {
  // 1. READ the counter and the cap. NO `FOR UPDATE`.
  const read = await client.query<{
    effect_count_cap: string;
    effects_dispatched: string;
    status: string;
  }>(
    `SELECT effect_count_cap, effects_dispatched, status
       FROM degraded_mode_override
      WHERE company_id = $1 AND override_id = $2`,
    [input.companyId, input.overrideId],
  );
  const row = read.rows[0];
  if (row === undefined) return false;

  // Count what the unsafe ledger has already issued, still without a lock.
  const issued = await client.query<{ n: string }>(
    `SELECT count(*)::TEXT AS n FROM unsafe_override_counter
      WHERE company_id = $1 AND override_id = $2`,
    [input.companyId, input.overrideId],
  );

  // 2. The barrier. Both racers are here, both holding the same stale reading.
  await input.afterRead();

  // 3. Decide from the stale reading.
  const cap = BigInt(row.effect_count_cap);
  const used = BigInt(row.effects_dispatched) + BigInt(issued.rows[0]!.n);
  if (row.status !== 'ACTIVE') return false;
  if (used >= cap) return false;

  // 4. Increment. Nothing excluded the other writer.
  await client.query(
    `INSERT INTO unsafe_override_counter (company_id, override_id, claimed_by)
     VALUES ($1, $2, $3)`,
    [input.companyId, input.overrideId, input.claimedBy],
  );
  return true;
}
