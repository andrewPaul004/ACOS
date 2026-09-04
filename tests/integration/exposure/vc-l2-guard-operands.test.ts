import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createHarness, type Harness } from '../../support/fixture.js';
import type { Client } from '../../../src/db/pool.js';

/**
 * VC-L2 — the guard's operand set is exactly I3's four terms.
 *
 * `36 §2` VC-L2, verbatim:
 *
 *   "assert the guard's operand set is exactly I3's four terms per ledger: reserved +
 *    standing + presumed + realised (v1.3, TB-01). A guard omitting the standing term
 *    must fail this case."
 *
 * Registry §1.2 I3, operand row, verbatim:
 *
 *   "The printed guard in 24 §3 K5 contains exactly these four operands per ledger and
 *    nothing else; rule 9 compares them mechanically."
 *
 * "Mechanically" is taken literally here. The trigger function's body is read back out
 * of `pg_proc.prosrc` — the source PostgreSQL actually compiled — and the summed
 * expression is extracted and compared operand by operand. Reading the .sql file
 * instead would prove only what was written, not what is installed.
 *
 * `phase2-v1.3-implementation-brief.md §7` condition 1 names "dropping the standing term
 * from I3" as a PASS-revocation trigger. This test is that condition's detector.
 */

let harness: Harness;
let client: Client;
let source: string;

beforeAll(async () => {
  harness = await createHarness();
  await harness.reset();
  client = await harness.connect();
  const result = await client.query<{ prosrc: string }>(
    `SELECT prosrc FROM pg_proc WHERE proname = 'i3_commitment_guard'`,
  );
  expect(result.rowCount, 'i3_commitment_guard is not installed').toBe(1);
  source = result.rows[0]!.prosrc;
});

afterAll(async () => {
  client?.release();
  await harness?.close();
});

/**
 * Extract the operands of a guard's summed expression.
 *
 * The guard's shape, per `24 §3` K5, is
 *
 *   AND (NEW.a + NEW.b + NEW.c + NEW.d) > NEW.max_<ledger>
 *
 * so the sum is the parenthesised group immediately preceding `> NEW.max_<ledger>`.
 * Every `NEW.x` inside that group is an operand of the bound.
 */
function summedOperands(prosrc: string, ceilingColumn: string): string[] {
  const anchor = prosrc.indexOf(`> NEW.${ceilingColumn}`);
  expect(anchor, `no comparison against NEW.${ceilingColumn} in the guard`).toBeGreaterThan(-1);

  // Walk backwards from the anchor to the matching opening parenthesis.
  const index = prosrc.lastIndexOf(')', anchor);
  expect(index, 'malformed guard: no closing parenthesis before the comparison').toBeGreaterThan(-1);
  let depth = 0;
  let start = -1;
  for (let i = index; i >= 0; i -= 1) {
    const ch = prosrc[i];
    if (ch === ')') depth += 1;
    else if (ch === '(') {
      depth -= 1;
      if (depth === 0) {
        start = i;
        break;
      }
    }
  }
  expect(start, 'malformed guard: unbalanced parentheses').toBeGreaterThan(-1);

  const group = prosrc.slice(start + 1, index);
  const operands = [...group.matchAll(/NEW\.([a-z_]+)/g)].map((m) => m[1]!);
  return operands;
}

describe('VC-L2 — the commitment guard carries exactly I3s four terms', () => {
  it('the monetary guard sums reserved + standing + presumed + realised, and nothing else', () => {
    const operands = summedOperands(source, 'max_monetary');
    expect(operands).toEqual([
      'reserved_monetary',
      'standing_monetary',
      'presumed_monetary',
      'realised_monetary',
    ]);
    // Stated separately so a failure names the missing term rather than a whole array.
    expect(operands, 'TB-01: the STANDING term must be in the bound').toContain(
      'standing_monetary',
    );
    expect(operands).toHaveLength(4);
  });

  it('the count guard sums reserved + standing + presumed + realised, and nothing else', () => {
    const operands = summedOperands(source, 'max_count');
    expect(operands).toEqual([
      'reserved_count',
      'standing_count',
      'presumed_count',
      'realised_count',
    ]);
  });

  it('the irrecoverable guard sums the three terms K5 declares — there is no standing column', () => {
    // `24 §3` K5's printed window_balance schema declares reserved_irrecoverable,
    // presumed_irrecoverable and realised_irrecoverable and NO standing_irrecoverable.
    // The three-operand guard is therefore the printed schema's own shape, not a term
    // dropped from I3: I3's standing term is materialised from
    // standing_window_exposure.forward_monetary, which is monetary.
    // Recorded in docs/implementation/S1A-implementation-log.md §3.
    const operands = summedOperands(source, 'max_irrecoverable_units');
    expect(operands).toEqual([
      'reserved_irrecoverable',
      'presumed_irrecoverable',
      'realised_irrecoverable',
    ]);
    expect(operands).not.toContain('standing_irrecoverable');
  });

  it('the commitment predicate names the three COMMITMENT terms and never realised', () => {
    // `24 §3` K5's IF: the guard fires only when a commitment term increases. If
    // realised appeared in the predicate, a vendor observation above the ceiling would
    // be refused and the financial-truth path would be blocked — which is TB-04's
    // defect and `phase2-v1.3-implementation-brief.md §7` condition 8's shape.
    const predicate = source.slice(
      source.indexOf('IF (NEW.reserved_monetary'),
      source.indexOf('> NEW.max_monetary'),
    );
    const increaseComparisons = [...predicate.matchAll(/NEW\.([a-z_]+)\s+>\s+OLD\.\1/g)].map(
      (m) => m[1]!,
    );
    expect(increaseComparisons).toEqual([
      'reserved_monetary',
      'standing_monetary',
      'presumed_monetary',
    ]);
    expect(increaseComparisons).not.toContain('realised_monetary');
  });

  it('the guard is a BEFORE UPDATE row trigger on window_balance, as K5 declares', async () => {
    const result = await client.query<{
      action_timing: string;
      event_manipulation: string;
      action_orientation: string;
      event_object_table: string;
    }>(
      `SELECT action_timing, event_manipulation, action_orientation, event_object_table
         FROM information_schema.triggers
        WHERE trigger_name = 'i3_commitment_guard'`,
    );
    expect(result.rowCount).toBe(1);
    expect(result.rows[0]?.action_timing).toBe('BEFORE');
    expect(result.rows[0]?.event_manipulation).toBe('UPDATE');
    expect(result.rows[0]?.action_orientation).toBe('ROW');
    expect(result.rows[0]?.event_object_table).toBe('window_balance');
  });
});
