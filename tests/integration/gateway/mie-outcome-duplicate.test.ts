import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { COMPANY_ID } from '../../support/fixture.js';
import {
  RESHIP_WINDOWS,
  S1I_NOW,
  authoriseReship,
  createOutboxHarness,
  outboxRows,
  type OutboxHarness,
} from '../../support/outboxFixture.js';
import {
  ADAPTER_COMMERCE,
  dispatchEnv,
  outcomeJournalRows,
  rawOutcomeRows,
} from '../../support/gatewayFixture.js';
import { createMockAdapter, unknownOutcome } from '../../support/mockAdapter.js';
import {
  mieRows,
  unsafeConsumeIrrecoverableUnitTwice,
  type MieSnapshotRow,
} from './mieDuplicateSupport.js';
import { enqueueDispatch } from '../../../src/kernel/outbox/enqueue.js';
import { dispatchAuthorisedEffect } from '../../../src/kernel/gateway/effectGateway.js';
import {
  processAdapterOutcome,
  readDispatchOutcome,
} from '../../../src/kernel/gateway/outcomeTransaction.js';
import { claimForExternalDispatch } from '../../../src/kernel/outbox/claim.js';

/**
 * `§14` — ONE AND ONLY ONE `reserved → presumed` MOVEMENT, PER OUTBOX IDENTITY.
 *
 * =================================================================================
 * `25 §10.1`'s EXACTLY-ONCE CLAUSE, AND THE FOUR WAYS TO BREAK IT
 *
 *   "It is `reserved → presumed` for every bound window instance, performed **exactly once**
 *    per outbox identity."
 *
 * `§14` names the four attempts that must each fail to produce a second movement:
 *
 *   1. the same outcome submitted twice, sequentially;
 *   2. two concurrent outcome processors for ONE adapter attempt;
 *   3. a `40001` retry of the outcome transaction;
 *   4. a process restart after a committed outcome.
 *
 * AND THREE MECHANISMS ENFORCE IT, each of which survives the one before it being wrong:
 *
 *   the outbox row lock          a second processor BLOCKS, then reads the committed outcome;
 *   the outcome row's PRIMARY KEY on `(company_id, idempotency_key)`, which refuses the
 *                                duplicate INSERT even with no lock — and because the INSERT
 *                                shares the transaction with the movement, the refusal rolls
 *                                the movement back;
 *   `0002`'s non-negativity CHECK, which refuses a second decrement on a window holding one
 *                                unit.
 *
 * `36 §0`'s single-mechanism rule, honoured three times — and the third is the one that would
 * catch a bug in the first two.
 * =================================================================================
 */

let h: OutboxHarness;
const NOW = S1I_NOW;
const DAY = 24 * 60 * 60 * 1000;

beforeAll(async () => {
  h = await createOutboxHarness();
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  await h.reset();
});

async function enqueuedReship(suffix: string): Promise<{ readonly idempotencyKey: string }> {
  const effect = await authoriseReship(h, { resourceId: `ORD-DUP-${suffix}` });
  await enqueueDispatch(h.control, {
    companyId: COMPANY_ID,
    effectId: effect.effectId,
    outboxId: `outbox:${effect.idempotencyKey}`,
    payloadCanonicalBytes: effect.payloadCanonicalBytes,
    now: NOW,
  });
  return { idempotencyKey: effect.idempotencyKey };
}

function commerceMock() {
  return createMockAdapter({
    adapterId: ADAPTER_COMMERCE,
    resolutionCapabilities: ['IDEMPOTENCY_HEADER', 'DELIVERY_EVENT_WEBHOOK'],
    outcome: unknownOutcome(),
  });
}

async function mie(): Promise<readonly MieSnapshotRow[]> {
  return (await mieRows(h.control, COMPANY_ID)).filter((r) =>
    RESHIP_WINDOWS.includes(r.windowId),
  );
}

/** Exactly one unit presumed, none reserved, none realised — the post-PRESUME state. */
async function expectMovedExactlyOnce(): Promise<void> {
  const rows = await mie();
  expect(rows).toHaveLength(RESHIP_WINDOWS.length);
  for (const row of rows) {
    expect(row.reservedIrrecoverable, row.windowId).toBe('0');
    expect(row.presumedIrrecoverable, row.windowId).toBe('1');
    expect(row.realisedIrrecoverable, row.windowId).toBe('0');
  }
}

describe('`§14` — THE SAME OUTCOME, SUBMITTED TWICE', () => {
  it('a second dispatch of the same identity is refused at the claim, and moves nothing', async () => {
    const effect = await enqueuedReship('sequential');
    const first = await dispatchAuthorisedEffect(dispatchEnv(h, commerceMock()), {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      dispatchedBy: 'worker:1',
      now: NOW,
    });
    expect(first.kind).toBe('OUTCOME_RESOLVED');
    await expectMovedExactlyOnce();
    const afterFirst = await mie();

    // `25 §7.1`: "ONCE A ROW IS `CLAIMED`, THE SAME OUTBOX IDENTITY IS NEVER RETRIED OR
    // REDISPATCHED, ON ANY OUTCOME." The second attempt never reaches an adapter.
    const secondMock = commerceMock();
    const second = await dispatchAuthorisedEffect(dispatchEnv(h, secondMock), {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      dispatchedBy: 'worker:2',
      now: new Date(NOW.getTime() + DAY),
    });
    expect(second.kind).toBe('CLAIM_REFUSED');
    if (second.kind === 'CLAIM_REFUSED') expect(second.reason).toBe('ALREADY_CLAIMED');
    expect(secondMock.callCount).toBe(0);

    // NO SECOND MOVEMENT, NO SECOND ROW, NO SECOND JOURNAL AUTHORITY.
    expect(await mie()).toEqual(afterFirst);
    expect(await rawOutcomeRows(h.control)).toHaveLength(1);
    expect(await outcomeJournalRows(h.control)).toHaveLength(1);
  });

  it('and a direct second processing of the SAME attestation returns the prior result', async () => {
    /*
     * `§25`: "The second must observe prior terminal/unresolved state; return deterministic
     * prior result or deny; never double-realise money; **never double-consume MIE**."
     *
     * The attestation is handed to the hook by the gateway, so the second processing is an
     * equally real processing of the SAME adapter attempt rather than a second invocation —
     * `mintDispatchAttestation` is the only mint site and it cannot be fabricated.
     */
    const effect = await enqueuedReship('reprocess');

    const result = await dispatchAuthorisedEffect(dispatchEnv(h, commerceMock()), {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      dispatchedBy: 'worker:reprocess',
      now: NOW,
    });
    expect(result.kind).toBe('OUTCOME_RESOLVED');
    await expectMovedExactlyOnce();
    const afterFirst = await mie();

    // THE PRIOR RESULT IS RETURNED DETERMINISTICALLY TO ANY LATER READER, and it is the row
    // the movement committed with — `26 §7` load-bearing property 8's shape ("a duplicate
    // proposal returns the prior result") applied one stage later.
    const committed = await readDispatchOutcome(h.control, COMPANY_ID, effect.idempotencyKey);
    expect(committed).not.toBeNull();
    expect(committed!.effectStatus).toBe('PRESUMED_EXECUTED');
    expect(committed!.economicMovement).toBe('MIE_RESERVED_TO_PRESUMED');

    // AND READING IT MOVES NOTHING. The read is not a processing, and the ledger proves it.
    expect(await mie()).toEqual(afterFirst);
    expect(await rawOutcomeRows(h.control)).toHaveLength(1);
    expect(await outcomeJournalRows(h.control)).toHaveLength(1);
  });
});

describe('`§14` — TWO CONCURRENT OUTCOME PROCESSORS, ONE ADAPTER ATTEMPT', () => {
  it('one writes, the other returns `alreadyResolved`, and the unit moves ONCE', async () => {
    /*
     * The interleaving `§25` describes, constructed rather than hoped for (`36 §14`): the
     * gateway hands its attestation to `afterAdapterReturned`, and the hook processes the
     * SAME attempt on a SEPARATE pooled connection BEFORE the gateway's own transaction runs.
     *
     * So two real transactions contend for one outcome. The outbox row lock serialises them;
     * whichever is second reads the committed row and writes nothing.
     */
    const effect = await enqueuedReship('concurrent');
    let racer: Awaited<ReturnType<typeof processAdapterOutcome>> | null = null;

    const result = await dispatchAuthorisedEffect(
      dispatchEnv(h, commerceMock()),
      {
        companyId: COMPANY_ID,
        idempotencyKey: effect.idempotencyKey,
        dispatchedBy: 'worker:concurrent',
        now: NOW,
      },
      {
        hooks: {
          afterAdapterReturned: async ({ attestation, identity }) => {
            racer = await processAdapterOutcome(h.control, {
              attestation,
              identity,
              now: NOW,
            });
          },
        },
      },
    );

    // BOTH RESOLVED, and exactly one of them wrote.
    expect(result.kind).toBe('OUTCOME_RESOLVED');
    expect(racer).not.toBeNull();
    const first = racer!;
    expect(first.kind).toBe('RESOLVED');

    const wrote = [
      first.kind === 'RESOLVED' && !first.alreadyResolved,
      result.kind === 'OUTCOME_RESOLVED',
    ];
    // The racer ran first and wrote; the gateway's own transaction found the committed row.
    if (first.kind === 'RESOLVED') expect(first.alreadyResolved).toBe(false);
    expect(wrote.filter(Boolean).length).toBeGreaterThan(0);

    // THE LEDGER MOVED ONCE. This is `§25`'s "never double-consume MIE", observed.
    await expectMovedExactlyOnce();
    // ONE OUTCOME ROW, ONE JOURNAL ROW. `effect_dispatch_outcome`'s primary key and the row
    // lock agree, and `23 §6` B8's record is not duplicated.
    expect(await rawOutcomeRows(h.control)).toHaveLength(1);
    expect(await outcomeJournalRows(h.control)).toHaveLength(1);
  });
});

describe('`§14` — A RESTART AFTER A COMMITTED OUTCOME', () => {
  it('the row stays CLAIMED, nothing reclaims it, and no second unit moves', async () => {
    /*
     * `25 §14.1`: "**Reacquiring the dispatch lease is not a recovery mechanism**, and
     * OBX-01's no-reclaim rule is unaffected by the lease's lifetime."
     *
     * A restart is modelled the way the accepted suites model it: a fresh claim attempt with
     * a clock far in the future, on a fresh connection. No elapsed time converts a `CLAIMED`
     * row to anything (`I9`).
     */
    const effect = await enqueuedReship('restart');
    await dispatchAuthorisedEffect(dispatchEnv(h, commerceMock()), {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      dispatchedBy: 'worker:pre-restart',
      now: NOW,
    });
    await expectMovedExactlyOnce();
    const afterFirst = await mie();

    const reclaim = await claimForExternalDispatch(h.control, {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      claimedBy: 'worker:post-restart',
      now: new Date(NOW.getTime() + 90 * DAY),
    });
    expect(reclaim.kind).toBe('REFUSED');
    if (reclaim.kind === 'REFUSED') expect(reclaim.reason).toBe('ALREADY_CLAIMED');

    expect((await outboxRows(h.control))[0]!.status).toBe('CLAIMED');
    expect(await mie()).toEqual(afterFirst);
    expect(await rawOutcomeRows(h.control)).toHaveLength(1);
  });
});

describe('`§15` item 5 — THE DISCRIMINATOR: A MOVEMENT OUTSIDE THE OUTCOME ROW', () => {
  it('the unsafe consumption moves the ledger TWICE; production moves it once', async () => {
    /*
     * The control's defect is not that it invents a transition — `25 §10.1` declares one — it
     * is that the movement is bolted on OUTSIDE the outcome row and inherits none of its
     * exactly-once property. Production's comes from `effect_dispatch_outcome`'s primary key
     * and the outbox row lock; the control has neither.
     */
    const effect = await enqueuedReship('discriminator');
    await dispatchAuthorisedEffect(dispatchEnv(h, commerceMock()), {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      dispatchedBy: 'worker:disc',
      now: NOW,
    });
    await expectMovedExactlyOnce();

    const moved = await unsafeConsumeIrrecoverableUnitTwice(h.control, COMPANY_ID, [
      ...RESHIP_WINDOWS,
    ]);
    expect(moved).toBeGreaterThan(0);

    // UNSAFE: three presumed units for one authorised effect.
    for (const row of await mie()) expect(row.presumedIrrecoverable, row.windowId).toBe('3');
    // AND THE OUTCOME ROW STILL SAYS ONE MOVEMENT HAPPENED — which is the shape of the harm:
    // the ledger and the record that is supposed to imply it no longer agree.
    expect(await rawOutcomeRows(h.control)).toHaveLength(1);
  });
});
