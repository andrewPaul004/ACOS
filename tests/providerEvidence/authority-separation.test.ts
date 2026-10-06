import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startProviderEvidenceIngress } from '../../src/audit/providerEvidence/ingressMain.js';
import { activeManifestId } from '../../src/kernel/controlArtifacts/registry.js';
import {
  INGRESS_RUNTIME_NAME,
  computeAllClosures,
  computeClosure,
  evaluateIngressSeparation,
} from '../../tools/integration-packaging/packagingManifest.js';
import { scanPerimeter } from '../../tools/perimeter/perimeterScan.js';
import { createAuditHarness, type AuditHarness } from '../support/auditHarness.js';
import { createHarness, type Harness } from '../support/fixture.js';
import {
  bodyOf,
  correlationTag,
  ingressEnvironment,
  processedEvent,
  providerEvidenceArtifactFixture,
  signWebhook,
  testIngressStore,
} from '../support/providerEvidenceFixture.js';

/**
 * ADR-027 decision 7 — "**provider evidence supplies observations; provider callbacks do not supply
 * authority**" — and `48 §8`'s "What the receiver MUST NOT hold", checked three ways:
 *
 *   1  the receiver's computed import closure (`tools/integration-packaging/`);
 *   2  the perimeter scan's ingress enumeration (`tools/perimeter/`), including regressions that
 *      prove each gate FAILS when the forbidden thing is introduced;
 *   3  a valid signed callback, delivered for real, changes NO control-plane state.
 */

describe('`48 §8` G10 — the receiver’s dependency closure holds no send, credential or authority path', () => {
  it('the real closure satisfies every ingress obligation', async () => {
    const closures = await computeAllClosures();
    const ingress = closures.find((closure) => closure.name === INGRESS_RUNTIME_NAME);
    expect(ingress).toBeDefined();
    const findings = evaluateIngressSeparation(ingress);
    expect(findings.filter((finding) => !finding.satisfied)).toEqual([]);
    expect(findings.length).toBeGreaterThanOrEqual(7);
    // NOTHING in the closure can create an authorisation, enqueue, claim, invoke an adapter,
    // dispatch, re-dispatch, release money, modify policy, alter a control artifact or choose a
    // recipient — none of those modules is reachable.
    for (const forbidden of [
      'src/kernel/gateway/effectGateway.ts',
      'src/kernel/outbox/enqueue.ts',
      'src/kernel/authorisation/localAuthorisation.ts',
      'src/kernel/exposure/ledger.ts',
      'src/kernel/policy/policyEngine.ts',
      'src/kernel/controlArtifacts/registry.ts',
      'src/integration/control/integrationClient.ts',
      'src/audit/provider/plane/auditReadClient.ts',
      'validation/sendgrid/integration/providerClient.ts',
      'validation/sendgrid/integration/secretSource.ts',
    ]) {
      expect(ingress!.modules, forbidden).not.toContain(forbidden);
    }
    expect(ingress!.packages).toEqual(['pg']);
  });

  describe('REGRESSION — an accidental import FAILS the gate', () => {
    function treeWith(importLine: string, extraFiles: Record<string, string> = {}): string {
      const root = mkdtempSync(join(tmpdir(), 'acos-ingress-closure-'));
      const files: Record<string, string> = {
        'src/audit/providerEvidence/ingressMain.ts': `${importLine}\nimport './receiver.js';\n`,
        'src/audit/providerEvidence/receiver.ts': "import './sendgridEventWebhookV1.js';\n",
        'src/audit/providerEvidence/sendgridEventWebhookV1.ts': "import 'node:crypto';\n",
        'src/audit/controlArtifacts/auditPlaneVerifier.ts': '\n',
        ...extraFiles,
      };
      for (const [path, content] of Object.entries(files)) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), content);
      }
      return root;
    }

    async function failingObligations(root: string): Promise<string[]> {
      const closure = await computeClosure(
        { name: INGRESS_RUNTIME_NAME, entryPoints: ['src/audit/providerEvidence/ingressMain.ts'] },
        root,
      );
      return evaluateIngressSeparation(closure)
        .filter((finding) => !finding.satisfied)
        .map((finding) => finding.obligation);
    }

    it('the clean synthetic tree passes', async () => {
      expect(
        await failingObligations(treeWith("import '../controlArtifacts/auditPlaneVerifier.js';")),
      ).toEqual([]);
    });

    it('a SendGrid SEND CLIENT import fails G10', async () => {
      const failing = await failingObligations(
        treeWith(
          "import '../controlArtifacts/auditPlaneVerifier.js';\nimport { sendToProviderSendGrid } from '../../../validation/sendgrid/integration/providerClient.js';",
          { 'validation/sendgrid/integration/providerClient.ts': 'export const sendToProviderSendGrid = 1;\n' },
        ),
      );
      expect(failing.some((obligation) => obligation.includes('G10'))).toBe(true);
    });

    it('an INTEGRATION CREDENTIAL SOURCE import fails', async () => {
      const failing = await failingObligations(
        treeWith(
          "import '../controlArtifacts/auditPlaneVerifier.js';\nimport '../../integration/runtime/adapterSecretSource.js';",
          { 'src/integration/runtime/adapterSecretSource.ts': '\n' },
        ),
      );
      expect(failing.some((obligation) => obligation.includes('credential source'))).toBe(true);
    });

    it('the EFFECT GATEWAY / enqueue path fails', async () => {
      const failing = await failingObligations(
        treeWith(
          "import '../controlArtifacts/auditPlaneVerifier.js';\nimport '../../kernel/gateway/effectGateway.js';",
          { 'src/kernel/gateway/effectGateway.ts': '\n' },
        ),
      );
      expect(failing.some((obligation) => obligation.includes('NO kernel module'))).toBe(true);
    });

    it('the Azure SDK fails, and so does a test key module', async () => {
      // The synthetic tree's import is ASSEMBLED, so this test file itself carries no
      // `from '@azure/...'` line: `key-vault-binding.test.ts` asserts no test constructs an Azure
      // client, and this text is written to a scratch file that is only scanned, never loaded.
      const azureSpecifier = ['@azure', 'identity'].join('/');
      const azure = await failingObligations(
        treeWith(
          `import '../controlArtifacts/auditPlaneVerifier.js';\nimport { ManagedIdentityCredential } from '${azureSpecifier}';`,
        ),
      );
      expect(azure.some((obligation) => obligation.includes('no package but `pg`'))).toBe(true);
      const testKey = await failingObligations(
        treeWith(
          "import '../controlArtifacts/auditPlaneVerifier.js';\nimport '../../../tests/support/providerEvidenceFixture.js';",
          { 'tests/support/providerEvidenceFixture.ts': '\n' },
        ),
      );
      expect(testKey.some((obligation) => obligation.includes('no test key'))).toBe(true);
    });
  });
});

describe('`48 §8` — the perimeter enumerates ONE ingress and refuses every way of widening it', () => {
  const LISTENER = [
    '// PERIMETER_INGRESS(provider_evidence, class_28)',
    "import { createServer, type IncomingMessage } from 'node:http';",
    'export function start(handle: (m: IncomingMessage) => void): void {',
    '  createServer((m) => handle(m)).listen(0);',
    '}',
    '',
  ].join('\n');

  function tree(files: Record<string, string>): string {
    const root = mkdtempSync(join(tmpdir(), 'acos-ingress-perimeter-'));
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), content);
    }
    return root;
  }

  it('the real repository: exactly one ingress listener, declared, no violations', async () => {
    const report = await scanPerimeter();
    expect(report.ingressTotal).toBe(1);
    expect(report.ingressViolations).toEqual([]);
    const ingress = report.sites.filter((site) => site.annotation.kind === 'INGRESS');
    expect(ingress.map((site) => site.kind).sort()).toEqual(['INGRESS_LISTENER', 'NETWORK_PRIMITIVE']);
    for (const site of ingress) expect(site.file.replace(/\\/g, '/')).toBe('src/audit/providerEvidence/ingressMain.ts');
  });

  it('a declared listener passes', async () => {
    const report = await scanPerimeter(tree({ 'src/ingress.ts': LISTENER }), ['src']);
    expect(report.pass).toBe(true);
    expect(report.ingressTotal).toBe(1);
  });

  it('an OUTBOUND fetch in the ingress module is NOT covered by the ingress declaration', async () => {
    const report = await scanPerimeter(
      tree({ 'src/ingress.ts': `${LISTENER}export const leak = (): unknown => fetch('https://api.sendgrid.com/v3/mail/send');\n` }),
      ['src'],
    );
    expect(report.pass).toBe(false);
    expect(report.productionUnannotated).toBeGreaterThan(0);
  });

  it('importing the OUTBOUND half of node:http is not an ingress', async () => {
    const report = await scanPerimeter(
      tree({ 'src/ingress.ts': LISTENER.replace('createServer, type', 'createServer, request, type') }),
      ['src'],
    );
    expect(report.pass).toBe(false);
  });

  it('a SECOND listener (arbitrary callback routing) is a G1 violation', async () => {
    const report = await scanPerimeter(
      tree({ 'src/ingress.ts': `${LISTENER}export const second = createServer(() => undefined);\n` }),
      ['src'],
    );
    expect(report.pass).toBe(false);
    expect(report.ingressViolations.join(' ')).toContain('G1');
  });

  it('a second module declaring the same channel, and an undeclared channel, are violations', async () => {
    const twice = await scanPerimeter(
      tree({ 'src/ingress.ts': LISTENER, 'src/other.ts': LISTENER }),
      ['src'],
    );
    expect(twice.pass).toBe(false);
    expect(twice.ingressViolations.join(' ')).toContain('enumerates ONE');
    const undeclared = await scanPerimeter(
      tree({ 'src/ingress.ts': LISTENER.replace('provider_evidence', 'any_webhook') }),
      ['src'],
    );
    expect(undeclared.pass).toBe(false);
  });

  it('a listener with NO declaration — or with an OUTBOUND annotation reused — is unannotated', async () => {
    const bare = await scanPerimeter(
      tree({ 'src/ingress.ts': LISTENER.replace('// PERIMETER_INGRESS(provider_evidence, class_28)', '') }),
      ['src'],
    );
    expect(bare.pass).toBe(false);
    const reused = await scanPerimeter(
      tree({
        'src/ingress.ts': LISTENER.replace(
          '// PERIMETER_INGRESS(provider_evidence, class_28)',
          '// PERIMETER_AUTHORISED(authorisation_ref)',
        ),
      }),
      ['src'],
    );
    expect(reused.sites.find((site) => site.kind === 'INGRESS_LISTENER')?.annotation.kind).toBe('NONE');
    expect(reused.pass).toBe(false);
  });
});

describe('ADR-027 decision 7 — a VALID signed callback changes no control-plane state', () => {
  let control: Harness;
  let audit: AuditHarness;

  beforeAll(async () => {
    control = await createHarness();
    await control.reset();
    audit = await createAuditHarness();
    await audit.reset();
  });

  afterAll(async () => {
    await control.close();
    await audit.close();
  });

  const CONTROL_TABLES = [
    'authorisation',
    'effect',
    'dispatch_outbox',
    'effect_dispatch_outcome',
    'exposure_reservation',
    'authority_grant',
    'approval',
    'effect_journal',
    'commerce_order',
  ];

  async function controlSnapshot(): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const table of CONTROL_TABLES) {
      const result = await control.pool.query<{ n: string }>(`SELECT COUNT(*)::TEXT AS n FROM ${table}`);
      out[table] = result.rows[0]!.n;
    }
    return out;
  }

  function packageDigest(root: string): string {
    const hash = createHash('sha256');
    for (const file of readdirSync(root).sort()) hash.update(file).update(readFileSync(join(root, file)));
    return hash.digest('hex');
  }

  it('no authorisation, enqueue, claim, dispatch, reservation, grant, approval, journal or recipient change; no artifact or pin change', async () => {
    const fixture = providerEvidenceArtifactFixture();
    const before = await controlSnapshot();
    const manifestBefore = activeManifestId();
    const packageBefore = packageDigest(fixture.auditRoot);

    const started = await startProviderEvidenceIngress({
      environment: ingressEnvironment(fixture),
      log: () => undefined,
      ...testIngressStore(),
    });
    if (!started.ready) throw new Error(started.refusal);
    try {
      const tag = correlationTag();
      for (const events of [
        [processedEvent(tag, { sg_message_id: 'one' })],
        [processedEvent(tag, { sg_message_id: 'two' })],
      ]) {
        const body = bodyOf(events);
        const signature = signWebhook('1760001000', body);
        // `fetch` cannot set `Host` (a forbidden header), and the receiver rightly refuses a
        // request whose Host is not the signed ingress — so a raw client is used.
        const status = await new Promise<number>((resolveStatus, rejectStatus) => {
          const request = httpRequest(
            {
              host: '127.0.0.1',
              port: started.port,
              method: 'POST',
              path: '/provider-evidence/sendgrid',
              setHost: false,
              headers: {
                Host: 'webhook.example.test',
                'Content-Type': 'application/json',
                'Content-Length': String(body.length),
                'X-Twilio-Email-Event-Webhook-Signature': signature,
                'X-Twilio-Email-Event-Webhook-Timestamp': '1760001000',
              },
            },
            (response) => {
              response.resume();
              resolveStatus(response.statusCode ?? 0);
            },
          );
          request.on('error', rejectStatus);
          request.end(body);
        });
        expect(status).toBe(204);
      }
    } finally {
      await started.close();
    }

    // EVEN A DUPLICATE-SEND FINDING (two message ids) PRODUCES NO EFFECT ANYWHERE.
    expect(await controlSnapshot()).toEqual(before);
    expect(activeManifestId()).toBe(manifestBefore);
    expect(packageDigest(fixture.auditRoot)).toBe(packageBefore);
  });
});
