import { readFileSync, readdirSync } from 'node:fs';
import { createServer, request as httpRequest, type IncomingMessage, type Server } from 'node:http';
import { join, relative, sep } from 'node:path';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  CONTAINER_APP_TARGET,
  INGRESS_ENVIRONMENT_CONTRACT,
  bindingProbePlan,
  evaluateBindingProbes,
  loadTemplate,
  operatorSequenceProblems,
  operatorSteps,
  renderBindingProbeCommands,
  renderContainerApp,
  reservedIngressIdentity,
  validateContainerAppDefinition,
  type BindingProbe,
  type ContainerAppParams,
  type OperatorStep,
} from '../../tools/deploy/containerApp.js';
import { auditEvaluatorDeploymentUrl, auditEvaluatorUrl, auditEvidenceIngressUrl } from '../../src/audit/db/auditPool.js';
import { validateRoleScopedUrl } from '../../src/audit/db/roleScopedUrl.js';
import { EVIDENCE_INGRESS_ROLE, evidenceIngressUrl } from '../../src/audit/providerEvidence/evidenceIngressPool.js';
import {
  startProviderEvidenceIngress,
  type StartedProviderEvidenceIngress,
} from '../../src/audit/providerEvidence/ingressMain.js';
import { INGRESS_ENVIRONMENT } from '../../src/audit/providerEvidence/ingressMain.js';
import { AUDIT_PLANE_TRUST_VARIABLES } from '../../src/audit/controlArtifacts/auditPlaneVerifier.js';
import { auditSql, createAuditHarness, type AuditHarness } from '../support/auditHarness.js';
import {
  TEST_INGRESS_IDENTITY,
  bodyOf,
  correlationTag,
  ingressEnvironment,
  processedEvent,
  providerEvidenceArtifactFixture,
  signWebhook,
  testIngressStore,
} from '../support/providerEvidenceFixture.js';

/**
 * S1P-WD — THE AZURE CONTAINER APPS DEFINITION, AND THE PUBLIC-BINDING VERIFICATION.
 *
 * Nothing here contacts Azure, SendGrid or any network beyond 127.0.0.1. The template is
 * asserted against the ingress runtime's real environment contract; the renderer's refusals are
 * driven; and the binding probes the owner will run against the real FQDN are executed against
 * a local proxy that behaves like the Container Apps front end in the respects that matter
 * (it terminates the client connection, forwards the original Host, adds `X-Forwarded-*` and a
 * request id, and re-chunks the body) — and against a proxy that REWRITES Host, which the probes
 * must catch.
 */

const RESERVED =
  'https://ca-acos-s1p-webhook.thankfulbay-82c0739d.centralus.azurecontainerapps.io/provider-evidence/sendgrid';

const PARAMS: ContainerAppParams = Object.freeze({
  subscriptionId: '11111111-2222-3333-4444-555555555555',
  environmentDefaultDomain: 'thankfulbay-82c0739d.centralus.azurecontainerapps.io',
  registryLoginServer: 'acracoss1p.azurecr.io',
  imageTag: 'fd0f65849485036d01f3572218233b59ace35c62',
  webhookIdentityResourceId:
    '/subscriptions/11111111-2222-3333-4444-555555555555/resourceGroups/rg-acos-s1p-nonprod/providers/Microsoft.ManagedIdentity/userAssignedIdentities/id-acos-s1p-webhook',
  auditPgUrlSecretUri: 'https://kv-acos-s1p-audit.vault.azure.net/secrets/acos-audit-evidence-ingress-pg-url',
  environmentStorageName: 'acos-audit-control-artifacts',
  ownerRootPublicKeyHex: 'a'.repeat(64),
  ownerSecondFactorPublicKeyHex: 'b'.repeat(64),
  expectedActiveManifestId: 'c'.repeat(64),
});

function filesUnder(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(relative(root, full).split(sep).join('/'));
    }
  };
  walk(root);
  return out;
}

describe('the Container App template matches the ingress runtime contract', () => {
  const template = loadTemplate();

  it('the reserved ingress identity is derived from the app name and environment domain, and is canonical', () => {
    expect(reservedIngressIdentity(PARAMS.environmentDefaultDomain)).toBe(RESERVED);
    expect(validateContainerAppDefinition(template, RESERVED)).toEqual([]);
  });

  it('exactly ONE external target port, HTTPS only, HTTP/1.1 to the container, no second route', () => {
    const ingress = (template as { properties: { configuration: { ingress: Record<string, unknown> } } }).properties
      .configuration.ingress;
    expect(ingress).toMatchObject({ external: true, targetPort: 8080, transport: 'http', allowInsecure: false });
    expect(ingress.additionalPortMappings).toBeUndefined();
    expect(ingress.customDomains).toBeUndefined();
    const text = JSON.stringify(template);
    expect(text).not.toMatch(/"httpGet"|\/health|\/ready|\/live/);
  });

  it('the environment is EXACTLY the variables the ingress code reads, and nothing else', () => {
    const names = INGRESS_ENVIRONMENT_CONTRACT.map((entry) => entry.name).sort();
    const fromCode = [
      ...Object.values(INGRESS_ENVIRONMENT),
      ...Object.values(AUDIT_PLANE_TRUST_VARIABLES),
      'ACOS_AUDIT_PG_URL',
    ].sort();
    expect(names).toEqual(fromCode);
    const env = (template as { properties: { template: { containers: { env: { name: string }[] }[] } } }).properties
      .template.containers[0]!.env.map((entry) => entry.name)
      .sort();
    expect(env).toEqual(fromCode);
  });

  it('no SendGrid credential, locator, send vault, integration identity or control-plane variable', () => {
    const text = JSON.stringify(template);
    expect(text).not.toMatch(/SENDGRID_API|SG\.|LOCATOR|INTEGRATION|ACOS_S1P_|ACOS_CONTROL|DECISION|mail\.send|AZURE_CLIENT/);
    expect(text).not.toMatch(/send-?vault|kv-[a-z-]*send/i);
  });

  it('the database URL is a SECRET REFERENCE to Key Vault, never a value', () => {
    const app = template as {
      properties: {
        configuration: { secrets: { name: string; value?: string; keyVaultUrl?: string }[] };
        template: { containers: { env: { name: string; value?: string; secretRef?: string }[] }[] };
      };
    };
    expect(app.properties.configuration.secrets).toEqual([
      { name: 'audit-pg-url', keyVaultUrl: '<AUDIT_PG_URL_SECRET_URI>', identity: '<WEBHOOK_IDENTITY_RESOURCE_ID>' },
    ]);
    const db = app.properties.template.containers[0]!.env.find((entry) => entry.name === 'ACOS_AUDIT_PG_URL')!;
    expect(db).toEqual({ name: 'ACOS_AUDIT_PG_URL', secretRef: 'audit-pg-url' });
    expect(JSON.stringify(app)).not.toMatch(/postgres(ql)?:\/\//);
  });

  it('control artifacts are a READ-ONLY Azure Files mount at the verifier root, not image content or env', () => {
    const app = template as {
      properties: {
        template: {
          containers: { volumeMounts: { volumeName: string; mountPath: string }[]; env: { name: string; value?: string }[] }[];
          volumes: { name: string; storageType: string; mountOptions?: string }[];
        };
      };
    };
    const container = app.properties.template.containers[0]!;
    expect(container.volumeMounts).toEqual([{ volumeName: 'audit-control-artifacts', mountPath: '/etc/acos/control-artifacts' }]);
    expect(app.properties.template.volumes[0]).toMatchObject({ storageType: 'AzureFile', mountOptions: 'dir_mode=0555,file_mode=0444' });
    // No artifact BYTES or class-28 JSON travel in the environment — only the root keys and pin.
    for (const entry of container.env) {
      expect(entry.value ?? '').not.toMatch(/channels|verification_key|evidence_mode|BEGIN|MFkw/);
    }
  });

  it('the image is the immutable-tag placeholder; one container; no command override; bounded scale', () => {
    const container = (template as { properties: { template: { containers: Record<string, unknown>[]; scale: unknown } } })
      .properties.template;
    expect(container.containers).toHaveLength(1);
    expect(container.containers[0]!.image).toBe('<REGISTRY_LOGIN_SERVER>/acos-s1p-provider-evidence:<IMAGE_TAG>');
    expect(container.containers[0]!.command).toBeUndefined();
    expect(container.scale).toEqual({ minReplicas: 1, maxReplicas: 2 });
  });
});

describe('the renderer validates, refuses, and never executes', () => {
  it('renders the reviewed definition from non-secret parameters', () => {
    const outcome = renderContainerApp(PARAMS);
    expect(outcome.problems).toEqual([]);
    expect(outcome.ok).toBe(true);
    expect(JSON.stringify(outcome.rendered)).toContain(`acracoss1p.azurecr.io/acos-s1p-provider-evidence:${PARAMS.imageTag}`);
    expect(JSON.stringify(outcome.rendered)).not.toMatch(/<[A-Z0-9_]+>/);
  });

  for (const [label, override, pattern] of [
    ['the tag `latest`', { imageTag: 'latest' }, /imageTag/],
    ['a short commit sha', { imageTag: 'fd0f658' }, /imageTag/],
    ['an unfilled placeholder', { registryLoginServer: '<registry>.azurecr.io' }, /registryLoginServer/],
    ['identical owner root keys', { ownerSecondFactorPublicKeyHex: 'a'.repeat(64) }, /identical/],
    ['a SEND-side identity', { webhookIdentityResourceId: PARAMS.webhookIdentityResourceId.replace('id-acos-s1p-webhook', 'id-acos-s1p-send') }, /SEND/],
    ['a SEND-side vault', { auditPgUrlSecretUri: 'https://kv-acos-s1p-send.vault.azure.net/secrets/pg' }, /SEND/],
    ['a versioned (pinned) secret URI', { auditPgUrlSecretUri: `${PARAMS.auditPgUrlSecretUri}/0123456789abcdef` }, /secret URI/],
    ['a non-hex manifest pin', { expectedActiveManifestId: 'not-a-pin' }, /manifest/],
  ] as const) {
    it(`REFUSES ${label}`, () => {
      const outcome = renderContainerApp({ ...PARAMS, ...override });
      expect(outcome.ok).toBe(false);
      expect(outcome.problems.join('\n')).toMatch(pattern);
    });
  }

  it('a template that adds a port, a secret value, a health route or a forbidden variable is refused', () => {
    const base = renderContainerApp(PARAMS).rendered as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const mutate = (edit: (copy: any) => void): string[] => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const copy = JSON.parse(JSON.stringify(base)) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
      edit(copy);
      return validateContainerAppDefinition(copy, RESERVED);
    };
    expect(mutate((c) => { c.properties.configuration.ingress.additionalPortMappings = [{ targetPort: 9090 }]; })).not.toEqual([]);
    expect(mutate((c) => { c.properties.configuration.ingress.allowInsecure = true; })).not.toEqual([]);
    expect(mutate((c) => { c.properties.configuration.secrets[0].value = 'postgres://x'; })).not.toEqual([]);
    expect(mutate((c) => { c.properties.template.containers[0].env.push({ name: 'SENDGRID_API_KEY', secretRef: 'sg' }); })).not.toEqual([]);
    expect(mutate((c) => { c.properties.template.containers[0].env.push({ name: 'ACOS_S1P_INTEGRATION_LOCATOR', value: '/x' }); })).not.toEqual([]);
    expect(mutate((c) => { c.properties.template.containers[0].env[1].value = `${RESERVED}/`; })).not.toEqual([]);
    expect(mutate((c) => { c.properties.template.containers[0].command = ['node', 'other.js']; })).not.toEqual([]);
    expect(mutate((c) => { c.properties.template.containers.push({ name: 'sidecar', image: 'x' }); })).not.toEqual([]);
    expect(mutate((c) => { c.properties.template.containers[0].image = 'acracoss1p.azurecr.io/acos-s1p-provider-evidence:latest'; })).not.toEqual([]);
  });

  it('the deploy tools import no process, network or Azure API: they can only print', () => {
    for (const file of filesUnder(join('tools', 'deploy'))) {
      const source = readFileSync(join('tools', 'deploy', file), 'utf8');
      expect(source, file).not.toMatch(/from 'node:(child_process|http|https|net|tls|dgram)'|from '@azure\/|fetch\(|execSync|spawn\(/);
    }
  });

  it('the reserved ingress identity is DEPLOYMENT CONFIGURATION only — it is not authority anywhere', () => {
    // Not in production source, not in the signed control artifacts: the only authority for an
    // ingress identity is a SIGNED class-28 record, and none exists for it yet.
    for (const root of ['src', join('artifacts', 'control')]) {
      for (const file of filesUnder(root)) {
        expect(readFileSync(join(root, file), 'utf8'), `${root}/${file}`).not.toContain('thankfulbay-82c0739d');
      }
    }
    expect(readFileSync(join('deploy', 'provider-evidence-ingress', 'containerapp.template.json'), 'utf8')).toContain(RESERVED);
  });

  it('the binding probe commands are exactly the plan, against the reserved FQDN, with no redirect following', () => {
    const commands = renderBindingProbeCommands(RESERVED);
    expect(commands).toHaveLength(bindingProbePlan(RESERVED).length);
    for (const command of commands) expect(command).toContain('--max-redirs 0');
    expect(commands.join('\n')).toContain(`'http://ca-acos-s1p-webhook.thankfulbay-82c0739d.centralus.azurecontainerapps.io${CONTAINER_APP_TARGET.ingressPath}'`);
  });
});

describe('TWO role-specific database credentials; neither process ever holds the audit OWNER URL', () => {
  const DEPLOYED_INGRESS =
    'postgres://acos_audit_evidence_ingress:r0tated-S3cret@psql-acos-s1p-audit.postgres.database.azure.com:5432/acos_audit?sslmode=verify-full';
  const original = process.env['ACOS_AUDIT_PG_URL'];
  afterEach(() => {
    process.env['ACOS_AUDIT_PG_URL'] = original;
  });

  it('the image-safe ingress module uses the ingress ROLE URL verbatim, TLS parameters included', () => {
    expect(evidenceIngressUrl({ ACOS_AUDIT_PG_URL: DEPLOYED_INGRESS })).toEqual({ ok: true, url: DEPLOYED_INGRESS });
    expect(EVIDENCE_INGRESS_ROLE).toBe('acos_audit_evidence_ingress');
  });

  for (const [label, url, refusal] of [
    ['the audit OWNER', 'postgres://acos:pw@db:5432/acos_audit', 'AUDIT_STORE_ROLE_NOT_EVIDENCE_INGRESS'],
    ['the EVALUATOR', 'postgres://acos_audit_evaluator:pw@db:5432/acos_audit', 'AUDIT_STORE_ROLE_NOT_EVIDENCE_INGRESS'],
    ['the REPLICATION role', 'postgres://acos_audit_replication:pw@db:5432/acos_audit', 'AUDIT_STORE_ROLE_NOT_EVIDENCE_INGRESS'],
    ['a look-alike role', 'postgres://acos_audit_evidence_ingress2:pw@db:5432/acos_audit', 'AUDIT_STORE_ROLE_NOT_EVIDENCE_INGRESS'],
    ['no URL at all', undefined, 'AUDIT_STORE_URL_MISSING'],
    ['a non-postgres URL', 'https://acos_audit_evidence_ingress:pw@db/acos_audit', 'AUDIT_STORE_URL_MALFORMED'],
    ['an unparseable URL', 'not a url', 'AUDIT_STORE_URL_MALFORMED'],
  ] as const) {
    it(`the ingress module REFUSES ${label} — it never rewrites a URL`, () => {
      expect(evidenceIngressUrl({ ACOS_AUDIT_PG_URL: url })).toEqual({ ok: false, refusal });
    });
  }

  it('the ingress REFUSES STARTUP on an owner URL — no listener, no pool', async () => {
    const started = await startProviderEvidenceIngress({
      environment: ingressEnvironment(providerEvidenceArtifactFixture(), { ACOS_AUDIT_PG_URL: original }),
      log: () => undefined,
    });
    expect(started).toMatchObject({ ready: false, refusal: 'AUDIT_STORE_CREDENTIAL_INVALID', detail: 'AUDIT_STORE_ROLE_NOT_EVIDENCE_INGRESS' });
  });

  it('the EVALUATOR accepts its own role-specific URL verbatim, with no owner URL anywhere', () => {
    const evaluator =
      'postgres://acos_audit_evaluator:r0tated-Eval@psql-acos-s1p-audit.postgres.database.azure.com:5432/acos_audit?sslmode=verify-full';
    process.env['ACOS_AUDIT_PG_URL'] = evaluator;
    expect(auditEvaluatorUrl()).toBe(evaluator);
  });

  it('local development still derives both roles from the local OWNER URL (outside the image)', () => {
    process.env['ACOS_AUDIT_PG_URL'] = 'postgres://acos:acos_local_dev@127.0.0.1:55433/acos_audit';
    expect(new URL(auditEvidenceIngressUrl()).username).toBe('acos_audit_evidence_ingress');
    expect(new URL(auditEvaluatorUrl()).username).toBe('acos_audit_evaluator');
  });
});

describe('DATABASE TLS FAILS CLOSED: a role-specific deployment URL needs exactly one sslmode=verify-full', () => {
  const HOST = 'psql-acos-s1p-audit.postgres.database.azure.com';
  const url = (role: string, rest: string): string => `postgres://${role}:r0tated-S3cret@${HOST}:5432/acos_audit${rest}`;

  for (const [role, check] of [
    ['acos_audit_evidence_ingress', (value: string | undefined) => evidenceIngressUrl({ ACOS_AUDIT_PG_URL: value })],
    ['acos_audit_evaluator', (value: string | undefined) => validateRoleScopedUrl(value, 'acos_audit_evaluator')],
  ] as const) {
    describe(role, () => {
      it('ACCEPTS one sslmode=verify-full, verbatim', () => {
        const accepted = url(role, '?sslmode=verify-full');
        expect(check(accepted)).toEqual({ ok: true, url: accepted });
      });

      it('preserves a valid sslrootcert alongside verify-full byte for byte (nothing rewritten)', () => {
        const accepted = url(role, '?sslrootcert=%2Fetc%2Facos%2Fpg-ca.pem&sslmode=verify-full&application_name=x');
        expect(check(accepted)).toEqual({ ok: true, url: accepted });
      });

      for (const [label, value, refusal] of [
        ['missing sslmode', url(role, ''), 'AUDIT_STORE_TLS_NOT_VERIFY_FULL'],
        ['sslmode=disable', url(role, '?sslmode=disable'), 'AUDIT_STORE_TLS_NOT_VERIFY_FULL'],
        ['sslmode=allow', url(role, '?sslmode=allow'), 'AUDIT_STORE_TLS_NOT_VERIFY_FULL'],
        ['sslmode=prefer', url(role, '?sslmode=prefer'), 'AUDIT_STORE_TLS_NOT_VERIFY_FULL'],
        ['sslmode=require', url(role, '?sslmode=require'), 'AUDIT_STORE_TLS_NOT_VERIFY_FULL'],
        ['sslmode=verify-ca', url(role, '?sslmode=verify-ca'), 'AUDIT_STORE_TLS_NOT_VERIFY_FULL'],
        ['sslmode=no-verify', url(role, '?sslmode=no-verify'), 'AUDIT_STORE_TLS_NOT_VERIFY_FULL'],
        ['an upper-cased value', url(role, '?sslmode=VERIFY-FULL'), 'AUDIT_STORE_TLS_NOT_VERIFY_FULL'],
        ['duplicate sslmode (even both verify-full)', url(role, '?sslmode=verify-full&sslmode=verify-full'), 'AUDIT_STORE_TLS_PARAMETER_CONFLICT'],
        ['duplicate sslmode (weak + strong)', url(role, '?sslmode=disable&sslmode=verify-full'), 'AUDIT_STORE_TLS_PARAMETER_CONFLICT'],
        ['a case-variant SSLMODE parameter', url(role, '?sslmode=verify-full&SSLMODE=disable'), 'AUDIT_STORE_TLS_PARAMETER_CONFLICT'],
        ['conflicting ssl=false', url(role, '?sslmode=verify-full&ssl=false'), 'AUDIT_STORE_TLS_PARAMETER_CONFLICT'],
        ['any ssl parameter (ssl=true)', url(role, '?sslmode=verify-full&ssl=true'), 'AUDIT_STORE_TLS_PARAMETER_CONFLICT'],
        ['a host override parameter', url(role, '?sslmode=verify-full&host=%2Fvar%2Frun%2Fpostgresql'), 'AUDIT_STORE_TLS_PARAMETER_CONFLICT'],
        // WHATWG URL cannot carry credentials without a host, so this never parses: refused as malformed
        // (the explicit host check in roleScopedUrl.ts stays as defence in depth).
        ['empty hostname', `postgres://${role}:pw@/acos_audit?sslmode=verify-full`, 'AUDIT_STORE_URL_MALFORMED'],
        ['empty hostname with a port', `postgres://${role}:pw@:5432/acos_audit?sslmode=verify-full`, 'AUDIT_STORE_URL_MALFORMED'],
        ['empty database', `postgres://${role}:pw@${HOST}:5432/?sslmode=verify-full`, 'AUDIT_STORE_DATABASE_MISSING'],
        ['no database path at all', `postgres://${role}:pw@${HOST}:5432?sslmode=verify-full`, 'AUDIT_STORE_DATABASE_MISSING'],
        ['missing password', `postgres://${role}@${HOST}:5432/acos_audit?sslmode=verify-full`, 'AUDIT_STORE_PASSWORD_MISSING'],
        ['empty password', `postgres://${role}:@${HOST}:5432/acos_audit?sslmode=verify-full`, 'AUDIT_STORE_PASSWORD_MISSING'],
      ] as const) {
        it(`REFUSES ${label}`, () => {
          expect(check(value)).toEqual({ ok: false, refusal });
        });
      }
    });
  }

  it('the INGRESS refuses the evaluator, owner and other roles even with verify-full', () => {
    for (const role of ['acos_audit_evaluator', 'acos', 'acos_audit_owner', 'acos_audit_replication']) {
      expect(evidenceIngressUrl({ ACOS_AUDIT_PG_URL: url(role, '?sslmode=verify-full') })).toEqual({
        ok: false,
        refusal: 'AUDIT_STORE_ROLE_NOT_EVIDENCE_INGRESS',
      });
    }
  });

  it('the EVALUATOR refuses the owner (or any other) role as a role-specific deployment credential', () => {
    for (const role of ['acos', 'acos_audit_owner', 'acos_audit_evidence_ingress']) {
      expect(validateRoleScopedUrl(url(role, '?sslmode=verify-full'), 'acos_audit_evaluator')).toEqual({
        ok: false,
        refusal: 'AUDIT_STORE_ROLE_MISMATCH',
      });
      expect(() => auditEvaluatorDeploymentUrl(url(role, '?sslmode=verify-full'))).toThrow(/AUDIT_STORE_ROLE_MISMATCH/);
    }
  });

  it('the evaluator path THROWS on a role-specific URL with weak TLS — it never falls back or repairs', () => {
    const original = process.env['ACOS_AUDIT_PG_URL'];
    try {
      process.env['ACOS_AUDIT_PG_URL'] = url('acos_audit_evaluator', '?sslmode=require');
      expect(() => auditEvaluatorUrl()).toThrow(/AUDIT_STORE_TLS_NOT_VERIFY_FULL/);
      process.env['ACOS_AUDIT_PG_URL'] = url('acos_audit_evaluator', '');
      expect(() => auditEvaluatorUrl()).toThrow(/AUDIT_STORE_TLS_NOT_VERIFY_FULL/);
    } finally {
      process.env['ACOS_AUDIT_PG_URL'] = original;
    }
  });

  it('no PGSSL* environment variable is consulted: the URL is the sole TLS authority', () => {
    const before = { ...process.env };
    try {
      process.env['PGSSLMODE'] = 'verify-full';
      expect(evidenceIngressUrl({ ACOS_AUDIT_PG_URL: url('acos_audit_evidence_ingress', '') })).toEqual({
        ok: false,
        refusal: 'AUDIT_STORE_TLS_NOT_VERIFY_FULL',
      });
    } finally {
      for (const key of Object.keys(process.env)) if (!(key in before)) delete process.env[key];
    }
    for (const file of ['src/audit/db/roleScopedUrl.ts', 'src/audit/providerEvidence/evidenceIngressPool.ts']) {
      // CODE only: the modules' documentation names PGSSL* in order to say it is never read.
      const code = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(code, file).not.toMatch(/process\.env|PGSSL/);
    }
  });
});

describe('the ACR commit-SHA tag is LOCKED and the lock VERIFIED before the app references it', () => {
  const steps = operatorSteps(PARAMS, 'rendered.json');
  const ids = steps.map((step) => step.id);
  const at = (id: OperatorStep['id']): number => ids.indexOf(id);

  it('the generated sequence satisfies the ordering rule', () => {
    expect(operatorSequenceProblems(steps)).toEqual([]);
  });

  it('build/push the SHA tag → lock it → verify the lock → only then register the share and create the app', () => {
    expect(steps[0]!.command).toBe('set -euo pipefail');
    expect(at('VERIFY_SOURCE_COMMIT')).toBeLessThan(at('BUILD_IMAGE'));
    expect(at('BUILD_IMAGE')).toBeLessThan(at('PUSH_IMAGE'));
    expect(at('PUSH_IMAGE')).toBeLessThan(at('LOCK_TAG'));
    expect(at('LOCK_TAG')).toBeLessThan(at('VERIFY_TAG_LOCK'));
    expect(at('VERIFY_TAG_LOCK')).toBeLessThan(at('REGISTER_READ_ONLY_SHARE'));
    expect(at('VERIFY_TAG_LOCK')).toBeLessThan(at('CREATE_CONTAINER_APP'));
    const reference = `acracoss1p.azurecr.io/acos-s1p-provider-evidence:${PARAMS.imageTag}`;
    expect(steps[at('BUILD_IMAGE')]!.command).toContain(`-t ${reference}`);
    expect(steps[at('PUSH_IMAGE')]!.command).toBe(`docker push ${reference}`);
  });

  it('the lock sets write AND delete disabled on exactly the SHA tag, and the verification exits unless both are false', () => {
    const image = `acos-s1p-provider-evidence:${PARAMS.imageTag}`;
    expect(steps[at('LOCK_TAG')]!.command).toBe(
      `az acr repository update --name acracoss1p --image ${image} --write-enabled false --delete-enabled false`,
    );
    const verify = steps[at('VERIFY_TAG_LOCK')]!.command;
    expect(verify).toContain(`az acr repository show --name acracoss1p --image ${image}`);
    expect(verify).toContain('changeableAttributes.writeEnabled, changeableAttributes.deleteEnabled');
    expect(verify).toContain('test "$LOCK" = "false false"');
    expect(verify).toMatch(/\|\| \{ echo "REFUSED: tag is not locked[^}]*exit 1; \}$/);
    expect(steps.map((step) => step.command).join('\n')).not.toMatch(/:latest\b/);
  });

  const without = (id: OperatorStep['id']): OperatorStep[] => steps.filter((step) => step.id !== id);
  const swap = (a: OperatorStep['id'], b: OperatorStep['id']): OperatorStep[] => {
    const copy = [...steps];
    const i = copy.findIndex((step) => step.id === a);
    const j = copy.findIndex((step) => step.id === b);
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
    return copy;
  };
  for (const [label, mutated, pattern] of [
    ['a sequence with NO lock', () => without('LOCK_TAG'), /missing step LOCK_TAG/],
    ['a sequence with NO lock verification', () => without('VERIFY_TAG_LOCK'), /missing step VERIFY_TAG_LOCK/],
    ['creating the app BEFORE the lock is verified', () => swap('VERIFY_TAG_LOCK', 'CREATE_CONTAINER_APP'), /before the tag lock is verified/],
    ['locking before pushing', () => swap('PUSH_IMAGE', 'LOCK_TAG'), /PUSH_IMAGE must precede LOCK_TAG/],
    ['a verification that does not exit', () => steps.map((step) => (step.id === 'VERIFY_TAG_LOCK' ? { ...step, command: step.command.replace('exit 1', 'true') } : step)), /exit otherwise/],
    ['a lock that leaves delete enabled', () => steps.map((step) => (step.id === 'LOCK_TAG' ? { ...step, command: step.command.replace('--delete-enabled false', '') } : step)), /delete-enabled false/],
    ['no stop-on-failure shell', () => without('GUARD_SHELL'), /missing step GUARD_SHELL/],
    ['a latest tag', () => steps.map((step) => (step.id === 'PUSH_IMAGE' ? { ...step, command: 'docker push acracoss1p.azurecr.io/acos-s1p-provider-evidence:latest' } : step)), /uses latest/],
  ] as const) {
    it(`the ordering rule REFUSES ${label}`, () => {
      expect(operatorSequenceProblems(mutated()).join('\n')).toMatch(pattern);
    });
  }
});

// =====================================================================================
// THE PUBLIC BINDING PROBES, AGAINST A LOCAL ACA-LIKE FRONT END.
// =====================================================================================

type ProxyMode = 'PRESERVE_HOST' | 'REWRITE_HOST';

interface FrontEnd {
  readonly tlsPort: number;
  readonly plainPort: number;
  close(): Promise<void>;
}

const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'content-length', 'te', 'trailer', 'upgrade']);

/**
 * The front end. `tlsPort` stands for the platform's TLS listener (the connection is plaintext
 * here because TLS termination is not the property under test — what reaches the container is).
 * It forwards the ORIGINAL Host, adds X-Forwarded-For/Proto and a request id, and RE-CHUNKS the
 * body (no Content-Length upstream). `plainPort` stands for port 80: it redirects to HTTPS.
 */
async function startFrontEnd(upstreamPort: number, mode: ProxyMode): Promise<FrontEnd> {
  const tls = createServer((incoming: IncomingMessage, outgoing) => {
    const headers: [string, string][] = [];
    for (let i = 0; i < incoming.rawHeaders.length; i += 2) {
      const name = incoming.rawHeaders[i]!;
      if (HOP_BY_HOP.has(name.toLowerCase())) continue;
      if (name.toLowerCase() === 'host' && mode === 'REWRITE_HOST') {
        headers.push(['Host', `127.0.0.1:${String(upstreamPort)}`]);
        continue;
      }
      headers.push([name, incoming.rawHeaders[i + 1]!]);
    }
    headers.push(['X-Forwarded-Proto', 'https'], ['X-Forwarded-For', '203.0.113.7'], ['X-Request-Id', 'aca-sim-1']);
    const upstream = httpRequest(
      { host: '127.0.0.1', port: upstreamPort, method: incoming.method, path: incoming.url, headers: headers.flat() as unknown as Record<string, string>, setHost: false },
      (response) => {
        outgoing.writeHead(response.statusCode ?? 502, { 'content-length': '0', connection: 'close' });
        response.resume();
        response.on('end', () => outgoing.end());
      },
    );
    upstream.on('error', () => {
      outgoing.writeHead(502, { 'content-length': '0' });
      outgoing.end();
    });
    incoming.pipe(upstream);
  });
  const plain = createServer((incoming, outgoing) => {
    outgoing.writeHead(301, { location: `https://${String(incoming.headers.host)}${String(incoming.url)}`, 'content-length': '0' });
    outgoing.end();
  });
  const listen = (server: Server): Promise<number> =>
    new Promise((resolveListen) => {
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        resolveListen(typeof address === 'object' && address !== null ? address.port : 0);
      });
    });
  const tlsPort = await listen(tls);
  const plainPort = await listen(plain);
  return {
    tlsPort,
    plainPort,
    close: async () => {
      for (const server of [tls, plain]) {
        await new Promise<void>((resolveClose) => {
          server.close(() => resolveClose());
          server.closeAllConnections();
        });
      }
    },
  };
}

function send(
  port: number,
  input: { readonly method: string; readonly host: string; readonly target: string; readonly body?: Buffer; readonly headers?: Record<string, string> },
): Promise<number> {
  return new Promise((resolveSend, rejectSend) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        method: input.method,
        path: input.target,
        setHost: false,
        headers: { Host: input.host, ...(input.body === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': String(input.body.length) }), ...(input.headers ?? {}) },
      },
      (response) => {
        response.resume();
        resolveSend(response.statusCode ?? 0);
      },
    );
    req.on('error', rejectSend);
    if (input.body !== undefined) req.write(input.body);
    req.end();
  });
}

async function runPlan(frontEnd: FrontEnd, identity: string): Promise<Record<string, number>> {
  const host = new URL(identity).host;
  const observed: Record<string, number> = {};
  for (const probe of bindingProbePlan(identity) as readonly BindingProbe[]) {
    observed[probe.name] = await send(probe.scheme === 'https' ? frontEnd.tlsPort : frontEnd.plainPort, {
      method: probe.method,
      host: probe.hostOverride ?? host,
      target: probe.target,
      ...(probe.method === 'POST' ? { body: Buffer.from('[]') } : {}),
    });
  }
  return observed;
}

describe('the binding probes through an ACA-like front end (local, no network)', () => {
  let audit: AuditHarness;
  let ingress: StartedProviderEvidenceIngress;

  beforeAll(async () => {
    audit = await createAuditHarness();
  });
  afterAll(async () => {
    await audit.close();
  });
  beforeEach(async () => {
    await audit.reset();
    const started = await startProviderEvidenceIngress({
      environment: ingressEnvironment(providerEvidenceArtifactFixture(), {
        [INGRESS_ENVIRONMENT.listenHost]: '127.0.0.1',
        [INGRESS_ENVIRONMENT.listenPort]: '0',
      }),
      log: () => undefined,
      ...testIngressStore(),
    });
    if (!started.ready) throw new Error(started.refusal);
    ingress = started;
  });
  afterEach(async () => {
    await ingress.close();
  });

  it('Host PRESERVED: every probe passes — 401 at the exact URL proves Host and path arrived unchanged', async () => {
    const frontEnd = await startFrontEnd(ingress.port, 'PRESERVE_HOST');
    try {
      const observed = await runPlan(frontEnd, TEST_INGRESS_IDENTITY);
      const verdict = evaluateBindingProbes(bindingProbePlan(TEST_INGRESS_IDENTITY), observed);
      expect(verdict.failures).toEqual([]);
      expect(observed['EXACT_HOST_AND_PATH_REACHES_RECEIVER']).toBe(401);
      // And no unsigned probe stored anything.
      expect(await auditSql(audit, 'SELECT COUNT(*)::INT AS n FROM provider_evidence_observation')).toEqual([{ n: 0 }]);
    } finally {
      await frontEnd.close();
    }
  });

  it('Host REWRITTEN by the front end: the exact-URL probe FAILS — the blocker is detected, not absorbed', async () => {
    const frontEnd = await startFrontEnd(ingress.port, 'REWRITE_HOST');
    try {
      const observed = await runPlan(frontEnd, TEST_INGRESS_IDENTITY);
      const verdict = evaluateBindingProbes(bindingProbePlan(TEST_INGRESS_IDENTITY), observed);
      expect(verdict.pass).toBe(false);
      expect(observed['EXACT_HOST_AND_PATH_REACHES_RECEIVER']).toBe(404);
      expect(verdict.failures.join('\n')).toContain('INGRESS BINDING BLOCKER');
    } finally {
      await frontEnd.close();
    }
  });

  it('the ingress STARTS (no persister injected) only on a verify-full ingress-role URL, and refuses weaker TLS before listening', async () => {
    const accepted = 'postgres://acos_audit_evidence_ingress:r0tated@127.0.0.1:1/acos_audit?sslmode=verify-full';
    const started = await startProviderEvidenceIngress({
      environment: ingressEnvironment(providerEvidenceArtifactFixture(), {
        ACOS_AUDIT_PG_URL: accepted,
        [INGRESS_ENVIRONMENT.listenPort]: '0',
      }),
      log: () => undefined,
    });
    // READY: the URL was accepted verbatim (the pool connects lazily; nothing is sent here).
    expect(started.ready).toBe(true);
    if (started.ready) await started.close();
    for (const [mode, detail] of [
      ['?sslmode=require', 'AUDIT_STORE_TLS_NOT_VERIFY_FULL'],
      ['', 'AUDIT_STORE_TLS_NOT_VERIFY_FULL'],
      ['?sslmode=verify-full&ssl=false', 'AUDIT_STORE_TLS_PARAMETER_CONFLICT'],
    ] as const) {
      const refused = await startProviderEvidenceIngress({
        environment: ingressEnvironment(providerEvidenceArtifactFixture(), {
          ACOS_AUDIT_PG_URL: `postgres://acos_audit_evidence_ingress:r0tated@127.0.0.1:1/acos_audit${mode}`,
          [INGRESS_ENVIRONMENT.listenPort]: '0',
        }),
        log: () => undefined,
      });
      expect(refused).toMatchObject({ ready: false, refusal: 'AUDIT_STORE_CREDENTIAL_INVALID', detail });
    }
  });

  it('the test-side role pool (outside the image) still persists through the audit store', async () => {
    const roleUrl = auditEvidenceIngressUrl();
    expect(new URL(roleUrl).username).toBe('acos_audit_evidence_ingress');
    const timestamp = '1760000901';
    const body = bodyOf([processedEvent(correlationTag(), { sg_event_id: 'evt-role-url' })]);
    const status = await send(ingress.port, {
      method: 'POST',
      host: new URL(TEST_INGRESS_IDENTITY).host,
      target: new URL(TEST_INGRESS_IDENTITY).pathname,
      body,
      headers: {
        'X-Twilio-Email-Event-Webhook-Signature': signWebhook(timestamp, body),
        'X-Twilio-Email-Event-Webhook-Timestamp': timestamp,
      },
    });
    expect(status).toBe(204);
    expect(await auditSql(audit, 'SELECT sg_event_id FROM provider_evidence_event')).toEqual([{ sg_event_id: 'evt-role-url' }]);
  });

  it('a SIGNED delivery through the front end (re-chunked, extra headers) is verified and durably stored', async () => {
    const frontEnd = await startFrontEnd(ingress.port, 'PRESERVE_HOST');
    try {
      const timestamp = '1760000900';
      const body = bodyOf([processedEvent(correlationTag(), { sg_event_id: 'evt-aca-sim' })]);
      const status = await send(frontEnd.tlsPort, {
        method: 'POST',
        host: new URL(TEST_INGRESS_IDENTITY).host,
        target: new URL(TEST_INGRESS_IDENTITY).pathname,
        body,
        headers: {
          'X-Twilio-Email-Event-Webhook-Signature': signWebhook(timestamp, body),
          'X-Twilio-Email-Event-Webhook-Timestamp': timestamp,
        },
      });
      expect(status).toBe(204);
      expect(await auditSql(audit, 'SELECT sg_event_id FROM provider_evidence_event')).toEqual([{ sg_event_id: 'evt-aca-sim' }]);
    } finally {
      await frontEnd.close();
    }
  });
});
