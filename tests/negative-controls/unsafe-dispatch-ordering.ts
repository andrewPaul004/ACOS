import { inTransaction, type Pool } from '../../src/db/pool.js';
import type {
  AdapterOutcome,
  DispatchEnvelope,
  ExternalEffectAdapter,
} from '../../src/kernel/gateway/adapterPort.js';
import { claimForExternalDispatchOn } from '../../src/kernel/outbox/claim.js';

/**
 * TEST-ONLY. THE ADAPTER INVOKED INSIDE THE CLAIM TRANSACTION — `§40` ITEM 2.
 *
 * =================================================================================
 * WHAT `§6` FORBIDS, AND WHAT THIS DOES
 *
 * `§6` of the S1J mandate lists four forbidden orderings:
 *
 *     "Never: adapter before claim commit; adapter inside the claim transaction;
 *      distributed transaction across DB + adapter; adapter invocation followed by claim."
 *
 * This function does the second, which implies the first. It opens ONE transaction, takes
 * the claim inside it, invokes the adapter WITHOUT committing, and only then commits.
 *
 * =================================================================================
 * WHY IT IS TEMPTING, AND WHAT IT COSTS
 *
 * It looks stronger than production: if the adapter fails, the claim rolls back, so the
 * effect stays `ENQUEUED` and can be claimed again. No stranded claims. No ambiguous
 * `CLAIMED` rows. It reads like the atomicity everyone wants.
 *
 * AND IT IS EXACTLY THE DOUBLE-SEND. `25 §7` is explicit about the direction: the row
 * transitions to `CLAIMED` "in a committed transaction **before** the HTTP call", and
 * v1.3.4's OBX-03 adds the sentence that names this control's defect: "**This does not
 * place the HTTP request inside the database transaction.** The transaction commits and
 * *then* transport runs."
 *
 * The reason is `23 §6` B8's opening line: "A perfect two-phase commit between a Postgres
 * transaction and a third-party HTTP API does not exist." An adapter call that succeeded
 * inside a transaction that then rolls back has sent a request the database has no record
 * of, and the row it rolled back is `ENQUEUED` — CLAIMABLE AGAIN. So the "safety" of the
 * rollback is precisely what produces the second send, and the effect key being
 * deterministic does not help: the second attempt is a NEW claim of a row that never
 * recorded the first.
 *
 * `35 §4` names the same trap from the other side: "an *incomplete* step is not a
 * checkpointed step, so a crash after the request leaves and before the outcome commits is
 * exactly the case the guarantee is silent about."
 *
 * THE DISCRIMINATOR IS AN EVENT ORDER, NOT AN OUTCOME. Both this control and production can
 * end with one claim and one invocation on the happy path. What differs is that here
 * `MOCK_ADAPTER_INVOKED` precedes `CLAIM_COMMITTED`, and in production it cannot, because
 * `claimForExternalDispatch` resolves only after `COMMIT`.
 * =================================================================================
 */

export interface UnsafeOrderedDispatch {
  readonly claimed: boolean;
  readonly outcome: AdapterOutcome | null;
  /** The events, in the order they happened. The whole point of the control. */
  readonly events: readonly string[];
}

export async function unsafeDispatchInsideClaimTransaction(
  control: Pool,
  input: {
    readonly companyId: string;
    readonly idempotencyKey: string;
    readonly claimedBy: string;
    readonly now: Date;
  },
  adapter: ExternalEffectAdapter,
  events: string[],
): Promise<UnsafeOrderedDispatch> {
  const client = await control.connect();
  try {
    return await inTransaction(client, 'READ COMMITTED', async (tx) => {
      const claim = await claimForExternalDispatchOn(tx, input);
      if (claim.kind === 'REFUSED') {
        return { claimed: false, outcome: null, events };
      }
      // NOT COMMITTED YET. The row is `CLAIMED` only inside this transaction.
      const row = claim.claim.row;
      const envelope = {
        companyId: row.companyId,
        outboxId: row.outboxId,
        claimId: row.claimId,
        effectId: row.effectId,
        authorisationId: row.authorisationId,
        idempotencyKey: row.idempotencyKey,
        actionClass: row.actionClass,
        resourceRef: row.resourceRef,
        recoverability: row.recoverability,
        adapter: row.adapter,
        method: 'unsafeInTransactionMethod',
        dispatchPayloadHash: row.dispatchPayloadHash,
        payloadCanonicalBytes: row.payloadCanonicalBytes,
        correlationTag: row.correlationTag,
        requiresUnmirroredTag: row.claimRequiresUnmirroredTag ?? false,
        overrideId: row.claimOverrideId,
      } as unknown as DispatchEnvelope;

      const outcome = await adapter.dispatch(envelope);
      // `inTransaction` issues COMMIT after this returns, so the claim becomes durable
      // AFTER the adapter has already been invoked.
      events.push('CLAIM_COMMITTED');
      return { claimed: true, outcome, events };
    });
  } finally {
    client.release();
  }
}
