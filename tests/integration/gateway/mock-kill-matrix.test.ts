import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { COMPANY_ID } from '../../support/fixture.js';
import {
  S1I_NOW,
  authorisePause,
  createOutboxHarness,
  outboxRows,
  type AuthorisedEffect,
  type OutboxHarness,
} from '../../support/outboxFixture.js';
import {
  ADAPTER_ADS,
  dispatchEnv,
  dispatchEnvWith,
  outcomeJournalRows,
  rawOutcomeRows,
  testRegistry,
} from '../../support/gatewayFixture.js';
import { createMockAdapter, returnedOutcome } from '../../support/mockAdapter.js';
import type { MockAdapter } from '../../support/mockAdapter.js';
import { enqueueDispatch } from '../../../src/kernel/outbox/enqueue.js';
import { dispatchAuthorisedEffect } from '../../../src/kernel/gateway/effectGateway.js';
import { liveCapabilityCount } from '../../../src/kernel/gateway/dispatchCapability.js';

/**
 * `§22`, `§23` — THE SIX KILL POINTS, AGAINST THE DETERMINISTIC MOCK.
 *
 * =================================================================================
 * WHAT THIS SUITE IS, AND — MORE IMPORTANTLY — WHAT IT IS NOT
 *
 * `§22` names six conceptual dispatch kill points and requires the mock to expose an
 * independent call/accepted counter "so tests know how many times it was invoked", with one
 * production property to hold across all of them:
 *
 *     "No recovery path invokes the mock a second time for an already-claimed effect."
 *
 * AND THEN, IN CAPITALS:
 *
 *     "THIS MOCK MATRIX DOES NOT CLOSE THE REAL I36 VALIDATION GATE."
 *
 * `phase2-v1.3.4-errata.md` SEQ-01 and `37 §2` both put the closing leg elsewhere:
 * "`I36`'s declared verification — the six kill points of `44 §5.2` against a **real ESP
 * sandbox**, measured by the provider's own accepted count — and `I20`." The registry says
 * the same in its own two-leg split: "ENFORCEMENT: attack the state machine directly [...]
 * VERIFICATION: kill at each of the six points in `44 §5.2` against the **real ESP
 * sandbox** and assert exactly one accepted message. **An outbox row count is not a
 * provider accepted count.**"
 *
 * `35 §12.3` says why a mock cannot substitute: "**a mock with a naive idempotency
 * implementation passes while the vendor would not.**"
 *
 * So what follows is `I36`'s LOCAL COMPOSITION leg. `mock.acceptedCount` is this process's
 * count of times its own in-process function reached its own acceptance point. It is not a
 * provider's accepted count, there is no provider, and `I36`'s verification leg and `I20`
 * both stay OPEN.
 * =================================================================================
 */

let h: OutboxHarness;
const NOW = S1I_NOW;
const LATER = new Date(S1I_NOW.getTime() + 6 * 60 * 60 * 1000);

beforeAll(async () => {
  h = await createOutboxHarness();
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await h.reset();
});

async function enqueuedPause(tag: string): Promise<AuthorisedEffect> {
  const effect = await authorisePause(h, { resourceId: `CMP-${tag}` });
  const outcome = await enqueueDispatch(h.control, {
    companyId: COMPANY_ID,
    effectId: effect.effectId,
    outboxId: `outbox:${tag}`,
    payloadCanonicalBytes: effect.payloadCanonicalBytes,
    now: NOW,
  });
  expect(outcome.kind).toBe('ENQUEUED');
  return effect;
}

/** One row of the matrix, measured. */
interface KillRow {
  readonly point: string;
  readonly mockCalls: number;
  readonly mockAccepted: number;
  readonly outboxStatus: string;
  readonly outcomeRows: number;
  readonly outcomeJournalRows: number;
  readonly liveCapabilities: number;
  /** What the RECOVERY attempt did, and what the counter read afterwards. */
  readonly recovery: string;
  readonly mockCallsAfterRecovery: number;
}

async function measure(
  point: string,
  tag: string,
  mockOptions: { readonly afterAccepted?: () => Promise<void> },
  hooks: Parameters<typeof dispatchAuthorisedEffect>[2] extends undefined
    ? never
    : NonNullable<Parameters<typeof dispatchAuthorisedEffect>[2]>['hooks'],
  expectThrow: boolean,
): Promise<{ readonly row: KillRow; readonly mock: MockAdapter }> {
  const effect = await enqueuedPause(tag);
  const mock = createMockAdapter({
    adapterId: ADAPTER_ADS,
    resolutionCapabilities: ['IDEMPOTENCY_HEADER'],
    outcome: returnedOutcome(),
    ...(mockOptions.afterAccepted === undefined
      ? {}
      : { afterAccepted: mockOptions.afterAccepted }),
  });
  const registry = testRegistry(mock);

  const run = dispatchAuthorisedEffect(
    dispatchEnvWith(h, registry),
    
    {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      dispatchedBy: 'worker:kill',
      now: NOW,
    },
    hooks === undefined ? undefined : { hooks },
  );
  if (expectThrow) {
    await expect(run).rejects.toThrow();
  } else {
    await run;
  }

  const afterCrash = {
    mockCalls: mock.callCount,
    mockAccepted: mock.acceptedCount,
    outboxStatus: (await outboxRows(h.control))[0]!.status,
    outcomeRows: (await rawOutcomeRows(h.control)).length,
    outcomeJournalRows: (await outcomeJournalRows(h.control)).length,
    liveCapabilities: liveCapabilityCount(),
  };

  // KILL POINT 6 — "recovery/re-entry attempt". The SAME production entry point, called
  // again, with the SAME registry, after the notional restart.
  const recovery = await dispatchAuthorisedEffect(dispatchEnvWith(h, registry),  {
    companyId: COMPANY_ID,
    idempotencyKey: effect.idempotencyKey,
    dispatchedBy: 'worker:recovered',
    now: LATER,
  });

  return {
    row: {
      point,
      ...afterCrash,
      recovery:
        recovery.kind === 'CLAIM_REFUSED'
          ? `CLAIM_REFUSED:${recovery.reason}`
          : recovery.kind,
      mockCallsAfterRecovery: mock.callCount,
    },
    mock,
  };
}

describe('`§22` — THE SIX POINTS, ONE ROW EACH', () => {
  it('POINT 1 — before the claim commits: nothing claimed, nothing invoked', async () => {
    /*
     * The kill is INSIDE the ACCEPTED S1I claim transaction, at its `afterLock` hook, so
     * the claim's own `BEGIN` is rolled back. `25 §7`: the transition happens "in a
     * committed transaction"; an uncommitted one is not a transition.
     *
     * THIS IS THE ONLY POINT WHERE RECOVERY LEGITIMATELY DISPATCHES, and it is legitimate
     * precisely because nothing was claimed: the row is still `ENQUEUED`, so a later claim
     * is a FIRST claim and not a re-dispatch. `I36` is about `CLAIMED` rows.
     */
    const { row, mock } = await measure(
      'before claim COMMIT',
      'kill-1',
      {},
      { afterClaimLock: () => Promise.reject(new Error('SIGKILL inside the claim tx')) },
      true,
    );
    expect(row.mockCalls).toBe(0);
    expect(row.mockAccepted).toBe(0);
    expect(row.outboxStatus).toBe('ENQUEUED');
    expect(row.outcomeRows).toBe(0);
    expect(row.liveCapabilities).toBe(0);
    // Recovery: a FIRST claim, and it succeeds. One invocation total.
    expect(row.recovery).toBe('OUTCOME_RESOLVED');
    expect(row.mockCallsAfterRecovery).toBe(1);
    expect(mock.acceptedCount).toBe(1);
  });

  it('POINT 2 — after claim COMMIT, before invocation: CLAIMED, and never invoked', async () => {
    const { row } = await measure(
      'after claim COMMIT, before invocation',
      'kill-2',
      {},
      { afterClaimCommit: () => Promise.reject(new Error('SIGKILL after claim COMMIT')) },
      true,
    );
    expect(row.mockCalls).toBe(0);
    expect(row.outboxStatus).toBe('CLAIMED');
    expect(row.outcomeRows).toBe(0);
    expect(row.liveCapabilities).toBe(0);
    // `§5`'s whole point: the row is CLAIMED, the request never left, and NOTHING will send
    // it. `35 §12.3`'s cost is stated rather than engineered away: "A message that was
    // genuinely never sent is delayed until the delivery-event reconciliation resolves it
    // and a fresh authorisation is obtained. That is a real customer-experience cost and it
    // is the correct trade."
    expect(row.recovery).toBe('CLAIM_REFUSED:ALREADY_CLAIMED');
    expect(row.mockCallsAfterRecovery).toBe(0);
  });

  it('POINT 3 — after the mock ACCEPTED, before the outcome is known: one call, no outcome', async () => {
    /*
     * `§22` item 3: "after mock invocation/request acceptance point, before outcome known".
     * The mock increments `acceptedCount` and THEN throws, so this is the state a real
     * request-sent-but-response-lost crash produces — `35 §12.3`'s "The HTTP request
     * leaves; the process dies before the response is recorded."
     */
    const { row } = await measure(
      'after mock ACCEPTED, before outcome known',
      'kill-3',
      { afterAccepted: () => Promise.reject(new Error('SIGKILL after acceptance')) },
      undefined,
      true,
    );
    expect(row.mockCalls).toBe(1);
    expect(row.mockAccepted).toBe(1);
    expect(row.outboxStatus).toBe('CLAIMED');
    expect(row.outcomeRows).toBe(0);
    expect(row.outcomeJournalRows).toBe(0);
    expect(row.liveCapabilities).toBe(0);
    // THE PROPERTY `§22` NAMES: no recovery path invokes the mock a second time.
    expect(row.recovery).toBe('CLAIM_REFUSED:ALREADY_CLAIMED');
    expect(row.mockCallsAfterRecovery).toBe(1);
  });

  it('POINT 4 — after the mock RETURNED, before the local outcome commits', async () => {
    const { row } = await measure(
      'after mock RETURNED, before outcome COMMIT',
      'kill-4',
      {},
      {
        beforeOutcomeCommit: () =>
          Promise.reject(new Error('SIGKILL before the outcome COMMIT')),
      },
      true,
    );
    expect(row.mockCalls).toBe(1);
    expect(row.mockAccepted).toBe(1);
    expect(row.outboxStatus).toBe('CLAIMED');
    // BOTH WRITES ROLLED BACK TOGETHER. `§20`'s fourth prohibition.
    expect(row.outcomeRows).toBe(0);
    expect(row.outcomeJournalRows).toBe(0);
    expect(row.recovery).toBe('CLAIM_REFUSED:ALREADY_CLAIMED');
    expect(row.mockCallsAfterRecovery).toBe(1);
  });

  it('POINT 5 — after the local outcome COMMITTED: the outcome stands, and is final', async () => {
    const { row } = await measure(
      'after outcome COMMIT',
      'kill-5',
      {},
      { afterOutcomeCommit: () => Promise.reject(new Error('SIGKILL after outcome COMMIT')) },
      true,
    );
    expect(row.mockCalls).toBe(1);
    expect(row.outboxStatus).toBe('CLAIMED');
    // The outcome and its journal row both survive, because they committed before the kill.
    expect(row.outcomeRows).toBe(1);
    expect(row.outcomeJournalRows).toBe(1);
    expect(row.recovery).toBe('CLAIM_REFUSED:ALREADY_CLAIMED');
    expect(row.mockCallsAfterRecovery).toBe(1);
  });

  it('POINT 6 — re-entry, at every point: exactly one invocation, ever', async () => {
    /*
     * The matrix's own summary row, and the property `§22` states in one line: "No recovery
     * path invokes the mock a second time for an already-claimed effect."
     *
     * Points 2 through 5 all leave a `CLAIMED` row, and the re-entry at each of them is
     * refused by the same mechanism — `25 §7`'s state machine — so the invocation count is
     * whatever it was when the process died and never one more.
     */
    const points: {
      readonly tag: string;
      readonly hooks: NonNullable<Parameters<typeof dispatchAuthorisedEffect>[2]>['hooks'];
      readonly afterAccepted?: () => Promise<void>;
      readonly expectedCalls: number;
    }[] = [
      {
        tag: 're-2',
        hooks: { afterClaimCommit: () => Promise.reject(new Error('k')) },
        expectedCalls: 0,
      },
      {
        tag: 're-3',
        hooks: undefined,
        afterAccepted: () => Promise.reject(new Error('k')),
        expectedCalls: 1,
      },
      {
        tag: 're-4',
        hooks: { beforeOutcomeCommit: () => Promise.reject(new Error('k')) },
        expectedCalls: 1,
      },
      {
        tag: 're-5',
        hooks: { afterOutcomeCommit: () => Promise.reject(new Error('k')) },
        expectedCalls: 1,
      },
    ];

    for (const point of points) {
      const { row } = await measure(
        point.tag,
        point.tag,
        point.afterAccepted === undefined ? {} : { afterAccepted: point.afterAccepted },
        point.hooks,
        true,
      );
      expect(row.recovery, point.tag).toBe('CLAIM_REFUSED:ALREADY_CLAIMED');
      expect(row.mockCallsAfterRecovery, point.tag).toBe(point.expectedCalls);
      // And a THIRD attempt changes nothing either.
      const third = await dispatchAuthorisedEffect(
        dispatchEnv(h,
        
          createMockAdapter({
            adapterId: ADAPTER_ADS,
            resolutionCapabilities: ['IDEMPOTENCY_HEADER'],
            outcome: returnedOutcome(),
          }),
        ),
        {
          companyId: COMPANY_ID,
          idempotencyKey: `idem:campaign.pause:CMP-${point.tag}:missing`,
          dispatchedBy: 'worker:third',
          now: LATER,
        },
      );
      // A key that never existed refuses for the OTHER declared reason, which is what makes
      // the `ALREADY_CLAIMED` above a real discrimination rather than a blanket refusal.
      expect(third.kind, point.tag).toBe('CLAIM_REFUSED');
      if (third.kind === 'CLAIM_REFUSED') {
        expect(third.reason, point.tag).toBe('OUTBOX_ROW_NOT_FOUND');
      }
    }
  });
});

describe('`§22`, `§30` — WHAT THE MATRIX DOES NOT CLOSE', () => {
  it('THIS DOES NOT CLOSE REAL-PROVIDER `I36` VALIDATION, AND `I20` REMAINS OPEN', async () => {
    /*
     * Asserted as a test rather than written only in a document, because `§29` and `§30`
     * are about a claim the repository must not make:
     *
     *   `§29`: "Do not state: provider accepted exactly once; ESP idempotency proven;
     *          provider query semantics proven; external exactly-once proven; delivery
     *          webhook proven."
     *   `§30`: "Do not compare mock accepted count to MIE reserved units and call I20
     *          closed. I20 requires provider-reported accepted messages/effects evaluated
     *          by the audit plane's independent provider read. There is no provider in
     *          S1J. I20 remains OPEN."
     *
     * The three absences below are what make the claim unavailable rather than merely
     * unmade: there is no provider read, no ESP credential and no delivery-event surface for
     * `I20` or `I36`'s verification leg to run against.
     */
    const effect = await enqueuedPause('open');
    const mock = createMockAdapter({
      adapterId: ADAPTER_ADS,
      resolutionCapabilities: ['IDEMPOTENCY_HEADER'],
      outcome: returnedOutcome(),
    });
    await dispatchAuthorisedEffect(dispatchEnv(h, mock), {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      dispatchedBy: 'worker:open',
      now: NOW,
    });
    expect(mock.acceptedCount).toBe(1);

    // 1. THE AUDIT PLANE HOLDS NO PROVIDER READING. `I20` is an AUDIT-plane invariant
    //    reconciled "from its own ESP read credential" (`35 §12.3`), and there is no table
    //    in the audit store that could hold a provider-reported accepted count.
    const auditTables = await h.auditOwner.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    const names = auditTables.rows.map((r) => r.table_name);
    for (const forbidden of ['provider', 'vendor', 'esp', 'delivery', 'accepted']) {
      expect(
        names.filter((n) => n.includes(forbidden)),
        `audit table matching ${forbidden}`,
      ).toEqual([]);
    }

    // 2. THE CONTROL PLANE HOLDS NO PROVIDER-REPORTED COUNT EITHER, so nothing in the
    //    repository can even form `I20`'s left-hand side.
    const controlTables = await h.control.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    const controlNames = controlTables.rows.map((r) => r.table_name);
    expect(controlNames.filter((n) => n.includes('provider'))).toEqual([]);
    expect(controlNames.filter((n) => n.includes('delivery'))).toEqual([]);

    // 3. AND `reserved_irrecoverable` IS ZERO EVERYWHERE, so `I20`'s right-hand side does
    //    not exist either — which is `S1J-C1`'s finding from the other direction.
    const units = await h.control.query<{ n: string }>(
      `SELECT COALESCE(sum(reserved_irrecoverable), 0)::TEXT AS n FROM window_balance
        WHERE company_id = $1`,
      [COMPANY_ID],
    );
    expect(units.rows[0]!.n).toBe('0');
  });
});
