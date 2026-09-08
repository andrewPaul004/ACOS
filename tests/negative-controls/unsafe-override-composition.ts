/**
 * TEST-ONLY VULNERABLE OVERRIDE ADMISSION — PER-OVERRIDE LIMITS ONLY, NO AGGREGATE.
 *
 * =================================================================================
 * `§34` OF THE S1H MANDATE REQUIRES THIS FILE, AND `36 §9`'s VC-A2f NAMES THE PROPERTY.
 *
 * `§34`: "Unsafe implementation: enforces per-override duration; per-override count; but has
 * no aggregate/composition limit. Run repeated overrides. Unsafe implementation eventually
 * exceeds the architecture's total governed bound. Production refuses before doing so."
 *
 * `30 §5.7.2` item 10: "**Composition is bounded by `I63`**, over a rolling 30-day window,
 * across duration, count, effect count and monetary exposure. **Rotating action classes,
 * expiry-and-recreation and establishing a durable degraded posture are each bounded by the
 * aggregate legs rather than by the per-override legs.**"
 *
 * `51 §3.6`: "`I63`'s aggregate leg is what makes A5's *'repeated bounded overrides compose
 * into unbounded authority'* question answerable and answered **no**."
 *
 * THIS FILE IS THE "YES" VERSION. It enforces every per-override bound from `51 §3.6` —
 * 24 hours, 5 effects, $50.00 — and nothing else. Under it, N maximum-valid overrides give
 * 24N hours, 5N effects and $50N of degraded authority, which is unbounded in N.
 * =================================================================================
 *
 * IMPORTS NOTHING. Not the production module, not the oracle, not `OVERRIDE_LIMITS`. The
 * three per-override values are transcribed from `51 §3.6` by hand, so the control is a
 * genuine second implementation of the WRONG rule rather than production with a flag off.
 */

/** `51 §3.6`'s per-override values, hand-transcribed. The ONLY limits this control knows. */
const MAX_DURATION_HOURS = 24;
const MAX_EFFECT_COUNT = 5;
const MAX_MONETARY_CENTS = 5000;

export interface UnsafeOverride {
  readonly overrideId: string;
  readonly startsAtMs: number;
  readonly expiresAtMs: number;
  readonly effectCountCap: number;
  readonly monetaryCapCents: number;
}

export interface UnsafeAdmission {
  readonly admitted: boolean;
  readonly reason: string;
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * Admit an override on the PER-OVERRIDE legs alone.
 *
 * The held population is accepted as a parameter and IGNORED — deliberately, and visibly, so
 * a reader can see that the aggregate information is available and unused. That is what the
 * defect looks like in real code: the data is there and nobody sums it.
 */
export function unsafeAdmit(
  held: readonly UnsafeOverride[],
  candidate: UnsafeOverride,
): UnsafeAdmission {
  void held; // THE HOLE. `I63(b)` would read this. This implementation does not.

  const hours = (candidate.expiresAtMs - candidate.startsAtMs) / HOUR_MS;
  if (hours <= 0 || hours > MAX_DURATION_HOURS) {
    return { admitted: false, reason: `duration ${String(hours)}h exceeds 24h` };
  }
  if (candidate.effectCountCap <= 0 || candidate.effectCountCap > MAX_EFFECT_COUNT) {
    return {
      admitted: false,
      reason: `effect_count_cap ${String(candidate.effectCountCap)} exceeds 5`,
    };
  }
  if (candidate.monetaryCapCents < 0 || candidate.monetaryCapCents > MAX_MONETARY_CENTS) {
    return {
      admitted: false,
      reason: `monetary cap ${String(candidate.monetaryCapCents)} exceeds 5000 cents`,
    };
  }
  return { admitted: true, reason: 'every PER-OVERRIDE leg of 51 §3.6 is satisfied' };
}

/** What the unsafe control lets a sequence of admitted overrides accumulate. */
export function unsafeAccumulated(admitted: readonly UnsafeOverride[]): {
  readonly count: number;
  readonly hours: number;
  readonly effects: number;
  readonly monetaryCents: number;
} {
  return {
    count: admitted.length,
    hours: admitted.reduce((s, o) => s + (o.expiresAtMs - o.startsAtMs) / HOUR_MS, 0),
    effects: admitted.reduce((s, o) => s + o.effectCountCap, 0),
    monetaryCents: admitted.reduce((s, o) => s + o.monetaryCapCents, 0),
  };
}
