import { afterAll, beforeEach, beforeAll, describe, expect, it } from 'vitest';

import { inTransaction, type Client } from '../../../src/db/pool.js';
import {
  SQLSTATE,
  WindowExhausted,
  hasSqlstate,
} from '../../../src/kernel/exposure/errors.js';
import { readBalance } from '../../../src/kernel/exposure/ledger.js';
import { recordRealisedSpend } from '../../../src/kernel/exposure/reconciler.js';
import { runForInstance } from '../../../src/kernel/exposure/boundaryReReservation.js';
import { authoriseRateClass } from '../../../src/kernel/exposure/stepR.js';
import { GOOGLE_ADS } from '../../../src/kernel/exposure/standingCap.js';
import { money } from '../../../src/kernel/exposure/money.js';
import {
  COMPANY_ID,
  RATE_GRANT,
  createHarness,
  instanceOf,
  materialiseInstances,
  type Harness,
} from '../../support/fixture.js';
import { CEILING, STANDING_CAP, VC_S5, fourTermSum } from '../../support/oracle.js';

/**
 * VC-S5 — window-instance scoping and the cross-boundary case (v1.3, TB-02).
 *
 * `36 §2` VC-S5, verbatim (the clauses S1A implements):
 *
 *   "$6.00/day, 31-day January. Pause on day 3; reach PAUSED; realised = $18.00,
 *    forward = $168.00, retained for the January instance — assert a second January
 *    authorisation denies WINDOW_EXHAUSTED. Cross into February. Assert the February
 *    instance's standing_monetary is $0.00 and its headroom is the full $186.00; assert
 *    no standing_window_exposure row was created for February; assert a successor
 *    authorisation permits. [...] Assert the LIVE-only re-reservation rule directly: a
 *    LIVE authorisation does acquire a February row and a PAUSE_PENDING, PAUSED or
 *    EXPIRED one does not."
 *
 * DEFERRED OUT OF S1A, with reasons recorded in docs/implementation/S1A-contract.md §5.3:
 *   - the delayed-January-delivery attribution clause, which needs `I22` and
 *     `51 §3.2.2`'s derive_sa_id — that is VC-S6, not the substrate proof;
 *   - the `I55` exemption clauses, which need the StandingRevocationAuthority sweep.
 *
 * TB-13 COMPLIANCE. `phase2-v1.3-implementation-brief.md §5` blocks "any
 * campaign.budget.set supersession path" pending TB-13. The "successor authorisation"
 * below is therefore a DISTINCT FIXTURE AUTHORISATION with its own id, created by the
 * ordinary rate-class path. No SUPERSEDED status exists, and no max-over-instance
 * standing_cap is computed anywhere in this repository.
 */

const JAN = new Date('2026-01-01T09:00:00Z');
const JAN_DAY_3 = new Date('2026-01-03T09:00:00Z');
const FEB = new Date('2026-02-01T09:00:00Z');

const MONTH = 'W_MONTH_ADSPEND';
const DAY = 'W_DAY_ADSPEND';

let harness: Harness;
let janKey: string;
let febKey: string;

beforeAll(async () => {
  harness = await createHarness();
  janKey = instanceOf(MONTH, JAN).key;
  febKey = instanceOf(MONTH, FEB).key;
});

beforeEach(async () => {
  await harness.reset();
});

afterAll(async () => {
  await harness?.close();
});

const ADAPTERS = new Map([[GOOGLE_ADS.adapter, GOOGLE_ADS]]);

/** The ordinary rate-class path. Used for BOTH the original and the successor. */
async function authorise(
  tx: Client,
  id: string,
  at: Date,
  expiresAt: Date,
): Promise<void> {
  const dayInstance = instanceOf(DAY, at);
  const monthInstance = instanceOf(MONTH, at);
  const monthCap =
    monthInstance.key === janKey ? STANDING_CAP.MONTH_31_AT_6 : STANDING_CAP.MONTH_28_AT_6;

  await authoriseRateClass(tx, {
    companyId: COMPANY_ID,
    authorisationId: `auth_${id}`,
    reservationId: `res_${id}`,
    actionClass: RATE_GRANT.actionClass,
    resourceRef: 'campaign/1',
    exposure: {
      vendorAmount: null,
      totalExposure: money('0.00'),
      forwardIntegral: money(monthCap),
    },
    standingAuthorizationId: id,
    revocationAuthorityId: `sra_${id}`,
    revocationEffectClass: RATE_GRANT.revocationEffectClass,
    adapter: RATE_GRANT.adapter,
    rateAmount: money(RATE_GRANT.rateAmount),
    rateCurrency: RATE_GRANT.rateCurrency,
    ratePeriod: RATE_GRANT.ratePeriod,
    createdAt: at,
    expiresAt,
    cessationGraceHours: GOOGLE_ADS.cessationGraceHours,
    windows: [
      {
        instance: dayInstance,
        countUnits: 0n,
        standingCap: money(STANDING_CAP.DAY_AT_6),
        instanceInScope: true,
      },
      {
        instance: monthInstance,
        countUnits: 0n,
        standingCap: money(monthCap),
        instanceInScope: true,
      },
    ],
  });
}

async function setStatus(tx: Client, id: string, status: string): Promise<void> {
  await tx.query(`UPDATE standing_authorization SET status = $2 WHERE standing_authorization_id = $1`, [
    id,
    status,
  ]);
}

async function standingRowsFor(client: Client, instanceKey: string): Promise<string[]> {
  const result = await client.query<{ standing_authorization_id: string }>(
    `SELECT standing_authorization_id FROM standing_window_exposure
      WHERE window_id = $1 AND window_instance_key = $2
      ORDER BY standing_authorization_id`,
    [MONTH, instanceKey],
  );
  return result.rows.map((r) => r.standing_authorization_id);
}

async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = await harness.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

/** January: authorise, spend three days, pause to PAUSED. */
async function januaryPausedOnDayThree(client: Client): Promise<void> {
  await inTransaction(client, 'SERIALIZABLE', async (tx) => {
    await materialiseInstances(tx, JAN, [DAY, MONTH]);
  });
  await inTransaction(client, 'SERIALIZABLE', (tx) =>
    authorise(tx, 'sa_jan', JAN, new Date('2026-01-31T23:59:59Z')),
  );
  // Three days at $6.00 = $18.00, by hand.
  await inTransaction(client, 'SERIALIZABLE', async (tx) => {
    await recordRealisedSpend(tx, {
      companyId: COMPANY_ID,
      standingAuthorizationId: 'sa_jan',
      windowId: MONTH,
      windowInstanceKey: janKey,
      delta: money(VC_S5.REALISED_AFTER_THREE_DAYS),
    });
  });
  // T1 then T2: LIVE → PAUSE_PENDING → PAUSED.
  await inTransaction(client, 'SERIALIZABLE', async (tx) => {
    await setStatus(tx, 'sa_jan', 'PAUSE_PENDING');
    await setStatus(tx, 'sa_jan', 'PAUSED');
  });
}

describe('VC-S5, January — exposure is RETAINED for the instance already held', () => {
  it('after pausing on day 3: realised $18.00, forward $168.00, retained', async () => {
    await withClient(async (client) => {
      await januaryPausedOnDayThree(client);

      const exposure = await client.query<{
        realised_monetary: string;
        forward_monetary: string;
        instance_in_scope: boolean;
      }>(
        `SELECT realised_monetary, forward_monetary, instance_in_scope
           FROM standing_window_exposure
          WHERE standing_authorization_id = 'sa_jan' AND window_instance_key = $1`,
        [janKey],
      );
      expect(exposure.rows[0]?.realised_monetary).toBe(VC_S5.REALISED_AFTER_THREE_DAYS);
      // max(0, 186.00 − 18.00) = 168.00, by hand.
      expect(exposure.rows[0]?.forward_monetary).toBe(VC_S5.FORWARD_AFTER_THREE_DAYS);
      expect(exposure.rows[0]?.instance_in_scope).toBe(true);

      // `24 §3.1`: PAUSED retains for the instance already held.
      const balance = await readBalance(client, COMPANY_ID, MONTH, janKey);
      expect(balance?.standingMonetary).toBe(VC_S5.FORWARD_AFTER_THREE_DAYS);
      expect(balance?.realisedMonetary).toBe(VC_S5.REALISED_AFTER_THREE_DAYS);
      // 168.00 + 18.00 = 186.00 — the January window is still fully committed.
      expect(
        fourTermSum({
          reserved: balance!.reservedMonetary,
          standing: balance!.standingMonetary,
          presumed: balance!.presumedMonetary,
          realised: balance!.realisedMonetary,
        }),
      ).toBe('186.00');
    });
  });

  it('a SECOND January authorisation denies WINDOW_EXHAUSTED', async () => {
    await withClient(async (client) => {
      await januaryPausedOnDayThree(client);

      // Day 3 is a FRESH day instance with the full $12.00 of daily headroom, so the
      // MONTH window is the only one that can bind. That is what VC-S5 is asserting:
      // exposure retained for the January MONTH instance blocks a second authorisation
      // inside it.
      await inTransaction(client, 'SERIALIZABLE', async (tx) => {
        await materialiseInstances(tx, JAN_DAY_3, [DAY]);
      });
      const dayThree = await readBalance(client, COMPANY_ID, DAY, instanceOf(DAY, JAN_DAY_3).key);
      expect(dayThree?.standingMonetary).toBe('0.00');

      let caught: unknown = null;
      try {
        await inTransaction(client, 'SERIALIZABLE', (tx) =>
          authorise(tx, 'sa_jan2', JAN_DAY_3, new Date('2026-01-31T23:59:59Z')),
        );
      } catch (error) {
        caught = error;
      }
      expect(
        caught,
        'a second January authorisation was PERMITTED; pausing returned headroom ' +
          'inside the window, which is the defect 54 §4.2 closes',
      ).not.toBeNull();
      // stepR translates the guard's SQLSTATE into `26 §7`'s denial vocabulary, so the
      // assertion is made against the DENIAL and against the SQLSTATE underneath it.
      expect(caught).toBeInstanceOf(WindowExhausted);
      expect((caught as WindowExhausted).denialCode).toBe('WINDOW_EXHAUSTED');
      expect(hasSqlstate((caught as WindowExhausted).cause, SQLSTATE.I3_WINDOW_EXHAUSTED)).toBe(
        true,
      );
      // The arithmetic of the denial, by hand: the retained January forward exposure of
      // $168.00 plus a second $186.00 cap is $354.00, plus $18.00 realised = $372.00
      // against a $186.00 ceiling.
      expect((caught as WindowExhausted).detail).toContain('standing=354.00');
      expect((caught as WindowExhausted).detail).toContain('realised=18.00');
    });
  });
});

describe('VC-S5, February — the LIVE-only re-reservation rule', () => {
  it('a PAUSED authorisation acquires NO February row; headroom returns in full', async () => {
    await withClient(async (client) => {
      await januaryPausedOnDayThree(client);

      // Cross the boundary.
      await inTransaction(client, 'SERIALIZABLE', async (tx) => {
        await materialiseInstances(tx, FEB, [DAY, MONTH]);
        const outcomes = await runForInstance(
          tx,
          {
            companyId: COMPANY_ID,
            companyTimezone: 'UTC',
            at: FEB,
            windows: [{ windowId: MONTH, period: 'MONTH' }],
            adapters: ADAPTERS,
          },
          { windowId: MONTH, period: 'MONTH' },
        );
        expect(outcomes).toHaveLength(1);
        expect(outcomes[0]?.action).toBe('SKIPPED_NOT_LIVE');
        expect(outcomes[0]?.status).toBe('PAUSED');
      });

      // No February standing_window_exposure row exists.
      expect(await standingRowsFor(client, febKey)).toEqual([]);

      // February's standing term is $0.00 and its headroom is the full $186.00.
      const february = await readBalance(client, COMPANY_ID, MONTH, febKey);
      expect(february?.standingMonetary).toBe(VC_S5.FEBRUARY_STANDING);
      expect(february?.reservedMonetary).toBe('0.00');
      expect(february?.presumedMonetary).toBe('0.00');
      expect(february?.realisedMonetary).toBe('0.00');
      expect(february?.maxMonetary).toBe(VC_S5.FEBRUARY_HEADROOM);
      expect(february?.maxMonetary).toBe(CEILING.W_MONTH_ADSPEND_MONETARY);

      // And January is untouched. `24 §3.1`: "Retained to instance close."
      const january = await readBalance(client, COMPANY_ID, MONTH, janKey);
      expect(january?.standingMonetary).toBe(VC_S5.FORWARD_AFTER_THREE_DAYS);
    });
  });

  it('a legitimate SUCCESSOR authorisation PERMITS in February', async () => {
    await withClient(async (client) => {
      await januaryPausedOnDayThree(client);
      await inTransaction(client, 'SERIALIZABLE', async (tx) => {
        await materialiseInstances(tx, FEB, [DAY, MONTH]);
      });

      // A DISTINCT fixture authorisation, through the ordinary rate-class path. Not a
      // supersession — TB-13 blocks that and no such path exists in this repository.
      await inTransaction(client, 'SERIALIZABLE', (tx) =>
        authorise(tx, 'sa_feb', FEB, new Date('2026-02-28T23:59:59Z')),
      );

      const february = await readBalance(client, COMPANY_ID, MONTH, febKey);
      // February 2026 has 28 days: max(28, 30.4) = 30.4; $6.00 × 30.4 = $182.40, by hand.
      expect(february?.standingMonetary).toBe(STANDING_CAP.MONTH_28_AT_6);
      expect(february?.standingMonetary).toBe('182.40');
      expect(await standingRowsFor(client, febKey)).toEqual(['sa_feb']);
    });
  });

  it('a LIVE authorisation DOES acquire a February row', async () => {
    await withClient(async (client) => {
      await inTransaction(client, 'SERIALIZABLE', async (tx) => {
        await materialiseInstances(tx, JAN, [DAY, MONTH]);
      });
      await inTransaction(client, 'SERIALIZABLE', (tx) =>
        // Expires in March, so its in-scope interval reaches February.
        authorise(tx, 'sa_live', JAN, new Date('2026-03-31T23:59:59Z')),
      );

      await inTransaction(client, 'SERIALIZABLE', async (tx) => {
        await materialiseInstances(tx, FEB, [DAY, MONTH]);
        const outcomes = await runForInstance(
          tx,
          {
            companyId: COMPANY_ID,
            companyTimezone: 'UTC',
            at: FEB,
            windows: [{ windowId: MONTH, period: 'MONTH' }],
            adapters: ADAPTERS,
          },
          { windowId: MONTH, period: 'MONTH' },
        );
        expect(outcomes[0]?.action).toBe('ROW_CREATED');
        expect(outcomes[0]?.status).toBe('LIVE');
        expect(outcomes[0]?.standingCap).toBe(STANDING_CAP.MONTH_28_AT_6);
      });

      expect(await standingRowsFor(client, febKey)).toEqual(['sa_live']);
      const february = await readBalance(client, COMPANY_ID, MONTH, febKey);
      expect(february?.standingMonetary).toBe(STANDING_CAP.MONTH_28_AT_6);
    });
  });

  it.each([
    ['PAUSE_PENDING', ['PAUSE_PENDING']],
    ['PAUSED', ['PAUSE_PENDING', 'PAUSED']],
    ['EXPIRED', ['EXPIRED']],
  ])('a %s authorisation does NOT acquire a February row', async (_final, path) => {
    await withClient(async (client) => {
      await inTransaction(client, 'SERIALIZABLE', async (tx) => {
        await materialiseInstances(tx, JAN, [DAY, MONTH]);
      });
      await inTransaction(client, 'SERIALIZABLE', (tx) =>
        authorise(tx, 'sa_x', JAN, new Date('2026-03-31T23:59:59Z')),
      );
      // Walk the declared transitions to reach the status under test.
      await inTransaction(client, 'SERIALIZABLE', async (tx) => {
        for (const status of path) await setStatus(tx, 'sa_x', status);
      });

      await inTransaction(client, 'SERIALIZABLE', async (tx) => {
        await materialiseInstances(tx, FEB, [DAY, MONTH]);
        const outcomes = await runForInstance(
          tx,
          {
            companyId: COMPANY_ID,
            companyTimezone: 'UTC',
            at: FEB,
            windows: [{ windowId: MONTH, period: 'MONTH' }],
            adapters: ADAPTERS,
          },
          { windowId: MONTH, period: 'MONTH' },
        );
        expect(outcomes[0]?.action).toBe('SKIPPED_NOT_LIVE');
      });

      expect(await standingRowsFor(client, febKey)).toEqual([]);
      const february = await readBalance(client, COMPANY_ID, MONTH, febKey);
      expect(february?.standingMonetary).toBe('0.00');
    });
  });
});

describe('VC-S5 — the in-scope interval bounds re-reservation independently of status', () => {
  it('a LIVE authorisation whose interval has ended acquires no row', async () => {
    await withClient(async (client) => {
      await inTransaction(client, 'SERIALIZABLE', async (tx) => {
        await materialiseInstances(tx, JAN, [DAY, MONTH]);
      });
      // Expires 2026-01-05; + 72h cessation_grace ends 2026-01-08. February does not
      // intersect [created_at, expires_at + cessation_grace).
      await inTransaction(client, 'SERIALIZABLE', (tx) =>
        authorise(tx, 'sa_short', JAN, new Date('2026-01-05T00:00:00Z')),
      );

      await inTransaction(client, 'SERIALIZABLE', async (tx) => {
        await materialiseInstances(tx, FEB, [DAY, MONTH]);
        const outcomes = await runForInstance(
          tx,
          {
            companyId: COMPANY_ID,
            companyTimezone: 'UTC',
            at: FEB,
            windows: [{ windowId: MONTH, period: 'MONTH' }],
            adapters: ADAPTERS,
          },
          { windowId: MONTH, period: 'MONTH' },
        );
        expect(outcomes[0]?.action).toBe('SKIPPED_OUT_OF_SCOPE');
        expect(outcomes[0]?.status).toBe('LIVE');
      });

      expect(await standingRowsFor(client, febKey)).toEqual([]);
    });
  });
});
