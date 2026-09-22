import type { Pool } from '../../db/pool.js';
import {
  advisoryLockKey,
  EntityLeaseManager,
  formatEntityKey,
  type EntityKey,
  type HeldEntityLease,
} from '../enumeration/entityLease.js';

/**
 * EPOCH B — THE DISPATCH LEASE. `25 §14.1`, v1.3.5 (SER-01, S1J-C6).
 *
 * =================================================================================
 * WHAT SER-01 FOUND, AND WHY THIS FILE IS NOT `entityLease.ts`
 *
 * `25 §14` required ONE advisory lock "for the duration of the propose→authorise→**execute**
 * span", and `phase2-v1.3.5-errata.md §2` records that that span is not achievable:
 *
 *   "The lease that can span propose→authorise is session-scoped — a transaction-scoped
 *    advisory lock is released by `COMMIT`, so it is structurally incapable of spanning a
 *    span whose step S may wait on a human for hours. **And a session-scoped lock lives in
 *    one process's connection.** `25 §7`'s outbox exists precisely so authorisation and
 *    dispatch can be separated in time and in process [...] **No mechanism hands a live
 *    session-scoped advisory lock across that gap**, and a later reacquisition is not the
 *    same lease."
 *
 * `25 §14.1` replaces it with two epochs, and is emphatic about the naming:
 *
 *   "**This is a NEW PostgreSQL session, and it is called the `dispatch lease` — it is NOT
 *    the same lease as Epoch A's and no artifact and no implementation may describe it as
 *    one.**"
 *
 * SO THIS IS A SEPARATE MODULE WITH A SEPARATE TYPE AND A SEPARATE NAME. The alternative —
 * calling `EntityLeaseManager.withEntityLease` at the dispatch site and letting the result
 * be called "the lease" — would be the implementation describing it as the same lease,
 * which the artifact forbids in those words. `HeldDispatchLease` is a distinct type, its
 * `epoch` field reads `'B'`, and `tests/integration/gateway/dispatch-lease-continuity.test.ts`
 * asserts that an Epoch-A `HeldEntityLease` is not accepted anywhere on the dispatch path.
 *
 * IT IS THE SAME LOCK KEY, AND THAT IS THE POINT. `25 §14.1`: "the **same architecture
 * entity advisory-lock key** for the effect's resource is acquired again." Same key, new
 * session, different lease. `entityKeyEqualityProof` below and
 * `dispatch-lease-continuity.test.ts`'s "Epoch-A lock key == Epoch-B lock key" assertion are
 * how that is checked rather than asserted in prose.
 * =================================================================================
 *
 * =================================================================================
 * THE GAP BETWEEN THE EPOCHS HOLDS NO LOCK, AND THAT IS DELIBERATE
 *
 * `25 §14.1`: "**THE GAP — NO DATABASE SESSION LOCK IS HELD, AND THAT IS AN EXPLICIT
 * ARCHITECTURE PROPERTY RATHER THAN A MISSING LOCK.** Safety across the gap derives from
 * five mechanisms, each independently stated elsewhere: the **immutable canonical effect**;
 * the **immutable persisted dispatch payload**, bound to the authorised hash and never
 * rebuilt; **content-addressed option identity**; **non-reclaimable outbox semantics**
 * (OBX-01); and **mandatory fresh dispatch-time revalidation before claim**."
 *
 * There is no lease-renewal daemon in this file, no connection held across the gap, no
 * handover token and no keepalive. `tests/integration/gateway/dispatch-lease-continuity.test.ts`
 * asserts from a SEPARATE PostgreSQL session that the lock is FREE between the authorising
 * COMMIT and the dispatch lease's acquisition — a server-side fact, not an application
 * boolean.
 * =================================================================================
 *
 * =================================================================================
 * REACQUIRING IT IS NOT A RECOVERY MECHANISM — `25 §14.1`
 *
 * "If the process is lost after the `CLAIM` COMMIT, the PostgreSQL session disappears and
 *  **the dispatch lease is released automatically by the database** — but the row remains
 *  `CLAIMED`, the fresh claim capability is gone, and **no restart may acquire a dispatch
 *  lease for the purpose of redispatching that row.** [...] **Reacquiring the dispatch lease
 *  is not a recovery mechanism**, and OBX-01's no-reclaim rule is unaffected by the lease's
 *  lifetime."
 *
 * Nothing in this file grants any permission. Holding a dispatch lease lets a caller ASK to
 * claim; the claim is refused `ALREADY_CLAIMED` by the accepted S1I service under the outbox
 * row lock, and the adapter is unreachable without a fresh-claim capability that only a
 * successful claim in THIS execution mints. `dispatch-lease-crash.test.ts` is the
 * regression: an old `CLAIMED` row plus a newly acquired dispatch lease still cannot
 * dispatch.
 * =================================================================================
 */

/**
 * `25 §14`'s lock key, DERIVED FROM THE COMMITTED `resource_ref` — `§26` of the S1J
 * continuation mandate.
 *
 * =================================================================================
 * WHY THE `resource_ref` AND NOTHING ELSE
 *
 * "Do not derive the dispatch lock key from: mutable resource text; caller; model; current
 *  unrelated state. Use the accepted entity-key derivation."
 *
 * `resource_ref` is on the committed `effect` row and the committed `dispatch_outbox` row,
 * both append-only, and `26 §4`'s `resourceTypeOf` already reads it as `type:id` — "the
 * resolved resource carries a ref of the form `order:ORD-123`. The type is the ref's prefix,
 * taken from the KERNEL-RESOLVED ref". So the two halves of `25 §14`'s
 * `(company_id, entity_type, entity_id)` are already present in one immutable
 * kernel-resolved value, and this function only splits it.
 *
 * IT TAKES NO CALLER INPUT BEYOND THE COMPANY AND THE COMMITTED REF. There is no
 * `entityType` parameter, no override and no options bag, so a dispatch worker cannot name
 * a different entity than the one its effect is against — which would let two dispatches
 * against one order proceed in parallel under two different keys.
 *
 * `tests/integration/gateway/dispatch-lease-continuity.test.ts` asserts
 * `advisoryLockKey(entityKeyForResourceRef(co, 'order:ORD-123'))` equals
 * `advisoryLockKey(entityKeyFor('ORD-123'))` — the Epoch-A key the accepted S1C/S1E/S1F
 * suites use — so the two epochs demonstrably serialise against each other and not merely
 * each against itself.
 * =================================================================================
 */
export function entityKeyForResourceRef(companyId: string, resourceRef: string): EntityKey {
  const separator = resourceRef.indexOf(':');
  if (separator <= 0 || separator === resourceRef.length - 1) {
    // An assertion, not a denial. `26 §4`'s `resourceTypeOf` raises an AUTHORITY DEFECT for
    // the same shape, and for the same reason: a ref the kernel resolved must carry its
    // type, and one that does not means an unresolved value reached committed state.
    throw new Error(
      `the committed resource ref ${resourceRef} does not carry a type prefix; the ` +
        'dispatch lease key is derived from the kernel-resolved ref (25 §14, 26 §4)',
    );
  }
  return {
    companyId,
    entityType: resourceRef.slice(0, separator),
    entityId: resourceRef.slice(separator + 1),
  };
}

/**
 * A dispatch lease that is currently HELD. Epoch B's, and never Epoch A's.
 *
 * `client` is the connection holding the session-level advisory lock, and every transaction
 * of Epoch B runs on it — `25 §14.1`'s "held **continuously, with no release and no
 * reacquisition inside the epoch**" across all seven steps. A transaction opened on a
 * different pooled connection would be a transaction the lock does not cover.
 */
export interface HeldDispatchLease {
  /** `'B'`. Present so the epoch is a value a test can assert, not a comment. */
  readonly epoch: 'B';
  readonly key: EntityKey;
  /** A stable id for this acquisition, distinct from any Epoch-A `leaseId`. */
  readonly dispatchLeaseId: string;
  /** The connection holding the session lock. Every Epoch-B transaction runs on THIS. */
  readonly client: HeldEntityLease['client'];
  /** Throws if the dispatch lease has been released, or does not cover `key`. */
  assertHeld(key?: EntityKey): void;
  isHeld(): boolean;
}

/**
 * The Epoch-A lease object underneath one dispatch lease. KERNEL-INTERNAL.
 *
 * =================================================================================
 * WHY A `WeakMap` AND NOT A FIELD
 *
 * `25 §14.1` forbids any implementation from describing the dispatch lease as the same
 * lease as Epoch A's, and a `HeldDispatchLease` carrying a public `HeldEntityLease` field
 * would be structurally assignable wherever an Epoch-A lease is expected — the two would be
 * interchangeable in the type system, which is exactly the conflation the artifact names.
 *
 * But the accepted enumeration core takes a `HeldEntityLease`, and `25 §14.1` requires the
 * live re-enumeration to run UNDER THE DISPATCH LEASE — on the connection holding the lock.
 * So the underlying object has to reach `reEnumerate` somehow, and the narrowest way is a
 * module-private map plus one exported accessor whose only caller is
 * `dispatchRevalidation.ts`.
 *
 * This is the same technique the accepted `preReservation.ts` uses for its sealed
 * continuation, and for the same reason it gives: it keeps a value reachable by exactly one
 * module without widening a public type. `no-real-transport-boundary.test.ts` asserts the
 * single caller.
 * =================================================================================
 */
const UNDERLYING = new WeakMap<HeldDispatchLease, HeldEntityLease>();

export function underlyingLeaseFor(lease: HeldDispatchLease): HeldEntityLease {
  const underlying = UNDERLYING.get(lease);
  if (underlying === undefined) {
    // An assertion, not a fallback. A `HeldDispatchLease` this module did not create is a
    // fabricated lease, and a fabricated lease is a claim to hold a lock nobody holds.
    throw new Error(
      'this dispatch lease was not created by DispatchLeaseManager; 25 §14.1 requires the ' +
        'dispatch-time revalidation to run under a genuinely held Epoch-B lease',
    );
  }
  return underlying;
}

let dispatchLeaseCounter = 0;

/**
 * Acquires and releases DISPATCH leases. Epoch B's manager.
 *
 * It composes the accepted `EntityLeaseManager` rather than reimplementing the advisory-lock
 * discipline: `25 §14.1` requires the SAME key and the same session-scoped lock, and a
 * second acquisition site would be a second lock discipline — the thing `30 §5.2` is
 * emphatic there must not be. What this class adds is the EPOCH, its name and its type.
 *
 * There is deliberately no `acquire()` returning a lease for the caller to release, for the
 * reason the accepted `EntityLeaseManager` gives: "release is explicit" and "release always
 * happens" are different properties and both are required.
 */
export class DispatchLeaseManager {
  readonly #leases: EntityLeaseManager;

  constructor(options: { readonly pool: Pool }) {
    this.#leases = new EntityLeaseManager({ pool: options.pool });
  }

  /**
   * Hold the entity advisory lock for the whole of `fn` — `25 §14.1`'s Epoch B.
   *
   * Blocks until the lock is available. There is no non-blocking variant, for the accepted
   * lease's reason: a caller that could fall through on failure to acquire would proceed on
   * state another holder is mutating.
   */
  async withDispatchLease<T>(
    key: EntityKey,
    fn: (lease: HeldDispatchLease) => Promise<T>,
  ): Promise<T> {
    return this.#leases.withEntityLease(key, async (underlying) => {
      dispatchLeaseCounter += 1;
      const dispatchLeaseId = `dispatch-lease:${String(dispatchLeaseCounter)}`;
      const lease: HeldDispatchLease = {
        epoch: 'B',
        key: underlying.key,
        dispatchLeaseId,
        client: underlying.client,
        assertHeld(k?: EntityKey): void {
          if (!underlying.isHeld()) {
            throw new Error(
              `dispatch lease ${dispatchLeaseId} for ${formatEntityKey(underlying.key)} has ` +
                'been released; 25 §14.1 requires Epoch B to be held continuously across ' +
                'revalidation, claim, adapter invocation and the outcome commit',
            );
          }
          underlying.assertHeld(k);
        },
        isHeld(): boolean {
          return underlying.isHeld();
        },
      };
      UNDERLYING.set(lease, underlying);
      return fn(lease);
    });
  }

  /**
   * Whether the lock for `key` is currently free, tested from a SEPARATE session.
   *
   * The observation `25 §14.1`'s gap property needs: a test asserting "no database session
   * lock is held" must ask the SERVER, not the application. Delegated to the accepted
   * implementation, which releases immediately if it succeeded so an observation never
   * becomes an acquisition.
   */
  async isEntityLockFree(key: EntityKey): Promise<boolean> {
    return this.#leases.isEntityLockFree(key);
  }
}

/**
 * The equality `25 §14.1` requires between the two epochs' keys, as a callable proof.
 *
 * Exported so the assertion lives beside the derivation rather than only inside a test file,
 * and so a future change to either side fails a check that names the requirement.
 */
export function entityKeyEqualityProof(a: EntityKey, b: EntityKey): boolean {
  const [a1, a2] = advisoryLockKey(a);
  const [b1, b2] = advisoryLockKey(b);
  return a1 === b1 && a2 === b2;
}
