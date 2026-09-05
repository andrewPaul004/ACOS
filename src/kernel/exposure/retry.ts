import { inTransaction, type Client, type IsolationLevel } from '../../db/pool.js';
import { SQLSTATE, hasSqlstate } from './errors.js';

/**
 * Bounded retry on serialisation failure — and ONLY on serialisation failure.
 *
 * `40001` is retryable. `40P01` is not, and propagates immediately. See `isRetryable`
 * below for why, and docs/implementation/S1A-implementation-log.md §17 (S1A-H2) for the
 * owner review finding that separated them.
 *
 * WHY THIS EXISTS — an empirical S1A finding, recorded in
 * docs/implementation/S1A-implementation-log.md §8.
 *
 * Registry §1.2 I3 declares the money path's enforcement as the `window_balance` row
 * "taken SELECT … FOR UPDATE inside the authorising transaction [...] + TX at
 * serialisable". Measured against real PostgreSQL, those two clauses together do NOT
 * produce a queue: at `SERIALIZABLE` (and at `REPEATABLE READ`), a `SELECT … FOR UPDATE`
 * that reaches a row a concurrent transaction has already updated and committed raises
 * `40001 could not serialize access due to concurrent update` rather than re-reading the
 * new version. Under N-way contention on one window instance, most transactions abort.
 *
 * That is FAIL-CLOSED and it is safe — an aborted transaction commits nothing, takes no
 * headroom and, because `journal_counter` is a row rather than a PostgreSQL sequence,
 * leaves no gap (`30 §5.2`). It is not a defect in the lock order: the property the lock
 * order claims is the absence of DEADLOCK, and that holds. But it does mean the
 * architecture's declared enforcement is only usable behind a retry, and the retry is
 * ACOS-owned.
 *
 * The architecture already anticipates exactly this and says so in the one place where
 * it would otherwise be dangerous — registry §1.1 `I42`, verbatim:
 *
 *   "v1.2: assert journal_seq is not an input to the key, so a serialisation-failure
 *    retry regenerates the same key (SR-A4)."
 *
 * A retry is therefore a declared part of the design, not an accommodation invented
 * here. What S1A adds is the measurement that it is REQUIRED rather than optional, and
 * the bound on it.
 *
 * The idempotency key must be computed BEFORE this function is called and passed into
 * the work, unchanged across attempts — `30 §5.2`: "The key is a deterministic function
 * of (task_id, action_class, resource_id, semantic_parameter_digest), computed before
 * the transaction that allocates the sequence."
 */

export interface RetryOptions {
  readonly isolation?: IsolationLevel;
  readonly maxAttempts?: number;
  /** Base backoff in milliseconds; attempt k waits `base × k` plus jitter. */
  readonly baseDelayMs?: number;
}

export interface RetryOutcome<T> {
  readonly value: T;
  /** Serialisation failures absorbed before success. Reported so contention is visible. */
  readonly retries: number;
}

export class SerialisationRetriesExhausted extends Error {
  public readonly attempts: number;
  public override readonly cause: unknown;

  public constructor(attempts: number, cause: unknown) {
    super(`money-path transaction still serialising after ${String(attempts)} attempts`);
    this.name = 'SerialisationRetriesExhausted';
    this.attempts = attempts;
    this.cause = cause;
  }
}

/**
 * EXACTLY ONE SQLSTATE IS RETRYABLE ON THE MONEY PATH — `40001`.
 *
 * S1A-H2, an owner review finding. The two SQLSTATEs are not two flavours of the same
 * event and must not be handled alike:
 *
 *   40001 SERIALIZATION_FAILURE — EXPECTED. At `SERIALIZABLE` a `SELECT … FOR UPDATE`
 *     reaching a row a concurrent transaction already committed raises this rather than
 *     re-reading it (log §8). It is ordinary contention on a correctly ordered path, the
 *     architecture anticipates the retry (registry §1.1 `I42`/SR-A4), and it is retried
 *     here within the bounded policy.
 *
 *   40P01 DEADLOCK_DETECTED — AN INVARIANT DEFECT. The declared money-path lock order
 *     (`30 §5.2`, `24 §3` K5, implemented once in lockOrder.ts) claims deadlock freedom.
 *     A `40P01` reaching this helper therefore means one of exactly two things: the
 *     declared order has failed, or a lock-taking path exists that never declared itself.
 *     Both are implementation defects on the money path, and neither is a condition to
 *     wait out. It PROPAGATES IMMEDIATELY, unretried, uncaught and unconverted.
 *
 * A retried deadlock is worse than a failed transaction: it would usually succeed on the
 * second attempt and so would erase the only signal that the ordering claim the whole
 * deadlock proof rests on is no longer true.
 *
 * What ACOS does with the propagated `40P01` in production — escalation, quarantine,
 * pass revocation — is deliberately NOT decided here. The required S1A behaviour is to
 * fail immediately; the escalation system belongs to the next S1 increment.
 */
function isRetryable(error: unknown): boolean {
  // `40P01` is named here so its exclusion is a decision in the code rather than an
  // omission a later edit could "fix" by adding it back.
  if (hasSqlstate(error, SQLSTATE.DEADLOCK_DETECTED)) return false;
  return hasSqlstate(error, SQLSTATE.SERIALIZATION_FAILURE);
}

export async function withSerialisationRetry<T>(
  client: Client,
  work: (tx: Client) => Promise<T>,
  options: RetryOptions = {},
): Promise<RetryOutcome<T>> {
  const isolation = options.isolation ?? 'SERIALIZABLE';
  const maxAttempts = options.maxAttempts ?? 10;
  const baseDelayMs = options.baseDelayMs ?? 5;

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const value = await inTransaction(client, isolation, work);
      return { value, retries: attempt - 1 };
    } catch (error) {
      if (!isRetryable(error)) throw error;
      lastError = error;
      if (attempt === maxAttempts) break;
      const jitter = Math.floor(Math.random() * baseDelayMs);
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * attempt + jitter));
    }
  }
  throw new SerialisationRetriesExhausted(maxAttempts, lastError);
}
