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
import { createMockAdapter, returnedOutcome, unknownOutcome } from '../../support/mockAdapter.js';
import {
  mieCommitment,
  mieRows,
  unsafeLeaveReserved,
  unsafeReleaseOnUnknown,
  unsafeReservedToRealised,
  unsafeTwoTransactionMovement,
  type MieSnapshotRow,
} from '../../negative-controls/unsafe-mie-movements.js';
import { enqueueDispatch } from '../../../src/kernel/outbox/enqueue.js';
import {
  dispatchAuthorisedEffect,
  type DispatchHooks,
} from '../../../src/kernel/gateway/effectGateway.js';

/**
 * `§13`, `§15` — THE MIE OUTCOME TRANSACTION IS ATOMIC, AND THE MOVEMENT IS THE DECLARED ONE.
 *
 * =================================================================================
 * `25 §10.1`'s ATOMICITY REQUIREMENT, VERBATIM
 *
 *   "It is `reserved → presumed` for every bound window instance, performed **exactly once**
 *    per outbox identity, **in the same serializable local transaction as the effect state,
 *    the outbox outcome state, the outcome journal row and the claim/outcome evidence.**"
 *
 * and the property that makes the statement shape load-bearing:
 *
 *   "**Unknown outcome must not create new headroom, and no transaction may expose transient
 *    headroom to another transaction while the movement is in flight.**"
 *
 * `§13` asks for seven kill points. SIX OF THEM ARE REACHABLE AND ONE IS NOT, and the one
 * that is not is the finding rather than a gap: `§13` lists "after decrement reserved" and
 * "after increment presumed" as separate points, and there is no instant between them because
 * `applyIrrecoverablePresumption` moves both terms in ONE `UPDATE`. A hook could not be placed
 * there without splitting the statement, and splitting it is the defect
 * `unsafe-two-transaction-mie-movement` exists to demonstrate. The suite asserts the absence
 * of that instant directly rather than reporting a kill point it could not reach.
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

async function enqueuedReship(suffix: string): Promise<{ readonly idempotencyKey: string }> {
  const effect = await authoriseReship(h, { resourceId: `ORD-ATOM-${suffix}` });
  await enqueueDispatch(h.control, {
    companyId: COMPANY_ID,
    effectId: effect.effectId,
    outboxId: `outbox:${effect.idempotencyKey}`,
    payloadCanonicalBytes: effect.payloadCanonicalBytes,
    now: NOW,
  });
  return { idempotencyKey: effect.idempotencyKey };
}

function commerceMock(outcome = unknownOutcome()) {
  return createMockAdapter({
    adapterId: ADAPTER_COMMERCE,
    resolutionCapabilities: ['IDEMPOTENCY_HEADER', 'DELIVERY_EVENT_WEBHOOK'],
    outcome,
  });
}

async function mie(): Promise<readonly MieSnapshotRow[]> {
  return (await mieRows(h.control, COMPANY_ID)).filter((r) =>
    RESHIP_WINDOWS.includes(r.windowId),
  );
}

/** Every observable the transaction could have moved, as one comparable value. */
async function worldState(): Promise<{
  readonly mie: readonly MieSnapshotRow[];
  readonly outcomes: number;
  readonly journal: number;
  readonly outboxStatus: string;
}> {
  return {
    mie: await mie(),
    outcomes: (await rawOutcomeRows(h.control)).length,
    journal: (await outcomeJournalRows(h.control)).length,
    outboxStatus: (await outboxRows(h.control))[0]!.status,
  };
}

const KILL = new Error('S1J kill point');

describe('`§13` — THE KILL-POINT MATRIX: EVERY ABORT RETURNS THE EXACT PRE-OUTCOME STATE', () => {
  /**
   * The six reachable points, named for the position `§13` gives them.
   *
   * Each hook THROWS, which propagates out of `inTransaction` and rolls the outcome
   * transaction back. The claim is already committed at every one of them — that is the state
   * the kill leaves behind, and `I9`'s detector's subject.
   */
  const points: ReadonlyArray<readonly [string, (hooks: Record<string, unknown>) => DispatchHooks]> =
    [
      ['1 — before the MIE movement', () => ({ beforeLedgerMovement: () => Promise.reject(KILL) })],
      ['3 — after the movement, before the journal', () => ({ afterLedgerMovement: () => Promise.reject(KILL) })],
      ['5 — after the journal row, before the outcome row', () => ({ afterJournalRow: () => Promise.reject(KILL) })],
      ['7 — after every write, before COMMIT', () => ({ beforeOutcomeCommit: () => Promise.reject(KILL) })],
      ['0 — inside the outcome transaction, after the row lock', () => ({ afterOutcomeLock: () => Promise.reject(KILL) })],
    ];

  for (const [name, build] of points) {
    it(`KILL POINT ${name}: nothing moved, nothing written`, async () => {
      const effect = await enqueuedReship(`kill-${name.slice(0, 1)}`);
      const mock = commerceMock();

      // The state the outcome transaction is about to act on. The claim has NOT happened yet,
      // so this is captured before the dispatch and compared with the outbox status excluded.
      const before = await mie();
      for (const row of before) expect(row.reservedIrrecoverable, row.windowId).toBe('1');

      await expect(
        dispatchAuthorisedEffect(
          dispatchEnv(h, mock),
          {
            companyId: COMPANY_ID,
            idempotencyKey: effect.idempotencyKey,
            dispatchedBy: 'worker:kill',
            now: NOW,
          },
          { hooks: build({}) },
        ),
      ).rejects.toThrow('S1J kill point');

      const after = await worldState();
      // THE LEDGER IS EXACTLY AS IT WAS. Not "close to", not "non-negative" — identical.
      expect(after.mie).toEqual(before);
      // NO OUTCOME ROW AND NO JOURNAL ROW. The three share a commit point, so an abort that
      // left any one of them would have broken `25 §10.1`'s atomicity clause.
      expect(after.outcomes).toBe(0);
      expect(after.journal).toBe(0);
      // AND THE CLAIM IS STILL COMMITTED AND STILL NON-RECLAIMABLE — `25 §7.1`. The kill
      // rolled back the OUTCOME, not the claim, which is the intentionally ambiguous state.
      expect(after.outboxStatus).toBe('CLAIMED');
      // The adapter WAS invoked, so the ambiguity is real rather than hypothetical.
      expect(mock.callCount).toBe(1);
      expect(mock.acceptedCount).toBe(1);
    });
  }

  it('KILL POINT 2/4 IS UNREACHABLE BY CONSTRUCTION — one statement, two terms', async () => {
    /*
     * `§13` lists "after decrement reserved" and "after increment presumed" as separate kill
     * points. THERE IS NO INSTANT BETWEEN THEM, and that is `25 §10.1`'s requirement rather
     * than an omission: "no transaction may expose transient headroom to another transaction
     * while the movement is in flight."
     *
     * Asserted over the source, because the property is the SHAPE OF THE STATEMENT. A single
     * `UPDATE` that sets both columns cannot be interrupted between them; two statements can.
     */
    const read = await import('node:fs/promises');
    const code = (await read.readFile('src/kernel/exposure/ledger.ts', 'utf8'))
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');

    const presume = /applyIrrecoverablePresumption[\s\S]*?\n}/.exec(code);
    expect(presume, 'the PRESUME movement is missing').not.toBeNull();
    const body = presume![0];
    // ONE `UPDATE`, setting BOTH terms.
    expect((body.match(/UPDATE window_balance/g) ?? []).length).toBe(1);
    expect(body).toContain('reserved_irrecoverable = reserved_irrecoverable - ');
    expect(body).toContain('presumed_irrecoverable = presumed_irrecoverable + ');
    // And no second statement, no `await` between two queries, inside it.
    expect((body.match(/client\.query\(/g) ?? []).length).toBe(1);
  });
});

describe('`§10` — THE SUM IS UNCHANGED, SO AN UNKNOWN OUTCOME CREATES NO HEADROOM', () => {
  it('the three-term commitment is identical before and after, per window', async () => {
    const effect = await enqueuedReship('headroom');
    const before = await mie();
    const mock = commerceMock();

    const result = await dispatchAuthorisedEffect(dispatchEnv(h, mock), {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      dispatchedBy: 'worker:headroom',
      now: NOW,
    });
    expect(result.kind).toBe('OUTCOME_RESOLVED');

    const after = await mie();
    for (const row of before) {
      const match = after.find(
        (r) => r.windowId === row.windowId && r.windowInstanceKey === row.windowInstanceKey,
      )!;
      // THE SUM, COMPUTED. `25 §10.1`: "the sum of the three terms does not fall".
      expect(mieCommitment(match), row.windowId).toBe(mieCommitment(row));
      // AND THE TERMS MOVED, so the equality above is not the equality of two unchanged rows.
      expect(match.reservedIrrecoverable).not.toBe(row.reservedIrrecoverable);
    }
  });

  it('`ADAPTER_RETURNED` performs the SAME movement — `25 §7.1` OBX-04', async () => {
    const effect = await enqueuedReship('returned');
    const before = await mie();
    const mock = commerceMock(returnedOutcome());

    const result = await dispatchAuthorisedEffect(dispatchEnv(h, mock), {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      dispatchedBy: 'worker:returned',
      now: NOW,
    });
    expect(result.kind).toBe('OUTCOME_RESOLVED');
    if (result.kind !== 'OUTCOME_RESOLVED') return;
    // "`ADAPTER_RETURNED` FOR AN IRRECOVERABLE EFFECT REACHES `PRESUMED_EXECUTED`, NOT AN
    // AWAITING-VERIFICATION STATE."
    expect(result.record.effectStatus).toBe('PRESUMED_EXECUTED');
    expect(result.record.economicMovement).toBe('MIE_RESERVED_TO_PRESUMED');

    for (const row of await mie()) {
      expect(row.reservedIrrecoverable, row.windowId).toBe('0');
      expect(row.presumedIrrecoverable, row.windowId).toBe('1');
    }
    for (const row of before) expect(row.reservedIrrecoverable, row.windowId).toBe('1');
  });
});

describe('`§15` — THE FOUR WRONG MOVEMENTS, EACH DISCRIMINATING', () => {
  it('CONTROL 2 — the state moves and the unit does not: the sum RISES', async () => {
    const effect = await enqueuedReship('ctrl-leave');
    const before = await mie();
    await dispatchAuthorisedEffect(dispatchEnv(h, commerceMock()), {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      dispatchedBy: 'worker:ctrl2',
      now: NOW,
    });
    const production = await mie();
    for (const row of before) {
      const after = production.find((r) => r.windowId === row.windowId)!;
      expect(mieCommitment(after), row.windowId).toBe(mieCommitment(row));
    }

    // UNSAFE: increment presumed, leave reserved. The commitment rises with nothing behind it.
    await unsafeLeaveReserved(h.control, COMPANY_ID, [...RESHIP_WINDOWS]);
    for (const row of production) {
      const after = (await mie()).find((r) => r.windowId === row.windowId)!;
      expect(mieCommitment(after), row.windowId).toBeGreaterThan(mieCommitment(row));
    }
  });

  it('CONTROL 3 — release on unknown: the sum FALLS, and headroom appears', async () => {
    /*
     * THE DANGEROUS ONE. `25 §7.2`: "**Nothing is released on `OUTCOME_UNKNOWN`.**" The freed
     * headroom funds the next send, which is the double-execution economics `25 §10` row 2
     * exists to prevent — arriving through the ledger instead of through a retry.
     */
    const effect = await enqueuedReship('ctrl-release');
    await dispatchAuthorisedEffect(dispatchEnv(h, commerceMock()), {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      dispatchedBy: 'worker:ctrl3',
      now: NOW,
    });
    const production = await mie();
    for (const row of production) expect(mieCommitment(row), row.windowId).toBe(1n);

    // Re-reserve so the control has a reserved unit to release, then release it.
    await authoriseReship(h, { resourceId: 'ORD-ATOM-ctrl-release-2' });
    const beforeRelease = await mie();
    await unsafeReleaseOnUnknown(h.control, COMPANY_ID, [...RESHIP_WINDOWS]);
    for (const row of beforeRelease) {
      const after = (await mie()).find((r) => r.windowId === row.windowId)!;
      expect(mieCommitment(after), row.windowId).toBeLessThan(mieCommitment(row));
    }
  });

  it('CONTROL 4 — reserved straight to realised: the sum holds, the MEANING does not', async () => {
    /*
     * The near-miss. `25 §10.1`: "**The unit does not move directly to `realised`, because a
     * presumption is not a realisation and provider truth is unverified.**" A unit realised
     * early can never be released when a provider later proves `NEVER_SENT`, because that row
     * moves `presumed`.
     */
    const effect = await enqueuedReship('ctrl-realised');
    await dispatchAuthorisedEffect(dispatchEnv(h, commerceMock()), {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      dispatchedBy: 'worker:ctrl4',
      now: NOW,
    });
    // PRODUCTION: the unit is PRESUMED and nothing is realised.
    for (const row of await mie()) {
      expect(row.presumedIrrecoverable, row.windowId).toBe('1');
      expect(row.realisedIrrecoverable, row.windowId).toBe('0');
    }

    await authoriseReship(h, { resourceId: 'ORD-ATOM-ctrl-realised-2' });
    await unsafeReservedToRealised(h.control, COMPANY_ID, [...RESHIP_WINDOWS]);
    // UNSAFE: the same sum, and a term that asserts provider truth nothing established.
    for (const row of await mie()) expect(row.realisedIrrecoverable, row.windowId).toBe('1');
  });

  it('CONTROL 6 — two transactions expose TRANSIENT HEADROOM another session can see', async () => {
    /*
     * `25 §10.1`: "no transaction may expose transient headroom to another transaction while
     * the movement is in flight."
     *
     * The observation is made from a SEPARATE connection DURING the gap, so it is a fact about
     * what PostgreSQL made visible rather than about what the control intended.
     */
    await authoriseReship(h, { resourceId: 'ORD-ATOM-transient' });
    const before = await mie();
    for (const row of before) expect(mieCommitment(row), row.windowId).toBe(1n);

    let duringGap: readonly MieSnapshotRow[] = [];
    await unsafeTwoTransactionMovement(h.control, COMPANY_ID, [...RESHIP_WINDOWS], async () => {
      duringGap = await mie();
    });

    // THE HEADROOM WAS VISIBLE. The committed sum fell by one unit for the length of the gap.
    expect(duringGap).toHaveLength(before.length);
    for (const row of before) {
      const seen = duringGap.find((r) => r.windowId === row.windowId)!;
      expect(mieCommitment(seen), row.windowId).toBe(mieCommitment(row) - 1n);
    }
    // And it closed afterwards, which is what makes the defect hard to see without a probe.
    for (const row of before) {
      const after = (await mie()).find((r) => r.windowId === row.windowId)!;
      expect(mieCommitment(after), row.windowId).toBe(mieCommitment(row));
    }
  });
});
