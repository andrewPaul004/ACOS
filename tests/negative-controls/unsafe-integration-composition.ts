import type { AdapterOutcome, DispatchEnvelope } from '../../src/kernel/gateway/adapterPort.js';
import type { IntegrationClient } from '../../src/integration/control/integrationClient.js';
import { buildDispatchRequest } from '../../src/integration/control/integrationClient.js';
import type {
  AdapterRuntimeDescriptor,
  AdapterRuntimeRegistry,
} from '../../src/integration/control/adapterRuntimeRegistry.js';
import {
  scanPerimeter,
  type PerimeterReport,
} from '../../tools/perimeter/perimeterScan.js';

/**
 * UNSAFE — TEST-ONLY. THE COMPOSITION BOUNDARY, BROKEN FOUR WAYS.
 *
 * `§52` controls 7, 10, 12, 13 and 14:
 *
 *   7.  "worker bypasses Effect Gateway and calls integration"
 *   10. "IPC timeout maps ambiguous send to NOT_SENT"
 *   12. "third adapter allowed without option-B trigger"
 *   13. "money-moving credential allowed under option A when proxy is required"
 *   14. "unannotated external-client call site passes CI"
 */

/**
 * CONTROL 7 — A WORKER-SHAPED MODULE THAT REACHES THE INTEGRATION TRANSPORT DIRECTLY.
 *
 * =================================================================================
 * WHAT THE BYPASS ACTUALLY SKIPS, AND WHY IT IS THE WHOLE SLICE
 *
 * `§19`: "Do not permit any arbitrary control module to invoke integration runtime directly.
 * The Effect Gateway remains the sole production dispatch origin. Maintain: kernel authority
 * -> Effect Gateway -> integration transport -> adapter runtime."
 *
 * Going straight to the transport skips, in order: `25 §14.1`'s Epoch B dispatch lease,
 * dispatch-time revalidation, the exclusive durable claim, the fresh-claim capability, EM6
 * adapter eligibility, and the entire outcome transaction. So the effect is dispatched with
 * no claim, no journal row and no ledger movement — which is `48 §1`'s "the only permitted
 * path is a policy" in one function.
 *
 * IT NEEDS AN ENVELOPE, AND THAT IS PART OF THE DISCRIMINATION. `DispatchEnvelope` is an
 * interface, so a bypasser can build one by hand — which is exactly why the boundary is
 * enforced STRUCTURALLY rather than by a type: the production property is that no module
 * under `src/` imports `integrationClient.js` at all except the composition that the Effect
 * Gateway resolves through, and the boundary suite asserts that import list by hand.
 * =================================================================================
 */
export function unsafeWorkerBypass(
  client: IntegrationClient,
  registry: AdapterRuntimeRegistry,
  envelope: DispatchEnvelope,
): Promise<AdapterOutcome> {
  const descriptor = registry.resolve(envelope.adapter);
  if (descriptor === undefined) {
    return Promise.resolve({ kind: 'NOT_SENT_CONFIRMED', basis: 'PRE_SEND_FAILURE' });
  }
  // THE VIOLATION: the adapter registry the gateway would resolve through is bypassed, and
  // the transport is driven from a module with no kernel authority at all.
  const proxy = client.adapterRegistry().resolve(envelope.adapter);
  if (proxy === undefined) {
    return Promise.resolve({ kind: 'NOT_SENT_CONFIRMED', basis: 'PRE_SEND_FAILURE' });
  }
  return proxy.dispatch(envelope);
}

/** The wire request a bypasser would build. Exposed so a test can inspect what it carries. */
export function unsafeDirectRequest(envelope: DispatchEnvelope): ReturnType<typeof buildDispatchRequest> {
  return buildDispatchRequest(envelope);
}

/**
 * CONTROL 10 — A CLIENT THAT MAPS A DEADLINE TO `NOT_SENT_CONFIRMED`.
 *
 * =================================================================================
 * THE MOST DANGEROUS SINGLE LINE IN THE SLICE
 *
 * `§41`: "**Timeout does NOT mean NOT_SENT** if the integration process may have crossed the
 * synthetic provider boundary."
 *
 * `25 §7.1`'s outcome table gives `NOT_SENT_CONFIRMED` a terminal local state that RELEASES
 * the commitment — `DISPATCH_NOT_SENT_CONFIRMED / RESERVATION_RELEASED`, and for an
 * IRRECOVERABLE class `MIE_RESERVED_RELEASED`. `25 §7.2`: labelling a possible escape as a
 * confirmed non-send "would release a commitment for an effect that happened."
 *
 * So this mapper releases an irrecoverable unit for a send that may have reached a provider,
 * and the released unit is then available to authorise another one. The discrimination is
 * read off the LEDGER rather than off the returned value: production leaves the reservation
 * held under `OUTCOME_UNKNOWN`, and this releases it.
 * =================================================================================
 */
export function unsafeTimeoutMapping(outcome: AdapterOutcome): AdapterOutcome {
  if (outcome.kind === 'OUTCOME_UNKNOWN' && outcome.reason === 'TIMEOUT') {
    // THE VIOLATION.
    return { kind: 'NOT_SENT_CONFIRMED', basis: 'PRE_SEND_FAILURE' };
  }
  return outcome;
}

/**
 * CONTROLS 12 AND 13 — AN OPTION-A REGISTRY WITH ADR-024's TRIGGER REMOVED.
 *
 * `§35`: "Add a mechanism/assertion that this trigger cannot silently disappear. If a third
 * adapter is registered under option A: refuse startup/configuration. Likewise a
 * money-moving credential class."
 *
 * ADR-024: the execution proxy is built "at the first money-moving credential or the third
 * adapter, whichever comes first", and its two benefits are unavailable under option A —
 * "action scoping becomes enforceable at the point the credential is presented, and raw
 * vendor responses can be retained outside the adapter."
 *
 * This registry validates identity and duplication and NOTHING ELSE, which is what a
 * registry written without reading ADR-024 looks like. It accepts a third adapter and it
 * accepts `mock_processor`, whose `refund.create` entry carries a vendor monetary field in
 * the VERIFIED class-3 artifact.
 */
export function unsafeAdapterRuntimeRegistry(
  descriptors: readonly AdapterRuntimeDescriptor[],
): AdapterRuntimeRegistry {
  const byId = new Map<string, AdapterRuntimeDescriptor>();
  for (const descriptor of descriptors) {
    if (byId.has(descriptor.adapterId)) {
      throw new Error(`duplicate adapter runtime "${descriptor.adapterId}"`);
    }
    // THE VIOLATION: no count check, no class-5 credential lookup, no catalogue read.
    // v1.3.7 sharpens what is missing: production reads the SIGNED credential record and
    // refuses on its `credential_risk_class`, and this registry never looks one up at all.
    byId.set(descriptor.adapterId, descriptor);
  }
  return Object.freeze({
    resolve: (adapterId: string): AdapterRuntimeDescriptor | undefined => byId.get(adapterId),
    registeredIds: Object.freeze([...byId.keys()].sort()),
    // No credential was consulted, so there is no scope to report. Production returns the
    // signed record it admitted the adapter against.
    credentialScopeOf: () => undefined,
  });
}

/**
 * CONTROL 14 — A PERIMETER CHECK THAT REPORTS AND DOES NOT GATE.
 *
 * =================================================================================
 * THE FAILURE `48 §7` QUESTION 4 IS ABOUT
 *
 * "Has the CI check been disabled, weakened, or worked around for any build? **Question 4
 * is the one that matters most**, and it is the one a reviewer is least likely to ask. A
 * perimeter enforced by a check that someone turned off for a release is not a perimeter."
 *
 * This is not the check turned OFF — that would be too obvious to be a useful control. It
 * is the check turned into a REPORT: it enumerates every site exactly as production does,
 * prints them, and returns `pass: true` regardless. Every artifact a reviewer looks at is
 * identical; only the exit code differs.
 *
 * The discrimination is run over a fixture tree containing one unannotated provider-client
 * call site: production returns `pass: false` and this returns `pass: true`.
 * =================================================================================
 */
export async function unsafePerimeterScan(
  cwd: string,
  roots: readonly string[],
): Promise<PerimeterReport> {
  const report = await scanPerimeter(cwd, roots);
  // THE VIOLATION: the finding is computed, kept, and then not enforced.
  return Object.freeze({ ...report, pass: true });
}
