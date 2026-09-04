import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeEach, beforeAll, describe, expect, it } from 'vitest';

import { inTransaction, type Client } from '../../../src/db/pool.js';
import { SQLSTATE, hasSqlstate } from '../../../src/kernel/exposure/errors.js';
import { acquireMoneyPathLocks, declaredOrder } from '../../../src/kernel/exposure/lockOrder.js';
import { withSerialisationRetry } from '../../../src/kernel/exposure/retry.js';
import {
  COMPANY_ID,
  createHarness,
  instanceOf,
  materialiseInstances,
  type Harness,
} from '../../support/fixture.js';

/**
 * S1A-6 — one declared money-path lock order.
 *
 * `30 §5.2`, verbatim:
 *
 *   "1. window_balance rows, FOR UPDATE, ascending window_id.
 *    2. journal_counter(company_id), FOR UPDATE.
 *    3. Everything else."
 *
 * `24 §3` K5, verbatim:
 *
 *   "The reconciler takes the same lock order as the authorising transaction —
 *    window_balance rows FOR UPDATE ascending window_id, then standing_window_exposure,
 *    then the journal counter. There is one lock order in the system and both writers of
 *    the money row obey it."
 *
 * `36 §2` VC-L2: "Assert the declared lock order (window_balance ascending window_id,
 * then journal_counter) produces no deadlock under N concurrent same-order refunds."
 *
 * Registry §1.2 I3, test column: "deadlock test against the journal counter under
 * reversed acquisition order."
 */

const AT = new Date('2026-04-05T12:00:00Z');
const WINDOWS = ['W_DAY_REFUND', 'W_MONTH_REFUND'] as const;

let harness: Harness;

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

describe('there is exactly ONE lock-acquisition site in src/', () => {
  it('no module other than lockOrder.ts issues FOR UPDATE on a money-path table', async () => {
    // The S1A mandate: "Do not introduce another code path that acquires these locks in
    // another order. Create a single reusable lock-order implementation/helper rather
    // than duplicating the sequence."
    //
    // Enforced against the source tree, because a second acquisition site that happens
    // to use the same order today is still a second site that can drift tomorrow.
    const offenders: string[] = [];
    const root = join(process.cwd(), 'src');

    async function walk(dir: string): Promise<void> {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(path);
          continue;
        }
        if (!entry.name.endsWith('.ts')) continue;
        if (path.endsWith(join('kernel', 'exposure', 'lockOrder.ts'))) continue;

        const contents = await readFile(path, 'utf8');
        // Strip comments so a passage QUOTING the architecture's lock order is not
        // mistaken for a second acquisition site.
        const code = contents
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/(^|[^:])\/\/.*$/gm, '$1');

        for (const table of [
          'window_balance',
          'standing_window_exposure',
          'journal_counter',
        ]) {
          const pattern = new RegExp(`${table}[\\s\\S]{0,400}?FOR UPDATE`, 'i');
          if (pattern.test(code)) {
            offenders.push(`${path} (${table})`);
          }
        }
      }
    }

    await walk(root);
    expect(
      offenders,
      `FOR UPDATE against a money-path table outside lockOrder.ts:\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });

  it('declaredOrder sorts ascending by window_id then instance key', () => {
    const shuffled = [
      { windowId: 'W_MONTH_REFUND', windowInstanceKey: 'W_MONTH_REFUND:2026-05' },
      { windowId: 'W_DAY_REFUND', windowInstanceKey: 'W_DAY_REFUND:2026-04-06' },
      { windowId: 'W_MONTH_REFUND', windowInstanceKey: 'W_MONTH_REFUND:2026-04' },
      { windowId: 'W_DAY_REFUND', windowInstanceKey: 'W_DAY_REFUND:2026-04-05' },
    ];
    expect(declaredOrder(shuffled).map((x) => x.windowInstanceKey)).toEqual([
      'W_DAY_REFUND:2026-04-05',
      'W_DAY_REFUND:2026-04-06',
      'W_MONTH_REFUND:2026-04',
      'W_MONTH_REFUND:2026-05',
    ]);
  });

  it('the acquisition order observed at the database is the declared one', async () => {
    // Asserted by recording the sequence of locking statements the helper actually
    // issues. PostgreSQL grants a row lock when its statement runs, so the statement
    // order IS the acquisition order — and unlike pg_locks, which reports only the set
    // of locks currently held, the statement sequence preserves the order that the
    // deadlock proof depends on.
    const client = await harness.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      const observed: string[] = [];
      const originalQuery = client.query.bind(client);
      // Record the SQL the helper issues, in order. This inspects the CALL SEQUENCE, not
      // a reimplementation of it.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (client as any).query = (...args: unknown[]) => {
        const text = typeof args[0] === 'string' ? args[0] : '';
        if (text.includes('FOR UPDATE')) {
          const params = args[1] as unknown[] | undefined;
          observed.push(`${String(params?.[1] ?? 'journal_counter')}`);
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (originalQuery as any)(...args);
      };

      await acquireMoneyPathLocks(client, {
        companyId: COMPANY_ID,
        // Deliberately supplied in the WRONG order.
        windowInstances: [
          { windowId: 'W_MONTH_REFUND', windowInstanceKey: instanceOf('W_MONTH_REFUND', AT).key },
          { windowId: 'W_DAY_REFUND', windowInstanceKey: instanceOf('W_DAY_REFUND', AT).key },
        ],
        includeStandingRows: true,
        includeJournalCounter: true,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (client as any).query = originalQuery;
      await client.query('ROLLBACK');

      // window_balance ascending window_id, then standing rows, then the counter LAST.
      expect(observed).toEqual([
        'W_DAY_REFUND',
        'W_MONTH_REFUND',
        'W_DAY_REFUND',
        'W_MONTH_REFUND',
        'journal_counter',
      ]);
    } finally {
      client.release();
    }
  });
});

describe('the declared order does not deadlock (VC-L2)', () => {
  const dayKey = () => instanceOf('W_DAY_REFUND', AT).key;
  const monthKey = () => instanceOf('W_MONTH_REFUND', AT).key;

  /** One money-path transaction: the declared locks, then a real commitment. */
  async function commitOneCent(tx: Client): Promise<void> {
    await acquireMoneyPathLocks(tx, {
      companyId: COMPANY_ID,
      // Supplied in REVERSE; the helper imposes the declared order.
      windowInstances: [
        { windowId: 'W_MONTH_REFUND', windowInstanceKey: monthKey() },
        { windowId: 'W_DAY_REFUND', windowInstanceKey: dayKey() },
      ],
      includeStandingRows: true,
      includeJournalCounter: true,
    });
    // Hold the locks briefly so the transactions genuinely contend rather than
    // completing before one another starts.
    await tx.query('SELECT pg_sleep(0.02)');
    await tx.query(
      `UPDATE window_balance SET reserved_monetary = reserved_monetary + 0.01
        WHERE company_id = $1 AND window_id = 'W_MONTH_REFUND' AND window_instance_key = $2`,
      [COMPANY_ID, monthKey()],
    );
  }

  it('N concurrent same-window transactions produce NO deadlock', async () => {
    // This is the claim `36 §2` VC-L2 makes and the only one it makes: no 40P01 under
    // the declared order. It is asserted WITHOUT retry, so a deadlock cannot be
    // absorbed and counted as a success.
    const N = 12;
    const runOne = async (): Promise<void> => {
      const client = await harness.connect();
      try {
        await inTransaction(client, 'SERIALIZABLE', commitOneCent);
      } finally {
        client.release();
      }
    };

    const results = await Promise.allSettled(Array.from({ length: N }, runOne));
    const deadlocks = results.filter(
      (r) => r.status === 'rejected' && hasSqlstate(r.reason, SQLSTATE.DEADLOCK_DETECTED),
    );
    expect(deadlocks, 'the declared lock order deadlocked').toHaveLength(0);

    // What DOES happen instead is recorded rather than hidden: at SERIALIZABLE a
    // SELECT … FOR UPDATE reaching a row a concurrent transaction already committed
    // raises 40001 rather than re-reading it. See src/kernel/exposure/retry.ts and
    // docs/implementation/S1A-implementation-log.md §8.
    const serialisationFailures = results.filter(
      (r) => r.status === 'rejected' && hasSqlstate(r.reason, SQLSTATE.SERIALIZATION_FAILURE),
    );
    const unexplained = results.filter(
      (r) =>
        r.status === 'rejected' &&
        !hasSqlstate(r.reason, SQLSTATE.SERIALIZATION_FAILURE) &&
        !hasSqlstate(r.reason, SQLSTATE.DEADLOCK_DETECTED),
    );
    expect(
      unexplained.map((r) => (r.status === 'rejected' ? String(r.reason) : '')),
      'a transaction failed for a reason that is neither deadlock nor serialisation',
    ).toEqual([]);
    expect(
      serialisationFailures.length,
      'expected contention to produce serialisation failures; if it did not, the ' +
        'transactions were not actually concurrent and this test proves nothing',
    ).toBeGreaterThan(0);
  });

  it('with the ACOS-owned retry, all N commit and the arithmetic is exact', async () => {
    const N = 12;
    const runOne = async (): Promise<number> => {
      const client = await harness.connect();
      try {
        const outcome = await withSerialisationRetry(client, commitOneCent, {
          isolation: 'SERIALIZABLE',
          maxAttempts: 25,
        });
        return outcome.retries;
      } finally {
        client.release();
      }
    };

    const results = await Promise.all(Array.from({ length: N }, runOne));
    expect(results).toHaveLength(N);

    // Every one of the N commitments landed, exactly once. 12 × $0.01 = $0.12, by hand.
    const client = await harness.connect();
    try {
      const balance = await client.query<{ reserved_monetary: string }>(
        `SELECT reserved_monetary FROM window_balance
          WHERE company_id = $1 AND window_id = 'W_MONTH_REFUND' AND window_instance_key = $2`,
        [COMPANY_ID, monthKey()],
      );
      expect(balance.rows[0]?.reserved_monetary).toBe('0.12');
    } finally {
      client.release();
    }
  });
});

describe('reversed acquisition order DOES deadlock — the negative control', () => {
  it('proves the deadlock test above can observe a deadlock at all', async () => {
    // Registry §1.2 I3's test column requires a "deadlock test against the journal
    // counter under reversed acquisition order". Without this, a passing no-deadlock
    // test is indistinguishable from a test that could not detect one.
    //
    // TEST-ONLY. This does not call production code; it issues the reversed sequence
    // directly. src/ is untouched.
    const dayKey = instanceOf('W_DAY_REFUND', AT).key;
    const monthKey = instanceOf('W_MONTH_REFUND', AT).key;

    async function lockRow(client: Client, windowId: string, instanceKey: string): Promise<void> {
      await client.query(
        `SELECT 1 FROM window_balance
          WHERE company_id = $1 AND window_id = $2 AND window_instance_key = $3
            FOR UPDATE`,
        [COMPANY_ID, windowId, instanceKey],
      );
    }

    const ascending = await harness.connect();
    const descending = await harness.connect();
    try {
      await ascending.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      await descending.query('BEGIN ISOLATION LEVEL SERIALIZABLE');

      // Each takes its first lock — no contention yet.
      await lockRow(ascending, 'W_DAY_REFUND', dayKey);
      await lockRow(descending, 'W_MONTH_REFUND', monthKey);

      // Now each reaches for the other's held row. One of them must be aborted with
      // 40P01 by PostgreSQL's deadlock detector.
      const both = await Promise.allSettled([
        lockRow(ascending, 'W_MONTH_REFUND', monthKey),
        lockRow(descending, 'W_DAY_REFUND', dayKey),
      ]);

      const deadlocked = both.filter(
        (r) => r.status === 'rejected' && hasSqlstate(r.reason, SQLSTATE.DEADLOCK_DETECTED),
      );
      expect(
        deadlocked.length,
        'reversed acquisition did NOT deadlock; the deadlock test above proves nothing',
      ).toBe(1);
    } finally {
      for (const client of [ascending, descending]) {
        try {
          await client.query('ROLLBACK');
        } catch {
          /* the aborted backend may already be rolled back */
        }
        client.release();
      }
    }
  });
});
