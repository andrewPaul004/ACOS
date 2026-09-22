import type { Client } from '../../db/pool.js';
import { fromDb, toDb, type Money } from './money.js';
import type { WindowInstance } from './windowInstance.js';

/**
 * Window-instance materialisation, and the reads the money path needs.
 *
 * `24 §3.1` makes the existence of a row the load-bearing fact — both for
 * `window_balance` (an instance that has no row has no balance) and for
 * `standing_window_exposure` (an instance with no row carries zero forward exposure,
 * "for every instance for which no standing_window_exposure row exists").
 */

export interface WindowDefinition {
  readonly companyId: string;
  readonly windowId: string;
  readonly maxMonetary: Money;
  readonly maxMonetaryUnbounded: boolean;
  readonly maxCount: bigint;
  readonly maxCountUnbounded: boolean;
  readonly maxIrrecoverableUnits: bigint;
  readonly maxIrrecoverableUnbounded: boolean;
}

/**
 * Create the `window_balance` row for an instance if it does not exist, copying the
 * ceilings from the window registry.
 *
 * Idempotent, and deliberately NOT a lock acquisition: it runs before the declared lock
 * order is entered. `ON CONFLICT DO NOTHING` means two concurrent authorisations racing
 * to create the same fresh instance both succeed and then both queue on the same row in
 * step 1 of the lock order, which is where the serialisation belongs.
 */
export async function ensureWindowInstance(
  client: Client,
  companyId: string,
  instance: WindowInstance,
): Promise<void> {
  await client.query(
    `INSERT INTO window_balance (
       company_id, window_id, window_instance_key,
       max_monetary, max_monetary_unbounded,
       max_count, max_count_unbounded,
       max_irrecoverable_units, max_irrecoverable_unbounded)
     SELECT $1, $2, $3,
            w.max_monetary, w.max_monetary_unbounded,
            w.max_count, w.max_count_unbounded,
            w.max_irrecoverable_units, w.max_irrecoverable_unbounded
       FROM window_registry w
      WHERE w.company_id = $1 AND w.window_id = $2
     ON CONFLICT (company_id, window_id, window_instance_key) DO NOTHING`,
    [companyId, instance.windowId, instance.key],
  );
}

export interface BalanceSnapshot {
  readonly companyId: string;
  readonly windowId: string;
  readonly windowInstanceKey: string;
  readonly reservedMonetary: string;
  readonly standingMonetary: string;
  readonly presumedMonetary: string;
  readonly realisedMonetary: string;
  readonly maxMonetary: string;
  readonly maxMonetaryUnbounded: boolean;
  readonly reservedCount: string;
  readonly standingCount: string;
  readonly presumedCount: string;
  readonly realisedCount: string;
  readonly maxCount: string;
  readonly maxCountUnbounded: boolean;
  /**
   * Ledger 3 — `24 §3` K5's three irrecoverable terms, v1.3.5 (MIE-01).
   *
   * Added when `25 §10.1` declared the transitions between them. Read-only here: the
   * movements are `applyIrrecoverableReservation`, `applyIrrecoverablePresumption` and
   * `releaseIrrecoverableReservation` below, each on an already-locked row.
   */
  readonly reservedIrrecoverable: string;
  readonly presumedIrrecoverable: string;
  readonly realisedIrrecoverable: string;
  readonly maxIrrecoverableUnits: string;
  readonly maxIrrecoverableUnbounded: boolean;
}

/**
 * Read a balance without locking. Used by observers and assertions, never by a writer:
 * a writer that reads here and then writes has skipped step 1 of the lock order, which
 * is precisely the shape the negative control reproduces.
 */
export async function readBalance(
  client: Client,
  companyId: string,
  windowId: string,
  windowInstanceKey: string,
): Promise<BalanceSnapshot | null> {
  const result = await client.query<Record<string, string | boolean>>(
    `SELECT company_id, window_id, window_instance_key,
            reserved_monetary, standing_monetary, presumed_monetary, realised_monetary,
            max_monetary, max_monetary_unbounded,
            reserved_count, standing_count, presumed_count, realised_count,
            max_count, max_count_unbounded,
            reserved_irrecoverable, presumed_irrecoverable, realised_irrecoverable,
            max_irrecoverable_units, max_irrecoverable_unbounded
       FROM window_balance
      WHERE company_id = $1 AND window_id = $2 AND window_instance_key = $3`,
    [companyId, windowId, windowInstanceKey],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    companyId: row['company_id'] as string,
    windowId: row['window_id'] as string,
    windowInstanceKey: row['window_instance_key'] as string,
    reservedMonetary: row['reserved_monetary'] as string,
    standingMonetary: row['standing_monetary'] as string,
    presumedMonetary: row['presumed_monetary'] as string,
    realisedMonetary: row['realised_monetary'] as string,
    maxMonetary: row['max_monetary'] as string,
    maxMonetaryUnbounded: row['max_monetary_unbounded'] as boolean,
    reservedCount: row['reserved_count'] as string,
    standingCount: row['standing_count'] as string,
    presumedCount: row['presumed_count'] as string,
    realisedCount: row['realised_count'] as string,
    maxCount: row['max_count'] as string,
    maxCountUnbounded: row['max_count_unbounded'] as boolean,
    reservedIrrecoverable: String(row['reserved_irrecoverable']),
    presumedIrrecoverable: String(row['presumed_irrecoverable']),
    realisedIrrecoverable: String(row['realised_irrecoverable']),
    maxIrrecoverableUnits: String(row['max_irrecoverable_units']),
    maxIrrecoverableUnbounded: row['max_irrecoverable_unbounded'] as boolean,
  };
}

/**
 * Move `reserved_monetary` and `reserved_count` on one already-locked balance row.
 *
 * The caller MUST hold the row through acquireMoneyPathLocks. This function does not
 * lock, because a second acquisition site is exactly what the single-lock-order rule
 * forbids. The commitment guard fires on this UPDATE; the caller translates it.
 */
export async function applyReservation(
  client: Client,
  companyId: string,
  windowId: string,
  windowInstanceKey: string,
  monetaryDelta: Money,
  countDelta: bigint,
): Promise<void> {
  await client.query(
    `UPDATE window_balance
        SET reserved_monetary = reserved_monetary + $4::NUMERIC,
            reserved_count    = reserved_count + $5::BIGINT
      WHERE company_id = $1 AND window_id = $2 AND window_instance_key = $3`,
    [companyId, windowId, windowInstanceKey, toDb(monetaryDelta), countDelta.toString()],
  );
}

/** Move `presumed_monetary` on one already-locked balance row. I3's term 3. */
export async function applyPresumed(
  client: Client,
  companyId: string,
  windowId: string,
  windowInstanceKey: string,
  monetaryDelta: Money,
): Promise<void> {
  await client.query(
    `UPDATE window_balance
        SET presumed_monetary = presumed_monetary + $4::NUMERIC
      WHERE company_id = $1 AND window_id = $2 AND window_instance_key = $3`,
    [companyId, windowId, windowInstanceKey, toDb(monetaryDelta)],
  );
}

/**
 * Move `realised_monetary` directly on one already-locked balance row, for realised
 * spend that is NOT attributable to a standing authorisation.
 *
 * `24 §3` K5: "An update that increases only realised passes the guard unconditionally,
 * even where the resulting four-term sum exceeds max_monetary." This function is how
 * that path is exercised for a non-standing observation; standing-attributable spend
 * goes through recordRealisedSpend(), which must move both terms at once.
 */
export async function applyRealised(
  client: Client,
  companyId: string,
  windowId: string,
  windowInstanceKey: string,
  monetaryDelta: Money,
): Promise<void> {
  await client.query(
    `UPDATE window_balance
        SET realised_monetary = realised_monetary + $4::NUMERIC
      WHERE company_id = $1 AND window_id = $2 AND window_instance_key = $3`,
    [companyId, windowId, windowInstanceKey, toDb(monetaryDelta)],
  );
}
/**
 * =====================================================================================
 * LEDGER 3 — THE IRRECOVERABLE UNITS. `24 §3` K5's transitions, v1.3.5 (MIE-01).
 *
 * `24 §3` K5 printed this ledger's three terms and NO TRANSITION between them until
 * v1.3.5. The declared movements, verbatim from its table:
 *
 *   | RESERVE, at local authorisation (`26 §7` step R) | `reserved += units`            | rises     |
 *   | PRESUME, at `PRESUMED_EXECUTED`                  | `reserved -= units`, `presumed += units` | UNCHANGED |
 *   | REALISE, at provider-evidenced `VERIFIED`        | `presumed -= units`, `realised += units` | unchanged |
 *   | RELEASE, at `DISPATCH_NOT_SENT_CONFIRMED`        | `reserved -= units`            | falls     |
 *   | RELEASE, at provider-proven `NEVER_SENT`         | `presumed -= units`            | falls     |
 *
 * THREE OF THE FIVE ARE IMPLEMENTED HERE. The two REALISE/never-sent rows are reached
 * only from independent provider evidence (`25 §10.1`: "declared so the lifecycle is
 * complete and are reached only from provider evidence"), and there is no provider, so
 * they have no function in `src/` and adding one would be a path with no reachable
 * caller sitting on the money path.
 *
 * EACH IS ONE `UPDATE` STATEMENT, AND THE PRESUME ROW ESPECIALLY.
 *
 * `25 §10.1`: "**no transaction may expose transient headroom to another transaction
 * while the movement is in flight.**" Two statements — a decrement then an increment —
 * would leave an instant in which the three-term sum is one unit lower, and `24 §3` K5's
 * guard evaluates per statement, so a concurrent commitment arriving between them would
 * pass a guard it should have failed. One statement moves both terms, so the sum the
 * guard reads is never the intermediate one, and
 * `tests/negative-controls/unsafe-two-transaction-mie-movement.ts` is the discriminating
 * control for the split version.
 * =====================================================================================
 */

/**
 * RESERVE — `reserved_irrecoverable += units` on one already-locked balance row.
 *
 * The caller MUST hold the row through `acquireMoneyPathLocks`. This function does not
 * lock, for the reason `applyReservation` gives: a second acquisition site is exactly what
 * the single-lock-order rule forbids. `24 §3` K5's guard fires on this UPDATE and the
 * caller translates it — a window at its `max_irrecoverable_units` raises
 * `I3_WINDOW_EXHAUSTED` and the whole step-R transaction is denied.
 */
export async function applyIrrecoverableReservation(
  client: Client,
  companyId: string,
  windowId: string,
  windowInstanceKey: string,
  units: bigint,
): Promise<void> {
  if (units === 0n) return;
  await client.query(
    `UPDATE window_balance
        SET reserved_irrecoverable = reserved_irrecoverable + $4::BIGINT
      WHERE company_id = $1 AND window_id = $2 AND window_instance_key = $3`,
    [companyId, windowId, windowInstanceKey, units.toString()],
  );
}

/**
 * PRESUME — `reserved -= units`, `presumed += units`, IN ONE STATEMENT.
 *
 * `25 §10.1`: "**`consume the irrecoverable unit` IS THE PRESUME ROW, AND NOTHING ELSE.**
 * It is `reserved → presumed` for every bound window instance, performed **exactly once**
 * per outbox identity [...] **The sum of the three terms does not fall, so an unknown
 * outcome creates no headroom.**"
 *
 * ONE `UPDATE`, FOR THE REASON THE HEADER GIVES. The exactly-once property is NOT this
 * function's — it comes from `effect_dispatch_outcome`'s primary key on
 * `(company_id, idempotency_key)` and the outbox row lock the outcome transaction takes,
 * so a second call for the same outbox identity never reaches this line.
 *
 * THE GUARD DOES NOT FIRE ON A CORRECT PRESUME, AND THAT IS ARITHMETIC RATHER THAN LUCK.
 * `24 §3` K5's irrecoverable clause is `(NEW.reserved > OLD.reserved OR NEW.presumed >
 * OLD.presumed) AND sum > ceiling`. `presumed` DOES rise here, so the first conjunct holds
 * — and the sum is unchanged, so if the row was within its ceiling before the movement it
 * is within it after. A window at exactly its ceiling presumes successfully, which is
 * correct: the commitment was already authorised and no new commitment is being made.
 */
export async function applyIrrecoverablePresumption(
  client: Client,
  companyId: string,
  windowId: string,
  windowInstanceKey: string,
  units: bigint,
): Promise<void> {
  if (units === 0n) return;
  await client.query(
    `UPDATE window_balance
        SET reserved_irrecoverable = reserved_irrecoverable - $4::BIGINT,
            presumed_irrecoverable = presumed_irrecoverable + $4::BIGINT
      WHERE company_id = $1 AND window_id = $2 AND window_instance_key = $3`,
    [companyId, windowId, windowInstanceKey, units.toString()],
  );
}

/**
 * RELEASE, confirmed-not-sent — `reserved_irrecoverable -= units`.
 *
 * `25 §7.2`: "For IRRECOVERABLE, `reserved_irrecoverable -= units`, **with no presumed and
 * no realised increment**. **No presumed unit is touched**, because `NOT_SENT_CONFIRMED`
 * is admissible only before an uncertain or executed classification has been reached."
 *
 * The sum FALLS, and that is correct precisely because a trusted adapter has established
 * the effect did not happen. `0002`'s `window_balance_irrecoverable_non_negative` CHECK is
 * what makes a release of a unit that was never reserved a database error rather than a
 * negative counter: it refuses `reserved_irrecoverable < 0`.
 */
export async function releaseIrrecoverableReservation(
  client: Client,
  companyId: string,
  windowId: string,
  windowInstanceKey: string,
  units: bigint,
): Promise<void> {
  if (units === 0n) return;
  await client.query(
    `UPDATE window_balance
        SET reserved_irrecoverable = reserved_irrecoverable - $4::BIGINT
      WHERE company_id = $1 AND window_id = $2 AND window_instance_key = $3`,
    [companyId, windowId, windowInstanceKey, units.toString()],
  );
}

/**
 * RELEASE, money — `reserved_monetary -= amount`, `reserved_count -= countUnits`.
 *
 * =================================================================================
 * `25 §7.2` SAYS "UNDER THE EXISTING RESERVATION-RELEASE SEMANTICS", AND NO ACCEPTED
 * SLICE HAD ANY. THAT IS AN IMPLEMENTATION GAP, NOT AN ARCHITECTURE ONE.
 *
 * `26 §7` load-bearing property 8 names a release — "a duplicate proposal returns the
 * prior result AND THE RESERVATION IS RELEASED rather than double-counted" — and the
 * accepted S1F implements it by rolling back to a SAVEPOINT, which releases by never
 * having committed. There is no committed-then-released path anywhere in `src/`, so this
 * function is the first, and `docs/implementation/S1J-owner-clarifications.md` records it
 * as an implementation decision rather than as a reading of the architecture.
 *
 * WHAT MAKES IT MINIMAL. It moves the SAME two terms step R moved, by the SAME amounts,
 * on the SAME bound window instances, read from the immutable
 * `reservation_window_instance` rows step R wrote. It invents no term, touches no
 * `presumed` and no `realised`, and creates no new ledger. The reservation row is stamped
 * `released_at`/`released_reason` in the same transaction so the release is evidenced and
 * `I3` term 1 stays reconstructable as the sum over UNRELEASED reservations.
 *
 * A DECREASE NEVER TRIPS THE GUARD. `24 §3` K5's predicate fires only where a term
 * INCREASES, so a release passes unconditionally — which is right: releasing headroom is
 * never a new commitment. `0002`'s non-negativity CHECK still refuses a release larger
 * than what is held.
 * =================================================================================
 */
export async function releaseMonetaryReservation(
  client: Client,
  companyId: string,
  windowId: string,
  windowInstanceKey: string,
  monetaryAmount: Money,
  countUnits: bigint,
): Promise<void> {
  await client.query(
    `UPDATE window_balance
        SET reserved_monetary = reserved_monetary - $4::NUMERIC,
            reserved_count    = reserved_count - $5::BIGINT
      WHERE company_id = $1 AND window_id = $2 AND window_instance_key = $3`,
    [companyId, windowId, windowInstanceKey, toDb(monetaryAmount), countUnits.toString()],
  );
}

/**
 * The window instances one authorisation's reservation is bound to, WITH ITS UNITS.
 *
 * `25 §10.1`: the movement is performed "against **every** applicable MIE window instance
 * the matching grants reference — not the first, not a primary, not the most permissive."
 * THIS QUERY IS THAT SET, and it is read from the immutable rows step R committed rather
 * than recomputed from grants at the outcome instant: a grant edited during the
 * asynchronous gap must not change which windows a committed reservation is released from
 * or presumed against.
 *
 * Ordered by `(window_id, window_instance_key)` — the declared total order
 * `lockOrder.declaredOrder` imposes — so a caller that locks in the returned order locks
 * in the declared order.
 */
export interface BoundReservationWindow {
  readonly reservationId: string;
  readonly windowId: string;
  readonly windowInstanceKey: string;
  readonly amount: Money;
  readonly irrecoverableUnits: bigint;
}

export async function readBoundReservationWindows(
  client: Client,
  companyId: string,
  authorisationId: string,
): Promise<readonly BoundReservationWindow[]> {
  const result = await client.query<{
    reservation_id: string;
    window_id: string;
    window_instance_key: string;
    amount: string;
    irrecoverable_units: string;
  }>(
    `SELECT rwi.reservation_id, rwi.window_id, rwi.window_instance_key,
            rwi.amount::TEXT AS amount,
            rwi.irrecoverable_units::TEXT AS irrecoverable_units
       FROM reservation_window_instance rwi
       JOIN exposure_reservation r ON r.reservation_id = rwi.reservation_id
      WHERE rwi.company_id = $1 AND r.authorisation_id = $2
      ORDER BY rwi.window_id, rwi.window_instance_key`,
    [companyId, authorisationId],
  );
  return result.rows.map((row) => ({
    reservationId: row.reservation_id,
    windowId: row.window_id,
    windowInstanceKey: row.window_instance_key,
    amount: fromDb(row.amount),
    irrecoverableUnits: BigInt(row.irrecoverable_units),
  }));
}
