import { createHash } from 'node:crypto';

import type { Client, Pool } from '../../db/pool.js';

/**
 * The entity execution lease — `25 §14`'s advisory lock, with its LIFETIME made explicit.
 *
 * `25 §14`, verbatim, and it is the whole specification of this file:
 *
 *   | Two work items touching the same entity | Advisory lock on
 *   | `(company_id, entity_type, entity_id)` **for the duration of the
 *   | propose→authorise→execute span.** Second item waits or defers; it does not proceed
 *   | on stale state. |
 *
 * ---------------------------------------------------------------------------------
 * WHY A SESSION LOCK AND NOT `pg_advisory_xact_lock`
 *
 * The S1C mandate is explicit about the shape it will not accept:
 *
 *   "Do NOT implement a helper that: acquires the advisory lock; re-enumerates; releases it
 *    immediately; returns a canonical request; and then claim the complete concurrency
 *    property."
 *
 * A transaction-scoped advisory lock is exactly that helper wearing a different name. It is
 * released by `COMMIT`, so it is STRUCTURALLY INCAPABLE of spanning propose→authorise→
 * execute: `26 §7` puts step S (approval) and step W (dispatch) after step C′, and step S
 * may wait on a human for hours. A lock that cannot outlive one transaction cannot hold
 * that span, and a component that took one and claimed the span would be asserting a
 * property its own mechanism forbids.
 *
 * So the lease is a SESSION-level advisory lock on a dedicated connection:
 *
 *   acquire   pg_advisory_lock(k1, k2)      on a client checked out for the lease's life
 *   hold      across an arbitrary number of transactions on that client
 *   release   pg_advisory_unlock(k1, k2)    explicit, in a finally
 *
 * That is the shape the future gateway needs, and it is the reason `withEntityLease` hands
 * the caller the lease's OWN client: downstream work must run on the connection that holds
 * the lock, not on an unrelated one from the pool.
 *
 * ---------------------------------------------------------------------------------
 * WHAT S1C PROVES WITH IT, AND WHAT IT DOES NOT
 *
 * PROVEN: C′ re-enumeration occurs while the lock is held; a second session cannot take the
 * same lock until release; the lease survives a transaction boundary and a fake downstream
 * callback standing in for later policy/dispatch; release is explicit and a released lease
 * is inert.
 *
 * NOT PROVEN: the finished propose→authorise→execute span, because steps M, R, S and W do
 * not exist in S1C. `S1C-result.md` says so in those words and does not claim VC-C3's lock
 * clause is fully closed.
 *
 * NO POLICY RUNS INSIDE THE CALLBACK. The mandate: "For S1C tests, a fake downstream
 * callback may stand in for later policy/dispatch solely to demonstrate lock lifetime. Do
 * NOT implement policy inside that callback."
 * ---------------------------------------------------------------------------------
 */

/** `25 §14`'s lock key, verbatim: `(company_id, entity_type, entity_id)`. */
export interface EntityKey {
  readonly companyId: string;
  readonly entityType: string;
  readonly entityId: string;
}

export function entityKeyEquals(a: EntityKey, b: EntityKey): boolean {
  return (
    a.companyId === b.companyId && a.entityType === b.entityType && a.entityId === b.entityId
  );
}

export function formatEntityKey(key: EntityKey): string {
  return `${key.companyId}/${key.entityType}/${key.entityId}`;
}

/**
 * The two 32-bit integers PostgreSQL's two-argument advisory-lock functions take.
 *
 * Derived from a SHA-256 over the three key components with 4-byte big-endian length
 * framing — the same framing discipline `canonicalBytes.ts` applies — so that
 * `('co', 'order', 'X')` and `('co', 'orderX', '')` cannot collide by concatenation. Both
 * halves are read as SIGNED 32-bit, because that is the type `pg_advisory_lock(int, int)`
 * declares; taking them unsigned and letting the driver coerce is how a key silently
 * becomes a different key on one of the two sides.
 *
 * A 64-bit space is not collision-free, and this does not pretend otherwise. A collision
 * costs mutual exclusion between two unrelated entities — availability, never correctness —
 * and the alternative, a lock table with its own rows and its own lock order, is a second
 * money-path lock ordering that `30 §5.2` is emphatic there must not be.
 */
export function advisoryLockKey(key: EntityKey): readonly [number, number] {
  const hash = createHash('sha256');
  for (const part of [key.companyId, key.entityType, key.entityId]) {
    const bytes = Buffer.from(part.normalize('NFC'), 'utf8');
    const length = Buffer.allocUnsafe(4);
    length.writeUInt32BE(bytes.byteLength, 0);
    hash.update(length);
    hash.update(bytes);
  }
  const digest = hash.digest();
  return [digest.readInt32BE(0), digest.readInt32BE(4)];
}

/**
 * A lease that is currently HELD.
 *
 * Every operation that `25 §14` requires to happen under the lock takes one of these as an
 * argument and calls `assertHeld()`. That is what makes "under the lock" a property of the
 * type rather than a property of the call site's ordering: the live C′ boundary cannot be
 * invoked without a lease, and a lease that has been released throws.
 */
export interface HeldEntityLease {
  readonly key: EntityKey;
  /** A stable id for this acquisition, so audit and tests can name the span. */
  readonly leaseId: string;
  /** The connection holding the session lock. Downstream work must run on THIS client. */
  readonly client: Client;
  /** Throws if the lease has been released, or if it does not cover `key`. */
  assertHeld(key?: EntityKey): void;
  /** Whether the lease is still held. For assertions; the guard is `assertHeld`. */
  isHeld(): boolean;
}

class Lease implements HeldEntityLease {
  readonly key: EntityKey;
  readonly leaseId: string;
  readonly client: Client;
  #held = true;

  constructor(key: EntityKey, leaseId: string, client: Client) {
    this.key = key;
    this.leaseId = leaseId;
    this.client = client;
  }

  assertHeld(key?: EntityKey): void {
    if (!this.#held) {
      throw new Error(
        `entity execution lease ${this.leaseId} for ${formatEntityKey(this.key)} has been released; ` +
          `25 §14 requires the advisory lock to be held for the duration of the ` +
          `propose→authorise→execute span`,
      );
    }
    if (key !== undefined && !entityKeyEquals(this.key, key)) {
      // A lease for a DIFFERENT entity is not a lease for this one. Without this check a
      // caller holding any lock at all could satisfy every `assertHeld` in the tree, and the
      // type would record a habit rather than a property.
      throw new Error(
        `entity execution lease ${this.leaseId} covers ${formatEntityKey(this.key)}, ` +
          `not ${formatEntityKey(key)}`,
      );
    }
  }

  isHeld(): boolean {
    return this.#held;
  }

  markReleased(): void {
    this.#held = false;
  }
}

let leaseCounter = 0;

export interface EntityLeaseManagerOptions {
  readonly pool: Pool;
}

/**
 * Acquires and releases entity execution leases.
 *
 * There is deliberately no `acquire()` returning a lease for the caller to release. The
 * only way to hold one is `withEntityLease`, whose `finally` releases it, because "release
 * is explicit" and "release always happens" are different properties and the mandate asks
 * for both.
 */
export class EntityLeaseManager {
  readonly #pool: Pool;

  constructor(options: EntityLeaseManagerOptions) {
    this.#pool = options.pool;
  }

  /**
   * Hold the `(company_id, entity_type, entity_id)` advisory lock for the whole of `fn`.
   *
   * Blocks until the lock is available — `25 §14`: "Second item waits or defers; it does not
   * proceed on stale state." There is no non-blocking variant on this class: a caller that
   * could fall through on failure to acquire would proceed on state another holder is
   * mutating, which is the condition the lock exists to prevent.
   */
  async withEntityLease<T>(
    key: EntityKey,
    fn: (lease: HeldEntityLease) => Promise<T>,
  ): Promise<T> {
    const [k1, k2] = advisoryLockKey(key);
    const client = await this.#pool.connect();
    leaseCounter += 1;
    const lease = new Lease(key, `lease:${String(leaseCounter)}`, client);
    let acquired = false;
    try {
      await client.query('SELECT pg_advisory_lock($1::int, $2::int)', [k1, k2]);
      acquired = true;
      return await fn(lease);
    } finally {
      lease.markReleased();
      if (acquired) {
        try {
          // Explicit release. Session locks are NOT released by COMMIT — that is the whole
          // reason this is a session lock — so nothing else will do it.
          await client.query('SELECT pg_advisory_unlock($1::int, $2::int)', [k1, k2]);
        } catch {
          // The connection is already broken, which releases the session lock anyway. The
          // original error, if there was one, is the one worth propagating.
        }
      }
      client.release();
    }
  }

  /**
   * Whether the lock for `key` is currently free, tested from a SEPARATE session.
   *
   * `pg_try_advisory_lock` is non-blocking, so this observes without waiting. It releases
   * immediately if it succeeded, so an observation never becomes an acquisition — the check
   * must not perturb what it measures.
   *
   * This is the mechanism the lease tests use to prove the lock is genuinely held during
   * re-enumeration, and genuinely free after release. Both directions matter: a test that
   * only asserted "held" could pass against an implementation that never releases.
   */
  async isEntityLockFree(key: EntityKey): Promise<boolean> {
    const [k1, k2] = advisoryLockKey(key);
    const client = await this.#pool.connect();
    try {
      const result = await client.query<{ taken: boolean }>(
        'SELECT pg_try_advisory_lock($1::int, $2::int) AS taken',
        [k1, k2],
      );
      const taken = result.rows[0]?.taken === true;
      if (taken) {
        await client.query('SELECT pg_advisory_unlock($1::int, $2::int)', [k1, k2]);
      }
      return taken;
    } finally {
      client.release();
    }
  }
}
