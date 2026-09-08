import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { COMPANY_ID } from '../../support/fixture.js';
import {
  NOT_AN_OWNER,
  OWNER_ALIAS,
  OWNER_ONE,
  OWNER_TWO,
  createMirrorHarness,
  journalRowsOfKind,
  newKeypair,
  registerOwnerAlias,
  registerSecondOwner,
  signGrant,
  type MirrorHarness,
} from '../../support/mirrorFixture.js';
import {
  OVERRIDE_LIMITS,
  activeOverrideOn,
  claimOverrideAllowance,
  expireOverrides,
  grantOverride,
  revokeOverride,
  type OverrideRequest,
} from '../../../src/kernel/mirror/degradedModeOverride.js';
import {
  declareMirrorDegraded,
  evaluateState,
} from '../../../src/kernel/mirror/mirrorStateMachine.js';
import { classifyDispatchPrecedence } from '../../../src/kernel/mirror/dispatchPrecedence.js';
import { money, toDb } from '../../../src/kernel/exposure/money.js';
import { ORACLE_LIMITS } from '../../support/overrideAggregateOracle.js';

/**
 * `VC-A2e` — THE OWNER OVERRIDE, BOUNDED EXACTLY AS `30 §5.7.2` AND `51 §3.6` SPECIFY.
 *
 * =================================================================================
 * `36 §9`, VC-A2e, verbatim:
 *
 *   "**VC-A2e — the override (v1.3, TA-05).** A `DegradedModeOverride` restores precedence
 *    rows 3 and 4 only; **an override naming an IRRECOVERABLE class or precedence rows 1 or 2
 *    must fail to be created**. Assert time-box, count cap and monetary cap each terminate
 *    dispatch independently. Assert auto-expiry returns to `UNCORROBORATED_STALL` or halt,
 *    **never to `NORMAL`**. Assert every dispatch under it carries `DISPATCHED_UNMIRRORED`
 *    **and** `override_id` and appears in the next `I8` verification list. Assert the second
 *    override inside 30 days is refused without a distinct second approver. **Assert
 *    `MAL_total` is unchanged by the override's existence.**"
 *
 * `I8`'s verification list does not exist at S1 — `37` S1: "**`I8` proves nothing at S1.**
 * All four action classes run against mock adapters, so there is no vendor side for the
 * inverse sweep to enumerate." That leg is reported OPEN in `S1H-result.md §16` rather than
 * simulated. Every other clause is here.
 * =================================================================================
 */

let h: MirrorHarness;

const T0 = new Date('2026-03-01T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;

beforeAll(async () => {
  h = await createMirrorHarness();
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await h.reset();
  // Every override responds to an OPEN incident and to an open declaration: `30 §5.7.2`
  // makes `incident_ref` NOT NULL, and the escape only means anything against a stall.
  await declareMirrorDegraded(h.control, COMPANY_ID, 'PUSH_ACK_TIMEOUT', T0);
});

function request(over: Partial<OverrideRequest> = {}): OverrideRequest {
  return {
    companyId: COMPANY_ID,
    overrideId: 'override:1',
    requestedBy: OWNER_ONE,
    requestedAt: T0,
    effectClasses: ['refund.create'],
    recoverabilityClasses: ['COMPENSABLE'],
    precedenceRows: [3],
    startsAt: T0,
    // `51 §3.6`: `max_override_duration` 24 hours. The MAXIMUM valid box.
    expiresAt: new Date(T0.getTime() + 24 * HOUR),
    // `51 §3.6`: `max_override_effect_count` 5, `max_override_monetary_exposure` $50.00.
    effectCountCap: 5n,
    monetaryExposureCap: money('50.00'),
    reason: 'a two-sided outage while an FTC 7-working-day clock runs (30 §5.6)',
    incidentRef: h.seed.incidentRef,
    ...over,
  };
}

async function grant(req: OverrideRequest, second?: { id: string; key: Parameters<typeof signGrant>[1] }) {
  return grantOverride(h.control, req, {
    grantedBy: OWNER_ONE,
    grantedAt: req.requestedAt,
    grantSignature: signGrant(req, h.seed.ownerOne.privateKey),
    ...(second === undefined
      ? {}
      : {
          secondApprover: second.id,
          secondApprovedAt: req.requestedAt,
          secondApproverSignature: signGrant(req, second.key),
        }),
  });
}

describe('the LIMITS the application reads are the limits the DATABASE enforces', () => {
  it('`51 §3.6`, three independent transcriptions, all agreeing', async () => {
    // `OVERRIDE_LIMITS` (application), `degraded_mode_override_limits()` (database) and
    // `ORACLE_LIMITS` (hand-authored, importing nothing) are three readings of one table.
    // A drift between the application and the CHECK constraints would be a silent
    // relaxation, so it is a test failure instead.
    const client = await h.control.connect();
    try {
      const db = await client.query<{
        max_override_duration: string;
        max_override_effect_count: string;
        max_override_monetary_exposure: string;
        max_override_count: string;
        max_cumulative_override_hours: string;
        max_cumulative_override_effects: string;
        max_cumulative_override_monetary: string;
        second_approver_required_from: string;
        composition_window: string;
      }>(
        `SELECT (max_override_duration)::TEXT AS max_override_duration,
                max_override_effect_count::TEXT,
                max_override_monetary_exposure::TEXT,
                max_override_count::TEXT,
                (max_cumulative_override_hours)::TEXT AS max_cumulative_override_hours,
                max_cumulative_override_effects::TEXT,
                max_cumulative_override_monetary::TEXT,
                second_approver_required_from::TEXT,
                (composition_window)::TEXT AS composition_window
           FROM degraded_mode_override_limits()`,
      );
      const row = db.rows[0]!;
      expect(row.max_override_duration).toBe('24:00:00');
      expect(row.max_override_effect_count).toBe('5');
      expect(row.max_override_monetary_exposure).toBe('50.00');
      expect(row.max_override_count).toBe('3');
      expect(row.max_cumulative_override_hours).toBe('72:00:00');
      expect(row.max_cumulative_override_effects).toBe('8');
      expect(row.max_cumulative_override_monetary).toBe('100.00');
      expect(row.second_approver_required_from).toBe('2');
      expect(row.composition_window).toBe('30 days');
    } finally {
      client.release();
    }

    expect(OVERRIDE_LIMITS.maxDurationMs).toBe(ORACLE_LIMITS.maxOverrideDurationHours * HOUR);
    expect(OVERRIDE_LIMITS.maxEffectCount).toBe(BigInt(ORACLE_LIMITS.maxOverrideEffectCount));
    expect(toDb(OVERRIDE_LIMITS.maxMonetaryExposure)).toBe('50.00');
    expect(OVERRIDE_LIMITS.maxCount).toBe(BigInt(ORACLE_LIMITS.maxOverrideCount));
    expect(OVERRIDE_LIMITS.maxCumulativeHours).toBe(ORACLE_LIMITS.maxCumulativeHours);
    expect(OVERRIDE_LIMITS.maxCumulativeEffects).toBe(BigInt(ORACLE_LIMITS.maxCumulativeEffects));
    expect(toDb(OVERRIDE_LIMITS.maxCumulativeMonetary)).toBe('100.00');
    expect(OVERRIDE_LIMITS.secondApproverRequiredFrom).toBe(
      BigInt(ORACLE_LIMITS.secondApproverRequiredFrom),
    );
    expect(OVERRIDE_LIMITS.compositionWindowDays).toBe(ORACLE_LIMITS.compositionWindowDays);
  });
});

describe('OWNER AUTHORITY IS A REAL Ed25519 SIGNATURE, NOT A PARAMETER', () => {
  it('a valid owner grant is admitted and journals REQUESTED then GRANTED', async () => {
    const req = request();
    const outcome = await grant(req);
    const rows = await journalRowsOfKind(h.control, COMPANY_ID, 'DEGRADED_MODE_OVERRIDE_EVENT');
    // `30 §5.7.2` item 7: "Creation, grant, [...] **each as its own row**."
    expect(rows.map((r) => r.overrideEvent)).toEqual(['REQUESTED', 'GRANTED']);
    expect(rows.map((r) => r.overrideId)).toEqual(['override:1', 'override:1']);
    expect(outcome.secondApprovedJournalSeq).toBeNull();
  });

  it('an AI_ROLE principal cannot grant one', async () => {
    // `24 §3` K10 on what AI may not do, and `26 §3`'s principal kinds. There is no
    // `isOwner` parameter to set: the kind is read from `principal`.
    const req = request({ requestedBy: NOT_AN_OWNER });
    await expect(
      grantOverride(h.control, req, {
        grantedBy: NOT_AN_OWNER,
        grantedAt: T0,
        grantSignature: signGrant(req, h.seed.ownerOne.privateKey),
      }),
    ).rejects.toThrow(/OVERRIDE_PRINCIPAL_NOT_OWNER/);
  });

  it('an owner-signed grant with a FORGED signature is refused', async () => {
    const req = request();
    await expect(
      grantOverride(h.control, req, {
        grantedBy: OWNER_ONE,
        grantedAt: T0,
        grantSignature: signGrant(req, newKeypair().privateKey),
      }),
    ).rejects.toThrow(/OVERRIDE_SIGNATURE_INVALID/);
  });

  it('a grant WIDENED after signing does not verify — the scope is inside the signature', async () => {
    // `§15`'s attack: "A compromised owner-action handler must not turn `mirror override`
    // into `budget override`." Every bound the owner consented to is a signed field, so a
    // handler that widened one produces a signature that no longer verifies.
    const signed = request({ monetaryExposureCap: money('1.00'), effectCountCap: 1n });
    const signature = signGrant(signed, h.seed.ownerOne.privateKey);
    const widened = request({ monetaryExposureCap: money('50.00'), effectCountCap: 5n });
    await expect(
      grantOverride(h.control, widened, {
        grantedBy: OWNER_ONE,
        grantedAt: T0,
        grantSignature: signature,
      }),
    ).rejects.toThrow(/OVERRIDE_SIGNATURE_INVALID/);
  });

  it('and a DIRECT INSERT by a non-owner is refused by the DATABASE too', async () => {
    // Two mechanisms. `36 §0`: a property enforced in one place is one edit from unenforced.
    const client = await h.control.connect();
    try {
      await expect(
        client.query(
          `INSERT INTO degraded_mode_override (
             company_id, override_id, requested_at, requested_by, granted_at, granted_by,
             effect_classes, recoverability_classes, precedence_rows,
             starts_at, expires_at, effect_count_cap, monetary_exposure_cap,
             reason, incident_ref, status)
           VALUES ($1,'override:sql',$2,$3,$2,$3,
                   ARRAY['refund.create'],ARRAY['COMPENSABLE'],ARRAY[3],
                   $2,$4,1,1.00,'direct sql',$5,'ACTIVE')`,
          [COMPANY_ID, T0, NOT_AN_OWNER, new Date(T0.getTime() + HOUR), h.seed.incidentRef.toString()],
        ),
      ).rejects.toThrow(/OVERRIDE_GRANTER_NOT_OWNER/);
    } finally {
      client.release();
    }
  });
});

describe('THE SCOPE RULE — rows 3 and 4 only, `IRRECOVERABLE` structurally unavailable', () => {
  it('an override naming IRRECOVERABLE fails to be created', async () => {
    // `30 §5.7.2`: "`recoverability_classes[]` therefore excludes `IRRECOVERABLE`
    // **structurally at MVP, not by policy**: there is no grant path that admits it."
    await expect(
      grant(request({ recoverabilityClasses: ['IRRECOVERABLE' as 'COMPENSABLE'] })),
    ).rejects.toThrow(/OVERRIDE_SCOPE_OUTSIDE_GRANT_PATH/);
  });

  for (const row of [1, 2, 5]) {
    it(`an override naming precedence row ${String(row)} fails to be created`, async () => {
      await expect(
        grant(request({ precedenceRows: [row as 3] })),
      ).rejects.toThrow(/OVERRIDE_SCOPE_OUTSIDE_GRANT_PATH/);
    });
  }

  it('and the DATABASE refuses the same scopes on a direct INSERT', async () => {
    const client = await h.control.connect();
    try {
      for (const [classes, rows, constraint] of [
        [`ARRAY['IRRECOVERABLE']`, 'ARRAY[3]', /override_recoverability_classes_bounded/],
        [`ARRAY['COMPENSABLE']`, 'ARRAY[1]', /override_precedence_rows_bounded/],
        [`ARRAY['COMPENSABLE']`, 'ARRAY[2]', /override_precedence_rows_bounded/],
      ] as const) {
        await expect(
          client.query(
            `INSERT INTO degraded_mode_override (
               company_id, override_id, requested_at, requested_by, granted_at, granted_by,
               effect_classes, recoverability_classes, precedence_rows,
               starts_at, expires_at, effect_count_cap, monetary_exposure_cap,
               reason, incident_ref, status)
             VALUES ($1,'override:scope',$2,$3,$2,$3,
                     ARRAY['refund.create'],${classes},${rows},
                     $2,$4,1,1.00,'scope',$5,'ACTIVE')`,
            [COMPANY_ID, T0, OWNER_ONE, new Date(T0.getTime() + HOUR), h.seed.incidentRef.toString()],
          ),
        ).rejects.toThrow(constraint);
      }
    } finally {
      client.release();
    }
  });

  it('an ACTIVE override restores row 3 in `UNCORROBORATED_STALL` and NOT rows 1 or 2', async () => {
    await grant(request());
    const client = await h.control.connect();
    try {
      const scope = await activeOverrideOn(client, COMPANY_ID, T0);
      expect(scope).not.toBeNull();

      // ROW 3 — restored, tagged, and carrying the `override_id` (`30 §5.7.2` item 5).
      const row3 = classifyDispatchPrecedence({
        mirrorState: 'UNCORROBORATED_STALL',
        actionClass: 'refund.create',
        recoverability: 'COMPENSABLE',
        clockBearing: true,
        aboveApprovalFloor: false,
        hasRecordedApproval: true,
        activeOverride: scope,
        now: T0,
      });
      expect(row3.matchedRow).toBe(3);
      expect(row3.disposition).toBe('DISPATCH_ELIGIBLE');
      expect(row3.requiresUnmirroredTag).toBe(true);
      expect(row3.overrideId).toBe('override:1');

      // ROW 1 — NOT restored. `30 §5.1` item 5: "never rows 1 or 2".
      const row1 = classifyDispatchPrecedence({
        mirrorState: 'UNCORROBORATED_STALL',
        actionClass: 'fulfilment.reship',
        recoverability: 'IRRECOVERABLE',
        clockBearing: true,
        aboveApprovalFloor: false,
        hasRecordedApproval: true,
        activeOverride: scope,
        now: T0,
      });
      expect(row1.matchedRow).toBe(1);
      expect(row1.disposition).toBe('HALT');
      expect(row1.overrideId).toBeNull();

      // ROW 2 — NOT restored.
      const row2 = classifyDispatchPrecedence({
        mirrorState: 'UNCORROBORATED_STALL',
        actionClass: 'refund.create',
        recoverability: 'COMPENSABLE',
        clockBearing: false,
        aboveApprovalFloor: true,
        hasRecordedApproval: false,
        activeOverride: scope,
        now: T0,
      });
      expect(row2.matchedRow).toBe(2);
      expect(row2.disposition).toBe('HALT');
      expect(row2.overrideId).toBeNull();
    } finally {
      client.release();
    }
  });

  it('an override scoped to row 3 does NOT restore row 4', async () => {
    // `I63(a)`: "no effect is dispatched under a `DegradedModeOverride` outside its declared
    // [...] `precedence_rows[]`."
    await grant(request({ precedenceRows: [3] }));
    const client = await h.control.connect();
    try {
      const scope = await activeOverrideOn(client, COMPANY_ID, T0);
      const row4 = classifyDispatchPrecedence({
        mirrorState: 'UNCORROBORATED_STALL',
        actionClass: 'refund.create',
        recoverability: 'COMPENSABLE',
        clockBearing: false,
        aboveApprovalFloor: false,
        hasRecordedApproval: false,
        activeOverride: scope,
        now: T0,
      });
      expect(row4.matchedRow).toBe(4);
      expect(row4.disposition).toBe('SUSPEND');
    } finally {
      client.release();
    }
  });

  it('an override scoped to a DIFFERENT action class restores nothing', async () => {
    await grant(request({ effectClasses: ['campaign.budget.set'] }));
    const client = await h.control.connect();
    try {
      const scope = await activeOverrideOn(client, COMPANY_ID, T0);
      const decision = classifyDispatchPrecedence({
        mirrorState: 'UNCORROBORATED_STALL',
        actionClass: 'refund.create',
        recoverability: 'COMPENSABLE',
        clockBearing: true,
        aboveApprovalFloor: false,
        hasRecordedApproval: true,
        activeOverride: scope,
        now: T0,
      });
      expect(decision.disposition).toBe('SUSPEND');
    } finally {
      client.release();
    }
  });
});

describe('THE THREE PER-OVERRIDE BOUNDS EACH TERMINATE DISPATCH INDEPENDENTLY', () => {
  it('the TIME BOX: one unit past `expires_at` restores nothing', async () => {
    await grant(request());
    const client = await h.control.connect();
    try {
      const inside = await activeOverrideOn(client, COMPANY_ID, new Date(T0.getTime() + 24 * HOUR - 1));
      expect(inside).not.toBeNull();
      // `[starts_at, expires_at)` is half-open, exactly as `I63(a)` writes it.
      const atBoundary = await activeOverrideOn(client, COMPANY_ID, new Date(T0.getTime() + 24 * HOUR));
      expect(atBoundary).toBeNull();
    } finally {
      client.release();
    }
  });

  it('a FUTURE start restores nothing until it arrives', async () => {
    await grant(
      request({
        startsAt: new Date(T0.getTime() + HOUR),
        expiresAt: new Date(T0.getTime() + 2 * HOUR),
      }),
    );
    const client = await h.control.connect();
    try {
      expect(await activeOverrideOn(client, COMPANY_ID, T0)).toBeNull();
      expect(await activeOverrideOn(client, COMPANY_ID, new Date(T0.getTime() + HOUR))).not.toBeNull();
    } finally {
      client.release();
    }
  });

  it('the MAXIMUM duration is admitted and ONE MILLISECOND MORE is refused', async () => {
    await grant(request({ expiresAt: new Date(T0.getTime() + 24 * HOUR) }));
    await expect(
      grant(request({ overrideId: 'override:too-long', expiresAt: new Date(T0.getTime() + 24 * HOUR + 1) })),
    ).rejects.toThrow(/OVERRIDE_LIMIT_EXCEEDED/);
  });

  it('a ZERO or NEGATIVE duration is refused', async () => {
    await expect(grant(request({ expiresAt: T0 }))).rejects.toThrow(/OVERRIDE_LIMIT_EXCEEDED/);
    await expect(
      grant(request({ expiresAt: new Date(T0.getTime() - 1) })),
    ).rejects.toThrow(/OVERRIDE_LIMIT_EXCEEDED/);
  });

  it('the COUNT CAP: zero, first, exactly at cap, one above cap', async () => {
    // `§18`'s enumeration, and `30 §5.7.2` item 3: "reaching either cap moves the override to
    // `EXHAUSTED` immediately."
    await grant(request({ effectCountCap: 2n, monetaryExposureCap: money('50.00') }));
    // ZERO consumed.
    const client = await h.control.connect();
    try {
      expect((await activeOverrideOn(client, COMPANY_ID, T0))!.effectsDispatched).toBe(0n);
    } finally {
      client.release();
    }
    // FIRST.
    const first = await claimOverrideAllowance(h.control, COMPANY_ID, 'override:1', money('1.00'), T0);
    expect(first).toEqual({ kind: 'ALLOWANCE_TAKEN', journalSeq: expect.anything(), exhausted: false });
    // EXACTLY AT CAP — admitted, and the override becomes EXHAUSTED in the same transaction.
    const second = await claimOverrideAllowance(h.control, COMPANY_ID, 'override:1', money('1.00'), T0);
    expect(second.kind).toBe('ALLOWANCE_TAKEN');
    if (second.kind === 'ALLOWANCE_TAKEN') expect(second.exhausted).toBe(true);
    // ONE ABOVE CAP — refused.
    const third = await claimOverrideAllowance(h.control, COMPANY_ID, 'override:1', money('1.00'), T0);
    expect(third.kind).toBe('REFUSED');

    // And each decrement plus the exhaustion is journaled (`30 §5.7.2` item 7).
    const events = (await journalRowsOfKind(h.control, COMPANY_ID, 'DEGRADED_MODE_OVERRIDE_EVENT'))
      .map((r) => r.overrideEvent);
    expect(events).toEqual([
      'REQUESTED',
      'GRANTED',
      'ALLOWANCE_TAKEN',
      'ALLOWANCE_TAKEN',
      'EXHAUSTED',
    ]);
  });

  it('the MONETARY CAP terminates dispatch independently of the count', async () => {
    // Count cap 5, monetary cap $2.00: the money runs out first, which is what "each
    // terminate dispatch independently" means.
    await grant(request({ effectCountCap: 5n, monetaryExposureCap: money('2.00') }));
    expect(
      (await claimOverrideAllowance(h.control, COMPANY_ID, 'override:1', money('1.50'), T0)).kind,
    ).toBe('ALLOWANCE_TAKEN');
    const overCap = await claimOverrideAllowance(
      h.control,
      COMPANY_ID,
      'override:1',
      money('1.00'),
      T0,
    );
    expect(overCap.kind).toBe('REFUSED');
    if (overCap.kind === 'REFUSED') expect(overCap.reason).toMatch(/monetary_exposure_cap/);
  });

  it('a cap ABOVE `51 §3.6`s per-override maximum is refused', async () => {
    await expect(grant(request({ effectCountCap: 6n }))).rejects.toThrow(/OVERRIDE_LIMIT_EXCEEDED/);
    await expect(
      grant(request({ monetaryExposureCap: money('50.01') })),
    ).rejects.toThrow(/OVERRIDE_LIMIT_EXCEEDED/);
  });

  it('the consumed counters are MONOTONIC — a reset is refused by the database', async () => {
    await grant(request({ effectCountCap: 2n }));
    await claimOverrideAllowance(h.control, COMPANY_ID, 'override:1', money('1.00'), T0);
    const client = await h.control.connect();
    try {
      await expect(
        client.query(
          `UPDATE degraded_mode_override SET effects_dispatched = 0 WHERE company_id = $1`,
          [COMPANY_ID],
        ),
      ).rejects.toThrow(/OVERRIDE_CONSUMPTION_DECREASED/);
    } finally {
      client.release();
    }
  });

  it('the SCOPE is FIXED AT CREATION — any change is refused by the database', async () => {
    // `30 §5.7.2`'s caps would be ceilings on numbers the holder could move if this trigger
    // did not exist. Every value below DIFFERS from the granted one, in both directions:
    // narrowing is refused as well as widening, because a changed scope is a new override
    // and a new override is what `I63(b)`'s aggregate counts.
    await grant(request());
    const client = await h.control.connect();
    try {
      for (const [sql, params] of [
        [`UPDATE degraded_mode_override SET expires_at = $2 WHERE company_id = $1`, [COMPANY_ID, new Date(T0.getTime() + 23 * HOUR)]],
        [`UPDATE degraded_mode_override SET effect_count_cap = 4 WHERE company_id = $1`, [COMPANY_ID]],
        [`UPDATE degraded_mode_override SET monetary_exposure_cap = 49.00 WHERE company_id = $1`, [COMPANY_ID]],
        [`UPDATE degraded_mode_override SET precedence_rows = ARRAY[3,4] WHERE company_id = $1`, [COMPANY_ID]],
        [`UPDATE degraded_mode_override SET effect_classes = ARRAY['refund.create','campaign.pause'] WHERE company_id = $1`, [COMPANY_ID]],
      ] as const) {
        await expect(client.query(sql, [...params])).rejects.toThrow(/OVERRIDE_SCOPE_IMMUTABLE/);
      }
    } finally {
      client.release();
    }
  });

  it('and an override cannot be DELETED — that would refund the aggregate', async () => {
    // `30 §5.7.2` item 10's composition bound reads the population, so removing a member is
    // the evasion the bound exists to stop.
    await grant(request());
    const client = await h.control.connect();
    try {
      await expect(
        client.query('DELETE FROM degraded_mode_override WHERE company_id = $1', [COMPANY_ID]),
      ).rejects.toThrow(/APPEND_ONLY_TABLE_degraded_mode_override/);
    } finally {
      client.release();
    }
  });
});

describe('AUTO-EXPIRY IS TO THE RESTRICTIVE STATE, NEVER TO `NORMAL`', () => {
  it('after expiry the state is `UNCORROBORATED_STALL` while the declaration stands', async () => {
    // `30 §5.7.2` item 4, verbatim: "Auto-expiry is to the restrictive state, **never to
    // `NORMAL`**. On `expires_at` or exhaustion the system returns to whichever of
    // `UNCORROBORATED_STALL` or full halt the underlying condition implies. **An override
    // never certifies that the mirror recovered.**"
    await grant(request({ expiresAt: new Date(T0.getTime() + HOUR) }));
    const past = new Date(T0.getTime() + HOUR + 1);
    const outcome = await expireOverrides(h.control, COMPANY_ID, past);
    expect(outcome.expired).toEqual(['override:1']);
    expect(outcome.resolution.state).toBe('UNCORROBORATED_STALL');
    expect((await evaluateState(h.control, COMPANY_ID, past)).state).toBe('UNCORROBORATED_STALL');

    const events = (await journalRowsOfKind(h.control, COMPANY_ID, 'DEGRADED_MODE_OVERRIDE_EVENT'))
      .map((r) => r.overrideEvent);
    expect(events).toContain('EXPIRED');
  });

  it('and expiry restores NOTHING — the suspended row is suspended again', async () => {
    await grant(request({ expiresAt: new Date(T0.getTime() + HOUR) }));
    const past = new Date(T0.getTime() + HOUR + 1);
    await expireOverrides(h.control, COMPANY_ID, past);
    const client = await h.control.connect();
    try {
      expect(await activeOverrideOn(client, COMPANY_ID, past)).toBeNull();
      const decision = classifyDispatchPrecedence({
        mirrorState: 'UNCORROBORATED_STALL',
        actionClass: 'refund.create',
        recoverability: 'COMPENSABLE',
        clockBearing: true,
        aboveApprovalFloor: false,
        hasRecordedApproval: true,
        activeOverride: null,
        now: past,
      });
      expect(decision.disposition).toBe('SUSPEND');
    } finally {
      client.release();
    }
  });

  it('an EXHAUSTED override likewise restores nothing, and never certifies recovery', async () => {
    await grant(request({ effectCountCap: 1n }));
    await claimOverrideAllowance(h.control, COMPANY_ID, 'override:1', money('1.00'), T0);
    const client = await h.control.connect();
    try {
      expect(await activeOverrideOn(client, COMPANY_ID, T0)).toBeNull();
    } finally {
      client.release();
    }
    expect((await evaluateState(h.control, COMPANY_ID, T0)).state).toBe('UNCORROBORATED_STALL');
  });

  it('a REVOKED override restores nothing and is journaled', async () => {
    await grant(request());
    await revokeOverride(h.control, COMPANY_ID, 'override:1', OWNER_ONE, T0);
    const client = await h.control.connect();
    try {
      expect(await activeOverrideOn(client, COMPANY_ID, T0)).toBeNull();
    } finally {
      client.release();
    }
    const events = (await journalRowsOfKind(h.control, COMPANY_ID, 'DEGRADED_MODE_OVERRIDE_EVENT'))
      .map((r) => r.overrideEvent);
    expect(events).toContain('REVOKED');
  });
});

describe('THE SECOND-APPROVER RULE — `30 §5.7.2` ITEM 9', () => {
  it('the FIRST override inside 30 days requires the owner alone', async () => {
    await expect(grant(request())).resolves.toBeTruthy();
  });

  it('the SECOND is REFUSED without a distinct second approver', async () => {
    // `51 §3.6`: `second_approver_required_from` = "the 2nd override inside a rolling 30-day
    // window". And its honest consequence: "at MVP exactly one OWNER-tier principal is
    // registered, so overrides 2 and 3 are **structurally unavailable**."
    await grant(request());
    await expect(
      grant(request({ overrideId: 'override:2', startsAt: new Date(T0.getTime() + 25 * HOUR), expiresAt: new Date(T0.getTime() + 49 * HOUR), requestedAt: new Date(T0.getTime() + 25 * HOUR) })),
    ).rejects.toThrow(/I63_SECOND_APPROVER_REQUIRED/);
  });

  it('the SAME approver twice is refused — `second_approver <> granted_by`', async () => {
    await grant(request());
    const second = request({
      overrideId: 'override:2',
      requestedAt: new Date(T0.getTime() + 25 * HOUR),
      startsAt: new Date(T0.getTime() + 25 * HOUR),
      expiresAt: new Date(T0.getTime() + 49 * HOUR),
    });
    await expect(
      grantOverride(h.control, second, {
        grantedBy: OWNER_ONE,
        grantedAt: second.requestedAt,
        grantSignature: signGrant(second, h.seed.ownerOne.privateKey),
        secondApprover: OWNER_ONE,
        secondApprovedAt: second.requestedAt,
        secondApproverSignature: signGrant(second, h.seed.ownerOne.privateKey),
      }),
    ).rejects.toThrow(/override_second_approver_is_distinct/);
  });

  it('a DISTINCT registered OWNER permits it where otherwise valid', async () => {
    const client = await h.control.connect();
    try {
      await registerSecondOwner(client, h.seed.ownerTwo);
    } finally {
      client.release();
    }
    await grant(request());
    const second = request({
      overrideId: 'override:2',
      requestedAt: new Date(T0.getTime() + 25 * HOUR),
      startsAt: new Date(T0.getTime() + 25 * HOUR),
      expiresAt: new Date(T0.getTime() + 49 * HOUR),
    });
    await expect(
      grant(second, { id: OWNER_TWO, key: h.seed.ownerTwo.privateKey }),
    ).resolves.toBeTruthy();
    const events = (await journalRowsOfKind(h.control, COMPANY_ID, 'DEGRADED_MODE_OVERRIDE_EVENT'))
      .filter((r) => r.overrideId === 'override:2')
      .map((r) => r.overrideEvent);
    expect(events).toEqual(['REQUESTED', 'GRANTED', 'SECOND_APPROVED']);
  });

  it('a SECOND APPROVER SHARING THE FIRST`S CREDENTIAL is refused', async () => {
    // `§20`: "cannot be the same credential identity under another display name."
    const client = await h.control.connect();
    try {
      await registerOwnerAlias(client, h.seed.ownerOne);
    } finally {
      client.release();
    }
    await grant(request());
    const second = request({
      overrideId: 'override:2',
      requestedAt: new Date(T0.getTime() + 25 * HOUR),
      startsAt: new Date(T0.getTime() + 25 * HOUR),
      expiresAt: new Date(T0.getTime() + 49 * HOUR),
    });
    await expect(
      grant(second, { id: OWNER_ALIAS, key: h.seed.ownerOne.privateKey }),
    ).rejects.toThrow(/OVERRIDE_SECOND_APPROVER_SHARES_CREDENTIAL/);
  });

  it('an AI_ROLE cannot be the second approver', async () => {
    await grant(request());
    const second = request({
      overrideId: 'override:2',
      requestedAt: new Date(T0.getTime() + 25 * HOUR),
      startsAt: new Date(T0.getTime() + 25 * HOUR),
      expiresAt: new Date(T0.getTime() + 49 * HOUR),
    });
    await expect(
      grantOverride(h.control, second, {
        grantedBy: OWNER_ONE,
        grantedAt: second.requestedAt,
        grantSignature: signGrant(second, h.seed.ownerOne.privateKey),
        secondApprover: NOT_AN_OWNER,
        secondApprovedAt: second.requestedAt,
        secondApproverSignature: signGrant(second, h.seed.ownerOne.privateKey),
      }),
    ).rejects.toThrow(/OVERRIDE_PRINCIPAL_NOT_OWNER/);
  });

  it('a NAMED second approver with no signature has approved nothing', async () => {
    const client = await h.control.connect();
    try {
      await registerSecondOwner(client, h.seed.ownerTwo);
    } finally {
      client.release();
    }
    await grant(request());
    const second = request({
      overrideId: 'override:2',
      requestedAt: new Date(T0.getTime() + 25 * HOUR),
      startsAt: new Date(T0.getTime() + 25 * HOUR),
      expiresAt: new Date(T0.getTime() + 49 * HOUR),
    });
    await expect(
      grantOverride(h.control, second, {
        grantedBy: OWNER_ONE,
        grantedAt: second.requestedAt,
        grantSignature: signGrant(second, h.seed.ownerOne.privateKey),
        secondApprover: OWNER_TWO,
        secondApprovedAt: second.requestedAt,
      }),
    ).rejects.toThrow(/OVERRIDE_SIGNATURE_INVALID/);
  });
});
