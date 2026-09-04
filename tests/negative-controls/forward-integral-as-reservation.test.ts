import { afterAll, beforeEach, beforeAll, describe, expect, it } from 'vitest';

import { inTransaction, type Client } from '../../src/db/pool.js';
import { SQLSTATE, hasSqlstate } from '../../src/kernel/exposure/errors.js';
import { acquireMoneyPathLocks } from '../../src/kernel/exposure/lockOrder.js';
import {
  COMPANY_ID,
  createHarness,
  instanceOf,
  materialiseInstances,
  type Harness,
} from '../support/fixture.js';
import { CEILING, STANDING_CAP, fourTermSum, withinCeiling } from '../support/oracle.js';

/**
 * NEGATIVE CONTROL — `forward_integral` placed into the ordinary reservation amount.
 *
 * This is TB-03, and it is the defect v1.3.1 erratum 1 exists to keep out of the code.
 *
 * `26 §2.1.3`, verbatim: "Every literal reading double-counted, and the arithmetic denied
 * the first campaign.budget.set the company ever attempts — W_MONTH_ADSPEND.max_monetary
 * equals standing_cap exactly, so counting the same money in two of I3's four terms
 * exhausts the window before anything is authorised."
 *
 * `26 §7` step R's rate branch, as corrected: "forward_integral is never the ordinary
 * reservation amount."
 *
 * `phase2-v1.3.1-errata.md §1`'s consistency condition E1 states the rule over prose.
 * This file states it over BEHAVIOUR: it performs the double count and shows that the
 * first authorisation is denied — so VC-S7's PERMIT is a discriminating result, not one
 * that any implementation would have produced.
 *
 * TEST-ONLY. It writes to the production tables with raw SQL, exactly as a defective
 * step R would; `src/kernel/exposure/stepR.ts` is not called and not modified.
 */

const JANUARY = new Date('2026-01-01T09:00:00Z');
const MONTH_CEIL = CEILING.W_MONTH_ADSPEND_MONETARY; // '186.00'
const CAP = STANDING_CAP.MONTH_31_AT_6; // '186.00'

let harness: Harness;
let monthKey: string;

beforeAll(async () => {
  harness = await createHarness();
  monthKey = instanceOf('W_MONTH_ADSPEND', JANUARY).key;
});

beforeEach(async () => {
  await harness.reset();
  const client = await harness.connect();
  try {
    await inTransaction(client, 'SERIALIZABLE', async (tx) => {
      await materialiseInstances(tx, JANUARY, ['W_MONTH_ADSPEND']);
      await tx.query(
        `INSERT INTO standing_revocation_authority (
           revocation_authority_id, company_id, standing_authorization_id,
           action_class_selector, resource_selector, per_action_max_monetary,
           expires_at, created_by)
         VALUES ('sra_x', $1, 'sa_x', 'campaign.pause', 'campaign/1', 0.00,
                 '2026-02-03T00:00:00Z', 'KERNEL')`,
        [COMPANY_ID],
      );
      await tx.query(
        `INSERT INTO standing_authorization (
           standing_authorization_id, company_id, action_class, resource_ref, adapter,
           rate_amount, rate_currency, rate_period, created_at, expires_at,
           cessation_grace_hours, revocation_effect_class, revocation_authority_id, status)
         VALUES ('sa_x', $1, 'campaign.budget.set', 'campaign/1', 'google_ads',
                 6.00, 'USD', 'day', '2026-01-01T00:00:00Z', '2026-01-31T23:59:59Z',
                 72, 'campaign.pause', 'sra_x', 'LIVE')`,
        [COMPANY_ID],
      );
    });
  } finally {
    client.release();
  }
});

afterAll(async () => {
  await harness?.close();
});

/**
 * A DEFECTIVE step R: it puts the forward integral into BOTH terms — the ordinary
 * reservation (I3 term 1) and the standing exposure row (I3 term 2). This is the literal
 * reading `26 §7`'s uncorrected Step R row invited.
 */
async function defectiveStepR(tx: Client): Promise<void> {
  await acquireMoneyPathLocks(tx, {
    companyId: COMPANY_ID,
    windowInstances: [{ windowId: 'W_MONTH_ADSPEND', windowInstanceKey: monthKey }],
    includeStandingRows: true,
    includeJournalCounter: false,
  });

  // TERM 2 — the standing_window_exposure row. Correct on its own.
  await tx.query(
    `INSERT INTO standing_window_exposure (
       standing_authorization_id, window_id, window_instance_key, company_id,
       standing_cap_monetary, realised_monetary, instance_in_scope)
     VALUES ('sa_x', 'W_MONTH_ADSPEND', $1, $2, $3::NUMERIC, 0.00, true)`,
    [monthKey, COMPANY_ID, CAP],
  );

  // TERM 1 — THE DEFECT. The same money, reserved again as an ordinary amount.
  await tx.query(
    `UPDATE window_balance SET reserved_monetary = reserved_monetary + $3::NUMERIC
      WHERE company_id = $1 AND window_id = 'W_MONTH_ADSPEND' AND window_instance_key = $2`,
    [COMPANY_ID, monthKey, CAP],
  );
}

describe('placing forward_integral into the reservation amount (TB-03)', () => {
  it('EXPECTED FAILURE: the FIRST rate authorisation is DENIED', async () => {
    const client = await harness.connect();
    let caught: unknown = null;
    try {
      await inTransaction(client, 'SERIALIZABLE', defectiveStepR);
    } catch (error) {
      caught = error;
    } finally {
      client.release();
    }

    expect(
      caught,
      'the double count was PERMITTED; VC-S7 then proves nothing, because a defective ' +
        'implementation would also have passed it',
    ).not.toBeNull();
    expect(hasSqlstate(caught, SQLSTATE.I3_WINDOW_EXHAUSTED)).toBe(true);

    // The arithmetic of the denial, by hand:
    //   term 1 reserved 186.00 + term 2 standing 186.00 = 372.00 > 186.00
    const doubled = fourTermSum({
      reserved: CAP,
      standing: CAP,
      presumed: '0.00',
      realised: '0.00',
    });
    expect(doubled).toBe('372.00');
    expect(withinCeiling(doubled, MONTH_CEIL)).toBe(false);

    console.log(
      [
        '',
        '  ─────────────────────────────────────────────────────────────',
        '  VC-S7 negative control (TB-03: forward_integral double-counted)',
        '',
        '    corrected step R (rate branch):  PASS   — first authorisation PERMITS',
        '    double-counting negative ctl:    EXPECTED FAILURE OBSERVED',
        '',
        `    term 1 ${CAP} + term 2 ${CAP} = ${doubled} > ${MONTH_CEIL}`,
        '    DENY: WINDOW_EXHAUSTED on the first campaign.budget.set',
        '  ─────────────────────────────────────────────────────────────',
        '',
      ].join('\n'),
    );
  });

  it('nothing was committed by the denied transaction', async () => {
    const client = await harness.connect();
    try {
      await inTransaction(client, 'SERIALIZABLE', defectiveStepR).catch(() => undefined);
      const balance = await client.query<{
        reserved_monetary: string;
        standing_monetary: string;
      }>(
        `SELECT reserved_monetary, standing_monetary FROM window_balance
          WHERE company_id = $1 AND window_instance_key = $2`,
        [COMPANY_ID, monthKey],
      );
      expect(balance.rows[0]?.reserved_monetary).toBe('0.00');
      expect(balance.rows[0]?.standing_monetary).toBe('0.00');
    } finally {
      client.release();
    }
  });

  it('the schema itself refuses a rate-class row carrying a non-zero amount (E1)', async () => {
    // A structural backstop, independent of the guard: `26 §2.1.3`'s field table is a
    // CHECK constraint, so a rate-class reservation whose amount is the forward integral
    // cannot be persisted at all.
    const client = await harness.connect();
    try {
      let caught: unknown = null;
      try {
        await client.query(
          `INSERT INTO exposure_reservation (
             reservation_id, company_id, authorisation_id, action_class, resource_ref,
             amount, vendor_amount, forward_integral, is_rate_class, created_at)
           VALUES ('res_bad', $1, 'auth_bad', 'campaign.budget.set', 'campaign/1',
                   $2::NUMERIC, NULL, $2::NUMERIC, true, now())`,
          [COMPANY_ID, CAP],
        );
      } catch (error) {
        caught = error;
      }
      expect(caught, 'the schema accepted a rate-class row whose amount is the forward integral')
        .not.toBeNull();
      // Two CHECKs encode `26 §2.1.3`'s field table and either is a correct refusal:
      // `rate_class_zero_reservation` (amount must be 0.00 for a rate class) and
      // `e1_forward_integral_is_not_the_reservation` (E1, stated over data). Which one
      // PostgreSQL reports first is an evaluation-order detail, not a semantic one.
      const constraint =
        typeof caught === 'object' && caught !== null && 'constraint' in caught
          ? String((caught as { constraint: unknown }).constraint)
          : '';
      expect([
        'rate_class_zero_reservation',
        'e1_forward_integral_is_not_the_reservation',
      ]).toContain(constraint);
    } finally {
      client.release();
    }
  });
});
