import type { Client, Pool } from '../db/pool.js';
import type { AuditIngress } from '../audit/ingress.js';
import type {
  AuditIngestOutcome,
  JournalRowKind,
  JournalTransportRecord,
} from '../audit/transport/journalRecord.js';
import { isAcknowledgement } from '../audit/transport/journalRecord.js';

/**
 * The CONTROL plane's half of `26 §7` step X: the post-COMMIT push to the audit store.
 *
 * =================================================================================
 * WHERE THIS RUNS IN `30 §5.1`'s ORDERING BLOCK
 *
 *     BEGIN
 *       ... window balances, journal counter, authorisation, effect, reservation,
 *           state transition, journal row
 *     COMMIT                                  -- durable, locally chained, gap-free   ← S1F
 *       ↓
 *     push to audit store (async, retried, quota-bounded, idempotent per §5.2)        ← HERE
 *       ↓
 *     dispatch, per (4)                                                               ← NOT BUILT
 *
 * "Cross-database atomicity is not attempted, because it does not exist. What replaces it
 * is a gap-free local sequence the audit store can prove it has all of."
 *
 * So: this module never opens a control transaction that spans an audit call, never rolls
 * a control commit back because an audit call failed, and never runs before the S1F
 * commit. `tests/integration/audit/post-commit-only.test.ts` proves each of the three,
 * and its vulnerable control demonstrates why the fourth — a cross-database transaction —
 * cannot be claimed at all.
 *
 * =================================================================================
 * THE BACKLOG IS `effect_journal WHERE mirrored_at IS NULL`, AND THERE IS NO SECOND QUEUE
 *
 * `30 §5.1` item 1 puts `mirrored_at` on the journal row, "null until the audit store
 * acknowledges". That column IS the durable retry source, so a restart rediscovers its
 * work from PostgreSQL and an in-memory queue is never the only record of it. `37` S4
 * schedules the ACOS-owned OUTBOX — `I36`'s exclusive claim, for EXTERNAL effects — and
 * S1G does not build one: an outbox here would be a second queue the architecture does
 * not ask for, in the slice that must not touch external dispatch.
 *
 * AND `mirrored_at` IS NOT A CORRECTNESS OPERAND. `30 §5.2`: "Set on first successful
 * acknowledgement, ADVISORY ONLY. It is a control-plane column, so a compromised control
 * plane can set it freely; nothing depends on it. `I17` and `I17e` are evaluated from the
 * audit side."
 *
 * It selects WORK. It never decides whether the audit store HOLDS a row: a stale null
 * re-pushes and the audit store answers `AUDIT_PUSH_DUPLICATE`; a stale timestamp on a
 * row the audit store never received is caught by `I17`'s gap check, which reads audit
 * holdings and attestations and never reads this column. `mirrored-at-advisory.test.ts`
 * asserts both directions.
 * =================================================================================
 */

/**
 * Kill points, named after `30 §5.1`'s ordering block and the S1G crash matrix.
 *
 * An observability seam, and the only way to assert a crash BETWEEN two durable writes
 * that belong to two different databases. Every hook is optional and the production
 * caller passes none.
 */
export interface PushKillPoints {
  readonly afterCommitBeforePush?: (seq: bigint) => Promise<void> | void;
  readonly beforeIngest?: (seq: bigint) => Promise<void> | void;
  readonly afterIngestBeforeAck?: (seq: bigint, outcome: AuditIngestOutcome) => Promise<void> | void;
  readonly afterAckBeforeMirroredAt?: (seq: bigint) => Promise<void> | void;
  readonly afterMirroredAt?: (seq: bigint) => Promise<void> | void;
}

export interface PushedRow {
  readonly journalSeq: bigint;
  readonly outcome: AuditIngestOutcome;
  readonly mirroredAtRecorded: boolean;
}

export interface ReplicationRun {
  readonly pushed: readonly PushedRow[];
}

interface BacklogRow {
  readonly company_id: string;
  readonly journal_seq: string;
  readonly journal_row_kind: JournalRowKind;
  readonly effect_id: string | null;
  readonly authorisation_id: string | null;
  readonly decision_id: string | null;
  readonly reservation_id: string | null;
  readonly approval_id: string | null;
  readonly idempotency_key: string | null;
  readonly action_class: string | null;
  readonly resource_ref: string | null;
  readonly verdict: string | null;
  readonly vendor_amount: string | null;
  readonly total_exposure: string | null;
  readonly forward_integral: string | null;
  readonly is_rate_class: boolean | null;
  readonly dispatch_payload_hash: string | null;
  readonly constructor_semantic_major: number | null;
  readonly constructor_non_semantic_minor: number | null;
  readonly policy_version: string | null;
  readonly attested_max_journal_seq: string | null;
  readonly attested_row_count: string | null;
  readonly attested_head_hash: Buffer | null;
  // S1H's three new row kinds. `SELECT j.*` already returned these columns the moment 0009
  // added them; naming them here is what puts them on the wire.
  readonly mirror_declaration_id: string | null;
  readonly mirror_declaration_event: string | null;
  readonly mirror_observed_reason: string | null;
  readonly corroboration_signal_id: string | null;
  readonly corroboration_interval_start: Date | null;
  readonly corroboration_observed_at: Date | null;
  readonly corroboration_expires_at: Date | null;
  readonly corroboration_reason: string | null;
  readonly override_id: string | null;
  readonly override_event: string | null;
  readonly override_actor: string | null;
  // S1I's `OUTBOX_CLAIMED`. `SELECT j.*` already returned these columns the moment 0010
  // added them; naming them here is what puts them on the wire.
  readonly outbox_id: string | null;
  readonly outbox_correlation_tag: string | null;
  readonly outbox_claim_id: string | null;
  readonly outbox_matched_row: number | null;
  readonly outbox_mirror_state: string | null;
  readonly outbox_requires_unmirrored_tag: boolean | null;
  readonly occurred_at: Date;
  readonly prev_hash: Buffer | null;
  readonly row_hash: Buffer;
  readonly transmitted_bytes: Buffer;
}

/**
 * The backlog query.
 *
 * `effect_journal_canonical_bytes(j.*)` is the CONTROL plane's canonicaliser, and the
 * bytes it returns are what `30 §5.3` calls "the transmitted bytes". They are read here
 * rather than reconstructed in TypeScript for the reason `§5.3` gives: a re-serialisation
 * step on the sending side would put a third canonicaliser on the wire, and the property
 * `VC-A3` proves is about the two triggers.
 *
 * ORDER BY `journal_seq` so the audit store sees the control chain in order and can check
 * each row's `prev_hash` against the predecessor it holds.
 */
const BACKLOG_SQL = `
  SELECT j.*, effect_journal_canonical_bytes(j.*) AS transmitted_bytes
    FROM effect_journal j
   WHERE j.company_id = $1
     AND j.mirrored_at IS NULL
   ORDER BY j.journal_seq
   LIMIT $2`;

function toRecord(row: BacklogRow): JournalTransportRecord {
  return {
    fields: {
      companyId: row.company_id,
      journalSeq: BigInt(row.journal_seq),
      journalRowKind: row.journal_row_kind,
      effectId: row.effect_id,
      authorisationId: row.authorisation_id,
      decisionId: row.decision_id,
      reservationId: row.reservation_id,
      approvalId: row.approval_id,
      idempotencyKey: row.idempotency_key,
      actionClass: row.action_class,
      resourceRef: row.resource_ref,
      verdict: row.verdict,
      vendorAmount: row.vendor_amount,
      totalExposure: row.total_exposure,
      forwardIntegral: row.forward_integral,
      isRateClass: row.is_rate_class,
      mirrorDeclarationId: row.mirror_declaration_id,
      mirrorDeclarationEvent: row.mirror_declaration_event,
      mirrorObservedReason: row.mirror_observed_reason,
      corroborationSignalId: row.corroboration_signal_id,
      corroborationIntervalStart: row.corroboration_interval_start,
      corroborationObservedAt: row.corroboration_observed_at,
      corroborationExpiresAt: row.corroboration_expires_at,
      corroborationReason: row.corroboration_reason,
      overrideId: row.override_id,
      overrideEvent: row.override_event,
      overrideActor: row.override_actor,
      outboxId: row.outbox_id,
      outboxCorrelationTag: row.outbox_correlation_tag,
      outboxClaimId: row.outbox_claim_id,
      outboxMatchedRow: row.outbox_matched_row,
      outboxMirrorState: row.outbox_mirror_state,
      outboxRequiresUnmirroredTag: row.outbox_requires_unmirrored_tag,
      dispatchPayloadHash: row.dispatch_payload_hash,
      constructorSemanticMajor: row.constructor_semantic_major,
      constructorNonSemanticMinor: row.constructor_non_semantic_minor,
      policyVersion: row.policy_version,
      attestedMaxJournalSeq:
        row.attested_max_journal_seq === null ? null : BigInt(row.attested_max_journal_seq),
      attestedRowCount:
        row.attested_row_count === null ? null : BigInt(row.attested_row_count),
      attestedHeadHash: row.attested_head_hash,
      occurredAt: row.occurred_at,
      prevHash: row.prev_hash,
    },
    transmittedBytes: row.transmitted_bytes,
    claimedRowHash: row.row_hash,
  };
}

/**
 * `26 §7` step X, one pass.
 *
 * Stateless with respect to progress: everything it needs to resume is in PostgreSQL, so
 * destroying and recreating this object between passes changes nothing. That is asserted
 * rather than asserted-about in `durable-backlog.test.ts`, which replicates a prefix,
 * discards the pusher entirely, builds a new one and finishes the work.
 *
 * `control` and `ingress` are separate parameters, on purpose: this function holds a
 * control pool and an audit ingress and never a single handle that could open a
 * transaction over both.
 */
export class JournalPusher {
  constructor(
    private readonly control: Pool,
    private readonly ingress: AuditIngress,
    private readonly kill: PushKillPoints = {},
  ) {}

  async pushPending(companyId: string, limit = 1000): Promise<ReplicationRun> {
    const backlog = await this.readBacklog(companyId, limit);
    const pushed: PushedRow[] = [];

    for (const row of backlog) {
      const seq = BigInt(row.journal_seq);
      await this.kill.afterCommitBeforePush?.(seq);
      await this.kill.beforeIngest?.(seq);

      // The audit store's own transaction. If it throws — unreachable store, refused
      // connection, refused row — the loop stops and the LOCAL AUTHORISATION IS UNTOUCHED.
      // There is no rollback path from here into the control database and no code that
      // could add one: this method never opened a control transaction.
      const outcome = await this.ingress.ingest(toRecord(row));
      await this.kill.afterIngestBeforeAck?.(seq, outcome);

      if (!isAcknowledgement(outcome)) {
        // `30 §5.2`: a differing `row_hash` at an existing sequence "is never benign".
        // The advisory column is NOT set, the row stays in the backlog, and the audit
        // store has already recorded its own CRITICAL finding — which the control plane
        // can neither read nor suppress.
        pushed.push({ journalSeq: seq, outcome, mirroredAtRecorded: false });
        break;
      }

      await this.kill.afterAckBeforeMirroredAt?.(seq);
      const recorded = await this.recordMirroredAt(companyId, seq);
      await this.kill.afterMirroredAt?.(seq);
      pushed.push({ journalSeq: seq, outcome, mirroredAtRecorded: recorded });
    }

    return { pushed };
  }

  private async readBacklog(companyId: string, limit: number): Promise<readonly BacklogRow[]> {
    const client: Client = await this.control.connect();
    try {
      const result = await client.query<BacklogRow>(BACKLOG_SQL, [companyId, limit]);
      return result.rows;
    } finally {
      client.release();
    }
  }

  /**
   * The one narrowly scoped mutation `30 §5.2` permits on a committed journal row.
   *
   * It is best-effort BY DESIGN. A failure here — a crash, a lost connection, a permanent
   * refusal — leaves the row looking unmirrored, the next pass re-pushes it, and the audit
   * store answers `AUDIT_PUSH_DUPLICATE`. Nothing is lost and nothing is duplicated,
   * because correctness was never in this column. Returning `false` rather than throwing
   * is what makes that visible to the caller instead of turning an advisory write into an
   * error the replication loop treats as a real failure.
   */
  private async recordMirroredAt(companyId: string, seq: bigint): Promise<boolean> {
    const client: Client = await this.control.connect();
    try {
      const result = await client.query(
        `UPDATE effect_journal SET mirrored_at = now()
          WHERE company_id = $1 AND journal_seq = $2 AND mirrored_at IS NULL`,
        [companyId, seq.toString()],
      );
      return (result.rowCount ?? 0) === 1;
    } catch {
      return false;
    } finally {
      client.release();
    }
  }
}
