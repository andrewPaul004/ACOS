import { inTransaction, type Client, type Pool } from '../../db/pool.js';

import type { IncompleteReason, NormalisedAcceptedEvent, NormalisedBatch } from './eventPayload.js';

/**
 * DURABLE, DATA-MINIMISED PERSISTENCE OF AUTHENTICATED PROVIDER EVIDENCE. `A0009`.
 *
 * =================================================================================
 * THE ORDER THIS MODULE EXISTS TO MAKE TRUE
 *
 * ADR-027 decision 4, steps 9 and 10: "durably persist the authenticated evidence; **only after
 * durable commit, acknowledge.**" `persistAuthenticatedBatch` RESOLVES ONLY AFTER `COMMIT`
 * RETURNED, and it THROWS on any failure before that — so the receiver's 2xx is reachable only
 * through a resolved promise, and an infrastructure failure becomes a non-2xx the provider's own
 * retry can redeliver.
 *
 * =================================================================================
 * `sg_event_id` DEDUPLICATION IS THE DATABASE'S, NOT THIS MODULE'S
 *
 * `provider_evidence_event`'s primary key is `(provider, sg_event_id)`. An event is written with
 * `ON CONFLICT DO NOTHING`; a conflicting identity is then READ BACK and compared on its
 * normalised semantic fields:
 *
 *   identical      a redelivery. No new row, no count change, and the batch is still COMPLETE —
 *                  acknowledged only because the ORIGINAL durable row was confirmed present.
 *   different      a provider inconsistency. The whole transaction is ROLLED BACK — no sibling
 *                  of the conflicting event survives — and a SECOND transaction records an
 *                  INCOMPLETE observation and the inconsistency itself. Nothing is overwritten
 *                  and nothing is ignored.
 *
 * Under READ COMMITTED a second concurrent delivery of the same identity blocks on the first's
 * uncommitted row, then sees it committed and confirms it — or, if the first rolled back,
 * inserts it. Exactly one semantic row survives either way.
 *
 * =================================================================================
 * NO RAW BODY, NO ADDRESS, NO SUBJECT, NO PROVIDER JSON
 *
 * The parameters below are identities, codes, counts, hashes and timestamps. There is no
 * parameter a body, an email address or an arbitrary provider field could travel in.
 * =================================================================================
 */

/** The evidence channel a batch arrived on, as the VERIFIED class-28 record defines it. */
export interface EvidenceChannelContext {
  readonly provider: string;
  /** The class-28 content hash the audit plane computed. */
  readonly trustArtifactDigest: string;
  readonly trustArtifactVersion: string;
  /** Derived from the signed key, never typed. */
  readonly keyIdentity: string;
  readonly verificationProfile: string;
}

/** What the signature verification established about the request. */
export interface AuthenticatedReceipt {
  readonly timestampText: string;
  readonly rawBodySha256: string;
  readonly receivedAt: Date;
}

export type PersistOutcome =
  | {
      readonly kind: 'COMPLETE_RECORDED';
      readonly observationId: string;
      /** New semantic event rows this batch created. */
      readonly inserted: number;
      /** Redelivered identities whose ORIGINAL durable row was confirmed identical. */
      readonly confirmedExisting: number;
    }
  | {
      readonly kind: 'INCOMPLETE_RECORDED';
      readonly observationId: string;
      readonly reason: IncompleteReason;
      /** Inconsistent identities recorded, when the reason is EVENT_IDENTITY_INCONSISTENT. */
      readonly inconsistencies: number;
    };

/** A store-layer port, so the receiver can be driven with a failing store in a test. */
export type BatchPersister = (
  channel: EvidenceChannelContext,
  receipt: AuthenticatedReceipt,
  batch: NormalisedBatch,
) => Promise<PersistOutcome>;

interface StoredEventRow {
  readonly sg_message_id: string;
  readonly event_class: string;
  readonly acos_correlation_tag: string;
  readonly provider_event_timestamp: string;
}

interface Inconsistency {
  readonly sgEventId: string;
  readonly recordedCorrelationTag: string;
  readonly presentedCorrelationTag: string;
}

class InconsistentRedelivery extends Error {
  constructor(readonly inconsistencies: readonly Inconsistency[]) {
    super('a redelivered provider event identity carries different semantic fields');
  }
}

async function insertObservation(
  client: Client,
  channel: EvidenceChannelContext,
  receipt: AuthenticatedReceipt,
  status: 'COMPLETE' | 'INCOMPLETE',
  reason: IncompleteReason | null,
  elementCount: number,
  acceptedClassEventCount: number,
): Promise<string> {
  const result = await client.query<{ observation_id: string }>(
    `INSERT INTO provider_evidence_observation
       (provider, trust_artifact_digest, trust_artifact_version, key_identity,
        verification_profile, provider_signature_timestamp, received_at, raw_body_sha256,
        status, incomplete_reason, element_count, accepted_class_event_count)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING observation_id::TEXT AS observation_id`,
    [
      channel.provider,
      channel.trustArtifactDigest,
      channel.trustArtifactVersion,
      channel.keyIdentity,
      channel.verificationProfile,
      receipt.timestampText,
      receipt.receivedAt,
      receipt.rawBodySha256,
      status,
      reason,
      elementCount,
      acceptedClassEventCount,
    ],
  );
  return result.rows[0]!.observation_id;
}

function matches(row: StoredEventRow, event: NormalisedAcceptedEvent): boolean {
  return (
    row.sg_message_id === event.sgMessageId &&
    row.event_class === event.eventClass &&
    row.acos_correlation_tag === event.correlationTag &&
    row.provider_event_timestamp === String(event.providerEventTimestamp)
  );
}

/**
 * Persist one authenticated, normalised batch. Resolves only after COMMIT; throws otherwise.
 */
export async function persistAuthenticatedBatch(
  pool: Pool,
  channel: EvidenceChannelContext,
  receipt: AuthenticatedReceipt,
  batch: NormalisedBatch,
): Promise<PersistOutcome> {
  const client = await pool.connect();
  try {
    if (batch.status === 'INCOMPLETE') {
      // AN AUTHENTICATED INCOMPLETE OBSERVATION. Recorded — so the period cannot read clean —
      // and acknowledged after commit, so permanently malformed signed JSON is not retried
      // forever. No event row: no readable sibling becomes a count.
      const observationId = await inTransaction(client, 'READ COMMITTED', (tx) =>
        insertObservation(
          tx,
          channel,
          receipt,
          'INCOMPLETE',
          batch.reason,
          batch.elementCount,
          batch.acceptedClassEventCount,
        ),
      );
      return Object.freeze({
        kind: 'INCOMPLETE_RECORDED' as const,
        observationId,
        reason: batch.reason,
        inconsistencies: 0,
      });
    }

    try {
      return await inTransaction(client, 'READ COMMITTED', async (tx) => {
        const observationId = await insertObservation(
          tx,
          channel,
          receipt,
          'COMPLETE',
          null,
          batch.elementCount,
          batch.acceptedEvents.length,
        );
        let inserted = 0;
        let confirmedExisting = 0;
        const inconsistencies: Inconsistency[] = [];
        for (const event of batch.acceptedEvents) {
          const insert = await tx.query(
            `INSERT INTO provider_evidence_event
               (provider, sg_event_id, sg_message_id, event_class, acos_correlation_tag,
                provider_event_timestamp, received_at, key_identity, trust_artifact_digest,
                observation_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             ON CONFLICT (provider, sg_event_id) DO NOTHING`,
            [
              channel.provider,
              event.sgEventId,
              event.sgMessageId,
              event.eventClass,
              event.correlationTag,
              event.providerEventTimestamp,
              receipt.receivedAt,
              channel.keyIdentity,
              channel.trustArtifactDigest,
              observationId,
            ],
          );
          if (insert.rowCount === 1) {
            inserted += 1;
            continue;
          }
          // THE IDENTITY EXISTS. CONFIRM THE ORIGINAL DURABLE ROW, OR REFUSE TO TREAT THIS AS A
          // RETRY.
          const existing = await tx.query<StoredEventRow>(
            `SELECT sg_message_id, event_class, acos_correlation_tag,
                    provider_event_timestamp::TEXT AS provider_event_timestamp
               FROM provider_evidence_event
              WHERE provider = $1 AND sg_event_id = $2`,
            [channel.provider, event.sgEventId],
          );
          const row = existing.rows[0];
          if (row === undefined) {
            // A conflict with no row to read is not a state READ COMMITTED can produce. It is
            // an infrastructure failure, not an acknowledgement.
            throw new Error('provider evidence conflict could not be confirmed against a row');
          }
          if (matches(row, event)) {
            confirmedExisting += 1;
          } else {
            inconsistencies.push({
              sgEventId: event.sgEventId,
              recordedCorrelationTag: row.acos_correlation_tag,
              presentedCorrelationTag: event.correlationTag,
            });
          }
        }
        if (inconsistencies.length > 0) {
          // ROLL BACK EVERYTHING THIS BATCH WROTE. No sibling may escape.
          throw new InconsistentRedelivery(inconsistencies);
        }
        return Object.freeze({
          kind: 'COMPLETE_RECORDED' as const,
          observationId,
          inserted,
          confirmedExisting,
        });
      });
    } catch (error) {
      if (!(error instanceof InconsistentRedelivery)) throw error;
      const recorded = error.inconsistencies;
      const observationId = await inTransaction(client, 'READ COMMITTED', async (tx) => {
        const id = await insertObservation(
          tx,
          channel,
          receipt,
          'INCOMPLETE',
          'EVENT_IDENTITY_INCONSISTENT',
          batch.elementCount,
          batch.acceptedEvents.length,
        );
        for (const inconsistency of recorded) {
          await tx.query(
            `INSERT INTO provider_evidence_inconsistency
               (provider, sg_event_id, recorded_correlation_tag, presented_correlation_tag,
                observation_id, detected_at)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              channel.provider,
              inconsistency.sgEventId,
              inconsistency.recordedCorrelationTag,
              inconsistency.presentedCorrelationTag,
              id,
              receipt.receivedAt,
            ],
          );
        }
        return id;
      });
      return Object.freeze({
        kind: 'INCOMPLETE_RECORDED' as const,
        observationId,
        reason: 'EVENT_IDENTITY_INCONSISTENT' as const,
        inconsistencies: recorded.length,
      });
    }
  } finally {
    client.release();
  }
}

/** Bind a pool into the persister port. */
export function poolPersister(pool: Pool): BatchPersister {
  return (channel, receipt, batch) => persistAuthenticatedBatch(pool, channel, receipt, batch);
}
