import { describe, expect, it } from 'vitest';

import {
  MIRROR_STATES,
  signalMaxAgeMs,
  isCorroborationFresh,
  resolveMirrorState,
  type HeldCorroboration,
  type MirrorState,
} from '../../src/kernel/mirror/mirrorState.js';
import { ATTESTATION_STALL_BOUND_MS } from '../../src/audit/transportCompleteness.js';

/**
 * `30 §5.6` — THE THREE-STATE MACHINE, EVERY LEGAL AND ILLEGAL TRANSITION.
 *
 * The expected states below are written out from `30 §5.6`'s "Entered when" column by hand.
 * Nothing in this file reads a production transition table, and `resolveMirrorState` is
 * called only to be COMPARED against a literal.
 */

const COMPANY = 'co_s1h';
const T0 = new Date('2026-03-01T12:00:00.000Z');

function held(observedAt: Date, options?: { companyId?: string; signalId?: string }): HeldCorroboration {
  return {
    signalId: options?.signalId ?? 'signal:1',
    companyId: options?.companyId ?? COMPANY,
    observedAt,
    expiresAt: new Date(observedAt.getTime() + signalMaxAgeMs()),
    intervalStart: new Date(observedAt.getTime() - 60_000),
    reason: 'ATTESTATION_STALL',
  };
}

function resolve(
  declarationOpen: boolean,
  corroboration: HeldCorroboration | null,
  now: Date,
): MirrorState {
  return resolveMirrorState({
    companyId: COMPANY,
    declarationOpen,
    heldCorroboration: corroboration,
    now,
  }).state;
}

describe('`30 §5.6` declares exactly three states and no convenience fourth', () => {
  it('the three, by their architecture names', () => {
    // `30 §5.6`'s table rows, in its own order. A fourth state would be a state the
    // architecture's precedence table (`22 §3.1`) has no column for.
    expect([...MIRROR_STATES]).toEqual([
      'NORMAL',
      'UNCORROBORATED_STALL',
      'CORROBORATED_DEGRADED',
    ]);
  });

  it('`max_age` is 5 minutes and STRICTLY LESS than `cadence × k`, as `§5.7.1` requires', () => {
    // `30 §5.7.1`: "**5 minutes** = `attestation_cadence × 1`, `CONFIGURED`. **Strictly less
    // than `attestation_cadence × k` = 15 minutes, as required**, and equal to the
    // re-issuance interval so a control plane in a live corroborated stall always holds a
    // valid one."
    //
    // Asserted as ARITHMETIC over the two constants rather than as two literals, so a future
    // edit to either cannot silently break the declared relationship. The 15-minute figure
    // comes from the AUDIT side's own transcription of `30 §5.4`, which is a second reading.
    expect(signalMaxAgeMs()).toBe(5 * 60 * 1000);
    expect(ATTESTATION_STALL_BOUND_MS).toBe(15 * 60 * 1000);
    expect(signalMaxAgeMs()).toBeLessThan(ATTESTATION_STALL_BOUND_MS);
  });
});

describe('every LEGAL transition of `30 §5.6`', () => {
  it('NORMAL — no declaration open, whatever else is true', () => {
    // "`NORMAL` | Mirror acknowledging within threshold".
    expect(resolve(false, null, T0)).toBe('NORMAL');
    expect(resolve(false, held(T0), T0)).toBe('NORMAL');
    expect(resolve(false, held(new Date(T0.getTime() - 60 * 60 * 1000)), T0)).toBe('NORMAL');
  });

  it('NORMAL → UNCORROBORATED_STALL — a declaration and no valid signal', () => {
    // "`UNCORROBORATED_STALL` | Control plane observes the mirror unreachable; **no valid,
    // unexpired `MirrorInputStallSignal` is held**".
    expect(resolve(true, null, T0)).toBe('UNCORROBORATED_STALL');
  });

  it('UNCORROBORATED_STALL → CORROBORATED_DEGRADED — a valid unexpired signal', () => {
    // "`CORROBORATED_DEGRADED` | The control plane holds a **valid, signed, unexpired
    // `MirrorInputStallSignal`** issued by the audit plane".
    expect(resolve(true, held(T0), T0)).toBe('CORROBORATED_DEGRADED');
  });

  it('CORROBORATED_DEGRADED → UNCORROBORATED_STALL — the signal ages out', () => {
    // `30 §5.7.1`: "A signal failing either test **cannot enter the state machine**; the
    // state remains **or reverts to** `UNCORROBORATED_STALL`." And: "Extending it by holding
    // it is bounded by `max_age`, **evaluated at every state evaluation and not only at
    // entry**."
    const signal = held(T0);
    expect(resolve(true, signal, T0)).toBe('CORROBORATED_DEGRADED');
    const later = new Date(T0.getTime() + signalMaxAgeMs() + 1);
    expect(resolve(true, signal, later)).toBe('UNCORROBORATED_STALL');
  });

  it('CORROBORATED_DEGRADED → NORMAL — the declaration closes while the signal is live', () => {
    // `§11`'s recovery case: "control declaration closes while current audit signal
    // remains." `NORMAL`'s condition does not mention the signal, so the state is `NORMAL`
    // and the still-held signal is reported as an anomaly rather than silently ignored.
    const signal = held(T0);
    const resolution = resolveMirrorState({
      companyId: COMPANY,
      declarationOpen: false,
      heldCorroboration: signal,
      now: T0,
    });
    expect(resolution.state).toBe('NORMAL');
    expect(resolution.anomalies).toContain('SIGNAL_HELD_WITHOUT_DECLARATION');
  });

  it('UNCORROBORATED_STALL → NORMAL — both conditions recover', () => {
    expect(resolve(true, null, T0)).toBe('UNCORROBORATED_STALL');
    expect(resolve(false, null, T0)).toBe('NORMAL');
  });
});

describe('every ILLEGAL transition — what the resolver refuses to produce', () => {
  it('a declaration ALONE never reaches CORROBORATED_DEGRADED — THE INVERSION', () => {
    // `30 §5.6`: "**The uncorroborated state is stricter than normal operation, not
    // looser.** A control plane that unilaterally declares a problem thereby **loses** the
    // relaxation it was declaring in order to obtain."
    //
    // Asserted 200 times over a repeated declaration, because `§5` of the mandate's attack is
    // "a compromised control-side caller repeatedly declares mirror failure while the audit
    // plane is healthy". Repetition is a no-op; there is no accumulation path.
    for (let i = 0; i < 200; i += 1) {
      const at = new Date(T0.getTime() + i * 1000);
      expect(resolve(true, null, at)).toBe('UNCORROBORATED_STALL');
    }
  });

  it('a signal for ANOTHER company never reaches CORROBORATED_DEGRADED', () => {
    const foreign = held(T0, { companyId: 'co_someone_else' });
    expect(resolve(true, foreign, T0)).toBe('UNCORROBORATED_STALL');
  });

  it('a STALE signal never reaches CORROBORATED_DEGRADED', () => {
    const stale = held(new Date(T0.getTime() - signalMaxAgeMs() - 1));
    expect(resolve(true, stale, T0)).toBe('UNCORROBORATED_STALL');
  });

  it('a FUTURE-DATED signal never reaches CORROBORATED_DEGRADED — `S1H-C6`', () => {
    // An ADDITION to `30 §5.7.1`'s conjunction, and it is strictly stricter than it: the
    // declared rule admits a future-dated signal because a negative age satisfies `≤ max_age`
    // and `now < expires_at` holds. Refusing it cannot unlock authority, so the addition
    // cannot move a `VC-A2` row in the permissive direction.
    const future = held(new Date(T0.getTime() + 1));
    expect(resolve(true, future, T0)).toBe('UNCORROBORATED_STALL');
  });

  it('an expired signal against an open declaration is REPORTED, not merely dropped', () => {
    const expired = held(new Date(T0.getTime() - signalMaxAgeMs() - 1));
    const resolution = resolveMirrorState({
      companyId: COMPANY,
      declarationOpen: true,
      heldCorroboration: expired,
      now: T0,
    });
    expect(resolution.state).toBe('UNCORROBORATED_STALL');
    expect(resolution.anomalies).toContain('CORROBORATION_EXPIRED_WHILE_DECLARED');
    expect(resolution.basisSignalId).toBeNull();
  });

  it('the resolution NEVER names a basis signal outside CORROBORATED_DEGRADED', () => {
    // `0009__mirror_state.sql`'s `mirror_state_corroborated_names_a_signal` CHECK is the
    // schema half of this; here it is the resolver's half.
    for (const declarationOpen of [false, true]) {
      for (const corroboration of [null, held(T0), held(new Date(T0.getTime() - 10 * 60_000))]) {
        const r = resolveMirrorState({
          companyId: COMPANY,
          declarationOpen,
          heldCorroboration: corroboration,
          now: T0,
        });
        if (r.state === 'CORROBORATED_DEGRADED') {
          expect(r.basisSignalId).not.toBeNull();
        } else {
          expect(r.basisSignalId).toBeNull();
        }
      }
    }
  });
});

describe("`30 §5.7.1`'s FRESHNESS RULE, at the boundary", () => {
  // "`now() − signal.observed_at ≤ max_age` **and** `now() < signal.expires_at`".
  //
  // The two conjuncts are not redundant: the first is non-strict, the second is strict, so
  // EXACTLY AT the boundary the first passes and the second fails. Every case below is a
  // literal instant computed by hand from `T0` and 300000ms.
  const signal = held(T0);

  it('one millisecond inside `max_age` — FRESH', () => {
    expect(isCorroborationFresh(signal, new Date(T0.getTime() + signalMaxAgeMs() - 1))).toBe(
      true,
    );
  });

  it('EXACTLY at `observed_at + max_age` — NOT fresh, because `now < expires_at` is strict', () => {
    expect(isCorroborationFresh(signal, new Date(T0.getTime() + signalMaxAgeMs()))).toBe(false);
  });

  it('one millisecond past — NOT fresh', () => {
    expect(isCorroborationFresh(signal, new Date(T0.getTime() + signalMaxAgeMs() + 1))).toBe(
      false,
    );
  });

  it('at the instant of observation — FRESH', () => {
    expect(isCorroborationFresh(signal, T0)).toBe(true);
  });

  it('one millisecond BEFORE observation — NOT fresh (`S1H-C6`)', () => {
    expect(isCorroborationFresh(signal, new Date(T0.getTime() - 1))).toBe(false);
  });

  it('a signal whose `expires_at` was rewritten forward is still bounded by `max_age`', () => {
    // `30 §5.7.1`, Minting and extension: "Extending a signal's life by rewriting
    // `expires_at` breaks the signature." It also fails HERE, before the signature is
    // reached: the first conjunct is over `observed_at`, which the rewrite did not move.
    const rewritten: HeldCorroboration = {
      ...signal,
      expiresAt: new Date(T0.getTime() + 24 * 60 * 60 * 1000),
    };
    expect(isCorroborationFresh(rewritten, new Date(T0.getTime() + signalMaxAgeMs() + 1))).toBe(
      false,
    );
  });
});
