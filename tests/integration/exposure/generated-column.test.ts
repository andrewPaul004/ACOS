import { afterAll, beforeEach, beforeAll, describe, expect, it } from 'vitest';

import { inTransaction, type Client } from '../../../src/db/pool.js';
import {
  COMPANY_ID,
  createHarness,
  instanceOf,
  materialiseInstances,
  type Harness,
} from '../../support/fixture.js';
import { forwardSumCollapsedAndWrong, forwardSumConservative } from '../../support/oracle.js';

/**
 * S1A-2 — `standing_window_exposure.forward_monetary`.
 *
 * `24 §3` K5, verbatim:
 *
 *   "forward_monetary is a generated column over (standing_cap_monetary,
 *    realised_monetary). It is not independently writable, by anyone, including the
 *    control plane. Only one primitive changes."
 *
 *   "Why forward is generated per authorisation and summed, rather than generated on the
 *    aggregate. max(0, ·) does not distribute over sums: max(0, Σcap − Σrealised) is
 *    smaller than Σ max(0, cap_i − realised_i) whenever one authorisation has overrun, so
 *    an aggregate generated column would silently under-reserve. Generating at the level
 *    where the identity is valid and aggregating by trigger keeps the conservative form."
 *
 * VC-S8's first clause: "Assert standing_window_exposure.forward_monetary is a generated
 * column and that a direct write to it fails."
 */

const AT = new Date('2026-01-15T12:00:00Z');
const WINDOW = 'W_MONTH_ADSPEND';

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
      await seedAuthorization(tx, 'sa_a');
      await seedAuthorization(tx, 'sa_b');
    });
  } finally {
    client.release();
  }
});

afterAll(async () => {
  await harness?.close();
});

async function seedAuthorization(client: Client, id: string): Promise<void> {
  await client.query(
    `INSERT INTO standing_revocation_authority (
       revocation_authority_id, company_id, standing_authorization_id,
       action_class_selector, resource_selector, per_action_max_monetary,
       expires_at, created_by)
     VALUES ($1, $2, $3, 'campaign.pause', 'campaign/1', 0.00,
             '2026-02-03T00:00:00Z', 'KERNEL')`,
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
}

async function seedExposure(
  client: Client,
  id: string,
  cap: string,
  realised: string,
): Promise<void> {
  await client.query(
    `INSERT INTO standing_window_exposure (
       standing_authorization_id, window_id, window_instance_key, company_id,
       standing_cap_monetary, realised_monetary, instance_in_scope)
     VALUES ($1, $2, $3, $4, $5::NUMERIC, $6::NUMERIC, true)`,
    [id, WINDOW, key, COMPANY_ID, cap, realised],
  );
}

async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = await harness.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

describe('forward_monetary is a generated column', () => {
  it('the catalogue reports GENERATED ALWAYS with the K5 expression', async () => {
    await withClient(async (client) => {
      const result = await client.query<{
        is_generated: string;
        generation_expression: string;
      }>(
        `SELECT is_generated, generation_expression
           FROM information_schema.columns
          WHERE table_name = 'standing_window_exposure' AND column_name = 'forward_monetary'`,
      );
      expect(result.rows[0]?.is_generated).toBe('ALWAYS');
      const expression = result.rows[0]?.generation_expression ?? '';
      expect(expression).toContain('GREATEST');
      expect(expression).toContain('standing_cap_monetary');
      expect(expression).toContain('realised_monetary');
    });
  });

  it('a direct INSERT naming forward_monetary FAILS', async () => {
    await withClient(async (client) => {
      await expect(
        client.query(
          `INSERT INTO standing_window_exposure (
             standing_authorization_id, window_id, window_instance_key, company_id,
             standing_cap_monetary, realised_monetary, forward_monetary, instance_in_scope)
           VALUES ('sa_a', $1, $2, $3, 186.00, 0.00, 999.00, true)`,
          [WINDOW, key, COMPANY_ID],
        ),
      ).rejects.toThrow(/cannot insert a non-DEFAULT value into column "forward_monetary"/i);
    });
  });

  it('a direct UPDATE of forward_monetary FAILS', async () => {
    await withClient(async (client) => {
      await inTransaction(client, 'SERIALIZABLE', (tx) => seedExposure(tx, 'sa_a', '186.00', '0.00'));
      await expect(
        client.query(
          `UPDATE standing_window_exposure SET forward_monetary = 0.00
            WHERE standing_authorization_id = 'sa_a'`,
        ),
      ).rejects.toThrow(/column "forward_monetary" can only be updated to DEFAULT/i);
    });
  });

  it('changing the cap primitive moves forward_monetary; nothing else can', async () => {
    await withClient(async (client) => {
      await inTransaction(client, 'SERIALIZABLE', (tx) => seedExposure(tx, 'sa_a', '186.00', '0.00'));
      const before = await client.query<{ forward_monetary: string }>(
        `SELECT forward_monetary FROM standing_window_exposure WHERE standing_authorization_id = 'sa_a'`,
      );
      expect(before.rows[0]?.forward_monetary).toBe('186.00');

      await client.query(
        `UPDATE standing_window_exposure SET realised_monetary = 18.00
          WHERE standing_authorization_id = 'sa_a'`,
      );
      const after = await client.query<{ forward_monetary: string }>(
        `SELECT forward_monetary FROM standing_window_exposure WHERE standing_authorization_id = 'sa_a'`,
      );
      // max(0, 186.00 − 18.00) = 168.00, by hand.
      expect(after.rows[0]?.forward_monetary).toBe('168.00');
    });
  });

  it('forward_monetary floors at zero when realised exceeds the cap', async () => {
    await withClient(async (client) => {
      await inTransaction(client, 'SERIALIZABLE', (tx) => seedExposure(tx, 'sa_a', '186.00', '200.00'));
      const result = await client.query<{ forward_monetary: string }>(
        `SELECT forward_monetary FROM standing_window_exposure WHERE standing_authorization_id = 'sa_a'`,
      );
      // GREATEST(0, 186.00 − 200.00) = 0.00
      expect(result.rows[0]?.forward_monetary).toBe('0.00');
    });
  });
});

describe('max(0, ·) does not distribute over sums — the transformation K5 rejects', () => {
  it('the two forms differ once one authorisation has overrun', async () => {
    // Hand-computed counterexample, in the oracle rather than in production code.
    //
    // The figures are chosen to be REACHABLE inside W_MONTH_ADSPEND's $186.00 ceiling,
    // because a fixture the commitment guard would have refused proves nothing about
    // what the guard permits. Two authorisations, caps $100.00 and $60.00, with the
    // first overdelivered to $120.00:
    //
    //   sa_a: cap 100.00, realised 120.00  →  max(0, −20.00) =   0.00
    //   sa_b: cap  60.00, realised   0.00  →  max(0,  60.00) =  60.00
    //   Σ max(0, cap − realised)                             =  60.00   ← conservative
    //   max(0, Σcap − Σrealised) = max(0, 160.00 − 120.00)   =  40.00   ← under-reserves
    const rows = [
      { cap: '100.00', realised: '120.00' },
      { cap: '60.00', realised: '0.00' },
    ];
    expect(forwardSumConservative(rows)).toBe('60.00');
    expect(forwardSumCollapsedAndWrong(rows)).toBe('40.00');
    expect(forwardSumConservative(rows)).not.toBe(forwardSumCollapsedAndWrong(rows));
  });

  it('the DATABASE produces the conservative form, not the collapsed one', async () => {
    await withClient(async (client) => {
      // Both authorisations are committed FIRST, at zero realised: standing = $160.00,
      // four-term sum $160.00 ≤ $186.00, so the commitment guard permits both.
      await inTransaction(client, 'SERIALIZABLE', async (tx) => {
        await seedExposure(tx, 'sa_a', '100.00', '0.00');
        await seedExposure(tx, 'sa_b', '60.00', '0.00');
      });

      // The overrun then arrives the way an overrun actually arrives — as realised spend
      // through the reconciler's single statement, which the guard never refuses.
      await inTransaction(client, 'SERIALIZABLE', async (tx) => {
        await tx.query(
          `UPDATE standing_window_exposure SET realised_monetary = realised_monetary + 120.00
            WHERE standing_authorization_id = 'sa_a' AND window_instance_key = $1`,
          [key],
        );
      });

      const rows = await client.query<{ standing_cap_monetary: string; realised_monetary: string }>(
        `SELECT standing_cap_monetary, realised_monetary
           FROM standing_window_exposure
          WHERE window_instance_key = $1 ORDER BY standing_authorization_id`,
        [key],
      );
      const oracleRows = rows.rows.map((r) => ({
        cap: r.standing_cap_monetary,
        realised: r.realised_monetary,
      }));
      expect(oracleRows).toEqual([
        { cap: '100.00', realised: '120.00' },
        { cap: '60.00', realised: '0.00' },
      ]);

      const balance = await client.query<{
        standing_monetary: string;
        realised_monetary: string;
      }>(
        `SELECT standing_monetary, realised_monetary FROM window_balance
          WHERE company_id = $1 AND window_id = $2 AND window_instance_key = $3`,
        [COMPANY_ID, WINDOW, key],
      );

      // The trigger-maintained aggregate equals the CONSERVATIVE hand-computed form.
      expect(balance.rows[0]?.standing_monetary).toBe(forwardSumConservative(oracleRows));
      expect(balance.rows[0]?.standing_monetary).toBe('60.00');
      // And is strictly greater than the form the architecture rejects. Had the schema
      // generated forward on the aggregate, the window would carry $40.00 of standing
      // exposure here and would have silently under-reserved by $20.00.
      expect(forwardSumCollapsedAndWrong(oracleRows)).toBe('40.00');
      expect(balance.rows[0]?.standing_monetary).not.toBe(
        forwardSumCollapsedAndWrong(oracleRows),
      );

      // Realised moved with it, in the same statement.
      expect(balance.rows[0]?.realised_monetary).toBe('120.00');
    });
  });
});
