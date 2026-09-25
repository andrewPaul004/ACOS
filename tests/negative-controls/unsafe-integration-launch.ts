import { fork, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';

import {
  ENV_ADAPTER_ID,
  ENV_ADAPTER_MODULE,
  ENV_PROTOCOL_VERSION,
  ENV_RUNTIME_IDENTITY,
  ENV_RUNTIME_ROOT,
  ENV_SECRET_LOCATOR,
  ENV_SECRET_SOURCE_MODULE,
} from '../../src/integration/protocol/runtimeEnvironment.js';
import { INTEGRATION_PROTOCOL_VERSION } from '../../src/integration/protocol/wire.js';
import { integrationAdapterRuntimeIdentity } from '../../src/integration/protocol/runtimeIdentity.js';

/**
 * UNSAFE — TEST-ONLY. THE LAUNCH BOUNDARY, BROKEN THREE WAYS.
 *
 * `§52` controls 3, 8 and 9:
 *
 *   3. "entire parent environment inherited"
 *   8. "arbitrary executable/module path supplied by caller"
 *   9. "child restart replays last CLAIMED invocation"
 */

const RUNTIME_ENTRY_POINT = resolve(process.cwd(), 'src', 'integration', 'runtime', 'main.ts');

export interface UnsafeLaunchConfiguration {
  readonly adapterId: string;
  readonly runtimeRoot: string;
  readonly adapterModule: string;
  readonly secretSourceModule: string;
  readonly secretLocator: string;
}

/**
 * CONTROL 3 — THE INHERITING LAUNCH. `env: { ...process.env, ... }`.
 *
 * =================================================================================
 * WHY THIS IS THE DEFAULT AND WHY THAT MATTERS
 *
 * `child_process.fork` with NO `env` option inherits the parent's environment entirely, and
 * the spread form below is what a developer writes when they want "the normal environment
 * plus these two variables". Both are the natural thing to write and both hand the child
 * every secret the control process holds.
 *
 * `§12`: "If the chosen OS/process mechanism inherits the environment by default: construct
 * an explicit allowlisted child environment. Do not pass the entire control environment."
 * `§30`: "Do not merely blacklist likely secret names."
 *
 * THE DISCRIMINATION IS `§30`'s REQUIRED NEGATIVE, run against both launchers with the same
 * parent environment: the parent holds `ADAPTER_B_SECRET`, a control database password and
 * an audit database password; this child sees all three and the production child sees none.
 * =================================================================================
 */
export function unsafeInheritingLaunch(configuration: UnsafeLaunchConfiguration): ChildProcess {
  return fork(RUNTIME_ENTRY_POINT, [], {
    execPath: process.execPath,
    execArgv: ['--import', 'tsx'],
    env: {
      // THE VIOLATION.
      ...process.env,
      [ENV_PROTOCOL_VERSION]: INTEGRATION_PROTOCOL_VERSION,
      [ENV_RUNTIME_IDENTITY]: integrationAdapterRuntimeIdentity(configuration.adapterId),
      [ENV_ADAPTER_ID]: configuration.adapterId,
      [ENV_RUNTIME_ROOT]: configuration.runtimeRoot,
      [ENV_ADAPTER_MODULE]: configuration.adapterModule,
      [ENV_SECRET_SOURCE_MODULE]: configuration.secretSourceModule,
      [ENV_SECRET_LOCATOR]: configuration.secretLocator,
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    serialization: 'json',
  });
}

/**
 * CONTROL 8 — A LAUNCHER WHOSE EXECUTABLE IS THE CALLER'S.
 *
 * `§38`: "Avoid arbitrary command execution. The control runtime must not spawn
 * `command = caller_input`. Use a closed adapter-runtime registry mapping trusted adapter
 * IDs to known executable/module identities."
 *
 * `IntegrationClient` computes its module path from its own file location and has no
 * parameter that could change it; this takes one. The discrimination is a TYPE-LEVEL and
 * STRUCTURAL one rather than a runtime comparison — there is no production function with
 * this signature, which is what the boundary suite asserts by enumerating the surface.
 */
export function unsafeCallerSuppliedLaunch(input: {
  readonly modulePath: string;
  readonly adapterId: string;
  readonly runtimeRoot: string;
  readonly adapterModule: string;
  readonly secretSourceModule: string;
  readonly secretLocator: string;
  readonly execArgv?: readonly string[];
}): ChildProcess {
  // THE VIOLATION: the module executed is a parameter, and so are the runtime flags.
  return fork(input.modulePath, [], {
    execPath: process.execPath,
    execArgv: [...(input.execArgv ?? ['--import', 'tsx'])],
    env: {
      [ENV_PROTOCOL_VERSION]: INTEGRATION_PROTOCOL_VERSION,
      [ENV_RUNTIME_IDENTITY]: integrationAdapterRuntimeIdentity(input.adapterId),
      [ENV_ADAPTER_ID]: input.adapterId,
      [ENV_RUNTIME_ROOT]: input.runtimeRoot,
      [ENV_ADAPTER_MODULE]: input.adapterModule,
      [ENV_SECRET_SOURCE_MODULE]: input.secretSourceModule,
      [ENV_SECRET_LOCATOR]: input.secretLocator,
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    serialization: 'json',
  });
}

/**
 * CONTROL 9 — A SUPERVISOR THAT REPLAYS THE LAST REQUEST AFTER A RESTART.
 *
 * =================================================================================
 * THE ATTACK `§28` NAMES
 *
 * "child dies after simulated send boundary; supervisor restarts child; unsafe supervisor
 * replays request. Production does not."
 *
 * `§28`: "**AUTOMATIC RESTART MUST NOT REPLAY A CLAIMED EFFECT.** Restart only restores
 * adapter availability. It does not reconstruct the fresh claim capability."
 *
 * This supervisor keeps `lastRequest` and re-sends it on the next start. That is the whole
 * defect and it is two lines. `IntegrationClient` holds no such field — its exit handler
 * deletes the runtime entry and nothing else — and its second, independent mechanism is that
 * `dispatchCapability.ts`'s fresh capability was consumed before the adapter was reached and
 * revoked in the gateway's `finally`, so there is no way back to the dispatch line even for
 * a caller who wanted one.
 *
 * The discrimination is COUNTED AT THE PROVIDER: the synthetic provider's acceptance count
 * for one idempotency key is 2 under this supervisor and 1 under production.
 * =================================================================================
 */
export class UnsafeReplayingSupervisor {
  private child: ChildProcess | null = null;

  private lastRequest: string | null = null;

  public constructor(private readonly configuration: UnsafeLaunchConfiguration) {}

  public start(): ChildProcess {
    const child = fork(RUNTIME_ENTRY_POINT, [], {
      execPath: process.execPath,
      execArgv: ['--import', 'tsx'],
      env: {
        [ENV_PROTOCOL_VERSION]: INTEGRATION_PROTOCOL_VERSION,
        [ENV_RUNTIME_IDENTITY]: integrationAdapterRuntimeIdentity(this.configuration.adapterId),
        [ENV_ADAPTER_ID]: this.configuration.adapterId,
        [ENV_RUNTIME_ROOT]: this.configuration.runtimeRoot,
        [ENV_ADAPTER_MODULE]: this.configuration.adapterModule,
        [ENV_SECRET_SOURCE_MODULE]: this.configuration.secretSourceModule,
        [ENV_SECRET_LOCATOR]: this.configuration.secretLocator,
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      serialization: 'json',
    });
    this.child = child;
    child.on('exit', () => {
      // THE VIOLATION. Restart, and re-send whatever was in flight.
      const pending = this.lastRequest;
      if (pending === null) return;
      const replacement = this.start();
      replacement.once('message', () => {
        replacement.send(pending);
      });
    });
    return child;
  }

  public send(encoded: string): void {
    this.lastRequest = encoded;
    this.child?.send(encoded);
  }

  public stop(): void {
    this.lastRequest = null;
    const child = this.child;
    this.child = null;
    child?.removeAllListeners('exit');
    child?.kill();
  }
}
