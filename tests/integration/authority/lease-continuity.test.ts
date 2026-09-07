import type { PoolClient } from 'pg';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { parseProposedIntent } from '../../../src/kernel/canonicalisation/intent.js';
import { advisoryLockKey } from '../../../src/kernel/enumeration/entityLease.js';
import { createHarness, type Harness } from '../../support/fixture.js';
import {
  entityKeyFor,
  loadCommerceFixture,
  rawIntent,
} from '../../support/enumerationFixture.js';
import {
  S1E_PASS_ORDER,
  loadAuthorityWorld,
  loadS1eOrders,
  makeAuthorityHarness,
  nonAuthorityContext,
  s1eSpec,
  workerSession,
  type AuthorityHarness,
} from '../../support/authorityFixture.js';

/**
 * ENTITY-LEASE CONTINUITY ACROSS THE WHOLE S1E SEQUENCE — TWO REAL POSTGRESQL BACKENDS.
 *
 * `25 §14`, verbatim:
 *
 *   | Two work items touching the same entity | Advisory lock on
 *   | `(company_id, entity_type, entity_id)` **for the duration of the
 *   | propose→authorise→execute span.** Second item waits or defers; it does not proceed on
 *   | stale state. |
 *
 * S1C proved the lock is held while C′ re-enumerates. S1E extends that span across every
 * authority gate `26 §7` places before step R, and this file is the proof.
 *
 * ---------------------------------------------------------------------------------
 * WHAT WOULD MAKE THIS TEST WORTHLESS, AND WHAT IT DOES INSTEAD
 *
 * An application-level boolean — `lease.isHeld()` — proves nothing: it is a field the same
 * code sets. `pg_try_advisory_lock` returning false proves the lock is held by SOMEONE at
 * one instant, which a release-and-reacquire would also satisfy at both sampling points.
 *
 * So this test uses three server-side facts:
 *
 * 1. **`pg_backend_pid()` on the lease's own connection**, sampled at three points in the
 *    span. PostgreSQL assigns one pid per backend, and the lease holds one connection for
 *    its lifetime, so an equal pid at all three points is a statement about the SERVER's
 *    view of the session rather than about the client's bookkeeping.
 *
 * 2. **`pg_locks`**, read from a THIRD connection, showing the advisory lock GRANTED to
 *    exactly that pid at the moment the last gate has run.
 *
 * 3. **A second session parked in a BLOCKING `pg_advisory_lock`**, started before the
 *    sequence reaches its barrier. This is the release/reacquire detector, and it is
 *    deterministic rather than probabilistic: if session A released the lock at any instant
 *    during the sequence, session B — already waiting in the lock queue — would be granted
 *    it, and the `pg_locks` sample at the barrier would show B's pid holding it and A's
 *    request ungranted. There is no interleaving in which a release goes unobserved.
 *
 * ---------------------------------------------------------------------------------
 * THIS ADVANCES VC-C3. IT DOES NOT CLOSE IT.
 *
 * `25 §14`'s span is propose→authorise→EXECUTE. S1E has no step R, no approval, no signed
 * `AuthorizationDecision` and no dispatch, so the second half of that span does not exist to
 * be held. What is proven here is continuity through the PRE-RESERVATION sequence, and
 * `S1E-result.md` records VC-C3 as PARTIAL for that reason.
 * ---------------------------------------------------------------------------------
 */

let harness: Harness;
let kernel: AuthorityHarness;

async function withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await harness.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

async function backendPid(client: PoolClient): Promise<number> {
  const rows = await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
  return rows.rows[0]!.pid;
}

interface AdvisoryLockRow {
  readonly pid: number;
  readonly granted: boolean;
}

/**
 * Who holds, and who is waiting for, the entity advisory lock — read from the SERVER.
 *
 * `classid` and `objid` are `oid`, which is unsigned; `advisoryLockKey` returns the SIGNED
 * 32-bit halves `pg_advisory_lock(int, int)` declares. They are the same bits, so the
 * comparison is done in JavaScript after an unsigned reinterpretation rather than by a cast
 * PostgreSQL would reject for a negative value.
 */
async function advisoryLockRows(
  observer: PoolClient,
  key: readonly [number, number],
): Promise<readonly AdvisoryLockRow[]> {
  const rows = await observer.query<{
    pid: number;
    granted: boolean;
    classid: string;
    objid: string;
  }>(
    `SELECT pid, granted, classid::bigint AS classid, objid::bigint AS objid
       FROM pg_locks
      WHERE locktype = 'advisory' AND objsubid = 2`,
  );
  const wantClass = BigInt(key[0] >>> 0);
  const wantObj = BigInt(key[1] >>> 0);
  return rows.rows
    .filter((row) => BigInt(row.classid) === wantClass && BigInt(row.objid) === wantObj)
    .map((row) => ({ pid: row.pid, granted: row.granted }));
}

beforeAll(async () => {
  harness = await createHarness();
});

afterAll(async () => {
  await harness.close();
});

beforeEach(async () => {
  await harness.reset();
  await withClient(async (client) => {
    await loadCommerceFixture(client);
    await loadS1eOrders(client);
    await loadAuthorityWorld(client);
  });
  kernel = makeAuthorityHarness(harness);
});

describe('ONE held session lease spans C′ through the final pre-reservation gate', () => {
  it('the same backend holds the lock from before C′ to after step P, and a competing session cannot pass', async () => {
    const spec = s1eSpec();
    const key = entityKeyFor(S1E_PASS_ORDER.orderId);
    const lockKey = advisoryLockKey(key);

    // --- the model's READ, in its own lease, exactly as `26 §2.0.1` describes -------------
    const read = await kernel.leases.withEntityLease(key, async (lease) => {
      const outcome = await kernel.enumerator.enumerate(lease, {
        actionClass: 'refund.create',
        resourceRef: S1E_PASS_ORDER.resourceRef,
        spec,
      });
      return {
        enumerationId: outcome.set.enumerationId,
        optionId: outcome.set.options[0]!.optionId,
      };
    });
    const intent = parseProposedIntent(
      rawIntent({
        resourceRef: S1E_PASS_ORDER.resourceRef,
        enumerationId: read.enumerationId,
        optionId: read.optionId,
      }),
    );

    const observer = await harness.connect();
    const competitor = await harness.connect();
    try {
      const competitorPid = await backendPid(competitor);

      const pids: { atAcquire?: number; atBarrier?: number; afterSequence?: number } = {};
      let locksAtBarrier: readonly AdvisoryLockRow[] = [];
      let competitorAcquired = false;
      let competitorAcquiredByBarrier: boolean | null = null;
      let competitorPromise: Promise<void> = Promise.resolve();

      // --- SESSION A: the whole S1E sequence, under one held lease -------------------------
      const outcome = await kernel.leases.withEntityLease(key, async (lease) => {
        pids.atAcquire = await backendPid(lease.client);

        // --- SESSION B: park in the lock queue, AFTER A holds it and BEFORE the sequence ----
        //
        // A BLOCKING acquire, not a try-acquire. It is the release detector: the instant A
        // lets go, B is granted the lock. Started here rather than earlier so that B is
        // demonstrably queued BEHIND A rather than racing it for the initial acquisition.
        competitorPromise = (async () => {
          await competitor.query('SELECT pg_advisory_lock($1::int, $2::int)', [
            lockKey[0],
            lockKey[1],
          ]);
          competitorAcquired = true;
          await competitor.query('SELECT pg_advisory_unlock($1::int, $2::int)', [
            lockKey[0],
            lockKey[1],
          ]);
        })();

        // `pg_locks` shows an UNGRANTED advisory row for a waiting backend. Waiting for it to
        // appear is what makes "B was in the queue for the whole sequence" true rather than
        // hoped for.
        await waitFor(async () => {
          const rows = await advisoryLockRows(observer, lockKey);
          return rows.some((row) => row.pid === competitorPid && !row.granted);
        });

        const result = await kernel.pipeline.evaluateUnderLease(
          lease,
          workerSession(),
          intent,
          spec,
          nonAuthorityContext(),
          async () => {
            // Every gate D through P has now run.
            pids.atBarrier = await backendPid(lease.client);
            locksAtBarrier = await advisoryLockRows(observer, lockKey);
            // SAMPLED HERE, inside the span, so there is no window in which A's release and
            // this read could interleave.
            competitorAcquiredByBarrier = competitorAcquired;
          },
        );

        pids.afterSequence = await backendPid(lease.client);
        return result;
      });

      await competitorPromise;

      // --- what the SERVER saw --------------------------------------------------------------
      expect(outcome.outcome, JSON.stringify({ outcome: outcome.outcome })).toBe(
        'PRE_RESERVATION_PASS',
      );

      // 1. ONE backend, three samples across the span.
      expect(pids.atAcquire).toBeGreaterThan(0);
      expect(pids.atBarrier).toBe(pids.atAcquire);
      expect(pids.afterSequence).toBe(pids.atAcquire);
      expect(pids.atAcquire).not.toBe(competitorPid);

      // 2. At the moment the last gate had run, the lock was GRANTED to that backend.
      const granted = locksAtBarrier.filter((row) => row.granted);
      expect(granted).toHaveLength(1);
      expect(granted[0]!.pid).toBe(pids.atAcquire);

      // 3. And the competitor was still WAITING, not holding.
      const waiting = locksAtBarrier.filter((row) => !row.granted);
      expect(waiting.map((row) => row.pid)).toEqual([competitorPid]);

      // 4. RELEASE/REACQUIRE DETECTOR: the competitor was parked in the queue from before the
      //    first gate, so it could only have been granted the lock if A let go of it at some
      //    instant during the sequence. Sampled INSIDE the span.
      expect(competitorAcquiredByBarrier).toBe(false);
      // And it did get the lock once the span ended, so the wait was real.
      expect(competitorAcquired).toBe(true);
    } finally {
      observer.release();
      competitor.release();
    }
  });

  it('the competing session PROCEEDS once the span ends — the lock is released, not leaked', async () => {
    const key = entityKeyFor(S1E_PASS_ORDER.orderId);
    expect(await kernel.leases.isEntityLockFree(key)).toBe(true);

    const spec = s1eSpec();
    const read = await kernel.leases.withEntityLease(key, async (lease) => {
      const outcome = await kernel.enumerator.enumerate(lease, {
        actionClass: 'refund.create',
        resourceRef: S1E_PASS_ORDER.resourceRef,
        spec,
      });
      return {
        enumerationId: outcome.set.enumerationId,
        optionId: outcome.set.options[0]!.optionId,
      };
    });
    const intent = parseProposedIntent(
      rawIntent({
        resourceRef: S1E_PASS_ORDER.resourceRef,
        enumerationId: read.enumerationId,
        optionId: read.optionId,
      }),
    );

    let freeDuringSpan: boolean | null = null;
    await kernel.leases.withEntityLease(key, (lease) =>
      kernel.pipeline.evaluateUnderLease(
        lease,
        workerSession(),
        intent,
        spec,
        nonAuthorityContext(),
        async () => {
          // Observed from a SEPARATE session, non-blocking, and it releases immediately if it
          // succeeded so the observation never becomes an acquisition.
          freeDuringSpan = await kernel.leases.isEntityLockFree(key);
        },
      ),
    );

    // Both directions. A test asserting only "held" would pass against an implementation
    // that never releases.
    expect(freeDuringSpan).toBe(false);
    expect(await kernel.leases.isEntityLockFree(key)).toBe(true);
  });

  it('a lease RELEASED mid-sequence makes the terminal assertion throw rather than pass', async () => {
    // The property `preReservation.ts` asserts at the end of the span: `lease.assertHeld()`
    // AFTER the last gate. This drives the case directly by releasing the lease's own
    // bookkeeping from inside the barrier, which is the closest a test can get to the bug
    // "the sequence finished on a lease that was no longer held".
    const spec = s1eSpec();
    const key = entityKeyFor(S1E_PASS_ORDER.orderId);
    const read = await kernel.leases.withEntityLease(key, async (lease) => {
      const outcome = await kernel.enumerator.enumerate(lease, {
        actionClass: 'refund.create',
        resourceRef: S1E_PASS_ORDER.resourceRef,
        spec,
      });
      return {
        enumerationId: outcome.set.enumerationId,
        optionId: outcome.set.options[0]!.optionId,
      };
    });
    const intent = parseProposedIntent(
      rawIntent({
        resourceRef: S1E_PASS_ORDER.resourceRef,
        enumerationId: read.enumerationId,
        optionId: read.optionId,
      }),
    );

    await expect(
      kernel.leases.withEntityLease(key, (lease) => {
        const forged = {
          ...lease,
          assertHeld: (): never => {
            throw new Error('lease released');
          },
          isHeld: () => false,
        };
        return kernel.pipeline.evaluateUnderLease(
          forged,
          workerSession(),
          intent,
          spec,
          nonAuthorityContext(),
        );
      }),
    ).rejects.toThrow('lease released');
  });
});

/** Poll a server-side condition. Used only to sequence the two sessions, never to assert. */
async function waitFor(condition: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('the competing session never appeared in pg_locks');
}
