import type {
  EntityKey,
  EntityLeaseManager,
  HeldEntityLease,
} from '../../src/kernel/enumeration/entityLease.js';

/**
 * INTENTIONALLY VULNERABLE — TEST ONLY. NEVER IMPORTED FROM `src/`.
 *
 * `25 §14`'s span defect: release after C′, reacquire before the authority gates.
 *
 * ---------------------------------------------------------------------------------
 * THE BUG THIS ENCODES
 *
 * `25 §14` requires the advisory lock on `(company_id, entity_type, entity_id)` "**for the
 * duration of the propose→authorise→execute span**". The S1C mandate names the shape it will
 * not accept: a helper that "acquires the advisory lock; re-enumerates; releases it
 * immediately; returns a canonical request".
 *
 * That shape is attractive because it looks tidier: each phase takes the lock it needs and
 * gives it back, connections are held for less time, and every individual phase is correct.
 * What it loses is the property the lock exists for — between the release and the reacquire
 * another work item can take the lock, mutate the entity, and let the authority gates
 * evaluate state that no longer matches the canonical effect C′ built.
 *
 * `runInTwoLeases` below is that helper. It runs `phase1` under one lease, releases, invokes
 * `inTheGap` while NOTHING holds the lock, and then runs `phase2` under a FRESH lease with a
 * different `leaseId` on a different pooled connection.
 *
 * The discriminating test asserts the observable difference from a SEPARATE PostgreSQL
 * session: during `inTheGap` the advisory lock is FREE, and during the production pipeline's
 * own barrier it is HELD. That is a server-side fact, not an application boolean.
 */
export async function runInTwoLeases<A, B>(
  manager: EntityLeaseManager,
  key: EntityKey,
  phase1: (lease: HeldEntityLease) => Promise<A>,
  inTheGap: () => Promise<void>,
  phase2: (lease: HeldEntityLease, first: A) => Promise<B>,
): Promise<{ readonly first: A; readonly second: B; readonly leaseIds: readonly string[] }> {
  const leaseIds: string[] = [];
  const first = await manager.withEntityLease(key, async (lease) => {
    leaseIds.push(lease.leaseId);
    return phase1(lease);
  });

  // THE DEFECT. Nothing holds the entity lock here.
  await inTheGap();

  const second = await manager.withEntityLease(key, async (lease) => {
    leaseIds.push(lease.leaseId);
    return phase2(lease, first);
  });

  return { first, second, leaseIds };
}
