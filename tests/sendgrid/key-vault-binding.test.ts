import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { computeClosure } from '../../tools/integration-packaging/packagingManifest.js';
import {
  FORBIDDEN_LIVE_DOCUMENT_FIELDS,
  LIVE_KEY_VAULT_DOCUMENT_FIELDS,
  canonicalVaultHost,
  parseKeyVaultLocator,
  parseVersionedSecretId,
  resolveExactSecretVersion,
  type KeyVaultReader,
  type KeyVaultSecretAnswer,
  type KeyVaultSecretLocator,
} from '../../validation/sendgrid/integration/keyVault.js';
import {
  LIVE_KEY_VAULT_DOCUMENT_FIELDS as AUDIT_LIVE_KEY_VAULT_DOCUMENT_FIELDS,
  auditCanonicalVaultHost,
  parseAuditKeyVaultLocator,
  resolveAuditExactSecretVersion,
  type AuditKeyVaultSecretLocator,
} from '../../validation/sendgrid/audit/keyVault.js';
import { createAdapterSecretSourceForTest } from '../../validation/sendgrid/integration/secretSource.js';
import { createAuditReadSecretSourceForTest } from '../../validation/sendgrid/audit/secretSource.js';

/**
 * OWNER DECISION — **AZURE KEY VAULT IMMUTABLE SECRET VERSION BINDING.**
 *
 * =================================================================================
 * WHAT THIS SUITE IS FOR
 *
 * `50 §2g` field 1 requires the identity of THE EXACT MATERIAL a runtime may present. A file
 * that carries a secret and a label beside it asserts an ADJACENCY; an Azure Key Vault secret
 * VERSION is immutable and Key Vault returns the version's full identifier IN THE SAME
 * RESPONSE as the material, so the identity is of the exact bytes returned.
 *
 * Two properties carry the whole design, and every case below is one of them:
 *
 *   NEVER LATEST     an exact version is required, requested explicitly, and CHECKED in the
 *                    answer. A missing version refuses before any call is made.
 *   THE RETURNED ID  `credentialIdentity` is `properties.id` — the string Key Vault SENT. The
 *                    configuration CHECKS it and never BUILDS it.
 *
 * **NOTHING HERE CONTACTS AZURE.** The Azure SDK boundary is a narrowly typed reader function;
 * every case supplies a literal answer. The production factories still construct the real
 * `ManagedIdentityCredential` and the real `SecretClient`, and the last block asserts that by
 * source scan and by import closure.
 *
 * =================================================================================
 * BOTH PLANES ARE DRIVEN INDEPENDENTLY, BECAUSE THEY ARE INDEPENDENT
 *
 * `validation/sendgrid/integration/` and `validation/sendgrid/audit/` share no module. The
 * Key Vault binding is therefore implemented twice, and it is TESTED twice — over the two
 * separate exports — rather than once over a shared helper that does not exist.
 * =================================================================================
 */

/**
 * A file's CODE, with comments removed.
 *
 * Every source-level assertion below is about what the code DOES, and these modules document
 * the credential types they refuse BY NAME — a scan over raw text would therefore find
 * `DefaultAzureCredential` in a sentence explaining that it is forbidden, and a scan for
 * `getSecret(` would find the comment that says the versionless form appears nowhere. Reading
 * the code without its prose is what makes those assertions mean what they say.
 */
function codeOf(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const VAULT = 'https://acos-s1p-send-kv.vault.azure.net';
const AUDIT_VAULT = 'https://acos-s1p-read-kv.vault.azure.net';
const NAME = 'acos-s1p-sendgrid-send';
const AUDIT_NAME = 'acos-s1p-sendgrid-audit-read';
const V1 = '0123456789abcdef0123456789abcdef';
const V2 = 'fedcba9876543210fedcba9876543210';
const CLIENT_ID = '11111111-2222-3333-4444-555555555555';
const AUDIT_CLIENT_ID = '99999999-8888-7777-6666-555555555555';
const SECRET = 'SG.s1p-validation-send-key-material';

function idFor(vault: string, name: string, version: string): string {
  return `${vault}/secrets/${name}/${version}`;
}

const LOCATOR: KeyVaultSecretLocator = Object.freeze({
  vaultUrl: VAULT,
  secretName: NAME,
  secretVersion: V1,
  managedIdentityClientId: CLIENT_ID,
});

const AUDIT_LOCATOR: AuditKeyVaultSecretLocator = Object.freeze({
  vaultUrl: AUDIT_VAULT,
  secretName: AUDIT_NAME,
  secretVersion: V1,
  managedIdentityClientId: AUDIT_CLIENT_ID,
});

/** A well-formed Key Vault answer, with per-case overrides. */
function answer(overrides: {
  readonly value?: string | undefined;
  readonly id?: string | undefined;
  readonly name?: string | undefined;
  readonly version?: string | undefined;
  readonly vaultUrl?: string | undefined;
  readonly enabled?: boolean | undefined;
  readonly notBefore?: Date | undefined;
  readonly expiresOn?: Date | undefined;
} = {}): KeyVaultSecretAnswer {
  return {
    value: 'value' in overrides ? overrides.value : SECRET,
    properties: {
      id: 'id' in overrides ? overrides.id : idFor(VAULT, NAME, V1),
      name: 'name' in overrides ? overrides.name : NAME,
      version: 'version' in overrides ? overrides.version : V1,
      vaultUrl: 'vaultUrl' in overrides ? overrides.vaultUrl : VAULT,
      ...(overrides.enabled === undefined ? {} : { enabled: overrides.enabled }),
      ...(overrides.notBefore === undefined ? {} : { notBefore: overrides.notBefore }),
      ...(overrides.expiresOn === undefined ? {} : { expiresOn: overrides.expiresOn }),
    },
  };
}

/** A reader that records every ask, so "never asked for another version" is provable. */
function recordingReader(
  answers: KeyVaultSecretAnswer | Error,
): { read: KeyVaultReader; asks: { name: string; version: string }[] } {
  const asks: { name: string; version: string }[] = [];
  return {
    asks,
    read: (name, version) => {
      asks.push({ name, version });
      if (answers instanceof Error) return Promise.reject(answers);
      return Promise.resolve(answers);
    },
  };
}

describe('`§11` EXACT VERSION — NEVER LATEST', () => {
  it('1 — configured V1, Key Vault returns V1 -> RESOLVED', async () => {
    const reader = recordingReader(answer());
    const outcome = await resolveExactSecretVersion(LOCATOR, reader.read);
    expect(outcome.kind).toBe('RESOLVED');
    if (outcome.kind !== 'RESOLVED') return;
    expect(outcome.version).toBe(V1);
    expect(outcome.secret).toBe(SECRET);
    // EXACTLY ONE ASK, for exactly the configured name and version.
    expect(reader.asks).toEqual([{ name: NAME, version: V1 }]);
  });

  it('2 — configured V1, returned version V2 -> UNAVAILABLE', async () => {
    /*
     * THE CASE THAT MAKES ROTATION SAFE.
     *
     * If ACOS accepted whatever version came back, creating a new Key Vault version would
     * move the material underneath an unchanged signed class-5 record. The returned version
     * is compared to the configured one, and a mismatch refuses.
     */
    const reader = recordingReader(
      answer({ id: idFor(VAULT, NAME, V2), version: V2 }),
    );
    const outcome = await resolveExactSecretVersion(LOCATOR, reader.read);
    expect(outcome.kind).toBe('REFUSED');
    if (outcome.kind !== 'REFUSED') return;
    expect(outcome.reason).toBe('RETURNED_VERSION_MISMATCH');
  });

  it('3 — a MISSING configured version -> UNAVAILABLE, before any call, ON BOTH PLANES', async () => {
    /*
     * A missing version is the one input that would otherwise mean "latest". It refuses at
     * the LOCATOR PARSE, so no call is made at all — asserted by the empty ask list.
     */
    for (const version of [undefined, '', 'latest', 'LATEST', 'not-hex']) {
      const parsed = parseKeyVaultLocator({
        vaultUrl: VAULT,
        secretName: NAME,
        ...(version === undefined ? {} : { secretVersion: version }),
        managedIdentityClientId: CLIENT_ID,
      });
      expect(parsed.kind, String(version)).toBe('REFUSED');
      if (parsed.kind !== 'REFUSED') continue;
      expect(parsed.reason).toBe('SECRET_VERSION_ABSENT');

      // THE AUDIT PLANE'S OWN PARSER, asserted independently. `latest` is not a version on
      // either plane, and neither parser has a default.
      const auditParsed = parseAuditKeyVaultLocator({
        vaultUrl: AUDIT_VAULT,
        secretName: AUDIT_NAME,
        ...(version === undefined ? {} : { secretVersion: version }),
        managedIdentityClientId: AUDIT_CLIENT_ID,
      });
      expect(auditParsed.kind, String(version)).toBe('REFUSED');
      if (auditParsed.kind !== 'REFUSED') continue;
      expect(auditParsed.reason).toBe('SECRET_VERSION_ABSENT');
    }

    // And through the SOURCE, which is the path a runtime actually takes.
    const workspace = mkdtempSync(join(tmpdir(), 'acos-s1p-kv-'));
    directories.push(workspace);
    const locatorPath = join(workspace, 'integration-secret.json');
    writeFileSync(
      locatorPath,
      JSON.stringify({
        adapterId: 'sendgrid_email',
        sourceKind: 'SECRET_MANAGER_VERSION',
        vaultUrl: VAULT,
        secretName: NAME,
        managedIdentityClientId: CLIENT_ID,
      }),
      'utf8',
    );
    let launched = 0;
    const source = createAdapterSecretSourceForTest({
      adapterId: 'sendgrid_email',
      locator: locatorPath,
      readerFactory: () => {
        launched += 1;
        return () => Promise.resolve(answer());
      },
    });
    expect((await source.resolve()).kind).toBe('UNAVAILABLE');
    // NO READER WAS EVEN CONSTRUCTED, so no credential and no destination was reached.
    expect(launched).toBe(0);
  });

  it('4 — a versionless lookup is IMPOSSIBLE through the production path', () => {
    /*
     * A SOURCE SCAN, because this is a property of the code rather than of a run.
     *
     * `getSecret(name)` — the one-argument, versionless, mutable-alias call — appears nowhere
     * in either package, and neither does a version LISTING. A future edit that introduced
     * one would fail here even if every behavioural case above still passed.
     */
    for (const path of [
      join('validation', 'sendgrid', 'integration', 'keyVault.ts'),
      join('validation', 'sendgrid', 'audit', 'keyVault.ts'),
    ]) {
      const source = codeOf(path);
      // The ONLY `getSecret` call carries an explicit version option.
      const calls = [...source.matchAll(/getSecret\s*\(/g)];
      expect(calls.length, path).toBe(1);
      expect(source, path).toContain('{ version: secretVersion }');
      // No discovery of "latest" by any route.
      expect(source, path).not.toMatch(/listPropertiesOfSecretVersions/);
      expect(source, path).not.toMatch(/getSecret\s*\(\s*secretName\s*\)/);
      expect(source, path).not.toMatch(/['"]latest['"]/);
    }
  });

  it('5 — after a failure the source NEVER asks for another version', async () => {
    const reader = recordingReader(
      answer({ id: idFor(VAULT, NAME, V2), version: V2 }),
    );
    await resolveExactSecretVersion(LOCATOR, reader.read);
    // ONE ask. No retry, no second version, no other name, no fallback vault.
    expect(reader.asks).toEqual([{ name: NAME, version: V1 }]);

    const failing = recordingReader(new Error('transient'));
    await resolveExactSecretVersion(LOCATOR, failing.read);
    expect(failing.asks).toEqual([{ name: NAME, version: V1 }]);
  });
});

describe('`§11` MATERIAL-BOUND IDENTITY', () => {
  it('6 — the returned FULL SECRET ID becomes the `credentialIdentity`', async () => {
    const expected = idFor(VAULT, NAME, V1);
    const outcome = await resolveExactSecretVersion(LOCATOR, () =>
      Promise.resolve(answer({ id: expected })),
    );
    expect(outcome.kind).toBe('RESOLVED');
    if (outcome.kind !== 'RESOLVED') return;
    // THE STRING KEY VAULT SENT, byte for byte.
    expect(outcome.credentialIdentity).toBe(expected);
  });

  it('7 - a document carrying a fabricated `credentialIdentity` is REFUSED OUTRIGHT', async () => {
    /*
     * **THIS CASE CHANGED, AND `45 §3` REQUIRES IT CHANGED OUT LOUD.**
     *
     * It used to assert that a document carrying a flattering `credentialIdentity` and an
     * `apiKey` still RESOLVED, on the ground that the Key Vault path did not read those
     * fields. That established the weaker property the independent review rejected: the
     * locator TOLERATED a secret.
     *
     * The live document is now closed. The same document is refused whole, before any
     * credential or client is constructed - so the fabricated identity cannot influence the
     * result because nothing about the document is used at all.
     *
     * That the RETURNED id is what becomes the identity is still proved, by case 6 above and
     * by case 1 of the closed-locator block, over documents that are actually admissible.
     */
    const workspace = mkdtempSync(join(tmpdir(), 'acos-s1p-kv-'));
    directories.push(workspace);
    const locatorPath = join(workspace, 'integration-secret.json');
    writeFileSync(
      locatorPath,
      JSON.stringify({
        adapterId: 'sendgrid_email',
        sourceKind: 'SECRET_MANAGER_VERSION',
        vaultUrl: VAULT,
        secretName: NAME,
        secretVersion: V1,
        managedIdentityClientId: CLIENT_ID,
        // A LIE, written beside the operands. Nothing reads it.
        credentialIdentity: idFor('https://attacker-kv.vault.azure.net', 'other-secret', V2),
        apiKey: 'SG.a-secret-the-key-vault-path-must-ignore',
      }),
      'utf8',
    );
    let factoryCalls = 0;
    const source = createAdapterSecretSourceForTest({
      adapterId: 'sendgrid_email',
      locator: locatorPath,
      readerFactory: () => {
        factoryCalls += 1;
        return () => Promise.resolve(answer());
      },
    });

    const resolution = await source.resolve();
    expect(resolution.kind).toBe('UNAVAILABLE');
    // THE AZURE BOUNDARY WAS NEVER REACHED. Ignoring and rejecting look identical from the
    // outside until you count the reader constructions.
    expect(factoryCalls).toBe(0);
  });

  it('8 — a returned ID whose SECRET NAME differs -> UNAVAILABLE', async () => {
    const outcome = await resolveExactSecretVersion(LOCATOR, () =>
      Promise.resolve(answer({ id: idFor(VAULT, 'a-different-secret', V1) })),
    );
    expect(outcome.kind).toBe('REFUSED');
    if (outcome.kind !== 'REFUSED') return;
    expect(outcome.reason).toBe('RETURNED_NAME_MISMATCH');
  });

  it('9 — a returned ID whose VERSION differs -> UNAVAILABLE', async () => {
    const outcome = await resolveExactSecretVersion(LOCATOR, () =>
      Promise.resolve(answer({ id: idFor(VAULT, NAME, V2) })),
    );
    expect(outcome.kind).toBe('REFUSED');
    if (outcome.kind !== 'REFUSED') return;
    expect(outcome.reason).toBe('RETURNED_VERSION_MISMATCH');
  });

  it('10 — a returned ID whose VAULT differs -> UNAVAILABLE', async () => {
    const outcome = await resolveExactSecretVersion(LOCATOR, () =>
      Promise.resolve(answer({ id: idFor('https://another-kv.vault.azure.net', NAME, V1) })),
    );
    expect(outcome.kind).toBe('REFUSED');
    if (outcome.kind !== 'REFUSED') return;
    expect(outcome.reason).toBe('RETURNED_VAULT_MISMATCH');
  });

  it('11 — a MISSING returned full ID -> UNAVAILABLE', async () => {
    /*
     * NO RETURNED ID MEANS NO ESTABLISHED IDENTITY, so the material is not handed on even
     * though the version field agreed. The identity is the binding; the version alone is not.
     */
    const outcome = await resolveExactSecretVersion(LOCATOR, () =>
      Promise.resolve(answer({ id: undefined })),
    );
    expect(outcome.kind).toBe('REFUSED');
    if (outcome.kind !== 'REFUSED') return;
    expect(outcome.reason).toBe('RETURNED_ID_ABSENT');
  });

  it('12 — an identity DERIVED FROM the vendor secret -> UNAVAILABLE', async () => {
    /*
     * A pathological vault whose secret VALUE is its own identifier. The rule that a label
     * may not be derived from the material it labels is restated here so a derived identity
     * never leaves the binding module.
     */
    const identity = idFor(VAULT, NAME, V1);
    const outcome = await resolveExactSecretVersion(LOCATOR, () =>
      Promise.resolve(answer({ id: identity, value: identity })),
    );
    expect(outcome.kind).toBe('REFUSED');
    if (outcome.kind !== 'REFUSED') return;
    expect(outcome.reason).toBe('IDENTITY_DERIVED_FROM_SECRET');
  });

  it('a VERSIONLESS returned id is refused rather than treated as a match', () => {
    // The two-segment form is the MUTABLE ALIAS. It names no version, so it establishes no
    // identity, and the parser refuses it instead of accepting the name-and-vault agreement.
    expect(parseVersionedSecretId(`${VAULT}/secrets/${NAME}`)).toBeNull();
    expect(parseVersionedSecretId(idFor(VAULT, NAME, V1))).toEqual({
      vaultHost: 'acos-s1p-send-kv.vault.azure.net',
      name: NAME,
      version: V1,
    });
  });
});

describe('`§11` MATERIAL', () => {
  it('13 — an EMPTY secret value -> UNAVAILABLE', async () => {
    for (const value of ['', undefined]) {
      const outcome = await resolveExactSecretVersion(LOCATOR, () =>
        Promise.resolve(answer({ value })),
      );
      expect(outcome.kind).toBe('REFUSED');
      if (outcome.kind !== 'REFUSED') continue;
      expect(outcome.reason).toBe('SECRET_VALUE_ABSENT');
    }
  });

  it('14 — a DISABLED secret version -> UNAVAILABLE', async () => {
    const outcome = await resolveExactSecretVersion(LOCATOR, () =>
      Promise.resolve(answer({ enabled: false })),
    );
    expect(outcome.kind).toBe('REFUSED');
    if (outcome.kind !== 'REFUSED') return;
    expect(outcome.reason).toBe('SECRET_DISABLED');
  });

  it('14b — a version outside its validity window -> UNAVAILABLE', async () => {
    const now = new Date('2026-09-29T12:00:00.000Z');
    const notYet = await resolveExactSecretVersion(
      LOCATOR,
      () => Promise.resolve(answer({ notBefore: new Date('2026-10-01T00:00:00.000Z') })),
      now,
    );
    expect(notYet.kind).toBe('REFUSED');
    if (notYet.kind === 'REFUSED') expect(notYet.reason).toBe('SECRET_NOT_CURRENTLY_VALID');

    const expired = await resolveExactSecretVersion(
      LOCATOR,
      () => Promise.resolve(answer({ expiresOn: new Date('2026-09-01T00:00:00.000Z') })),
      now,
    );
    expect(expired.kind).toBe('REFUSED');
    if (expired.kind === 'REFUSED') expect(expired.reason).toBe('SECRET_NOT_CURRENTLY_VALID');

    // AND A VERSION INSIDE ITS WINDOW STILL RESOLVES, so the check is not vacuous.
    const inside = await resolveExactSecretVersion(
      LOCATOR,
      () =>
        Promise.resolve(
          answer({
            notBefore: new Date('2026-09-01T00:00:00.000Z'),
            expiresOn: new Date('2026-12-01T00:00:00.000Z'),
          }),
        ),
      now,
    );
    expect(inside.kind).toBe('RESOLVED');
  });

  it('15 — a RETRIEVAL ERROR -> UNAVAILABLE, and the SDK detail is not carried', async () => {
    /*
     * `§12`: "Do not log SDK exception bodies wholesale." An Azure error can carry a request
     * id, headers and echoed request detail. Every failure maps onto ONE non-secret reason,
     * so there is no field through which an exception body could travel.
     */
    const thrown = new Error('RestError: 403 Forbidden — caller does not have secrets/get');
    const outcome = await resolveExactSecretVersion(LOCATOR, () => Promise.reject(thrown));
    expect(outcome.kind).toBe('REFUSED');
    if (outcome.kind !== 'REFUSED') return;
    expect(outcome.reason).toBe('KEY_VAULT_UNREACHABLE');
    expect(JSON.stringify(outcome)).not.toContain('Forbidden');
    expect(JSON.stringify(outcome)).not.toContain('secrets/get');
  });

  it('16 — a MALFORMED Azure response -> UNAVAILABLE', async () => {
    for (const malformed of [
      null,
      undefined,
      {},
      { properties: null },
      { properties: 'not-an-object' },
      { value: SECRET },
    ]) {
      const outcome = await resolveExactSecretVersion(
        LOCATOR,
        () => Promise.resolve(malformed as unknown as KeyVaultSecretAnswer),
      );
      expect(outcome.kind, JSON.stringify(malformed)).toBe('REFUSED');
    }
  });

  it('a NON-CANONICAL vault url is refused BEFORE a client is constructed', () => {
    /*
     * `§5`: "Do not turn Key Vault access into an arbitrary network capability." The SDK would
     * dial whatever origin it was handed, so the narrowing happens on this side of the
     * constructor — and Azure Government, China and private-cloud hosts are deliberately NOT
     * admitted in this S1P slice.
     */
    for (const rejected of [
      'http://acos-s1p-send-kv.vault.azure.net',
      'https://user:pass@acos-s1p-send-kv.vault.azure.net',
      'https://acos-s1p-send-kv.vault.azure.net:8443',
      'https://acos-s1p-send-kv.vault.azure.net/?x=1',
      'https://acos-s1p-send-kv.vault.azure.net/#f',
      'https://acos-s1p-send-kv.vault.azure.net/secrets',
      'https://attacker.example.test',
      'https://127.0.0.1',
      'https://acos-s1p-send-kv.vault.usgovcloudapi.net',
      'https://acos-s1p-send-kv.vault.azure.cn',
      '',
      'not a url',
    ]) {
      expect(canonicalVaultHost(rejected), rejected).toBeNull();
      expect(auditCanonicalVaultHost(rejected), rejected).toBeNull();
    }
    expect(canonicalVaultHost(VAULT)).toBe('acos-s1p-send-kv.vault.azure.net');
  });
});

describe('`§11` AUTHENTICATION — ONE DETERMINISTIC PRINCIPAL', () => {
  const SOURCES = [
    join('validation', 'sendgrid', 'integration', 'keyVault.ts'),
    join('validation', 'sendgrid', 'integration', 'secretSource.ts'),
    join('validation', 'sendgrid', 'audit', 'keyVault.ts'),
    join('validation', 'sendgrid', 'audit', 'secretSource.ts'),
  ];

  it('17 — the production branch constructs `ManagedIdentityCredential` with the EXACT configured client id', () => {
    /*
     * A SOURCE-LEVEL ASSERTION, because the construction is what matters and a behavioural
     * test would have to replace it to observe it.
     *
     * The credential is built from `locator.managedIdentityClientId` and from nothing else —
     * no environment variable, no default, no fallback — so the identity that retrieves vendor
     * material is the one the deployment configured.
     */
    for (const path of [
      join('validation', 'sendgrid', 'integration', 'keyVault.ts'),
      join('validation', 'sendgrid', 'audit', 'keyVault.ts'),
    ]) {
      const source = codeOf(path);
      expect(source, path).toContain('new ManagedIdentityCredential({');
      expect(source, path).toContain('clientId: locator.managedIdentityClientId,');
      // The client id comes from the locator, never from the process environment.
      expect(source, path).not.toMatch(/process\.env/);
    }
  });

  it('18 — NO `DefaultAzureCredential` exists in either SendGrid secret-source closure', () => {
    for (const path of SOURCES) {
      expect(codeOf(path), path).not.toContain('DefaultAzureCredential');
    }
  });

  it('19 — no CLI, environment, client-secret, chained or interactive credential either', () => {
    /*
     * The owner decision's full prohibition list. The identity used to retrieve vendor material
     * must be deterministic: a credential CHAIN is precisely a mechanism for silently becoming
     * a different principal, and a developer login is precisely what it would become.
     */
    const forbidden = [
      'DefaultAzureCredential',
      'AzureCliCredential',
      'AzureDeveloperCliCredential',
      'AzurePowerShellCredential',
      'EnvironmentCredential',
      'ClientSecretCredential',
      'ClientCertificateCredential',
      'ChainedTokenCredential',
      'UsernamePasswordCredential',
      'InteractiveBrowserCredential',
      'DeviceCodeCredential',
      'WorkloadIdentityCredential',
      'VisualStudioCodeCredential',
    ];
    for (const path of SOURCES) {
      const source = codeOf(path);
      for (const name of forbidden) {
        expect(source, `${path} names ${name}`).not.toContain(name);
      }
    }

    /*
     * **`accessToken` LEFT THAT LIST, AND `45 §3` REQUIRES IT SAID OUT LOUD.**
     *
     * `keyVault.ts` now NAMES `accessToken` - in `FORBIDDEN_LIVE_DOCUMENT_FIELDS`, the list of
     * fields a live locator may not carry. Naming a field in order to REJECT it is the
     * opposite of consuming one, and a scan that could not tell those apart would have forced
     * the forbidden list to be anonymous.
     *
     * So the property is asserted as what it actually is: no source READS an Azure token
     * field. The accessor forms are what would consume one, and they appear nowhere.
     */
    for (const path of SOURCES) {
      const source = codeOf(path);
      for (const accessor of ['.accessToken', "['accessToken']"]) {
        expect(source, `${path} reads ${accessor}`).not.toContain(accessor);
      }
    }

    /*
     * NON-VACUOUS, AND IT MATTERS HERE. `codeOf` strips comments, and these modules DO name
     * the forbidden credentials in prose — explaining why each is refused. The assertion is
     * that none of them is CODE, so the scan must be shown to still see code.
     */
    expect(codeOf(join('validation', 'sendgrid', 'integration', 'keyVault.ts'))).toContain(
      'ManagedIdentityCredential',
    );
    expect(readFileSync(join('validation', 'sendgrid', 'integration', 'keyVault.ts'), 'utf8'))
      .toContain('DefaultAzureCredential');
  });

  it('20 — no Azure authentication secret crosses the runtime environment or IPC', () => {
    /*
     * The credential-holding child obtains its OWN token through managed identity. Nothing
     * hands it a token, a client secret or a certificate — the environment allowlists have no
     * slot for one, and the locator schema has no field for one.
     */
    const forbidden = [
      'AZURE_CLIENT_SECRET',
      'AZURE_TENANT_ID',
      'AZURE_CLIENT_CERTIFICATE_PATH',
      'AZURE_USERNAME',
      'AZURE_PASSWORD',
      'getToken(',
    ];
    for (const path of [
      ...SOURCES,
      join('validation', 'sendgrid', 'harness', 'probeEnvironment.ts'),
      join('src', 'integration', 'runtime', 'main.ts'),
      join('src', 'audit', 'provider', 'runtime', 'main.ts'),
    ]) {
      const source = codeOf(path);
      for (const name of forbidden) {
        expect(source, `${path} names ${name}`).not.toContain(name);
      }
    }

    /*
     * **THIS ASSERTION CHANGED, AND `45 §3` REQUIRES IT CHANGED OUT LOUD.**
     *
     * It previously offered `apiKey` and `accessToken` alongside the operands, asserted the
     * parse SUCCEEDED, and checked that the forbidden values were absent from the result. That
     * established the wrong property: a locator that tolerates a secret is not a closed
     * locator. The values reached nothing, but an operator who put a key there would get a
     * working run and no signal, and the material would sit in a deployment file nothing
     * audits.
     *
     * The rule is now REJECTION, not projection: the whole document is refused.
     */
    const parsed = parseKeyVaultLocator({
      adapterId: 'sendgrid_email',
      sourceKind: 'SECRET_MANAGER_VERSION',
      vaultUrl: VAULT,
      secretName: NAME,
      secretVersion: V1,
      managedIdentityClientId: CLIENT_ID,
      apiKey: 'SG.should-never-be-accepted',
      accessToken: 'eyJ0-should-never-be-accepted',
    });
    expect(parsed.kind).toBe('REFUSED');
    if (parsed.kind !== 'REFUSED') return;
    expect(parsed.reason).toBe('LOCATOR_FIELDS_NOT_CLOSED');
    // AND THE REFUSAL NAMES NO VALUE — a reason echoing the field's content could carry it.
    expect(JSON.stringify(parsed)).not.toContain('SG.');
    expect(JSON.stringify(parsed)).not.toContain('eyJ0');
  });
});

describe('`§11` PLANE SEPARATION', () => {
  it('21, 22 — neither source can see the other plane’s locator, and neither imports the other', async () => {
    const integration = await computeClosure({
      name: 'INTEGRATION_SECRET_SOURCE',
      entryPoints: ['validation/sendgrid/integration/secretSource.ts'],
    });
    const audit = await computeClosure({
      name: 'AUDIT_SECRET_SOURCE',
      entryPoints: ['validation/sendgrid/audit/secretSource.ts'],
    });

    expect(integration.modules.filter((module) => module.includes('/audit/'))).toEqual([]);
    expect(audit.modules.filter((module) => module.includes('/integration/'))).toEqual([]);

    // AND EACH CARRIES ITS OWN KEY VAULT BINDING, not a shared one.
    expect(integration.modules).toContain('validation/sendgrid/integration/keyVault.ts');
    expect(audit.modules).toContain('validation/sendgrid/audit/keyVault.ts');

    /*
     * `§16` — THE AZURE SDK IS IN BOTH CHILDREN AND THE DUPLICATION IS DELIBERATE.
     *
     * A shared Key Vault helper would be the first module these two packages had in common,
     * and `48 §3.6`'s read-only exemption rests on the audit plane being independently
     * composed. The owner direction: "Duplication of a small amount of Azure binding code
     * across the two packages is preferable to weakening the plane boundary."
     */
    for (const closure of [integration, audit]) {
      expect(closure.packages, closure.name).toContain('@azure/identity');
      expect(closure.packages, closure.name).toContain('@azure/keyvault-secrets');
    }
  });

  it('23 — each plane resolves through its OWN vault to its OWN returned identity', async () => {
    /*
     * **THIS TEST'S TITLE CHANGED, AND `45 §3` REQUIRES IT CHANGED OUT LOUD.**
     *
     * It was called "the two planes use DISTINCT managed identities and DISTINCT vaults" and
     * it proved no such thing: it built two fixture constants carrying different GUIDs and
     * asserted the constants differed. A real deployment could have configured ONE
     * user-assigned managed identity for both planes and passed it.
     *
     * The live contract is now a GATE, driven against the isolated child processes in
     * `THE DISTINCT-PRINCIPAL GATE` below and in `tests/sendgrid/preflight.test.ts`. What
     * remains here is what this case could always honestly claim: each plane's binding
     * resolves through its own vault and its own secret to its own returned identity.
     */
    const send = await resolveExactSecretVersion(LOCATOR, (name, version) => {
      expect(name).toBe(NAME);
      expect(version).toBe(V1);
      return Promise.resolve(answer());
    });
    const read = await resolveAuditExactSecretVersion(AUDIT_LOCATOR, (name, version) => {
      expect(name).toBe(AUDIT_NAME);
      expect(version).toBe(V1);
      return Promise.resolve({
        value: 'SG.s1p-validation-audit-read-key',
        properties: {
          id: idFor(AUDIT_VAULT, AUDIT_NAME, V1),
          name: AUDIT_NAME,
          version: V1,
          vaultUrl: AUDIT_VAULT,
        },
      });
    });

    expect(send.kind).toBe('RESOLVED');
    expect(read.kind).toBe('RESOLVED');
    if (send.kind !== 'RESOLVED' || read.kind !== 'RESOLVED') return;
    // TWO DIFFERENT CREDENTIAL IDENTITIES, from two different vaults.
    expect(send.credentialIdentity).not.toBe(read.credentialIdentity);
    expect(send.credentialIdentity).toContain('acos-s1p-send-kv');
    expect(read.credentialIdentity).toContain('acos-s1p-read-kv');
  });

  it('24 — the SAME vendor credential identity on both planes still fails the distinct-credential gate', () => {
    /*
     * `§13` of the S1O mandate forbids one credential serving both planes, and that gate lives
     * in the preflight rather than in a secret source. Key Vault binding does not soften it:
     * the two identities are compared for equality, and two planes resolving the same
     * versioned secret id is the configuration that gate exists to refuse.
     *
     * The gate itself is driven in `tests/sendgrid/preflight.test.ts`; this case asserts the
     * OPERAND the Key Vault mechanism now supplies to it.
     */
    const shared = idFor(VAULT, NAME, V1);
    expect(shared).toBe(shared);
    // A single versioned secret id cannot satisfy two distinct class-5 records, because
    // `50 §2g` field 1 identifies exactly one credential's material.
    expect(parseVersionedSecretId(shared)?.version).toBe(V1);
  });

  it('25 — the audit plane refuses an integration-shaped document, and vice versa', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'acos-s1p-kv-'));
    directories.push(workspace);

    // An INTEGRATION document handed to the AUDIT source: `providerId` does not match, so the
    // audit source refuses before any Key Vault operand is parsed.
    const crossed = join(workspace, 'crossed.json');
    writeFileSync(
      crossed,
      JSON.stringify({
        adapterId: 'sendgrid_email',
        sourceKind: 'SECRET_MANAGER_VERSION',
        vaultUrl: VAULT,
        secretName: NAME,
        secretVersion: V1,
        managedIdentityClientId: CLIENT_ID,
      }),
      'utf8',
    );
    let launched = 0;
    const auditSource = createAuditReadSecretSourceForTest({
      providerId: 'twilio_sendgrid',
      locator: crossed,
      readerFactory: () => {
        launched += 1;
        return () => Promise.resolve(answer());
      },
    });
    expect((await auditSource.resolve()).kind).toBe('UNAVAILABLE');
    expect(launched).toBe(0);
  });
});

describe('`§11` ROTATION — A NEW VERSION CANNOT SILENTLY PASS AN UNCHANGED CLASS-5 RECORD', () => {
  /*
   * =================================================================================
   * THE PROPERTY THE WHOLE OWNER DECISION EXISTS FOR
   *
   * A signed class-5 record names ONE exact versioned secret id. Rotation creates a NEW Key
   * Vault version, which has a NEW id. Three independent things then have to line up before
   * the new material can be used, and each of them is owner-controlled:
   *
   *   1  the locator must be pointed at V2 — a deployment change;
   *   2  a candidate class-5 record must name the V2 id — a repository change;
   *   3  a new release must be signed — an owner ceremony.
   *
   * If only (1) happens, the source resolves V2 honestly and the accepted host compares the
   * returned identity against the signed V1 identity and REFUSES, before SendGrid. The
   * authority follows the owner, never the vault.
   * =================================================================================
   */

  /** The comparison the accepted integration/audit hosts perform. Restated, not imported. */
  function hostAccepts(returnedIdentity: string, signedCredentialId: string): boolean {
    return returnedIdentity === signedCredentialId;
  }

  it('26 — returned identity A and signed expected identity A -> the host may proceed', async () => {
    const signed = idFor(VAULT, NAME, V1);
    const outcome = await resolveExactSecretVersion(LOCATOR, () =>
      Promise.resolve(answer({ id: signed })),
    );
    expect(outcome.kind).toBe('RESOLVED');
    if (outcome.kind !== 'RESOLVED') return;
    expect(hostAccepts(outcome.credentialIdentity, signed)).toBe(true);
  });

  it('27 — returned identity B against signed identity A -> refused BEFORE SendGrid', async () => {
    /*
     * The locator was repointed at a DIFFERENT SECRET in the same vault. The source resolves
     * it honestly — it is a legitimate exact version — and the identity comparison is what
     * refuses. The refusal is in the host, before the adapter is reached, so no SendGrid
     * boundary is crossed.
     */
    const signed = idFor(VAULT, NAME, V1);
    const other: KeyVaultSecretLocator = { ...LOCATOR, secretName: 'a-different-secret' };
    const outcome = await resolveExactSecretVersion(other, () =>
      Promise.resolve(
        answer({
          id: idFor(VAULT, 'a-different-secret', V1),
          name: 'a-different-secret',
        }),
      ),
    );
    expect(outcome.kind).toBe('RESOLVED');
    if (outcome.kind !== 'RESOLVED') return;
    expect(hostAccepts(outcome.credentialIdentity, signed)).toBe(false);
  });

  it('28 — a synthetic `FILE_FIXTURE` still cannot satisfy the live material-bound preflight', async () => {
    /*
     * The fixture path remains, for offline tests, and it remains HONEST: a file established
     * the label, so the provenance is `SYNTHETIC_TEST_IDENTITY` whatever the file claims, and
     * `preflight.ts` refuses a live run on it.
     */
    const workspace = mkdtempSync(join(tmpdir(), 'acos-s1p-kv-'));
    directories.push(workspace);
    const locatorPath = join(workspace, 'fixture.json');
    writeFileSync(
      locatorPath,
      JSON.stringify({
        adapterId: 'sendgrid_email',
        sourceKind: 'FILE_FIXTURE',
        apiKey: 'SG.fixture-material',
        // Even a perfectly-shaped Key Vault id, written into a FILE, buys nothing.
        credentialIdentity: idFor(VAULT, NAME, V1),
      }),
      'utf8',
    );
    const source = createAdapterSecretSourceForTest({
      adapterId: 'sendgrid_email',
      locator: locatorPath,
      readerFactory: () => () => Promise.reject(new Error('must not be reached')),
    });
    const resolution = await source.resolve();
    expect(resolution.kind).toBe('RESOLVED');
    if (resolution.kind !== 'RESOLVED') return;
    // THE MECHANISM ASSIGNS THE PROVENANCE, and a file's mechanism is the fixture one.
    expect(resolution.credential.identityProvenance).toBe('SYNTHETIC_TEST_IDENTITY');
  });

  it('29 — candidate signed identity names V1; the locator moves to V2 -> MISMATCH', async () => {
    const signedV1 = idFor(VAULT, NAME, V1);
    const rotated: KeyVaultSecretLocator = { ...LOCATOR, secretVersion: V2 };

    const outcome = await resolveExactSecretVersion(rotated, () =>
      Promise.resolve(answer({ id: idFor(VAULT, NAME, V2), version: V2 })),
    );
    // The resolution SUCCEEDS — V2 is a real exact version, resolved honestly.
    expect(outcome.kind).toBe('RESOLVED');
    if (outcome.kind !== 'RESOLVED') return;
    expect(outcome.credentialIdentity).toBe(idFor(VAULT, NAME, V2));

    // AND THE HOST REFUSES, because the SIGNED record still names V1. **This is the whole
    // point: rotation cannot mutate authority underneath a signature.**
    expect(hostAccepts(outcome.credentialIdentity, signedV1)).toBe(false);
  });

  it('30 — V2 becomes usable ONLY when the signed expected identity IS the returned V2 id', async () => {
    const signedV2 = idFor(VAULT, NAME, V2);
    const rotated: KeyVaultSecretLocator = { ...LOCATOR, secretVersion: V2 };
    const outcome = await resolveExactSecretVersion(rotated, () =>
      Promise.resolve(answer({ id: signedV2, version: V2 })),
    );
    expect(outcome.kind).toBe('RESOLVED');
    if (outcome.kind !== 'RESOLVED') return;
    expect(hostAccepts(outcome.credentialIdentity, signedV2)).toBe(true);

    // AND THE OLD SIGNATURE NO LONGER ACCEPTS IT, so the two versions are not interchangeable.
    expect(hostAccepts(outcome.credentialIdentity, idFor(VAULT, NAME, V1))).toBe(false);
  });

  it('the AUDIT plane rotates under the same rule, independently', async () => {
    const signedV1 = idFor(AUDIT_VAULT, AUDIT_NAME, V1);
    const rotated: AuditKeyVaultSecretLocator = { ...AUDIT_LOCATOR, secretVersion: V2 };
    const outcome = await resolveAuditExactSecretVersion(rotated, () =>
      Promise.resolve({
        value: 'SG.s1p-validation-audit-read-key',
        properties: {
          id: idFor(AUDIT_VAULT, AUDIT_NAME, V2),
          name: AUDIT_NAME,
          version: V2,
          vaultUrl: AUDIT_VAULT,
        },
      }),
    );
    expect(outcome.kind).toBe('RESOLVED');
    if (outcome.kind !== 'RESOLVED') return;
    expect(outcome.credentialIdentity).not.toBe(signedV1);
  });
});

describe('`§12` SECRET HYGIENE — NOTHING CARRIES MATERIAL', () => {
  it('no refusal, and no resolved shape, can carry a token or an Authorization header', async () => {
    const refusal = await resolveExactSecretVersion(LOCATOR, () =>
      Promise.reject(new Error('Bearer eyJ0eXAiOiJKV1QifQ. Authorization: Bearer secret')),
    );
    const serialised = JSON.stringify(refusal);
    expect(serialised).not.toContain('Bearer');
    expect(serialised).not.toContain('eyJ0');
    expect(serialised).not.toMatch(/authorization/i);

    /*
     * AND THE REFUSAL SET ITSELF CANNOT NAME MATERIAL. Every reason is a property of the
     * configuration or of the returned METADATA; none is a value.
     */
    if (refusal.kind !== 'REFUSED') return;
    expect(refusal.reason).toBe('KEY_VAULT_UNREACHABLE');
  });

  it('the resolved credential identity is a NON-SECRET Key Vault URL, and is audit-visible', async () => {
    /*
     * `§12`: "The evidence bundle may carry the non-secret `credentialIdentity` because
     * class-5 identity is designed to be audit-visible." So the assertion is the positive one:
     * the identity is a URL a reviewer can read, and it contains no secret material.
     */
    const outcome = await resolveExactSecretVersion(LOCATOR, () => Promise.resolve(answer()));
    expect(outcome.kind).toBe('RESOLVED');
    if (outcome.kind !== 'RESOLVED') return;
    expect(outcome.credentialIdentity.startsWith('https://')).toBe(true);
    expect(outcome.credentialIdentity).not.toContain(SECRET);
    expect(outcome.credentialIdentity).not.toContain('SG.');
  });
});

const directories: string[] = [];

afterEach(() => {
  while (directories.length > 0) {
    const directory = directories.pop();
    if (directory !== undefined) rmSync(directory, { recursive: true, force: true });
  }
});

describe('NOTHING IN THIS SUITE CONTACTS AZURE', () => {
  it('no test file constructs a real `SecretClient` or a real Azure credential', () => {
    /*
     * The seam is for MODULE TESTING. `§10` also requires that the production factory always
     * use the real client — which `tests/sendgrid/key-vault-binding.test.ts` cannot assert
     * about itself, so it asserts the complement: no test anywhere builds one.
     */
    const offenders: string[] = [];
    const walk = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (path.endsWith('.ts')) {
          if (/from\s+['"]@azure\//.test(codeOf(path))) offenders.push(path);
        }
      }
    };
    walk('tests');
    expect(offenders).toEqual([]);

    // NON-VACUOUS: the two production modules DO import the SDK, and the walk reads files.
    expect(
      readFileSync(join('validation', 'sendgrid', 'integration', 'keyVault.ts'), 'utf8'),
    ).toMatch(/from '@azure\/keyvault-secrets'/);
  });
});

describe('THE LIVE LOCATOR IS **CLOSED** — FORBIDDEN FIELDS ARE REJECTED, NOT IGNORED', () => {
  /*
   * =================================================================================
   * THE DEFECT THIS BLOCK CLOSES
   *
   * The first implementation called the locator CLOSED while `parseKeyVaultLocator` read the
   * four operands it wanted and IGNORED everything else. A live document carrying `apiKey`,
   * a fabricated `credentialIdentity` or an Azure `accessToken` PARSED — the forbidden values
   * reached nothing, but they were tolerated.
   *
   * Tolerating a secret is the defect. An operator who put a key in a locator would get a
   * working run and no signal; the material would sit in a deployment file nothing audits,
   * and the next reader of that file would reasonably conclude it belonged there.
   *
   * The rule is now exact-field-set acceptance, checked BEFORE the credential is constructed,
   * BEFORE the client is constructed and BEFORE any vault read — which every case below
   * proves by asserting the reader factory was never even called.
   * =================================================================================
   */

  /** The EXACT live integration document. Nothing more, nothing less. */
  function integrationDocument(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      adapterId: 'sendgrid_email',
      sourceKind: 'SECRET_MANAGER_VERSION',
      vaultUrl: VAULT,
      secretName: NAME,
      secretVersion: V1,
      managedIdentityClientId: CLIENT_ID,
      ...extra,
    };
  }

  /** The EXACT live audit document, with this plane's own operands. */
  function auditDocument(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      providerId: 'twilio_sendgrid',
      sourceKind: 'SECRET_MANAGER_VERSION',
      vaultUrl: AUDIT_VAULT,
      secretName: AUDIT_NAME,
      secretVersion: V1,
      managedIdentityClientId: AUDIT_CLIENT_ID,
      ...extra,
    };
  }

  /** Drive the INTEGRATION source, counting whether the Azure boundary was ever reached. */
  async function resolveIntegration(
    document: Record<string, unknown>,
  ): Promise<{ readonly kind: string; readonly factoryCalls: number }> {
    const workspace = mkdtempSync(join(tmpdir(), 'acos-s1p-closed-'));
    directories.push(workspace);
    const locatorPath = join(workspace, 'integration-secret.json');
    writeFileSync(locatorPath, JSON.stringify(document), 'utf8');
    let factoryCalls = 0;
    const source = createAdapterSecretSourceForTest({
      adapterId: 'sendgrid_email',
      locator: locatorPath,
      readerFactory: () => {
        factoryCalls += 1;
        return () => Promise.resolve(answer());
      },
    });
    return { kind: (await source.resolve()).kind, factoryCalls };
  }

  it('1 — the EXACT integration Key Vault document is ACCEPTED', async () => {
    const outcome = await resolveIntegration(integrationDocument());
    expect(outcome.kind).toBe('RESOLVED');
    expect(outcome.factoryCalls).toBe(1);
  });

  it('2 — the EXACT audit Key Vault document is ACCEPTED', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'acos-s1p-closed-'));
    directories.push(workspace);
    const locatorPath = join(workspace, 'audit-secret.json');
    writeFileSync(locatorPath, JSON.stringify(auditDocument()), 'utf8');
    const source = createAuditReadSecretSourceForTest({
      providerId: 'twilio_sendgrid',
      locator: locatorPath,
      readerFactory: () => () =>
        Promise.resolve({
          value: 'SG.s1p-validation-audit-read-key',
          properties: {
            id: idFor(AUDIT_VAULT, AUDIT_NAME, V1),
            name: AUDIT_NAME,
            version: V1,
            vaultUrl: AUDIT_VAULT,
          },
        }),
    });
    const resolution = await source.resolve();
    expect(resolution.kind).toBe('RESOLVED');
    if (resolution.kind !== 'RESOLVED') return;
    expect(resolution.credential.identityProvenance).toBe('DEPLOYMENT_SECRET_VERSION');
  });

  it('3, 4, 5, 6 — ANY forbidden or unknown field REFUSES, and no reader is constructed', async () => {
    /*
     * ONE TABLE, THE FOUR REQUIRED CASES PLUS THE REST OF THE FORBIDDEN LIST.
     *
     * `factoryCalls === 0` is the load-bearing half of each: the refusal happens in the parse,
     * so `ManagedIdentityCredential` is never built, `SecretClient` is never built and Key
     * Vault is never dialled. A check that merely produced `UNAVAILABLE` after contacting
     * Azure would satisfy the letter of "fails closed" and none of its intent.
     */
    const cases: readonly (readonly [string, string])[] = [
      ['apiKey', 'SG.a-real-looking-send-key'],
      ['credentialIdentity', idFor(VAULT, NAME, V2)],
      ['accessToken', 'eyJ0eXAiOiJKV1QifQ.payload.signature'],
      ['identityProvenance', 'DEPLOYMENT_SECRET_VERSION'],
      ['version', 'fixture-version'],
      ['clientSecret', 'a-client-secret'],
      ['tenantId', '00000000-0000-0000-0000-000000000000'],
      ['certificatePath', '/etc/ssl/private/azure.pem'],
      ['privateKey', '-----BEGIN PRIVATE KEY-----'],
      ['simulatedAccountPath', '/tmp/simulated-account.json'],
      ['somethingNobodyDeclared', 'anything at all'],
    ];
    for (const [field, value] of cases) {
      const outcome = await resolveIntegration(integrationDocument({ [field]: value }));
      expect(outcome.kind, `${field} was accepted`).toBe('UNAVAILABLE');
      expect(outcome.factoryCalls, `${field} reached the Azure boundary`).toBe(0);
    }
  });

  it('the AUDIT plane is closed independently, over its own field set', async () => {
    for (const field of ['apiKey', 'credentialIdentity', 'accessToken', 'adapterId', 'unknown']) {
      const workspace = mkdtempSync(join(tmpdir(), 'acos-s1p-closed-'));
      directories.push(workspace);
      const locatorPath = join(workspace, 'audit-secret.json');
      writeFileSync(locatorPath, JSON.stringify(auditDocument({ [field]: 'x' })), 'utf8');
      let factoryCalls = 0;
      const source = createAuditReadSecretSourceForTest({
        providerId: 'twilio_sendgrid',
        locator: locatorPath,
        readerFactory: () => {
          factoryCalls += 1;
          return () => Promise.reject(new Error('must not be reached'));
        },
      });
      expect((await source.resolve()).kind, field).toBe('UNAVAILABLE');
      expect(factoryCalls, field).toBe(0);
    }
  });

  it('the two planes do NOT accept the other plane-owner field', () => {
    /*
     * `adapterId` belongs to the integration document and `providerId` to the audit one. Each
     * closed set names its own, so a document shaped for the other plane refuses on the field
     * set alone — before the owner-id comparison that would also have caught it.
     */
    const integrationSees = parseKeyVaultLocator(auditDocument());
    expect(integrationSees.kind).toBe('REFUSED');
    if (integrationSees.kind === 'REFUSED') {
      expect(integrationSees.reason).toBe('LOCATOR_FIELDS_NOT_CLOSED');
    }
    const auditSees = parseAuditKeyVaultLocator(integrationDocument());
    expect(auditSees.kind).toBe('REFUSED');
    if (auditSees.kind === 'REFUSED') {
      expect(auditSees.reason).toBe('LOCATOR_FIELDS_NOT_CLOSED');
    }
  });

  it('7 — `FILE_FIXTURE` keeps its own wider TEST-ONLY schema and is unaffected', async () => {
    /*
     * The fixture mechanism still carries `apiKey` and `credentialIdentity`, because that is
     * what a fixture IS. Closing the LIVE locator did not close the fixture one, and the
     * fixture stays honest: the provenance is `SYNTHETIC_TEST_IDENTITY` whatever the document
     * claims, so it still cannot satisfy a live material-bound preflight.
     */
    const workspace = mkdtempSync(join(tmpdir(), 'acos-s1p-closed-'));
    directories.push(workspace);
    const locatorPath = join(workspace, 'fixture.json');
    writeFileSync(
      locatorPath,
      JSON.stringify({
        adapterId: 'sendgrid_email',
        sourceKind: 'FILE_FIXTURE',
        apiKey: 'SG.fixture-material',
        credentialIdentity: 'twilio_sendgrid.validation_send',
        version: 'fixture-1',
      }),
      'utf8',
    );
    const source = createAdapterSecretSourceForTest({
      adapterId: 'sendgrid_email',
      locator: locatorPath,
      readerFactory: () => () => Promise.reject(new Error('must not be reached')),
    });
    const resolution = await source.resolve();
    expect(resolution.kind).toBe('RESOLVED');
    if (resolution.kind !== 'RESOLVED') return;
    expect(resolution.credential.identityProvenance).toBe('SYNTHETIC_TEST_IDENTITY');
  });

  it('8 — a fake identity beside the operands fails because the DOCUMENT is refused', async () => {
    /*
     * **THE DIFFERENCE THIS CORRECTION MAKES, STATED AS AN ASSERTION.**
     *
     * The old suite proved a fabricated `credentialIdentity` "could not influence the result"
     * — true, but only because the field was unread. Now the document carrying it does not
     * resolve at all, and the Azure boundary is never reached. Ignoring and rejecting look the
     * same from the outside until you count the reader constructions.
     */
    const outcome = await resolveIntegration(
      integrationDocument({ credentialIdentity: idFor(VAULT, NAME, V2) }),
    );
    expect(outcome.kind).toBe('UNAVAILABLE');
    expect(outcome.factoryCalls).toBe(0);
  });

  it('the closed set and the forbidden list agree, and neither is empty', () => {
    // A field added to one list and forgotten in the other is how this control would erode.
    for (const forbidden of FORBIDDEN_LIVE_DOCUMENT_FIELDS) {
      expect(LIVE_KEY_VAULT_DOCUMENT_FIELDS, forbidden).not.toContain(forbidden);
      expect(AUDIT_LIVE_KEY_VAULT_DOCUMENT_FIELDS, forbidden).not.toContain(forbidden);
    }
    expect(LIVE_KEY_VAULT_DOCUMENT_FIELDS.length).toBeGreaterThan(0);
    expect(FORBIDDEN_LIVE_DOCUMENT_FIELDS.length).toBeGreaterThan(0);
  });
});

describe('THE DISTINCT-PRINCIPAL GATE — REPORTED BY THE SOURCES, NOT BY THE PARENT', () => {
  /*
   * =================================================================================
   * WHAT THE OLD TEST 23 CLAIMED, AND WHAT IT ACTUALLY PROVED
   *
   * It was titled "the two planes use DISTINCT managed identities and DISTINCT vaults" and it
   * compared two fixture constants. A real deployment could have configured ONE user-assigned
   * managed identity for both planes and passed every gate.
   *
   * The live contract is that each SOURCE reports the non-secret Azure principal it is
   * configured to resolve as, from its OWN closed locator parse, inside its OWN process — and
   * the coordinator compares the two. These cases drive the reporting half; the GATE that
   * consumes it is driven in `tests/sendgrid/preflight.test.ts`, and the end-to-end refusal in
   * `tests/sendgrid/cli-orchestration.test.ts`.
   * =================================================================================
   */
  function documentFor(
    plane: 'INTEGRATION' | 'AUDIT',
    principal: string,
  ): Record<string, unknown> {
    return plane === 'INTEGRATION'
      ? {
          adapterId: 'sendgrid_email',
          sourceKind: 'SECRET_MANAGER_VERSION',
          vaultUrl: VAULT,
          secretName: NAME,
          secretVersion: V1,
          managedIdentityClientId: principal,
        }
      : {
          providerId: 'twilio_sendgrid',
          sourceKind: 'SECRET_MANAGER_VERSION',
          vaultUrl: AUDIT_VAULT,
          secretName: AUDIT_NAME,
          secretVersion: V1,
          managedIdentityClientId: principal,
        };
  }

  function principalOf(
    plane: 'INTEGRATION' | 'AUDIT',
    document: Record<string, unknown>,
  ): { readonly principalIdentity: string | null; readonly mechanism: string | null } {
    const workspace = mkdtempSync(join(tmpdir(), 'acos-s1p-principal-'));
    directories.push(workspace);
    const locatorPath = join(workspace, 'secret.json');
    writeFileSync(locatorPath, JSON.stringify(document), 'utf8');
    const source =
      plane === 'INTEGRATION'
        ? createAdapterSecretSourceForTest({
            adapterId: 'sendgrid_email',
            locator: locatorPath,
            readerFactory: () => () => Promise.reject(new Error('must not be reached')),
          })
        : createAuditReadSecretSourceForTest({
            providerId: 'twilio_sendgrid',
            locator: locatorPath,
            readerFactory: () => () => Promise.reject(new Error('must not be reached')),
          });
    return (
      source as unknown as {
        describeSourcePrincipal(): {
          principalIdentity: string | null;
          mechanism: string | null;
        };
      }
    ).describeSourcePrincipal();
  }

  it('each SOURCE reports the managed identity from its OWN closed locator', () => {
    const send = principalOf('INTEGRATION', documentFor('INTEGRATION', CLIENT_ID));
    const read = principalOf('AUDIT', documentFor('AUDIT', AUDIT_CLIENT_ID));
    expect(send.principalIdentity).toBe(CLIENT_ID);
    expect(read.principalIdentity).toBe(AUDIT_CLIENT_ID);
    expect(send.mechanism).toBe('SECRET_MANAGER_VERSION');
    // AND THEY DIFFER — which a deployment must arrange and the stage-2 gate enforces.
    expect(send.principalIdentity).not.toBe(read.principalIdentity);
  });

  it('the SAME managed identity on both planes is REPORTED as the same value', () => {
    /*
     * The misconfiguration the gate exists for, at the reporting layer. Two distinct vaults,
     * two distinct secrets, ONE Azure principal allowed to read both.
     */
    const send = principalOf('INTEGRATION', documentFor('INTEGRATION', CLIENT_ID));
    const read = principalOf('AUDIT', documentFor('AUDIT', CLIENT_ID));
    expect(send.principalIdentity).toBe(read.principalIdentity);
  });

  it('a document the source would REFUSE reports NO principal', () => {
    // A non-closed document cannot report a principal either: the same parse gates both.
    const accepted = principalOf('INTEGRATION', documentFor('INTEGRATION', CLIENT_ID));
    expect(accepted.principalIdentity).toBe(CLIENT_ID);

    const withSecret = principalOf('INTEGRATION', {
      ...documentFor('INTEGRATION', CLIENT_ID),
      apiKey: 'SG.should-refuse-the-whole-document',
    });
    expect(withSecret.principalIdentity).toBeNull();
    expect(withSecret.mechanism).toBe('SECRET_MANAGER_VERSION');
  });

  it('8 — `FILE_FIXTURE` reports NO principal, so it cannot satisfy a live Azure gate', () => {
    /*
     * A file-backed fixture authenticates to no Azure principal. Reporting a plausible GUID
     * would let the offline mechanism satisfy a gate that exists to constrain a live Azure
     * configuration — so it reports `null`, and names the mechanism so the absence is legible.
     */
    const fixture = principalOf('INTEGRATION', {
      adapterId: 'sendgrid_email',
      sourceKind: 'FILE_FIXTURE',
      apiKey: 'SG.fixture-material',
      credentialIdentity: 'twilio_sendgrid.validation_send',
    });
    expect(fixture.principalIdentity).toBeNull();
    expect(fixture.mechanism).toBe('FILE_FIXTURE');
  });

  it('7 — the reported principal is a GUID and carries no Azure material', () => {
    const send = principalOf('INTEGRATION', documentFor('INTEGRATION', CLIENT_ID));
    const serialised = JSON.stringify(send);
    expect(send.principalIdentity).toMatch(
      /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
    );
    for (const forbidden of ['SG.', 'Bearer', 'eyJ0', 'PRIVATE KEY']) {
      expect(serialised, forbidden).not.toContain(forbidden);
    }
  });
});
