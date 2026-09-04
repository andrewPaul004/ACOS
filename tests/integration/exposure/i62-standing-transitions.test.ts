import { afterAll, beforeEach, beforeAll, describe, expect, it } from 'vitest';

import { inTransaction, type Client } from '../../../src/db/pool.js';
import { SQLSTATE, hasSqlstate } from '../../../src/kernel/exposure/errors.js';
import { COMPANY_ID, createHarness, type Harness } from '../../support/fixture.js';

/**
 * I62 — the StandingAuthorization transition trigger. Partial VC-S2, S1A scope.
 *
 * Registry §1.2 I62, verbatim:
 *   "Every StandingAuthorization transition is in the declared transition set of
 *    24 §3.1 (T1–T8), and REVOKED has no outbound transition."
 * Enforcement, verbatim:
 *   "DB (BEFORE UPDATE trigger over (OLD.status, NEW.status) against the declared set)"
 * Test, verbatim:
 *   "Attempt every permitted transition and assert it succeeds; attempt representative
 *    forbidden transitions and assert refusal, with REVOKED → EXPIRED called out
 *    explicitly and required to fail."
 *
 * `24 §3.1` on why: v1.2's "any → EXPIRED" admitted REVOKED → EXPIRED, so "a revoked
 * authorisation would re-enter EXPIRED at expires_at, re-acquiring forward exposure it
 * had already released, while I55 fired STANDING_UNREVOCABLE at CRITICAL."
 *
 * WHY I62 IS IN S1A AT ALL. VC-S5 drives an authorisation through LIVE → PAUSE_PENDING →
 * PAUSED. Those transitions must be legal and their neighbours illegal, or the boundary
 * test is running against an unconstrained status column.
 *
 * WHAT IS NOT IN S1A. I54's cessation verification, the expiry sweep, the pause dispatch
 * and the PAUSE_PENDING retry (TB-11). T7 and T8 are DECLARED in the transition set and
 * are structurally unreachable, because `standing_revoked_requires_cessation` demands a
 * `cessation_verified_at` that no code path sets — which is `51 §3.2`'s conservative
 * default: "Cessation specification undeclared → no REVOKED transition exists."
 */

const ALL_STATUSES = ['LIVE', 'PAUSE_PENDING', 'PAUSED', 'EXPIRED', 'REVOKED'] as const;

/** `24 §3.1`'s table T1–T8, transcribed by hand. Not read from the database. */
const DECLARED: readonly (readonly [string, string])[] = [
  ['LIVE', 'PAUSE_PENDING'], // T1
  ['PAUSE_PENDING', 'PAUSED'], // T2
  ['PAUSE_PENDING', 'PAUSE_PENDING'], // T3
  ['LIVE', 'EXPIRED'], // T4
  ['PAUSE_PENDING', 'EXPIRED'], // T5
  ['PAUSED', 'EXPIRED'], // T6
  ['PAUSED', 'REVOKED'], // T7
  ['EXPIRED', 'REVOKED'], // T8
];

let harness: Harness;
let client: Client;

beforeAll(async () => {
  harness = await createHarness();
  client = await harness.connect();
});

beforeEach(async () => {
  await harness.reset();
});

afterAll(async () => {
  client?.release();
  await harness?.close();
});

async function seed(status: string, cessationVerified: boolean): Promise<void> {
  await inTransaction(client, 'SERIALIZABLE', async (tx) => {
    await tx.query(
      `INSERT INTO standing_revocation_authority (
         revocation_authority_id, company_id, standing_authorization_id,
         action_class_selector, resource_selector, per_action_max_monetary,
         expires_at, created_by)
       VALUES ('sra_t', $1, 'sa_t', 'campaign.pause', 'campaign/1', 0.00,
               '2026-02-03T00:00:00Z', 'KERNEL')`,
      [COMPANY_ID],
    );
    await tx.query(
      `INSERT INTO standing_authorization (
         standing_authorization_id, company_id, action_class, resource_ref, adapter,
         rate_amount, rate_currency, rate_period, created_at, expires_at,
         cessation_grace_hours, revocation_effect_class, revocation_authority_id,
         status, cessation_verified_at)
       VALUES ('sa_t', $1, 'campaign.budget.set', 'campaign/1', 'google_ads',
               6.00, 'USD', 'day', '2026-01-01T00:00:00Z', '2026-01-31T23:59:59Z',
               72, 'campaign.pause', 'sra_t', $2, $3)`,
      [COMPANY_ID, status, cessationVerified ? new Date('2026-01-20T00:00:00Z') : null],
    );
  });
}

async function attempt(to: string): Promise<unknown> {
  try {
    await client.query(
      `UPDATE standing_authorization SET status = $1 WHERE standing_authorization_id = 'sa_t'`,
      [to],
    );
    return null;
  } catch (error) {
    return error;
  }
}

describe('I62 — every DECLARED transition is permitted', () => {
  for (const [from, to] of DECLARED) {
    it(`${from} -> ${to} succeeds`, async () => {
      // T7 and T8 reach REVOKED, which `standing_revoked_requires_cessation` gates on
      // cessation_verified_at (I54). The row is seeded with it present so THIS test
      // exercises I62's transition set rather than I54's precondition; the
      // unreachability of REVOKED in practice is asserted separately below.
      const needsCessation = to === 'REVOKED';
      await seed(from, needsCessation);
      const error = await attempt(to);
      expect(error, `${from} -> ${to} was refused: ${String(error)}`).toBeNull();

      const result = await client.query<{ status: string }>(
        `SELECT status FROM standing_authorization WHERE standing_authorization_id = 'sa_t'`,
      );
      expect(result.rows[0]?.status).toBe(to);
    });
  }
});

describe('I62 — every UNDECLARED transition is refused, by the DATABASE', () => {
  const declaredSet = new Set(DECLARED.map(([from, to]) => `${from}->${to}`));
  const forbidden: [string, string][] = [];
  for (const from of ALL_STATUSES) {
    for (const to of ALL_STATUSES) {
      if (from === to && to !== 'PAUSE_PENDING') continue; // a no-op status update
      if (declaredSet.has(`${from}->${to}`)) continue;
      forbidden.push([from, to]);
    }
  }

  for (const [from, to] of forbidden) {
    it(`${from} -> ${to} is refused`, async () => {
      await seed(from, true);
      const error = await attempt(to);
      expect(error, `${from} -> ${to} was PERMITTED`).not.toBeNull();
      expect(
        hasSqlstate(error, SQLSTATE.I62_ILLEGAL_TRANSITION) ||
          // A CHECK constraint may refuse first for REVOKED-sourced attempts; either is
          // a database refusal, which is what I62's enforcement column requires.
          String(error).includes('standing_revoked_requires_cessation'),
        `refused, but not by I62's trigger: ${String(error)}`,
      ).toBe(true);
    });
  }

  it('REVOKED -> EXPIRED must fail — called out explicitly (TB-06)', async () => {
    // `24 §3.1`: v1.2's `any → EXPIRED` admitted this, "re-acquiring forward exposure it
    // had already released". VC-S2 requires this case by name.
    await seed('REVOKED', true);
    const error = await attempt('EXPIRED');
    expect(error, 'REVOKED -> EXPIRED was PERMITTED; exposure could be resurrected')
      .not.toBeNull();
    expect(hasSqlstate(error, SQLSTATE.I62_ILLEGAL_TRANSITION)).toBe(true);

    const result = await client.query<{ status: string }>(
      `SELECT status FROM standing_authorization WHERE standing_authorization_id = 'sa_t'`,
    );
    expect(result.rows[0]?.status).toBe('REVOKED');
  });

  it('REVOKED has ZERO outbound rows in the declared set', async () => {
    const result = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM standing_transition_set WHERE from_status = 'REVOKED'`,
    );
    expect(result.rows[0]?.n).toBe('0');
  });

  it('the refusal comes from the trigger, with the application check absent', async () => {
    // There is no application-level transition check in `src/` to disable — every
    // transition in this repository is an UPDATE straight to the column. The registry's
    // requirement, "An illegal transition attempted with the application check disabled
    // must still fail", is therefore satisfied by construction, and this test states it.
    await seed('LIVE', true);
    const error = await attempt('REVOKED');
    expect(hasSqlstate(error, SQLSTATE.I62_ILLEGAL_TRANSITION)).toBe(true);
  });
});

describe('I54 — REVOKED is structurally unavailable at MVP (TB-07)', () => {
  it('a transition to REVOKED without cessation_verified_at is refused', async () => {
    // `51 §3.2`: "Cessation specification undeclared → no REVOKED transition exists.
    // I54 cannot be satisfied, so forward exposure is held to the close of the last
    // in-scope window instance."
    await seed('PAUSED', false);
    const error = await attempt('REVOKED');
    expect(error).not.toBeNull();
    expect(String(error)).toContain('standing_revoked_requires_cessation');
  });

  it('no code path in src/ sets cessation_verified_at', async () => {
    const { readdir, readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const offenders: string[] = [];

    async function walk(dir: string): Promise<void> {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(path);
          continue;
        }
        if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.sql')) continue;
        const contents = await readFile(path, 'utf8');
        const code = contents
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/(^|[^:])(\/\/|--).*$/gm, '$1');
        if (/cessation_verified_at\s*=/.test(code) || /SET[\s\S]{0,80}cessation_verified_at/.test(code)) {
          offenders.push(path);
        }
      }
    }

    await walk(join(process.cwd(), 'src'));
    expect(
      offenders,
      `62 §9 prohibition 3 forbids cessation measurement until TB-07 declares the ` +
        `specification. These files write cessation_verified_at:\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });
});
