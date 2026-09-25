import { evaluatePreliveReadiness, renderPreliveResult } from './preliveGate.js';

/**
 * `acos prelive verify` — the operator-facing entry point.
 *
 * READ ONLY. It verifies, prints and exits. It publishes no bundle, writes no file, opens no
 * socket and changes no configuration. A non-zero exit means the local control-artifact
 * prerequisites did not all pass, and says nothing about anything else.
 */
export function runPreliveCli(source: Readonly<Record<string, string | undefined>>): number {
  const result = evaluatePreliveReadiness(source);
  process.stdout.write(renderPreliveResult(result));
  return result.status === 'READY_FOR_PROVIDER_SANDBOX_CONFIGURATION' ? 0 : 1;
}

const invokedDirectly =
  process.argv[1] !== undefined && process.argv[1].replace(/\\/g, '/').endsWith('prelive/cli.ts');
if (invokedDirectly) {
  process.exitCode = runPreliveCli(process.env);
}
