import { createHash } from 'node:crypto';

import {
  evaluatePreliveReadiness,
  type EnvironmentSource,
  type PreliveResult,
} from '../prelive/preliveGate.js';
import {
  POSTMARK_CAPABILITY_RECORD,
  em6Qualifies,
  type ProviderCapabilityRecord,
} from './capabilityRecord.js';

/**
 * `acos verify:postmark-sandbox` — THE S1M PROVIDER-SANDBOX READINESS GATE.
 *
 * =================================================================================
 * `§52`: IT MUST FAIL CLEARLY AND IT MUST NOT SILENTLY SKIP
 *
 * "It must fail/abort clearly if credentials are absent. It must not silently SKIP."
 *
 * So this module has no skip path, no conditional describe, no "credentials not configured,
 * nothing to do" branch and no exit code that means "inapplicable". It returns exactly one
 * of two statuses, and `cli.ts` exits non-zero on anything but the first.
 *
 * =================================================================================
 * IT MAKES NO NETWORK CALL, AND THAT IS NOT A CONVENIENCE
 *
 * `§37` lists eight things that must ALL hold before a real S1M external effect, and the
 * first four are local. The last four are about a provider. THIS GATE EVALUATES THE LOCAL
 * ONES AND REFUSES ON THE REST, rather than reaching a provider to find out — because the
 * mechanism that would let it reach one legally does not exist yet, which is itself one of
 * the findings below.
 *
 * There is no `fetch`, no HTTP client, no socket, no vendor SDK and no API origin in this
 * directory, and `tests/postmark/postmark-tooling-boundary.test.ts` asserts each as an
 * absence. `§30`: the production API origin "must come from closed trusted adapter
 * configuration", so this gate REFUSES an environment-supplied origin rather than honouring
 * one.
 *
 * =================================================================================
 * IT READS CREDENTIAL PRESENCE AND NEVER A CREDENTIAL VALUE — `§29`
 *
 * `§29` requires that the token never appear in a journal, a row, a payload, worker output,
 * an exception, an incident or a log. `credentialPresence` below returns a BOOLEAN and a
 * digest, the digest exists only so two slots can be compared for distinctness, and the
 * rendered report contains neither. `renderPostmarkGateResult` has no path that can print a
 * value read from the environment.
 * =================================================================================
 */

/** `§3`'s deployment declaration. The variable the mandate names, and the only value it may hold. */
export const EXPECTED_DELIVERY_TYPE_KEY = 'POSTMARK_EXPECTED_DELIVERY_TYPE';
export const REQUIRED_DELIVERY_TYPE = 'Sandbox';

/** `§7`'s two independently configured credential slots. Presence is read; a value never is. */
export const CONTROL_SEND_CREDENTIAL_KEY = 'ACOS_POSTMARK_SANDBOX_SERVER_TOKEN';
export const AUDIT_READ_CREDENTIAL_KEY = 'ACOS_AUDIT_POSTMARK_SANDBOX_SERVER_TOKEN';

/**
 * `§3` and `§45`: configuration that could select a live server, and `§30`: a
 * caller-supplied API origin. EACH IS A REFUSAL RATHER THAN A WARNING.
 *
 * `§45`: "Do not make `allowLive=true` a casual configuration toggle." The toggle is not
 * casual here because it does not enable anything — its PRESENCE, at any value, is a
 * finding. A future owner-reviewed slice that genuinely enables a live server removes this
 * row in a commit somebody reads.
 */
export const REFUSED_CONFIGURATION_KEYS: readonly { readonly key: string; readonly why: string }[] =
  Object.freeze([
    Object.freeze({
      key: 'POSTMARK_ALLOW_LIVE',
      why: 'a live-server enablement toggle is present; S1M enables no live configuration (§45)',
    }),
    Object.freeze({
      key: 'POSTMARK_LIVE_SERVER_TOKEN',
      why: 'a live server token is configured; S1M permits a sandbox server only (§3)',
    }),
    Object.freeze({
      key: 'POSTMARK_ACCOUNT_TOKEN',
      why:
        'an account-level token is configured; it can create and alter servers, so it is a ' +
        'path from a sandbox deployment to a live one (§3)',
    }),
    Object.freeze({
      key: 'POSTMARK_API_BASE_URL',
      why:
        'an API origin is supplied through configuration; §30 requires the production origin ' +
        'to come from closed trusted adapter configuration and forbids arbitrary base-URL ' +
        'selection reaching production',
    }),
  ]);

/**
 * THE ARCHITECTURE PRECONDITIONS S1M CANNOT CLEAR, DECLARED AS A CLOSED LIST.
 *
 * =================================================================================
 * WHY THESE ARE DATA RATHER THAN PROSE IN A DOCUMENT
 *
 * `37 §2` assigns `I24` and `I25` to **S2** and the four integration-plane adapters to
 * **S3**. The repository is at S1. So the mechanism S1M was told to "use" — `§6`: "Use the
 * current credential-broker/adapter credential boundary" — is not a mechanism that has been
 * built yet, and `§6`'s own instruction for that case is to return PARTIAL rather than to
 * invent a shortcut.
 *
 * Holding them HERE, as rows with slice attributions, means a later slice cannot become
 * ready by accident: it has to delete a row, in a commit somebody reads, and
 * `tests/postmark/postmark-gate.test.ts` asserts the gate is NOT_READY while any row stands.
 * That is the same discipline `tools/control-release/inventory.ts` applies to `50 §6`.
 * =================================================================================
 */
export const OPEN_ARCHITECTURE_PRECONDITIONS: readonly {
  readonly code: string;
  readonly detail: string;
  readonly owningSlice: string;
}[] = Object.freeze([
  Object.freeze({
    code: 'EXTERNAL_WRITE_PERIMETER_UNENFORCED',
    detail:
      'I24 requires every external-vendor HTTP call site to carry an authorisation_ref or an ' +
      'annotated PERIMETER_EXEMPT, enforced by CI and by a runtime assertion (48 §4 items 2 ' +
      'and 3). Neither the CI check nor the runtime assertion exists, so the first real ' +
      'vendor call site would be created ahead of the mechanism that governs vendor call sites',
    owningSlice: 'S2',
  }),
  Object.freeze({
    code: 'CONTROL_PLANE_VENDOR_CREDENTIAL_RULE_UNENFORCED',
    detail:
      'I25 requires that no process in the control plane hold a vendor credential, checked ' +
      'against the control-plane image and its injected environment (48 §4 item 4). No such ' +
      'check exists, and the Effect Gateway invokes an adapter in its own process, so an ' +
      'in-process adapter holding a provider token would place a vendor credential inside ' +
      'the control plane',
    owningSlice: 'S2',
  }),
  Object.freeze({
    code: 'INTEGRATION_PLANE_RUNTIME_ABSENT',
    detail:
      '48 §2 row 2 places the communications adapter in the integration plane, and 23 §7 ' +
      'requires per-adapter runtime isolation — one adapter cannot read another secret from ' +
      'its own environment or filesystem — with per-adapter secrets held in the platform ' +
      'secret manager and no credential broker (23 §11). The repository has one runtime and ' +
      'no integration plane, so there is no architecture-legal place for a provider token',
    owningSlice: 'S3',
  }),
]);

export type PostmarkGateStatus =
  /** Every local S1M prerequisite passed. Nothing about a provider is claimed. */
  | 'READY_FOR_POSTMARK_SANDBOX_VALIDATION'
  | 'NOT_READY';

export interface PostmarkGateFinding {
  readonly code: string;
  readonly detail: string;
}

export interface PostmarkGateResult {
  readonly status: PostmarkGateStatus;
  /**
   * Whether production's adapter registry could be read at all. It cannot be read before
   * `50 §3f` occasion 1 has run, which is a property of the architecture rather than of
   * this tool — see `readAdapterRegistry` below.
   */
  readonly adapterRegistryReadable: boolean;
  readonly prelive: PreliveResult;
  readonly capability: ProviderCapabilityRecord;
  readonly em6Qualifies: boolean;
  readonly declaredDeliveryType: string | null;
  readonly controlCredentialPresent: boolean;
  readonly auditCredentialPresent: boolean;
  readonly credentialSlotsDistinct: boolean | null;
  readonly registeredAdapterIds: readonly string[];
  readonly findings: readonly PostmarkGateFinding[];
}

interface CredentialPresence {
  readonly present: boolean;
  /** SHA-256 of the configured value, used ONLY to compare two slots. Never rendered. */
  readonly digest: string | null;
}

function credentialPresence(source: EnvironmentSource, key: string): CredentialPresence {
  const value = source[key];
  if (value === undefined || value === '') return { present: false, digest: null };
  return { present: true, digest: createHash('sha256').update(value, 'utf8').digest('hex') };
}

/**
 * Read production's adapter registry — LAZILY, AND ONLY AFTER THE BUNDLE CHECK.
 *
 * =================================================================================
 * WHY THIS IS A DYNAMIC IMPORT AND NOT A STATIC ONE
 *
 * `adapterRegistry.ts` builds `EMPTY_ADAPTER_REGISTRY` at module evaluation, and building
 * one reads the action catalogue, which `50 §3f` binds to the ACTIVE VERIFIED BUNDLE. So a
 * static import of that module raises `NO_ACTIVE_VERIFIED_BUNDLE` at import time, before any
 * code in this file runs — which would make the gate CRASH with a stack trace instead of
 * REPORTING, on exactly the deployment that most needs a report.
 *
 * That is the architecture behaving correctly (`50 §3f`: "external claim and dispatch cannot
 * proceed if the verified bundle is unavailable or invalid"), so the gate accommodates it
 * rather than working around it: the import happens after the pre-live check has run, and a
 * failure to read is itself a finding rather than an exception.
 *
 * The catch is deliberately broad and deliberately silent. `50 §3f`'s refusal carries a
 * reason code and a detail, and the detail is about control-artifact integrity rather than
 * about Postmark; the gate reports the CONSEQUENCE — no adapter is reachable — and leaves
 * the integrity diagnosis to the pre-live rows above, which already carry it.
 * =================================================================================
 */
async function readAdapterRegistry(): Promise<{
  readonly readable: boolean;
  readonly registeredIds: readonly string[];
}> {
  try {
    const { EMPTY_ADAPTER_REGISTRY } = await import('../../src/kernel/gateway/adapterRegistry.js');
    return { readable: true, registeredIds: EMPTY_ADAPTER_REGISTRY.registeredIds };
  } catch {
    return { readable: false, registeredIds: [] };
  }
}

/**
 * Evaluate LOCAL evidence only. No network, no vendor call, no credential test.
 *
 * `§39` of the S1L mandate constrained the pre-live gate the same way and this gate inherits
 * it by composing that gate rather than by re-deciding it: `evaluatePreliveReadiness` runs
 * each plane's own bootstrap through that plane's own trust boundary, and this function adds
 * `§37`'s S1M-specific rows on top without reinterpreting any of them.
 */
export async function evaluatePostmarkSandboxReadiness(
  source: EnvironmentSource = process.env,
  capability: ProviderCapabilityRecord = POSTMARK_CAPABILITY_RECORD,
): Promise<PostmarkGateResult> {
  const findings: PostmarkGateFinding[] = [];

  // ---------------------------------------------------------------------------------
  // `§37` rows 1 to 5 — the control-artifact release readiness, unchanged and NOT re-judged.
  // ---------------------------------------------------------------------------------
  const prelive = evaluatePreliveReadiness(source);
  if (prelive.status !== 'READY_FOR_PROVIDER_SANDBOX_CONFIGURATION') {
    for (const finding of prelive.findings) {
      findings.push({ code: `PRELIVE_${finding.code}`, detail: finding.detail });
    }
  }

  // ---------------------------------------------------------------------------------
  // `§3` — THE SANDBOX DECLARATION, FAIL-CLOSED.
  //
  // "At minimum require an explicit deployment configuration declaring
  // POSTMARK_EXPECTED_DELIVERY_TYPE=Sandbox and fail closed if provider evidence indicates
  // otherwise." An absent declaration is a refusal and never a default: `§35` — "Do not
  // silently trust a variable named sandbox if a Live token can still send."
  // ---------------------------------------------------------------------------------
  const declaredDeliveryType = source[EXPECTED_DELIVERY_TYPE_KEY] ?? null;
  if (declaredDeliveryType === null || declaredDeliveryType === '') {
    findings.push({
      code: 'PROVIDER_DELIVERY_TYPE_UNDECLARED',
      detail: `${EXPECTED_DELIVERY_TYPE_KEY} is not declared; S1M has no default and refuses`,
    });
  } else if (declaredDeliveryType !== REQUIRED_DELIVERY_TYPE) {
    findings.push({
      code: 'PROVIDER_DELIVERY_TYPE_NOT_SANDBOX',
      detail:
        `${EXPECTED_DELIVERY_TYPE_KEY} declares a delivery type other than ` +
        `${REQUIRED_DELIVERY_TYPE}; S1M permits a sandbox server only (§3, §45)`,
    });
  }

  for (const refused of REFUSED_CONFIGURATION_KEYS) {
    if (source[refused.key] !== undefined && source[refused.key] !== '') {
      findings.push({ code: 'REFUSED_CONFIGURATION_PRESENT', detail: refused.why });
    }
  }

  // ---------------------------------------------------------------------------------
  // `§6`, `§7`, `§27` — TWO CREDENTIAL SLOTS, INDEPENDENTLY CONFIGURED.
  //
  // Presence only. The values are never rendered, never logged and never returned.
  // ---------------------------------------------------------------------------------
  const control = credentialPresence(source, CONTROL_SEND_CREDENTIAL_KEY);
  const audit = credentialPresence(source, AUDIT_READ_CREDENTIAL_KEY);
  if (!control.present) {
    findings.push({
      code: 'CONTROL_SEND_CREDENTIAL_ABSENT',
      detail: `${CONTROL_SEND_CREDENTIAL_KEY} is not configured`,
    });
  }
  if (!audit.present) {
    findings.push({
      code: 'AUDIT_READ_CREDENTIAL_ABSENT',
      detail: `${AUDIT_READ_CREDENTIAL_KEY} is not configured`,
    });
  }
  const credentialSlotsDistinct =
    control.digest !== null && audit.digest !== null ? control.digest !== audit.digest : null;
  if (credentialSlotsDistinct === false) {
    findings.push({
      code: 'AUDIT_CREDENTIAL_NOT_INDEPENDENT',
      detail:
        'the audit read slot holds the same credential as the control send slot; §27 requires ' +
        'the audit plane to perform its own provider request rather than borrow the dispatch ' +
        'credential, and 30 §5 / 48 §3.6 make that independence the basis of the audit ' +
        'plane read-only exemption',
    });
  }

  // ---------------------------------------------------------------------------------
  // `§14` — EM6 QUALIFICATION, FROM THE RECORD RATHER THAN FROM AN ADAPTER ANNOTATION.
  //
  // `36 §7` / `I26`: an adapter DECLARING a capability is an assertion to be measured, not a
  // fact. The record is the evidence; `em6Qualifies` is `25 §7`'s disjunction applied to it.
  // ---------------------------------------------------------------------------------
  const qualifies = em6Qualifies(capability);
  if (!qualifies) {
    findings.push({
      code: 'PROVIDER_EM6_UNQUALIFIED',
      detail:
        'the capability record nominates no primitive that it also declares present; 25 §7 ' +
        'disqualifies a provider offering neither an idempotency header nor a delivery-event ' +
        'webhook nor a queryable message log from serving an IRRECOVERABLE class',
    });
  }

  // ---------------------------------------------------------------------------------
  // `§7` — THE PROVIDER'S OWN CREDENTIAL-SCOPING LIMITATION, DERIVED AND NOT ASSUMED.
  //
  // `36 §13`'s replica-read test: "assert [...] that its vendor credentials are read-only —
  // attempt a write against each and assert vendor-side failure." A credential that cannot
  // fail that attempt cannot pass that test, and `48 §2` row 13's exemption is justified by
  // the word "Reads only".
  // ---------------------------------------------------------------------------------
  if (!capability.credentialScoping.readOnlyApiTokenAvailable) {
    findings.push({
      code: 'AUDIT_PROVIDER_READ_CREDENTIAL_NOT_LEAST_PRIVILEGE',
      detail:
        `${capability.provider} publishes no read-only API credential: ` +
        `${capability.credentialScoping.detail}. An audit-plane slot can therefore be ` +
        'independently provisioned but not least-privilege, so the 36 §13 replica-read test ' +
        'cannot pass and the 48 §2 row 13 read-only exemption is not earned',
    });
  }

  // ---------------------------------------------------------------------------------
  // `§8` — THE SOLE WRITE ENTRY, CHECKED MECHANICALLY.
  //
  // `48 §2` row 2's communications adapter. Production's registry is the one place a
  // dispatchable adapter can come from, and while it is empty `resolveAdapterFor` refuses
  // every effect — so the gate reports the absence rather than inferring readiness from a
  // configuration variable.
  // ---------------------------------------------------------------------------------
  const registry = await readAdapterRegistry();
  const registeredAdapterIds = registry.registeredIds;
  if (registeredAdapterIds.length === 0) {
    findings.push({
      code: 'COMMUNICATIONS_ADAPTER_ABSENT',
      detail: registry.readable
        ? 'production adapter registry is empty, so the Effect Gateway resolves no adapter ' +
          'for any effect and no external write can leave by any path (48 §2 row 2)'
        : 'production adapter registry could not be read because no verified control-artifact ' +
          'bundle is active; 50 §3f refuses external claim and dispatch without one, so no ' +
          'external write can leave by any path',
    });
  }

  for (const precondition of OPEN_ARCHITECTURE_PRECONDITIONS) {
    findings.push({
      code: precondition.code,
      detail: `${precondition.detail} [owning slice ${precondition.owningSlice}]`,
    });
  }

  return Object.freeze({
    status: findings.length === 0 ? 'READY_FOR_POSTMARK_SANDBOX_VALIDATION' : 'NOT_READY',
    adapterRegistryReadable: registry.readable,
    prelive,
    capability,
    em6Qualifies: qualifies,
    declaredDeliveryType,
    controlCredentialPresent: control.present,
    auditCredentialPresent: audit.present,
    credentialSlotsDistinct,
    registeredAdapterIds,
    findings: Object.freeze(findings),
  });
}

/**
 * `§46` — WHAT AN OPERATOR MUST PROVIDE, STATED WITHOUT ASKING FOR IT HERE.
 *
 * "State exactly what the operator must provide: sandbox server token; required read token
 * if separate; server ID where needed; WITHOUT ASKING FOR THEM IN SOURCE CODE OR CHAT LOGS."
 *
 * So this list names the SLOTS and never a value, and nothing in this repository reads one.
 */
export const OPERATOR_REQUIREMENTS: readonly string[] = Object.freeze([
  `${EXPECTED_DELIVERY_TYPE_KEY}=${REQUIRED_DELIVERY_TYPE}, declared by the deployment`,
  `${CONTROL_SEND_CREDENTIAL_KEY} — a server token belonging to a Postmark SANDBOX server`,
  `${AUDIT_READ_CREDENTIAL_KEY} — a SECOND, separately provisioned server token for the audit plane`,
  'the control-plane and audit-plane control-artifact trust variables from deployment.json',
]);

export function renderPostmarkGateResult(result: PostmarkGateResult): string {
  const out: string[] = [];
  out.push('ACOS S1M — POSTMARK SANDBOX VALIDATION READINESS');
  out.push('');
  out.push('LOCAL EVIDENCE ONLY. No network call, no vendor call, no credential test.');
  out.push('This gate says nothing about I36, I20 or I8, and closes none of them.');
  out.push('');
  out.push(`provider                 : ${result.capability.provider}`);
  out.push(`environment required     : ${result.capability.environmentClassification}`);
  out.push(
    `sandbox proof mechanism  : ${result.capability.classificationProof.method} -> ` +
      `${result.capability.classificationProof.field} == ` +
      `${result.capability.classificationProof.acceptedValue}`,
  );
  out.push(`capability evidence date : ${result.capability.retrievedOn}`);
  out.push(`EM6 qualifying primitive : ${result.capability.qualifyingPrimitive}`);
  out.push(`EM6 qualifies            : ${String(result.em6Qualifies)}`);
  out.push('');
  out.push(`control plane verified   : ${String(result.prelive.control.verified)}`);
  out.push(`audit plane verified     : ${String(result.prelive.audit.verified)}`);
  out.push(`manifest identities equal: ${String(result.prelive.manifestIdentitiesEqual)}`);
  out.push(`active manifest          : ${result.prelive.control.manifestId ?? '(none)'}`);
  out.push('');
  out.push(`declared delivery type   : ${result.declaredDeliveryType ?? '(undeclared)'}`);
  out.push(`control send credential  : ${result.controlCredentialPresent ? 'present' : 'absent'}`);
  out.push(`audit read credential    : ${result.auditCredentialPresent ? 'present' : 'absent'}`);
  out.push(
    `credential slots distinct: ${
      result.credentialSlotsDistinct === null
        ? 'not comparable — a slot is empty'
        : String(result.credentialSlotsDistinct)
    }`,
  );
  out.push(
    `registered adapters      : ${
      !result.adapterRegistryReadable
        ? '(unreadable — no active verified bundle)'
        : result.registeredAdapterIds.length === 0
          ? '(none)'
          : result.registeredAdapterIds.join(', ')
    }`,
  );
  out.push('');
  out.push(`RESULT: ${result.status}`);
  out.push('');
  if (result.status === 'READY_FOR_POSTMARK_SANDBOX_VALIDATION') {
    out.push('Every local S1M prerequisite passed. This is the ONLY claim made.');
    return out.join('\n');
  }
  out.push('BLOCKING FINDINGS');
  for (const finding of result.findings) {
    out.push(`  - ${finding.code}`);
    out.push(`      ${finding.detail}`);
  }
  out.push('');
  out.push('WHAT AN OPERATOR MUST PROVIDE (names only — never supply a value here)');
  for (const requirement of OPERATOR_REQUIREMENTS) {
    out.push(`  - ${requirement}`);
  }
  out.push('');
  out.push('Findings attributed to a later slice are not configuration problems. They are');
  out.push('mechanisms this repository has not built, and no environment variable clears them.');
  return out.join('\n');
}
