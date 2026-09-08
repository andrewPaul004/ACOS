import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { PoolClient } from 'pg';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { money } from '../../src/kernel/exposure/money.js';
import { createHarness, type Harness } from '../support/fixture.js';
import { loadCommerceFixture } from '../support/enumerationFixture.js';
import {
  S1E_PASS_ORDER,
  loadAuthorityWorld,
  loadS1eOrders,
} from '../support/authorityFixture.js';
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
  scalar,
  type LocalAuthorityHarness,
} from '../support/localAuthorisationFixture.js';
import {
  unsafeReserveVendorAmount,
  unsafeTwoTransactionCommit,
} from './unsafe-local-authorisation.js';

/**
 * THE REMAINING S1F ADVERSARIAL CONTROLS.
 *
 * The multi-window control lives in
 * tests/integration/authority/multi-window-binding.test.ts, the rate-class controls in
 * tests/integration/authority/rate-class-local-authorisation.test.ts, the duplicate control
 * in tests/integration/authority/local-idempotency.test.ts and the lock-order control in
 * tests/integration/authority/journal-sequencing.test.ts — each next to the property it
 * discriminates, which is where a reader looking for the property will look.
 *
 * This file holds the three that belong to no single property: the reservation QUANTITY,
 * the transaction BOUNDARY, and the immutability of the canonical effect between S1E and
 * step R.
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

async function preloadRealised(
  client: PoolClient,
  windowId: string,
  realised: string,
): Promise<void> {
  await client.query(
    `INSERT INTO window_balance (
       company_id, window_id, window_instance_key,
       max_monetary, max_monetary_unbounded, max_count, max_count_unbounded,
       max_irrecoverable_units, max_irrecoverable_unbounded, realised_monetary)
     SELECT $1, $2, $3, w.max_monetary, w.max_monetary_unbounded,
            w.max_count, w.max_count_unbounded,
            w.max_irrecoverable_units, w.max_irrecoverable_unbounded, $4::NUMERIC
       FROM window_registry w WHERE w.company_id = $1 AND w.window_id = $2
     ON CONFLICT (company_id, window_id, window_instance_key)
       DO UPDATE SET realised_monetary = $4::NUMERIC`,
    [COMPANY_ID, windowId, expectedInstanceKey(windowId, FIXTURE_NOW), realised],
  );
}

async function clearAttempt(client: PoolClient): Promise<void> {
  await client.query(`DELETE FROM reservation_window_instance`);
  await client.query(`DELETE FROM exposure_reservation`);
  await client.query(`DELETE FROM authorisation_window_instance`);
  await client.query(`DELETE FROM authorisation`);
  await client.query(
    `UPDATE window_balance SET reserved_monetary = 0.00, reserved_count = 0
      WHERE company_id = $1`,
    [COMPANY_ID],
  );
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
// CONTROL — the reservation quantity
// =====================================================================================

describe('CONTROL — reserving `vendor_amount` instead of `total_exposure`', () => {
  /**
   * The discriminating fixture, hand-authored.
   *
   *   W_DAY_REFUND ceiling                      $50.00   (`51 §2`)
   *   realised, pre-loaded                      $40.50
   *   headroom                                   $9.50
   *   vendor_amount                              $9.41    <= $9.50   -> the control COMMITS
   *   total_exposure  ($9.41 + $0.59)           $10.00    >  $9.50   -> production DENIES
   *
   * The gap between the two is the retained processing fee, which `26 §2.1.1` calls "the fee
   * that does not come back". One fixture, one cent of margin either side of it, and the two
   * implementations disagree.
   */
  const REALISED = '40.50';

  function spec(id: string) {
    return {
      companyId: COMPANY_ID,
      authorisationId: `auth:unsafe-vendor-${id}`,
      reservationId: `reservation:unsafe-vendor-${id}`,
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

  it('VULNERABLE — the control COMMITS, and reserves $9.41 where $10.00 is owed', async () => {
    await withClient(async (client) => {
      await preloadRealised(client, 'W_DAY_REFUND', REALISED);
      await preloadRealised(client, 'W_MONTH_REFUND', '0.00');
    });
    const unsafe = await withClient((client) => unsafeReserveVendorAmount(client, spec('a')));
    expect(unsafe).toBe('COMMITTED');
    await withClient(async (client) => {
      // The under-reservation is real and it is exactly the retained fee.
      expect(
        await scalar(
          client,
          `SELECT amount FROM exposure_reservation WHERE reservation_id = $1`,
          ['reservation:unsafe-vendor-a'],
        ),
      ).toBe(S1F_EXPECTED.pass.vendorAmount);
      expect(
        await scalar(
          client,
          `SELECT (reserved_monetary + realised_monetary)::TEXT FROM window_balance
            WHERE company_id = $1 AND window_id = 'W_DAY_REFUND'`,
          [COMPANY_ID],
        ),
      ).toBe('49.91');
    });
  });

  it('PRODUCTION on the SAME fixture DENIES — I18b binds the total, not the vendor amount', async () => {
    await withClient(async (client) => {
      await preloadRealised(client, 'W_DAY_REFUND', REALISED);
      await preloadRealised(client, 'W_MONTH_REFUND', '0.00');
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

  it('AND THE CONTROL IS NOT BROKEN — at $40.00 realised BOTH commit', async () => {
    // $10.00 of headroom admits both quantities, so the two implementations agree. Without
    // this, "the control commits and production denies" would be compatible with a control
    // that always commits.
    await withClient(async (client) => {
      await preloadRealised(client, 'W_DAY_REFUND', '40.00');
      await preloadRealised(client, 'W_MONTH_REFUND', '0.00');
    });
    const unsafe = await withClient((client) => unsafeReserveVendorAmount(client, spec('b')));
    expect(unsafe).toBe('COMMITTED');
    await withClient(clearAttempt);
    await withClient(async (client) => {
      await preloadRealised(client, 'W_DAY_REFUND', '40.00');
    });
    const outcome = await proposeAndAuthorise(kernel, S1E_PASS_ORDER);
    expect(outcome.outcome, json(outcome)).toBe('LOCAL_AUTHORISATION_COMMITTED');
  });
});

// =====================================================================================
// CONTROL — the transaction boundary
// =====================================================================================

describe('CONTROL — the reservation and the decision in SEPARATE transactions', () => {
  it('VULNERABLE — a crash between them strands a reservation with no decision', async () => {
    // `33 §1`: the four rows "commit or fail together, as a single Postgres transaction".
    // This is what "together" buys, measured: the two-transaction shape's success path is
    // indistinguishable from production's, and its crash path is not.
    await withClient(async (client) => {
      await preloadRealised(client, 'W_DAY_REFUND', '0.00');
      await preloadRealised(client, 'W_MONTH_REFUND', '0.00');
    });
    const spec = {
      companyId: COMPANY_ID,
      authorisationId: 'auth:unsafe-two-tx',
      reservationId: 'reservation:unsafe-two-tx',
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
    const decision = {
      decisionId: 'decision:unsafe-two-tx',
      effectId: 'effect:unsafe-two-tx',
      idempotencyKey: 'idem:unsafe-two-tx',
      adapter: 'mock_processor',
      recoverability: 'COMPENSABLE',
      principalId: 'principal:support_reasoner:1',
      sessionId: 'session:S1E-worker-1',
      taskId: 'task:T-S1C-1',
      resourceId: S1E_PASS_ORDER.orderId,
    };

    await withClient((client) =>
      unsafeTwoTransactionCommit(client, spec, decision, /* failBetween */ true),
    );

    await withClient(async (client) => {
      // THE STRANDED STATE. Headroom is consumed, and nothing authorises it.
      expect(await countOf(client, 'exposure_reservation')).toBe(1);
      expect(await countOf(client, 'authorisation')).toBe(1);
      expect(
        await scalar(
          client,
          `SELECT reserved_monetary FROM window_balance
            WHERE company_id = $1 AND window_id = 'W_DAY_REFUND'`,
          [COMPANY_ID],
        ),
      ).toBe(S1F_EXPECTED.pass.totalExposure);
      // No decision, no effect, no journal row. `I2` is unsatisfiable for this reservation
      // and `30 §5.1`'s journal has no record that the money was taken.
      expect(await countOf(client, 'authorisation_decision')).toBe(0);
      expect(await countOf(client, 'effect')).toBe(0);
      expect(await countOf(client, 'effect_journal')).toBe(0);
    });
  });

  it('PRODUCTION at the same point leaves NOTHING — the abort takes the reservation with it', async () => {
    await expect(
      proposeAndAuthorise(kernel, S1E_PASS_ORDER, {
        at: async (point) => {
          // The production equivalent of the control's crash: the reservation is written,
          // and the process dies before the decision.
          if (point === 'AFTER_RESERVATION_ROW') throw new Error('crash after reservation');
        },
      }),
    ).rejects.toThrow('crash after reservation');

    await withClient(async (client) => {
      for (const table of S1F_TABLES) {
        expect(await countOf(client, table), table).toBe(0);
      }
      expect(
        await scalar(
          client,
          `SELECT count(*)::TEXT FROM window_balance
            WHERE company_id = $1 AND reserved_monetary <> 0.00`,
          [COMPANY_ID],
        ),
      ).toBe('0');
    });
    // THE TEST DISCRIMINATES: one stranded reservation under the control, zero under
    // production, at the same point in the same sequence.
  });

  it('AND THE CONTROL IS NOT BROKEN — without the crash it commits both halves', async () => {
    await withClient(async (client) => {
      await preloadRealised(client, 'W_DAY_REFUND', '0.00');
      await preloadRealised(client, 'W_MONTH_REFUND', '0.00');
    });
    await withClient((client) =>
      unsafeTwoTransactionCommit(
        client,
        {
          companyId: COMPANY_ID,
          authorisationId: 'auth:unsafe-two-tx-ok',
          reservationId: 'reservation:unsafe-two-tx-ok',
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
        },
        {
          decisionId: 'decision:unsafe-two-tx-ok',
          effectId: 'effect:unsafe-two-tx-ok',
          idempotencyKey: 'idem:unsafe-two-tx-ok',
          adapter: 'mock_processor',
          recoverability: 'COMPENSABLE',
          principalId: 'principal:support_reasoner:1',
          sessionId: 'session:S1E-worker-1',
          taskId: 'task:T-S1C-1',
          resourceId: S1E_PASS_ORDER.orderId,
        },
        /* failBetween */ false,
      ),
    );
    await withClient(async (client) => {
      expect(await countOf(client, 'exposure_reservation')).toBe(1);
      expect(await countOf(client, 'authorisation_decision')).toBe(1);
      expect(await countOf(client, 'effect')).toBe(1);
    });
  });
});

// =====================================================================================
// CONTROL — a mutable canonical effect between S1E and step R
// =====================================================================================

describe('CONTROL — the canonical effect cannot change economically between Cedar and R', () => {
  it('the S1E result is FROZEN — a write to its exposure is refused', async () => {
    // The accepted S1B/S1E `freezeCanonicalEffect` is what makes this true; S1F restates it
    // because S1F is the first slice with a WRITER downstream of the freeze.
    const kernelHarness = kernel;
    const outcome = await kernelHarness.leases.withEntityLease(
      { companyId: COMPANY_ID, entityType: 'order', entityId: S1E_PASS_ORDER.orderId },
      async () => undefined,
    );
    void outcome;

    const pre = await import('../support/authorityFixture.js');
    const s1e = await pre.proposeUnderLease(kernel, S1E_PASS_ORDER);
    expect(s1e.outcome, json(s1e)).toBe('PRE_RESERVATION_PASS');
    if (s1e.outcome !== 'PRE_RESERVATION_PASS') return;

    expect(Object.isFrozen(s1e.request)).toBe(true);
    expect(Object.isFrozen(s1e.request.exposure)).toBe(true);
    // In an ES module (strict mode) a write to a frozen property THROWS rather than being
    // silently dropped, which is the difference between a defect that is loud and one that
    // reaches settlement.
    expect(() => {
      (s1e.request.exposure as { totalExposure: bigint }).totalExposure = 1n;
    }).toThrow();
    expect(() => {
      (s1e.request as { exposure: unknown }).exposure = {};
    }).toThrow();
  });

  it('AUTHORITATIVE STATE moving after C′ does NOT move the committed reservation', async () => {
    // The stronger, runtime half. The proposal is parked at the edge into step R — after
    // Cedar, before the money path — and the underlying commerce row is then changed and
    // committed by a SEPARATE connection. The reservation that commits must be the one C′
    // computed, not a recomputation.
    //
    // `26 §7`'s property 2: "The kernel constructs the request (step C′)." A reservation
    // recomputed at R would mean the amount Cedar approved and the amount reserved were
    // computed at different instants from different state, which is the CAN-01 shape.
    let mutated = false;
    const outcome = await proposeAndAuthorise(kernel, S1E_PASS_ORDER, {
      barrier: async () => {
        if (mutated) return;
        mutated = true;
        await withClient(async (client) => {
          await client.query(
            `UPDATE commerce_order_line SET refundable_remaining = 99.00
              WHERE company_id = $1 AND line_id = $2`,
            [COMPANY_ID, S1E_PASS_ORDER.lineId],
          );
          await client.query(
            `UPDATE commerce_parent_transaction SET refundable_remaining = 99.00
              WHERE company_id = $1 AND parent_transaction_id = $2`,
            [COMPANY_ID, S1E_PASS_ORDER.parentTransactionId],
          );
          await client.query(
            `UPDATE commerce_refund_retained_fee SET amount = 40.00
              WHERE company_id = $1 AND line_id = $2`,
            [COMPANY_ID, S1E_PASS_ORDER.lineId],
          );
        });
      },
    });
    expect(mutated).toBe(true);
    expect(outcome.outcome, json(outcome)).toBe('LOCAL_AUTHORISATION_COMMITTED');
    if (outcome.outcome !== 'LOCAL_AUTHORISATION_COMMITTED') return;

    await withClient(async (client) => {
      // The FROZEN economics, not the mutated ones. $99.00 + $40.00 would have been
      // $139.00, which would also have exceeded the $25.00 per-action bound and the $50.00
      // day ceiling — so a recomputing implementation would have produced a different
      // outcome entirely, not merely a different amount.
      expect(
        await scalar(
          client,
          `SELECT amount FROM exposure_reservation WHERE reservation_id = $1`,
          [outcome.reservationId],
        ),
      ).toBe(S1F_EXPECTED.pass.totalExposure);
      expect(
        await scalar(
          client,
          `SELECT total_exposure FROM authorisation WHERE authorisation_id = $1`,
          [outcome.authorisationId],
        ),
      ).toBe(S1F_EXPECTED.pass.totalExposure);
      expect(
        await scalar(
          client,
          `SELECT total_exposure FROM effect_journal WHERE company_id = $1`,
          [COMPANY_ID],
        ),
      ).toBe(S1F_EXPECTED.pass.totalExposure);
      // And the mutation really did land, so the test is not passing because nothing moved.
      expect(
        await scalar(
          client,
          `SELECT refundable_remaining FROM commerce_order_line
            WHERE company_id = $1 AND line_id = $2`,
          [COMPANY_ID, S1E_PASS_ORDER.lineId],
        ),
      ).toBe('99.00');
    });
  });
});

// =====================================================================================
// The controls are TEST-ONLY
// =====================================================================================

describe('nothing under `src/` imports a control', () => {
  it('the vulnerable module is unreachable from production code', async () => {
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
        // IMPORT STATEMENTS ONLY, over comment-stripped code. Several accepted modules
        // CITE a control by path in prose — `principal.ts` names
        // `unsafe-caller-supplied-principal.ts`, `liveSelector.ts` names
        // `unsafe-positional-selector.ts` — and a citation is documentation, not a
        // dependency. What must not exist is a real edge from `src/` into `tests/`.
        const code = (await readFile(path, 'utf8'))
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/(^|[^:])\/\/.*$/gm, '$1');
        for (const pattern of [
          /import[\s\S]{0,200}?from\s*'[^']*negative-controls/,
          /import[\s\S]{0,200}?from\s*'[^']*\/tests\//,
          /require\(\s*'[^']*negative-controls/,
        ]) {
          if (pattern.test(code)) offenders.push(`${path} (${String(pattern)})`);
        }
      }
    }
    await walk(root);
    expect(offenders, `src/ references a control:\n  ${offenders.join('\n  ')}`).toEqual([]);
  });

  it('and every control differs from production in a NAMED way', async () => {
    // The controls are worth having only if each one is a single named defect rather than a
    // second implementation that happens to behave differently. Asserted by requiring the
    // module to say which line differs, for each one.
    const source = await readFile(
      join(process.cwd(), 'tests', 'negative-controls', 'unsafe-local-authorisation.ts'),
      'utf8',
    );
    for (const marker of [
      'DEFECT 1 — the reservation quantity is `vendor_amount`',
      'DEFECT 2 — only ONE of the referenced windows is checked',
      'DEFECT 3 — the rate class puts `forward_integral` into the ORDINARY reservation amount',
      'DEFECT 4 — the zero-amount reservation row is OMITTED',
      'DEFECT 5 — the reservation and the decision commit in SEPARATE transactions',
      'DEFECT 6 — the journal counter is acquired FIRST',
      'DEFECT 7 — a duplicate is detected by a SELECT',
    ]) {
      expect(source, `the control module does not name: ${marker}`).toContain(marker);
    }
    expect(source).toContain('THE DEFECT:');
    // Seven named defects, and every one of them says what one expression or statement
    // differs.
    expect((source.match(/THE DEFECT:/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });
});

// =====================================================================================
// The isolation assertion is not decoration — MAL-08
// =====================================================================================

describe('the SERIALIZABLE assertion is not decoration — MAL-08', () => {
  /**
   * `33 §6`, verbatim: "v1.1: isolation is set and asserted at the connection, and the
   * constraint is the backstop rather than the guard (R9, MAL-08). v1.0 stated serialisable
   * as intent, and a reservation written inside a framework `@transaction` at default
   * isolation SILENTLY REINTRODUCES WRITE SKEW on the `SUM` guard — which `36 §14`'s 10x
   * load test CANNOT REPRODUCE."
   *
   * Two things are established here, and the second is the one that matters.
   */

  it('PostgreSQL itself refuses the framework-wrapper case, and NOTHING is written', async () => {
    // The hazard's shape: the S1F transaction opened inside somebody else's already-active
    // transaction. PostgreSQL treats the nested `BEGIN ISOLATION LEVEL SERIALIZABLE` as a
    // `SET TRANSACTION`, which is an ERROR once a statement has run in the outer
    // transaction — so the money path cannot start at all. Fail-closed, at the database,
    // before the production assertion is even reached.
    const { commitLocalAuthorisation } = await import(
      '../../src/kernel/authorisation/localAuthorisation.js'
    );
    const { rateFacts, rateExtension } = await import('../support/localAuthorisationFixture.js');

    let thrown: unknown = null;
    await kernel.leases.withEntityLease(
      { companyId: COMPANY_ID, entityType: 'campaign', entityId: 'CMP-S1F-1' },
      async (lease) => {
        await lease.client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
        try {
          // A statement inside the outer transaction, which is what a framework wrapper
          // would have done before handing control to the money path.
          await lease.client.query('SELECT 1');
          try {
            await commitLocalAuthorisation(
              lease,
              { kind: 'RATE', facts: rateFacts(), rate: rateExtension(FIXTURE_NOW) },
              kernel.commitOptions(),
            );
          } catch (error) {
            thrown = error;
          }
        } finally {
          await lease.client.query('ROLLBACK');
        }
      },
    );

    expect(thrown).not.toBeNull();
    expect(String((thrown as Error).message)).toContain('SET TRANSACTION ISOLATION LEVEL');
    await withClient(async (client) => {
      for (const table of S1F_TABLES) {
        expect(await countOf(client, table), table).toBe(0);
      }
    });
  });

  it('a REPEATABLE READ transaction reports a level the assertion would refuse', async () => {
    // The assertion compares against the literal `'serializable'`. This is the measurement
    // that the comparison is capable of failing: the same read, in a REPEATABLE READ
    // transaction, returns something else. Without it, "the level is serializable" would be
    // compatible with a read that returns that string unconditionally.
    await withClient(async (client) => {
      for (const [level, expected] of [
        ['SERIALIZABLE', 'serializable'],
        ['REPEATABLE READ', 'repeatable read'],
        ['READ COMMITTED', 'read committed'],
      ] as const) {
        await client.query(`BEGIN ISOLATION LEVEL ${level}`);
        try {
          expect(await scalar(client, `SELECT current_setting('transaction_isolation')`)).toBe(
            expected,
          );
        } finally {
          await client.query('ROLLBACK');
        }
      }
    });
  });

  it('and the assertion reads the DATABASE rather than an application constant', async () => {
    const source = await readFile(
      join(process.cwd(), 'src', 'kernel', 'authorisation', 'localAuthorisation.ts'),
      'utf8',
    );
    expect(source).toContain(`current_setting('transaction_isolation')`);
    // The refusal is a throw, not a log line and not a fallback.
    expect(source).toMatch(/if \(level !== 'serializable'\) \{\s*throw new Error/);
    // And the level the money path asks for is SERIALIZABLE, hard-coded, with no caller
    // override: `LocalAuthorisationOptions` has no `isolation` member.
    expect(source).toContain("isolation: 'SERIALIZABLE'");
    expect(source).not.toMatch(/isolation:\s*options\./);
  });
});
