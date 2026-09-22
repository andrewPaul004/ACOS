import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { COMPANY_ID } from '../../support/fixture.js';
import {
  RESHIP_WINDOWS,
  authoriseReship,
  createOutboxHarness,
  type OutboxHarness,
} from '../../support/outboxFixture.js';
import {
  mieRows,
  unsafeApplicationOnlyReservation,
  type MieSnapshotRow,
} from '../../negative-controls/unsafe-mie-movements.js';

/**
 * `§8` — THE FINAL MIE UNIT, UNDER REAL CONCURRENCY.
 *
 * =================================================================================
 * THE FIXTURE, AND WHY IT IS THE ONE THAT MATTERS
 *
 * `§8`: "MIE window has exactly one remaining unit. Two valid IRRECOVERABLE authorisations
 * race. Expected: exactly one commits; exactly one fails the architecture economic guard;
 * committed `reserved_irrecoverable` reaches the ceiling exactly; no oversubscription; no
 * deadlock under legitimate lock order."
 *
 * A ceiling is only a ceiling at its boundary. Every test that reserves against a window with
 * room to spare passes against an implementation with no guard at all, so the discriminating
 * fixture is the last unit — and it has to be raced, because the defect this closes is a
 * read-then-write interleaving that a sequential test cannot produce.
 *
 * REAL POSTGRESQL, AND A REAL RACE. `36 §14` requires the race to be CONSTRUCTED rather than
 * hoped for. Both authorisations are started before either is awaited, so both are genuinely
 * in flight; the serialisation is PostgreSQL's row lock and `24 §3` K5's trigger, not a
 * JavaScript mutex.
 * =================================================================================
 *
 * =================================================================================
 * WHAT ENFORCES IT, AND WHAT DOES NOT
 *
 * `24 §3` K5 is explicit that the guard cannot be a `CHECK`: "A bare CHECK cannot express it,
 * because the four-term sum must gate a *commitment* while never refusing an *observation*
 * [...] It is a BEFORE UPDATE trigger on window_balance, per ledger."
 *
 * So the refusal below comes from `i3_commitment_guard`'s irrecoverable clause, raised as
 * `I3_WINDOW_EXHAUSTED` with SQLSTATE `ACS03`, translated by `asDenial` into the
 * `WINDOW_EXHAUSTED` the local authorisation returns. Not from an `if`, and not from the
 * application's own arithmetic — which is what `unsafeApplicationOnlyReservation` does, and
 * what the discriminator at the end of this file shows the cost of.
 * =================================================================================
 */

let h: OutboxHarness;

beforeAll(async () => {
  h = await createOutboxHarness();
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  await h.reset();
});

/**
 * Drive every MIE window instance to ONE unit below its ceiling.
 *
 * Direct SQL, and deliberately: manufacturing the state through 12 real authorisations would
 * take 12 round trips per window and would test the reservation path rather than the
 * boundary. The rows it writes are the same rows a real sequence would have produced.
 */
async function fillToOneRemaining(): Promise<void> {
  // MATERIALISE THE INSTANCES FIRST. `window_balance` rows are created lazily INSIDE step R
  // — the accepted `ledger.ts`: "an instance that has no row has no balance" — so a bare
  // `UPDATE` before the first IRRECOVERABLE authorisation would touch nothing and the
  // fixture would silently test a window with full headroom.
  await authoriseReship(h, { resourceId: 'ORD-RACE-SEED' });
  const client = await h.control.connect();
  try {
    const result = await client.query(
      `UPDATE window_balance
          SET reserved_irrecoverable = max_irrecoverable_units - 1
        WHERE company_id = $1 AND window_id = ANY($2::TEXT[])`,
      [COMPANY_ID, [...RESHIP_WINDOWS]],
    );
    if ((result.rowCount ?? 0) !== RESHIP_WINDOWS.length) {
      throw new Error(
        `the MIE instances were not materialised: expected ${String(RESHIP_WINDOWS.length)} ` +
          `rows, updated ${String(result.rowCount)}`,
      );
    }
  } finally {
    client.release();
  }
}

async function mieWindows(): Promise<readonly MieSnapshotRow[]> {
  const rows = await mieRows(h.control, COMPANY_ID);
  return rows.filter((r) => RESHIP_WINDOWS.includes(r.windowId));
}

async function ceilings(): Promise<ReadonlyMap<string, bigint>> {
  const client = await h.control.connect();
  try {
    const result = await client.query<{ window_id: string; ceiling: string }>(
      `SELECT window_id, max_irrecoverable_units::TEXT AS ceiling
         FROM window_balance WHERE company_id = $1 AND window_id = ANY($2::TEXT[])`,
      [COMPANY_ID, [...RESHIP_WINDOWS]],
    );
    return new Map(result.rows.map((r) => [r.window_id, BigInt(r.ceiling)]));
  } finally {
    client.release();
  }
}

describe('`§8` — TWO VALID IRRECOVERABLE AUTHORISATIONS RACE FOR ONE UNIT', () => {
  it('exactly one commits, exactly one is denied, and the ceiling is reached EXACTLY', async () => {
    await fillToOneRemaining();
    const max = await ceilings();

    // BOTH IN FLIGHT BEFORE EITHER IS AWAITED. Two distinct resources, so both are genuinely
    // valid authorisations rather than a duplicate of one — `I42` would refuse a duplicate
    // for a reason that has nothing to do with the ceiling, and the test would prove nothing.
    const first = authoriseReship(h, { resourceId: 'ORD-RACE-A' });
    const second = authoriseReship(h, { resourceId: 'ORD-RACE-B' });
    const results = await Promise.allSettled([first, second]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled, 'exactly one authorisation commits').toHaveLength(1);
    expect(rejected, 'exactly one authorisation is denied').toHaveLength(1);

    // THE DENIAL IS THE ARCHITECTURE'S ECONOMIC GUARD, not a lock timeout and not a crash.
    //
    // `authoriseReship` surfaces a non-committing outcome as an Error naming the outcome
    // literal, and `26 §7`'s only DENY terminal at or after step R is `WINDOW_EXHAUSTED`
    // (`localAuthorisationErrors.ts`: "D13 `WINDOW_EXHAUSTED` is the only DENY terminal
    // `26 §7` places at or after R"). So `LOCAL_AUTHORISATION_DENIED` at this point IS that
    // denial, and the assertion also excludes the two answers that would mean something else
    // went wrong.
    const reason = String((rejected[0] as PromiseRejectedResult).reason);
    expect(reason).toMatch(/LOCAL_AUTHORISATION_DENIED|WINDOW_EXHAUSTED/);
    expect(reason).not.toMatch(/40P01|deadlock|timeout/i);

    // NO OVERSUBSCRIPTION, AND NO UNDERSHOOT. The committed value reaches the ceiling
    // EXACTLY, which is stronger than "did not exceed": an implementation that refused both
    // would also not exceed it.
    for (const row of await mieWindows()) {
      expect(BigInt(row.reservedIrrecoverable), row.windowId).toBe(max.get(row.windowId));
      expect(row.presumedIrrecoverable, row.windowId).toBe('0');
      expect(row.realisedIrrecoverable, row.windowId).toBe('0');
    }
  });

  it('a third attempt at the ceiling is denied deterministically, with no race at all', async () => {
    /*
     * The sequential companion. Once the ceiling is reached, the answer is determinate and
     * carries no timing: `24 §3` K5's predicate fires on any statement that INCREASES a
     * committed term while the three-term sum exceeds the ceiling.
     */
    await fillToOneRemaining();
    // The last unit, taken.
    await authoriseReship(h, { resourceId: 'ORD-RACE-FILL' });

    await expect(authoriseReship(h, { resourceId: 'ORD-RACE-OVER' })).rejects.toThrow(
      /LOCAL_AUTHORISATION_DENIED|WINDOW_EXHAUSTED/,
    );

    for (const row of await mieWindows()) {
      expect(BigInt(row.reservedIrrecoverable), row.windowId).toBe(
        (await ceilings()).get(row.windowId),
      );
    }
  });

  it('NO DEADLOCK under the legitimate lock order — `40P01` is a defect, not contention', async () => {
    /*
     * `30 §5.2` / S1A-H2: "A `40P01` from this path is an INVARIANT DEFECT, not contention."
     * `lockOrder.ts` acquires `window_balance` rows ONE AT A TIME in ascending
     * `(window_id, window_instance_key)`, precisely so the acquisition sequence is the
     * declared sequence "observably, always" rather than only in the absence of concurrency.
     *
     * Two IRRECOVERABLE authorisations touch the SAME TWO windows, so a wrong order would
     * deadlock on the second row. Four concurrent attempts against a window with room makes
     * the opportunity real, and the assertion is that no attempt fails with `40P01`.
     */
    const attempts = ['D1', 'D2', 'D3', 'D4'].map((suffix) =>
      authoriseReship(h, { resourceId: `ORD-DEADLOCK-${suffix}` }),
    );
    const results = await Promise.allSettled(attempts);

    for (const result of results) {
      if (result.status === 'rejected') {
        expect(String(result.reason), 'a deadlock on the money path is a defect').not.toMatch(
          /40P01|deadlock/i,
        );
      }
    }
    // All four fit: `W_DAY_MIE` admits 13 and `W_MONTH_MIE` admits 43.
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(4);
    for (const row of await mieWindows()) {
      expect(row.reservedIrrecoverable, row.windowId).toBe('4');
    }
  });
});

describe('`§15` item 7 — THE DISCRIMINATOR: APPLICATION-ONLY ADMISSION OVERSUBSCRIBES', () => {
  it('two read-then-write racers both admit the last unit; production admits one', async () => {
    /*
     * =================================================================================
     * THE SHAPE, AND WHY IT LOOKS CORRECT
     *
     * READ the balance, decide in application code that there is headroom, WRITE. Each step
     * is right and the composition is not, because between the read and the write the other
     * session does the same thing. The accepted `lock-order.test.ts` states the production
     * rule it violates: a writer that "reads here and then writes has skipped step 1 of the
     * lock order".
     *
     * WHAT THE CONTROL PROVES DEPENDS ON THE GUARD BEING REAL. Both racers pass their own
     * `if`; what happens at the `UPDATE` is PostgreSQL's answer, and `24 §3` K5's trigger is
     * what decides it. So this test asserts BOTH halves: the application-level decision
     * admitted twice (the defect), and the database refused the second write (the backstop
     * that survives the defect).
     * =================================================================================
     */
    await fillToOneRemaining();
    const target = (await mieWindows()).find((r) => r.windowId === RESHIP_WINDOWS[0]);
    expect(target, 'the MIE instance was not materialised').toBeDefined();
    if (target === undefined) return;

    // Both racers read, then both decide, then both write — the interleaving constructed
    // through a barrier rather than hoped for.
    let releaseSecond: (() => void) | null = null;
    const secondRead = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });

    const one = unsafeApplicationOnlyReservation(
      h.control,
      COMPANY_ID,
      target.windowId,
      target.windowInstanceKey,
      async () => {
        // Let the other racer read the SAME pre-write balance before this one writes.
        await secondRead;
      },
    );
    const two = unsafeApplicationOnlyReservation(
      h.control,
      COMPANY_ID,
      target.windowId,
      target.windowInstanceKey,
      async () => {
        releaseSecond?.();
      },
    );

    const [a, b] = await Promise.all([two, one]);
    const admitted = [a, b].filter((r) => r === 'ADMITTED');

    // BOTH PASSED THEIR OWN CHECK — neither returned `REFUSED` for lack of headroom, which is
    // the defect: the application's arithmetic admitted the last unit twice.
    expect([a, b]).not.toContain('REFUSED_BY_APPLICATION');

    // AND THE DATABASE REFUSED THE SECOND WRITE. `24 §3` K5's guard is the only thing between
    // this control and an oversubscribed ceiling, and it holds.
    expect(admitted, 'the guard admitted more than the ceiling allows').toHaveLength(1);

    const after = await mieWindows();
    const max = await ceilings();
    for (const row of after) {
      expect(BigInt(row.reservedIrrecoverable) <= max.get(row.windowId)!, row.windowId).toBe(
        true,
      );
    }
  });
});
