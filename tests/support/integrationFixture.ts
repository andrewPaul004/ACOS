import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

import {
  createAdapterRuntimeRegistry,
  type AdapterRuntimeDescriptor,
  type AdapterRuntimeRegistry,
} from '../../src/integration/control/adapterRuntimeRegistry.js';
import { IntegrationClient } from '../../src/integration/control/integrationClient.js';
import { activeVerifiedControlArtifacts } from '../../src/kernel/controlArtifacts/registry.js';

/**
 * THE S1N INTEGRATION-PLANE FIXTURE. IT LAUNCHES REAL OS PROCESSES.
 *
 * `§5`: "The control and integration runtimes must have distinct PIDs in tests." Nothing
 * here simulates a process: `IntegrationClient` forks `src/integration/runtime/main.ts`,
 * the child loads a synthetic adapter from `tests/integration-plane/`, and the PID the child
 * reports in its `RUNTIME_READY` message is the one the suite asserts against
 * `process.pid`.
 */

export const ADAPTER_A = 'mock_ads';
export const ADAPTER_B = 'mock_commerce';
export const ADAPTER_MONEY_MOVING = 'mock_processor';

/**
 * `50 §2g` — THE CREDENTIAL IDENTITIES THE VERIFIED CLASS-5 ARTIFACT DECLARES.
 *
 * v1.3.7 moved ADR-024's option-B trigger operand off the ACTION catalogue and onto the
 * CREDENTIAL, so a descriptor now names a credential identity instead of declaring a class.
 *
 * **THE TWO `mock_ads` IDENTITIES ARE THE DEMONSTRATION.** Same adapter, same action
 * catalogue, different signed answer: `pause_only` reaches `campaign.pause` and
 * `campaign.read` and is `NON_MONETARY_WRITE`; `budget_manage` also reaches
 * `campaign.budget.set`, which is `§2g` clause 9 — "increase a budget, spend cap, credit
 * line, or analogous provider-side authority that permits additional spend" — and is
 * `MONEY_MOVING`. S1N's action-derived predicate called both `NON_MONETARY`, because
 * `campaign.budget.set` declares `carries_vendor_monetary_field: false`.
 */
export const CREDENTIAL_A_NON_MONETARY = 'mock_ads.pause_only';
export const CREDENTIAL_A_MONEY_MOVING = 'mock_ads.budget_manage';
export const CREDENTIAL_B_NON_MONETARY = 'mock_commerce.fulfilment';
export const CREDENTIAL_PROCESSOR_MONEY_MOVING = 'mock_processor.refund';
/** `§8`'s required attack: `mail.send` beside `payment.refund`, on one credential. */
export const CREDENTIAL_MIXED_ENVELOPE = 'synthetic_esp.mixed_send';
/** `50 §2g` field 2's reserved audit-plane sentinel. Not presentable by any adapter. */
export const CREDENTIAL_AUDIT_PLANE = 'synthetic_esp.audit_read';

export const ADAPTER_A_ROOT = resolve(process.cwd(), 'tests', 'integration-plane', 'adapterA');
export const ADAPTER_B_ROOT = resolve(process.cwd(), 'tests', 'integration-plane', 'adapterB');

/**
 * `§29` — THE SENTINEL. A CLEARLY FAKE, HIGH-ENTROPY, UNMISTAKABLE STRING.
 *
 * "Use a clearly fake high-entropy sentinel secret such as
 * `TEST_ONLY_VENDOR_SECRET_<random fixture>`."
 *
 * Minted per call so two runtimes in one file never share one, and so a leak found in a
 * later assertion is attributable to the runtime that resolved it rather than to any
 * previous one.
 */
export function mintSentinelSecret(label: string): string {
  return `TEST_ONLY_VENDOR_SECRET_${label}_${randomBytes(24).toString('hex')}`;
}

export interface SecretFixtureDocument {
  readonly adapterId: string;
  readonly secret: string;
  readonly identity?: string;
  /** Doubles as adapter A's and B's provider script. See their `adapter.ts`. */
  readonly version?: string;
  readonly revoked?: boolean;
}

/**
 * One temporary secret-source directory, outside the repository.
 *
 * OUTSIDE THE REPOSITORY IS THE POINT, not a convenience: a sentinel written inside the
 * working tree would be found by `§29`'s own repository-wide leak scan and the scan would
 * be reporting the fixture rather than a leak. It also models the real shape — `48 §6` puts
 * secret-manager IAM under "Deployment only", so the material is provisioned somewhere the
 * application source is not.
 */
export class SecretFixtureDirectory {
  public readonly path: string;

  private readonly files = new Map<string, string>();

  public constructor() {
    this.path = mkdtempSync(join(tmpdir(), 'acos-s1n-secrets-'));
  }

  public write(name: string, document: SecretFixtureDocument): string {
    const file = join(this.path, `${name}.json`);
    writeFileSync(file, JSON.stringify(document), 'utf8');
    this.files.set(name, file);
    return file;
  }

  public locator(name: string): string {
    const file = this.files.get(name);
    if (file === undefined) throw new Error(`no secret fixture named "${name}"`);
    return file;
  }

  public cleanup(): void {
    rmSync(this.path, { recursive: true, force: true });
  }
}

export interface DescriptorOverrides {
  readonly runtimeRoot?: string;
  readonly adapterModule?: string;
  readonly secretSourceModule?: string;
  /** `50 §2g`: a credential IDENTITY, never a risk class. The class is signed, not declared. */
  readonly credentialId?: string;
}

/** Adapter A's descriptor. `mock_ads` serves REVERSIBLE and COMPENSABLE classes. */
export function adapterADescriptor(
  secretLocator: string,
  overrides: DescriptorOverrides = {},
): AdapterRuntimeDescriptor {
  return {
    adapterId: ADAPTER_A,
    runtimeRoot: overrides.runtimeRoot ?? ADAPTER_A_ROOT,
    adapterModule: overrides.adapterModule ?? join(ADAPTER_A_ROOT, 'adapter.ts'),
    secretSourceModule: overrides.secretSourceModule ?? join(ADAPTER_A_ROOT, 'secretSource.ts'),
    secretLocator,
    resolutionCapabilities: ['QUERYABLE_MESSAGE_LOG'],
    credentialId: overrides.credentialId ?? CREDENTIAL_A_NON_MONETARY,
  };
}

/**
 * Adapter B's descriptor. `mock_commerce` serves the IRRECOVERABLE class.
 *
 * `25 §7`'s EM6 criterion applies, so the descriptor declares one resolution primitive. It
 * is a TEST FIXTURE declaration: `36 §7` requires such a claim to be measured against a
 * vendor sandbox and S1N measures nothing.
 */
export function adapterBDescriptor(
  secretLocator: string,
  overrides: DescriptorOverrides = {},
): AdapterRuntimeDescriptor {
  return {
    adapterId: ADAPTER_B,
    runtimeRoot: overrides.runtimeRoot ?? ADAPTER_B_ROOT,
    adapterModule: overrides.adapterModule ?? join(ADAPTER_B_ROOT, 'adapter.ts'),
    secretSourceModule: overrides.secretSourceModule ?? join(ADAPTER_B_ROOT, 'secretSource.ts'),
    secretLocator,
    resolutionCapabilities: ['QUERYABLE_MESSAGE_LOG'],
    credentialId: overrides.credentialId ?? CREDENTIAL_B_NON_MONETARY,
  };
}

/** The locators the INTEGRATION plane holds, for the audit registry's collision check. */
export function integrationSecretLocators(
  ...descriptors: readonly AdapterRuntimeDescriptor[]
): ReadonlySet<string> {
  return new Set(descriptors.map((descriptor) => descriptor.secretLocator));
}

export function runtimeRegistry(
  ...descriptors: readonly AdapterRuntimeDescriptor[]
): AdapterRuntimeRegistry {
  return createAdapterRuntimeRegistry(descriptors, activeVerifiedControlArtifacts());
}

export interface LaunchedIntegration {
  readonly client: IntegrationClient;
  readonly secrets: SecretFixtureDirectory;
  close(): Promise<void>;
}

/**
 * Build a client over a temporary secret directory and return both, with one teardown.
 *
 * The client starts NO process here. `IntegrationClient` forks lazily on the first
 * invocation for an adapter, which is what lets a test assert the "no runtime is running"
 * state and then observe the transition.
 */
export function launchIntegration(
  build: (secrets: SecretFixtureDirectory) => AdapterRuntimeRegistry,
  options: { readonly deadlineMs?: number } = {},
): LaunchedIntegration {
  const secrets = new SecretFixtureDirectory();
  const registry = build(secrets);
  const client = new IntegrationClient(registry, {
    ...(options.deadlineMs === undefined ? {} : { deadlineMs: options.deadlineMs }),
  });
  return {
    client,
    secrets,
    close: async (): Promise<void> => {
      await client.close();
      secrets.cleanup();
    },
  };
}

/** Wait until an adapter's runtime has reported `RUNTIME_READY`, or fail after `timeoutMs`. */
export async function awaitRuntimeReady(
  client: IntegrationClient,
  adapterId: string,
  timeoutMs = 20_000,
): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const pid = client.runtimePid(adapterId);
    if (pid !== null && pid > 0) return pid;
    if (Date.now() > deadline) {
      throw new Error(`integration runtime for "${adapterId}" did not become ready`);
    }
    await new Promise((settle) => setTimeout(settle, 25));
  }
}
