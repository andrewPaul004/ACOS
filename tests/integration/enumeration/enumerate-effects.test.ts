import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { toDb } from '../../../src/kernel/exposure/money.js';
import { computeOptionId } from '../../../src/kernel/canonicalisation/optionDigest.js';
import { refundSemanticOptionDigest } from '../../../src/kernel/canonicalisation/constructors/refundCreate.js';
import { CanonicalisationDenied } from '../../../src/kernel/canonicalisation/errors.js';
import type { SelectedAuthoritativeRefundOption } from '../../../src/kernel/canonicalisation/types.js';
import { createHarness, type Harness } from '../../support/fixture.js';
import {
  CAN03,
  TWO_BY_TWO,
  entityKeyFor,
  loadCommerceFixture,
  makeEnumerationHarness,
  makeSpec,
  type EnumerationHarness,
} from '../../support/enumerationFixture.js';

/**
 * `enumerate_effects` — the READ the model needs, over REAL PostgreSQL.
 *
 * `26 §2.0.1`, verbatim:
 *
 *   enumerate_effects(action_class, resource_ref)
 *     → EnumeratedOptionSet { enumeration_id, computed_at, constructor_version,
 *                             options[{ option_id, description }] }
 *
 * and its capability-kind row, verbatim: "**READ.** It creates no effect, reserves nothing
 * and dispatches nothing."
 */

let harness: Harness;
let kernel: EnumerationHarness;

beforeAll(async () => {
  harness = await createHarness();
});

afterAll(async () => {
  await harness.close();
});

beforeEach(async () => {
  await harness.reset();
  const client = await harness.connect();
  try {
    await loadCommerceFixture(client);
  } finally {
    client.release();
  }
  kernel = makeEnumerationHarness(harness);
});

describe('1 — a valid refund enumeration', () => {
  it('returns both refundable lines of the CAN-03 order', async () => {
    const outcome = await kernel.leases.withEntityLease(entityKeyFor(CAN03.orderId), (lease) =>
      kernel.enumerator.enumerate(lease, {
        actionClass: 'refund.create',
        resourceRef: CAN03.resourceRef,
        spec: makeSpec(),
      }),
    );

    expect(outcome.internalFailure).toBeNull();
    expect(outcome.set.options).toHaveLength(2);
    // `36 §2` VC-C3's fixture: [A: $10.00, B: $20.00].
    expect(outcome.authoritative.map((entry) => toDb(entry.option.amount))).toEqual([
      CAN03.lineAAmount,
      CAN03.lineBAmount,
    ]);
    expect(outcome.authoritative.map((entry) => entry.option.lineId)).toEqual([
      CAN03.lineA,
      CAN03.lineB,
    ]);
  });

  it('every amount is COMPUTED from authoritative state, bounded by both dimensions', async () => {
    // `26 §2.1`: parameters are "COMPUTED from selected_option — not supplied".
    // The transaction has $30.00 remaining and the lines have $10.00 and $20.00, so each
    // option's amount is its line's remaining — the binding constraint on this fixture.
    const outcome = await enumerateCan03();
    for (const entry of outcome.authoritative) {
      expect(toDb(entry.option.amount)).toBe(toDb(entry.option.lineRefundableRemaining));
    }
  });

  it('carries the AUTHORITATIVE retained fee for each pair, not a derived one', async () => {
    // S1B-C3a: an amount and the record it came from. The two lines carry DIFFERENT fees, so
    // an implementation reading the wrong row fails here rather than passing by symmetry.
    const outcome = await enumerateCan03();
    const fees = outcome.authoritative.map((entry) => ({
      line: entry.option.lineId,
      amount: entry.retainedProcessingFee === null ? null : toDb(entry.retainedProcessingFee.amount),
      source: entry.retainedProcessingFee?.sourceRef,
    }));
    expect(fees).toEqual([
      { line: CAN03.lineA, amount: CAN03.feeA, source: CAN03.feeSourceRef },
      { line: CAN03.lineB, amount: CAN03.feeB, source: CAN03.feeSourceRef },
    ]);
  });

  it('stamps computed_at from the INJECTED clock, not the wall clock', async () => {
    kernel.clock.set(new Date('2026-01-02T03:04:05.000Z'));
    const outcome = await enumerateCan03();
    expect(outcome.set.computedAt.toISOString()).toBe('2026-01-02T03:04:05.000Z');
  });

  it('stamps the VERIFIED constructor version (I61)', async () => {
    const outcome = await enumerateCan03();
    expect(outcome.set.constructorVersion.constructorId).toBe('ctor.refund.create');
    expect(outcome.set.constructorVersion.actionClass).toBe('refund.create');
    // Resolved through ConstructorVersionResolver, so `recordHash` is the hash of bytes
    // whose Ed25519 signature verified. An unsigned or mis-signed record cannot reach here.
    expect(outcome.set.constructorVersion.recordHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('records the enumeration in kernel state, with the ordered option ids', async () => {
    const outcome = await enumerateCan03();
    const client = await harness.connect();
    try {
      const row = await client.query<{ options: unknown; computed_at: Date; task_id: string }>(
        `SELECT options, computed_at, task_id FROM enumeration_record
          WHERE enumeration_id = $1`,
        [outcome.set.enumerationId],
      );
      expect(row.rowCount).toBe(1);
      // Ids AND the projected descriptions the model was shown — so C′ can compare against
      // what was actually read rather than against its own recomputation.
      expect(row.rows[0]!.options).toEqual(
        outcome.set.options.map((o) => ({ option_id: o.optionId, description: o.description })),
      );
      // `26 §1` Corollary 3: the max_age check must read a figure the KERNEL recorded.
      expect(row.rows[0]!.computed_at.toISOString()).toBe(outcome.set.computedAt.toISOString());
    } finally {
      client.release();
    }
  });

  it('is a READ — it writes no effect, no reservation and no journal row', async () => {
    await enumerateCan03();
    const client = await harness.connect();
    try {
      // `26 §2.0.1`: "It creates no effect, reserves nothing and dispatches nothing."
      const reservations = await client.query('SELECT 1 FROM exposure_reservation');
      expect(reservations.rowCount).toBe(0);
      // And the journal counter has not moved: S1C allocates no journal_seq, which is the
      // same fact `S1C-result.md` reports as VC-C2 journaling OPEN.
      const counter = await client.query<{ next_seq: string }>(
        'SELECT next_seq FROM journal_counter',
      );
      expect(counter.rows[0]!.next_seq).toBe('1');
    } finally {
      client.release();
    }
  });
});

describe('2 — the enumeration is two-dimensional over (line, parent_transaction)', () => {
  it('a 2-line, 2-transaction order produces FOUR options', async () => {
    // `26 §8`: "The refund enumeration is two-dimensional over (line, parent_transaction)".
    // A one-dimensional enumeration over lines would produce two.
    const outcome = await kernel.leases.withEntityLease(entityKeyFor(TWO_BY_TWO.orderId), (lease) =>
      kernel.enumerator.enumerate(lease, {
        actionClass: 'refund.create',
        resourceRef: TWO_BY_TWO.resourceRef,
        spec: makeSpec(),
      }),
    );
    expect(outcome.set.options).toHaveLength(4);
    expect(
      outcome.authoritative.map(
        (entry) => `${entry.option.lineId}|${entry.option.parentTransactionId}`,
      ),
    ).toEqual([
      `${TWO_BY_TWO.lines[0]}|${TWO_BY_TWO.transactions[0].id}`,
      `${TWO_BY_TWO.lines[0]}|${TWO_BY_TWO.transactions[1].id}`,
      `${TWO_BY_TWO.lines[1]}|${TWO_BY_TWO.transactions[0].id}`,
      `${TWO_BY_TWO.lines[1]}|${TWO_BY_TWO.transactions[1].id}`,
    ]);
  });

  it('the same line against two transactions gives two DIFFERENT option_ids', async () => {
    // `26 §8`: "instrument is enumerated, not asserted (SR-R3, RES-10, CAN-07)". The two
    // options below refund the same line for the same amount to DIFFERENT instruments, and
    // the architecture's whole point is that those are different effects.
    const outcome = await kernel.leases.withEntityLease(entityKeyFor(TWO_BY_TWO.orderId), (lease) =>
      kernel.enumerator.enumerate(lease, {
        actionClass: 'refund.create',
        resourceRef: TWO_BY_TWO.resourceRef,
        spec: makeSpec(),
      }),
    );
    const [first, second] = outcome.set.options;
    expect(first!.optionId).not.toBe(second!.optionId);
    expect(toDb(outcome.authoritative[0]!.option.amount)).toBe(
      toDb(outcome.authoritative[1]!.option.amount),
    );
    expect(outcome.authoritative[0]!.option.instrument).not.toBe(
      outcome.authoritative[1]!.option.instrument,
    );
  });
});

describe('3 — option_id is exactly the architecture-declared content address', () => {
  it('equals H(action_class ‖ resource_id ‖ semantic_option_digest), recomputed independently', async () => {
    // `26 §2.2`: option_id = H(action_class ‖ resource_id ‖ semantic_option_digest).
    // Recomputed here from the authoritative option through the same declared form, so an
    // enumerator that invented its own identity fails.
    const outcome = await enumerateCan03();
    for (const [index, entry] of outcome.authoritative.entries()) {
      const option = entry.option as SelectedAuthoritativeRefundOption;
      const expected = computeOptionId(
        'refund.create',
        option.resourceId,
        refundSemanticOptionDigest(option),
      );
      expect(outcome.set.options[index]!.optionId).toBe(expected);
    }
  });

  it('option ids are stable across two enumerations of unchanged state', async () => {
    const first = await enumerateCan03();
    const second = await enumerateCan03();
    expect(second.set.options.map((o) => o.optionId)).toEqual(
      first.set.options.map((o) => o.optionId),
    );
  });

  it('NO POSITIONAL IDENTITY — physically reordering the rows does not move any option_id', async () => {
    // The discriminating test for "content-addressed, never positional". The rows are
    // deleted and reinserted in the opposite physical order, which changes the heap order and
    // would change any identity derived from position. Every option_id must be unchanged.
    const before = await enumerateCan03();

    const client = await harness.connect();
    try {
      await client.query(
        `DELETE FROM commerce_refund_retained_fee WHERE company_id IS NOT NULL AND order_id = $1`,
        [CAN03.orderId],
      );
      await client.query(`DELETE FROM commerce_order_line WHERE order_id = $1`, [CAN03.orderId]);
      // B first this time.
      await client.query(
        `INSERT INTO commerce_order_line (company_id, order_id, line_id, refundable_remaining)
         VALUES ('co_s1a_fixture', $1, $2, $3::NUMERIC), ('co_s1a_fixture', $1, $4, $5::NUMERIC)`,
        [CAN03.orderId, CAN03.lineB, CAN03.lineBAmount, CAN03.lineA, CAN03.lineAAmount],
      );
      await client.query(
        `INSERT INTO commerce_refund_retained_fee
           (company_id, order_id, line_id, parent_transaction_id, amount, currency, source_ref)
         VALUES ('co_s1a_fixture', $1, $2, $3, $4::NUMERIC, 'USD', $6),
                ('co_s1a_fixture', $1, $5, $3, $7::NUMERIC, 'USD', $6)`,
        [
          CAN03.orderId,
          CAN03.lineB,
          CAN03.parentTransactionId,
          CAN03.feeB,
          CAN03.lineA,
          CAN03.feeSourceRef,
          CAN03.feeA,
        ],
      );
    } finally {
      client.release();
    }

    const after = await enumerateCan03();
    expect(new Set(after.set.options.map((o) => o.optionId))).toEqual(
      new Set(before.set.options.map((o) => o.optionId)),
    );
  });
});

describe('4 — the closed catalogue and the registered constructor gate the READ', () => {
  it('an action class outside the closed catalogue denies UNKNOWN_ACTION', async () => {
    await expect(
      kernel.leases.withEntityLease(entityKeyFor(CAN03.orderId), (lease) =>
        kernel.enumerator.enumerate(lease, {
          actionClass: 'refund.creat',
          resourceRef: CAN03.resourceRef,
          spec: makeSpec(),
        }),
      ),
    ).rejects.toMatchObject({ code: 'UNKNOWN_ACTION' });
  });

  it('a catalogued class with no registered constructor denies NOT_CANONICALISABLE', async () => {
    // `26 §11.2`: "Any class with no registered constructor | DENY: NOT_CANONICALISABLE at
    // step C2". A class ACOS cannot canonicalise is a class it must not enumerate either.
    const error = await kernel.leases
      .withEntityLease(entityKeyFor(CAN03.orderId), (lease) =>
        kernel.enumerator.enumerate(lease, {
          actionClass: 'campaign.pause',
          resourceRef: CAN03.resourceRef,
          spec: makeSpec(),
        }),
      )
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CanonicalisationDenied);
    expect((error as CanonicalisationDenied).code).toBe('NOT_CANONICALISABLE');
  });
});

async function enumerateCan03() {
  return kernel.leases.withEntityLease(entityKeyFor(CAN03.orderId), (lease) =>
    kernel.enumerator.enumerate(lease, {
      actionClass: 'refund.create',
      resourceRef: CAN03.resourceRef,
      spec: makeSpec(),
    }),
  );
}
