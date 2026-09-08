import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

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
  auditIncidents,
  auditRows,
  createReplicationFixture,
  sha256,
  transportRecordFor,
  type ReplicationFixture,
} from '../../support/replicationFixture.js';
import { isAcknowledgement } from '../../../src/audit/transport/journalRecord.js';
import type { JournalTransportRecord } from '../../../src/audit/transport/journalRecord.js';
import {
  effectAuthorisationFields,
  oracleCanonicalBytes,
} from '../../support/jcs1Oracle.js';

/**
 * RETRY-SAFE DUPLICATES AND SEQUENCE COLLISIONS. S1G, `30 §5.2`.
 *
 * =================================================================================
 * THE CONTRACT, VERBATIM, AND THE REASON IT IS NOT OBVIOUS
 *
 *   | Case                                                      | Behaviour
 *   | UNIQUE(company_id, journal_seq) conflict, IDENTICAL row_hash | ON CONFLICT DO
 *   |   NOTHING. Emit `AUDIT_PUSH_DUPLICATE` at INFO. This is the expected retry.
 *   | Conflict, DIFFERING row_hash | Reject. Emit `AUDIT_SEQUENCE_COLLISION` at CRITICAL.
 *   |   Two different rows claiming one sequence is either a control-plane bug or a
 *   |   rewrite attempt, and it is never benign.
 *   | row_count | count(DISTINCT journal_seq). Anchored quantities are unaffected.
 *
 * `30 §5.2` on why every naive answer is wrong: "rejecting the duplicate breaks the retry;
 * accepting it duplicates a row inside a hash chain; and counting it inflates `row_count`,
 * WHICH IS AN ANCHORED QUANTITY, so a benign retry storm would corrupt the anchor and
 * produce a permanent unresolvable `I17b` discrepancy."
 *
 * Every assertion below reads the audit store's ROWS, its `chain_seq` and its
 * `audit_incident` table by direct SQL. None is proved by an application return value
 * alone — `§29` forbids exactly that.
 * =================================================================================
 */

let fixture: ReplicationFixture;
let kernel: LocalAuthorityHarness;

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
  const spec = s1eSpec({ admittedResourceRefs: [S1E_PASS_ORDER.resourceRef, CAN03.resourceRef] });
  await proposeAndAuthorise(kernel, S1E_PASS_ORDER, { spec });
  await proposeAndAuthorise(kernel, CAN03, { spec });
});

/**
 * A DIFFERENT row, fully self-consistent, claiming an EXISTING sequence.
 *
 * This is what `30 §5.2`'s critical row actually looks like: "two different rows claiming
 * one sequence". The bytes and the hash are rebuilt by the INDEPENDENT ORACLE for the
 * altered fields, so the row survives every check the audit store makes on ONE row and
 * fails only the one check that compares it to what the store already holds.
 *
 * A carelessly built conflicting row — altered fields with the ORIGINAL bytes — is a
 * different attack (`AUDIT_CANONICAL_MISMATCH`, asserted in
 * `ingestion-and-rechaining.test.ts`) and would not exercise the collision path at all.
 */
function conflictingRowAt(
  record: JournalTransportRecord,
  alteredResourceRef: string,
): JournalTransportRecord {
  const f = record.fields;
  const fields = { ...f, resourceRef: alteredResourceRef };
  const bytes = oracleCanonicalBytes(
    effectAuthorisationFields({
      companyId: f.companyId,
      journalSeq: f.journalSeq,
      effectId: f.effectId!,
      authorisationId: f.authorisationId!,
      decisionId: f.decisionId!,
      reservationId: f.reservationId!,
      approvalId: f.approvalId,
      idempotencyKey: f.idempotencyKey!,
      actionClass: f.actionClass!,
      resourceRef: alteredResourceRef,
      verdict: f.verdict!,
      vendorAmount: f.vendorAmount,
      totalExposure: f.totalExposure!,
      forwardIntegral: f.forwardIntegral,
      isRateClass: f.isRateClass!,
      dispatchPayloadHash: f.dispatchPayloadHash!,
      constructorSemanticMajor: f.constructorSemanticMajor!,
      constructorNonSemanticMinor: f.constructorNonSemanticMinor!,
      policyVersion: f.policyVersion!,
      occurredAt: f.occurredAt,
      prevHash: f.prevHash === null ? null : Buffer.from(f.prevHash),
    }),
  );
  return { fields, transmittedBytes: bytes, claimedRowHash: sha256(bytes) };
}

async function chainState(): Promise<{ rows: number; head: string; count: number }> {
  const held = await auditRows(fixture);
  return {
    rows: held.length,
    head: held[held.length - 1]?.audit_row_hash.toString('hex') ?? '',
    count: new Set(held.map((r) => r.journal_seq)).size,
  };
}

// =====================================================================================
// Case 1 — the ordinary first push.
// =====================================================================================

describe('case 1 — first push', () => {
  it('is ACCEPTED, writes one row and advances the chain once', async () => {
    const outcome = await fixture.ingress.ingest(await transportRecordFor(fixture, 1n));
    expect(outcome).toBe('ACCEPTED');
    const state = await chainState();
    expect(state.rows).toBe(1);
    expect(state.count).toBe(1);
    expect(await auditIncidents(fixture)).toEqual([]);
  });
});

// =====================================================================================
// Cases 2, 3, 4 — the benign retry, in the three ways it arises.
// =====================================================================================

describe('cases 2-4 — the EXPECTED retry is benign', () => {
  it('case 2 — an exact duplicate is `AUDIT_PUSH_DUPLICATE` at INFO, and NOTHING advances', async () => {
    const record = await transportRecordFor(fixture, 1n);
    await fixture.ingress.ingest(record);
    const before = await chainState();

    const outcome = await fixture.ingress.ingest(record);
    expect(outcome).toBe('AUDIT_PUSH_DUPLICATE');
    expect(isAcknowledgement(outcome)).toBe(true); // the pusher treats it as success

    const after = await chainState();
    // No second row.
    expect(after.rows).toBe(before.rows);
    // No second chain advancement — the head is byte-identical.
    expect(after.head).toBe(before.head);
    // And `row_count` — `count(DISTINCT journal_seq)` — is not poisoned.
    expect(after.count).toBe(1);

    const incidents = await auditIncidents(fixture);
    expect(incidents).toHaveLength(1);
    expect(incidents[0]!.kind).toBe('AUDIT_PUSH_DUPLICATE');
    expect(incidents[0]!.severity).toBe('INFO');
  });

  it('case 3 — the ACK is lost, the pusher retries, and the store answers benignly', async () => {
    // The ACK loss is modelled where it actually happens: the audit store COMMITTED, and
    // the acknowledgement never reached the control plane, so `mirrored_at` stayed null
    // and the row is still in the backlog.
    let dropped = false;
    const pusher = fixture.pusher({
      afterIngestBeforeAck(seq) {
        if (seq === 1n && !dropped) {
          dropped = true;
          throw new Error('ACK LOST IN TRANSIT');
        }
      },
    });
    await expect(pusher.pushPending(COMPANY_ID)).rejects.toThrow('ACK LOST IN TRANSIT');

    // The audit store holds the row; the control plane does not know it.
    expect((await auditRows(fixture)).map((r) => r.journal_seq)).toEqual(['1']);
    expect(await mirroredAt(1n)).toBeNull();

    const before = await chainState();
    const run = await fixture.pusher().pushPending(COMPANY_ID);
    expect(run.pushed[0]).toMatchObject({ journalSeq: 1n, outcome: 'AUDIT_PUSH_DUPLICATE' });

    const after = await chainState();
    expect(after.rows).toBe(before.rows + 1); // seq 2, which had never been pushed
    expect(after.count).toBe(2);
    // Exactly one duplicate incident, for seq 1, and no collision.
    const kinds = (await auditIncidents(fixture)).map((i) => i.kind);
    expect(kinds).toEqual(['AUDIT_PUSH_DUPLICATE']);
  });

  it('case 4 — the `mirrored_at` update is lost, and the re-push is still benign', async () => {
    const pusher = fixture.pusher({
      afterAckBeforeMirroredAt(seq) {
        if (seq === 1n) throw new Error('CRASH BEFORE mirrored_at');
      },
    });
    await expect(pusher.pushPending(COMPANY_ID)).rejects.toThrow('CRASH BEFORE mirrored_at');
    expect(await mirroredAt(1n)).toBeNull();

    const run = await fixture.pusher().pushPending(COMPANY_ID);
    expect(run.pushed.map((p) => p.outcome)).toEqual(['AUDIT_PUSH_DUPLICATE', 'ACCEPTED']);
    // Exactly two audit rows — the duplicate produced none.
    expect(await auditRows(fixture)).toHaveLength(2);
    // And the advisory column is recorded on the retry.
    expect(await mirroredAt(1n)).not.toBeNull();
  });
});

// =====================================================================================
// Cases 5, 6 — the security event. `30 §5.2`: "it is never benign."
// =====================================================================================

describe('cases 5-6 — a CONFLICTING push at an existing sequence is CRITICAL', () => {
  it('case 5 — the same sequence with a CHANGED FIELD does not overwrite', async () => {
    const original = await transportRecordFor(fixture, 1n);
    await fixture.ingress.ingest(original);
    const before = await chainState();
    const heldBefore = await auditRows(fixture);

    // A different row, fully self-consistent, claiming sequence 1.
    const conflicting = conflictingRowAt(original, 'order:REWRITTEN');

    const outcome = await fixture.ingress.ingest(conflicting);
    expect(outcome).toBe('AUDIT_SEQUENCE_COLLISION');
    expect(isAcknowledgement(outcome)).toBe(false);

    // THE HELD ROW IS UNTOUCHED.
    const heldAfter = await auditRows(fixture);
    expect(heldAfter).toHaveLength(1);
    expect(heldAfter[0]!.claimed_row_hash.equals(heldBefore[0]!.claimed_row_hash)).toBe(true);
    expect(heldAfter[0]!.effect_id).toBe(heldBefore[0]!.effect_id);
    expect((await chainState()).head).toBe(before.head);

    const incidents = await auditIncidents(fixture);
    expect(incidents).toHaveLength(1);
    expect(incidents[0]!.kind).toBe('AUDIT_SEQUENCE_COLLISION');
    expect(incidents[0]!.severity).toBe('CRITICAL');
    expect(incidents[0]!.journal_seq).toBe('1');
  });

  it('case 6 — the same sequence with a CHANGED SUPPLIED HASH is also CRITICAL', async () => {
    const original = await transportRecordFor(fixture, 1n);
    await fixture.ingress.ingest(original);

    const outcome = await fixture.ingress.ingest({
      ...original,
      claimedRowHash: sha256(Buffer.from('a different claim for the same sequence')),
    });
    expect(outcome).toBe('AUDIT_SEQUENCE_COLLISION');
    expect(await auditRows(fixture)).toHaveLength(1);
    expect((await auditIncidents(fixture))[0]!.kind).toBe('AUDIT_SEQUENCE_COLLISION');
  });

  it('THE VULNERABLE CONTROL: a receiver that treats any conflict as a benign retry LOSES the collision', async () => {
    // `§28` item 4. The vulnerable rule is the plausible one — "ON CONFLICT DO NOTHING,
    // always" — and it discriminates: it returns the SAME answer as the benign case, so a
    // rewrite attempt at an occupied sequence becomes indistinguishable from network
    // weather.
    const original = await transportRecordFor(fixture, 1n);
    await fixture.ingress.ingest(original);
    const other = conflictingRowAt(original, 'order:REWRITTEN');

    const client = await fixture.audit.owner.connect();
    try {
      await client.query(`CREATE TEMP TABLE vulnerable_holdings (
        company_id TEXT, journal_seq BIGINT, row_hash BYTEA,
        PRIMARY KEY (company_id, journal_seq))`);
      await client.query(`INSERT INTO vulnerable_holdings VALUES ($1, 1, $2)`, [
        COMPANY_ID,
        Buffer.from(original.claimedRowHash),
      ]);
      const vulnerable = await client.query(
        `INSERT INTO vulnerable_holdings VALUES ($1, 1, $2)
         ON CONFLICT DO NOTHING RETURNING journal_seq`,
        [COMPANY_ID, Buffer.from(other.claimedRowHash)],
      );
      // The vulnerable receiver reports "nothing happened" and raises no incident. It
      // cannot distinguish this from case 2.
      expect(vulnerable.rowCount).toBe(0);
    } finally {
      client.release();
    }

    // PRODUCTION raised CRITICAL for the same input — one incident, on the audit side,
    // that the control plane can neither read nor delete.
    const outcome = await fixture.ingress.ingest(other);
    expect(outcome).toBe('AUDIT_SEQUENCE_COLLISION');
    expect((await auditIncidents(fixture)).map((i) => i.severity)).toContain('CRITICAL');
  });
});

// =====================================================================================
// Cases 7, 8 — concurrency, against real PostgreSQL.
// =====================================================================================

describe('cases 7-8 — concurrent pushes at one sequence', () => {
  it('case 7 — concurrent EXACT duplicates produce ONE row and no collision', async () => {
    const record = await transportRecordFor(fixture, 1n);
    const outcomes = await Promise.all([
      fixture.ingress.ingest(record),
      fixture.ingress.ingest(record),
      fixture.ingress.ingest(record),
      fixture.ingress.ingest(record),
    ]);

    // Exactly one winner; the rest are benign retries. Which one wins is a race, so the
    // assertion is on the MULTISET, not on the order.
    expect(outcomes.filter((o) => o === 'ACCEPTED')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'AUDIT_PUSH_DUPLICATE')).toHaveLength(3);
    expect(outcomes.every(isAcknowledgement)).toBe(true);

    const held = await auditRows(fixture);
    expect(held).toHaveLength(1);
    expect(held[0]!.chain_seq).toBe('1');
    expect((await auditIncidents(fixture)).every((i) => i.kind === 'AUDIT_PUSH_DUPLICATE')).toBe(
      true,
    );
  });

  it('case 8 — concurrent CONFLICTING pushes still produce one row and a CRITICAL incident', async () => {
    const honest = await transportRecordFor(fixture, 1n);
    const conflicting = conflictingRowAt(honest, 'order:REWRITTEN');

    const outcomes = await Promise.all([
      fixture.ingress.ingest(honest),
      fixture.ingress.ingest(conflicting),
      fixture.ingress.ingest(honest),
      fixture.ingress.ingest(conflicting),
    ]);

    // One row is stored. Whichever arrived first, the other is a collision — never a
    // benign duplicate, and never an overwrite.
    const held = await auditRows(fixture);
    expect(held).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'ACCEPTED')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'AUDIT_SEQUENCE_COLLISION').length).toBeGreaterThanOrEqual(
      1,
    );

    const critical = (await auditIncidents(fixture)).filter((i) => i.severity === 'CRITICAL');
    expect(critical.length).toBeGreaterThanOrEqual(1);
    expect(critical.every((i) => i.kind === 'AUDIT_SEQUENCE_COLLISION')).toBe(true);

    // And the stored row is one of the two ORIGINALS, unmodified.
    const storedHash = held[0]!.claimed_row_hash;
    expect(
      storedHash.equals(Buffer.from(honest.claimedRowHash)) ||
        storedHash.equals(Buffer.from(conflicting.claimedRowHash)),
    ).toBe(true);
  });
});

async function mirroredAt(seq: bigint): Promise<Date | null> {
  const client = await fixture.control.connect();
  try {
    const result = await client.query<{ mirrored_at: Date | null }>(
      `SELECT mirrored_at FROM effect_journal WHERE company_id = $1 AND journal_seq = $2`,
      [COMPANY_ID, seq.toString()],
    );
    return result.rows[0]?.mirrored_at ?? null;
  } finally {
    client.release();
  }
}
