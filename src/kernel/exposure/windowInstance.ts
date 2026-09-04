/**
 * Window instances. `24 §3.1`, verbatim:
 *
 *   "A window instance is the concrete calendar period of a DISCRETE window containing a
 *    given instant, keyed by window_instance_key — for example W_MONTH_ADSPEND:2026-01,
 *    evaluated in the company timezone on the database clock."
 *
 *   "The authorisation's in-scope interval is [s.created_at, s.expires_at +
 *    cessation_grace)."
 *
 * No live clock. `phase2-v1.3-implementation-brief.md §3`: "Any live clock. I56's schema
 * is S1; live clocks are S5." Every function here takes the instant as a parameter.
 */

export type WindowPeriod = 'DAY' | 'MONTH' | 'BALANCE';

export interface WindowInstance {
  readonly windowId: string;
  readonly key: string;
  /** Inclusive lower bound of the instance's calendar period. */
  readonly startsAt: Date;
  /** Exclusive upper bound. */
  readonly endsAt: Date;
}

/**
 * Decompose an instant into calendar fields in the named IANA timezone.
 *
 * `Intl.DateTimeFormat` is the platform's own tz database. Reimplementing offset rules
 * would be a second source of truth for a boundary that decides which window instance a
 * commitment lands in, and `24 §3.1` makes that boundary load-bearing.
 */
function civilFields(
  instant: Date,
  timezone: string,
): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((p) => p.type === type);
    if (!part) throw new Error(`timezone ${timezone} produced no ${type} part`);
    return Number.parseInt(part.value, 10);
  };
  return { year: get('year'), month: get('month'), day: get('day') };
}

/** The UTC instant at which the given civil midnight occurs in `timezone`. */
function civilMidnightUtc(
  year: number,
  month: number,
  day: number,
  timezone: string,
): Date {
  // Start from the naive UTC instant and correct by the zone's offset at that instant.
  // Two passes converge for every real zone, including DST transition days: the first
  // pass lands within an hour or two of the true midnight, the second lands on it.
  let guess = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  for (let pass = 0; pass < 2; pass += 1) {
    const asCivil = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(guess));
    const num = (type: Intl.DateTimeFormatPartTypes): number => {
      const part = asCivil.find((p) => p.type === type);
      if (!part) throw new Error(`timezone ${timezone} produced no ${type} part`);
      return Number.parseInt(part.value, 10);
    };
    const seen = Date.UTC(num('year'), num('month') - 1, num('day'), num('hour'), num('minute'), num('second'));
    const target = Date.UTC(year, month - 1, day, 0, 0, 0);
    if (seen === target) break;
    guess += target - seen;
  }
  return new Date(guess);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * The instance of `windowId` containing `instant`.
 *
 * BALANCE is `W_LIABILITY_OUTSTANDING`'s shape — `51 §2`: "the only window whose balance
 * is not reset by a boundary [...] its 'period' is the life of the company." It has one
 * instance, keyed with a constant.
 */
export function instanceFor(
  windowId: string,
  period: WindowPeriod,
  instant: Date,
  timezone: string,
): WindowInstance {
  if (period === 'BALANCE') {
    return {
      windowId,
      key: `${windowId}:LIFETIME`,
      startsAt: new Date(0),
      endsAt: new Date(8.64e15),
    };
  }

  const { year, month, day } = civilFields(instant, timezone);

  if (period === 'MONTH') {
    const startsAt = civilMidnightUtc(year, month, 1, timezone);
    const nextYear = month === 12 ? year + 1 : year;
    const nextMonth = month === 12 ? 1 : month + 1;
    const endsAt = civilMidnightUtc(nextYear, nextMonth, 1, timezone);
    return {
      windowId,
      key: `${windowId}:${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}`,
      startsAt,
      endsAt,
    };
  }

  const startsAt = civilMidnightUtc(year, month, day, timezone);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  const endsAt = civilMidnightUtc(
    next.getUTCFullYear(),
    next.getUTCMonth() + 1,
    next.getUTCDate(),
    timezone,
  );
  return {
    windowId,
    key:
      `${windowId}:${year.toString().padStart(4, '0')}-` +
      `${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`,
    startsAt,
    endsAt,
  };
}

/** The number of calendar days in the instance. `26 §10.1`'s `days_in_window(w)`. */
export function daysInWindow(instance: WindowInstance): number {
  const ms = instance.endsAt.getTime() - instance.startsAt.getTime();
  return Math.round(ms / 86_400_000);
}

export interface InScopeInterval {
  /** `s.created_at` */
  readonly from: Date;
  /** `s.expires_at + cessation_grace`, exclusive */
  readonly until: Date;
}

export function inScopeInterval(
  createdAt: Date,
  expiresAt: Date,
  cessationGraceHours: number,
): InScopeInterval {
  return {
    from: createdAt,
    until: new Date(expiresAt.getTime() + cessationGraceHours * 3_600_000),
  };
}

/**
 * `24 §3.1`'s membership predicate, verbatim:
 *
 *   "in_scope_instances(s) = { i : period(i) ∩ [s.created_at,
 *                                  s.expires_at + cessation_grace) ≠ ∅ AND a
 *                                  standing_window_exposure row exists for (s, w(i), i) }"
 *
 * This function decides only the first conjunct — the interval intersection. The second
 * conjunct is the existence of the row itself, which is a fact about the database and is
 * never inferred here. That separation is deliberate: `24 §3.1` makes the row's
 * existence, and specifically the LIVE-only rule that creates it, the thing that
 * decides whether a later instance carries exposure.
 */
export function periodIntersectsInterval(
  instance: WindowInstance,
  interval: InScopeInterval,
): boolean {
  return instance.startsAt < interval.until && interval.from < instance.endsAt;
}
