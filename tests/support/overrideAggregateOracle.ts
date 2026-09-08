/**
 * `I63(b)` — THE SECOND IMPLEMENTATION OF THE OVERRIDE COMPOSITION BOUND.
 *
 * =================================================================================
 * `VC-A2f` REQUIRES THIS FILE TO EXIST, IN THOSE WORDS.
 *
 * `36 §9`, VC-A2f: "Exercise maximum-valid overrides repeatedly across consecutive
 * simulated outages, **rotating action classes and recreating after expiry**, and assert
 * every aggregate leg of `I63` binds: 3 overrides, 72 cumulative hours, 8 cumulative
 * effects, $100.00 cumulative monetary, per rolling 30 days. **The expected aggregate is
 * computed by a second implementation from `51 §3.6`, not by the production counter.**"
 *
 * `51 §5`'s verification table, `I63` row: "Repeated maximum-valid overrides across
 * consecutive outages, rotating action classes and recreating after expiry, against an
 * **independently calculated** aggregate".
 *
 * THIS FILE IMPORTS NOTHING. Not the production trigger, not `OVERRIDE_LIMITS`, not the SQL
 * function. Every quantity below is transcribed from `51 §3.6`'s table by hand.
 * =================================================================================
 *
 * `51 §3.6`, transcribed:
 *
 *   | `max_override_duration`                            | **24 hours**  | Per override
 *   | `max_override_effect_count`                        | **5**         | Per override
 *   | `max_override_monetary_exposure`                   | **$50.00**    | Per override
 *   | `max_override_count`                               | **3** / 30d   | Aggregate
 *   | `max_cumulative_override_hours`                    | **72 hours** / 30d | Aggregate
 *   | `max_cumulative_override_effects`                  | **8** / 30d   | Aggregate
 *   | `max_cumulative_override_monetary`                 | **$100.00** / 30d | Aggregate
 *   | `second_approver_required_from`                    | the **2nd** override / 30d
 *
 * And `51 §3.6`'s own worked composition, which this implementation must reproduce:
 *
 *   "Three overrides is the count cap; 3 × 24 h = 72 h, exactly the hours cap; 3 × 5 = 15
 *    effects, cut to **8** by the aggregate; 3 × $50.00 = $150.00, cut to **$100.00** by the
 *    aggregate. **The aggregate legs bind before the per-override legs on both consumable
 *    quantities.**"
 */

/** `51 §3.6`, hand-transcribed. Money in whole cents, to avoid a float anywhere near a cap. */
export const ORACLE_LIMITS = Object.freeze({
  maxOverrideDurationHours: 24,
  maxOverrideEffectCount: 5,
  maxOverrideMonetaryCents: 5000,
  maxOverrideCount: 3,
  maxCumulativeHours: 72,
  maxCumulativeEffects: 8,
  maxCumulativeMonetaryCents: 10_000,
  secondApproverRequiredFrom: 2,
  compositionWindowDays: 30,
});

export interface OracleOverride {
  readonly overrideId: string;
  /** Milliseconds since the epoch. A number, so the arithmetic is visible in a failure. */
  readonly startsAtMs: number;
  readonly expiresAtMs: number;
  readonly effectsDispatched: number;
  readonly monetaryDispatchedCents: number;
}

export interface AggregateWindow {
  readonly windowStartMs: number;
  readonly count: number;
  readonly hours: number;
  readonly effects: number;
  readonly monetaryCents: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/**
 * Every maximal rolling 30-day window, and the aggregate inside each.
 *
 * "OVER ANY ROLLING 30-DAY WINDOW", COMPUTED LITERALLY. For a finite set of records, every
 * 30-day window's membership equals that of a window beginning at some record's own
 * `starts_at` — sliding a window right until its left edge hits a record can only remove
 * members, so the maximal windows are exactly those anchored at a record. Enumerating those
 * enumerates all of them.
 *
 * This is deliberately a DIFFERENT ROUTE from a single look-back from the newest record,
 * which is the implementation a reader would reach for first and which misses a violating
 * window anchored earlier. `§19`'s "expiry then immediate recreation" attack lives in
 * exactly that gap.
 */
export function aggregateWindows(
  overrides: readonly OracleOverride[],
): readonly AggregateWindow[] {
  const anchors = [...new Set(overrides.map((o) => o.startsAtMs))].sort((a, b) => a - b);
  return anchors.map((windowStartMs) => {
    const windowEndMs = windowStartMs + ORACLE_LIMITS.compositionWindowDays * DAY_MS;
    const inside = overrides.filter(
      (o) => o.startsAtMs >= windowStartMs && o.startsAtMs < windowEndMs,
    );
    return {
      windowStartMs,
      count: inside.length,
      hours: inside.reduce((sum, o) => sum + (o.expiresAtMs - o.startsAtMs) / HOUR_MS, 0),
      effects: inside.reduce((sum, o) => sum + o.effectsDispatched, 0),
      monetaryCents: inside.reduce((sum, o) => sum + o.monetaryDispatchedCents, 0),
    };
  });
}

export type AggregateBreach =
  | 'COUNT'
  | 'HOURS'
  | 'EFFECTS'
  | 'MONETARY';

export interface OracleVerdict {
  readonly withinBounds: boolean;
  readonly breaches: readonly { window: AggregateWindow; leg: AggregateBreach }[];
}

/** Would `I63(b)` permit this population? Computed from `ORACLE_LIMITS`, by hand. */
export function oracleVerdict(overrides: readonly OracleOverride[]): OracleVerdict {
  const breaches: { window: AggregateWindow; leg: AggregateBreach }[] = [];
  for (const window of aggregateWindows(overrides)) {
    if (window.count > ORACLE_LIMITS.maxOverrideCount) breaches.push({ window, leg: 'COUNT' });
    if (window.hours > ORACLE_LIMITS.maxCumulativeHours) breaches.push({ window, leg: 'HOURS' });
    if (window.effects > ORACLE_LIMITS.maxCumulativeEffects) {
      breaches.push({ window, leg: 'EFFECTS' });
    }
    if (window.monetaryCents > ORACLE_LIMITS.maxCumulativeMonetaryCents) {
      breaches.push({ window, leg: 'MONETARY' });
    }
  }
  return { withinBounds: breaches.length === 0, breaches };
}

/**
 * `30 §5.7.2` item 9's ordinal for a CANDIDATE override, computed independently.
 *
 * "The **first** override inside a rolling 30-day window requires the owner alone. **Every
 * subsequent override inside that window requires a distinct second approver.**"
 *
 * The window that matters for a candidate is the one ENDING at its own start, and THE
 * CANDIDATE COUNTS ITSELF: it is the first, second or third override inside that window.
 * So the ordinal is `1 + |{held : starts_at ∈ (candidate − 30 days, candidate]}|`, and a
 * candidate with no peers is number 1 and needs no second approver.
 *
 * `overrides` is the HELD population, excluding the candidate.
 */
export function oracleOrdinal(
  overrides: readonly OracleOverride[],
  candidateStartMs: number,
): number {
  const windowOpen = candidateStartMs - ORACLE_LIMITS.compositionWindowDays * DAY_MS;
  const peers = overrides.filter(
    (o) => o.startsAtMs > windowOpen && o.startsAtMs <= candidateStartMs,
  ).length;
  return peers + 1;
}

export function oracleRequiresSecondApprover(
  overrides: readonly OracleOverride[],
  candidateStartMs: number,
): boolean {
  return (
    oracleOrdinal(overrides, candidateStartMs) >= ORACLE_LIMITS.secondApproverRequiredFrom
  );
}
