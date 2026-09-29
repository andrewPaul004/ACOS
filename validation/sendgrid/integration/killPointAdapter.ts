import { readFileSync } from 'node:fs';

import type {
  AdapterInvocation,
  IntegrationAdapter,
  ProviderBoundary,
} from '../../../src/integration/runtime/integrationAdapter.js';
import type { WireOutcome } from '../../../src/integration/protocol/wire.js';
import { ENV_SECRET_LOCATOR } from '../../../src/integration/protocol/runtimeEnvironment.js';
import { integrationAdapter as realSendGridAdapter } from './adapter.js';
import { KILL_POINT_3_EXIT_CODE } from './killPointExit.js';

/**
 * KILL POINT 3, AS A SEPARATE ADAPTER MODULE — `§9`.
 *
 * =================================================================================
 * WHY THE CRASH LIVES HERE AND NOT IN `adapter.ts`
 *
 * Kill point 3 is "after invocation/request acceptance point, before outcome known", and it
 * happens INSIDE the integration child, after the provider accepted and before the response
 * crosses back. A real adapter has no `afterAccepted` callback for the control plane to hook,
 * and `§13` of the S1N mandate forbids giving it one: the dispatch wire carries no control
 * member, so the control plane cannot ask an adapter to do anything but its job.
 *
 * `tests/integration-plane/adapterA/` established the accepted alternative — the behaviour
 * rides on the RUNTIME's OWN LAUNCH CONFIGURATION rather than on a message — and its
 * consequence is stated there and holds here: "one runtime behaves one way for its whole
 * life, the control plane cannot change it mid-flight, and nothing about the outcome is
 * attributable to anything the control plane said."
 *
 * **SO THIS IS A DIFFERENT MODULE SPECIFIER, NOT A FLAG.** `adapter.ts` has no crash branch,
 * no import of this file and no reference to `killPoint`; a descriptor that names
 * `adapter.js` cannot reach this code by any configuration. A run that wants point 3 launches
 * a runtime whose `adapterModule` IS this file, which is a decision taken once, at wiring
 * time, by the operator invoking the harness.
 *
 * =================================================================================
 * THE SEND IS REAL AND THE CRASH IS REAL. THAT IS THE POINT
 *
 * This wrapper does not simulate a send and does not simulate acceptance. It delegates to the
 * REAL adapter, which performs the REAL `POST /v3/mail/send`; only once that has returned
 * does it kill its own process, so the provider genuinely accepted a message that ACOS
 * genuinely has no outcome for. `§9`: "Do not simulate this result and call it provider
 * evidence."
 *
 * `process.exit` rather than a throw, and the difference matters: a throw would be caught by
 * the integration host and answered on the wire, which is a different failure from the one
 * `35 §12.3` describes. An exit produces the silence a SIGKILL produces, and
 * `integrationClient.ts`'s deadline is what the control plane then sees.
 * =================================================================================
 */

/**
 * Re-exported so a reader of THIS module sees the code it exits with, while the value itself
 * is DECLARED ONCE in `killPointExit.ts` — a module the OFFLINE double can import in order to
 * name the same code without acquiring a real vendor send client along with it.
 */
export { KILL_POINT_3_EXIT_CODE };

/**
 * Whether this runtime was launched to crash. Read ONCE, from this runtime's OWN locator
 * document, at module evaluation — never per invocation and never from a message.
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
  adapterId: realSendGridAdapter.adapterId,

  async invoke(invocation: AdapterInvocation, boundary: ProviderBoundary): Promise<WireOutcome> {
    const outcome = await realSendGridAdapter.invoke(invocation, boundary);
    if (ARMED) {
      /*
       * THE REAL SEND HAS RETURNED. THE OUTCOME HAS NOT BEEN REPORTED.
       *
       * Exactly `35 §12.3`'s "The HTTP request leaves; the process dies before the response
       * is recorded." The outbox row stays CLAIMED, no outcome row exists, and the provider
       * holds one accepted message that ACOS cannot see — which is the state only a
       * provider-side read can distinguish from kill point 2.
       */
      process.exit(KILL_POINT_3_EXIT_CODE);
    }
    return outcome;
  },
};

/*
 * THE NAMED EXPORT ABOVE IS `integrationAdapter`, WHICH IS THE NAME THE HOST REQUIRES.
 *
 * `isIntegrationAdapterModule` admits a module carrying that one named export and refuses a
 * default, so a module that failed to provide it is refused at load rather than partially
 * loaded. The name being the SAME as the real adapter's is what lets a descriptor swap one
 * for the other by changing a module specifier and nothing else.
 */
