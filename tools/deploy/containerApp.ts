import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { parseIngressIdentity } from '../../src/audit/providerEvidence/ingressIdentity.js';
import { CONTROL_ARTIFACT_MOUNT, IMAGE_LISTEN_PORT } from './ingressImage.js';

/**
 * S1P-WD — THE AZURE CONTAINER APPS DEPLOYMENT DEFINITION FOR THE PROVIDER-EVIDENCE INGRESS.
 *
 * =================================================================================
 * REVIEWABLE AND NON-EXECUTING
 *
 * This module RENDERS `deploy/provider-evidence-ingress/containerapp.template.json` from a file
 * of NON-SECRET parameters, VALIDATES the result against the ingress's runtime contract, and
 * PRINTS the `az` commands an owner would run. It runs nothing: it imports no child-process
 * API, no network client and no Azure SDK (`tests/deploy/container-app.test.ts` asserts that),
 * so no invocation of it can create, change or read an Azure resource.
 *
 * =================================================================================
 * WHAT IS — AND IS NOT — A PARAMETER
 *
 * Parameters are identifiers and PUBLIC values: resource ids, the registry server, the image's
 * git-commit tag, the Key Vault secret URI (a reference, not the secret), the two owner root
 * PUBLIC keys and the manifest pin (`50 §3a` deployment trust configuration — public, but
 * authority-bearing, so they sit in the app's revisioned template, apart from the mutable
 * artifact share). The database password is never a parameter: `ACOS_AUDIT_PG_URL` is a
 * Container Apps secret REFERENCE to Key Vault. The Azure Files account key is never a
 * parameter: the printed command reads it from the operator's shell.
 *
 * The reserved `ingress_identity` appears in the template as DEPLOYMENT CONFIGURATION — the
 * non-authoritative launch echo, which can only stop the receiver. The authority is the SIGNED
 * class-28 record, which does not exist yet and is not produced here.
 * =================================================================================
 */

export const TEMPLATE_PATH = 'deploy/provider-evidence-ingress/containerapp.template.json';

/** The names fixed by the owner's provisioning record. Not parameters, so they cannot drift. */
export const CONTAINER_APP_TARGET = Object.freeze({
  resourceGroup: 'rg-acos-s1p-nonprod',
  environment: 'cae-acos-s1p-audit',
  appName: 'ca-acos-s1p-webhook',
  region: 'centralus',
  ingressPath: '/provider-evidence/sendgrid',
  imageRepository: 'acos-s1p-provider-evidence',
  provider: 'twilio_sendgrid',
});

export interface ContainerAppParams {
  readonly subscriptionId: string;
  readonly environmentDefaultDomain: string;
  readonly registryLoginServer: string;
  readonly imageTag: string;
  readonly webhookIdentityResourceId: string;
  readonly auditPgUrlSecretUri: string;
  readonly environmentStorageName: string;
  readonly ownerRootPublicKeyHex: string;
  readonly ownerSecondFactorPublicKeyHex: string;
  readonly expectedActiveManifestId: string;
}

/** Placeholder → parameter. Every `<...>` in the template must be one of these. */
const PLACEHOLDERS: Readonly<Record<string, keyof ContainerAppParams>> = Object.freeze({
  '<SUBSCRIPTION_ID>': 'subscriptionId',
  '<REGISTRY_LOGIN_SERVER>': 'registryLoginServer',
  '<IMAGE_TAG>': 'imageTag',
  '<WEBHOOK_IDENTITY_RESOURCE_ID>': 'webhookIdentityResourceId',
  '<AUDIT_PG_URL_SECRET_URI>': 'auditPgUrlSecretUri',
  '<ENVIRONMENT_STORAGE_NAME>': 'environmentStorageName',
  '<OWNER_ROOT_PUBLIC_KEY_HEX>': 'ownerRootPublicKeyHex',
  '<OWNER_SECOND_FACTOR_PUBLIC_KEY_HEX>': 'ownerSecondFactorPublicKeyHex',
  '<EXPECTED_ACTIVE_MANIFEST_ID>': 'expectedActiveManifestId',
});

/**
 * The ingress process's COMPLETE environment, read from the code (`ingressMain.ts`'s
 * `INGRESS_ENVIRONMENT`, `auditPlaneVerifier.ts`'s `AUDIT_PLANE_TRUST_VARIABLES`, and
 * `src/db/pool.ts`'s `auditUrl()`). Nothing else in the ingress closure reads the environment.
 */
export const INGRESS_ENVIRONMENT_CONTRACT: readonly {
  readonly name: string;
  readonly source: 'LITERAL' | 'PARAMETER' | 'SECRET_REFERENCE';
  readonly purpose: string;
}[] = Object.freeze([
  { name: 'ACOS_PROVIDER_EVIDENCE_PROVIDER', source: 'LITERAL', purpose: 'selects which SIGNED class-28 record to serve; selects nothing unsigned' },
  { name: 'ACOS_PROVIDER_EVIDENCE_INGRESS_ECHO', source: 'LITERAL', purpose: 'non-authoritative launch echo; must equal the signed ingress_identity exactly or the process never listens' },
  { name: 'ACOS_PROVIDER_EVIDENCE_LISTEN_HOST', source: 'LITERAL', purpose: 'container-local bind address behind the Container Apps TLS front end' },
  { name: 'ACOS_PROVIDER_EVIDENCE_LISTEN_PORT', source: 'LITERAL', purpose: 'container-local HTTP port; equals ingress.targetPort' },
  { name: 'ACOS_AUDIT_PG_URL', source: 'SECRET_REFERENCE', purpose: 'the ingress ROLE\'s own audit-store URL (user acos_audit_evidence_ingress, sslmode=verify-full); used verbatim' },
  { name: 'ACOS_AUDIT_OWNER_ARTIFACT_ROOT_KEY', source: 'PARAMETER', purpose: '50 §3a owner PRIMARY Ed25519 PUBLIC key, 64 hex' },
  { name: 'ACOS_AUDIT_OWNER_ARTIFACT_SECOND_FACTOR_KEY', source: 'PARAMETER', purpose: '50 §3a owner SECOND-FACTOR Ed25519 PUBLIC key, 64 hex' },
  { name: 'ACOS_AUDIT_EXPECTED_ACTIVE_MANIFEST_ID', source: 'PARAMETER', purpose: '50 §3e deployment pin: the released manifest_id' },
  { name: 'ACOS_AUDIT_CONTROL_ARTIFACT_ROOT', source: 'LITERAL', purpose: 'the read-only mount holding manifest.json and the signed artifact files' },
]);

/** Environment names that must never reach this container. */
const FORBIDDEN_ENVIRONMENT = /SENDGRID|LOCATOR|INTEGRATION|KEY_VAULT|KEYVAULT|AZURE_CLIENT|AZURE_TENANT|AZURE_FEDERATED|^ACOS_CONTROL_|^ACOS_S1P_|^PG[A-Z]*$|DECISION_KEY|PRIVATE/;

const HEX64 = /^[0-9a-f]{64}$/;
const GIT_SHA = /^[0-9a-f]{40}$/;

export interface RenderOutcome {
  readonly ok: boolean;
  readonly problems: readonly string[];
  readonly rendered: unknown;
  readonly reservedIngressIdentity: string;
}

/** The canonical public identity this app's name and environment domain imply. */
export function reservedIngressIdentity(environmentDefaultDomain: string): string {
  return `https://${CONTAINER_APP_TARGET.appName}.${environmentDefaultDomain}${CONTAINER_APP_TARGET.ingressPath}`;
}

export function loadTemplate(cwd: string = process.cwd()): unknown {
  return JSON.parse(readFileSync(resolve(cwd, TEMPLATE_PATH), 'utf8')) as unknown;
}

function validateParams(params: ContainerAppParams): string[] {
  const problems: string[] = [];
  const text = (key: keyof ContainerAppParams): string => {
    const value = params[key];
    if (typeof value !== 'string' || value.length === 0 || value.includes('<')) {
      problems.push(`${key} is missing or still a placeholder`);
      return '';
    }
    return value;
  };
  if (!/^[0-9a-f-]{36}$/.test(text('subscriptionId'))) problems.push('subscriptionId is not a GUID');
  const tag = text('imageTag');
  if (!GIT_SHA.test(tag)) {
    problems.push('imageTag must be a full 40-hex git commit SHA: an immutable, content-associated tag, never "latest"');
  }
  if (!/^[a-z0-9]{5,50}\.azurecr\.io$/.test(text('registryLoginServer'))) {
    problems.push('registryLoginServer is not an Azure Container Registry login server');
  }
  if (!/^\/subscriptions\/[^/]+\/resourceGroups\/[^/]+\/providers\/Microsoft\.ManagedIdentity\/userAssignedIdentities\/[^/]+$/.test(text('webhookIdentityResourceId'))) {
    problems.push('webhookIdentityResourceId is not a user-assigned identity resource id');
  }
  if (/send|integration|sendgrid/i.test(params.webhookIdentityResourceId ?? '')) {
    problems.push('webhookIdentityResourceId names a SEND/integration identity; the ingress must never hold one');
  }
  const secretUri = text('auditPgUrlSecretUri');
  if (!/^https:\/\/[a-z0-9-]{3,24}\.vault\.azure\.net\/secrets\/[A-Za-z0-9-]+$/.test(secretUri)) {
    problems.push('auditPgUrlSecretUri is not a versionless Key Vault secret URI');
  }
  if (/send|integration|sendgrid/i.test(secretUri)) {
    problems.push('auditPgUrlSecretUri points at a SEND/integration vault or secret');
  }
  if (!/^[a-z0-9-]{1,32}$/.test(text('environmentStorageName'))) problems.push('environmentStorageName is invalid');
  const root = text('ownerRootPublicKeyHex');
  const second = text('ownerSecondFactorPublicKeyHex');
  if (!HEX64.test(root)) problems.push('ownerRootPublicKeyHex is not 64 lowercase hex (32-byte Ed25519 public key)');
  if (!HEX64.test(second)) problems.push('ownerSecondFactorPublicKeyHex is not 64 lowercase hex');
  if (root.length > 0 && root === second) problems.push('the two owner root keys are identical (50 §3a forbids it)');
  if (!HEX64.test(text('expectedActiveManifestId'))) problems.push('expectedActiveManifestId is not a 64-hex manifest_id');
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(text('environmentDefaultDomain'))) problems.push('environmentDefaultDomain is invalid');
  return problems;
}

function substitute(value: unknown, params: ContainerAppParams, unknownPlaceholders: Set<string>): unknown {
  if (typeof value === 'string') {
    return value.replace(/<[A-Z0-9_]+>/g, (token) => {
      const key = PLACEHOLDERS[token];
      if (key === undefined) {
        unknownPlaceholders.add(token);
        return token;
      }
      return params[key];
    });
  }
  if (Array.isArray(value)) return value.map((item) => substitute(item, params, unknownPlaceholders));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        substitute(key, params, unknownPlaceholders) as string,
        substitute(item, params, unknownPlaceholders),
      ]),
    );
  }
  return value;
}

interface ContainerShape {
  readonly image?: string;
  readonly env?: readonly { readonly name: string; readonly value?: string; readonly secretRef?: string }[];
  readonly volumeMounts?: readonly { readonly volumeName: string; readonly mountPath: string }[];
  readonly command?: unknown;
  readonly args?: unknown;
}

/**
 * Validate a (rendered or template) Container App definition against the ingress runtime
 * contract. Used by the renderer AND by the tests, so the two cannot disagree.
 */
export function validateContainerAppDefinition(
  definition: unknown,
  expectedIdentity: string,
): string[] {
  const problems: string[] = [];
  const app = definition as {
    readonly name?: string;
    readonly properties?: {
      readonly configuration?: {
        readonly ingress?: Record<string, unknown> & { readonly additionalPortMappings?: unknown };
        readonly secrets?: readonly { readonly name: string; readonly value?: string; readonly keyVaultUrl?: string }[];
        readonly dapr?: unknown;
      };
      readonly template?: {
        readonly containers?: readonly ContainerShape[];
        readonly initContainers?: unknown;
        readonly scale?: { readonly minReplicas?: number; readonly maxReplicas?: number };
        readonly volumes?: readonly { readonly name: string; readonly storageType?: string }[];
      };
    };
  };
  if (app.name !== CONTAINER_APP_TARGET.appName) problems.push('app name is not ca-acos-s1p-webhook');
  const configuration = app.properties?.configuration;
  const ingress = configuration?.ingress;
  if (ingress === undefined) {
    problems.push('no ingress');
  } else {
    if (ingress.external !== true) problems.push('ingress is not external');
    if (ingress.targetPort !== IMAGE_LISTEN_PORT) problems.push(`ingress.targetPort is not ${String(IMAGE_LISTEN_PORT)}`);
    if (ingress.allowInsecure !== false) problems.push('ingress.allowInsecure must be explicitly false (HTTPS only)');
    if (ingress.transport !== 'http') problems.push('ingress.transport must be http (HTTP/1.1 to the container behind TLS termination)');
    if (ingress.additionalPortMappings !== undefined) problems.push('a second ingress port is declared');
    if (ingress.exposedPort !== undefined && ingress.exposedPort !== 0) problems.push('an exposed TCP port is declared');
    if (ingress.customDomains !== undefined) problems.push('a custom domain changes the public authority away from the reserved identity');
    if (ingress.ipSecurityRestrictions !== undefined) problems.push('ip restrictions are an owner decision, not part of this template');
  }
  if (configuration?.dapr !== undefined) problems.push('Dapr adds a sidecar listener; not permitted');
  for (const secret of configuration?.secrets ?? []) {
    if (secret.value !== undefined) problems.push(`secret ${secret.name} embeds a value; it must be a Key Vault reference`);
  }
  if ((configuration?.secrets ?? []).map((secret) => secret.name).join(',') !== 'audit-pg-url') {
    problems.push('the only secret must be audit-pg-url');
  }

  const template = app.properties?.template;
  if (template?.initContainers !== undefined) problems.push('init containers are not permitted');
  const containers = template?.containers ?? [];
  if (containers.length !== 1) problems.push('exactly one container is required');
  const container = containers[0];
  if (container !== undefined) {
    if (container.command !== undefined || container.args !== undefined) {
      problems.push('command/args override the image entry point; the image runs the ingress and nothing else');
    }
    const image = container.image ?? '';
    if (/:latest$/.test(image) || !image.includes(`/${CONTAINER_APP_TARGET.imageRepository}:`)) {
      problems.push('container image must be <registry>/acos-s1p-provider-evidence:<immutable tag>, never latest');
    }
    const env = container.env ?? [];
    const names = env.map((entry) => entry.name);
    const contract = INGRESS_ENVIRONMENT_CONTRACT.map((entry) => entry.name);
    if (JSON.stringify([...names].sort()) !== JSON.stringify([...contract].sort())) {
      problems.push(`environment is not exactly the ingress contract: ${names.join(', ')}`);
    }
    for (const entry of env) {
      if (FORBIDDEN_ENVIRONMENT.test(entry.name)) problems.push(`forbidden environment variable ${entry.name}`);
      const spec = INGRESS_ENVIRONMENT_CONTRACT.find((item) => item.name === entry.name);
      if (spec?.source === 'SECRET_REFERENCE' && (entry.secretRef === undefined || entry.value !== undefined)) {
        problems.push(`${entry.name} must be a secret reference, never a value`);
      }
      if (spec !== undefined && spec.source !== 'SECRET_REFERENCE' && entry.secretRef !== undefined) {
        problems.push(`${entry.name} must not be a secret reference`);
      }
    }
    const value = (name: string): string | undefined => env.find((entry) => entry.name === name)?.value;
    if (value('ACOS_PROVIDER_EVIDENCE_PROVIDER') !== CONTAINER_APP_TARGET.provider) problems.push('provider selector is not twilio_sendgrid');
    if (value('ACOS_PROVIDER_EVIDENCE_INGRESS_ECHO') !== expectedIdentity) problems.push('launch echo is not the reserved ingress identity');
    const parsed = parseIngressIdentity(expectedIdentity);
    if (!parsed.ok) problems.push(`the reserved ingress identity is not canonical: ${parsed.refusal}`);
    if (value('ACOS_PROVIDER_EVIDENCE_LISTEN_HOST') !== '0.0.0.0') problems.push('listen host must be 0.0.0.0 inside the container');
    if (value('ACOS_PROVIDER_EVIDENCE_LISTEN_PORT') !== String(IMAGE_LISTEN_PORT)) problems.push('listen port must equal the target port');
    if (value('ACOS_AUDIT_CONTROL_ARTIFACT_ROOT') !== CONTROL_ARTIFACT_MOUNT) problems.push('control-artifact root is not the read-only mount');
    const mounts = container.volumeMounts ?? [];
    if (mounts.length !== 1 || mounts[0]?.mountPath !== CONTROL_ARTIFACT_MOUNT) {
      problems.push('exactly one volume mount, at the control-artifact root, is required');
    }
  }
  const volumes = template?.volumes ?? [];
  if (volumes.length !== 1 || volumes[0]?.storageType !== 'AzureFile') {
    problems.push('exactly one AzureFile volume (the control-artifact package) is required');
  }
  const scale = template?.scale;
  if (scale?.minReplicas !== 1 || scale.maxReplicas === undefined || scale.maxReplicas > 2) {
    problems.push('scale must be minReplicas 1 and maxReplicas at most 2 for validation');
  }
  return problems;
}

/** Render the template from parameters. Refuses (ok: false) on ANY problem. */
export function renderContainerApp(params: ContainerAppParams, template: unknown = loadTemplate()): RenderOutcome {
  const identity = reservedIngressIdentity(params.environmentDefaultDomain);
  const problems = validateParams(params);
  const unknownPlaceholders = new Set<string>();
  const rendered = substitute(template, params, unknownPlaceholders);
  for (const token of unknownPlaceholders) problems.push(`unknown placeholder ${token}`);
  if (/<[A-Z0-9_]+>/.test(JSON.stringify(rendered))) problems.push('an unfilled placeholder remains');
  problems.push(...validateContainerAppDefinition(rendered, identity));
  return Object.freeze({ ok: problems.length === 0, problems: Object.freeze(problems), rendered, reservedIngressIdentity: identity });
}

/** One step of the owner's Phase A sequence. `id` is what the ordering rule and tests refer to. */
export interface OperatorStep {
  readonly id:
    | 'GUARD_SHELL'
    | 'VERIFY_SOURCE_COMMIT'
    | 'REGISTRY_LOGIN'
    | 'BUILD_IMAGE'
    | 'PUSH_IMAGE'
    | 'RECORD_DIGEST'
    | 'LOCK_TAG'
    | 'VERIFY_TAG_LOCK'
    | 'REGISTER_READ_ONLY_SHARE'
    | 'CREATE_CONTAINER_APP'
    | 'CONFIRM_CONTAINER_APP';
  readonly comment: string;
  readonly command: string;
}

/** The registry NAME is the first label of its login server (`<name>.azurecr.io`). */
export function registryName(loginServer: string): string {
  return loginServer.split('.')[0] ?? '';
}

/**
 * The owner's Phase A command sequence, PRINTED as one `bash` script and never run.
 *
 * THE COMMIT-SHA TAG IS MADE IMMUTABLE BEFORE ANYTHING REFERENCES IT. A 40-hex tag is only a name:
 * Azure Container Registry lets a tag be overwritten or deleted unless it is LOCKED. So after the
 * push the script locks `acos-s1p-provider-evidence:<sha>` (`write-enabled false`,
 * `delete-enabled false`), then READS BACK both attributes and EXITS unless both are `false` —
 * and only after that does it register the share or create the Container App. `set -euo
 * pipefail` makes any failed step stop the script. The manifest digest is recorded as provenance;
 * it does not replace the lock.
 */
export function operatorSteps(params: ContainerAppParams, renderedPath: string): readonly OperatorStep[] {
  const t = CONTAINER_APP_TARGET;
  const registry = registryName(params.registryLoginServer);
  const image = `${t.imageRepository}:${params.imageTag}`;
  const reference = `${params.registryLoginServer}/${image}`;
  return Object.freeze([
    { id: 'GUARD_SHELL', comment: 'stop at the first failing step', command: 'set -euo pipefail' },
    {
      id: 'VERIFY_SOURCE_COMMIT',
      comment: 'build only the reviewed commit, from a clean tree',
      command:
        `test "$(git rev-parse HEAD)" = "${params.imageTag}" && test -z "$(git status --porcelain)" ` +
        '|| { echo "REFUSED: HEAD is not the reviewed commit, or the tree is dirty" >&2; exit 1; }',
    },
    { id: 'REGISTRY_LOGIN', comment: 'authenticate docker to the registry', command: `az acr login --name ${registry}` },
    {
      id: 'BUILD_IMAGE',
      comment: 'build from the digest-pinned bases, tagged with the commit SHA (never latest)',
      command: `docker build --platform linux/amd64 -f deploy/provider-evidence-ingress/Dockerfile -t ${reference} .`,
    },
    { id: 'PUSH_IMAGE', comment: 'push the commit-SHA tag', command: `docker push ${reference}` },
    {
      id: 'RECORD_DIGEST',
      comment: 'provenance: the manifest digest the tag resolves to (recorded, not a substitute for the lock)',
      command: `az acr repository show --name ${registry} --image ${image} --query digest --output tsv`,
    },
    {
      id: 'LOCK_TAG',
      comment: 'LOCK the tag: it can no longer be overwritten or deleted',
      command: `az acr repository update --name ${registry} --image ${image} --write-enabled false --delete-enabled false`,
    },
    {
      id: 'VERIFY_TAG_LOCK',
      comment: 'refuse to proceed unless writeEnabled == false AND deleteEnabled == false',
      command:
        `LOCK="$(az acr repository show --name ${registry} --image ${image} ` +
        '--query "[changeableAttributes.writeEnabled, changeableAttributes.deleteEnabled]" --output tsv | tr -s \'\\t\\r\\n\' \' \' | xargs)"; ' +
        'test "$LOCK" = "false false" || { echo "REFUSED: tag is not locked (write/delete: $LOCK)" >&2; exit 1; }',
    },
    {
      id: 'REGISTER_READ_ONLY_SHARE',
      comment: 'register the READ-ONLY control-artifact share with the environment',
      command:
        `az containerapp env storage set --resource-group ${t.resourceGroup} --name ${t.environment} ` +
        `--storage-name ${params.environmentStorageName} --storage-type AzureFile --access-mode ReadOnly ` +
        '--azure-file-account-name "$AUDIT_ARTIFACT_STORAGE_ACCOUNT" --azure-file-share-name "$AUDIT_ARTIFACT_SHARE" ' +
        '--azure-file-account-key "$AUDIT_ARTIFACT_STORAGE_KEY"',
    },
    {
      id: 'CREATE_CONTAINER_APP',
      comment: 'create the app from the rendered, reviewed definition (references the LOCKED tag)',
      command: `az containerapp create --resource-group ${t.resourceGroup} --name ${t.appName} --yaml ${renderedPath}`,
    },
    {
      id: 'CONFIRM_CONTAINER_APP',
      comment: 'confirm: HTTPS only, one port, the expected variables, and the startup result',
      command:
        `az containerapp show --resource-group ${t.resourceGroup} --name ${t.appName} --query "properties.configuration.ingress" && ` +
        `az containerapp show --resource-group ${t.resourceGroup} --name ${t.appName} --query "properties.template.containers[0].env[].name" && ` +
        `az containerapp logs show --resource-group ${t.resourceGroup} --name ${t.appName} --type console --tail 50`,
    },
  ]);
}

/**
 * The ORDERING RULE the printed sequence must satisfy — and that a hand-edited sequence is
 * checked against: the shell stops on failure; the source commit is verified before the build;
 * the SHA tag is built and pushed, then locked, then the lock is VERIFIED with an exit on failure;
 * and only then is the share registered or the app created/updated. Returns the problems.
 */
export function operatorSequenceProblems(steps: readonly OperatorStep[]): readonly string[] {
  const problems: string[] = [];
  const index = (id: OperatorStep['id']): number => steps.findIndex((step) => step.id === id);
  const required: OperatorStep['id'][] = [
    'GUARD_SHELL',
    'VERIFY_SOURCE_COMMIT',
    'BUILD_IMAGE',
    'PUSH_IMAGE',
    'LOCK_TAG',
    'VERIFY_TAG_LOCK',
    'CREATE_CONTAINER_APP',
  ];
  for (const id of required) if (index(id) === -1) problems.push(`missing step ${id}`);
  if (problems.length > 0) return Object.freeze(problems);
  const order: OperatorStep['id'][] = ['GUARD_SHELL', 'VERIFY_SOURCE_COMMIT', 'BUILD_IMAGE', 'PUSH_IMAGE', 'LOCK_TAG', 'VERIFY_TAG_LOCK'];
  for (let i = 1; i < order.length; i += 1) {
    if (index(order[i - 1]!) > index(order[i]!)) problems.push(`${order[i - 1]!} must precede ${order[i]!}`);
  }
  for (const step of steps) {
    const mutating = /az containerapp (create|update|up|revision copy)|az containerapp env storage set/.test(step.command);
    if (mutating && steps.indexOf(step) < index('VERIFY_TAG_LOCK')) {
      problems.push(`${step.id} references the deployment before the tag lock is verified`);
    }
  }
  if (index('GUARD_SHELL') !== 0 || steps[0]?.command !== 'set -euo pipefail') problems.push('the script must start with set -euo pipefail');
  const lock = steps[index('LOCK_TAG')]!.command;
  if (!/--write-enabled false/.test(lock) || !/--delete-enabled false/.test(lock)) {
    problems.push('the lock must set write-enabled false AND delete-enabled false');
  }
  const verify = steps[index('VERIFY_TAG_LOCK')]!.command;
  if (!/"false false"/.test(verify) || !/exit 1/.test(verify)) {
    problems.push('the lock verification must require both attributes false and exit otherwise');
  }
  for (const step of steps) {
    if (/:latest\b/.test(step.command)) problems.push(`${step.id} uses latest`);
  }
  return Object.freeze(problems);
}

/** The sequence as printable lines: a comment per step, then its command. */
export function operatorCommands(params: ContainerAppParams, renderedPath: string): readonly string[] {
  return Object.freeze(
    operatorSteps(params, renderedPath).flatMap((step) => [`# ${step.id}: ${step.comment}`, step.command]),
  );
}

/**
 * THE PUBLIC BINDING PROBES — Phase A's verification that Container Apps delivers the reserved
 * authority and path to the listener unchanged, run BEFORE any provider is pointed at it.
 *
 * Each probe is an UNSIGNED request. The receiver checks Host and path BEFORE it reads the body
 * or any signature, so an unsigned POST to the exact URL is answered 401 ONLY IF the Host the
 * app received equalled the reserved FQDN and the path was preserved; a rewritten Host or path
 * is answered 404. That is why 401 — not 2xx — is the PASS for the first probe, and why no probe
 * can store evidence: nothing unauthenticated is persisted.
 */
export interface BindingProbe {
  readonly name: string;
  readonly method: 'POST' | 'GET';
  /** Appended to `https://<fqdn>` (or `http://` for the plaintext probe). */
  readonly target: string;
  readonly scheme: 'https' | 'http';
  /** A Host header to send instead of the FQDN, or null for the real one. */
  readonly hostOverride: string | null;
  /** The statuses that pass. */
  readonly expect: readonly number[];
  readonly why: string;
}

export function bindingProbePlan(identity: string): readonly BindingProbe[] {
  const parsed = parseIngressIdentity(identity);
  if (!parsed.ok) throw new Error(`not a canonical ingress identity: ${parsed.refusal}`);
  const path = parsed.identity.path;
  return Object.freeze([
    { name: 'EXACT_HOST_AND_PATH_REACHES_RECEIVER', method: 'POST', target: path, scheme: 'https', hostOverride: null, expect: [401], why: '401 proves the app saw Host == reserved FQDN and the exact path; 404 would mean Host or path was rewritten (AZURE CONTAINER APPS INGRESS BINDING BLOCKER)' },
    { name: 'GET_IS_REFUSED', method: 'GET', target: path, scheme: 'https', hostOverride: null, expect: [405], why: 'the one route accepts POST only' },
    { name: 'QUERY_IS_REFUSED', method: 'POST', target: `${path}?probe=1`, scheme: 'https', hostOverride: null, expect: [404], why: 'a query is a different request target' },
    { name: 'TRAILING_SLASH_IS_REFUSED', method: 'POST', target: `${path}/`, scheme: 'https', hostOverride: null, expect: [404], why: 'paths are compared exactly' },
    { name: 'OTHER_PATH_IS_REFUSED', method: 'POST', target: '/health', scheme: 'https', hostOverride: null, expect: [404], why: 'no second route exists' },
    { name: 'ALTERNATE_HOST_IS_REFUSED', method: 'POST', target: path, scheme: 'https', hostOverride: 'not-the-reserved-host.example', expect: [404, 421], why: 'the platform or the receiver must refuse any other authority' },
    { name: 'PLAINTEXT_NEVER_REACHES_RECEIVER', method: 'POST', target: path, scheme: 'http', hostOverride: null, expect: [301, 302, 307, 308, 400, 403, 404], why: 'port 80 must redirect or refuse; a 401 here would mean HTTP reached the receiver' },
  ]);
}

/** The exact `curl` commands for the plan. Each prints only the status code. */
export function renderBindingProbeCommands(identity: string): readonly string[] {
  const parsed = parseIngressIdentity(identity);
  if (!parsed.ok) throw new Error('not a canonical ingress identity');
  const host = parsed.identity.host;
  return Object.freeze(
    bindingProbePlan(identity).map((probe) => {
      const hostHeader = probe.hostOverride === null ? '' : ` -H 'Host: ${probe.hostOverride}'`;
      const body = probe.method === 'POST' ? ` -H 'Content-Type: application/json' --data '[]'` : '';
      return (
        `# ${probe.name}: expect ${probe.expect.join('|')}\n` +
        `curl --silent --output /dev/null --write-out '%{http_code}\\n' --max-redirs 0 -X ${probe.method}` +
        `${hostHeader}${body} '${probe.scheme}://${host}${probe.target}'`
      );
    }),
  );
}

/** Judge observed statuses against the plan. Every probe must pass; a missing result fails. */
export function evaluateBindingProbes(
  plan: readonly BindingProbe[],
  observed: Readonly<Record<string, number>>,
): { readonly pass: boolean; readonly failures: readonly string[] } {
  const failures = plan
    .filter((probe) => !probe.expect.includes(observed[probe.name] ?? -1))
    .map(
      (probe) =>
        `${probe.name}: observed ${String(observed[probe.name] ?? 'nothing')}, expected ${probe.expect.join('|')} — ${probe.why}`,
    );
  return Object.freeze({ pass: failures.length === 0, failures: Object.freeze(failures) });
}
