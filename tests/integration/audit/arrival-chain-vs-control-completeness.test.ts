import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

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
  createReplicationFixture,
  transportRecordFor,
  type ReplicationFixture,
} from '../../support/replicationFixture.js';
import { emitAttestation } from '../../../src/replication/attestation.js';
import { evaluateTransportCompleteness } from '../../../src/audit/transportCompleteness.js';

/**
 * THE ARRIVAL-ORDER AUDIT CHAIN IS SUPPLEMENTAL, AND NOTHING MORE. S1G-C4.
 *
 * =================================================================================
 * THE OWNER DISPOSITION THIS FILE ENFORCES
 *
 * `chain_seq` is ACCEPTED as an ADDITIONAL, AUDIT-LOCAL append chain. It may protect the
 * immutability and order of what the audit database actually received. It must NOT replace
 * or redefine the transported control-journal semantics.
 *
 * These remain authoritative for transport integrity and completeness, and every one of
 * them is a CONTROL-journal quantity:
 *
 *   - the control `journal_seq`;
 *   - the independently reconstructed `ACOS-JCS-1` row representation;
 *   - the independently verified control `prev_hash`;
 *   - the independently verified control `row_hash`;
 *   - `JournalAttestation`'s declared control head.
 *
 * `I17b` is why the arrival chain exists at all: it anchors
 * `{head_hash, chain_seq, row_count}` — three quantities, with `chain_seq` named
 * separately from `count(DISTINCT journal_seq)`. `I17d` names "`prev_hash`, `row_hash` and
 * `chain_seq`" as values the writer must not compute. And `30 §5.5` case 1 forces arrival
 * order specifically: the store must be able to hold `1, 2, 4` and report `3` missing, and
 * a store that chained by `journal_seq` could not accept `4` at all.
 *
 * SO THE ARRIVAL CHAIN IS TAMPER-EVIDENCE OVER THE STORE'S OWN HOLDINGS. If it were the
 * basis of `I17`/`I17e` completeness it would be a DEFECT: a store that received 1 and 3
 * has an internally perfect arrival chain of length two, and a completeness check reading
 * it would report a complete prefix over a journal missing sequence 2.
 * =================================================================================
 *
 * `§13` of the S1G owner-resolution mandate requires six proofs, and each has a test
 * below in order: in-order receipt; a benign retry of 2 after 3; 1 then 3 with 2 missing;
 * 3 before 2; that the arrival chain cannot make a missing `journal_seq` look complete;
 * and that the attestation comparison is against control-journal semantics rather than the
 * arrival-order chain head.
 */

let fixture: ReplicationFixture;
let kernel: LocalAuthorityHarness;

const AT = new Date('2026-01-05T00:20:00Z');

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

/**
 * Four control journal rows: two real authorisations, then two attestations.
 *
 * Attestations advance the journal without consuming `W_DAY_REFUND`'s count of 2, and they
 * are ordinary rows on the ordinary chain — `30 §5.4`.
 */
async function fourControlRows(): Promise<void> {
  const spec = s1eSpec({ admittedResourceRefs: [S1E_PASS_ORDER.resourceRef, CAN03.resourceRef] });
  await proposeAndAuthorise(kernel, S1E_PASS_ORDER, { spec });
  await proposeAndAuthorise(kernel, CAN03, { spec });
  await emitAttestation(fixture.control.pool, COMPANY_ID, new Date('2026-01-05T00:05:00Z'));
  await emitAttestation(fixture.control.pool, COMPANY_ID, new Date('2026-01-05T00:10:00Z'));
}

async function ingest(seq: bigint): Promise<string> {
  return fixture.ingress.ingest(await transportRecordFor(fixture, seq));
}

// =====================================================================================
// 1-4. What the arrival chain records, across four transport orders.
// =====================================================================================

describe('the arrival chain records ARRIVAL, in whatever order transport delivers', () => {
  it('1 — sequences 1, 2, 3 in order: `chain_seq` tracks `journal_seq`, coincidentally', async () => {
    await fourControlRows();
    expect(await ingest(1n)).toBe('ACCEPTED');
    expect(await ingest(2n)).toBe('ACCEPTED');
    expect(await ingest(3n)).toBe('ACCEPTED');

    const held = await auditRows(fixture);
    expect(held.map((r) => r.journal_seq)).toEqual(['1', '2', '3']);
    expect(held.map((r) => r.chain_seq)).toEqual(['1', '2', '3']);

    // The agreement is a COINCIDENCE of in-order delivery, not a property. The next three
    // tests break it, and nothing that matters depends on it.
    expect(held[1]!.audit_prev_hash).toEqual(held[0]!.audit_row_hash);
    expect(held[2]!.audit_prev_hash).toEqual(held[1]!.audit_row_hash);

    // And the completeness evaluator finds nothing, because nothing is missing.
    const report = await evaluateTransportCompleteness(fixture.audit.evaluator, COMPANY_ID, AT);
    expect(report.gaps).toEqual([]);
  });

  it('2 — a BENIGN RETRY of 2 arriving after 3 advances NOTHING', async () => {
    await fourControlRows();
    await ingest(1n);
    await ingest(2n);
    await ingest(3n);

    // The pusher's acknowledgement for 2 was lost, so it re-pushes 2 after 3 has landed.
    // `30 §5.2`: `ON CONFLICT DO NOTHING` on `(company_id, journal_seq)`; same hash is
    // INFO. The arrival chain must NOT gain a fourth link for a row it already holds.
    expect(await ingest(2n)).toBe('AUDIT_PUSH_DUPLICATE');

    const held = await auditRows(fixture);
    expect(held.map((r) => r.journal_seq)).toEqual(['1', '2', '3']);
    expect(held.map((r) => r.chain_seq)).toEqual(['1', '2', '3']);
    // Sequence 2 keeps the arrival position it originally took. A retry is not an arrival.
    expect(held[1]!.chain_seq).toBe('2');
  });

  it('3 — 1 then 3 with 2 MISSING: the row is HELD and the arrival chain closes over it', async () => {
    await fourControlRows();
    await ingest(1n);
    // Sequence 2 is lost in transit.
    expect(await ingest(3n)).toBe('ACCEPTED');

    const held = await auditRows(fixture);
    expect(held.map((r) => r.journal_seq)).toEqual(['1', '3']);
    // TWO rows arrived, so the arrival chain has two links and is internally perfect.
    expect(held.map((r) => r.chain_seq)).toEqual(['1', '2']);
    expect(held[1]!.audit_prev_hash).toEqual(held[0]!.audit_row_hash);
  });

  it('4 — 3 BEFORE 2: transport can reorder, and the arrival chain simply records it', async () => {
    await fourControlRows();
    await ingest(1n);
    expect(await ingest(3n)).toBe('ACCEPTED');
    expect(await ingest(2n)).toBe('ACCEPTED');

    const held = await auditRows(fixture);
    // `auditRows` orders by `journal_seq`, so the store's holdings read 1, 2, 3 …
    expect(held.map((r) => r.journal_seq)).toEqual(['1', '2', '3']);
    // … while the arrival chain records that 3 arrived SECOND and 2 arrived THIRD.
    expect(held.map((r) => r.chain_seq)).toEqual(['1', '3', '2']);

    // The arrival chain still links in arrival order, which is the only order it can
    // link in — 2's predecessor is the row that arrived before it, which is 3.
    const byChainSeq = [...held].sort((a, b) => Number(a.chain_seq) - Number(b.chain_seq));
    expect(byChainSeq.map((r) => r.journal_seq)).toEqual(['1', '3', '2']);
    expect(byChainSeq[1]!.audit_prev_hash).toEqual(byChainSeq[0]!.audit_row_hash);
    expect(byChainSeq[2]!.audit_prev_hash).toEqual(byChainSeq[1]!.audit_row_hash);

    // And out-of-order arrival does not disturb the CONTROL chain verification: each row's
    // structured `prev_hash` still matches the row the store holds at `journal_seq - 1`.
    for (let i = 1; i < held.length; i += 1) {
      expect(held[i]!.prev_hash).toEqual(held[i - 1]!.claimed_row_hash);
    }
  });
});

// =====================================================================================
// 5. The DEFECT the disposition forbids: arrival order used as control completeness.
// =====================================================================================

describe('the arrival chain CANNOT make a missing control `journal_seq` look complete', () => {
  it('5 — the store holds 1 and 3, its arrival chain is perfect, and the GAP IS REPORTED', async () => {
    await fourControlRows();
    await ingest(1n);
    await ingest(3n);

    const held = await auditRows(fixture);
    // A perfect arrival chain of length two: contiguous `chain_seq`, linked hashes.
    expect(held.map((r) => r.chain_seq)).toEqual(['1', '2']);
    expect(held[1]!.audit_prev_hash).toEqual(held[0]!.audit_row_hash);

    // AND THE EVALUATOR STILL REPORTS THE GAP, because it reads `journal_seq`.
    const report = await evaluateTransportCompleteness(fixture.audit.evaluator, COMPANY_ID, AT);
    expect(report.gaps.map(String)).toEqual(['2']);
    expect(report.findings.map((f) => f.kind)).toContain('AUDIT_COMPLETENESS_GAP');
    expect(report.heldSequences.map(String)).toEqual(['1', '3']);
  });

  it('and the DEFECTIVE evaluator — one reading arrival order — would call it complete', async () => {
    // THE VULNERABLE CONTROL. Written here, never in `src/`, so the discrimination is
    // demonstrated rather than asserted. If `chain_seq` were the basis of `I17`, this is
    // the answer the audit plane would give.
    await fourControlRows();
    await ingest(1n);
    await ingest(3n);
    const held = await auditRows(fixture);

    const defectiveGaps = (rows: readonly { chain_seq: string }[]): string[] => {
      const arrival = new Set(rows.map((r) => r.chain_seq));
      const max = Math.max(...rows.map((r) => Number(r.chain_seq)));
      const missing: string[] = [];
      for (let s = 1; s <= max; s += 1) if (!arrival.has(String(s))) missing.push(String(s));
      return missing;
    };

    // The defective reading finds NOTHING missing — the arrival chain is contiguous.
    expect(defectiveGaps(held)).toEqual([]);
    // The production reading finds sequence 2.
    const report = await evaluateTransportCompleteness(fixture.audit.evaluator, COMPANY_ID, AT);
    expect(report.gaps.map(String)).toEqual(['2']);
    // So the two disagree on this exact fixture, which is what makes the test discriminate.
    expect(defectiveGaps(held)).not.toEqual(report.gaps.map(String));
  });

  it('and `chain_seq` appears NOWHERE in the completeness evaluator, by source', async () => {
    // The sharpest form: the module that owns `I17` and `I17e` cannot read arrival order,
    // because it never names it.
    const source = await readFile(
      join(process.cwd(), 'src', 'audit', 'transportCompleteness.ts'),
      'utf8',
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toContain('chain_seq');
    expect(code).not.toContain('audit_prev_hash');
    expect(code).not.toContain('audit_row_hash');
    // And it does read the control-journal quantities that ARE authoritative.
    expect(code).toContain('journal_seq');
    expect(code).toContain('attested_max_journal_seq');
    expect(code).toContain('claimed_row_hash');
  });
});

// =====================================================================================
// 6. The attestation comparison is against CONTROL-journal semantics.
// =====================================================================================

describe('the attestation is compared against the CONTROL head, not the arrival head', () => {
  it('6 — a truncated tail is caught even though the arrival chain is intact', async () => {
    // Four control rows exist; three are delivered. The fourth is an attestation
    // describing the prefix through 3 — so the store holds an attestation whose declared
    // control maximum it can check, and an arrival chain with no gap in it at all.
    await fourControlRows();
    await ingest(1n);
    await ingest(2n);
    await ingest(4n); // the attestation at seq 4, describing the prefix through 3

    const held = await auditRows(fixture);
    // The arrival chain is contiguous and internally perfect: three arrivals, three links.
    expect(held.map((r) => r.chain_seq)).toEqual(['1', '2', '3']);
    expect(held[2]!.audit_prev_hash).toEqual(held[1]!.audit_row_hash);

    // The attestation's declared CONTROL head is 3, and the store does not hold 3.
    const attestation = held.find((r) => r.journal_row_kind === 'JOURNAL_ATTESTATION');
    expect(attestation?.attested_max_journal_seq).toBe('3');

    const report = await evaluateTransportCompleteness(fixture.audit.evaluator, COMPANY_ID, AT);
    expect(report.latestAttestation?.attestedMaxJournalSeq).toBe(3n);
    expect(report.findings.map((f) => f.kind)).toContain('ATTESTATION_INCONSISTENT');

    // And the finding names the CONTROL-journal quantities, not `chain_seq`.
    const finding = report.findings.find((f) => f.kind === 'ATTESTATION_INCONSISTENT')!;
    expect(Object.keys(finding.detail)).toEqual(
      expect.arrayContaining([
        'attestedMaxJournalSeq',
        'attestedRowCount',
        'missingBelowAttestedMax',
        'headHashMatches',
      ]),
    );
    expect(JSON.stringify(finding.detail)).not.toContain('chain');
  });

  it('the attested head hash is compared to the row hash at the attested CONTROL sequence', async () => {
    await fourControlRows();
    await ingest(1n);
    await ingest(2n);
    await ingest(3n);
    await ingest(4n);

    const held = await auditRows(fixture);
    const attestation = held.find((r) => r.journal_seq === '4')!;
    const headRow = held.find((r) => r.journal_seq === attestation.attested_max_journal_seq)!;

    // The attested head is the CONTROL row hash at the attested control sequence — the
    // value THIS STORE recomputed at ingest, not the arrival-chain head.
    expect(attestation.attested_head_hash).toEqual(headRow.claimed_row_hash);
    const arrivalHead = [...held].sort((a, b) => Number(b.chain_seq) - Number(a.chain_seq))[0]!;
    expect(attestation.attested_head_hash).not.toEqual(arrivalHead.audit_row_hash);

    // A complete, consistent prefix produces no finding — the check discriminates.
    const report = await evaluateTransportCompleteness(fixture.audit.evaluator, COMPANY_ID, AT);
    expect(report.findings.filter((f) => f.kind !== 'ATTESTATION_STALL')).toEqual([]);
  });

  it('and `row_count` is `count(DISTINCT journal_seq)`, so a retry cannot fake completeness', async () => {
    // `30 §5.2`. If the count were arrivals, a benign re-push would inflate it and either
    // mask a gap or slander an honest attester. Both directions are asserted.
    await fourControlRows();
    await ingest(1n);
    await ingest(3n);
    await ingest(1n); // benign retry — a second ARRIVAL of a sequence already held
    await ingest(4n); // the attestation, declaring the control prefix through 3

    const held = await auditRows(fixture);
    expect(held.map((r) => r.journal_seq)).toEqual(['1', '3', '4']);
    // Three rows held, three arrivals recorded — the retry added neither.
    expect(held.map((r) => r.chain_seq)).toEqual(['1', '2', '3']);

    const report = await evaluateTransportCompleteness(fixture.audit.evaluator, COMPANY_ID, AT);
    // The gap at 2 is still reported: the extra arrival did not fill it.
    expect(report.gaps.map(String)).toEqual(['2']);
    expect(report.findings.map((f) => f.kind)).toContain('AUDIT_COMPLETENESS_GAP');
    expect(report.findings.map((f) => f.kind)).toContain('ATTESTATION_INCONSISTENT');
  });
});
