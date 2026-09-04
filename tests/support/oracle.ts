/**
 * THE INDEPENDENT ORACLE.
 *
 * `36 §0`, verbatim: "Independent validation must not call the same production function
 * twice and call agreement proof."
 *
 * Nothing in this file imports anything from `src/`. Not the money module, not
 * standingCap.ts, not the window-instance keyer. Every figure below is a literal
 * transcribed from the architecture, or an arithmetic step written out by hand from a
 * printed formula, with the formula quoted at the site.
 *
 * `26 §10.1` records why this matters: an earlier independent implementation "reproduced
 * $300.00 only by inferring the convention from the printed answer, which is exactly the
 * circularity 36 §0 exists to prevent." The way to not infer a convention from an answer
 * is to write the answer down from the source, which is what this file is.
 *
 * All values are decimal strings at scale 2, because that is how PostgreSQL returns
 * NUMERIC(18,2) and comparing strings avoids introducing a second numeric type here.
 */

/* ------------------------------------------------------------------------------ *
 * Window ceilings — `51 §2`, transcribed by hand.
 * ------------------------------------------------------------------------------ */

export const CEILING = {
  W_DAY_REFUND_MONETARY: '50.00',
  W_MONTH_REFUND_MONETARY: '250.00',
  W_DAY_CREDIT_MONETARY: '12.50',
  W_MONTH_CREDIT_MONETARY: '50.00',
  /** `51 §2`: "$12.00" */
  W_DAY_ADSPEND_MONETARY: '12.00',
  /** `51 §2`: "$186.00 ... the annual worst case of standing_cap(month) — $6.00 × 31" */
  W_MONTH_ADSPEND_MONETARY: '186.00',
  W_LIABILITY_OUTSTANDING_MONETARY: '200.00',
} as const;

export const COUNT_CEILING = {
  W_DAY_REFUND: 2n,
  W_MONTH_REFUND: 10n,
  W_DAY_CREDIT: 1n,
  W_MONTH_CREDIT: 4n,
  W_MONTH_UNGATED: 200n,
} as const;

/* ------------------------------------------------------------------------------ *
 * standing_cap — `51 §3.2` and `26 §10.1`:
 *
 *   standing_cap(s, w)        = s.rate.amount × periods_basis(w, adapter)
 *   periods_basis(W_DAY,   a) = a.daily_overdelivery_multiplier
 *   periods_basis(W_MONTH, a) = max( days_in_window(w), a.monthly_basis_multiplier )
 *
 * google_ads: daily_overdelivery_multiplier = 2.0, monthly_basis_multiplier = 30.4
 * The fixture rate is $6.00/day (`51 §3.2`).
 *
 * Every case below is the multiplication done by hand, with the working shown. There is
 * no loop, no shared helper and no call into src/. If a future change to standingCap.ts
 * disagrees with one of these numbers, one of the two is wrong and the test says so.
 * ------------------------------------------------------------------------------ */

export const STANDING_CAP = {
  /** DAY:   $6.00 × 2.0 = $12.00 */
  DAY_AT_6: '12.00',

  /** MONTH, 31 days: max(31, 30.4) = 31; $6.00 × 31 = $186.00 */
  MONTH_31_AT_6: '186.00',

  /** MONTH, 30 days: max(30, 30.4) = 30.4; $6.00 × 30.4 = $182.40 */
  MONTH_30_AT_6: '182.40',

  /** MONTH, 29 days: max(29, 30.4) = 30.4; $6.00 × 30.4 = $182.40 */
  MONTH_29_AT_6: '182.40',

  /** MONTH, 28 days: max(28, 30.4) = 30.4; $6.00 × 30.4 = $182.40 */
  MONTH_28_AT_6: '182.40',
} as const;

/**
 * Cross-check against the architecture's own printed answers.
 *
 * `phase2-v1.3.1-verification.md §10`, the recomputation table, verbatim:
 *   Standing(month), 28/29/30-day  $182.40
 *   Standing(month), 31-day        $186.00
 *
 * `26 §2.1.3`'s worked first authorisation, verbatim:
 *   standing_cap(s, W_MONTH_ADSPEND:2026-01) = $6.00 × max(31, 30.4) = $186.00
 *   standing_cap(s, W_DAY_ADSPEND:2026-01-01) = $6.00 × 2.0 = $12.00
 *
 * These constants are asserted against those strings in
 * tests/integration/exposure/oracle-self-check.test.ts, so the oracle cannot drift from
 * the document without a test failing.
 */
export const ARCHITECTURE_PRINTED = {
  STANDING_MONTH_31: '$186.00',
  STANDING_MONTH_SHORT: '$182.40',
  FIRST_AUTH_MONTH_SUM: '$186.00',
  FIRST_AUTH_MONTH_CEILING: '$186.00',
  FIRST_AUTH_DAY_SUM: '$12.00',
  FIRST_AUTH_DAY_CEILING: '$12.00',
} as const;

/* ------------------------------------------------------------------------------ *
 * VC-S5's figures — `36 §2`, verbatim:
 *   "$6.00/day, 31-day January. Pause on day 3; reach PAUSED; realised = $18.00,
 *    forward = $168.00, retained for the January instance"
 *
 * $18.00 is three days at $6.00. $168.00 = $186.00 − $18.00, which is
 * max(0, standing_cap − realised) with standing_cap = $186.00.
 * ------------------------------------------------------------------------------ */

export const VC_S5 = {
  REALISED_AFTER_THREE_DAYS: '18.00',
  FORWARD_AFTER_THREE_DAYS: '168.00',
  FEBRUARY_STANDING: '0.00',
  FEBRUARY_HEADROOM: '186.00',
} as const;

/* ------------------------------------------------------------------------------ *
 * Four-term arithmetic, done here rather than by the production guard.
 *
 * I3, registry §1.2, verbatim:
 *   "Σ open reservations + Σ forward exposure of every StandingAuthorization not in
 *    status REVOKED and in scope for i + Σ presumed exposure of effects in
 *    PRESUMED_SETTLED + realised spend ≤ w.ceiling"
 * ------------------------------------------------------------------------------ */

/** Exact decimal addition over scale-2 strings, via integer minor units. */
export function sumScale2(...values: readonly string[]): string {
  let total = 0n;
  for (const value of values) total += toMinorUnits(value);
  return fromMinorUnits(total);
}

export function subScale2(a: string, b: string): string {
  return fromMinorUnits(toMinorUnits(a) - toMinorUnits(b));
}

/** `Σ max(0, cap_i − realised_i)` — the form `24 §3` K5 requires. */
export function forwardSumConservative(
  rows: readonly { cap: string; realised: string }[],
): string {
  let total = 0n;
  for (const row of rows) {
    const remainder = toMinorUnits(row.cap) - toMinorUnits(row.realised);
    total += remainder > 0n ? remainder : 0n;
  }
  return fromMinorUnits(total);
}

/**
 * `max(0, Σcap − Σrealised)` — the transformation the architecture REJECTS.
 *
 * Present only so a test can demonstrate the two differ. `24 §3` K5: "max(0, Σcap −
 * Σrealised) is smaller than Σ max(0, cap_i − realised_i) whenever one authorisation has
 * overrun, so an aggregate generated column would silently under-reserve."
 */
export function forwardSumCollapsedAndWrong(
  rows: readonly { cap: string; realised: string }[],
): string {
  let caps = 0n;
  let realised = 0n;
  for (const row of rows) {
    caps += toMinorUnits(row.cap);
    realised += toMinorUnits(row.realised);
  }
  const remainder = caps - realised;
  return fromMinorUnits(remainder > 0n ? remainder : 0n);
}

export function fourTermSum(terms: {
  reserved: string;
  standing: string;
  presumed: string;
  realised: string;
}): string {
  return sumScale2(terms.reserved, terms.standing, terms.presumed, terms.realised);
}

export function withinCeiling(sum: string, ceiling: string): boolean {
  return toMinorUnits(sum) <= toMinorUnits(ceiling);
}

export function compareScale2(a: string, b: string): -1 | 0 | 1 {
  const x = toMinorUnits(a);
  const y = toMinorUnits(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** One cent, as a scale-2 string. Used by the boundary cases in S1A-8. */
export const ONE_CENT = '0.01';

export function plusOneCent(value: string): string {
  return sumScale2(value, ONE_CENT);
}

export function minusOneCent(value: string): string {
  return subScale2(value, ONE_CENT);
}

/* -- local, deliberately duplicated rather than imported from src/kernel/exposure -- */

function toMinorUnits(value: string): bigint {
  const match = /^(-?)(\d+)\.(\d{2})$/.exec(value);
  if (!match) throw new Error(`oracle expects a scale-2 decimal string, got ${value}`);
  const [, sign, whole, cents] = match;
  const magnitude = BigInt(whole!) * 100n + BigInt(cents!);
  return sign === '-' ? -magnitude : magnitude;
}

function fromMinorUnits(value: bigint): string {
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const whole = magnitude / 100n;
  const cents = magnitude % 100n;
  return `${negative ? '-' : ''}${whole}.${cents.toString().padStart(2, '0')}`;
}
