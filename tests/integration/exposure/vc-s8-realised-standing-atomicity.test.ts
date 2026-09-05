import { afterAll, beforeEach, beforeAll, describe, expect, it } from 'vitest';

import { inTransaction, type Client } from '../../../src/db/pool.js';
import { SQLSTATE, hasSqlstate } from '../../../src/kernel/exposure/errors.js';
import { acquireMoneyPathLocks } from '../../../src/kernel/exposure/lockOrder.js';
import { readBalance } from '../../../src/kernel/exposure/ledger.js';
import { recordRealisedSpend } from '../../../src/kernel/exposure/reconciler.js';
import { withSerialisationRetry } from '../../../src/kernel/exposure/retry.js';
import { money } from '../../../src/kernel/exposure/money.js';
import { Conductor, POINT } from '../../support/barrier.js';
import {
  COMPANY_ID,
  createHarness,
  instanceOf,
  materialiseInstances,
  type Harness,
} from '../../support/fixture.js';
import { CEILING, fourTermSum, subScale2, withinCeiling } from '../../support/oracle.js';

/**
 * VC-S8 — realised/standing atomicity, both orderings, with the mandatory negative
 * control.
 *
 * `36 §2` VC-S8, verbatim:
 *
 *   "Assert standing_window_exposure.forward_monetary is a generated column and that a
 *    direct write to it fails. Assert one reconciler statement moves standing_monetary
 *    and realised_monetary together in window_balance. Targeted interleaving, both
 *    orderings, of an asynchronous realised-spend update against a concurrent
 *    authorisation on the same window_balance row, with the mandatory REPEATABLE READ
 *    negative control that must fail. Assert no interleaving exposes headroom acquirable
 *    without the window_balance lock. Financial truth: drive realised_monetary above
 *    max_monetary and assert the write succeeds, that WINDOW_CEILING_BREACHED is raised,
 *    that a vendor-attributable excess raises STANDING_OVERDELIVERY and not I3's security
 *    path, and that the next commitment against the window is nonetheless refused."
 *
 * The generated-column clause is asserted in generated-column.test.ts. The negative
 * control lives in tests/negative-controls/. This file carries the interleavings and the
 * financial-truth leg.
 *
 * FIXTURE. W_MONTH_ADSPEND:2026-01, ceiling $186.00. One LIVE authorisation at
 * standing_cap $100.00, leaving $86.00 of headroom. A realised-spend observation of
 * $40.00 against that authorisation reduces its forward to $60.00 and raises the
 * window's realised to $40.00 — so the four-term sum is unchanged at $100.00 and the
 * headroom is still $86.00. That invariance is the whole point of TB-04: money moving
 * from the standing term to the realised term must not create or destroy headroom, and
 * no interleaving may make it appear to.
 */

const AT = new Date('2026-01-15T12:00:00Z');
const WINDOW = 'W_MONTH_ADSPEND';
const CEIL = CEILING.W_MONTH_ADSPEND_MONETARY; // '186.00'
const CAP = '100.00';
const SPEND = '40.00';
/** 186.00 − 100.00 = 86.00, by hand. */
const HEADROOM = '86.00';

let harness: Harness;
let key: string;

beforeAll(async () => {
  harness = await createHarness();
  key = instanceOf(WINDOW, AT).key;
});

beforeEach(async () => {
  await harness.reset();
  const client = await harness.connect();
  try {
    await inTransaction(client, 'SERIALIZABLE', async (tx) => {
      await materialiseInstances(tx, AT, [WINDOW]);
      await seedLiveAuthorisation(tx, 'sa_live', CAP);
    });
  } finally {
    client.release();
  }
});

afterAll(async () => {
  await harness?.close();
});

async function seedLiveAuthorisation(
  client: Client,
  id: string,
  cap: string,
): Promise<void> {
  await client.query(
    `INSERT INTO standing_revocation_authority (
       revocation_authority_id, company_id, standing_authorization_id,
       action_class_selector, resource_selector, per_action_max_monetary, expires_at, created_by)
     VALUES ($1, $2, $3, 'campaign.pause', 'campaign/1', 0.00, '2026-02-03T00:00:00Z', 'KERNEL')`,
    [`sra_${id}`, COMPANY_ID, id],
  );
  await client.query(
    `INSERT INTO standing_authorization (
       standing_authorization_id, company_id, action_class, resource_ref, adapter,
       rate_amount, rate_currency, rate_period, created_at, expires_at,
       cessation_grace_hours, revocation_effect_class, revocation_authority_id, status)
     VALUES ($1, $2, 'campaign.budget.set', 'campaign/1', 'google_ads',
             6.00, 'USD', 'day', '2026-01-01T00:00:00Z', '2026-01-31T23:59:59Z',
             72, 'campaign.pause', $3, 'LIVE')`,
    [id, COMPANY_ID, `sra_${id}`],
  );
  await client.query(
    `INSERT INTO standing_window_exposure (
       standing_authorization_id, window_id, window_instance_key, company_id,
       standing_cap_monetary, realised_monetary, instance_in_scope)
     VALUES ($1, $2, $3, $4, $5::NUMERIC, 0.00, true)`,
    [id, WINDOW, key, COMPANY_ID, cap],
  );
}

/** An independent observer on its own backend. Never writes; only watches. */
async function observedSum(client: Client): Promise<string> {
  const balance = await readBalance(client, COMPANY_ID, WINDOW, key);
  if (!balance) throw new Error('the balance row vanished');
  return fourTermSum({
    reserved: balance.reservedMonetary,
    standing: balance.standingMonetary,
    presumed: balance.presumedMonetary,
    realised: balance.realisedMonetary,
  });
}

async function finalTerms(): Promise<{
  reserved: string;
  standing: string;
  presumed: string;
  realised: string;
  sum: string;
}> {
  const client = await harness.connect();
  try {
    const balance = await readBalance(client, COMPANY_ID, WINDOW, key);
    if (!balance) throw new Error('the balance row vanished');
    const terms = {
      reserved: balance.reservedMonetary,
      standing: balance.standingMonetary,
      presumed: balance.presumedMonetary,
      realised: balance.realisedMonetary,
    };
    return { ...terms, sum: fourTermSum(terms) };
  } finally {
    client.release();
  }
}

/**
 * The outcome of the authorising side, with the serialisation retries it absorbed.
 *
 * `retries` is reported, not merely counted. `36 §0`'s discipline cuts both ways: a
 * concurrency test that no longer produces the contention it claims to test has stopped
 * being a test, and after S1A-H5 made the interleaving deterministic the retry became a
 * property to ASSERT rather than an incidental. See the `40001` assertions below.
 */
interface AuthorisationOutcome {
  readonly decision: 'PERMIT' | 'WINDOW_EXHAUSTED';
  /** Real `40001` serialisation failures absorbed by `withSerialisationRetry`. */
  readonly retries: number;
}

/**
 * The authorising side: take the declared locks, then commit `amount`.
 *
 * A guard refusal propagates out of the transaction so PostgreSQL rolls it back — the
 * transaction is in a failed state once the trigger raises, and swallowing the error
 * inside it would issue COMMIT on an aborted transaction. `WINDOW_EXHAUSTED` is a
 * DENIAL, and `26 §7` step R denials commit nothing.
 */
function authorisation(conductor: Conductor, amount: string) {
  return async (): Promise<AuthorisationOutcome> => {
    const me = conductor.participant('auth');
    const client = await harness.connect();
    try {
      let retries = 0;
      try {
        const outcome = await withSerialisationRetry(
          client,
          async (tx) => {
            await me.at(POINT.AFTER_BEGIN);
            await acquireMoneyPathLocks(tx, {
              companyId: COMPANY_ID,
              windowInstances: [{ windowId: WINDOW, windowInstanceKey: key }],
              includeStandingRows: true,
              includeJournalCounter: false,
            });
            await me.at(POINT.AFTER_LOCK);
            await tx.query(
              `UPDATE window_balance SET reserved_monetary = reserved_monetary + $4::NUMERIC
                WHERE company_id = $1 AND window_id = $2 AND window_instance_key = $3`,
              [COMPANY_ID, WINDOW, key, amount],
            );
            await me.at(POINT.AFTER_WRITE);
          },
          { maxAttempts: 25 },
        );
        retries = outcome.retries;
      } catch (error) {
        if (!hasSqlstate(error, SQLSTATE.I3_WINDOW_EXHAUSTED)) throw error;
        await me.at(POINT.AFTER_COMMIT);
        return { decision: 'WINDOW_EXHAUSTED', retries };
      }
      await me.at(POINT.AFTER_COMMIT);
      return { decision: 'PERMIT', retries };
    } finally {
      client.release();
    }
  };
}

/**
 * The reconciler side: take the same declared locks, then record realised spend.
 *
 * ---------------------------------------------------------------------------------
 * S1A-H5 — WHY THIS SIDE HAS AN `AFTER_LOCK` RENDEZVOUS
 *
 * The S1A harness gave the reconciler only `AFTER_BEGIN` and `AFTER_WRITE`. `AFTER_BEGIN`
 * proves the transaction is open and its snapshot taken; it proves NOTHING about who owns
 * the `window_balance` row. A conductor that released the competing authorisation on the
 * strength of `AFTER_BEGIN` was asserting an ordering it had not established, and under
 * load the authorisation sometimes reached the row first. The reconciler then blocked
 * behind an authorisation parked at a barrier the conductor would not release until the
 * reconciler had written — a harness deadlock, observed as 3 timeouts in 14 runs.
 *
 * The repair is a rendezvous at ACTUAL LOCK OWNERSHIP. The lock is taken here, through the
 * one declared helper and in the one declared order, and the barrier is announced only
 * once `SELECT … FOR UPDATE` has returned. `recordRealisedSpend` then re-acquires the same
 * rows in the same order inside the same transaction, which PostgreSQL satisfies from the
 * locks already held: a no-op re-acquisition, not a second lock site.
 *
 * NO PRODUCTION MONEY-PATH SEMANTICS CHANGED. `src/kernel/exposure/reconciler.ts` is
 * byte-identical to its accepted S1A form; this is a test-harness repair, and the ordering
 * it establishes is the one the S1A test already claimed in its comments.
 * ---------------------------------------------------------------------------------
 */
function reconciler(conductor: Conductor, delta: string) {
  return async (): Promise<void> => {
    const me = conductor.participant('recon');
    const client = await harness.connect();
    try {
      await withSerialisationRetry(
        client,
        async (tx) => {
          await me.at(POINT.AFTER_BEGIN);
          // The declared money-path lock order, taken through the single helper — the same
          // call `recordRealisedSpend` makes below, with the same spec.
          await acquireMoneyPathLocks(tx, {
            companyId: COMPANY_ID,
            windowInstances: [{ windowId: WINDOW, windowInstanceKey: key }],
            includeStandingRows: true,
            includeJournalCounter: false,
          });
          // Announced only now: the row is HELD, not merely reached for.
          await me.at(POINT.AFTER_LOCK);
          await recordRealisedSpend(tx, {
            companyId: COMPANY_ID,
            standingAuthorizationId: 'sa_live',
            windowId: WINDOW,
            windowInstanceKey: key,
            delta: money(delta),
          });
          await me.at(POINT.AFTER_WRITE);
        },
        { maxAttempts: 25 },
      );
      await me.at(POINT.AFTER_COMMIT);
    } finally {
      client.release();
    }
  };
}

describe('the reconciler moves standing and realised in ONE statement', () => {
  it('one statement, both terms, no intermediate state visible', async () => {
    const client = await harness.connect();
    const observer = await harness.connect();
    try {
      const before = await readBalance(observer, COMPANY_ID, WINDOW, key);
      expect(before?.standingMonetary).toBe(CAP);
      expect(before?.realisedMonetary).toBe('0.00');

      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      await recordRealisedSpend(client, {
        companyId: COMPANY_ID,
        standingAuthorizationId: 'sa_live',
        windowId: WINDOW,
        windowInstanceKey: key,
        delta: money(SPEND),
      });

      // From another backend, mid-transaction: neither term has moved.
      const during = await readBalance(observer, COMPANY_ID, WINDOW, key);
      expect(during?.standingMonetary).toBe(CAP);
      expect(during?.realisedMonetary).toBe('0.00');

      await client.query('COMMIT');

      // After commit: BOTH moved. standing 100.00 → 60.00, realised 0.00 → 40.00.
      // max(0, 100.00 − 40.00) = 60.00, by hand.
      const after = await readBalance(observer, COMPANY_ID, WINDOW, key);
      expect(after?.standingMonetary).toBe('60.00');
      expect(after?.realisedMonetary).toBe(SPEND);

      // And the FOUR-TERM SUM IS UNCHANGED. Money moved between terms; no headroom was
      // created and none was destroyed.
      expect(await observedSum(observer)).toBe(CAP);
      expect(subScale2(CEIL, CAP)).toBe(HEADROOM);
    } finally {
      client.release();
      observer.release();
    }
  });
});

describe('ORDERING A — the reconciler begins while the authorisation acquires headroom', () => {
  it('no transient headroom, no lost update, no dropped standing, no deadlock', async () => {
    const conductor = new Conductor();
    const observer = await harness.connect();
    const observations: string[] = [];

    try {
      // Both participants are started and settled independently so a failure in one
      // surfaces as its own rejection rather than cancelling the other mid-interleaving.
      const reconRun = Promise.allSettled([reconciler(conductor, SPEND)()]);
      const authRun = Promise.allSettled([authorisation(conductor, HEADROOM)()]);

      // 1. The reconciler opens its transaction.
      await conductor.step('recon', POINT.AFTER_BEGIN);

      // 2. THE RENDEZVOUS (S1A-H5). Wait for the reconciler to actually OWN the
      //    window_balance row lock. `AFTER_BEGIN` proved only that a snapshot was taken;
      //    releasing the authorisation on the strength of it was a race the harness lost
      //    under load. Nothing below runs until `SELECT … FOR UPDATE` has returned.
      await conductor.until('recon', POINT.AFTER_LOCK);

      // 3. ONLY NOW is the competing authorisation released. It reaches for the same row
      //    and must block behind the reconciler — which is exactly the property under
      //    test, and is now established rather than hoped for.
      await conductor.step('auth', POINT.AFTER_BEGIN);
      conductor.release('recon', POINT.AFTER_LOCK);

      // 4. The reconciler has written. Observe from a third backend BEFORE it commits.
      await conductor.until('recon', POINT.AFTER_WRITE);
      observations.push(await observedSum(observer));
      conductor.release('recon', POINT.AFTER_WRITE);

      // 5. Let both run to completion, sampling as they go.
      await conductor.step('recon', POINT.AFTER_COMMIT);
      observations.push(await observedSum(observer));

      await conductor.step('auth', POINT.AFTER_LOCK);
      observations.push(await observedSum(observer));
      await conductor.step('auth', POINT.AFTER_WRITE);
      observations.push(await observedSum(observer));
      await conductor.step('auth', POINT.AFTER_COMMIT);
      observations.push(await observedSum(observer));

      const [reconResult] = await reconRun;
      const [authResult] = await authRun;
      expect(reconResult?.status, `reconciler failed: ${String(reconResult?.status === 'rejected' ? reconResult.reason : '')}`).toBe('fulfilled');
      expect(authResult?.status, `authorisation failed: ${String(authResult?.status === 'rejected' ? authResult.reason : '')}`).toBe('fulfilled');
      if (authResult?.status === 'fulfilled') {
        expect(authResult.value.decision).toBe('PERMIT');
        // The required real `40001`, still observable on the CORRECT lock-order path.
        // S1A implementation log §8: at SERIALIZABLE a `SELECT … FOR UPDATE` reaching a row
        // a concurrent transaction has already committed raises `40001` rather than
        // re-reading it. The reconciler commits underneath the waiting authorisation here,
        // so exactly that must happen — and it is real contention absorbed by the
        // ACOS-owned retry, not a deadlock and not a harness artefact.
        expect(
          authResult.value.retries,
          'the authorisation absorbed no 40001; the interleaving no longer produces the ' +
            'contention this case exists to test',
        ).toBeGreaterThanOrEqual(1);
      }

      // ASSERTION 1 — no unauthorised transient headroom. Every observation, at every
      // point in the interleaving, is within the ceiling. A sample below the conservative
      // floor would be headroom that no authorisation created.
      for (const sample of observations) {
        expect(
          withinCeiling(sample, CEIL),
          `an observer saw ${sample} against a ceiling of ${CEIL}\n` +
            `timeline:\n  ${conductor.timeline().join('\n  ')}`,
        ).toBe(true);
      }

      const terms = await finalTerms();
      // ASSERTION 2 — no lost realised update.
      expect(terms.realised).toBe(SPEND);
      // ASSERTION 3 — no dropped standing update. max(0, 100.00 − 40.00) = 60.00.
      expect(terms.standing).toBe('60.00');
      // ASSERTION 5 — financial truth is correct: exactly what the vendor reported.
      // ASSERTION 6 — headroom is conservative: 60.00 + 40.00 + 86.00 = 186.00 ≤ 186.00.
      expect(terms.reserved).toBe(HEADROOM);
      expect(terms.sum).toBe('186.00');
      expect(withinCeiling(terms.sum, CEIL)).toBe(true);
    } finally {
      conductor.abort(new Error('test finished'));
      observer.release();
    }
  });
});

describe('ORDERING B — the authorisation begins while the reconciler records spend', () => {
  it('no transient headroom, no lost update, no dropped standing, no deadlock', async () => {
    const conductor = new Conductor();
    const observer = await harness.connect();
    const observations: string[] = [];

    try {
      const authRun = Promise.allSettled([authorisation(conductor, HEADROOM)()]);
      const reconRun = Promise.allSettled([reconciler(conductor, SPEND)()]);

      // 1. The authorisation opens and takes the window_balance lock. This side already
      //    had the S1A-H5 rendezvous: `AFTER_LOCK` here is announced after
      //    `SELECT … FOR UPDATE` returns, so the ownership is established, not assumed.
      await conductor.step('auth', POINT.AFTER_BEGIN);
      await conductor.until('auth', POINT.AFTER_LOCK);
      observations.push(await observedSum(observer));
      conductor.release('auth', POINT.AFTER_LOCK);

      // 2. The reconciler opens and reaches for the SAME row. It must block behind the
      //    authorisation's lock — it cannot move the standing term underneath it, and it
      //    cannot reach its own `AFTER_LOCK` until the authorisation has committed.
      await conductor.step('recon', POINT.AFTER_BEGIN);

      // 3. The authorisation writes and commits while the reconciler is still waiting.
      await conductor.until('auth', POINT.AFTER_WRITE);
      observations.push(await observedSum(observer));
      conductor.release('auth', POINT.AFTER_WRITE);
      await conductor.step('auth', POINT.AFTER_COMMIT);
      observations.push(await observedSum(observer));

      // 4. Now the reconciler proceeds — and its own lock-ownership barrier is reached
      //    only here, which is itself the evidence it was blocked until this point.
      await conductor.step('recon', POINT.AFTER_LOCK);
      await conductor.step('recon', POINT.AFTER_WRITE);
      await conductor.step('recon', POINT.AFTER_COMMIT);
      observations.push(await observedSum(observer));

      const [authResult] = await authRun;
      const [reconResult] = await reconRun;
      expect(authResult?.status, `authorisation failed: ${String(authResult?.status === 'rejected' ? authResult.reason : '')}`).toBe('fulfilled');
      expect(reconResult?.status, `reconciler failed: ${String(reconResult?.status === 'rejected' ? reconResult.reason : '')}`).toBe('fulfilled');
      if (authResult?.status === 'fulfilled') {
        expect(authResult.value.decision).toBe('PERMIT');
        // ORDERING B: the authorisation takes the row FIRST and commits before the
        // reconciler is unblocked, so it absorbs NO serialisation failure. Asserted, so
        // that the two orderings are distinguished rather than assumed alike.
        expect(authResult.value.retries).toBe(0);
      }

      for (const sample of observations) {
        expect(
          withinCeiling(sample, CEIL),
          `an observer saw ${sample} against a ceiling of ${CEIL}\n` +
            `timeline:\n  ${conductor.timeline().join('\n  ')}`,
        ).toBe(true);
      }

      const terms = await finalTerms();
      expect(terms.realised).toBe(SPEND);
      expect(terms.standing).toBe('60.00');
      expect(terms.reserved).toBe(HEADROOM);
      expect(terms.sum).toBe('186.00');
    } finally {
      conductor.abort(new Error('test finished'));
      observer.release();
    }
  });
});

describe('no interleaving exposes headroom acquirable without the window_balance lock', () => {
  it('an over-commit racing a spend observation is refused, in both orderings', async () => {
    // The authorisation asks for ONE CENT MORE than the headroom. Whatever the
    // interleaving, it must be refused: the realised spend does not create room, because
    // the standing term falls by exactly what the realised term gains.
    const conductor = new Conductor();
    try {
      const overCommit = '86.01'; // HEADROOM + 0.01, by hand
      const reconRun = Promise.allSettled([reconciler(conductor, SPEND)()]);
      const authRun = Promise.allSettled([authorisation(conductor, overCommit)()]);

      await conductor.step('recon', POINT.AFTER_BEGIN);
      // S1A-H5, the same rendezvous: the reconciler must be proven to OWN the row before
      // the competing over-commit is released. This case shared the race.
      await conductor.until('recon', POINT.AFTER_LOCK);
      await conductor.step('auth', POINT.AFTER_BEGIN);
      conductor.release('recon', POINT.AFTER_LOCK);
      await conductor.step('recon', POINT.AFTER_WRITE);
      await conductor.step('recon', POINT.AFTER_COMMIT);
      await conductor.step('auth', POINT.AFTER_LOCK);
      conductor.releaseIfParked('auth', POINT.AFTER_WRITE);
      await conductor.step('auth', POINT.AFTER_COMMIT);

      await reconRun;
      const [authResult] = await authRun;
      expect(authResult?.status).toBe('fulfilled');
      if (authResult?.status === 'fulfilled') {
        expect(
          authResult.value.decision,
          'one cent above the headroom was PERMITTED across the interleaving',
        ).toBe('WINDOW_EXHAUSTED');
      }

      const terms = await finalTerms();
      expect(terms.reserved).toBe('0.00');
      expect(terms.sum).toBe(CAP);
      expect(withinCeiling(terms.sum, CEIL)).toBe(true);
    } finally {
      conductor.abort(new Error('test finished'));
    }
  });
});

describe('financial truth above the ceiling', () => {
  it('a realised figure above max_monetary IS WRITTEN, and raises the right incidents', async () => {
    const client = await harness.connect();
    try {
      // The vendor delivered $250.00 against a $100.00 authorised cap in a $186.00
      // window. Both bounds are exceeded. Both must be recorded.
      await inTransaction(client, 'SERIALIZABLE', async (tx) => {
        await recordRealisedSpend(tx, {
          companyId: COMPANY_ID,
          standingAuthorizationId: 'sa_live',
          windowId: WINDOW,
          windowInstanceKey: key,
          delta: money('250.00'),
        });
      });

      const terms = await finalTerms();
      // The write SUCCEEDED. Reality is recorded.
      expect(terms.realised).toBe('250.00');
      // forward = max(0, 100.00 − 250.00) = 0.00
      expect(terms.standing).toBe('0.00');
      expect(terms.sum).toBe('250.00');
      expect(withinCeiling(terms.sum, CEIL)).toBe(false);

      const incidents = await client.query<{
        incident_type: string;
        incident_path: string;
        severity: string;
      }>(
        `SELECT incident_type, incident_path, severity FROM incident
          WHERE window_instance_key = $1 ORDER BY incident_type`,
        [key],
      );
      const types = incidents.rows.map((r) => r.incident_type);
      expect(types).toContain('WINDOW_CEILING_BREACHED');
      expect(types).toContain('STANDING_OVERDELIVERY');

      // AND NEITHER IS I3'S SECURITY PATH. `24 §3` K5: "a distinct incident type,
      // deliberately NOT I3's security path. A vendor billing artefact is not evidence
      // that the control model was breached."
      for (const row of incidents.rows) {
        expect(
          row.incident_path,
          `${row.incident_type} was classified as ${row.incident_path}`,
        ).toBe('FINANCIAL_TRUTH');
      }
    } finally {
      client.release();
    }
  });

  it('the NEXT commitment against the over-delivered window is refused', async () => {
    const client = await harness.connect();
    try {
      await inTransaction(client, 'SERIALIZABLE', async (tx) => {
        await recordRealisedSpend(tx, {
          companyId: COMPANY_ID,
          standingAuthorizationId: 'sa_live',
          windowId: WINDOW,
          windowInstanceKey: key,
          delta: money('250.00'),
        });
      });

      const conductor = new Conductor();
      const attempt = authorisation(conductor, '0.01')();
      await conductor.step('auth', POINT.AFTER_BEGIN);
      await conductor.step('auth', POINT.AFTER_LOCK);
      conductor.releaseIfParked('auth', POINT.AFTER_WRITE);
      await conductor.step('auth', POINT.AFTER_COMMIT);
      expect((await attempt).decision).toBe('WINDOW_EXHAUSTED');

      // But financial truth remains writable, indefinitely.
      await inTransaction(client, 'SERIALIZABLE', async (tx) => {
        await recordRealisedSpend(tx, {
          companyId: COMPANY_ID,
          standingAuthorizationId: 'sa_live',
          windowId: WINDOW,
          windowInstanceKey: key,
          delta: money('50.00'),
        });
      });
      expect((await finalTerms()).realised).toBe('300.00');
    } finally {
      client.release();
    }
  });
});
