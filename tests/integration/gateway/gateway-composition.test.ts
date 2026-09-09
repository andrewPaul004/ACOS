import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { COMPANY_ID } from '../../support/fixture.js';
import {
  REFUND_TASK_ID,
  S1I_NOW,
  authorisePause,
  authoriseRefund,
  authoriseReship,
  bindTaskToCase,
  createOutboxHarness,
  openLiveClock,
  outboxRows,
  type AuthorisedEffect,
  type OutboxHarness,
} from '../../support/outboxFixture.js';
import {
  ADAPTER_ADS,
  ADAPTER_COMMERCE,
  ADAPTER_PROCESSOR,
  outcomeJournalRows,
  persistedCorrelationTag,
  persistedPayloadHex,
  rawOutcomeRows,
  testRegistry,
} from '../../support/gatewayFixture.js';
import { createMockAdapter, returnedOutcome } from '../../support/mockAdapter.js';
import { enqueueDispatch } from '../../../src/kernel/outbox/enqueue.js';
import { dispatchAuthorisedEffect } from '../../../src/kernel/gateway/effectGateway.js';
import { createAdapterRegistry } from '../../../src/kernel/gateway/adapterRegistry.js';
import { expectedOutcomeFor } from '../../support/s1jOutcomeTable.js';

/**
 * `§4`, `§6`, `§8`, `§10`, `§11`, `§12` — THE EFFECT GATEWAY'S DISPATCH COMPOSITION.
 *
 * =================================================================================
 * `§4`'s GOAL, END TO END, AGAINST REAL POSTGRESQL AND A DETERMINISTIC IN-PROCESS MOCK
 *
 *     ENQUEUED → claim COMMIT → fresh dispatch capability → Effect Gateway → mock adapter
 *     → outcome classification → local outcome transaction → resulting state
 *
 * Every class the S1 catalogue declares is exercised: REVERSIBLE at `30 §5.1` row 5,
 * COMPENSABLE at row 3 under a live statutory clock, IRRECOVERABLE at row 1 in `NORMAL`
 * (v1.3.4, IRN-01).
 *
 * WHAT NONE OF IT PROVES. The adapter is a mock with no network, no credential and no
 * provider. `§29`: "A mock proves the ACOS-side state machine. Nothing more."
 * =================================================================================
 */

let h: OutboxHarness;
const NOW = S1I_NOW;
const DAY = 24 * 60 * 60 * 1000;
const CASE = 'case:CS-S1J';

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

/** A COMPENSABLE refund made row-3 eligible by a live statutory clock on its own case. */
async function enqueuedRefundOnAClock(tag: string): Promise<AuthorisedEffect> {
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

describe('`§4` — THE WHOLE COMPOSITION, PER RECOVERABILITY CLASS', () => {
  it('REVERSIBLE (`campaign.pause`, row 5): claim → mock → committed outcome', async () => {
    const effect = await authorisePause(h, { resourceId: 'CMP-S1J-REV' });
    await enqueue(effect, 'rev');
    const events: string[] = [];
    const mock = createMockAdapter({
      adapterId: ADAPTER_ADS,
      resolutionCapabilities: ['IDEMPOTENCY_HEADER'],
      outcome: returnedOutcome('mock:ads-1'),
      events,
    });

    const result = await dispatchAuthorisedEffect(
      h.control,
      testRegistry(mock),
      {
        companyId: COMPANY_ID,
        idempotencyKey: effect.idempotencyKey,
        dispatchedBy: 'worker:s1j',
        now: NOW,
      },
      { events: (e) => events.push(e) },
    );

    expect(result.kind).toBe('OUTCOME_RESOLVED');
    if (result.kind !== 'OUTCOME_RESOLVED') return;

    // The mock was invoked exactly once and reached its acceptance point exactly once.
    expect(mock.callCount).toBe(1);
    expect(mock.acceptedCount).toBe(1);

    // The committed row, read with raw SQL — never through the production reader.
    const rows = await rawOutcomeRows(h.control);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    const oracle = expectedOutcomeFor('REVERSIBLE', 'ADAPTER_RETURNED');
    expect(row.outcomeKind).toBe('ADAPTER_RETURNED');
    expect(row.effectStatus).toBe(oracle.effectStatus);
    expect(row.economicMovement).toBe('NONE');
    expect(row.recoverability).toBe('REVERSIBLE');
    expect(row.adapter).toBe(ADAPTER_ADS);
    expect(row.providerReference).toBe('mock:ads-1');

    // The outbox row is untouched: still `CLAIMED`, under the same claim.
    const outbox = (await outboxRows(h.control))[0]!;
    expect(outbox.status).toBe('CLAIMED');
    expect(row.claimId).toBe(outbox.claimId);
  });

  it('COMPENSABLE (`refund.create`, row 3 under a live clock): the money path', async () => {
    const effect = await enqueuedRefundOnAClock('comp');
    const mock = createMockAdapter({
      adapterId: ADAPTER_PROCESSOR,
      resolutionCapabilities: ['IDEMPOTENCY_HEADER', 'QUERYABLE_MESSAGE_LOG'],
      outcome: returnedOutcome('mock:processor-1'),
    });

    const result = await dispatchAuthorisedEffect(h.control, testRegistry(mock), {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      dispatchedBy: 'worker:s1j',
      now: NOW,
    });
    expect(result.kind).toBe('OUTCOME_RESOLVED');
    expect(mock.callCount).toBe(1);

    const row = (await rawOutcomeRows(h.control))[0]!;
    expect(row.recoverability).toBe('COMPENSABLE');
    expect(row.effectStatus).toBe(
      expectedOutcomeFor('COMPENSABLE', 'ADAPTER_RETURNED').effectStatus,
    );
    // The claim was decided at row 3, which is the only route a discretionary COMPENSABLE
    // effect has: `30 §5.1` row 4 SUSPENDS it and row 2 halts it above the floor.
    const outbox = (await outboxRows(h.control))[0]!;
    expect(outbox.claimMatchedRow).toBe(3);
    expect(outbox.claimClockRef).toBe(`clock:comp`);
  });

  it('IRRECOVERABLE (`fulfilment.reship`, row 1 in NORMAL): v1.3.4 IRN-01', async () => {
    /*
     * `30 §5.1b` (v1.3.4, IRN-01) is what makes this reachable at all: "an otherwise-valid
     * IRRECOVERABLE effect is `DISPATCH_ELIGIBLE` in `NORMAL` and still halts in
     * `UNCORROBORATED_STALL`, in `CORROBORATED_DEGRADED`, under the `§5.1a` posture and
     * against any override."
     *
     * `30 §5.1`'s own note is why the SUCCESS branch is the one exercised here: "Nothing
     * about a claim in `NORMAL` asserts execution [...] not an MIE execution consumption."
     * The UNKNOWN branch is `outcome-irrecoverable-partial.test.ts`, and it is PARTIAL.
     */
    const effect = await authoriseReship(h, { resourceId: 'ORD-S1J-IRR' });
    await enqueue(effect, 'irr');
    const mock = createMockAdapter({
      adapterId: ADAPTER_COMMERCE,
      // `25 §7`'s EM6 criterion is satisfied by ONE primitive, and this mock advertises the
      // delivery-event webhook `25 §10`'s IRRECOVERABLE branch resolves from.
      resolutionCapabilities: ['DELIVERY_EVENT_WEBHOOK'],
      outcome: returnedOutcome('mock:commerce-1'),
    });

    const result = await dispatchAuthorisedEffect(h.control, testRegistry(mock), {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      dispatchedBy: 'worker:s1j',
      now: NOW,
    });
    expect(result.kind).toBe('OUTCOME_RESOLVED');
    expect(mock.callCount).toBe(1);

    const row = (await rawOutcomeRows(h.control))[0]!;
    expect(row.recoverability).toBe('IRRECOVERABLE');
    expect(row.effectStatus).toBe(
      expectedOutcomeFor('IRRECOVERABLE', 'ADAPTER_RETURNED').effectStatus,
    );
    expect((await outboxRows(h.control))[0]!.claimMatchedRow).toBe(1);
  });
});

describe('`§6` — CLAIM COMMIT ALWAYS PRECEDES THE MOCK INVOCATION', () => {
  it('the event order is CLAIM_COMMITTED then MOCK_ADAPTER_INVOKED, per class', async () => {
    /*
     * `§6`: "Add direct event-order instrumentation in tests. Expected: `CLAIM_COMMITTED`
     * always precedes `MOCK_ADAPTER_INVOKED`."
     *
     * The two events come from DIFFERENT SOURCES on purpose: the gateway emits the first
     * through its observer, and the MOCK pushes the second from inside its own `dispatch`.
     * A test that took both from the gateway would be asserting the gateway's own account
     * of its ordering.
     */
    const cases: { readonly tag: string; readonly run: () => Promise<string[]> }[] = [
      {
        tag: 'REVERSIBLE',
        run: async () => {
          const effect = await authorisePause(h, { resourceId: 'CMP-ORDER' });
          await enqueue(effect, 'order-rev');
          const events: string[] = [];
          const mock = createMockAdapter({
            adapterId: ADAPTER_ADS,
            resolutionCapabilities: ['IDEMPOTENCY_HEADER'],
            outcome: returnedOutcome(),
            events,
          });
          await dispatchAuthorisedEffect(
            h.control,
            testRegistry(mock),
            {
              companyId: COMPANY_ID,
              idempotencyKey: effect.idempotencyKey,
              dispatchedBy: 'worker:order',
              now: NOW,
            },
            { events: (e) => events.push(e) },
          );
          return events;
        },
      },
    ];

    for (const { tag, run } of cases) {
      const events = await run();
      const claimAt = events.indexOf('CLAIM_COMMITTED');
      const invokeAt = events.indexOf('MOCK_ADAPTER_INVOKED');
      const acceptedAt = events.indexOf('MOCK_ADAPTER_ACCEPTED');
      const outcomeAt = events.indexOf('OUTCOME_COMMITTED');
      expect(claimAt, tag).toBeGreaterThanOrEqual(0);
      expect(invokeAt, tag).toBeGreaterThan(claimAt);
      expect(acceptedAt, tag).toBeGreaterThan(invokeAt);
      expect(outcomeAt, tag).toBeGreaterThan(acceptedAt);
    }
  });

  it('the claim journal row precedes the outcome journal row in the SEQUENCE too', async () => {
    /*
     * `30 §5.2`'s gap-free company-scoped sequence. The two rows are separate journal
     * facts, in order, on one chain — which is what lets an audit reader join a
     * `DISPATCH_OUTCOME` to the `OUTBOX_CLAIMED` that authorised the attempt and see which
     * came first.
     */
    const effect = await authorisePause(h, { resourceId: 'CMP-SEQ' });
    await enqueue(effect, 'seq');
    const mock = createMockAdapter({
      adapterId: ADAPTER_ADS,
      resolutionCapabilities: ['IDEMPOTENCY_HEADER'],
      outcome: returnedOutcome(),
    });
    const result = await dispatchAuthorisedEffect(h.control, testRegistry(mock), {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      dispatchedBy: 'worker:seq',
      now: NOW,
    });
    expect(result.kind).toBe('OUTCOME_RESOLVED');
    if (result.kind !== 'OUTCOME_RESOLVED') return;

    const outcomeRows = await outcomeJournalRows(h.control);
    expect(outcomeRows).toHaveLength(1);
    expect(outcomeRows[0]!.journalSeq).toBeGreaterThan(result.claimJournalSeq);
  });
});

describe('`§8` — THE ADAPTER COMES FROM TRUSTED CLOSED RESOLUTION', () => {
  it('the attack: the effect says adapter A, the caller installs adapter B', async () => {
    /*
     * `§8`'s required attack, run for real. `campaign.pause`'s catalogue adapter is
     * `mock_ads`; the caller installs a mock under `mock_commerce` with different
     * semantics and no capabilities.
     *
     * PRODUCTION OFFERS NO SUCH ARGUMENT, so the "attack" is a registry that simply does
     * not contain the adapter the committed effect names. The gateway refuses
     * `ADAPTER_NOT_REGISTERED` and the substituted adapter is NEVER INVOKED — which is
     * stronger than refusing the substitution, because the substituted adapter was never a
     * candidate.
     */
    const effect = await authorisePause(h, { resourceId: 'CMP-SUBST' });
    await enqueue(effect, 'subst');
    const attackerAdapter = createMockAdapter({
      adapterId: ADAPTER_COMMERCE,
      resolutionCapabilities: [],
      outcome: returnedOutcome('mock:attacker'),
    });

    const result = await dispatchAuthorisedEffect(h.control, testRegistry(attackerAdapter), {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      dispatchedBy: 'worker:subst',
      now: NOW,
    });

    expect(result.kind).toBe('ADAPTER_REFUSED');
    if (result.kind === 'ADAPTER_REFUSED') {
      expect(result.reason).toBe('ADAPTER_NOT_REGISTERED');
    }
    expect(attackerAdapter.callCount).toBe(0);
    // AND THE CLAIM STILL COMMITTED. `I36`: it is never re-dispatched by any path, so a
    // refused resolution does not return the row to `ENQUEUED`.
    expect((await outboxRows(h.control))[0]!.status).toBe('CLAIMED');
    expect(await rawOutcomeRows(h.control)).toHaveLength(0);
  });

  it('a registry cannot be built for an identity the closed catalogue does not name', () => {
    /*
     * `SR7` / ADR-006: the catalogue is "the single extension point". A registry entry for
     * an unknown identity is refused at CONSTRUCTION, so a process cannot start holding a
     * dispatch surface for something no action class declares.
     */
    const rogue = createMockAdapter({
      adapterId: 'vendor_of_the_callers_choosing',
      resolutionCapabilities: ['IDEMPOTENCY_HEADER'],
      outcome: returnedOutcome(),
    });
    expect(() => createAdapterRegistry([rogue])).toThrow(
      /not an adapter identity the closed action catalogue names/,
    );
  });

  it('and two adapters cannot share one identity — the resolution stays deterministic', () => {
    const a = createMockAdapter({
      adapterId: ADAPTER_ADS,
      resolutionCapabilities: [],
      outcome: returnedOutcome('a'),
    });
    const b = createMockAdapter({
      adapterId: ADAPTER_ADS,
      resolutionCapabilities: [],
      outcome: returnedOutcome('b'),
    });
    expect(() => createAdapterRegistry([a, b])).toThrow(/two adapters registered under/);
  });
});

describe('`§10`, `§11`, `§12` — WHAT ACTUALLY CROSSED THE PORT', () => {
  it('the mock received the PERSISTED payload bytes, the PERSISTED tag and the requirement', async () => {
    const effect = await enqueuedRefundOnAClock('port');
    const mock = createMockAdapter({
      adapterId: ADAPTER_PROCESSOR,
      resolutionCapabilities: ['IDEMPOTENCY_HEADER'],
      outcome: returnedOutcome(),
    });
    await dispatchAuthorisedEffect(h.control, testRegistry(mock), {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      dispatchedBy: 'worker:port',
      now: NOW,
    });

    expect(mock.observed).toHaveLength(1);
    const observed = mock.observed[0]!;

    // `§10`. BOTH SIDES OF THIS COMPARISON COME FROM OUTSIDE THE PRODUCTION ENVELOPE
    // BUILDER: the left from the mock's own record of what it was handed, the right from
    // raw SQL against `dispatch_outbox`.
    expect(observed.payloadHex).toBe(
      await persistedPayloadHex(h.control, effect.idempotencyKey),
    );
    // And it equals the bytes the ACCEPTED S1F authorisation produced, so nothing along the
    // path re-canonicalised anything.
    expect(observed.payloadHex).toBe(effect.payloadCanonicalBytes.toString('hex'));
    expect(observed.dispatchPayloadHash).toBe(effect.dispatchPayloadHash);

    // `§11`. The tag the adapter observed is the tag the row has held since enqueue.
    expect(observed.correlationTag).toBe(
      await persistedCorrelationTag(h.control, effect.idempotencyKey),
    );

    // `§12`. In `NORMAL` no tag is required, and the envelope says so rather than omitting
    // the field — `30 §5.7.2` item 5's requirement is carried in both directions.
    expect(observed.requiresUnmirroredTag).toBe(false);
    expect(observed.overrideId).toBeNull();

    // The authoritative identity, unchanged across the port.
    expect(observed.recoverability).toBe('COMPENSABLE');
    expect(observed.adapter).toBe(ADAPTER_PROCESSOR);
    expect(observed.method).toBe('refundCreate');
    expect(observed.idempotencyKey).toBe(effect.idempotencyKey);
  });
});
