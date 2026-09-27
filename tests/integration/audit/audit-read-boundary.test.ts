import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  AUDIT_READER_ENV_KEYS,
  INTEGRATION_ENV_KEYS_FOR_DISJOINTNESS,
  PLATFORM_INJECTED_ENV_KEYS,
  auditAllowlistIsDisjointFromIntegration,
  buildAuditReaderEnvironment,
} from '../../../src/audit/provider/protocol/readerEnvironment.js';
import {
  AUDIT_PROVIDER_READER_PREFIX,
  auditProviderReaderIdentity,
  isIntegrationRuntimeIdentity,
  providerIdOfAuditReaderIdentity,
} from '../../../src/audit/provider/protocol/readerIdentity.js';
import { INTEGRATION_RUNTIME_ENV_KEYS } from '../../../src/integration/protocol/runtimeEnvironment.js';
import {
  AUDIT_PROVIDER,
  AUDIT_PERIOD_END_MS,
  AUDIT_PERIOD_START_MS,
  AUDIT_READ_CREDENTIAL_ID,
  SEND_CREDENTIAL_ID,
  auditReaderRegistry,
  auditVerifiedReadCredentials,
  awaitReaderReady,
  launchAuditReader,
  mintAuditSentinelSecret,
  readerADescriptor,
  type LaunchedAuditReader,
} from '../../support/auditProviderFixture.js';
import { emptyAuditReaderRegistry } from '../../../src/audit/provider/plane/auditReaderRegistry.js';
import { activeVerifiedControlArtifacts } from '../../../src/kernel/controlArtifacts/registry.js';

/**
 * `§13`, `§14`, `§16` — THE AUDIT PROVIDER-READ BOUNDARY, MEASURED.
 *
 * =================================================================================
 * WHAT THIS FILE PROVES, AND WHAT IT CANNOT
 *
 * It proves the ACOS side: a real OS process with its own PID, its own constructed
 * environment, its own credential source, a closed read-only protocol, and a reader object
 * that cannot express a mutation.
 *
 * **IT PROVES NOTHING ABOUT ANY VENDOR.** `§15`: "A documentation claim alone is not the
 * final acceptance proof for a configured provider. [...] The later sandbox slice must
 * empirically run the attempted-write test." A synthetic reader refuses a write because this
 * repository wrote it to; `36 §13` asks the provider, and that obligation stays open.
 * =================================================================================
 */

let launched: LaunchedAuditReader | null = null;

afterEach(async () => {
  if (launched !== null) {
    await launched.close();
    launched = null;
  }
});

/* ================================================================================
 * 1. A SEPARATE OS PROCESS
 * ============================================================================== */

describe('`§14` — the audit reader is a REAL separate OS process', () => {
  it('its PID differs from this process, and it reports its own risk class', async () => {
    const secret = mintAuditSentinelSecret('pid');
    launched = launchAuditReader((secrets) => {
      const locator = secrets.write('audit', {
        providerId: AUDIT_PROVIDER,
        secret,
        credentialIdentity: AUDIT_READ_CREDENTIAL_ID,
      });
      return auditReaderRegistry([readerADescriptor(locator)]);
    });

    const outcome = await launched.client.read({
      providerId: AUDIT_PROVIDER,
      operation: 'MESSAGE_ACTIVITY_SEARCH',
      periodStartMs: AUDIT_PERIOD_START_MS,
      periodEndMs: AUDIT_PERIOD_END_MS,
      correlationTag: 'acos-corr-pid',
    });
    expect(outcome.kind).toBe('EVIDENCE');

    const pid = await awaitReaderReady(launched.client, AUDIT_PROVIDER);
    expect(pid).toBeGreaterThan(0);
    expect(pid).not.toBe(process.pid);
    // The reader started under the SIGNED class-5 record's risk class, and reported it back.
    expect(launched.client.observedCredentialRiskClass(AUDIT_PROVIDER)).toBe('READ_ONLY');
  });

  it('its environment is EXACTLY the eight-key allowlist plus the platform set', async () => {
    const secret = mintAuditSentinelSecret('env');
    launched = launchAuditReader((secrets) => {
      const locator = secrets.write('audit', {
        providerId: AUDIT_PROVIDER,
        secret,
        credentialIdentity: AUDIT_READ_CREDENTIAL_ID,
      });
      return auditReaderRegistry([readerADescriptor(locator)]);
    });
    await launched.client.read({
      providerId: AUDIT_PROVIDER,
      operation: 'MESSAGE_ACTIVITY_COUNT',
      periodStartMs: AUDIT_PERIOD_START_MS,
      periodEndMs: AUDIT_PERIOD_END_MS,
    });
    await awaitReaderReady(launched.client, AUDIT_PROVIDER);

    const observed = launched.client.observedReaderEnvironmentKeys(AUDIT_PROVIDER);
    expect(observed).not.toBeNull();
    const expected = new Set([...AUDIT_READER_ENV_KEYS, ...PLATFORM_INJECTED_ENV_KEYS]);
    // AN EQUALITY, NOT A CONTAINMENT. `§14`'s "separate environment allowlist" is only a real
    // assertion if the expected set is closed on both sides.
    for (const key of observed!) expect(expected.has(key), `unexpected key ${key}`).toBe(true);

    /*
     * AND THE NEGATIVE THAT MATTERS. The audit plane's own database credential, the control
     * plane's, and every integration-plane key are absent BY NAME.
     */
    for (const forbidden of [
      'ACOS_AUDIT_PG_URL',
      'ACOS_CONTROL_PG_URL',
      'ACOS_DBOS_SYS_PG_URL',
      'OWNER_SIGNING_PRIVATE_KEY',
      ...INTEGRATION_RUNTIME_ENV_KEYS,
    ]) {
      expect(observed!, forbidden).not.toContain(forbidden);
    }
  });
});

/* ================================================================================
 * 2. THE TWO PLANES SHARE NOTHING
 * ============================================================================== */

describe('`§13`, `§14` — the audit plane and the integration plane are disjoint', () => {
  it('the two environment allowlists share no key, computed rather than observed', () => {
    expect(auditAllowlistIsDisjointFromIntegration()).toBe(true);
    // The transcription this plane holds must match the OTHER plane's real list, which is
    // safe to import HERE because a test's module graph is not a runtime's.
    expect([...INTEGRATION_ENV_KEYS_FOR_DISJOINTNESS].sort()).toEqual(
      [...INTEGRATION_RUNTIME_ENV_KEYS].sort(),
    );
    const integration = new Set<string>(INTEGRATION_RUNTIME_ENV_KEYS);
    for (const key of AUDIT_READER_ENV_KEYS) expect(integration.has(key), key).toBe(false);
  });

  it('the two identity spaces are disjoint — neither parser accepts the other', () => {
    const auditIdentity = auditProviderReaderIdentity(AUDIT_PROVIDER);
    expect(auditIdentity.startsWith(AUDIT_PROVIDER_READER_PREFIX)).toBe(true);
    expect(isIntegrationRuntimeIdentity(auditIdentity)).toBe(false);
    expect(providerIdOfAuditReaderIdentity('INTEGRATION_ADAPTER:mock_ads')).toBeNull();
    expect(providerIdOfAuditReaderIdentity('CONTROL_PLANE')).toBeNull();
  });

  it('the audit reader package imports NO integration-plane module', async () => {
    const root = join(process.cwd(), 'src', 'audit', 'provider');
    const files: string[] = [];
    async function walk(dir: string): Promise<void> {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (entry.name.endsWith('.ts')) files.push(full);
      }
    }
    await walk(root);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = await readFile(file, 'utf8');
      // `readWire.ts`'s header: the two protocols share no module, no type and no constant.
      expect(source, file).not.toMatch(/from\s+['"].*integration\//);
    }
  });

  it('the launch environment carries no control-plane key at all', () => {
    const env = buildAuditReaderEnvironment({
      providerId: AUDIT_PROVIDER,
      runtimeRoot: '/root',
      readerModule: '/root/reader.ts',
      secretSourceModule: '/root/secretSource.ts',
      secretLocator: '/elsewhere/audit.json',
      credentialRiskClass: 'READ_ONLY',
      expectedCredentialId: AUDIT_READ_CREDENTIAL_ID,
    });
    expect(Object.keys(env).sort()).toEqual([...AUDIT_READER_ENV_KEYS].sort());
    // `§14`: "no reliance on control adapter result". There is no slot a control-plane
    // verdict could occupy even if a deployment wanted to pass one.
    for (const key of Object.keys(env)) expect(key).not.toMatch(/CONTROL/);
  });
});

/* ================================================================================
 * 3. `50 §2g` — THE REGISTRY REFUSES WHAT `48 §3.6` DOES NOT EXEMPT
 * ============================================================================== */

describe('`50 §2g`, `48 §3.6` — the audit reader registry', () => {
  it('admits a READ_ONLY, audit_plane-scoped credential', () => {
    const registry = auditReaderRegistry([readerADescriptor('/tmp/audit-a.json')]);
    expect(registry.registeredIds).toEqual([AUDIT_PROVIDER]);
    expect(registry.credentialScopeOf(AUDIT_PROVIDER)!.credentialRiskClass).toBe('READ_ONLY');
  });

  it('REFUSES a credential the class-5 artifact does not declare — FAIL CLOSED', () => {
    expect(() =>
      auditReaderRegistry([
        readerADescriptor('/tmp/audit-a.json', { credentialId: 'nobody.declared.this' }),
      ]),
    ).toThrow(/CREDENTIAL_NOT_DECLARED/);
  });

  it('REFUSES an adapter-scoped credential — a send credential in the audit plane', () => {
    /*
     * THE REFUSAL IS `CREDENTIAL_NOT_DECLARED`, AND THAT IS THE STRONGER PLACEMENT.
     *
     * `auditPlaneVerifier.ts` keeps ONLY records carrying `50 §2g` field 2's reserved
     * `audit_plane` scope, so an adapter-scoped credential never enters the audit plane's
     * map at all. The audit plane therefore never learns a send credential's identity,
     * which makes `§13`'s "no control send credential" a fact about what this plane can see
     * rather than a check it performs — and a check can be removed.
     */
    expect(() =>
      auditReaderRegistry([
        readerADescriptor('/tmp/audit-a.json', { credentialId: 'mock_ads.pause_only' }),
      ]),
    ).toThrow(/CREDENTIAL_NOT_DECLARED/);

    // AND THE AUDIT PLANE'S OWN MAP HOLDS ONLY AUDIT-PLANE RECORDS, asserted directly.
    const credentials = auditVerifiedReadCredentials();
    expect(Object.keys(credentials)).toEqual([AUDIT_READ_CREDENTIAL_ID]);
    for (const scope of Object.values(credentials)) {
      expect(scope.credentialRiskClass).toBe('READ_ONLY');
      expect(scope.externalMutationCapable).toBe(false);
    }
  });

  it('REFUSES a locator the INTEGRATION plane also holds — §13, separate source', () => {
    const shared = '/tmp/shared-secret.json';
    expect(() =>
      auditReaderRegistry([readerADescriptor(shared)], new Set([shared])),
    ).toThrow(/READER_LOCATOR_SHARED_WITH_INTEGRATION/);
    // And the same descriptor is admitted when the locator is the audit plane's own.
    expect(
      auditReaderRegistry([readerADescriptor('/tmp/audit-only.json')], new Set([shared]))
        .registeredIds,
    ).toEqual([AUDIT_PROVIDER]);
  });

  it('REFUSES a module outside the declared runtime root', () => {
    expect(() =>
      auditReaderRegistry([
        readerADescriptor('/tmp/audit-a.json', {
          readerModule: join(process.cwd(), 'tests', 'integration-plane', 'adapterA', 'adapter.ts'),
        }),
      ]),
    ).toThrow(/MODULE_OUTSIDE_RUNTIME_ROOT/);
  });

  it('PRODUCTION holds an EMPTY reader registry — no real provider read exists', () => {
    const empty = emptyAuditReaderRegistry();
    expect(empty.registeredIds).toEqual([]);
    expect(empty.resolve(AUDIT_PROVIDER)).toBeUndefined();
    expect(empty.credentialScopeOf(AUDIT_PROVIDER)).toBeUndefined();
  });
});

/* ================================================================================
 * 4. `50 §2g` — THE AUDIT CREDENTIAL IS NOT PRESENTABLE BY AN ADAPTER
 * ============================================================================== */

describe('`50 §2g` — the reserved audit_plane scope carries no dispatch authority', () => {
  it('the adapter-runtime registry refuses a descriptor naming the audit credential', async () => {
    const { createAdapterRuntimeRegistry } = await import(
      '../../../src/integration/control/adapterRuntimeRegistry.js'
    );
    const root = join(process.cwd(), 'tests', 'integration-plane', 'adapterA');
    expect(() =>
      createAdapterRuntimeRegistry(
        [
          {
            adapterId: 'mock_ads',
            credentialId: AUDIT_READ_CREDENTIAL_ID,
            runtimeRoot: root,
            adapterModule: join(root, 'adapter.ts'),
            secretSourceModule: join(root, 'secretSource.ts'),
            secretLocator: '/tmp/x.json',
            resolutionCapabilities: ['QUERYABLE_MESSAGE_LOG'],
          },
        ],
        activeVerifiedControlArtifacts(),
      ),
    ).toThrow(/CREDENTIAL_IS_AUDIT_PLANE_SCOPED/);
  });

  it('SEND_CREDENTIAL_ID is not declared, so neither plane admits it', () => {
    expect(() =>
      auditReaderRegistry([
        readerADescriptor('/tmp/audit-a.json', { credentialId: SEND_CREDENTIAL_ID }),
      ]),
    ).toThrow(/CREDENTIAL_NOT_DECLARED/);
  });
});

/* ================================================================================
 * 5. NO REAL PROVIDER, ANYWHERE
 * ============================================================================== */

describe('`§27` — no provider request is possible from this repository', () => {
  it('the audit provider package contains no network primitive and no vendor name', async () => {
    const roots = [
      join(process.cwd(), 'src', 'audit', 'provider'),
      join(process.cwd(), 'tests', 'audit-plane'),
    ];
    const forbidden = [
      /\bglobalThis\.fetch\s*\(/,
      /(?<![.\w$])fetch\s*\(/,
      /from\s+['"](?:node:)?https?['"]/,
      /from\s+['"](?:node:)?net['"]/,
      /from\s+['"](?:node:)?tls['"]/,
      /from\s+['"](?:node:)?dgram['"]/,
      /from\s+['"]axios['"]/,
      /\bsendgrid\b/i,
      /\bmailgun\b/i,
      /\bpostmark\b/i,
      /api\.sendgrid\.com/,
      /api\.mailgun\.net/,
      /api\.postmarkapp\.com/,
    ];
    for (const root of roots) {
      const files: string[] = [];
      async function walk(dir: string): Promise<void> {
        for (const entry of await readdir(dir, { withFileTypes: true })) {
          const full = join(dir, entry.name);
          if (entry.isDirectory()) await walk(full);
          else if (entry.name.endsWith('.ts')) files.push(full);
        }
      }
      await walk(root);
      for (const file of files) {
        const source = await readFile(file, 'utf8');
        for (const pattern of forbidden) {
          expect(pattern.test(source), `${file} matched ${String(pattern)}`).toBe(false);
        }
      }
    }
  });
});
