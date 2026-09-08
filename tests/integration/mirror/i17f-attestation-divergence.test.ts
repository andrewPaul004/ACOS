import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { COMPANY_ID } from '../../support/fixture.js';
import {
  AUDIT_INSTANCE_ID,
  createMirrorHarness,
  type MirrorHarness,
} from '../../support/mirrorFixture.js';
import { auditIncidents, transportRecordFor } from '../../support/replicationFixture.js';
import { emitAttestation } from '../../../src/replication/attestation.js';
import { runStallObservationCycle } from '../../../src/audit/mirrorInputStall.js';
import {
  evaluateAndRecordDivergence,
  evaluateAttestationDivergence,
} from '../../../src/audit/attestationDivergence.js';
import {
  declareMirrorDegraded,
  evaluateState,
} from '../../../src/kernel/mirror/mirrorStateMachine.js';

/**
 * `I17f(b)` — `ATTESTATION_DIVERGENCE`, A DETECTOR THAT ATTRIBUTES NOTHING.
 *
 * =================================================================================
 * REGISTRY `I17f(b)`: "An audit-plane `MIRROR_INPUT_STALL` with no corresponding journaled
 * control-plane `AUDIT_MIRROR_DEGRADED` declaration raises `ATTESTATION_DIVERGENCE` at
 * CRITICAL."
 *
 * `30 §5.6`: "a **detector**, restated as one in v1.3 **because its violation raises the
 * condition that satisfies it** (TA-09)."
 *
 * `§13` OF THE S1H MANDATE, and it is the harder half:
 *
 *   "Do not turn the circularity into fake synchronization. During a genuine partition, it
 *    may be impossible for the audit side to receive the declaration. That can legitimately
 *    raise an incident. [...] **Do not claim incident attribution distinguishes attack from
 *    network failure if architecture does not.**"
 *
 * It does not. `30 §5.7`: the declaration travels "over the push path whose failure it
 * declares", and "its non-arrival is **definitionally indistinguishable** from the condition
 * it declares."
 * =================================================================================
 */

let h: MirrorHarness;

const ATTESTED_AT = new Date('2026-03-01T12:00:00.000Z');
const STALLED_AT = new Date(ATTESTED_AT.getTime() + 16 * 60_000);

beforeAll(async () => {
  h = await createMirrorHarness();
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await h.reset();
  const seq = await emitAttestation(h.control, COMPANY_ID, ATTESTED_AT);
  await h.replication.ingress.ingest(await transportRecordFor(h.replication, seq));
});

/** The audit plane observes and publishes a stall. */
async function publish(): Promise<void> {
  const issued = await runStallObservationCycle(
    h.auditEvaluator,
    COMPANY_ID,
    STALLED_AT,
    AUDIT_INSTANCE_ID,
    h.auditKey.privateKey,
  );
  expect(issued).not.toBeNull();
}

/** Push every pending control journal row to the audit store. */
async function pushBacklog(): Promise<void> {
  await h.replication.pusher().pushPending(COMPANY_ID);
}

describe('CASE A — the declaration REACHES the audit plane: NO divergence', () => {
  it('declared, pushed, published: the detector stays silent', async () => {
    await declareMirrorDegraded(h.control, COMPANY_ID, 'PUSH_ACK_TIMEOUT', STALLED_AT);
    await pushBacklog();
    await publish();

    const report = await evaluateAttestationDivergence(h.auditEvaluator, COMPANY_ID, STALLED_AT);
    expect(report.publishedIntervals).toHaveLength(1);
    expect(report.receivedDeclarations.map((d) => d.event)).toContain('OPENED');
    expect(report.findings).toEqual([]);
  });

  it('and nothing is written to `audit_incident`', async () => {
    await declareMirrorDegraded(h.control, COMPANY_ID, 'PUSH_ACK_TIMEOUT', STALLED_AT);
    await pushBacklog();
    await publish();
    await evaluateAndRecordDivergence(h.auditEvaluator, COMPANY_ID, STALLED_AT);
    const incidents = await auditIncidents(h.replication);
    expect(incidents.filter((i) => i.kind === 'ATTESTATION_DIVERGENCE')).toEqual([]);
  });
});

describe('CASE B — the declaration DOES NOT REACH the audit plane because transport is down', () => {
  it('divergence FIRES, and the finding claims no attribution', async () => {
    // The control plane declares HONESTLY. The push never happens — which is the very
    // condition it was declaring. `30 §5.7`: "its non-arrival is definitionally
    // indistinguishable from the condition it declares."
    await declareMirrorDegraded(h.control, COMPANY_ID, 'PUSH_ACK_TIMEOUT', STALLED_AT);
    // NO `pushBacklog()`. The row exists in the control journal and nowhere else.
    await publish();

    const report = await evaluateAndRecordDivergence(h.auditEvaluator, COMPANY_ID, STALLED_AT);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]!.kind).toBe('ATTESTATION_DIVERGENCE');
    expect(report.findings[0]!.severity).toBe('CRITICAL');
    expect(report.findings[0]!.detail['clause']).toBe('I17f(b)');
    // THE HONEST PART. `§13`: do not claim the incident distinguishes attack from failure.
    expect(String(report.findings[0]!.detail['attribution'])).toMatch(/^NONE\./);
    expect(String(report.findings[0]!.detail['attribution'])).toMatch(
      /declared\s+honestly and could not push/,
    );

    const incidents = await auditIncidents(h.replication);
    expect(incidents.filter((i) => i.kind === 'ATTESTATION_DIVERGENCE')).toHaveLength(1);
  });

  it('the CONTROL-SIDE row exists all along, which is what makes the case honest', async () => {
    await declareMirrorDegraded(h.control, COMPANY_ID, 'PUSH_ACK_TIMEOUT', STALLED_AT);
    await publish();
    const client = await h.control.connect();
    try {
      const rows = await client.query<{ n: string }>(
        `SELECT count(*)::TEXT AS n FROM effect_journal
          WHERE company_id = $1 AND journal_row_kind = 'AUDIT_MIRROR_DEGRADED'`,
        [COMPANY_ID],
      );
      expect(rows.rows[0]!.n).toBe('1');
    } finally {
      client.release();
    }
    // The audit plane holds none of it — `24 §3` K11's declared inputs contain no
    // control-database read, so it cannot look.
    const report = await evaluateAttestationDivergence(h.auditEvaluator, COMPANY_ID, STALLED_AT);
    expect(report.receivedDeclarations).toEqual([]);
    expect(report.findings).toHaveLength(1);
  });
});

describe('CASE C — the control plane LIES by not declaring at all', () => {
  it('divergence fires IDENTICALLY, and that identity is the point', async () => {
    // No declaration is journaled. The audit plane still publishes, because its observation
    // is its own. The finding is BYTE-FOR-BYTE the same shape as case B's, which is what
    // `I17f(b)`'s reclassification to a DETECTOR records: the audit plane cannot tell these
    // apart, and a test that claimed otherwise would be asserting a property the
    // architecture explicitly denies.
    await publish();
    const report = await evaluateAndRecordDivergence(h.auditEvaluator, COMPANY_ID, STALLED_AT);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]!.kind).toBe('ATTESTATION_DIVERGENCE');
    expect(String(report.findings[0]!.detail['attribution'])).toMatch(/^NONE\./);
    expect(report.receivedDeclarations).toEqual([]);
  });

  it('and the LYING control plane gains nothing — its own state is still NORMAL', async () => {
    // The lie's whole purpose would be to reach the relaxed state. It does not: with no
    // declaration open, `30 §5.6` row 1 applies and the state is `NORMAL` — which is the
    // state that dispatches row 3 WITHOUT the `DISPATCHED_UNMIRRORED` tag, so `I17f(c)`
    // becomes the exposure and `I8` its only detector. `S1H-result.md §10` records that.
    await publish();
    expect((await evaluateState(h.control, COMPANY_ID, STALLED_AT)).state).toBe('NORMAL');
  });
});

describe('CASE D — the audit plane`s signal exists INDEPENDENTLY of the control plane', () => {
  it('the interval and the signal are audit rows the control plane never wrote', async () => {
    await publish();
    const client = await h.auditOwner.connect();
    try {
      const rows = await client.query<{ observed_by: string }>(
        'SELECT observed_by FROM audit_mirror_stall_interval WHERE company_id = $1',
        [COMPANY_ID],
      );
      // `observed_by` defaults to `SESSION_USER`, so the row records WHO wrote it. It is the
      // audit plane's own evaluator, never the control plane's replication principal.
      expect(rows.rows[0]!.observed_by).toBe('acos_audit_evaluator');
      expect(rows.rows[0]!.observed_by).not.toBe('acos_audit_replication');
    } finally {
      client.release();
    }
  });
});

describe('THE DETECTOR IS A DETECTOR — it refuses nothing and halts nothing', () => {
  it('firing changes no authority on either side', async () => {
    // `30 §5.6`: `I17f(b)` is "a **detector**". An implementation that refused here would
    // halt the company every time the push path went down, which is the condition it exists
    // to REPORT.
    await declareMirrorDegraded(h.control, COMPANY_ID, 'PUSH_ACK_TIMEOUT', STALLED_AT);
    await publish();
    const before = (await evaluateState(h.control, COMPANY_ID, STALLED_AT)).state;
    const report = await evaluateAndRecordDivergence(h.auditEvaluator, COMPANY_ID, STALLED_AT);
    expect(report.findings).toHaveLength(1);
    const after = (await evaluateState(h.control, COMPANY_ID, STALLED_AT)).state;
    expect(after).toBe(before);
    expect(after).toBe('UNCORROBORATED_STALL');
  });

  it('evaluation is SEPARABLE from recording, so "produced nothing" is observable', async () => {
    // The same discipline S1G applied to `recordFindings`: a detector observable only through
    // its side effects makes "produced nothing" indistinguishable from "was not run".
    await declareMirrorDegraded(h.control, COMPANY_ID, 'PUSH_ACK_TIMEOUT', STALLED_AT);
    await pushBacklog();
    await publish();
    const report = await evaluateAttestationDivergence(h.auditEvaluator, COMPANY_ID, STALLED_AT);
    expect(report.findings).toEqual([]);
    expect(report.publishedIntervals).toHaveLength(1);
    // Non-vacuous: the evaluation DID look at an interval and DID find a declaration.
    expect(report.receivedDeclarations).toHaveLength(1);
  });

  it('and with NO published interval there is nothing to diverge from', async () => {
    await declareMirrorDegraded(h.control, COMPANY_ID, 'PUSH_ACK_TIMEOUT', STALLED_AT);
    await pushBacklog();
    // No `publish()`. `I17f(b)` quantifies over PUBLISHED intervals.
    const report = await evaluateAttestationDivergence(h.auditEvaluator, COMPANY_ID, STALLED_AT);
    expect(report.publishedIntervals).toEqual([]);
    expect(report.findings).toEqual([]);
  });
});

describe('`I17f(a)` AND `I17f(c)` ARE NOT EVALUATED, AND THE SUITE SAYS WHY', () => {
  it('there are NO dispatched effects and no `DISPATCHED_UNMIRRORED` tag in either store', async () => {
    // `I17f(a)` and `(c)` both quantify over DISPATCHED EFFECTS. `§35` of the mandate: "do
    // NOT manufacture fake `DISPATCHED` rows merely to claim the invariant closed." So the
    // assertion here is the ABSENCE of the operands, which is what makes the OPEN status in
    // `S1H-result.md §10` a fact about the system rather than a note.
    await publish();

    const control = await h.control.connect();
    try {
      const columns = await control.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_name IN ('effect', 'effect_journal')`,
      );
      const names = columns.rows.map((r) => r.column_name);
      expect(names).not.toContain('dispatched_at');
      expect(names).not.toContain('dispatched_unmirrored');
      expect(names).not.toContain('override_ref');

      // And no effect row is in a dispatched state, because there is no such state.
      const statuses = await control.query<{ constraint_def: string }>(
        `SELECT pg_get_constraintdef(oid) AS constraint_def FROM pg_constraint
          WHERE conrelid = 'effect'::regclass AND contype = 'c'`,
      );
      for (const row of statuses.rows) {
        expect(row.constraint_def).not.toMatch(/DISPATCHED/);
      }
    } finally {
      control.release();
    }

    const audit = await h.auditOwner.connect();
    try {
      const kinds = await audit.query<{ journal_row_kind: string }>(
        'SELECT DISTINCT journal_row_kind FROM audit_journal WHERE company_id = $1',
        [COMPANY_ID],
      );
      // Only the kinds S1G and S1H produce. No dispatch row kind exists.
      for (const row of kinds.rows) {
        expect([
          'EFFECT_AUTHORISATION',
          'JOURNAL_ATTESTATION',
          'AUDIT_MIRROR_DEGRADED',
          'MIRROR_CORROBORATION_CONSUMED',
          'DEGRADED_MODE_OVERRIDE_EVENT',
        ]).toContain(row.journal_row_kind);
      }
    } finally {
      audit.release();
    }
  });

  it('and the audit plane`s published intervals ARE retained, ready for `(a)` and `(c)`', async () => {
    // What S1H DOES deliver toward those clauses: `30 §5.7.1`'s "the audit plane's own record
    // of the intervals it published", immutable and audit-owned. The clauses become
    // evaluable the moment dispatch rows exist, and not before.
    await publish();
    const client = await h.auditOwner.connect();
    try {
      const rows = await client.query<{ interval_start: Date; interval_end: Date | null }>(
        'SELECT interval_start, interval_end FROM audit_mirror_stall_interval WHERE company_id = $1',
        [COMPANY_ID],
      );
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0]!.interval_start.getTime()).toBe(STALLED_AT.getTime());
      expect(rows.rows[0]!.interval_end).toBeNull();
    } finally {
      client.release();
    }
  });
});
