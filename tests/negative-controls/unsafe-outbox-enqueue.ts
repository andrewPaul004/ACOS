import type { Client, Pool } from '../../src/db/pool.js';

/**
 * TEST-ONLY. Three defective ENQUEUE designs, each isolating one production mechanism.
 *
 * =================================================================================
 * `§37` OF THE S1I MANDATE, items 1, 5 and 9:
 *
 *   1. "application-only duplicate enqueue with no DB uniqueness"
 *   5. "caller-supplied recoverability"
 *   9. "caller changes correlation tag/payload after enqueue"
 *
 * Each function below is the same INSERT the production enqueue performs, with exactly one
 * of `0010`'s mechanisms removed, writing to an unconstrained table so the removal's
 * consequence is observable rather than refused.
 *
 * `36 §0` is why they exist at all: a control that differs from production in two ways
 * proves nothing about either. So each is described by WHAT IS MISSING, and the missing
 * thing is named in the architecture text it violates.
 * =================================================================================
 */

/**
 * The unconstrained store. Created once, in its own transaction, BEFORE any race.
 *
 * NO PRIMARY KEY. No unique index on the effect idempotency identity, none on the
 * correlation tag, no composite foreign key to `effect` or `authorisation`, no payload↔hash
 * CHECK, no state-machine trigger. It is what `dispatch_outbox` would be if `25 §7`'s
 * "unique on the effect idempotency key" were an application convention.
 *
 * `CREATE TABLE IF NOT EXISTS` takes an `ACCESS EXCLUSIVE` lock and holds it to commit, so
 * creating it inside a racing transaction would serialise the interleaving under test.
 */
export async function ensureUnsafeOutbox(control: Pool): Promise<void> {
  const client = await control.connect();
  try {
    await client.query(
      `CREATE TABLE IF NOT EXISTS unsafe_outbox (
         company_id              TEXT,
         idempotency_key         TEXT,
         outbox_id               TEXT,
         effect_id               TEXT,
         recoverability          TEXT,
         dispatch_payload_hash   TEXT,
         payload_canonical_bytes BYTEA,
         correlation_tag         TEXT,
         status                  TEXT,
         enqueued_at             TIMESTAMPTZ
       )`,
    );
    await client.query('TRUNCATE unsafe_outbox');
  } finally {
    client.release();
  }
}

export async function unsafeOutboxRowCount(
  control: Pool,
  companyId: string,
  idempotencyKey: string,
): Promise<number> {
  const client = await control.connect();
  try {
    const result = await client.query<{ n: string }>(
      `SELECT count(*)::TEXT AS n FROM unsafe_outbox
        WHERE company_id = $1 AND idempotency_key = $2`,
      [companyId, idempotencyKey],
    );
    return Number(result.rows[0]!.n);
  } finally {
    client.release();
  }
}

/**
 * `§37` ITEM 1 — duplicate prevention as an APPLICATION LOOKUP.
 *
 * WHAT IS MISSING: `dispatch_outbox_pkey`. `33 §6` states the property the primary key
 * carries, for the sibling table and in the same words S1I inherits: "`effects` primary key
 * includes the idempotency key with a unique constraint (I42), so a duplicate proposal
 * cannot create a second row **even if every layer above it fails**."
 *
 * This function keeps the layer above — the `SELECT` that looks for a prior row — and
 * removes the layer beneath. Under a targeted interleaving both callers find nothing and
 * both insert, so ONE intended external effect acquires TWO outbox rows, TWO correlation
 * tags and, downstream, two claimable identities.
 */
export async function unsafeApplicationOnlyEnqueue(
  client: Client,
  input: {
    readonly companyId: string;
    readonly effectId: string;
    readonly idempotencyKey: string;
    readonly outboxId: string;
    readonly recoverability: string;
    readonly dispatchPayloadHash: string;
    readonly payloadCanonicalBytes: Buffer;
    readonly correlationTag: string;
    readonly now: Date;
    readonly afterLookup: () => Promise<void>;
  },
): Promise<'ENQUEUED' | 'ALREADY_ENQUEUED'> {
  // The application lookup — the layer that is kept.
  const prior = await client.query(
    `SELECT 1 FROM unsafe_outbox WHERE company_id = $1 AND idempotency_key = $2`,
    [input.companyId, input.idempotencyKey],
  );
  await input.afterLookup();
  if ((prior.rowCount ?? 0) > 0) return 'ALREADY_ENQUEUED';

  await client.query(
    `INSERT INTO unsafe_outbox
       (company_id, idempotency_key, outbox_id, effect_id, recoverability,
        dispatch_payload_hash, payload_canonical_bytes, correlation_tag, status, enqueued_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ENQUEUED', $9)`,
    [
      input.companyId,
      input.idempotencyKey,
      input.outboxId,
      input.effectId,
      input.recoverability,
      input.dispatchPayloadHash,
      input.payloadCanonicalBytes,
      input.correlationTag,
      input.now,
    ],
  );
  return 'ENQUEUED';
}

/**
 * `§37` ITEM 5 / `§12` — recoverability as a CALLER PARAMETER.
 *
 * WHAT IS MISSING: the composite foreign key to `effect (... recoverability ...)`, and the
 * `INSERT ... SELECT` that derives the value from the committed row rather than accepting
 * one.
 *
 * `26 §5`: recoverability is "Assigned per action class in the catalogue, **not per
 * request, and never by a model**." `24 §3` K4's list of what AI may not do includes "a
 * recoverability class" by name.
 *
 * `§12`'s required fixture is exactly this: "real action = IRRECOVERABLE; caller claims
 * REVERSIBLE. Unsafe path accepts altered policy class. Production preserves IRRECOVERABLE.
 * Must discriminate." The consequence is not cosmetic — `30 §5.1` row 1 HALTS every
 * IRRECOVERABLE effect in every mirror state, and a relabelled one reaches row 5 and
 * dispatches.
 */
export async function unsafeCallerSuppliedRecoverabilityEnqueue(
  control: Pool,
  input: {
    readonly companyId: string;
    readonly effectId: string;
    readonly idempotencyKey: string;
    /** THE DEFECT. Production has no such parameter. */
    readonly recoverability: string;
    readonly dispatchPayloadHash: string;
    readonly payloadCanonicalBytes: Buffer;
    readonly now: Date;
  },
): Promise<string> {
  const client = await control.connect();
  try {
    await client.query(
      `INSERT INTO unsafe_outbox
         (company_id, idempotency_key, outbox_id, effect_id, recoverability,
          dispatch_payload_hash, payload_canonical_bytes, correlation_tag, status,
          enqueued_at)
       VALUES ($1, $2, 'unsafe:outbox', $3, $4, $5, $6, 'acos-corr-unsafe', 'ENQUEUED', $7)`,
      [
        input.companyId,
        input.idempotencyKey,
        input.effectId,
        input.recoverability,
        input.dispatchPayloadHash,
        input.payloadCanonicalBytes,
        input.now,
      ],
    );
    const stored = await client.query<{ recoverability: string }>(
      `SELECT recoverability FROM unsafe_outbox
        WHERE company_id = $1 AND idempotency_key = $2`,
      [input.companyId, input.idempotencyKey],
    );
    return stored.rows[0]!.recoverability;
  } finally {
    client.release();
  }
}

/**
 * `§37` ITEM 9 — a MUTABLE outbox row.
 *
 * WHAT IS MISSING: `dispatch_outbox_state_machine`'s identity guard, and
 * `dispatch_outbox_payload_binds_hash`.
 *
 * `§25`: "A claimed outbox identity cannot be rebound to a different payload, different
 * correlation tag, different effect, different recoverability, different company, different
 * unmirrored-tag requirement." `§9`: "payload bytes/structure immutable after enqueue [...]
 * no mutation after CLAIMED."
 *
 * Returns what the row holds AFTER the mutation, so a test can compare it to what
 * production still holds.
 */
export async function unsafeMutateEnqueuedRow(
  control: Pool,
  input: {
    readonly companyId: string;
    readonly idempotencyKey: string;
    readonly newPayload: Buffer;
    readonly newCorrelationTag: string;
  },
): Promise<{ readonly payload: Buffer; readonly correlationTag: string }> {
  const client = await control.connect();
  try {
    await client.query(
      `UPDATE unsafe_outbox
          SET payload_canonical_bytes = $3, correlation_tag = $4
        WHERE company_id = $1 AND idempotency_key = $2`,
      [input.companyId, input.idempotencyKey, input.newPayload, input.newCorrelationTag],
    );
    const after = await client.query<{
      payload_canonical_bytes: Buffer;
      correlation_tag: string;
    }>(
      `SELECT payload_canonical_bytes, correlation_tag FROM unsafe_outbox
        WHERE company_id = $1 AND idempotency_key = $2`,
      [input.companyId, input.idempotencyKey],
    );
    return {
      payload: after.rows[0]!.payload_canonical_bytes,
      correlationTag: after.rows[0]!.correlation_tag,
    };
  } finally {
    client.release();
  }
}
