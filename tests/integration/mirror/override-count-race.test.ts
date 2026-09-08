import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { COMPANY_ID } from '../../support/fixture.js';
import { inTransaction } from '../../../src/db/pool.js';
import {
  OWNER_ONE,
  createMirrorHarness,
  journalRowsOfKind,
  signGrant,
  type MirrorHarness,
} from '../../support/mirrorFixture.js';
import {
  claimOverrideAllowanceOn,
  grantOverride,
  type OverrideRequest,
} from '../../../src/kernel/mirror/degradedModeOverride.js';
import { declareMirrorDegraded } from '../../../src/kernel/mirror/mirrorStateMachine.js';
import { money } from '../../../src/kernel/exposure/money.js';
import { Conductor, POINT, settleAll, valueOf } from '../../support/barrier.js';

/**
 * `§18`/`§37` — TWO CONCURRENT CLAIMS COMPETE FOR THE FINAL ALLOWED COUNT. AT MOST ONE WINS.
 *
 * =================================================================================
 * `§37` OF THE S1H MANDATE:
 *
 *   "Use real PostgreSQL where properties involve [...] owner override counters [...]
 *    concurrent final-count claims. **Do not use in-memory mutexes to prove override caps.**
 *    Required race: two concurrent pre-dispatch claims compete for the final allowed override
 *    count. **At most one succeeds.**"
 *
 * `36 §14`, on how a race must be constructed: "the bug appears when two transactions
 * interleave between the `SELECT` sum and the `INSERT`, and reproducing that needs
 * **targeted interleaving with injected delays**, not throughput."
 *
 * So this is not a load test. Two real PostgreSQL backends are placed at the dangerous
 * instruction boundary by `tests/support/barrier.ts` — the accepted S1A conductor — and the
 * interleaving is the one written down here.
 *
 * NO EFFECT IS DISPATCHED. The claim increments `effects_dispatched` in the transaction that
 * WOULD dispatch, in a slice with no dispatcher.
 * =================================================================================
 */

let h: MirrorHarness;

const T0 = new Date('2026-03-01T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;

beforeAll(async () => {
  h = await createMirrorHarness();
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await h.reset();
  await declareMirrorDegraded(h.control, COMPANY_ID, 'PUSH_ACK_TIMEOUT', T0);
});

/** An override with exactly ONE allowance left after `alreadyConsumed` claims. */
async function grantWithCap(cap: bigint): Promise<void> {
  const req: OverrideRequest = {
    companyId: COMPANY_ID,
    overrideId: 'override:race',
    requestedBy: OWNER_ONE,
    requestedAt: T0,
    effectClasses: ['refund.create'],
    recoverabilityClasses: ['COMPENSABLE'],
    precedenceRows: [3],
    startsAt: T0,
    expiresAt: new Date(T0.getTime() + 24 * HOUR),
    effectCountCap: cap,
    monetaryExposureCap: money('50.00'),
    reason: 'the final-count race (§18)',
    incidentRef: h.seed.incidentRef,
  };
  await grantOverride(h.control, req, {
    grantedBy: OWNER_ONE,
    grantedAt: T0,
    grantSignature: signGrant(req, h.seed.ownerOne.privateKey),
  });
}

async function consumedCount(): Promise<bigint> {
  const client = await h.control.connect();
  try {
    const row = await client.query<{ effects_dispatched: string; status: string }>(
      `SELECT effects_dispatched, status FROM degraded_mode_override
        WHERE company_id = $1 AND override_id = 'override:race'`,
      [COMPANY_ID],
    );
    return BigInt(row.rows[0]!.effects_dispatched);
  } finally {
    client.release();
  }
}

describe('THE FINAL ALLOWED COUNT, CONTESTED BY TWO REAL BACKENDS', () => {
  it('cap = 1: two concurrent claims, EXACTLY ONE succeeds', async () => {
    await grantWithCap(1n);

    const conductor = new Conductor();
    const a = conductor.participant('A');
    const b = conductor.participant('B');

    const claim = async (who: typeof a): Promise<string> => {
      const client = await h.control.connect();
      try {
        return await inTransaction(client, 'READ COMMITTED', async (tx) => {
          const result = await claimOverrideAllowanceOn(
            tx,
            COMPANY_ID,
            'override:race',
            money('1.00'),
            T0,
            {
              // The interleaving point: AFTER the `SELECT … FOR UPDATE` has returned and
              // BEFORE the counter is read and written. Whoever holds the row lock is here.
              afterLock: async () => {
                await who.at(POINT.AFTER_LOCK);
              },
            },
          );
          return result.kind;
        });
      } finally {
        client.release();
      }
    };

    const running = settleAll([() => claim(a), () => claim(b)]);

    // A takes the lock and parks. B then attempts the same `FOR UPDATE` and BLOCKS in
    // PostgreSQL — it never reaches its own barrier until A commits, which is exactly the
    // serialisation the cap depends on.
    await conductor.until('A', POINT.AFTER_LOCK);
    conductor.release('A', POINT.AFTER_LOCK);
    // B's barrier is released as soon as it arrives, which is after A's COMMIT.
    await conductor.step('B', POINT.AFTER_LOCK);

    const outcomes = (await running).map((r) => valueOf(r));
    expect(outcomes.filter((o) => o === 'ALLOWANCE_TAKEN')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'REFUSED')).toHaveLength(1);
    // AND THE LEDGER AGREES: one effect consumed, never two.
    expect(await consumedCount()).toBe(1n);
  });

  it('cap = 3 with two already consumed: the final one is contested and won once', async () => {
    // The `§18` enumeration's "concurrent attempts for the final remaining count", with the
    // override genuinely in mid-life rather than at zero.
    await grantWithCap(3n);
    for (let i = 0; i < 2; i += 1) {
      const client = await h.control.connect();
      try {
        await inTransaction(client, 'READ COMMITTED', (tx) =>
          claimOverrideAllowanceOn(tx, COMPANY_ID, 'override:race', money('1.00'), T0),
        );
      } finally {
        client.release();
      }
    }
    expect(await consumedCount()).toBe(2n);

    const conductor = new Conductor();
    const a = conductor.participant('A');
    const b = conductor.participant('B');
    const claim = async (who: typeof a): Promise<string> => {
      const client = await h.control.connect();
      try {
        return await inTransaction(client, 'READ COMMITTED', async (tx) => {
          const result = await claimOverrideAllowanceOn(
            tx,
            COMPANY_ID,
            'override:race',
            money('1.00'),
            T0,
            { afterLock: async () => { await who.at(POINT.AFTER_LOCK); } },
          );
          return result.kind;
        });
      } finally {
        client.release();
      }
    };

    const running = settleAll([() => claim(a), () => claim(b)]);
    await conductor.until('A', POINT.AFTER_LOCK);
    conductor.release('A', POINT.AFTER_LOCK);
    await conductor.step('B', POINT.AFTER_LOCK);

    const outcomes = (await running).map((r) => valueOf(r));
    expect(outcomes.filter((o) => o === 'ALLOWANCE_TAKEN')).toHaveLength(1);
    expect(await consumedCount()).toBe(3n);
  });

  it('N+1 effects never become pre-dispatch eligible under sustained contention', async () => {
    // Ten concurrent claimants against a cap of 5. Not a load test — the assertion is on the
    // LEDGER, and the point is that no ordering of ten real transactions can push the
    // counter past the cap. The CHECK constraint `override_effects_within_cap` is the
    // backstop underneath the lock, so even a bug in the application read cannot exceed it.
    await grantWithCap(5n);
    const claim = async (): Promise<string> => {
      const client = await h.control.connect();
      try {
        return await inTransaction(client, 'READ COMMITTED', async (tx) => {
          const result = await claimOverrideAllowanceOn(
            tx,
            COMPANY_ID,
            'override:race',
            money('1.00'),
            T0,
          );
          return result.kind;
        });
      } finally {
        client.release();
      }
    };
    const outcomes = (await settleAll(Array.from({ length: 10 }, () => claim))).map((r) =>
      valueOf(r),
    );
    expect(outcomes.filter((o) => o === 'ALLOWANCE_TAKEN')).toHaveLength(5);
    expect(outcomes.filter((o) => o === 'REFUSED')).toHaveLength(5);
    expect(await consumedCount()).toBe(5n);

    // And exactly five claims plus one exhaustion were journaled — `30 §5.7.2` item 7's
    // "each cap decrement" and "exhaustion", once each.
    const events = (await journalRowsOfKind(h.control, COMPANY_ID, 'DEGRADED_MODE_OVERRIDE_EVENT'))
      .map((r) => r.overrideEvent);
    expect(events.filter((e) => e === 'ALLOWANCE_TAKEN')).toHaveLength(5);
    expect(events.filter((e) => e === 'EXHAUSTED')).toHaveLength(1);
  });

  it('the DATABASE refuses an over-cap counter even with the application check bypassed', async () => {
    // `§39`: the property must not rest on a check production could be edited to skip.
    await grantWithCap(1n);
    const client = await h.control.connect();
    try {
      await expect(
        client.query(
          `UPDATE degraded_mode_override SET effects_dispatched = 2
            WHERE company_id = $1 AND override_id = 'override:race'`,
          [COMPANY_ID],
        ),
      ).rejects.toThrow(/override_effects_within_cap/);
      await expect(
        client.query(
          `UPDATE degraded_mode_override SET monetary_dispatched = 50.01
            WHERE company_id = $1 AND override_id = 'override:race'`,
          [COMPANY_ID],
        ),
      ).rejects.toThrow(/override_monetary_within_cap/);
    } finally {
      client.release();
    }
  });

  it('and the race is proved to be a REAL lock, not a scheduling accident', async () => {
    // The negative half of `36 §14`'s discipline: if the two transactions did not actually
    // contend, the assertions above would pass on any implementation. The `FOR UPDATE` is
    // asserted directly — B's lock wait is visible in `pg_locks` while A holds the row.
    await grantWithCap(1n);
    const conductor = new Conductor();
    const a = conductor.participant('A');

    const holder = h.control.connect().then(async (client) => {
      try {
        return await inTransaction(client, 'READ COMMITTED', async (tx) => {
          const result = await claimOverrideAllowanceOn(
            tx,
            COMPANY_ID,
            'override:race',
            money('1.00'),
            T0,
            { afterLock: async () => { await a.at(POINT.AFTER_LOCK); } },
          );
          return result.kind;
        });
      } finally {
        client.release();
      }
    });

    await conductor.until('A', POINT.AFTER_LOCK);

    // A second backend attempts the same row and must WAIT.
    const contender = h.control.connect().then(async (client) => {
      try {
        return await inTransaction(client, 'READ COMMITTED', (tx) =>
          tx.query(
            `SELECT override_id FROM degraded_mode_override
              WHERE company_id = $1 AND override_id = 'override:race' FOR UPDATE`,
            [COMPANY_ID],
          ),
        );
      } finally {
        client.release();
      }
    });

    // Give the contender time to enter the lock wait, then observe it in the catalogue.
    const observer = await h.control.connect();
    try {
      let waiting = 0;
      for (let attempt = 0; attempt < 200 && waiting === 0; attempt += 1) {
        // A row-level lock wait appears in `pg_locks` as an UNGRANTED wait on the HOLDER'S
        // `transactionid` (or on the tuple, before the waiter escalates), never as an
        // ungranted lock on the relation — the relation lock is `RowShareLock` and both
        // backends hold it happily. Querying the relation instead is the mistake that makes
        // this control silently vacuous.
        const rows = await observer.query<{ n: string }>(
          `SELECT count(*)::TEXT AS n FROM pg_locks
            WHERE NOT granted AND locktype IN ('transactionid', 'tuple')`,
        );
        waiting = Number(rows.rows[0]!.n);
        if (waiting === 0) {
          // A single round trip is the delay; no wall-clock sleep is introduced.
          await observer.query('SELECT 1');
        }
      }
      expect(waiting, 'the second claimant did not actually block on the row lock').toBeGreaterThan(
        0,
      );
    } finally {
      observer.release();
    }

    conductor.release('A', POINT.AFTER_LOCK);
    expect(await holder).toBe('ALLOWANCE_TAKEN');
    await contender;
    expect(await consumedCount()).toBe(1n);
  });
});
