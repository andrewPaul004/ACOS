import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  ATTESTATION_CADENCE_MS,
  ATTESTATION_K,
  ATTESTATION_STALL_BOUND_MS,
  emitAttestation,
  emitAttestationIfDue,
} from '../../../src/replication/attestation.js';
import { evaluateTransportCompleteness } from '../../../src/audit/transportCompleteness.js';
import { CAN03, loadCommerceFixture } from '../../support/enumerationFixture.js';
import {
  S1E_PASS_ORDER,
  loadAuthorityWorld,
  loadS1eOrders,
  s1eSpec,
} from '../../support/authorityFixture.js';
import {
  COMPANY_ID,
  makeLocalAuthorityHarness,
  proposeAndAuthorise,
  type LocalAuthorityHarness,
} from '../../support/localAuthorisationFixture.js';
import {
  auditRows,
  controlJournal,
  createReplicationFixture,
  transportRecordFor,
  type ReplicationFixture,
} from '../../support/replicationFixture.js';
import { attestationFields, oracleRowHash } from '../../support/jcs1Oracle.js';

/**
 * `VC-A1` — ATTESTATION AND TRANSPORT COMPLETENESS. S1G.
 *
 * =================================================================================
 * `36 §2`, verbatim:
 *
 *   "VC-A1 — attestation. `JournalAttestation` is emitted every 5 minutes INCLUDING WHEN
 *    NO JOURNAL ROW WAS PRODUCED; k=3 raises `ATTESTATION_STALL` within 15 minutes. THE
 *    SILENCE FIXTURE: stop pushing at `journal_seq = N` and assert the audit plane raises
 *    within 15 minutes [...] `I17e` independently recomputes `head_hash` from received
 *    rows."
 *
 * And registry `I17`'s validation column, which names the harder half:
 *
 *   "truncate the tail at seq 900 of 1,000 out of band and assert detection FROM THE AUDIT
 *    PLANE ALONE, WITH NO CONTROL-DATABASE ACCESS."
 *
 * THE CLOCK IS A PARAMETER, NOT A SLEEP. `36 §6`'s clock rule makes the evaluating instant
 * an operand of the check; a 15-minute bound asserted by a 15-minute sleep is a test
 * nobody runs. Every instant below is supplied.
 * =================================================================================
 */

let fixture: ReplicationFixture;
let kernel: LocalAuthorityHarness;

/** A fixed evaluation epoch. Every instant in this file is derived from it. */
const T0 = new Date('2026-01-05T12:00:00.000Z');
const at = (minutes: number): Date => new Date(T0.getTime() + minutes * 60_000);

beforeAll(async () => {
  fixture = await createReplicationFixture();
});

afterAll(async () => {
  await fixture.close();
});

beforeEach(async () => {
  await fixture.reset();
  const client = await fixture.control.connect();
  try {
    await loadCommerceFixture(client);
    await loadS1eOrders(client);
    await loadAuthorityWorld(client);
  } finally {
    client.release();
  }
  kernel = makeLocalAuthorityHarness(fixture.control);
});

async function authoriseTwo(): Promise<void> {
  const spec = s1eSpec({ admittedResourceRefs: [S1E_PASS_ORDER.resourceRef, CAN03.resourceRef] });
  await proposeAndAuthorise(kernel, S1E_PASS_ORDER, { spec });
  await proposeAndAuthorise(kernel, CAN03, { spec });
}

/** Push exactly the named sequences, and nothing else. The transport, under test control. */
async function pushOnly(...sequences: bigint[]): Promise<void> {
  for (const seq of sequences) {
    await fixture.ingress.ingest(await transportRecordFor(fixture, seq));
  }
}

const evaluate = async (now: Date) =>
  evaluateTransportCompleteness(fixture.audit.evaluator, COMPANY_ID, now);

const kinds = (report: Awaited<ReturnType<typeof evaluate>>): string[] =>
  report.findings.map((f) => f.kind);

// =====================================================================================
// The attestation is a REAL journal row. `§16`.
// =====================================================================================

describe('the attestation is a real journal row on the real chain and the real path', () => {
  it('it takes a REAL `journal_seq` from the SAME counter, and chains from the previous row', async () => {
    await authoriseTwo();
    const seq = await emitAttestation(fixture.control.pool, COMPANY_ID, at(0));
    expect(seq).toBe(3n); // the SAME gap-free company sequence, not a separate one

    const journal = await controlJournal(fixture);
    expect(journal.map((r) => r.journal_row_kind)).toEqual([
      'EFFECT_AUTHORISATION',
      'EFFECT_AUTHORISATION',
      'JOURNAL_ATTESTATION',
    ]);
    // The local chain runs THROUGH it: the attestation's prev_hash is row 2's row_hash.
    expect(journal[2]!.prev_hash).toEqual(journal[1]!.row_hash);

    // And the counter advanced, so a later authorisation continues from 4.
    const client = await fixture.control.connect();
    try {
      const next = await client.query<{ next_seq: string }>(
        `SELECT next_seq FROM journal_counter WHERE company_id = $1`,
        [COMPANY_ID],
      );
      expect(next.rows[0]!.next_seq).toBe('4');
    } finally {
      client.release();
    }
  });

  it('its declared quantities describe the prefix BEFORE it, computed by direct SQL', async () => {
    await authoriseTwo();
    await emitAttestation(fixture.control.pool, COMPANY_ID, at(0));
    const journal = await controlJournal(fixture);
    const attestation = journal[2]!;

    // Hand-checked against direct SQL over `effect_journal`, never against the production
    // attestation builder. `30 §5.2`: `row_count` is `count(DISTINCT journal_seq)`.
    expect(attestation.attested_max_journal_seq).toBe('2');
    expect(attestation.attested_row_count).toBe('2');
    expect(attestation.attested_head_hash).toEqual(journal[1]!.row_hash);
  });

  it('and its own row hash is what the INDEPENDENT ORACLE computes', async () => {
    await authoriseTwo();
    await emitAttestation(fixture.control.pool, COMPANY_ID, at(0));
    const journal = await controlJournal(fixture);
    const a = journal[2]!;
    const client = await fixture.control.connect();
    let occurredAt: Date;
    try {
      const result = await client.query<{ occurred_at: Date }>(
        `SELECT occurred_at FROM effect_journal WHERE company_id = $1 AND journal_seq = 3`,
        [COMPANY_ID],
      );
      occurredAt = result.rows[0]!.occurred_at;
    } finally {
      client.release();
    }
    const expected = oracleRowHash(
      attestationFields({
        companyId: COMPANY_ID,
        journalSeq: 3n,
        attestedMaxJournalSeq: 2n,
        attestedRowCount: 2n,
        attestedHeadHash: a.attested_head_hash!,
        attestedAt: occurredAt,
        prevHash: a.prev_hash,
      }),
    );
    expect(a.row_hash.equals(expected)).toBe(true);
  });

  it('an EMPTY attestation is emitted when nothing happened — the whole point of `§5.4`', async () => {
    // "Emitted whether or not any journal row was produced in the interval — the empty
    // attestation is the entire point."
    const seq = await emitAttestation(fixture.control.pool, COMPANY_ID, at(0));
    expect(seq).toBe(1n);
    const journal = await controlJournal(fixture);
    expect(journal[0]!.attested_max_journal_seq).toBe('0');
    expect(journal[0]!.attested_row_count).toBe('0');
    expect(journal[0]!.attested_head_hash).toEqual(Buffer.alloc(32));
    expect(journal[0]!.prev_hash).toEqual(Buffer.alloc(32));
  });

  it('it travels the SAME transport — no privileged side channel exists', async () => {
    await authoriseTwo();
    await emitAttestation(fixture.control.pool, COMPANY_ID, at(0));
    // The ORDINARY pusher, reading the ORDINARY backlog, moves it.
    const run = await fixture.pusher().pushPending(COMPANY_ID);
    expect(run.pushed.map((p) => p.journalSeq)).toEqual([1n, 2n, 3n]);
    const held = await auditRows(fixture);
    expect(held[2]!.journal_row_kind).toBe('JOURNAL_ATTESTATION');
    // And it re-chained on the audit side like anything else.
    expect(held[2]!.audit_prev_hash).toEqual(held[1]!.audit_row_hash);
  });

  it('the cadence and k are `30 §5.4`’s declared values, and the bound is their product', () => {
    expect(ATTESTATION_CADENCE_MS).toBe(5 * 60 * 1000);
    expect(ATTESTATION_K).toBe(3);
    expect(ATTESTATION_STALL_BOUND_MS).toBe(15 * 60 * 1000);
  });

  it('`emitAttestationIfDue` is driven by AUTHORITATIVE STATE and a supplied clock', async () => {
    // Due immediately when the channel has never spoken.
    const first = await emitAttestationIfDue(fixture.control.pool, COMPANY_ID, at(0));
    expect(first).toMatchObject({ emitted: true, journalSeq: 1n });

    // Not due one minute later.
    const early = await emitAttestationIfDue(fixture.control.pool, COMPANY_ID, at(1));
    expect(early.emitted).toBe(false);
    if (!early.emitted) expect(early.nextDueAt).toEqual(at(5));

    // Due at exactly the cadence.
    const onTime = await emitAttestationIfDue(fixture.control.pool, COMPANY_ID, at(5));
    expect(onTime).toMatchObject({ emitted: true, journalSeq: 2n });
    expect(await controlJournal(fixture)).toHaveLength(2);
  });
});

// =====================================================================================
// `§18` case A — mid-range omission.
// =====================================================================================

describe('VC-A1 case A — a mid-range omission is detected', () => {
  it('the store receives 1, 2, 4 and reports 3 missing', async () => {
    await authoriseTwo();
    await emitAttestation(fixture.control.pool, COMPANY_ID, at(0));
    await emitAttestation(fixture.control.pool, COMPANY_ID, at(5));
    await pushOnly(1n, 2n, 4n);

    const report = await evaluate(at(6));
    expect(report.heldSequences).toEqual([1n, 2n, 4n]);
    expect(report.gaps).toEqual([3n]);
    expect(kinds(report)).toContain('AUDIT_COMPLETENESS_GAP');
    const gap = report.findings.find((f) => f.kind === 'AUDIT_COMPLETENESS_GAP')!;
    expect(gap.severity).toBe('CRITICAL');
    expect(gap.detail['missing']).toEqual(['3']);
  });

  it('a complete prefix produces NO finding — the detector discriminates', async () => {
    await authoriseTwo();
    await emitAttestation(fixture.control.pool, COMPANY_ID, at(0));
    await pushOnly(1n, 2n, 3n);
    const report = await evaluate(at(1));
    expect(report.gaps).toEqual([]);
    expect(report.findings).toEqual([]);
  });
});

// =====================================================================================
// `§18` case B — tail transport truncation, with an HONEST attester.
// =====================================================================================

describe('VC-A1 case B — tail truncation against an honest attester', () => {
  it('the attestation reports a head beyond the holdings, and the audit plane detects it', async () => {
    // `30 §5.5` case 2a: "Row written locally, push suppressed by a third party or a
    // transport fault, WHILE THE CONTROL PLANE ATTESTS HONESTLY at the true
    // `max_journal_seq`" — caught by `I17e`.
    await authoriseTwo();
    // The control journal advances to 3, then attests honestly at max = 3.
    await emitAttestation(fixture.control.pool, COMPANY_ID, at(0)); // seq 3
    await emitAttestation(fixture.control.pool, COMPANY_ID, at(5)); // seq 4, attests max=3

    // Transport delivers rows 1 and 2 and the LAST attestation. Row 3 never arrives.
    await pushOnly(1n, 2n, 4n);

    const report = await evaluate(at(6));
    expect(report.latestAttestation?.attestedMaxJournalSeq).toBe(3n);
    expect(kinds(report)).toContain('ATTESTATION_INCONSISTENT');
    const finding = report.findings.find((f) => f.kind === 'ATTESTATION_INCONSISTENT')!;
    expect(finding.detail['missingBelowAttestedMax']).toEqual(['3']);
    expect(finding.detail['attestedRowCount']).toBe('3');
    expect(finding.detail['heldRowCountAtOrBelowAttestedMax']).toBe(2);
  });

  it('AND IT IS DETECTED WITHOUT ANY CONTROL-DATABASE ACCESS', async () => {
    // Registry `I17`'s validation column requires exactly this. The evaluator is handed
    // the AUDIT pool and nothing else; there is no control pool in scope for it to use.
    await authoriseTwo();
    await emitAttestation(fixture.control.pool, COMPANY_ID, at(0));
    await emitAttestation(fixture.control.pool, COMPANY_ID, at(5));
    await pushOnly(1n, 2n, 4n);

    // Close the control plane entirely. The check must still work.
    await fixture.control.close();
    try {
      const report = await evaluate(at(6));
      expect(kinds(report)).toContain('ATTESTATION_INCONSISTENT');
    } finally {
      // Rebuild the fixture for the next test; the harness owns the control pool.
      fixture = await createReplicationFixture();
    }
  });

  it('the head hash is recomputed from ROWS HELD, and a wrong head is caught', async () => {
    await authoriseTwo();
    await emitAttestation(fixture.control.pool, COMPANY_ID, at(0)); // seq 3, attests max 2
    await pushOnly(1n, 2n);

    // Deliver an attestation whose head hash does not match the row this store holds at
    // the attested maximum. Built by hand, and signed by nothing — the audit store's own
    // recomputation is what rejects it.
    const attestation = await transportRecordFor(fixture, 3n);
    const truthful = await evaluate(at(1));
    expect(truthful.findings).toEqual([]); // holdings 1,2 with no attestation yet: silent

    await fixture.ingress.ingest(attestation);
    const withAttestation = await evaluate(at(1));
    expect(withAttestation.findings).toEqual([]); // honest and complete

    // Now the discriminating half: an attestation claiming a head this store's rows do
    // not produce.
    const report = await evaluateWithForgedHead();
    expect(report).toContain('ATTESTATION_INCONSISTENT');
  });
});

/**
 * Rewrite the held attestation's `attested_head_hash` DIRECTLY, as the owner, and
 * re-evaluate.
 *
 * The rewrite is the ATTACK, not a production path: `acos_audit_replication` cannot do
 * this (`audit-role-security.test.ts` proves it) and the append-only trigger refuses an
 * UPDATE from anyone. It is performed here by dropping and reinserting under the owner
 * with the trigger momentarily disabled, which is a privilege NO ACOS principal holds.
 */
async function evaluateWithForgedHead(): Promise<string[]> {
  const client = await fixture.audit.owner.connect();
  try {
    await client.query('ALTER TABLE audit_journal DISABLE TRIGGER audit_journal_immutable');
    await client.query(
      `UPDATE audit_journal SET attested_head_hash = sha256('a head this store cannot produce')
        WHERE company_id = $1 AND journal_row_kind = 'JOURNAL_ATTESTATION'`,
      [COMPANY_ID],
    );
    await client.query('ALTER TABLE audit_journal ENABLE TRIGGER audit_journal_immutable');
  } finally {
    client.release();
  }
  const report = await evaluate(new Date(T0.getTime() + 60_000));
  return report.findings.map((f) => f.kind);
}

// =====================================================================================
// `§18` cases C and D — a suppressed attestation, and a writer that stops entirely.
// =====================================================================================

describe('VC-A1 cases C and D — suppressed attestation, and total silence', () => {
  it('case C — a suppressed attestation presents as a SEQUENCE GAP', async () => {
    // Registry `I17e`'s validation column: "Suppress one attestation and assert it
    // presents as a sequence gap." The attestation is a journal row, so withholding it is
    // withholding a sequence, and `I17`'s gap check is what sees it.
    await authoriseTwo();
    await emitAttestation(fixture.control.pool, COMPANY_ID, at(0)); // seq 3 — suppressed
    await emitAttestation(fixture.control.pool, COMPANY_ID, at(5)); // seq 4 — delivered
    await pushOnly(1n, 2n, 4n);

    const report = await evaluate(at(6));
    expect(report.gaps).toEqual([3n]);
    expect(kinds(report)).toContain('AUDIT_COMPLETENESS_GAP');
  });

  it('case D — the writer stops entirely, and `ATTESTATION_STALL` fires within k x cadence', async () => {
    await authoriseTwo();
    await emitAttestation(fixture.control.pool, COMPANY_ID, at(0));
    await fixture.pusher().pushPending(COMPANY_ID);

    // Nothing more is written and nothing more arrives.
    // At 14 minutes — inside the bound — the detector is SILENT.
    expect(kinds(await evaluate(at(14)))).not.toContain('ATTESTATION_STALL');
    // At 15 minutes exactly — still inside, the bound is `>`.
    expect(kinds(await evaluate(at(15)))).not.toContain('ATTESTATION_STALL');
    // Past `k x cadence` it fires.
    expect(kinds(await evaluate(at(16)))).toContain('ATTESTATION_STALL');

    const stalled = (await evaluate(at(16))).findings.find(
      (f) => f.kind === 'ATTESTATION_STALL',
    )!;
    expect(stalled.severity).toBe('CRITICAL');
    expect(stalled.detail['boundMs']).toBe(15 * 60 * 1000);
  });

  it('a store that has NEVER received an attestation is not "stalled"', async () => {
    // There is no channel to have stopped. Firing here would raise CRITICAL on every store
    // from the moment it is created, which is the cry-wolf failure `30 §5.4` cites as the
    // reason k is 3 rather than 1.
    await authoriseTwo();
    await pushOnly(1n, 2n);
    expect(kinds(await evaluate(at(600)))).toEqual([]);
  });

  it('THE VULNERABLE CONTROL: a detector reading `mirrored_at` calls the truncated store COMPLETE', async () => {
    // `§28` item 5 and item 7. The vulnerable rule: "every control row is marked mirrored,
    // therefore the mirror is complete."
    await authoriseTwo();
    await emitAttestation(fixture.control.pool, COMPANY_ID, at(0));
    await pushOnly(1n, 2n); // the attestation at seq 3 is NEVER delivered

    // The control plane sets the advisory column for every row, truthfully or not.
    const client = await fixture.control.connect();
    try {
      await client.query(`UPDATE effect_journal SET mirrored_at = now() WHERE company_id = $1`, [
        COMPANY_ID,
      ]);
      const vulnerable = await client.query<{ unmirrored: string }>(
        `SELECT count(*) AS unmirrored FROM effect_journal
          WHERE company_id = $1 AND mirrored_at IS NULL`,
        [COMPANY_ID],
      );
      // THE VULNERABLE VERDICT: "nothing outstanding, the mirror is complete."
      expect(vulnerable.rows[0]!.unmirrored).toBe('0');
    } finally {
      client.release();
    }

    // PRODUCTION reads the audit store instead, and holds only two of three rows. There is
    // no attestation in the holdings at all, so nothing yet claims a head — which is
    // precisely `30 §5.4`'s point that a store which stops receiving looks idle. What
    // discriminates is that production's verdict is computed from HOLDINGS, so when the
    // next attestation does arrive the inconsistency is visible.
    expect((await auditRows(fixture)).map((r) => r.journal_seq)).toEqual(['1', '2']);
    await emitAttestation(fixture.control.pool, COMPANY_ID, at(5)); // seq 4, attests max 3
    await pushOnly(4n);
    expect(kinds(await evaluate(at(6)))).toEqual(
      expect.arrayContaining(['AUDIT_COMPLETENESS_GAP', 'ATTESTATION_INCONSISTENT']),
    );
  });
});
