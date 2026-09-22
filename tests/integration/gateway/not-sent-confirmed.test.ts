import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { COMPANY_ID } from '../../support/fixture.js';
import {
  RESHIP_WINDOWS,
  S1I_NOW,
  authorisePause,
  authoriseReship,
  createOutboxHarness,
  openLiveClock,
  outboxRows,
  REFUND_TASK_ID,
  authoriseRefund,
  bindTaskToCase,
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
import { createMockAdapter, notSentOutcome, unknownOutcome } from '../../support/mockAdapter.js';
import {
  mieCommitment,
  mieRows,
  type MieSnapshotRow,
} from '../../negative-controls/unsafe-mie-movements.js';
import { expectedOutcomeFor } from '../../support/s1jOutcomeTable.js';
import { enqueueDispatch } from '../../../src/kernel/outbox/enqueue.js';
import { dispatchAuthorisedEffect } from '../../../src/kernel/gateway/effectGateway.js';
import { claimForExternalDispatch } from '../../../src/kernel/outbox/claim.js';
import { NOT_SENT_BASES } from '../../../src/kernel/gateway/adapterPort.js';

/**
 * `§17`, `§18`, `§19` — `NOT_SENT_CONFIRMED`, THE TERMINAL STATE, AND THE RELEASE.
 *
 * =================================================================================
 * `25 §7.2`, VERBATIM — THE THREE THINGS THIS SUITE ASSERTS
 *
 *   "**`NOT_SENT_CONFIRMED` may be returned only by a trusted adapter, and only where the
 *    adapter can positively establish from its own control flow or from typed provider
 *    semantics that NO EXTERNAL WRITE CROSSED THE TRANSPORT BOUNDARY.**"
 *
 *   "**The local state is `DISPATCH_NOT_SENT_CONFIRMED`, and it is deliberately NOT
 *    `NEVER_SENT`.**"
 *
 *   "**Because `NOT_SENT_CONFIRMED` proves the external effect did not happen, the existing
 *    commitment is released — in the SAME atomic outcome transaction — according to its
 *    recoverability class.**"
 *
 * AND THE ONE THAT CONSTRAINS EVERY OTHER OUTCOME: "**THE OLD OUTBOX IDENTITY IS TERMINAL AND
 * NON-RECLAIMABLE.** A row in `DISPATCH_NOT_SENT_CONFIRMED` may not return to `ENQUEUED`, may
 * not become `READY`, may not enter a retry state and may not be claimed a second time. **If
 * the business intent should be attempted again, that requires a NEW PROPOSAL, A NEW
 * AUTHORISATION and a NEW EFFECT/OUTBOX IDENTITY.**"
 * =================================================================================
 */

let h: OutboxHarness;
const NOW = S1I_NOW;
const DAY = 24 * 60 * 60 * 1000;
const CASE = 'case:CS-NOTSENT';

beforeAll(async () => {
  h = await createOutboxHarness();
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  await h.reset();
});

async function enqueue(effect: {
  readonly effectId: string;
  readonly idempotencyKey: string;
  readonly payloadCanonicalBytes: Buffer;
}): Promise<void> {
  await enqueueDispatch(h.control, {
    companyId: COMPANY_ID,
    effectId: effect.effectId,
    outboxId: `outbox:${effect.idempotencyKey}`,
    payloadCanonicalBytes: effect.payloadCanonicalBytes,
    now: NOW,
  });
}

/** One IRRECOVERABLE effect, enqueued. */
async function reship(suffix: string): Promise<{ readonly idempotencyKey: string }> {
  const effect = await authoriseReship(h, { resourceId: `ORD-NS-${suffix}` });
  await enqueue(effect);
  return { idempotencyKey: effect.idempotencyKey };
}

/** One REVERSIBLE effect, enqueued. */
async function pause(suffix: string): Promise<{ readonly idempotencyKey: string }> {
  const effect = await authorisePause(h, { resourceId: `CMP-NS-${suffix}` });
  await enqueue(effect);
  return { idempotencyKey: effect.idempotencyKey };
}

/** One COMPENSABLE money effect, enqueued under a live clock so row 3 admits it. */
async function refund(): Promise<{
  readonly idempotencyKey: string;
  readonly authorisationId: string;
}> {
  await bindTaskToCase(h.control, REFUND_TASK_ID, CASE);
  await openLiveClock(h.control, {
    caseRef: CASE,
    clockId: `clock:${CASE}`,
    deadlineAt: new Date(NOW.getTime() + 7 * DAY),
  });
  const effect = await authoriseRefund(h);
  await enqueue(effect);
  return { idempotencyKey: effect.idempotencyKey, authorisationId: effect.authorisationId };
}

function mock(adapterId: string, options: { readonly preSend?: boolean } = {}) {
  return createMockAdapter({
    adapterId,
    resolutionCapabilities: ['IDEMPOTENCY_HEADER', 'DELIVERY_EVENT_WEBHOOK'],
    ...(options.preSend === true
      ? { outcome: unknownOutcome(), failBeforeSend: 'PRE_SEND_FAILURE' as const }
      : { outcome: notSentOutcome() }),
  });
}

async function mie(): Promise<
  readonly MieSnapshotRow[]
> {
  return (await mieRows(h.control, COMPANY_ID)).filter((r) =>
    RESHIP_WINDOWS.includes(r.windowId),
  );
}

interface ReservationRow {
  readonly reservationId: string;
  readonly releasedAt: string | null;
  readonly releasedReason: string | null;
}

async function reservations(): Promise<readonly ReservationRow[]> {
  const client = await h.control.connect();
  try {
    const r = await client.query<{
      reservation_id: string;
      released_at: string | null;
      released_reason: string | null;
    }>(
      `SELECT reservation_id, released_at::TEXT AS released_at, released_reason
         FROM exposure_reservation WHERE company_id = $1 ORDER BY reservation_id`,
      [COMPANY_ID],
    );
    return r.rows.map((row) => ({
      reservationId: row.reservation_id,
      releasedAt: row.released_at,
      releasedReason: row.released_reason,
    }));
  } finally {
    client.release();
  }
}

describe('`§17` — THE BASIS IS TYPED CONTROL FLOW, NEVER AN ERROR STRING', () => {
  it('the two admissible bases are `25 §7.2`s, and nothing else is representable', () => {
    /*
     * "Admissible bases include a failure raised **before** the external request was opened or
     * sent, and a provider rejection whose declared adapter contract guarantees no external
     * mutation occurred."
     *
     * A closed two-member enum, hand-transcribed here. `25 §7.2`: "**THE CLASSIFICATION MAY
     * NOT BE MADE FROM ARBITRARY ERROR-MESSAGE STRINGS** [...] a string is a vendor's prose,
     * and an economic release decided by prose is a release decided by the vendor's changelog."
     */
    expect([...NOT_SENT_BASES]).toEqual(['PRE_SEND_FAILURE', 'PROVIDER_REJECTED_NO_MUTATION']);
  });

  it('a GENUINE pre-send failure never reaches the acceptance point — `§17`', async () => {
    /*
     * The mock's control flow IS the proof. `failBeforeSend` returns before `acceptedCount` is
     * incremented, so the counter is an observed fact about what the adapter did rather than a
     * claim about what it meant.
     */
    const effect = await reship('genuine');
    const adapter = mock(ADAPTER_COMMERCE, { preSend: true });

    const result = await dispatchAuthorisedEffect(dispatchEnv(h, adapter), {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      dispatchedBy: 'worker:genuine',
      now: NOW,
    });

    expect(result.kind).toBe('OUTCOME_RESOLVED');
    // INVOKED, AND NOTHING LEFT. This pair is the whole evidentiary basis.
    expect(adapter.callCount).toBe(1);
    expect(adapter.acceptedCount).toBe(0);
    if (result.kind !== 'OUTCOME_RESOLVED') return;
    expect(result.record.outcomeKind).toBe('NOT_SENT_CONFIRMED');
  });
});

describe('`§18` — THE LOCAL STATE IS TERMINAL, AND THE OLD IDENTITY NEVER RETURNS', () => {
  it('every class reaches `DISPATCH_NOT_SENT_CONFIRMED` — `25 §7.1` row 7', async () => {
    /*
     * Row 7 is the only row in the C4 matrix whose recoverability column reads "any". Asserted
     * for all three classes against the HAND-AUTHORED table rather than against production's.
     */
    for (const [label, make, adapterId, recoverability] of [
      ['REVERSIBLE', pause, ADAPTER_ADS, 'REVERSIBLE'],
      ['IRRECOVERABLE', reship, ADAPTER_COMMERCE, 'IRRECOVERABLE'],
    ] as const) {
      await h.reset();
      const effect = await make(`term-${label}`);
      const expected = expectedOutcomeFor(recoverability, 'NOT_SENT_CONFIRMED');
      const result = await dispatchAuthorisedEffect(dispatchEnv(h, mock(adapterId)), {
        companyId: COMPANY_ID,
        idempotencyKey: effect.idempotencyKey,
        dispatchedBy: `worker:${label}`,
        now: NOW,
      });
      expect(result.kind, label).toBe('OUTCOME_RESOLVED');
      if (result.kind !== 'OUTCOME_RESOLVED') return;
      expect(result.record.effectStatus, label).toBe(expected.effectStatus);
      expect(result.record.economicMovement, label).toBe(expected.economicMovement);
    }
  });

  it('the outbox identity stays CLAIMED — it does not return to ENQUEUED or READY', async () => {
    /*
     * `25 §7.2`: "A row in `DISPATCH_NOT_SENT_CONFIRMED` may not return to `ENQUEUED`, may not
     * become `READY`, may not enter a retry state and may not be claimed a second time."
     *
     * The enforcement is `0010`'s state machine trigger, which refuses every UPDATE to a
     * `CLAIMED` row — so the terminal state lives on the OUTCOME row and the outbox row is
     * simply never touched. `25 §7` OBX-01: "no transition out of `CLAIMED`".
     */
    const effect = await reship('terminal');
    await dispatchAuthorisedEffect(dispatchEnv(h, mock(ADAPTER_COMMERCE)), {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      dispatchedBy: 'worker:terminal',
      now: NOW,
    });

    const row = (await outboxRows(h.control))[0]!;
    expect(row.status).toBe('CLAIMED');
    expect((await rawOutcomeRows(h.control))[0]!.effectStatus).toBe(
      'DISPATCH_NOT_SENT_CONFIRMED',
    );

    // AND IT CANNOT BE CLAIMED A SECOND TIME, at any later instant.
    const reclaim = await claimForExternalDispatch(h.control, {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      claimedBy: 'worker:again',
      now: new Date(NOW.getTime() + 90 * DAY),
    });
    expect(reclaim.kind).toBe('REFUSED');
    if (reclaim.kind === 'REFUSED') expect(reclaim.reason).toBe('ALREADY_CLAIMED');

    // A SECOND DISPATCH OF THE SAME IDENTITY REACHES NO ADAPTER.
    const second = mock(ADAPTER_COMMERCE);
    const result = await dispatchAuthorisedEffect(dispatchEnv(h, second), {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      dispatchedBy: 'worker:again-2',
      now: new Date(NOW.getTime() + 91 * DAY),
    });
    expect(result.kind).toBe('CLAIM_REFUSED');
    expect(second.callCount).toBe(0);
  });

  it('`NEVER_SENT` is NOT the state, and the schema has no arm for it', async () => {
    /*
     * `25 §7.2`: "**The local state is `DISPATCH_NOT_SENT_CONFIRMED`, and it is deliberately
     * NOT `NEVER_SENT`.** The two are kept distinct because their evidence differs in kind:
     * one is **immediate trusted-adapter proof at the dispatch attempt**, the other is **later
     * independent provider reconciliation**."
     */
    const effect = await reship('never-sent');
    const result = await dispatchAuthorisedEffect(dispatchEnv(h, mock(ADAPTER_COMMERCE)), {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      dispatchedBy: 'worker:never',
      now: NOW,
    });
    // `journalSeq` is a `bigint`, which `JSON.stringify` refuses — the same discipline
    // `src/audit/ingress.ts` applies on the wire, and for `30 §5.2`'s reason.
    const serialised = JSON.stringify(result, (_k, v) =>
      typeof v === 'bigint' ? v.toString() : v,
    );
    expect(serialised).not.toContain('NEVER_SENT');

    // AND THE SCHEMA HAS NO ARM FOR IT EITHER, so a later code path cannot write one.
    //
    // The probe runs against a DIFFERENT effect — one that is CLAIMED with no outcome row, so
    // the insert reaches the domain CHECK rather than stopping at the outcome table's own
    // primary key or at `0012`'s eight-column foreign key. An `ADAPTER_FAILED` dispatch leaves
    // exactly that state: `25 §7.1` gives the kind no local state, so the claim commits and
    // nothing is recorded.
    const probe = await reship('never-sent-probe');
    const failing = createMockAdapter({
      adapterId: ADAPTER_COMMERCE,
      resolutionCapabilities: ['IDEMPOTENCY_HEADER', 'DELIVERY_EVENT_WEBHOOK'],
      outcome: { kind: 'ADAPTER_FAILED', failureClass: 'MOCK_REJECTED' },
    });
    await dispatchAuthorisedEffect(dispatchEnv(h, failing), {
      companyId: COMPANY_ID,
      idempotencyKey: probe.idempotencyKey,
      dispatchedBy: 'worker:probe',
      now: NOW,
    });

    const client = await h.control.connect();
    try {
      const rows = await outboxRows(h.control);
      const row = rows.find((r) => r.idempotencyKey === probe.idempotencyKey)!;
      expect(row.status).toBe('CLAIMED');
      await expect(
        client.query(
          `INSERT INTO effect_dispatch_outcome (
             company_id, idempotency_key, outbox_id, effect_id, authorisation_id, claim_id,
             adapter, recoverability, outcome_kind, effect_status,
             requires_unmirrored_tag, unmirrored_tag_sent, economic_movement,
             invoked_at, outcome_at, journal_seq)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'IRRECOVERABLE', 'NOT_SENT_CONFIRMED',
                   'NEVER_SENT', FALSE, FALSE, 'MIE_RESERVED_RELEASED', $8, $8, 1)`,
          [
            COMPANY_ID,
            row.idempotencyKey,
            row.outboxId,
            row.effectId,
            row.authorisationId,
            row.claimId,
            row.adapter,
            NOW,
          ],
        ),
      ).rejects.toThrow(/dispatch_outcome_effect_status_declared|dispatch_outcome_c4_/);
    } finally {
      client.release();
    }
  });
});

describe('`§19` — THE RELEASE, IN THE SAME ATOMIC OUTCOME TRANSACTION', () => {
  it('IRRECOVERABLE: `reserved -= units`, with NO presumed and NO realised increment', async () => {
    /*
     * `25 §7.2`: "For IRRECOVERABLE, `reserved_irrecoverable -= units`, **with no presumed and
     * no realised increment**. **No presumed unit is touched**, because `NOT_SENT_CONFIRMED`
     * is admissible only before an uncertain or executed classification has been reached."
     *
     * The sum FALLS here, and that is correct precisely because a trusted adapter established
     * that the effect did not happen — the opposite of the unknown branch, where the sum must
     * not fall. Both are asserted as computed sums so the contrast is arithmetic.
     */
    const effect = await reship('release-irr');
    const before = await mie();
    for (const row of before) {
      expect(row.reservedIrrecoverable, row.windowId).toBe('1');
      expect(mieCommitment(row), row.windowId).toBe(1n);
    }

    const result = await dispatchAuthorisedEffect(dispatchEnv(h, mock(ADAPTER_COMMERCE)), {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      dispatchedBy: 'worker:release-irr',
      now: NOW,
    });
    expect(result.kind).toBe('OUTCOME_RESOLVED');
    if (result.kind !== 'OUTCOME_RESOLVED') return;
    expect(result.record.economicMovement).toBe('MIE_RESERVED_RELEASED');

    for (const row of await mie()) {
      expect(row.reservedIrrecoverable, row.windowId).toBe('0');
      // NO PRESUMED UNIT IS TOUCHED.
      expect(row.presumedIrrecoverable, row.windowId).toBe('0');
      expect(row.realisedIrrecoverable, row.windowId).toBe('0');
      // THE SUM FALLS — the whole commitment is gone, because the effect provably did not
      // happen.
      expect(mieCommitment(row), row.windowId).toBe(0n);
    }

    // AND IT IS EVIDENCED. `0013` stamps the reservation so `I3` term 1 stays reconstructable
    // as the sum over UNRELEASED reservations.
    const rows = await reservations();
    expect(rows.some((r) => r.releasedReason === 'DISPATCH_NOT_SENT_CONFIRMED')).toBe(true);
  });

  it('the release is ATOMIC with the outcome row and the journal row', async () => {
    /*
     * `25 §7.2`: "the existing commitment is released — **in the SAME atomic outcome
     * transaction**". A kill before the COMMIT must leave the commitment exactly where it was.
     */
    const effect = await reship('atomic');
    const before = await mie();

    await expect(
      dispatchAuthorisedEffect(
        dispatchEnv(h, mock(ADAPTER_COMMERCE)),
        {
          companyId: COMPANY_ID,
          idempotencyKey: effect.idempotencyKey,
          dispatchedBy: 'worker:atomic',
          now: NOW,
        },
        { hooks: { beforeOutcomeCommit: () => Promise.reject(new Error('kill')) } },
      ),
    ).rejects.toThrow('kill');

    expect(await mie()).toEqual(before);
    expect(await rawOutcomeRows(h.control)).toHaveLength(0);
    expect(await outcomeJournalRows(h.control)).toHaveLength(0);
    // The reservation is unstamped — the release and the row share a commit point.
    expect((await reservations()).every((r) => r.releasedAt === null)).toBe(true);
  });

  it('a RELEASED reservation cannot be un-released — `0013`s one-way trigger', async () => {
    /*
     * A reservation that could be un-released is a reservation whose headroom could be
     * consumed twice: release the units, clear the stamp, and the next reader believes the
     * commitment is still held while the balance says it is not.
     */
    const effect = await reship('one-way');
    await dispatchAuthorisedEffect(dispatchEnv(h, mock(ADAPTER_COMMERCE)), {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      dispatchedBy: 'worker:one-way',
      now: NOW,
    });

    const client = await h.control.connect();
    try {
      await expect(
        client.query(
          `UPDATE exposure_reservation SET released_at = NULL, released_reason = NULL
            WHERE company_id = $1 AND released_at IS NOT NULL`,
          [COMPANY_ID],
        ),
      ).rejects.toThrow(/RESERVATION_RELEASE_IS_ONE_WAY/);
    } finally {
      client.release();
    }
  });

  it('MONEY: the reservation is released, and nothing is marked realised', async () => {
    /*
     * `25 §7.2`: "For REVERSIBLE and COMPENSABLE money, the still-held reservation is released
     * under the existing reservation-release semantics." `S1J-C8` records that no accepted
     * slice HAD any, and what was built: the same two terms step R moved, by the same amounts,
     * on the same bound instances.
     *
     * `§19`: "Do not mark realised." Asserted directly — a release that realised would be an
     * assertion that the effect happened, which is the opposite of what the outcome proves.
     */
    const effect = await refund();
    const client = await h.control.connect();
    const money = async (): Promise<readonly { reserved: string; realised: string }[]> => {
      const r = await client.query<{ reserved: string; realised: string }>(
        `SELECT reserved_monetary::TEXT AS reserved, realised_monetary::TEXT AS realised
           FROM window_balance
          WHERE company_id = $1 AND window_id LIKE '%REFUND%' ORDER BY window_id`,
        [COMPANY_ID],
      );
      return r.rows;
    };
    try {
      const before = await money();
      expect(before.length).toBeGreaterThan(0);
      expect(before.some((m) => m.reserved !== '0.00')).toBe(true);

      const result = await dispatchAuthorisedEffect(dispatchEnv(h, mock(ADAPTER_PROCESSOR)), {
        companyId: COMPANY_ID,
        idempotencyKey: effect.idempotencyKey,
        dispatchedBy: 'worker:release-money',
        now: NOW,
      });
      expect(result.kind).toBe('OUTCOME_RESOLVED');
      if (result.kind !== 'OUTCOME_RESOLVED') return;
      expect(result.record.effectStatus).toBe('DISPATCH_NOT_SENT_CONFIRMED');
      expect(result.record.economicMovement).toBe('RESERVATION_RELEASED');

      const after = await money();
      for (const row of after) {
        expect(row.reserved).toBe('0.00');
        // NOTHING IS REALISED. `24 §3` K5's realised term is fed by settlement events.
        expect(row.realised).toBe('0.00');
      }
    } finally {
      client.release();
    }
  });
});
