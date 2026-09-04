import { afterAll, beforeEach, beforeAll, describe, expect, it } from 'vitest';

import type { Client } from '../../src/db/pool.js';
import { createHarness, type Harness } from '../support/fixture.js';
import { Conductor, POINT, settleAll } from '../support/barrier.js';
import { fourTermSum, subScale2, withinCeiling } from '../support/oracle.js';
import {
  createUnsafeSchema,
  dropUnsafeSchema,
  readUnsafeTerms,
  seedUnsafeFixture,
  unsafeAuthorise,
  unsafeRecordRealisedSpend,
  type UnsafeFixture,
} from './unsafe-schema.js';

/**
 * THE MANDATORY NEGATIVE CONTROL.
 *
 * `36 §2`, verbatim: "Negative control, mandatory (v1.1, VAL-06): the same
 * targeted-interleaving scenario at REPEATABLE READ must fail. A concurrency test with
 * no negative control cannot be distinguished from a test that does not exercise the
 * bug."
 *
 * `phase2-v1.3-implementation-brief.md §7` condition 4, verbatim: "The S1 concurrency
 * harness cannot produce a failing negative control at REPEATABLE READ — covering
 * obligations 2 and 16." Reaching that condition REVOKES the architecture PASS.
 *
 * The S1A mandate: "If you cannot make the negative control fail: STOP. The test has not
 * demonstrated that it exercises the race. Do not declare the substrate proven."
 *
 * ---------------------------------------------------------------------------------
 * WHAT THIS FILE DOES
 *
 * It runs the SAME assertion battery that tests/integration/exposure/vc-s8-*.test.ts
 * runs against production, but against the deliberately unsafe path in
 * ./unsafe-schema.ts, and asserts THE BATTERY FAILS. A run in which the unsafe path
 * satisfies the assertions is a FAILURE of this file, because it would mean the
 * assertions cannot see the race and the production result proves nothing.
 *
 * Production code is not weakened, imported or modified. The unsafe path lives in its
 * own PostgreSQL schema and its own module, both under tests/.
 * ---------------------------------------------------------------------------------
 *
 * THE FIXTURE, and the arithmetic done by hand:
 *
 *   ceiling                                  $186.00
 *   one standing authorisation, cap          $100.00     → standing term $100.00
 *   four-term sum before anything happens    $100.00
 *   headroom                                  $86.00     (186.00 − 100.00)
 *
 *   A vendor spend observation of $40.00 arrives. Correctly applied, standing falls to
 *   max(0, 100.00 − 40.00) = $60.00 and realised rises to $40.00, so the four-term sum
 *   is UNCHANGED at $100.00 and the headroom is still $86.00. Money moved between terms;
 *   no headroom was created.
 *
 *   Under the unsafe path the two moves are separate transactions, standing-first. In
 *   the interval between them:
 *
 *     standing $60.00 + realised $0.00 = $60.00   → apparent headroom $126.00
 *
 *   $126.00 is $40.00 of headroom that no authorisation created and no lock protects.
 *   `24 §3` K5 names exactly this: "standing-first transiently created headroom a
 *   concurrent authorisation could consume without touching any lock associated with the
 *   standing authorisation."
 */

const FIXTURE: UnsafeFixture = {
  companyId: 'co_s1a_fixture',
  windowId: 'W_MONTH_ADSPEND',
  instanceKey: 'W_MONTH_ADSPEND:2026-01',
  ceiling: '186.00',
  standingAuthorizationId: 'sa_live',
  standingCap: '100.00',
};

const SPEND = '40.00';
/** 186.00 − 100.00 = 86.00, by hand. The headroom that legitimately exists. */
const TRUE_HEADROOM = '86.00';
/** 186.00 − 60.00 = 126.00, by hand. The headroom the unsafe path transiently shows. */
const PHANTOM_HEADROOM = '126.00';

let harness: Harness;
let admin: Client;

beforeAll(async () => {
  harness = await createHarness();
  await harness.reset();
  admin = await harness.connect();
});

beforeEach(async () => {
  await createUnsafeSchema(admin);
  await seedUnsafeFixture(admin, FIXTURE);
});

afterAll(async () => {
  if (admin) {
    await dropUnsafeSchema(admin);
    admin.release();
  }
  await harness?.close();
});

/**
 * The assertion battery. IDENTICAL in shape to the one VC-S8 applies to production:
 * the four-term sum never exceeds the ceiling, realised is exactly what the vendor
 * reported, and standing is the conservative remainder.
 */
function assertBattery(
  terms: { reserved: string; standing: string; presumed: string; realised: string },
  ceiling: string,
  observations: readonly string[],
): void {
  for (const sample of observations) {
    if (!withinCeiling(sample, ceiling)) {
      throw new Error(
        `TRANSIENT UNAUTHORISED HEADROOM: an observer saw a four-term sum of ${sample} ` +
          `against a ceiling of ${ceiling}`,
      );
    }
  }
  const sum = fourTermSum(terms);
  if (!withinCeiling(sum, ceiling)) {
    throw new Error(
      `CEILING BREACHED BY COMMITMENT: final four-term sum ${sum} exceeds ${ceiling} ` +
        `(reserved ${terms.reserved} + standing ${terms.standing} + ` +
        `presumed ${terms.presumed} + realised ${terms.realised})`,
    );
  }
  if (terms.realised !== SPEND) {
    throw new Error(`LOST REALISED UPDATE: expected ${SPEND}, found ${terms.realised}`);
  }
  if (terms.standing !== subScale2(FIXTURE.standingCap, SPEND)) {
    throw new Error(
      `DROPPED STANDING UPDATE: expected ${subScale2(FIXTURE.standingCap, SPEND)}, ` +
        `found ${terms.standing}`,
    );
  }
}

describe('the negative control reproduces the forbidden interleaving', () => {
  it('the unsafe path transiently exposes headroom no authorisation created', async () => {
    const conductor = new Conductor();
    const reconClient = await harness.connect();
    const observer = await harness.connect();
    const observations: string[] = [];

    try {
      const recon = conductor.participant('recon');

      // Started, NOT awaited. It parks inside the forbidden interval and stays there
      // until this test releases it, which is what makes the observation deterministic.
      const reconRun = unsafeRecordRealisedSpend(reconClient, FIXTURE, SPEND, async () => {
        // Standing has fallen and realised has not yet risen. Both halves committed.
        await recon.at(POINT.AFTER_WRITE);
      });

      // Now, from an independent backend, while the interval is open.
      await conductor.until('recon', POINT.AFTER_WRITE);
      const terms = await readUnsafeTerms(observer, FIXTURE);
      observations.push(fourTermSum(terms));
      conductor.release('recon', POINT.AFTER_WRITE);
      await reconRun;

      // THE PHANTOM. standing $60.00, realised still $0.00 → sum $60.00, and the
      // apparent headroom is $126.00 rather than the true $86.00.
      expect(observations[0]).toBe('60.00');
      expect(subScale2(FIXTURE.ceiling, observations[0]!)).toBe(PHANTOM_HEADROOM);
      expect(subScale2(FIXTURE.ceiling, observations[0]!)).not.toBe(TRUE_HEADROOM);
    } finally {
      conductor.abort(new Error('test finished'));
      reconClient.release();
      observer.release();
    }
  });

  it('EXPECTED FAILURE: the assertion battery FAILS against the unsafe path', async () => {
    const conductor = new Conductor();
    const reconClient = await harness.connect();
    const authClient = await harness.connect();
    const observer = await harness.connect();
    const observations: string[] = [];

    let authVerdict: string | null = null;

    try {
      const recon = conductor.participant('recon');

      // The reconciler is started and parks inside the forbidden interval.
      const reconRun = unsafeRecordRealisedSpend(reconClient, FIXTURE, SPEND, async () => {
        await recon.at(POINT.AFTER_WRITE);
      });
      await conductor.until('recon', POINT.AFTER_WRITE);
      observations.push(fourTermSum(await readUnsafeTerms(observer, FIXTURE)));

      // THE AUTHORISATION RUNS ENTIRELY INSIDE THE INTERVAL. It reads the phantom state
      // — standing already reduced, realised not yet increased — decides headroom from
      // it in application code, and commits. It asks for the PHANTOM headroom of
      // $126.00, which against the true state is $40.00 more than exists.
      const results = await settleAll([
        async () => {
          authVerdict = await unsafeAuthorise(
            authClient,
            FIXTURE,
            PHANTOM_HEADROOM,
            async () => undefined,
          );
        },
      ]);
      observations.push(fourTermSum(await readUnsafeTerms(observer, FIXTURE)));

      // Only now does the reconciler's second transaction post the realised half.
      conductor.release('recon', POINT.AFTER_WRITE);
      await reconRun;

      for (const result of results) {
        expect(result.status, `an unsafe participant threw: ${String(result)}`).toBe(
          'fulfilled',
        );
      }

      const finalTerms = await readUnsafeTerms(observer, FIXTURE);
      observations.push(fourTermSum(finalTerms));

      // ---- THE NEGATIVE CONTROL'S OWN ASSERTION ----
      //
      // The battery that PASSES against production must FAIL here. If it does not, the
      // battery cannot see the race, and `phase2-v1.3-implementation-brief.md §7`
      // condition 4 is reached.
      let batteryError: unknown = null;
      try {
        assertBattery(finalTerms, FIXTURE.ceiling, observations);
      } catch (error) {
        batteryError = error;
      }

      expect(
        batteryError,
        'THE NEGATIVE CONTROL DID NOT FAIL. The assertion battery accepted the unsafe ' +
          'path, so it cannot distinguish a correct implementation from a racy one and ' +
          'the VC-S8 result proves nothing. This is ' +
          'phase2-v1.3-implementation-brief.md §7 condition 4.',
      ).not.toBeNull();

      // And the failure is the SPECIFIC one TB-04 describes, not an incidental one.
      const message = String(batteryError);
      expect(message).toMatch(/CEILING BREACHED BY COMMITMENT|TRANSIENT UNAUTHORISED HEADROOM/);

      // The concrete damage, computed by hand:
      //   reserved 126.00 + standing 60.00 + presumed 0.00 + realised 40.00 = 226.00
      //   226.00 > 186.00, over by 40.00 — exactly the spend that briefly vanished.
      expect(authVerdict).toBe('PERMIT');
      expect(finalTerms.reserved).toBe(PHANTOM_HEADROOM);
      expect(fourTermSum(finalTerms)).toBe('226.00');
      expect(subScale2(fourTermSum(finalTerms), FIXTURE.ceiling)).toBe('40.00');

      console.log(
        [
          '',
          '  ─────────────────────────────────────────────────────────────',
          '  VC-S8 negative control (REPEATABLE READ, no row lock,',
          '  no commitment guard, standing/realised in two transactions)',
          '',
          '    safe implementation:      PASS',
          '    unsafe negative control:  EXPECTED FAILURE OBSERVED',
          '',
          `    ${String(batteryError).replace(/^Error: /, '')}`,
          '  ─────────────────────────────────────────────────────────────',
          '',
        ].join('\n'),
      );
    } finally {
      conductor.abort(new Error('test finished'));
      reconClient.release();
      authClient.release();
      observer.release();
    }
  });

  it('the SAME battery PASSES against a correctly applied observation', async () => {
    // The battery is not simply broken: applied to the unsafe schema with the two moves
    // made atomically and no concurrent authorisation, it accepts the result. So the
    // failure above is caused by the interleaving, not by the assertions.
    const client = await harness.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE unsafe_v12.standing_window_exposure
            SET realised_monetary = realised_monetary + $1::NUMERIC,
                forward_monetary  = GREATEST(0, standing_cap_monetary
                                                - (realised_monetary + $1::NUMERIC))`,
        [SPEND],
      );
      await client.query(
        `UPDATE unsafe_v12.window_balance wb
            SET standing_monetary = (SELECT COALESCE(SUM(forward_monetary), 0)
                                       FROM unsafe_v12.standing_window_exposure),
                realised_monetary = realised_monetary + $1::NUMERIC`,
        [SPEND],
      );
      await client.query('COMMIT');

      const terms = await readUnsafeTerms(client, FIXTURE);
      expect(() => assertBattery(terms, FIXTURE.ceiling, [fourTermSum(terms)])).not.toThrow();
      expect(fourTermSum(terms)).toBe('100.00');
    } finally {
      client.release();
    }
  });
});
