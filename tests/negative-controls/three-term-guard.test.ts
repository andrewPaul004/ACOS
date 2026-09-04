import { afterAll, beforeEach, beforeAll, describe, expect, it } from 'vitest';

import type { Client } from '../../src/db/pool.js';
import { SQLSTATE, hasSqlstate } from '../../src/kernel/exposure/errors.js';
import { createHarness, type Harness } from '../support/fixture.js';
import { fourTermSum, withinCeiling } from '../support/oracle.js';

/**
 * NEGATIVE CONTROL — a guard omitting the standing term.
 *
 * `36 §2` VC-L2, verbatim: "assert the guard's operand set is exactly I3's four terms per
 * ledger: reserved + standing + presumed + realised (v1.3, TB-01). **A guard omitting the
 * standing term must fail this case.**"
 *
 * `24 §3` K5 describes the defect being controlled for: v1.2 "printed a three-term CHECK
 * over a row with no standing column, so the term Mechanism B exists to enforce was
 * enforced by nothing in the artifact declaring the enforcement (TB-01)."
 *
 * `phase2-v1.3-implementation-brief.md §7` condition 1 lists "dropping the standing term
 * from I3" among the prohibited repairs. This file demonstrates what dropping it costs,
 * so the four-term result in tests/integration/exposure/vc-l2-guard-operands.test.ts is
 * a measured property rather than an assumed one.
 *
 * TEST-ONLY. The three-term guard is installed on a table in its own schema. The
 * production trigger in `public` is untouched.
 */

const SCHEMA = 'unsafe_tb01';
const CEILING = '186.00';

let harness: Harness;
let client: Client;

beforeAll(async () => {
  harness = await createHarness();
  await harness.reset();
  client = await harness.connect();
});

beforeEach(async () => {
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await client.query(`CREATE SCHEMA ${SCHEMA}`);
  await client.query(`
    CREATE TABLE ${SCHEMA}.window_balance (
      company_id          TEXT NOT NULL,
      window_id           TEXT NOT NULL,
      window_instance_key TEXT NOT NULL,
      reserved_monetary   NUMERIC(18,2) NOT NULL DEFAULT 0,
      standing_monetary   NUMERIC(18,2) NOT NULL DEFAULT 0,
      presumed_monetary   NUMERIC(18,2) NOT NULL DEFAULT 0,
      realised_monetary   NUMERIC(18,2) NOT NULL DEFAULT 0,
      max_monetary        NUMERIC(18,2) NOT NULL,
      PRIMARY KEY (company_id, window_id, window_instance_key)
    )
  `);

  // v1.2's shape: the standing term is absent from the bound.
  await client.query(`
    CREATE FUNCTION ${SCHEMA}.three_term_guard() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF (NEW.reserved_monetary > OLD.reserved_monetary
       OR NEW.presumed_monetary > OLD.presumed_monetary)
         AND (NEW.reserved_monetary
            + NEW.presumed_monetary + NEW.realised_monetary) > NEW.max_monetary
      THEN
        RAISE EXCEPTION 'I3_WINDOW_EXHAUSTED' USING ERRCODE = 'ACS03';
      END IF;
      RETURN NEW;
    END;
    $$
  `);
  await client.query(`
    CREATE TRIGGER three_term_guard BEFORE UPDATE ON ${SCHEMA}.window_balance
      FOR EACH ROW EXECUTE FUNCTION ${SCHEMA}.three_term_guard()
  `);

  await client.query(
    `INSERT INTO ${SCHEMA}.window_balance
       (company_id, window_id, window_instance_key, standing_monetary, max_monetary)
     VALUES ('co', 'W_MONTH_ADSPEND', 'W_MONTH_ADSPEND:2026-01', 186.00, $1::NUMERIC)`,
    [CEILING],
  );
});

afterAll(async () => {
  if (client) {
    await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    client.release();
  }
  await harness?.close();
});

async function terms(): Promise<{
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
  }>(`SELECT reserved_monetary, standing_monetary, presumed_monetary, realised_monetary
        FROM ${SCHEMA}.window_balance`);
  const row = result.rows[0]!;
  return {
    reserved: row.reserved_monetary,
    standing: row.standing_monetary,
    presumed: row.presumed_monetary,
    realised: row.realised_monetary,
  };
}

describe('a guard omitting the standing term (TB-01)', () => {
  it('EXPECTED FAILURE: the window is fully committed to standing, yet admits more', async () => {
    // The window's entire $186.00 is already held as standing forward exposure — this is
    // exactly the state VC-S7 produces after the first campaign.budget.set. There is
    // zero headroom.
    const before = await terms();
    expect(before.standing).toBe('186.00');
    expect(fourTermSum(before)).toBe('186.00');
    expect(withinCeiling(fourTermSum(before), CEILING)).toBe(true);

    // A three-term guard cannot see the standing term, so it permits a commitment the
    // four-term guard refuses.
    await client.query(
      `UPDATE ${SCHEMA}.window_balance SET reserved_monetary = 186.00`,
    );

    const after = await terms();
    expect(after.reserved).toBe('186.00');
    // 186.00 + 186.00 = 372.00, exactly double the authorised ceiling.
    expect(fourTermSum(after)).toBe('372.00');
    expect(
      withinCeiling(fourTermSum(after), CEILING),
      'the three-term guard held the bound; the negative control proves nothing',
    ).toBe(false);

    console.log(
      [
        '',
        '  ─────────────────────────────────────────────────────────────',
        '  VC-L2 negative control (guard omitting the standing term)',
        '',
        '    four-term guard:          PASS  (refuses the over-commit)',
        '    three-term negative ctl:  EXPECTED FAILURE OBSERVED',
        '',
        `    committed ${after.reserved} against a window already holding`,
        `    ${after.standing} of standing exposure; sum ${fourTermSum(after)}`,
        `    against a ceiling of ${CEILING} — over by 186.00`,
        '  ─────────────────────────────────────────────────────────────',
        '',
      ].join('\n'),
    );
  });

  it('the PRODUCTION four-term guard refuses the identical write', async () => {
    // The discriminating half. Same state, same write, production trigger.
    await client.query(
      `INSERT INTO window_registry (
         company_id, window_id, name, boundary_kind, period,
         max_monetary, max_monetary_unbounded, max_count, max_count_unbounded,
         max_irrecoverable_units, max_irrecoverable_unbounded)
       VALUES ('co_s1a_fixture', 'W_TB01_PROBE', 'probe', 'DISCRETE', 'MONTH',
               $1::NUMERIC, false, 0, true, 0, true)`,
      [CEILING],
    );
    await client.query(
      `INSERT INTO window_balance (
         company_id, window_id, window_instance_key, standing_monetary,
         max_monetary, max_monetary_unbounded, max_count, max_count_unbounded,
         max_irrecoverable_units, max_irrecoverable_unbounded)
       VALUES ('co_s1a_fixture', 'W_TB01_PROBE', 'W_TB01_PROBE:2026-01', $1::NUMERIC,
               $1::NUMERIC, false, 0, true, 0, true)`,
      [CEILING],
    );

    let caught: unknown = null;
    try {
      await client.query(
        `UPDATE window_balance SET reserved_monetary = 186.00
          WHERE window_id = 'W_TB01_PROBE'`,
      );
    } catch (error) {
      caught = error;
    }
    expect(caught, 'the production guard permitted the over-commit').not.toBeNull();
    expect(hasSqlstate(caught, SQLSTATE.I3_WINDOW_EXHAUSTED)).toBe(true);

    const result = await client.query<{ reserved_monetary: string }>(
      `SELECT reserved_monetary FROM window_balance WHERE window_id = 'W_TB01_PROBE'`,
    );
    expect(result.rows[0]?.reserved_monetary).toBe('0.00');
  });
});
