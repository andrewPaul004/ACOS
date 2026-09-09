import { inTransaction, type Pool } from '../../src/db/pool.js';

/**
 * TEST-ONLY. AN INVENTED MIE CONSUMPTION — `§40` ITEM 10.
 *
 * =================================================================================
 * WHAT THIS CONTROL DISCRIMINATES, AND WHY IT IS UNUSUAL
 *
 * Every other control in this directory is a defect: it does something the architecture
 * forbids. THIS ONE DOES SOMETHING THE ARCHITECTURE REQUIRES — "consume the irrecoverable
 * unit" — BY A MECHANISM THE ARCHITECTURE DOES NOT DECLARE.
 *
 * `§40` item 10 asks for exactly that: "IRRECOVERABLE unknown does not consume MIE / or
 * consumes it twice, **if MIE transition is normatively defined**". It is not defined, so
 * the control is the definition itself, and the discrimination is:
 *
 *     UNSAFE:     invents a plausible ledger transition and performs it.
 *     PRODUCTION: refuses to write anything, and says which artifact leaves it open.
 *
 * =================================================================================
 * THE FOUR CANDIDATE TRANSITIONS, AND WHY NONE IS DECLARED
 *
 * `24 §3` K5's authoritative `window_balance` schema gives the irrecoverable ledger three
 * terms and no transitions:
 *
 *     reserved_irrecoverable, presumed_irrecoverable, realised_irrecoverable
 *
 * So "consume the unit" could be any of:
 *
 *   (a) `reserved_irrecoverable` -1, `presumed_irrecoverable` +1
 *   (b) `reserved_irrecoverable` -1, `realised_irrecoverable` +1
 *   (c) `presumed_irrecoverable` +1, `reserved_irrecoverable` unchanged
 *   (d) `realised_irrecoverable` +1, `reserved_irrecoverable` unchanged
 *
 * and the artifacts pull in different directions:
 *
 *   - the registry binds `I3`'s term 3 to the `PRESUMED_SETTLED` state, which `I32` and
 *     `26 §10.3` define as a MONEY reservation's liquidity-override state — not
 *     `PRESUMED_EXECUTED` — which argues against (a) and (c);
 *   - `I20` bounds provider-accepted messages against "Σ **reserved** irrecoverable units"
 *     and its test column wants a fixture window "including a `PRESUMED_EXECUTED` row",
 *     which reads as the reserved term SURVIVING the consumption and argues against (a)
 *     and (b);
 *   - `25 §10` calls the consumption a consumption, which argues against (c) and (d);
 *   - and `26 §7` step R does not say which ledger the reservation was taken in: its prose
 *     reserves "`exposure.total_exposure` into the ordinary reservation term — `I3` term
 *     1", its flowchart node reserves "money · irrecoverable-count", and `51 §2` gives the
 *     MIE windows both a `max_count` and a `max_irrecoverable_units` at the same figures.
 *
 * AND THE DECIDING FACT: NO ACCEPTED SLICE RESERVES AN IRRECOVERABLE UNIT AT ALL.
 * `src/kernel/exposure/ledger.ts`'s `applyReservation` moves `reserved_monetary` and
 * `reserved_count`; `reserved_irrecoverable` has no production writer anywhere. So under
 * (a) or (b) the consumption would drive a `BIGINT` term negative and trip
 * `window_balance_irrecoverable_non_negative` — THERE IS NO RESERVED UNIT TO CONSUME.
 *
 * This control therefore implements (c): increment `presumed_irrecoverable`, leave
 * `reserved_irrecoverable` alone. It is the only candidate that does not immediately
 * violate a `CHECK`, which is exactly the kind of reasoning that turns an undeclared rule
 * into a shipped one. `§2` and `§16` of the mandate forbid production from doing it.
 * =================================================================================
 */

export interface UnsafeMieSnapshot {
  readonly windowId: string;
  readonly windowInstanceKey: string;
  readonly reservedIrrecoverable: string;
  readonly presumedIrrecoverable: string;
  readonly realisedIrrecoverable: string;
}

export async function unsafeMieSnapshot(
  control: Pool,
  companyId: string,
): Promise<readonly UnsafeMieSnapshot[]> {
  const client = await control.connect();
  try {
    const result = await client.query<{
      window_id: string;
      window_instance_key: string;
      reserved_irrecoverable: string;
      presumed_irrecoverable: string;
      realised_irrecoverable: string;
    }>(
      `SELECT window_id, window_instance_key,
              reserved_irrecoverable::TEXT AS reserved_irrecoverable,
              presumed_irrecoverable::TEXT AS presumed_irrecoverable,
              realised_irrecoverable::TEXT AS realised_irrecoverable
         FROM window_balance WHERE company_id = $1
        ORDER BY window_id, window_instance_key`,
      [companyId],
    );
    return result.rows.map((r) => ({
      windowId: r.window_id,
      windowInstanceKey: r.window_instance_key,
      reservedIrrecoverable: r.reserved_irrecoverable,
      presumedIrrecoverable: r.presumed_irrecoverable,
      realisedIrrecoverable: r.realised_irrecoverable,
    }));
  } finally {
    client.release();
  }
}

/**
 * Invent the transition and perform it on every MIE window instance that exists.
 *
 * Returns how many balance rows it moved, so the test can assert (a) that it moved
 * something, (b) that calling it twice moves it TWICE — the "consumes it twice" half of
 * `§40` item 10, which follows automatically because an invented transition has no
 * idempotency key, no once-only record and nothing to make it exactly-once. That absence is
 * itself part of what makes inventing it unsafe: production's exactly-once property comes
 * from `effect_dispatch_outcome`'s primary key, and a ledger movement bolted on outside the
 * outcome row inherits none of it.
 */
export async function unsafeConsumeIrrecoverableUnit(
  control: Pool,
  companyId: string,
  windowIds: readonly string[],
): Promise<number> {
  const client = await control.connect();
  try {
    return await inTransaction(client, 'READ COMMITTED', async (tx) => {
      let moved = 0;
      for (const windowId of [...windowIds].sort()) {
        const result = await tx.query(
          `UPDATE window_balance
              SET presumed_irrecoverable = presumed_irrecoverable + 1
            WHERE company_id = $1 AND window_id = $2`,
          [companyId, windowId],
        );
        moved += result.rowCount ?? 0;
      }
      return moved;
    });
  } finally {
    client.release();
  }
}
