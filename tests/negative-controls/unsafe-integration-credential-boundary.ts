import { readFileSync } from 'node:fs';

import type {
  AdapterOutcome,
  DispatchEnvelope,
  ExternalEffectAdapter,
} from '../../src/kernel/gateway/adapterPort.js';

/**
 * UNSAFE — TEST-ONLY. THE CREDENTIAL BOUNDARY, BROKEN THREE WAYS.
 *
 * =================================================================================
 * `§52` CONTROLS 1, 2 AND 4. NOTHING HERE IS IMPORTED BY `src/`.
 *
 *   1. "adapter runs in control process with credential"
 *   2. "control loads integration secret source"
 *   4. "adapter A reads adapter B credential"
 *
 * Each is the shape the repository had BEFORE S1N, or the shape it would have if one
 * mechanism were removed. `I25` — "no process in the control plane holds a vendor
 * credential" — is a statement about a process, so the only honest way to demonstrate it is
 * to build the process that violates it and show the sentinel arriving where production
 * puts nothing.
 * =================================================================================
 */

/**
 * CONTROL 1 — THE S1M SHAPE. An `ExternalEffectAdapter` that resolves a vendor credential
 * IN CONTROL-PLANE PROCESS MEMORY and dispatches from there.
 *
 * This is exactly what `effectGateway.ts` would have invoked if S1M had written a Postmark
 * adapter, and exactly why S1M returned PARTIAL instead: `48 §4` item 4 says "a
 * control-plane component that acquires a vendor call site fails the build twice."
 *
 * `observedSecret` is what discriminates. After a dispatch through this adapter the sentinel
 * is readable from the control process; after a dispatch through the production integration
 * client it is not, because the production client has no `readFileSync`, no locator and no
 * route to one.
 */
export interface UnsafeInProcessAdapter extends ExternalEffectAdapter {
  observedSecret(): string | null;
}

export function createUnsafeInProcessCredentialedAdapter(input: {
  readonly adapterId: string;
  readonly secretLocator: string;
}): UnsafeInProcessAdapter {
  let observed: string | null = null;
  return {
    adapterId: input.adapterId,
    resolutionCapabilities: ['QUERYABLE_MESSAGE_LOG'],
    observedSecret: () => observed,
    dispatch: (envelope: DispatchEnvelope): Promise<AdapterOutcome> => {
      // THE VIOLATION. A vendor secret enters control-plane process memory.
      const document = JSON.parse(readFileSync(input.secretLocator, 'utf8')) as {
        secret?: unknown;
      };
      observed = typeof document.secret === 'string' ? document.secret : null;
      return Promise.resolve({
        kind: 'ADAPTER_RETURNED',
        providerReference: `unsafe:${envelope.idempotencyKey}`,
        rawResponseHash: null,
      });
    },
  };
}

/**
 * CONTROL 2 — A CONTROL-PLANE SECRET LOADER, with no adapter attached at all.
 *
 * `§10`: "Add structural tests proving the control production dependency graph contains no:
 * adapter secret loader; vendor credential parser; provider token environment variable
 * reader; secret manager SDK; integration-process private configuration loader."
 *
 * The discrimination is STRUCTURAL rather than behavioural: this module exists, it does the
 * forbidden thing, and the boundary suite's scan over `src/` finds nothing of the sort —
 * while the same scan pointed at this file finds it. A scan that could not find a real
 * offender would be a scan proving only that it had nothing to find.
 */
export function unsafeControlPlaneSecretLoad(locator: string): string | null {
  const document = JSON.parse(readFileSync(locator, 'utf8')) as { secret?: unknown };
  return typeof document.secret === 'string' ? document.secret : null;
}

/**
 * CONTROL 2b — THE ENVIRONMENT VARIANT. `§9`'s explicitly forbidden shortcut.
 *
 * "Do NOT fall back to `process.env.GENERIC_VENDOR_SECRET` inside the control process."
 */
export function unsafeControlPlaneEnvironmentSecret(): string | null {
  return process.env['GENERIC_VENDOR_SECRET'] ?? null;
}

/**
 * CONTROL 4 — A SHARED SECRET SOURCE WITH A SELECTOR SIGNATURE.
 *
 * `adapterSecretSource.ts` explains why the production interface takes no adapter id:
 * "A source with a `resolve(adapterId)` signature is a source that CAN be asked for another
 * adapter's secret, and the only thing standing between the ask and the answer would be a
 * check inside the source."
 *
 * This is that source, with no such check. Adapter A asks it for adapter B's credential and
 * gets one. The production pair — a per-adapter locator, an allowlisted environment, and a
 * source scoped at construction that refuses a document belonging to another adapter — has
 * three independent mechanisms and this has none.
 */
export function unsafeSharedSecretSource(locatorsByAdapterId: Readonly<Record<string, string>>): {
  resolve(adapterId: string): string | null;
} {
  return {
    resolve(adapterId: string): string | null {
      const locator = locatorsByAdapterId[adapterId];
      if (locator === undefined) return null;
      const document = JSON.parse(readFileSync(locator, 'utf8')) as { secret?: unknown };
      return typeof document.secret === 'string' ? document.secret : null;
    },
  };
}
