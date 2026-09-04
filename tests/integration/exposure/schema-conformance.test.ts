import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createHarness, type Harness } from '../../support/fixture.js';
import type { Client } from '../../../src/db/pool.js';

/**
 * The installed schema conforms to `24 §3` K5, which the package declares to be "the
 * single authoritative schema specification for window_balance and for the standing
 * exposure it aggregates. No other artifact declares either."
 *
 * Everything asserted here is read out of the RUNNING DATABASE through
 * information_schema and the catalogues — not out of the migration files. A test that
 * parsed the .sql would pass whether or not the migration was ever applied.
 */

let harness: Harness;
let client: Client;

beforeAll(async () => {
  harness = await createHarness();
  await harness.reset();
  client = await harness.connect();
});

afterAll(async () => {
  client?.release();
  await harness?.close();
});

async function columnsOf(table: string): Promise<Map<string, { type: string; nullable: boolean }>> {
  const result = await client.query<{
    column_name: string;
    data_type: string;
    is_nullable: string;
  }>(
    `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1`,
    [table],
  );
  return new Map(
    result.rows.map((r) => [
      r.column_name,
      { type: r.data_type, nullable: r.is_nullable === 'YES' },
    ]),
  );
}

async function primaryKeyOf(table: string): Promise<string[]> {
  const result = await client.query<{ attname: string; ord: number }>(
    `SELECT a.attname, k.ord
       FROM pg_constraint c
       JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
      WHERE c.conrelid = $1::regclass AND c.contype = 'p'
      ORDER BY k.ord`,
    [table],
  );
  return result.rows.map((r) => r.attname);
}

describe('window_balance conforms to 24 §3 K5', () => {
  it('is keyed (company_id, window_id, window_instance_key) — TB-02 puts the instance in the key', async () => {
    expect(await primaryKeyOf('window_balance')).toEqual([
      'company_id',
      'window_id',
      'window_instance_key',
    ]);
  });

  it('declares the four monetary terms K5 prints', async () => {
    const columns = await columnsOf('window_balance');
    for (const name of [
      'reserved_monetary',
      'standing_monetary',
      'presumed_monetary',
      'realised_monetary',
    ]) {
      const column = columns.get(name);
      expect(column, `window_balance.${name} is missing`).toBeDefined();
      expect(column?.type).toBe('numeric');
      expect(column?.nullable, `${name} must be NOT NULL`).toBe(false);
    }
  });

  it('declares the four count terms K5 prints', async () => {
    const columns = await columnsOf('window_balance');
    for (const name of [
      'reserved_count',
      'standing_count',
      'presumed_count',
      'realised_count',
    ]) {
      expect(columns.get(name), `window_balance.${name} is missing`).toBeDefined();
    }
  });

  it('declares the three irrecoverable terms, and NO standing_irrecoverable', async () => {
    // K5's printed schema has no standing_irrecoverable column. Asserting its ABSENCE
    // is deliberate: if a later increment adds one, this test fails and forces the
    // change to be reconciled against the printed schema rather than drifting into it.
    const columns = await columnsOf('window_balance');
    expect(columns.get('reserved_irrecoverable')).toBeDefined();
    expect(columns.get('presumed_irrecoverable')).toBeDefined();
    expect(columns.get('realised_irrecoverable')).toBeDefined();
    expect(columns.get('standing_irrecoverable')).toBeUndefined();
  });

  it('carries the per-ledger non-negativity CHECK K5 prints', async () => {
    const result = await client.query<{ conname: string; def: string }>(
      `SELECT conname, pg_get_constraintdef(oid) AS def
         FROM pg_constraint
        WHERE conrelid = 'window_balance'::regclass AND contype = 'c'`,
    );
    const monetary = result.rows.find((r) => r.conname === 'window_balance_monetary_non_negative');
    expect(monetary, 'the monetary non-negativity CHECK is missing').toBeDefined();
    for (const term of ['reserved_monetary', 'standing_monetary', 'presumed_monetary', 'realised_monetary']) {
      expect(monetary?.def).toContain(term);
    }
  });

  it('carries no nullable money ceiling — 26 §10.1 makes null a schema violation', async () => {
    const columns = await columnsOf('window_balance');
    expect(columns.get('max_monetary')?.nullable).toBe(false);
    expect(columns.get('max_count')?.nullable).toBe(false);
    expect(columns.get('max_irrecoverable_units')?.nullable).toBe(false);
  });
});

describe('standing_window_exposure conforms to 24 §3 K5', () => {
  it('is keyed (standing_authorization_id, window_id, window_instance_key)', async () => {
    expect(await primaryKeyOf('standing_window_exposure')).toEqual([
      'standing_authorization_id',
      'window_id',
      'window_instance_key',
    ]);
  });

  it('declares the two authoritative primitives and instance_in_scope', async () => {
    const columns = await columnsOf('standing_window_exposure');
    expect(columns.get('standing_cap_monetary')?.nullable).toBe(false);
    expect(columns.get('realised_monetary')?.nullable).toBe(false);
    expect(columns.get('instance_in_scope')?.nullable).toBe(false);
  });
});

describe('51 §2.1 — ROLLING is NOT_ADMISSIBLE_AT_MVP (VC-S1)', () => {
  it('the window registry refuses a ROLLING window', async () => {
    await expect(
      client.query(
        `INSERT INTO window_registry (
           company_id, window_id, name, boundary_kind, period,
           max_monetary, max_monetary_unbounded, max_count, max_count_unbounded,
           max_irrecoverable_units, max_irrecoverable_unbounded)
         VALUES ('co_s1a_fixture', 'W_ROLLING_PROBE', 'probe', 'ROLLING', 'DAY',
                 1.00, false, 1, false, 0, true)`,
      ),
    ).rejects.toThrow(/window_rolling_not_admissible_at_mvp/);
  });

  it('every fixture window is DISCRETE', async () => {
    const result = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM window_registry WHERE boundary_kind <> 'DISCRETE'`,
    );
    expect(result.rows[0]?.n).toBe('0');
  });
});
