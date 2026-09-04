import { mulByRational, type Money } from './money.js';
import { daysInWindow, type WindowInstance, type WindowPeriod } from './windowInstance.js';

/**
 * `standing_cap`, the exposure-remainder form. `26 §10.1` and `51 §3.2`, verbatim:
 *
 *   standing_cap(s, w)        = s.rate.amount × periods_basis(w, adapter)
 *   periods_basis(W_DAY,   a) = a.daily_overdelivery_multiplier
 *   periods_basis(W_MONTH, a) = max( days_in_window(w), a.monthly_basis_multiplier )
 *   forward_exposure(s, i, t) = 0                                if i ∉ in_scope_instances(s)
 *                             = max( 0, standing_cap(s, w(i)) − realised_spend(s, i, t) )
 *
 * `forward_exposure`'s second branch is NOT computed here. It is the generated column
 * `standing_window_exposure.forward_monetary`, and `24 §3` K5 states it "is not
 * independently writable, by anyone, including the control plane." A TypeScript
 * implementation of it would be a second definition of a value the database owns.
 *
 * What this module computes is `standing_cap`, which IS a control-plane input — it is
 * written into `standing_cap_monetary`, the authoritative primitive.
 */

/**
 * Adapter parameters, with declared provenance. `51 §3.2`.
 *
 * Registry rule 8 requires provenance on every vendor parameter, and `51 §3.2`'s
 * conservative default states the consequence of an UNMEASURED one: "daily_overdelivery_
 * multiplier or monthly_basis_multiplier unmeasured → the adapter is not
 * autonomy-eligible for rate classes."
 */
export type Provenance = 'DOCUMENTED' | 'CONFIGURED' | 'UNMEASURED';

export interface Multiplier {
  /** Expressed as an exact rational so 30.4 is 152/5 rather than a binary float. */
  readonly numerator: bigint;
  readonly denominator: bigint;
  readonly provenance: Provenance;
}

export interface AdapterParameters {
  readonly adapter: string;
  readonly dailyOverdeliveryMultiplier: Multiplier;
  readonly monthlyBasisMultiplier: Multiplier;
  /** `51 §3.2`: 72 h, CONFIGURED. Also the terminal bound on the in-scope interval. */
  readonly cessationGraceHours: number;
  /**
   * `51 §3.2`: UNDECLARED for every adapter. TB-07, scheduled
   * `S1 BEFORE IMPLEMENTING RELATED COMPONENT`. `62 §9` prohibition 3 forbids attempting
   * the measurement until it is declared, so this is a literal `null` and there is no
   * code path that reads a value out of it.
   */
  readonly cessationSpecification: null;
}

/**
 * `51 §3.2`'s declared google_ads parameters. These are the SIGNED NON-PRODUCTION
 * fixture values. Nothing in `src/` seeds a production ceiling — TB-08(a) blocks that
 * (`phase2-v1.3-implementation-brief.md §5`) — and these are consumed by test fixtures.
 */
export const GOOGLE_ADS: AdapterParameters = {
  adapter: 'google_ads',
  // 2.0 — DOCUMENTED. "delivery may reach twice the average daily budget on an
  // individual day"
  dailyOverdeliveryMultiplier: { numerator: 2n, denominator: 1n, provenance: 'DOCUMENTED' },
  // 30.4 — DOCUMENTED. "Google Ads monthly spending limit: average daily budget × 30.4"
  monthlyBasisMultiplier: { numerator: 152n, denominator: 5n, provenance: 'DOCUMENTED' },
  cessationGraceHours: 72,
  cessationSpecification: null,
};

/**
 * `51 §3.2`'s meta_ads row: UNMEASURED throughout, "and therefore not autonomy-eligible
 * for rate classes."
 */
export const META_ADS: AdapterParameters = {
  adapter: 'meta_ads',
  dailyOverdeliveryMultiplier: { numerator: 0n, denominator: 1n, provenance: 'UNMEASURED' },
  monthlyBasisMultiplier: { numerator: 0n, denominator: 1n, provenance: 'UNMEASURED' },
  cessationGraceHours: 72,
  cessationSpecification: null,
};

export function isAutonomyEligibleForRateClasses(a: AdapterParameters): boolean {
  return (
    a.dailyOverdeliveryMultiplier.provenance !== 'UNMEASURED' &&
    a.monthlyBasisMultiplier.provenance !== 'UNMEASURED'
  );
}

export class AdapterNotAutonomyEligible extends Error {
  public constructor(adapter: string) {
    super(
      `adapter ${adapter} carries an UNMEASURED rate multiplier and is not ` +
        `autonomy-eligible for rate classes (51 §3.2)`,
    );
    this.name = 'AdapterNotAutonomyEligible';
  }
}

/** `periods_basis(w, a)`, returned as an exact rational. */
export function periodsBasis(
  period: WindowPeriod,
  instance: WindowInstance,
  adapter: AdapterParameters,
): { numerator: bigint; denominator: bigint } {
  if (period === 'DAY') {
    return {
      numerator: adapter.dailyOverdeliveryMultiplier.numerator,
      denominator: adapter.dailyOverdeliveryMultiplier.denominator,
    };
  }
  if (period === 'MONTH') {
    const days = BigInt(daysInWindow(instance));
    const m = adapter.monthlyBasisMultiplier;
    // max( days_in_window(w), monthly_basis_multiplier ), compared as exact rationals:
    // days ≥ m  ⟺  days × m.denominator ≥ m.numerator
    if (days * m.denominator >= m.numerator) {
      return { numerator: days, denominator: 1n };
    }
    return { numerator: m.numerator, denominator: m.denominator };
  }
  throw new Error(
    `standing forward exposure is defined only against DISCRETE DAY and MONTH windows ` +
      `(registry I3; 51 §2.1 makes ROLLING NOT_ADMISSIBLE_AT_MVP); got period ${period}`,
  );
}

/** `standing_cap(s, w) = s.rate.amount × periods_basis(w, adapter)`. */
export function standingCap(
  rateAmount: Money,
  period: WindowPeriod,
  instance: WindowInstance,
  adapter: AdapterParameters,
): Money {
  if (!isAutonomyEligibleForRateClasses(adapter)) {
    throw new AdapterNotAutonomyEligible(adapter.adapter);
  }
  const basis = periodsBasis(period, instance, adapter);
  return mulByRational(rateAmount, basis.numerator, basis.denominator);
}
