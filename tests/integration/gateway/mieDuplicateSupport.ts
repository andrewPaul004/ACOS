import { inTransaction, type Pool } from '../../../src/db/pool.js';

export { mieRows, mieCommitment, type MieSnapshotRow } from '../../negative-controls/unsafe-mie-movements.js';

/**
 * TEST-ONLY. `§15` item 5 — THE DUPLICATE CONSUMPTION, AS ONE CALLABLE.
 *
 * `§15`: "Duplicate outcome consumes MIE twice."
 *
 * The accepted `unsafeConsumeIrrecoverableUnit` performs ONE invented consumption; calling it
 * twice is the duplicate. This wrapper does exactly that and returns how many balance rows it
 * moved, so a test can state the defect as a single call whose name says what it is.
 *
 * WHY IT IS UNSAFE AND PRODUCTION IS NOT. The movement is performed OUTSIDE
 * `effect_dispatch_outcome`, so it inherits none of the exactly-once machinery: no primary
 * key on `(company_id, idempotency_key)`, no outbox row lock, no shared commit point with the
 * outcome row. `25 §10.1` requires the PRESUME row "**exactly once** per outbox identity",
 * and a ledger movement with no outbox identity attached cannot be once-per-anything.
 */
export async function unsafeConsumeIrrecoverableUnitTwice(
  control: Pool,
  companyId: string,
  windowIds: readonly string[],
): Promise<number> {
  const client = await control.connect();
  try {
    let moved = 0;
    for (let pass = 0; pass < 2; pass += 1) {
      moved += await inTransaction(client, 'READ COMMITTED', async (tx) => {
        let inPass = 0;
        for (const windowId of [...windowIds].sort()) {
          const result = await tx.query(
            `UPDATE window_balance
                SET presumed_irrecoverable = presumed_irrecoverable + 1
              WHERE company_id = $1 AND window_id = $2`,
            [companyId, windowId],
          );
          inPass += result.rowCount ?? 0;
        }
        return inPass;
      });
    }
    return moved;
  } finally {
    client.release();
  }
}
