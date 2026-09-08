import { inTransaction, type Client, type Pool } from '../../db/pool.js';
import { enqueueDispatchOn, type EnqueueOutcome } from './enqueue.js';

/**
 * RECOVERY — the obligation that comes with the architecture choosing a post-commit outbox.
 *
 * =================================================================================
 * WHY THIS MODULE EXISTS AT ALL.
 *
 * `30 §5.1` item 3 and `23 §6` B8 put the outbox row AFTER the authorising commit
 * ("dispatch follows the commit"), and `24 §4`'s `EFFECT ||--o| OUTBOX_ROW` makes an
 * effect with no outbox row a legal state. `enqueue.ts` records the full argument.
 *
 * `§26` of the S1I mandate states the cost of that choice plainly: "If architecture permits
 * B: implement durable idempotent derivation/recovery so `authorisation committed, process
 * dies before enqueue` cannot permanently lose the effect. [...] Do not silently leave an
 * authorised effect with no recoverable route to its outbox."
 *
 * `§27` is the test: "local S1F authorisation exists; process crashes before S1I enqueue;
 * restart. Expected: the system can deterministically discover/reconstruct the missing
 * outbox work from durable authoritative state without making a second economic
 * authorisation. No model re-proposal required merely because internal enqueue crashed."
 * =================================================================================
 *
 * =================================================================================
 * THE DISCOVERY HALF IS STATELESS, WHICH IS WHY A CRASH CANNOT LOSE IT.
 *
 * `dispatch_outbox_missing` is a VIEW — a LEFT JOIN over `effect`, `authorisation` and
 * `dispatch_outbox`. It holds no cursor, no watermark, no queue and no progress marker, so
 * there is nothing for a crash to drop and nothing for a restart to have to rebuild. An
 * authorised effect with no outbox row appears here on EVERY restart until one exists,
 * which is the same reasoning `journalPusher.ts` records for its own backlog: "everything
 * it needs to resume is in PostgreSQL, so destroying and recreating this object between
 * passes changes nothing."
 *
 * AND NO SECOND ECONOMIC AUTHORISATION IS MADE. Nothing in this module writes to
 * `authorisation`, `effect`, `exposure_reservation`, `window_balance`,
 * `standing_window_exposure` or `authorisation_decision`; it reads the first two and calls
 * `enqueueDispatchOn`, which writes exactly one `dispatch_outbox` row. `§28`'s SQL
 * assertions are in `outbox-enqueue.test.ts`.
 * =================================================================================
 *
 * =================================================================================
 * THE PAYLOAD HALF IS RECONSTRUCTION UNDER A COMMITTED HASH, AND THAT IS THE WHOLE
 * SAFETY ARGUMENT.
 *
 * S1F persists `dispatch_payload_hash` and not the payload's bytes — `26 §2.1` declares
 * the hash on the `AuthorizationRequest` and declares no payload column, and S1F built
 * exactly what is declared. So after a crash the bytes must be RE-DERIVED, and `§27`
 * anticipates that: it says "discover/**reconstruct**".
 *
 * `§9` and `§10` forbid something adjacent and very specific, and the distinction is the
 * point:
 *
 *   FORBIDDEN — a DISPATCHER that rebuilds the vendor request from current mutable state
 *   at claim time. That is `§10`'s attack, and production is immune to it because the
 *   claim reads `payload_canonical_bytes` off the row and there is no other
 *   representation to rebuild from. `payload-mutation-attack.test.ts` proves the
 *   discrimination against `tests/negative-controls/unsafe-reconstructing-claim.ts`.
 *
 *   PERMITTED, AND CHECKED — a RECOVERY that re-derives the bytes and offers them to the
 *   enqueue, WHICH ACCEPTS THEM ONLY IF THEY HASH TO THE COMMITTED AUTHORISED HASH. If
 *   the world moved between the authorisation and the recovery, the reconstruction
 *   produces different bytes, `enqueueDispatchOn` returns `PAYLOAD_HASH_DIVERGED`, and no
 *   row is created. A drifted effect therefore needs a FRESH AUTHORISATION — it does not
 *   get quietly enqueued under the old one, which is exactly the outcome ADR-026 item 4
 *   requires of a `NEVER_SENT` row: "a new proposal requiring fresh authorisation, never a
 *   retry."
 *
 * So this module never decides what the payload IS. It offers a candidate and the
 * committed hash decides.
 * =================================================================================
 *
 * =================================================================================
 * NO SCHEDULER — `§6`.
 *
 * `recoverMissingOutboxRows` runs when it is called and returns. There is no timer, no
 * loop, no daemon and no background worker in this file, and it does not claim anything:
 * it creates `ENQUEUED` rows and stops. `§6` of the mandate forbids an always-running
 * dispatcher precisely because S1I has no next mechanism to hand a claim to.
 * =================================================================================
 */

/** One authorised effect with no outbox row. */
export interface MissingOutboxWork {
  readonly companyId: string;
  readonly effectId: string;
  readonly idempotencyKey: string;
  readonly authorisationId: string;
  readonly actionClass: string;
  readonly recoverability: string;
  readonly adapter: string;
  readonly resourceRef: string;
  /** The committed authorised hash. THE ONLY BYTES THE ENQUEUE WILL ACCEPT. */
  readonly dispatchPayloadHash: string;
  readonly authorisedAt: Date;
}

interface MissingDbRow {
  readonly company_id: string;
  readonly effect_id: string;
  readonly idempotency_key: string;
  readonly authorisation_id: string;
  readonly action_class: string;
  readonly recoverability: string;
  readonly adapter: string;
  readonly resource_ref: string;
  readonly dispatch_payload_hash: string;
  readonly created_at: Date;
}

export async function missingOutboxWorkOn(
  client: Client,
  companyId: string,
): Promise<readonly MissingOutboxWork[]> {
  const result = await client.query<MissingDbRow>(
    `SELECT company_id, effect_id, idempotency_key, authorisation_id, action_class,
            recoverability, adapter, resource_ref, dispatch_payload_hash, created_at
       FROM dispatch_outbox_missing
      WHERE company_id = $1
      ORDER BY created_at, effect_id`,
    [companyId],
  );
  return result.rows.map((r) => ({
    companyId: r.company_id,
    effectId: r.effect_id,
    idempotencyKey: r.idempotency_key,
    authorisationId: r.authorisation_id,
    actionClass: r.action_class,
    recoverability: r.recoverability,
    adapter: r.adapter,
    resourceRef: r.resource_ref,
    dispatchPayloadHash: r.dispatch_payload_hash,
    authorisedAt: r.created_at,
  }));
}

export async function missingOutboxWork(
  control: Pool,
  companyId: string,
): Promise<readonly MissingOutboxWork[]> {
  const client = await control.connect();
  try {
    return await inTransaction(client, 'READ COMMITTED', (tx) =>
      missingOutboxWorkOn(tx, companyId),
    );
  } finally {
    client.release();
  }
}

/**
 * Reconstructs the payload for one missing item.
 *
 * A PORT, not an implementation. The reconstruction is the canonicaliser's work — `24 §3`
 * K4's versioned constructor per action class — and putting it behind an interface keeps
 * this module from acquiring a second construction path. The RETURN VALUE IS NOT TRUSTED:
 * `enqueueDispatchOn` compares its hash against `item.dispatchPayloadHash` and refuses a
 * mismatch, so a wrong or drifted reconstruction cannot create a row.
 *
 * Returning `null` means "cannot reconstruct", which the recovery reports rather than
 * papering over.
 */
export type PayloadReconstructor = (
  item: MissingOutboxWork,
) => Promise<Buffer | null> | Buffer | null;

export interface RecoveryReport {
  readonly item: MissingOutboxWork;
  readonly outcome:
    | EnqueueOutcome
    | { readonly kind: 'REFUSED'; readonly reason: 'PAYLOAD_UNRECONSTRUCTABLE'; readonly detail: string };
}

/**
 * Enqueue every discoverable missing row whose payload reconstructs to the committed hash.
 *
 * IDEMPOTENT. Running it twice enqueues nothing the second time: the items are gone from
 * the view, and even a stale item list resolves to `ALREADY_ENQUEUED` rather than to a
 * second row, because `(company_id, idempotency_key)` is the primary key.
 *
 * ONE TRANSACTION PER ITEM, deliberately. A single transaction across N items would make
 * one unreconstructable payload roll back the N−1 rows that were fine, and `§27`'s property
 * is about not losing work.
 */
export async function recoverMissingOutboxRows(
  control: Pool,
  companyId: string,
  reconstruct: PayloadReconstructor,
  outboxIdFor: (item: MissingOutboxWork) => string,
  now: Date,
): Promise<readonly RecoveryReport[]> {
  const items = await missingOutboxWork(control, companyId);
  const reports: RecoveryReport[] = [];

  for (const item of items) {
    const bytes = await reconstruct(item);
    if (bytes === null) {
      reports.push({
        item,
        outcome: {
          kind: 'REFUSED',
          reason: 'PAYLOAD_UNRECONSTRUCTABLE',
          detail:
            `no payload could be reconstructed for effect ${item.effectId}; the effect ` +
            'remains authorised with no outbox row and is rediscoverable on every pass',
        },
      });
      continue;
    }

    const client = await control.connect();
    try {
      const outcome = await inTransaction(client, 'READ COMMITTED', (tx) =>
        enqueueDispatchOn(tx, {
          companyId: item.companyId,
          effectId: item.effectId,
          outboxId: outboxIdFor(item),
          payloadCanonicalBytes: bytes,
          now,
        }),
      );
      reports.push({ item, outcome });
    } finally {
      client.release();
    }
  }

  return reports;
}
