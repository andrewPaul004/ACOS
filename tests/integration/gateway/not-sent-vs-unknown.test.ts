import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { COMPANY_ID } from '../../support/fixture.js';
import {
  RESHIP_WINDOWS,
  S1I_NOW,
  authorisePause,
  authoriseReship,
  createOutboxHarness,
  outboxRows,
  type OutboxHarness,
} from '../../support/outboxFixture.js';
import {
  ADAPTER_ADS,
  ADAPTER_COMMERCE,
  dispatchEnv,
  rawOutcomeRows,
  testRegistry,
} from '../../support/gatewayFixture.js';
import { createMockAdapter, unknownOutcome } from '../../support/mockAdapter.js';
import {
  mieCommitment,
  mieRows,
  type MieSnapshotRow,
} from '../../negative-controls/unsafe-mie-movements.js';
import {
  unsafeFalseNotSentAdapter,
  unsafeMapExceptionToNotSent,
  unsafeRequeueClaimedRow,
} from '../../negative-controls/unsafe-not-sent-mapping.js';
import { enqueueDispatch } from '../../../src/kernel/outbox/enqueue.js';
import { dispatchAuthorisedEffect } from '../../../src/kernel/gateway/effectGateway.js';
import { claimForExternalDispatch } from '../../../src/kernel/outbox/claim.js';

/**
 * `§20`, `§21` — THE FALSE NOT-SENT, AND THE GENERIC-FAILURE RETRY.
 *
 * =================================================================================
 * `35 §4`'s RULE AND ITS MIRROR IMAGE
 *
 * `35 §4`: "conflating 'failed' with 'unknown' is what produces double execution."
 *
 * `25 §7.2` names the mirror image, which is this suite's subject: "**labelling a possible
 * escape as a confirmed non-send would release a commitment for an effect that happened.**"
 *
 * The two errors are symmetric and their costs are not:
 *
 *   failed-as-unknown    → the effect is retried              → DOUBLE EXECUTION
 *   unknown-as-not-sent  → the commitment is released         → the ceiling stops bounding an
 *                                                               effect that already happened,
 *                                                               and the freed headroom funds
 *                                                               another
 *
 * AND THE DISCRIMINATING FACT IS THE SAME ONE IN BOTH DIRECTIONS: did the request cross the
 * adapter's own acceptance point? The mock's `acceptedCount` answers it, and every assertion
 * below is stated against that counter rather than against intent.
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

async function reship(suffix: string): Promise<{ readonly idempotencyKey: string }> {
  const effect = await authoriseReship(h, { resourceId: `ORD-VS-${suffix}` });
  await enqueueDispatch(h.control, {
    companyId: COMPANY_ID,
    effectId: effect.effectId,
    outboxId: `outbox:${effect.idempotencyKey}`,
    payloadCanonicalBytes: effect.payloadCanonicalBytes,
    now: NOW,
  });
  return { idempotencyKey: effect.idempotencyKey };
}

async function pause(suffix: string): Promise<{ readonly idempotencyKey: string }> {
  const effect = await authorisePause(h, { resourceId: `CMP-VS-${suffix}` });
  await enqueueDispatch(h.control, {
    companyId: COMPANY_ID,
    effectId: effect.effectId,
    outboxId: `outbox:${effect.idempotencyKey}`,
    payloadCanonicalBytes: effect.payloadCanonicalBytes,
    now: NOW,
  });
  return { idempotencyKey: effect.idempotencyKey };
}

async function mie(): Promise<
  readonly MieSnapshotRow[]
> {
  return (await mieRows(h.control, COMPANY_ID)).filter((r) =>
    RESHIP_WINDOWS.includes(r.windowId),
  );
}

describe('`§20` — AN ESCAPED REQUEST IS `OUTCOME_UNKNOWN`, NEVER A CONFIRMED NON-SEND', () => {
  it('THE UNSAFE MAPPER: an exception after the acceptance point becomes NOT_SENT_CONFIRMED', () => {
    /*
     * `25 §7.2` forbids this twice over: the classification must come "from its own control
     * flow or from typed provider semantics", and "**THE CLASSIFICATION MAY NOT BE MADE FROM
     * ARBITRARY ERROR-MESSAGE STRINGS.**"
     *
     * The mapper has both defects: it reads a thrown value and it reads its message. The
     * damage is done entirely inside the adapter, which is precisely why `25 §7.2` puts the
     * rule on the ADAPTER rather than on the kernel — the production `AdapterOutcome` type has
     * no field the string could even travel in.
     */
    const mapped = unsafeMapExceptionToNotSent(
      new Error('provider connection refused after send'),
      true,
    );
    expect(mapped.outcome.kind).toBe('NOT_SENT_CONFIRMED');
    // AND THE FACT THAT REFUTES IT IS RIGHT THERE, unread by the mapper.
    expect(mapped.hadAccepted).toBe(true);
  });

  it('IRRECOVERABLE — unsafe releases the unit; production presumes it', async () => {
    /*
     * =================================================================================
     * THE COMPARISON, ON TWO EFFECTS OF THE SAME CLASS UNDER THE SAME CONDITIONS.
     *
     * Both adapters cross their acceptance point. One reports a confirmed non-send; the other
     * reports the truth, which is that the outcome is unknown.
     *
     *   UNSAFE:     acceptedCount 1  →  NOT_SENT_CONFIRMED  →  reserved -= 1, sum FALLS
     *   PRODUCTION: acceptedCount 1  →  OUTCOME_UNKNOWN     →  reserved → presumed, sum HOLDS
     *
     * The second is `25 §10.1`'s whole point: "**Unknown outcome must not create new
     * headroom.**"
     * =================================================================================
     */
    const unsafeEffect = await reship('unsafe-irr');
    const unsafeAdapter = unsafeFalseNotSentAdapter({
      adapterId: ADAPTER_COMMERCE,
      resolutionCapabilities: ['IDEMPOTENCY_HEADER', 'DELIVERY_EVENT_WEBHOOK'],
    });
    const unsafeResult = await dispatchAuthorisedEffect(
      { ...dispatchEnv(h), registry: testRegistry(unsafeAdapter) },
      {
        companyId: COMPANY_ID,
        idempotencyKey: unsafeEffect.idempotencyKey,
        dispatchedBy: 'worker:unsafe',
        now: NOW,
      },
    );
    expect(unsafeResult.kind).toBe('OUTCOME_RESOLVED');
    if (unsafeResult.kind !== 'OUTCOME_RESOLVED') return;
    // THE REQUEST ESCAPED…
    expect(unsafeAdapter.acceptedCount).toBe(1);
    // …AND THE COMMITMENT WAS RELEASED ANYWAY.
    expect(unsafeResult.record.effectStatus).toBe('DISPATCH_NOT_SENT_CONFIRMED');
    expect(unsafeResult.record.economicMovement).toBe('MIE_RESERVED_RELEASED');
    const afterUnsafe = await mie();
    for (const row of afterUnsafe) expect(mieCommitment(row), row.windowId).toBe(0n);

    // PRODUCTION, on a second effect: the honest classification for the same situation.
    await h.reset();
    const honestEffect = await reship('honest-irr');
    const honestAdapter = createMockAdapter({
      adapterId: ADAPTER_COMMERCE,
      resolutionCapabilities: ['IDEMPOTENCY_HEADER', 'DELIVERY_EVENT_WEBHOOK'],
      outcome: unknownOutcome(),
    });
    const honest = await dispatchAuthorisedEffect(dispatchEnv(h, honestAdapter), {
      companyId: COMPANY_ID,
      idempotencyKey: honestEffect.idempotencyKey,
      dispatchedBy: 'worker:honest',
      now: NOW,
    });
    expect(honest.kind).toBe('OUTCOME_RESOLVED');
    if (honest.kind !== 'OUTCOME_RESOLVED') return;
    expect(honestAdapter.acceptedCount).toBe(1);
    expect(honest.record.effectStatus).toBe('PRESUMED_EXECUTED');
    expect(honest.record.economicMovement).toBe('MIE_RESERVED_TO_PRESUMED');
    for (const row of await mie()) {
      expect(row.reservedIrrecoverable, row.windowId).toBe('0');
      expect(row.presumedIrrecoverable, row.windowId).toBe('1');
      // THE SUM HOLDS. This single assertion is the discrimination.
      expect(mieCommitment(row), row.windowId).toBe(1n);
    }
  });

  it('MONEY — unsafe releases the reservation; production holds it', async () => {
    /*
     * `35 §4`: "The exposure reservation **remains held**. It is not released on timeout,
     * because releasing it would let a retry plus a concurrent proposal collectively exceed
     * the window." `25 §7.2` restates it: "**Nothing is released on `OUTCOME_UNKNOWN`.**"
     */
    const effect = await pause('money-honest');
    const adapter = createMockAdapter({
      adapterId: ADAPTER_ADS,
      resolutionCapabilities: ['IDEMPOTENCY_HEADER'],
      outcome: unknownOutcome(),
    });
    const result = await dispatchAuthorisedEffect(dispatchEnv(h, adapter), {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      dispatchedBy: 'worker:money-honest',
      now: NOW,
    });
    expect(result.kind).toBe('OUTCOME_RESOLVED');
    if (result.kind !== 'OUTCOME_RESOLVED') return;
    expect(adapter.acceptedCount).toBe(1);
    expect(result.record.effectStatus).toBe('DISPATCHED_OUTCOME_UNKNOWN');
    // HOLDING IS THE ABSENCE OF A MOVEMENT — and the gateway reports no moved window.
    expect(result.record.economicMovement).toBe('NONE');
    expect(result.movedWindows).toHaveLength(0);

    // The unsafe adapter, on a second effect: released.
    await h.reset();
    const unsafeEffect = await pause('money-unsafe');
    const unsafeAdapter = unsafeFalseNotSentAdapter({
      adapterId: ADAPTER_ADS,
      resolutionCapabilities: ['IDEMPOTENCY_HEADER'],
    });
    const unsafe = await dispatchAuthorisedEffect(
      { ...dispatchEnv(h), registry: testRegistry(unsafeAdapter) },
      {
        companyId: COMPANY_ID,
        idempotencyKey: unsafeEffect.idempotencyKey,
        dispatchedBy: 'worker:money-unsafe',
        now: NOW,
      },
    );
    expect(unsafe.kind).toBe('OUTCOME_RESOLVED');
    if (unsafe.kind !== 'OUTCOME_RESOLVED') return;
    expect(unsafeAdapter.acceptedCount).toBe(1);
    expect(unsafe.record.economicMovement).toBe('RESERVATION_RELEASED');
    // THE DISCRIMINATION, AS ONE COMPARISON.
    expect(unsafe.record.economicMovement).not.toBe('NONE');
  });

  it('NEITHER OUTCOME RETRIES — the claimed identity is terminal on both paths', async () => {
    /*
     * The one property the two share, and it is `25 §7.1`'s: "**ONCE A ROW IS `CLAIMED`, THE
     * SAME OUTBOX IDENTITY IS NEVER RETRIED OR REDISPATCHED, ON ANY OUTCOME.**" So the harm of
     * a false not-sent is entirely economic — it does not also produce a second send, which is
     * why the accounting is the thing that has to be right.
     */
    const effect = await reship('no-retry');
    const adapter = unsafeFalseNotSentAdapter({
      adapterId: ADAPTER_COMMERCE,
      resolutionCapabilities: ['IDEMPOTENCY_HEADER', 'DELIVERY_EVENT_WEBHOOK'],
    });
    await dispatchAuthorisedEffect(
      { ...dispatchEnv(h), registry: testRegistry(adapter) },
      {
        companyId: COMPANY_ID,
        idempotencyKey: effect.idempotencyKey,
        dispatchedBy: 'worker:no-retry',
        now: NOW,
      },
    );
    expect(adapter.callCount).toBe(1);

    const reclaim = await claimForExternalDispatch(h.control, {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      claimedBy: 'worker:retry',
      now: new Date(NOW.getTime() + DAY),
    });
    expect(reclaim.kind).toBe('REFUSED');
  });
});

describe('`§21` — THE GENERIC-FAILURE RETRY, AND THE K4 CORRECTION', () => {
  it('the UNSAFE requeue returns a CLAIMED row to ENQUEUED and dispatches it twice', async () => {
    /*
     * =================================================================================
     * THE CONTRADICTION v1.3.5 RESOLVED, DEMONSTRATED.
     *
     * `24 §3` K4 as issued: "On **adapter failure**, bounded retry with jitter against the
     * same idempotency key". `25 §7` OBX-01 as issued: "**no transition out of `CLAIMED`, and
     * no second transition into it**." Both cannot be followed.
     *
     * OBX-04 resolves it in OBX-01's favour, and this control shows what the other reading
     * costs: ONE authorised effect, TWO adapter invocations.
     *
     * THE CONTROL HAS TO DISABLE A DATABASE TRIGGER TO DO IT, and that is itself the proof. No
     * production code path can requeue a claimed row, because `0010`'s state machine refuses
     * every UPDATE to one and nothing in `src/` disables a trigger.
     * =================================================================================
     */
    const effect = await reship('requeue');
    const adapter = createMockAdapter({
      adapterId: ADAPTER_COMMERCE,
      resolutionCapabilities: ['IDEMPOTENCY_HEADER', 'DELIVERY_EVENT_WEBHOOK'],
      outcome: unknownOutcome(),
    });

    const first = await dispatchAuthorisedEffect(dispatchEnv(h, adapter), {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      dispatchedBy: 'worker:requeue-1',
      now: NOW,
    });
    expect(first.kind).toBe('OUTCOME_RESOLVED');
    expect(adapter.callCount).toBe(1);
    expect((await outboxRows(h.control))[0]!.status).toBe('CLAIMED');

    // PRODUCTION'S ANSWER TO A SECOND ATTEMPT, first: refused.
    const productionSecond = await dispatchAuthorisedEffect(dispatchEnv(h, adapter), {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      dispatchedBy: 'worker:requeue-2',
      now: new Date(NOW.getTime() + DAY),
    });
    expect(productionSecond.kind).toBe('CLAIM_REFUSED');
    expect(adapter.callCount, 'production invoked the adapter a second time').toBe(1);

    // THE UNSAFE K4 READING: put the row back, then claim it again.
    await unsafeRequeueClaimedRow(h.control, COMPANY_ID, effect.idempotencyKey);
    expect((await outboxRows(h.control))[0]!.status).toBe('ENQUEUED');

    const mieBefore = await mie();
    await expect(
      dispatchAuthorisedEffect(dispatchEnv(h, adapter), {
        companyId: COMPANY_ID,
        idempotencyKey: effect.idempotencyKey,
        dispatchedBy: 'worker:requeue-3',
        now: new Date(NOW.getTime() + 2 * DAY),
      }),
    ).rejects.toThrow(/window_balance_irrecoverable_non_negative/);

    // ============================================================================
    // THE HARM, AND THE BACKSTOP, IN THAT ORDER.
    //
    // THE ADAPTER WAS INVOKED TWICE FOR ONE AUTHORISED EFFECT. That is `I36`'s violation and
    // it is IRREVERSIBLE — a second send has left. No database control can undo it, which is
    // exactly why `25 §7.1` corrects K4 at the CLAIM rather than at the outcome.
    expect(adapter.callCount).toBe(2);
    expect(adapter.acceptedCount).toBe(2);

    // AND THE ACCOUNTING REFUSED TO FOLLOW IT. The second PRESUME would drive
    // `reserved_irrecoverable` below zero on a window holding one unit, and `0002`'s
    // `window_balance_irrecoverable_non_negative` CHECK refuses it — the THIRD mechanism in
    // `mie-outcome-duplicate.test.ts`'s list, catching what the first two could not because
    // the control defeated both of them by hand.
    //
    // `36 §0`'s single-mechanism rule, earning its keep: the outcome row's primary key and the
    // outbox row lock were both disabled, and the ledger's own arithmetic still held.
    expect(await mie()).toEqual(mieBefore);
    expect(await rawOutcomeRows(h.control)).toHaveLength(0);
  });

  it('`ADAPTER_FAILED` reaches no state and requeues nothing — `25 §7.1`', async () => {
    /*
     * "Retained for diagnostics only. **It carries no local outcome policy and reaches no
     * local state**, because a failure the adapter cannot classify as confirmed-not-sent is a
     * failure whose request may have escaped."
     *
     * So the refusal writes nothing AND leaves the claim exactly where it is — which is the
     * corrected K4: the retry applies to workflow failures before a claim, not to this.
     */
    const effect = await reship('failed');
    const adapter = createMockAdapter({
      adapterId: ADAPTER_COMMERCE,
      resolutionCapabilities: ['IDEMPOTENCY_HEADER', 'DELIVERY_EVENT_WEBHOOK'],
      outcome: { kind: 'ADAPTER_FAILED', failureClass: 'MOCK_REJECTED' },
    });
    const before = await mie();

    const result = await dispatchAuthorisedEffect(dispatchEnv(h, adapter), {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      dispatchedBy: 'worker:failed',
      now: NOW,
    });

    expect(result.kind).toBe('OUTCOME_REFUSED');
    if (result.kind !== 'OUTCOME_REFUSED') return;
    expect(result.reason).toBe('OUTCOME_POLICY_UNDECLARED');
    expect(result.undeclared).toBe('ADAPTER_FAILED_REACHES_NO_LOCAL_STATE');

    // NOTHING WRITTEN, AND NOTHING MOVED — the commitment is still reserved.
    expect(await rawOutcomeRows(h.control)).toHaveLength(0);
    expect(await mie()).toEqual(before);
    // AND THE ROW IS STILL CLAIMED. No requeue, no retry, no second invocation.
    expect((await outboxRows(h.control))[0]!.status).toBe('CLAIMED');
    const second = await dispatchAuthorisedEffect(dispatchEnv(h, adapter), {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      dispatchedBy: 'worker:failed-2',
      now: new Date(NOW.getTime() + DAY),
    });
    expect(second.kind).toBe('CLAIM_REFUSED');
    expect(adapter.callCount).toBe(1);
  });
});
