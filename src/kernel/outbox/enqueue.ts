import { createHash } from 'node:crypto';

import { inTransaction, type Client, type Pool } from '../../db/pool.js';
import { hasSqlstate } from '../exposure/errors.js';
import { mintCorrelationTag } from './correlationTag.js';
import {
  OUTBOX_COLUMNS,
  toOutboxRow,
  type EnqueueRefusal,
  type OutboxDbRow,
  type OutboxRow,
} from './outboxState.js';

/**
 * ENQUEUE — creating the one outbox row for one intended external effect.
 *
 * =================================================================================
 * WHERE THIS SITS, AND WHY IT IS NOT INSIDE THE S1F TRANSACTION — `§26`.
 *
 * `§26` of the S1I mandate asks whether v1.3.3 requires the outbox row to be part of the
 * atomic local-authorisation transaction (A) or permits a durable post-commit derivative
 * (B), and forbids deciding on convenience. v1.3.3 answers it in three places and they
 * agree.
 *
 * `30 §5.1` item 3 prints the authorising transaction's write list EXHAUSTIVELY:
 *
 *   BEGIN
 *     SELECT ... FOR UPDATE on window_balance rows, ascending window_id
 *     SELECT ... FOR UPDATE on journal_counter(company_id)
 *     authorisation row
 *     effect row (status = AUTHORISED)
 *     reservation row
 *     state transition
 *     journal row (journal_seq, local prev_hash/row_hash over ACOS-JCS-1 bytes)
 *   COMMIT                                  -- durable, locally chained, gap-free
 *     ↓
 *   push to audit store (async, retried, quota-bounded, idempotent per §5.2)
 *     ↓
 *   dispatch, per (4)
 *
 * NO OUTBOX ROW APPEARS IN IT, and the block is a complete enumeration rather than an
 * illustration — S1F implements it statement for statement.
 *
 * `23 §6` B8 says the same in prose: "One transaction commits the authorisation, the
 * effect row, the reservation, the state transition and a gap-free locally chained journal
 * row; **dispatch follows the commit**, by recoverability class (`30 §5`)."
 *
 * `24 §4`'s ERD gives the cardinality: `EFFECT ||--o| OUTBOX_ROW` — ZERO OR ONE. An effect
 * with no outbox row is a legal state of the model. Under reading (A) it would not be.
 *
 * SO THE ARCHITECTURE CHOOSES (B), AND THE ACCEPTED S1F TRANSACTION IS NOT TOUCHED. What
 * (B) obliges S1I to provide is the recoverable derivation — `§27`: "authorisation
 * committed, process dies before enqueue" must not permanently lose the effect — and
 * `recovery.ts` plus the `dispatch_outbox_missing` view are it.
 * =================================================================================
 *
 * =================================================================================
 * WHAT THE CALLER SUPPLIES, AND WHY IT IS NOT AUTHORITY.
 *
 * TWO THINGS: an `effectId`, and the canonical bytes of the dispatch payload.
 *
 * EVERYTHING ELSE IS DERIVED IN SQL FROM COMMITTED ROWS. `company_id`,
 * `idempotency_key`, `authorisation_id`, `action_class`, `recoverability`, `adapter`,
 * `resource_ref` and `dispatch_payload_hash` come from `INSERT ... SELECT` over `effect`
 * and `authorisation`; there is no parameter for any of them, so `§12`'s attack — a caller
 * declaring an IRRECOVERABLE action REVERSIBLE — has no field to use. The composite
 * foreign keys in `0010` are the second refusal: a tuple that does not match the committed
 * rows has no INSERT at all.
 *
 * AND THE BYTES ARE NOT TRUSTED EITHER. They are checked against the committed authorised
 * `dispatch_payload_hash` — in this function for a legible refusal, and in the database by
 * `dispatch_outbox_payload_binds_hash` as the enforcement. A caller offering
 * payload-for-Y with effect X gets `PAYLOAD_HASH_DIVERGED`, not a row.
 *
 * WHY THE BYTES MUST BE OFFERED AT ALL. S1F persists the payload's HASH and not its bytes
 * (`26 §2.1` declares `dispatch_payload_hash` on the request and declares no payload
 * column), so the bytes have to arrive from somewhere at enqueue time. The safe property
 * is not "the bytes are trusted" — it is that ONLY the already-authorised bytes are
 * ACCEPTABLE. Any other byte string, reconstructed or invented, is refused.
 * =================================================================================
 *
 * =================================================================================
 * NO SCHEDULER. NO POLLER. NO WORKER. — `§6`.
 *
 * This module exports two functions and neither starts anything. There is no `setInterval`,
 * no timer, no queue consumer and no background loop anywhere under
 * `src/kernel/outbox/`, and `no-transport-boundary.test.ts` asserts that as an absence over
 * the source tree. `§6` of the mandate: an always-running dispatcher would strand real rows
 * in `CLAIMED` while the next mechanism does not exist.
 * =================================================================================
 */

export type EnqueueOutcome =
  | { readonly kind: 'ENQUEUED'; readonly row: OutboxRow }
  /**
   * `25 §7`'s uniqueness, observed rather than violated.
   *
   * THE PRIOR ROW IS RETURNED. `I42`'s registry text sets the pattern for the effect
   * table — "Insert fails; the duplicate proposal returns the prior result" — and the same
   * reading applies here: a second enqueue of one intended effect is not an error, it is
   * the same answer. Returning the prior row is also what makes `§11`'s "duplicate enqueue
   * returns/reuses the same canonical outbox identity/tag" true by construction, since no
   * second tag is minted.
   */
  | { readonly kind: 'ALREADY_ENQUEUED'; readonly row: OutboxRow }
  | { readonly kind: 'REFUSED'; readonly reason: EnqueueRefusal; readonly detail: string };

/** The `0010` CHECK's SQLSTATE for a violated constraint, and the outbox trigger's. */
const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';

/**
 * `hex(sha256(bytes))` — the same representation the accepted
 * `dispatchPayloadHash` produces in `src/kernel/canonicalisation/canonicaliser.ts`, and the
 * same one `encode(sha256(...), 'hex')` produces in `0010`.
 *
 * THREE IMPLEMENTATIONS OF ONE RULE, DELIBERATELY. The canonicaliser's is what the
 * authorisation committed; the database's is the enforcement; this one exists only to turn
 * a would-be CHECK violation into a named refusal. `outbox-enqueue.test.ts` asserts all
 * three agree on the same bytes.
 */
function payloadHashOf(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

interface EnqueueSourceRow {
  readonly company_id: string;
  readonly status: string;
  readonly dispatch_payload_hash: string;
}

/**
 * How many correlation-tag collisions to absorb before giving up.
 *
 * `§11` of the mandate requires collision HANDLING. A v4 UUID collision is not a real
 * operational risk; a colliding value INSERTED BY A TEST is, and that is what this bound
 * exists for. Three attempts, because the property under test is "the second attempt mints
 * a different tag and succeeds" and a larger bound would prove nothing further.
 */
const TAG_ATTEMPTS = 3;

/**
 * Enqueue on an existing connection, inside the caller's transaction.
 *
 * `On`-suffixed, following the accepted convention in `mirrorStateMachine.ts` and
 * `degradedModeOverride.ts`: the caller owns the transaction so a test can hold it at a
 * barrier and so the recovery path can enqueue several rows under one boundary.
 */
export async function enqueueDispatchOn(
  client: Client,
  input: {
    readonly companyId: string;
    readonly effectId: string;
    readonly outboxId: string;
    readonly payloadCanonicalBytes: Buffer;
    readonly now: Date;
  },
): Promise<EnqueueOutcome> {
  // The prior-row read comes first, so a duplicate enqueue never mints a tag it then
  // discards and never depends on catching a constraint violation to notice.
  const existing = await readByEffect(client, input.companyId, input.effectId);
  if (existing !== null) {
    return { kind: 'ALREADY_ENQUEUED', row: existing };
  }

  const source = await client.query<EnqueueSourceRow>(
    `SELECT e.company_id, e.status, a.dispatch_payload_hash
       FROM effect e
       JOIN authorisation a ON a.authorisation_id = e.authorisation_id
      WHERE e.effect_id = $1 AND e.company_id = $2`,
    [input.effectId, input.companyId],
  );
  const found = source.rows[0];
  if (found === undefined) {
    return {
      kind: 'REFUSED',
      reason: 'EFFECT_NOT_FOUND',
      detail: `no committed effect ${input.effectId} for company ${input.companyId}`,
    };
  }
  if (found.status !== 'AUTHORISED') {
    return {
      kind: 'REFUSED',
      reason: 'EFFECT_NOT_AUTHORISED',
      detail:
        `effect ${input.effectId} is ${found.status}; only an AUTHORISED effect may be ` +
        'enqueued, because 26 §12 approval resume and verify mode are unbuilt',
    };
  }

  const offered = payloadHashOf(input.payloadCanonicalBytes);
  if (offered !== found.dispatch_payload_hash) {
    // `§10`/`§27`: a reconstruction that drifted is REFUSED, never silently enqueued. The
    // effect needs a fresh authorisation, not a different payload under the old one.
    return {
      kind: 'REFUSED',
      reason: 'PAYLOAD_HASH_DIVERGED',
      detail:
        `the offered payload hashes to ${offered}; the committed authorisation bound ` +
        `${found.dispatch_payload_hash} (26 §2.1)`,
    };
  }

  for (let attempt = 1; attempt <= TAG_ATTEMPTS; attempt += 1) {
    try {
      const inserted = await client.query<OutboxDbRow>(
        `INSERT INTO dispatch_outbox (
           company_id, idempotency_key, outbox_id, effect_id, authorisation_id,
           action_class, recoverability, adapter, resource_ref, effect_status,
           dispatch_payload_hash, payload_canonical_bytes, correlation_tag,
           status, enqueued_at
         )
         SELECT e.company_id, e.idempotency_key, $2, e.effect_id, e.authorisation_id,
                e.action_class, e.recoverability, e.adapter, e.resource_ref, e.status,
                a.dispatch_payload_hash, $3, $4,
                'ENQUEUED', $5
           FROM effect e
           JOIN authorisation a ON a.authorisation_id = e.authorisation_id
          WHERE e.effect_id = $1 AND e.company_id = $6 AND e.status = 'AUTHORISED'
         RETURNING ${OUTBOX_COLUMNS}`,
        [
          input.effectId,
          input.outboxId,
          input.payloadCanonicalBytes,
          mintCorrelationTag(),
          input.now,
          input.companyId,
        ],
      );
      const row = inserted.rows[0];
      if (row === undefined) {
        // The `SELECT` matched nothing. Only reachable if the effect ceased to be
        // AUTHORISED between the read above and here, which the append-only trigger makes
        // impossible — so this is an assertion, not a fallback.
        return {
          kind: 'REFUSED',
          reason: 'EFFECT_NOT_AUTHORISED',
          detail: `effect ${input.effectId} did not resolve to an AUTHORISED row`,
        };
      }
      return { kind: 'ENQUEUED', row: toOutboxRow(row) };
    } catch (error) {
      if (hasSqlstate(error, UNIQUE_VIOLATION) && isCorrelationTagCollision(error)) {
        if (attempt < TAG_ATTEMPTS) continue;
      }
      if (hasSqlstate(error, UNIQUE_VIOLATION) && isIdentityCollision(error)) {
        // A concurrent enqueue for the same intended effect won. `25 §7`'s uniqueness did
        // its job; the loser reports the same answer the winner did rather than an error.
        // The read has to happen outside the aborted transaction, so the caller-facing
        // wrapper handles it; on this path the refusal is the honest report.
        return {
          kind: 'REFUSED',
          reason: 'ALREADY_ENQUEUED',
          detail:
            `a concurrent enqueue already created the outbox row for ${input.effectId} ` +
            '(25 §7 uniqueness, I36)',
        };
      }
      if (hasSqlstate(error, CHECK_VIOLATION)) {
        // The database's own payload↔hash binding refused. Reachable only if this
        // function's pre-check and `0010`'s CHECK disagree, which is a defect worth
        // surfacing as itself rather than as a generic failure.
        return {
          kind: 'REFUSED',
          reason: 'PAYLOAD_HASH_DIVERGED',
          detail: `dispatch_outbox refused the row: ${String(error)}`,
        };
      }
      throw error;
    }
  }

  return {
    kind: 'REFUSED',
    reason: 'ALREADY_ENQUEUED',
    detail: `correlation tag collided ${String(TAG_ATTEMPTS)} times`,
  };
}

function constraintOf(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'constraint' in error) {
    const value = (error as { constraint: unknown }).constraint;
    return typeof value === 'string' ? value : '';
  }
  return '';
}

function isCorrelationTagCollision(error: unknown): boolean {
  return constraintOf(error) === 'dispatch_outbox_correlation_tag_unique';
}

function isIdentityCollision(error: unknown): boolean {
  const name = constraintOf(error);
  return (
    name === 'dispatch_outbox_pkey' ||
    name === 'dispatch_outbox_effect_id_key' ||
    name === 'dispatch_outbox_authorisation_id_key' ||
    name === 'dispatch_outbox_outbox_id_key'
  );
}

/**
 * Enqueue in its own transaction.
 *
 * `READ COMMITTED`, because nothing here is a money-path read-modify-write: the row is
 * created or it is not, and every uniqueness property is a constraint rather than a
 * predicate over a snapshot. `33 §6` scopes the serialisable requirement to the exposure
 * ledger — "the only table with a serialisable-isolation requirement" — and this is not it.
 *
 * A LOST CONCURRENT ENQUEUE IS RE-READ OUTSIDE THE ABORTED TRANSACTION. `§44` of the
 * mandate: a retry must not create a second outbox row, a second semantic effect, a second
 * correlation tag or a second claim. The re-read returns the WINNER's row — the same tag,
 * the same identity — so the loser and the winner agree and nothing is minted twice.
 */
export async function enqueueDispatch(
  control: Pool,
  input: {
    readonly companyId: string;
    readonly effectId: string;
    readonly outboxId: string;
    readonly payloadCanonicalBytes: Buffer;
    readonly now: Date;
  },
): Promise<EnqueueOutcome> {
  const client = await control.connect();
  try {
    const outcome = await inTransaction(client, 'READ COMMITTED', (tx) =>
      enqueueDispatchOn(tx, input),
    );
    if (outcome.kind === 'REFUSED' && outcome.reason === 'ALREADY_ENQUEUED') {
      const winner = await inTransaction(client, 'READ COMMITTED', (tx) =>
        readByEffect(tx, input.companyId, input.effectId),
      );
      if (winner !== null) return { kind: 'ALREADY_ENQUEUED', row: winner };
    }
    return outcome;
  } finally {
    client.release();
  }
}

// =====================================================================================
// READERS. Introspection only — none of them decides anything.
// =====================================================================================

export async function readByEffect(
  client: Client,
  companyId: string,
  effectId: string,
): Promise<OutboxRow | null> {
  const result = await client.query<OutboxDbRow>(
    `SELECT ${OUTBOX_COLUMNS} FROM dispatch_outbox
      WHERE company_id = $1 AND effect_id = $2`,
    [companyId, effectId],
  );
  const row = result.rows[0];
  return row === undefined ? null : toOutboxRow(row);
}

export async function readByIdempotencyKey(
  client: Client,
  companyId: string,
  idempotencyKey: string,
): Promise<OutboxRow | null> {
  const result = await client.query<OutboxDbRow>(
    `SELECT ${OUTBOX_COLUMNS} FROM dispatch_outbox
      WHERE company_id = $1 AND idempotency_key = $2`,
    [companyId, idempotencyKey],
  );
  const row = result.rows[0];
  return row === undefined ? null : toOutboxRow(row);
}

/**
 * The candidate list. `ENQUEUED` rows, oldest first.
 *
 * ---------------------------------------------------------------------------------
 * THIS IS A CANDIDATE LIST AND NOT AN ELIGIBILITY DECISION — `§13`.
 *
 * "An outbox row existing does NOT mean it can still be claimed." The query filters on
 * `status` and on nothing else: it reads no mirror state, no override, no clock and no
 * exposure, and there is no stored eligibility column for it to read — `0010` adds none.
 *
 * `30 §5.1` item 4's classification happens inside the CLAIM TRANSACTION, over operands
 * read there, at that instant. A row returned by this function and then refused by the
 * claim is the NORMAL case, not an anomaly.
 * ---------------------------------------------------------------------------------
 */
export async function claimableCandidates(
  client: Client,
  companyId: string,
  limit: number,
): Promise<readonly OutboxRow[]> {
  const result = await client.query<OutboxDbRow>(
    `SELECT ${OUTBOX_COLUMNS} FROM dispatch_outbox
      WHERE company_id = $1 AND status = 'ENQUEUED'
      ORDER BY enqueued_at, outbox_id
      LIMIT $2`,
    [companyId, limit],
  );
  return result.rows.map(toOutboxRow);
}
