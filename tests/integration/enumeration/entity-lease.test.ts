import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { inTransaction } from '../../../src/db/pool.js';
import { advisoryLockKey, type HeldEntityLease } from '../../../src/kernel/enumeration/entityLease.js';
import { Conductor, settleAll } from '../../support/barrier.js';
import { createHarness, type Harness } from '../../support/fixture.js';
import {
  CAN03,
  entityKeyFor,
  loadCommerceFixture,
  makeEnumerationHarness,
  makeSpec,
  type EnumerationHarness,
} from '../../support/enumerationFixture.js';

/**
 * The entity execution lease — `25 §14`'s lock, and its LIFETIME.
 *
 * `25 §14`, verbatim:
 *
 *   "Advisory lock on `(company_id, entity_type, entity_id)` **for the duration of the
 *    propose→authorise→execute span.** Second item waits or defers; it does not proceed on
 *    stale state."
 *
 * ---------------------------------------------------------------------------------
 * WHAT THESE TESTS PROVE, AND WHAT THEY DO NOT
 *
 * The S1C mandate forbids taking a transaction-scoped lock, re-enumerating, releasing, and
 * then claiming the concurrency property. So the tests below assert the lifetime directly,
 * from a SECOND session, at the instants that matter:
 *
 *   - the lock is genuinely held WHILE the C′ re-enumeration runs;
 *   - it is still held after a COMMIT, which is the property `pg_advisory_xact_lock` cannot
 *     have and the reason the lease is session-scoped;
 *   - it is still held across a fake downstream callback standing in for later
 *     policy/dispatch;
 *   - it is released, explicitly, when the span ends;
 *   - a second holder WAITS rather than proceeding on stale state.
 *
 * They do NOT prove the finished propose→authorise→execute span, because steps M, R, S and
 * W do not exist in S1C. `S1C-result.md` says exactly that and does not claim VC-C3's lock
 * clause is fully closed.
 *
 * NO POLICY RUNS IN THE CALLBACK. The mandate: "a fake downstream callback may stand in for
 * later policy/dispatch solely to demonstrate lock lifetime. Do NOT implement policy inside
 * that callback."
 *
 * Every interleaving is driven by `tests/support/barrier.ts`. No sleeps.
 * ---------------------------------------------------------------------------------
 */

let harness: Harness;
let kernel: EnumerationHarness;

beforeAll(async () => {
  harness = await createHarness();
});

afterAll(async () => {
  await harness.close();
});

beforeEach(async () => {
  await harness.reset();
  const client = await harness.connect();
  try {
    await loadCommerceFixture(client);
  } finally {
    client.release();
  }
  kernel = makeEnumerationHarness(harness);
});

const KEY = entityKeyFor(CAN03.orderId);

describe('16 — the lock is HELD while C′ re-enumerates', () => {
  it('a second session cannot take the same lock during re-enumeration, and can after release', async () => {
    const conductor = new Conductor();
    const observations: Record<string, boolean> = {};

    const holder = async (): Promise<void> => {
      await kernel.leases.withEntityLease(KEY, async (lease) => {
        // Re-enumerate under the lease, exactly as step C′ does.
        const live = await kernel.enumerator.reEnumerate(lease, {
          actionClass: 'refund.create',
          resourceRef: CAN03.resourceRef,
          spec: makeSpec(),
        });
        expect(live.set.options).toHaveLength(2);
        // Park HERE — after the re-enumeration, still inside the lease.
        await conductor.reach('holder', 'AFTER_RE_ENUMERATION');
      });
      await conductor.reach('holder', 'AFTER_RELEASE');
    };

    const observer = async (): Promise<void> => {
      await conductor.until('holder', 'AFTER_RE_ENUMERATION');
      // A SEPARATE session, non-blocking. The lock must not be free.
      observations['duringSpan'] = await kernel.leases.isEntityLockFree(KEY);
      conductor.release('holder', 'AFTER_RE_ENUMERATION');

      await conductor.until('holder', 'AFTER_RELEASE');
      observations['afterRelease'] = await kernel.leases.isEntityLockFree(KEY);
      conductor.release('holder', 'AFTER_RELEASE');
    };

    const results = await settleAll([holder, observer]);
    for (const result of results) {
      if (result.status === 'rejected') throw result.reason;
    }

    // Both directions. A test asserting only "held" would pass against an implementation
    // that never releases, which is a different bug and not a better one.
    expect(observations['duringSpan'], 'the entity lock was FREE during C′').toBe(false);
    expect(observations['afterRelease'], 'the entity lock was NOT released').toBe(true);
  });
});

describe('17 — the lease outlives a transaction and a downstream callback', () => {
  it('survives a COMMIT on its own connection — the property a transaction lock cannot have', async () => {
    const conductor = new Conductor();
    let freeAfterCommit: boolean | null = null;

    const holder = async (): Promise<void> => {
      await kernel.leases.withEntityLease(KEY, async (lease) => {
        // A real transaction on the lease's own connection, opened and committed.
        await inTransaction(lease.client, 'READ COMMITTED', async (client) => {
          await client.query('SELECT 1 FROM commerce_order WHERE order_id = $1', [CAN03.orderId]);
        });
        // `pg_advisory_xact_lock` would be GONE here. The session lock is not.
        await conductor.reach('holder', 'AFTER_COMMIT');
      });
    };

    const observer = async (): Promise<void> => {
      await conductor.until('holder', 'AFTER_COMMIT');
      freeAfterCommit = await kernel.leases.isEntityLockFree(KEY);
      conductor.release('holder', 'AFTER_COMMIT');
    };

    const results = await settleAll([holder, observer]);
    for (const result of results) {
      if (result.status === 'rejected') throw result.reason;
    }
    expect(freeAfterCommit, 'the lease did not survive a COMMIT').toBe(false);
  });

  it('is still held inside a FAKE DOWNSTREAM CALLBACK standing in for authorise/execute', async () => {
    // The callback does NOTHING but observe. `26 §7`'s steps M, R, S and W are not
    // implemented in S1C and no policy runs here — the mandate is explicit about that. The
    // point is only that the span the future gateway needs is available and observably
    // locked.
    const conductor = new Conductor();
    let freeInsideCallback: boolean | null = null;
    let leaseWasHeld = false;
    let clientWasTheLeaseClient = false;

    const fakeDownstream = async (lease: HeldEntityLease): Promise<void> => {
      // A future gateway step would assert this before touching money.
      lease.assertHeld(KEY);
      leaseWasHeld = lease.isHeld();
      const result = await lease.client.query<{ ok: number }>('SELECT 1 AS ok');
      clientWasTheLeaseClient = result.rows[0]!.ok === 1;
      await conductor.reach('holder', 'INSIDE_DOWNSTREAM');
    };

    const holder = async (): Promise<void> => {
      await kernel.leases.withEntityLease(KEY, async (lease) => {
        await kernel.enumerator.reEnumerate(lease, {
          actionClass: 'refund.create',
          resourceRef: CAN03.resourceRef,
          spec: makeSpec(),
        });
        await fakeDownstream(lease);
      });
    };

    const observer = async (): Promise<void> => {
      await conductor.until('holder', 'INSIDE_DOWNSTREAM');
      freeInsideCallback = await kernel.leases.isEntityLockFree(KEY);
      conductor.release('holder', 'INSIDE_DOWNSTREAM');
    };

    const results = await settleAll([holder, observer]);
    for (const result of results) {
      if (result.status === 'rejected') throw result.reason;
    }
    expect(leaseWasHeld).toBe(true);
    expect(clientWasTheLeaseClient).toBe(true);
    expect(freeInsideCallback, 'the lock was free during downstream work').toBe(false);
  });

  it('a second work item WAITS for the same entity rather than proceeding on stale state', async () => {
    // `25 §14`: "Second item waits or defers; it does not proceed on stale state."
    const conductor = new Conductor();
    const order: string[] = [];

    const first = async (): Promise<void> => {
      await kernel.leases.withEntityLease(KEY, async () => {
        order.push('first:acquired');
        await conductor.reach('first', 'HOLDING');
        order.push('first:releasing');
      });
    };

    const second = async (): Promise<void> => {
      await conductor.until('first', 'HOLDING');
      // Started while `first` holds. This must BLOCK, not fail and not proceed.
      const acquisition = kernel.leases.withEntityLease(KEY, async () => {
        order.push('second:acquired');
      });
      // Let `first` finish. Only then can `second` acquire.
      conductor.release('first', 'HOLDING');
      await acquisition;
    };

    const results = await settleAll([first, second]);
    for (const result of results) {
      if (result.status === 'rejected') throw result.reason;
    }
    expect(order).toEqual(['first:acquired', 'first:releasing', 'second:acquired']);
  });

  it('a DIFFERENT entity is not blocked — the lock is per (company, type, id)', async () => {
    // The control. Without it, a "second item waits" result could equally be produced by a
    // global lock, which would be a correctness-preserving disaster rather than `25 §14`.
    const conductor = new Conductor();
    let otherAcquired = false;

    const holder = async (): Promise<void> => {
      await kernel.leases.withEntityLease(KEY, async () => {
        await conductor.reach('holder', 'HOLDING');
      });
    };

    const other = async (): Promise<void> => {
      await conductor.until('holder', 'HOLDING');
      await kernel.leases.withEntityLease(entityKeyFor('ORD-777'), async () => {
        otherAcquired = true;
      });
      conductor.release('holder', 'HOLDING');
    };

    const results = await settleAll([holder, other]);
    for (const result of results) {
      if (result.status === 'rejected') throw result.reason;
    }
    expect(otherAcquired).toBe(true);
  });
});

describe('the lease type is the proof obligation, not a convention', () => {
  it('a RELEASED lease is inert — assertHeld throws after the span ends', async () => {
    let escaped: HeldEntityLease | null = null;
    await kernel.leases.withEntityLease(KEY, async (lease) => {
      escaped = lease;
      lease.assertHeld(KEY);
    });
    expect(escaped).not.toBeNull();
    expect(escaped!.isHeld()).toBe(false);
    expect(() => escaped!.assertHeld()).toThrow(/has been released/);
    // And nothing can be enumerated with it, so a retained reference cannot smuggle work
    // out of the span.
    await expect(
      kernel.enumerator.reEnumerate(escaped!, {
        actionClass: 'refund.create',
        resourceRef: CAN03.resourceRef,
        spec: makeSpec(),
      }),
    ).rejects.toThrow(/has been released/);
  });

  it('a lease for ANOTHER entity does not satisfy assertHeld for this one', async () => {
    // Without the key check, any lease at all would satisfy every `assertHeld` in the tree
    // and the type would record a habit rather than a property.
    await kernel.leases.withEntityLease(entityKeyFor('ORD-777'), async (lease) => {
      expect(() => lease.assertHeld(KEY)).toThrow(/covers .*ORD-777.*not .*ORD-123/);
    });
  });

  it('the lock is released even when the span throws', async () => {
    await expect(
      kernel.leases.withEntityLease(KEY, async () => {
        throw new Error('downstream failure');
      }),
    ).rejects.toThrow('downstream failure');
    expect(await kernel.leases.isEntityLockFree(KEY)).toBe(true);
  });

  it('the advisory key is a deterministic function of (company, type, id), with framing', () => {
    // `25 §14`'s key, and the framing that stops `('co','order','X')` colliding with
    // `('co','orderX','')` by concatenation.
    expect(advisoryLockKey(KEY)).toEqual(advisoryLockKey(entityKeyFor(CAN03.orderId)));
    expect(advisoryLockKey(KEY)).not.toEqual(advisoryLockKey(entityKeyFor('ORD-1234')));
    expect(
      advisoryLockKey({ companyId: 'co', entityType: 'order', entityId: 'X' }),
    ).not.toEqual(advisoryLockKey({ companyId: 'co', entityType: 'orderX', entityId: '' }));
    // Both halves must be int4-representable, because that is the type
    // `pg_advisory_lock(int, int)` declares.
    for (const half of advisoryLockKey(KEY)) {
      expect(Number.isInteger(half)).toBe(true);
      expect(half).toBeGreaterThanOrEqual(-(2 ** 31));
      expect(half).toBeLessThan(2 ** 31);
    }
  });
});
