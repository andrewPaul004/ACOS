import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

import {
  createAuditReaderRegistry,
  type AuditReaderDescriptor,
  type AuditReaderRegistry,
} from '../../src/audit/provider/plane/auditReaderRegistry.js';
import type { AuditVerifiedCredentialScope } from '../../src/audit/controlArtifacts/auditPlaneVerifier.js';
import { AuditReadClient } from '../../src/audit/provider/plane/auditReadClient.js';
import { verifyAuditPlaneControlArtifacts } from '../../src/audit/controlArtifacts/auditPlaneVerifier.js';
import { defaultControlArtifactFixture } from './controlArtifactFixture.js';

/**
 * THE S1O AUDIT PROVIDER-READ FIXTURE. IT LAUNCHES REAL OS PROCESSES.
 *
 * `§14`: "separate OS process / architecture-equivalent trust boundary". Nothing here
 * simulates a process: `AuditReadClient` forks `src/audit/provider/runtime/main.ts`, the
 * child loads a synthetic reader from `tests/audit-plane/`, and the PID the child reports
 * in its `AUDIT_READER_READY` message is the one the suite asserts against `process.pid` AND
 * against the integration runtime's PID.
 */

export const AUDIT_PROVIDER = 'synthetic_esp';

/** The credential identity whose SIGNED class-5 record governs reader A. `50 §2g`. */
export const AUDIT_READ_CREDENTIAL_ID = 'synthetic_esp.audit_read';
/** A send-capable credential identity, for the negative cases. */
export const SEND_CREDENTIAL_ID = 'synthetic_esp.send';
/** A money-moving credential identity, for ADR-024's option-B trigger. */
export const MONEY_MOVING_CREDENTIAL_ID = 'synthetic_psp.charge';

export const READER_A_ROOT = resolve(process.cwd(), 'tests', 'audit-plane', 'readerA');

/**
 * `§17` — THE AUDIT SENTINEL. CLEARLY FAKE, HIGH-ENTROPY, AND DISTINCT FROM S1N's.
 *
 * `§17`: "Use synthetic credential first. Assert the audit secret cannot appear in: control
 * process; integration send process; IPC; DB; control journal; worker output; logs/errors.
 * **Sibling integration process must not read it.**"
 *
 * The prefix differs from `mintSentinelSecret`'s `TEST_ONLY_VENDOR_SECRET_` deliberately: a
 * leak matrix that used one prefix for both planes could not tell which plane's material had
 * escaped, and the sibling-visibility assertion is exactly the one that needs to.
 */
export function mintAuditSentinelSecret(label: string): string {
  return `TEST_ONLY_AUDIT_READ_SECRET_${label}_${randomBytes(24).toString('hex')}`;
}

export interface AuditSecretFixtureDocument {
  readonly providerId: string;
  readonly secret: string;
  readonly identity?: string;
  readonly version?: string;
  readonly revoked?: boolean;
}

/**
 * One temporary audit secret directory, outside the repository AND distinct from S1N's.
 *
 * A separate `mkdtemp` prefix rather than a subdirectory of the integration fixture's, so
 * that `§13`'s "same secret source as send credential" prohibition is false by construction
 * in the fixture as well as in the production registry: the two directories have no common
 * ancestor below the OS temp root, and a reader confined to one cannot resolve a path in
 * the other.
 */
export class AuditSecretFixtureDirectory {
  public readonly path: string;

  private readonly files = new Map<string, string>();

  public constructor() {
    this.path = mkdtempSync(join(tmpdir(), 'acos-s1o-audit-secrets-'));
  }

  public write(name: string, document: AuditSecretFixtureDocument): string {
    const file = join(this.path, `${name}.json`);
    writeFileSync(file, JSON.stringify(document), 'utf8');
    this.files.set(name, file);
    return file;
  }

  public locator(name: string): string {
    const file = this.files.get(name);
    if (file === undefined) throw new Error(`no audit secret fixture named "${name}"`);
    return file;
  }

  public cleanup(): void {
    rmSync(this.path, { recursive: true, force: true });
  }
}

export interface AuditDescriptorOverrides {
  readonly providerId?: string;
  readonly credentialId?: string;
  readonly runtimeRoot?: string;
  readonly readerModule?: string;
  readonly secretSourceModule?: string;
}

/** Reader A's descriptor. Provider `synthetic_esp`, credential `synthetic_esp.audit_read`. */
export function readerADescriptor(
  secretLocator: string,
  overrides: AuditDescriptorOverrides = {},
): AuditReaderDescriptor {
  return {
    providerId: overrides.providerId ?? AUDIT_PROVIDER,
    credentialId: overrides.credentialId ?? AUDIT_READ_CREDENTIAL_ID,
    runtimeRoot: overrides.runtimeRoot ?? READER_A_ROOT,
    readerModule: overrides.readerModule ?? join(READER_A_ROOT, 'reader.ts'),
    secretSourceModule: overrides.secretSourceModule ?? join(READER_A_ROOT, 'secretSource.ts'),
    secretLocator,
  };
}

/**
 * Build the registry over the ACTIVE VERIFIED BUNDLE.
 *
 * `integrationSecretLocators` defaults to EMPTY, which is the mis-wiring
 * `unsafe-audit-read-boundary.ts` exercises — a deployment that forgot to declare what the
 * send side uses. The real composition passes the real set, and
 * `audit-read-boundary.test.ts` asserts the collision is refused when it does.
 */
export function auditReaderRegistry(
  descriptors: readonly AuditReaderDescriptor[],
  integrationSecretLocators: ReadonlySet<string> = new Set(),
): AuditReaderRegistry {
  return createAuditReaderRegistry(
    descriptors,
    auditVerifiedReadCredentials(),
    integrationSecretLocators,
  );
}

/**
 * The AUDIT PLANE's own verified class-5 read credentials.
 *
 * `§14`: "no reliance on control adapter result". The registry is fed from
 * `verifyAuditPlaneControlArtifacts`, which reads the audit plane's OWN copy of the signed
 * bytes through its OWN deployment variables and shares no module with the control plane's
 * verifier — so an audit reader is admitted on the audit plane's reading of the record that
 * says it is read-only, never on the control plane's.
 */
export function auditVerifiedReadCredentials(): Readonly<
  Record<string, AuditVerifiedCredentialScope>
> {
  const outcome = verifyAuditPlaneControlArtifacts(defaultControlArtifactFixture().auditEnv);
  if (!outcome.verified) {
    throw new Error(
      `the audit plane could not verify its own control artifacts: ${outcome.reason}`,
    );
  }
  return outcome.auditReadCredentials;
}

export interface LaunchedAuditReader {
  readonly client: AuditReadClient;
  readonly secrets: AuditSecretFixtureDirectory;
  close(): Promise<void>;
}

/**
 * Build a client over a temporary audit secret directory and return both, with one teardown.
 *
 * The client starts NO process here. `AuditReadClient` forks lazily on the first read for a
 * provider, which is what lets a test assert the "no reader is running" state and then
 * observe the transition.
 */
export function launchAuditReader(
  build: (secrets: AuditSecretFixtureDirectory) => AuditReaderRegistry,
  options: { readonly deadlineMs?: number } = {},
): LaunchedAuditReader {
  const secrets = new AuditSecretFixtureDirectory();
  const registry = build(secrets);
  const client = new AuditReadClient(registry, {
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

/** Wait until a provider's reader has reported ready, or fail after `timeoutMs`. */
export async function awaitReaderReady(
  client: AuditReadClient,
  providerId: string,
  timeoutMs = 20_000,
): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const pid = client.readerPid(providerId);
    if (pid !== null && pid > 0 && client.observedReaderEnvironmentKeys(providerId) !== null) {
      return pid;
    }
    if (Date.now() > deadline) {
      throw new Error(`audit reader for "${providerId}" did not become ready`);
    }
    await new Promise((settle) => setTimeout(settle, 25));
  }
}

/** A period the synthetic reader's clock sits inside. Both bounds required, always. */
export const AUDIT_PERIOD_START_MS = Date.UTC(2026, 0, 5, 12, 0, 0);
export const AUDIT_PERIOD_END_MS = Date.UTC(2026, 0, 5, 13, 0, 0);
