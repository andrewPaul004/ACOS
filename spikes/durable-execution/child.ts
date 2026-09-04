/**
 * Kill-point child process.
 *
 * The S1A mandate: "Do not infer kill-point behavior from documentation alone where it
 * can be tested locally."
 *
 * A kill must be a real process death, not a thrown exception, or the test measures
 * error handling rather than crash recovery. This module is therefore an entry point
 * run as a SEPARATE OS PROCESS, which SIGKILLs itself at the named point. No `finally`
 * runs, no connection is closed politely, and PostgreSQL discovers the loss the way it
 * would discover a machine going away.
 *
 * Invoked as:
 *   tsx spikes/durable-execution/child.ts <candidate> <killPoint> <workflowId> <workItemId> <delta>
 */

import { runCandidateA } from './candidateA-dbos.js';
import { runCandidateB } from './candidateB-journal.js';

async function main(): Promise<void> {
  const [candidate, killPoint, workflowId, workItemId, delta] = process.argv.slice(2);
  if (!candidate || !killPoint || !workflowId || !workItemId || !delta) {
    throw new Error(
      'usage: child.ts <A|B> <killPoint> <workflowId> <workItemId> <delta>',
    );
  }

  const appUrl = process.env['ACOS_CONTROL_PG_URL'];
  const sysUrl = process.env['ACOS_DBOS_SYS_PG_URL'];
  if (!appUrl) throw new Error('ACOS_CONTROL_PG_URL is not set');

  if (candidate === 'A') {
    if (!sysUrl) throw new Error('ACOS_DBOS_SYS_PG_URL is not set');
    await runCandidateA({
      init: { appDatabaseUrl: appUrl, systemDatabaseUrl: sysUrl },
      workflowId,
      workItemId,
      delta,
      killPoint,
    });
  } else if (candidate === 'B') {
    await runCandidateB({
      connectionString: appUrl,
      workflowId,
      workItemId,
      delta,
      killPoint,
    });
  } else {
    throw new Error(`unknown candidate ${candidate}`);
  }

  process.stdout.write('COMPLETED\n');
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    process.stdout.write(`FAILED ${String(error)}\n`);
    process.exit(1);
  },
);
