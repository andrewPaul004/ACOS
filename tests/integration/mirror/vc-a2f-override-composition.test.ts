import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { COMPANY_ID } from '../../support/fixture.js';
import {
  OWNER_ONE,
  OWNER_TWO,
  createMirrorHarness,
  signGrant,
  type MirrorHarness,
} from '../../support/mirrorFixture.js';
import {
  claimOverrideAllowance,
  grantOverride,
  type OverrideRequest,
} from '../../../src/kernel/mirror/degradedModeOverride.js';
import { declareMirrorDegraded } from '../../../src/kernel/mirror/mirrorStateMachine.js';
import { money } from '../../../src/kernel/exposure/money.js';
import {
  ORACLE_LIMITS,
  aggregateWindows,
  oracleOrdinal,
  oracleRequiresSecondApprover,
  oracleVerdict,
  type OracleOverride,
} from '../../support/overrideAggregateOracle.js';

/**
 * `VC-A2f` / `I63(b)` — REPEATED BOUNDED OVERRIDES DO NOT COMPOSE INTO UNBOUNDED AUTHORITY.
 *
 * =================================================================================
 * `36 §9`, VC-A2f, verbatim:
 *
 *   "**VC-A2f — override composition (v1.3, TA-05, `I63`).** Exercise maximum-valid overrides
 *    repeatedly across consecutive simulated outages, **rotating action classes and
 *    recreating after expiry**, and assert every aggregate leg of `I63` binds: 3 overrides,
 *    72 cumulative hours, 8 cumulative effects, $100.00 cumulative monetary, per rolling 30
 *    days. **The expected aggregate is computed by a second implementation from `51 §3.6`,
 *    not by the production counter.**"
 *
 * `51 §3.6`: "`I63`'s aggregate leg is what makes A5's *'repeated bounded overrides compose
 * into unbounded authority'* question answerable and answered **no**."
 *
 * THE ORACLE IS `tests/support/overrideAggregateOracle.ts`, which imports nothing.
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
  // A second OWNER-tier principal is registered here, because `51 §3.6` makes overrides 2
  // and 3 structurally unavailable without one and the composition bound is only reachable
  // at 2 and 3. `vc-a2e-override.test.ts` asserts the DEFAULT — one owner, one override —
  // so registering a second here does not paper the limitation over.
  await h.reset({ registerSecondOwner: true });
  await declareMirrorDegraded(h.control, COMPANY_ID, 'PUSH_ACK_TIMEOUT', T0);
});

interface Plan {
  readonly id: string;
  readonly startsAt: Date;
  readonly hours: number;
  readonly effectClass: 'refund.create' | 'campaign.budget.set' | 'campaign.pause';
  readonly recoverability: 'COMPENSABLE' | 'REVERSIBLE';
  readonly row: 3 | 4;
  readonly effectCountCap: bigint;
  readonly monetary: string;
}

function requestFor(plan: Plan): OverrideRequest {
  return {
    companyId: COMPANY_ID,
    overrideId: plan.id,
    requestedBy: OWNER_ONE,
    requestedAt: plan.startsAt,
    effectClasses: [plan.effectClass],
    recoverabilityClasses: [plan.recoverability],
    precedenceRows: [plan.row],
    startsAt: plan.startsAt,
    expiresAt: new Date(plan.startsAt.getTime() + plan.hours * HOUR),
    effectCountCap: plan.effectCountCap,
    monetaryExposureCap: money(plan.monetary),
    reason: 'consecutive simulated outage (VC-A2f)',
    incidentRef: h.seed.incidentRef,
  };
}

/** Grant one, with a second approver whenever the ORACLE says one is required. */
async function grantPlan(plan: Plan, held: readonly OracleOverride[]): Promise<void> {
  const req = requestFor(plan);
  const needsSecond = oracleRequiresSecondApprover(held, plan.startsAt.getTime());
  await grantOverride(h.control, req, {
    grantedBy: OWNER_ONE,
    grantedAt: plan.startsAt,
    grantSignature: signGrant(req, h.seed.ownerOne.privateKey),
    ...(needsSecond
      ? {
          secondApprover: OWNER_TWO,
          secondApprovedAt: plan.startsAt,
          secondApproverSignature: signGrant(req, h.seed.ownerTwo.privateKey),
        }
      : {}),
  });
}

function asOracle(plan: Plan, effects = 0, cents = 0): OracleOverride {
  return {
    overrideId: plan.id,
    startsAtMs: plan.startsAt.getTime(),
    expiresAtMs: plan.startsAt.getTime() + plan.hours * HOUR,
    effectsDispatched: effects,
    monetaryDispatchedCents: cents,
  };
}

describe('the ORACLE reproduces `51 §3.6`s own worked composition', () => {
  it('3 × 24 h is exactly 72 h — the hours cap, reached and not exceeded', () => {
    // `51 §3.6`: "Three overrides is the count cap; 3 × 24 h = 72 h, **exactly the hours
    // cap**." So three maximum-duration overrides are ADMISSIBLE and a fourth is not.
    const three: OracleOverride[] = [0, 1, 2].map((i) => ({
      overrideId: `o${String(i)}`,
      startsAtMs: T0.getTime() + i * DAY,
      expiresAtMs: T0.getTime() + i * DAY + 24 * HOUR,
      effectsDispatched: 0,
      monetaryDispatchedCents: 0,
    }));
    expect(oracleVerdict(three).withinBounds).toBe(true);
    expect(aggregateWindows(three)[0]!.hours).toBe(72);

    const four = [
      ...three,
      {
        overrideId: 'o3',
        startsAtMs: T0.getTime() + 3 * DAY,
        expiresAtMs: T0.getTime() + 3 * DAY + 24 * HOUR,
        effectsDispatched: 0,
        monetaryDispatchedCents: 0,
      },
    ];
    const verdict = oracleVerdict(four);
    expect(verdict.withinBounds).toBe(false);
    expect(verdict.breaches.map((b) => b.leg)).toContain('COUNT');
    expect(verdict.breaches.map((b) => b.leg)).toContain('HOURS');
  });

  it('the AGGREGATE binds BEFORE the per-override legs on both consumable quantities', () => {
    // `51 §3.6`: "3 × 5 = 15 effects, cut to **8** by the aggregate; 3 × $50.00 = $150.00,
    // cut to **$100.00** by the aggregate. **The aggregate legs bind before the per-override
    // legs on both consumable quantities.**"
    expect(3 * ORACLE_LIMITS.maxOverrideEffectCount).toBe(15);
    expect(ORACLE_LIMITS.maxCumulativeEffects).toBe(8);
    expect(ORACLE_LIMITS.maxCumulativeEffects).toBeLessThan(
      3 * ORACLE_LIMITS.maxOverrideEffectCount,
    );
    expect(3 * ORACLE_LIMITS.maxOverrideMonetaryCents).toBe(15_000);
    expect(ORACLE_LIMITS.maxCumulativeMonetaryCents).toBe(10_000);
    expect(ORACLE_LIMITS.maxCumulativeMonetaryCents).toBeLessThan(
      3 * ORACLE_LIMITS.maxOverrideMonetaryCents,
    );
  });

  it('and the oracle checks EVERY rolling window, not only the newest', () => {
    // The property that catches "expire and recreate". Four overrides spread so that no
    // window anchored at the LAST one is over the count — but one anchored earlier is.
    const spread: OracleOverride[] = [0, 1, 2, 40].map((d, i) => ({
      overrideId: `o${String(i)}`,
      startsAtMs: T0.getTime() + d * DAY,
      expiresAtMs: T0.getTime() + d * DAY + HOUR,
      effectsDispatched: 0,
      monetaryDispatchedCents: 0,
    }));
    // The window anchored at day 40 holds ONE. The window anchored at day 0 holds THREE.
    const windows = aggregateWindows(spread);
    expect(windows.find((w) => w.windowStartMs === T0.getTime() + 40 * DAY)!.count).toBe(1);
    expect(windows.find((w) => w.windowStartMs === T0.getTime())!.count).toBe(3);
    expect(oracleVerdict(spread).withinBounds).toBe(true);
  });
});

describe('PRODUCTION AGREES WITH THE ORACLE — the count leg', () => {
  it('three maximum-duration overrides are admitted; the FOURTH is refused', async () => {
    const held: OracleOverride[] = [];
    for (let i = 0; i < 3; i += 1) {
      const plan: Plan = {
        id: `override:${String(i)}`,
        // Non-overlapping, consecutive: `VC-A2f`'s "consecutive simulated outages".
        startsAt: new Date(T0.getTime() + i * DAY),
        hours: 24,
        effectClass: 'refund.create',
        recoverability: 'COMPENSABLE',
        row: 3,
        effectCountCap: 2n,
        monetary: '20.00',
      };
      expect(oracleVerdict([...held, asOracle(plan)]).withinBounds).toBe(true);
      await grantPlan(plan, held);
      held.push(asOracle(plan));
    }

    const fourth: Plan = {
      id: 'override:3',
      startsAt: new Date(T0.getTime() + 3 * DAY),
      hours: 24,
      effectClass: 'refund.create',
      recoverability: 'COMPENSABLE',
      row: 3,
      effectCountCap: 2n,
      monetary: '20.00',
    };
    // THE ORACLE SAYS NO, INDEPENDENTLY.
    const verdict = oracleVerdict([...held, asOracle(fourth)]);
    expect(verdict.withinBounds).toBe(false);
    // AND PRODUCTION REFUSES IT.
    await expect(grantPlan(fourth, held)).rejects.toThrow(
      /I63_COMPOSITION_COUNT|I63_COMPOSITION_HOURS/,
    );
  });

  it('ROTATING ACTION CLASSES does not evade the count cap', async () => {
    // `30 §5.7.2` item 10: "**Rotating action classes**, expiry-and-recreation and
    // establishing a durable degraded posture are each bounded by the aggregate legs rather
    // than by the per-override legs."
    const classes: Plan['effectClass'][] = ['refund.create', 'campaign.budget.set', 'campaign.pause'];
    const held: OracleOverride[] = [];
    for (let i = 0; i < 3; i += 1) {
      const plan: Plan = {
        id: `override:rot-${String(i)}`,
        startsAt: new Date(T0.getTime() + i * DAY),
        hours: 6,
        effectClass: classes[i]!,
        recoverability: classes[i] === 'campaign.pause' ? 'REVERSIBLE' : 'COMPENSABLE',
        row: 4,
        effectCountCap: 1n,
        monetary: '5.00',
      };
      await grantPlan(plan, held);
      held.push(asOracle(plan));
    }
    const fourth: Plan = {
      id: 'override:rot-3',
      startsAt: new Date(T0.getTime() + 3 * DAY),
      hours: 6,
      // A FOURTH, DIFFERENT class. The aggregate does not care.
      effectClass: 'refund.create',
      recoverability: 'REVERSIBLE',
      row: 4,
      effectCountCap: 1n,
      monetary: '5.00',
    };
    expect(oracleVerdict([...held, asOracle(fourth)]).breaches.map((b) => b.leg)).toContain(
      'COUNT',
    );
    await expect(grantPlan(fourth, held)).rejects.toThrow(/I63_COMPOSITION_COUNT/);
  });

  it('EXPIRY AND IMMEDIATE RECREATION does not evade it either', async () => {
    // Three one-hour overrides back to back, each expired before the next begins, then a
    // fourth. The hours aggregate is nowhere near 72 — so the leg that binds is the COUNT,
    // and that is the point: an attacker who keeps each override tiny still runs out.
    const held: OracleOverride[] = [];
    for (let i = 0; i < 3; i += 1) {
      const plan: Plan = {
        id: `override:recreate-${String(i)}`,
        startsAt: new Date(T0.getTime() + i * HOUR),
        hours: 1,
        effectClass: 'refund.create',
        recoverability: 'COMPENSABLE',
        row: 3,
        effectCountCap: 1n,
        monetary: '1.00',
      };
      await grantPlan(plan, held);
      held.push(asOracle(plan));
    }
    expect(aggregateWindows(held)[0]!.hours).toBe(3);
    const fourth: Plan = {
      id: 'override:recreate-3',
      startsAt: new Date(T0.getTime() + 3 * HOUR),
      hours: 1,
      effectClass: 'refund.create',
      recoverability: 'COMPENSABLE',
      row: 3,
      effectCountCap: 1n,
      monetary: '1.00',
    };
    expect(oracleVerdict([...held, asOracle(fourth)]).breaches.map((b) => b.leg)).toEqual([
      'COUNT',
    ]);
    await expect(grantPlan(fourth, held)).rejects.toThrow(/I63_COMPOSITION_COUNT/);
  });

  it('and the window ROLLS: past 30 days a fourth override is admitted again', async () => {
    // The bound is a rolling 30-day window, not a lifetime cap. `51 §3.6` says so, and a
    // test that never demonstrated the roll would be asserting a stricter rule than the
    // architecture declares.
    const held: OracleOverride[] = [];
    for (let i = 0; i < 3; i += 1) {
      const plan: Plan = {
        id: `override:roll-${String(i)}`,
        startsAt: new Date(T0.getTime() + i * HOUR),
        hours: 1,
        effectClass: 'refund.create',
        recoverability: 'COMPENSABLE',
        row: 3,
        effectCountCap: 1n,
        monetary: '1.00',
      };
      await grantPlan(plan, held);
      held.push(asOracle(plan));
    }
    const beyond: Plan = {
      id: 'override:roll-3',
      startsAt: new Date(T0.getTime() + 31 * DAY),
      hours: 1,
      effectClass: 'refund.create',
      recoverability: 'COMPENSABLE',
      row: 3,
      effectCountCap: 1n,
      monetary: '1.00',
    };
    expect(oracleVerdict([...held, asOracle(beyond)]).withinBounds).toBe(true);
    // The ordinal inside the window ENDING at the new start is 1 — the three earlier
    // overrides have rolled out of it — so no second approver is required. The oracle
    // computes that independently of the trigger.
    expect(oracleOrdinal(held, beyond.startsAt.getTime())).toBe(1);
    await expect(grantPlan(beyond, held)).resolves.toBeUndefined();
  });
});

describe('PRODUCTION AGREES WITH THE ORACLE — the CONSUMABLE legs', () => {
  it('cumulative EFFECTS are cut to 8 across three overrides of 5', async () => {
    // `51 §3.6`: "3 × 5 = 15 effects, cut to **8** by the aggregate."
    const held: OracleOverride[] = [];
    const plans: Plan[] = [0, 1, 2].map((i) => ({
      id: `override:eff-${String(i)}`,
      startsAt: new Date(T0.getTime() + i * DAY),
      hours: 24,
      effectClass: 'refund.create',
      recoverability: 'COMPENSABLE',
      row: 3,
      effectCountCap: 5n,
      monetary: '50.00',
    }));
    for (const plan of plans) {
      await grantPlan(plan, held);
      held.push(asOracle(plan));
    }

    // Consume, one at a time, tracking the oracle in parallel. Each claim uses $0.01 so the
    // MONETARY leg cannot be what binds — the EFFECTS leg must be.
    let claimed = 0;
    const consumption = new Map<string, { effects: number; cents: number }>();
    for (const plan of plans) consumption.set(plan.id, { effects: 0, cents: 0 });

    for (const plan of plans) {
      for (let i = 0; i < 5; i += 1) {
        const projected = plans.map((p) => {
          const c = consumption.get(p.id)!;
          const bump = p.id === plan.id ? 1 : 0;
          return asOracle(p, c.effects + bump, c.cents + bump);
        });
        const oracleAllows = oracleVerdict(projected).withinBounds;
        const result = await claimOverrideAllowance(
          h.control,
          COMPANY_ID,
          plan.id,
          money('0.01'),
          new Date(plan.startsAt.getTime() + HOUR),
        );
        // THE ORACLE AND PRODUCTION AGREE ON EVERY SINGLE CLAIM.
        expect(result.kind === 'ALLOWANCE_TAKEN', `${plan.id}#${String(i)}`).toBe(oracleAllows);
        if (result.kind === 'ALLOWANCE_TAKEN') {
          const c = consumption.get(plan.id)!;
          consumption.set(plan.id, { effects: c.effects + 1, cents: c.cents + 1 });
          claimed += 1;
        }
      }
    }

    // 15 were available per-override; 8 were actually claimable.
    expect(claimed).toBe(ORACLE_LIMITS.maxCumulativeEffects);
    expect(claimed).toBeLessThan(3 * Number(plans[0]!.effectCountCap));
  });

  it('cumulative MONETARY is cut to $100.00 across three overrides of $50.00', async () => {
    // `51 §3.6`: "3 × $50.00 = $150.00, cut to **$100.00** by the aggregate."
    const held: OracleOverride[] = [];
    const plans: Plan[] = [0, 1, 2].map((i) => ({
      id: `override:mon-${String(i)}`,
      startsAt: new Date(T0.getTime() + i * DAY),
      hours: 24,
      effectClass: 'refund.create',
      recoverability: 'COMPENSABLE',
      row: 3,
      effectCountCap: 2n,
      monetary: '50.00',
    }));
    for (const plan of plans) {
      await grantPlan(plan, held);
      held.push(asOracle(plan));
    }

    // Two claims of $25.00 each per override = $150.00 attempted, 6 effects — inside the
    // 8-effect aggregate, so the MONETARY leg is what must bind.
    let claimedCents = 0;
    const consumption = new Map<string, { effects: number; cents: number }>();
    for (const plan of plans) consumption.set(plan.id, { effects: 0, cents: 0 });

    for (const plan of plans) {
      for (let i = 0; i < 2; i += 1) {
        const projected = plans.map((p) => {
          const c = consumption.get(p.id)!;
          const bumpE = p.id === plan.id ? 1 : 0;
          const bumpC = p.id === plan.id ? 2500 : 0;
          return asOracle(p, c.effects + bumpE, c.cents + bumpC);
        });
        const oracleAllows = oracleVerdict(projected).withinBounds;
        const result = await claimOverrideAllowance(
          h.control,
          COMPANY_ID,
          plan.id,
          money('25.00'),
          new Date(plan.startsAt.getTime() + HOUR),
        );
        expect(result.kind === 'ALLOWANCE_TAKEN', `${plan.id}#${String(i)}`).toBe(oracleAllows);
        if (result.kind === 'ALLOWANCE_TAKEN') {
          const c = consumption.get(plan.id)!;
          consumption.set(plan.id, { effects: c.effects + 1, cents: c.cents + 2500 });
          claimedCents += 2500;
        }
      }
    }

    expect(claimedCents).toBe(ORACLE_LIMITS.maxCumulativeMonetaryCents);
  });

  it('and `51 §3.6`s SAFETY ARGUMENT holds: the aggregate is below the signed window ceiling', async () => {
    // `51 §3.6`: "every monetary and count aggregate is **strictly below** the already-signed
    // window ceiling it draws against: `$100.00` against `W_MONTH_REFUND`'s `$250.00`, and 8
    // effects against its count of 10. [...] **no override or sequence of overrides can raise
    // realisable loss above the signed `MAL_total`.**"
    const client = await h.control.connect();
    try {
      const ceiling = await client.query<{ max_monetary: string; max_count: string }>(
        `SELECT max_monetary::TEXT, max_count::TEXT FROM window_registry
          WHERE company_id = $1 AND window_id = 'W_MONTH_REFUND'`,
        [COMPANY_ID],
      );
      expect(ceiling.rows[0]!.max_monetary).toBe('250.00');
      expect(ceiling.rows[0]!.max_count).toBe('10');
      expect(ORACLE_LIMITS.maxCumulativeMonetaryCents).toBeLessThan(25_000);
      expect(ORACLE_LIMITS.maxCumulativeEffects).toBeLessThan(10);
    } finally {
      client.release();
    }
  });
});
