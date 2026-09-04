import type { Client } from '../../db/pool.js';
import { acquireMoneyPathLocks } from './lockOrder.js';
import { toDb, type Money } from './money.js';

/**
 * The spend reconciler — the other writer of the money row.
 *
 * `24 §3` K5's TB-04 repair, verbatim:
 *
 *   "2. The spend reconciler's update is one statement against standing_window_exposure,
 *       and a trigger in the same statement recomputes window_balance.standing_monetary
 *       as Σ forward_monetary WHERE instance_in_scope and increments
 *       window_balance.realised_monetary by the same delta. Both terms move together or
 *       neither does.
 *    3. The reconciler takes the same lock order as the authorising transaction —
 *       window_balance rows FOR UPDATE ascending window_id, then
 *       standing_window_exposure, then the journal counter. There is one lock order in
 *       the system and both writers of the money row obey it."
 *
 * There is exactly ONE statement here that changes money, and it writes ONE column:
 * `standing_window_exposure.realised_monetary`. Everything else — forward_monetary, the
 * window_balance standing term, the window_balance realised term — moves as a
 * consequence, inside that statement, in the database. No sequencing decision is
 * available to this module, which is the point: `24 §3` K5 says of the two orderings
 * that "the repair removes the choice."
 */

export interface RealisedSpendObservation {
  readonly companyId: string;
  readonly standingAuthorizationId: string;
  readonly windowId: string;
  readonly windowInstanceKey: string;
  /** The incremental spend the vendor reported for this instance. */
  readonly delta: Money;
}

export interface ReconcileResult {
  /** `standing_window_exposure.realised_monetary` after the write. */
  readonly realisedMonetary: string;
  /** The generated `forward_monetary` after the write. */
  readonly forwardMonetary: string;
}

/**
 * Record vendor-attributable realised spend against one standing authorisation in one
 * window instance.
 *
 * The caller owns the transaction. Where a single observation spans several instances,
 * the caller passes them all to `recordRealisedSpendAcrossInstances` so the locks are
 * taken once, in the declared order, before any write.
 */
export async function recordRealisedSpend(
  client: Client,
  observation: RealisedSpendObservation,
): Promise<ReconcileResult> {
  return (await recordRealisedSpendAcrossInstances(client, [observation]))[0]!;
}

export async function recordRealisedSpendAcrossInstances(
  client: Client,
  observations: readonly RealisedSpendObservation[],
): Promise<readonly ReconcileResult[]> {
  if (observations.length === 0) return [];

  const companyIds = new Set(observations.map((o) => o.companyId));
  if (companyIds.size !== 1) {
    throw new Error('a reconciler transaction covers exactly one company');
  }
  const companyId = observations[0]!.companyId;

  // Step 1 and 2 of the declared lock order, through the single helper. The reconciler
  // and the authorising transaction call the same function with the same ordering rule,
  // which is what makes the deadlock proof hold across both writers.
  await acquireMoneyPathLocks(client, {
    companyId,
    windowInstances: observations.map((o) => ({
      windowId: o.windowId,
      windowInstanceKey: o.windowInstanceKey,
    })),
    includeStandingRows: true,
    includeJournalCounter: false,
  });

  const results: ReconcileResult[] = [];
  for (const observation of observations) {
    // THE statement. One column, one row. The sync trigger moves
    // window_balance.standing_monetary and window_balance.realised_monetary inside it.
    //
    // Financial truth is always writable: no guard on this path can refuse it, because
    // the commitment guard's IF requires one of the three COMMITMENT terms to increase
    // and this changes none of them. `24 §3` K5: "An update that increases only realised
    // passes the guard unconditionally, even where the resulting four-term sum exceeds
    // max_monetary."
    const result = await client.query<{
      realised_monetary: string;
      forward_monetary: string;
    }>(
      `UPDATE standing_window_exposure
          SET realised_monetary = realised_monetary + $4::NUMERIC
        WHERE company_id = $1
          AND standing_authorization_id = $2
          AND window_id = $3
          AND window_instance_key = $5
        RETURNING realised_monetary, forward_monetary`,
      [
        observation.companyId,
        observation.standingAuthorizationId,
        observation.windowId,
        toDb(observation.delta),
        observation.windowInstanceKey,
      ],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error(
        `no standing_window_exposure row for ${observation.standingAuthorizationId} in ` +
          `${observation.windowId} / ${observation.windowInstanceKey}. ` +
          `24 §3.1: an instance with no row carries zero forward exposure, so a spend ` +
          `observation against one is an attribution defect, not a ledger write.`,
      );
    }
    results.push({
      realisedMonetary: row.realised_monetary,
      forwardMonetary: row.forward_monetary,
    });
  }
  return results;
}

/**
 * Record realised spend that is NOT attributable to a standing authorisation, directly
 * against the window balance's realised term.
 *
 * Same financial-truth rule, same lock order. Kept separate from the standing path
 * because the standing path must move two terms and this one must move exactly one; a
 * shared function would have to branch on which, and that branch is the thing TB-04
 * removed.
 */
export async function recordNonStandingRealisedSpend(
  client: Client,
  companyId: string,
  windowId: string,
  windowInstanceKey: string,
  delta: Money,
): Promise<void> {
  await acquireMoneyPathLocks(client, {
    companyId,
    windowInstances: [{ windowId, windowInstanceKey }],
    includeStandingRows: false,
    includeJournalCounter: false,
  });
  await client.query(
    `UPDATE window_balance
        SET realised_monetary = realised_monetary + $4::NUMERIC
      WHERE company_id = $1 AND window_id = $2 AND window_instance_key = $3`,
    [companyId, windowId, windowInstanceKey, toDb(delta)],
  );
}
