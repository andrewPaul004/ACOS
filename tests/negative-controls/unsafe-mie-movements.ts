import { inTransaction, type Pool } from '../../src/db/pool.js';

/**
 * TEST-ONLY. THE FIVE UNSAFE IRRECOVERABLE-LEDGER MOVEMENTS — `§15` OF THE CONTINUATION.
 *
 * =================================================================================
 * WHAT CHANGED ABOUT THIS FAMILY OF CONTROLS AT v1.3.5
 *
 * The accepted `unsafe-mie-consumption.ts` was unusual: it did something the architecture
 * REQUIRED — "consume the irrecoverable unit" — by a mechanism the architecture did not
 * declare, and the discrimination was "production refuses; the control invents". MIE-01
 * declares the mechanism, so that discrimination is gone and a sharper one replaces it:
 *
 *     PRODUCTION:  `25 §10.1`'s PRESUME row — `reserved -= units`, `presumed += units`, in
 *                  ONE statement, inside the outcome transaction, exactly once.
 *     UNSAFE:      each of the five OTHER movements a reasonable engineer might have
 *                  written, every one of which is wrong in a way that MOVES AUTHORITY.
 *
 * `§15` names them, and each function below is one:
 *
 *   1. authorise IRRECOVERABLE without reserving          `unsafeAuthoriseWithoutReserving`
 *   2. change state but leave the unit reserved           `unsafeLeaveReserved`
 *   3. RELEASE the unit on an unknown outcome             `unsafeReleaseOnUnknown`
 *   4. move reserved → REALISED on an unknown outcome     `unsafeReservedToRealised`
 *   6. split the movement across two transactions         `unsafeTwoTransactionMovement`
 *
 * (Item 5, the duplicate consumption, is the accepted `unsafeConsumeIrrecoverableUnit`
 * called twice; item 7, application-only final-unit concurrency, is
 * `unsafeApplicationOnlyReservation` below, because it is a CONCURRENCY defect rather than
 * an arithmetic one.)
 *
 * NONE OF THESE IS REACHABLE FROM `src/`. `no-real-transport-boundary.test.ts` asserts no
 * production file imports anything under `tests/`.
 * =================================================================================
 */

export interface MieSnapshotRow {
  readonly windowId: string;
  readonly windowInstanceKey: string;
  readonly reservedIrrecoverable: string;
  readonly presumedIrrecoverable: string;
  readonly realisedIrrecoverable: string;
}

/** Every irrecoverable term, by window instance. Direct SQL; no production reader. */
export async function mieRows(
  control: Pool,
  companyId: string,
): Promise<readonly MieSnapshotRow[]> {
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

/** The three-term sum `25 §10.1` requires PRESUME to leave unchanged. */
export function mieCommitment(row: MieSnapshotRow): bigint {
  return (
    BigInt(row.reservedIrrecoverable) +
    BigInt(row.presumedIrrecoverable) +
    BigInt(row.realisedIrrecoverable)
  );
}

/**
 * CONTROL 1 — AN IRRECOVERABLE AUTHORISATION THAT RESERVES NO MIE UNIT.
 *
 * The defect the accepted implementation actually had, and which
 * `phase2-v1.3.5-errata.md §1` names: "**no artifact declared a reservation of an
 * irrecoverable unit at all**, so there was no unit to consume". An authorisation that
 * moves only the count ledger passes every accepted S1F assertion and leaves
 * `reserved_irrecoverable` at zero.
 *
 * WHY IT IS UNSAFE, STATED AS THE PROPERTY IT BREAKS: `max_irrecoverable_units` is the
 * ceiling `25 §10.1`'s lifecycle runs against, and a class that never contributes to the
 * ledger is a class the ceiling does not bound. `51 §2.3`: "lowering `email.send` to 0 would
 * remove the class from the ceiling entirely."
 *
 * It undoes the reservation a committed authorisation made, which is the same observable
 * state a step R that never reserved would have produced — and does it without touching the
 * immutable `reservation_window_instance` evidence, so the divergence between the ledger and
 * its own basis is exactly what a test can detect.
 */
export async function unsafeAuthoriseWithoutReserving(
  control: Pool,
  companyId: string,
): Promise<number> {
  const client = await control.connect();
  try {
    return await inTransaction(client, 'READ COMMITTED', async (tx) => {
      const result = await tx.query(
        `UPDATE window_balance
            SET reserved_irrecoverable = 0
          WHERE company_id = $1 AND reserved_irrecoverable > 0`,
        [companyId],
      );
      return result.rowCount ?? 0;
    });
  } finally {
    client.release();
  }
}

/**
 * CONTROL 2 — THE STATE MOVES AND THE UNIT DOES NOT.
 *
 * `PRESUMED_EXECUTED` is reached and `reserved_irrecoverable` is left where it is. This is
 * the reading `phase2-v1.3.5-errata.md §1` records as one of the four candidates — "`I20`
 * bounded provider-accepted messages against 'Σ **reserved** irrecoverable units' [...] which
 * reads as the reserved term **surviving** the consumption".
 *
 * WHY IT IS UNSAFE: the three-term sum RISES with nothing behind it. A window whose unit is
 * both reserved and presumed is a window that has double-counted one authorised effect, and
 * `24 §3` K5's guard would then refuse a later legitimate commitment the ceiling admits.
 * The error is conservative in direction and wrong in kind — and `25 §10.1` is explicit that
 * the sum is UNCHANGED, not raised.
 *
 * A no-op by construction: it increments `presumed` and leaves `reserved` alone.
 */
export async function unsafeLeaveReserved(
  control: Pool,
  companyId: string,
  windowIds: readonly string[],
): Promise<number> {
  const client = await control.connect();
  try {
    return await inTransaction(client, 'READ COMMITTED', async (tx) => {
      let moved = 0;
      for (const windowId of [...windowIds].sort()) {
        const r = await tx.query(
          `UPDATE window_balance
              SET presumed_irrecoverable = presumed_irrecoverable + 1
            WHERE company_id = $1 AND window_id = $2`,
          [companyId, windowId],
        );
        moved += r.rowCount ?? 0;
      }
      return moved;
    });
  } finally {
    client.release();
  }
}

/**
 * CONTROL 3 — THE UNIT IS RELEASED ON AN UNKNOWN OUTCOME. THE DANGEROUS ONE.
 *
 * `25 §10.1`: "**The sum of the three terms does not fall, so an unknown outcome creates no
 * headroom** — which is the whole point of assuming execution." This control makes the sum
 * fall.
 *
 * WHY IT IS UNSAFE, IN THE ARCHITECTURE'S OWN TERMS: `25 §10` row 2's reason for assuming
 * execution is that "for an irrecoverable send the expensive error is *also* duplication —
 * Gmail bulk-sender status has no expiration and spam rate must stay under 0.1%, so a
 * duplicate storm is a permanent domain-reputation event". Releasing the unit hands the
 * freed headroom to the NEXT proposal, so an ambiguous send becomes budget for another send.
 * That is the double-execution economics the whole branch exists to prevent, arriving
 * through the ledger instead of through a retry.
 *
 * `25 §7.2` says it in one line: "**Nothing is released on `OUTCOME_UNKNOWN`.**"
 */
export async function unsafeReleaseOnUnknown(
  control: Pool,
  companyId: string,
  windowIds: readonly string[],
): Promise<number> {
  const client = await control.connect();
  try {
    return await inTransaction(client, 'READ COMMITTED', async (tx) => {
      let moved = 0;
      for (const windowId of [...windowIds].sort()) {
        const r = await tx.query(
          `UPDATE window_balance
              SET reserved_irrecoverable = reserved_irrecoverable - 1
            WHERE company_id = $1 AND window_id = $2 AND reserved_irrecoverable > 0`,
          [companyId, windowId],
        );
        moved += r.rowCount ?? 0;
      }
      return moved;
    });
  } finally {
    client.release();
  }
}

/**
 * CONTROL 4 — `reserved` MOVES STRAIGHT TO `realised` ON AN UNKNOWN OUTCOME.
 *
 * The candidate `phase2-v1.3.5-errata.md §1` lists as (b), and the one that is most nearly
 * right: the sum is unchanged and the ceiling still binds, so no headroom appears.
 *
 * WHY IT IS STILL UNSAFE: `25 §10.1` is explicit — "**The unit does not move directly to
 * `realised`, because a presumption is not a realisation and provider truth is
 * unverified.**" `realised` is the term provider evidence writes; a unit recorded there
 * asserts that the effect DID happen, which no local fact establishes. It also destroys the
 * later resolution: `25 §10.1`'s REALISE and never-sent RELEASE rows both move `presumed`,
 * so a unit realised early can no longer be released when a provider proves `NEVER_SENT` —
 * the accounting becomes permanently wrong in the direction that hides a missed send.
 */
export async function unsafeReservedToRealised(
  control: Pool,
  companyId: string,
  windowIds: readonly string[],
): Promise<number> {
  const client = await control.connect();
  try {
    return await inTransaction(client, 'READ COMMITTED', async (tx) => {
      let moved = 0;
      for (const windowId of [...windowIds].sort()) {
        const r = await tx.query(
          `UPDATE window_balance
              SET reserved_irrecoverable = reserved_irrecoverable - 1,
                  realised_irrecoverable = realised_irrecoverable + 1
            WHERE company_id = $1 AND window_id = $2 AND reserved_irrecoverable > 0`,
          [companyId, windowId],
        );
        moved += r.rowCount ?? 0;
      }
      return moved;
    });
  } finally {
    client.release();
  }
}

/**
 * CONTROL 6 — THE MOVEMENT SPLIT ACROSS TWO TRANSACTIONS. TRANSIENT HEADROOM.
 *
 * `25 §10.1`: "**no transaction may expose transient headroom to another transaction while
 * the movement is in flight.**"
 *
 * The decrement commits, `between()` runs while the sum is one unit lower, and the increment
 * commits afterwards. Every intermediate state is individually legal — non-negative terms, a
 * sum below the ceiling — and the composite is a window that admitted a commitment it had no
 * headroom for. This is `24 §3` K5's guard evaluated against a state that never should have
 * been visible, and it is why production performs both terms in ONE `UPDATE`.
 *
 * `between` is the interleaving point, supplied by the test: `36 §14` requires the race to be
 * constructed rather than hoped for, so there is no sleep here.
 */
export async function unsafeTwoTransactionMovement(
  control: Pool,
  companyId: string,
  windowIds: readonly string[],
  between: () => Promise<void>,
): Promise<void> {
  const client = await control.connect();
  try {
    await inTransaction(client, 'READ COMMITTED', async (tx) => {
      for (const windowId of [...windowIds].sort()) {
        await tx.query(
          `UPDATE window_balance
              SET reserved_irrecoverable = reserved_irrecoverable - 1
            WHERE company_id = $1 AND window_id = $2 AND reserved_irrecoverable > 0`,
          [companyId, windowId],
        );
      }
    });

    // THE GAP. The decrement is COMMITTED and the increment has not happened, so another
    // session sees a three-term sum one unit below the true commitment.
    await between();

    await inTransaction(client, 'READ COMMITTED', async (tx) => {
      for (const windowId of [...windowIds].sort()) {
        await tx.query(
          `UPDATE window_balance
              SET presumed_irrecoverable = presumed_irrecoverable + 1
            WHERE company_id = $1 AND window_id = $2`,
          [companyId, windowId],
        );
      }
    });
  } finally {
    client.release();
  }
}

/**
 * CONTROL 7 — APPLICATION-ONLY FINAL-UNIT ADMISSION.
 *
 * `§15` item 7: "Application-only final-unit concurrency oversubscribes."
 *
 * The shape is the one every ledger gets wrong at least once: READ the balance, decide in
 * application code that there is headroom, then WRITE. Each step is correct; the composition
 * is not, because between the read and the write another session does the same thing. The
 * accepted `lock-order.test.ts` header states the production rule this violates: a writer
 * that "reads here and then writes has skipped step 1 of the lock order".
 *
 * IT TAKES NO ROW LOCK, DELIBERATELY. That is the whole defect. Production reserves through
 * `applyIrrecoverableReservation` under `acquireMoneyPathLocks`, and the DATABASE's guard —
 * not an `if` — is what refuses the oversubscription. `24 §3` K5: "A bare CHECK cannot
 * express it [...] It is a BEFORE UPDATE trigger."
 *
 * `admit` is where the test interleaves the two racers.
 */
export async function unsafeApplicationOnlyReservation(
  control: Pool,
  companyId: string,
  windowId: string,
  windowInstanceKey: string,
  admit: () => Promise<void>,
): Promise<'ADMITTED' | 'REFUSED'> {
  const client = await control.connect();
  try {
    // 1. READ, with no lock.
    const read = await client.query<{ reserved: string; presumed: string; realised: string; ceiling: string }>(
      `SELECT reserved_irrecoverable::TEXT AS reserved,
              presumed_irrecoverable::TEXT AS presumed,
              realised_irrecoverable::TEXT AS realised,
              max_irrecoverable_units::TEXT AS ceiling
         FROM window_balance
        WHERE company_id = $1 AND window_id = $2 AND window_instance_key = $3`,
      [companyId, windowId, windowInstanceKey],
    );
    const row = read.rows[0];
    if (row === undefined) return 'REFUSED';

    // 2. DECIDE, in application code.
    const committed = BigInt(row.reserved) + BigInt(row.presumed) + BigInt(row.realised);
    if (committed + 1n > BigInt(row.ceiling)) return 'REFUSED';

    // 3. THE INTERLEAVING. The other racer reads the same balance and decides the same way.
    await admit();

    // 4. WRITE. Both racers reach here; the guard is the only thing that can still refuse
    //    one, and a test asserts whether it did.
    try {
      await client.query(
        `UPDATE window_balance
            SET reserved_irrecoverable = reserved_irrecoverable + 1
          WHERE company_id = $1 AND window_id = $2 AND window_instance_key = $3`,
        [companyId, windowId, windowInstanceKey],
      );
      return 'ADMITTED';
    } catch {
      return 'REFUSED';
    }
  } finally {
    client.release();
  }
}
