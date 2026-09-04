/**
 * Deterministic interleaving control.
 *
 * `36 §2`, verbatim: "§14's 10× load on a few hundred effects per month cannot reproduce
 * serialisable write skew at all — this needs injected delays between SELECT and INSERT,
 * not throughput."
 *
 * The S1A mandate says the same thing more sharply: "Do NOT rely on 'run 100 parallel
 * requests and hope.' Build barriers/latches so the tests deliberately place
 * transactions at the dangerous instruction boundaries."
 *
 * This is that mechanism. Two participants run on their own PostgreSQL backends. Each
 * announces when it reaches a named point and then blocks until the test conductor
 * releases it. The conductor decides the order, so the interleaving under test is the
 * one the test author wrote down — not one the scheduler happened to produce.
 *
 * Nothing here mocks PostgreSQL. The locks, the isolation level, the triggers and the
 * deadlock detector are all real; only the wall-clock spacing between statements is
 * under the test's control.
 */

export type Point = string;

interface Waiter {
  readonly point: Point;
  readonly release: () => void;
}

class Deferred<T> {
  public readonly promise: Promise<T>;
  public resolve!: (value: T) => void;
  public reject!: (reason: unknown) => void;

  public constructor() {
    this.promise = new Promise<T>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }
}

export class Conductor {
  private readonly parked = new Map<string, Waiter>();
  private readonly awaited = new Map<string, Deferred<void>>();
  /** Points that have been released once. Later arrivals pass straight through. */
  private readonly open = new Set<string>();
  private readonly everArrived = new Set<string>();
  private readonly log: string[] = [];
  private failed: unknown = null;

  /** A participant's handle. Passed into the code under test. */
  public participant(name: string): Participant {
    return new Participant(name, this);
  }

  /**
   * Called by a participant when it reaches `point`. Resolves when released.
   *
   * A point that has already been released once is OPEN, and a later arrival passes
   * through without parking. This is what makes the harness compatible with the
   * money path's serialisation retry: an aborted attempt re-enters the same code and
   * would otherwise park at a barrier the conductor has already stepped past and will
   * never step past again. Gating the FIRST attempt is what the interleaving needs; the
   * retry is a consequence of the interleaving, not a second one to orchestrate.
   */
  public async reach(name: string, point: Point): Promise<void> {
    if (this.failed) throw this.failed;
    const key = `${name}:${point}`;
    this.everArrived.add(key);
    const pending = this.awaited.get(key);
    if (pending) {
      this.awaited.delete(key);
      pending.resolve();
    }
    if (this.open.has(key)) {
      this.log.push(`pass ${key}`);
      return;
    }
    this.log.push(`arrive ${key}`);
    const gate = new Deferred<void>();
    this.parked.set(key, { point, release: () => gate.resolve() });
    await gate.promise;
    this.log.push(`resume ${key}`);
  }

  /** Block the conductor until `name` has reached `point`. */
  public async until(name: string, point: Point, timeoutMs = 20_000): Promise<void> {
    const key = `${name}:${point}`;
    if (this.everArrived.has(key)) return;
    const gate = new Deferred<void>();
    this.awaited.set(key, gate);
    const timer = setTimeout(() => {
      gate.reject(
        new Error(
          `timed out after ${String(timeoutMs)}ms waiting for ${key}. ` +
            `Timeline so far:\n  ${this.log.join('\n  ')}`,
        ),
      );
    }, timeoutMs);
    try {
      await gate.promise;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Let `name` continue past `point`, and leave the point open for retries. */
  public release(name: string, point: Point): void {
    const key = `${name}:${point}`;
    this.open.add(key);
    const waiter = this.parked.get(key);
    if (!waiter) {
      if (this.everArrived.has(key)) return; // already passed through
      throw new Error(`${key} has not arrived; call until() first`);
    }
    this.parked.delete(key);
    this.log.push(`release ${key}`);
    waiter.release();
  }

  /** Wait for arrival then immediately release. The common case. */
  public async step(name: string, point: Point, timeoutMs = 20_000): Promise<void> {
    await this.until(name, point, timeoutMs);
    this.release(name, point);
  }

  /** Release a participant that may or may not still be parked, without failing. */
  public releaseIfParked(name: string, point: Point): void {
    const key = `${name}:${point}`;
    this.open.add(key);
    const waiter = this.parked.get(key);
    if (!waiter) return;
    this.parked.delete(key);
    this.log.push(`release ${key}`);
    waiter.release();
  }

  /** Open every named point so nothing can park again. Used before draining a run. */
  public openAll(names: readonly string[], points: readonly Point[]): void {
    for (const name of names) {
      for (const point of points) this.releaseIfParked(name, point);
    }
  }

  /** Abort every parked participant. Used in cleanup so a failure cannot hang the run. */
  public abort(reason: unknown): void {
    this.failed = reason;
    for (const [key, waiter] of this.parked) {
      this.log.push(`abort ${key}`);
      waiter.release();
    }
    this.parked.clear();
    for (const [, gate] of this.awaited) gate.reject(reason);
    this.awaited.clear();
  }

  public timeline(): readonly string[] {
    return [...this.log];
  }
}

export class Participant {
  public constructor(
    public readonly name: string,
    private readonly conductor: Conductor,
  ) {}

  /** Announce arrival at `point` and block until the conductor releases. */
  public async at(point: Point): Promise<void> {
    await this.conductor.reach(this.name, point);
  }
}

/** The instruction boundaries the S1A concurrency tests place transactions at. */
export const POINT = {
  /** Transaction open, snapshot taken, nothing locked. */
  AFTER_BEGIN: 'AFTER_BEGIN',
  /** window_balance has been read WITHOUT a lock. Only the unsafe path passes here. */
  AFTER_UNLOCKED_READ: 'AFTER_UNLOCKED_READ',
  /** SELECT ... FOR UPDATE has returned; the row is held. */
  AFTER_LOCK: 'AFTER_LOCK',
  /** About to issue the money-moving UPDATE. */
  BEFORE_WRITE: 'BEFORE_WRITE',
  /** The UPDATE returned; not yet committed. */
  AFTER_WRITE: 'AFTER_WRITE',
  /** COMMIT returned. */
  AFTER_COMMIT: 'AFTER_COMMIT',
} as const;

/**
 * Run participants concurrently and collect their outcomes without letting one
 * rejection cancel the others — a participant that fails while another is parked would
 * otherwise deadlock the test rather than reporting the failure.
 */
export async function settleAll<T>(
  tasks: readonly (() => Promise<T>)[],
): Promise<readonly PromiseSettledResult<T>[]> {
  return Promise.allSettled(tasks.map((task) => task()));
}

export function rejectionOf(result: PromiseSettledResult<unknown>): unknown {
  return result.status === 'rejected' ? result.reason : null;
}

export function valueOf<T>(result: PromiseSettledResult<T>): T {
  if (result.status === 'rejected') {
    throw result.reason instanceof Error
      ? result.reason
      : new Error(String(result.reason));
  }
  return result.value;
}
