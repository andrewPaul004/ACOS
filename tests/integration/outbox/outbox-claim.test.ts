import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { COMPANY_ID } from '../../support/fixture.js';
import {
  authorisePause,
  authoriseReship,
  claimJournalRows,
  createOutboxHarness,
  economicSnapshot,
  outboxRows,
  type AuthorisedEffect,
  type OutboxHarness,
} from '../../support/outboxFixture.js';
import { Conductor, POINT, settleAll, valueOf } from '../../support/barrier.js';
import { createPool, inTransaction } from '../../../src/db/pool.js';
import { enqueueDispatch } from '../../../src/kernel/outbox/enqueue.js';
import {
  claimForExternalDispatch,
  claimForExternalDispatchOn,
} from '../../../src/kernel/outbox/claim.js';
import {
  ensureUnsafeClaimLedger,
  unsafeClaimCount,
  unsafeSelectThenUpdateClaim,
} from '../../negative-controls/unsafe-select-then-update-claim.js';

/**
 * `I36` — THE EXCLUSIVE DURABLE CLAIM, AGAINST REAL POSTGRESQL.
 *
 * =================================================================================
 * THE INVARIANT, VERBATIM FROM THE REGISTRY:
 *
 *   "I36 | No outbox row transitions from `CLAIMED` to a second dispatch, by any path.
 *         | Control | DB (state machine constraint) | Dispatch refused. A second dispatch
 *         is a critical incident."
 *
 * `25 §7`: "The row transitions to `CLAIMED` in a committed transaction **before** the HTTP
 * call, and a `CLAIMED` row is never re-dispatched by any path — including recovery,
 * including a fork, including a manual replay."
 *
 * WHAT THIS SUITE PROVES, AND WHAT IT DOES NOT. It proves the CLAIM LEG: one durable claim
 * per outbox identity, exclusive under concurrency, unreclaimable by restart, timeout, the
 * same worker or another worker, and committed before it is returned. It proves NOTHING
 * about external exactly-once. There is no request, no vendor and no provider-accepted
 * count anywhere in this slice, and `I36`'s declared verification — "kill at each of the six
 * points in `44 §5.2` against the real ESP sandbox and assert exactly one accepted message"
 * — remains OPEN. `S1I-result.md §11` says so in those words.
 * =================================================================================
 *
 * =================================================================================
 * WHY THE CLAIMABLE EFFECT IS `campaign.pause`.
 *
 * With `clockBearing` false at claim time (`S1I-C1`, and `claim.ts` records the whole
 * argument), `30 §5.1` item 4 classifies the S1 catalogue as: IRRECOVERABLE halts at row 1;
 * COMPENSABLE falls to row 4 and SUSPENDS; REVERSIBLE reaches row 5 and dispatches. So
 * `campaign.pause` — `26 §5`: "campaign.pause | REVERSIBLE" — is the only class that
 * reaches a claim without an owner override, and `override-backed-claim-race.test.ts` covers the
 * other route.
 * =================================================================================
 */

let h: OutboxHarness;
const NOW = new Date('2026-09-05T10:05:00.000Z');
const WORKER = 'worker:s1i-dispatcher-1';

beforeAll(async () => {
  h = await createOutboxHarness();
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await h.reset();
});

/** Authorise a REVERSIBLE effect and enqueue it. The precondition of every case below. */
async function enqueuedPause(resourceId = 'CMP-S1I-CLAIM'): Promise<AuthorisedEffect> {
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

describe('ONE CLAIM, AND WHAT IT RECORDS', () => {
  it('a REVERSIBLE effect in NORMAL is claimed at row 5, and the row says so', async () => {
    const effect = await enqueuedPause();
    const result = await claimForExternalDispatch(h.control, {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      claimedBy: WORKER,
      now: NOW,
    });

    expect(result.kind).toBe('CLAIMED');
    if (result.kind !== 'CLAIMED') return;
    // `30 §5.1` item 4 row 5: "recoverability == REVERSIBLE | Dispatch against the
    // committed, locally chained journal."
    expect(result.claim.matchedRow).toBe(5);
    expect(result.claim.mirrorState).toBe('NORMAL');
    // `36 §6`: the tag follows the STATE, and `NORMAL` requires none.
    expect(result.claim.requiresUnmirroredTag).toBe(false);
    expect(result.claim.overrideId).toBeNull();

    // DIRECT SQL, on a fresh connection.
    const rows = await outboxRows(h.control);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.status).toBe('CLAIMED');
    expect(row.claimedBy).toBe(WORKER);
    expect(row.claimedAt?.toISOString()).toBe(NOW.toISOString());
    expect(row.claimMatchedRow).toBe(5);
    expect(row.claimMirrorState).toBe('NORMAL');
    expect(row.claimRequiresUnmirroredTag).toBe(false);
    expect(row.claimOverrideId).toBeNull();
    expect(row.claimId).toBe(result.claim.row.claimId);

    // `§9` — THE PAYLOAD IS THE ONE THAT WAS AUTHORISED, byte for byte, and the claim
    // returned it rather than rebuilding it.
    expect(row.payloadCanonicalBytes.equals(effect.payloadCanonicalBytes)).toBe(true);
    expect(row.dispatchPayloadHash).toBe(effect.dispatchPayloadHash);
  });

  it('the claim is journaled as `OUTBOX_CLAIMED` — never as a dispatch', async () => {
    const effect = await enqueuedPause();
    const result = await claimForExternalDispatch(h.control, {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      claimedBy: WORKER,
      now: NOW,
    });
    expect(result.kind).toBe('CLAIMED');
    if (result.kind !== 'CLAIMED') return;

    const journal = await claimJournalRows(h.control);
    expect(journal).toHaveLength(1);
    const entry = journal[0]!;
    expect(entry.journalSeq).toBe(result.claim.journalSeq);
    expect(entry.effectId).toBe(effect.effectId);
    expect(entry.authorisationId).toBe(effect.authorisationId);
    expect(entry.idempotencyKey).toBe(effect.idempotencyKey);
    expect(entry.dispatchPayloadHash).toBe(effect.dispatchPayloadHash);
    expect(entry.matchedRow).toBe(5);
    expect(entry.mirrorState).toBe('NORMAL');
    // `§16`: the tag REQUIREMENT is on the record, immutably.
    expect(entry.requiresUnmirroredTag).toBe(false);
    expect(entry.overrideId).toBeNull();
    // `I17d`: the chain is the database's. A caller-supplied value is refused.
    expect(entry.rowHash).toHaveLength(32);
    expect(entry.prevHash).toHaveLength(32);
    // The outbox row and the journal row name the SAME claim.
    expect(entry.claimId).toBe(result.claim.row.claimId);
    expect(entry.correlationTag).toBe(result.claim.row.correlationTag);
  });

  it('`§29` — the claim changes no reservation, no exposure and no grant', async () => {
    const effect = await enqueuedPause();
    const before = await economicSnapshot(h.control);

    await claimForExternalDispatch(h.control, {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      claimedBy: WORKER,
      now: NOW,
    });
    // And a REFUSED second attempt, which must also change nothing.
    await claimForExternalDispatch(h.control, {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      claimedBy: WORKER,
      now: NOW,
    });

    const after = await economicSnapshot(h.control);
    // `§29`: "claim must not top up reservation, release reservation, change exposure,
    // alter grant, change approval, mutate canonical effect."
    expect(after).toEqual(before);
  });

  it('`§24` — the IRRECOVERABLE EXECUTION UNIT IS NOT CONSUMED, at enqueue or at claim', async () => {
    /*
     * `§24` OF THE MANDATE: "Do not consume an irrecoverable-effect execution unit merely
     * because the row is enqueued. Do not consume it merely because a claim exists unless
     * current architecture explicitly defines claim as the consumption point."
     *
     * v1.3.3 defines the consumption point and it is NOT the claim. `35 §4`: on recovery
     * the row "is `CLAIMED` and is never re-dispatched by any path (I36). **It is marked
     * `PRESUMED_EXECUTED`, the irrecoverable unit is consumed**, and the provider's
     * delivery event [...] resolves it." ADR-026 item 3 says the same: for IRRECOVERABLE,
     * on an unknown outcome, "Mark `PRESUMED_EXECUTED`, **consume the irrecoverable
     * unit**, resolve later from the provider's delivery event."
     *
     * So the unit is consumed at `PRESUMED_EXECUTED`, which requires a real request
     * uncertainty, which requires a request. S1I has none, and `§23` forbids
     * manufacturing one.
     *
     * ASSERTED AS A ZERO RATHER THAN AS AN EQUALITY. The snapshot comparison above proves
     * "unchanged"; this proves the value is actually zero, so a fixture that had
     * pre-consumed a unit could not make the case pass.
     */
    const reversible = await enqueuedPause('CMP-MIE-REVERSIBLE');
    const irrecoverable = await authoriseReship(h, { resourceId: 'ORD-MIE' });
    const enqueued = await enqueueDispatch(h.control, {
      companyId: COMPANY_ID,
      effectId: irrecoverable.effectId,
      outboxId: 'outbox:mie',
      payloadCanonicalBytes: irrecoverable.payloadCanonicalBytes,
      now: NOW,
    });
    expect(enqueued.kind).toBe('ENQUEUED');

    // One claim that SUCCEEDS, and one that is HALTED at row 1.
    expect(
      (
        await claimForExternalDispatch(h.control, {
          companyId: COMPANY_ID,
          idempotencyKey: reversible.idempotencyKey,
          claimedBy: WORKER,
          now: NOW,
        })
      ).kind,
    ).toBe('CLAIMED');
    expect(
      (
        await claimForExternalDispatch(h.control, {
          companyId: COMPANY_ID,
          idempotencyKey: irrecoverable.idempotencyKey,
          claimedBy: WORKER,
          now: NOW,
        })
      ).kind,
    ).toBe('REFUSED');

    const client = await h.control.connect();
    try {
      const ledger = await client.query<{
        window_id: string;
        reserved_irrecoverable: string;
        presumed_irrecoverable: string;
        realised_irrecoverable: string;
      }>(
        `SELECT window_id, reserved_irrecoverable::TEXT, presumed_irrecoverable::TEXT,
                realised_irrecoverable::TEXT
           FROM window_balance WHERE company_id = $1
          ORDER BY window_id, window_instance_key`,
        [COMPANY_ID],
      );
      expect(ledger.rows.length).toBeGreaterThan(0);
      for (const row of ledger.rows) {
        expect(row.reserved_irrecoverable, row.window_id).toBe('0');
        expect(row.presumed_irrecoverable, row.window_id).toBe('0');
        expect(row.realised_irrecoverable, row.window_id).toBe('0');
      }
      // And no effect anywhere is in a presumed or verified state.
      const statuses = await client.query<{ status: string }>(
        `SELECT DISTINCT status FROM effect WHERE company_id = $1`,
        [COMPANY_ID],
      );
      for (const row of statuses.rows) {
        expect(['AUTHORISED', 'AWAITING_APPROVAL']).toContain(row.status);
      }
    } finally {
      client.release();
    }
  });

  it('`§41` — no business-effect state representing DISPATCHED, EXECUTED or SETTLED exists', async () => {
    const effect = await enqueuedPause();
    await claimForExternalDispatch(h.control, {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      claimedBy: WORKER,
      now: NOW,
    });

    const client = await h.control.connect();
    try {
      // The effect row's status after the claim is still the LOCAL authorisation status.
      // `24 §3` K4's terminal set — VERIFIED, FAILED, COMPENSATED, PRESUMED_EXECUTED,
      // UNRESOLVED_DISCREPANCY — is reached only after dispatch, and nothing dispatched.
      const statuses = await client.query<{ status: string }>(
        `SELECT status FROM effect WHERE company_id = $1`,
        [COMPANY_ID],
      );
      for (const row of statuses.rows) {
        expect(['AUTHORISED', 'AWAITING_APPROVAL']).toContain(row.status);
      }
      // And the CHECK constraint still admits nothing else.
      const checks = await client.query<{ def: string }>(
        `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
          WHERE conrelid = 'effect'::regclass AND contype = 'c'`,
      );
      for (const row of checks.rows) {
        expect(row.def).not.toMatch(/DISPATCHED|EXECUTED|VERIFIED|SETTLED|PRESUMED/);
      }
      // The outbox's own status domain is exactly two values, and neither is a dispatch.
      const outboxCheck = await client.query<{ def: string }>(
        `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
          WHERE conrelid = 'dispatch_outbox'::regclass
            AND conname = 'dispatch_outbox_status_declared'`,
      );
      expect(outboxCheck.rows[0]!.def).toMatch(/ENQUEUED/);
      expect(outboxCheck.rows[0]!.def).toMatch(/CLAIMED/);
      expect(outboxCheck.rows[0]!.def).not.toMatch(/DISPATCHED|VERIFIED|PRESUMED|NEVER_SENT/);
      // And the journal kind is `OUTBOX_CLAIMED`, not a dispatch record.
      const kinds = await client.query<{ journal_row_kind: string }>(
        `SELECT DISTINCT journal_row_kind FROM effect_journal WHERE company_id = $1`,
        [COMPANY_ID],
      );
      for (const row of kinds.rows) {
        expect(row.journal_row_kind).not.toMatch(/DISPATCHED$|EXECUTED|SETTLED/);
      }
    } finally {
      client.release();
    }
    expect(effect.recoverability).toBe('REVERSIBLE');
  });
});

describe('`§18` — THE CLAIM IS COMMITTED BEFORE IT IS RETURNED', () => {
  it('a SEPARATE connection observes CLAIMED the instant the caller holds the claim', async () => {
    const effect = await enqueuedPause();

    /*
     * The property `25 §7` requires: "the row transitions to `CLAIMED` in a COMMITTED
     * transaction BEFORE the HTTP call". Since there is no HTTP call, the observable form
     * is: at the moment the caller can act on the claim, another connection already sees
     * it. A claim returned from an uncommitted transaction would be invisible here.
     */
    const observer = await h.control.connect();
    try {
      const before = await observer.query<{ status: string }>(
        `SELECT status FROM dispatch_outbox WHERE company_id = $1 AND idempotency_key = $2`,
        [COMPANY_ID, effect.idempotencyKey],
      );
      expect(before.rows[0]!.status).toBe('ENQUEUED');

      const result = await claimForExternalDispatch(h.control, {
        companyId: COMPANY_ID,
        idempotencyKey: effect.idempotencyKey,
        claimedBy: WORKER,
        now: NOW,
      });
      expect(result.kind).toBe('CLAIMED');

      // NO WAIT, NO POLL, NO RETRY. The very next statement on the OTHER connection.
      const after = await observer.query<{ status: string; claim_id: string }>(
        `SELECT status, claim_id FROM dispatch_outbox
          WHERE company_id = $1 AND idempotency_key = $2`,
        [COMPANY_ID, effect.idempotencyKey],
      );
      expect(after.rows[0]!.status).toBe('CLAIMED');
      if (result.kind === 'CLAIMED') {
        expect(after.rows[0]!.claim_id).toBe(result.claim.row.claimId);
      }
    } finally {
      observer.release();
    }
  });

  it('and the journal row is committed with it, in one transaction', async () => {
    const effect = await enqueuedPause();
    const result = await claimForExternalDispatch(h.control, {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      claimedBy: WORKER,
      now: NOW,
    });
    expect(result.kind).toBe('CLAIMED');
    // A `CLAIMED` row with no journal row, or a journal row with no `CLAIMED` row, would
    // mean the two were not one durable fact. Read both from a fresh connection.
    const rows = await outboxRows(h.control);
    const journal = await claimJournalRows(h.control);
    expect(rows[0]!.status).toBe('CLAIMED');
    expect(journal).toHaveLength(1);
    expect(journal[0]!.outboxId).toBe(rows[0]!.outboxId);
  });
});

describe('`§17` — TWO CONCURRENT CLAIMERS, AND EXACTLY ONE WINS', () => {
  it('production: two real backends race one row; one CLAIMED, one ALREADY_CLAIMED', async () => {
    /*
     * `§17`: "Do not fake with JS mutex, process singleton, sequential test, in-memory
     * lock." `36 §14`: "targeted interleaving with injected delays, not throughput."
     *
     * A takes the row lock and parks at the hook. B attempts the SAME `FOR UPDATE` and
     * BLOCKS INSIDE POSTGRESQL — it cannot reach its own hook until A commits. When it
     * does, it re-reads the row under the lock and sees `CLAIMED`.
     */
    const effect = await enqueuedPause();
    const conductor = new Conductor();
    const a = conductor.participant('A');
    const b = conductor.participant('B');

    const claim = async (who: typeof a, worker: string): Promise<string> => {
      const client = await h.control.connect();
      try {
        return await inTransaction(client, 'READ COMMITTED', async (tx) => {
          const result = await claimForExternalDispatchOn(
            tx,
            {
              companyId: COMPANY_ID,
              idempotencyKey: effect.idempotencyKey,
              claimedBy: worker,
              now: NOW,
            },
            { afterLock: async () => { await who.at(POINT.AFTER_LOCK); } },
          );
          return result.kind === 'CLAIMED' ? 'CLAIMED' : `REFUSED:${result.reason}`;
        });
      } finally {
        client.release();
      }
    };

    const running = settleAll([
      () => claim(a, 'worker:A'),
      () => claim(b, 'worker:B'),
    ]);

    await conductor.until('A', POINT.AFTER_LOCK);
    conductor.release('A', POINT.AFTER_LOCK);
    await conductor.step('B', POINT.AFTER_LOCK);

    const outcomes = (await running).map((r) => valueOf(r));
    expect(outcomes.filter((o) => o === 'CLAIMED')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'REFUSED:ALREADY_CLAIMED')).toHaveLength(1);

    // AND THE PERSISTED STATE AGREES: one claim, one claim id, one journal row.
    const rows = await outboxRows(h.control);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('CLAIMED');
    expect(await claimJournalRows(h.control)).toHaveLength(1);
  });

  it('NEGATIVE CONTROL: `SELECT`-then-`UPDATE` without exclusion returns TWO claims', async () => {
    /*
     * `§38` OF THE MANDATE, and it is mandatory:
     *
     *   "Unsafe implementation: SELECT READY row; barrier; both workers see READY; both
     *    mark/return a claim without a correct exclusive DB mechanism. Under targeted
     *    interleaving: unsafe returns two claims. Production: exactly one. **If your unsafe
     *    implementation also returns one because the test accidentally serializes, the test
     *    is invalid.**"
     *
     * So this case asserts TWO — not "at least one" and not "differs from production". If
     * the interleaving ever serialised, this expectation would fail and the suite would
     * report that the discrimination had been lost rather than passing quietly.
     *
     * THE UNSAFE PATH IS TEST-ONLY. It lives under `tests/negative-controls/`, and
     * `no-transport-boundary.test.ts` asserts no file in `src/` can import from `tests/`.
     */
    const effect = await enqueuedPause();
    // The unconstrained ledger is created BEFORE the race, in its own transaction.
    // `CREATE TABLE IF NOT EXISTS` holds an `ACCESS EXCLUSIVE` lock to commit, so issuing
    // it inside the racing transactions would serialise the very interleaving `§38`
    // requires to be concurrent.
    await ensureUnsafeClaimLedger(h.control);
    const conductor = new Conductor();
    const a = conductor.participant('A');
    const b = conductor.participant('B');

    const attempt = async (who: typeof a, worker: string): Promise<string> => {
      const client = await h.control.connect();
      try {
        return await inTransaction(client, 'READ COMMITTED', async (tx) =>
          unsafeSelectThenUpdateClaim(tx, {
            companyId: COMPANY_ID,
            idempotencyKey: effect.idempotencyKey,
            claimedBy: worker,
            now: NOW,
            afterRead: async () => { await who.at(POINT.AFTER_UNLOCKED_READ); },
          }),
        );
      } finally {
        client.release();
      }
    };

    const running = settleAll([
      () => attempt(a, 'unsafe:A'),
      () => attempt(b, 'unsafe:B'),
    ]);

    // BOTH read `ENQUEUED` before EITHER writes. That is the interleaving, constructed.
    await conductor.until('A', POINT.AFTER_UNLOCKED_READ);
    await conductor.until('B', POINT.AFTER_UNLOCKED_READ);
    conductor.release('A', POINT.AFTER_UNLOCKED_READ);
    conductor.release('B', POINT.AFTER_UNLOCKED_READ);

    const outcomes = (await running).map((r) => valueOf(r));
    // EXACTLY TWO. The control discriminates.
    expect(outcomes.filter((o) => o === 'CLAIMED')).toHaveLength(2);
    // And the unconstrained ledger holds two claims for ONE intended effect.
    expect(await unsafeClaimCount(h.control, COMPANY_ID, effect.idempotencyKey)).toBe(2);
    // PRODUCTION'S OWN ROW IS UNTOUCHED: the control writes only to its own table, so the
    // real outbox row is still claimable and the production case above still holds.
    const rows = await outboxRows(h.control);
    expect(rows[0]!.status).toBe('ENQUEUED');
  });
});

describe('`§19` — A CLAIMED ROW NEVER BECOMES CLAIMABLE AGAIN', () => {
  it('the SAME worker asking twice is refused', async () => {
    const effect = await enqueuedPause();
    const first = await claimForExternalDispatch(h.control, {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      claimedBy: WORKER,
      now: NOW,
    });
    expect(first.kind).toBe('CLAIMED');
    const second = await claimForExternalDispatch(h.control, {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      claimedBy: WORKER,
      now: NOW,
    });
    expect(second.kind).toBe('REFUSED');
    if (second.kind === 'REFUSED') expect(second.reason).toBe('ALREADY_CLAIMED');
    expect(await claimJournalRows(h.control)).toHaveLength(1);
  });

  it('a DIFFERENT worker is refused', async () => {
    const effect = await enqueuedPause();
    await claimForExternalDispatch(h.control, {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      claimedBy: 'worker:first',
      now: NOW,
    });
    const other = await claimForExternalDispatch(h.control, {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      claimedBy: 'worker:second',
      now: NOW,
    });
    expect(other.kind).toBe('REFUSED');
    if (other.kind === 'REFUSED') expect(other.reason).toBe('ALREADY_CLAIMED');
    const rows = await outboxRows(h.control);
    expect(rows[0]!.claimedBy).toBe('worker:first');
  });

  it('CLOCK PASSAGE does not reclaim it — not after an hour, a day or a month', async () => {
    /*
     * `§19`: "lease timeout does not make it claimable; clock passage does not
     * automatically reclaim it." `§39` requires the discriminating control and
     * `outbox-immutability.test.ts` runs it.
     *
     * The instant is a PARAMETER of the claim, so "advance the clock" is exact rather than
     * approximate: no test sleeps, and there is no interval this can be run at that
     * produces a different answer.
     */
    const effect = await enqueuedPause();
    await claimForExternalDispatch(h.control, {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      claimedBy: WORKER,
      now: NOW,
    });

    const HOUR = 60 * 60 * 1000;
    for (const later of [NOW.getTime() + HOUR, NOW.getTime() + 24 * HOUR, NOW.getTime() + 30 * 24 * HOUR]) {
      const attempt = await claimForExternalDispatch(h.control, {
        companyId: COMPANY_ID,
        idempotencyKey: effect.idempotencyKey,
        claimedBy: WORKER,
        now: new Date(later),
      });
      expect(attempt.kind).toBe('REFUSED');
      if (attempt.kind === 'REFUSED') expect(attempt.reason).toBe('ALREADY_CLAIMED');
    }
    const rows = await outboxRows(h.control);
    expect(rows[0]!.claimedAt?.toISOString()).toBe(NOW.toISOString());
    expect(await claimJournalRows(h.control)).toHaveLength(1);
  });

  it('A PROCESS RESTART does not reclaim it', async () => {
    const effect = await enqueuedPause();
    await claimForExternalDispatch(h.control, {
      companyId: COMPANY_ID,
      idempotencyKey: effect.idempotencyKey,
      claimedBy: WORKER,
      now: NOW,
    });

    // Every S1I module is stateless with respect to progress, so the restart is realised
    // as a brand-new pool against the same database — the same substitution the ACCEPTED
    // `durable-backlog.test.ts` makes.
    const revived = createPool({
      connectionString: h.replication.control.url,
      applicationName: 'acos-s1i-restarted',
    });
    try {
      const attempt = await claimForExternalDispatch(revived, {
        companyId: COMPANY_ID,
        idempotencyKey: effect.idempotencyKey,
        claimedBy: 'worker:after-restart',
        now: new Date(NOW.getTime() + 60 * 60 * 1000),
      });
      expect(attempt.kind).toBe('REFUSED');
      if (attempt.kind === 'REFUSED') expect(attempt.reason).toBe('ALREADY_CLAIMED');
    } finally {
      await revived.end();
    }
    expect(await claimJournalRows(h.control)).toHaveLength(1);
  });
});

describe('THE CANDIDATE LIST IS NOT AN ELIGIBILITY DECISION', () => {
  it('a claimed row leaves the candidate list, and no poller exists to have claimed it', async () => {
    const one = await enqueuedPause('CMP-S1I-CAND-1');
    const two = await enqueuedPause('CMP-S1I-CAND-2');

    const client = await h.control.connect();
    try {
      const before = await client.query<{ n: string }>(
        `SELECT count(*)::TEXT AS n FROM dispatch_outbox
          WHERE company_id = $1 AND status = 'ENQUEUED'`,
        [COMPANY_ID],
      );
      expect(before.rows[0]!.n).toBe('2');
    } finally {
      client.release();
    }

    await claimForExternalDispatch(h.control, {
      companyId: COMPANY_ID,
      idempotencyKey: one.idempotencyKey,
      claimedBy: WORKER,
      now: NOW,
    });

    const rows = await outboxRows(h.control);
    expect(rows.filter((r) => r.status === 'ENQUEUED')).toHaveLength(1);
    expect(rows.filter((r) => r.status === 'CLAIMED')).toHaveLength(1);
    // `§6`: nothing claimed `two` on its own. There is no poller, no timer and no worker.
    expect(rows.find((r) => r.idempotencyKey === two.idempotencyKey)!.status).toBe('ENQUEUED');
  });
});
