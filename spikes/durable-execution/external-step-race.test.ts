import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPool, type Client, type Pool } from '../../src/db/pool.js';
import { up, down } from '../../src/db/migrate.js';
import { SQLSTATE, hasSqlstate } from '../../src/kernel/exposure/errors.js';
import { Conductor, settleAll } from '../../tests/support/barrier.js';
import {
  applyLedgerStep,
  createStepJournalSchema,
  runStep,
  type RunOptions,
  type StepPhase,
} from './candidateB-journal.js';
import {
  KILL,
  createSpikeSchema,
  observe,
  seedSpikeFixture,
  stepDispatch,
} from './workItem.js';

/**
 * S1A-H4 — the durable journal is selected for IN-DATABASE CHECKPOINTING, not for
 * external exactly-once.
 *
 * An owner review finding, and a NARROWING of what ADR-IMP-002 claims rather than a
 * change of its decision.
 *
 * WHAT WAS OVERCLAIMED. ADR-IMP-002 originally said the two candidates were "equally
 * correct". The kill-point matrix supports a narrower statement: both candidates were
 * correct FOR THE S1A APPLICATION-TRANSACTION/CHECKPOINT PROPERTY UNDER TEST. It does not
 * support a claim about external effects, and the generic `runStep` in
 * `candidateB-journal.ts` does not provide one:
 *
 *     read completed checkpoint  →  perform step  →  record completed checkpoint
 *
 * Two truly concurrent workers can both pass the read before either records. For a
 * nontransactional or external effect, both then perform it.
 *
 * THIS FILE MEASURES BOTH HALVES OF THE ASYMMETRY, deterministically, with the same
 * barrier-driven race shape applied to each:
 *
 *   1. THE NEGATIVE CONTROL — the same race against the generic `runStep` around an
 *      unclaimed external effect. The effect happens TWICE. The lesson is
 *      "raw step journal + unclaimed external step is insufficient", NOT "turn `runStep`
 *      into the production dispatcher".
 *
 *   2. THE CONTRAST — the same race against `applyLedgerStep`, where the checkpoint is
 *      written inside the ledger transaction. The ledger moves EXACTLY ONCE, and it is
 *      the SUBSTRATE that prevents the double, not the journal. The property ADR-IMP-002
 *      selected on is therefore intact, and the winner does not change.
 *
 * WHAT CLOSES THE HOLE, and where it is assigned: `23 §6` B8, `25 §7` and `33 §1.1` —
 * an ACOS-owned dispatch outbox with an exclusive work-item claim, plus vendor
 * idempotency. It is S1 work. Building it here would be implementing the production
 * orchestrator inside an S1A spike, which the S1A mandate prohibits.
 *
 * No production code in `src/` is touched by this file, and nothing here weakens
 * candidate B. The only change to the spike was to EXPORT the two step functions and give
 * each an optional test-only barrier hook, so this test drives the real code rather than
 * a reimplementation of it.
 */

const DELTA = '40.00';

let pool: Pool;
let admin: Client;

beforeAll(async () => {
  const appUrl = process.env['ACOS_CONTROL_PG_URL'];
  if (!appUrl) throw new Error('ACOS_CONTROL_PG_URL is not set');
  pool = createPool({ connectionString: appUrl, max: 8, applicationName: 'acos-step-race' });
  admin = await pool.connect();
});

afterAll(async () => {
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

async function checkpointNames(workflowId: string): Promise<string[]> {
  const result = await admin.query<{ step_name: string }>(
    `SELECT step_name FROM acos_step_journal WHERE workflow_id = $1 ORDER BY step_name`,
    [workflowId],
  );
  return result.rows.map((r) => r.step_name);
}

/** Park at AFTER_READ only. That is the boundary the shape does not protect. */
function parkAfterRead(
  conductor: Conductor,
  name: string,
): (phase: StepPhase) => Promise<void> {
  const participant = conductor.participant(name);
  return async (phase: StepPhase): Promise<void> => {
    if (phase === 'AFTER_READ') await participant.at('AFTER_READ');
  };
}

/** Hold both workers at AFTER_READ, then release them together. */
async function releaseTogether(conductor: Conductor, names: readonly string[]): Promise<void> {
  for (const name of names) await conductor.until(name, 'AFTER_READ');
  for (const name of names) conductor.release(name, 'AFTER_READ');
}

describe('S1A-H4 NEGATIVE CONTROL — an unclaimed external step races', () => {
  it('two concurrent workers BOTH dispatch, and the journal records ONE checkpoint', async () => {
    const workItemId = 'wi_race_dispatch';
    const workflowId = 'wf_race_dispatch';
    await resetForRun(workItemId);

    const conductor = new Conductor();
    const workers = ['worker_a', 'worker_b'] as const;

    const runWorker = (name: string) => async (): Promise<string> => {
      const client = await pool.connect();
      try {
        const output = await runStep(
          client,
          workflowId,
          'dispatch',
          async () => {
            // The MOCK external effect. In production this is a vendor call, and a
            // vendor call cannot be rolled back by a later ROLLBACK.
            await stepDispatch(client, workItemId, `dispatched-by=${name}`);
            return { dispatched: true, by: name };
          },
          parkAfterRead(conductor, name),
        );
        return output.by;
      } finally {
        client.release();
      }
    };

    let results;
    try {
      [results] = await Promise.all([
        settleAll(workers.map((name) => runWorker(name))),
        releaseTogether(conductor, workers),
      ]);
    } catch (error) {
      conductor.abort(error);
      throw error;
    }

    // Both workers completed without error. Nothing failed; that is what makes this a
    // silent duplicate rather than a visible one.
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);

    const o = await observe(admin, workItemId);

    // THE FINDING. The external effect happened TWICE.
    expect(
      o.dispatchCount,
      'the unclaimed external step did NOT double — the race did not occur and this ' +
        `negative control proves nothing.\ntimeline:\n  ${conductor.timeline().join('\n  ')}`,
    ).toBe(2);

    // And the journal holds exactly ONE checkpoint for it, because `ON CONFLICT DO
    // NOTHING` deduplicates the RECORD and not the EFFECT. The journal therefore reports
    // one dispatch where two happened, which is the precise shape of the limitation.
    expect(await checkpointNames(workflowId)).toEqual(['dispatch']);

    // Stated once more as the lesson, so a reader cannot take this as a bug report
    // against `runStep`: external exactly-once is the outbox's job, not the journal's.
    // `23 §6` B8, `25 §7`, `33 §1.1`.
  });
});

describe('S1A-H4 CONTRAST — the application-transaction checkpoint property is intact', () => {
  it('the same race against applyLedgerStep applies the ledger EXACTLY ONCE', async () => {
    const workItemId = 'wi_race_ledger';
    const workflowId = 'wf_race_ledger';
    await resetForRun(workItemId);

    const conductor = new Conductor();
    const workers = ['ledger_a', 'ledger_b'] as const;

    const options = (): RunOptions => ({
      connectionString: process.env['ACOS_CONTROL_PG_URL']!,
      workflowId,
      workItemId,
      delta: DELTA,
      killPoint: KILL.NONE,
    });

    const runWorker = (name: string) => async (): Promise<string> => {
      const client = await pool.connect();
      try {
        await applyLedgerStep(client, options(), parkAfterRead(conductor, name));
        return name;
      } finally {
        client.release();
      }
    };

    let results;
    try {
      [results] = await Promise.all([
        settleAll(workers.map((name) => runWorker(name))),
        releaseTogether(conductor, workers),
      ]);
    } catch (error) {
      conductor.abort(error);
      throw error;
    }

    // Exactly one application committed. The other was refused BY THE SUBSTRATE.
    const committed = results.filter((r) => r.status === 'fulfilled');
    const refused = results.filter((r) => r.status === 'rejected');
    expect(
      committed.length,
      `expected exactly one commit.\ntimeline:\n  ${conductor.timeline().join('\n  ')}`,
    ).toBe(1);
    expect(refused.length).toBe(1);

    // AND THE REFUSAL IS 40001, NOT SILENCE. The loser's `SELECT … FOR UPDATE` reached a
    // window_balance row the winner had already updated and committed
    // (S1A-implementation-log.md §8). It is fail-closed: nothing committed, no headroom
    // taken, no journal gap.
    const reason = refused[0]!.status === 'rejected' ? refused[0]!.reason : null;
    expect(
      hasSqlstate(reason, SQLSTATE.SERIALIZATION_FAILURE),
      `expected 40001 from the losing application, got: ${String(reason)}`,
    ).toBe(true);
    expect(
      hasSqlstate(reason, SQLSTATE.DEADLOCK_DETECTED),
      'the concurrent ledger applications deadlocked; the declared lock order is violated',
    ).toBe(false);

    const o = await observe(admin, workItemId);
    expect(o.realisedMonetary, 'the ledger delta was applied more than once').toBe(DELTA);
    expect(o.standingMonetary, 'the TB-04 coupling broke').toBe('60.00');
    expect(o.journalNextSeq, 'a second journal sequence was allocated').toBe('2');
    expect(o.withinCeiling).toBe(true);
    expect(o.couplingHolds).toBe(true);

    // One checkpoint, written by the transaction that committed the ledger.
    expect(await checkpointNames(workflowId)).toEqual(['applyLedger']);
  });
});
