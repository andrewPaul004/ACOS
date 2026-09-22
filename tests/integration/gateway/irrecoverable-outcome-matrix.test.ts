import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { COMPANY_ID } from '../../support/fixture.js';
import {
  REFUND_TASK_ID,
  RESHIP_WINDOWS,
  S1I_NOW,
  authorisePause,
  authoriseRefund,
  authoriseReship,
  bindTaskToCase,
  createOutboxHarness,
  openLiveClock,
  outboxRows,
  type OutboxHarness,
} from '../../support/outboxFixture.js';
import {
  ADAPTER_ADS,
  ADAPTER_COMMERCE,
  ADAPTER_PROCESSOR,
  dispatchEnv,
  outcomeJournalRows,
  rawOutcomeRows,
} from '../../support/gatewayFixture.js';
import {
  createMockAdapter,
  failedOutcome,
  notSentOutcome,
  returnedOutcome,
  unknownOutcome,
} from '../../support/mockAdapter.js';
import { mieCommitment, mieRows } from '../../negative-controls/unsafe-mie-movements.js';
import {
  EXPECTED_OUTCOMES,
  expectedOutcomeFor,
  type ExpectedOutcomeKind,
  type ExpectedRecoverability,
} from '../../support/s1jOutcomeTable.js';
import { enqueueDispatch } from '../../../src/kernel/outbox/enqueue.js';
import { dispatchAuthorisedEffect } from '../../../src/kernel/gateway/effectGateway.js';
import type { AdapterOutcome } from '../../../src/kernel/gateway/adapterPort.js';

/**
 * `§33` — THE COMPLETE C4 MATRIX, END TO END, AGAINST REAL POSTGRESQL.
 *
 * =================================================================================
 * TWELVE CELLS, AND EVERY ONE OF THEM DISPATCHED
 *
 * `tests/gateway/outcome-policy.test.ts` checks the same twelve cells as a PURE FUNCTION.
 * This suite checks them as COMMITTED DATABASE STATE: one real authorisation per cell, one
 * real claim, one real mock invocation, one real outcome transaction, and then direct SQL.
 *
 * `36 §0`'s rule is why both exist. The pure-function suite would pass against a policy table
 * whose answers never reached a row; this one would pass against a transaction that wrote the
 * right row for the wrong reason. Neither alone is the check.
 *
 * `§41`: every expected value comes from `s1jOutcomeTable.ts`, which is hand-transcribed from
 * `25 §7.1` and imports nothing.
 * =================================================================================
 *
 * =================================================================================
 * THE ROW THAT MATTERS MOST, AND WHY IT IS ASSERTED TWICE
 *
 * `25 §7.1`: "**`ADAPTER_RETURNED` FOR AN IRRECOVERABLE EFFECT REACHES `PRESUMED_EXECUTED`,
 * NOT AN AWAITING-VERIFICATION STATE.** [...] The unit moves `reserved → presumed` **exactly
 * once**, on whichever of the two outcomes arrives."
 *
 * v1.3.4 gave one unqualified answer for all three classes on that outcome, and OBX-04's
 * second correction split it. So the matrix asserts the cell, and a separate case asserts that
 * the two IRRECOVERABLE informative cells AGREE — which is the property the correction is
 * about, and which a per-cell assertion would not catch if both were wrong the same way.
 * =================================================================================
 */

let h: OutboxHarness;
const NOW = S1I_NOW;
const CASE = 'case:CS-MATRIX';
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

/** The adapter outcome for one cell, hand-authored per kind. */
function outcomeFor(kind: ExpectedOutcomeKind): AdapterOutcome {
  switch (kind) {
    case 'ADAPTER_RETURNED':
      return returnedOutcome();
    case 'OUTCOME_UNKNOWN':
      return unknownOutcome();
    case 'NOT_SENT_CONFIRMED':
      return notSentOutcome();
    case 'ADAPTER_FAILED':
      return failedOutcome();
  }
}

/** One enqueued effect of the given class, plus the adapter identity it dispatches through. */
async function effectFor(
  recoverability: ExpectedRecoverability,
  suffix: string,
): Promise<{ readonly idempotencyKey: string; readonly adapterId: string }> {
  if (recoverability === 'REVERSIBLE') {
    const effect = await authorisePause(h, { resourceId: `CMP-MX-${suffix}` });
    await enqueueDispatch(h.control, {
      companyId: COMPANY_ID,
      effectId: effect.effectId,
      outboxId: `outbox:${effect.idempotencyKey}`,
      payloadCanonicalBytes: effect.payloadCanonicalBytes,
      now: NOW,
    });
    return { idempotencyKey: effect.idempotencyKey, adapterId: ADAPTER_ADS };
  }
  if (recoverability === 'IRRECOVERABLE') {
    const effect = await authoriseReship(h, { resourceId: `ORD-MX-${suffix}` });
    await enqueueDispatch(h.control, {
      companyId: COMPANY_ID,
      effectId: effect.effectId,
      outboxId: `outbox:${effect.idempotencyKey}`,
      payloadCanonicalBytes: effect.payloadCanonicalBytes,
      now: NOW,
    });
    return { idempotencyKey: effect.idempotencyKey, adapterId: ADAPTER_COMMERCE };
  }
  // COMPENSABLE — the money path, under a live statutory clock so `30 §5.1` row 3 admits it.
  await bindTaskToCase(h.control, REFUND_TASK_ID, CASE);
  await openLiveClock(h.control, {
    caseRef: CASE,
    clockId: `clock:${CASE}`,
    deadlineAt: new Date(NOW.getTime() + 7 * DAY),
  });
  const effect = await authoriseRefund(h);
  await enqueueDispatch(h.control, {
    companyId: COMPANY_ID,
    effectId: effect.effectId,
    outboxId: `outbox:${effect.idempotencyKey}`,
    payloadCanonicalBytes: effect.payloadCanonicalBytes,
    now: NOW,
  });
  return { idempotencyKey: effect.idempotencyKey, adapterId: ADAPTER_PROCESSOR };
}

describe('`25 §7.1` — ALL TWELVE CELLS, AS COMMITTED STATE', () => {
  it('the hand-authored table is exhaustive over 3 classes × 4 outcome kinds', () => {
    expect(EXPECTED_OUTCOMES).toHaveLength(12);
    const seen = new Set(EXPECTED_OUTCOMES.map((r) => `${r.recoverability}/${r.outcomeKind}`));
    expect(seen.size).toBe(12);
  });

  for (const row of EXPECTED_OUTCOMES) {
    const label = `(${row.recoverability}, ${row.outcomeKind})`;
    it(`${label} → ${row.effectStatus ?? 'UNDECLARED'} / ${row.economicMovement ?? 'none'}`, async () => {
      const suffix = `${row.recoverability.slice(0, 3)}${row.outcomeKind.slice(0, 3)}`;
      const effect = await effectFor(row.recoverability, suffix);
      const expected = expectedOutcomeFor(row.recoverability, row.outcomeKind);

      const mock = createMockAdapter({
        adapterId: effect.adapterId,
        resolutionCapabilities: ['IDEMPOTENCY_HEADER', 'DELIVERY_EVENT_WEBHOOK'],
        outcome: outcomeFor(row.outcomeKind),
      });

      const result = await dispatchAuthorisedEffect(dispatchEnv(h, mock), {
        companyId: COMPANY_ID,
        idempotencyKey: effect.idempotencyKey,
        dispatchedBy: `worker:${suffix}`,
        now: NOW,
      });

      // THE ADAPTER WAS ALWAYS INVOKED. Every cell is a real dispatch, including the ones
      // whose local policy is undeclared — the refusal is about the ACCOUNTING, not about
      // whether the effect was attempted.
      expect(mock.callCount, label).toBe(1);

      if (expected.disposition === 'UNDECLARED') {
        expect(result.kind, label).toBe('OUTCOME_REFUSED');
        if (result.kind !== 'OUTCOME_REFUSED') return;
        expect(result.undeclared, label).toBe('ADAPTER_FAILED_REACHES_NO_LOCAL_STATE');
        // NOTHING WRITTEN — `25 §7.1`: it "reaches no local state".
        expect(await rawOutcomeRows(h.control), label).toHaveLength(0);
        expect(await outcomeJournalRows(h.control), label).toHaveLength(0);
      } else {
        expect(result.kind, label).toBe('OUTCOME_RESOLVED');
        if (result.kind !== 'OUTCOME_RESOLVED') return;
        expect(result.record.effectStatus, label).toBe(expected.effectStatus);
        expect(result.record.economicMovement, label).toBe(expected.economicMovement);
        expect(result.record.outcomeKind, label).toBe(row.outcomeKind);
        // ONE OUTCOME ROW AND ONE JOURNAL ROW, always — `23 §6` B8.
        expect(await rawOutcomeRows(h.control), label).toHaveLength(1);
        expect(await outcomeJournalRows(h.control), label).toHaveLength(1);
        // AND THE COMMITTED ROW AGREES WITH WHAT THE GATEWAY REPORTED.
        const committed = (await rawOutcomeRows(h.control))[0]!;
        expect(committed.effectStatus, label).toBe(expected.effectStatus);
        expect(committed.economicMovement, label).toBe(expected.economicMovement);
      }

      // `25 §7.1`: "Same-row redispatch: **NO**", on every row without exception. The claim is
      // committed and the row is `CLAIMED` on every branch, including the undeclared ones.
      expect((await outboxRows(h.control))[0]!.status, label).toBe('CLAIMED');
    });
  }
});

describe('OBX-04 — THE TWO IRRECOVERABLE INFORMATIVE CELLS AGREE, EXACTLY', () => {
  it('`ADAPTER_RETURNED` and `OUTCOME_UNKNOWN` reach the same state by the same movement', async () => {
    /*
     * `25 §7.1`: "The unit moves `reserved → presumed` **exactly once**, on whichever of the
     * two outcomes arrives." And: "`PRESUMED_EXECUTED` reached from `ADAPTER_RETURNED` and
     * `PRESUMED_EXECUTED` reached from `OUTCOME_UNKNOWN` are the same state and are resolved
     * by the same provider evidence."
     *
     * Asserted as an EQUALITY between two real dispatches rather than as two independent
     * expectations, because the property is the agreement.
     */
    const observed: Record<string, { status: string; movement: string; sum: bigint }> = {};

    for (const kind of ['ADAPTER_RETURNED', 'OUTCOME_UNKNOWN'] as const) {
      await h.reset();
      const effect = await effectFor('IRRECOVERABLE', kind.slice(0, 4));
      const before = (await mieRows(h.control, COMPANY_ID)).filter((r) =>
        RESHIP_WINDOWS.includes(r.windowId),
      );
      const mock = createMockAdapter({
        adapterId: effect.adapterId,
        resolutionCapabilities: ['IDEMPOTENCY_HEADER', 'DELIVERY_EVENT_WEBHOOK'],
        outcome: outcomeFor(kind),
      });
      const result = await dispatchAuthorisedEffect(dispatchEnv(h, mock), {
        companyId: COMPANY_ID,
        idempotencyKey: effect.idempotencyKey,
        dispatchedBy: `worker:${kind}`,
        now: NOW,
      });
      expect(result.kind).toBe('OUTCOME_RESOLVED');
      if (result.kind !== 'OUTCOME_RESOLVED') return;

      const after = (await mieRows(h.control, COMPANY_ID)).filter((r) =>
        RESHIP_WINDOWS.includes(r.windowId),
      );
      for (const row of after) {
        expect(row.reservedIrrecoverable, `${kind}/${row.windowId}`).toBe('0');
        expect(row.presumedIrrecoverable, `${kind}/${row.windowId}`).toBe('1');
      }
      // The three-term sum, unchanged — computed from the two snapshots.
      for (const row of before) {
        const match = after.find((r) => r.windowId === row.windowId)!;
        expect(mieCommitment(match), `${kind}/${row.windowId}`).toBe(mieCommitment(row));
      }

      observed[kind] = {
        status: result.record.effectStatus,
        movement: result.record.economicMovement,
        sum: after.reduce((total, r) => total + mieCommitment(r), 0n),
      };
    }

    // THE AGREEMENT, AS ONE ASSERTION.
    expect(observed['ADAPTER_RETURNED']).toEqual(observed['OUTCOME_UNKNOWN']);
    expect(observed['ADAPTER_RETURNED']!.status).toBe('PRESUMED_EXECUTED');
    // AND IT IS NOT THE MONEY ANSWER — the correction OBX-04 made.
    expect(observed['ADAPTER_RETURNED']!.status).not.toBe('DISPATCHED_AWAITING_VERIFICATION');
  });

  it('and the MONEY classes keep the awaiting-verification answer — the split is real', async () => {
    /*
     * The other half of the same correction. If both classes had moved, the matrix would be
     * uniform again and the asymmetry `25 §10` calls "the point" would be gone.
     */
    const effect = await effectFor('REVERSIBLE', 'split');
    const mock = createMockAdapter({
      adapterId: effect.adapterId,
      resolutionCapabilities: ['IDEMPOTENCY_HEADER'],
      outcome: returnedOutcome(),
    });
    const result = await dispatchAuthorisedEffect(dispatchEnv(h, mock), {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      dispatchedBy: 'worker:split',
      now: NOW,
    });
    expect(result.kind).toBe('OUTCOME_RESOLVED');
    if (result.kind !== 'OUTCOME_RESOLVED') return;
    expect(result.record.effectStatus).toBe('DISPATCHED_AWAITING_VERIFICATION');
    expect(result.record.economicMovement).toBe('NONE');
  });
});
