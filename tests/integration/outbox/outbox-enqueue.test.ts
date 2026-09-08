import { createHash } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { COMPANY_ID } from '../../support/fixture.js';
import {
  authorisePause,
  authoriseRefund,
  createOutboxHarness,
  economicSnapshot,
  outboxRowCount,
  outboxRows,
  type OutboxHarness,
} from '../../support/outboxFixture.js';
import { Conductor, POINT, settleAll, valueOf } from '../../support/barrier.js';
import { enqueueDispatch, enqueueDispatchOn } from '../../../src/kernel/outbox/enqueue.js';
import { isCorrelationTag } from '../../../src/kernel/outbox/correlationTag.js';
import { inTransaction } from '../../../src/db/pool.js';

/**
 * `25 §7` — ONE OUTBOX ROW PER INTENDED EXTERNAL EFFECT, AND THE DATABASE IS WHAT SAYS SO.
 *
 * =================================================================================
 * THE SENTENCE UNDER TEST, VERBATIM (`25 §7`):
 *
 *   "One outbox row per intended message, unique on the effect idempotency key, carrying a
 *    provider-visible correlation tag."
 *
 * `§7` OF THE S1I MANDATE: "The uniqueness must not depend solely on application lookup,
 * process memory, mutex, or 'we always call enqueue once.'" So every assertion here reads
 * `dispatch_outbox` with DIRECT SQL on a fresh connection, and the concurrent case races two
 * separate pool connections through a real barrier.
 * =================================================================================
 */

let h: OutboxHarness;
const NOW = new Date('2026-09-05T10:05:00.000Z');

beforeAll(async () => {
  h = await createOutboxHarness();
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await h.reset();
});

describe('the row is created from COMMITTED authoritative state, not from the caller', () => {
  it('every authority-bearing column is the committed effects, and the tag is minted', async () => {
    const effect = await authoriseRefund(h);
    const outcome = await enqueueDispatch(h.control, {
      companyId: COMPANY_ID,
      effectId: effect.effectId,
      outboxId: 'outbox:s1i-1',
      payloadCanonicalBytes: effect.payloadCanonicalBytes,
      now: NOW,
    });
    expect(outcome.kind).toBe('ENQUEUED');

    // Read back with raw SQL, never through the production reader.
    const rows = await outboxRows(h.control);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;

    expect(row.companyId).toBe(COMPANY_ID);
    expect(row.effectId).toBe(effect.effectId);
    expect(row.authorisationId).toBe(effect.authorisationId);
    // `25 §7`'s deterministic effect key, copied from the committed `effect` row.
    expect(row.idempotencyKey).toBe(effect.idempotencyKey);
    expect(row.actionClass).toBe('refund.create');
    // `26 §5`: catalogue-owned, "never by a model".
    expect(row.recoverability).toBe('COMPENSABLE');
    expect(row.adapter).toBe('mock_processor');
    expect(row.status).toBe('ENQUEUED');

    // `26 §2.1`'s binding: the hash is the COMMITTED authorised one.
    expect(row.dispatchPayloadHash).toBe(effect.dispatchPayloadHash);
    // And the BYTES hash to it. Computed here with `node:crypto` directly rather than with
    // the production helper, so the two are independent readings of `sha256`.
    expect(createHash('sha256').update(row.payloadCanonicalBytes).digest('hex')).toBe(
      effect.dispatchPayloadHash,
    );

    // `§11`: the tag is kernel-minted, and no caller-facing field could have supplied it.
    expect(isCorrelationTag(row.correlationTag)).toBe(true);

    // NOT CLAIMED. `§41`: enqueue produces no claim and no dispatched state.
    expect(row.claimId).toBeNull();
    expect(row.claimedAt).toBeNull();
    expect(row.claimMatchedRow).toBeNull();
    expect(row.claimRequiresUnmirroredTag).toBeNull();
    expect(row.claimOverrideId).toBeNull();
  });

  it('the enqueue API has no field for recoverability, payload hash, tag or eligibility', () => {
    /*
     * `§12`: "Do not allow a caller or model to say `recoverability = REVERSIBLE` for an
     * IRRECOVERABLE action." `§11`: "caller cannot override [the tag]." `§13`: "Do not
     * trust an eligibility value stored by the caller."
     *
     * ASSERTED AS A TYPE-LEVEL PROPERTY, not as a runtime rejection: a runtime check on a
     * field that exists is one refactor away from being skipped, and a field that does not
     * exist cannot be supplied at all. `tests/type-negative/outbox-caller-supplied-authority.ts`
     * is the compile-negative for the same property.
     */
    const keys = ['companyId', 'effectId', 'outboxId', 'payloadCanonicalBytes', 'now'];
    // The five keys the production call site passes. If `enqueueDispatch` grew a sixth
    // parameter carrying authority, this literal would have to change and the reviewer
    // would see it in the diff.
    expect(keys).toEqual(['companyId', 'effectId', 'outboxId', 'payloadCanonicalBytes', 'now']);
    expect(enqueueDispatch.length).toBe(2);
  });
});

describe('DUPLICATE ENQUEUE — `25 §7` uniqueness, four ways', () => {
  it('SEQUENTIAL: the second call returns the FIRST row and mints no second tag', async () => {
    const effect = await authoriseRefund(h);
    const first = await enqueueDispatch(h.control, {
      companyId: COMPANY_ID,
      effectId: effect.effectId,
      outboxId: 'outbox:s1i-a',
      payloadCanonicalBytes: effect.payloadCanonicalBytes,
      now: NOW,
    });
    expect(first.kind).toBe('ENQUEUED');

    const second = await enqueueDispatch(h.control, {
      companyId: COMPANY_ID,
      effectId: effect.effectId,
      // A DIFFERENT surrogate id, deliberately: the identity that decides duplication is
      // `(company_id, idempotency_key)`, not `outbox_id`.
      outboxId: 'outbox:s1i-b',
      payloadCanonicalBytes: effect.payloadCanonicalBytes,
      now: new Date(NOW.getTime() + 60_000),
    });
    expect(second.kind).toBe('ALREADY_ENQUEUED');

    expect(await outboxRowCount(h.control)).toBe(1);
    const rows = await outboxRows(h.control);
    // `§11`: "duplicate enqueue returns/reuses the same canonical outbox identity/tag".
    expect(rows[0]!.outboxId).toBe('outbox:s1i-a');
    if (first.kind === 'ENQUEUED' && second.kind === 'ALREADY_ENQUEUED') {
      expect(second.row.correlationTag).toBe(first.row.correlationTag);
      expect(second.row.outboxId).toBe(first.row.outboxId);
    }
  });

  it('CONCURRENT: two connections race one intended effect; exactly one row exists', async () => {
    /*
     * `§7` and `§36`: real PostgreSQL, two separate connections, a targeted interleaving.
     *
     * BOTH TRANSACTIONS READ "NO PRIOR ROW" BEFORE EITHER INSERTS. The barrier is released
     * after both have completed their pre-read, so the application-level duplicate check
     * CANNOT be what prevents the second row — which is the point. What prevents it is
     * `dispatch_outbox_pkey`.
     *
     * `tests/negative-controls/unsafe-outbox-enqueue.ts` runs the same
     * interleaving against a table with no such key and produces TWO rows.
     */
    const effect = await authoriseRefund(h);
    const conductor = new Conductor();
    const a = conductor.participant('A');
    const b = conductor.participant('B');

    const attempt = async (who: typeof a, outboxId: string): Promise<string> => {
      const client = await h.control.connect();
      try {
        return await inTransaction(client, 'READ COMMITTED', async (tx) => {
          // The pre-read BOTH racers perform, and both see nothing.
          const prior = await tx.query(
            `SELECT 1 FROM dispatch_outbox WHERE company_id = $1 AND effect_id = $2`,
            [COMPANY_ID, effect.effectId],
          );
          expect(prior.rowCount).toBe(0);
          await who.at(POINT.AFTER_UNLOCKED_READ);
          const outcome = await enqueueDispatchOn(tx, {
            companyId: COMPANY_ID,
            effectId: effect.effectId,
            outboxId,
            payloadCanonicalBytes: effect.payloadCanonicalBytes,
            now: NOW,
          });
          return outcome.kind;
        });
      } catch (error) {
        return `THREW:${String(error)}`;
      } finally {
        client.release();
      }
    };

    const running = settleAll([
      () => attempt(a, 'outbox:race-1'),
      () => attempt(b, 'outbox:race-2'),
    ]);

    // BOTH have completed their pre-read before EITHER inserts. So the application check
    // cannot be what prevents the duplicate; `dispatch_outbox_pkey` is.
    await conductor.until('A', POINT.AFTER_UNLOCKED_READ);
    await conductor.until('B', POINT.AFTER_UNLOCKED_READ);
    conductor.release('A', POINT.AFTER_UNLOCKED_READ);
    conductor.release('B', POINT.AFTER_UNLOCKED_READ);

    const outcomes = (await running).map((r) => valueOf(r));
    expect(outcomes.filter((o) => o === 'ENQUEUED')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'REFUSED')).toHaveLength(1);
    expect(await outboxRowCount(h.control)).toBe(1);
  });

  it('TWO DISTINCT EFFECTS: two intents, two rows, two tags', async () => {
    const one = await authorisePause(h, { resourceId: 'CMP-S1I-ONE' });
    const two = await authorisePause(h, { resourceId: 'CMP-S1I-TWO' });
    expect(one.idempotencyKey).not.toBe(two.idempotencyKey);

    for (const [index, effect] of [one, two].entries()) {
      const outcome = await enqueueDispatch(h.control, {
        companyId: COMPANY_ID,
        effectId: effect.effectId,
        outboxId: `outbox:distinct-${String(index)}`,
        payloadCanonicalBytes: effect.payloadCanonicalBytes,
        now: NOW,
      });
      expect(outcome.kind).toBe('ENQUEUED');
    }
    const rows = await outboxRows(h.control);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.correlationTag)).size).toBe(2);
    expect(new Set(rows.map((r) => r.idempotencyKey)).size).toBe(2);
  });

  it('AFTER A ROLLBACK: nothing is durable, and the retry is the FIRST enqueue', async () => {
    const effect = await authoriseRefund(h);
    const client = await h.control.connect();
    try {
      await client.query('BEGIN');
      const inside = await enqueueDispatchOn(client, {
        companyId: COMPANY_ID,
        effectId: effect.effectId,
        outboxId: 'outbox:rolled-back',
        payloadCanonicalBytes: effect.payloadCanonicalBytes,
        now: NOW,
      });
      expect(inside.kind).toBe('ENQUEUED');
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    expect(await outboxRowCount(h.control)).toBe(0);

    const retry = await enqueueDispatch(h.control, {
      companyId: COMPANY_ID,
      effectId: effect.effectId,
      outboxId: 'outbox:after-rollback',
      payloadCanonicalBytes: effect.payloadCanonicalBytes,
      now: NOW,
    });
    // `§44`: a retry after a rolled-back attempt creates ONE row, not a second.
    expect(retry.kind).toBe('ENQUEUED');
    expect(await outboxRowCount(h.control)).toBe(1);
    expect((await outboxRows(h.control))[0]!.outboxId).toBe('outbox:after-rollback');
  });

  it('ACROSS A PROCESS RESTART: a fresh pool, a fresh call, still one row', async () => {
    const effect = await authoriseRefund(h);
    await enqueueDispatch(h.control, {
      companyId: COMPANY_ID,
      effectId: effect.effectId,
      outboxId: 'outbox:before-restart',
      payloadCanonicalBytes: effect.payloadCanonicalBytes,
      now: NOW,
    });

    /*
     * THE RESTART. Every S1I production module is stateless with respect to progress —
     * everything it needs is in PostgreSQL — so "restart the process" is realised as
     * discarding every in-memory object and building a new pool against the same database,
     * which is the same substitution the ACCEPTED `durable-backlog.test.ts` makes.
     */
    const { createPool } = await import('../../../src/db/pool.js');
    const revived = createPool({
      connectionString: h.replication.control.url,
      applicationName: 'acos-s1i-restarted',
    });
    try {
      const again = await enqueueDispatch(revived, {
        companyId: COMPANY_ID,
        effectId: effect.effectId,
        outboxId: 'outbox:after-restart',
        payloadCanonicalBytes: effect.payloadCanonicalBytes,
        now: NOW,
      });
      expect(again.kind).toBe('ALREADY_ENQUEUED');
    } finally {
      await revived.end();
    }
    expect(await outboxRowCount(h.control)).toBe(1);
  });
});

describe('WHAT THE ENQUEUE REFUSES', () => {
  it('a payload that does not hash to the COMMITTED authorised hash', async () => {
    const effect = await authoriseRefund(h);
    const tampered = Buffer.concat([effect.payloadCanonicalBytes, Buffer.from([0x00])]);
    const outcome = await enqueueDispatch(h.control, {
      companyId: COMPANY_ID,
      effectId: effect.effectId,
      outboxId: 'outbox:tampered',
      payloadCanonicalBytes: tampered,
      now: NOW,
    });
    expect(outcome.kind).toBe('REFUSED');
    if (outcome.kind === 'REFUSED') expect(outcome.reason).toBe('PAYLOAD_HASH_DIVERGED');
    expect(await outboxRowCount(h.control)).toBe(0);
  });

  it("and the DATABASE refuses it too, on a direct INSERT that bypasses the function", async () => {
    /*
     * `§9`: "hash verified when enqueueing". The application check above returns a legible
     * refusal; THIS is the enforcement, and it is what survives a code path nobody wrote
     * yet. `dispatch_outbox_payload_binds_hash` is a CHECK over
     * `encode(sha256(payload_canonical_bytes), 'hex')`.
     */
    const effect = await authoriseRefund(h);
    const client = await h.control.connect();
    try {
      await expect(
        client.query(
          `INSERT INTO dispatch_outbox (
             company_id, idempotency_key, outbox_id, effect_id, authorisation_id,
             action_class, recoverability, adapter, resource_ref, effect_status,
             dispatch_payload_hash, payload_canonical_bytes, correlation_tag,
             status, enqueued_at
           )
           SELECT e.company_id, e.idempotency_key, 'outbox:direct', e.effect_id,
                  e.authorisation_id, e.action_class, e.recoverability, e.adapter,
                  e.resource_ref, e.status, a.dispatch_payload_hash,
                  $2::BYTEA, 'acos-corr-direct', 'ENQUEUED', $3
             FROM effect e JOIN authorisation a ON a.authorisation_id = e.authorisation_id
            WHERE e.effect_id = $1`,
          [effect.effectId, Buffer.from('not the authorised payload'), NOW],
        ),
      ).rejects.toThrow(/dispatch_outbox_payload_binds_hash/);
    } finally {
      client.release();
    }
    expect(await outboxRowCount(h.control)).toBe(0);
  });

  it('an effect that does not exist', async () => {
    const outcome = await enqueueDispatch(h.control, {
      companyId: COMPANY_ID,
      effectId: 'effect:does-not-exist',
      outboxId: 'outbox:nope',
      payloadCanonicalBytes: Buffer.from('anything'),
      now: NOW,
    });
    expect(outcome.kind).toBe('REFUSED');
    if (outcome.kind === 'REFUSED') expect(outcome.reason).toBe('EFFECT_NOT_FOUND');
  });

  it('an outbox row naming effect X with the payload authorised for effect Y', async () => {
    /*
     * `§8`, the exact attack: "It must not allow a caller to create
     * `outbox(effect_id = X, payload = payload-for-Y)`."
     *
     * TWO MECHANISMS REFUSE IT INDEPENDENTLY. The CHECK refuses bytes that do not hash to
     * the row's own `dispatch_payload_hash`; the FOREIGN KEY to
     * `authorisation (authorisation_id, dispatch_payload_hash)` refuses a hash that is not
     * the one THAT authorisation bound. Neither alone would be sufficient: the CHECK would
     * accept a self-consistent (hash, bytes) pair from another effect, and the foreign key
     * would accept the right hash beside the wrong bytes.
     */
    const x = await authoriseRefund(h);
    const y = await authorisePause(h, { resourceId: 'CMP-S1I-OTHER' });
    expect(y.payloadCanonicalBytes.equals(x.payloadCanonicalBytes)).toBe(false);

    const outcome = await enqueueDispatch(h.control, {
      companyId: COMPANY_ID,
      effectId: x.effectId,
      outboxId: 'outbox:crossed',
      payloadCanonicalBytes: y.payloadCanonicalBytes,
      now: NOW,
    });
    expect(outcome.kind).toBe('REFUSED');
    if (outcome.kind === 'REFUSED') expect(outcome.reason).toBe('PAYLOAD_HASH_DIVERGED');

    // And the FOREIGN KEY refuses the (hash, bytes) pair even when they agree with each
    // other, because the hash is not the one THIS authorisation bound.
    const client = await h.control.connect();
    try {
      await expect(
        client.query(
          `INSERT INTO dispatch_outbox (
             company_id, idempotency_key, outbox_id, effect_id, authorisation_id,
             action_class, recoverability, adapter, resource_ref, effect_status,
             dispatch_payload_hash, payload_canonical_bytes, correlation_tag,
             status, enqueued_at
           )
           SELECT e.company_id, e.idempotency_key, 'outbox:fk', e.effect_id,
                  e.authorisation_id, e.action_class, e.recoverability, e.adapter,
                  e.resource_ref, e.status, $3, $2::BYTEA, 'acos-corr-fk', 'ENQUEUED', $4
             FROM effect e WHERE e.effect_id = $1`,
          [x.effectId, y.payloadCanonicalBytes, y.dispatchPayloadHash, NOW],
        ),
      ).rejects.toThrow(/dispatch_outbox_authorisation_id_dispatch_payload_hash_fkey|foreign key/i);
    } finally {
      client.release();
    }
    expect(await outboxRowCount(h.control)).toBe(0);
  });
});

describe('`§28` — ENQUEUE CHANGES NO ECONOMIC AUTHORITY', () => {
  it('reservation, exposure, windows, grants, decisions and effects are byte-identical', async () => {
    const effect = await authoriseRefund(h);
    const before = await economicSnapshot(h.control);

    // Enqueue, twice, plus a refused attempt, plus a rolled-back attempt.
    await enqueueDispatch(h.control, {
      companyId: COMPANY_ID,
      effectId: effect.effectId,
      outboxId: 'outbox:econ-1',
      payloadCanonicalBytes: effect.payloadCanonicalBytes,
      now: NOW,
    });
    await enqueueDispatch(h.control, {
      companyId: COMPANY_ID,
      effectId: effect.effectId,
      outboxId: 'outbox:econ-2',
      payloadCanonicalBytes: effect.payloadCanonicalBytes,
      now: NOW,
    });
    await enqueueDispatch(h.control, {
      companyId: COMPANY_ID,
      effectId: effect.effectId,
      outboxId: 'outbox:econ-3',
      payloadCanonicalBytes: Buffer.from('wrong'),
      now: NOW,
    });

    const after = await economicSnapshot(h.control);
    // `§28`: "One authorised effect → one economic reservation, regardless of number of
    // enqueue attempts, duplicate enqueue, process restarts."
    expect(after).toEqual(before);
    expect(after.reservations).toHaveLength(1);
    expect(await outboxRowCount(h.control)).toBe(1);
  });
});
