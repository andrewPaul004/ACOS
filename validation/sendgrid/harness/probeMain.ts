import { runProbe } from './probeRuntime.js';

/**
 * THE ONE-SHOT CREDENTIAL PROCESS'S ENTRY POINT.
 *
 * It exists so `probeRuntime.ts` can have NO module-evaluation side effect: a module that
 * runs itself when imported is a module whose safety depends on nobody importing it, and the
 * offline suite imports `probeRuntime.ts` to drive `runProbe` against a fixture environment
 * with no credential in it.
 *
 * This file is what `probeClient.ts` FORKS, and it is the whole of the process's behaviour:
 * run one role, print one sanitized line, exit. There is no loop, no server and no second
 * question this process can be asked.
 */
void runProbe().then(
  () => {
    process.exitCode = 0;
  },
  () => {
    /*
     * A THROW PRINTS NOTHING AND EXITS NON-ZERO.
     *
     * `§23`: an exception's message must not cross the process boundary — it can carry a
     * filesystem path, a module specifier or a provider URL. The parent classifies a silent
     * non-zero exit as `PROBE_PROCESS_FAILED`, which is all it is entitled to conclude.
     */
    process.exitCode = 1;
  },
);
