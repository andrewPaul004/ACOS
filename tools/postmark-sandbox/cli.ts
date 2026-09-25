import { evaluatePostmarkSandboxReadiness, renderPostmarkGateResult } from './gate.js';

/**
 * `npm run verify:postmark-sandbox` — the operator-facing entry point (`§52`).
 *
 * READ ONLY. It evaluates, prints and exits. It publishes no bundle, writes no file, opens
 * no socket, reads no credential value and changes no configuration.
 *
 * `§52`: "It must fail/abort clearly if credentials are absent. It must not silently SKIP."
 * There is no skip branch and no exit code that means "inapplicable" — a non-zero exit means
 * the S1M provider-sandbox validation MAY NOT RUN, and the printed findings say why.
 *
 * IT MUST REPORT RATHER THAN THROW, EVEN WITH NOTHING CONFIGURED. `50 §3f` refuses every
 * authority read when no verified bundle is active, and the first version of this tool
 * inherited that refusal as an uncaught exception at import time — a stack trace instead of
 * a report, on exactly the deployment that most needs a report. `gate.ts` now reads the
 * adapter registry lazily and turns that refusal into a finding.
 */
export async function runPostmarkSandboxCli(
  source: Readonly<Record<string, string | undefined>>,
): Promise<number> {
  const result = await evaluatePostmarkSandboxReadiness(source);
  process.stdout.write(`${renderPostmarkGateResult(result)}\n`);
  return result.status === 'READY_FOR_POSTMARK_SANDBOX_VALIDATION' ? 0 : 1;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  process.argv[1].replace(/\\/g, '/').endsWith('postmark-sandbox/cli.ts');
if (invokedDirectly) {
  process.exitCode = await runPostmarkSandboxCli(process.env);
}
