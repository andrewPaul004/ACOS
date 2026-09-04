import { describe, expect, it } from 'vitest';

import { GOOGLE_ADS, META_ADS, isAutonomyEligibleForRateClasses, standingCap } from '../../../src/kernel/exposure/standingCap.js';
import { fromDb, money, toDb } from '../../../src/kernel/exposure/money.js';
import { daysInWindow, instanceFor } from '../../../src/kernel/exposure/windowInstance.js';
import {
  ARCHITECTURE_PRINTED,
  CEILING,
  STANDING_CAP,
  forwardSumCollapsedAndWrong,
  forwardSumConservative,
  fourTermSum,
  minusOneCent,
  plusOneCent,
} from '../../support/oracle.js';

/**
 * The oracle's own self-check.
 *
 * `36 §0`, verbatim: "Independent validation must not call the same production function
 * twice and call agreement proof."
 *
 * tests/support/oracle.ts imports nothing from `src/`, so it is independent BY
 * CONSTRUCTION. But independence is only useful if the oracle is also CORRECT, and an
 * oracle nobody checks is just a second place to be wrong. This file checks it twice
 * over:
 *
 *   1. against the architecture's own PRINTED answers, quoted from
 *      `26 §2.1.3` and `phase2-v1.3.1-verification.md §10`;
 *   2. against the production implementation, as a DIFFERENTIAL — the two were written
 *      from the same formula by different routes (a hand-evaluated constant table versus
 *      an exact-rational multiplication), and they must agree.
 *
 * The second check is the one `26 §10.1` warns about: an earlier independent
 * implementation "reproduced $300.00 only by inferring the convention from the printed
 * answer". Check 1 exists so that check 2 cannot be satisfied by two implementations
 * sharing a wrong convention — the printed answer is the third party.
 */

describe('the oracle agrees with the architecture PRINTED answers', () => {
  it('26 §2.1.3s worked first authorisation', () => {
    expect(`$${STANDING_CAP.MONTH_31_AT_6}`).toBe(ARCHITECTURE_PRINTED.FIRST_AUTH_MONTH_SUM);
    expect(`$${CEILING.W_MONTH_ADSPEND_MONETARY}`).toBe(
      ARCHITECTURE_PRINTED.FIRST_AUTH_MONTH_CEILING,
    );
    expect(`$${STANDING_CAP.DAY_AT_6}`).toBe(ARCHITECTURE_PRINTED.FIRST_AUTH_DAY_SUM);
    expect(`$${CEILING.W_DAY_ADSPEND_MONETARY}`).toBe(
      ARCHITECTURE_PRINTED.FIRST_AUTH_DAY_CEILING,
    );
  });

  it('phase2-v1.3.1-verification.md §10s recomputation table', () => {
    // "Standing(month), 28/29/30-day  $182.40 | Standing(month), 31-day  $186.00"
    expect(`$${STANDING_CAP.MONTH_31_AT_6}`).toBe(ARCHITECTURE_PRINTED.STANDING_MONTH_31);
    expect(`$${STANDING_CAP.MONTH_30_AT_6}`).toBe(ARCHITECTURE_PRINTED.STANDING_MONTH_SHORT);
    expect(`$${STANDING_CAP.MONTH_29_AT_6}`).toBe(ARCHITECTURE_PRINTED.STANDING_MONTH_SHORT);
    expect(`$${STANDING_CAP.MONTH_28_AT_6}`).toBe(ARCHITECTURE_PRINTED.STANDING_MONTH_SHORT);
  });

  it('51 §2s W_MONTH_ADSPEND rationale: $6.00 × 31 is the annual worst case', () => {
    // "$186.00. This is the annual worst case of standing_cap(month) — $6.00 × 31 in a
    // 31-day month."
    expect(STANDING_CAP.MONTH_31_AT_6).toBe(CEILING.W_MONTH_ADSPEND_MONETARY);
    // And every shorter month is strictly below it.
    for (const shorter of [
      STANDING_CAP.MONTH_30_AT_6,
      STANDING_CAP.MONTH_29_AT_6,
      STANDING_CAP.MONTH_28_AT_6,
    ]) {
      expect(Number.parseFloat(shorter)).toBeLessThan(
        Number.parseFloat(CEILING.W_MONTH_ADSPEND_MONETARY),
      );
    }
  });
});

describe('the oracle and the production implementation are a differential pair', () => {
  const rate = money('6.00');

  it.each([
    ['2026-01-15T00:00:00Z', 31, STANDING_CAP.MONTH_31_AT_6],
    ['2026-04-15T00:00:00Z', 30, STANDING_CAP.MONTH_30_AT_6],
    ['2024-02-15T00:00:00Z', 29, STANDING_CAP.MONTH_29_AT_6],
    ['2026-02-15T00:00:00Z', 28, STANDING_CAP.MONTH_28_AT_6],
  ])('MONTH at %s (%i days) → %s', (instant, days, expected) => {
    const instance = instanceFor('W_MONTH_ADSPEND', 'MONTH', new Date(instant), 'UTC');
    expect(daysInWindow(instance)).toBe(days);
    // Production: exact-rational multiplication of 6.00 by max(days, 152/5).
    const produced = standingCap(rate, 'MONTH', instance, GOOGLE_ADS);
    // Oracle: the answer written out by hand.
    expect(toDb(produced)).toBe(expected);
  });

  it('DAY → $6.00 × 2.0 = $12.00', () => {
    const instance = instanceFor('W_DAY_ADSPEND', 'DAY', new Date('2026-01-01T00:00:00Z'), 'UTC');
    expect(toDb(standingCap(rate, 'DAY', instance, GOOGLE_ADS))).toBe(STANDING_CAP.DAY_AT_6);
  });
});

describe('51 §3.2 — an UNMEASURED adapter is not autonomy-eligible for rate classes', () => {
  it('google_ads is eligible; meta_ads is not', () => {
    expect(isAutonomyEligibleForRateClasses(GOOGLE_ADS)).toBe(true);
    expect(isAutonomyEligibleForRateClasses(META_ADS)).toBe(false);
  });

  it('standingCap refuses to compute for an UNMEASURED adapter', () => {
    const instance = instanceFor('W_MONTH_ADSPEND', 'MONTH', new Date('2026-01-15Z'), 'UTC');
    expect(() => standingCap(money('6.00'), 'MONTH', instance, META_ADS)).toThrow(
      /not autonomy-eligible/,
    );
  });

  it('the cessation specification is literally null — TB-07, undeclared', () => {
    expect(GOOGLE_ADS.cessationSpecification).toBeNull();
    expect(META_ADS.cessationSpecification).toBeNull();
    // `51 §3.2`: cessation_grace = 72 h, CONFIGURED.
    expect(GOOGLE_ADS.cessationGraceHours).toBe(72);
  });
});

describe('the oracles arithmetic primitives', () => {
  it('adds and subtracts at scale 2 without float error', () => {
    // 0.10 + 0.20 is the canonical binary-float failure. It must be exact here.
    expect(fourTermSum({ reserved: '0.10', standing: '0.20', presumed: '0.00', realised: '0.00' }))
      .toBe('0.30');
    expect(plusOneCent('186.00')).toBe('186.01');
    expect(minusOneCent('186.00')).toBe('185.99');
  });

  it('the conservative and collapsed forward sums differ under overrun', () => {
    const rows = [
      { cap: '100.00', realised: '120.00' },
      { cap: '60.00', realised: '0.00' },
    ];
    expect(forwardSumConservative(rows)).toBe('60.00');
    expect(forwardSumCollapsedAndWrong(rows)).toBe('40.00');
  });

  it('and agree when nothing has overrun', () => {
    const rows = [
      { cap: '100.00', realised: '20.00' },
      { cap: '60.00', realised: '10.00' },
    ];
    expect(forwardSumConservative(rows)).toBe('130.00');
    expect(forwardSumCollapsedAndWrong(rows)).toBe('130.00');
  });

  it('rejects a value carrying more than the declared scale — 30 §5.3', () => {
    expect(() => fromDb('25.001')).toThrow(/more than 2 decimal places/);
    // And 25.0 vs 25.00 are handled without silently losing the distinction: parsing
    // normalises to minor units, and rendering always emits the declared scale.
    expect(toDb(fromDb('25.0'))).toBe('25.00');
  });
});

describe('window instances are keyed as 24 §3.1 declares', () => {
  it('W_MONTH_ADSPEND:2026-01 — the examples exact form', () => {
    const instance = instanceFor('W_MONTH_ADSPEND', 'MONTH', new Date('2026-01-15T12:00:00Z'), 'UTC');
    expect(instance.key).toBe('W_MONTH_ADSPEND:2026-01');
  });

  it('a DAY instance carries the calendar date', () => {
    const instance = instanceFor('W_DAY_ADSPEND', 'DAY', new Date('2026-01-05T23:30:00Z'), 'UTC');
    expect(instance.key).toBe('W_DAY_ADSPEND:2026-01-05');
  });

  it('the instance is evaluated in the COMPANY timezone, not the servers', () => {
    // 2026-01-05T23:30:00Z is already 2026-01-06 in Tokyo. `24 §3.1`: instances are
    // "evaluated in the company timezone on the database clock".
    const utc = instanceFor('W_DAY_ADSPEND', 'DAY', new Date('2026-01-05T23:30:00Z'), 'UTC');
    const tokyo = instanceFor(
      'W_DAY_ADSPEND',
      'DAY',
      new Date('2026-01-05T23:30:00Z'),
      'Asia/Tokyo',
    );
    expect(utc.key).toBe('W_DAY_ADSPEND:2026-01-05');
    expect(tokyo.key).toBe('W_DAY_ADSPEND:2026-01-06');
  });

  it('a DST transition day still yields exactly one instance with a real boundary', () => {
    // 2026-03-08 is the US spring-forward date; the civil day is 23 hours long.
    const instance = instanceFor(
      'W_DAY_REFUND',
      'DAY',
      new Date('2026-03-08T18:00:00Z'),
      'America/New_York',
    );
    expect(instance.key).toBe('W_DAY_REFUND:2026-03-08');
    const hours = (instance.endsAt.getTime() - instance.startsAt.getTime()) / 3_600_000;
    expect(hours).toBe(23);
  });

  it('W_LIABILITY_OUTSTANDING has one lifetime instance — 51 §2', () => {
    // "the only window whose balance is not reset by a boundary [...] its 'period' is
    // the life of the company."
    const a = instanceFor('W_LIABILITY_OUTSTANDING', 'BALANCE', new Date('2026-01-01Z'), 'UTC');
    const b = instanceFor('W_LIABILITY_OUTSTANDING', 'BALANCE', new Date('2027-06-01Z'), 'UTC');
    expect(a.key).toBe(b.key);
    expect(a.key).toBe('W_LIABILITY_OUTSTANDING:LIFETIME');
  });
});
