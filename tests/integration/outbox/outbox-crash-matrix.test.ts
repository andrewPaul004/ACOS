import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { COMPANY_ID } from '../../support/fixture.js';
import {
  authorisePause,
  authoriseRefund,
  claimJournalRows,
  createOutboxHarness,
  economicSnapshot,
  outboxRowCount,
  outboxRows,
  reconstructRefundPayload,
  type AuthorisedEffect,
  type OutboxHarness,
} from '../../support/outboxFixture.js';
import { createPool, inTransaction } from '../../../src/db/pool.js';
import {
  claimableCandidates,
  enqueueDispatch,
  enqueueDispatchOn,
} from '../../../src/kernel/outbox/enqueue.js';
import {
  claimForExternalDispatch,
  claimForExternalDispatchOn,
} from '../../../src/kernel/outbox/claim.js';
import {
  missingOutboxWork,
  recoverMissingOutboxRows,
} from '../../../src/kernel/outbox/recovery.js';

/**
 * `§20`, `§26`, `§27` — THE CRASH MATRIX, WITH THE DEFINING S1I CASE AT ITS CENTRE.
 *
 * =================================================================================
 * `§20` IS THE ONE THE SLICE EXISTS FOR:
 *
 *   "1. outbox row is eligible; 2. claim transaction commits; 3. simulate process death
 *    immediately; 4. NO external call was made; 5. recreate process/service; 6. attempt
 *    normal claim loop again.
 *    Expected: **IT DOES NOT RECLAIM THE ROW.** The row remains in the architecture's
 *    claimed/unknown-to-be-dispatched local state. Do not 'helpfully retry'. This is
 *    intentionally availability-sacrificing in favor of duplicate prevention until later
 *    resolution exists."
 *
 * `35 §4` states the trade in the architecture's own words: on recovery the row "is
 * `CLAIMED` and **is never re-dispatched by any path** (I36)". ADR-026's consequence: "A
 * missed message is now possible and is detected rather than prevented — the correct trade."
 *
 * WHAT "SIMULATE PROCESS DEATH" MEANS HERE, EXACTLY. Every S1I production module is
 * stateless with respect to progress — `recovery.ts` records the argument and
 * `journalPusher.ts` made it first — so a death is realised as DISCARDING EVERY IN-MEMORY
 * OBJECT and building a new pool against the same database. Nothing is carried across: no
 * cursor, no claim token, no cached state. That is the same substitution the ACCEPTED
 * `durable-backlog.test.ts` makes, and it is stronger than a `process.exit` would be for
 * this property, because it proves the recovery works from the DATABASE alone.
 * =================================================================================
 */

let h: OutboxHarness;
const NOW = new Date('2026-09-05T10:05:00.000Z');
const AFTER_DEATH = new Date('2026-09-05T11:05:00.000Z');

beforeAll(async () => {
  h = await createOutboxHarness();
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await h.reset();
});

/** Discard every in-memory object and come back with a new connection pool. */
async function afterProcessDeath<T>(work: (control: ReturnType<typeof createPool>) => Promise<T>): Promise<T> {
  const revived = createPool({
    connectionString: h.replication.control.url,
    applicationName: 'acos-s1i-revived',
  });
  try {
    return await work(revived);
  } finally {
    await revived.end();
  }
}

async function enqueuedPause(resourceId: string): Promise<AuthorisedEffect> {
  const effect = await authorisePause(h, { resourceId });
  const outcome = await enqueueDispatch(h.control, {
    companyId: COMPANY_ID,
    effectId: effect.effectId,
    outboxId: `outbox:${resourceId}`,
    payloadCanonicalBytes: effect.payloadCanonicalBytes,
    now: NOW,
  });
  expect(outcome.kind).toBe('ENQUEUED');
  return effect;
}

describe('`§20` — DEATH AFTER THE CLAIM COMMITS AND BEFORE ANY HYPOTHETICAL TRANSPORT', () => {
  it('the revived process runs the normal claim loop and DOES NOT reclaim the row', async () => {
    // 1 and 2. Eligible, then the claim commits.
    const effect = await enqueuedPause('CMP-KILL-AFTER-CLAIM');
    const claim = await claimForExternalDispatch(h.control, {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      claimedBy: 'worker:doomed',
      now: NOW,
    });
    expect(claim.kind).toBe('CLAIMED');
    const claimIdBefore = claim.kind === 'CLAIMED' ? claim.claim.row.claimId : null;

    // 3 and 4. Death, immediately, with NO external call — there is no transport to have
    // called, and `no-transport-boundary.test.ts` asserts that as an absence in `src/`.

    // 5 and 6. A new process runs the NORMAL LOOP: read the candidate list, claim what it
    //          offers. This is the whole of the property — not a special-cased assertion
    //          about one row, but the ordinary path finding nothing to do.
    await afterProcessDeath(async (revived) => {
      const client = await revived.connect();
      let candidates;
      try {
        candidates = await claimableCandidates(client, COMPANY_ID, 100);
      } finally {
        client.release();
      }
      // THE CLAIMED ROW IS NOT A CANDIDATE. The loop has nothing to reclaim.
      expect(candidates).toHaveLength(0);

      // And even asking for it BY NAME — a manual replay, `25 §7`'s own third case — is
      // refused.
      const replay = await claimForExternalDispatch(revived, {
        companyId: COMPANY_ID,
        idempotencyKey: effect.idempotencyKey,
        claimedBy: 'worker:revived',
        now: AFTER_DEATH,
      });
      expect(replay.kind).toBe('REFUSED');
      if (replay.kind === 'REFUSED') expect(replay.reason).toBe('ALREADY_CLAIMED');
    });

    // The persisted state is byte-for-byte what the dead process left.
    const rows = await outboxRows(h.control);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('CLAIMED');
    expect(rows[0]!.claimId).toBe(claimIdBefore);
    expect(rows[0]!.claimedBy).toBe('worker:doomed');
    expect(rows[0]!.claimedAt?.toISOString()).toBe(NOW.toISOString());
    // ONE journal row. Not two.
    expect(await claimJournalRows(h.control)).toHaveLength(1);
  });

  it('and it is availability-sacrificing on purpose: the effect is stranded, not retried', async () => {
    /*
     * `§20`: "This is intentionally availability-sacrificing in favor of duplicate
     * prevention until later resolution exists." Asserted as the observable consequence,
     * so nobody reads the previous case as a bug report.
     *
     * `35 §4` names what resolves it and it is not in this slice: "It is marked
     * `PRESUMED_EXECUTED`, the irrecoverable unit is consumed, and the provider's delivery
     * event — matched on the correlation tag — resolves it to `VERIFIED` or `NEVER_SENT`."
     */
    const effect = await enqueuedPause('CMP-STRANDED');
    await claimForExternalDispatch(h.control, {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      claimedBy: 'worker:doomed',
      now: NOW,
    });

    const row = (await outboxRows(h.control))[0]!;
    // The row is CLAIMED and there is no state it can reach from here in S1I. No
    // `PRESUMED_EXECUTED`, no `VERIFIED`, no `NEVER_SENT` — all three need provider
    // evidence and `§23` forbids manufacturing any.
    expect(row.status).toBe('CLAIMED');
    // The correlation tag is persisted and immutable, which is what a future resolution
    // will match on (ADR-026 item 4).
    expect(row.correlationTag).toMatch(/^acos-corr-/);
  });
});

describe('`§26` and `§27` — AUTHORISATION COMMITTED, DEATH BEFORE ENQUEUE', () => {
  it('the missing work is DISCOVERABLE from committed state, on every restart', async () => {
    /*
     * `§26`/`§27`: architecture places the outbox row AFTER the authorising commit
     * (`30 §5.1` item 3's ordering block; `23 §6` B8: "dispatch follows the commit"), so
     * this kill point is the one that reading (B) obliges S1I to make recoverable.
     */
    const effect = await authoriseRefund(h);
    // DEATH. No enqueue happened.
    expect(await outboxRowCount(h.control)).toBe(0);

    const found = await afterProcessDeath((revived) => missingOutboxWork(revived, COMPANY_ID));
    expect(found.map((f) => f.effectId)).toContain(effect.effectId);
    const item = found.find((f) => f.effectId === effect.effectId)!;
    // Everything the enqueue needs, from committed authoritative state alone.
    expect(item.idempotencyKey).toBe(effect.idempotencyKey);
    expect(item.authorisationId).toBe(effect.authorisationId);
    expect(item.dispatchPayloadHash).toBe(effect.dispatchPayloadHash);
    expect(item.recoverability).toBe('COMPENSABLE');

    // AND IT IS DISCOVERABLE AGAIN, on a second restart, because the view holds no state.
    const again = await afterProcessDeath((revived) => missingOutboxWork(revived, COMPANY_ID));
    expect(again.map((f) => f.effectId)).toContain(effect.effectId);
  });

  it('recovery enqueues it with NO second economic authorisation', async () => {
    const authorisationRef = 'auth:AR-S1I-RECOVER';
    const effect = await authoriseRefund(h, { authorisationRef });
    const before = await economicSnapshot(h.control);

    const reports = await afterProcessDeath((revived) =>
      recoverMissingOutboxRows(
        revived,
        COMPANY_ID,
        // The reconstruction: the registered constructor, re-run. `§27` permits
        // "discover/reconstruct", and the committed hash is what decides whether the
        // result is acceptable.
        () => reconstructRefundPayload(h, authorisationRef),
        (recovered) => `outbox:recovered:${recovered.effectId}`,
        AFTER_DEATH,
      ),
    );

    const mine = reports.find((r) => r.item.effectId === effect.effectId);
    expect(mine).toBeDefined();
    expect(mine!.outcome.kind).toBe('ENQUEUED');

    // ONE ROW, and no second authorisation, reservation, decision or effect.
    expect(await outboxRowCount(h.control)).toBe(1);
    expect(await economicSnapshot(h.control)).toEqual(before);
    // `§27`: "No model re-proposal required merely because internal enqueue crashed."
    // The recovery consumed no intent, no enumeration and no selector.
    const row = (await outboxRows(h.control))[0]!;
    expect(row.effectId).toBe(effect.effectId);
    expect(row.dispatchPayloadHash).toBe(effect.dispatchPayloadHash);
    expect(row.payloadCanonicalBytes.equals(effect.payloadCanonicalBytes)).toBe(true);
  });

  it('recovery is IDEMPOTENT — running it twice creates one row', async () => {
    const authorisationRef = 'auth:AR-S1I-RECOVER-TWICE';
    await authoriseRefund(h, { authorisationRef });

    for (let pass = 0; pass < 2; pass += 1) {
      await recoverMissingOutboxRows(
        h.control,
        COMPANY_ID,
        () => reconstructRefundPayload(h, authorisationRef),
        (recovered) => `outbox:recovered-${String(pass)}:${recovered.effectId}`,
        AFTER_DEATH,
      );
    }
    expect(await outboxRowCount(h.control)).toBe(1);
    // The second pass found nothing to do, because the first pass removed it from the view.
    expect(await missingOutboxWork(h.control, COMPANY_ID)).toHaveLength(0);
  });

  it('and an unreconstructable payload leaves the work discoverable rather than lost', async () => {
    await authoriseRefund(h);
    const reports = await recoverMissingOutboxRows(
      h.control,
      COMPANY_ID,
      // The reconstructor cannot produce bytes — a deployed constructor was withdrawn, say.
      () => null,
      (recovered) => `outbox:none:${recovered.effectId}`,
      AFTER_DEATH,
    );
    expect(reports).toHaveLength(1);
    expect(reports[0]!.outcome.kind).toBe('REFUSED');
    expect(await outboxRowCount(h.control)).toBe(0);
    // `§26`: "Do not silently leave an authorised effect with no recoverable route to its
    // outbox." It is still there, still discoverable.
    expect(await missingOutboxWork(h.control, COMPANY_ID)).toHaveLength(1);
  });
});

describe('THE REMAINING KILL POINTS', () => {
  it('ENQUEUE BEFORE COMMIT: the row is not durable and the retry is the first enqueue', async () => {
    const effect = await authorisePause(h, { resourceId: 'CMP-KILL-ENQ' });
    const client = await h.control.connect();
    try {
      await client.query('BEGIN');
      const inside = await enqueueDispatchOn(client, {
        companyId: COMPANY_ID,
        effectId: effect.effectId,
        outboxId: 'outbox:uncommitted',
        payloadCanonicalBytes: effect.payloadCanonicalBytes,
        now: NOW,
      });
      expect(inside.kind).toBe('ENQUEUED');
      // DEATH before COMMIT.
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }

    await afterProcessDeath(async (revived) => {
      expect(await outboxRowCount(revived)).toBe(0);
      // The work is discoverable, and the retry produces exactly one row.
      expect((await missingOutboxWork(revived, COMPANY_ID)).map((f) => f.effectId)).toContain(
        effect.effectId,
      );
      const retry = await enqueueDispatch(revived, {
        companyId: COMPANY_ID,
        effectId: effect.effectId,
        outboxId: 'outbox:retried',
        payloadCanonicalBytes: effect.payloadCanonicalBytes,
        now: AFTER_DEATH,
      });
      expect(retry.kind).toBe('ENQUEUED');
    });
    expect(await outboxRowCount(h.control)).toBe(1);
  });

  it('AFTER THE ENQUEUE COMMIT, BEFORE ANY CLAIM: the row is durable and claimable', async () => {
    const effect = await enqueuedPause('CMP-KILL-AFTER-ENQ');
    await afterProcessDeath(async (revived) => {
      const client = await revived.connect();
      try {
        const candidates = await claimableCandidates(client, COMPANY_ID, 100);
        expect(candidates.map((c) => c.idempotencyKey)).toEqual([effect.idempotencyKey]);
      } finally {
        client.release();
      }
      const claim = await claimForExternalDispatch(revived, {
        companyId: COMPANY_ID,
        idempotencyKey: effect.idempotencyKey,
        claimedBy: 'worker:revived',
        now: AFTER_DEATH,
      });
      expect(claim.kind).toBe('CLAIMED');
    });
    expect(await claimJournalRows(h.control)).toHaveLength(1);
  });

  it('AFTER THE CLAIM UPDATE, BEFORE ITS COMMIT: nothing happened, and the row is claimable', async () => {
    /*
     * The kill point `44 §5.2` calls "before the claim commits", and it is the one that
     * makes `§18`'s ordering meaningful: if an uncommitted claim were observable, the
     * commit-before-transport rule would buy nothing.
     */
    const effect = await enqueuedPause('CMP-KILL-MID-CLAIM');
    const client = await h.control.connect();
    try {
      await client.query('BEGIN');
      const result = await claimForExternalDispatchOn(client, {
        companyId: COMPANY_ID,
        idempotencyKey: effect.idempotencyKey,
        claimedBy: 'worker:doomed-mid-claim',
        now: NOW,
      });
      expect(result.kind).toBe('CLAIMED');
      // DEATH before COMMIT. The claim was computed, the row was updated, the journal row
      // was inserted — and none of it is durable.
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }

    await afterProcessDeath(async (revived) => {
      const rows = await outboxRows(revived);
      expect(rows[0]!.status).toBe('ENQUEUED');
      expect(rows[0]!.claimId).toBeNull();
      // No journal row either: the claim and its record share one commit point.
      expect(await claimJournalRows(revived)).toHaveLength(0);

      // AND THE ROW IS STILL CLAIMABLE, exactly once.
      const claim = await claimForExternalDispatch(revived, {
        companyId: COMPANY_ID,
        idempotencyKey: effect.idempotencyKey,
        claimedBy: 'worker:revived',
        now: AFTER_DEATH,
      });
      expect(claim.kind).toBe('CLAIMED');
      const second = await claimForExternalDispatch(revived, {
        companyId: COMPANY_ID,
        idempotencyKey: effect.idempotencyKey,
        claimedBy: 'worker:revived',
        now: AFTER_DEATH,
      });
      expect(second.kind).toBe('REFUSED');
    });
    expect(await claimJournalRows(h.control)).toHaveLength(1);
  });

  it('and the journal sequence is GAP-FREE across a rolled-back claim', async () => {
    /*
     * `30 §5.2`: "a gap is the one signal `I17` reads as suppression", and the allocator is
     * a ROW rather than a PostgreSQL sequence precisely so a rollback leaves none. S1I adds
     * a new emitter on that allocator, so the property is re-asserted for it.
     */
    const first = await enqueuedPause('CMP-SEQ-1');
    const second = await enqueuedPause('CMP-SEQ-2');

    // A claim that rolls back. Its allocated sequence must not be consumed.
    const client = await h.control.connect();
    try {
      await client.query('BEGIN');
      await claimForExternalDispatchOn(client, {
        companyId: COMPANY_ID,
        idempotencyKey: first.idempotencyKey,
        claimedBy: 'worker:rolled-back',
        now: NOW,
      });
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }

    // Two claims that commit.
    for (const effect of [first, second]) {
      const claim = await claimForExternalDispatch(h.control, {
        companyId: COMPANY_ID,
        idempotencyKey: effect.idempotencyKey,
        claimedBy: 'worker:committed',
        now: NOW,
      });
      expect(claim.kind).toBe('CLAIMED');
    }

    const reader = await h.control.connect();
    try {
      const seqs = await reader.query<{ journal_seq: string }>(
        `SELECT journal_seq FROM effect_journal WHERE company_id = $1 ORDER BY journal_seq`,
        [COMPANY_ID],
      );
      const values = seqs.rows.map((r) => Number(r.journal_seq));
      // Contiguous from 1, with no hole where the rolled-back claim's allocation was.
      expect(values).toEqual(values.map((_, index) => index + 1));
    } finally {
      reader.release();
    }
  });
});

describe('`§44` — A `40001` RETRY CREATES NOTHING TWICE', () => {
  it('a serialisation-failure retry of the enqueue yields one row and one tag', async () => {
    /*
     * `§44`: "Where a claim/enqueue transaction legitimately encounters `40001`, bounded
     * retry may occur according to accepted infrastructure. A retry must NOT create a
     * second outbox row, a second semantic effect, a second correlation tag if the first
     * transaction committed, or a second claim."
     *
     * The enqueue's identity is `(company_id, idempotency_key)` — `25 §7`'s DETERMINISTIC
     * key, computed before any transaction — so a retry recomputes the same identity by
     * construction. This drives the retry directly rather than hoping for contention:
     * the same call, twice, which is what a retry IS from the database's point of view.
     */
    const effect = await authorisePause(h, { resourceId: 'CMP-RETRY' });
    const first = await enqueueDispatch(h.control, {
      companyId: COMPANY_ID,
      effectId: effect.effectId,
      outboxId: 'outbox:retry-1',
      payloadCanonicalBytes: effect.payloadCanonicalBytes,
      now: NOW,
    });
    expect(first.kind).toBe('ENQUEUED');
    const tag = first.kind === 'ENQUEUED' ? first.row.correlationTag : '';

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const retried = await enqueueDispatch(h.control, {
        companyId: COMPANY_ID,
        effectId: effect.effectId,
        outboxId: `outbox:retry-${String(attempt + 2)}`,
        payloadCanonicalBytes: effect.payloadCanonicalBytes,
        now: AFTER_DEATH,
      });
      expect(retried.kind).toBe('ALREADY_ENQUEUED');
      if (retried.kind === 'ALREADY_ENQUEUED') {
        // NO SECOND CORRELATION TAG. `§44`, third clause.
        expect(retried.row.correlationTag).toBe(tag);
      }
    }
    expect(await outboxRowCount(h.control)).toBe(1);
  });

  it('and a retried claim after a commit is refused rather than repeated', async () => {
    const effect = await enqueuedPause('CMP-RETRY-CLAIM');
    const claim = await claimForExternalDispatch(h.control, {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      claimedBy: 'worker:retry',
      now: NOW,
    });
    expect(claim.kind).toBe('CLAIMED');
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const retried = await claimForExternalDispatch(h.control, {
        companyId: COMPANY_ID,
        idempotencyKey: effect.idempotencyKey,
        claimedBy: 'worker:retry',
        now: NOW,
      });
      expect(retried.kind).toBe('REFUSED');
      if (retried.kind === 'REFUSED') expect(retried.reason).toBe('ALREADY_CLAIMED');
    }
    // `§44`: no second claim.
    expect(await claimJournalRows(h.control)).toHaveLength(1);
  });

  it('and `40P01` remains a lock-order defect that is never retried', async () => {
    /*
     * `§44`: "`40P01` remains a lock-order defect. Do not retry it."
     *
     * The ACCEPTED `retry.ts` is where that decision lives — `isRetryable` names `40P01`
     * explicitly in order to exclude it — and S1I adds no second retry policy. Asserted as
     * a SOURCE property, because the behaviour is an absence: there is no code in the
     * outbox directory that catches a deadlock.
     */
    const { readFile, readdir } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const dir = join(process.cwd(), 'src', 'kernel', 'outbox');
    for (const entry of await readdir(dir)) {
      const code = (await readFile(join(dir, entry), 'utf8'))
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
      expect(code, entry).not.toMatch(/40P01/);
      expect(code, entry).not.toMatch(/DEADLOCK/);
      // And no second retry loop: the outbox directory does not implement one.
      expect(code, entry).not.toMatch(/withSerialisationRetry|maxAttempts/);
    }
    // A trivial use of `inTransaction` so the import is exercised rather than decorative.
    const client = await h.control.connect();
    try {
      const value = await inTransaction(client, 'READ COMMITTED', async () => 1);
      expect(value).toBe(1);
    } finally {
      client.release();
    }
  });
});
