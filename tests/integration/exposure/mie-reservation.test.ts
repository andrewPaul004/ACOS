import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { COMPANY_ID } from '../../support/fixture.js';
import {
  RESHIP_WINDOWS,
  authorisePause,
  authoriseReship,
  createOutboxHarness,
  type OutboxHarness,
} from '../../support/outboxFixture.js';
import { proposeAndAuthorise } from '../../support/localAuthorisationFixture.js';
import { S1E_PASS_ORDER } from '../../support/authorityFixture.js';
import { mieRows, unsafeAuthoriseWithoutReserving } from '../../negative-controls/unsafe-mie-movements.js';
import { actionCatalogue, irrecoverableUnitsFor } from '../../../src/kernel/canonicalisation/actionCatalogue.js';

/**
 * v1.3.6 (`50 §2a`, `50 §3f`): the catalogue is READ FROM THE ACTIVE VERIFIED BUNDLE.
 *
 * Before S1K this was a frozen literal imported from `actionCatalogue.ts`. `50 §3f`'s single
 * source of authority rule moved it into the signed class-3 artifact, so this binding now
 * resolves the same rows out of the bundle `tests/support/controlArtifactSetup.ts`
 * bootstrapped — which is what production reads.
 */
const ACTION_CATALOGUE = actionCatalogue().entries;


/**
 * `§4`, `§5`, `§6`, `§37` — STEP R RESERVES THE IRRECOVERABLE UNIT, AND `I20` CAN COUNT IT.
 *
 * =================================================================================
 * WHAT MIE-01 ADDED, AND WHY THE ACCEPTED SLICES HAD NOTHING TO TEST
 *
 * `phase2-v1.3.5-errata.md §1`: "**no artifact declared a reservation of an irrecoverable
 * unit at all**, so there was no unit to consume". `reserved_irrecoverable` had no
 * production writer; `stepR.reserveOrdinary` moved `reserved_monetary` and `reserved_count`
 * and nothing else.
 *
 * `25 §10.1` declares the RESERVE row and `51 §2.3` declares its quantity, and this suite is
 * both halves: the catalogue's declaration, checked against a HAND-AUTHORED transcription of
 * `51 §2.3`'s table, and step R's write, checked against direct SQL on both sides of an
 * authorisation.
 * =================================================================================
 *
 * =================================================================================
 * `§41` — THE EXPECTED VALUES ARE HAND-AUTHORED
 *
 * `SPEC_TABLE` below is transcribed from `51 §2.3` by hand and imports nothing. Reading the
 * expected unit count out of `ACTION_CATALOGUE` would be the catalogue agreeing with itself,
 * which `36 §0` names as the thing a cross-implementation check is not.
 * =================================================================================
 */

let h: OutboxHarness;

beforeAll(async () => {
  h = await createOutboxHarness();
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  await h.reset();
});

/**
 * `51 §2.3`'s table, HAND-TRANSCRIBED, restricted to the four classes `37 §2` S1 declares.
 *
 * The artifact's table has seven rows; three of them (`goodwill.credit.issue`,
 * `order.address.edit`, `email.send`) name classes that are not in this catalogue, and they
 * are listed in the comment rather than the map so the transcription is visibly complete:
 *
 *   goodwill.credit.issue  COMPENSABLE     0
 *   order.address.edit     IRRECOVERABLE   1
 *   email.send             IRRECOVERABLE   1
 */
const SPEC_TABLE: ReadonlyArray<readonly [string, string, bigint]> = [
  ['refund.create', 'COMPENSABLE', 0n],
  ['campaign.pause', 'REVERSIBLE', 0n],
  ['campaign.budget.set', 'COMPENSABLE', 0n],
  ['fulfilment.reship', 'IRRECOVERABLE', 1n],
];

async function mie(): Promise<ReturnType<typeof mieRows> extends Promise<infer T> ? T : never> {
  const rows = await mieRows(h.control, COMPANY_ID);
  return rows.filter((r) => RESHIP_WINDOWS.includes(r.windowId)) as never;
}

interface I20Row {
  readonly windowId: string;
  readonly windowInstanceKey: string;
  readonly authorisedIrrecoverableUnits: string;
  readonly authorisedReservations: string;
  readonly releasedIrrecoverableUnits: string;
}

/**
 * `I20`'s ACOS-side denominator, read by direct SQL from the view `0013` declares.
 *
 * `§41` forbids reading an expected value out of a production helper, so this is its own
 * `SELECT` on its own connection and calls nothing under `src/`.
 */
async function i20Denominator(): Promise<readonly I20Row[]> {
  const client = await h.control.connect();
  try {
    const result = await client.query<{
      window_id: string;
      window_instance_key: string;
      authorised_irrecoverable_units: string;
      authorised_reservations: string;
      released_irrecoverable_units: string;
    }>(
      `SELECT window_id, window_instance_key,
              authorised_irrecoverable_units::TEXT AS authorised_irrecoverable_units,
              authorised_reservations::TEXT AS authorised_reservations,
              released_irrecoverable_units::TEXT AS released_irrecoverable_units
         FROM i20_authorised_irrecoverable_units
        WHERE company_id = $1
        ORDER BY window_id, window_instance_key`,
      [COMPANY_ID],
    );
    return result.rows.map((r) => ({
      windowId: r.window_id,
      windowInstanceKey: r.window_instance_key,
      authorisedIrrecoverableUnits: r.authorised_irrecoverable_units,
      authorisedReservations: r.authorised_reservations,
      releasedIrrecoverableUnits: r.released_irrecoverable_units,
    }));
  } finally {
    client.release();
  }
}

describe('`51 §2.3` — THE CATALOGUE DECLARES THE UNIT COUNT, PER CLASS', () => {
  it('every declared value matches the hand-authored transcription', () => {
    for (const [actionClass, recoverability, units] of SPEC_TABLE) {
      const entry = ACTION_CATALOGUE[actionClass as keyof typeof ACTION_CATALOGUE];
      expect(entry, actionClass).toBeDefined();
      expect(entry.recoverability, actionClass).toBe(recoverability);
      expect(entry.irrecoverableUnits, actionClass).toBe(units);
      // And the resolver agrees with the entry — the one a caller would reach.
      expect(irrecoverableUnitsFor(actionClass as never), actionClass).toBe(units);
    }
  });

  it('`51 §2.3`s coherence rule: IRRECOVERABLE is 1, every other class is 0', () => {
    /*
     * "**For every IRRECOVERABLE class in the current catalogue the declared value is `1`,
     *  and for every REVERSIBLE and COMPENSABLE class it is `0`.**"
     *
     * Asserted over the WHOLE catalogue rather than over the transcription, so a class added
     * to `ACTION_CATALOGUE` without a row in `SPEC_TABLE` fails here.
     */
    for (const entry of Object.values(ACTION_CATALOGUE)) {
      if (entry.recoverability === 'IRRECOVERABLE') {
        expect(entry.irrecoverableUnits, entry.actionClass).toBe(1n);
      } else {
        expect(entry.irrecoverableUnits, entry.actionClass).toBe(0n);
      }
    }
    // `51 §2.3`: "raising `fulfilment.reship` to 2 would halve the reships the MIE ceiling
    // admits, and lowering `email.send` to 0 would remove the class from the ceiling
    // entirely." The count is an authority quantity, so it is a `bigint` all the way to the
    // `BIGINT` column and never a `number`.
    for (const entry of Object.values(ACTION_CATALOGUE)) {
      expect(typeof entry.irrecoverableUnits).toBe('bigint');
    }
  });

  it('an uncatalogued class has NO implicit default — it throws', () => {
    // "A class present in the catalogue with no declared value is a **catalogue-validation
    // failure, not a class with a value of one**." The same rule, with more force, for a
    // class that is not in the catalogue at all.
    expect(() => irrecoverableUnitsFor('email.send' as never)).toThrow(/closed action catalogue/);
  });
});

describe('`25 §10.1` RESERVE — step R, on EVERY applicable MIE window instance', () => {
  it('an IRRECOVERABLE authorisation reserves one unit per referenced window', async () => {
    // NO `before` SNAPSHOT IS POSSIBLE, AND THAT IS THE ACCEPTED DESIGN. `window_balance`
    // rows are materialised lazily by `ensureWindowInstance` INSIDE step R's transaction —
    // the accepted S1A `ledger.ts` says why: "an instance that has no row has no balance".
    // So before the first IRRECOVERABLE authorisation the MIE instances do not exist, and
    // the property to assert is the post-state plus the count of instances touched.
    expect(await mie()).toHaveLength(0);

    await authoriseReship(h, { resourceId: 'ORD-MIE-1' });

    const after = await mie();
    // EVERY referenced instance, not the first and not a primary — `25 §10.1`. The fixture
    // declares two MIE windows (`W_DAY_MIE`, `W_MONTH_MIE`), so "every" is observable.
    expect(after).toHaveLength(RESHIP_WINDOWS.length);
    for (const row of after) {
      expect(row.reservedIrrecoverable, row.windowId).toBe('1');
      expect(row.presumedIrrecoverable, row.windowId).toBe('0');
      expect(row.realisedIrrecoverable, row.windowId).toBe('0');
    }
  });

  it('a REVERSIBLE authorisation moves the irrecoverable ledger NOT AT ALL', async () => {
    /*
     * `51 §2.3`: "A REVERSIBLE or COMPENSABLE class declares `0` and therefore moves the
     * irrecoverable ledger not at all." `25 §10.1` says the same from the other side: such an
     * effect "moves the count ledger only".
     */
    await authorisePause(h, { resourceId: 'CMP-MIE-NONE' });
    // Its own count window IS materialised — a pause is a governed action and `51 §2`'s
    // count ceiling binds it. What must not move is LEDGER 3, on any instance.
    const rows = await mieRows(h.control, COMPANY_ID);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.reservedIrrecoverable, row.windowId).toBe('0');
      expect(row.presumedIrrecoverable, row.windowId).toBe('0');
      expect(row.realisedIrrecoverable, row.windowId).toBe('0');
    }
  });

  it('a COMPENSABLE money authorisation moves it not at all either', async () => {
    const outcome = await proposeAndAuthorise(h.kernel, {
      orderId: S1E_PASS_ORDER.orderId,
      resourceRef: S1E_PASS_ORDER.resourceRef,
    });
    expect(outcome.outcome).toBe('LOCAL_AUTHORISATION_COMMITTED');
    const rows = await mieRows(h.control, COMPANY_ID);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.reservedIrrecoverable, row.windowId).toBe('0');
      expect(row.presumedIrrecoverable, row.windowId).toBe('0');
      expect(row.realisedIrrecoverable, row.windowId).toBe('0');
    }
  });

  it('two IRRECOVERABLE authorisations reserve TWO units, on the same instances', async () => {
    await authoriseReship(h, { resourceId: 'ORD-MIE-A' });
    await authoriseReship(h, { resourceId: 'ORD-MIE-B' });
    for (const row of await mie()) expect(row.reservedIrrecoverable, row.windowId).toBe('2');
  });
});

describe('`§6`, `§37` — THE IMMUTABLE EVIDENCE, AND `I20`s ACOS-SIDE DENOMINATOR', () => {
  it('the reservation evidence records the units, and cannot be rewritten', async () => {
    await authoriseReship(h, { resourceId: 'ORD-MIE-EVID' });

    const client = await h.control.connect();
    try {
      const rows = await client.query<{ window_id: string; irrecoverable_units: string }>(
        `SELECT window_id, irrecoverable_units::TEXT AS irrecoverable_units
           FROM reservation_window_instance
          WHERE company_id = $1 ORDER BY window_id`,
        [COMPANY_ID],
      );
      expect(rows.rows).toHaveLength(RESHIP_WINDOWS.length);
      for (const row of rows.rows) expect(row.irrecoverable_units).toBe('1');

      // `0013`: "a denominator a later statement can RAISE is a denominator an attacker can
      // raise." The rewrite is refused by the database, not by a convention.
      await expect(
        client.query(
          `UPDATE reservation_window_instance SET irrecoverable_units = 99
            WHERE company_id = $1`,
          [COMPANY_ID],
        ),
      ).rejects.toThrow(/APPEND_ONLY_TABLE_reservation_window_instance/);
    } finally {
      client.release();
    }
  });

  it('`I20`s denominator SURVIVES the reserved → presumed movement — `§37`', async () => {
    /*
     * =================================================================================
     * `§37`'s FIXTURE, EXACTLY: reserve one unit; move reserved → presumed; observe current
     * reserved is 0; and the historical committed evidence still proves one authorised unit.
     *
     * `25 §10.1` states why this matters: "a bound written against the *current* value of
     * that column would tighten as presumptions accumulate — **inverting the invariant's own
     * direction**." The view reads only immutable committed rows, so the figure is invariant
     * under PRESUME, REALISE and RELEASE.
     * =================================================================================
     */
    const effect = await authoriseReship(h, { resourceId: 'ORD-MIE-I20' });
    expect(effect.recoverability).toBe('IRRECOVERABLE');

    const denominatorBefore = await i20Denominator();
    expect(denominatorBefore).toHaveLength(RESHIP_WINDOWS.length);
    for (const row of denominatorBefore) {
      expect(row.authorisedIrrecoverableUnits, row.windowId).toBe('1');
      expect(row.authorisedReservations, row.windowId).toBe('1');
      expect(row.releasedIrrecoverableUnits, row.windowId).toBe('0');
    }

    // MOVE THE UNIT, by the declared transition, through direct SQL rather than through a
    // dispatch: this test is about the DENOMINATOR, and the dispatch path's own movement is
    // asserted by `outcome-classes.test.ts`.
    const client = await h.control.connect();
    try {
      await client.query(
        `UPDATE window_balance
            SET reserved_irrecoverable = reserved_irrecoverable - 1,
                presumed_irrecoverable = presumed_irrecoverable + 1
          WHERE company_id = $1 AND reserved_irrecoverable > 0`,
        [COMPANY_ID],
      );
    } finally {
      client.release();
    }

    // The LIVE column is now zero — which is why it cannot be the basis.
    for (const row of await mie()) {
      expect(row.reservedIrrecoverable, row.windowId).toBe('0');
      expect(row.presumedIrrecoverable, row.windowId).toBe('1');
    }

    // AND THE DENOMINATOR IS UNCHANGED, byte for byte.
    expect(await i20Denominator()).toEqual(denominatorBefore);
  });

  it('THE DISCRIMINATOR — `§15` item 1: an authorisation that reserves no unit', async () => {
    /*
     * The defect the accepted implementation actually had. The control removes the reserved
     * units without touching the immutable evidence, so the two DISAGREE — which is exactly
     * the observation a reviewer would need and exactly what the evidence exists to provide.
     */
    await authoriseReship(h, { resourceId: 'ORD-MIE-CTRL' });
    const denominator = await i20Denominator();
    for (const row of denominator) expect(row.authorisedIrrecoverableUnits).toBe('1');

    const moved = await unsafeAuthoriseWithoutReserving(h.control, COMPANY_ID);
    expect(moved).toBeGreaterThan(0);

    // UNSAFE: the ledger now says nothing is committed…
    for (const row of await mie()) expect(row.reservedIrrecoverable, row.windowId).toBe('0');
    // …while `I20`'s basis still says one unit was authorised. The divergence IS the
    // detection, and it is only possible because the evidence is a separate immutable row.
    expect(await i20Denominator()).toEqual(denominator);
  });
});
