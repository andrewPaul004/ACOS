import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { COMPANY_ID } from '../support/fixture.js';
import {
  AUDIT_INSTANCE_ID,
  createMirrorHarness,
  type MirrorHarness,
} from '../support/mirrorFixture.js';
import { transportRecordFor } from '../support/replicationFixture.js';
import { emitAttestation } from '../../src/replication/attestation.js';
import {
  closeStallInterval,
  runStallObservationCycle,
} from '../../src/audit/mirrorInputStall.js';
import { postgresCorroborationSource } from '../../src/replication/corroborationFetch.js';
import {
  closeMirrorDeclaration,
  consumeCorroboration,
  declareMirrorDegraded,
  evaluateState,
} from '../../src/kernel/mirror/mirrorStateMachine.js';
import { SIGNAL_MAX_AGE_MS } from '../../src/kernel/mirror/mirrorState.js';
import { classifyDispatchPrecedence } from '../../src/kernel/mirror/dispatchPrecedence.js';
import { unsafeSignatureOnlyResolver } from './unsafe-mirror-state-machine.js';
import { PERMISSIVENESS } from '../support/mirrorPrecedenceTable.js';

/**
 * MANDATORY NEGATIVE CONTROL — SIGNAL REPLAY. `§32` OF THE S1H MANDATE.
 *
 * =================================================================================
 * `§32`, verbatim, INCLUDING the fixture:
 *
 *   "Required discriminating control: Unsafe state machine: verifies signature; ignores
 *    `max_age`.
 *
 *    Fixture: 1. genuine audit stall; 2. valid signal issued; 3. outage resolves; 4. signal
 *    ages beyond allowed maximum; 5. control replays it during later healthy state.
 *
 *    Unsafe implementation: enters `CORROBORATED_DEGRADED`. Production: does NOT.
 *    **This is mandatory.**"
 *
 * `30 §5.7.1` names what the unsafe machine is missing: v1.2 "declared no endpoint, no
 * transport, no authentication, no signature and — **the load-bearing one — no freshness**."
 *
 * THE SIGNAL IN THIS FILE IS GENUINE. It is observed by the real audit plane from real audit
 * holdings, canonicalised by the audit database and signed with the audit plane's real
 * Ed25519 key. Nothing about it is forged; the ONLY thing wrong with it is its age.
 * =================================================================================
 */

let h: MirrorHarness;

/** 1. The genuine stall. */
const ATTESTED_AT = new Date('2026-03-01T12:00:00.000Z');
const STALLED_AT = new Date(ATTESTED_AT.getTime() + 16 * 60_000);
/** 3. The outage resolves. 4. The signal ages past `max_age`. */
const RECOVERED_AT = new Date(STALLED_AT.getTime() + 20 * 60_000);

beforeAll(async () => {
  h = await createMirrorHarness();
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await h.reset();
});

/** Steps 1 and 2: a genuine stall, and a genuinely signed signal, fetched over the real path. */
async function genuineStallAndSignal() {
  const seq = await emitAttestation(h.control, COMPANY_ID, ATTESTED_AT);
  expect(await h.replication.ingress.ingest(await transportRecordFor(h.replication, seq))).toBe(
    'ACCEPTED',
  );
  await declareMirrorDegraded(h.control, COMPANY_ID, 'PUSH_ACK_TIMEOUT', STALLED_AT);
  const issued = await runStallObservationCycle(
    h.auditEvaluator,
    COMPANY_ID,
    STALLED_AT,
    AUDIT_INSTANCE_ID,
    h.auditKey.privateKey,
  );
  expect(issued).not.toBeNull();

  const fetched = await postgresCorroborationSource(h.auditReader).fetchCurrent(COMPANY_ID);
  expect(fetched.kind).toBe('SIGNAL');
  if (fetched.kind !== 'SIGNAL') throw new Error('unreachable');
  return fetched.signal;
}

describe('STEPS 1 AND 2 — the signal is GENUINE and, while fresh, it WORKS', () => {
  it('at issuance it reaches `CORROBORATED_DEGRADED`', async () => {
    const signal = await genuineStallAndSignal();
    const outcome = await consumeCorroboration(
      h.control,
      COMPANY_ID,
      signal,
      h.auditKey.publicKey,
      STALLED_AT,
    );
    expect(outcome.kind).toBe('SIGNAL_CONSUMED');
    expect(outcome.resolution.state).toBe('CORROBORATED_DEGRADED');
  });

  it('and one millisecond before it expires it is still valid', async () => {
    const signal = await genuineStallAndSignal();
    const outcome = await consumeCorroboration(
      h.control,
      COMPANY_ID,
      signal,
      h.auditKey.publicKey,
      new Date(signal.observedAt.getTime() + SIGNAL_MAX_AGE_MS - 1),
    );
    expect(outcome.kind).toBe('SIGNAL_CONSUMED');
    expect(outcome.resolution.state).toBe('CORROBORATED_DEGRADED');
  });
});

describe('STEPS 3, 4 AND 5 — the outage resolves, the signal ages, the control replays it', () => {
  it('THE UNSAFE MACHINE enters `CORROBORATED_DEGRADED` on the aged signal', async () => {
    const signal = await genuineStallAndSignal();
    // 3. The outage resolves: the audit plane closes its interval, the control plane closes
    //    its declaration. The system is HEALTHY.
    await closeStallInterval(h.auditEvaluator, COMPANY_ID, RECOVERED_AT);
    await closeMirrorDeclaration(h.control, COMPANY_ID, RECOVERED_AT);
    expect((await evaluateState(h.control, COMPANY_ID, RECOVERED_AT)).state).toBe('NORMAL');

    // 5. A compromised control plane re-declares and replays the aged signal. The signature
    //    still verifies — it is a real signal — and the unsafe machine asks nothing else.
    const replayedInto = unsafeSignatureOnlyResolver(
      true,
      signal,
      COMPANY_ID,
      h.auditKey.publicKey,
    );
    expect(replayedInto).toBe('CORROBORATED_DEGRADED');

    // 4. And it really is beyond `max_age`: four times it, exactly.
    const ageMs = RECOVERED_AT.getTime() - signal.observedAt.getTime();
    expect(ageMs).toBeGreaterThan(SIGNAL_MAX_AGE_MS);
    expect(ageMs).toBe(4 * SIGNAL_MAX_AGE_MS);
  });

  it('PRODUCTION REFUSES IT — `SIGNAL_STALE`, and the state stays `UNCORROBORATED_STALL`', async () => {
    const signal = await genuineStallAndSignal();
    await closeStallInterval(h.auditEvaluator, COMPANY_ID, RECOVERED_AT);
    await closeMirrorDeclaration(h.control, COMPANY_ID, RECOVERED_AT);
    // The compromised control plane re-declares, which by itself reaches only the stricter
    // state, and then replays.
    await declareMirrorDegraded(h.control, COMPANY_ID, 'PUSH_ACK_TIMEOUT', RECOVERED_AT);

    const outcome = await consumeCorroboration(
      h.control,
      COMPANY_ID,
      signal,
      h.auditKey.publicKey,
      RECOVERED_AT,
    );
    expect(outcome.kind).toBe('REJECTED');
    if (outcome.kind === 'REJECTED') expect(outcome.rejection).toBe('SIGNAL_STALE');
    expect(outcome.resolution.state).toBe('UNCORROBORATED_STALL');

    // AND NOTHING WAS RECORDED. A rejected signal is not a fact about this company's state.
    const client = await h.control.connect();
    try {
      const rows = await client.query<{ n: string }>(
        'SELECT count(*)::TEXT AS n FROM mirror_corroboration WHERE company_id = $1',
        [COMPANY_ID],
      );
      expect(rows.rows[0]!.n).toBe('0');
    } finally {
      client.release();
    }
  });

  it('THE DISCRIMINATION: two machines, one genuine signal, two different states', async () => {
    const signal = await genuineStallAndSignal();
    await closeStallInterval(h.auditEvaluator, COMPANY_ID, RECOVERED_AT);
    await closeMirrorDeclaration(h.control, COMPANY_ID, RECOVERED_AT);
    await declareMirrorDegraded(h.control, COMPANY_ID, 'PUSH_ACK_TIMEOUT', RECOVERED_AT);

    const unsafeState = unsafeSignatureOnlyResolver(
      true,
      signal,
      COMPANY_ID,
      h.auditKey.publicKey,
    );
    const productionState = (
      await consumeCorroboration(h.control, COMPANY_ID, signal, h.auditKey.publicKey, RECOVERED_AT)
    ).resolution.state;

    expect(unsafeState).toBe('CORROBORATED_DEGRADED');
    expect(productionState).toBe('UNCORROBORATED_STALL');
    expect(unsafeState).not.toBe(productionState);
  });

  it('and the AUTHORITY differs for the refund the replay was aimed at', async () => {
    // The whole reason to replay: row 3. `22 §3.1` gives it "Dispatch, tagged" in
    // `CORROBORATED_DEGRADED` and "Suspend" in `UNCORROBORATED_STALL`.
    const signal = await genuineStallAndSignal();
    await closeStallInterval(h.auditEvaluator, COMPANY_ID, RECOVERED_AT);
    await closeMirrorDeclaration(h.control, COMPANY_ID, RECOVERED_AT);
    await declareMirrorDegraded(h.control, COMPANY_ID, 'PUSH_ACK_TIMEOUT', RECOVERED_AT);

    const refund = {
      actionClass: 'refund.create' as const,
      recoverability: 'COMPENSABLE' as const,
      clockBearing: true,
      aboveApprovalFloor: false,
      hasRecordedApproval: true,
      activeOverride: null,
      now: RECOVERED_AT,
    };

    const unsafe = classifyDispatchPrecedence({
      mirrorState: unsafeSignatureOnlyResolver(true, signal, COMPANY_ID, h.auditKey.publicKey),
      ...refund,
    });
    const production = classifyDispatchPrecedence({
      mirrorState: (
        await consumeCorroboration(
          h.control,
          COMPANY_ID,
          signal,
          h.auditKey.publicKey,
          RECOVERED_AT,
        )
      ).resolution.state,
      ...refund,
    });

    expect(unsafe.disposition).toBe('DISPATCH_ELIGIBLE');
    expect(production.disposition).toBe('SUSPEND');
    expect(PERMISSIVENESS[production.disposition]).toBeLessThan(
      PERMISSIVENESS[unsafe.disposition],
    );
  });
});

describe('THE CONTROL IS SHARP — freshness is the ONLY difference between the machines', () => {
  it('on a FRESH signal both machines say `CORROBORATED_DEGRADED`', async () => {
    // If the unsafe machine differed on a fresh signal too, the discrimination above would
    // not isolate `max_age`.
    const signal = await genuineStallAndSignal();
    expect(unsafeSignatureOnlyResolver(true, signal, COMPANY_ID, h.auditKey.publicKey)).toBe(
      'CORROBORATED_DEGRADED',
    );
    expect(
      (await consumeCorroboration(h.control, COMPANY_ID, signal, h.auditKey.publicKey, STALLED_AT))
        .resolution.state,
    ).toBe('CORROBORATED_DEGRADED');
  });

  it('on a FORGED signature both machines refuse — the unsafe one is not simply broken', async () => {
    const signal = await genuineStallAndSignal();
    const forged = { ...signal, signature: Buffer.alloc(64, 0x5a) };
    expect(unsafeSignatureOnlyResolver(true, forged, COMPANY_ID, h.auditKey.publicKey)).toBe(
      'UNCORROBORATED_STALL',
    );
    const outcome = await consumeCorroboration(
      h.control,
      COMPANY_ID,
      forged,
      h.auditKey.publicKey,
      STALLED_AT,
    );
    expect(outcome.kind).toBe('REJECTED');
    expect(outcome.resolution.state).toBe('UNCORROBORATED_STALL');
  });

  it('on a WRONG-COMPANY signal both refuse too', async () => {
    const signal = await genuineStallAndSignal();
    expect(unsafeSignatureOnlyResolver(true, signal, 'co_other', h.auditKey.publicKey)).toBe(
      'UNCORROBORATED_STALL',
    );
  });
});

describe('AND REPLAY IS BOUNDED A SECOND WAY — the consumed `signal_id`', () => {
  it('a signal already consumed cannot re-enter, even while still fresh', async () => {
    // `30 §5.7.1`, Replay protection: "`signal_id` is recorded in the journal on consumption;
    // a `signal_id` already consumed cannot re-enter the state machine." Two independent
    // bounds — freshness and the consumed record — so a defect in either leaves the other.
    const signal = await genuineStallAndSignal();
    expect(
      (await consumeCorroboration(h.control, COMPANY_ID, signal, h.auditKey.publicKey, STALLED_AT))
        .kind,
    ).toBe('SIGNAL_CONSUMED');
    const second = await consumeCorroboration(
      h.control,
      COMPANY_ID,
      signal,
      h.auditKey.publicKey,
      STALLED_AT,
    );
    expect(second.kind).toBe('ALREADY_CONSUMED');
    const client = await h.control.connect();
    try {
      const rows = await client.query<{ n: string }>(
        `SELECT count(*)::TEXT AS n FROM effect_journal
          WHERE company_id = $1 AND journal_row_kind = 'MIRROR_CORROBORATION_CONSUMED'`,
        [COMPANY_ID],
      );
      expect(rows.rows[0]!.n).toBe('1');
    } finally {
      client.release();
    }
  });

  it('and holding a consumed signal past `max_age` reverts the state anyway', async () => {
    // `30 §5.7.1`: "Extending it by holding it is bounded by `max_age`, **evaluated at every
    // state evaluation and not only at entry**." So even the LEGITIMATE consumption expires.
    const signal = await genuineStallAndSignal();
    await consumeCorroboration(h.control, COMPANY_ID, signal, h.auditKey.publicKey, STALLED_AT);
    expect((await evaluateState(h.control, COMPANY_ID, STALLED_AT)).state).toBe(
      'CORROBORATED_DEGRADED',
    );
    const past = new Date(signal.observedAt.getTime() + SIGNAL_MAX_AGE_MS);
    expect((await evaluateState(h.control, COMPANY_ID, past)).state).toBe('UNCORROBORATED_STALL');
  });
});
