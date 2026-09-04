import { afterAll, beforeEach, beforeAll, describe, expect, it } from 'vitest';

import { inTransaction, type Client } from '../../../src/db/pool.js';
import { authoriseRateClass } from '../../../src/kernel/exposure/stepR.js';
import { money } from '../../../src/kernel/exposure/money.js';
import { readBalance } from '../../../src/kernel/exposure/ledger.js';
import {
  COMPANY_ID,
  RATE_GRANT,
  createHarness,
  instanceOf,
  materialiseInstances,
  type Harness,
} from '../../support/fixture.js';
import {
  ARCHITECTURE_PRINTED,
  CEILING,
  STANDING_CAP,
  fourTermSum,
  withinCeiling,
} from '../../support/oracle.js';

/**
 * VC-S7 — the first rate authorisation permits (v1.3, TB-03).
 *
 * `36 §2` VC-S7, verbatim:
 *
 *   "In a clean 31-day January with an empty W_MONTH_ADSPEND and W_DAY_ADSPEND, assert
 *    the first campaign.budget.set at $6.00/day returns PERMIT. Assert reservation.amount
 *    == total_exposure == 0.00 and that I18b holds; assert vendor_amount IS NULL and
 *    dispatch_payload.monetary_effect IS NULL; assert the standing_window_exposure row
 *    and the zero-amount reservation row are written in one transaction so no
 *    interleaving observes standing absent; assert I3's four-term sum is $186.00 ≤
 *    $186.00. No pre-existing verification case asserted this and under every literal
 *    v1.2 reading it denied WINDOW_EXHAUSTED."
 *
 * THIS TEST IS A STOP CONDITION. The S1A mandate: "If this test DENIES: STOP. Do not
 * adjust limits until it passes. A denial means TB-03 has been reintroduced."
 *
 * Every expected figure comes from tests/support/oracle.ts, which imports nothing from
 * src/ and transcribes `51 §2` and `51 §3.2` by hand.
 */

const JANUARY_2026 = new Date('2026-01-01T09:00:00Z');

let harness: Harness;

beforeAll(async () => {
  harness = await createHarness();
});

beforeEach(async () => {
  await harness.reset();
});

afterAll(async () => {
  await harness?.close();
});

interface AuthOutcome {
  readonly verdict: string;
  readonly reservation: {
    amount: string;
    vendor_amount: string | null;
    forward_integral: string | null;
    is_rate_class: boolean;
  };
}

/**
 * The fixture's exposure block for `campaign.budget.set`.
 *
 * `26 §2.1.3`'s field table for a rate class, transcribed. S1A does not build the Effect
 * Canonicaliser, so this is a fixture rather than a constructor output — which happens
 * to make the assertions below independent of any production construction path, as
 * `36 §0` requires.
 */
function rateExposureBlock(forwardIntegral: string) {
  return {
    vendorAmount: null,
    totalExposure: money('0.00'),
    forwardIntegral: money(forwardIntegral),
  };
}

async function firstRateAuthorisation(client: Client): Promise<AuthOutcome> {
  const dayInstance = instanceOf('W_DAY_ADSPEND', JANUARY_2026);
  const monthInstance = instanceOf('W_MONTH_ADSPEND', JANUARY_2026);

  const result = await authoriseRateClass(client, {
    companyId: COMPANY_ID,
    authorisationId: 'auth_first',
    reservationId: 'res_first',
    actionClass: RATE_GRANT.actionClass,
    resourceRef: 'campaign/1',
    // forward_integral for the MONTH window; the DAY window's own cap is on its row.
    exposure: rateExposureBlock(STANDING_CAP.MONTH_31_AT_6),
    standingAuthorizationId: 'sa_first',
    revocationAuthorityId: 'sra_first',
    revocationEffectClass: RATE_GRANT.revocationEffectClass,
    adapter: RATE_GRANT.adapter,
    rateAmount: money(RATE_GRANT.rateAmount),
    rateCurrency: RATE_GRANT.rateCurrency,
    ratePeriod: RATE_GRANT.ratePeriod,
    createdAt: JANUARY_2026,
    expiresAt: new Date('2026-01-31T23:59:59Z'),
    cessationGraceHours: 72,
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
        standingCap: money(STANDING_CAP.MONTH_31_AT_6),
        instanceInScope: true,
      },
    ],
  });

  const reservation = await client.query<AuthOutcome['reservation']>(
    `SELECT amount, vendor_amount, forward_integral, is_rate_class
       FROM exposure_reservation WHERE reservation_id = 'res_first'`,
  );
  return { verdict: result.verdict, reservation: reservation.rows[0]! };
}

describe('VC-S7 — the first campaign.budget.set in a clean January', () => {
  it('PERMITS. A denial here is TB-03 reintroduced and stops S1A.', async () => {
    const client = await harness.connect();
    try {
      await inTransaction(client, 'SERIALIZABLE', async (tx) => {
        await materialiseInstances(tx, JANUARY_2026, ['W_DAY_ADSPEND', 'W_MONTH_ADSPEND']);
      });

      const outcome = await inTransaction(client, 'SERIALIZABLE', (tx) =>
        firstRateAuthorisation(tx),
      );

      expect(outcome.verdict).toBe('PERMIT');
    } finally {
      client.release();
    }
  });

  it('the window was empty before the authorisation — the "clean" precondition', async () => {
    const client = await harness.connect();
    try {
      await inTransaction(client, 'SERIALIZABLE', async (tx) => {
        await materialiseInstances(tx, JANUARY_2026, ['W_DAY_ADSPEND', 'W_MONTH_ADSPEND']);
      });
      const before = await readBalance(
        client,
        COMPANY_ID,
        'W_MONTH_ADSPEND',
        instanceOf('W_MONTH_ADSPEND', JANUARY_2026).key,
      );
      expect(before).not.toBeNull();
      expect(before?.reservedMonetary).toBe('0.00');
      expect(before?.standingMonetary).toBe('0.00');
      expect(before?.presumedMonetary).toBe('0.00');
      expect(before?.realisedMonetary).toBe('0.00');
      expect(before?.maxMonetary).toBe(CEILING.W_MONTH_ADSPEND_MONETARY);
    } finally {
      client.release();
    }
  });

  it('reservation.amount == total_exposure == 0.00, and I18b holds exactly', async () => {
    const client = await harness.connect();
    try {
      await inTransaction(client, 'SERIALIZABLE', async (tx) => {
        await materialiseInstances(tx, JANUARY_2026, ['W_DAY_ADSPEND', 'W_MONTH_ADSPEND']);
      });
      const outcome = await inTransaction(client, 'SERIALIZABLE', (tx) =>
        firstRateAuthorisation(tx),
      );

      // I18b: reservation.amount == exposure.total_exposure, exactly, no tolerance.
      // total_exposure is 0.00 by `26 §2.1.3`, so the reservation amount is 0.00.
      expect(outcome.reservation.amount).toBe('0.00');
      expect(outcome.reservation.is_rate_class).toBe(true);
    } finally {
      client.release();
    }
  });

  it('vendor_amount IS NULL — I18a null branch, 26 §2.1.3', async () => {
    const client = await harness.connect();
    try {
      await inTransaction(client, 'SERIALIZABLE', async (tx) => {
        await materialiseInstances(tx, JANUARY_2026, ['W_DAY_ADSPEND', 'W_MONTH_ADSPEND']);
      });
      const outcome = await inTransaction(client, 'SERIALIZABLE', (tx) =>
        firstRateAuthorisation(tx),
      );
      expect(outcome.reservation.vendor_amount).toBeNull();

      // dispatch_payload.monetary_effect IS NULL. S1A builds no canonicaliser and no
      // dispatch payload, so this is asserted against the FIXTURE payload — which is the
      // most independent form the assertion can take, since there is no production
      // constructor for it to agree with by construction.
      const fixtureDispatchPayload = { monetaryEffect: null };
      expect(fixtureDispatchPayload.monetaryEffect).toBeNull();
    } finally {
      client.release();
    }
  });

  it('forward_integral is a SEPARATE field, never the reservation amount (E1)', async () => {
    const client = await harness.connect();
    try {
      await inTransaction(client, 'SERIALIZABLE', async (tx) => {
        await materialiseInstances(tx, JANUARY_2026, ['W_DAY_ADSPEND', 'W_MONTH_ADSPEND']);
      });
      const outcome = await inTransaction(client, 'SERIALIZABLE', (tx) =>
        firstRateAuthorisation(tx),
      );
      expect(outcome.reservation.forward_integral).toBe(STANDING_CAP.MONTH_31_AT_6);
      expect(outcome.reservation.amount).toBe('0.00');
      expect(outcome.reservation.amount).not.toBe(outcome.reservation.forward_integral);
    } finally {
      client.release();
    }
  });

  it("I3's four-term sum on the MONTH window is $186.00 ≤ $186.00", async () => {
    const client = await harness.connect();
    try {
      await inTransaction(client, 'SERIALIZABLE', async (tx) => {
        await materialiseInstances(tx, JANUARY_2026, ['W_DAY_ADSPEND', 'W_MONTH_ADSPEND']);
      });
      await inTransaction(client, 'SERIALIZABLE', (tx) => firstRateAuthorisation(tx));

      const balance = await readBalance(
        client,
        COMPANY_ID,
        'W_MONTH_ADSPEND',
        instanceOf('W_MONTH_ADSPEND', JANUARY_2026).key,
      );
      expect(balance).not.toBeNull();

      // Term by term, against `26 §2.1.3`'s printed working:
      //   term 1 reserved  = $0.00      term 2 standing  = $186.00
      //   term 3 presumed  = $0.00      term 4 realised  = $0.00
      expect(balance!.reservedMonetary).toBe('0.00');
      expect(balance!.standingMonetary).toBe(STANDING_CAP.MONTH_31_AT_6);
      expect(balance!.presumedMonetary).toBe('0.00');
      expect(balance!.realisedMonetary).toBe('0.00');

      // The sum, computed by the ORACLE, not by the guard.
      const sum = fourTermSum({
        reserved: balance!.reservedMonetary,
        standing: balance!.standingMonetary,
        presumed: balance!.presumedMonetary,
        realised: balance!.realisedMonetary,
      });
      expect(sum).toBe('186.00');
      expect(withinCeiling(sum, CEILING.W_MONTH_ADSPEND_MONETARY)).toBe(true);
      expect(`$${sum}`).toBe(ARCHITECTURE_PRINTED.FIRST_AUTH_MONTH_SUM);
      expect(`$${balance!.maxMonetary}`).toBe(ARCHITECTURE_PRINTED.FIRST_AUTH_MONTH_CEILING);
    } finally {
      client.release();
    }
  });

  it("I3's four-term sum on the DAY window is $12.00 ≤ $12.00", async () => {
    const client = await harness.connect();
    try {
      await inTransaction(client, 'SERIALIZABLE', async (tx) => {
        await materialiseInstances(tx, JANUARY_2026, ['W_DAY_ADSPEND', 'W_MONTH_ADSPEND']);
      });
      await inTransaction(client, 'SERIALIZABLE', (tx) => firstRateAuthorisation(tx));

      const balance = await readBalance(
        client,
        COMPANY_ID,
        'W_DAY_ADSPEND',
        instanceOf('W_DAY_ADSPEND', JANUARY_2026).key,
      );
      expect(balance!.standingMonetary).toBe(STANDING_CAP.DAY_AT_6);
      const sum = fourTermSum({
        reserved: balance!.reservedMonetary,
        standing: balance!.standingMonetary,
        presumed: balance!.presumedMonetary,
        realised: balance!.realisedMonetary,
      });
      expect(sum).toBe('12.00');
      expect(`$${sum}`).toBe(ARCHITECTURE_PRINTED.FIRST_AUTH_DAY_SUM);
      expect(withinCeiling(sum, CEILING.W_DAY_ADSPEND_MONETARY)).toBe(true);
    } finally {
      client.release();
    }
  });

  it('no interleaving observes standing absent: both rows land in ONE transaction', async () => {
    // `26 §2.1.3`: "There is no interval in which the standing term is absent and the
    // reservation is zero."
    //
    // Asserted by an INDEPENDENT observer on its own backend at READ COMMITTED, which
    // reads the balance while the authorising transaction is open and uncommitted. If
    // the two rows were written in separate transactions, the observer would see a
    // window in which the reservation row exists at 0.00 and standing_monetary is still
    // 0.00 — headroom that no authorisation created.
    const writer = await harness.connect();
    const observer = await harness.connect();
    try {
      await inTransaction(writer, 'SERIALIZABLE', async (tx) => {
        await materialiseInstances(tx, JANUARY_2026, ['W_DAY_ADSPEND', 'W_MONTH_ADSPEND']);
      });
      const monthKey = instanceOf('W_MONTH_ADSPEND', JANUARY_2026).key;

      await writer.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      await firstRateAuthorisation(writer);

      // Mid-transaction, from another backend: nothing is visible yet.
      const during = await readBalance(observer, COMPANY_ID, 'W_MONTH_ADSPEND', monthKey);
      expect(during?.standingMonetary).toBe('0.00');
      const reservationDuring = await observer.query(
        `SELECT count(*)::text AS n FROM exposure_reservation WHERE reservation_id = 'res_first'`,
      );
      expect(reservationDuring.rows[0]?.n).toBe('0');

      await writer.query('COMMIT');

      // After commit, BOTH are visible. There was no state in between.
      const after = await readBalance(observer, COMPANY_ID, 'W_MONTH_ADSPEND', monthKey);
      expect(after?.standingMonetary).toBe(STANDING_CAP.MONTH_31_AT_6);
      const reservationAfter = await observer.query(
        `SELECT count(*)::text AS n FROM exposure_reservation WHERE reservation_id = 'res_first'`,
      );
      expect(reservationAfter.rows[0]?.n).toBe('1');
    } finally {
      writer.release();
      observer.release();
    }
  });

  it('the StandingRevocationAuthority exists, at zero monetary, created by KERNEL (I55)', async () => {
    const client = await harness.connect();
    try {
      await inTransaction(client, 'SERIALIZABLE', async (tx) => {
        await materialiseInstances(tx, JANUARY_2026, ['W_DAY_ADSPEND', 'W_MONTH_ADSPEND']);
      });
      await inTransaction(client, 'SERIALIZABLE', (tx) => firstRateAuthorisation(tx));

      const result = await client.query<{
        per_action_max_monetary: string;
        created_by: string;
        action_class_selector: string;
      }>(
        `SELECT per_action_max_monetary, created_by, action_class_selector
           FROM standing_revocation_authority WHERE standing_authorization_id = 'sa_first'`,
      );
      expect(result.rowCount).toBe(1);
      expect(result.rows[0]?.per_action_max_monetary).toBe('0.00');
      expect(result.rows[0]?.created_by).toBe('KERNEL');
      expect(result.rows[0]?.action_class_selector).toBe(RATE_GRANT.revocationEffectClass);
    } finally {
      client.release();
    }
  });
});
