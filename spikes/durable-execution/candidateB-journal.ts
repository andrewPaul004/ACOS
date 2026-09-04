import { createPool, inTransaction, type Client } from '../../src/db/pool.js';
import {
  KILL,
  killIf,
  stepApplyLedger,
  stepClaim,
  stepComplete,
  stepDispatch,
} from './workItem.js';

/**
 * CANDIDATE B — an ACOS-owned Postgres step journal.
 *
 * `34 ADR-002(b)`: the correct fallback for a DBOS guarantee failure is "an ACOS-owned
 * Postgres step journal. Keeps the checkpoint in the same database and preserves R1."
 * `34 ADR-002(c)`: "This ADR listed a hand-rolled Postgres step journal among its
 * alternatives and never evaluated it."
 *
 * This is the evaluation. It is deliberately the SMALLEST thing that could satisfy the
 * requirement — one table, three queries — because the question the spike asks is not
 * "which is more featureful" but "which preserves ACOS's Postgres transaction
 * semantics with less coupling".
 *
 * THE PROPERTY THAT MATTERS. Step 2's checkpoint row is written INSIDE step 2's own
 * transaction, against the SAME database, on the SAME connection. The application
 * transaction and the durability record therefore share one commit point by
 * construction, not by configuration.
 */

export const STEP_JOURNAL_DDL = `
  CREATE TABLE IF NOT EXISTS acos_step_journal (
    workflow_id   TEXT NOT NULL,
    step_name     TEXT NOT NULL,
    -- The step's recorded output. A completed step is never re-executed; its output is
    -- replayed from here. This is the same guarantee DBOS states, owned by ACOS.
    output        JSONB,
    completed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (workflow_id, step_name)
  );

  CREATE TABLE IF NOT EXISTS acos_workflow (
    workflow_id   TEXT PRIMARY KEY,
    work_item_id  TEXT NOT NULL,
    status        TEXT NOT NULL,
    started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at   TIMESTAMPTZ
  );
`;

export async function createStepJournalSchema(client: Client): Promise<void> {
  await client.query(STEP_JOURNAL_DDL);
}

/**
 * Read a completed step's output, or null. The whole of the never-re-execute guarantee
 * on this side is this function plus the INSERT in `recordStep`.
 */
async function completedStep<T>(
  client: Client,
  workflowId: string,
  stepName: string,
): Promise<{ output: T } | null> {
  const result = await client.query<{ output: T }>(
    `SELECT output FROM acos_step_journal WHERE workflow_id = $1 AND step_name = $2`,
    [workflowId, stepName],
  );
  const row = result.rows[0];
  return row ? { output: row.output } : null;
}

async function recordStep(
  client: Client,
  workflowId: string,
  stepName: string,
  output: unknown,
): Promise<void> {
  await client.query(
    `INSERT INTO acos_step_journal (workflow_id, step_name, output)
     VALUES ($1, $2, $3::JSONB)
     ON CONFLICT (workflow_id, step_name) DO NOTHING`,
    [workflowId, stepName, JSON.stringify(output ?? null)],
  );
}

/**
 * Run a step that is NOT part of the ledger transaction. Its checkpoint is its own
 * transaction, so there is a window between the step's effect and its checkpoint —
 * exactly the window `31 §3.1` says DBOS "narrows but does not close" either.
 */
async function runStep<T>(
  client: Client,
  workflowId: string,
  stepName: string,
  fn: () => Promise<T>,
): Promise<T> {
  const already = await completedStep<T>(client, workflowId, stepName);
  if (already) return already.output;
  const output = await fn();
  await recordStep(client, workflowId, stepName, output);
  return output;
}

export interface RunOptions {
  readonly connectionString: string;
  readonly workflowId: string;
  readonly workItemId: string;
  readonly delta: string;
  readonly killPoint: string;
}

export async function runCandidateB(options: RunOptions): Promise<void> {
  const pool = createPool({ connectionString: options.connectionString, max: 2 });
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO acos_workflow (workflow_id, work_item_id, status)
       VALUES ($1, $2, 'RUNNING')
       ON CONFLICT (workflow_id) DO UPDATE SET status = 'RUNNING'`,
      [options.workflowId, options.workItemId],
    );

    // Step 1 — claim.
    await runStep(client, options.workflowId, 'claim', () =>
      stepClaim(client, options.workItemId),
    );

    killIf(options.killPoint, KILL.BEFORE_TX);

    // Step 2 — THE APPLICATION TRANSACTION, with its checkpoint INSIDE it.
    //
    // This is the whole candidate-B argument in eight lines: the step-journal row and
    // the ledger rows are written by the same connection inside the same BEGIN/COMMIT,
    // so either both are durable or neither is. No configuration makes that untrue and
    // no second database participates.
    const ledgerAlready = await completedStep(client, options.workflowId, 'applyLedger');
    if (!ledgerAlready) {
      await inTransaction(client, 'SERIALIZABLE', async (tx) => {
        const result = await stepApplyLedger(
          tx,
          options.workItemId,
          options.delta,
          options.killPoint,
        );
        await recordStep(tx, options.workflowId, 'applyLedger', result);
        killIf(options.killPoint, KILL.AFTER_CHECKPOINT);
      });
    }

    killIf(options.killPoint, KILL.AFTER_COMMIT);

    // Step 3 — the mock external effect.
    await runStep(client, options.workflowId, 'dispatch', async () => {
      await stepDispatch(client, options.workItemId, `delta=${options.delta}`);
      return { dispatched: true };
    });

    // Step 4 — complete.
    await runStep(client, options.workflowId, 'complete', async () => {
      await stepComplete(client, options.workItemId);
      return { done: true };
    });

    await client.query(
      `UPDATE acos_workflow SET status = 'SUCCESS', finished_at = now() WHERE workflow_id = $1`,
      [options.workflowId],
    );
  } finally {
    client.release();
    await pool.end();
  }
}

/**
 * Recovery. ACOS-owned, and it is the same function as the forward path: re-run the
 * workflow, and every step whose checkpoint exists is replayed from the journal rather
 * than executed.
 */
export async function recoverCandidateB(options: RunOptions): Promise<void> {
  await runCandidateB(options);
}

export async function workflowStatus(
  client: Client,
  workflowId: string,
): Promise<{ status: string | null; steps: string[] }> {
  const wf = await client.query<{ status: string }>(
    `SELECT status FROM acos_workflow WHERE workflow_id = $1`,
    [workflowId],
  );
  const steps = await client.query<{ step_name: string }>(
    `SELECT step_name FROM acos_step_journal WHERE workflow_id = $1 ORDER BY step_name`,
    [workflowId],
  );
  return {
    status: wf.rows[0]?.status ?? null,
    steps: steps.rows.map((r) => r.step_name),
  };
}
