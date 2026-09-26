import { readFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  computeAllClosures,
  evaluateSeparation,
} from '../../../tools/integration-packaging/packagingManifest.js';
import {
  DISPATCH_REQUEST_FIELDS,
  REFUSAL_REASONS,
} from '../../../src/integration/protocol/wire.js';
import { INTEGRATION_RUNTIME_ENV_KEYS } from '../../../src/integration/protocol/runtimeEnvironment.js';
import { AUDIT_READER_ENV_KEYS } from '../../../src/audit/provider/protocol/readerEnvironment.js';
import { emptyAdapterRuntimeRegistry } from '../../../src/integration/control/adapterRuntimeRegistry.js';
import { EMPTY_ADAPTER_REGISTRY } from '../../../src/kernel/gateway/adapterRegistry.js';

/**
 * `§10`, `§11`, `§45`, `§46`, `§47` — THE SOURCE AND ARTIFACT BOUNDARIES.
 *
 * =================================================================================
 * `§10`'s REQUIREMENT, AND WHY IT IS A SCAN RATHER THAN A CLAIM
 *
 * "Add structural tests proving the control production dependency graph contains no:
 * adapter secret loader; vendor credential parser; provider token environment variable
 * reader; secret manager SDK; integration-process private configuration loader."
 *
 * `48 §4` item 4 is the architecture's own form: `I25` is "CI-checked on the dependency tree
 * and the injected environment. This is what makes the plane boundary mean something: a
 * control-plane component that acquires a vendor call site fails the build twice."
 *
 * So the assertions below are made over the actual files, with hand-authored lists on the
 * positive side, and the corresponding NEGATIVE control —
 * `unsafe-integration-credential-boundary.ts` — is a real module doing the forbidden thing,
 * so the scan is shown finding an offender rather than only finding nothing.
 * =================================================================================
 */

interface SourceFile {
  readonly path: string;
  readonly code: string;
}

async function filesUnder(...segments: string[]): Promise<readonly SourceFile[]> {
  const root = join(process.cwd(), ...segments);
  const out: SourceFile[] = [];
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.name.endsWith('.ts')) {
        const raw = await readFile(full, 'utf8');
        out.push({
          path: full,
          code: raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1'),
        });
      }
    }
  }
  await walk(root);
  return out;
}

const rel = (path: string): string => relative(process.cwd(), path);

/**
 * Everything in `src/` that is NOT a FORKED RUNTIME — i.e. the control plane.
 *
 * =================================================================================
 * S1O WIDENS THIS EXCLUSION, OUT LOUD. THE S1N VERSION EXCLUDED ONE DIRECTORY:
 *
 *     `src/integration/runtime/`
 *
 * and the reason it excluded it is the reason it must now exclude a second: **that code
 * does not run in the control plane's process.** `I25` is a statement about a PROCESS, and
 * a scan that asked "does the control plane read an environment variable" while including a
 * different process's entry point would be answering a question about the wrong process.
 *
 * S1O forks a second runtime, in the AUDIT plane: `src/audit/provider/runtime/`. It reads
 * its own eight-key launch environment, exactly as the integration runtime reads its seven,
 * and it is excluded here and **asserted separately below** — not dropped.
 *
 * **THE EXCLUSION IS BY DIRECTORY, AND BOTH DIRECTORIES ARE FORKED ENTRY POINTS.** Nothing
 * else in `src/` is excluded, and a future runtime added anywhere else stays in this scan.
 * =================================================================================
 */
const FORKED_RUNTIME_DIRECTORIES = [
  `${sep}integration${sep}runtime${sep}`,
  `${sep}audit${sep}provider${sep}runtime${sep}`,
];

async function controlPlaneFiles(): Promise<readonly SourceFile[]> {
  const files = await filesUnder('src');
  return files.filter(
    ({ path }) => !FORKED_RUNTIME_DIRECTORIES.some((directory) => path.includes(directory)),
  );
}

describe('`§10` — THE CONTROL PLANE IS CREDENTIAL-BLIND, BY SCAN', () => {
  it('no control-plane source reads a secret source, a vault SDK or a vendor token', async () => {
    const files = await controlPlaneFiles();
    const offenders: string[] = [];
    for (const { path, code } of files) {
      for (const pattern of [
        /adapterSecretSource/,
        /createAdapterSecretSource/,
        /SecretsManager/i,
        /SecretManagerServiceClient/,
        /\bhashicorp\b/i,
        /\bvault\b/i,
        /dotenv/i,
        /GENERIC_VENDOR_SECRET/,
        /VENDOR_SECRET/,
        /SERVER_TOKEN/,
        /API_KEY/,
        /ACCESS_TOKEN/,
        /Authorization\s*:/,
        /\bBearer\b/,
      ]) {
        if (pattern.test(code)) offenders.push(`${rel(path)} (${String(pattern)})`);
      }
    }
    expect(
      offenders,
      `a credential surface in the control plane:\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });

  it('and the ONLY `process.env` readers in `src/` are the three accepted ones', async () => {
    /*
     * `48 §4` item 4's "injected environment" half, as an EXACT list rather than a pattern.
     *
     *   `db/pool.ts`                       `23 §3`: the control plane holds "only its own DB
     *                                      credential", and this is where it reads it.
     *   `controlArtifacts/trustConfig.ts`  `50 §3a`'s two provisioned Ed25519 PUBLIC keys and
     *                                      the deployment manifest pin. Public material and an
     *                                      identifier; no private key is read anywhere.
     *   `audit/controlArtifacts/auditPlaneVerifier.ts`
     *                                      the audit plane's independent copy of the same.
     *
     * Not one of them is a vendor credential, and S1N adds none. The integration RUNTIME
     * reads its own launch environment and is a different process; it is excluded from
     * `controlPlaneFiles()` and asserted separately below.
     */
    const files = await controlPlaneFiles();
    const readers = files
      .filter(({ code }) => /process\.env/.test(code))
      .map(({ path }) => rel(path))
      .sort();
    expect(readers).toEqual(
      [
        join('src', 'audit', 'controlArtifacts', 'auditPlaneVerifier.ts'),
        join('src', 'db', 'pool.ts'),
        join('src', 'kernel', 'controlArtifacts', 'trustConfig.ts'),
      ].sort(),
    );
  });

  it('the integration RUNTIME reads only its own seven launch variables', async () => {
    const files = await filesUnder('src', 'integration', 'runtime');
    const readers = files.filter(({ code }) => /process\.env/.test(code));
    expect(readers.map(({ path }) => rel(path))).toEqual([
      join('src', 'integration', 'runtime', 'main.ts'),
    ]);
    const code = readers[0]!.code;
    // Every environment read goes through `readEnv`, and every key it is given is a declared
    // constant — there is no string literal environment key in the file at all.
    expect(code).not.toMatch(/process\.env\[['"]/);
    for (const key of INTEGRATION_RUNTIME_ENV_KEYS) {
      expect(code, key).not.toContain(`'${key}'`);
    }
  });

  it('the AUDIT provider runtime reads only its own eight launch variables', async () => {
    /*
     * The mirror of the integration-runtime assertion above, and it exists for the same
     * reason: `controlPlaneFiles()` excludes this directory because it is a different
     * process, and an exclusion with no compensating assertion is a hole.
     *
     * `§14` of the S1O mandate: the audit runtime needs a "separate environment allowlist",
     * and `50 §2g` forbids an environment variable supplying a credential risk class. Both
     * are checked here: the only file that reads the environment is the entry point, every
     * key it reads is a declared constant, and there is no string-literal environment key in
     * the file at all.
     */
    const files = await filesUnder('src', 'audit', 'provider', 'runtime');
    const readers = files.filter(({ code }) => /process\.env/.test(code));
    expect(readers.map(({ path }) => rel(path))).toEqual([
      join('src', 'audit', 'provider', 'runtime', 'main.ts'),
    ]);
    const code = readers[0]!.code;
    expect(code).not.toMatch(/process\.env\[['"]/);
    for (const key of AUDIT_READER_ENV_KEYS) {
      expect(code, key).not.toContain(`'${key}'`);
    }

    // AND IT READS NO KEY THE OTHER PLANE OWNS. `§13`: no control send credential.
    for (const key of INTEGRATION_RUNTIME_ENV_KEYS) {
      expect(code, key).not.toContain(key);
    }
  });

  it('the CONTROL side of the boundary imports no runtime module and no adapter', async () => {
    const files = await filesUnder('src', 'integration', 'control');
    const seen = new Set<string>();
    for (const { code } of files) {
      for (const match of code.matchAll(/from\s+['"]([^'"]+)['"]/g)) seen.add(match[1]!);
    }
    /*
     * `§45`: "CONTROL side may import: integration client/protocol types. CONTROL side may
     * NOT import: adapter secret loader; provider client; adapter implementation;
     * integration-only config reader."
     *
     * A HAND-AUTHORED ALLOWLIST, so a NEW dependency fails this test rather than slipping
     * past a pattern — the discipline the ACCEPTED gateway boundary test uses.
     */
    expect([...seen].sort()).toEqual(
      [
        'node:child_process',
        'node:crypto',
        'node:path',
        'node:url',
        '../../kernel/canonicalisation/actionCatalogue.js',
        '../../kernel/canonicalisation/actionClasses.js',
        '../../kernel/controlArtifacts/bundle.js',
        '../../kernel/controlArtifacts/credentialRisk.js',
        '../../kernel/gateway/adapterPort.js',
        '../../kernel/gateway/adapterRegistry.js',
        '../protocol/runtimeEnvironment.js',
        '../protocol/runtimeIdentity.js',
        '../protocol/wire.js',
        './adapterRuntimeRegistry.js',
      ].sort(),
    );
    for (const forbidden of [
      '../runtime/adapterSecretSource.js',
      '../runtime/integrationHost.js',
      '../runtime/integrationAdapter.js',
      '../runtime/main.ts',
      'node:fs',
      'node:fs/promises',
    ]) {
      expect([...seen], forbidden).not.toContain(forbidden);
    }
  });

  it('and the INTEGRATION side imports no database, no control artifact and no gateway', async () => {
    const files = await filesUnder('src', 'integration', 'runtime');
    const seen = new Set<string>();
    for (const { code } of files) {
      for (const match of code.matchAll(/from\s+['"]([^'"]+)['"]/g)) seen.add(match[1]!);
    }
    for (const specifier of seen) {
      expect(specifier, `the integration runtime imports ${specifier}`).not.toMatch(
        /(db\/pool|db\/migrate|auditPool|controlArtifacts|kernel\/gateway|kernel\/exposure|kernel\/outbox|kernel\/policy|pg)/,
      );
    }
  });
});

describe('`§19` — NOTHING IN `src/` REACHES THE INTEGRATION TRANSPORT BUT ITS OWN MODULE', () => {
  it('no production module imports the integration client', async () => {
    const files = await filesUnder('src');
    const importers = files
      .filter(({ path }) => !path.endsWith(`${sep}integrationClient.ts`))
      .filter(({ code }) => /integrationClient\.js/.test(code))
      .map(({ path }) => rel(path));
    /*
     * `§19`: "Do not permit any arbitrary control module to invoke integration runtime
     * directly. The Effect Gateway remains the sole production dispatch origin."
     *
     * The list is EMPTY, which is the same posture `EMPTY_ADAPTER_REGISTRY` holds: the
     * transport is a leaf that a composition wires up, and there is no composition in
     * production because there is no adapter. A worker module that imported it would appear
     * here by name.
     */
    expect(importers).toEqual([]);
  });

  it('and production holds an EMPTY adapter registry and an EMPTY runtime registry', () => {
    expect(EMPTY_ADAPTER_REGISTRY.registeredIds).toEqual([]);
    const runtimes = emptyAdapterRuntimeRegistry();
    expect(runtimes.registeredIds).toEqual([]);
    expect(runtimes.resolve('mock_ads')).toBeUndefined();
    expect(runtimes.resolve('mock_commerce')).toBeUndefined();
    expect(runtimes.resolve('mock_processor')).toBeUndefined();
  });
});

describe('`§4`, `§47` — NO REAL PROVIDER, AND NO POSTMARK VARIABLE IS CONSUMED', () => {
  it('neither `src/` nor the synthetic integration plane names a real provider', async () => {
    const files = [...(await filesUnder('src')), ...(await filesUnder('tests', 'integration-plane'))];
    const offenders: string[] = [];
    for (const { path, code } of files) {
      for (const pattern of [
        /postmark/i,
        /sendgrid/i,
        /mailgun/i,
        /shopify/i,
        /stripe/i,
        /\bmailchimp\b/i,
        /\bses\b/i,
        /googleapis/i,
        /graph\.facebook/i,
        /globalThis\.fetch/,
        /from\s+['"]axios['"]/,
        /from\s+['"]undici['"]/,
        /from\s+['"]node-fetch['"]/,
        /from\s+['"](node:)?https?['"]/,
        /from\s+['"](node:)?net['"]/,
        /from\s+['"](node:)?tls['"]/,
        /https?:\/\//,
      ]) {
        if (pattern.test(code)) offenders.push(`${rel(path)} (${String(pattern)})`);
      }
    }
    expect(offenders, `a real provider surface:\n  ${offenders.join('\n  ')}`).toEqual([]);
  });

  it('`§47`: S1N consumes no `POSTMARK_*` variable anywhere', async () => {
    /*
     * "S1M's `POSTMARK_*` presence checks/readiness material may remain as the PARTIAL
     * checkpoint. **But S1N must not consume them.**"
     *
     * The S1M readiness gate under `tools/postmark-sandbox/` still names them, and that is
     * the checkpoint. Nothing S1N added does.
     */
    const files = [
      ...(await filesUnder('src')),
      ...(await filesUnder('tests', 'integration-plane')),
      ...(await filesUnder('tools', 'perimeter')),
      ...(await filesUnder('tools', 'integration-packaging')),
    ];
    for (const { path, code } of files) {
      expect(code, rel(path)).not.toMatch(/POSTMARK/i);
    }
  });
});

describe('`§13`, `§14` — THE WIRE SURFACE IS ASSERTED AGAINST A HAND-AUTHORED COPY', () => {
  it('the request field list is exactly these twenty names', () => {
    expect([...DISPATCH_REQUEST_FIELDS]).toEqual([
      'protocolVersion',
      'kind',
      'invocationId',
      'adapterId',
      'method',
      'actionClass',
      'recoverability',
      'authorisationRef',
      'companyId',
      'outboxId',
      'claimId',
      'effectId',
      'idempotencyKey',
      'correlationTag',
      'resourceRef',
      'requiresUnmirroredTag',
      'overrideRef',
      'dispatchPayloadHash',
      'dispatchPayloadBase64',
      'bindingDigest',
    ]);
  });

  it('and the refusal reasons are exactly these sixteen', () => {
    expect([...REFUSAL_REASONS]).toEqual([
      'PROTOCOL_VERSION_MISMATCH',
      'MESSAGE_NOT_AN_OBJECT',
      'MESSAGE_TOO_LARGE',
      'UNKNOWN_FIELD',
      'MISSING_FIELD',
      'FIELD_MALFORMED',
      'DUPLICATE_SEMANTIC_FIELD',
      'PROTOTYPE_POLLUTION_SHAPE',
      'ADAPTER_IDENTITY_MISMATCH',
      'AUTHORISATION_REF_MISSING',
      'AUTHORISATION_BINDING_MISMATCH',
      'PAYLOAD_HASH_MISMATCH',
      'CREDENTIAL_REVOKED',
      'CREDENTIAL_UNAVAILABLE',
      'ADAPTER_NOT_LOADED',
      'CONCURRENCY_LIMIT_EXCEEDED',
    ]);
  });
});

describe('`§11`, `§46` — THE PACKAGING MANIFEST PROVES THE SEPARATION', () => {
  it('every separation obligation holds over the computed import closures', async () => {
    const closures = await computeAllClosures();
    const findings = evaluateSeparation(closures);
    const failed = findings.filter((finding) => !finding.satisfied);
    expect(
      failed.map((finding) => `${finding.obligation}: ${finding.offending.join(', ')}`),
    ).toEqual([]);
    // AND THE OBLIGATION SET IS NOT EMPTY, so a manifest that computed nothing cannot pass.
    expect(findings.length).toBeGreaterThanOrEqual(8);
  });

  it("and adapter A's closure and adapter B's are genuinely different sets", async () => {
    const closures = await computeAllClosures();
    const a = closures.find((closure) => closure.name.endsWith('mock_ads'))!;
    const b = closures.find((closure) => closure.name.endsWith('mock_commerce'))!;
    expect(a.modules).not.toEqual(b.modules);
    expect(a.modules).toContain('tests/integration-plane/adapterA/providerClient.ts');
    expect(b.modules).not.toContain('tests/integration-plane/adapterA/providerClient.ts');
    expect(b.modules).toContain('tests/integration-plane/adapterB/providerClient.ts');
    expect(a.modules).not.toContain('tests/integration-plane/adapterB/providerClient.ts');
  });
});
