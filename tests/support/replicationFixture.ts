import { createHash } from 'node:crypto';

import type { Client, Pool } from '../../src/db/pool.js';
import { auditIngress, type AuditIngress } from '../../src/audit/ingress.js';
import { JournalPusher, type PushKillPoints } from '../../src/replication/journalPusher.js';
import type {
  AuditIngestOutcome,
  JournalTransportRecord,
} from '../../src/audit/transport/journalRecord.js';
import { createAuditHarness, type AuditHarness } from './auditHarness.js';
import { createHarness, type Harness } from './fixture.js';
import { COMPANY_ID } from './fixture.js';

/**
 * The S1G replication fixture — TWO REAL POSTGRESQL SERVERS.
 *
 * =================================================================================
 * NO SELF-VALIDATING ORACLE, AND THE S1G-SPECIFIC FORMS OF THAT RULE
 *
 * `36 §0`: "Independent validation must not call the same production function twice and
 * call agreement proof." For this slice that forbids five things specifically, and none
 * of them appears in this file or in any S1G test:
 *
 *   - the audit implementation calling the CONTROL canonicaliser. Structurally
 *     impossible: `acos_jcs1_*` does not exist on the audit server.
 *   - an expected row hash obtained from either production trigger. `VC-A3`'s oracle is
 *     `jcs1Oracle.ts`, hand-written, importing nothing from `src/`.
 *   - the production attestation builder computing the expected attestation. The
 *     attestation assertions read `emit_journal_attestation`'s OUTPUT and compare it to
 *     hand-authored quantities and to direct SQL over `effect_journal`.
 *   - `mirrored_at` deciding whether the audit store SHOULD hold a row. Every holdings
 *     assertion is direct SQL against `audit_journal` on the other server.
 *   - retry proved only through application return values. Every retry assertion reads
 *     the audit store's rows, its `chain_seq` and its `audit_incident` table directly.
 * =================================================================================
 */

export interface ReplicationFixture {
  readonly control: Harness;
  readonly audit: AuditHarness;
  readonly ingress: AuditIngress;
  pusher(kill?: PushKillPoints): JournalPusher;
  reset(): Promise<void>;
  close(): Promise<void>;
}

export async function createReplicationFixture(): Promise<ReplicationFixture> {
  const control = await createHarness();
  const audit = await createAuditHarness();
  await control.reset();
  await audit.reset();
  const ingress = auditIngress(audit.replication);

  return {
    control,
    audit,
    ingress,
    pusher(kill: PushKillPoints = {}) {
      return new JournalPusher(control.pool, ingress, kill);
    },
    async reset() {
      await control.reset();
      await audit.reset();
    },
    async close() {
      await control.close();
      await audit.close();
    },
  };
}

// =====================================================================================
// Direct SQL over the AUDIT store. Every holdings assertion goes through here.
// =====================================================================================

export interface AuditRow {
  readonly journal_seq: string;
  readonly journal_row_kind: string;
  readonly chain_seq: string;
  readonly claimed_row_hash: Buffer;
  readonly audit_prev_hash: Buffer;
  readonly audit_row_hash: Buffer;
  readonly prev_hash: Buffer | null;
  readonly transmitted_bytes: Buffer;
  readonly effect_id: string | null;
  readonly total_exposure: string | null;
  readonly attested_max_journal_seq: string | null;
  readonly attested_row_count: string | null;
  readonly attested_head_hash: Buffer | null;
  readonly received_from: string;
}

export async function auditRows(fixture: ReplicationFixture): Promise<readonly AuditRow[]> {
  const client = await fixture.audit.owner.connect();
  try {
    const result = await client.query<AuditRow>(
      `SELECT * FROM audit_journal WHERE company_id = $1 ORDER BY journal_seq`,
      [COMPANY_ID],
    );
    return result.rows;
  } finally {
    client.release();
  }
}

export interface AuditIncidentRow {
  readonly kind: string;
  readonly severity: string;
  readonly journal_seq: string | null;
  readonly detail: Record<string, unknown>;
}

export async function auditIncidents(
  fixture: ReplicationFixture,
): Promise<readonly AuditIncidentRow[]> {
  const client = await fixture.audit.owner.connect();
  try {
    const result = await client.query<AuditIncidentRow>(
      `SELECT kind, severity, journal_seq, detail FROM audit_incident
        WHERE company_id = $1 ORDER BY incident_id`,
      [COMPANY_ID],
    );
    return result.rows;
  } finally {
    client.release();
  }
}

// =====================================================================================
// Direct SQL over the CONTROL journal. Used by TESTS as an oracle of what the control
// plane committed — never by the audit plane, and never as an input to an audit check.
// =====================================================================================

export interface ControlJournalRow {
  readonly journal_seq: string;
  readonly journal_row_kind: string;
  readonly row_hash: Buffer;
  readonly prev_hash: Buffer | null;
  readonly mirrored_at: Date | null;
  readonly attested_max_journal_seq: string | null;
  readonly attested_row_count: string | null;
  readonly attested_head_hash: Buffer | null;
  readonly transmitted_bytes: Buffer;
}

export async function controlJournal(
  fixture: ReplicationFixture,
): Promise<readonly ControlJournalRow[]> {
  const client = await fixture.control.connect();
  try {
    const result = await client.query<ControlJournalRow>(
      `SELECT j.*, effect_journal_canonical_bytes(j.*) AS transmitted_bytes
         FROM effect_journal j WHERE j.company_id = $1 ORDER BY j.journal_seq`,
      [COMPANY_ID],
    );
    return result.rows;
  } finally {
    client.release();
  }
}

/** Build the transport record for one control journal row, exactly as the pusher does. */
export async function transportRecordFor(
  fixture: ReplicationFixture,
  journalSeq: bigint,
): Promise<JournalTransportRecord> {
  const client: Client = await fixture.control.connect();
  try {
    const result = await client.query<Record<string, unknown>>(
      `SELECT j.*, effect_journal_canonical_bytes(j.*) AS transmitted_bytes
         FROM effect_journal j WHERE j.company_id = $1 AND j.journal_seq = $2`,
      [COMPANY_ID, journalSeq.toString()],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error(`no control journal row at seq ${String(journalSeq)}`);
    return recordFromControlRow(row);
  } finally {
    client.release();
  }
}

export function recordFromControlRow(row: Record<string, unknown>): JournalTransportRecord {
  return {
    fields: {
      companyId: row['company_id'] as string,
      journalSeq: BigInt(row['journal_seq'] as string),
      journalRowKind: row['journal_row_kind'] as 'EFFECT_AUTHORISATION' | 'JOURNAL_ATTESTATION',
      effectId: (row['effect_id'] as string | null) ?? null,
      authorisationId: (row['authorisation_id'] as string | null) ?? null,
      decisionId: (row['decision_id'] as string | null) ?? null,
      reservationId: (row['reservation_id'] as string | null) ?? null,
      approvalId: (row['approval_id'] as string | null) ?? null,
      idempotencyKey: (row['idempotency_key'] as string | null) ?? null,
      actionClass: (row['action_class'] as string | null) ?? null,
      resourceRef: (row['resource_ref'] as string | null) ?? null,
      verdict: (row['verdict'] as string | null) ?? null,
      vendorAmount: (row['vendor_amount'] as string | null) ?? null,
      totalExposure: (row['total_exposure'] as string | null) ?? null,
      forwardIntegral: (row['forward_integral'] as string | null) ?? null,
      isRateClass: (row['is_rate_class'] as boolean | null) ?? null,
      dispatchPayloadHash: (row['dispatch_payload_hash'] as string | null) ?? null,
      constructorSemanticMajor: (row['constructor_semantic_major'] as number | null) ?? null,
      constructorNonSemanticMinor:
        (row['constructor_non_semantic_minor'] as number | null) ?? null,
      policyVersion: (row['policy_version'] as string | null) ?? null,
      attestedMaxJournalSeq:
        row['attested_max_journal_seq'] === null
          ? null
          : BigInt(row['attested_max_journal_seq'] as string),
      attestedRowCount:
        row['attested_row_count'] === null ? null : BigInt(row['attested_row_count'] as string),
      attestedHeadHash: (row['attested_head_hash'] as Buffer | null) ?? null,
      occurredAt: row['occurred_at'] as Date,
      prevHash: (row['prev_hash'] as Buffer | null) ?? null,
    },
    transmittedBytes: row['transmitted_bytes'] as Buffer,
    claimedRowHash: row['row_hash'] as Buffer,
  };
}

/**
 * A record whose STRUCTURED FIELDS were altered in transit while the control-side
 * `claimed_row_hash` was retained.
 *
 * `§9` of the S1G mandate: "A vulnerable receiver trusting the supplied hash must accept
 * it. Production audit ingestion must reject/detect it." The transmitted bytes are
 * regenerated to match the altered fields, so the attack is not defeated by a trivial
 * bytes-versus-fields comparison alone — the hash is what no longer fits.
 */
export function tamperStructuredField(
  record: JournalTransportRecord,
  overrides: Partial<JournalTransportRecord['fields']>,
  transmittedBytes: Buffer,
): JournalTransportRecord {
  return {
    fields: { ...record.fields, ...overrides },
    transmittedBytes,
    claimedRowHash: record.claimedRowHash, // the ORIGINAL claim, retained
  };
}

/** sha256, for building an attacker's own consistent-looking claim. */
export function sha256(bytes: Buffer): Buffer {
  return createHash('sha256').update(bytes).digest();
}

/** Ingest one record on a pool of the caller's choosing. */
export async function ingestAs(
  pool: Pool,
  record: JournalTransportRecord,
): Promise<AuditIngestOutcome> {
  return auditIngress(pool).ingest(record);
}

export { COMPANY_ID };
