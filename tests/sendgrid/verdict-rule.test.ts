import { describe, expect, it } from 'vitest';

import { KILL_POINT_ROWS } from '../../validation/sendgrid/harness/killPoints.js';
import { verdictFor } from '../../validation/sendgrid/harness/scenarioDriver.js';
import type { ObservationResult } from '../../validation/sendgrid/harness/observation.js';

/**
 * `§10.1`, `§11.3` — THE VERDICT RULE, DRIVEN DIRECTLY.
 *
 * =================================================================================
 * WHY THIS IS A SEPARATE, PURE SUITE
 *
 * `tests/sendgrid/scenario-driver.test.ts` exercises the rule through a real Postgres backend
 * and two forked processes, which is the right way to prove the PATH. It is a poor way to
 * prove the RULE: the cases that matter most — a provider that answered and held one message
 * too many, a shortfall the provider positively showed — cannot be staged there without
 * corrupting the scenario they run in.
 *
 * So the rule is driven here over plain observation records, and every branch is reached.
 *
 * =================================================================================
 * THE RULE, IN FULL
 *
 *   an untrustworthy count (null)            -> UNRESOLVED
 *   local state disagrees                    -> FAIL
 *   the provider accepted MORE than expected -> FAIL, whichever observation produced it
 *   FEWER, and the provider ANSWERED         -> FAIL
 *   FEWER, and the correlation never appeared-> UNRESOLVED (`§10.1`)
 *   equal, and a ZERO rests on non-observation -> UNRESOLVED (`§10.1`)
 *   equal, every non-zero positively observed  -> PASS
 * =================================================================================
 */

const ROW_3 = KILL_POINT_ROWS.find((row) => row.point === 3)!;
const ROW_2 = KILL_POINT_ROWS.find((row) => row.point === 2)!;

/**
 * SECOND REVIEW `§4.4` — THE CASES BELOW RUN UNDER THE **FIXTURE** BOUND, DELIBERATELY.
 *
 * The rule has two independent halves: the COUNT half, driven exhaustively here, and the
 * SETTLING half added by defect 4, driven in `tests/sendgrid/live-finality.test.ts`. Holding
 * the bound at `FIXTURE_DETERMINISTIC` here keeps each case testing the half it names —
 * otherwise every PASS below would collapse to `UNRESOLVED` for a reason unrelated to counts.
 *
 * The settling fields are a parameter so both suites drive ONE helper, not two shapes.
 */
function observation(
  outcome: ObservationResult['outcome'],
  providerAcceptedCount: number | null,
  settling: Pick<ObservationResult, 'settlingIntervalCompleted' | 'visibilityBoundKind'> = {
    settlingIntervalCompleted: true,
    visibilityBoundKind: 'FIXTURE_DETERMINISTIC',
  },
): ObservationResult {
  return {
    outcome,
    correlationTag: 'acos-corr-00000000-0000-4000-8000-000000000000',
    attempts: [],
    providerAcceptedCount,
    providerMessageIds: [],
    stabilisationObservationsOutstanding: 0,
    ...settling,
  };
}

const OBSERVED_ONE = observation('PROVIDER_ACTIVITY_OBSERVED', 1);
const OBSERVED_TWO = observation('PROVIDER_ACTIVITY_OBSERVED', 2);
const OBSERVED_NONE = observation('PROVIDER_ACTIVITY_OBSERVED', 0);
const NOT_OBSERVED = observation('NOT_OBSERVED_WITHIN_BOUND', 0);
const UNRESOLVED_COUNT = observation('STABILISATION_UNRESOLVED', null);

/** Row 3's local half, met exactly, so every case below turns on the PROVIDER half. */
const LOCAL_OK_3 = {
  row: ROW_3,
  localOutboxStatus: ROW_3.expectedOutboxStatus,
  localOutcomeRows: ROW_3.expectedOutcomeRowsInSeparateProcessComposition ?? ROW_3.expectedOutcomeRows,
  recovery: ROW_3.expectedRecovery,
};

describe('`§11.3` — NO ROW PASSES ON LOCAL EXPECTATIONS ALONE', () => {
  it('a row whose counts match and were POSITIVELY OBSERVED passes', () => {
    const { verdict, note } = verdictFor({
      ...LOCAL_OK_3,
      observationBefore: OBSERVED_ONE,
      observationAfter: OBSERVED_ONE,
    });
    expect(verdict).toBe('PASS');
    expect(note).toContain('POSITIVELY OBSERVED');
  });

  it('local state that disagrees FAILS however good the provider half is', () => {
    expect(
      verdictFor({
        ...LOCAL_OK_3,
        localOutboxStatus: 'ENQUEUED',
        observationBefore: OBSERVED_ONE,
        observationAfter: OBSERVED_ONE,
      }).verdict,
    ).toBe('FAIL');
  });

  it('an untrustworthy count is UNRESOLVED, never a pass and never a fail', () => {
    for (const [before, after] of [
      [UNRESOLVED_COUNT, OBSERVED_ONE],
      [OBSERVED_ONE, UNRESOLVED_COUNT],
    ] as const) {
      const { verdict } = verdictFor({
        ...LOCAL_OK_3,
        observationBefore: before,
        observationAfter: after,
      });
      expect(verdict).toBe('UNRESOLVED');
    }
  });

  it('a row with NO observation at all is NOT_RUN', () => {
    expect(
      verdictFor({ ...LOCAL_OK_3, observationBefore: null, observationAfter: null }).verdict,
    ).toBe('NOT_RUN');
  });
});

describe('`§10.1` — AN EXCESS FAILS; A SHORTFALL DEPENDS ON WHETHER THE PROVIDER ANSWERED', () => {
  it('**AN EXCESS FAILS** — this is the condition `I36` exists to exclude', () => {
    const { verdict, note } = verdictFor({
      ...LOCAL_OK_3,
      observationBefore: OBSERVED_ONE,
      observationAfter: OBSERVED_TWO,
    });
    expect(verdict).toBe('FAIL');
    expect(note).toContain('accepted MORE messages');
  });

  it('and an excess on a ZERO-expectation row fails too', () => {
    const { verdict } = verdictFor({
      row: ROW_2,
      localOutboxStatus: ROW_2.expectedOutboxStatus,
      localOutcomeRows: ROW_2.expectedOutcomeRows,
      recovery: ROW_2.expectedRecovery,
      observationBefore: OBSERVED_ONE,
      observationAfter: OBSERVED_ONE,
    });
    expect(verdict).toBe('FAIL');
  });

  it('a SHORTFALL the provider POSITIVELY SHOWED is a FAIL', () => {
    /*
     * The provider answered, repeatedly, and held nothing for this correlation. That is a
     * measurement, not an absence of one, and a row expecting an accepted message fails on it.
     */
    const { verdict, note } = verdictFor({
      ...LOCAL_OK_3,
      observationBefore: OBSERVED_NONE,
      observationAfter: OBSERVED_NONE,
    });
    expect(verdict).toBe('FAIL');
    expect(note).toContain('ANSWERED and held fewer');
  });

  it('a SHORTFALL that is a bounded NON-OBSERVATION is UNRESOLVED', () => {
    /*
     * `§10.1`. The correlation never became visible within the bound. Provider latency and a
     * message that never left read identically, so the row is neither passed nor failed.
     */
    const { verdict, note } = verdictFor({
      ...LOCAL_OK_3,
      observationBefore: NOT_OBSERVED,
      observationAfter: NOT_OBSERVED,
    });
    expect(verdict).toBe('UNRESOLVED');
    expect(note).toContain('did not become visible within the bound');
  });

  it('a ZERO expectation MET by a non-observation is UNRESOLVED, not PASS', () => {
    /*
     * THE HONEST CEILING ON POINTS 1 AND 2. Every local expectation is met and nothing was
     * observed, which is exactly what the row expects — and it still cannot pass, because
     * Email Activity supplies no complete-absence guarantee.
     */
    const { verdict, note } = verdictFor({
      row: ROW_2,
      localOutboxStatus: ROW_2.expectedOutboxStatus,
      localOutcomeRows: ROW_2.expectedOutcomeRows,
      recovery: ROW_2.expectedRecovery,
      observationBefore: NOT_OBSERVED,
      observationAfter: NOT_OBSERVED,
    });
    expect(verdict).toBe('UNRESOLVED');
    expect(note).toContain('not proof of never-sent');
  });

  it('but a ZERO expectation met by a POSITIVE observation of nothing DOES pass', () => {
    /*
     * The one way a zero-expectation row can pass: the provider ANSWERED and held nothing.
     * `observeCorrelation` reports that as `PROVIDER_ACTIVITY_OBSERVED` only when a matching
     * record was seen, so in practice this case needs a provider-reporting surface that can
     * affirm absence — which SendGrid's does not. It is asserted here so the RULE is complete
     * and so a future provider that CAN affirm absence is already handled.
     */
    const { verdict } = verdictFor({
      row: ROW_2,
      localOutboxStatus: ROW_2.expectedOutboxStatus,
      localOutcomeRows: ROW_2.expectedOutcomeRows,
      recovery: ROW_2.expectedRecovery,
      observationBefore: OBSERVED_NONE,
      observationAfter: OBSERVED_NONE,
    });
    expect(verdict).toBe('PASS');
  });
});
