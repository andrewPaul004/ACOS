import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { COMPANY_ID } from '../../support/fixture.js';
import {
  REFUND_TASK_ID,
  S1I_NOW,
  authoriseRefund,
  bindTaskToCase,
  claimClockRefOf,
  closeClock,
  createOutboxHarness,
  effectCaseRef,
  openLiveClock,
  authorisePause,
  outboxRows,
  type AuthorisedEffect,
  type OutboxHarness,
} from '../../support/outboxFixture.js';
import { enqueueDispatch } from '../../../src/kernel/outbox/enqueue.js';
import { claimForExternalDispatch } from '../../../src/kernel/outbox/claim.js';
import { selectEvidentiaryClockOn } from '../../../src/kernel/clocks/statutoryClock.js';

/**
 * `30 §9.2.4` AND `§9.2.5` — CLAIM-TIME CLOCK DERIVATION, AND THE EVIDENTIARY SELECTION.
 * v1.3.4 (CSB-01), `I65`. **ROW 3 IS REACHABLE.**
 *
 * =================================================================================
 * WHAT THIS SUITE IS FOR.
 *
 * S1I asserted that row 3 was unreachable and reported the leg PARTIAL, because v1.3.3
 * declared no binding for its operand. `effect-case-binding.test.ts` proves the binding is
 * trusted; **this suite proves it is LIVE** — that the operand tracks current clock state
 * in both directions, that it survives a restart, that it fails closed, and that when
 * several clocks qualify the one recorded as evidence is chosen deterministically.
 *
 * `30 §9.2.4`: "**`clock_bearing` is derived at the decision instant from CURRENT
 * authoritative clock state.** It is never read from an enqueue-time boolean, never
 * persisted as authority, and never accepted as a parameter [...] **Both directions are
 * live.**"
 * =================================================================================
 */

let h: OutboxHarness;
const NOW = S1I_NOW;
const DAY = 24 * 60 * 60 * 1000;
const CASE = 'case:CS-CLOCK';

beforeAll(async () => {
  h = await createOutboxHarness();
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await h.reset();
  await bindTaskToCase(h.control, REFUND_TASK_ID, CASE);
});

/**
 * A COMPENSABLE `refund.create` on a case, enqueued and not yet claimed.
 *
 * `refund.create` at the S1E pass order's `$10.00` is BELOW `51 §3.7`'s `$20.00` floor, so
 * row 2 cannot intercept it: with a clock it is row 3, without one it is row 4. That is
 * exactly the pair this suite needs, and it is why the refund fixture is the subject
 * rather than the reship one.
 */
async function enqueuedRefund(tag: string): Promise<AuthorisedEffect> {
  const effect = await authoriseRefund(h);
  const outcome = await enqueueDispatch(h.control, {
    companyId: COMPANY_ID,
    effectId: effect.effectId,
    outboxId: `outbox:${tag}`,
    payloadCanonicalBytes: effect.payloadCanonicalBytes,
    now: NOW,
  });
  expect(outcome.kind).toBe('ENQUEUED');
  return effect;
}

async function claim(effect: AuthorisedEffect, at: Date = NOW) {
  return claimForExternalDispatch(h.control, {
    companyId: COMPANY_ID,
    idempotencyKey: effect.idempotencyKey,
    claimedBy: 'worker:clock',
    now: at,
  });
}

describe('`§22` — THE CLOCK IS READ AT CLAIM TIME, IN BOTH DIRECTIONS', () => {
  it('CASE 1 — enqueued with NO live clock; one opens before the claim: row 3 applies', async () => {
    /*
     * `§22` case 1 of the owner-resolution mandate: "enqueue with no live clock; a valid
     * clock opens before claim → row 3 may apply."
     *
     * This is the direction that was UNREACHABLE at S1I: `clockBearingAtClaim()` returned a
     * constant `false`, so no clock opening at any time could have produced a row-3 claim.
     */
    const effect = await enqueuedRefund('clock-opens');

    // Before: no clock. The effect falls to row 4 and SUSPENDS.
    const before = await claim(effect);
    expect(before.kind).toBe('REFUSED');
    if (before.kind === 'REFUSED') {
      expect(before.reason).toBe('PRE_DISPATCH_SUSPENDED');
      expect(before.decision?.matchedRow).toBe(4);
    }
    expect((await outboxRows(h.control))[0]!.status).toBe('ENQUEUED');

    // A qualifying live clock opens on the effect's OWN case, through the accepted `I56`
    // path — a retained RECORD-grade artifact, then a clock citing it.
    await openLiveClock(h.control, {
      caseRef: CASE,
      clockId: 'clock:opened-later',
      deadlineAt: new Date(NOW.getTime() + 7 * DAY),
    });

    // After: ROW 3, and the claim succeeds. The row was never re-enqueued and nothing
    // about it changed — only the world did.
    const after = await claim(effect);
    expect(after.kind).toBe('CLAIMED');
    if (after.kind !== 'CLAIMED') return;
    expect(after.claim.matchedRow).toBe(3);
    expect(after.claim.mirrorState).toBe('NORMAL');
    expect(after.claim.claimClockRef).toBe('clock:opened-later');
    expect((await outboxRows(h.control))[0]!.status).toBe('CLAIMED');
  });

  it('CASE 2 — enqueued WITH a live clock; it closes before the claim: row 3 no longer applies', async () => {
    // `§22` case 2: "enqueue with a live clock; it resolves/expires before claim → row 3
    // no longer applies."
    await openLiveClock(h.control, {
      caseRef: CASE,
      clockId: 'clock:closes-later',
      deadlineAt: new Date(NOW.getTime() + 7 * DAY),
    });
    const effect = await enqueuedRefund('clock-closes');

    await closeClock(h.control, 'clock:closes-later', new Date(NOW.getTime() + 60_000));

    const after = await claim(effect, new Date(NOW.getTime() + 120_000));
    expect(after.kind).toBe('REFUSED');
    if (after.kind === 'REFUSED') {
      expect(after.reason).toBe('PRE_DISPATCH_SUSPENDED');
      expect(after.decision?.matchedRow).toBe(4);
    }
    expect((await outboxRows(h.control))[0]!.status).toBe('ENQUEUED');
    // And nothing recorded a clock, because no claim happened.
    expect(await claimClockRefOf(h.control, effect.idempotencyKey)).toBeNull();
  });

  it('CASE 2b — a clock whose DEADLINE has passed is not live: a breach is not a relaxation', async () => {
    /*
     * `isClockBearingOn`'s accepted rule, unchanged: "LIVE means `closed_at IS NULL` and
     * `now < deadline_at`. A clock past its own deadline is not a live clock — a deadline
     * that has passed is a breach, not a reason to relax the mirror, and treating it as
     * live would let an expired obligation buy an indefinite relaxation."
     */
    await openLiveClock(h.control, {
      caseRef: CASE,
      clockId: 'clock:expires',
      deadlineAt: new Date(NOW.getTime() + 60_000),
    });
    const effect = await enqueuedRefund('clock-expires');

    // One second BEFORE the deadline: row 3.
    const beforeDeadline = await claim(effect, new Date(NOW.getTime() + 59_000));
    expect(beforeDeadline.kind).toBe('CLAIMED');
    if (beforeDeadline.kind !== 'CLAIMED') return;
    expect(beforeDeadline.claim.matchedRow).toBe(3);

    // A SECOND effect, claimed AFTER the deadline: row 4. The clock is the same row in the
    // same table; only the instant moved.
    await h.reset();
    await bindTaskToCase(h.control, REFUND_TASK_ID, CASE);
    await openLiveClock(h.control, {
      caseRef: CASE,
      clockId: 'clock:expires',
      deadlineAt: new Date(NOW.getTime() + 60_000),
    });
    const second = await enqueuedRefund('clock-expired');
    const afterDeadline = await claim(second, new Date(NOW.getTime() + 61_000));
    expect(afterDeadline.kind).toBe('REFUSED');
    if (afterDeadline.kind === 'REFUSED') {
      expect(afterDeadline.decision?.matchedRow).toBe(4);
    }
  });

  it('CASE 4 — a process restart produces the SAME current answer', async () => {
    /*
     * `§22` case 4: "process restart → same current result." Nothing is cached anywhere, so
     * a fresh pool on a fresh connection reads the same authoritative tables. The assertion
     * is against a SEPARATE pool, not a second call on the same one, because a per-process
     * cache would survive the second and not the first.
     */
    await openLiveClock(h.control, {
      caseRef: CASE,
      clockId: 'clock:restart',
      deadlineAt: new Date(NOW.getTime() + 7 * DAY),
    });
    const effect = await enqueuedRefund('clock-restart');

    // The restart: a brand-new pool, no in-memory state carried across — the same shape
    // `outbox-claim-eligibility.test.ts` uses for the mirror-state restart case.
    const { createPool } = await import('../../../src/db/pool.js');
    const restarted = createPool({
      connectionString: h.replication.control.url,
      applicationName: 'acos-s1i-restart-clock',
    });
    try {
      const outcome = await claimForExternalDispatch(restarted, {
        companyId: COMPANY_ID,
        idempotencyKey: effect.idempotencyKey,
        claimedBy: 'worker:restarted',
        now: NOW,
      });
      expect(outcome.kind).toBe('CLAIMED');
      if (outcome.kind !== 'CLAIMED') return;
      expect(outcome.claim.matchedRow).toBe(3);
      expect(outcome.claim.claimClockRef).toBe('clock:restart');
    } finally {
      await restarted.end();
    }
  });

  it('a CASE-LESS effect is never clock-bearing, however many clocks exist', async () => {
    /*
     * `30 §9.2.3`: "**A NULL `case_ref` never means 'search for any clock that fits.'**
     * There is no global clock search, no nearest-case match, no fallback and no heuristic.
     * Absence of a binding is a determinate `false`, not a query."
     *
     * The company has THREE live clocks and the effect has no case. A global search would
     * find all three.
     */
    await bindTaskToCase(h.control, REFUND_TASK_ID, null);
    for (const id of ['clock:g1', 'clock:g2', 'clock:g3']) {
      await openLiveClock(h.control, {
        caseRef: `case:UNRELATED-${id}`,
        clockId: id,
        deadlineAt: new Date(NOW.getTime() + 7 * DAY),
      });
    }
    const effect = await enqueuedRefund('caseless');
    expect(await effectCaseRef(h.control, effect.effectId)).toBeNull();

    const outcome = await claim(effect);
    expect(outcome.kind).toBe('REFUSED');
    if (outcome.kind === 'REFUSED') {
      // Row 4, not row 3: the operand is `false` and the effect is COMPENSABLE
      // discretionary.
      expect(outcome.decision?.matchedRow).toBe(4);
    }
  });
});

describe('`30 §9.2.5` — SEVERAL QUALIFYING CLOCKS SELECT DETERMINISTICALLY', () => {
  /**
   * THE EXPECTED ORDER IS HAND-AUTHORED HERE, FROM `30 §9.2.5`:
   *
   *   "1. **earliest authoritative statutory deadline** (`deadline_at` ascending); then
   *    2. **stable `clock_ref` ascending**, as the total tie-break."
   *
   * It is NOT computed by calling `selectEvidentiaryClockOn` — `36 §0`: "Independent
   * validation must not call the same production function twice and call agreement proof."
   */
  function oracleSelect(
    clocks: readonly { readonly clockId: string; readonly deadlineAt: Date }[],
  ): string {
    const sorted = [...clocks].sort((a, b) => {
      const byDeadline = a.deadlineAt.getTime() - b.deadlineAt.getTime();
      if (byDeadline !== 0) return byDeadline;
      return a.clockId < b.clockId ? -1 : a.clockId > b.clockId ? 1 : 0;
    });
    return sorted[0]!.clockId;
  }

  it('the EARLIEST deadline wins, and the insertion order is irrelevant', async () => {
    /*
     * TA-08 is why this rule exists at all: `phase2-v1.3-lower-severity-register.md`
     * schedules "at most one live clock per `(case_ref, statute)`" at **S5**, and v1.3.4
     * deliberately did not bring it forward. So several live clocks on one case is a
     * REACHABLE state at S1 and an unordered query would name a different one on a
     * different day for the same facts.
     *
     * The clocks are inserted in the WRONG order on purpose — latest deadline first — so a
     * production implementation that returned the first row it found would fail.
     */
    const clocks = [
      { clockId: 'clock:late', deadlineAt: new Date(NOW.getTime() + 30 * DAY) },
      { clockId: 'clock:earliest', deadlineAt: new Date(NOW.getTime() + 2 * DAY) },
      { clockId: 'clock:middle', deadlineAt: new Date(NOW.getTime() + 7 * DAY) },
    ];
    for (const c of clocks) {
      await openLiveClock(h.control, { caseRef: CASE, ...c });
    }

    const client = await h.control.connect();
    try {
      const selected = await selectEvidentiaryClockOn(client, COMPANY_ID, CASE, NOW);
      expect(selected?.clockRef).toBe(oracleSelect(clocks));
      expect(selected?.clockRef).toBe('clock:earliest');
    } finally {
      client.release();
    }
  });

  it('an EQUAL deadline is broken by ascending `clock_ref`, and the order is total', async () => {
    // `deadline_at` is not unique, so an order on it alone is not deterministic. Three
    // clocks share one instant and a fourth is later, so the tie-break is exercised
    // alongside the primary key rather than alone.
    const at = new Date(NOW.getTime() + 3 * DAY);
    const clocks = [
      { clockId: 'clock:tie-c', deadlineAt: at },
      { clockId: 'clock:tie-a', deadlineAt: at },
      { clockId: 'clock:tie-b', deadlineAt: at },
      { clockId: 'clock:aaa-later', deadlineAt: new Date(NOW.getTime() + 9 * DAY) },
    ];
    for (const c of clocks) {
      await openLiveClock(h.control, { caseRef: CASE, ...c });
    }

    const client = await h.control.connect();
    try {
      const selected = await selectEvidentiaryClockOn(client, COMPANY_ID, CASE, NOW);
      expect(selected?.clockRef).toBe(oracleSelect(clocks));
      // `clock:aaa-later` sorts FIRST alphabetically and is NOT selected, which is what
      // makes the deadline the primary key rather than the id.
      expect(selected?.clockRef).toBe('clock:tie-a');
    } finally {
      client.release();
    }
  });

  it('the selection does NOT change the boolean — the operand is still existence', async () => {
    /*
     * `30 §9.2.5`: "**The selection does not change the boolean.** The operand remains *at
     * least one qualifying live clock exists*; the selection names **which** clock is
     * recorded as the reason."
     *
     * So a case with three clocks and a case with one produce the SAME row 3, and only the
     * evidence differs.
     */
    await openLiveClock(h.control, {
      caseRef: CASE,
      clockId: 'clock:only',
      deadlineAt: new Date(NOW.getTime() + 5 * DAY),
    });
    const single = await enqueuedRefund('one-clock');
    const first = await claim(single);
    expect(first.kind).toBe('CLAIMED');
    if (first.kind !== 'CLAIMED') return;
    expect(first.claim.matchedRow).toBe(3);
    expect(first.claim.claimClockRef).toBe('clock:only');

    await h.reset();
    await bindTaskToCase(h.control, REFUND_TASK_ID, CASE);
    for (const c of [
      { clockId: 'clock:m-late', deadlineAt: new Date(NOW.getTime() + 20 * DAY) },
      { clockId: 'clock:m-early', deadlineAt: new Date(NOW.getTime() + DAY) },
    ]) {
      await openLiveClock(h.control, { caseRef: CASE, ...c });
    }
    const many = await enqueuedRefund('many-clocks');
    const second = await claim(many);
    expect(second.kind).toBe('CLAIMED');
    if (second.kind !== 'CLAIMED') return;
    expect(second.claim.matchedRow).toBe(first.claim.matchedRow);
    expect(second.claim.claimClockRef).toBe('clock:m-early');
  });
});

describe('`30 §9.2.5` — THE PERSISTED EVIDENCE, AND WHAT THE DATABASE REFUSES', () => {
  it('the selected clock is persisted on the claim ONLY where row 3 is the reason', async () => {
    await openLiveClock(h.control, {
      caseRef: CASE,
      clockId: 'clock:evidence',
      deadlineAt: new Date(NOW.getTime() + 4 * DAY),
    });
    const row3 = await enqueuedRefund('evidence-row3');
    const claimed = await claim(row3);
    expect(claimed.kind).toBe('CLAIMED');
    expect(await claimClockRefOf(h.control, row3.idempotencyKey)).toBe('clock:evidence');

    // A row-5 claim on the SAME company, with the SAME clock live, records nothing:
    // `30 §9.2.5` — "Where row 3 is not the reason, the field is NULL or absent."
    const pause = await authorisePause(h, { resourceId: 'CMP-EVIDENCE-ROW5' });
    await enqueueDispatch(h.control, {
      companyId: COMPANY_ID,
      effectId: pause.effectId,
      outboxId: 'outbox:evidence-row5',
      payloadCanonicalBytes: pause.payloadCanonicalBytes,
      now: NOW,
    });
    const row5 = await claim(pause);
    expect(row5.kind).toBe('CLAIMED');
    if (row5.kind !== 'CLAIMED') return;
    expect(row5.claim.matchedRow).toBe(5);
    expect(row5.claim.claimClockRef).toBeNull();
    expect(await claimClockRefOf(h.control, pause.idempotencyKey)).toBeNull();
  });

  it('the DATABASE refuses a claim citing a clock of ANOTHER CASE', async () => {
    /*
     * `§23` of the owner-resolution mandate: "Database rules should prevent: caller
     * choosing a clock; selected clock belonging to another company; selected clock
     * belonging to another case; selected clock not live at the authoritative decision
     * instant. **Use real PostgreSQL.**"
     *
     * The claim service has no parameter for a clock, so these are attacked with direct
     * SQL — which is the only way to reach them, and is the point: `36 §0`'s second
     * mechanism.
     */
    await openLiveClock(h.control, {
      caseRef: CASE,
      clockId: 'clock:mine',
      deadlineAt: new Date(NOW.getTime() + 4 * DAY),
    });
    await openLiveClock(h.control, {
      caseRef: 'case:SOMEONE-ELSE',
      clockId: 'clock:theirs',
      deadlineAt: new Date(NOW.getTime() + 4 * DAY),
    });
    const effect = await enqueuedRefund('cross-case');

    const client = await h.control.connect();
    try {
      await expect(
        client.query(
          `UPDATE dispatch_outbox
              SET status = 'CLAIMED', claim_id = 'claim:x', claimed_at = $3,
                  claimed_by = 'attacker', claim_matched_row = 3,
                  claim_mirror_state = 'NORMAL', claim_requires_unmirrored_tag = FALSE,
                  claim_clock_ref = 'clock:theirs'
            WHERE company_id = $1 AND idempotency_key = $2`,
          [COMPANY_ID, effect.idempotencyKey, NOW],
        ),
      ).rejects.toThrow(/CLAIM_CLOCK_EVIDENCE_CASE_MISMATCH/);
    } finally {
      client.release();
    }
    expect((await outboxRows(h.control))[0]!.status).toBe('ENQUEUED');
  });

  it('the DATABASE refuses a claim citing a clock that was NOT LIVE at the decision instant', async () => {
    await openLiveClock(h.control, {
      caseRef: CASE,
      clockId: 'clock:stale',
      deadlineAt: new Date(NOW.getTime() + 60_000),
    });
    const effect = await enqueuedRefund('stale-clock');

    const client = await h.control.connect();
    try {
      await expect(
        client.query(
          `UPDATE dispatch_outbox
              SET status = 'CLAIMED', claim_id = 'claim:y', claimed_at = $3,
                  claimed_by = 'attacker', claim_matched_row = 3,
                  claim_mirror_state = 'NORMAL', claim_requires_unmirrored_tag = FALSE,
                  claim_clock_ref = 'clock:stale'
            WHERE company_id = $1 AND idempotency_key = $2`,
          // One minute PAST the deadline. `claimed_at` is the authoritative decision
          // instant, not `now()`, which is what makes this checkable at all.
          [COMPANY_ID, effect.idempotencyKey, new Date(NOW.getTime() + 120_000)],
        ),
      ).rejects.toThrow(/CLAIM_CLOCK_EVIDENCE_NOT_LIVE/);
    } finally {
      client.release();
    }
  });

  it('the DATABASE refuses a clock reference that does not resolve, and one on a case-less effect', async () => {
    await bindTaskToCase(h.control, REFUND_TASK_ID, null);
    const caseless = await enqueuedRefund('caseless-evidence');

    const client = await h.control.connect();
    try {
      // A dangling reference: the composite foreign key to `statutory_clock` has no row.
      await expect(
        client.query(
          `UPDATE dispatch_outbox
              SET status = 'CLAIMED', claim_id = 'claim:z', claimed_at = $3,
                  claimed_by = 'attacker', claim_matched_row = 3,
                  claim_mirror_state = 'NORMAL', claim_requires_unmirrored_tag = FALSE,
                  claim_clock_ref = 'clock:does-not-exist'
            WHERE company_id = $1 AND idempotency_key = $2`,
          [COMPANY_ID, caseless.idempotencyKey, NOW],
        ),
      ).rejects.toThrow();

      // And a real clock cited by an effect with NO case binding: `30 §9.2.3` makes a
      // case-less effect never clock-bearing, so a row-3 claim for one is unrepresentable.
      await openLiveClock(h.control, {
        caseRef: CASE,
        clockId: 'clock:real-but-unrelated',
        deadlineAt: new Date(NOW.getTime() + 4 * DAY),
      });
      await expect(
        client.query(
          `UPDATE dispatch_outbox
              SET status = 'CLAIMED', claim_id = 'claim:w', claimed_at = $3,
                  claimed_by = 'attacker', claim_matched_row = 3,
                  claim_mirror_state = 'NORMAL', claim_requires_unmirrored_tag = FALSE,
                  claim_clock_ref = 'clock:real-but-unrelated'
            WHERE company_id = $1 AND idempotency_key = $2`,
          [COMPANY_ID, caseless.idempotencyKey, NOW],
        ),
      ).rejects.toThrow(/CLAIM_CLOCK_EVIDENCE_WITHOUT_CASE_BINDING/);
    } finally {
      client.release();
    }
  });

  it('and evidence at a NON-row-3 claim is refused by the biconditional', async () => {
    // `dispatch_outbox_clock_evidence_is_row_3`:
    // `(claim_clock_ref IS NOT NULL) = (claim_matched_row = 3)`.
    await openLiveClock(h.control, {
      caseRef: CASE,
      clockId: 'clock:not-row-3',
      deadlineAt: new Date(NOW.getTime() + 4 * DAY),
    });
    const effect = await enqueuedRefund('wrong-row');

    const client = await h.control.connect();
    try {
      await expect(
        client.query(
          `UPDATE dispatch_outbox
              SET status = 'CLAIMED', claim_id = 'claim:v', claimed_at = $3,
                  claimed_by = 'attacker', claim_matched_row = 5,
                  claim_mirror_state = 'NORMAL', claim_requires_unmirrored_tag = FALSE,
                  claim_clock_ref = 'clock:not-row-3'
            WHERE company_id = $1 AND idempotency_key = $2`,
          [COMPANY_ID, effect.idempotencyKey, NOW],
        ),
      ).rejects.toThrow(/dispatch_outbox_clock_evidence_is_row_3/);
    } finally {
      client.release();
    }
  });
});
