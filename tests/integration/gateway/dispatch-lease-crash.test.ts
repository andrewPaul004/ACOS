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
  testRegistry,
} from '../../support/gatewayFixture.js';
import { createMockAdapter, unknownOutcome } from '../../support/mockAdapter.js';
import { mieRows, type MieSnapshotRow } from '../../negative-controls/unsafe-mie-movements.js';
import { unsafeDispatchOnPersistedClaim } from '../../negative-controls/unsafe-dispatch-epoch.js';
import { enqueueDispatch } from '../../../src/kernel/outbox/enqueue.js';
import { dispatchAuthorisedEffect } from '../../../src/kernel/gateway/effectGateway.js';
import {
  DispatchLeaseManager,
  entityKeyForResourceRef,
} from '../../../src/kernel/gateway/dispatchLease.js';
import { claimForExternalDispatch } from '../../../src/kernel/outbox/claim.js';
import { liveCapabilityCount } from '../../../src/kernel/gateway/dispatchCapability.js';

/**
 * `§31`, `§32` — A CRASH INSIDE EPOCH B IS NOT A RECOVERY PATH.
 *
 * =================================================================================
 * `25 §14.1`'s CRASH CLAUSE, VERBATIM
 *
 *   "If the process is lost after the `CLAIM` COMMIT, the PostgreSQL session disappears and
 *    **the dispatch lease is released automatically by the database** — but the row remains
 *    `CLAIMED`, the fresh claim capability is gone, and **no restart may acquire a dispatch
 *    lease for the purpose of redispatching that row.** The same holds for a loss after the
 *    adapter was invoked and before the outcome committed. **Reacquiring the dispatch lease
 *    is not a recovery mechanism**, and OBX-01's no-reclaim rule is unaffected by the lease's
 *    lifetime. **`I9`'s detection of an orphan `CLAIMED` row is unchanged, and no elapsed
 *    time converts it to anything.**"
 *
 * =================================================================================
 * THE MISREADING THIS SUITE EXISTS TO CLOSE — `§32`
 *
 * SER-01 introduces a lease, and a lease is a permission-shaped object. Someone who has just
 * implemented Epoch B might reason: the lock serialises the entity, the previous holder
 * crashed, the database released it, so acquiring it again restores the right to proceed.
 *
 * IT DOES NOT, AND THE TWO MECHANISMS ARE DELIBERATELY DIFFERENT IN KIND:
 *
 *   the DISPATCH LEASE       serialises ENTITY STATE. It is reacquirable by anyone, always.
 *   the FRESH CLAIM          proves THIS PROCESS owns the live successful claim continuation.
 *   CAPABILITY               It is minted at exactly one line in `src/`, downstream of a
 *                            claim that committed in this execution, and it does not survive
 *                            the call — let alone the process.
 *
 * `§32`: "Persisted CLAIMED alone is insufficient. Required regression: old CLAIMED + newly
 * acquired entity lease still cannot dispatch. **This is important.**"
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

async function enqueuedReship(suffix: string): Promise<{
  readonly idempotencyKey: string;
  readonly resourceRef: string;
}> {
  const resourceId = `ORD-CRASH-${suffix}`;
  const effect = await authoriseReship(h, { resourceId });
  await enqueueDispatch(h.control, {
    companyId: COMPANY_ID,
    effectId: effect.effectId,
    outboxId: `outbox:${effect.idempotencyKey}`,
    payloadCanonicalBytes: effect.payloadCanonicalBytes,
    now: NOW,
  });
  return { idempotencyKey: effect.idempotencyKey, resourceRef: `order:${resourceId}` };
}

function commerceMock(afterAccepted?: () => Promise<void>) {
  return createMockAdapter({
    adapterId: ADAPTER_COMMERCE,
    resolutionCapabilities: ['IDEMPOTENCY_HEADER', 'DELIVERY_EVENT_WEBHOOK'],
    outcome: unknownOutcome(),
    ...(afterAccepted === undefined ? {} : { afterAccepted }),
  });
}

async function mie(): Promise<
  readonly MieSnapshotRow[]
> {
  return (await mieRows(h.control, COMPANY_ID)).filter((r) =>
    RESHIP_WINDOWS.includes(r.windowId),
  );
}

const CRASH = new Error('S1J simulated process loss');

describe('`§31` — A CRASH AFTER THE CLAIM COMMIT, BEFORE THE ADAPTER', () => {
  it('the row stays CLAIMED, the capability is gone, and nothing is dispatched', async () => {
    const effect = await enqueuedReship('after-claim');
    const mock = commerceMock();

    await expect(
      dispatchAuthorisedEffect(
        dispatchEnv(h, mock),
        {
          companyId: COMPANY_ID,
          idempotencyKey: effect.idempotencyKey,
          dispatchedBy: 'worker:crash-1',
          now: NOW,
        },
        { hooks: { afterClaimCommit: () => Promise.reject(CRASH) } },
      ),
    ).rejects.toThrow('S1J simulated process loss');

    // THE PERSISTED ROW REMAINS `CLAIMED` — `25 §14.1`, and OBX-01's no-reclaim rule.
    expect((await outboxRows(h.control))[0]!.status).toBe('CLAIMED');
    // NOTHING CROSSED THE PORT.
    expect(mock.callCount).toBe(0);
    // NO OUTCOME, AND NO LEDGER MOVEMENT. The unit is still RESERVED, which is the correct
    // state for an effect that was never attempted: `25 §10.1`'s PRESUME row is reached from
    // an adapter outcome and there was none.
    expect(await rawOutcomeRows(h.control)).toHaveLength(0);
    for (const row of await mie()) {
      expect(row.reservedIrrecoverable, row.windowId).toBe('1');
      expect(row.presumedIrrecoverable, row.windowId).toBe('0');
    }
    // THE CAPABILITY DID NOT SURVIVE THE CALL — `§5`, `§24`. The gateway's `finally` revokes
    // on every exit, so a later line in the same process cannot pick it up.
    expect(liveCapabilityCount()).toBe(0);
    // AND THE LEASE WAS RELEASED. A stranded entity lock would deadlock every later operation
    // against the resource — an availability failure that reads as a security success.
    const manager = new DispatchLeaseManager({ pool: h.control });
    expect(
      await manager.isEntityLockFree(entityKeyForResourceRef(COMPANY_ID, effect.resourceRef)),
    ).toBe(true);
  });
});

describe('`§31` — A CRASH AFTER THE ADAPTER, BEFORE THE OUTCOME COMMIT', () => {
  it('the request may have escaped, and STILL nothing reclaims or redispatches', async () => {
    /*
     * The harder case, and the one `§23` calls "intentionally ambiguous": the mock reached its
     * own acceptance point, so a real request would have left the process, and the outcome
     * never became durable. `I9` — "no effect is in a non-terminal state past its SLA" — is
     * the detector, and detection is the recovery, not retry.
     */
    const effect = await enqueuedReship('after-adapter');
    const mock = commerceMock();

    await expect(
      dispatchAuthorisedEffect(
        dispatchEnv(h, mock),
        {
          companyId: COMPANY_ID,
          idempotencyKey: effect.idempotencyKey,
          dispatchedBy: 'worker:crash-2',
          now: NOW,
        },
        { hooks: { afterAdapterReturned: () => Promise.reject(CRASH) } },
      ),
    ).rejects.toThrow('S1J simulated process loss');

    // THE REQUEST MAY HAVE ESCAPED — the fact that makes the ambiguity real.
    expect(mock.callCount).toBe(1);
    expect(mock.acceptedCount).toBe(1);

    // AND NOTHING WAS RECORDED. No outcome row, no journal row, no ledger movement — the
    // three share a commit point and none of them reached it.
    expect(await rawOutcomeRows(h.control)).toHaveLength(0);
    expect(await outcomeJournalRows(h.control)).toHaveLength(0);
    for (const row of await mie()) expect(row.reservedIrrecoverable, row.windowId).toBe('1');

    // THE ROW IS STILL `CLAIMED`, and no elapsed time changes that.
    expect((await outboxRows(h.control))[0]!.status).toBe('CLAIMED');
    const reclaim = await claimForExternalDispatch(h.control, {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      claimedBy: 'worker:much-later',
      now: new Date(NOW.getTime() + 365 * DAY),
    });
    expect(reclaim.kind).toBe('REFUSED');
    if (reclaim.kind === 'REFUSED') expect(reclaim.reason).toBe('ALREADY_CLAIMED');
  });
});

describe('`§32` — AN OLD `CLAIMED` ROW PLUS A NEWLY ACQUIRED DISPATCH LEASE', () => {
  it('a restart CAN take the lease and STILL cannot dispatch — the required regression', async () => {
    /*
     * =================================================================================
     * THE TEST `§32` CALLS IMPORTANT, AND IT HAS TWO HALVES THAT MUST BOTH HOLD.
     *
     * HALF ONE: the lease IS reacquirable. If it were not, this test would pass for the wrong
     * reason — a lock that never releases would also prevent the redispatch, and would be a
     * defect of its own. `25 §14.1`: the database releases it when the session disappears.
     *
     * HALF TWO: holding it grants nothing. The dispatch is refused at the claim, because the
     * claim is the gate and `ALREADY_CLAIMED` is the deterministic answer — "There is no
     * elapsed time and no parameter that changes this answer."
     * =================================================================================
     */
    const effect = await enqueuedReship('old-claimed');

    // A first dispatch that crashes after the claim, leaving a persisted `CLAIMED` row.
    await expect(
      dispatchAuthorisedEffect(
        dispatchEnv(h, commerceMock()),
        {
          companyId: COMPANY_ID,
          idempotencyKey: effect.idempotencyKey,
          dispatchedBy: 'worker:before-restart',
          now: NOW,
        },
        { hooks: { afterClaimCommit: () => Promise.reject(CRASH) } },
      ),
    ).rejects.toThrow('S1J simulated process loss');
    expect((await outboxRows(h.control))[0]!.status).toBe('CLAIMED');

    // HALF ONE — the lease is free and a "restarted process" takes it without waiting.
    const manager = new DispatchLeaseManager({ pool: h.control });
    const key = entityKeyForResourceRef(COMPANY_ID, effect.resourceRef);
    expect(await manager.isEntityLockFree(key)).toBe(true);
    let heldInsideLease = false;
    await manager.withDispatchLease(key, async (lease) => {
      lease.assertHeld(key);
      heldInsideLease = !(await manager.isEntityLockFree(key));
    });
    expect(heldInsideLease, 'the restarted process genuinely held the lease').toBe(true);

    // HALF TWO — the whole dispatch, on a fresh environment, much later. It is refused at the
    // claim and the adapter is never reached.
    const mock = commerceMock();
    const result = await dispatchAuthorisedEffect(dispatchEnv(h, mock), {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      dispatchedBy: 'worker:after-restart',
      now: new Date(NOW.getTime() + 30 * DAY),
    });
    expect(result.kind).toBe('CLAIM_REFUSED');
    if (result.kind === 'CLAIM_REFUSED') expect(result.reason).toBe('ALREADY_CLAIMED');
    expect(mock.callCount).toBe(0);
    expect(await rawOutcomeRows(h.control)).toHaveLength(0);
  });

  it('THE DISCRIMINATOR — the unsafe path dispatches from the persisted row alone', async () => {
    /*
     * `§32`: "Persisted CLAIMED alone is insufficient."
     *
     * `unsafeDispatchOnPersistedClaim` reads the `CLAIMED` row, builds an envelope from it and
     * invokes — with no capability and no claim of its own. It reaches the adapter because
     * nothing in ITS path stops it; production does not, because the capability is minted at
     * exactly one line in `src/` and that line is downstream of a successful claim.
     */
    const effect = await enqueuedReship('discriminator');
    await expect(
      dispatchAuthorisedEffect(
        dispatchEnv(h, commerceMock()),
        {
          companyId: COMPANY_ID,
          idempotencyKey: effect.idempotencyKey,
          dispatchedBy: 'worker:disc-first',
          now: NOW,
        },
        { hooks: { afterClaimCommit: () => Promise.reject(CRASH) } },
      ),
    ).rejects.toThrow('S1J simulated process loss');

    // PRODUCTION, after the "restart": refused, zero invocations.
    const productionMock = commerceMock();
    const production = await dispatchAuthorisedEffect(dispatchEnv(h, productionMock), {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      dispatchedBy: 'worker:disc-production',
      now: new Date(NOW.getTime() + DAY),
    });
    expect(production.kind).toBe('CLAIM_REFUSED');
    expect(productionMock.callCount).toBe(0);

    // UNSAFE: the same persisted row, dispatched.
    const unsafeMock = commerceMock();
    const unsafe = await unsafeDispatchOnPersistedClaim(h.control, testRegistry(unsafeMock), {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
    });
    expect(unsafe.invoked).toBe(true);
    expect(unsafeMock.callCount).toBe(1);

    // THE DISCRIMINATION, AS ONE COMPARISON — one authorised effect, two adapter invocations
    // under the unsafe path and zero under production's.
    expect(unsafeMock.callCount).not.toBe(productionMock.callCount);
  });
});
