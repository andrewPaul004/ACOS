import { afterAll, beforeEach, beforeAll, describe, expect, it } from 'vitest';

import { inTransaction, type Client } from '../../../src/db/pool.js';
import { SQLSTATE, hasSqlstate } from '../../../src/kernel/exposure/errors.js';
import {
  COMPANY_ID,
  createHarness,
  instanceOf,
  materialiseInstances,
  type Harness,
} from '../../support/fixture.js';
import {
  CEILING,
  fourTermSum,
  minusOneCent,
  plusOneCent,
  withinCeiling,
} from '../../support/oracle.js';

/**
 * S1A-8 — the four-term commitment guard, across the combinations the mandate lists.
 *
 * Enforcement under test: `24 §3` K5's BEFORE UPDATE trigger, quoted in
 * src/db/migrations/0002__window_balance.sql.
 *
 * EVERY case here writes to window_balance with RAW SQL, through `pg`, bypassing
 * src/kernel/exposure entirely. `36 §2` VC-L2: the guard must reject "at the database,
 * not in application code — assert by attempting the insert with the application check
 * disabled". There is no application check in this file to disable, which is the
 * strongest available form of that assertion.
 *
 * The window used is W_MONTH_REFUND at $250.00 (`51 §2`), because the refund window has
 * a bounded monetary ceiling AND a bounded count ceiling, so both ledgers are
 * exercisable on one row.
 */

const AT = new Date('2026-03-10T12:00:00Z');
const WINDOW = 'W_MONTH_REFUND';
const CEIL = CEILING.W_MONTH_REFUND_MONETARY; // '250.00'

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
    });
  } finally {
    client.release();
  }
});

afterAll(async () => {
  await harness?.close();
});

type Terms = Partial<{
  reserved: string;
  standing: string;
  presumed: string;
  realised: string;
}>;

/** Set the four monetary terms directly. Raw SQL; no kernel code involved. */
async function setTerms(client: Client, terms: Terms): Promise<void> {
  await client.query(
    `UPDATE window_balance
        SET reserved_monetary = COALESCE($4::NUMERIC, reserved_monetary),
            standing_monetary = COALESCE($5::NUMERIC, standing_monetary),
            presumed_monetary = COALESCE($6::NUMERIC, presumed_monetary),
            realised_monetary = COALESCE($7::NUMERIC, realised_monetary)
      WHERE company_id = $1 AND window_id = $2 AND window_instance_key = $3`,
    [
      COMPANY_ID,
      WINDOW,
      key,
      terms.reserved ?? null,
      terms.standing ?? null,
      terms.presumed ?? null,
      terms.realised ?? null,
    ],
  );
}

async function readTerms(client: Client): Promise<{
  reserved: string;
  standing: string;
  presumed: string;
  realised: string;
}> {
  const result = await client.query<{
    reserved_monetary: string;
    standing_monetary: string;
    presumed_monetary: string;
    realised_monetary: string;
  }>(
    `SELECT reserved_monetary, standing_monetary, presumed_monetary, realised_monetary
       FROM window_balance
      WHERE company_id = $1 AND window_id = $2 AND window_instance_key = $3`,
    [COMPANY_ID, WINDOW, key],
  );
  const row = result.rows[0]!;
  return {
    reserved: row.reserved_monetary,
    standing: row.standing_monetary,
    presumed: row.presumed_monetary,
    realised: row.realised_monetary,
  };
}

async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = await harness.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

async function expectGuardRefusal(fn: () => Promise<unknown>): Promise<void> {
  let caught: unknown = null;
  try {
    await fn();
  } catch (error) {
    caught = error;
  }
  expect(caught, 'the guard did not fire').not.toBeNull();
  expect(
    hasSqlstate(caught, SQLSTATE.I3_WINDOW_EXHAUSTED),
    `expected SQLSTATE ${SQLSTATE.I3_WINDOW_EXHAUSTED} (I3_WINDOW_EXHAUSTED), got ${String(caught)}`,
  ).toBe(true);
}

describe('S1A-8 — the four-term commitment guard', () => {
  it('1. ordinary reservation alone: permitted up to the ceiling', async () => {
    await withClient(async (client) => {
      await setTerms(client, { reserved: CEIL });
      const terms = await readTerms(client);
      expect(terms.reserved).toBe('250.00');
      expect(withinCeiling(fourTermSum(terms), CEIL)).toBe(true);
    });
  });

  it('2. standing exposure alone: permitted up to the ceiling', async () => {
    await withClient(async (client) => {
      await setTerms(client, { standing: CEIL });
      expect((await readTerms(client)).standing).toBe('250.00');
    });
  });

  it('3. PRESUMED_SETTLED alone: permitted up to the ceiling', async () => {
    await withClient(async (client) => {
      await setTerms(client, { presumed: CEIL });
      expect((await readTerms(client)).presumed).toBe('250.00');
    });
  });

  it('4. realised alone: permitted, and NOT gated by the commitment predicate', async () => {
    await withClient(async (client) => {
      await setTerms(client, { realised: CEIL });
      expect((await readTerms(client)).realised).toBe('250.00');
    });
  });

  it('5. all four together, summing exactly to the ceiling: permitted', async () => {
    await withClient(async (client) => {
      // 100.00 + 50.00 + 60.00 + 40.00 = 250.00, computed by hand.
      await setTerms(client, {
        reserved: '100.00',
        standing: '50.00',
        presumed: '60.00',
        realised: '40.00',
      });
      const terms = await readTerms(client);
      expect(fourTermSum(terms)).toBe('250.00');
      expect(withinCeiling(fourTermSum(terms), CEIL)).toBe(true);
    });
  });

  it('6. exact boundary: a commitment landing on the ceiling is permitted', async () => {
    await withClient(async (client) => {
      await setTerms(client, { reserved: '200.00', standing: '30.00', presumed: '20.00' });
      const terms = await readTerms(client);
      expect(fourTermSum(terms)).toBe(CEIL);
    });
  });

  it('7. one cent below the ceiling: permitted', async () => {
    await withClient(async (client) => {
      const target = minusOneCent(CEIL); // 249.99
      await setTerms(client, { reserved: target });
      expect((await readTerms(client)).reserved).toBe('249.99');
    });
  });

  it('8. one cent above the ceiling: REFUSED by the database', async () => {
    await withClient(async (client) => {
      const target = plusOneCent(CEIL); // 250.01
      await expectGuardRefusal(() => setTerms(client, { reserved: target }));
      // Nothing moved.
      expect((await readTerms(client)).reserved).toBe('0.00');
    });
  });

  it('8b. one cent above via the STANDING term alone: also refused (TB-01)', async () => {
    // The term v1.2's printed three-term CHECK could not see. A guard omitting it would
    // permit this write, which is what tests/negative-controls/three-term-guard proves.
    await withClient(async (client) => {
      await expectGuardRefusal(() => setTerms(client, { standing: plusOneCent(CEIL) }));
    });
  });

  it('8c. one cent above via the PRESUMED term alone: also refused', async () => {
    await withClient(async (client) => {
      await expectGuardRefusal(() => setTerms(client, { presumed: plusOneCent(CEIL) }));
    });
  });

  it('8d. the ceiling is breached only in SUM, not per term', async () => {
    // Each term alone is within the ceiling; together they exceed it by one cent.
    // A guard checking terms individually would permit this.
    await withClient(async (client) => {
      await setTerms(client, { reserved: '100.00', standing: '100.00', realised: '50.00' });
      expect(fourTermSum(await readTerms(client))).toBe('250.00');
      await expectGuardRefusal(() => setTerms(client, { presumed: '0.01' }));
    });
  });

  it('9. a realised vendor observation ABOVE the ceiling is RECORDED, not refused', async () => {
    // `24 §3` K5: "An update that increases only realised passes the guard
    // unconditionally, even where the resulting four-term sum exceeds max_monetary."
    await withClient(async (client) => {
      await setTerms(client, { reserved: '200.00' });
      await setTerms(client, { realised: '100.00' }); // sum = 300.00 > 250.00

      const terms = await readTerms(client);
      expect(terms.realised).toBe('100.00');
      expect(fourTermSum(terms)).toBe('300.00');
      expect(withinCeiling(fourTermSum(terms), CEIL)).toBe(false);

      // And it raises WINDOW_CEILING_BREACHED, on the FINANCIAL_TRUTH path — NOT I3's
      // security path. `24 §3` K5: "A vendor billing artefact is not evidence that the
      // control model was breached."
      const incidents = await client.query<{ incident_type: string; incident_path: string }>(
        `SELECT incident_type, incident_path FROM incident
          WHERE window_id = $1 AND window_instance_key = $2
          ORDER BY incident_id`,
        [WINDOW, key],
      );
      expect(incidents.rows.map((r) => r.incident_type)).toContain('WINDOW_CEILING_BREACHED');
      for (const row of incidents.rows) {
        expect(row.incident_path).toBe('FINANCIAL_TRUTH');
        expect(row.incident_path).not.toBe('SECURITY');
      }
    });
  });

  it('10. after a realised overage, the NEXT commitment is refused', async () => {
    // `24 §3` K5: "a realised increase shrinks the headroom available to the next
    // commitment, because the guard reads NEW.realised_monetary. No term was dropped
    // from the bound; what changed is which write the bound refuses."
    await withClient(async (client) => {
      await setTerms(client, { realised: '300.00' }); // already above the $250.00 ceiling
      expect((await readTerms(client)).realised).toBe('300.00');

      await expectGuardRefusal(() => setTerms(client, { reserved: '0.01' }));
      await expectGuardRefusal(() => setTerms(client, { standing: '0.01' }));
      await expectGuardRefusal(() => setTerms(client, { presumed: '0.01' }));

      // But financial truth remains writable, indefinitely.
      await setTerms(client, { realised: '350.00' });
      expect((await readTerms(client)).realised).toBe('350.00');
    });
  });

  it('the count ledger binds independently of the monetary ledger', async () => {
    // `51 §2`: W_MONTH_REFUND max_count = 10. `24 §3` K5's guard is "per ledger".
    await withClient(async (client) => {
      await client.query(
        `UPDATE window_balance SET reserved_count = 10
          WHERE company_id = $1 AND window_id = $2 AND window_instance_key = $3`,
        [COMPANY_ID, WINDOW, key],
      );
      await expectGuardRefusal(() =>
        client.query(
          `UPDATE window_balance SET reserved_count = 11
            WHERE company_id = $1 AND window_id = $2 AND window_instance_key = $3`,
          [COMPANY_ID, WINDOW, key],
        ),
      );
    });
  });

  it('an UNBOUNDED monetary ceiling admits any commitment — 26 §10.1 min(UNBOUNDED, x) = x', async () => {
    await withClient(async (client) => {
      await inTransaction(client, 'SERIALIZABLE', async (tx) => {
        await materialiseInstances(tx, AT, ['W_MONTH_MIE']);
      });
      const mieKey = instanceOf('W_MONTH_MIE', AT).key;
      await client.query(
        `UPDATE window_balance SET reserved_monetary = 999999.00
          WHERE company_id = $1 AND window_id = 'W_MONTH_MIE' AND window_instance_key = $2`,
        [COMPANY_ID, mieKey],
      );
      const result = await client.query<{ reserved_monetary: string }>(
        `SELECT reserved_monetary FROM window_balance
          WHERE company_id = $1 AND window_id = 'W_MONTH_MIE' AND window_instance_key = $2`,
        [COMPANY_ID, mieKey],
      );
      expect(result.rows[0]?.reserved_monetary).toBe('999999.00');
    });
  });

  it('a $0.00 ceiling admits no monetary exposure at all — 26 §10.1', async () => {
    // `51 §2`: "The two override windows exist at zero." `26 §10.1`: "0.00 means the
    // window admits no monetary exposure and every reservation against it denies."
    await withClient(async (client) => {
      await inTransaction(client, 'SERIALIZABLE', async (tx) => {
        await materialiseInstances(tx, AT, ['W_MONTH_REFUND_OVERRIDE']);
      });
      const overrideKey = instanceOf('W_MONTH_REFUND_OVERRIDE', AT).key;
      await expectGuardRefusal(() =>
        client.query(
          `UPDATE window_balance SET reserved_monetary = 0.01
            WHERE company_id = $1 AND window_id = 'W_MONTH_REFUND_OVERRIDE'
              AND window_instance_key = $2`,
          [COMPANY_ID, overrideKey],
        ),
      );
    });
  });
});
