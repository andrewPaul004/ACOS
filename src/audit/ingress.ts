import type { Client, Pool } from '../db/pool.js';
import type { AuditIngestOutcome, JournalTransportRecord } from './transport/journalRecord.js';

/**
 * The audit plane's ingress. S1G, the receiving half of `26 §7` step X.
 *
 * =================================================================================
 * WHAT THIS MODULE DOES NOT DO, AND WHY EACH ABSENCE IS LOAD-BEARING
 *
 *  - It does not open a control-database connection. `24 §3` K11's declared inputs
 *    contain no control-database read, and `30 §5.4` states why: "The audit plane has no
 *    independent reading of [the true control maximum] and by construction cannot: R10
 *    removed the replica deliberately." `plane-independence.test.ts` asserts that no file
 *    under `src/audit/` names `controlUrl`, `ACOS_CONTROL_PG_URL` or any control
 *    repository, and runs the evaluator with the control database unreachable.
 *
 *  - It does not canonicalise in TypeScript. The bytes are constructed by the AUDIT
 *    DATABASE, in `audit_journal_canonical_bytes`, under `acos_audit_owner`. `I17d`:
 *    "Hash and sequence values are computed by database functions inside each instance,
 *    under roles the writing principal cannot execute as." A canonicaliser in this
 *    process would be a canonicaliser the writing principal executes.
 *
 *  - It does not trust `claimedRowHash`. It hands it to the database AS A CLAIM, and the
 *    database refuses the row if its own computation disagrees. There is no branch here
 *    that writes a supplied hash into a chain column, because there is no such column
 *    this process can write at all.
 *
 *  - It decides nothing about dispatch. S1G dispatches nothing.
 * =================================================================================
 */

/**
 * The 44 bound parameters of `audit_ingest_journal_row`, in the declared order.
 *
 * S1G bound 27. S1H's `A0002` appends eleven, each `DEFAULT NULL`, for `30 §5.7`'s
 * declaration row, `§5.7.1`'s consumed-signal record and `§5.7.2` item 7's override events.
 * S1I's `A0005` appends six more, also `DEFAULT NULL`, for `25 §7`'s outbox claim.
 * The defaults are what keep the ACCEPTED 27- and 38-argument SQL call sites in
 * `post-commit-and-crash-matrix.test.ts` and `vc-a3-cross-implementation.test.ts` resolving
 * to the same function unchanged.
 */
const INGEST_SQL = `SELECT audit_ingest_journal_row(
  $1,  $2,  $3,  $4,  $5,  $6,  $7,  $8,  $9,  $10,
  $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
  $21, $22, $23, $24, $25, $26, $27, $28, $29, $30,
  $31, $32, $33, $34, $35, $36, $37, $38, $39, $40,
  $41, $42, $43, $44
) AS outcome`;

function bind(record: JournalTransportRecord): unknown[] {
  const f = record.fields;
  return [
    f.companyId,
    // BIGINT is bound as a string. `pg` has no bigint binding and a Number would silently
    // lose precision past 2^53 on a sequence the whole completeness argument rests on.
    f.journalSeq.toString(),
    f.journalRowKind,
    f.effectId,
    f.authorisationId,
    f.decisionId,
    f.reservationId,
    f.approvalId,
    f.idempotencyKey,
    f.actionClass,
    f.resourceRef,
    f.verdict,
    f.vendorAmount,
    f.totalExposure,
    f.forwardIntegral,
    f.isRateClass,
    f.dispatchPayloadHash,
    f.constructorSemanticMajor,
    f.constructorNonSemanticMinor,
    f.policyVersion,
    f.attestedMaxJournalSeq === null ? null : f.attestedMaxJournalSeq.toString(),
    f.attestedRowCount === null ? null : f.attestedRowCount.toString(),
    f.attestedHeadHash === null ? null : Buffer.from(f.attestedHeadHash),
    f.occurredAt,
    f.prevHash === null ? null : Buffer.from(f.prevHash),
    Buffer.from(record.claimedRowHash),
    Buffer.from(record.transmittedBytes),
    f.mirrorDeclarationId,
    f.mirrorDeclarationEvent,
    f.mirrorObservedReason,
    f.corroborationSignalId,
    f.corroborationIntervalStart,
    f.corroborationObservedAt,
    f.corroborationExpiresAt,
    f.corroborationReason,
    f.overrideId,
    f.overrideEvent,
    f.overrideActor,
    f.outboxId,
    f.outboxCorrelationTag,
    f.outboxClaimId,
    f.outboxMatchedRow,
    f.outboxMirrorState,
    f.outboxRequiresUnmirroredTag,
  ];
}

/**
 * Ingest one row on an existing audit-store connection.
 *
 * ONE audit transaction, and it is the audit store's own. `30 §5.1`: "Cross-database
 * atomicity is not attempted, because it does not exist." Nothing here can join a control
 * transaction, and the caller cannot pass one in: the parameter is an audit `Client`.
 */
export async function ingestOn(
  client: Client,
  record: JournalTransportRecord,
): Promise<AuditIngestOutcome> {
  const result = await client.query<{ outcome: AuditIngestOutcome }>(
    INGEST_SQL,
    bind(record),
  );
  const outcome = result.rows[0]?.outcome;
  if (outcome === undefined) {
    throw new Error('audit ingest returned no outcome');
  }
  return outcome;
}

/**
 * The audit plane's ingress endpoint, as the replication principal sees it.
 *
 * `30 §5.7.1` declares the audit plane's own HTTP read endpoint for the corroboration
 * signal, and S1G does not build it — that is `VC-A2d`'s work and `§5.7.1` records the
 * signing key and endpoint as separately provisioned. What S1G builds is the WRITE
 * direction the replication principal uses, and it is a database connection under a
 * scoped role, which is exactly what `30 §5`'s "the control plane holds INSERT and
 * nothing else" describes.
 */
export interface AuditIngress {
  ingest(record: JournalTransportRecord): Promise<AuditIngestOutcome>;
}

export function auditIngress(pool: Pool): AuditIngress {
  return {
    async ingest(record: JournalTransportRecord): Promise<AuditIngestOutcome> {
      const client = await pool.connect();
      try {
        return await ingestOn(client, record);
      } finally {
        client.release();
      }
    },
  };
}
