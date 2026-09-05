import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { inTransaction, type Client } from '../../../src/db/pool.js';
import { SQLSTATE, hasSqlstate } from '../../../src/kernel/exposure/errors.js';
import {
  SerialisationRetriesExhausted,
  withSerialisationRetry,
} from '../../../src/kernel/exposure/retry.js';
import { Conductor, settleAll } from '../../support/barrier.js';
import {
  COMPANY_ID,
  createHarness,
  instanceOf,
  materialiseInstances,
  type Harness,
} from '../../support/fixture.js';

/**
 * S1A-H2 — `40001` is retryable; `40P01` is pass-revoking.
 *
 * An owner review finding. `src/kernel/exposure/retry.ts` originally treated both
 * SQLSTATEs as retryable. That is not acceptable on the ACOS money path, and the two are
 * not two flavours of one event:
 *
 *   `40001` is EXPECTED `SERIALIZABLE` contention on a correctly ordered path. The
 *     architecture anticipates the retry — registry §1.1 `I42`: *"a serialisation-failure
 *     retry regenerates the same key (SR-A4)"* — and S1A measured that it is required
 *     rather than optional (log §8). Bounded retry is correct.
 *
 *   `40P01` means the DECLARED MONEY-PATH LOCK ORDER HAS FAILED, or a lock-taking path
 *     exists that never declared itself. `30 §5.2` declares the order once; `24 §3` K5
 *     says *"there is one lock order in the system and both writers of the money row obey
 *     it"*; `lockOrder.ts` is the single acquisition site. A deadlock contradicts that
 *     claim, so it is an invariant/implementation defect and must surface immediately.
 *
 * Retrying a deadlock is worse than failing: it would usually succeed on the second
 * attempt and so would delete the only evidence that the ordering claim the deadlock
 * proof rests on is no longer true.
 *
 * TWO TESTS, because they prove different things:
 *
 *   1. A `40P01` reaching the helper is attempted EXACTLY ONCE and propagates unchanged.
 *      Driven by a PostgreSQL-raised `40P01` so the code path is the production one.
 *   2. A REAL reversed-order deadlock between two real backends, driven THROUGH the
 *      helper, with a deterministic barrier placing both transactions at the dangerous
 *      boundary. This proves the rule holds against a deadlock PostgreSQL's own detector
 *      raised, not only against one the test raised.
 *
 * The pre-existing controls are retained and are not duplicated here:
 * `lock-order.test.ts` still asserts zero `40P01` under the declared order, still proves
 * that reversed acquisition genuinely deadlocks, and still proves that `40001` retries
 * succeed and that the arithmetic afterwards is exact.
 */

const AT = new Date('2026-04-05T12:00:00Z');
const WINDOWS = ['W_DAY_REFUND', 'W_MONTH_REFUND'] as const;

let harness: Harness;

const dayKey = (): string => instanceOf('W_DAY_REFUND', AT).key;
const monthKey = (): string => instanceOf('W_MONTH_REFUND', AT).key;

beforeAll(async () => {
  harness = await createHarness();
});

beforeEach(async () => {
  await harness.reset();
  const client = await harness.connect();
  try {
    await inTransaction(client, 'SERIALIZABLE', async (tx) => {
      await materialiseInstances(tx, AT, [...WINDOWS]);
    });
  } finally {
    client.release();
  }
});

afterAll(async () => {
  await harness?.close();
});

/** TEST-ONLY raw lock. Deliberately not the production helper: this file needs the
 *  UNDECLARED order, which the production helper makes unreachable by construction. */
async function lockRow(client: Client, windowId: string, instanceKey: string): Promise<void> {
  await client.query(
    `SELECT 1 FROM window_balance
      WHERE company_id = $1 AND window_id = $2 AND window_instance_key = $3
        FOR UPDATE`,
    [COMPANY_ID, windowId, instanceKey],
  );
}

describe('S1A-H2 — a 40P01 reaching the retry helper is attempted once and propagates', () => {
  it('the work runs EXACTLY ONCE and the 40P01 propagates unchanged', async () => {
    let attempts = 0;
    const client = await harness.connect();
    let caught: unknown = null;

    try {
      await withSerialisationRetry(
        client,
        async (tx) => {
          attempts += 1;
          // Raised BY PostgreSQL, with PostgreSQL's own SQLSTATE, so the error reaching
          // the helper has the same shape as one the deadlock detector produces.
          await tx.query(`DO $$ BEGIN RAISE EXCEPTION 'injected'
                            USING ERRCODE = 'deadlock_detected'; END $$`);
        },
        { isolation: 'SERIALIZABLE', maxAttempts: 10 },
      );
    } catch (error) {
      caught = error;
    } finally {
      client.release();
    }

    // EXACTLY ONCE. maxAttempts is 10; a retried deadlock would show 10 here.
    expect(attempts, 'the deadlock was retried').toBe(1);

    // Propagated AS ITSELF — not swallowed, not converted, not wrapped.
    expect(caught, 'the deadlock did not propagate').not.toBeNull();
    expect(
      hasSqlstate(caught, SQLSTATE.DEADLOCK_DETECTED),
      `expected a 40P01 to reach the caller, got: ${String(caught)}`,
    ).toBe(true);
    expect(
      caught instanceof SerialisationRetriesExhausted,
      'the deadlock was converted into a retry-exhaustion error, hiding the SQLSTATE',
    ).toBe(false);
  });

  it('by contrast a 40001 IS retried, so the distinction is the helper making a choice', async () => {
    // The discriminating half. Without this, the test above could pass against a helper
    // that retried nothing at all.
    let attempts = 0;
    const client = await harness.connect();
    try {
      const outcome = await withSerialisationRetry(
        client,
        async (tx) => {
          attempts += 1;
          if (attempts < 3) {
            await tx.query(`DO $$ BEGIN RAISE EXCEPTION 'injected'
                              USING ERRCODE = 'serialization_failure'; END $$`);
          }
          return 'COMMITTED';
        },
        { isolation: 'SERIALIZABLE', maxAttempts: 10, baseDelayMs: 1 },
      );
      expect(outcome.value).toBe('COMMITTED');
      expect(outcome.retries).toBe(2);
    } finally {
      client.release();
    }
    expect(attempts).toBe(3);
  });
});

describe('S1A-H2 — a REAL reversed-order deadlock driven through the helper', () => {
  it('PostgreSQL raises the 40P01, the helper does not absorb it, and the work ran once', async () => {
    // Two real backends, deliberately reversed against each other, placed at the
    // dangerous boundary by a barrier rather than by hope. `36 §2`: "this needs injected
    // delays between SELECT and INSERT, not throughput."
    const conductor = new Conductor();
    const helperSide = conductor.participant('helper');
    const otherSide = conductor.participant('other');

    let helperAttempts = 0;

    const runHelperSide = async (): Promise<string> => {
      const client = await harness.connect();
      try {
        const outcome = await withSerialisationRetry(
          client,
          async (tx) => {
            helperAttempts += 1;
            await lockRow(tx, 'W_MONTH_REFUND', monthKey());
            await helperSide.at('FIRST_LOCK');
            await lockRow(tx, 'W_DAY_REFUND', dayKey());
            return 'COMMITTED';
          },
          { isolation: 'SERIALIZABLE', maxAttempts: 10, baseDelayMs: 1 },
        );
        return outcome.value;
      } finally {
        client.release();
      }
    };

    const runOtherSide = async (): Promise<string> => {
      const client = await harness.connect();
      try {
        await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
        await lockRow(client, 'W_DAY_REFUND', dayKey());
        await otherSide.at('FIRST_LOCK');
        await lockRow(client, 'W_MONTH_REFUND', monthKey());
        await client.query('COMMIT');
        return 'COMMITTED';
      } finally {
        try {
          await client.query('ROLLBACK');
        } catch {
          /* the aborted backend may already be rolled back */
        }
        client.release();
      }
    };

    const conduct = async (): Promise<void> => {
      // Both hold their first lock, then both reach for the other's. That is the cycle.
      await conductor.until('helper', 'FIRST_LOCK');
      await conductor.until('other', 'FIRST_LOCK');
      conductor.release('helper', 'FIRST_LOCK');
      conductor.release('other', 'FIRST_LOCK');
    };

    let results;
    try {
      [results] = await Promise.all([settleAll([runHelperSide, runOtherSide]), conduct()]);
    } catch (error) {
      conductor.abort(error);
      throw error;
    }

    const [helperResult, otherResult] = results;

    // The test proves nothing unless a real deadlock happened.
    const deadlocked = results.filter(
      (r) => r.status === 'rejected' && hasSqlstate(r.reason, SQLSTATE.DEADLOCK_DETECTED),
    );
    expect(
      deadlocked.length,
      `reversed acquisition did NOT deadlock; this test proves nothing.\n` +
        `timeline:\n  ${conductor.timeline().join('\n  ')}`,
    ).toBe(1);

    // THE PROPERTY. Whichever backend PostgreSQL chose as the victim — that choice is
    // PostgreSQL's, not the test's — the helper attempted its work exactly once. A
    // helper that retried the deadlock would show more.
    expect(helperAttempts, 'the helper retried a real deadlock').toBe(1);

    // And if the helper's side was the victim, the 40P01 reached its caller as itself.
    if (helperResult!.status === 'rejected') {
      expect(hasSqlstate(helperResult!.reason, SQLSTATE.DEADLOCK_DETECTED)).toBe(true);
      expect(helperResult!.reason instanceof SerialisationRetriesExhausted).toBe(false);
    } else {
      // Otherwise the other side was the victim and the helper's transaction committed.
      expect(helperResult!.value).toBe('COMMITTED');
      expect(otherResult!.status).toBe('rejected');
    }
  });
});
