/**
 * The injected clock.
 *
 * `26 §2.0.1` requires `computed_at` to be stamped on the enumeration "for the class's
 * max_age check at C′", and `26 §7`'s C′ row requires the check itself. Both need a
 * reading of *now*, and the S1C mandate requires that reading to be injected:
 *
 *   "Use an injected deterministic clock. No wall-clock sleeps in tests."
 *
 * ---------------------------------------------------------------------------------
 * WHY THIS IS A DEPENDENCY AND NOT A CALL TO `Date.now()`
 *
 * A staleness rule tested by sleeping is a rule tested by hoping the scheduler was
 * punctual. `36 §2`, on the S1A concurrency work, states the general form: "this needs
 * injected delays between SELECT and INSERT, not throughput." The staleness case is the
 * same shape — the interesting instant is chosen by the test, not waited for.
 *
 * And the second reason matters more. `26 §1` Corollary 3: "the request must be built by
 * the ceiling's enforcer, not by its subject." A `computed_at` that any caller could
 * influence would make the max_age check evaluate a figure its subject supplied. The clock
 * is therefore a KERNEL-OWNED dependency of the enumerator and of the C′ boundary, not a
 * parameter either of them accepts per call from an untrusted caller.
 * ---------------------------------------------------------------------------------
 */
export interface Clock {
  now(): Date;
}

/** The production clock. */
export const systemClock: Clock = {
  now(): Date {
    return new Date();
  },
};

/**
 * A test clock whose reading is set explicitly.
 *
 * Exported from `src/` rather than from `tests/` because the enumerator and the C′ boundary
 * both take a `Clock` and a fixture that constructed its own would be free to drift from
 * this contract. There is exactly one `Clock` interface in the tree.
 */
export class FixedClock implements Clock {
  #at: Date;

  constructor(at: Date) {
    this.#at = new Date(at.getTime());
  }

  now(): Date {
    return new Date(this.#at.getTime());
  }

  /** Move the clock. Deterministic; nothing sleeps. */
  set(at: Date): void {
    this.#at = new Date(at.getTime());
  }

  /** Move the clock forward by whole seconds. */
  advanceSeconds(seconds: number): void {
    this.#at = new Date(this.#at.getTime() + seconds * 1000);
  }
}
