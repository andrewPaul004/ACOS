import type { PoolClient } from 'pg';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createHarness, type Harness } from '../../support/fixture.js';
import { loadCommerceFixture } from '../../support/enumerationFixture.js';
import {
  S1E_PASS_ORDER,
  insertGrant,
  loadAuthorityWorld,
  loadS1eOrders,
} from '../../support/authorityFixture.js';
import {
  COMPANY_ID,
  EXPECTED_REFUND_WINDOWS,
  FIXTURE_NOW,
  S1F_EXPECTED,
  S1F_TABLES,
  countOf,
  expectedInstanceKey,
  makeLocalAuthorityHarness,
  proposeAndAuthorise,
  rowsOf,
  scalar,
  type LocalAuthorityHarness,
} from '../../support/localAuthorisationFixture.js';
import { unsafeReserveSingleWindow } from '../../negative-controls/unsafe-local-authorisation.js';
import { money } from '../../../src/kernel/exposure/money.js';

/**
 * EVERY REFERENCED WINDOW MUST BIND — and the transaction is all-or-nothing across them.
 *
 * =====================================================================================
 * THE RULE
 *
 * `26 §7` step R, as restated by `phase2-v1.3.1-errata.md §1`, verbatim: reserves "against
 * **every** named window instance the matching grants reference, taking each
 * `window_balance` row `SELECT … FOR UPDATE` in ascending `window_id` [...] and fails if
 * **any** lacks headroom."
 *
 * The accepted S1E owner ruling S1E-C4, verbatim: "window sets compose by UNION and step R
 * must reserve against every referenced applicable window; adding a matching grant may
 * never widen."
 *
 * There is no primary window, no first-match, no most-permissive window, no partial
 * reservation and no per-window independent commit.
 *
 * =====================================================================================
 * THE FIXTURE ARITHMETIC, HAND-AUTHORED
 *
 * `51 §2`, transcribed: `W_DAY_REFUND.max_monetary = $50.00`,
 * `W_MONTH_REFUND.max_monetary = $250.00`. The S1E pass order's exposure is $9.41 + $0.59 =
 * $10.00.
 *
 *   day exhausted     realised $41.00  ->  headroom $9.00  <  $10.00
 *   month exhausted   realised $241.00 ->  headroom $9.00  <  $10.00
 *   exact boundary    realised $40.00  ->  headroom $10.00 == $10.00   -> PERMIT
 *   one cent over     realised $40.01  ->  headroom  $9.99 <  $10.00   -> DENY
 *
 * Every figure above is written out here. Nothing calls the production guard, the production
 * exposure computation or the production window resolver to decide what to expect.
 * =====================================================================================
 */

let harness: Harness;
let kernel: LocalAuthorityHarness;

function json(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => (typeof v === 'bigint' ? v.toString() : v));
}

async function withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await harness.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

/**
 * Materialise one window instance and set its REALISED spend, by direct SQL.
 *
 * `24 §3` K5: "An update that increases only realised passes the guard unconditionally, even
 * where the resulting four-term sum exceeds max_monetary." So realised is the term a fixture
 * can set without asking the guard's permission, which is what makes it the right lever for
 * pre-loading a window.
 *
 * Written as raw SQL rather than through `ensureWindowInstance`/`applyRealised`, so the
 * fixture's own setup does not depend on the production writers whose behaviour is under
 * test.
 */
async function preloadRealised(
  client: PoolClient,
  windowId: string,
  realised: string,
): Promise<void> {
  const key = expectedInstanceKey(windowId, FIXTURE_NOW);
  await client.query(
    `INSERT INTO window_balance (
       company_id, window_id, window_instance_key,
       max_monetary, max_monetary_unbounded,
       max_count, max_count_unbounded,
       max_irrecoverable_units, max_irrecoverable_unbounded,
       realised_monetary)
     SELECT $1, $2, $3,
            w.max_monetary, w.max_monetary_unbounded,
            w.max_count, w.max_count_unbounded,
            w.max_irrecoverable_units, w.max_irrecoverable_unbounded,
            $4::NUMERIC
       FROM window_registry w
      WHERE w.company_id = $1 AND w.window_id = $2
     ON CONFLICT (company_id, window_id, window_instance_key)
       DO UPDATE SET realised_monetary = $4::NUMERIC`,
    [COMPANY_ID, windowId, key, realised],
  );
}

async function assertNothingPersisted(where: string): Promise<void> {
  await withClient(async (client) => {
    for (const table of S1F_TABLES) {
      expect(await countOf(client, table), `${where}: ${table} is not empty`).toBe(0);
    }
    const balances = await rowsOf<{ window_id: string; reserved_monetary: string }>(
      client,
      `SELECT window_id, reserved_monetary FROM window_balance WHERE company_id = $1`,
      [COMPANY_ID],
    );
    for (const row of balances) {
      expect(row.reserved_monetary, `${where}: ${row.window_id}`).toBe('0.00');
    }
    expect(
      await scalar(client, `SELECT next_seq::TEXT FROM journal_counter WHERE company_id = $1`, [
        COMPANY_ID,
      ]),
      `${where}: journal gap`,
    ).toBe('1');
  });
}

beforeAll(async () => {
  harness = await createHarness();
});

afterAll(async () => {
  await harness.close();
});

beforeEach(async () => {
  await harness.reset();
  await withClient(async (client) => {
    await loadCommerceFixture(client);
    await loadS1eOrders(client);
    await loadAuthorityWorld(client);
  });
  kernel = makeLocalAuthorityHarness(harness);
});

// =====================================================================================
// One window passes, another fails — in both directions
// =====================================================================================

describe('a single window without headroom fails the ENTIRE transaction', () => {
  it('DAY has headroom, MONTH does not — production DENIES and persists nothing', async () => {
    await withClient(async (client) => {
      await preloadRealised(client, 'W_MONTH_REFUND', '241.00');
    });
    const outcome = await proposeAndAuthorise(kernel, S1E_PASS_ORDER);
    expect(outcome.outcome, json(outcome)).toBe('LOCAL_AUTHORISATION_DENIED');
    if (outcome.outcome !== 'LOCAL_AUTHORISATION_DENIED') return;
    expect(outcome.step).toBe('R');
    expect(outcome.code).toBe('WINDOW_EXHAUSTED');
    await assertNothingPersisted('month exhausted');
  });

  it('MONTH has headroom, DAY does not — production DENIES and persists nothing', async () => {
    await withClient(async (client) => {
      await preloadRealised(client, 'W_DAY_REFUND', '41.00');
    });
    const outcome = await proposeAndAuthorise(kernel, S1E_PASS_ORDER);
    expect(outcome.outcome, json(outcome)).toBe('LOCAL_AUTHORISATION_DENIED');
    if (outcome.outcome !== 'LOCAL_AUTHORISATION_DENIED') return;
    expect(outcome.step).toBe('R');
    expect(outcome.code).toBe('WINDOW_EXHAUSTED');
    await assertNothingPersisted('day exhausted');
  });
});

describe('THE VULNERABLE CONTROL — an implementation that checks only one window', () => {
  /** The reservation spec the control and production both operate on. Hand-authored. */
  function spec(reservationId: string) {
    return {
      companyId: COMPANY_ID,
      authorisationId: `auth:unsafe-${reservationId}`,
      reservationId,
      actionClass: 'refund.create',
      resourceRef: S1E_PASS_ORDER.resourceRef,
      vendorAmount: money(S1F_EXPECTED.pass.vendorAmount),
      totalExposure: money(S1F_EXPECTED.pass.totalExposure),
      windows: EXPECTED_REFUND_WINDOWS.map((windowId) => ({
        windowId,
        windowInstanceKey: expectedInstanceKey(windowId, FIXTURE_NOW),
      })),
      at: FIXTURE_NOW,
      countUnits: 1n,
    };
  }

  it('MONTH exhausted — the control COMMITS by checking only DAY, production DENIES', async () => {
    await withClient(async (client) => {
      await preloadRealised(client, 'W_DAY_REFUND', '0.00');
      await preloadRealised(client, 'W_MONTH_REFUND', '241.00');
    });

    // VULNERABLE — checks only the day window, which has $50.00 of headroom.
    const unsafe = await withClient((client) =>
      unsafeReserveSingleWindow(client, spec('reservation:unsafe-1'), 'W_DAY_REFUND'),
    );
    expect(unsafe).toBe('COMMITTED');

    // And it left real exposure behind on ONE window and none on the other, which is the
    // partial commit the whole rule exists to forbid.
    await withClient(async (client) => {
      expect(
        await scalar(
          client,
          `SELECT reserved_monetary FROM window_balance
            WHERE company_id = $1 AND window_id = 'W_DAY_REFUND'`,
          [COMPANY_ID],
        ),
      ).toBe('10.00');
      expect(
        await scalar(
          client,
          `SELECT reserved_monetary FROM window_balance
            WHERE company_id = $1 AND window_id = 'W_MONTH_REFUND'`,
          [COMPANY_ID],
        ),
      ).toBe('0.00');
      // Clean up the control's rows so production runs against the same fixture the
      // control did.
      await client.query(`DELETE FROM reservation_window_instance`);
      await client.query(`DELETE FROM exposure_reservation`);
      await client.query(
        `UPDATE window_balance SET reserved_monetary = 0.00, reserved_count = 0
          WHERE company_id = $1`,
        [COMPANY_ID],
      );
    });

    // PRODUCTION — the same fixture, the same exposure, the same windows.
    const outcome = await proposeAndAuthorise(kernel, S1E_PASS_ORDER);
    expect(outcome.outcome, json(outcome)).toBe('LOCAL_AUTHORISATION_DENIED');

    // THE TEST DISCRIMINATES: the two implementations disagree on ONE fixture.
    expect(unsafe).toBe('COMMITTED');
    expect(outcome.outcome).toBe('LOCAL_AUTHORISATION_DENIED');
  });

  it('DAY exhausted — the control COMMITS by checking only MONTH, production DENIES', async () => {
    await withClient(async (client) => {
      await preloadRealised(client, 'W_DAY_REFUND', '41.00');
      await preloadRealised(client, 'W_MONTH_REFUND', '0.00');
    });

    // VULNERABLE — the roles reversed: only the month window, which has $250.00.
    const unsafe = await withClient((client) =>
      unsafeReserveSingleWindow(client, spec('reservation:unsafe-2'), 'W_MONTH_REFUND'),
    );
    expect(unsafe).toBe('COMMITTED');

    await withClient(async (client) => {
      expect(
        await scalar(
          client,
          `SELECT reserved_monetary FROM window_balance
            WHERE company_id = $1 AND window_id = 'W_MONTH_REFUND'`,
          [COMPANY_ID],
        ),
      ).toBe('10.00');
      await client.query(`DELETE FROM reservation_window_instance`);
      await client.query(`DELETE FROM exposure_reservation`);
      await client.query(
        `UPDATE window_balance SET reserved_monetary = 0.00, reserved_count = 0
          WHERE company_id = $1`,
        [COMPANY_ID],
      );
    });

    const outcome = await proposeAndAuthorise(kernel, S1E_PASS_ORDER);
    expect(outcome.outcome, json(outcome)).toBe('LOCAL_AUTHORISATION_DENIED');
    expect(unsafe).toBe('COMMITTED');
  });

  it('AND THE CONTROL IS NOT BROKEN — with both windows clear, BOTH implementations commit', async () => {
    // Without this, "the control committed and production denied" would be compatible with
    // a control that always commits and a production path that always denies.
    await withClient(async (client) => {
      // The control does not materialise instances — that is production's job at step R —
      // so the fixture materialises both at zero before running it.
      await preloadRealised(client, 'W_DAY_REFUND', '0.00');
      await preloadRealised(client, 'W_MONTH_REFUND', '0.00');
    });
    const unsafe = await withClient((client) =>
      unsafeReserveSingleWindow(client, spec('reservation:unsafe-3'), 'W_DAY_REFUND'),
    );
    expect(unsafe).toBe('COMMITTED');
    await withClient(async (client) => {
      await client.query(`DELETE FROM reservation_window_instance`);
      await client.query(`DELETE FROM exposure_reservation`);
      await client.query(
        `UPDATE window_balance SET reserved_monetary = 0.00, reserved_count = 0
          WHERE company_id = $1`,
        [COMPANY_ID],
      );
    });
    const outcome = await proposeAndAuthorise(kernel, S1E_PASS_ORDER);
    expect(outcome.outcome, json(outcome)).toBe('LOCAL_AUTHORISATION_COMMITTED');
  });
});

// =====================================================================================
// The S1A four-term guard is the actual enforcement, reached through the live S1E→S1F path
// =====================================================================================

describe('the DB guard bounds the live path, at the boundary and one cent past it', () => {
  it('EXACT BOUNDARY — $40.00 realised leaves exactly $10.00, and it PERMITS', async () => {
    // `24 §3` K5's printed guard refuses a sum that is `> max_monetary`. Equality is
    // therefore admitted, and this asserts that reading rather than assuming it.
    await withClient(async (client) => {
      await preloadRealised(client, 'W_DAY_REFUND', '40.00');
    });
    const outcome = await proposeAndAuthorise(kernel, S1E_PASS_ORDER);
    expect(outcome.outcome, json(outcome)).toBe('LOCAL_AUTHORISATION_COMMITTED');
    await withClient(async (client) => {
      // $40.00 realised + $10.00 reserved = $50.00, exactly the ceiling.
      expect(
        await scalar(
          client,
          `SELECT (reserved_monetary + standing_monetary + presumed_monetary + realised_monetary)::TEXT
             FROM window_balance WHERE company_id = $1 AND window_id = 'W_DAY_REFUND'`,
          [COMPANY_ID],
        ),
      ).toBe('50.00');
    });
  });

  it('ONE MINIMUM CURRENCY UNIT OVER — $40.01 realised DENIES and rolls back', async () => {
    await withClient(async (client) => {
      await preloadRealised(client, 'W_DAY_REFUND', '40.01');
    });
    const outcome = await proposeAndAuthorise(kernel, S1E_PASS_ORDER);
    expect(outcome.outcome, json(outcome)).toBe('LOCAL_AUTHORISATION_DENIED');
    if (outcome.outcome !== 'LOCAL_AUTHORISATION_DENIED') return;
    expect(outcome.code).toBe('WINDOW_EXHAUSTED');
    await withClient(async (client) => {
      for (const table of S1F_TABLES) {
        expect(await countOf(client, table), table).toBe(0);
      }
    });
  });

  it('the REALISED term participates — it is not merely stored', async () => {
    // The same proposal, twice, differing only in the realised term. A guard reading three
    // terms would admit both.
    await withClient(async (client) => {
      await preloadRealised(client, 'W_DAY_REFUND', '39.99');
    });
    expect((await proposeAndAuthorise(kernel, S1E_PASS_ORDER)).outcome).toBe(
      'LOCAL_AUTHORISATION_COMMITTED',
    );

    await harness.reset();
    await withClient(async (client) => {
      await loadCommerceFixture(client);
      await loadS1eOrders(client);
      await loadAuthorityWorld(client);
      await preloadRealised(client, 'W_DAY_REFUND', '40.01');
    });
    kernel = makeLocalAuthorityHarness(harness);
    expect((await proposeAndAuthorise(kernel, S1E_PASS_ORDER)).outcome).toBe(
      'LOCAL_AUTHORISATION_DENIED',
    );
  });

  it('the COUNT ledger participates — `W_DAY_REFUND.max_count = 2` binds the third refund', async () => {
    // `51 §2` declares max_count 2 for the day window. Three authorisations of the same
    // class against different orders would fit the monetary ceiling ($30.00 of $50.00) and
    // must still be refused by the count ledger.
    //
    // The fixture has two orders, so the count is driven to its ceiling by pre-loading
    // `realised_count` — the count analogue of the realised-monetary lever, and admitted by
    // the guard for the same reason.
    await withClient(async (client) => {
      await preloadRealised(client, 'W_DAY_REFUND', '0.00');
      await client.query(
        `UPDATE window_balance SET realised_count = 2
          WHERE company_id = $1 AND window_id = 'W_DAY_REFUND'`,
        [COMPANY_ID],
      );
    });
    const outcome = await proposeAndAuthorise(kernel, S1E_PASS_ORDER);
    expect(outcome.outcome, json(outcome)).toBe('LOCAL_AUTHORISATION_DENIED');
    if (outcome.outcome !== 'LOCAL_AUTHORISATION_DENIED') return;
    expect(outcome.code).toBe('WINDOW_EXHAUSTED');
  });
});

// =====================================================================================
// Multi-grant composition: UNION over windows, INTERSECTION over bounds
// =====================================================================================

describe('the accepted S1E owner ruling survives step R', () => {
  it('a SECOND matching grant UNIONS its window into the reservation', async () => {
    // S1E-C4: "window sets compose by UNION and step R must reserve against every
    // referenced applicable window". The second grant names a window the first does not, so
    // after S1F the effect must be bound by THREE instances.
    await withClient(async (client) => {
      await insertGrant(client, {
        grantId: 'grant:s1f:refund.create:second',
        actionClasses: ['refund.create'],
        windows: ['W_MONTH_CREDIT'],
      });
    });
    const outcome = await proposeAndAuthorise(kernel, S1E_PASS_ORDER);
    expect(outcome.outcome, json(outcome)).toBe('LOCAL_AUTHORISATION_COMMITTED');
    if (outcome.outcome !== 'LOCAL_AUTHORISATION_COMMITTED') return;

    // The expected union, hand-authored: the first grant's two windows plus the second
    // grant's one.
    const expected = ['W_DAY_REFUND', 'W_MONTH_CREDIT', 'W_MONTH_REFUND'];
    expect(outcome.windowInstances.map((w) => w.windowId).sort()).toEqual(expected);

    await withClient(async (client) => {
      const bound = await rowsOf<{ window_id: string }>(
        client,
        `SELECT window_id FROM reservation_window_instance
          WHERE reservation_id = $1 ORDER BY window_id`,
        [outcome.reservationId],
      );
      expect(bound.map((r) => r.window_id)).toEqual(expected);
      // And the money moved on all three.
      for (const windowId of expected) {
        expect(
          await scalar(
            client,
            `SELECT reserved_monetary FROM window_balance
              WHERE company_id = $1 AND window_id = $2`,
            [COMPANY_ID, windowId],
          ),
          windowId,
        ).toBe(S1F_EXPECTED.pass.totalExposure);
      }
    });
  });

  it('the UNIONED window can DENY — adding a grant never widens', async () => {
    // S1E-C4: "adding a matching grant may never widen." The second grant's window is
    // pre-loaded to the point of exhaustion; the effect fitted comfortably before the grant
    // existed and must now be refused.
    await withClient(async (client) => {
      await insertGrant(client, {
        grantId: 'grant:s1f:refund.create:second',
        actionClasses: ['refund.create'],
        windows: ['W_MONTH_CREDIT'],
      });
      // `51 §2`: W_MONTH_CREDIT.max_monetary = $50.00. $41.00 realised leaves $9.00.
      await preloadRealised(client, 'W_MONTH_CREDIT', '41.00');
    });
    const outcome = await proposeAndAuthorise(kernel, S1E_PASS_ORDER);
    expect(outcome.outcome, json(outcome)).toBe('LOCAL_AUTHORISATION_DENIED');
    await assertNothingPersisted('unioned window exhausted');
  });

  it('the INTERSECTION narrows the authority, and it denies BEFORE R is reached', async () => {
    // S1E-C4, ACCEPTED: "The effective authority is the most restrictive authority permitted
    // by every simultaneously matching grant [...] recoverability and capability constraints
    // may not become more permissive because another matching grant exists."
    //
    // `recoverability_max` is the dimension used here rather than `per_action_max`, and the
    // reason is an ACCEPTED S1D/S1E boundary that S1F must not quietly move.
    // `grants.ts` states it: "The per-action cap that binds is still the one in the Cedar
    // artifact [...] Moving the binding figure into a database row would put the money cap
    // somewhere a compromised writer could raise, which is the opposite of `26 §11`'s 'No
    // runtime editing'." So a grant row's `per_action_max` does not decide step M and a test
    // asserting that it does would be asserting a defect.
    //
    // `recoverability_max` IS a grant-row operand and step J compares against the
    // intersected value. `refund.create` is COMPENSABLE (`26 §5`), so a second matching
    // grant capped at REVERSIBLE must deny — the broad grant's COMPENSABLE authority may
    // not survive it.
    await withClient(async (client) => {
      await insertGrant(client, {
        grantId: 'grant:s1f:refund.create:narrow',
        actionClasses: ['refund.create'],
        windows: ['W_DAY_REFUND', 'W_MONTH_REFUND'],
        recoverabilityMax: 'REVERSIBLE',
      });
    });
    const outcome = await proposeAndAuthorise(kernel, S1E_PASS_ORDER);
    expect(outcome.outcome, json(outcome)).toBe('DENIED');
    if (outcome.outcome !== 'DENIED') return;
    expect(outcome.step).toBe('J');
    expect(outcome.code).toBe('RECOVERABILITY');
    // And nothing was locked or reserved: `26 §7` puts J before R.
    await assertNothingPersisted('narrower grant');
  });

  it('AND IT DISCRIMINATES — without the narrow grant the same fixture COMMITS', async () => {
    // Otherwise "a narrower grant denies" would be compatible with a fixture that denies
    // for some other reason entirely.
    const outcome = await proposeAndAuthorise(kernel, S1E_PASS_ORDER);
    expect(outcome.outcome, json(outcome)).toBe('LOCAL_AUTHORISATION_COMMITTED');
  });
});

// =====================================================================================
// The acquisition order is the declared one, observed
// =====================================================================================

describe('the money-path lock order, observed on the live S1F path', () => {
  it('window_balance ascending, then standing rows, then journal_counter LAST', async () => {
    // The EXPECTED order is written out HERE, transcribed from `30 §5.2` and the S1A owner
    // clarification. It is not read from `declaredOrder` or from `lockOrder.ts`.
    const EXPECTED: readonly string[] = [
      'W_DAY_REFUND',
      'W_MONTH_REFUND',
      'journal_counter',
    ];

    const observed: string[] = [];
    const client = await harness.connect();
    try {
      // The pipeline runs on the LEASE's connection, so the recorder is installed on the
      // pool's client factory instead: every `FOR UPDATE` statement the transaction issues
      // is recorded in the order PostgreSQL received it, which IS the acquisition order.
      const original = harness.pool.connect.bind(harness.pool);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (harness.pool as any).connect = async () => {
        const leased = await original();
        const query = leased.query.bind(leased);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (leased as any).query = (...args: unknown[]) => {
          const text = typeof args[0] === 'string' ? args[0] : '';
          if (text.includes('FOR UPDATE')) {
            const params = args[1] as unknown[] | undefined;
            observed.push(String(params?.[1] ?? 'journal_counter'));
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (query as any)(...args);
        };
        return leased;
      };
      try {
        const outcome = await proposeAndAuthorise(kernel, S1E_PASS_ORDER);
        expect(outcome.outcome).toBe('LOCAL_AUTHORISATION_COMMITTED');
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (harness.pool as any).connect = original;
      }
    } finally {
      client.release();
    }

    // Duplicate acquisitions of an already-held row are re-locks, not reorderings: the
    // accepted step-R implementation takes the same locks again through the same helper.
    // What matters is the ORDER OF FIRST ACQUISITION, so the trace is de-duplicated.
    const firstAcquisition: string[] = [];
    for (const name of observed) {
      if (!firstAcquisition.includes(name)) firstAcquisition.push(name);
    }
    expect(firstAcquisition).toEqual([...EXPECTED]);
  });

  it('NO deadlock is produced by the legitimate order under contention', async () => {
    // `30 §5.2`: "`36 §2.5`'s concurrency test asserts no deadlock under N concurrent
    // same-order refunds." Both orders touch the same two window rows in the same order, so
    // there is no cycle to detect. `40001` is expected and is absorbed by the bounded retry;
    // `40P01` is a defect and would propagate.
    const results = await Promise.all([
      proposeAndAuthorise(kernel, S1E_PASS_ORDER),
      proposeAndAuthorise(kernel, S1E_PASS_ORDER),
    ]);
    for (const outcome of results) {
      // Either outcome is admissible — the second is a duplicate of the first by
      // idempotency key, because `reason_code` is not a member of the effect key. What is
      // NOT admissible is a `40P01`, which would have thrown out of `proposeAndAuthorise`.
      expect(
        ['LOCAL_AUTHORISATION_COMMITTED', 'DUPLICATE_PRIOR_RESULT'],
        json(outcome),
      ).toContain(outcome.outcome);
    }
  });
});
