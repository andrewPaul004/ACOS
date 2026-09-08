import { describe, expect, it } from 'vitest';

import {
  DEGRADED_MODE_TIMING,
  DEGRADED_PER_ACTION_APPROVAL_FLOOR,
  classifyMirrorLag,
  isAboveDegradedApprovalFloor,
  isFullHaltPosture,
} from '../../src/kernel/mirror/degradedModeThresholds.js';
import { SIGNAL_MAX_AGE_MS } from '../../src/kernel/mirror/mirrorState.js';
import { OVERRIDE_LIMITS } from '../../src/kernel/mirror/degradedModeOverride.js';
import { money, toDb } from '../../src/kernel/exposure/money.js';
import { ATTESTATION_STALL_BOUND_MS } from '../../src/replication/attestation.js';
import {
  ORACLE_APPROVAL_FLOOR_MINOR_UNITS,
  ORACLE_FULL_HALT_MS,
  ORACLE_MIRROR_LAG_CRITICAL_MS,
} from '../support/mirrorPrecedenceTable.js';

/**
 * `51 §3.7` and `51 §3.8` — THE THREE QUANTITIES v1.3.3 DECLARED, AGAINST A HAND-AUTHORED
 * SECOND READING AND AT EVERY DECLARED BOUNDARY.
 *
 * =================================================================================
 * WHY THIS SUITE COMPARES TWO TRANSCRIPTIONS RATHER THAN READING ONE.
 *
 * `36 §0`: "Independent validation must not call the same production function twice and
 * call agreement proof." `tests/support/mirrorPrecedenceTable.ts` carries a HAND-AUTHORED
 * transcription of all three values, imports nothing, and is compared against production's
 * here. A seeded edit to either side fails this file.
 *
 * `override-limits-agree.test.ts` applies the same discipline to `51 §3.6`, and this is that
 * pattern extended to `§3.7` and `§3.8`.
 * =================================================================================
 */

describe('`51 §3.7` — the declared value, against a hand-authored second reading', () => {
  it('the approval floor is USD 20.00, in minor units, in both transcriptions', () => {
    expect(DEGRADED_PER_ACTION_APPROVAL_FLOOR).toBe(ORACLE_APPROVAL_FLOOR_MINOR_UNITS);
    // And it renders at `51 §1`'s declared scale, which is how the fixture prints it.
    expect(toDb(DEGRADED_PER_ACTION_APPROVAL_FLOOR)).toBe('20.00');
  });

  it('and it is NOT `refund.create`s $25.00 `per_action_max`', () => {
    // `30 §5.1a`: "the two are different quantities with different kinds". The Cedar bound
    // is `26 §8`'s DENY boundary and lives in the policy artifact; this is a precedence
    // operand. Asserting the inequality here is what makes a future collapse of the two
    // into one number a test failure.
    expect(DEGRADED_PER_ACTION_APPROVAL_FLOOR).not.toBe(money('25.00'));
    expect(DEGRADED_PER_ACTION_APPROVAL_FLOOR).toBeLessThan(money('25.00'));
  });

  it('so the band in which precedence row 2 is reachable is non-empty', () => {
    // `51 §3.7`'s "Why $20.00 and not $25.00": at a floor equal to `per_action_max` the band
    // is EMPTY and row 2 is dead code for the whole S1 catalogue. The band's own edges:
    expect(isAboveDegradedApprovalFloor(money('20.01'))).toBe(true);
    expect(isAboveDegradedApprovalFloor(money('25.00'))).toBe(true);
  });
});

describe('`51 §3.7` — the STRICT boundary, at the minimum currency unit', () => {
  // `51 §3.7`: "`total_exposure > 20.00` is ABOVE the floor. The comparison is **strict** [...]
  // so `$20.00` exactly is **not** above the floor and `$20.01` — one minor unit above — **is**."
  const CASES: readonly [string, boolean][] = [
    ['0.00', false],
    ['19.98', false],
    ['19.99', false],
    ['20.00', false], // AT the floor. NOT above.
    ['20.01', true], // ONE MINOR UNIT above.
    ['22.00', true],
    ['25.00', true],
    ['25.01', true], // above the floor, and separately DENIED by `per_action_max`.
  ];

  for (const [literal, expected] of CASES) {
    it(`$${literal} is ${expected ? 'ABOVE' : 'NOT above'} the floor`, () => {
      expect(isAboveDegradedApprovalFloor(money(literal))).toBe(expected);
    });
  }

  it('the boundary is exactly one minor unit wide and nothing sits inside it', () => {
    // Stated as arithmetic on the constant rather than on the literals above, so a change of
    // scale or of the constant fails here.
    const floor = DEGRADED_PER_ACTION_APPROVAL_FLOOR;
    expect(isAboveDegradedApprovalFloor(floor)).toBe(false);
    expect(isAboveDegradedApprovalFloor((floor + 1n) as typeof floor)).toBe(true);
    expect(isAboveDegradedApprovalFloor((floor - 1n) as typeof floor)).toBe(false);
  });

  it('a non-monetary effect carries 0.00 and is NOT above the floor', () => {
    // `51 §3.7`: "A rate class reserves `0.00` (`26 §2.1.3`) and an action class with no
    // monetary field carries `total_exposure = 0.00`, so the predicate is false. The floor
    // is a monetary predicate and is exhaustively so."
    expect(isAboveDegradedApprovalFloor(money('0.00'))).toBe(false);
  });
});

describe('`51 §3.8` — the two timing thresholds, against the hand-authored reading', () => {
  it('mirror-lag CRITICAL is PT15M and full-halt is PT30M, in both transcriptions', () => {
    expect(DEGRADED_MODE_TIMING.mirrorLagCriticalMs).toBe(ORACLE_MIRROR_LAG_CRITICAL_MS);
    expect(DEGRADED_MODE_TIMING.auditUnreachableFullHaltMs).toBe(ORACLE_FULL_HALT_MS);
    // And the ISO-8601 notation `51 §3.8` prints, as minutes.
    expect(DEGRADED_MODE_TIMING.mirrorLagCriticalMs / 60_000).toBe(15);
    expect(DEGRADED_MODE_TIMING.auditUnreachableFullHaltMs / 60_000).toBe(30);
  });

  it('PT30M > PT15M — computed, not asserted', () => {
    // `30 §5.1` item 5 says "a LONGER threshold" and `30 §5.1a` says "`30 minutes > 15
    // minutes` is required and is the point. The CRITICAL escalation must precede the halt
    // so the owner sees the condition before the company stops."
    //
    // Arithmetic over the two constants, so an edit that collapses them fails here and not
    // only in the architecture gate.
    expect(DEGRADED_MODE_TIMING.auditUnreachableFullHaltMs).toBeGreaterThan(
      DEGRADED_MODE_TIMING.mirrorLagCriticalMs,
    );
  });
});

describe('`51 §3.8` — the relationship to attestation, aligned but NOT merged', () => {
  it('the lag threshold equals `attestation_cadence × k`, which is the accepted 15-minute bound', () => {
    // `51 §3.8`: "`attestation_cadence` = 5 minutes and `k` = 3 give an existing 15-minute
    // attestation-silence bound (`30 §5.4`), and `mirror_lag_critical_threshold` is
    // **aligned** with it deliberately. **The concepts are not merged.**"
    //
    // `ATTESTATION_STALL_BOUND_MS` is S1G's ACCEPTED transcription of `cadence × k`, so this
    // asserts the alignment against a constant this pass did not write.
    expect(DEGRADED_MODE_TIMING.mirrorLagCriticalMs).toBe(ATTESTATION_STALL_BOUND_MS);
  });

  it('and the lag threshold is NOT the signal `max_age`', () => {
    // `30 §5.7.1`: `max_age` is 5 minutes and is "strictly less than `attestation_cadence ×
    // k` = 15 minutes". Three distinct operands, and the suite says so.
    expect(SIGNAL_MAX_AGE_MS).not.toBe(DEGRADED_MODE_TIMING.mirrorLagCriticalMs);
    expect(SIGNAL_MAX_AGE_MS).toBeLessThan(DEGRADED_MODE_TIMING.mirrorLagCriticalMs);
  });

  it('and neither threshold is any override quantity', () => {
    // `51 §3.8`: "Both are class 27 [...] `§3.6`'s quantities are unchanged." An override's
    // maximum duration is 24 hours; neither threshold is derived from it or equal to it.
    expect(DEGRADED_MODE_TIMING.auditUnreachableFullHaltMs).not.toBe(
      OVERRIDE_LIMITS.maxDurationMs,
    );
    expect(DEGRADED_MODE_TIMING.auditUnreachableFullHaltMs).toBeLessThan(
      OVERRIDE_LIMITS.maxDurationMs,
    );
  });
});

describe('`51 §3.8` — the mirror-lag CRITICAL boundary, INCLUSIVE at the threshold', () => {
  // `51 §3.8`: "`mirror_lag >= PT15M` is at or over the threshold. `14:59.999999` under,
  // `15:00.000000` at, `15:00.000001` over."
  //
  // `ACOS-JCS-1` declares 6 fractional digits; JavaScript's `Date` and PostgreSQL's
  // `timestamptz` subtraction here are at millisecond resolution, so the boundary is
  // asserted at ONE MILLISECOND either side, which is the finest unit this operand can
  // actually carry. The microsecond statement is the architecture's; this is the
  // implementation's honest precision and the suite says which is which.
  const T = DEGRADED_MODE_TIMING.mirrorLagCriticalMs;

  it('14:59.999 is WITHIN_THRESHOLD', () => {
    expect(classifyMirrorLag(T - 1)).toBe('WITHIN_THRESHOLD');
  });

  it('exactly 15:00.000 is CRITICAL — the threshold is inclusive', () => {
    expect(classifyMirrorLag(T)).toBe('CRITICAL');
  });

  it('15:00.001 — one millisecond over — is CRITICAL', () => {
    expect(classifyMirrorLag(T + 1)).toBe('CRITICAL');
  });

  it('an empty backlog is 0 and is WITHIN_THRESHOLD', () => {
    expect(classifyMirrorLag(0)).toBe('WITHIN_THRESHOLD');
  });

  it('and there is no third condition', () => {
    // `30 §5.1a` declares one condition with two values. A future third would be a state the
    // architecture does not declare.
    const seen = new Set([
      classifyMirrorLag(0),
      classifyMirrorLag(T - 1),
      classifyMirrorLag(T),
      classifyMirrorLag(T * 100),
    ]);
    expect([...seen].sort()).toEqual(['CRITICAL', 'WITHIN_THRESHOLD']);
  });
});

describe('`51 §3.8` — the FULL-HALT boundary, INCLUSIVE at the threshold', () => {
  // `51 §3.8`: "`continuous_unreachability >= PT30M` enters the FULL-HALT POSTURE.
  // `29:59.999999` outside, `30:00.000000` inside, `30:00.000001` inside."
  const T = DEGRADED_MODE_TIMING.auditUnreachableFullHaltMs;

  it('29:59.999 is NOT in the posture', () => {
    expect(isFullHaltPosture(T - 1)).toBe(false);
  });

  it('exactly 30:00.000 IS in the posture — the threshold is inclusive', () => {
    expect(isFullHaltPosture(T)).toBe(true);
  });

  it('30:00.001 — one millisecond over — IS in the posture', () => {
    expect(isFullHaltPosture(T + 1)).toBe(true);
  });

  it('and no declaration open means 0, which is not the posture', () => {
    // `30 §5.1a`: "`continuous_unreachability = 0`, when no declaration is open."
    expect(isFullHaltPosture(0)).toBe(false);
  });

  it('the 15-minute lag threshold alone does NOT enter the posture', () => {
    // The two thresholds are separate quantities. At 15 minutes the CRITICAL escalation
    // holds and the halt does not, which is the whole reason `PT30M > PT15M`.
    expect(classifyMirrorLag(DEGRADED_MODE_TIMING.mirrorLagCriticalMs)).toBe('CRITICAL');
    expect(isFullHaltPosture(DEGRADED_MODE_TIMING.mirrorLagCriticalMs)).toBe(false);
  });
});
