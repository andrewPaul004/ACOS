import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { COMPANY_ID } from '../../support/fixture.js';
import {
  REFUND_TASK_ID,
  S1I_NOW,
  authorisePause,
  authoriseRefund,
  authoriseReship,
  bindTaskToCase,
  claimJournalRows,
  createOutboxHarness,
  economicSnapshot,
  openLiveClock,
  outboxRows,
  type AuthorisedEffect,
  type EconomicSnapshot,
  type OutboxHarness,
} from '../../support/outboxFixture.js';
import {
  ADAPTER_ADS,
  ADAPTER_COMMERCE,
  ADAPTER_PROCESSOR,
  outcomeJournalRows,
  rawOutcomeRows,
  testRegistry,
} from '../../support/gatewayFixture.js';
import {
  createMockAdapter,
  failedOutcome,
  returnedOutcome,
  unknownOutcome,
} from '../../support/mockAdapter.js';
import { expectedOutcomeFor } from '../../support/s1jOutcomeTable.js';
import {
  unsafeMieSnapshot,
  unsafeConsumeIrrecoverableUnit,
} from '../../negative-controls/unsafe-mie-consumption.js';
import { enqueueDispatch } from '../../../src/kernel/outbox/enqueue.js';
import { claimForExternalDispatch } from '../../../src/kernel/outbox/claim.js';
import { dispatchAuthorisedEffect } from '../../../src/kernel/gateway/effectGateway.js';

/**
 * `§15`, `§16`, `§18`, `§19`, `§26`, `§27`, `§42` — THE OUTCOME BRANCHES, PER CLASS.
 *
 * =================================================================================
 * `25 §10`'s TABLE, EXERCISED AGAINST REAL POSTGRESQL AND DIRECT SQL
 *
 * The expected state on every branch comes from `tests/support/s1jOutcomeTable.ts`, which
 * imports nothing and was transcribed by hand from `25 §10`, `25 §5`, `35 §4` and
 * `24 §3` K4 (`§41`). Every economic assertion is a raw-SQL snapshot of
 * `exposure_reservation`, `window_balance` (all eleven ledger terms), and
 * `standing_window_exposure`, compared with `toEqual` before and after (`§42`).
 * =================================================================================
 */

let h: OutboxHarness;
const NOW = S1I_NOW;
const DAY = 24 * 60 * 60 * 1000;
const CASE = 'case:CS-OUTCOME';

beforeAll(async () => {
  h = await createOutboxHarness();
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await h.reset();
});

async function enqueue(effect: AuthorisedEffect, tag: string): Promise<void> {
  const outcome = await enqueueDispatch(h.control, {
    companyId: COMPANY_ID,
    effectId: effect.effectId,
    outboxId: `outbox:${tag}`,
    payloadCanonicalBytes: effect.payloadCanonicalBytes,
    now: NOW,
  });
  expect(outcome.kind).toBe('ENQUEUED');
}

/** REVERSIBLE, `30 §5.1` row 5, eligible in `NORMAL` with no clock and no override. */
async function reversible(tag: string): Promise<AuthorisedEffect> {
  const effect = await authorisePause(h, { resourceId: `CMP-${tag}` });
  await enqueue(effect, tag);
  return effect;
}

/** COMPENSABLE money, `30 §5.1` row 3, made eligible by a live statutory clock. */
async function compensableOnAClock(tag: string): Promise<AuthorisedEffect> {
  await bindTaskToCase(h.control, REFUND_TASK_ID, CASE);
  const effect = await authoriseRefund(h);
  await enqueue(effect, tag);
  await openLiveClock(h.control, {
    caseRef: CASE,
    clockId: `clock:${tag}`,
    deadlineAt: new Date(NOW.getTime() + 7 * DAY),
  });
  return effect;
}

/** IRRECOVERABLE, `30 §5.1` row 1, eligible in `NORMAL` only (v1.3.4, IRN-01). */
async function irrecoverable(tag: string): Promise<AuthorisedEffect> {
  const effect = await authoriseReship(h, { resourceId: `ORD-${tag}` });
  await enqueue(effect, tag);
  return effect;
}

function mockFor(
  adapterId: string,
  outcome: ReturnType<typeof returnedOutcome>,
): ReturnType<typeof createMockAdapter> {
  return createMockAdapter({
    adapterId,
    resolutionCapabilities: ['IDEMPOTENCY_HEADER', 'DELIVERY_EVENT_WEBHOOK'],
    outcome,
  });
}

async function dispatch(
  effect: AuthorisedEffect,
  adapterId: string,
  outcome: ReturnType<typeof returnedOutcome>,
  worker = 'worker:outcome',
): Promise<{
  readonly result: Awaited<ReturnType<typeof dispatchAuthorisedEffect>>;
  readonly mock: ReturnType<typeof createMockAdapter>;
}> {
  const mock = mockFor(adapterId, outcome);
  const result = await dispatchAuthorisedEffect(h.control, testRegistry(mock), {
    companyId: COMPANY_ID,
    idempotencyKey: effect.idempotencyKey,
    dispatchedBy: worker,
    now: NOW,
  });
  return { result, mock };
}

/** The economic terms that must be identical across the dispatch. `§42`. */
function economicTerms(snapshot: EconomicSnapshot): unknown {
  return {
    reservations: snapshot.reservations,
    balances: snapshot.balances,
    standing: snapshot.standing,
    authorisations: snapshot.authorisations,
    effects: snapshot.effects,
  };
}

describe('`§18` — A CONFIRMED ADAPTER RETURN', () => {
  it('reaches `DISPATCHED_AWAITING_VERIFICATION` and moves nothing economic', async () => {
    /*
     * `25 §5`: "EXECUTING --> VERIFYING: adapter returned", and its own note: "A 200 from
     * an API is not evidence that the world changed. Verification is an independent
     * read-back — and for money, it is the settlement reconciliation, not the API
     * response."
     *
     * So `§18`'s conditional — "required economic movement occurs exactly once IF
     * architecture says success makes it realised" — is answered in the negative, and the
     * snapshot below is what proves the negative rather than a comment asserting it.
     */
    const effect = await compensableOnAClock('ok-money');
    const before = await economicSnapshot(h.control);

    const { result, mock } = await dispatch(effect, ADAPTER_PROCESSOR, returnedOutcome('p1'));
    expect(result.kind).toBe('OUTCOME_RESOLVED');
    expect(mock.callCount).toBe(1);

    const row = (await rawOutcomeRows(h.control))[0]!;
    const oracle = expectedOutcomeFor('COMPENSABLE', 'ADAPTER_RETURNED');
    expect(row.outcomeKind).toBe('ADAPTER_RETURNED');
    expect(row.effectStatus).toBe(oracle.effectStatus);
    expect(row.economicMovement).toBe('NONE');
    expect(row.providerReference).toBe('p1');
    expect(row.rawResponseHash).toBe('a'.repeat(64));

    // `§42`. Every economic term identical, including all eleven `window_balance` ledger
    // columns and the three irrecoverable ones.
    const after = await economicSnapshot(h.control);
    expect(economicTerms(after)).toEqual(economicTerms(before));

    // `24 §3` K4's terminal `VERIFIED` is NOT reached, because S1J performs no read-back.
    expect(row.effectStatus).not.toBe('VERIFIED');
    // And the `effect` row is untouched: it is append-only, and the post-dispatch status
    // lives on the outcome row (`S1J-C3`).
    expect(after.effects.every((e) => e['status'] === 'AUTHORISED')).toBe(true);
  });

  it('a second processing of the same attempt is idempotent, not a second row', async () => {
    /*
     * `§18`: "second outcome processing is idempotent or refused exactly as specified", and
     * `26 §7` load-bearing property 8's shape — "a duplicate proposal returns the prior
     * result" — one stage later.
     *
     * The second gateway call cannot even reach the outcome stage: it refuses at the CLAIM,
     * because `25 §7` admits no second transition into `CLAIMED`. So the property holds
     * twice over, and the row count is what says so.
     */
    const effect = await reversible('ok-twice');
    const first = await dispatch(effect, ADAPTER_ADS, returnedOutcome());
    expect(first.result.kind).toBe('OUTCOME_RESOLVED');

    const second = await dispatch(effect, ADAPTER_ADS, returnedOutcome(), 'worker:again');
    expect(second.result.kind).toBe('CLAIM_REFUSED');
    if (second.result.kind === 'CLAIM_REFUSED') {
      expect(second.result.reason).toBe('ALREADY_CLAIMED');
    }
    // THE SECOND MOCK WAS NEVER INVOKED. `I36`, from the dispatch side.
    expect(second.mock.callCount).toBe(0);
    expect(await rawOutcomeRows(h.control)).toHaveLength(1);
    expect(await outcomeJournalRows(h.control)).toHaveLength(1);
  });
});

describe('`§15`, `§27` — REVERSIBLE / COMPENSABLE UNKNOWN: HOLD AND RESOLVE', () => {
  it('the money unknown holds the reservation and releases NO headroom', async () => {
    /*
     * `25 §10` row 1: "**Hold and resolve.** Reservation held; the reconciler queries or
     * re-POSTs under the original authorisation; never a blind retry."
     *
     * `35 §4`: "The exposure reservation **remains held**. It is not released on timeout,
     * because releasing it would let a retry plus a concurrent proposal collectively exceed
     * the window."
     *
     * `§15`'s required direct assertions, before vs after: reservation remains; reserved
     * headroom remains; no duplicate reservation; no realised settlement mutation; outbox
     * remains non-reclaimable.
     */
    const effect = await compensableOnAClock('unknown-money');
    const before = await economicSnapshot(h.control);
    expect(before.reservations).toHaveLength(1);

    const { result, mock } = await dispatch(
      effect,
      ADAPTER_PROCESSOR,
      unknownOutcome('TIMEOUT'),
    );
    expect(result.kind).toBe('OUTCOME_RESOLVED');
    expect(mock.callCount).toBe(1);
    expect(mock.acceptedCount).toBe(1);

    const row = (await rawOutcomeRows(h.control))[0]!;
    expect(row.outcomeKind).toBe('OUTCOME_UNKNOWN');
    // `35 §4`'s own literal for the effect row.
    expect(row.effectStatus).toBe('DISPATCHED_OUTCOME_UNKNOWN');
    expect(row.effectStatus).toBe(
      expectedOutcomeFor('COMPENSABLE', 'OUTCOME_UNKNOWN').effectStatus,
    );
    expect(row.economicMovement).toBe('NONE');
    // The adapter's `reason` is diagnostic and is deliberately NOT persisted as authority:
    // `§14` forbids inspecting an error string to decide an economic outcome, so there is
    // no column for it to be read back out of later.
    expect(row.providerReference).toBeNull();
    expect(row.rawResponseHash).toBeNull();

    const after = await economicSnapshot(h.control);
    // THE RESERVATION REMAINS, BYTE FOR BYTE, and there is exactly one of it.
    expect(after.reservations).toEqual(before.reservations);
    expect(after.reservations).toHaveLength(1);
    // EVERY WINDOW TERM IS UNCHANGED — reserved, standing, presumed and realised, in all
    // three ledgers. In particular `presumed_monetary` did NOT move: `I3`'s term 3 is bound
    // by the registry to the `PRESUMED_SETTLED` state, which is `I32`'s liquidity-override
    // path (`26 §10.3`) and not this one.
    expect(after.balances).toEqual(before.balances);
    expect(after.standing).toEqual(before.standing);
    expect(after.authorisations).toEqual(before.authorisations);
  });

  it('and the outbox stays non-reclaimable: no retry, no reclaim, no second invocation', async () => {
    /*
     * `25 §10` row 1: "never a blind retry." `25 §7` OBX-01: "It is never the subject of a
     * retry that re-claims."
     */
    const effect = await compensableOnAClock('unknown-noretry');
    const first = await dispatch(effect, ADAPTER_PROCESSOR, unknownOutcome());
    expect(first.result.kind).toBe('OUTCOME_RESOLVED');

    // `§26`: the normal claim API refuses. Directly, not only through the gateway.
    const reclaim = await claimForExternalDispatch(h.control, {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      claimedBy: 'worker:reclaim',
      now: new Date(NOW.getTime() + 7 * DAY),
    });
    expect(reclaim.kind).toBe('REFUSED');
    if (reclaim.kind === 'REFUSED') expect(reclaim.reason).toBe('ALREADY_CLAIMED');

    // And through the gateway, with a fresh adapter: never invoked.
    const second = await dispatch(effect, ADAPTER_PROCESSOR, unknownOutcome(), 'worker:retry');
    expect(second.result.kind).toBe('CLAIM_REFUSED');
    expect(second.mock.callCount).toBe(0);

    // `§25`'s no-duplicate property, from the row count.
    expect(await rawOutcomeRows(h.control)).toHaveLength(1);
    expect(await outcomeJournalRows(h.control)).toHaveLength(1);
  });

  it('a REVERSIBLE unknown takes the same branch — `25 §10` groups the two classes', async () => {
    const effect = await reversible('unknown-rev');
    const before = await economicSnapshot(h.control);
    const { result } = await dispatch(effect, ADAPTER_ADS, unknownOutcome('AMBIGUOUS'));
    expect(result.kind).toBe('OUTCOME_RESOLVED');

    const row = (await rawOutcomeRows(h.control))[0]!;
    expect(row.effectStatus).toBe(
      expectedOutcomeFor('REVERSIBLE', 'OUTCOME_UNKNOWN').effectStatus,
    );
    expect(economicTerms(await economicSnapshot(h.control))).toEqual(economicTerms(before));
  });
});

describe('`§16`, `§28` — IRRECOVERABLE UNKNOWN: PARTIAL, AND FAIL-CLOSED', () => {
  it('production REFUSES and writes nothing, naming `S1J-C1`', async () => {
    /*
     * `25 §10` row 2 requires `PRESUMED_EXECUTED` AND the irrecoverable-unit consumption as
     * ONE act — `24 §3` K4, `34` ADR-026 item 3 and `35 §12.3` all state the pair the same
     * way. The consumption's ledger mutation is declared nowhere, and no accepted slice
     * reserves a unit for it to consume, so the pair cannot be performed.
     *
     * `§2` and `§16`: RETURN PARTIAL rather than invent a counter.
     */
    const effect = await irrecoverable('unknown-irr');
    const before = await economicSnapshot(h.control);
    const mieBefore = await unsafeMieSnapshot(h.control, COMPANY_ID);

    const { result, mock } = await dispatch(effect, ADAPTER_COMMERCE, unknownOutcome());

    expect(result.kind).toBe('OUTCOME_REFUSED');
    if (result.kind !== 'OUTCOME_REFUSED') return;
    expect(result.reason).toBe('OUTCOME_POLICY_UNDECLARED');
    expect(result.undeclared).toBe('IRRECOVERABLE_UNKNOWN_MIE_TRANSITION_UNDECLARED');
    expect(result.detail).toContain('S1J-C1');

    // The mock WAS invoked and DID reach its acceptance point. The refusal is about the
    // local accounting, not about the dispatch: `30 §5.1b` makes an IRRECOVERABLE effect
    // dispatch-eligible in `NORMAL`, and it was dispatched.
    expect(mock.callCount).toBe(1);
    expect(mock.acceptedCount).toBe(1);

    // NOTHING WAS WRITTEN. No outcome row, no journal row, no ledger movement.
    expect(await rawOutcomeRows(h.control)).toHaveLength(0);
    expect(await outcomeJournalRows(h.control)).toHaveLength(0);
    expect(economicTerms(await economicSnapshot(h.control))).toEqual(economicTerms(before));
    expect(await unsafeMieSnapshot(h.control, COMPANY_ID)).toEqual(mieBefore);

    // AND `PRESUMED_EXECUTED` DOES NOT EXIST IN THIS SCHEMA. The row is unwritable even by
    // a direct INSERT, which is `0012`'s
    // `dispatch_outcome_irrecoverable_unknown_undeclared` CHECK.
    const outbox = (await outboxRows(h.control))[0]!;
    const client = await h.control.connect();
    try {
      await expect(
        client.query(
          `INSERT INTO effect_dispatch_outcome (
             company_id, idempotency_key, outbox_id, effect_id, authorisation_id, claim_id,
             adapter, recoverability, outcome_kind, effect_status,
             requires_unmirrored_tag, unmirrored_tag_sent, economic_movement,
             invoked_at, outcome_at, journal_seq)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'IRRECOVERABLE', 'OUTCOME_UNKNOWN',
                   'DISPATCHED_OUTCOME_UNKNOWN', FALSE, FALSE, 'NONE', $8, $8, 1)`,
          [
            COMPANY_ID,
            effect.idempotencyKey,
            outbox.outboxId,
            outbox.effectId,
            outbox.authorisationId,
            outbox.claimId,
            outbox.adapter,
            NOW,
          ],
        ),
      ).rejects.toThrow(/dispatch_outcome_irrecoverable_unknown_undeclared/);
    } finally {
      client.release();
    }
  });

  it('the SAFETY half still holds: never re-dispatched, by any path', async () => {
    /*
     * `25 §10` row 2's first sentence is "Never re-dispatch", and that half is closed by
     * the committed `CLAIMED` row rather than by the accounting. So the PARTIAL is scoped
     * to the ledger movement and does not weaken `I36`.
     */
    const effect = await irrecoverable('unknown-irr-safe');
    const first = await dispatch(effect, ADAPTER_COMMERCE, unknownOutcome());
    expect(first.result.kind).toBe('OUTCOME_REFUSED');
    expect(first.mock.callCount).toBe(1);

    expect((await outboxRows(h.control))[0]!.status).toBe('CLAIMED');
    const reclaim = await claimForExternalDispatch(h.control, {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      claimedBy: 'worker:reclaim',
      now: new Date(NOW.getTime() + 30 * DAY),
    });
    expect(reclaim.kind).toBe('REFUSED');
    if (reclaim.kind === 'REFUSED') expect(reclaim.reason).toBe('ALREADY_CLAIMED');

    const second = await dispatch(effect, ADAPTER_COMMERCE, unknownOutcome(), 'worker:2');
    expect(second.result.kind).toBe('CLAIM_REFUSED');
    expect(second.mock.callCount).toBe(0);
  });

  it('THE DISCRIMINATOR — `§40` item 10: the unsafe control invents the transition', async () => {
    /*
     * `§40` item 10: "IRRECOVERABLE unknown does not consume MIE / or consumes it twice, IF
     * MIE transition is normatively defined." It is not, so the control IS the invention.
     *
     * AND IT IS NOT EXACTLY-ONCE, WHICH IS THE SECOND HALF OF THE ITEM. Production's
     * exactly-once property comes from `effect_dispatch_outcome`'s primary key; a ledger
     * movement bolted on outside the outcome row inherits none of it, so calling the
     * control twice moves the counter twice.
     */
    const effect = await irrecoverable('unknown-irr-mie');
    const { result } = await dispatch(effect, ADAPTER_COMMERCE, unknownOutcome());
    expect(result.kind).toBe('OUTCOME_REFUSED');

    const before = await unsafeMieSnapshot(h.control, COMPANY_ID);
    // The reship reserved COUNT units against the MIE windows; the irrecoverable ledger is
    // untouched by any accepted slice, so `reserved_irrecoverable` is zero everywhere —
    // which is exactly why there is nothing to consume.
    for (const row of before) expect(row.reservedIrrecoverable).toBe('0');

    const moved = await unsafeConsumeIrrecoverableUnit(h.control, COMPANY_ID, [
      'W_DAY_MIE',
      'W_MONTH_MIE',
    ]);
    expect(moved).toBeGreaterThan(0);
    const once = await unsafeMieSnapshot(h.control, COMPANY_ID);
    expect(once).not.toEqual(before);

    // Twice.
    await unsafeConsumeIrrecoverableUnit(h.control, COMPANY_ID, ['W_DAY_MIE', 'W_MONTH_MIE']);
    const twice = await unsafeMieSnapshot(h.control, COMPANY_ID);
    expect(twice).not.toEqual(once);
    const mieWindows = twice.filter((r) => r.windowId.endsWith('_MIE'));
    for (const row of mieWindows) expect(row.presumedIrrecoverable).toBe('2');
  });
});

describe('`§19` — A KNOWN ADAPTER FAILURE HAS NO DECLARED LOCAL STATE', () => {
  it('production refuses `KNOWN_FAILURE_STATE_UNDECLARED` and writes nothing', async () => {
    /*
     * `24 §3` K4 declares the RESPONSE and no state; the response contradicts `25 §7`
     * OBX-01. `§19`: "If no immediate known-not-sent state exists, do not invent one.
     * Report the omission as architecture-driven." `S1J-C2`.
     */
    const effect = await reversible('failed');
    const before = await economicSnapshot(h.control);
    const mock = createMockAdapter({
      adapterId: ADAPTER_ADS,
      resolutionCapabilities: ['IDEMPOTENCY_HEADER'],
      outcome: failedOutcome('MOCK_VALIDATION_REJECTED'),
    });

    const result = await dispatchAuthorisedEffect(h.control, testRegistry(mock), {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      dispatchedBy: 'worker:failed',
      now: NOW,
    });
    expect(result.kind).toBe('OUTCOME_REFUSED');
    if (result.kind !== 'OUTCOME_REFUSED') return;
    expect(result.undeclared).toBe('KNOWN_FAILURE_STATE_UNDECLARED');

    expect(await rawOutcomeRows(h.control)).toHaveLength(0);
    expect(await outcomeJournalRows(h.control)).toHaveLength(0);
    expect(economicTerms(await economicSnapshot(h.control))).toEqual(economicTerms(before));

    // `NEVER_SENT` IS NOT REUSED. `25 §10` reserves it for delivery-event evidence after a
    // presumption; `35 §12.3` makes it "a new proposal requiring fresh authorisation".
    expect(JSON.stringify(result)).not.toContain('NEVER_SENT');
    // And the schema has no arm for it either, so a later code path cannot write one.
    const client = await h.control.connect();
    try {
      const row = (await outboxRows(h.control))[0]!;
      await expect(
        client.query(
          `INSERT INTO effect_dispatch_outcome (
             company_id, idempotency_key, outbox_id, effect_id, authorisation_id, claim_id,
             adapter, recoverability, outcome_kind, effect_status,
             requires_unmirrored_tag, unmirrored_tag_sent, economic_movement,
             invoked_at, outcome_at, journal_seq)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'REVERSIBLE', 'ADAPTER_FAILED',
                   'DISPATCHED_OUTCOME_UNKNOWN', FALSE, FALSE, 'NONE', $8, $8, 1)`,
          [
            COMPANY_ID,
            effect.idempotencyKey,
            row.outboxId,
            row.effectId,
            row.authorisationId,
            row.claimId,
            row.adapter,
            NOW,
          ],
        ),
      ).rejects.toThrow(/dispatch_outcome_kind_declared/);
    } finally {
      client.release();
    }
  });
});

describe('`§26` — EVERY OUTCOME BRANCH REMAINS NON-RECLAIMABLE', () => {
  const branches = [
    { tag: 'nc-success', outcome: returnedOutcome(), refusedOutcome: false },
    { tag: 'nc-unknown', outcome: unknownOutcome(), refusedOutcome: false },
    { tag: 'nc-failed', outcome: failedOutcome(), refusedOutcome: true },
  ] as const;

  for (const branch of branches) {
    it(`after ${branch.tag}: the normal claim API refuses ALREADY_CLAIMED`, async () => {
      const effect = await reversible(branch.tag);
      const mock = createMockAdapter({
        adapterId: ADAPTER_ADS,
        resolutionCapabilities: ['IDEMPOTENCY_HEADER'],
        outcome: branch.outcome,
      });
      const result = await dispatchAuthorisedEffect(h.control, testRegistry(mock), {
        companyId: COMPANY_ID,
        idempotencyKey: effect.idempotencyKey,
        dispatchedBy: 'worker:nc',
        now: NOW,
      });
      expect(result.kind).toBe(branch.refusedOutcome ? 'OUTCOME_REFUSED' : 'OUTCOME_RESOLVED');

      const reclaim = await claimForExternalDispatch(h.control, {
        companyId: COMPANY_ID,
        idempotencyKey: effect.idempotencyKey,
        claimedBy: 'worker:reclaim',
        now: new Date(NOW.getTime() + 365 * DAY),
      });
      expect(reclaim.kind).toBe('REFUSED');
      if (reclaim.kind === 'REFUSED') expect(reclaim.reason).toBe('ALREADY_CLAIMED');
      // The claim journal still holds exactly one claim for this effect.
      expect(await claimJournalRows(h.control)).toHaveLength(1);
    });
  }

  it('and no elapsed time of any length changes the answer', async () => {
    /*
     * `25 §7` OBX-01: "`CLAIMED` HAS NO TIMEOUT, NO LEASE, NO EXPIRY AND NO RECLAIM. There
     * is no `READY`-after-timeout, no visibility timeout, no stale-lease reaper, no attempt
     * counter that resets a claim, and no elapsed time of any length that returns a
     * `CLAIMED` row to `ENQUEUED`."
     */
    const effect = await reversible('nc-time');
    const { result } = await dispatch(effect, ADAPTER_ADS, unknownOutcome());
    expect(result.kind).toBe('OUTCOME_RESOLVED');
    for (const days of [1, 30, 365, 3650]) {
      const reclaim = await claimForExternalDispatch(h.control, {
        companyId: COMPANY_ID,
        idempotencyKey: effect.idempotencyKey,
        claimedBy: 'worker:patient',
        now: new Date(NOW.getTime() + days * DAY),
      });
      expect(reclaim.kind, `${days} days`).toBe('REFUSED');
    }
    expect((await outboxRows(h.control))[0]!.status).toBe('CLAIMED');
  });
});
