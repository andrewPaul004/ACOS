import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPool, inTransaction, type Client, type Pool } from '../../src/db/pool.js';
import { up, down } from '../../src/db/migrate.js';
import { acquireMoneyPathLocks } from '../../src/kernel/exposure/lockOrder.js';
import { createStepJournalSchema, workflowStatus } from './candidateB-journal.js';
import { runChild } from './harness.js';
import {
  COMPANY_ID,
  INSTANCE_KEY,
  KILL,
  STANDING_ID,
  WINDOW_ID,
  createSpikeSchema,
  observe,
  seedSpikeFixture,
  type SpikeObservation,
} from './workItem.js';

/**
 * S1A-9 — THE DURABLE-EXECUTION SPIKE.
 *
 * `phase2-v1.3-implementation-brief.md §4` authorises it and adds the TB-04
 * interleavings to its kill-point matrix. `31 §3.3`: "DBOS remains the provisional
 * recommendation; the spike decides."
 *
 * SEVEN KILL POINTS, per the S1A mandate, plus the TB-04 interleavings in both
 * orderings. Each row records: resulting DB state, workflow state, duplicate behaviour,
 * recovery behaviour, and whether any ACOS invariant is weakened.
 *
 * NOT TEMPORAL. `31 §3.2`: taking Temporal "moves the checkpoint out of Postgres and
 * destroys R1" and is "an explicit return to Option B". `31 §3.3`: "Do not switch to
 * Temporal because it was v1.0's named fallback." It is outside this spike.
 *
 * DEVIATION FROM `31 §3.3`, recorded rather than silent: that section asks for the
 * spike to run "against a vendor sandbox for refundCreate and for the ESP rather than
 * against mocks (VAL-04)". S1A prohibits Stripe, Shopify and ESP adapters and any real
 * credential, so step 3 is a MOCK. What VAL-04 buys — evidence about vendor idempotency
 * — is therefore NOT obtained here and ADR-IMP-002 does not claim it.
 */

const DELTA = '40.00';

let pool: Pool;
let admin: Client;
let appUrl: string;
let sysUrl: string;

/** Records every measured cell, printed as the matrix at the end of the run. */
interface MatrixRow {
  candidate: 'A' | 'B';
  killPoint: string;
  childResult: string;
  dbAfterKill: string;
  workflowAfterKill: string;
  recovery: string;
  duplicates: string;
  invariantWeakened: string;
}
const MATRIX: MatrixRow[] = [];

beforeAll(async () => {
  appUrl = process.env['ACOS_CONTROL_PG_URL'] ?? '';
  // DBOS keeps workflow status and step outputs in a SEPARATE system database. The
  // audit container is reused as a convenient second server; it is NOT the architecture's
  // audit plane and nothing here should be read as provisioning one.
  //
  // S1A-H1. This URL is READ from the environment, published by
  // `tests/support/globalSetup.ts` from `provision()`, which also CREATES the database.
  // It is deliberately no longer derived here by string substitution from
  // ACOS_AUDIT_PG_URL: that derivation named a database `docker compose up` never
  // creates, and the original S1A run passed only because it had been created by hand.
  sysUrl = process.env['ACOS_DBOS_SYS_PG_URL'] ?? '';
  if (!appUrl) throw new Error('ACOS_CONTROL_PG_URL is not set');
  if (!sysUrl) {
    throw new Error(
      'ACOS_DBOS_SYS_PG_URL is not set; globalSetup did not provision the DBOS system ' +
        'database. See tests/support/localPostgres.ts (S1A-H1).',
    );
  }

  pool = createPool({ connectionString: appUrl, max: 8, applicationName: 'acos-spike' });
  admin = await pool.connect();
});

afterAll(async () => {
  if (MATRIX.length > 0) {
    console.log(renderMatrix());
  }
  admin?.release();
  await pool?.end();
});

async function resetForRun(workItemId: string): Promise<void> {
  await down(admin);
  await up(admin);
  await createSpikeSchema(admin);
  await createStepJournalSchema(admin);
  await seedSpikeFixture(admin, workItemId, DELTA);
}

/**
 * Reset ALL DBOS durable state.
 *
 * This function has to exist, and its SHAPE is a finding. DBOS keeps durable state in
 * TWO places, and neither is cleared by resetting the application's own data:
 *
 *   1. `dbos.transaction_completion` — in the APPLICATION database, but in the `dbos`
 *      SCHEMA, which `DROP SCHEMA public CASCADE` does not touch. This is the table that
 *      makes a completed transaction step not re-execute.
 *   2. `dbos.*` in the SYSTEM database — workflow status, step outputs, queues. A
 *      separate database entirely.
 *
 * Candidate B needs no equivalent function: its step journal is an ordinary table in
 * `public`, so it is dropped with the rest of the application data and can never be out
 * of step with the ledger it describes.
 *
 * Measured consequence in "the two databases have independent lifecycles" below.
 */
async function resetDbosState(): Promise<void> {
  // (1) the application-side completion table
  await admin.query('DROP SCHEMA IF EXISTS dbos CASCADE');

  // (2) the system database
  const sysPool = createPool({ connectionString: sysUrl, max: 1 });
  const client = await sysPool.connect();
  try {
    await client.query('DROP SCHEMA IF EXISTS dbos CASCADE');
  } finally {
    client.release();
    await sysPool.end();
  }
}

async function resetForRunA(workItemId: string): Promise<void> {
  await resetForRun(workItemId);
  await resetDbosState();
}

function childEnv(): NodeJS.ProcessEnv {
  return { ACOS_CONTROL_PG_URL: appUrl, ACOS_DBOS_SYS_PG_URL: sysUrl };
}

function describeObservation(o: SpikeObservation): string {
  return (
    `state=${o.workItemState ?? 'null'} realised=${o.realisedMonetary ?? 'null'} ` +
    `standing=${o.standingMonetary ?? 'null'} nextSeq=${o.journalNextSeq ?? 'null'} ` +
    `dispatch=${String(o.dispatchCount)}`
  );
}

function renderMatrix(): string {
  const header = [
    '',
    '  ══════════════════════════════════════════════════════════════════════════',
    '  S1A-9 DURABLE-EXECUTION SPIKE — KILL-POINT MATRIX',
    '  Candidate A: DBOS Transact 4.27.6 / node-pg-datasource 4.27.6',
    '  Candidate B: ACOS-owned Postgres step journal',
    '  ══════════════════════════════════════════════════════════════════════════',
    '',
  ];
  const rows = MATRIX.map(
    (r) =>
      [
        `  [${r.candidate}] ${r.killPoint}`,
        `      child      : ${r.childResult}`,
        `      db state   : ${r.dbAfterKill}`,
        `      workflow   : ${r.workflowAfterKill}`,
        `      recovery   : ${r.recovery}`,
        `      duplicates : ${r.duplicates}`,
        `      invariant  : ${r.invariantWeakened}`,
      ].join('\n'),
  );
  return [...header, ...rows, ''].join('\n');
}

/**
 * The invariant check applied after every kill and every recovery.
 *
 * These are the S1A properties the durability layer must not weaken:
 *   - the four-term sum stays within the ceiling;
 *   - standing == max(0, cap − realised), i.e. TB-04's coupling survives the crash;
 *   - realised is either 0.00 (the transaction did not commit) or exactly the delta
 *     (it committed once) — never a partial and never a double;
 *   - journal_counter is gap-free: next_seq is 1 (unallocated) or 2 (allocated once).
 *
 * ---------------------------------------------------------------------------------
 * S1B.2, FINDING 7 - EXTERNAL DISPATCH IS NOT ONE OF THEM
 *
 * This function used to add `dispatchCount > 1` to the list, classifying a duplicated
 * external dispatch as a weakened S1A substrate invariant. S1A-H4 had already established
 * the opposite, and ADR-IMP-002 was narrowed to say so: a raw step journal plus an
 * UNCLAIMED external step is insufficient for external exactly-once, and closing that hole
 * is the outbox's job (`23 §6` B8, `25 §7`, `33 §1.1`) - S1 work, deliberately not built
 * here.
 *
 * The two properties are therefore SEPARATED rather than merged:
 *
 *   this function          the application-transaction/checkpoint property, which the
 *                          substrate guarantees and which must never weaken;
 *   externalDispatchNote   the OBSERVATION of what the unclaimed external step did, which
 *                          is recorded in the matrix and is not a verdict.
 *
 * The once-observed `dispatchCount == 2` under concurrent retry was therefore a STALE TEST
 * EXPECTATION, not evidence that the ledger checkpoint property failed. It is recorded as
 * repaired, not erased: the deterministic S1A-H4 negative control in
 * `external-step-race.test.ts` still FORCES and OBSERVES two external dispatches, and this
 * spike still asserts exact-once dispatch in every SEQUENTIAL case, where no concurrent
 * external-step race exists.
 * ---------------------------------------------------------------------------------
 */
function invariantVerdict(o: SpikeObservation): string {
  const problems: string[] = [];
  if (!o.withinCeiling) problems.push('four-term sum exceeds the ceiling');
  if (!o.couplingHolds) problems.push('standing != max(0, cap - realised) (TB-04 coupling broken)');
  if (o.realisedMonetary !== null && !['0.00', DELTA].includes(o.realisedMonetary)) {
    problems.push(`realised is ${o.realisedMonetary}, neither 0.00 nor ${DELTA}`);
  }
  if (o.journalNextSeq !== null && !['1', '2'].includes(o.journalNextSeq)) {
    problems.push(`journal next_seq is ${o.journalNextSeq}; expected 1 or 2`);
  }
  return problems.length === 0 ? 'NONE WEAKENED' : problems.join('; ');
}

/**
 * The EXTERNAL DISPATCH observation. Recorded, never classified as an invariant failure.
 *
 * Before the outbox and its exclusive claim exist, a duplicate dispatch under concurrent
 * retry is a KNOWN POSSIBLE RESULT of the shape `runStep` has:
 *
 *     read completed checkpoint  ->  perform step  ->  record completed checkpoint
 *
 * Two truly concurrent workers can both pass the read before either records. Reporting that
 * as "an S1A invariant was weakened" would contradict the accepted S1A-H4 result, and
 * requiring exactly one dispatch there would make a nondeterministic race into a
 * nondeterministic test.
 */
function externalDispatchNote(o: SpikeObservation, concurrent: boolean): string {
  if (o.dispatchCount === 1) return 'dispatch=1 (exactly once)';
  if (o.dispatchCount === 0) return 'dispatch=0 (not reached)';
  return concurrent
    ? `dispatch=${String(o.dispatchCount)} (duplicate under concurrent retry - KNOWN, ` +
        'S1A-H4; the outbox claim is not built - ADR-IMP-002)'
    : `dispatch=${String(o.dispatchCount)} (UNEXPECTED duplicate with no concurrent race)`;
}

function wf_id_for(killPoint: string): string {
  return `wf_b_${killPoint}`;
}

async function candidateBWorkflow(workflowId: string): Promise<string> {
  const status = await workflowStatus(admin, workflowId);
  return `status=${status.status ?? 'null'} steps=[${status.steps.join(',')}]`;
}

/* ------------------------------------------------------------------------------ *
 * Candidate B — the ACOS-owned step journal. Seven kill points.
 * ------------------------------------------------------------------------------ */

const KILL_POINTS: readonly string[] = [
  KILL.BEFORE_TX,
  KILL.AFTER_LOCKS,
  KILL.AFTER_ROWS_BEFORE_COMMIT,
  KILL.AFTER_CHECKPOINT,
  KILL.AFTER_COMMIT,
];

describe('candidate B — ACOS-owned Postgres step journal', () => {
  it('runs the work item to completion with no kill', async () => {
    const id = 'wi_b_clean';
    await resetForRun(id);
    const outcome = await runChild('B', KILL.NONE, 'wf_b_clean', id, DELTA, childEnv());
    expect(outcome.result, outcome.stderr).toBe('COMPLETED');

    const o = await observe(admin, id);
    expect(o.workItemState).toBe('COMPLETE');
    expect(o.realisedMonetary).toBe(DELTA);
    // max(0, 100.00 − 40.00) = 60.00
    expect(o.standingMonetary).toBe('60.00');
    expect(o.journalNextSeq).toBe('2');
    expect(o.dispatchCount).toBe(1);
    expect(invariantVerdict(o)).toBe('NONE WEAKENED');

    MATRIX.push({
      candidate: 'B',
      killPoint: 'NONE (baseline)',
      childResult: 'COMPLETED',
      dbAfterKill: describeObservation(o),
      workflowAfterKill: await candidateBWorkflow('wf_b_clean'),
      recovery: 'n/a',
      duplicates: externalDispatchNote(o, false),
      invariantWeakened: invariantVerdict(o),
    });
  });

  for (const killPoint of KILL_POINTS) {
    it(`survives a kill at ${killPoint} and recovers exactly once`, async () => {
      const id = `wi_b_${killPoint}`;
      const wf = `wf_b_${killPoint}`;
      await resetForRun(id);

      // KILL POINT 1–5.
      const killed = await runChild('B', killPoint, wf, id, DELTA, childEnv());
      expect(killed.result, `child did not reach ${killPoint}: ${killed.stdout}${killed.stderr}`)
        .toBe('KILLED');

      const afterKill = await observe(admin, id);
      const wfAfterKill = await candidateBWorkflow(wf);

      // A kill before commit must leave the ledger untouched. A kill after commit must
      // leave it applied exactly once. Nothing in between is admissible.
      //
      // NOTE ON AFTER_CHECKPOINT — this is candidate B's central result.
      //
      // For candidate B the step-journal row is written INSIDE the application
      // transaction, so "after the checkpoint" and "before the commit" are the SAME
      // INSTANT. A kill there leaves nothing: not the ledger, not the journal sequence,
      // not the checkpoint. There is no state in which the durability layer believes the
      // step completed and the ledger disagrees, because one commit decides both.
      const preCommitKills: readonly string[] = [
        KILL.BEFORE_TX,
        KILL.AFTER_LOCKS,
        KILL.AFTER_ROWS_BEFORE_COMMIT,
        KILL.AFTER_CHECKPOINT,
      ];
      if (preCommitKills.includes(killPoint)) {
        expect(afterKill.realisedMonetary, `${killPoint} left a partial ledger write`).toBe(
          '0.00',
        );
        expect(afterKill.journalNextSeq, `${killPoint} left a journal gap`).toBe('1');
        if (killPoint === KILL.AFTER_CHECKPOINT) {
          // And specifically: the checkpoint is gone too. Checkpoint and ledger are
          // never observable in disagreement.
          const wf = await workflowStatus(admin, wf_id_for(killPoint));
          expect(
            wf.steps,
            'the step journal recorded applyLedger for a transaction that never committed',
          ).not.toContain('applyLedger');
        }
      } else {
        expect(afterKill.realisedMonetary).toBe(DELTA);
        expect(afterKill.journalNextSeq).toBe('2');
      }
      expect(invariantVerdict(afterKill), `after kill at ${killPoint}`).toBe('NONE WEAKENED');

      // KILL POINT 6 — recovery. Re-run the same workflow id.
      const recovered = await runChild('B', KILL.NONE, wf, id, DELTA, childEnv());
      expect(recovered.result, recovered.stderr).toBe('COMPLETED');

      const afterRecovery = await observe(admin, id);
      expect(afterRecovery.workItemState).toBe('COMPLETE');
      // EXACTLY ONCE. The ledger delta is applied once across the crash and the retry.
      expect(
        afterRecovery.realisedMonetary,
        `recovery re-applied the ledger delta at ${killPoint}`,
      ).toBe(DELTA);
      expect(afterRecovery.standingMonetary).toBe('60.00');
      expect(afterRecovery.journalNextSeq, 'recovery allocated a second sequence').toBe('2');
      expect(afterRecovery.dispatchCount, 'recovery duplicated the external effect').toBe(1);
      expect(invariantVerdict(afterRecovery), `after recovery from ${killPoint}`).toBe(
        'NONE WEAKENED',
      );

      MATRIX.push({
        candidate: 'B',
        killPoint,
        childResult: `KILLED (exit ${String(killed.exitCode)}, signal ${String(killed.signal)})`,
        dbAfterKill: describeObservation(afterKill),
        workflowAfterKill: wfAfterKill,
        recovery: `re-run same workflow id → ${describeObservation(afterRecovery)}`,
        duplicates: externalDispatchNote(afterRecovery, false),
        invariantWeakened: invariantVerdict(afterRecovery),
      });
    });
  }

  it('kill point 7 — a CONCURRENT retry of the same work item applies the LEDGER once', async () => {
    /**
     * S1B.2, FINDING 7 — WHAT THIS KILL POINT ASSERTS, AND WHAT IT ONLY OBSERVES.
     *
     * It asserted `dispatchCount <= 1`, and `invariantVerdict` classified a second dispatch
     * as an S1A substrate invariant failure. S1A-H4 established the opposite and
     * ADR-IMP-002 was narrowed accordingly: a raw step journal plus an unclaimed external
     * step is INSUFFICIENT for external exactly-once. The assertion was therefore stale —
     * the once-observed `dispatchCount == 2` was a wrong expectation, not a failure of the
     * ledger checkpoint property.
     *
     * ASSERTED (the application-transaction/checkpoint property — must never weaken):
     *   realised delta applied EXACTLY ONCE;
     *   the TB-04 standing coupling correct;
     *   the journal sequence allocated EXACTLY ONCE;
     *   the four-term sum within the window ceiling.
     *
     * OBSERVED AND RECORDED (not a verdict):
     *   how many times the unclaimed external step dispatched. One or two are both possible
     *   here and neither violates the property above. Requiring one would make a genuine
     *   race into a nondeterministic test; requiring two would assert that a race always
     *   loses, which is equally untrue.
     *
     * The DETERMINISTIC evidence that the hole is real stays where it can be deterministic:
     * `external-step-race.test.ts` forces the interleaving with a barrier and observes two
     * dispatches on every run. The outbox that closes it is S1 work and is not built here.
     */
    const id = 'wi_b_concurrent';
    await resetForRun(id);

    // Two processes, same work item, same workflow id, started together.
    const [a, b] = await Promise.all([
      runChild('B', KILL.NONE, 'wf_b_concurrent', id, DELTA, childEnv()),
      runChild('B', KILL.NONE, 'wf_b_concurrent', id, DELTA, childEnv()),
    ]);

    const o = await observe(admin, id);
    const processes = `\nA: ${a.stdout}${a.stderr}\nB: ${b.stdout}${b.stderr}`;

    // --- ASSERTED: the application transaction and its checkpoint --------------------
    expect(
      o.realisedMonetary,
      `concurrent retry applied the delta more than once${processes}`,
    ).toBe(DELTA);
    expect(o.standingMonetary, `the TB-04 coupling broke${processes}`).toBe('60.00');
    expect(o.journalNextSeq, `a second journal sequence was allocated${processes}`).toBe('2');
    expect(o.withinCeiling).toBe(true);
    expect(o.couplingHolds).toBe(true);
    expect(invariantVerdict(o)).toBe('NONE WEAKENED');

    // --- OBSERVED: the unclaimed external step ---------------------------------------
    // At least one dispatch happened. Without this the row could be recorded from a run in
    // which neither process reached the step, and it would say nothing at all.
    expect(
      o.dispatchCount,
      `no external dispatch was reached${processes}`,
    ).toBeGreaterThanOrEqual(1);
    // And the shape bounds it: two workers can each dispatch at most once.
    expect(o.dispatchCount).toBeLessThanOrEqual(2);

    MATRIX.push({
      candidate: 'B',
      killPoint: 'CONCURRENT_RETRY',
      childResult:
        `${a.result} / ${b.result}` +
        (a.result === 'FAILED' || b.result === 'FAILED'
          ? ' — one process lost the claim race and exited non-zero; ' +
            'the ledger still moved exactly once'
          : ''),
      dbAfterKill: describeObservation(o),
      workflowAfterKill: await candidateBWorkflow('wf_b_concurrent'),
      recovery: 'n/a — both ran forward',
      duplicates: externalDispatchNote(o, true),
      invariantWeakened: invariantVerdict(o),
    });
  });
});

/* ------------------------------------------------------------------------------ *
 * The TB-04 interleavings, added to the matrix by
 * `phase2-v1.3-implementation-brief.md §4`.
 * ------------------------------------------------------------------------------ */

describe('the TB-04 interleaving, inside the spike, both orderings', () => {
  /**
   * An asynchronous realised-spend update against a concurrent authorisation on the
   * same window_balance row — run through the DURABILITY layer rather than directly, so
   * the question is whether the layer changes the answer VC-S8 already established.
   */
  async function interleave(order: 'RECONCILER_FIRST' | 'AUTHORISATION_FIRST'): Promise<void> {
    const id = `wi_tb04_${order}`;
    await resetForRun(id);

    // The concurrent authorisation, on its own connection, taking the declared locks.
    const authClient = await pool.connect();
    const authorise = async (): Promise<'PERMIT' | 'DENIED'> => {
      try {
        await inTransaction(authClient, 'SERIALIZABLE', async (tx) => {
          await acquireMoneyPathLocks(tx, {
            companyId: COMPANY_ID,
            windowInstances: [{ windowId: WINDOW_ID, windowInstanceKey: INSTANCE_KEY }],
            includeStandingRows: true,
            includeJournalCounter: false,
          });
          // 186.00 − 100.00 = 86.00 of true headroom.
          await tx.query(
            `UPDATE window_balance SET reserved_monetary = reserved_monetary + 86.00
              WHERE company_id = $1 AND window_id = $2 AND window_instance_key = $3`,
            [COMPANY_ID, WINDOW_ID, INSTANCE_KEY],
          );
        });
        return 'PERMIT';
      } catch {
        return 'DENIED';
      }
    };

    try {
      const reconciler = runChild('B', KILL.NONE, `wf_${order}`, id, DELTA, childEnv());
      let verdict: 'PERMIT' | 'DENIED';
      if (order === 'RECONCILER_FIRST') {
        await new Promise((resolve) => setTimeout(resolve, 120));
        verdict = await authorise();
        await reconciler;
      } else {
        verdict = await authorise();
        await reconciler;
      }

      const o = await observe(admin, id);
      // The reconciler's delta landed exactly once, the coupling held, and the
      // authorisation either fitted in the true headroom or was refused. In no ordering
      // does the durability layer produce a sum above the ceiling.
      expect(o.realisedMonetary).toBe(DELTA);
      expect(o.couplingHolds, 'TB-04 coupling broke under the durability layer').toBe(true);
      expect(o.withinCeiling, 'the four-term sum exceeded the ceiling').toBe(true);

      MATRIX.push({
        candidate: 'B',
        killPoint: `TB-04 ${order}`,
        childResult: 'COMPLETED',
        dbAfterKill: describeObservation(o),
        workflowAfterKill: `authorisation=${verdict}`,
        recovery: 'n/a',
        duplicates: externalDispatchNote(o, false),
        invariantWeakened: invariantVerdict(o),
      });
    } finally {
      authClient.release();
    }
  }

  it('ordering A — the reconciler workflow runs while an authorisation contends', async () => {
    await interleave('RECONCILER_FIRST');
  });

  it('ordering B — the authorisation runs while the reconciler workflow contends', async () => {
    await interleave('AUTHORISATION_FIRST');
  });
});

/* ------------------------------------------------------------------------------ *
 * Candidate A — DBOS Transact.
 * ------------------------------------------------------------------------------ */

describe('candidate A — DBOS Transact', () => {
  it('records what DBOS requires before a single line of ACOS work can run', async () => {
    // This is a measurement of OPERATIONAL COST, which is one of the criteria the S1A
    // mandate lists. It is recorded whether or not the launch succeeds.
    const id = 'wi_a_clean';
    await resetForRunA(id);

    const outcome = await runChild('A', KILL.NONE, 'wf_a_clean', id, DELTA, childEnv());
    const o = await observe(admin, id);

    const dbosTables = await admin.query<{ table_name: string; table_schema: string }>(
      `SELECT table_schema, table_name FROM information_schema.tables
        WHERE table_schema = 'dbos' ORDER BY table_name`,
    );

    MATRIX.push({
      candidate: 'A',
      killPoint: 'NONE (baseline)',
      childResult: `${outcome.result} — ${outcome.stdout.trim() || outcome.stderr.trim().slice(0, 400)}`,
      dbAfterKill: describeObservation(o),
      workflowAfterKill:
        `dbos schema tables in the APPLICATION db: ` +
        `[${dbosTables.rows.map((r) => r.table_name).join(', ') || 'none'}]`,
      recovery: 'see ADR-IMP-002',
      duplicates: externalDispatchNote(o, false),
      invariantWeakened: invariantVerdict(o),
    });

    // The spike RECORDS the outcome rather than requiring success: an inability to run
    // DBOS against this substrate without additional provisioning is itself the
    // measurement `31 §3.3` asked for, and ADR-IMP-002 states it either way.
    expect(['COMPLETED', 'FAILED', 'KILLED']).toContain(outcome.result);
  });

  for (const killPoint of [
    KILL.AFTER_ROWS_BEFORE_COMMIT,
    KILL.AFTER_CHECKPOINT,
    KILL.AFTER_COMMIT,
  ]) {
    it(`kill at ${killPoint}, then recovery under the same workflow id`, async () => {
      const id = `wi_a_${killPoint}`;
      const wf = `wf_a_${killPoint}`;
      await resetForRunA(id);

      const killed = await runChild('A', killPoint, wf, id, DELTA, childEnv());
      const afterKill = await observe(admin, id);

      // Recovery: a fresh process, same workflow id. DBOS replays checkpointed steps.
      const recovered = await runChild('A', KILL.NONE, wf, id, DELTA, childEnv());
      const afterRecovery = await observe(admin, id);

      // The properties that matter are the SAME ones candidate B is held to. Whatever
      // the durability layer does internally, the ledger must move exactly once and the
      // TB-04 coupling must survive.
      expect(
        afterRecovery.realisedMonetary,
        `the ledger delta is not exactly-once across crash+recovery at ${killPoint}
` +
          `kill: ${killed.stdout}${killed.stderr.slice(0, 300)}
` +
          `recover: ${recovered.stdout}${recovered.stderr.slice(0, 300)}`,
      ).toBe(DELTA);
      expect(afterRecovery.couplingHolds).toBe(true);
      expect(afterRecovery.withinCeiling).toBe(true);
      expect(
        afterRecovery.journalNextSeq,
        'recovery allocated a second journal sequence — a gap or a double',
      ).toBe('2');
      expect(afterRecovery.dispatchCount, 'recovery duplicated the external effect')
        .toBeLessThanOrEqual(1);

      MATRIX.push({
        candidate: 'A',
        killPoint,
        childResult: `${killed.result} (exit ${String(killed.exitCode)})`,
        dbAfterKill: describeObservation(afterKill),
        workflowAfterKill: 'workflow status in the SYSTEM database (separate from the ledger)',
        recovery: `${recovered.result} → ${describeObservation(afterRecovery)}`,
        duplicates: externalDispatchNote(afterRecovery, false),
        invariantWeakened: invariantVerdict(afterRecovery),
      });
    });
  }

  it('MEASURED FINDING: the two databases have independent lifecycles', async () => {
    // `34 ADR-002`'s rationale, verbatim: "DBOS's checkpoint lives in the same Postgres
    // as the exposure ledger and the effect journal, so a step checkpoint and a
    // reservation commit in one transaction."
    //
    // That is true of the TRANSACTION checkpoint (`dbos.transaction_completion`, in the
    // application database) and NOT true of the WORKFLOW record, which lives in the
    // system database. This test measures what that costs, rather than arguing about it.
    const id = 'wi_a_lifecycle';
    const wf = 'wf_a_lifecycle';
    await resetForRunA(id);

    // 1. A clean, successful run. The ledger moves.
    const first = await runChild('A', KILL.NONE, wf, id, DELTA, childEnv());
    expect(first.result, first.stderr.slice(0, 400)).toBe('COMPLETED');
    const afterFirst = await observe(admin, id);
    expect(afterFirst.realisedMonetary).toBe(DELTA);

    // 2. Restore ONLY the application database — the ordinary shape of a restore, a
    //    branch reset, a migration rollback, or a test-environment refresh. The system
    //    database is untouched, exactly as it would be if it were a separate service.
    await resetForRun(id);
    const afterReset = await observe(admin, id);
    expect(afterReset.realisedMonetary).toBe('0.00');

    // 3. Re-run the SAME workflow id.
    const second = await runChild('A', KILL.NONE, wf, id, DELTA, childEnv());
    const afterSecond = await observe(admin, id);

    // DBOS behaves correctly by its own contract: the workflow id already completed, so
    // it is not re-executed. The ACOS consequence is that the work silently does not
    // happen and the process still reports success.
    const workSkipped = afterSecond.realisedMonetary === '0.00';

    MATRIX.push({
      candidate: 'A',
      killPoint: 'SYSTEM-DB LIFECYCLE DIVERGENCE',
      childResult: `${first.result} then ${second.result}`,
      dbAfterKill:
        `after app-db restore: ${describeObservation(afterReset)}; ` +
        `after re-run: ${describeObservation(afterSecond)}`,
      workflowAfterKill: 'system db still holds the workflow as complete',
      recovery: workSkipped
        ? 'NOT RE-EXECUTED — the process reports success and the ledger stays untouched'
        : 're-executed against the restored application database',
      duplicates: externalDispatchNote(afterSecond, false),
      invariantWeakened: workSkipped
        ? 'no ACOS invariant is violated, but the work silently did not happen'
        : 'none',
    });

    // The measurement is recorded either way. What must NOT happen is a DOUBLE
    // application, and it does not.
    expect(['0.00', DELTA]).toContain(afterSecond.realisedMonetary);
    expect(afterSecond.withinCeiling).toBe(true);
    expect(afterSecond.couplingHolds).toBe(true);
  });

  it('records whether the DBOS checkpoint shares the application transaction', async () => {
    // The narrow question the S1A mandate poses: "Does DBOS preserve or materially
    // complicate ACOS's Postgres transaction semantics compared with an ACOS-owned step
    // journal?"
    //
    // Answered structurally: is `dbos.transaction_completion` in the APPLICATION
    // database (so it can share a commit with window_balance), or only in the system
    // database (so it cannot)?
    const inAppDb = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM information_schema.tables
        WHERE table_schema = 'dbos' AND table_name = 'transaction_completion'`,
    );
    const present = inAppDb.rows[0]?.n === '1';

    MATRIX.push({
      candidate: 'A',
      killPoint: 'CHECKPOINT LOCATION',
      childResult: 'structural inspection',
      dbAfterKill: present
        ? 'dbos.transaction_completion EXISTS in the application database'
        : 'dbos.transaction_completion NOT FOUND in the application database',
      workflowAfterKill: 'workflow status and step outputs live in the SYSTEM database',
      recovery: 'n/a',
      duplicates: 'n/a',
      invariantWeakened: present
        ? 'transaction step: shares the application commit. workflow state: does not.'
        : 'not measurable — schema absent',
    });

    expect(typeof present).toBe('boolean');
  });
});

/* ------------------------------------------------------------------------------ *
 * The substrate property both candidates must preserve.
 * ------------------------------------------------------------------------------ */

describe('the property the spike exists to protect', () => {
  it('journal_seq is gap-free across a rollback — a SEQUENCE would fail this', async () => {
    // `30 §5.2`: "PostgreSQL sequences are non-transactional: nextval outside the
    // transaction leaves permanent gaps on rollback, and a gap is the one signal I17
    // reads as suppression. The allocator is therefore a row."
    //
    // This is a property of the SUBSTRATE, not of either candidate, and
    // `phase2-v1.3-implementation-brief.md §4` says so. It is asserted here because if
    // it failed, neither candidate could be selected.
    await resetForRun('wi_gapfree');

    const client = await pool.connect();
    try {
      const before = await observe(admin, 'wi_gapfree');
      expect(before.journalNextSeq).toBe('1');

      // Allocate, then roll back.
      await client.query('BEGIN');
      await client.query(
        `UPDATE journal_counter SET next_seq = next_seq + 1 WHERE company_id = $1`,
        [COMPANY_ID],
      );
      await client.query('ROLLBACK');

      const after = await observe(admin, 'wi_gapfree');
      expect(after.journalNextSeq, 'the rollback left a gap in journal_seq').toBe('1');

      // And a PostgreSQL SEQUENCE demonstrably does NOT have this property.
      await client.query('CREATE SEQUENCE IF NOT EXISTS gapfree_probe');
      await client.query('BEGIN');
      await client.query(`SELECT nextval('gapfree_probe')`);
      await client.query('ROLLBACK');
      const seq = await client.query<{ v: string }>(`SELECT nextval('gapfree_probe')::text AS v`);
      // The rolled-back nextval consumed 1, so the next value is 2 — a permanent gap.
      expect(seq.rows[0]?.v).toBe('2');
      await client.query('DROP SEQUENCE gapfree_probe');
    } finally {
      client.release();
    }
  });

  it('the standing authorisation and the balance are in ONE database, on ONE connection', async () => {
    // The Option A property `33 §1` calls decisive: "the reservation and the step journal
    // in one transaction." Asserted here as the thing a durability choice must not break.
    const result = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN ('window_balance', 'standing_window_exposure', 'journal_counter')`,
    );
    expect(result.rows[0]?.n).toBe('3');

    const spanning = await admin.query<{ current_database: string }>(
      `SELECT current_database()`,
    );
    expect(spanning.rows[0]?.current_database).toBe('acos_control');
    void STANDING_ID;
  });
});
