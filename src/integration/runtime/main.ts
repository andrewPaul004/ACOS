import { isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  ENV_ADAPTER_ID,
  ENV_ADAPTER_MODULE,
  ENV_EXPECTED_CREDENTIAL_ID,
  ENV_PROTOCOL_VERSION,
  ENV_RUNTIME_IDENTITY,
  ENV_RUNTIME_ROOT,
  ENV_SECRET_LOCATOR,
  ENV_SECRET_SOURCE_MODULE,
} from '../protocol/runtimeEnvironment.js';
import {
  INTEGRATION_PROTOCOL_VERSION,
  RUNTIME_READY_KIND,
  encodeIntegrationMessage,
  type RuntimeReady,
} from '../protocol/wire.js';
import {
  adapterIdOfRuntimeIdentity,
  integrationAdapterRuntimeIdentity,
} from '../protocol/runtimeIdentity.js';
import type { AdapterSecretSource } from './adapterSecretSource.js';
import { handleDispatchRequest, type IntegrationRuntimeConfiguration } from './integrationHost.js';
import { isIntegrationAdapterModule } from './integrationAdapter.js';
import { emitIntegrationLog } from './runtimeLog.js';

/**
 * THE INTEGRATION RUNTIME'S ENTRY POINT. THE PROCESS `I25` IS ABOUT.
 *
 * =================================================================================
 * `§5` — A REAL OS PROCESS, AND THE MECHANISM IS THE POINT
 *
 * "Do not satisfy I25 with: another module; class; worker object in same process; DI
 * container; Node `vm`; mere function boundary."
 *
 * This module is executed by `child_process.fork` in a process of its own. It has its own
 * PID, its own heap, its own module registry, its own environment and its own filesystem
 * view, and the only channel between it and the control plane is the private descriptor the
 * parent created — `§40`: no TCP port, no HTTP listener, no Unix socket, no listener of any
 * kind. `process.on('message')` below is the whole of its inbound surface, and a process
 * that is not this process's parent cannot reach it.
 *
 * `§39` — THAT IS ALSO THE AUTHENTICATION, AND v1.3.6 DECLARES NO OTHER.
 *
 * "If architecture has no explicit IPC authentication because same-host process spawning +
 * private pipe is the trust mechanism, document and test that boundary. Do not invent
 * network JWT infrastructure."
 *
 * v1.3.6 specifies no IPC authentication mechanism for the Z1→Z2 edge. `23 §7`'s zone
 * diagram draws it as `Z1 -->|authorised effects| Z2` and says nothing about how Z2 knows
 * the sender; `48` is about what reaches Z5. So the trust mechanism is the one the OS
 * provides: an anonymous pipe created by the parent at fork, inherited by exactly one child,
 * addressable by no name and reachable by no other process. There is no token to steal
 * because there is no token, and no endpoint to reach because there is no endpoint.
 * =================================================================================
 *
 * =================================================================================
 * `§38` — NO ARBITRARY COMMAND EXECUTION, FROM EITHER DIRECTION
 *
 * "The control runtime must not spawn `command = caller_input`. Use a closed adapter-runtime
 * registry mapping trusted adapter IDs to known executable/module identities. No shell
 * interpolation. Use process APIs with argument arrays."
 *
 * The control side of that is `adapterRuntimeRegistry.ts` and `integrationClient.ts`, which
 * `fork` a fixed module path with an argument ARRAY and never a shell. THIS side adds the
 * second half: the module specifiers arrive in the launch environment, and this module
 * refuses to load either one unless it RESOLVES INSIDE THIS RUNTIME'S OWN ROOT.
 *
 * `§11`: "For adapter A: only A's integration package/dependencies should be available
 * through its declared runtime composition. Adapter B must not be able to import A's
 * provider-specific module. [...] Do not solve by convention only." `assertInsideRuntimeRoot`
 * is that mechanism at load time; the static import-closure proof is
 * `tools/integration-packaging/`.
 * =================================================================================
 */

/** A startup failure. Written to `stderr` as a closed code and never as a stack. */
export const STARTUP_FAILURES = [
  'ENV_MISSING',
  'ENV_PROTOCOL_MISMATCH',
  'ENV_IDENTITY_MISMATCH',
  'MODULE_OUTSIDE_RUNTIME_ROOT',
  'ADAPTER_MODULE_INVALID',
  'SECRET_SOURCE_MODULE_INVALID',
  'ADAPTER_IDENTITY_MISMATCH',
] as const;

export type StartupFailure = (typeof STARTUP_FAILURES)[number];

export class IntegrationRuntimeStartupError extends Error {
  public readonly failure: StartupFailure;

  public constructor(failure: StartupFailure) {
    // THE MESSAGE IS THE CODE. `§23`: a startup error that printed the specifier it refused
    // would print a filesystem path, and a path is one of the five things a control plane
    // must not learn from an integration failure.
    super(failure);
    this.failure = failure;
    this.name = 'IntegrationRuntimeStartupError';
  }
}

function readEnv(key: string): string {
  const value = process.env[key];
  if (value === undefined || value.length === 0) {
    throw new IntegrationRuntimeStartupError('ENV_MISSING');
  }
  return value;
}

/**
 * `§11`, `§12` — THE MODULE CONFINEMENT CHECK.
 *
 * A specifier must resolve to an absolute path inside the runtime root. `relative` returning
 * a path that starts with `..` or that is absolute means the target is outside, which is the
 * standard containment test and is correct on both path separators.
 */
export function isInsideRuntimeRoot(runtimeRoot: string, specifier: string): boolean {
  if (!isAbsolute(specifier)) return false;
  const root = resolve(runtimeRoot);
  const target = resolve(specifier);
  if (target === root) return false;
  const rel = relative(root, target);
  return rel.length > 0 && !rel.startsWith('..') && !isAbsolute(rel);
}

/**
 * What a secret-source module must export: a FACTORY taking the locator, not an instance.
 *
 * A factory rather than a ready-made source because the locator is per runtime and the
 * source must be SCOPED to this runtime's adapter at construction — `adapterSecretSource.ts`
 * explains why a source with a selector signature is not a boundary. The factory receives
 * the adapter id and the locator, and what it returns must declare that same adapter id or
 * this process refuses to start.
 */
export interface SecretSourceModule {
  readonly createAdapterSecretSource: (input: {
    readonly adapterId: string;
    readonly locator: string;
  }) => AdapterSecretSource;
}

function isSecretSourceModule(value: unknown): value is SecretSourceModule {
  if (typeof value !== 'object' || value === null) return false;
  return typeof (value as { createAdapterSecretSource?: unknown }).createAdapterSecretSource === 'function';
}

/**
 * Compose this runtime from its launch environment. NO REQUEST HAS BEEN READ AT THIS POINT.
 *
 * Exported so the focused suite can compose a runtime in-process and assert the refusals
 * without forking — the fork is proved separately, by PID, and the two properties are
 * independent.
 */
export async function composeIntegrationRuntime(): Promise<{
  readonly configuration: IntegrationRuntimeConfiguration;
  readonly runtimeIdentity: string;
}> {
  if (readEnv(ENV_PROTOCOL_VERSION) !== INTEGRATION_PROTOCOL_VERSION) {
    throw new IntegrationRuntimeStartupError('ENV_PROTOCOL_MISMATCH');
  }
  const adapterId = readEnv(ENV_ADAPTER_ID);
  const runtimeIdentity = readEnv(ENV_RUNTIME_IDENTITY);
  if (adapterIdOfRuntimeIdentity(runtimeIdentity) !== adapterId) {
    throw new IntegrationRuntimeStartupError('ENV_IDENTITY_MISMATCH');
  }
  // Recomputed rather than trusted: the identity in the environment must be the identity
  // this repository's own producer would mint for this adapter id, and not merely one that
  // parses back to it.
  if (integrationAdapterRuntimeIdentity(adapterId) !== runtimeIdentity) {
    throw new IntegrationRuntimeStartupError('ENV_IDENTITY_MISMATCH');
  }

  const runtimeRoot = readEnv(ENV_RUNTIME_ROOT);
  const adapterModule = readEnv(ENV_ADAPTER_MODULE);
  const secretSourceModule = readEnv(ENV_SECRET_SOURCE_MODULE);
  const secretLocator = readEnv(ENV_SECRET_LOCATOR);
  /*
   * `50 §2g` FIELD 1's ECHO, READ HERE AND COMPARED IN THE HOST.
   *
   * `readEnv` refuses an absent or empty value, so a runtime launched WITHOUT an expected
   * credential identity does not start. That is the fail-closed direction and it is the one
   * that matters: the alternative — start, and skip the comparison when there is nothing to
   * compare against — is precisely the defect this correction closes, one level up.
   *
   * It is NOT compared here, because at this point nothing has been resolved. The comparison
   * needs the material's own identity, and the material is resolved per invocation.
   */
  const expectedCredentialId = readEnv(ENV_EXPECTED_CREDENTIAL_ID);

  for (const specifier of [adapterModule, secretSourceModule]) {
    if (!isInsideRuntimeRoot(runtimeRoot, specifier)) {
      throw new IntegrationRuntimeStartupError('MODULE_OUTSIDE_RUNTIME_ROOT');
    }
  }

  /*
   * THE ONLY DYNAMIC IMPORT IN `src/`, AND IT IS DELIBERATE.
   *
   * `§4` forbids a real provider and `§7` of the S1J mandate puts every adapter
   * implementation in "an explicitly non-production test location". Both hold: there is no
   * adapter under `src/` and nothing here names one. What this process loads is whatever its
   * TRUSTED LAUNCH CONFIGURATION declared, confined to its own runtime root — in S1N a
   * synthetic adapter under `tests/integration-plane/`, and in a later slice a real Z2
   * adapter package.
   *
   * A STATIC IMPORT COULD NOT DO THIS JOB. Each adapter runtime must load ITS OWN adapter
   * and no other; a static import list in this file would put every adapter's module into
   * every runtime's module graph, which is exactly the per-adapter dependency isolation
   * `29 §3.5` and `23 §7` require and would be the defect the confinement check exists to
   * prevent.
   */
  const loadedAdapter: unknown = await import(pathToFileURL(resolve(adapterModule)).href);
  if (!isIntegrationAdapterModule(loadedAdapter)) {
    throw new IntegrationRuntimeStartupError('ADAPTER_MODULE_INVALID');
  }
  const adapter = loadedAdapter.integrationAdapter;
  if (adapter.adapterId !== adapterId) {
    throw new IntegrationRuntimeStartupError('ADAPTER_IDENTITY_MISMATCH');
  }

  const loadedSource: unknown = await import(pathToFileURL(resolve(secretSourceModule)).href);
  if (!isSecretSourceModule(loadedSource)) {
    throw new IntegrationRuntimeStartupError('SECRET_SOURCE_MODULE_INVALID');
  }
  const secretSource = loadedSource.createAdapterSecretSource({
    adapterId,
    locator: secretLocator,
  });
  if (secretSource.declaredAdapterId !== adapterId) {
    throw new IntegrationRuntimeStartupError('ADAPTER_IDENTITY_MISMATCH');
  }

  return {
    configuration: Object.freeze({ adapterId, adapter, secretSource, expectedCredentialId }),
    runtimeIdentity,
  };
}

/**
 * The process's message loop. ONE inbound channel, ONE reply per request, NO queue of its own.
 *
 * `§42`'s bounds live on the CONTROL side, where the requests originate, because a bound
 * enforced only by the callee still lets the caller allocate the messages. What this side
 * guarantees is that it reads one message, answers it, and holds nothing: there is no
 * buffer, no retry, no pending map and — `§28` — no record of the last request, so a
 * restarted runtime has nothing to replay even if something asked it to.
 */
async function run(): Promise<void> {
  const { configuration, runtimeIdentity } = await composeIntegrationRuntime();

  emitIntegrationLog({
    event: 'RUNTIME_STARTED',
    runtimeIdentity,
    adapterId: configuration.adapterId,
    invocationId: null,
    authorisationRef: null,
    effectId: null,
    outboxId: null,
    correlationTag: null,
    resultClass: null,
  });

  process.on('message', (raw: unknown) => {
    void (async (): Promise<void> => {
      const reply = await handleDispatchRequest(configuration, raw);
      emitIntegrationLog({
        event: reply.kind === 'REQUEST_REFUSED' ? 'REQUEST_REFUSED' : 'INVOCATION_COMPLETED',
        runtimeIdentity,
        adapterId: configuration.adapterId,
        invocationId: reply.invocationId,
        // A REFUSED request has no authorisation to record: either it carried none, or the
        // one it carried was not bound to the effect, and recording an unbound reference
        // beside an effect identity is how a log becomes a false provenance trail.
        authorisationRef: null,
        effectId: null,
        outboxId: null,
        correlationTag: null,
        resultClass: reply.kind === 'REQUEST_REFUSED' ? reply.reason : reply.outcome.kind,
      });
      const encoded = encodeIntegrationMessage(reply);
      // A reply that does not encode within the bound is DROPPED rather than truncated. The
      // control side's deadline resolves it as `OUTCOME_UNKNOWN`, which is the honest answer:
      // the adapter ran and the kernel did not learn what happened.
      if (encoded !== null) process.send?.(encoded);
    })();
  });

  const ready: RuntimeReady = {
    protocolVersion: INTEGRATION_PROTOCOL_VERSION,
    kind: RUNTIME_READY_KIND,
    runtimeIdentity,
    adapterId: configuration.adapterId,
    pid: process.pid,
    /*
     * `§30`, `48 §4` item 4 — THE KEYS OF THIS PROCESS'S OWN ENVIRONMENT. KEYS ONLY.
     *
     * `Object.keys`, never `process.env` itself: a value has no route onto this message,
     * because the member's type is `readonly string[]` and the control-side decoder refuses
     * any element that is not a bare environment-variable identifier. `§43`'s prohibition is
     * on the "raw environment", which is the values.
     *
     * It is the CHILD that reports this rather than the parent asserting what it passed,
     * because what the parent passed is the thing under test and is therefore not evidence
     * about itself.
     */
    environmentKeys: Object.keys(process.env).sort(),
  };
  const encodedReady = encodeIntegrationMessage(ready);
  if (encodedReady !== null) process.send?.(encodedReady);
}

/*
 * =================================================================================
 * THE MODULE IS BOTH A LIBRARY AND AN EXECUTABLE, AND THE DISCRIMINATOR IS THE LAUNCH
 * CONTRACT RATHER THAN `process.send`.
 *
 * `process.send` is defined in ANY forked child — including a Vitest worker — so gating on
 * it alone would start an integration runtime inside the test runner the moment a test
 * imported this module for one of its exported functions, and that runtime would then fail
 * its own environment check and call `process.exit`. The focused suite found exactly that.
 *
 * So the gate is the LAUNCH CONTRACT: this process runs as an integration runtime only when
 * `integrationClient.ts` constructed its environment, which means
 * `ACOS_INTEGRATION_RUNTIME_IDENTITY` is set AND an IPC channel exists. Nothing else can
 * produce that pair, and a Vitest worker produces neither half.
 * =================================================================================
 */
if (process.send !== undefined && process.env[ENV_RUNTIME_IDENTITY] !== undefined) {
  void run().catch((error: unknown) => {
    const failure =
      error instanceof IntegrationRuntimeStartupError ? error.failure : 'ADAPTER_MODULE_INVALID';
    process.stderr.write(`${JSON.stringify({ event: 'RUNTIME_START_FAILED', failure })}\n`);
    process.exit(1);
  });
}
