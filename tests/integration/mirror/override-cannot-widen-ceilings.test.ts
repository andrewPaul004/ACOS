import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { COMPANY_ID, WINDOWS } from '../../support/fixture.js';
import {
  OWNER_ONE,
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
import { ORACLE_LIMITS } from '../../support/overrideAggregateOracle.js';

/**
 * `§15` — THE OVERRIDE CANNOT WIDEN A MONEY CEILING. SCHEMA, SOURCE AND BEHAVIOUR.
 *
 * =================================================================================
 * `30 §5.7.2` SEMANTICS ITEM 1, verbatim:
 *
 *   "**It changes no ceiling.** Every effect dispatched under it still traverses the full
 *    policy sequence, still reserves, and is still bound by `I3`. The override releases a
 *    **dispatch gate**, never an exposure gate. **`MAL_total` is unchanged by an override's
 *    existence** and no re-signature is triggered — which is checkable, because every
 *    override limit in `51 §3.6` is strictly below the corresponding already-signed window
 *    ceiling."
 *
 * `§15` OF THE S1H MANDATE:
 *
 *   "It must NEVER change: MAL; window ceilings; per-action monetary caps; existing S1
 *    reservations; grants; Cedar operands; exposure arithmetic. **Add a database/type/source
 *    test ensuring the override structure has no field capable of mutating monetary
 *    authority.** A compromised owner-action handler must not turn `mirror override` into
 *    `budget override`."
 *
 * THREE INDEPENDENT ASSERTIONS BELOW: the SCHEMA has no such field, the SOURCE has no such
 * statement, and the BEHAVIOUR leaves every ceiling and balance byte-identical.
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
  await declareMirrorDegraded(h.control, COMPANY_ID, 'PUSH_ACK_TIMEOUT', T0);
});

async function grantMaximum(): Promise<void> {
  const req: OverrideRequest = {
    companyId: COMPANY_ID,
    overrideId: 'override:max',
    requestedBy: OWNER_ONE,
    requestedAt: T0,
    // The WIDEST scope `30 §5.7.2` admits: both grantable classes, both grantable rows,
    // every catalogued class, the maximum time box and both maximum caps.
    effectClasses: ['refund.create', 'campaign.pause', 'campaign.budget.set', 'fulfilment.reship'],
    recoverabilityClasses: ['COMPENSABLE', 'REVERSIBLE'],
    precedenceRows: [3, 4],
    startsAt: T0,
    expiresAt: new Date(T0.getTime() + 24 * HOUR),
    effectCountCap: 5n,
    monetaryExposureCap: money('50.00'),
    reason: 'the widest override the architecture admits (§15)',
    incidentRef: h.seed.incidentRef,
  };
  await grantOverride(h.control, req, {
    grantedBy: OWNER_ONE,
    grantedAt: T0,
    grantSignature: signGrant(req, h.seed.ownerOne.privateKey),
  });
}

describe('SCHEMA — `degraded_mode_override` has no field that names monetary authority', () => {
  it('no column references a window, a grant, a reservation or a standing authorisation', async () => {
    const client = await h.control.connect();
    try {
      const columns = await client.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_name = 'degraded_mode_override'`,
      );
      const names = columns.rows.map((r) => r.column_name);
      for (const forbidden of [
        'window_id',
        'window_instance_key',
        'authority_grant_id',
        'grant_id',
        'reservation_id',
        'standing_authorization_id',
        'per_action_max',
        'max_monetary',
        'max_count',
        'mal_total',
        'ceiling',
        'headroom',
      ]) {
        expect(names, `a column named ${forbidden}`).not.toContain(forbidden);
      }
    } finally {
      client.release();
    }
  });

  it('and no FOREIGN KEY reaches a money table', async () => {
    // The override's only foreign keys are to `company`, `principal` (three times) and
    // `incident`. NONE of those is a money object.
    const client = await h.control.connect();
    try {
      const fks = await client.query<{ target: string }>(
        `SELECT confrelid::regclass::TEXT AS target FROM pg_constraint
          WHERE conrelid = 'degraded_mode_override'::regclass AND contype = 'f'`,
      );
      const targets = new Set(fks.rows.map((r) => r.target));
      expect([...targets].sort()).toEqual(['company', 'incident', 'principal']);
      for (const money of [
        'window_registry',
        'window_balance',
        'authority_grant',
        'authority_grant_window',
        'exposure_reservation',
        'standing_authorization',
        'standing_window_exposure',
      ]) {
        expect(targets, `a foreign key to ${money}`).not.toContain(money);
      }
    } finally {
      client.release();
    }
  });

  it('`monetary_exposure_cap` is a CEILING ON ITSELF, bounded by `51 §3.6` at $50.00', async () => {
    // The only monetary column on the table, and it can only ever be spent DOWN from a value
    // the CHECK bounds at $50.00. There is no arithmetic anywhere that writes it into a
    // window, a grant or a reservation.
    const client = await h.control.connect();
    try {
      const checks = await client.query<{ def: string }>(
        `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
          WHERE conrelid = 'degraded_mode_override'::regclass
            AND conname = 'override_monetary_cap_bounded'`,
      );
      expect(checks.rows[0]!.def).toMatch(/50\.00/);
    } finally {
      client.release();
    }
  });
});

describe('SOURCE — the override module contains no statement touching a money table', () => {
  it('`degradedModeOverride.ts` names no money relation', async () => {
    const code = stripComments(
      await readFile(
        join(process.cwd(), 'src', 'kernel', 'mirror', 'degradedModeOverride.ts'),
        'utf8',
      ),
    );
    for (const relation of [
      'window_balance',
      'window_registry',
      'authority_grant',
      'exposure_reservation',
      'standing_window_exposure',
      'standing_authorization',
      'reservation_window_instance',
      'authorisation_window_instance',
    ]) {
      expect(code, `the module names ${relation}`).not.toContain(relation);
    }
  });

  it('no file under `src/kernel/mirror/` or `src/kernel/clocks/` writes to a money table', async () => {
    // The whole S1H kernel surface, not only the override module — because a mirror module
    // that adjusted a window would be the same defect in a different file.
    const offenders: string[] = [];
    for (const dir of [
      join(process.cwd(), 'src', 'kernel', 'mirror'),
      join(process.cwd(), 'src', 'kernel', 'clocks'),
    ]) {
      for (const name of await readdir(dir)) {
        if (!name.endsWith('.ts')) continue;
        const code = stripComments(await readFile(join(dir, name), 'utf8'));
        for (const pattern of [
          /(INSERT\s+INTO|UPDATE)\s+window_balance/i,
          /(INSERT\s+INTO|UPDATE)\s+window_registry/i,
          /(INSERT\s+INTO|UPDATE)\s+authority_grant/i,
          /(INSERT\s+INTO|UPDATE)\s+exposure_reservation/i,
          /(INSERT\s+INTO|UPDATE)\s+standing_/i,
          /realised_monetary/,
          /reserved_monetary/,
          /standing_monetary/,
          /presumed_monetary/,
          /max_monetary/,
        ]) {
          if (pattern.test(code)) offenders.push(`${name} (${String(pattern)})`);
        }
      }
    }
    expect(
      offenders,
      `S1H kernel code touching monetary authority:\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });
});

describe('BEHAVIOUR — a MAXIMUM override changes no ceiling and no balance', () => {
  it('every `window_registry` ceiling is byte-identical before and after', async () => {
    const before = await snapshotCeilings();
    await grantMaximum();
    await claimOverrideAllowance(h.control, COMPANY_ID, 'override:max', money('25.00'), T0);
    const after = await snapshotCeilings();
    expect(after).toEqual(before);
  });

  it('every `window_balance` term is byte-identical before and after', async () => {
    // `I3`'s four terms. `30 §5.7.2`: "Every effect dispatched under it still traverses the
    // full policy sequence, **still reserves**, and is still bound by `I3`." The override
    // itself moves none of them; the reservation the effect would take is `26 §7` step R's
    // work and is untouched by this slice.
    const before = await snapshotBalances();
    await grantMaximum();
    await claimOverrideAllowance(h.control, COMPANY_ID, 'override:max', money('50.00'), T0);
    const after = await snapshotBalances();
    expect(after).toEqual(before);
  });

  it('the grant set and its windows are byte-identical before and after', async () => {
    const before = await snapshotGrants();
    await grantMaximum();
    const after = await snapshotGrants();
    expect(after).toEqual(before);
  });

  it('`MAL_monetary` recomputed from the registry is unchanged — `$300.00`', async () => {
    // `51 §4.1`: "**`MAL_monetary(month) = $300.00` is the figure the owner signs.**"
    // Recomputed here from the seeded MONTH windows, before and after the widest override
    // this architecture admits, so "no re-signature is triggered" is a measured fact.
    const before = await malMonetaryMonth();
    expect(before).toBe('300.00');
    await grantMaximum();
    await claimOverrideAllowance(h.control, COMPANY_ID, 'override:max', money('50.00'), T0);
    expect(await malMonetaryMonth()).toBe('300.00');
  });

  it('and `51 §3.6`s safety argument is arithmetic, not assertion', async () => {
    // "every monetary and count aggregate is **strictly below** the already-signed window
    // ceiling it draws against: `$100.00` against `W_MONTH_REFUND`'s `$250.00`, and 8
    // effects against its count of 10."
    const refund = WINDOWS.find((w) => w.windowId === 'W_MONTH_REFUND')!;
    expect(refund.maxMonetary).toBe('250.00');
    expect(refund.maxCount).toBe('10');
    expect(ORACLE_LIMITS.maxCumulativeMonetaryCents).toBe(10_000);
    expect(ORACLE_LIMITS.maxCumulativeMonetaryCents).toBeLessThan(25_000);
    expect(ORACLE_LIMITS.maxCumulativeEffects).toBe(8);
    expect(ORACLE_LIMITS.maxCumulativeEffects).toBeLessThan(10);
  });
});

// =====================================================================================
// Helpers
// =====================================================================================

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

async function snapshotCeilings(): Promise<unknown> {
  const client = await h.control.connect();
  try {
    const rows = await client.query(
      `SELECT window_id, max_monetary::TEXT, max_monetary_unbounded, max_count::TEXT,
              max_count_unbounded, max_irrecoverable_units::TEXT, max_irrecoverable_unbounded
         FROM window_registry WHERE company_id = $1 ORDER BY window_id`,
      [COMPANY_ID],
    );
    return rows.rows;
  } finally {
    client.release();
  }
}

async function snapshotBalances(): Promise<unknown> {
  const client = await h.control.connect();
  try {
    const rows = await client.query(
      // `I3`'s four terms, by their real column names: reserved (open), standing (forward),
      // presumed (unresolved) and realised (settled), across money, count and the split
      // irrecoverable counter.
      `SELECT window_id, window_instance_key,
              reserved_monetary::TEXT, standing_monetary::TEXT, presumed_monetary::TEXT,
              realised_monetary::TEXT,
              reserved_count::TEXT, standing_count::TEXT, presumed_count::TEXT,
              realised_count::TEXT,
              reserved_irrecoverable::TEXT, presumed_irrecoverable::TEXT,
              realised_irrecoverable::TEXT
         FROM window_balance WHERE company_id = $1
        ORDER BY window_id, window_instance_key`,
      [COMPANY_ID],
    );
    return rows.rows;
  } finally {
    client.release();
  }
}

async function snapshotGrants(): Promise<unknown> {
  const client = await h.control.connect();
  try {
    const grants = await client.query(
      `SELECT * FROM authority_grant WHERE company_id = $1 ORDER BY grant_id`,
      [COMPANY_ID],
    );
    const windows = await client.query(
      `SELECT * FROM authority_grant_window WHERE company_id = $1
        ORDER BY grant_id, window_id`,
      [COMPANY_ID],
    );
    return { grants: grants.rows, windows: windows.rows };
  } finally {
    client.release();
  }
}

/**
 * `MAL_monetary(month)`, recomputed from the registry, INDEPENDENTLY of any production
 * module.
 *
 * `26 §10.1`'s formula as `51 §4.1` applies it: the MONTH windows' monetary ceilings summed,
 * with `W_*_OVERRIDE` windows at `0.00` because no override window is activated. Written out
 * here rather than imported, because a helper that computed it through production code would
 * make "unchanged" a statement about production agreeing with itself.
 */
async function malMonetaryMonth(): Promise<string> {
  const client = await h.control.connect();
  try {
    const rows = await client.query<{ window_id: string; max_monetary: string }>(
      `SELECT window_id, max_monetary::TEXT FROM window_registry
        WHERE company_id = $1 AND period = 'MONTH' AND NOT max_monetary_unbounded
        ORDER BY window_id`,
      [COMPANY_ID],
    );
    // `51 §4.1`: `W_MONTH_REFUND` $250.00 + `W_MONTH_CREDIT` $50.00 = $300.00. The ad-spend
    // window carries `Standing(month)` and is not part of `MAL_monetary`; the two override
    // windows are `0.00` until signed.
    const cents = rows.rows
      .filter((r) => r.window_id === 'W_MONTH_REFUND' || r.window_id === 'W_MONTH_CREDIT')
      .reduce((sum, r) => sum + Math.round(Number(r.max_monetary) * 100), 0);
    return (cents / 100).toFixed(2);
  } finally {
    client.release();
  }
}
