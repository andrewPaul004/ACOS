import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { COMPANY_ID } from '../support/fixture.js';
import {
  S1I_NOW,
  authorisePause,
  authoriseReship,
  createOutboxHarness,
  outboxRows,
  type AuthorisedEffect,
  type OutboxHarness,
} from '../support/outboxFixture.js';
import {
  ADAPTER_ADS,
  ADAPTER_COMMERCE,
  dispatchEnv,
  rawOutcomeRows,
} from '../support/gatewayFixture.js';
import { createMockAdapter, returnedOutcome } from '../support/mockAdapter.js';
import { enqueueDispatch } from '../../src/kernel/outbox/enqueue.js';
import { dispatchAuthorisedEffect } from '../../src/kernel/gateway/effectGateway.js';
import { adapterIsEligibleFor } from '../../src/kernel/gateway/adapterRegistry.js';
import { unsafeDispatchInsideClaimTransaction } from './unsafe-dispatch-ordering.js';
import {
  unsafeDispatchIgnoringCapabilities,
  unsafeDispatchWithChosenAdapter,
} from './unsafe-adapter-selection.js';

/**
 * `§13`, `§40` — THE DISCRIMINATING CONTROLS, RUN SIDE BY SIDE WITH PRODUCTION.
 *
 * =================================================================================
 * `§40`'s RULE, VERBATIM
 *
 *   "Every control included in the final count must actually discriminate. Do not count
 *    controls that production and vulnerable paths agree on."
 *
 * So each case below runs BOTH paths against the SAME database state and asserts that they
 * differ. The controls that live in other suites — because the state they need is built
 * there — are cross-referenced in `S1J-test-matrix.md §4` and are:
 *
 *   item 1  `fresh-claim.test.ts` — `unsafeDispatchClaimed` / `unsafeDispatchAllClaimed`
 *   item 4  `dispatch-envelope.test.ts` — `unsafeReconstructedEnvelope`
 *   item 5  `dispatch-envelope.test.ts` — `unsafeMapperDroppingCorrelationTag`
 *   item 6  `dispatch-envelope.test.ts` — `unsafeMapperDroppingUnmirroredTag`
 *   items 7, 8, 9  `tests/gateway/outcome-policy.test.ts` — the three unsafe policies
 *   item 10 `outcome-classes.test.ts` — `unsafeConsumeIrrecoverableUnit`
 *   item 11 `fresh-claim.test.ts` — `unsafeDispatchAllClaimed` after an accepted call
 *   item 12 `outcome-atomicity.test.ts` — the split commit and the unlocked read-then-write
 *
 * This file carries items 2, 3 and 13.
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

describe('`§40` item 2 — THE ADAPTER INVOKED BEFORE THE CLAIM COMMITS', () => {
  it('the unsafe path invokes BEFORE the commit; production cannot', async () => {
    /*
     * `§6`: "Never: adapter before claim commit; adapter inside the claim transaction."
     * `25 §7` (OBX-03): "The transaction commits and *then* transport runs."
     *
     * THE DISCRIMINATOR IS AN EVENT ORDER, NOT AN OUTCOME. Both paths can end with one
     * claim and one invocation on the happy path, so a test that only counted rows would
     * find them identical. What differs is the ORDER, and the two events come from
     * different sources: `CLAIM_COMMITTED` from the code under test, `MOCK_ADAPTER_INVOKED`
     * from inside the mock.
     */
    const unsafeEffect = await enqueuedPause('order-unsafe');
    const unsafeEvents: string[] = [];
    const unsafeMock = createMockAdapter({
      adapterId: ADAPTER_ADS,
      resolutionCapabilities: ['IDEMPOTENCY_HEADER'],
      outcome: returnedOutcome(),
      events: unsafeEvents,
    });
    const unsafe = await unsafeDispatchInsideClaimTransaction(
      h.control,
      {
        companyId: COMPANY_ID,
        idempotencyKey: unsafeEffect.idempotencyKey,
        claimedBy: 'worker:unsafe-order',
        now: NOW,
      },
      unsafeMock,
      unsafeEvents,
    );
    expect(unsafe.claimed).toBe(true);
    expect(unsafeMock.callCount).toBe(1);
    // THE INVOCATION PRECEDES THE COMMIT.
    expect(unsafeEvents.indexOf('MOCK_ADAPTER_INVOKED')).toBeLessThan(
      unsafeEvents.indexOf('CLAIM_COMMITTED'),
    );

    const productionEffect = await enqueuedPause('order-production');
    const productionEvents: string[] = [];
    const productionMock = createMockAdapter({
      adapterId: ADAPTER_ADS,
      resolutionCapabilities: ['IDEMPOTENCY_HEADER'],
      outcome: returnedOutcome(),
      events: productionEvents,
    });
    const production = await dispatchAuthorisedEffect(
      dispatchEnv(h,
      productionMock),
      {
        companyId: COMPANY_ID,
        idempotencyKey: productionEffect.idempotencyKey,
        dispatchedBy: 'worker:production-order',
        now: NOW,
      },
      { events: (e) => productionEvents.push(e) },
    );
    expect(production.kind).toBe('OUTCOME_RESOLVED');
    // THE COMMIT PRECEDES THE INVOCATION.
    expect(productionEvents.indexOf('CLAIM_COMMITTED')).toBeLessThan(
      productionEvents.indexOf('MOCK_ADAPTER_INVOKED'),
    );
  });

  it('and the unsafe ordering makes a rolled-back claim RE-CLAIMABLE after a sent request', async () => {
    /*
     * WHY THE ORDER MATTERS, DEMONSTRATED. `23 §6` B8: "A perfect two-phase commit between
     * a Postgres transaction and a third-party HTTP API does not exist."
     *
     * The unsafe path invokes inside the transaction and then the transaction fails. The
     * request has been made — `acceptedCount` is 1 — and the row is back to `ENQUEUED`, so
     * a SECOND claim succeeds and a SECOND invocation happens. That is the duplicate
     * `I36` exists to prevent, produced by a design whose rollback looked like safety.
     */
    const effect = await enqueuedPause('order-rollback');
    const mock = createMockAdapter({
      adapterId: ADAPTER_ADS,
      resolutionCapabilities: ['IDEMPOTENCY_HEADER'],
      outcome: returnedOutcome(),
      // The mock is invoked, accepts, and then the caller's transaction dies.
      afterAccepted: () => Promise.reject(new Error('the transaction dies after acceptance')),
    });
    await expect(
      unsafeDispatchInsideClaimTransaction(
        h.control,
        {
          companyId: COMPANY_ID,
          idempotencyKey: effect.idempotencyKey,
          claimedBy: 'worker:unsafe-rollback',
          now: NOW,
        },
        mock,
        [],
      ),
    ).rejects.toThrow('the transaction dies after acceptance');

    // THE REQUEST WAS ACCEPTED and the claim is GONE.
    expect(mock.acceptedCount).toBe(1);
    expect((await outboxRows(h.control))[0]!.status).toBe('ENQUEUED');

    // So production — correct production, on the row the unsafe path left behind — claims
    // it as a FIRST claim and dispatches. TWO ACCEPTED REQUESTS FOR ONE INTENDED EFFECT.
    const second = createMockAdapter({
      adapterId: ADAPTER_ADS,
      resolutionCapabilities: ['IDEMPOTENCY_HEADER'],
      outcome: returnedOutcome(),
    });
    const result = await dispatchAuthorisedEffect(dispatchEnv(h, second), {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      dispatchedBy: 'worker:after-rollback',
      now: NOW,
    });
    expect(result.kind).toBe('OUTCOME_RESOLVED');
    expect(mock.acceptedCount + second.acceptedCount).toBe(2);

    /*
     * AND PRODUCTION ALONE NEVER PRODUCES THIS STATE, because its claim commits in its own
     * transaction before anything is invoked: the row is `CLAIMED` before the mock is
     * reachable, and no failure downstream returns it to `ENQUEUED`.
     * `mock-kill-matrix.test.ts` POINT 3 is the same crash under the correct ordering —
     * one accepted call, one `CLAIMED` row, and no second invocation ever.
     */
  });
});

describe('`§40` item 3 — THE CALLER CHOOSES THE ADAPTER', () => {
  it('the unsafe path invokes whatever it is handed; production has no such parameter', async () => {
    /*
     * `§8`'s attack: "authorised effect says adapter A; attacker/caller requests mock
     * adapter B with different semantics."
     *
     * `campaign.pause`'s catalogue adapter is `mock_ads`. The attacker's adapter declares
     * `mock_commerce`, has no capabilities and a different provider reference.
     */
    const effect = await enqueuedPause('chosen');
    const attacker = createMockAdapter({
      adapterId: ADAPTER_COMMERCE,
      resolutionCapabilities: [],
      outcome: returnedOutcome('mock:attacker-chose-me'),
    });

    // UNSAFE: the adapter is a parameter, so the attacker's adapter executes.
    const unsafe = await unsafeDispatchWithChosenAdapter(
      h.control,
      { companyId: COMPANY_ID, idempotencyKey: effect.idempotencyKey },
      attacker,
    );
    expect(unsafe?.kind).toBe('ADAPTER_RETURNED');
    expect(attacker.callCount).toBe(1);
    // And it received the real payload and the real tag, which is what makes it dangerous
    // rather than merely broken: everything except the executor is correct.
    expect(attacker.observed[0]!.payloadHex).toBe(
      effect.payloadCanonicalBytes.toString('hex'),
    );

    // PRODUCTION: the same attacker adapter, installed in the registry under its own
    // identity, is never consulted — the gateway asks for `mock_ads`.
    attacker.reset();
    const production = await dispatchAuthorisedEffect(dispatchEnv(h, attacker), {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      dispatchedBy: 'worker:chosen',
      now: NOW,
    });
    expect(production.kind).toBe('ADAPTER_REFUSED');
    if (production.kind === 'ADAPTER_REFUSED') {
      expect(production.reason).toBe('ADAPTER_NOT_REGISTERED');
    }
    expect(attacker.callCount).toBe(0);
    expect(await rawOutcomeRows(h.control)).toHaveLength(0);
  });
});

describe('`§13`, `§40` item 13 — EM6 ADAPTER ELIGIBILITY FOR IRRECOVERABLE CLASSES', () => {
  it('the predicate is `25 §7`s own disjunction: one primitive suffices, none disqualifies', () => {
    /*
     * `25 §7`, verbatim: "A provider offering **neither an idempotency header nor a
     * delivery-event webhook nor a queryable message log** cannot serve an IRRECOVERABLE
     * class."
     *
     * Read as the sentence's own shape: "neither X nor Y nor Z" is false as soon as one
     * holds, so ONE capability suffices. The three members and the empty case are all
     * exercised, and the REVERSIBLE/COMPENSABLE columns are asserted permissive because
     * v1.3.4 states the requirement for the IRRECOVERABLE class only.
     */
    const withNone = createMockAdapter({
      adapterId: ADAPTER_COMMERCE,
      resolutionCapabilities: [],
      outcome: returnedOutcome(),
    });
    expect(adapterIsEligibleFor(withNone, 'IRRECOVERABLE')).toBe(false);
    expect(adapterIsEligibleFor(withNone, 'COMPENSABLE')).toBe(true);
    expect(adapterIsEligibleFor(withNone, 'REVERSIBLE')).toBe(true);

    for (const capability of [
      'IDEMPOTENCY_HEADER',
      'DELIVERY_EVENT_WEBHOOK',
      'QUERYABLE_MESSAGE_LOG',
    ] as const) {
      const withOne = createMockAdapter({
        adapterId: ADAPTER_COMMERCE,
        resolutionCapabilities: [capability],
        outcome: returnedOutcome(),
      });
      expect(adapterIsEligibleFor(withOne, 'IRRECOVERABLE'), capability).toBe(true);
    }
  });

  it('production REFUSES BEFORE INVOCATION; the unsafe path dispatches anyway', async () => {
    /*
     * `§13`'s required negative control, verbatim: "IRRECOVERABLE effect + mock adapter
     * advertises NONE of the required resolution capabilities. Unsafe gateway dispatches.
     * Production refuses before invocation."
     *
     * WHAT THE UNSAFE PATH COSTS. `25 §10`'s IRRECOVERABLE branch resolves
     * `PRESUMED_EXECUTED` "from the provider's delivery event matched on the correlation
     * tag". An adapter with no delivery event, no queryable log and no idempotency header
     * leaves that presumption permanently unresolvable — so the effect can never reach
     * `VERIFIED` or `NEVER_SENT`, `I9` fires and cannot be satisfied, and `I20` has nothing
     * to reconcile against. It is DUP-01's hole reopened.
     */
    const effect = await authoriseReship(h, { resourceId: 'ORD-INELIGIBLE' });
    await enqueueDispatch(h.control, {
      companyId: COMPANY_ID,
      effectId: effect.effectId,
      outboxId: 'outbox:ineligible',
      payloadCanonicalBytes: effect.payloadCanonicalBytes,
      now: NOW,
    });
    const barren = createMockAdapter({
      adapterId: ADAPTER_COMMERCE,
      resolutionCapabilities: [],
      outcome: returnedOutcome('mock:no-way-to-resolve-me'),
    });

    // PRODUCTION: refused, and the adapter is never invoked.
    const production = await dispatchAuthorisedEffect(dispatchEnv(h, barren), {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      dispatchedBy: 'worker:ineligible',
      now: NOW,
    });
    expect(production.kind).toBe('ADAPTER_REFUSED');
    if (production.kind === 'ADAPTER_REFUSED') {
      expect(production.reason).toBe('ADAPTER_INELIGIBLE_FOR_IRRECOVERABLE');
      expect(production.detail).toContain('25 §7');
    }
    expect(barren.callCount).toBe(0);
    expect(await rawOutcomeRows(h.control)).toHaveLength(0);
    // THE CLAIM STILL COMMITTED, and stays non-reclaimable. `I36` does not bend for a
    // refusal downstream of it, and that is the honest cost of checking eligibility after
    // the claim: the effect is stuck rather than duplicated. `25 §7` puts the claim first
    // deliberately.
    expect((await outboxRows(h.control))[0]!.status).toBe('CLAIMED');

    // UNSAFE: the same adapter, resolved correctly FROM THE CATALOGUE — so `§40` item 3's
    // defect is absent — and dispatched with the capability check simply never made.
    const unsafe = await unsafeDispatchIgnoringCapabilities(
      h.control,
      { companyId: COMPANY_ID, idempotencyKey: effect.idempotencyKey },
      [barren],
    );
    expect(unsafe?.kind).toBe('ADAPTER_RETURNED');
    expect(barren.callCount).toBe(1);
  });

  it('and an ELIGIBLE adapter for the same effect dispatches, so the refusal is about EM6', async () => {
    /*
     * The control's other half. Without this, the refusal above could be explained by
     * anything about the IRRECOVERABLE class rather than by the capability predicate.
     */
    const effect = await authoriseReship(h, { resourceId: 'ORD-ELIGIBLE' });
    await enqueueDispatch(h.control, {
      companyId: COMPANY_ID,
      effectId: effect.effectId,
      outboxId: 'outbox:eligible',
      payloadCanonicalBytes: effect.payloadCanonicalBytes,
      now: NOW,
    });
    const capable = createMockAdapter({
      adapterId: ADAPTER_COMMERCE,
      // ONE primitive, and it is the one `25 §10`'s IRRECOVERABLE branch resolves from.
      resolutionCapabilities: ['DELIVERY_EVENT_WEBHOOK'],
      outcome: returnedOutcome('mock:resolvable'),
    });
    const result = await dispatchAuthorisedEffect(dispatchEnv(h, capable), {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      dispatchedBy: 'worker:eligible',
      now: NOW,
    });
    expect(result.kind).toBe('OUTCOME_RESOLVED');
    expect(capable.callCount).toBe(1);
    expect((await rawOutcomeRows(h.control))[0]!.recoverability).toBe('IRRECOVERABLE');
  });

  it('THE ADVERTISEMENT IS A FIXTURE, NOT EVIDENCE ABOUT ANY PROVIDER', () => {
    /*
     * `§13`: "Do NOT claim a real provider has that capability. The MOCK may advertise
     * architecture-defined capabilities for testing."
     *
     * `36 §7` is the standard the advertisement does not meet: "measure the `@idempotent`
     * directive's key scope and deduplication window **empirically** rather than trusting
     * the annotation — it has only been present since API version 2026-04, and **if the
     * window is shorter than the reconciler's resolution latency it does not cover the case
     * it is relied on for.** Until this test runs, `33 §6` and `35 §3` state the property
     * as unverified."
     *
     * So the capability set is a declared array on a test object. There is no measurement,
     * no sandbox and no provider, and `36 §7`'s contract tests stay OPEN.
     */
    const mock = createMockAdapter({
      adapterId: ADAPTER_COMMERCE,
      resolutionCapabilities: ['IDEMPOTENCY_HEADER'],
      outcome: returnedOutcome(),
    });
    // It is a frozen literal supplied by the test, and nothing measured it.
    expect(mock.resolutionCapabilities).toEqual(['IDEMPOTENCY_HEADER']);
    expect(Object.isFrozen(mock.resolutionCapabilities)).toBe(true);
  });
});
