import type { PoolClient } from 'pg';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createHarness, type Harness } from '../../support/fixture.js';
import { loadCommerceFixture } from '../../support/enumerationFixture.js';
import { loadAuthorityWorld, loadS1eOrders } from '../../support/authorityFixture.js';
import {
  COMPANY_ID,
  EXPECTED_RATE_WINDOWS,
  RATE_RESOURCE_REF,
  S1F_EXPECTED,
  authoriseRateLocally,
  countOf,
  expectedInstanceKey,
  makeLocalAuthorityHarness,
  rateExtension,
  rateFacts,
  rowsOf,
  scalar,
  type LocalAuthorityHarness,
} from '../../support/localAuthorisationFixture.js';
import {
  unsafeRateOmitsReservationRow,
  unsafeRateReservesForwardIntegral,
} from '../../negative-controls/unsafe-local-authorisation.js';
import { money } from '../../../src/kernel/exposure/money.js';

/**
 * THE RATE CLASS THROUGH S1F — `26 §2.1.3`'s handoff, committed atomically.
 *
 * =====================================================================================
 * THE RULE, VERBATIM
 *
 * `26 §7` step R's rate branch, as restated by `phase2-v1.3.1-errata.md §1`:
 *
 *   "**Rate class.** `exposure.total_exposure` is `0.00` (`§2.1.3`), so step R creates a
 *    **real zero-amount reservation row** — `reservation.amount == exposure.total_exposure
 *    == 0.00`, satisfying `I2` without a carve-out and `I18b` exactly — and **in the same
 *    transaction** creates the `StandingAuthorization`, its `StandingRevocationAuthority`
 *    (`I55`) and the `standing_window_exposure` rows whose `forward_monetary` enters `I3`
 *    **term 2**. **`forward_integral` is never the ordinary reservation amount.**"
 *
 * `26 §2.1.3`'s worked January example, transcribed:
 *
 *   standing_cap(W_MONTH_ADSPEND:2026-01) = $6.00 x max(31, 30.4) = $186.00
 *   term 1 reserved  = $0.00      term 2 standing  = $186.00
 *   term 3 presumed  = $0.00      term 4 realised  = $0.00
 *           Sum = $186.00  <=  W_MONTH_ADSPEND.max_monetary = $186.00     -> PERMIT
 *
 * =====================================================================================
 * WHAT S1F PROVES FOR THIS BRANCH, AND WHAT IT DOES NOT
 *
 * `campaign.budget.set` reaches step R with a KERNEL-SUPPLIED exposure block rather than
 * through C′. It is in the closed catalogue (`actionCatalogue.ts`, `rateBased: true`) and it
 * has NO REGISTERED CONSTRUCTOR, so `26 §7` step C2 would deny it `NOT_CANONICALISABLE`;
 * building one is a per-class commerce state model, enumerator and semantic option digest,
 * which is canonicaliser work for a new class and is excluded from the S1F mandate.
 *
 * So what is proven here is S1F's own property — that the zero-amount reservation, the
 * standing authorisation, its revocation authority, the standing window rows, the effect,
 * the signed decision and the journal row COMMIT OR FAIL TOGETHER — and not that a rate
 * class traverses C′. The S1F result records that boundary. It is the same boundary
 * accepted VC-S7 drew.
 * =====================================================================================
 */

let harness: Harness;
let kernel: LocalAuthorityHarness;

/** `26 §2.1.3`'s January. The month has 31 days, which is what makes $186.00 the figure. */
const JANUARY = new Date('2026-01-01T12:00:00.000Z');

function json(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => (typeof v === 'bigint' ? v.toString() : v));
}

async function withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await harness.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

beforeAll(async () => {
  harness = await createHarness();
});

afterAll(async () => {
  await harness.close();
});

beforeEach(async () => {
  await harness.reset();
  await withClient(async (client) => {
    await loadCommerceFixture(client);
    await loadS1eOrders(client);
    await loadAuthorityWorld(client);
  });
  // The clock is January, because the standing cap is a function of the month's length.
  kernel = makeLocalAuthorityHarness(harness, { at: JANUARY });
});

// =====================================================================================
// The first-authorisation permit
// =====================================================================================

describe('the FIRST rate authorisation in a clean window PERMITS through S1F', () => {
  it('VC-S7, end to end through the local authorisation transaction', async () => {
    // `26 §2.1.3`: "The first authorisation permits, and it is asserted rather than
    // assumed." Under every literal v1.2 reading it denied `WINDOW_EXHAUSTED`, which is the
    // TB-03 failure. This asserts it through S1F's transaction rather than through step R
    // alone.
    const outcome = await authoriseRateLocally(kernel, JANUARY);
    expect(outcome.outcome, json(outcome)).toBe('LOCAL_AUTHORISATION_COMMITTED');
    if (outcome.outcome !== 'LOCAL_AUTHORISATION_COMMITTED') return;
    expect(outcome.verdict).toBe('PERMIT');
    expect(outcome.journalSeq).toBe(1n);
    expect(outcome.windowInstances.map((w) => w.windowId).sort()).toEqual([
      ...EXPECTED_RATE_WINDOWS,
    ]);
  });

  it('the reservation row is REAL and its amount is EXACTLY $0.00', async () => {
    const outcome = await authoriseRateLocally(kernel, JANUARY);
    if (outcome.outcome !== 'LOCAL_AUTHORISATION_COMMITTED') throw new Error(json(outcome));

    await withClient(async (client) => {
      const rows = await rowsOf<{
        reservation_id: string;
        amount: string;
        vendor_amount: string | null;
        forward_integral: string | null;
        is_rate_class: boolean;
      }>(
        client,
        `SELECT reservation_id, amount, vendor_amount, forward_integral, is_rate_class
           FROM exposure_reservation WHERE company_id = $1`,
        [COMPANY_ID],
      );
      // I2, without a carve-out: the row EXISTS.
      expect(rows).toHaveLength(1);
      const row = rows[0]!;
      expect(row.reservation_id).toBe(outcome.reservationId);
      // I18b, exactly, no tolerance.
      expect(row.amount).toBe(S1F_EXPECTED.rate.reservationAmount);
      // `26 §2.1.3`'s field table: the dispatched request carries a RATE, not money.
      expect(row.vendor_amount).toBeNull();
      expect(row.is_rate_class).toBe(true);
      // The forward integral is recorded as a SEPARATE FIELD — `phase2-v1.3.1-errata.md
      // §1`: "a separate field that is not a component of total_exposure".
      expect(row.forward_integral).toBe(S1F_EXPECTED.rate.monthForwardIntegral);
      expect(row.forward_integral).not.toBe(row.amount);

      // And the authorisation row agrees: total_exposure is 0.00 there too, so I18b holds
      // between two persisted rows and not between a row and a constant.
      expect(
        await scalar(
          client,
          `SELECT total_exposure FROM authorisation WHERE authorisation_id = $1`,
          [outcome.authorisationId],
        ),
      ).toBe(S1F_EXPECTED.rate.totalExposure);
    });
  });

  it('`forward_integral` NEVER entered the ordinary reservation amount, on ANY row', async () => {
    // The E1 consistency condition, asserted against DATA rather than against prose. Every
    // reservation row, every reservation-window row and every journal row is checked.
    const outcome = await authoriseRateLocally(kernel, JANUARY);
    if (outcome.outcome !== 'LOCAL_AUTHORISATION_COMMITTED') throw new Error(json(outcome));

    await withClient(async (client) => {
      expect(
        await scalar(
          client,
          `SELECT count(*)::TEXT FROM exposure_reservation
            WHERE company_id = $1 AND is_rate_class AND amount <> 0.00`,
          [COMPANY_ID],
        ),
      ).toBe('0');
      expect(
        await scalar(
          client,
          `SELECT count(*)::TEXT FROM reservation_window_instance WHERE amount <> 0.00`,
        ),
      ).toBe('0');
      expect(
        await scalar(
          client,
          `SELECT count(*)::TEXT FROM effect_journal
            WHERE company_id = $1 AND is_rate_class AND total_exposure <> 0.00`,
          [COMPANY_ID],
        ),
      ).toBe('0');
      // And the journal row records the forward integral separately, which is where a later
      // audit reader finds the economics.
      expect(
        await scalar(
          client,
          `SELECT forward_integral FROM effect_journal WHERE company_id = $1`,
          [COMPANY_ID],
        ),
      ).toBe(S1F_EXPECTED.rate.monthForwardIntegral);
    });
  });

  it('TERM 1 is $0.00 and TERM 2 carries the whole economics, per instance', async () => {
    const outcome = await authoriseRateLocally(kernel, JANUARY);
    if (outcome.outcome !== 'LOCAL_AUTHORISATION_COMMITTED') throw new Error(json(outcome));

    // The expected per-instance figures, HAND-AUTHORED from `26 §2.1.3`'s worked example.
    const expected: Readonly<Record<string, string>> = {
      W_MONTH_ADSPEND: S1F_EXPECTED.rate.monthForwardIntegral,
      W_DAY_ADSPEND: S1F_EXPECTED.rate.dayForwardIntegral,
    };

    await withClient(async (client) => {
      for (const windowId of EXPECTED_RATE_WINDOWS) {
        const balance = (
          await rowsOf<{
            reserved_monetary: string;
            standing_monetary: string;
            presumed_monetary: string;
            realised_monetary: string;
            max_monetary: string;
          }>(
            client,
            `SELECT reserved_monetary, standing_monetary, presumed_monetary,
                    realised_monetary, max_monetary
               FROM window_balance
              WHERE company_id = $1 AND window_id = $2 AND window_instance_key = $3`,
            [COMPANY_ID, windowId, expectedInstanceKey(windowId, JANUARY)],
          )
        )[0]!;
        // TERM 1 — the ordinary reservation term. Zero, and it must be.
        expect(balance.reserved_monetary, `${windowId} term 1`).toBe('0.00');
        // TERM 2 — the standing term. The whole economics.
        expect(balance.standing_monetary, `${windowId} term 2`).toBe(expected[windowId]);
        expect(balance.presumed_monetary, `${windowId} term 3`).toBe('0.00');
        expect(balance.realised_monetary, `${windowId} term 4`).toBe('0.00');
        // And the four-term sum is exactly the ceiling — `26 §2.1.3`'s "Sum = $186.00 <=
        // max_monetary = $186.00 -> PERMIT". Equality, not slack.
        expect(balance.max_monetary, `${windowId} ceiling`).toBe(expected[windowId]);
      }
    });
  });

  it('`standing_window_exposure` rows exist for EVERY referenced instance', async () => {
    const outcome = await authoriseRateLocally(kernel, JANUARY);
    if (outcome.outcome !== 'LOCAL_AUTHORISATION_COMMITTED') throw new Error(json(outcome));
    await withClient(async (client) => {
      const rows = await rowsOf<{
        window_id: string;
        standing_cap_monetary: string;
        forward_monetary: string;
        instance_in_scope: boolean;
      }>(
        client,
        `SELECT window_id, standing_cap_monetary, forward_monetary, instance_in_scope
           FROM standing_window_exposure WHERE company_id = $1 ORDER BY window_id`,
        [COMPANY_ID],
      );
      expect(rows.map((r) => r.window_id)).toEqual([...EXPECTED_RATE_WINDOWS].sort());
      const expected: Readonly<Record<string, string>> = {
        W_MONTH_ADSPEND: S1F_EXPECTED.rate.monthForwardIntegral,
        W_DAY_ADSPEND: S1F_EXPECTED.rate.dayForwardIntegral,
      };
      for (const row of rows) {
        expect(row.standing_cap_monetary, row.window_id).toBe(expected[row.window_id]);
        // `forward_monetary` is a GENERATED column over the K5 expression, and it is what
        // enters I3 term 2.
        expect(row.forward_monetary, row.window_id).toBe(expected[row.window_id]);
        expect(row.instance_in_scope).toBe(true);
      }
    });
  });
});

// =====================================================================================
// I55 — the revocation authority is created atomically, and is scoped to nothing else
// =====================================================================================

describe('I55 — a live StandingAuthorization cannot emerge without its revocation authority', () => {
  it('both rows are committed, and the standing row NAMES the authority', async () => {
    const outcome = await authoriseRateLocally(kernel, JANUARY);
    if (outcome.outcome !== 'LOCAL_AUTHORISATION_COMMITTED') throw new Error(json(outcome));
    await withClient(async (client) => {
      const standing = await rowsOf<{
        standing_authorization_id: string;
        status: string;
        revocation_authority_id: string;
        revocation_effect_class: string;
        expires_at: Date;
        cessation_grace_hours: number;
      }>(
        client,
        `SELECT standing_authorization_id, status, revocation_authority_id,
                revocation_effect_class, expires_at, cessation_grace_hours
           FROM standing_authorization WHERE company_id = $1`,
        [COMPANY_ID],
      );
      expect(standing).toHaveLength(1);
      expect(standing[0]!.status).toBe('LIVE');

      const authority = await rowsOf<{
        revocation_authority_id: string;
        standing_authorization_id: string;
        action_class_selector: string;
        resource_selector: string;
        per_action_max_monetary: string;
        expires_at: Date;
        created_by: string;
      }>(
        client,
        `SELECT revocation_authority_id, standing_authorization_id, action_class_selector,
                resource_selector, per_action_max_monetary, expires_at, created_by
           FROM standing_revocation_authority WHERE company_id = $1`,
        [COMPANY_ID],
      );
      expect(authority).toHaveLength(1);
      expect(authority[0]!.revocation_authority_id).toBe(
        standing[0]!.revocation_authority_id,
      );
      expect(authority[0]!.standing_authorization_id).toBe(
        standing[0]!.standing_authorization_id,
      );
    });
  });

  it('the authority is scoped to ONE class, ONE resource and ZERO monetary authority', async () => {
    // `24 §3.1`, verbatim: "It authorises step I for exactly one class against exactly one
    // resource at exactly zero monetary exposure", and `36 §2.7` "asserts it cannot
    // authorise another class, another resource, or any monetary amount."
    //
    // Asserted against the PERSISTED FIELDS: the scoping is not a runtime convention, it is
    // what the row says. The KERNEL_SERVICE execution path that would consume it is NOT
    // built in S1F, so what is proven is that the authority cannot be generalised by its
    // persisted fields into another class, another resource, another standing authorisation
    // or positive monetary authority.
    const outcome = await authoriseRateLocally(kernel, JANUARY);
    if (outcome.outcome !== 'LOCAL_AUTHORISATION_COMMITTED') throw new Error(json(outcome));
    await withClient(async (client) => {
      const row = (
        await rowsOf<{
          action_class_selector: string;
          resource_selector: string;
          per_action_max_monetary: string;
          created_by: string;
          expires_at: Date;
        }>(
          client,
          `SELECT action_class_selector, resource_selector, per_action_max_monetary,
                  created_by, expires_at
             FROM standing_revocation_authority WHERE company_id = $1`,
          [COMPANY_ID],
        )
      )[0]!;

      // A SINGLETON class selector — the revocation effect class, hand-authored from
      // `51 §3.2`'s rate grant row: "revocation_effect_class campaign.pause".
      expect(row.action_class_selector).toBe('campaign.pause');
      // It is NOT the class it revokes, and it is not a wildcard.
      expect(row.action_class_selector).not.toBe('campaign.budget.set');
      expect(row.action_class_selector).not.toContain('*');
      expect(row.action_class_selector).not.toContain('ANY');
      // An EQUALITY on one resource_ref.
      expect(row.resource_selector).toBe(RATE_RESOURCE_REF);
      expect(row.resource_selector).not.toContain('*');
      // ZERO monetary authority.
      expect(row.per_action_max_monetary).toBe('0.00');
      // Created by the KERNEL, never model-proposable.
      expect(row.created_by).toBe('KERNEL');

      // `I55`: "expires_at >= grant.expires_at + cessation_grace". The grace is 72 hours,
      // CONFIGURED (`24 §3.1`), and the fixture's standing authorisation expires 30 days
      // out — so the authority must expire 33 days out. Hand-authored arithmetic.
      const standingExpiry = new Date(JANUARY.getTime() + 30 * 86_400_000);
      const expected = new Date(standingExpiry.getTime() + 72 * 3_600_000);
      expect(row.expires_at.toISOString()).toBe(expected.toISOString());
      expect(row.expires_at.getTime()).toBeGreaterThan(standingExpiry.getTime());
    });
  });

  it('there is NO code path in `src/` that revokes — creation is in scope, execution is not', async () => {
    // Reported accurately rather than claimed. `26 §7.1`'s KERNEL_SERVICE branch, the pause
    // dispatch and the `REVOKED` transition are all unbuilt, and the accepted S1A suite
    // already asserts that `cessation_verified_at` is set nowhere.
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
        if (!entry.name.endsWith('.ts')) continue;
        const code = (await readFile(path, 'utf8'))
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/(^|[^:])\/\/.*$/gm, '$1');
        // The two markers of an actual revocation EXECUTION path. `KERNEL_SERVICE` is
        // deliberately NOT one of them: it is a member of `26 §3`'s principal-kind enum and
        // appears in `principal.ts` and `types.ts` as schema vocabulary, which is a
        // declaration rather than a path.
        for (const pattern of [/'REVOKED'/, /cessation_verified_at/]) {
          if (pattern.test(code)) offenders.push(`${path} (${String(pattern)})`);
        }
      }
    }
    await walk(join(process.cwd(), 'src'));
    expect(offenders, `a revocation path exists:\n  ${offenders.join('\n  ')}`).toEqual([]);
  });
});

// =====================================================================================
// The vulnerable controls
// =====================================================================================

describe('THE VULNERABLE CONTROL — `forward_integral` as the ordinary reservation amount', () => {
  /** The rate spec both implementations operate on, hand-authored. */
  function spec(id: string) {
    const extension = rateExtension(JANUARY);
    return {
      companyId: COMPANY_ID,
      authorisationId: `auth:unsafe-rate-${id}`,
      reservationId: `reservation:unsafe-rate-${id}`,
      standingAuthorizationId: `standing:unsafe-rate-${id}`,
      revocationAuthorityId: `revocation:unsafe-rate-${id}`,
      actionClass: 'campaign.budget.set',
      resourceRef: RATE_RESOURCE_REF,
      revocationEffectClass: 'campaign.pause',
      adapter: 'google_ads',
      rateAmount: money('6.00'),
      rateCurrency: 'USD',
      ratePeriod: 'day',
      forwardIntegral: money(S1F_EXPECTED.rate.monthForwardIntegral),
      at: JANUARY,
      expiresAt: extension.expiresAt,
      cessationGraceHours: 72,
      windows: EXPECTED_RATE_WINDOWS.map((windowId) => ({
        windowId,
        windowInstanceKey: expectedInstanceKey(windowId, JANUARY),
        standingCap: money(
          windowId === 'W_MONTH_ADSPEND'
            ? S1F_EXPECTED.rate.monthForwardIntegral
            : S1F_EXPECTED.rate.dayForwardIntegral,
        ),
      })),
    };
  }

  async function materialiseAdspendInstances(): Promise<void> {
    await withClient(async (client) => {
      for (const windowId of EXPECTED_RATE_WINDOWS) {
        await client.query(
          `INSERT INTO window_balance (
             company_id, window_id, window_instance_key,
             max_monetary, max_monetary_unbounded, max_count, max_count_unbounded,
             max_irrecoverable_units, max_irrecoverable_unbounded)
           SELECT $1, w.window_id, $3, w.max_monetary, w.max_monetary_unbounded,
                  w.max_count, w.max_count_unbounded,
                  w.max_irrecoverable_units, w.max_irrecoverable_unbounded
             FROM window_registry w WHERE w.company_id = $1 AND w.window_id = $2
           ON CONFLICT DO NOTHING`,
          [COMPANY_ID, windowId, expectedInstanceKey(windowId, JANUARY)],
        );
      }
    });
  }

  it('the control DOUBLE-COUNTS and DENIES the first authorisation — the TB-03 failure', async () => {
    // `phase2-v1.3.1-errata.md §1`: "Because `W_MONTH_ADSPEND.max_monetary` equals
    // `standing_cap` exactly, the double count denies the first `campaign.budget.set` the
    // company ever attempts — which is TB-03."
    await materialiseAdspendInstances();
    const unsafe = await withClient((client) =>
      unsafeRateReservesForwardIntegral(client, spec('a')),
    );
    expect(unsafe).toBe('WINDOW_EXHAUSTED');

    // The four-term sum the control attempted: $186.00 in term 1 PLUS $186.00 in term 2
    // against a $186.00 ceiling. Nothing was committed.
    await withClient(async (client) => {
      expect(await countOf(client, 'exposure_reservation')).toBe(0);
      expect(await countOf(client, 'standing_window_exposure')).toBe(0);
    });
  });

  it('PRODUCTION on the SAME fixture PERMITS — the test discriminates', async () => {
    await materialiseAdspendInstances();
    const outcome = await authoriseRateLocally(kernel, JANUARY);
    expect(outcome.outcome, json(outcome)).toBe('LOCAL_AUTHORISATION_COMMITTED');
    // THE DISCRIMINATION: the same window, the same rate, the same instant. The control
    // denies; production permits. That is only possible if the two put the forward integral
    // in different terms.
  });
});

describe('THE VULNERABLE CONTROL — the zero-dollar reservation row omitted', () => {
  it('the control commits standing state with NO reservation row', async () => {
    await withClient(async (client) => {
      for (const windowId of EXPECTED_RATE_WINDOWS) {
        await client.query(
          `INSERT INTO window_balance (
             company_id, window_id, window_instance_key,
             max_monetary, max_monetary_unbounded, max_count, max_count_unbounded,
             max_irrecoverable_units, max_irrecoverable_unbounded)
           SELECT $1, w.window_id, $3, w.max_monetary, w.max_monetary_unbounded,
                  w.max_count, w.max_count_unbounded,
                  w.max_irrecoverable_units, w.max_irrecoverable_unbounded
             FROM window_registry w WHERE w.company_id = $1 AND w.window_id = $2
           ON CONFLICT DO NOTHING`,
          [COMPANY_ID, windowId, expectedInstanceKey(windowId, JANUARY)],
        );
      }
    });

    const extension = rateExtension(JANUARY);
    const unsafe = await withClient((client) =>
      unsafeRateOmitsReservationRow(client, {
        companyId: COMPANY_ID,
        authorisationId: 'auth:unsafe-omit',
        reservationId: 'reservation:unsafe-omit',
        standingAuthorizationId: 'standing:unsafe-omit',
        revocationAuthorityId: 'revocation:unsafe-omit',
        actionClass: 'campaign.budget.set',
        resourceRef: RATE_RESOURCE_REF,
        revocationEffectClass: 'campaign.pause',
        adapter: 'google_ads',
        rateAmount: money('6.00'),
        rateCurrency: 'USD',
        ratePeriod: 'day',
        forwardIntegral: money(S1F_EXPECTED.rate.monthForwardIntegral),
        at: JANUARY,
        expiresAt: extension.expiresAt,
        cessationGraceHours: 72,
        windows: EXPECTED_RATE_WINDOWS.map((windowId) => ({
          windowId,
          windowInstanceKey: expectedInstanceKey(windowId, JANUARY),
          standingCap: money(
            windowId === 'W_MONTH_ADSPEND'
              ? S1F_EXPECTED.rate.monthForwardIntegral
              : S1F_EXPECTED.rate.dayForwardIntegral,
          ),
        })),
      }),
    );

    // VULNERABLE — it commits. The arithmetic works, which is what makes the omission
    // tempting.
    expect(unsafe).toBe('COMMITTED');
    await withClient(async (client) => {
      expect(await countOf(client, 'standing_authorization')).toBe(1);
      expect(await countOf(client, 'standing_window_exposure')).toBe(2);
      // And I2 is broken: standing state exists and no reservation names it.
      expect(await countOf(client, 'exposure_reservation')).toBe(0);
    });
  });

  it('AND A DECISION CANNOT BE WRITTEN OVER IT — I2 is structural after S1F', async () => {
    // The reason the omission is refused rather than merely detected:
    // `authorisation_decision.reservation_id` is NOT NULL with a foreign key, so a decision
    // for an effect with no reservation is a row the DATABASE will not accept.
    await withClient(async (client) => {
      const columns = await rowsOf<{ column_name: string; is_nullable: string }>(
        client,
        `SELECT column_name, is_nullable FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'authorisation_decision'
            AND column_name = 'reservation_id'`,
      );
      expect(columns).toHaveLength(1);
      expect(columns[0]!.is_nullable).toBe('NO');

      const fk = await rowsOf<{ n: string }>(
        client,
        `SELECT count(*)::TEXT AS n FROM pg_constraint
          WHERE conrelid = 'authorisation_decision'::regclass AND contype = 'f'
            AND confrelid = 'exposure_reservation'::regclass`,
      );
      expect(fk[0]!.n).toBe('1');
    });

    // And production writes the row, so the constraint is satisfied rather than avoided.
    const outcome = await authoriseRateLocally(kernel, JANUARY);
    expect(outcome.outcome).toBe('LOCAL_AUTHORISATION_COMMITTED');
  });
});

// =====================================================================================
// The rate class under an exhausted window
// =====================================================================================

describe('a rate class still denies when a referenced instance lacks headroom', () => {
  it('one cent of realised spend on the MONTH window denies the whole transaction', async () => {
    // The month ceiling equals the standing cap exactly, so any pre-existing spend makes
    // the four-term sum exceed it. This is the assertion that the guard is reached at all
    // on the rate path.
    await withClient(async (client) => {
      await client.query(
        `INSERT INTO window_balance (
           company_id, window_id, window_instance_key,
           max_monetary, max_monetary_unbounded, max_count, max_count_unbounded,
           max_irrecoverable_units, max_irrecoverable_unbounded, realised_monetary)
         SELECT $1, w.window_id, $2, w.max_monetary, w.max_monetary_unbounded,
                w.max_count, w.max_count_unbounded,
                w.max_irrecoverable_units, w.max_irrecoverable_unbounded, 0.01
           FROM window_registry w
          WHERE w.company_id = $1 AND w.window_id = 'W_MONTH_ADSPEND'
         ON CONFLICT (company_id, window_id, window_instance_key)
           DO UPDATE SET realised_monetary = 0.01`,
        [COMPANY_ID, expectedInstanceKey('W_MONTH_ADSPEND', JANUARY)],
      );
    });
    const outcome = await authoriseRateLocally(kernel, JANUARY);
    expect(outcome.outcome, json(outcome)).toBe('LOCAL_AUTHORISATION_DENIED');
    if (outcome.outcome !== 'LOCAL_AUTHORISATION_DENIED') return;
    expect(outcome.code).toBe('WINDOW_EXHAUSTED');
    await withClient(async (client) => {
      // No orphan standing state of any kind.
      expect(await countOf(client, 'standing_authorization')).toBe(0);
      expect(await countOf(client, 'standing_revocation_authority')).toBe(0);
      expect(await countOf(client, 'standing_window_exposure')).toBe(0);
      expect(await countOf(client, 'exposure_reservation')).toBe(0);
      expect(await countOf(client, 'authorisation_decision')).toBe(0);
      expect(await countOf(client, 'effect_journal')).toBe(0);
    });
  });

  it('a rate class whose `total_exposure` is NOT 0.00 is a DEFECT, not a denial', async () => {
    // `26 §2.1.3`'s field table is not negotiable, and softening it into
    // `WINDOW_EXHAUSTED` would hide the TB-03 shape behind a plausible denial.
    await expect(
      authoriseRateLocally(kernel, JANUARY, {
        facts: {
          ...rateFacts(),
          exposure: {
            vendorAmount: null,
            totalExposure: money('186.00'),
            forwardIntegral: money('186.00'),
          },
        },
      }),
    ).rejects.toThrow('total_exposure = 0.00');
  });
});
