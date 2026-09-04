import { DBOS } from '@dbos-inc/dbos-sdk';
import { NodePostgresDataSource } from '@dbos-inc/node-pg-datasource';

import type { Client } from '../../src/db/pool.js';
import {
  KILL,
  killIf,
  stepApplyLedger,
  stepClaim,
  stepComplete,
  stepDispatch,
} from './workItem.js';

/**
 * CANDIDATE A — DBOS Transact.
 *
 * `34 ADR-002`: "DBOS Transact (MIT, v2.23.0, 2026-06-01) as primary — provisional, and
 * subject to an S1 spike against an ACOS-owned Postgres step journal on the same
 * kill-point matrix."
 *
 * VERSION TESTED. The architecture pins v2.23.0. The version actually installed and
 * tested here is **@dbos-inc/dbos-sdk 4.27.6** with **@dbos-inc/node-pg-datasource
 * 4.27.6**, because 2.23.0 is not the current major on npm and the S1A mandate requires
 * inspecting current first-party documentation and recording exact versions. The gap
 * between the ADR's pin and the shipped version is itself a finding and is recorded in
 * docs/implementation/ADR-IMP-002-durable-execution.md. `latest` is not used anywhere.
 *
 * `31 §3.1`, on what the guarantee reaches, verbatim: DBOS "eliminates re-execution
 * across suspension and resume [...] It narrows but does not close the crash-during-
 * dispatch window, because an incomplete step is not a checkpointed step."
 *
 * The S1A mandate: "Do not assume an external HTTP call is exactly-once merely because a
 * DBOS workflow is durable. For this spike the key question is narrower: Does DBOS
 * preserve or materially complicate ACOS's Postgres transaction semantics compared with
 * an ACOS-owned step journal?"
 *
 * ---------------------------------------------------------------------------------
 * THE TWO DATABASES, which is the finding this file exists to expose.
 *
 * DBOS keeps TWO kinds of durable state:
 *
 *   (a) TRANSACTION COMPLETION — `dbos.transaction_completion` in the APPLICATION
 *       database, written by the data source inside the user's own transaction. The
 *       first-party docs state this as "atomically committing both user-defined changes
 *       and a DBOS checkpoint". This is the property ACOS needs and DBOS has it.
 *
 *   (b) WORKFLOW STATUS AND STEP OUTPUTS — the SYSTEM DATABASE, addressed by
 *       `systemDatabaseUrl`. This is a SEPARATE database, and writes to it are NOT in
 *       the application transaction.
 *
 * So the answer to the spike's narrow question is split, and the split is the result.
 * See ADR-IMP-002.
 * ---------------------------------------------------------------------------------
 */

export interface DbosInit {
  readonly appDatabaseUrl: string;
  readonly systemDatabaseUrl: string;
}

let dataSource: NodePostgresDataSource | null = null;

export function getDataSource(): NodePostgresDataSource {
  if (!dataSource) throw new Error('DBOS data source is not initialised');
  return dataSource;
}

/** Create the schemas DBOS needs. Run once against a fresh database. */
export async function initialiseDbosSchemas(init: DbosInit): Promise<void> {
  await NodePostgresDataSource.initializeDBOSSchema({ connectionString: init.appDatabaseUrl });
}

export interface DbosRunOptions {
  readonly init: DbosInit;
  readonly workflowId: string;
  readonly workItemId: string;
  readonly delta: string;
  readonly killPoint: string;
}

/**
 * Build and register the workflow.
 *
 * Registration must happen BEFORE `DBOS.launch()`, and the same function must be
 * registered under the same name in the recovering process or recovery cannot find it —
 * a real operational constraint, recorded in ADR-IMP-002 under "coupling".
 */
export function buildWorkflow(options: DbosRunOptions): () => Promise<void> {
  const ds = getDataSource();

  // Step 2 — the ACOS application transaction, run as a DBOS transaction so its
  // checkpoint commits with it.
  const applyLedger = ds.registerTransaction(
    async (): Promise<unknown> => {
      const tx = NodePostgresDataSource.client as unknown as Client;
      const result = await stepApplyLedger(
        tx,
        options.workItemId,
        options.delta,
        options.killPoint,
      );
      killIf(options.killPoint, KILL.AFTER_CHECKPOINT);
      return result;
    },
    { name: 'applyLedger', isolationLevel: 'SERIALIZABLE' },
  );

  const claim = ds.registerTransaction(
    async (): Promise<unknown> => {
      const tx = NodePostgresDataSource.client as unknown as Client;
      return stepClaim(tx, options.workItemId);
    },
    { name: 'claim', isolationLevel: 'READ COMMITTED' },
  );

  const dispatch = ds.registerTransaction(
    async (): Promise<unknown> => {
      const tx = NodePostgresDataSource.client as unknown as Client;
      await stepDispatch(tx, options.workItemId, `delta=${options.delta}`);
      return { dispatched: true };
    },
    { name: 'dispatch', isolationLevel: 'READ COMMITTED' },
  );

  const complete = ds.registerTransaction(
    async (): Promise<unknown> => {
      const tx = NodePostgresDataSource.client as unknown as Client;
      await stepComplete(tx, options.workItemId);
      return { done: true };
    },
    { name: 'complete', isolationLevel: 'READ COMMITTED' },
  );

  return DBOS.registerWorkflow(
    async (): Promise<void> => {
      await claim();
      killIf(options.killPoint, KILL.BEFORE_TX);
      await applyLedger();
      killIf(options.killPoint, KILL.AFTER_COMMIT);
      await dispatch();
      await complete();
    },
    { name: 'spikeWorkflow' },
  );
}

export async function launchDbos(init: DbosInit): Promise<void> {
  dataSource = new NodePostgresDataSource('acos_spike', {
    connectionString: init.appDatabaseUrl,
    max: 4,
  });
  DBOS.setConfig({
    name: 'acos-s1a-spike',
    systemDatabaseUrl: init.systemDatabaseUrl,
    enableOTLP: false,
    logLevel: 'error',
  });
}

export async function runCandidateA(options: DbosRunOptions): Promise<void> {
  await launchDbos(options.init);
  const workflow = buildWorkflow(options);
  await DBOS.launch();
  try {
    await DBOS.withNextWorkflowID(options.workflowId, async () => {
      await workflow();
    });
  } finally {
    await DBOS.shutdown();
  }
}

/**
 * Recovery. DBOS re-drives an interrupted workflow when a process with the same
 * executor identity launches and the workflow's status is still PENDING; re-invoking
 * under the same workflow id replays checkpointed steps rather than re-executing them.
 */
export async function recoverCandidateA(options: DbosRunOptions): Promise<void> {
  await runCandidateA(options);
}

export async function dbosWorkflowStatus(workflowId: string): Promise<string | null> {
  const status = await DBOS.getWorkflowStatus(workflowId);
  return status?.status ?? null;
}
