import { readFileSync } from 'node:fs';

import type {
  AdapterInvocation,
  IntegrationAdapter,
  ProviderBoundary,
} from '../../../src/integration/runtime/integrationAdapter.js';
import type { WireOutcome } from '../../../src/integration/protocol/wire.js';
import { ENV_SECRET_LOCATOR } from '../../../src/integration/protocol/runtimeEnvironment.js';
import { KILL_POINT_3_EXIT_CODE } from '../../../validation/sendgrid/integration/killPointExit.js';
import { integrationAdapter as doubleAdapter } from './adapter.js';

/**
 * TEST-ONLY. THE OFFLINE DOUBLE OF THE KILL-POINT-3 ADAPTER MODULE.
 *
 * `§9`, `§11.3` point 3: the kill is produced by launching the integration runtime from a
 * DIFFERENT MODULE SPECIFIER, not by a control message. The dispatch wire carries no control
 * member and the driver adds none, so the behaviour rides on the runtime's own launch
 * configuration — the accepted `tests/integration-plane/adapterA/` pattern.
 *
 * It delegates to the double adapter, which performs the real payload parse and the simulated
 * acceptance, and THEN exits. So the simulated account genuinely holds one accepted message
 * that ACOS has no outcome for, which is the state only a provider-side read distinguishes
 * from kill point 2 — and the exit code is the REAL module's, imported rather than copied.
 */
function killPointArmed(): boolean {
  try {
    const document = JSON.parse(
      readFileSync(process.env[ENV_SECRET_LOCATOR] ?? '', 'utf8'),
    ) as { readonly killPoint?: unknown };
    return document.killPoint === 'EXIT_AFTER_SEND';
  } catch {
    return false;
  }
}

const ARMED = killPointArmed();

export const integrationAdapter: IntegrationAdapter = {
  adapterId: doubleAdapter.adapterId,

  async invoke(invocation: AdapterInvocation, boundary: ProviderBoundary): Promise<WireOutcome> {
    const outcome = await doubleAdapter.invoke(invocation, boundary);
    if (ARMED) {
      // The send has been accepted. The outcome has NOT been reported. `35 §12.3`.
      process.exit(KILL_POINT_3_EXIT_CODE);
    }
    return outcome;
  },
};
