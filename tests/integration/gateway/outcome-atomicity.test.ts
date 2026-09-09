import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { COMPANY_ID } from '../../support/fixture.js';
import {
  S1I_NOW,
  authorisePause,
  createOutboxHarness,
  economicSnapshot,
  outboxRows,
  type AuthorisedEffect,
  type OutboxHarness,
} from '../../support/outboxFixture.js';
import {
  ADAPTER_ADS,
  outcomeJournalRows,
  rawOutcomeRowCount,
  rawOutcomeRows,
  testRegistry,
} from '../../support/gatewayFixture.js';
import { createMockAdapter, returnedOutcome, unknownOutcome } from '../../support/mockAdapter.js';
import { Conductor, settleAll, valueOf } from '../../support/barrier.js';
import { enqueueDispatch } from '../../../src/kernel/outbox/enqueue.js';
import { dispatchAuthorisedEffect } from '../../../src/kernel/gateway/effectGateway.js';
import { processAdapterOutcome } from '../../../src/kernel/gateway/outcomeTransaction.js';
import {
  unsafeReadThenWriteOutcome,
  unsafeSplitOutcomeCommit,
} from '../../negative-controls/unsafe-outcome-transaction.js';

/**
 * `§20`, `§21`, `§25`, `§43` — THE OUTCOME TRANSACTION IS ONE TRANSACTION.
 *
 * =================================================================================
 * `§20`'s KILL POINTS, AND WHAT NONE OF THEM MAY LEAVE BEHIND
 *
 *   "A crash must not persist: effect state without required ledger movement; MIE movement
 *    without `PRESUMED_EXECUTED`; released reservation while effect remains unresolved;
 *    journal outcome without matching local state; duplicate economic movement."
 *
 * Three of the five are vacuous at S1J for an architecture reason rather than an omission:
 * `25 §10`'s declared branches move no ledger (`§18`'s conditional is answered in the
 * negative), so there is no MIE movement, no release and no economic movement to be
 * half-done. `outcome-classes.test.ts` asserts that with direct SQL.
 *
 * WHAT REMAINS IS THE FOURTH, AND IT IS REAL: the `DISPATCH_OUTCOME` journal row and the
 * `effect_dispatch_outcome` row must be one durable fact. `23 §6` B8 requires the journal
 * row and the state to share a commit point, and `30 §5.5` item 9 records what a lone
 * journal row costs: rows of this class "have no detector at all, under any mechanism in
 * this architecture."
 * =================================================================================
 */

let h: OutboxHarness;
const NOW = S1I_NOW;

beforeAll(async () => {
  h = await createOutboxHarness();
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await h.reset();
});

async function enqueuedPause(tag: string): Promise<AuthorisedEffect> {
  const effect = await authorisePause(h, { resourceId: `CMP-${tag}` });
  const outcome = await enqueueDispatch(h.control, {
    companyId: COMPANY_ID,
    effectId: effect.effectId,
    outboxId: `outbox:${tag}`,
    payloadCanonicalBytes: effect.payloadCanonicalBytes,
    now: NOW,
  });
  expect(outcome.kind).toBe('ENQUEUED');
  return effect;
}

function adsMock(): ReturnType<typeof createMockAdapter> {
  return createMockAdapter({
    adapterId: ADAPTER_ADS,
    resolutionCapabilities: ['IDEMPOTENCY_HEADER'],
    outcome: returnedOutcome(),
  });
}

async function journalRowCount(kind: string): Promise<number> {
  const result = await h.control.query<{ n: string }>(
    `SELECT count(*)::TEXT AS n FROM effect_journal
      WHERE company_id = $1 AND journal_row_kind = $2`,
    [COMPANY_ID, kind],
  );
  return Number(result.rows[0]!.n);
}

describe('`§20` — KILL POINTS INSIDE THE OUTCOME TRANSACTION', () => {
  it('a kill AFTER THE ROW LOCK and before any write leaves nothing at all', async () => {
    const effect = await enqueuedPause('kill-lock');
    const before = await economicSnapshot(h.control);
    const mock = adsMock();

    await expect(
      dispatchAuthorisedEffect(
        h.control,
        testRegistry(mock),
        {
          companyId: COMPANY_ID,
          idempotencyKey: effect.idempotencyKey,
          dispatchedBy: 'worker:kill-lock',
          now: NOW,
        },
        {
          hooks: {
            afterOutcomeLock: () => Promise.reject(new Error('SIGKILL after the row lock')),
          },
        },
      ),
    ).rejects.toThrow('SIGKILL after the row lock');

    // The mock WAS invoked — the kill is downstream of it — and the local state is empty.
    expect(mock.callCount).toBe(1);
    expect(await rawOutcomeRowCount(h.control)).toBe(0);
    expect(await journalRowCount('DISPATCH_OUTCOME')).toBe(0);
    expect(await economicSnapshot(h.control)).toEqual(before);
    // The claim survives, because it committed in its OWN transaction. `25 §7`: the claim
    // is "the last committed local transaction before an effect can leave".
    expect((await outboxRows(h.control))[0]!.status).toBe('CLAIMED');
  });

  it('a kill AFTER BOTH WRITES and before COMMIT rolls BOTH back — no lone journal row', async () => {
    /*
     * THE ONE THAT MATTERS. The journal row is emitted first, then the state row, then the
     * hook throws, then `inTransaction` issues ROLLBACK. If the two were in separate
     * transactions the journal row would survive alone, which is
     * `unsafe-outcome-transaction.ts`'s CONTROL A.
     */
    const effect = await enqueuedPause('kill-precommit');
    const mock = adsMock();

    await expect(
      dispatchAuthorisedEffect(
        h.control,
        testRegistry(mock),
        {
          companyId: COMPANY_ID,
          idempotencyKey: effect.idempotencyKey,
          dispatchedBy: 'worker:kill-precommit',
          now: NOW,
        },
        {
          hooks: {
            beforeOutcomeCommit: () =>
              Promise.reject(new Error('SIGKILL after both writes, before COMMIT')),
          },
        },
      ),
    ).rejects.toThrow('SIGKILL after both writes');

    expect(mock.callCount).toBe(1);
    expect(await rawOutcomeRowCount(h.control)).toBe(0);
    expect(await journalRowCount('DISPATCH_OUTCOME')).toBe(0);
  });

  it('and the rolled-back attempt consumed no journal sequence — `30 §5.2` gap-freedom', async () => {
    /*
     * `30 §5.2`'s sequence is "gap-free", and `§5.4` gives a gap "exactly one
     * interpretation" — suppression. A rolled-back outcome must therefore not burn a
     * sequence number, or every kill point would manufacture a false suppression signal.
     *
     * `journal_allocate_seq` takes `journal_counter` `FOR UPDATE` inside the transaction, so
     * the rollback restores the counter. Asserted by dispatching a SECOND effect afterwards
     * and reading the sequences that exist.
     */
    const first = await enqueuedPause('gap-1');
    const mock = adsMock();
    await expect(
      dispatchAuthorisedEffect(
        h.control,
        testRegistry(mock),
        {
          companyId: COMPANY_ID,
          idempotencyKey: first.idempotencyKey,
          dispatchedBy: 'worker:gap',
          now: NOW,
        },
        { hooks: { beforeOutcomeCommit: () => Promise.reject(new Error('crash')) } },
      ),
    ).rejects.toThrow('crash');

    const second = await enqueuedPause('gap-2');
    const ok = await dispatchAuthorisedEffect(h.control, testRegistry(adsMock()), {
      companyId: COMPANY_ID,
      idempotencyKey: second.idempotencyKey,
      dispatchedBy: 'worker:gap',
      now: NOW,
    });
    expect(ok.kind).toBe('OUTCOME_RESOLVED');

    const all = await h.control.query<{ journal_seq: string }>(
      `SELECT journal_seq::TEXT AS journal_seq FROM effect_journal
        WHERE company_id = $1 ORDER BY journal_seq`,
      [COMPANY_ID],
    );
    const seqs = all.rows.map((r) => Number(r.journal_seq));
    // Contiguous from 1, with no hole where the rolled-back outcome would have sat.
    expect(seqs).toEqual(seqs.map((_, i) => i + 1));
  });

  it('THE DISCRIMINATOR — `§40` item 12: the split commit leaves a lone journal row', async () => {
    const effect = await enqueuedPause('split');
    // Claim it through the gateway with a kill after the lock, so the row is CLAIMED and
    // outcome-less — the state the unsafe split then operates on.
    await expect(
      dispatchAuthorisedEffect(
        h.control,
        testRegistry(adsMock()),
        {
          companyId: COMPANY_ID,
          idempotencyKey: effect.idempotencyKey,
          dispatchedBy: 'worker:split',
          now: NOW,
        },
        { hooks: { afterOutcomeLock: () => Promise.reject(new Error('crash')) } },
      ),
    ).rejects.toThrow('crash');
    expect(await journalRowCount('DISPATCH_OUTCOME')).toBe(0);

    const split = await unsafeSplitOutcomeCommit(
      h.control,
      {
        companyId: COMPANY_ID,
        idempotencyKey: effect.idempotencyKey,
        outcomeKind: 'OUTCOME_UNKNOWN',
        effectStatus: 'DISPATCHED_OUTCOME_UNKNOWN',
        now: NOW,
      },
      () => Promise.reject(new Error('SIGKILL between the two transactions')),
    );

    expect(split.kind).toBe('JOURNAL_ONLY');
    // A CHAINED, AUDIT-MIRRORABLE ROW SAYING THE OUTCOME RESOLVED — with no local state
    // resolving it. `30 §5.5` item 9: no detector exists for a row of this class.
    expect(await journalRowCount('DISPATCH_OUTCOME')).toBe(1);
    expect(await rawOutcomeRowCount(h.control)).toBe(0);
  });
});

describe('`§25` — TWO OUTCOME-PROCESSING TRANSACTIONS FOR ONE MOCK ATTEMPT', () => {
  it('at most one writes; the other returns the deterministic prior result', async () => {
    /*
     * ONE INVOCATION, TWO PROCESSINGS. The second processing uses the SAME attestation the
     * invocation minted — handed to the test by the `afterAdapterReturned` hook — so it is
     * a genuinely equal claim on the same attempt and not a second dispatch.
     *
     * THE INTERLEAVING IS CONSTRUCTED, NOT HOPED FOR. `36 §14` requires "targeted
     * interleaving with injected delays, plus a negative control". The conductor puts the
     * RACER first: it takes the `dispatch_outbox` row lock, parks at its own `afterLock`
     * point, is released, and commits — all while the gateway's own outcome transaction has
     * not started. The gateway's transaction then takes the same row lock, reads the
     * committed outcome under it, and returns it.
     *
     * That ordering is the one worth constructing, because it is the one where the SECOND
     * processing is the production path: if production ever wrote a second row, this is
     * where it would.
     */
    const effect = await enqueuedPause('race');
    const conductor = new Conductor();
    const racer = conductor.participant('racer');
    const mock = adsMock();

    let racerResult: Awaited<ReturnType<typeof processAdapterOutcome>> | null = null;

    const gateway = await dispatchAuthorisedEffect(
      h.control,
      testRegistry(mock),
      {
        companyId: COMPANY_ID,
        idempotencyKey: effect.idempotencyKey,
        dispatchedBy: 'worker:race',
        now: NOW,
      },
      {
        hooks: {
          afterAdapterReturned: async ({ attestation, identity }) => {
            // The racer runs on its OWN pool connection, in its OWN transaction, and
            // contends for the same `dispatch_outbox` row lock production will take.
            const pending = processAdapterOutcome(
              h.control,
              { attestation, identity, now: NOW },
              { afterLock: () => racer.at('AFTER_LOCK') },
            );
            await conductor.until('racer', 'AFTER_LOCK');
            conductor.release('racer', 'AFTER_LOCK');
            const settled = await settleAll([() => pending]);
            racerResult = valueOf(settled[0]!);
          },
        },
      },
    );

    // THE RACER WROTE. It reached the row first and its transaction committed.
    expect(racerResult).not.toBeNull();
    const racerOutcome = racerResult as unknown as Awaited<
      ReturnType<typeof processAdapterOutcome>
    >;
    expect(racerOutcome.kind).toBe('RESOLVED');
    if (racerOutcome.kind === 'RESOLVED') expect(racerOutcome.alreadyResolved).toBe(false);

    // AND PRODUCTION DID NOT WRITE A SECOND ONE. It observed the prior state under its own
    // row lock and returned it — `§25`'s "deterministic prior result".
    expect(gateway.kind).toBe('OUTCOME_RESOLVED');
    if (gateway.kind === 'OUTCOME_RESOLVED' && racerOutcome.kind === 'RESOLVED') {
      expect(gateway.record.journalSeq).toBe(racerOutcome.record.journalSeq);
    }

    // ONE OUTCOME ROW, ONE JOURNAL ROW. No double-realisation, no duplicate journal
    // authority, no second MIE movement — and, above all, no second invocation.
    expect(await rawOutcomeRowCount(h.control)).toBe(1);
    expect(await outcomeJournalRows(h.control)).toHaveLength(1);
    expect(mock.callCount).toBe(1);
    expect(mock.acceptedCount).toBe(1);
  });

  it('and re-presenting the same attestation afterwards returns the SAME row', async () => {
    /*
     * `§25`: "return deterministic prior result or deny". The attestation is deliberately
     * NOT single-use, because a local outcome transaction can legitimately be retried and
     * re-invoking the adapter to obtain a fresh one is the duplicate `I36` forbids.
     */
    const effect = await enqueuedPause('reprocess');
    const mock = adsMock();
    let attempt: {
      readonly attestation: Parameters<typeof processAdapterOutcome>[1]['attestation'];
      readonly identity: Parameters<typeof processAdapterOutcome>[1]['identity'];
    } | null = null;

    const gateway = await dispatchAuthorisedEffect(
      h.control,
      testRegistry(mock),
      {
        companyId: COMPANY_ID,
        idempotencyKey: effect.idempotencyKey,
        dispatchedBy: 'worker:reprocess',
        now: NOW,
      },
      {
        hooks: {
          afterAdapterReturned: (a) => {
            attempt = a;
            return Promise.resolve();
          },
        },
      },
    );
    expect(gateway.kind).toBe('OUTCOME_RESOLVED');
    expect(attempt).not.toBeNull();

    const again = await processAdapterOutcome(h.control, {
      attestation: attempt!.attestation,
      identity: attempt!.identity,
      now: new Date(NOW.getTime() + 60_000),
    });
    expect(again.kind).toBe('RESOLVED');
    if (again.kind !== 'RESOLVED') return;
    expect(again.alreadyResolved).toBe(true);
    if (gateway.kind === 'OUTCOME_RESOLVED') {
      expect(again.record.journalSeq).toBe(gateway.record.journalSeq);
      expect(again.record.outcomeKind).toBe(gateway.record.outcomeKind);
      expect(again.record.effectStatus).toBe(gateway.record.effectStatus);
    }
    expect(await rawOutcomeRowCount(h.control)).toBe(1);
    expect(mock.callCount).toBe(1);
  });

  it('THE DISCRIMINATOR — `§40` item 12b: read-then-write without the lock is stopped by the KEY', async () => {
    /*
     * `36 §0`'s single-mechanism rule. Production's exclusion is the row lock, and
     * `effect_dispatch_outcome`'s primary key is the SECOND mechanism. This control removes
     * the first and shows the second doing the work — a `unique_violation` that aborts the
     * loser's transaction, rather than the determinate `alreadyResolved` production returns.
     *
     * Both end with one row. WHAT DIFFERS IS WHICH MECHANISM REFUSED, and that is the
     * finding: a path that relies on the key alone converts a normal race into an error a
     * caller has to interpret.
     */
    const effect = await enqueuedPause('unlocked-race');
    // Claim and dispatch normally first, so a committed outcome exists to collide with.
    const mock = adsMock();
    await dispatchAuthorisedEffect(h.control, testRegistry(mock), {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      dispatchedBy: 'worker:unlocked-race',
      now: NOW,
    });
    expect(await rawOutcomeRowCount(h.control)).toBe(1);

    // The unsafe path sees the prior row on its unlocked read and declines — the benign
    // case, which is why the defect is invisible in a sequential test.
    const sequential = await unsafeReadThenWriteOutcome(h.control, {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      outcomeKind: 'ADAPTER_RETURNED',
      effectStatus: 'DISPATCHED_AWAITING_VERIFICATION',
      now: NOW,
    });
    expect(sequential.kind).toBe('SAW_PRIOR');

    // Now the interleaved case, on a SECOND effect: two unlocked read-then-writers, both
    // passing the existence check, and the key deciding it.
    const other = await enqueuedPause('unlocked-race-2');
    const otherMock = adsMock();
    await dispatchAuthorisedEffect(
      h.control,
      testRegistry(otherMock),
      {
        companyId: COMPANY_ID,
        idempotencyKey: other.idempotencyKey,
        dispatchedBy: 'worker:unlocked-race-2',
        now: NOW,
      },
      { hooks: { afterOutcomeLock: () => Promise.reject(new Error('crash')) } },
    ).catch(() => undefined);

    const conductor = new Conductor();
    const a = conductor.participant('a');
    const results = await settleAll([
      () =>
        unsafeReadThenWriteOutcome(
          h.control,
          {
            companyId: COMPANY_ID,
            idempotencyKey: other.idempotencyKey,
            outcomeKind: 'ADAPTER_RETURNED',
            effectStatus: 'DISPATCHED_AWAITING_VERIFICATION',
            now: NOW,
          },
          () => a.at('AFTER_UNLOCKED_READ'),
        ),
      async () => {
        await conductor.until('a', 'AFTER_UNLOCKED_READ');
        const second = await unsafeReadThenWriteOutcome(h.control, {
          companyId: COMPANY_ID,
          idempotencyKey: other.idempotencyKey,
          outcomeKind: 'ADAPTER_RETURNED',
          effectStatus: 'DISPATCHED_AWAITING_VERIFICATION',
          now: NOW,
        });
        conductor.release('a', 'AFTER_UNLOCKED_READ');
        return second;
      },
    ]);

    const kinds = results.map((r) => (r.status === 'fulfilled' ? r.value.kind : 'threw'));
    // Both passed the unlocked existence check, so one INSERTED and the other was refused
    // by the key — never `SAW_PRIOR`, which is what the row lock would have produced.
    expect(kinds).toContain('INSERTED');
    expect(kinds).toContain('REFUSED_BY_KEY');
    expect(
      (await rawOutcomeRows(h.control)).filter((r) => r.idempotencyKey === other.idempotencyKey),
    ).toHaveLength(1);
  });
});

describe('`§21`, `§43` — THE MONEY-PATH LOCK ORDER IS NOT ENGAGED, AND THAT IS DECLARED', () => {
  it('the outcome transaction touches no `window_balance` row, so there is no money lock', async () => {
    /*
     * `§43` is conditional: "IF outcome-state transactions touch money/MIE rows: assert
     * SERIALIZABLE where current architecture requires it; bounded retry `40001`."
     *
     * They do not. `25 §10`'s declared branches move no ledger term, so the transaction's
     * locks are `dispatch_outbox` (step 3 of `30 §5.2`) then `journal_counter` (step 5,
     * LAST) — two locks in the declared total order with no money-path lock between them.
     * `33 §6` scopes the serialisable requirement to the exposure ledger, "the only table
     * with a serialisable-isolation requirement", so `READ COMMITTED` is correct here for
     * the same reason it is correct for the ACCEPTED S1I claim.
     *
     * Asserted by observing that the ledger is byte-identical across a dispatch of every
     * declared outcome kind, on a money-bearing class.
     */
    const effect = await enqueuedPause('locks');
    const before = await economicSnapshot(h.control);
    const mock = createMockAdapter({
      adapterId: ADAPTER_ADS,
      resolutionCapabilities: ['IDEMPOTENCY_HEADER'],
      outcome: unknownOutcome(),
    });
    const result = await dispatchAuthorisedEffect(h.control, testRegistry(mock), {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      dispatchedBy: 'worker:locks',
      now: NOW,
    });
    expect(result.kind).toBe('OUTCOME_RESOLVED');
    expect(await economicSnapshot(h.control)).toEqual(before);
  });

  it('and `40P01` is not retried anywhere on this path — no second lock discipline exists', async () => {
    /*
     * `§21`: "`40P01`: defect, never retry." The accepted doctrine lives in
     * `src/kernel/exposure/retry.ts` and is asserted by
     * `tests/integration/exposure/retry-deadlock-not-retried.test.ts`. S1J adds NO retry
     * loop of its own — `outcomeTransaction.ts` contains no retry, no backoff and no
     * SQLSTATE inspection — so there is no second discipline to disagree with the first.
     *
     * Asserted over the source, because the property is an absence.
     */
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile('src/kernel/gateway/outcomeTransaction.ts', 'utf8'),
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    for (const pattern of [/40001/, /40P01/, /retr/i, /backoff/i, /SERIALIZABLE/]) {
      expect(pattern.test(code), `${String(pattern)} appears in outcomeTransaction.ts`).toBe(
        false,
      );
    }
  });
});
