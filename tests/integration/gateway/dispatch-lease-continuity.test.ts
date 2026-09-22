import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { COMPANY_ID } from '../../support/fixture.js';
import {
  S1I_NOW,
  authoriseReship,
  createOutboxHarness,
  outboxRows,
  type OutboxHarness,
} from '../../support/outboxFixture.js';
import { entityKeyFor } from '../../support/enumerationFixture.js';
import { ADAPTER_COMMERCE, dispatchEnv } from '../../support/gatewayFixture.js';
import { createMockAdapter, returnedOutcome } from '../../support/mockAdapter.js';
import { enqueueDispatch } from '../../../src/kernel/outbox/enqueue.js';
import {
  dispatchAuthorisedEffect,
  type GatewayEvent,
} from '../../../src/kernel/gateway/effectGateway.js';
import {
  DispatchLeaseManager,
  entityKeyEqualityProof,
  entityKeyForResourceRef,
} from '../../../src/kernel/gateway/dispatchLease.js';
import { advisoryLockKey } from '../../../src/kernel/enumeration/entityLease.js';

/**
 * `§23`, `§24`, `§25`, `§26`, `§30` — THE TWO SERIALIZATION EPOCHS, MEASURED.
 *
 * =================================================================================
 * THE DEFECT SER-01 FOUND, AND WHAT REPLACED IT
 *
 * `25 §14` required ONE advisory lock "for the duration of the propose→authorise→**execute**
 * span". `phase2-v1.3.5-errata.md §2` records why that is unachievable: "a session-scoped
 * lock lives in one process's connection", and `25 §7`'s outbox exists precisely so a row
 * may be claimed "later, after a restart, possibly by a different worker".
 *
 * `25 §14.1` replaces it with TWO epochs and an explicitly lock-free gap. This suite asserts
 * all three parts FROM A SEPARATE POSTGRESQL SESSION, because every one of them is a
 * server-side fact and none of them is an application boolean:
 *
 *   EPOCH A   unchanged, and asserted by the accepted `lease-continuity.test.ts`.
 *   THE GAP   `pg_try_advisory_lock` SUCCEEDS between the authorising COMMIT and the
 *             dispatch — "**NO DATABASE SESSION LOCK IS HELD, AND THAT IS AN EXPLICIT
 *             ARCHITECTURE PROPERTY RATHER THAN A MISSING LOCK.**"
 *   EPOCH B   the SAME key, a NEW session, and `pg_try_advisory_lock` FAILS at every point
 *             from revalidation through the outcome COMMIT.
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

/** One authorised, enqueued IRRECOVERABLE effect. */
async function enqueuedReship(suffix: string): Promise<{
  readonly idempotencyKey: string;
  readonly resourceRef: string;
  readonly resourceId: string;
}> {
  const resourceId = `ORD-LEASE-${suffix}`;
  const effect = await authoriseReship(h, { resourceId });
  await enqueueDispatch(h.control, {
    companyId: COMPANY_ID,
    effectId: effect.effectId,
    outboxId: `outbox:${effect.idempotencyKey}`,
    payloadCanonicalBytes: effect.payloadCanonicalBytes,
    now: NOW,
  });
  return {
    idempotencyKey: effect.idempotencyKey,
    resourceRef: `order:${resourceId}`,
    resourceId,
  };
}

function commerceMock(events?: string[]) {
  return createMockAdapter({
    adapterId: ADAPTER_COMMERCE,
    resolutionCapabilities: ['IDEMPOTENCY_HEADER', 'DELIVERY_EVENT_WEBHOOK'],
    outcome: returnedOutcome(),
    ...(events === undefined ? {} : { events }),
  });
}

/**
 * Whether the entity lock is FREE, observed from a SEPARATE session.
 *
 * `pg_try_advisory_lock` is non-blocking, so this observes without waiting, and it releases
 * immediately if it succeeded so an observation never becomes an acquisition — the accepted
 * `entityLease.ts` discipline, reused rather than reimplemented.
 */
async function lockIsFree(resourceRef: string): Promise<boolean> {
  const manager = new DispatchLeaseManager({ pool: h.control });
  return manager.isEntityLockFree(entityKeyForResourceRef(COMPANY_ID, resourceRef));
}

describe('`§26` — EPOCH B REACQUIRES THE SAME ENTITY LOCK KEY', () => {
  it('the key is derived from the committed `resource_ref`, and equals Epoch A’s', () => {
    /*
     * `25 §14.1`: "the **same architecture entity advisory-lock key** for the effect's
     * resource is acquired again."
     *
     * `entityKeyFor` is the key the ACCEPTED S1C/S1E/S1F suites hold Epoch A under.
     * `entityKeyForResourceRef` is production's dispatch-time derivation. They must produce
     * the same two 32-bit integers, or the two epochs serialise against themselves and not
     * against each other — which would look correct in every single-epoch test.
     */
    const epochA = entityKeyFor('ORD-123');
    const epochB = entityKeyForResourceRef(COMPANY_ID, 'order:ORD-123');
    expect(epochB).toEqual(epochA);
    expect(advisoryLockKey(epochB)).toEqual(advisoryLockKey(epochA));
    expect(entityKeyEqualityProof(epochA, epochB)).toBe(true);
  });

  it('and a DIFFERENT resource is a different key — the proof is not vacuous', () => {
    const one = entityKeyForResourceRef(COMPANY_ID, 'order:ORD-123');
    const other = entityKeyForResourceRef(COMPANY_ID, 'order:ORD-124');
    expect(entityKeyEqualityProof(one, other)).toBe(false);
    // And the type prefix is load-bearing: `26 §4`'s `resourceTypeOf` reads the same split.
    expect(entityKeyForResourceRef(COMPANY_ID, 'campaign:X').entityType).toBe('campaign');
    expect(entityKeyForResourceRef(COMPANY_ID, 'campaign:X').entityId).toBe('X');
  });

  it('a ref with no type prefix is a DEFECT, not a key', () => {
    // `26 §4`: "the resolved resource ref [...] does not carry a type prefix" is an AUTHORITY
    // DEFECT. A key derived from an unresolved value would silently serialise the wrong set.
    expect(() => entityKeyForResourceRef(COMPANY_ID, 'ORD-123')).toThrow(/type prefix/);
    expect(() => entityKeyForResourceRef(COMPANY_ID, 'order:')).toThrow(/type prefix/);
  });
});

describe('`§24` — THE ASYNCHRONOUS GAP HOLDS NO SESSION LOCK', () => {
  it('after the authorising COMMIT and before the dispatch, the lock is FREE', async () => {
    /*
     * `25 §14.1`: "**THE GAP — NO DATABASE SESSION LOCK IS HELD, AND THAT IS AN EXPLICIT
     * ARCHITECTURE PROPERTY RATHER THAN A MISSING LOCK.**"
     *
     * Observed from a THIRD session, so it is PostgreSQL reporting the state of its own lock
     * table rather than the implementation reporting on itself.
     */
    const effect = await enqueuedReship('gap');
    expect(await lockIsFree(effect.resourceRef)).toBe(true);

    // And nothing in the process is holding it either — there is no renewal daemon and no
    // handover token, so a second observation a moment later gives the same answer.
    expect(await lockIsFree(effect.resourceRef)).toBe(true);
  });
});

describe('`§25`, `§30` — EPOCH B IS HELD CONTINUOUSLY ACROSS ALL SEVEN STEPS', () => {
  it('the lock is HELD at revalidation, at the claim, at the adapter and at the outcome', async () => {
    /*
     * `25 §14.1`'s span, verbatim:
     *
     *   1. dispatch-time revalidation → 2. claim-time authority evaluation → 3. CLAIM →
     *   4. CLAIM COMMIT → 5. adapter invocation → 6. local adapter-outcome transaction →
     *   7. OUTCOME COMMIT
     *
     * "held **continuously, with no release and no reacquisition inside the epoch**".
     *
     * Each observation below is made from a SEPARATE session at a different point in the
     * span, through the gateway's own kill-point hooks. A single observation would not
     * distinguish "held throughout" from "held at the moment I looked".
     */
    const effect = await enqueuedReship('span');
    const observations: Record<string, boolean> = {};
    const mock = createMockAdapter({
      adapterId: ADAPTER_COMMERCE,
      resolutionCapabilities: ['IDEMPOTENCY_HEADER', 'DELIVERY_EVENT_WEBHOOK'],
      outcome: returnedOutcome(),
      afterAccepted: async () => {
        // STEP 5, inside the adapter, outside every transaction.
        observations['adapter'] = await lockIsFree(effect.resourceRef);
      },
    });

    const result = await dispatchAuthorisedEffect(
      dispatchEnv(h, mock),
      {
        companyId: COMPANY_ID,
        idempotencyKey: effect.idempotencyKey,
        dispatchedBy: 'worker:span',
        now: NOW,
      },
      {
        hooks: {
          // STEP 1→2 boundary: revalidation passed, the claim has not begun.
          afterRevalidation: async () => {
            observations['afterRevalidation'] = await lockIsFree(effect.resourceRef);
          },
          // STEP 4: the claim has COMMITTED and the adapter has not been invoked.
          afterClaimCommit: async () => {
            observations['afterClaimCommit'] = await lockIsFree(effect.resourceRef);
          },
          // STEP 6: inside the outcome transaction, after the row lock.
          afterOutcomeLock: async () => {
            observations['insideOutcome'] = await lockIsFree(effect.resourceRef);
          },
          // STEP 7: the outcome has COMMITTED and the lease has not yet been released.
          afterOutcomeCommit: async () => {
            observations['afterOutcomeCommit'] = await lockIsFree(effect.resourceRef);
          },
        },
      },
    );

    expect(result.kind).toBe('OUTCOME_RESOLVED');

    // EVERY point in the span observed the lock as HELD. `false` here means "not free".
    expect(observations).toEqual({
      afterRevalidation: false,
      afterClaimCommit: false,
      adapter: false,
      insideOutcome: false,
      afterOutcomeCommit: false,
    });

    // AND IT IS RELEASED AFTERWARDS. Both directions matter: a test that only asserted
    // "held" would pass against an implementation that never releases.
    expect(await lockIsFree(effect.resourceRef)).toBe(true);
  });

  it('a competing entity mutation CANNOT intervene during Epoch B — `§30`', async () => {
    /*
     * `25 §14.1`: "**No ACOS-authorised entity mutation can intervene between dispatch
     * revalidation and the attempted external effect, or between the external effect and its
     * recorded outcome.**"
     *
     * Session 2 is a REAL competitor: it asks for the same advisory lock the way any
     * legitimate ACOS mutation would — through the accepted lease manager, blocking — and the
     * test measures whether it obtained it before Epoch B finished. `36 §14` requires the race
     * to be constructed rather than hoped for, so the interleaving is a hook and not a sleep.
     */
    const effect = await enqueuedReship('competitor');
    const key = entityKeyForResourceRef(COMPANY_ID, effect.resourceRef);
    const competitor = new DispatchLeaseManager({ pool: h.control });

    const order: string[] = [];
    let competitorAcquired: (() => void) | null = null;
    const competitorStarted = new Promise<void>((resolve) => {
      competitorAcquired = resolve;
    });

    // Initialised to a resolved promise so the type never widens to `null`: the
    // competitor is started inside a hook, and a nullable handle here would make the
    // `await` below a non-Thenable await under `@typescript-eslint/await-thenable`.
    let competitorDone: Promise<void> = Promise.resolve();

    const mock = commerceMock();
    const result = await dispatchAuthorisedEffect(
      dispatchEnv(h, mock),
      {
        companyId: COMPANY_ID,
        idempotencyKey: effect.idempotencyKey,
        dispatchedBy: 'worker:excl',
        now: NOW,
      },
      {
        hooks: {
          afterRevalidation: async () => {
            // The competitor starts WHILE Epoch B holds the lock, and blocks.
            competitorDone = competitor.withDispatchLease(key, async () => {
              order.push('COMPETITOR_ACQUIRED');
            });
            competitorAcquired?.();
            await competitorStarted;
            // It has not acquired: the lock is held and `withDispatchLease` blocks.
            expect(order).toEqual([]);
          },
          afterOutcomeCommit: async () => {
            order.push('OUTCOME_COMMITTED');
            // STILL not acquired, with the outcome already durable — the lease outlives the
            // COMMIT and is released only afterwards.
            expect(order).toEqual(['OUTCOME_COMMITTED']);
          },
        },
      },
    );

    expect(result.kind).toBe('OUTCOME_RESOLVED');
    await competitorDone;

    // THE ORDER IS THE PROPERTY. The competitor acquired only after Epoch B released.
    expect(order).toEqual(['OUTCOME_COMMITTED', 'COMPETITOR_ACQUIRED']);
  });

  it('the event order records the epoch, and the lease brackets everything', async () => {
    /*
     * `§6`'s ordering instrumentation, extended to `25 §14.1`'s two new boundaries. The mock
     * pushes into the SAME log, so the claim, the invocation and the outcome are ordered
     * against the lease rather than against a clock.
     */
    const effect = await enqueuedReship('events');
    const events: string[] = [];
    const mock = commerceMock(events);

    const result = await dispatchAuthorisedEffect(
      dispatchEnv(h, mock),
      {
        companyId: COMPANY_ID,
        idempotencyKey: effect.idempotencyKey,
        dispatchedBy: 'worker:events',
        now: NOW,
      },
      { events: (e: GatewayEvent) => events.push(e) },
    );
    expect(result.kind).toBe('OUTCOME_RESOLVED');

    const at = (name: string): number => events.indexOf(name);
    // `30 §5.1`'s ordering block, read off the log.
    expect(at('DISPATCH_LEASE_ACQUIRED')).toBe(0);
    expect(at('REVALIDATED')).toBeGreaterThan(at('DISPATCH_LEASE_ACQUIRED'));
    // "A claim that occurs before revalidation is a defect of this class."
    expect(at('CLAIM_COMMITTED')).toBeGreaterThan(at('REVALIDATED'));
    expect(at('MOCK_ADAPTER_INVOKED')).toBeGreaterThan(at('CLAIM_COMMITTED'));
    expect(at('OUTCOME_COMMITTED')).toBeGreaterThan(at('MOCK_ADAPTER_INVOKED'));
    // "released only afterwards" — the lease event is last, on every path.
    expect(at('DISPATCH_LEASE_RELEASED')).toBe(events.length - 1);
  });

  it('a REFUSED revalidation still releases the lease, and claims nothing', async () => {
    /*
     * The `finally` half. `25 §14.1` releases "only afterwards" on the success path, and on
     * every other exit the lock must not be stranded — a stranded entity lock would deadlock
     * every later operation against that resource, which is an availability failure that
     * reads as a security success.
     */
    const effect = await enqueuedReship('refused');
    // Demote the resource so the authorised option leaves the live set.
    const client = await h.control.connect();
    try {
      await client.query(
        `UPDATE commerce_order SET grade = 'OBSERVATION'
          WHERE company_id = $1 AND resource_ref = $2`,
        [COMPANY_ID, effect.resourceRef],
      );
    } finally {
      client.release();
    }

    const mock = commerceMock();
    const result = await dispatchAuthorisedEffect(dispatchEnv(h, mock), {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      dispatchedBy: 'worker:refused',
      now: NOW,
    });

    expect(result.kind).toBe('REVALIDATION_REFUSED');
    expect(mock.callCount).toBe(0);
    expect((await outboxRows(h.control))[0]!.status).toBe('ENQUEUED');
    expect(await lockIsFree(effect.resourceRef)).toBe(true);
  });
});
