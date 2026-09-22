import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { inTransaction, type Client } from '../../../src/db/pool.js';
import { SQLSTATE, hasSqlstate } from '../../../src/kernel/exposure/errors.js';
import {
  COMPANY_ID,
  createHarness,
  instanceOf,
  materialiseInstances,
  type Harness,
} from '../../support/fixture.js';

/**
 * S1A-H3 — the irrecoverable-units ledger's standing term is EXPLICITLY ZERO.
 *
 * An owner clarification, recorded in `docs/implementation/S1A-owner-clarifications.md`.
 * This file is its executable half.
 *
 * THE TEXTUAL MISMATCH, stated plainly rather than explained away. Registry `I3`
 * describes FOUR conceptual terms for each ledger. `24 §3` K5's single authoritative
 * `window_balance` schema declares, for the irrecoverable ledger, exactly:
 *
 *   reserved_irrecoverable, presumed_irrecoverable, realised_irrecoverable
 *
 * and deliberately declares no `standing_irrecoverable`. `standing_window_exposure`,
 * which is where `I3`'s standing term is materialised from, carries only MONETARY forward
 * exposure: `standing_cap_monetary`, `realised_monetary`, and the generated
 * `forward_monetary`.
 *
 * THE OWNER CLARIFICATION FOR S1: for the irrecoverable-units ledger, the conceptual
 * standing term is DEFINITIONALLY `0` under the current `StandingAuthorization` model.
 * The implemented guard therefore has three STORED non-zero operands plus an IMPLICIT
 * ZERO standing term, and `3 stored + 0 = I3`'s four conceptual terms.
 *
 * WHAT THIS FILE IS FOR. `standing_irrecoverable` is not added, and the guard's
 * arithmetic is not changed. What is added is the assertion that makes the implicit-zero
 * reading EXPLICIT and MECHANICAL, so that a future `StandingAuthorization` type which
 * introduces irrecoverable-unit forward exposure cannot silently reuse this schema. Such
 * a type would have nowhere to store that exposure and no operand to enter the bound
 * through; it would require an ARCHITECTURE change, and these assertions are what force
 * that conversation instead of allowing a drift.
 */

const AT = new Date('2026-04-05T12:00:00Z');
const WINDOW = 'W_DAY_MIE'; // `51 §2`: max_irrecoverable_units = 13, BOUNDED.
const CEILING = 13;

let harness: Harness;
let client: Client;

beforeAll(async () => {
  harness = await createHarness();
  await harness.reset();
  client = await harness.connect();
  await inTransaction(client, 'SERIALIZABLE', async (tx) => {
    await materialiseInstances(tx, AT, [WINDOW]);
  });
});

afterAll(async () => {
  client?.release();
  await harness?.close();
});

const key = (): string => instanceOf(WINDOW, AT).key;

async function irrecoverableColumns(): Promise<string[]> {
  const result = await client.query<{ pair: string }>(
    `SELECT table_name || '.' || column_name AS pair
       FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name LIKE '%irrecoverable%'
      ORDER BY pair`,
  );
  return result.rows.map((r) => r.pair);
}

describe('S1A-H3 — there is no place in the schema for an irrecoverable standing term', () => {
  it('window_balance declares three irrecoverable ledger terms and NO standing one', async () => {
    const result = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'window_balance'
          AND column_name IN ('reserved_irrecoverable', 'standing_irrecoverable',
                              'presumed_irrecoverable', 'realised_irrecoverable')
        ORDER BY column_name`,
    );
    expect(result.rows.map((r) => r.column_name)).toEqual([
      'presumed_irrecoverable',
      'realised_irrecoverable',
      'reserved_irrecoverable',
    ]);
  });

  it('standing_window_exposure carries ONLY monetary forward exposure', async () => {
    // This is the load-bearing assertion for the clarification. `I3`'s standing term is
    // materialised from this table. If it carries no irrecoverable quantity, then the
    // irrecoverable ledger's standing term has nothing to be but zero.
    const result = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'standing_window_exposure'
        ORDER BY column_name`,
    );
    const columns = result.rows.map((r) => r.column_name);
    expect(columns).toEqual([
      'company_id',
      'forward_monetary',
      'instance_in_scope',
      'realised_monetary',
      'standing_authorization_id',
      'standing_cap_monetary',
      'window_id',
      'window_instance_key',
    ]);
    // Named separately so a failure says WHICH kind of exposure appeared.
    expect(
      columns.filter((c) => c.includes('irrecoverable')),
      'standing_window_exposure has acquired an irrecoverable quantity. The implicit-zero ' +
        'standing term in the irrecoverable guard is no longer valid and this is an ' +
        'ARCHITECTURE change, not an implementation one. See S1A-owner-clarifications.md.',
    ).toEqual([]);
    expect(
      columns.filter((c) => c.includes('count')),
      'standing_window_exposure has acquired a count quantity; the count ledger has its ' +
        'own declared standing_count column and this table is not it.',
    ).toEqual([]);
  });

  it('EVERY irrecoverable column in the schema is one K5 or `25 §10.1` declares', async () => {
    /*
     * =============================================================================
     * THE EXACT-SET ASSERTION IS THE POINT, AND IT IS WIDENED BY EXACTLY THREE.
     *
     * A future `StandingAuthorization` type introducing irrecoverable-unit forward exposure
     * would have to add a column, and this assertion is what makes that impossible to do
     * quietly. **The property it protects — S1A-H3, that there is no place in the schema for
     * an irrecoverable STANDING term — is untouched**, and the case above still asserts it
     * directly against `standing_window_exposure`.
     *
     * What v1.3.5 added is the RESERVATION EVIDENCE and the view over it. `25 §10.1` rebases
     * `I20` on "the immutable historical authorisation basis [...] **and not** the current
     * value of `reserved_irrecoverable`", and the reason is mechanical: PRESUME and REALISE
     * move units OUT of that column while leaving the commitment unchanged, so a bound
     * written against the live column inverts the invariant's own direction.
     *
     * So the basis has to live somewhere immutable, and `0013` puts it on the row `0004`
     * already created for exactly this purpose — one row per (reservation, window instance),
     * written inside step R's transaction. **None of the three is a ledger term**, and none
     * of them is a standing one.
     * =============================================================================
     */
    expect(await irrecoverableColumns()).toEqual([
      // `25 §10.1`'s `I20` denominator, read from committed immutable rows only.
      'i20_authorised_irrecoverable_units.authorised_irrecoverable_units',
      'i20_authorised_irrecoverable_units.released_irrecoverable_units',
      // The immutable evidence the view sums. Append-only against `UPDATE` (`0013`).
      'reservation_window_instance.irrecoverable_units',
      // `24 §3` K5's seven, unchanged.
      'window_balance.max_irrecoverable_unbounded',
      'window_balance.max_irrecoverable_units',
      'window_balance.presumed_irrecoverable',
      'window_balance.realised_irrecoverable',
      'window_balance.reserved_irrecoverable',
      'window_registry.max_irrecoverable_unbounded',
      'window_registry.max_irrecoverable_units',
    ]);

    // AND NOT ONE OF THEM IS A STANDING TERM. S1A-H3's property, restated over the whole
    // schema rather than over one table, so a `standing_irrecoverable` ANYWHERE fails here
    // as well as in the case above.
    for (const column of await irrecoverableColumns()) {
      expect(column, 'an irrecoverable standing term appeared').not.toContain('standing');
    }
  });
});

describe('S1A-H3 — the implicit zero is OBSERVABLE in the guard arithmetic', () => {
  it('the three stored terms may consume the WHOLE ceiling — which is what standing = 0 means', async () => {
    // 5 + 4 + 4 = 13 = the ceiling. It is admitted exactly.
    //
    // This is the behavioural content of the clarification. If the conceptual standing
    // term were anything other than zero, the three stored terms could NOT reach the
    // ceiling on their own: the fourth operand would consume part of it. That they can is
    // the implicit zero, measured rather than asserted in prose.
    //
    // realised is set first because `24 §3` K5's guard predicate fires only when a
    // COMMITMENT term increases — a financial-truth write is never refused.
    await client.query(
      `UPDATE window_balance SET realised_irrecoverable = 4
        WHERE company_id = $1 AND window_id = $2 AND window_instance_key = $3`,
      [COMPANY_ID, WINDOW, key()],
    );
    await client.query(
      `UPDATE window_balance
          SET reserved_irrecoverable = 5, presumed_irrecoverable = 4
        WHERE company_id = $1 AND window_id = $2 AND window_instance_key = $3`,
      [COMPANY_ID, WINDOW, key()],
    );

    const after = await client.query<{
      reserved_irrecoverable: string;
      presumed_irrecoverable: string;
      realised_irrecoverable: string;
      max_irrecoverable_units: string;
    }>(
      `SELECT reserved_irrecoverable, presumed_irrecoverable,
              realised_irrecoverable, max_irrecoverable_units
         FROM window_balance
        WHERE company_id = $1 AND window_id = $2 AND window_instance_key = $3`,
      [COMPANY_ID, WINDOW, key()],
    );
    const row = after.rows[0]!;
    const sum =
      Number(row.reserved_irrecoverable) +
      Number(row.presumed_irrecoverable) +
      Number(row.realised_irrecoverable);
    expect(Number(row.max_irrecoverable_units)).toBe(CEILING);
    expect(sum, 'three stored terms plus an implicit zero standing term').toBe(CEILING);
  });

  it('one unit above the ceiling is still refused at the database', async () => {
    // The bound is real. The implicit zero widens what the three stored terms may hold;
    // it does not weaken the ceiling.
    let caught: unknown = null;
    try {
      await client.query(
        `UPDATE window_balance SET reserved_irrecoverable = reserved_irrecoverable + 1
          WHERE company_id = $1 AND window_id = $2 AND window_instance_key = $3`,
        [COMPANY_ID, WINDOW, key()],
      );
    } catch (error) {
      caught = error;
    }
    expect(
      hasSqlstate(caught, SQLSTATE.I3_WINDOW_EXHAUSTED),
      `expected ACS03 from the commitment guard, got: ${String(caught)}`,
    ).toBe(true);
  });
});
