import { describe, expect, it } from 'vitest';

import { KILL_POINT_ROWS } from '../../validation/sendgrid/harness/killPoints.js';
import {
  MAX_OBSERVATION_ATTEMPTS,
  MIN_STABILISATION_OBSERVATIONS,
  observeCorrelation,
  type ObservationBound,
  type ObservationDeps,
  type ObservationResult,
} from '../../validation/sendgrid/harness/observation.js';
import { verdictFor } from '../../validation/sendgrid/harness/scenarioDriver.js';
import {
  assertLiveUsable,
  boundSettlesLiveAbsence,
  observationModeLabel,
  FIXTURE_VISIBILITY_BOUND,
  SENDGRID_LIVE_VISIBILITY_BOUND,
  type VisibilityBound,
} from '../../validation/sendgrid/harness/visibilityBound.js';
import type { ProviderReadResult } from '../../src/audit/provider/runtime/auditProviderReader.js';
import type { ProviderEvidenceRecord } from '../../src/audit/provider/protocol/readWire.js';

/**
 * SECOND REVIEW, DEFECT 4 — **TWO SUCCESSFUL POLLS ARE NOT A LIVE `I36` FINALITY GUARANTEE.**
 *
 * =================================================================================
 * THE REJECTED BEHAVIOUR, STATED PLAINLY
 *
 * `MIN_STABILISATION_OBSERVATIONS = 2` was the SOLE condition that turned a real provider
 * count into a live no-duplicate conclusion. At the published 6-requests-per-minute rate that
 * is roughly twenty seconds of quiet, and the accepted S1O capability record documents no
 * reporting-lag guarantee whatsoever. A duplicate arriving in the twenty-first second would
 * have met a verdict that was already `PASS`.
 *
 * The review's fix is a conjunction, `§4.3`: the required samples AND completion of an
 * EVIDENCE-BACKED visibility interval measured from the LAST POSSIBLE WRITE (`§4.2`).
 *
 * =================================================================================
 * THE FOUR CASES `§4.4` NAMES, AND WHERE EACH IS DRIVEN BELOW
 *
 *   1  a duplicate that appears after two stable polls but before the bound closes must be
 *      counted as TWO, never ONE                       — "THE DELAYED DUPLICATE"
 *   2  no established live bound -> UNRESOLVED even with two stable samples
 *                                                      — "NO BOUND, NO CONCLUSION"
 *   3  a provider failure during the final interval -> UNRESOLVED
 *                                                      — "A FAILED READ SETTLES NOTHING"
 *   4  offline fixture mode is permitted and LABELLED offline evidence
 *                                                      — "THE FIXTURE MODE IS NAMED"
 *
 * Cases 1 and 3 need a bound that actually exists, so they use a `MEASURED_INTERVAL` **test
 * fixture**. That value is NOT a claim about SendGrid — `SENDGRID_LIVE_VISIBILITY_BOUND` stays
 * `UNESTABLISHED`, and the last describe block asserts it does. The fixture exists so the
 * mechanism can be proven now and a real measured bound can be dropped in later without
 * touching the oracle.
 * =================================================================================
 */

const TAG = 'acos-corr-00000000-0000-4000-8000-00000000004f';

/**
 * THE ROW WHOSE VERDICT ACTUALLY DEPENDS ON "AND NOTHING FURTHER APPEARED".
 *
 * One accepted message before the recovery and ONE after it — so a PASS is a statement
 * that the recovery produced no second message, which is precisely the claim a visibility
 * bound is needed to support. A zero-expectation row would test a different branch.
 */
const ROW_ONE_BEFORE_AND_AFTER = KILL_POINT_ROWS.find(
  (candidate) =>
    candidate.expectedProviderAcceptedCount === 1 &&
    candidate.expectedProviderAcceptedCountAfterRecovery === 1,
)!;

/**
 * A HYPOTHETICAL measured bound, for driving the mechanism. Sixty seconds, chosen only because
 * it is longer than the sampling window and shorter than the run budget.
 *
 * **`§4.1`'S "DO NOT INVENT A NUMBER" IS NOT VIOLATED BY THIS**: no production value, no
 * evidence bundle and no verdict outside this file is derived from it. `basis` says so.
 */
const MEASURED: VisibilityBound = {
  kind: 'MEASURED_INTERVAL',
  intervalMs: 60_000,
  basis:
    'TEST FIXTURE ONLY — a hypothetical interval used to drive the settling mechanism in ' +
    'tests/sendgrid/live-finality.test.ts. It is NOT a SendGrid measurement and no shipped ' +
    'value derives from it.',
};

function record(messageId: string): ProviderEvidenceRecord {
  return {
    providerMessageId: messageId,
    correlationTag: TAG,
    providerStatus: 'delivered',
    providerTimestampMs: 1_759_000_000_000,
  };
}

/** `EVIDENCE` carrying the given ids, in the shape the observation loop consumes. */
function evidence(...messageIds: readonly string[]): ProviderReadResult {
  const records = messageIds.map(record);
  return { kind: 'EVIDENCE', recordCount: records.length, records };
}

const UNAVAILABLE: ProviderReadResult = { kind: 'PROVIDER_UNAVAILABLE' };

/**
 * A CLOCK THAT ADVANCES ONE POLL INTERVAL PER READING, so elapsed time is exactly the number
 * of attempts and each case can say precisely when the interval closes.
 */
function scriptedDeps(script: readonly ProviderReadResult[], stepMs: number): ObservationDeps {
  let clock = 0;
  let index = 0;
  return {
    now: () => clock,
    delay: () => {
      clock += stepMs;
      return Promise.resolve();
    },
    read: () => {
      const next = script[Math.min(index, script.length - 1)]!;
      index += 1;
      return Promise.resolve(next);
    },
  };
}

function bound(overrides: Partial<ObservationBound>): ObservationBound {
  return {
    correlationTag: TAG,
    periodStartMs: 0,
    periodEndMs: 10_000_000,
    maxAttempts: 30,
    intervalMs: 10_000,
    maxDurationMs: 30 * 60 * 1000,
    maxRecords: 50,
    stabilisationObservations: MIN_STABILISATION_OBSERVATIONS,
    visibilityBound: FIXTURE_VISIBILITY_BOUND,
    lastPossibleWriteAtMs: 0,
    ...overrides,
  };
}

describe('`§4.4` CASE 1 — THE DELAYED DUPLICATE', () => {
  it('a duplicate appearing after two stable polls, while the bound is still open, counts TWO', async () => {
    /*
     * THE EXACT SEQUENCE THE REJECTED RULE CERTIFIED WRONGLY.
     *
     *   attempt 1   one message        -> DISCOVERY
     *   attempts 2-3  one message      -> both stabilisation samples discharged
     *   attempt 4+  TWO messages       -> the duplicate finally surfaces
     *
     * Under the old rule the loop stopped at attempt 3 with `providerAcceptedCount: 1` — the
     * same number a correctly non-duplicated send produces. With a 60s interval and a 10s
     * poll, the window cannot close before attempt 7, so the duplicate is seen.
     */
    const result = await observeCorrelation(
      scriptedDeps(
        [
          evidence('msg-1'),
          evidence('msg-1'),
          evidence('msg-1'),
          evidence('msg-1', 'msg-2'),
          evidence('msg-1', 'msg-2'),
          evidence('msg-1', 'msg-2'),
          evidence('msg-1', 'msg-2'),
          evidence('msg-1', 'msg-2'),
        ],
        10_000,
      ),
      bound({ visibilityBound: MEASURED, lastPossibleWriteAtMs: 0 }),
    );

    expect(result.outcome).toBe('PROVIDER_ACTIVITY_OBSERVED');
    // **THE ASSERTION THE REJECTED BEHAVIOUR FAILS.**
    expect(result.providerAcceptedCount).toBe(2);
    expect(result.providerAcceptedCount).not.toBe(1);
    expect(result.settlingIntervalCompleted).toBe(true);
    expect(result.providerMessageIds).toEqual(['msg-1', 'msg-2']);
  });

  it('and the window really does stay open past the samples: it ends only after the interval', async () => {
    /*
     * NON-VACUOUS. The case above must succeed because the WINDOW stayed open, not because the
     * script happened to be long. Here nothing ever changes, and the run still cannot finish
     * until 60_000ms have elapsed since the last possible write — attempt 7 at a 10s step.
     */
    const result = await observeCorrelation(
      scriptedDeps([evidence('msg-1')], 10_000),
      bound({ visibilityBound: MEASURED, lastPossibleWriteAtMs: 0 }),
    );

    expect(result.outcome).toBe('PROVIDER_ACTIVITY_OBSERVED');
    /*
     * EIGHT ATTEMPTS. The loop reads the clock BEFORE waiting, so attempt `n` is timed at
     * `(n - 2) x 10_000ms` for every attempt after the first; the first settling instant at or
     * beyond 60_000ms is therefore attempt 8, not attempt 7.
     */
    expect(result.attempts.length).toBe(8);
    const finalAttempt = result.attempts.at(-1)!;
    expect(finalAttempt.startedAtMs).toBeGreaterThanOrEqual(60_000);
    // The samples alone were discharged five attempts earlier and did NOT end the window.
    expect(MIN_STABILISATION_OBSERVATIONS).toBeLessThan(result.attempts.length - 1);
  });

  it('`§4.2` — the interval runs from the LAST POSSIBLE WRITE, not from the loop start', async () => {
    /*
     * THE PLACEMENT FAILURE `§4.2` NAMES: "initial send becomes visible / stabilization
     * completes / recovery occurs / duplicate appears afterward".
     *
     * SAME script, SAME budget, SAME bound as the case above — the ONLY difference is WHEN the
     * last possible write happened. At 0 the window closed at attempt 8 and the run settled.
     * At 50_000 — a recovery half a minute into the run — the interval cannot close before
     * 110_000ms, which is past `MAX_OBSERVATION_ATTEMPTS`, so the run ends UNSETTLED.
     *
     * Measuring from the LOOP would have settled both identically. That it does not is the
     * whole of `§4.2`, and the outcome here is the honest one: a run that could not wait long
     * enough reports no count rather than a premature one.
     */
    const result = await observeCorrelation(
      scriptedDeps([evidence('msg-1')], 10_000),
      bound({ visibilityBound: MEASURED, lastPossibleWriteAtMs: 50_000 }),
    );

    expect(result.outcome).toBe('STABILISATION_UNRESOLVED');
    expect(result.settlingIntervalCompleted).toBe(false);
    expect(result.providerAcceptedCount).toBeNull();
    // It spent its ENTIRE budget trying, rather than stopping at the samples.
    expect(result.attempts.length).toBe(MAX_OBSERVATION_ATTEMPTS);
    expect(result.stabilisationObservationsOutstanding).toBe(0);
  });
});

describe('`§4.4` CASE 2 — NO BOUND, NO CONCLUSION', () => {
  it('an UNESTABLISHED bound still REPORTS the count — the observation is not suppressed', async () => {
    /*
     * `§4.1`: "the live count may be observed, but a no-duplicate PASS remains UNRESOLVED".
     * Both halves matter. Withholding the count too would destroy the excess-detection that
     * needs no bound at all.
     */
    const result = await observeCorrelation(
      scriptedDeps([evidence('msg-1')], 10_000),
      bound({ visibilityBound: SENDGRID_LIVE_VISIBILITY_BOUND }),
    );

    expect(result.outcome).toBe('PROVIDER_ACTIVITY_OBSERVED');
    expect(result.providerAcceptedCount).toBe(1);
    // ...and the run is HONEST about what it did not establish.
    expect(result.settlingIntervalCompleted).toBe(false);
    expect(result.visibilityBoundKind).toBe('UNESTABLISHED');
  });

  it('but the VERDICT is UNRESOLVED, with both stabilisation samples discharged', () => {
    /*
     * THE HEART OF DEFECT 4. Every other condition of a `PASS` is satisfied — local state
     * matches, the counts match, the correlation was positively observed, both samples were
     * taken — and the row still cannot pass, because the claim it rests on is "no further
     * message appeared" and nothing establishes how long that takes for SendGrid.
     */
    const observed = (settling: Partial<ObservationResult>): ObservationResult =>
      ({
        outcome: 'PROVIDER_ACTIVITY_OBSERVED',
        correlationTag: TAG,
        attempts: [],
        providerAcceptedCount: 1,
        providerMessageIds: ['msg-1'],
        stabilisationObservationsOutstanding: 0,
        settlingIntervalCompleted: false,
        visibilityBoundKind: 'UNESTABLISHED',
        ...settling,
      }) as ObservationResult;

    const live = verdictFor({
      row: ROW_ONE_BEFORE_AND_AFTER,
      localOutboxStatus: ROW_ONE_BEFORE_AND_AFTER.expectedOutboxStatus,
      localOutcomeRows: ROW_ONE_BEFORE_AND_AFTER.expectedOutcomeRowsInSeparateProcessComposition ?? ROW_ONE_BEFORE_AND_AFTER.expectedOutcomeRows,
      recovery: ROW_ONE_BEFORE_AND_AFTER.expectedRecovery,
      observationBefore: observed({}),
      observationAfter: observed({}),
    });

    expect(live.verdict).toBe('UNRESOLVED');
    expect(live.note).toContain('visibility bound');

    /*
     * AND THE SAME ROW PASSES THE MOMENT A BOUND EXISTS AND CLOSES — so the `UNRESOLVED` above
     * is caused by the missing bound and by nothing else.
     */
    const settled = verdictFor({
      row: ROW_ONE_BEFORE_AND_AFTER,
      localOutboxStatus: ROW_ONE_BEFORE_AND_AFTER.expectedOutboxStatus,
      localOutcomeRows: ROW_ONE_BEFORE_AND_AFTER.expectedOutcomeRowsInSeparateProcessComposition ?? ROW_ONE_BEFORE_AND_AFTER.expectedOutcomeRows,
      recovery: ROW_ONE_BEFORE_AND_AFTER.expectedRecovery,
      observationBefore: observed({
        settlingIntervalCompleted: true,
        visibilityBoundKind: 'MEASURED_INTERVAL',
      }),
      observationAfter: observed({
        settlingIntervalCompleted: true,
        visibilityBoundKind: 'MEASURED_INTERVAL',
      }),
    });
    expect(settled.verdict).toBe('PASS');
  });

  it('an EXCESS is still a FAIL with no bound at all — seeing a duplicate needs no guarantee', () => {
    /*
     * THE ASYMMETRY, PRESERVED. A missing bound may only ever WITHHOLD a conclusion. It must
     * never soften a positive observation of a message that should not exist, because that
     * observation is self-evidencing: the record is there.
     */
    const two: ObservationResult = {
      outcome: 'PROVIDER_ACTIVITY_OBSERVED',
      correlationTag: TAG,
      attempts: [],
      providerAcceptedCount: 2,
      providerMessageIds: ['msg-1', 'msg-2'],
      stabilisationObservationsOutstanding: 0,
      settlingIntervalCompleted: false,
      visibilityBoundKind: 'UNESTABLISHED',
    } as ObservationResult;

    const outcome = verdictFor({
      row: ROW_ONE_BEFORE_AND_AFTER,
      localOutboxStatus: ROW_ONE_BEFORE_AND_AFTER.expectedOutboxStatus,
      localOutcomeRows: ROW_ONE_BEFORE_AND_AFTER.expectedOutcomeRowsInSeparateProcessComposition ?? ROW_ONE_BEFORE_AND_AFTER.expectedOutcomeRows,
      recovery: ROW_ONE_BEFORE_AND_AFTER.expectedRecovery,
      observationBefore: two,
      observationAfter: two,
    });

    expect(outcome.verdict).toBe('FAIL');
  });
});

describe('`§4.4` CASE 3 — A FAILED READ DURING THE FINAL INTERVAL SETTLES NOTHING', () => {
  it('the provider stops answering before the interval closes -> UNRESOLVED, count withheld', async () => {
    /*
     * The correlation was discovered and both samples were taken — and then the provider went
     * dark for the rest of the window. The old rule had already finished; the new one has not,
     * so the run exhausts its budget with the interval still open.
     *
     * `§4.3`: "any failed read that undermines the final interval resulting in UNRESOLVED".
     */
    const result = await observeCorrelation(
      scriptedDeps(
        [evidence('msg-1'), evidence('msg-1'), evidence('msg-1'), UNAVAILABLE],
        10_000,
      ),
      bound({ visibilityBound: MEASURED, maxAttempts: 6 }),
    );

    expect(result.outcome).toBe('STABILISATION_UNRESOLVED');
    expect(result.settlingIntervalCompleted).toBe(false);
    // A count that was never settled is NOT reported as a number.
    expect(result.providerAcceptedCount).toBeNull();

    const outcome = verdictFor({
      row: ROW_ONE_BEFORE_AND_AFTER,
      localOutboxStatus: ROW_ONE_BEFORE_AND_AFTER.expectedOutboxStatus,
      localOutcomeRows: ROW_ONE_BEFORE_AND_AFTER.expectedOutcomeRowsInSeparateProcessComposition ?? ROW_ONE_BEFORE_AND_AFTER.expectedOutcomeRows,
      recovery: ROW_ONE_BEFORE_AND_AFTER.expectedRecovery,
      observationBefore: result,
      observationAfter: result,
    });
    expect(outcome.verdict).toBe('UNRESOLVED');
  });

  it('a failed read does NOT discharge a sample, so the two are not merely elapsed time', async () => {
    /*
     * Guards the older correction (`§10`) against regression from this one: an unavailable
     * read consumes an attempt and discharges nothing, in either phase.
     */
    const result = await observeCorrelation(
      scriptedDeps([evidence('msg-1'), UNAVAILABLE], 10_000),
      bound({ visibilityBound: MEASURED, maxAttempts: 5 }),
    );

    expect(result.outcome).toBe('STABILISATION_UNRESOLVED');
    expect(result.stabilisationObservationsOutstanding).toBe(MIN_STABILISATION_OBSERVATIONS);
  });
});

describe('`§4.4` CASE 4 — THE FIXTURE MODE IS PERMITTED, AND NAMED', () => {
  it('a fixture run settles immediately and says, in its own label, that it is offline', async () => {
    const result = await observeCorrelation(
      scriptedDeps([evidence('msg-1')], 10_000),
      bound({ visibilityBound: FIXTURE_VISIBILITY_BOUND }),
    );

    expect(result.outcome).toBe('PROVIDER_ACTIVITY_OBSERVED');
    expect(result.providerAcceptedCount).toBe(1);
    expect(result.settlingIntervalCompleted).toBe(true);
    expect(result.visibilityBoundKind).toBe('FIXTURE_DETERMINISTIC');

    // `§4.4`'s labelling requirement, read from the string that reaches the evidence bundle.
    const label = observationModeLabel(FIXTURE_VISIBILITY_BOUND);
    expect(label).toContain('OFFLINE FIXTURE EVIDENCE');
    expect(label.toLowerCase()).not.toContain('sendgrid');
  });

  it('the live label for SendGrid states the absence instead of implying a guarantee', () => {
    const label = observationModeLabel(SENDGRID_LIVE_VISIBILITY_BOUND);
    expect(label).toContain('NO ESTABLISHED VISIBILITY BOUND');
  });

  it('a LIVE composition cannot borrow the fixture bound', () => {
    // The single way defect 4 could return. Refused where a live run names its bound.
    expect(() => assertLiveUsable(FIXTURE_VISIBILITY_BOUND)).toThrow(/OFFLINE fixture/);
    // `UNESTABLISHED` is PERMITTED: honest, and it downgrades conclusions rather than faking.
    expect(assertLiveUsable(SENDGRID_LIVE_VISIBILITY_BOUND)).toBe(SENDGRID_LIVE_VISIBILITY_BOUND);
  });
});

describe('THE SHIPPED SENDGRID BOUND IS STILL UNESTABLISHED', () => {
  it('no number has been invented for SendGrid, and the reason is recorded', () => {
    /*
     * `§4.1`: "Do NOT invent a number." This is the assertion that fails if a later change
     * quietly supplies one without the owner-accepted evidence the review requires.
     */
    expect(SENDGRID_LIVE_VISIBILITY_BOUND.kind).toBe('UNESTABLISHED');
    expect(boundSettlesLiveAbsence(SENDGRID_LIVE_VISIBILITY_BOUND)).toBe(false);
    if (SENDGRID_LIVE_VISIBILITY_BOUND.kind !== 'UNESTABLISHED') return;
    expect(SENDGRID_LIVE_VISIBILITY_BOUND.why).toContain('NO ');
  });

  it('`MIN_STABILISATION_OBSERVATIONS` alone can no longer settle a live absence', () => {
    // The rejected rule, stated as a property: samples are necessary, never sufficient.
    expect(MIN_STABILISATION_OBSERVATIONS).toBeGreaterThan(0);
    expect(boundSettlesLiveAbsence(FIXTURE_VISIBILITY_BOUND)).toBe(false);
    expect(boundSettlesLiveAbsence(MEASURED)).toBe(true);
  });
});
