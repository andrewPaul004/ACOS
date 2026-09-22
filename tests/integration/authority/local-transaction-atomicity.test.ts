import { readdir, readFile } from 'node:fs/promises';
import { join, sep } from 'node:path';

import type { PoolClient } from 'pg';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { LOCAL_COMMIT_POINTS } from '../../../src/kernel/authorisation/localAuthorisationErrors.js';
import type { LocalCommitPoint } from '../../../src/kernel/authorisation/localAuthorisationErrors.js';
import { createHarness, type Harness } from '../../support/fixture.js';
import { loadCommerceFixture } from '../../support/enumerationFixture.js';
import {
  S1E_PASS_ORDER,
  loadAuthorityWorld,
  loadS1eOrders,
} from '../../support/authorityFixture.js';
import {
  COMPANY_ID,
  FIXTURE_NOW,
  S1F_TABLES,
  authoriseRateLocally,
  countOf,
  makeLocalAuthorityHarness,
  proposeAndAuthorise,
  rateFacts,
  scalar,
  type LocalAuthorityHarness,
} from '../../support/localAuthorisationFixture.js';

/**
 * THE KILL-POINT MATRIX. `33 §1`'s "commit or fail TOGETHER", tested by making it fail.
 *
 * =====================================================================================
 * WHY A RETURN VALUE PROVES NOTHING HERE
 *
 * The S1F mandate: "Do not call a set of independently committed rows 'atomic'." A service
 * that committed the reservation, then the decision, then the journal row in three
 * transactions returns exactly the same success value as one that commits them together.
 * The only thing that separates them is what a CRASH leaves behind.
 *
 * So every case below aborts a REAL transaction at a REAL point inside it and then reads the
 * database from a SEPARATE connection. `36 §2`'s requirement, and `35`'s kill-point
 * walkthroughs, are about the state after the abort — never about the error that caused it.
 *
 * The eleven points are `LOCAL_COMMIT_POINTS`, which is the production sequence's own list
 * of boundaries. The matrix asserts it covers every stage rather than transcribing a
 * separate list: a production sequence that grew a twelfth write without a point would show
 * up as a point with no coverage.
 * =====================================================================================
 */

let harness: Harness;
let kernel: LocalAuthorityHarness;

async function withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await harness.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

/** Every S1F table is empty, and the journal counter never advanced. */
async function assertNothingPersisted(where: string): Promise<void> {
  await withClient(async (client) => {
    for (const table of S1F_TABLES) {
      expect(await countOf(client, table), `${where}: ${table} is not empty`).toBe(0);
    }
    // `30 §5.2`: "a gap is the one signal I17 reads as suppression". The counter is a ROW,
    // so a rolled-back allocation leaves no gap AND no consumed value.
    expect(
      await scalar(client, `SELECT next_seq::TEXT FROM journal_counter WHERE company_id = $1`, [
        COMPANY_ID,
      ]),
      `${where}: the journal counter advanced`,
    ).toBe('1');
    // And the money never moved. Read every instance rather than the two the fixture
    // expects, so an instance created and moved by a partial attempt would be caught.
    const balances = await client.query<{
      window_id: string;
      reserved_monetary: string;
      standing_monetary: string;
      presumed_monetary: string;
      reserved_count: string;
    }>(
      `SELECT window_id, reserved_monetary, standing_monetary, presumed_monetary, reserved_count
         FROM window_balance WHERE company_id = $1`,
      [COMPANY_ID],
    );
    for (const row of balances.rows) {
      expect(row.reserved_monetary, `${where}: ${row.window_id} reserved`).toBe('0.00');
      expect(row.standing_monetary, `${where}: ${row.window_id} standing`).toBe('0.00');
      expect(row.presumed_monetary, `${where}: ${row.window_id} presumed`).toBe('0.00');
      expect(row.reserved_count, `${where}: ${row.window_id} count`).toBe('0');
    }
  });
}

class Kill extends Error {
  public constructor(public readonly point: LocalCommitPoint) {
    super(`kill at ${point}`);
    this.name = 'Kill';
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
  kernel = makeLocalAuthorityHarness(harness);
});

// =====================================================================================
// The matrix — ordinary class
// =====================================================================================

/** The points an ORDINARY class actually reaches. Hand-authored, not derived. */
const ORDINARY_POINTS: readonly LocalCommitPoint[] = [
  'AFTER_ISOLATION_ASSERTED',
  'AFTER_FIRST_WINDOW_LOCK',
  'AFTER_ALL_WINDOW_LOCKS',
  'AFTER_AUTHORISATION_ROW',
  'AFTER_RESERVATION_ROW',
  'AFTER_EFFECT_ROW',
  'AFTER_DECISION_ROW',
  'AFTER_JOURNAL_SEQ_ALLOCATED',
  'AFTER_JOURNAL_ROW',
];

/** The two additional points only a RATE class reaches. */
const RATE_ONLY_POINTS: readonly LocalCommitPoint[] = ['AFTER_STANDING_ROWS'];

/** The one point only an APPROVAL-BEARING proposal reaches. */
const APPROVAL_ONLY_POINTS: readonly LocalCommitPoint[] = ['AFTER_APPROVAL_ROW'];

/**
 * The files permitted to name the outbox. HAND-AUTHORED — see the narrowing note below.
 *
 * `src/kernel/outbox/` is the mechanism `25 §7` specifies. The three transport files carry
 * the claim's journal row to the audit plane, which `30 §5.1` item 2 and `I17`'s two-sided
 * diff make mandatory rather than optional: a control-side row kind the audit store cannot
 * ingest is a permanent gap, and `30 §5.2` gives a gap "exactly one interpretation".
 */
const OUTBOX_FILES: readonly string[] = [
  join('src', 'kernel', 'outbox', 'outboxState.ts'),
  join('src', 'kernel', 'outbox', 'correlationTag.ts'),
  join('src', 'kernel', 'outbox', 'enqueue.ts'),
  join('src', 'kernel', 'outbox', 'claim.ts'),
  join('src', 'kernel', 'outbox', 'recovery.ts'),
  join('src', 'audit', 'transport', 'journalRecord.ts'),
  join('src', 'audit', 'ingress.ts'),
  join('src', 'replication', 'journalPusher.ts'),
  // S1J. WIDENED BY EXACTLY FOUR, and every existing entry is untouched.
  //
  // `25 §7` (OBX-03) prints the chain the dispatch composition runs on: "current claim-time
  // authority evaluation -> exclusive durable claim -> COMMIT -> transport". A composition
  // that could not name the CLAIMED outbox row it dispatches could not read the persisted
  // payload, the correlation tag or the degraded-state requirement off it.
  //
  // EVERY TRANSPORT PATTERN ABOVE REMAINS UNCHANGED AND STILL GLOBAL, and S1J adds none of
  // them: no `fetch`, no `XMLHttpRequest`, no `node:https`, no `node:net`, no `node:dgram`,
  // no `axios`, no `undici`. `tests/integration/gateway/no-real-transport-boundary.test.ts`
  // adds thirty further absences over the gateway directory on top of these — including
  // every vendor name, every credential shape and every URL form.
  //
  // AND THE PROPERTY THIS SUITE IS ABOUT IS UNTOUCHED: the assertion below still reads
  // `localAuthorisation.ts` directly and requires it to contain neither `outbox` nor
  // `CLAIMED`, so no outbox or outcome write can join the S1F commit point.
  join('src', 'kernel', 'gateway', 'effectGateway.ts'),
  // v1.3.5 (SER-01). TWO MORE, and both for the same reason the four above were added:
  // `25 §14.1`'s Epoch B is defined in terms of the outbox row it is about to claim.
  //
  //   dispatchLease.ts        derives the entity advisory-lock key from the committed
  //                           `dispatch_outbox.resource_ref`, because `25 §14.1` requires
  //                           "the **same architecture entity advisory-lock key**" as Epoch A
  //                           and that key is only recoverable from immutable committed
  //                           identity.
  //   dispatchRevalidation.ts reads the ORIGINAL identity off the same row, which
  //                           `25 §14.1` names operand by operand.
  //
  // NEITHER ADDS A TRANSPORT PATTERN. No `fetch`, no `XMLHttpRequest`, no `node:https`, no
  // `node:net`, no `node:dgram`, no `axios`, no `undici` — every pattern above stays global
  // and unchanged. And the property this suite is about is untouched: the assertion at the
  // end still reads `localAuthorisation.ts` directly and requires it to contain neither
  // `outbox` nor `CLAIMED`, so nothing here can join the S1F commit point.
  join('src', 'kernel', 'gateway', 'dispatchEnvelope.ts'),
  join('src', 'kernel', 'gateway', 'dispatchCapability.ts'),
  join('src', 'kernel', 'gateway', 'outcomeTransaction.ts'),
  join('src', 'kernel', 'gateway', 'dispatchLease.ts'),
  join('src', 'kernel', 'gateway', 'dispatchRevalidation.ts'),
];

describe('the declared point list covers the whole production sequence', () => {
  it('every declared point is claimed by exactly one of the three coverage lists', () => {
    const claimed = [...ORDINARY_POINTS, ...RATE_ONLY_POINTS, ...APPROVAL_ONLY_POINTS].sort();
    expect(claimed).toEqual([...LOCAL_COMMIT_POINTS].sort());
    expect(new Set(claimed).size).toBe(claimed.length);
  });
});

describe('ORDINARY class — an abort at every point inside the transaction', () => {
  for (const point of ORDINARY_POINTS) {
    it(`abort at ${point} leaves NOTHING persisted`, async () => {
      await expect(
        proposeAndAuthorise(kernel, S1E_PASS_ORDER, {
          at: async (reached) => {
            if (reached === point) throw new Kill(point);
          },
        }),
      ).rejects.toThrow(`kill at ${point}`);
      await assertNothingPersisted(point);
    });
  }

  it('AND THE MATRIX DISCRIMINATES — with no kill, every row is there', async () => {
    // A matrix in which the transaction never got far enough to write anything would pass
    // every case above. This is the control: the same fixture, unkilled, writes all of it.
    const outcome = await proposeAndAuthorise(kernel, S1E_PASS_ORDER);
    expect(outcome.outcome).toBe('LOCAL_AUTHORISATION_COMMITTED');
    await withClient(async (client) => {
      expect(await countOf(client, 'authorisation')).toBe(1);
      expect(await countOf(client, 'authorisation_window_instance')).toBe(2);
      expect(await countOf(client, 'exposure_reservation')).toBe(1);
      expect(await countOf(client, 'reservation_window_instance')).toBe(2);
      expect(await countOf(client, 'effect')).toBe(1);
      expect(await countOf(client, 'authorisation_decision')).toBe(1);
      expect(await countOf(client, 'effect_journal')).toBe(1);
      // No approval, because the fixture grant declares approval_requirement NONE.
      expect(await countOf(client, 'approval')).toBe(0);
    });
  });

  it('`I64` — the CASE BINDING commits with the effect, in the same transaction', async () => {
    /*
     * -----------------------------------------------------------------------------
     * `§21` OF THE S1I OWNER-RESOLUTION MANDATE:
     *
     *   "If `effect.case_ref` is persisted in the S1F transaction, rerun every S1F
     *    kill-point matrix. Required property: no committed effect can exist with a
     *    missing required case binding; a mutable case binding; a binding written in a
     *    separate crash window. For a case-associated effect, effect + `case_ref` commit
     *    together. **Do not weaken the accepted one-transaction property.**"
     *
     * THE MATRIX ABOVE ALREADY PROVES THE HARD HALF, and this case says why. `0011`
     * derives the binding in a `BEFORE INSERT` trigger on `effect`, so the value is
     * computed and written **as part of the INSERT itself**. There is no second statement,
     * no second transaction and no window between the two — which is why every abort in
     * the matrix above leaves NOTHING persisted rather than leaving an effect with an
     * unwritten binding.
     *
     * `assertNothingPersisted` sweeps `effect` among its tables, so a committed effect
     * missing its case would have to be a committed effect, which the matrix forbids at
     * every point. What remains to assert is the POSITIVE: that the unkilled run writes
     * both together and that the binding is the authoritative one.
     *
     * NO NEW KILL POINT IS ADDED, and that is a claim rather than an omission: a kill
     * point between the effect row and its binding is not expressible, because there is no
     * instant between them to kill at.
     * -----------------------------------------------------------------------------
     */
    await withClient(async (client) => {
      await client.query(`UPDATE authority_task SET case_ref = $1`, ['case:CS-ATOMICITY']);
    });

    const outcome = await proposeAndAuthorise(kernel, S1E_PASS_ORDER);
    expect(outcome.outcome).toBe('LOCAL_AUTHORISATION_COMMITTED');

    await withClient(async (client) => {
      const rows = await client.query<{ effect_id: string; case_ref: string | null }>(
        `SELECT effect_id, case_ref FROM effect`,
      );
      expect(rows.rows).toHaveLength(1);
      // Committed together: one effect row, carrying the authoritative binding.
      expect(rows.rows[0]!.case_ref).toBe('case:CS-ATOMICITY');

      // AND NO EFFECT ANYWHERE IS MISSING A BINDING ITS TASK DECLARES. Stated as a
      // relational assertion rather than a row read, so it would catch a second effect
      // written by any path.
      const divergent = await client.query<{ count: string }>(
        `SELECT count(*)::TEXT AS count
           FROM effect e
           JOIN authorisation a ON a.authorisation_id = e.authorisation_id
           JOIN authority_task t
             ON t.company_id = a.company_id AND t.task_id = a.task_id
          WHERE e.case_ref IS DISTINCT FROM t.case_ref`,
      );
      expect(divergent.rows[0]!.count).toBe('0');
    });
  });
});

describe('RATE class — an abort at every point, including the standing rows', () => {
  for (const point of [...ORDINARY_POINTS, ...RATE_ONLY_POINTS]) {
    it(`abort at ${point} leaves no orphan standing state`, async () => {
      await expect(
        authoriseRateLocally(kernel, FIXTURE_NOW, {
          at: async (reached) => {
            if (reached === point) throw new Kill(point);
          },
        }),
      ).rejects.toThrow(`kill at ${point}`);
      // The four rate-class-specific orphans `24 §3` K5 and `I55` forbid, checked by name
      // as well as by the sweep: an orphan StandingAuthorization, an orphan
      // StandingRevocationAuthority, an orphan standing_window_exposure row, and a
      // standing term left in `window_balance` with no row behind it.
      await assertNothingPersisted(point);
    });
  }

  it('AND IT DISCRIMINATES — unkilled, the rate class writes all four rows', async () => {
    const outcome = await authoriseRateLocally(kernel, FIXTURE_NOW);
    expect(outcome.outcome).toBe('LOCAL_AUTHORISATION_COMMITTED');
    await withClient(async (client) => {
      expect(await countOf(client, 'exposure_reservation')).toBe(1);
      expect(await countOf(client, 'standing_authorization')).toBe(1);
      expect(await countOf(client, 'standing_revocation_authority')).toBe(1);
      expect(await countOf(client, 'standing_window_exposure')).toBe(2);
      expect(await countOf(client, 'authorisation_decision')).toBe(1);
      expect(await countOf(client, 'effect_journal')).toBe(1);
    });
  });
});

describe('APPROVAL-BEARING proposal — the reservation and the approval share a commit', () => {
  it('abort at AFTER_APPROVAL_ROW leaves no reservation and no approval', async () => {
    await expect(
      authoriseRateLocally(kernel, FIXTURE_NOW, {
        facts: rateFacts({ approvalRequirement: 'TIER_2' }),
        at: async (reached) => {
          if (reached === 'AFTER_APPROVAL_ROW') throw new Kill('AFTER_APPROVAL_ROW');
        },
      }),
    ).rejects.toThrow('kill at AFTER_APPROVAL_ROW');
    await assertNothingPersisted('AFTER_APPROVAL_ROW');
  });

  it('AND IT DISCRIMINATES — unkilled, `26 §7` property 6 holds: reservation THEN approval', async () => {
    // `26 §7` property 6: "Reservation precedes approval (step R before S), SR5. The window
    // is committed across the human latency gap".
    const outcome = await authoriseRateLocally(kernel, FIXTURE_NOW, {
      facts: rateFacts({ approvalRequirement: 'TIER_2' }),
    });
    expect(outcome.outcome).toBe('LOCAL_AUTHORISATION_PENDING_APPROVAL');
    if (outcome.outcome !== 'LOCAL_AUTHORISATION_PENDING_APPROVAL') return;
    expect(outcome.approvalTier).toBe('TIER_2');
    expect(outcome.localStatus).toBe('AWAITING_APPROVAL');

    await withClient(async (client) => {
      const approval = await client.query<{
        state: string;
        reservation_id: string;
        tier: string;
        reservation_expires_at: Date | null;
      }>(
        `SELECT state, reservation_id, tier, reservation_expires_at FROM approval
          WHERE approval_id = $1`,
        [outcome.approvalId],
      );
      expect(approval.rows).toHaveLength(1);
      // `26 §12.2`: the initial state is PENDING and S1F performs no transition out of it.
      expect(approval.rows[0]!.state).toBe('PENDING');
      // `25 §12`: the approval carries "the reservation_id".
      expect(approval.rows[0]!.reservation_id).toBe(outcome.reservationId);
      // `26 §12.1`: TIER_2 is 48h + 6h. Hand-authored: 54 hours after the fixture instant.
      const expected = new Date(FIXTURE_NOW.getTime() + 54 * 3_600_000);
      expect(approval.rows[0]!.reservation_expires_at?.toISOString()).toBe(
        expected.toISOString(),
      );
      // The decision is REQUIRE_APPROVAL, and it still names a real reservation (I2).
      const decision = await client.query<{ verdict: string; reservation_id: string; approval_id: string }>(
        `SELECT verdict, reservation_id, approval_id FROM authorisation_decision
          WHERE decision_id = $1`,
        [outcome.decisionId],
      );
      expect(decision.rows[0]!.verdict).toBe('REQUIRE_APPROVAL');
      expect(decision.rows[0]!.reservation_id).toBe(outcome.reservationId);
      expect(decision.rows[0]!.approval_id).toBe(outcome.approvalId);
      // The effect row records the local status, and the journal row committed with it.
      expect(
        await scalar(client, `SELECT status FROM effect WHERE effect_id = $1`, [outcome.effectId]),
      ).toBe('AWAITING_APPROVAL');
      expect(await countOf(client, 'effect_journal')).toBe(1);
    });
  });
});

// =====================================================================================
// There is ONE transaction, and the source says so
// =====================================================================================

describe('the two-transaction pattern does not exist in `src/`', () => {
  it('exactly one module opens a money-path transaction, and it opens exactly one', async () => {
    // A source scan, because the property is structural: a second `BEGIN` around the
    // decision or the journal row would return the same value and leave a different crash
    // state, and by then the matrix above would already have been written against the
    // one-transaction shape.
    const offenders: string[] = [];
    const root = join(process.cwd(), 'src');
    const allowed = new Set([
      // The only transaction helper. `pool.ts` owns BEGIN/COMMIT.
      join('db', 'pool.ts'),
      // The only retry wrapper, which calls `inTransaction` once.
      join('kernel', 'exposure', 'retry.ts'),
      // The migration runner, which is DDL and not a money path.
      join('db', 'migrate.ts'),
    ]);

    async function walk(dir: string): Promise<void> {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(path);
          continue;
        }
        if (!entry.name.endsWith('.ts')) continue;
        if ([...allowed].some((suffix) => path.endsWith(suffix))) continue;
        const code = (await readFile(path, 'utf8'))
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/(^|[^:])\/\/.*$/gm, '$1');
        if (/\bBEGIN\b/.test(code) || /\bCOMMIT\b/.test(code)) {
          offenders.push(path);
        }
      }
    }

    await walk(root);
    expect(offenders, `a transaction is opened outside pool.ts:\n  ${offenders.join('\n  ')}`).toEqual(
      [],
    );

    // And the local authorisation module wraps its work exactly once.
    const local = await readFile(
      join(root, 'kernel', 'authorisation', 'localAuthorisation.ts'),
      'utf8',
    );
    const stripped = local.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(stripped.match(/withSerialisationRetry\(/g) ?? []).toHaveLength(1);
    expect(stripped.match(/inTransaction\(/g) ?? []).toHaveLength(0);
  });

  it('no module in `src/` performs transport, and none names an adapter method', async () => {
    // The S1F mandate: "No code in S1F should perform transport." Asserted over the whole
    // tree rather than over the new files, so a later edit anywhere is caught.
    const offenders: string[] = [];
    const root = join(process.cwd(), 'src');

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
        for (const pattern of [
          // Bare global `fetch(` — never a method CALLED fetch and never a method DECLARED
          // fetch. `26 §7` step G's whole point is that "the engine fetches its own
          // preconditions", so `PreconditionEvaluator.fetch` and
          // `this.#preconditions.fetch(...)` are the architecture's own vocabulary and are
          // not network calls. The two lookbehinds are what separate them.
          /(?<![.\w])(?<!async )fetch\s*\(/,
          /\bXMLHttpRequest\b/,
          /from\s+'node:https?'/,
          /from\s+'node:net'/,
          /from\s+'node:dgram'/,
          /require\(['"]https?['"]\)/,
          /\baxios\b/,
          /\bundici\b/,
        ]) {
          if (pattern.test(code)) offenders.push(`${path} (${String(pattern)})`);
        }
        /*
         * -----------------------------------------------------------------------------
         * S1I NARROWED THE `outbox` PATTERN, AND THIS COMMENT IS THE RECORD OF IT.
         *
         * S1F asserted `/\boutbox\b/i` as an ABSENCE over the whole of `src/`. S1I builds
         * `25 §7`'s outbox, so the property becomes CONFINEMENT — the same move S1H made
         * when it built the mirror mechanism S1G had asserted absent — held against a
         * HAND-AUTHORED FILE LIST so that a NEW file acquiring the word fails this test
         * rather than joining a pattern exemption.
         *
         * EVERY TRANSPORT PATTERN ABOVE IS UNCHANGED AND STILL GLOBAL. S1I adds no `fetch`,
         * no `XMLHttpRequest`, no `node:https`, no `node:net`, no `node:dgram`, no `axios`
         * and no `undici`, and `tests/integration/outbox/no-transport-boundary.test.ts`
         * adds twenty-three further absences over the outbox directory on top of these.
         *
         * AND THE PROPERTY THIS SUITE IS ABOUT IS UNTOUCHED: the S1F transaction itself
         * still contains no outbox write. The outbox row is a POST-COMMIT derivative —
         * `30 §5.1` item 3's ordering block lists the transaction's writes exhaustively and
         * no outbox row appears in it — which the assertion below states directly.
         * -----------------------------------------------------------------------------
         */
        const relative = path.replace(`${process.cwd()}${sep}`, '');
        if (/\boutbox\b/i.test(code) && !OUTBOX_FILES.includes(relative)) {
          offenders.push(`${relative} (/\\boutbox\\b/i)`);
        }
      }
    }

    await walk(root);
    expect(offenders, `transport or outbox code in src/:\n  ${offenders.join('\n  ')}`).toEqual([]);

    // AND THE S1F TRANSACTION KNOWS NOTHING ABOUT IT. The sharpest form of the property
    // this suite exists for: the module that owns the atomic authorisation transaction
    // cannot reach the outbox at all, so no outbox write can join that commit point.
    const transaction = (
      await readFile(
        join(process.cwd(), 'src', 'kernel', 'authorisation', 'localAuthorisation.ts'),
        'utf8',
      )
    )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(transaction).not.toMatch(/\boutbox\b/i);
    expect(transaction).not.toMatch(/CLAIMED/);
  });
});
