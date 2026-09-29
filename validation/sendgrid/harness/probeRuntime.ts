import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type {
  AdapterSecretSource,
  SecretResolution,
} from '../../../src/integration/runtime/adapterSecretSource.js';
import type {
  AuditReadSecretSource,
  AuditSecretResolution,
} from '../../../src/audit/provider/runtime/auditSecretSource.js';
import {
  ENV_PROBE_EXPECTED_CREDENTIAL_ID,
  ENV_PROBE_LOCATOR,
  ENV_PROBE_OPERANDS,
  ENV_PROBE_PLANE,
  ENV_PROBE_PROTOCOL_VERSION,
  ENV_PROBE_ROLE,
  ENV_PROBE_SOURCE_MODULE,
  S1P_PROBE_PROTOCOL_VERSION,
  isProbePlane,
  isProbeRole,
  type ProbeOperands,
  type S1PProbePlane,
} from './probeEnvironment.js';
import {
  PROBE_REPLY_PREFIX,
  type ProbeRefusal,
  type ProbeReply,
} from './probeResult.js';
import {
  probeActivityReadCapability,
  sendToProviderSendGridDuplicateProbe,
  sendToProviderSendGridScopeProbe,
} from './scopeProbes.js';

/**
 * THE ONE-SHOT CREDENTIAL PROCESS — `§5` OF THE S1P CORRECTION MANDATE.
 *
 * =================================================================================
 * THIS PROCESS RESOLVES **ONE** CREDENTIAL, ANSWERS **ONE** QUESTION, AND EXITS
 *
 * The coordinator holds no vendor credential. When it needs a fact that only a
 * credential-holding process can establish — "which credential does this locator actually
 * resolve?", "will the provider refuse a send attempted with the audit key?" — it FORKS this
 * module with a seven-key constructed environment carrying ONE locator and ONE source module,
 * reads one sanitized line from stdout, and the process ends.
 *
 * `§5`: "No process used by S1P should need both vendor credentials simultaneously." That is
 * true here structurally, not by convention: `buildProbeEnvironment` has one locator slot, and
 * a process cannot read a path it was not given. `tests/sendgrid/credential-process-isolation.test.ts`
 * asserts it from the CHILD's own reported environment keys rather than from the parent's
 * account of what it passed.
 *
 * =================================================================================
 * WHAT CROSSES BACK, AND WHAT STRUCTURALLY CANNOT
 *
 * ONE LINE on stdout, carrying a `ProbeReply` — identity FACTS, a capability RECORD, or a
 * refusal CODE. `ProbeReply`'s members are enumerated in `probeResult.ts` and NONE of them has
 * a member a secret could occupy, which is the same bound `DispatchResponse` and
 * `ProviderReadResponse` carry on their own wires.
 *
 * The resolved material is used in exactly one expression per role and is never assigned to
 * anything this module returns, logs or prints. Nothing is written to stderr on the success
 * path; an exception's message never crosses (`§23`).
 *
 * =================================================================================
 * `§11` — MODULE CONFINEMENT, RESTATED FOR THIS RUNTIME
 *
 * The source module specifier is TRUSTED LAUNCH CONFIGURATION, and it is still confined: it
 * must resolve inside `validation/sendgrid/`, so a mis-wired or tampered environment cannot
 * make this process load an arbitrary module and call it a secret source. The accepted
 * integration host applies the same rule to its own adapter module for the same reason.
 * =================================================================================
 */

const HERE = dirname(fileURLToPath(import.meta.url));
/** `§11`'s confinement root for a probe's secret-source module. */
export const PROBE_MODULE_ROOT = resolve(HERE, '..');

function withinRoot(candidate: string): boolean {
  const target = resolve(candidate);
  return target === PROBE_MODULE_ROOT || target.startsWith(`${PROBE_MODULE_ROOT}${sep}`);
}

function emit(reply: ProbeReply): void {
  process.stdout.write(`${PROBE_REPLY_PREFIX}${JSON.stringify(reply)}\n`);
}

function refuse(reason: ProbeRefusal): void {
  emit({ kind: 'PROBE_REFUSED', reason });
}

interface IntegrationSourceModule {
  readonly createAdapterSecretSource: (input: {
    readonly adapterId: string;
    readonly locator: string;
  }) => AdapterSecretSource;
}

interface AuditSourceModule {
  readonly createAuditReadSecretSource: (input: {
    readonly providerId: string;
    readonly locator: string;
  }) => AuditReadSecretSource;
}

/** The adapter and provider identities this package serves. Wiring assertions, not selectors. */
const SENDGRID_ADAPTER_ID = 'sendgrid_email';
const SENDGRID_PROVIDER_ID = 'twilio_sendgrid';

/**
 * Resolve THE one credential this process was launched to hold.
 *
 * Returns the resolution and nothing else. The caller reads its identity labels and, for the
 * capability roles, its material — and does so inside one expression, in one place.
 */
async function resolveOne(
  plane: S1PProbePlane,
  sourceModule: string,
  locator: string,
): Promise<SecretResolution | AuditSecretResolution | 'MODULE_UNLOADABLE' | 'MODULE_SHAPE'> {
  let loaded: unknown;
  try {
    loaded = (await import(pathToFileURL(sourceModule).href)) as unknown;
  } catch {
    return 'MODULE_UNLOADABLE';
  }
  if (plane === 'INTEGRATION') {
    const factory = (loaded as Partial<IntegrationSourceModule>).createAdapterSecretSource;
    if (typeof factory !== 'function') return 'MODULE_SHAPE';
    return factory({ adapterId: SENDGRID_ADAPTER_ID, locator }).resolve();
  }
  const factory = (loaded as Partial<AuditSourceModule>).createAuditReadSecretSource;
  if (typeof factory !== 'function') return 'MODULE_SHAPE';
  return factory({ providerId: SENDGRID_PROVIDER_ID, locator }).resolve();
}

export async function runProbe(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<void> {
  if (environment[ENV_PROBE_PROTOCOL_VERSION] !== S1P_PROBE_PROTOCOL_VERSION) {
    refuse('PROTOCOL_VERSION_MISMATCH');
    return;
  }
  const role = environment[ENV_PROBE_ROLE];
  if (!isProbeRole(role)) {
    refuse('ROLE_UNKNOWN');
    return;
  }
  const plane = environment[ENV_PROBE_PLANE];
  if (!isProbePlane(plane)) {
    refuse('PLANE_UNKNOWN');
    return;
  }
  /*
   * `§5.1` — THE ATTEMPTED-WRITE PROBE IS THE AUDIT KEY'S TEST, AND ONLY THE AUDIT KEY'S.
   *
   * `36 §13` asks whether the READ-ONLY credential can write. A `SEND_PROBE` launched on the
   * integration plane would be a deliberate unauthorised send with the send key, which is a
   * different and much worse thing; it is refused before a credential is resolved.
   */
  if (role === 'SEND_PROBE' && plane !== 'AUDIT') {
    refuse('ROLE_NOT_PERMITTED_ON_PLANE');
    return;
  }
  /*
   * `§13` — AND THE DUPLICATE PAIR IS THE SEND KEY'S EXPERIMENT, AND ONLY THE SEND KEY'S.
   *
   * It deliberately produces two accepted messages. Performing it with the AUDIT credential
   * would be attempting a write with a key that must not have one — which is `SEND_PROBE`'s
   * question, asked once, and not something to duplicate.
   */
  if (role === 'DUPLICATE_SEND_PROBE' && plane !== 'INTEGRATION') {
    refuse('ROLE_NOT_PERMITTED_ON_PLANE');
    return;
  }

  const sourceModule = environment[ENV_PROBE_SOURCE_MODULE] ?? '';
  const locator = environment[ENV_PROBE_LOCATOR] ?? '';
  const expectedCredentialId = environment[ENV_PROBE_EXPECTED_CREDENTIAL_ID] ?? '';
  if (sourceModule.length === 0 || !withinRoot(sourceModule)) {
    refuse('SOURCE_MODULE_UNLOADABLE');
    return;
  }

  let operands: ProbeOperands;
  try {
    const parsed = JSON.parse(environment[ENV_PROBE_OPERANDS] ?? '{}') as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      refuse('OPERANDS_MALFORMED');
      return;
    }
    operands = parsed as ProbeOperands;
  } catch {
    refuse('OPERANDS_MALFORMED');
    return;
  }

  const resolution = await resolveOne(plane, sourceModule, locator);
  if (resolution === 'MODULE_UNLOADABLE') {
    refuse('SOURCE_MODULE_UNLOADABLE');
    return;
  }
  if (resolution === 'MODULE_SHAPE') {
    refuse('SOURCE_MODULE_SHAPE_INVALID');
    return;
  }

  if (role === 'IDENTITY') {
    /*
     * THE STAGE-2 ANSWER. NO NETWORK, AND NO MATERIAL ON THE REPLY.
     *
     * `identityProvenance` is the value the SOURCE MECHANISM assigned (correction 3), which is
     * the whole operand of the preflight's material-binding gate. A file-backed source reports
     * `SYNTHETIC_TEST_IDENTITY` here whatever its document claims, and the live run refuses.
     */
    emit({
      kind: 'IDENTITY_FACTS',
      facts: {
        plane,
        resolved: resolution.kind === 'RESOLVED',
        resolvedIdentity:
          resolution.kind === 'RESOLVED' ? resolution.credential.credentialIdentity : null,
        identityProvenance:
          resolution.kind === 'RESOLVED' ? resolution.credential.identityProvenance : null,
        expectedCredentialId,
        identityMatchedExpectation:
          resolution.kind === 'RESOLVED' &&
          expectedCredentialId.length > 0 &&
          resolution.credential.credentialIdentity === expectedCredentialId,
        revoked: resolution.kind === 'CREDENTIAL_REVOKED',
        environmentKeys: Object.keys(process.env).sort(),
        pid: process.pid,
      },
    });
    return;
  }

  if (resolution.kind !== 'RESOLVED') {
    // A capability probe with no credential is `NOT_RUN`, never a pass and never a refusal by
    // the provider — the provider was never asked. `§8.7`.
    emit({
      kind: 'PROBE_RECORD',
      record: {
        operation:
          role === 'SEND_PROBE'
            ? 'POST /v3/mail/send'
            : role === 'DUPLICATE_SEND_PROBE'
              ? 'POST /v3/mail/send x2'
              : 'GET /v3/messages',
        credentialIdentity: expectedCredentialId,
        plane,
        httpStatus: null,
        outcome: 'NOT_RUN',
        note: 'no credential resolved in this process; the provider was not asked',
      },
    });
    return;
  }

  if (role === 'SEND_PROBE') {
    emit({
      kind: 'PROBE_RECORD',
      // PERIMETER_EXEMPT(credential_scope_conformance_probe, 36-13) — the `36 §13`
      // attempted-write test, performed with the AUDIT credential this process alone holds and
      // expected to be REFUSED by the provider. No ACOS effect stands behind it, so it carries
      // no `authorisation_ref` and must not pretend to; the DECLARATION site one file over
      // carries the same annotation and the same reason.
      record: await sendToProviderSendGridScopeProbe({
        auditSecret: resolution.credential.secret,
        auditCredentialIdentity: resolution.credential.credentialIdentity,
        correlationTag: operands.correlationTag ?? '',
        senderAddress: operands.senderAddress ?? '',
        sinkAddress: operands.sinkAddress ?? '',
      }),
    });
    return;
  }

  if (role === 'DUPLICATE_SEND_PROBE') {
    emit({
      kind: 'PROBE_RECORD',
      // PERIMETER_EXEMPT(duplicate_negative_control, S1P-11) — `§11`'s deliberate two-send
      // experiment, behind a SECOND operator acknowledgement, to the owner's own sink. It
      // exists so the `I36` oracle can be shown to SEE two accepted messages, and it carries
      // no `authorisation_ref` because ACOS authorised neither send.
      record: await sendToProviderSendGridDuplicateProbe({
        secret: resolution.credential.secret,
        credentialIdentity: resolution.credential.credentialIdentity,
        correlationTag: operands.correlationTag ?? '',
        senderAddress: operands.senderAddress ?? '',
        sinkAddress: operands.sinkAddress ?? '',
      }),
    });
    return;
  }

  emit({
    kind: 'PROBE_RECORD',
    record: await probeActivityReadCapability({
      secret: resolution.credential.secret,
      credentialIdentity: resolution.credential.credentialIdentity,
      plane,
      periodStartMs: operands.periodStartMs ?? 0,
      periodEndMs: operands.periodEndMs ?? 0,
    }),
  });
}
