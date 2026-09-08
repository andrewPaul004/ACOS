import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { COMPANY_ID } from '../support/fixture.js';
import {
  OWNER_ONE,
  OWNER_TWO,
  createMirrorHarness,
  signGrant,
  type MirrorHarness,
} from '../support/mirrorFixture.js';
import {
  grantOverride,
  type OverrideRequest,
} from '../../src/kernel/mirror/degradedModeOverride.js';
import { declareMirrorDegraded } from '../../src/kernel/mirror/mirrorStateMachine.js';
import { money } from '../../src/kernel/exposure/money.js';
import {
  ORACLE_LIMITS,
  oracleRequiresSecondApprover,
  type OracleOverride,
} from '../support/overrideAggregateOracle.js';
import {
  unsafeAccumulated,
  unsafeAdmit,
  type UnsafeOverride,
} from './unsafe-override-composition.js';

/**
 * MANDATORY NEGATIVE CONTROL — OVERRIDE COMPOSITION. `§34` OF THE S1H MANDATE.
 *
 * =================================================================================
 * `§34`, verbatim:
 *
 *   "Unsafe implementation: enforces per-override duration; per-override count; but has no
 *    aggregate/composition limit. Run repeated overrides. **Unsafe implementation eventually
 *    exceeds the architecture's total governed bound. Production refuses before doing so.**
 *    Required discriminating test."
 *
 * `51 §3.6`: "`I63`'s aggregate leg is what makes A5's *'repeated bounded overrides compose
 * into unbounded authority'* question answerable and answered **no**."
 *
 * `30 §5.7.2` item 10: "**Rotating action classes, expiry-and-recreation and establishing a
 * durable degraded posture are each bounded by the aggregate legs rather than by the
 * per-override legs.**"
 *
 * EVERY OVERRIDE BELOW IS INDIVIDUALLY MAXIMUM-VALID. `51 §3.6`'s per-override legs — 24
 * hours, 5 effects, $50.00 — are satisfied by all of them, which is what makes the unsafe
 * implementation's admission correct on its own terms and wrong in aggregate.
 * =================================================================================
 */

let h: MirrorHarness;

const T0 = new Date('2026-03-01T00:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

beforeAll(async () => {
  h = await createMirrorHarness();
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await h.reset({ registerSecondOwner: true });
  await declareMirrorDegraded(h.control, COMPANY_ID, 'PUSH_ACK_TIMEOUT', T0);
});

/** A MAXIMUM-VALID override starting on day `day`. */
function maximumValid(day: number): { unsafe: UnsafeOverride; request: OverrideRequest } {
  const startsAt = new Date(T0.getTime() + day * DAY);
  return {
    unsafe: {
      overrideId: `override:${String(day)}`,
      startsAtMs: startsAt.getTime(),
      expiresAtMs: startsAt.getTime() + 24 * HOUR,
      effectCountCap: 5,
      monetaryCapCents: 5000,
    },
    request: {
      companyId: COMPANY_ID,
      overrideId: `override:${String(day)}`,
      requestedBy: OWNER_ONE,
      requestedAt: startsAt,
      // Rotating the class each time, which `30 §5.7.2` item 10 names as an evasion route.
      effectClasses: [
        (['refund.create', 'campaign.pause', 'campaign.budget.set'] as const)[day % 3]!,
      ],
      recoverabilityClasses: [day % 3 === 1 ? 'REVERSIBLE' : 'COMPENSABLE'],
      precedenceRows: [day % 2 === 0 ? 3 : 4],
      startsAt,
      expiresAt: new Date(startsAt.getTime() + 24 * HOUR),
      effectCountCap: 5n,
      monetaryExposureCap: money('50.00'),
      reason: `consecutive outage on day ${String(day)} (§34)`,
      incidentRef: h.seed.incidentRef,
    },
  };
}

async function grantIt(request: OverrideRequest, held: readonly OracleOverride[]): Promise<void> {
  const needsSecond = oracleRequiresSecondApprover(held, request.startsAt.getTime());
  await grantOverride(h.control, request, {
    grantedBy: OWNER_ONE,
    grantedAt: request.requestedAt,
    grantSignature: signGrant(request, h.seed.ownerOne.privateKey),
    ...(needsSecond
      ? {
          secondApprover: OWNER_TWO,
          secondApprovedAt: request.requestedAt,
          secondApproverSignature: signGrant(request, h.seed.ownerTwo.privateKey),
        }
      : {}),
  });
}

describe('THE UNSAFE IMPLEMENTATION ADMITS EVERY ONE OF THEM', () => {
  it('ten maximum-valid overrides, all admitted on the per-override legs alone', () => {
    const held: UnsafeOverride[] = [];
    for (let day = 0; day < 10; day += 1) {
      const { unsafe } = maximumValid(day);
      const admission = unsafeAdmit(held, unsafe);
      expect(admission.admitted, `day ${String(day)}: ${admission.reason}`).toBe(true);
      held.push(unsafe);
    }

    // AND THE ACCUMULATION IS UNBOUNDED IN N.
    const total = unsafeAccumulated(held);
    expect(total.count).toBe(10);
    expect(total.hours).toBe(240);
    expect(total.effects).toBe(50);
    expect(total.monetaryCents).toBe(50_000);

    // Every aggregate leg of `51 §3.6` blown past, by multiples.
    expect(total.count).toBeGreaterThan(ORACLE_LIMITS.maxOverrideCount);
    expect(total.hours).toBeGreaterThan(ORACLE_LIMITS.maxCumulativeHours);
    expect(total.effects).toBeGreaterThan(ORACLE_LIMITS.maxCumulativeEffects);
    expect(total.monetaryCents).toBeGreaterThan(ORACLE_LIMITS.maxCumulativeMonetaryCents);
  });

  it('and the unsafe accumulation EXCEEDS the signed window ceiling it draws against', () => {
    // `51 §3.6`'s safety argument is that the AGGREGATE is "strictly below the already-signed
    // window ceiling it draws against: `$100.00` against `W_MONTH_REFUND`'s `$250.00`". Under
    // the unsafe implementation that argument fails: ten overrides reach $500.00 of override
    // exposure against a $250.00 signed monthly refund ceiling.
    const held: UnsafeOverride[] = [];
    for (let day = 0; day < 10; day += 1) held.push(maximumValid(day).unsafe);
    expect(unsafeAccumulated(held).monetaryCents).toBeGreaterThan(25_000);
  });

  it('and 60 overrides compose to 1440 hours — a durable degraded posture, unbounded', () => {
    // `30 §5.7.2` item 10 names "establishing a durable degraded posture" as the third
    // evasion. Two months of continuous degraded authority, every override individually
    // lawful.
    const held: UnsafeOverride[] = [];
    for (let day = 0; day < 60; day += 1) {
      const { unsafe } = maximumValid(day);
      expect(unsafeAdmit(held, unsafe).admitted).toBe(true);
      held.push(unsafe);
    }
    expect(unsafeAccumulated(held).hours).toBe(1440);
  });

  it('while REFUSING a genuinely over-long single override — the control is not simply broken', () => {
    // The unsafe implementation enforces the per-override legs correctly. That is what makes
    // it a sharp control rather than a stub: the ONLY thing it omits is the aggregate.
    const over = maximumValid(0).unsafe;
    expect(
      unsafeAdmit([], { ...over, expiresAtMs: over.startsAtMs + 25 * HOUR }).admitted,
    ).toBe(false);
    expect(unsafeAdmit([], { ...over, effectCountCap: 6 }).admitted).toBe(false);
    expect(unsafeAdmit([], { ...over, monetaryCapCents: 5001 }).admitted).toBe(false);
  });
});

describe('PRODUCTION REFUSES BEFORE THE BOUND IS EXCEEDED', () => {
  it('the FOURTH grant is refused, and the aggregate never passes `51 §3.6`', async () => {
    const held: OracleOverride[] = [];
    for (let day = 0; day < 3; day += 1) {
      const { request, unsafe } = maximumValid(day);
      await grantIt(request, held);
      held.push({
        overrideId: unsafe.overrideId,
        startsAtMs: unsafe.startsAtMs,
        expiresAtMs: unsafe.expiresAtMs,
        effectsDispatched: 0,
        monetaryDispatchedCents: 0,
      });
    }

    // THREE ARE ADMITTED — `51 §3.6`: "Three overrides is the count cap; 3 × 24 h = 72 h,
    // exactly the hours cap." The architecture's own maximum, reached exactly.
    const stored = await storedAggregate();
    expect(stored.count).toBe(3);
    expect(stored.hours).toBe(72);

    // AND THE FOURTH IS REFUSED, where the unsafe implementation admitted it.
    const fourth = maximumValid(3);
    expect(unsafeAdmit([], fourth.unsafe).admitted).toBe(true);
    await expect(grantIt(fourth.request, held)).rejects.toThrow(
      /I63_COMPOSITION_COUNT|I63_COMPOSITION_HOURS/,
    );

    // The ledger did not move.
    const after = await storedAggregate();
    expect(after).toEqual(stored);
  });

  it('THE DISCRIMINATION, over the same ten-override sequence', async () => {
    const heldUnsafe: UnsafeOverride[] = [];
    const heldOracle: OracleOverride[] = [];
    let productionAdmitted = 0;
    let unsafeAdmitted = 0;

    for (let day = 0; day < 10; day += 1) {
      const { request, unsafe } = maximumValid(day);

      if (unsafeAdmit(heldUnsafe, unsafe).admitted) {
        unsafeAdmitted += 1;
        heldUnsafe.push(unsafe);
      }

      try {
        await grantIt(request, heldOracle);
        productionAdmitted += 1;
        heldOracle.push({
          overrideId: unsafe.overrideId,
          startsAtMs: unsafe.startsAtMs,
          expiresAtMs: unsafe.expiresAtMs,
          effectsDispatched: 0,
          monetaryDispatchedCents: 0,
        });
      } catch (error) {
        // `I63(b)` — the only reason production may refuse a per-override-valid grant.
        expect(String(error)).toMatch(
          /I63_COMPOSITION_COUNT|I63_COMPOSITION_HOURS|I63_SECOND_APPROVER_REQUIRED/,
        );
      }
    }

    expect(unsafeAdmitted).toBe(10);
    expect(productionAdmitted).toBe(ORACLE_LIMITS.maxOverrideCount);
    expect(productionAdmitted).toBeLessThan(unsafeAdmitted);
  });

  it('and after the window ROLLS, production admits again — it is a bound, not a ban', async () => {
    // `51 §3.6`'s bound is per rolling 30 days. A control that never admitted a fourth
    // override would be stricter than the architecture, and asserting that would be
    // asserting the wrong rule.
    const held: OracleOverride[] = [];
    for (let day = 0; day < 3; day += 1) {
      const { request, unsafe } = maximumValid(day);
      await grantIt(request, held);
      held.push({
        overrideId: unsafe.overrideId,
        startsAtMs: unsafe.startsAtMs,
        expiresAtMs: unsafe.expiresAtMs,
        effectsDispatched: 0,
        monetaryDispatchedCents: 0,
      });
    }
    // Day 40, not day 31: the rolling window ending at day 31 would still contain days 1 and
    // 2, so the assertion below would be about a window holding two — true, but a weaker
    // statement than the one this test is for. At day 40 every earlier override has rolled
    // out and the window holds exactly the new one.
    const beyond = maximumValid(40);
    await expect(grantIt(beyond.request, held)).resolves.toBeUndefined();
    // And the newest 30-day window holds exactly one.
    const client = await h.control.connect();
    try {
      const rows = await client.query<{ n: string }>(
        `SELECT count(*)::TEXT AS n FROM degraded_mode_override
          WHERE company_id = $1
            AND starts_at >  $2::TIMESTAMPTZ - INTERVAL '30 days'
            AND starts_at <= $2::TIMESTAMPTZ`,
        [COMPANY_ID, beyond.request.startsAt],
      );
      expect(rows.rows[0]!.n).toBe('1');
    } finally {
      client.release();
    }
  });
});

/** The stored aggregate, read straight out of PostgreSQL. */
async function storedAggregate(): Promise<{ count: number; hours: number }> {
  const client = await h.control.connect();
  try {
    const rows = await client.query<{ n: string; hours: string }>(
      `SELECT count(*)::TEXT AS n,
              COALESCE(sum(EXTRACT(EPOCH FROM (expires_at - starts_at)) / 3600), 0)::TEXT AS hours
         FROM degraded_mode_override WHERE company_id = $1`,
      [COMPANY_ID],
    );
    return { count: Number(rows.rows[0]!.n), hours: Number(rows.rows[0]!.hours) };
  } finally {
    client.release();
  }
}
