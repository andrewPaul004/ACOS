import type { Client } from '../../db/pool.js';
import { toDb, type Money } from './money.js';
import type { WindowInstance } from './windowInstance.js';

/**
 * Window-instance materialisation, and the reads the money path needs.
 *
 * `24 §3.1` makes the existence of a row the load-bearing fact — both for
 * `window_balance` (an instance that has no row has no balance) and for
 * `standing_window_exposure` (an instance with no row carries zero forward exposure,
 * "for every instance for which no standing_window_exposure row exists").
 */

export interface WindowDefinition {
  readonly companyId: string;
  readonly windowId: string;
  readonly maxMonetary: Money;
  readonly maxMonetaryUnbounded: boolean;
  readonly maxCount: bigint;
  readonly maxCountUnbounded: boolean;
  readonly maxIrrecoverableUnits: bigint;
  readonly maxIrrecoverableUnbounded: boolean;
}

/**
 * Create the `window_balance` row for an instance if it does not exist, copying the
 * ceilings from the window registry.
 *
 * Idempotent, and deliberately NOT a lock acquisition: it runs before the declared lock
 * order is entered. `ON CONFLICT DO NOTHING` means two concurrent authorisations racing
 * to create the same fresh instance both succeed and then both queue on the same row in
 * step 1 of the lock order, which is where the serialisation belongs.
 */
export async function ensureWindowInstance(
  client: Client,
  companyId: string,
  instance: WindowInstance,
): Promise<void> {
  await client.query(
    `INSERT INTO window_balance (
       company_id, window_id, window_instance_key,
       max_monetary, max_monetary_unbounded,
       max_count, max_count_unbounded,
       max_irrecoverable_units, max_irrecoverable_unbounded)
     SELECT $1, $2, $3,
            w.max_monetary, w.max_monetary_unbounded,
            w.max_count, w.max_count_unbounded,
            w.max_irrecoverable_units, w.max_irrecoverable_unbounded
       FROM window_registry w
      WHERE w.company_id = $1 AND w.window_id = $2
     ON CONFLICT (company_id, window_id, window_instance_key) DO NOTHING`,
    [companyId, instance.windowId, instance.key],
  );
}

export interface BalanceSnapshot {
  readonly companyId: string;
  readonly windowId: string;
  readonly windowInstanceKey: string;
  readonly reservedMonetary: string;
  readonly standingMonetary: string;
  readonly presumedMonetary: string;
  readonly realisedMonetary: string;
  readonly maxMonetary: string;
  readonly maxMonetaryUnbounded: boolean;
  readonly reservedCount: string;
  readonly standingCount: string;
  readonly presumedCount: string;
  readonly realisedCount: string;
  readonly maxCount: string;
  readonly maxCountUnbounded: boolean;
}

/**
 * Read a balance without locking. Used by observers and assertions, never by a writer:
 * a writer that reads here and then writes has skipped step 1 of the lock order, which
 * is precisely the shape the negative control reproduces.
 */
export async function readBalance(
  client: Client,
  companyId: string,
  windowId: string,
  windowInstanceKey: string,
): Promise<BalanceSnapshot | null> {
  const result = await client.query<Record<string, string | boolean>>(
    `SELECT company_id, window_id, window_instance_key,
            reserved_monetary, standing_monetary, presumed_monetary, realised_monetary,
            max_monetary, max_monetary_unbounded,
            reserved_count, standing_count, presumed_count, realised_count,
            max_count, max_count_unbounded
       FROM window_balance
      WHERE company_id = $1 AND window_id = $2 AND window_instance_key = $3`,
    [companyId, windowId, windowInstanceKey],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    companyId: row['company_id'] as string,
    windowId: row['window_id'] as string,
    windowInstanceKey: row['window_instance_key'] as string,
    reservedMonetary: row['reserved_monetary'] as string,
    standingMonetary: row['standing_monetary'] as string,
    presumedMonetary: row['presumed_monetary'] as string,
    realisedMonetary: row['realised_monetary'] as string,
    maxMonetary: row['max_monetary'] as string,
    maxMonetaryUnbounded: row['max_monetary_unbounded'] as boolean,
    reservedCount: row['reserved_count'] as string,
    standingCount: row['standing_count'] as string,
    presumedCount: row['presumed_count'] as string,
    realisedCount: row['realised_count'] as string,
    maxCount: row['max_count'] as string,
    maxCountUnbounded: row['max_count_unbounded'] as boolean,
  };
}

/**
 * Move `reserved_monetary` and `reserved_count` on one already-locked balance row.
 *
 * The caller MUST hold the row through acquireMoneyPathLocks. This function does not
 * lock, because a second acquisition site is exactly what the single-lock-order rule
 * forbids. The commitment guard fires on this UPDATE; the caller translates it.
 */
export async function applyReservation(
  client: Client,
  companyId: string,
  windowId: string,
  windowInstanceKey: string,
  monetaryDelta: Money,
  countDelta: bigint,
): Promise<void> {
  await client.query(
    `UPDATE window_balance
        SET reserved_monetary = reserved_monetary + $4::NUMERIC,
            reserved_count    = reserved_count + $5::BIGINT
      WHERE company_id = $1 AND window_id = $2 AND window_instance_key = $3`,
    [companyId, windowId, windowInstanceKey, toDb(monetaryDelta), countDelta.toString()],
  );
}

/** Move `presumed_monetary` on one already-locked balance row. I3's term 3. */
export async function applyPresumed(
  client: Client,
  companyId: string,
  windowId: string,
  windowInstanceKey: string,
  monetaryDelta: Money,
): Promise<void> {
  await client.query(
    `UPDATE window_balance
        SET presumed_monetary = presumed_monetary + $4::NUMERIC
      WHERE company_id = $1 AND window_id = $2 AND window_instance_key = $3`,
    [companyId, windowId, windowInstanceKey, toDb(monetaryDelta)],
  );
}

/**
 * Move `realised_monetary` directly on one already-locked balance row, for realised
 * spend that is NOT attributable to a standing authorisation.
 *
 * `24 §3` K5: "An update that increases only realised passes the guard unconditionally,
 * even where the resulting four-term sum exceeds max_monetary." This function is how
 * that path is exercised for a non-standing observation; standing-attributable spend
 * goes through recordRealisedSpend(), which must move both terms at once.
 */
export async function applyRealised(
  client: Client,
  companyId: string,
  windowId: string,
  windowInstanceKey: string,
  monetaryDelta: Money,
): Promise<void> {
  await client.query(
    `UPDATE window_balance
        SET realised_monetary = realised_monetary + $4::NUMERIC
      WHERE company_id = $1 AND window_id = $2 AND window_instance_key = $3`,
    [companyId, windowId, windowInstanceKey, toDb(monetaryDelta)],
  );
}
