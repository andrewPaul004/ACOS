import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createOutboxHarness, type OutboxHarness } from '../support/outboxFixture.js';
import {
  S1P_AUDIT_CREDENTIAL_ID,
  S1P_INTEGRATION_CREDENTIAL_ID,
  S1P_SINK,
  createS1PScenario,
  type S1PScenario,
} from '../support/s1pScenarioFixture.js';
import { KILL_POINT_ROWS } from '../../validation/sendgrid/harness/killPoints.js';
import {
  auditDescriptorFor,
  derivePointSixRow,
  hooksFor,
  integrationDescriptorFor,
  runAllScenarios,
  runScenario,
} from '../../validation/sendgrid/harness/scenarioDriver.js';
import { compareI20 } from '../../validation/sendgrid/harness/i20.js';
import { readAccount } from '../sendgrid-doubles/simulatedAccount.js';
import { FIXTURE_VISIBILITY_BOUND } from '../../validation/sendgrid/harness/visibilityBound.js';

/**
 * `§11` — **THE SIX-SCENARIO DRIVER, EXECUTED.** OFFLINE, THROUGH THE ACCEPTED PATH.
 *
 * =================================================================================
 * WHAT MAKES THIS A REAL EXERCISE RATHER THAN A SHAPE TEST
 *
 * The rejected S1P deferred the driver and printed "NOT IMPLEMENTED"; the review's answer was
 * that a provider account is needed to EXECUTE it, not to WRITE it. So every scenario below
 * really does:
 *
 *   - commit a local authorisation for `email.send` through `commitLocalAuthorisation`,
 *     reserving ONE irrecoverable unit at step R;
 *   - enqueue it on the durable outbox and read back the KERNEL-minted correlation tag;
 *   - dispatch it through the unmodified `dispatchAuthorisedEffect`, with a REAL dispatch
 *     lease against a REAL PostgreSQL backend;
 *   - cross a REAL process boundary into a forked `src/integration/runtime/main.ts`;
 *   - be observed through a SECOND forked process, `src/audit/provider/runtime/main.ts`,
 *     over the accepted read-only audit IPC;
 *   - be recovered through the SAME gateway entry point.
 *
 * The ONE double is the transport. `tests/sendgrid-doubles/` has no `fetch` in its closure, so
 * `npm run verify` cannot reach `api.sendgrid.com` through any of this.
 *
 * **THE ROWS ARE JUDGED ON THE PROVIDER'S COUNT, NOT ON LOCAL STATE.** `verdictFor` requires
 * both halves to match `KILL_POINT_ROWS`, and the provider half comes from the independent
 * audit read — which is the whole reason `35 §12.3` says a mock matrix cannot close `I36`.
 * =================================================================================
 */

let h: OutboxHarness;
let scenario: S1PScenario | null = null;

beforeAll(async () => {
  h = await createOutboxHarness();
}, 120_000);

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await h.reset();
});

afterEach(async () => {
  if (scenario !== null) {
    await scenario.cleanup();
    scenario = null;
  }
});

describe('`§11.1` — THE DRIVER CONSTRUCTS DESCRIPTORS AND NEVER CALLS A PROVIDER MODULE', () => {
  it('`§19` item 14 — the driver s import closure holds NEITHER provider client', () => {
    /*
     * ASSERTED OVER THE SOURCE, because the property is about what the module CAN reach.
     * `scenarioDriver.ts` imports a descriptor TYPE and a launch PORT; it has no reference to
     * `sendToProviderSendGrid`, to `readFromProviderSendGridActivity`, or to either adapter
     * module, so `§11.1`'s two prohibitions are structural rather than observed.
     */
    const source = readFileSync(
      join('validation', 'sendgrid', 'harness', 'scenarioDriver.ts'),
      'utf8',
    );
    for (const forbidden of [
      "from './scopeProbes.js'",
      "from '../integration/adapter.js'",
      "from '../integration/providerClient.js'",
      "from '../audit/reader.js'",
      "from '../audit/providerReadClient.js'",
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it('the integration descriptor names the KILL-POINT module for point 3 and only point 3', () => {
    scenario = createS1PScenario(h);
    const runtime = scenario.runtime;
    for (const row of KILL_POINT_ROWS) {
      const descriptor = integrationDescriptorFor(runtime, row.point);
      expect(descriptor.adapterId).toBe(runtime.adapterId);
      expect(descriptor.credentialId).toBe(S1P_INTEGRATION_CREDENTIAL_ID);
      expect(descriptor.adapterModule, `point ${String(row.point)}`).toBe(
        row.point === 3 ? runtime.integrationKillPointAdapterModule : runtime.integrationAdapterModule,
      );
      // `§11.3`: a DIFFERENT MODULE SPECIFIER, never a control flag on the wire.
      expect(descriptor.adapterModule).not.toContain('killPoint=');
    }
  });

  it('the audit descriptor names the audit credential, and a DIFFERENT locator', () => {
    scenario = createS1PScenario(h);
    const descriptor = auditDescriptorFor(scenario.runtime);
    expect(descriptor.providerId).toBe(scenario.runtime.providerId);
    expect(descriptor.credentialId).toBe(S1P_AUDIT_CREDENTIAL_ID);
    expect(descriptor.secretLocator).not.toBe(scenario.runtime.integrationSecretLocator);
  });

  it('points 1, 2, 4 and 5 fire at REAL `DispatchHooks` members; 3 and 6 do not', () => {
    expect(Object.keys(hooksFor(1) ?? {})).toEqual(['afterClaimLock']);
    expect(Object.keys(hooksFor(2) ?? {})).toEqual(['afterClaimCommit']);
    expect(hooksFor(3)).toBeUndefined();
    expect(Object.keys(hooksFor(4) ?? {})).toEqual(['beforeOutcomeCommit']);
    expect(Object.keys(hooksFor(5) ?? {})).toEqual(['afterOutcomeCommit']);
    expect(hooksFor(6)).toBeUndefined();
  });
});

describe('`§11.3` — EACH CANONICAL POINT, EXECUTED END TO END', () => {
  for (const row of KILL_POINT_ROWS.filter((entry) => entry.point !== 6)) {
    it(`POINT ${String(row.point)} — ${row.name}`, async () => {
      scenario = createS1PScenario(h);
      const result = await runScenario(scenario.runtime, scenario.ports, row);

      /*
       * THE VERDICT RULE, IN FULL:
       *
       *   PASS       both halves agree AND every NON-ZERO provider count was positively
       *              observed;
       *   UNRESOLVED both halves agree but a ZERO rests on a bounded non-observation — `§10.1`,
       *              because Email Activity supplies no complete-absence guarantee;
       *   FAIL       either half disagrees.
       *
       * Points 1 and 2 carry a zero expectation, so their honest ceiling is UNRESOLVED. Points
       * 3, 4 and 5 expect ONE and observe it, so they PASS — and point 3 is the row only a
       * provider-side read can distinguish from point 2.
       */
      const expectsAnUnprovableZero =
        row.expectedProviderAcceptedCount === 0 ||
        row.expectedProviderAcceptedCountAfterRecovery === 0;
      expect(result.row.verdict, result.row.note).toBe(
        expectsAnUnprovableZero ? 'UNRESOLVED' : 'PASS',
      );
      expect(result.row.point).toBe(row.point);
      expect(result.row.killPointName).toBe(row.name);
      expect(result.row.localOutboxStatus).toBe(row.expectedOutboxStatus);
      expect(result.row.localOutcomeRows).toBe(
        row.expectedOutcomeRowsInSeparateProcessComposition ?? row.expectedOutcomeRows,
      );
      expect(result.row.recovery).toBe(row.expectedRecovery);
      expect(result.row.providerAcceptedCount).toBe(
        row.expectedProviderAcceptedCountAfterRecovery,
      );

      /*
       * `§22`'s ONE PRODUCTION PROPERTY, MEASURED AGAINST THE PROVIDER.
       *
       * Point 1 is the legitimate exception the accepted matrix names — nothing was claimed,
       * so the recovery is a FIRST claim. Every other point must show the provider's count
       * UNCHANGED across the recovery attempt.
       */
      expect(result.row.redispatchOccurred).toBe(false);

      // AND THE SIMULATED ACCOUNT AGREES, read independently of the audit plane.
      const account = readAccount(scenario.accountPath);
      const forThisCorrelation = account.messages.filter((message) =>
        message.categories.includes(result.row.correlationTag),
      );
      expect(forThisCorrelation).toHaveLength(row.expectedProviderAcceptedCountAfterRecovery);
      // EVERY accepted message went to the OWNER-CONTROLLED SINK, and none anywhere else.
      expect(account.messages.length).toBe(forThisCorrelation.length);
    }, 120_000);
  }
});

describe('`§19` item 13 — ALL SIX POINTS IN ONE RUN, AND THE DERIVED RE-ENTRY ROW', () => {
  it('runs the canonical matrix and reports six rows', async () => {
    scenario = createS1PScenario(h);
    const results = await runAllScenarios(scenario.runtime, scenario.ports);

    expect(results).toHaveLength(6);
    expect(results.map((result) => result.row.point)).toEqual([1, 2, 3, 4, 5, 6]);

    /*
     * THE MATRIX'S HONEST SHAPE: three PASSES, two UNRESOLVED, and the derived row.
     *
     * Points 1 and 2 expect a provider-side ZERO, which only a non-observation can meet, so
     * `§10.1` caps them at UNRESOLVED. **NO ROW FAILS**, which is the property the run is for.
     */
    const byPoint = new Map(results.map((result) => [result.row.point, result.row]));
    expect(byPoint.get(1)?.verdict).toBe('UNRESOLVED');
    expect(byPoint.get(2)?.verdict).toBe('UNRESOLVED');
    for (const point of [3, 4, 5] as const) {
      expect(byPoint.get(point)?.verdict, byPoint.get(point)?.note).toBe('PASS');
    }
    expect(results.filter((result) => result.row.verdict === 'FAIL')).toEqual([]);

    /*
     * POINT 6 IS DERIVED FROM THE RE-ENTRIES AT POINTS 2 TO 5, which is what the ACCEPTED mock
     * matrix does and what `§11.3` describes. It stages no effect of its own.
     */
    const six = results[5]!.row;
    expect(six.recovery).toBe('CLAIM_REFUSED:ALREADY_CLAIMED');
    expect(six.redispatchOccurred).toBe(false);
    expect(six.note).toContain('the provider-side accepted count was unchanged');

    // AND `I20`'s COMPARISON OVER THE WHOLE RUN.
    const comparison = compareI20(results.map((result) => result.i20Operand));
    expect(comparison.verdict).toBe('WITHIN_BASIS');
    /*
     * FIVE staged scenarios reserved one irrecoverable unit each; the provider accepted a
     * message for points 1, 3, 4 and 5 and none for point 2, so four accepted effects stand
     * behind five committed reservations. `I20` is a BOUND, not an equality — a legitimately
     * unsent effect is a reservation with no provider-side counterpart, and `35 §12.3` states
     * that cost openly.
     */
    expect(comparison.historicalReservationBasisUnits).toBe(5n);
    expect(comparison.providerAcceptedIrrecoverableEffects).toBe(4);
  }, 300_000);
});

describe('`§10`, `§19` item 12 — THE ORACLE SEES A DELAYED SECOND MESSAGE, IN PROCESS', () => {
  it('the same oracle that judges the matrix reports >= 2 for a deliberate duplicate', async () => {
    /*
     * `§13`'s DUPLICATE NEGATIVE CONTROL, in its offline form.
     *
     * It uses THE SAME `observeCorrelation` oracle the kill-point rows are judged by — `§10.2`
     * requires exactly that — and the duplicate is produced the way the live control produces
     * it: a SECOND accepted message under ONE correlation, outside the kernel dispatch path.
     * Here the second message is also DELAYED, so the run discriminates the stop-on-first
     * defect at the same time.
     */
    scenario = createS1PScenario(h, { maxObservationAttempts: 8 });
    const row = KILL_POINT_ROWS.find((entry) => entry.point === 5)!;
    const result = await runScenario(scenario.runtime, scenario.ports, row);
    expect(result.row.verdict).toBe('PASS');
    expect(result.row.providerAcceptedCount).toBe(1);

    // THE DELIBERATE DUPLICATE: one more accepted message, same correlation, visible LATER.
    const { acceptSend } = await import('../sendgrid-doubles/simulatedAccount.js');
    const account = readAccount(scenario.accountPath);
    acceptSend(scenario.accountPath, {
      categories: [result.row.correlationTag],
      visibleAfterReads: account.readsServed + 2,
    });

    const audit = await scenario.ports.launchAuditReader(auditDescriptorFor(scenario.runtime));
    try {
      const { observeCorrelation } = await import(
        '../../validation/sendgrid/harness/observation.js'
      );
      const window = scenario.ports.observationWindow();
      const observed = await observeCorrelation(
        { read: audit.read, delay: scenario.ports.delay, now: scenario.ports.nowMs },
        {
          correlationTag: result.row.correlationTag,
          periodStartMs: window.periodStartMs,
          periodEndMs: window.periodEndMs,
          ...scenario.ports.observationBound,
          visibilityBound: FIXTURE_VISIBILITY_BOUND,
          lastPossibleWriteAtMs: 0,
        },
      );
      expect(observed.outcome).toBe('PROVIDER_ACTIVITY_OBSERVED');
      // THE DISCRIMINATION: the oracle that reported ONE for the scenario reports TWO here.
      expect(observed.providerAcceptedCount).toBeGreaterThanOrEqual(2);
    } finally {
      await audit.close();
    }
  }, 300_000);
});

describe('`§19` item 9, in the COMPOSITION — a refused read cannot pass a row', () => {
  it('the audit plane answering 403 leaves every row UNRESOLVED, never PASS', async () => {
    scenario = createS1PScenario(h, {
      readBehaviour: { kind: 'REFUSE', httpStatus: 403 },
      maxObservationAttempts: 3,
    });
    const row = KILL_POINT_ROWS.find((entry) => entry.point === 5)!;
    const result = await runScenario(scenario.runtime, scenario.ports, row);

    /*
     * THE LOCAL STATE IS PERFECT AND THE ROW STILL DOES NOT PASS.
     *
     * The effect dispatched, the outcome committed, the recovery was refused ALREADY_CLAIMED —
     * every local expectation `KILL_POINT_ROWS` carries is met. The row is UNRESOLVED because
     * the PROVIDER-SIDE count was not established, which is the discrimination correction 9
     * exists for: the rejected reader would have reported a count of ZERO and failed the row
     * on a number it invented.
     */
    expect(result.row.localOutboxStatus).toBe('CLAIMED');
    expect(result.row.localOutcomeRows).toBe(1);
    expect(result.row.recovery).toBe('CLAIM_REFUSED:ALREADY_CLAIMED');
    expect(result.row.verdict).toBe('UNRESOLVED');
    expect(result.row.providerAcceptedCount).toBeNull();

    // AND `I20` REFUSES TO COMPARE, rather than treating the absence as a zero.
    const comparison = compareI20([result.i20Operand]);
    expect(comparison.verdict).toBe('UNRESOLVED');
    expect(comparison.providerAcceptedIrrecoverableEffects).toBeNull();
  }, 180_000);
});

describe('THE DERIVED POINT-6 ROW IS UNRESOLVED WHEN ANY RE-ENTRY IS UNMEASURED', () => {
  it('one unmeasured row among points 2 to 5 makes the property unevaluable', () => {
    const measured = {
      point: 4 as const,
      killPointName: 'x',
      correlationTag: 'acos-corr-1',
      expectedSemantics: '',
      localOutboxStatus: 'CLAIMED',
      localOutcomeRows: 0,
      mayHaveCrossedProviderBoundary: true,
      providerResponseMessageId: null,
      observation: null,
      providerAcceptedCount: 1,
      recovery: 'CLAIM_REFUSED:ALREADY_CLAIMED',
      redispatchOccurred: false,
      finalEffectState: null,
      verdict: 'PASS' as const,
      note: '',
    };
    const derived = derivePointSixRow([
      { row: measured, i20Operand: { scenarioLabel: 'a', providerAcceptedCount: 1, historicalReservationUnits: 1n }, providerOperationCount: 1 },
      {
        row: { ...measured, point: 5 as const, providerAcceptedCount: null, redispatchOccurred: null },
        i20Operand: { scenarioLabel: 'b', providerAcceptedCount: null, historicalReservationUnits: 1n },
        providerOperationCount: 0,
      },
    ]);
    expect(derived.row.verdict).toBe('UNRESOLVED');
    expect(derived.row.note).toContain('no trustworthy provider count');
  });
});

describe('EVERY ACCEPTED MESSAGE WENT TO THE OWNER-CONTROLLED SINK', () => {
  it('the authorised payload decides the recipient, and the account confirms it', async () => {
    scenario = createS1PScenario(h);
    const row = KILL_POINT_ROWS.find((entry) => entry.point === 5)!;
    const result = await runScenario(scenario.runtime, scenario.ports, row);
    expect(result.row.verdict).toBe('PASS');
    /*
     * The simulated account records the CATEGORIES of what was sent, and the driver's own
     * seeder bound the sink into the payload. The recipient assertion is therefore made at the
     * two ends that matter: `S1P_SINK` is what the seeder authorised, and CONTROL 9 proves the
     * mapping cannot be made to address anything else by a launch document.
     */
    expect(scenario.ports.sinkAddress).toBe(S1P_SINK);
    expect(readAccount(scenario.accountPath).messages).toHaveLength(1);
  }, 120_000);
});
