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
  tamperStructuredField,
  transportRecordFor,
  type ReplicationFixture,
} from '../../support/replicationFixture.js';
import { oracleCanonicalBytes, effectAuthorisationFields } from '../../support/jcs1Oracle.js';
import { emitAttestation } from '../../../src/replication/attestation.js';

/**
 * AUDIT INGESTION AND INDEPENDENT RE-CHAINING. S1G — `26 §7` step X, receiving side.
 *
 * =================================================================================
 * THE PROPERTY
 *
 * `30 §5.1` item 2: "The audit store is a REPLICATING VERIFIER, not a write-ahead
 * dependency. It receives rows, RE-CHAINS THEM UNDER ITS OWN TRIGGER, and verifies that
 * the chain it received is internally consistent and gap-free by `journal_seq`."
 *
 * `30 §5.9`: "Proves nothing at all if the writer computes the hashes. I17d."
 *
 * So the control plane's `row_hash` is EVIDENCE TO COMPARE and never an INSERT value. The
 * assertions below establish that by attack, not by reading the code: a row whose
 * structured fields were altered in transit while the original hash was retained must be
 * REFUSED, and the vulnerable receiver that trusts the supplied hash must ACCEPT it.
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
});

async function authoriseTwo(): Promise<void> {
  const spec = s1eSpec({ admittedResourceRefs: [S1E_PASS_ORDER.resourceRef, CAN03.resourceRef] });
  await proposeAndAuthorise(kernel, S1E_PASS_ORDER, { spec });
  await proposeAndAuthorise(kernel, CAN03, { spec });
}

// =====================================================================================
// The ordinary path.
// =====================================================================================

describe('the audit store receives STRUCTURED FIELDS and re-chains them itself', () => {
  it('a committed control row is replicated, and the audit store computes its OWN chain', async () => {
    await authoriseTwo();
    const run = await fixture.pusher().pushPending(COMPANY_ID);
    expect(run.pushed.map((p) => p.outcome)).toEqual(['ACCEPTED', 'ACCEPTED']);

    const held = await auditRows(fixture);
    expect(held).toHaveLength(2);

    // The AUDIT chain is the audit store's own, over ARRIVAL order, and the genesis links
    // from 32 zero bytes exactly as `30 §5.1` item 2 requires of a chain.
    expect(held[0]!.chain_seq).toBe('1');
    expect(held[1]!.chain_seq).toBe('2');
    expect(held[0]!.audit_prev_hash).toEqual(Buffer.alloc(32));
    expect(held[1]!.audit_prev_hash).toEqual(held[0]!.audit_row_hash);

    // `I17b` anchors `{head_hash, chain_seq, row_count}`, so `chain_seq` is a REAL
    // audit-local quantity and not a copy of `journal_seq`. Here they happen to coincide
    // because nothing was lost; `vc-a1-transport-loss.test.ts` shows them diverging.
    expect(held.map((r) => r.journal_seq)).toEqual(['1', '2']);

    // And the audit row hash is NOT the control row hash. It binds arrival order to
    // content; copying the control chain would prove nothing (I17d).
    expect(held[0]!.audit_row_hash.equals(held[0]!.claimed_row_hash)).toBe(false);
  });

  it('the audit store INDEPENDENTLY reproduces the row hash it was handed', async () => {
    await authoriseTwo();
    await fixture.pusher().pushPending(COMPANY_ID);

    // Recompute, on the AUDIT server, from the AUDIT store's own structured columns, using
    // the AUDIT canonicaliser. If the audit store had merely stored the claim, this would
    // still agree — so the discriminating assertion is the attack below, not this one.
    const client = await fixture.audit.owner.connect();
    try {
      const result = await client.query<{ agrees: boolean }>(
        `SELECT bool_and(sha256(audit_journal_canonical_bytes(a.*)) = a.claimed_row_hash) AS agrees
           FROM audit_journal a WHERE a.company_id = $1`,
        [COMPANY_ID],
      );
      expect(result.rows[0]!.agrees).toBe(true);
    } finally {
      client.release();
    }
  });

  it('and the transmitted bytes it stored equal the bytes the CONTROL plane sent', async () => {
    await authoriseTwo();
    await fixture.pusher().pushPending(COMPANY_ID);
    const record = await transportRecordFor(fixture, 1n);
    const held = await auditRows(fixture);
    expect(held[0]!.transmitted_bytes.equals(Buffer.from(record.transmittedBytes))).toBe(true);
  });

  it('and those bytes equal the INDEPENDENT ORACLE, so all three agree end to end', async () => {
    await authoriseTwo();
    await fixture.pusher().pushPending(COMPANY_ID);
    const control = await fixture.control.connect();
    let row: Record<string, unknown>;
    try {
      const result = await control.query<Record<string, unknown>>(
        `SELECT * FROM effect_journal WHERE company_id = $1 AND journal_seq = 1`,
        [COMPANY_ID],
      );
      row = result.rows[0]!;
    } finally {
      control.release();
    }
    const expected = oracleCanonicalBytes(
      effectAuthorisationFields({
        companyId: row['company_id'] as string,
        journalSeq: BigInt(row['journal_seq'] as string),
        effectId: row['effect_id'] as string,
        authorisationId: row['authorisation_id'] as string,
        decisionId: row['decision_id'] as string,
        reservationId: row['reservation_id'] as string,
        approvalId: row['approval_id'] as string | null,
        idempotencyKey: row['idempotency_key'] as string,
        actionClass: row['action_class'] as string,
        resourceRef: row['resource_ref'] as string,
        verdict: row['verdict'] as string,
        vendorAmount: row['vendor_amount'] as string | null,
        totalExposure: row['total_exposure'] as string,
        forwardIntegral: row['forward_integral'] as string | null,
        isRateClass: row['is_rate_class'] as boolean,
        dispatchPayloadHash: row['dispatch_payload_hash'] as string,
        constructorSemanticMajor: row['constructor_semantic_major'] as number,
        constructorNonSemanticMinor: row['constructor_non_semantic_minor'] as number,
        policyVersion: row['policy_version'] as string,
        occurredAt: row['occurred_at'] as Date,
        prevHash: row['prev_hash'] as Buffer,
      }),
    );
    const held = await auditRows(fixture);
    expect(held[0]!.transmitted_bytes.equals(expected)).toBe(true);
  });
});

// =====================================================================================
// `§9` — DO NOT TRUST THE CONTROL HASH.
// =====================================================================================

describe('a row altered in transit is REFUSED, however consistent the attacker makes it', () => {
  it('fields altered, ORIGINAL hash retained — the audit store recomputes and refuses', async () => {
    await authoriseTwo();
    const original = await transportRecordFor(fixture, 1n);

    // The attacker changes the money and regenerates the transmitted bytes so the wire is
    // self-consistent with the fields. What it CANNOT regenerate is the control plane's
    // signature over the original — it keeps the original `row_hash`.
    const alteredBytes = oracleCanonicalBytes(
      effectAuthorisationFields({
        companyId: original.fields.companyId,
        journalSeq: original.fields.journalSeq,
        effectId: original.fields.effectId!,
        authorisationId: original.fields.authorisationId!,
        decisionId: original.fields.decisionId!,
        reservationId: original.fields.reservationId!,
        approvalId: original.fields.approvalId,
        idempotencyKey: original.fields.idempotencyKey!,
        actionClass: original.fields.actionClass!,
        resourceRef: original.fields.resourceRef!,
        verdict: original.fields.verdict!,
        vendorAmount: original.fields.vendorAmount,
        totalExposure: '999.99', // ← the alteration
        forwardIntegral: original.fields.forwardIntegral,
        isRateClass: original.fields.isRateClass!,
        dispatchPayloadHash: original.fields.dispatchPayloadHash!,
        constructorSemanticMajor: original.fields.constructorSemanticMajor!,
        constructorNonSemanticMinor: original.fields.constructorNonSemanticMinor!,
        policyVersion: original.fields.policyVersion!,
        occurredAt: original.fields.occurredAt,
        prevHash: Buffer.from(original.fields.prevHash!),
      }),
    );
    const tampered = tamperStructuredField(
      original,
      { totalExposure: '999.99' },
      alteredBytes,
    );

    const outcome = await fixture.ingress.ingest(tampered);
    expect(outcome).toBe('AUDIT_CANONICAL_MISMATCH');
    expect(await auditRows(fixture)).toHaveLength(0);

    const incidents = await auditIncidents(fixture);
    expect(incidents.map((i) => i.kind)).toEqual(['AUDIT_CANONICAL_MISMATCH']);
    expect(incidents[0]!.severity).toBe('CRITICAL');
  });

  it('THE VULNERABLE CONTROL: a receiver that trusts the supplied hash ACCEPTS the same row', async () => {
    // `§28` requires the negative control to DISCRIMINATE. It writes the row through a
    // TEST-ONLY table with no verification trigger, and the row lands — which is exactly
    // what production refused one test above.
    //
    // The vulnerable receiver's rule: "the sender computed a hash, so the row is fine."
    await authoriseTwo();
    const original = await transportRecordFor(fixture, 1n);

    const client = await fixture.audit.owner.connect();
    try {
      await client.query(`CREATE TEMP TABLE vulnerable_audit_journal (
        company_id TEXT, journal_seq BIGINT, total_exposure NUMERIC(18,2), row_hash BYTEA)`);
      await client.query(
        `INSERT INTO vulnerable_audit_journal VALUES ($1, $2, $3, $4)`,
        [COMPANY_ID, '1', '999.99', Buffer.from(original.claimedRowHash)],
      );
      const stored = await client.query<{ total_exposure: string }>(
        `SELECT total_exposure FROM vulnerable_audit_journal`,
      );
      // The vulnerable store now holds a $999.99 refund carrying the hash of a $10.00 one.
      expect(stored.rows[0]!.total_exposure).toBe('999.99');
    } finally {
      client.release();
    }

    // And production still holds nothing, from the identical input.
    expect(await auditRows(fixture)).toHaveLength(0);
  });

  it('bytes altered while the FIELDS stay honest is refused too — the wire is checked both ways', async () => {
    await authoriseTwo();
    const original = await transportRecordFor(fixture, 1n);
    const flipped = Buffer.from(original.transmittedBytes);
    flipped[flipped.length - 1] = (flipped[flipped.length - 1] ?? 0) ^ 0xff;

    const outcome = await fixture.ingress.ingest({
      fields: original.fields,
      transmittedBytes: flipped,
      claimedRowHash: sha256(flipped), // a hash consistent with the ALTERED bytes
    });
    expect(outcome).toBe('AUDIT_CANONICAL_MISMATCH');
    expect(await auditRows(fixture)).toHaveLength(0);
  });

  it('a forged predecessor is refused — the CONTROL chain is verified over rows held', async () => {
    await authoriseTwo();
    await fixture.ingress.ingest(await transportRecordFor(fixture, 1n));

    // Row 2, with its `prev_hash` pointing at something the store does not hold.
    const second = await transportRecordFor(fixture, 2n);
    const forgedPrev = sha256(Buffer.from('not the predecessor'));
    const forgedBytes = Buffer.from(second.transmittedBytes);
    // The last framed field of an EFFECT_AUTHORISATION row is `prev_hash`, 32 bytes.
    forgedPrev.copy(forgedBytes, forgedBytes.length - 32);

    const outcome = await fixture.ingress.ingest({
      fields: { ...second.fields, prevHash: forgedPrev },
      transmittedBytes: forgedBytes,
      claimedRowHash: sha256(forgedBytes),
    });
    expect(outcome).toBe('AUDIT_CHAIN_BREAK');
    expect(await auditRows(fixture)).toHaveLength(1);
    expect((await auditIncidents(fixture)).map((i) => i.kind)).toContain('AUDIT_CHAIN_BREAK');
  });

  it('a genesis row that does not chain from 32 zero bytes is refused', async () => {
    await authoriseTwo();
    const first = await transportRecordFor(fixture, 1n);
    const forged = sha256(Buffer.from('a fabricated predecessor for seq 1'));
    const bytes = Buffer.from(first.transmittedBytes);
    forged.copy(bytes, bytes.length - 32);

    const outcome = await fixture.ingress.ingest({
      fields: { ...first.fields, prevHash: forged },
      transmittedBytes: bytes,
      claimedRowHash: sha256(bytes),
    });
    expect(outcome).toBe('AUDIT_CHAIN_BREAK');
    expect(await auditRows(fixture)).toHaveLength(0);
  });
});

// =====================================================================================
// `§10` — sequence identity.
// =====================================================================================

describe('sequence identity on the audit side', () => {
  it('`(company_id, journal_seq)` is the primary key — one row per sequence, structurally', async () => {
    const client = await fixture.audit.owner.connect();
    try {
      const result = await client.query<{ column_name: string }>(
        `SELECT a.attname AS column_name
           FROM pg_index i
           JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
          WHERE i.indrelid = 'audit_journal'::regclass AND i.indisprimary
          ORDER BY array_position(i.indkey, a.attnum)`,
      );
      expect(result.rows.map((r) => r.column_name)).toEqual(['company_id', 'journal_seq']);
    } finally {
      client.release();
    }
  });

  it('`mirrored_at` is NOT a column of the audit store at all', async () => {
    // `30 §5.2`: "It is a CONTROL-PLANE column [...] nothing depends on it." The strongest
    // form of "not a correctness operand" is that the evaluating side cannot see it.
    const client = await fixture.audit.owner.connect();
    try {
      const result = await client.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_name = 'audit_journal' AND column_name = 'mirrored_at'`,
      );
      expect(result.rows).toEqual([]);
    } finally {
      client.release();
    }
  });

  it('a gap is HELD, not refused — the store must be able to observe 1, 2, 4', async () => {
    // `30 §5.5` case 1 and `36 §2` VC-A1's mid-range omission. A receiver that REFUSED a
    // non-contiguous row could never report the gap, because it would never hold the row
    // that reveals one.
    //
    // Sequences 3 and 4 are ATTESTATIONS, which is how the journal advances without
    // consuming `W_DAY_REFUND`'s count of 2. They are ordinary journal rows on the
    // ordinary chain, which is the whole point of `30 §5.4`.
    await authoriseTwo();
    await emitAttestation(fixture.control.pool, COMPANY_ID, new Date('2026-01-05T00:05:00Z'));
    await emitAttestation(fixture.control.pool, COMPANY_ID, new Date('2026-01-05T00:10:00Z'));

    await fixture.ingress.ingest(await transportRecordFor(fixture, 1n));
    await fixture.ingress.ingest(await transportRecordFor(fixture, 2n));
    // Sequence 3 is withheld in transit. Sequence 4 arrives.
    const outcome = await fixture.ingress.ingest(await transportRecordFor(fixture, 4n));

    // ACCEPTED — the store cannot verify a predecessor it does not hold, and refusing
    // would destroy the evidence the gap check exists to read.
    expect(outcome).toBe('ACCEPTED');
    const held = await auditRows(fixture);
    expect(held.map((r) => r.journal_seq)).toEqual(['1', '2', '4']);

    // And `chain_seq` DIVERGES from `journal_seq`, which is why `I17b` names them
    // separately: the audit chain is over arrival, and three rows arrived.
    expect(held.map((r) => r.chain_seq)).toEqual(['1', '2', '3']);
    expect(held[2]!.audit_prev_hash).toEqual(held[1]!.audit_row_hash);
  });
});
