import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  AdapterRuntimeRegistryError,
  classesServedBy,
  createAdapterRuntimeRegistry,
} from '../../src/integration/control/adapterRuntimeRegistry.js';
import { createAuditReaderRegistry } from '../../src/audit/provider/plane/auditReaderRegistry.js';
import { activeVerifiedControlArtifacts } from '../../src/kernel/controlArtifacts/registry.js';
import { verifiedCredentialScopes } from '../../src/kernel/controlArtifacts/bundle.js';
import { computeClosure } from '../../tools/integration-packaging/packagingManifest.js';
import { SENDGRID_ADAPTER_ID } from '../../validation/sendgrid/harness/preflight.js';
import { SENDGRID_PROVIDER_ID } from '../../validation/sendgrid/harness/preflight.js';
import { withoutProviderEvidenceSurface } from '../support/providerEvidenceSurface.js';

/**
 * `§8`, `§14`, `§19` — THE PREREQUISITES THAT ARE NOT REPOSITORY WORK, AND THE PLANE
 * SEPARATION THAT IS.
 *
 * =================================================================================
 * WHY THE FIRST BLOCK ASSERTS FAILURES
 *
 * `§14`: "do not create fake real credential IDs before credentials exist [...] do not
 * forge owner signatures [...] do not perform the production owner ceremony." S1P therefore
 * adds NO record to `artifacts/control/class-03.action-catalogue.json` and NO record to
 * `artifacts/control/class-05.credential-scopes.json`.
 *
 * The consequence is that a SendGrid runtime cannot be registered, and these cases assert
 * THAT — against the repository's real deployed bytes, through the ACCEPTED registries, by
 * their declared refusal codes. `§14`: "identify it as an operator/owner prerequisite and
 * leave the live run PARTIAL."
 *
 * **A REVIEWER SHOULD READ THIS BLOCK AS THE MECHANISED FORM OF THAT SENTENCE.** The
 * prerequisite is not a paragraph in a document; it is a refusal that fires.
 * =================================================================================
 */

const INTEGRATION_ROOT = join('validation', 'sendgrid', 'integration');
const AUDIT_ROOT = join('validation', 'sendgrid', 'audit');
const HARNESS_ROOT = join('validation', 'sendgrid', 'harness');

function filesUnder(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) filesUnder(path, out);
    else if (entry.name.endsWith('.ts')) out.push(path);
  }
  return out;
}

const SRC_FILES = filesUnder('src');

describe('`§14` — THE CLASS-3 RECORD NOW EXISTS; THE CLASS-5 RECORDS STILL DO NOT', () => {
  /*
   * ===================================================================================
   * TWO ACCEPTED ASSERTIONS IN THIS BLOCK CHANGED, AND `45 §3` REQUIRES THEM CHANGED OUT LOUD.
   *
   * BEFORE the S1P independent-review corrections this file asserted that the verified class-3
   * catalogue named NO SendGrid adapter, and that registering a SendGrid runtime was refused
   * as `ADAPTER_NOT_IN_CATALOGUE`. Both were true of a slice that disguised its validation
   * send as another class.
   *
   * `§1` of the correction mandate ruled that disguise out: the validation send is
   * `email.send`, it is IRRECOVERABLE, and it routes to `sendgrid_email`. So the signed class-3
   * catalogue NOW names the adapter, and the two assertions are restated as what remains true
   * — which is a STRICTLY NARROWER and therefore stronger statement of the same prerequisite:
   *
   *   the class-3 record exists  ->  so the catalogue gate no longer fires;
   *   the class-5 records do NOT ->  so the CREDENTIAL gate fires instead, on BOTH planes.
   *
   * The thing the block exists to say is unchanged: **a real SendGrid runtime cannot be
   * registered in this repository, and the refusal is a mechanised one rather than a promise.**
   * What changed is WHICH mechanised refusal fires, and that change is the visible consequence
   * of adding an honest action class without adding a credential.
   * ===================================================================================
   */
  it('the VERIFIED class-3 catalogue NOW names the SendGrid adapter, and only for `email.send`', () => {
    const bundle = activeVerifiedControlArtifacts();
    expect(classesServedBy(SENDGRID_ADAPTER_ID, bundle)).toEqual(['email.send']);
  });

  it('registering a SendGrid runtime is REFUSED — now as CREDENTIAL_NOT_DECLARED', () => {
    const bundle = activeVerifiedControlArtifacts();
    let refusal: string | null = null;
    try {
      createAdapterRuntimeRegistry(
        [
          {
            adapterId: SENDGRID_ADAPTER_ID,
            credentialId: 'twilio_sendgrid.mail_send',
            runtimeRoot: INTEGRATION_ROOT,
            adapterModule: `${INTEGRATION_ROOT}/adapter.js`,
            secretSourceModule: `${INTEGRATION_ROOT}/secretSource.js`,
            secretLocator: '/deployment/integration.json',
            resolutionCapabilities: ['IDEMPOTENCY_HEADER'],
          },
        ],
        bundle,
      );
    } catch (error) {
      if (error instanceof AdapterRuntimeRegistryError) refusal = error.refusal;
    }
    /*
     * `50 §2g`: "a configured credential with no verified class-5 record [...] **FAILS
     * CLOSED**." No real SendGrid credential identity is signed anywhere, so the registry
     * refuses on the credential rather than on the catalogue — which is the remaining
     * prerequisite, named.
     */
    expect(refusal).toBe('CREDENTIAL_NOT_DECLARED');
  });

  it('the VERIFIED class-5 declaration carries no SendGrid credential of either kind', () => {
    const declaration = verifiedCredentialScopes(activeVerifiedControlArtifacts());
    for (const [credentialId, scope] of Object.entries(declaration.credentials)) {
      expect(scope.provider, credentialId).not.toBe(SENDGRID_PROVIDER_ID);
      expect(scope.adapter, credentialId).not.toBe(SENDGRID_ADAPTER_ID);
    }
  });

  it('an audit reader for SendGrid is REFUSED as CREDENTIAL_NOT_DECLARED', () => {
    const declaration = verifiedCredentialScopes(activeVerifiedControlArtifacts());
    const auditCredentials = Object.fromEntries(
      Object.entries(declaration.credentials).filter(([, scope]) => scope.adapter === 'audit_plane'),
    );
    expect(() =>
      createAuditReaderRegistry(
        [
          {
            providerId: SENDGRID_PROVIDER_ID,
            credentialId: 'twilio_sendgrid.audit_read',
            runtimeRoot: AUDIT_ROOT,
            readerModule: `${AUDIT_ROOT}/reader.js`,
            secretSourceModule: `${AUDIT_ROOT}/secretSource.js`,
            secretLocator: '/deployment/audit.json',
          },
        ],
        auditCredentials,
        new Set<string>(),
      ),
    ).toThrow(/CREDENTIAL_NOT_DECLARED/);
  });

  it('`§19` — PRODUCTION S ADAPTER REGISTRY IS STILL EMPTY, AND src/ NAMES NO VENDOR', () => {
    /*
     * The two ACCEPTED source-boundary properties S1P must not have weakened. They are
     * re-asserted here, over `validation/`'s vendor name rather than S1M's, so a reviewer
     * reading THIS slice's tests sees the answer to `48 §7` question 4 without leaving it.
     */
    // v1.3.8 — the declared provider-evidence surface's exact tokens are removed first, and only
    // from its declared files (`tests/support/providerEvidenceSurface.ts`). Any other vendor
    // mention anywhere in `src/` is still an offender.
    const offenders = SRC_FILES.filter((path) =>
      /sendgrid/i.test(withoutProviderEvidenceSurface(path, readFileSync(path, 'utf8'))),
    );
    expect(offenders, `a vendor surface in src/:\n  ${offenders.join('\n  ')}`).toEqual([]);

    for (const path of SRC_FILES) {
      const source = readFileSync(path, 'utf8');
      for (const match of source.matchAll(/\bfrom '([^'\n]+)';/g)) {
        expect(match[1], `${path} imports ${match[1] ?? ''}`).not.toMatch(/validation\//);
      }
    }
  });
});

describe('`§8.2`, `§14` — THE TWO PLANES SHARE NO MODULE', () => {
  it('the SendGrid integration closure holds no audit module, and vice versa', async () => {
    const integration = await computeClosure({
      name: 'INTEGRATION_ADAPTER:sendgrid_email',
      entryPoints: [
        'src/integration/runtime/main.ts',
        `${INTEGRATION_ROOT.split('\\').join('/')}/adapter.ts`,
        `${INTEGRATION_ROOT.split('\\').join('/')}/secretSource.ts`,
      ],
    });
    const audit = await computeClosure({
      name: 'AUDIT_READER:twilio_sendgrid',
      entryPoints: [
        'src/audit/provider/runtime/main.ts',
        `${AUDIT_ROOT.split('\\').join('/')}/reader.ts`,
        `${AUDIT_ROOT.split('\\').join('/')}/secretSource.ts`,
      ],
    });

    // Non-vacuous: each closure really reached its own package.
    expect(integration.modules).toContain('validation/sendgrid/integration/adapter.ts');
    expect(integration.modules).toContain('validation/sendgrid/integration/providerClient.ts');
    expect(audit.modules).toContain('validation/sendgrid/audit/reader.ts');
    expect(audit.modules).toContain('validation/sendgrid/audit/providerReadClient.ts');

    // `§13` of S1O: the audit plane holds no send credential and no send client.
    expect(
      audit.modules.filter((module) => module.startsWith('validation/sendgrid/integration/')),
    ).toEqual([]);
    expect(
      integration.modules.filter((module) => module.startsWith('validation/sendgrid/audit/')),
    ).toEqual([]);

    // `§8.2`: the attempted-write probe is NOT a capability of the audit runtime.
    expect(
      audit.modules.filter((module) => module.startsWith('validation/sendgrid/harness/')),
    ).toEqual([]);

    // `§12` of S1N: neither runtime reaches a database module.
    for (const closure of [integration, audit]) {
      expect(
        closure.modules.filter((module) => module.startsWith('src/db/')),
        closure.name,
      ).toEqual([]);
    }
  });

  it('`I25` — the CONTROL closure reaches no module of the validation package', async () => {
    const control = await computeClosure({
      name: 'CONTROL_PLANE',
      entryPoints: [
        'src/kernel/gateway/effectGateway.ts',
        'src/integration/control/integrationClient.ts',
        'src/integration/control/adapterRuntimeRegistry.ts',
      ],
    });
    expect(control.modules).toContain('src/kernel/gateway/effectGateway.ts');
    expect(control.modules.filter((module) => module.startsWith('validation/'))).toEqual([]);
  });
});

describe('`§8.5` — THE LIVE HARNESS IS NOT REACHED BY ANY TEST', () => {
  const TEST_FILES = filesUnder('tests');

  it('no test file INVOKES a function that would reach a provider', () => {
    /*
     * The property that matters is non-INVOCATION rather than non-import: the offline suite
     * legitimately imports the pure parts of these modules — the classifier, the mapping, the
     * preflight — and importing them runs nothing. What must be absent is a CALL.
     */
    const forbidden = [
      'sendToProviderSendGrid(',
      'readFromProviderSendGridActivity(',
      'readFromProviderSendGridMessage(',
      'sendToProviderSendGridScopeProbe(',
      // `§11`'s deliberate duplicate pair. The ONE function in the repository whose job is to
      // send a message ACOS did not authorise, so its absence from `tests/` matters most.
      'sendToProviderSendGridDuplicateProbe(',
      'probeActivityReadCapability(',
      'auditProviderReader.readFromProvider(',
    ];
    const offenders: string[] = [];
    for (const path of TEST_FILES) {
      // THIS FILE IS EXCLUDED BECAUSE IT DECLARES THE LIST, and a scanner that matched its
      // own pattern table would report six findings forever and none of them would be a
      // call. The exclusion is by exact path so no other file inherits it.
      if (path === join('tests', 'sendgrid', 'prerequisites-and-separation.test.ts')) continue;
      const source = readFileSync(path, 'utf8');
      for (const call of forbidden) {
        if (source.includes(call)) offenders.push(`${path} calls ${call}`);
      }
    }
    expect(offenders).toEqual([]);

    /*
     * NON-VACUOUS: the patterns DO match where the calls genuinely are. Without this, a
     * typo in one of the six strings would make the scan pass by finding nothing anywhere.
     */
    expect(
      readFileSync(join('validation', 'sendgrid', 'integration', 'adapter.ts'), 'utf8'),
    ).toContain('sendToProviderSendGrid(');
    expect(
      readFileSync(join('validation', 'sendgrid', 'audit', 'reader.ts'), 'utf8'),
    ).toContain('readFromProviderSendGridActivity(');
  });

  it('nothing under `tests/` imports the harness entry point', () => {
    for (const path of TEST_FILES) {
      const source = readFileSync(path, 'utf8');
      expect(source, `${path} imports run.js`).not.toMatch(/harness\/run\.js/);
    }
  });

  it('`cli.ts` has NO module-evaluation side effect — the entry point is a separate file', () => {
    const cli = readFileSync(join(HARNESS_ROOT, 'cli.ts'), 'utf8');
    expect(cli).not.toMatch(/^\s*void main\(/m);
    const run = readFileSync(join(HARNESS_ROOT, 'run.ts'), 'utf8');
    expect(run).toMatch(/void main\(/);
  });

  it('vitest collects no file under `validation/`', () => {
    const configuration = readFileSync('vitest.config.ts', 'utf8');
    expect(configuration).toContain("include: ['tests/**/*.test.ts', 'spikes/**/*.test.ts']");
    expect(configuration).not.toMatch(/validation/);
    // And no file in the package is named like a test, so a future include widening would
    // still collect nothing here.
    for (const path of [
      ...filesUnder(INTEGRATION_ROOT),
      ...filesUnder(AUDIT_ROOT),
      ...filesUnder(HARNESS_ROOT),
    ]) {
      expect(path, `${path} is shaped like a test file`).not.toMatch(/\.test\.ts$/);
    }
  });
});
