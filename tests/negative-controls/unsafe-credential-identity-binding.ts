import { createHash } from 'node:crypto';

import {
  DISPATCH_RESPONSE_KIND,
  REQUEST_REFUSED_KIND,
  INTEGRATION_PROTOCOL_VERSION,
  computeRequestBindingDigest,
  decodeDispatchRequest,
  type WireOutcome,
} from '../../src/integration/protocol/wire.js';
import type {
  HostReply,
  IntegrationRuntimeConfiguration,
} from '../../src/integration/runtime/integrationHost.js';
import type {
  AdapterInvocation,
  ProviderBoundary,
} from '../../src/integration/runtime/integrationAdapter.js';
import {
  AUDIT_READ_PROTOCOL_VERSION,
  PROVIDER_READ_REFUSED_KIND,
  PROVIDER_READ_RESPONSE_KIND,
  decodeProviderReadRequest,
} from '../../src/audit/provider/protocol/readWire.js';
import type {
  AuditHostReply,
  AuditReaderConfiguration,
} from '../../src/audit/provider/runtime/auditReadHost.js';
import type { AuditReaderDescriptor } from '../../src/audit/provider/plane/auditReaderRegistry.js';
import type { AdapterRuntimeDescriptor } from '../../src/integration/control/adapterRuntimeRegistry.js';

/**
 * S1O CORRECTION — VULNERABLE CONTROLS 13–15: THE CREDENTIAL-IDENTITY BINDING.
 *
 * **TEST-ONLY. NOTHING HERE IS PRODUCTION CODE AND NOTHING HERE IS EXPORTED FROM `src/`.**
 *
 * =================================================================================
 * THE DEFECT THESE THREE ARE ABOUT
 *
 * The first S1O candidate built two chains that never met:
 *
 *     signed class-5 `credential_id`  ->  `credential_risk_class`  ->  the registry admits
 *     `secretLocator`                 ->  resolved material        ->  presented at a provider
 *
 * Nothing compared the ends. A locator repointed at another credential produced a runtime
 * whose SIGNED RISK DECLARATION GOVERNED A CREDENTIAL IT WAS NOT HOLDING, and every other
 * check on the path passed — the descriptor was well formed, the adapter was in the
 * catalogue, the signed record existed and said what it said, the authorisation was bound,
 * the payload hashed.
 *
 * `50 §2g` field 1 now defines `credential_id` as the identity of the exact material the
 * runtime may present, and both planes compare the signed expectation to what their own
 * secret source resolved, before the provider boundary. These three functions are the
 * implementations that DO NOT, so the production refusals have something to discriminate
 * against.
 *
 * **CONTROL 15 IS THE SUBTLE ONE.** It does perform a comparison, and the comparison is of
 * the wrong operands: it compares LOCATORS and treats inequality as proof that two runtimes
 * hold different credentials. Two locators may name one credential; one locator may be
 * repointed at another. Locator isolation and identity binding are different controls, and
 * the production code keeps both.
 * =================================================================================
 */

/* ================================================================================
 * CONTROL 13 — THE INTEGRATION RUNTIME THAT NEVER ASKS WHICH CREDENTIAL IT HOLDS
 * ============================================================================== */

/**
 * The production host with GUARD 7 REMOVED, and nothing else changed.
 *
 * =================================================================================
 * WHY IT IS A COPY RATHER THAN A FLAG ON THE REAL HOST
 *
 * A boolean option on `handleDispatchRequest` would make the production host contain the
 * unsafe path, which is the shape `29 §3.1` objects to one level up: a component enforcing a
 * restriction on itself. This is a separate implementation of the same seven steps, missing
 * exactly one — and "exactly one" is what makes the paired assertion in
 * `credential-identity-binding.test.ts` a discrimination rather than a comparison of two
 * different programs.
 *
 * **THE ATTACK IT ADMITS**, stated concretely and exercised by the test:
 *
 *     descriptor          credentialId `mock_ads.pause_only`
 *     signed class-5      NON_MONETARY_WRITE, granted [campaign.pause, campaign.read]
 *     registry            ADMITS — not MONEY_MOVING, so option A still applies
 *     secret source       resolves material identified `mock_ads.budget_manage`
 *     signed class-5      MONEY_MOVING, granted [campaign.budget.set, ...]
 *
 * This host dispatches. ADR-024's option-B trigger has been crossed by a credential the
 * deployment is actually holding, and the registry's refusal never fired because the
 * registry read the record for the OTHER credential.
 */
export async function unsafeHandleWithoutCredentialIdentityBinding(
  configuration: IntegrationRuntimeConfiguration,
  raw: unknown,
): Promise<HostReply> {
  const decoded = decodeDispatchRequest(raw);
  if (decoded.kind === 'REFUSED') {
    return {
      protocolVersion: INTEGRATION_PROTOCOL_VERSION,
      kind: REQUEST_REFUSED_KIND,
      invocationId: null,
      reason: decoded.reason,
    };
  }
  const request = decoded.message;

  if (
    request.adapterId !== configuration.adapterId ||
    configuration.adapter.adapterId !== configuration.adapterId ||
    configuration.secretSource.declaredAdapterId !== configuration.adapterId
  ) {
    return {
      protocolVersion: INTEGRATION_PROTOCOL_VERSION,
      kind: REQUEST_REFUSED_KIND,
      invocationId: request.invocationId,
      reason: 'ADAPTER_IDENTITY_MISMATCH',
    };
  }
  if (request.authorisationRef.trim().length === 0) {
    return {
      protocolVersion: INTEGRATION_PROTOCOL_VERSION,
      kind: REQUEST_REFUSED_KIND,
      invocationId: request.invocationId,
      reason: 'AUTHORISATION_REF_MISSING',
    };
  }
  if (computeRequestBindingDigest(request) !== request.bindingDigest) {
    return {
      protocolVersion: INTEGRATION_PROTOCOL_VERSION,
      kind: REQUEST_REFUSED_KIND,
      invocationId: request.invocationId,
      reason: 'AUTHORISATION_BINDING_MISMATCH',
    };
  }
  const payloadBytes = Buffer.from(request.dispatchPayloadBase64, 'base64');
  if (createHash('sha256').update(payloadBytes).digest('hex') !== request.dispatchPayloadHash) {
    return {
      protocolVersion: INTEGRATION_PROTOCOL_VERSION,
      kind: REQUEST_REFUSED_KIND,
      invocationId: request.invocationId,
      reason: 'PAYLOAD_HASH_MISMATCH',
    };
  }

  const resolution = await configuration.secretSource.resolve();
  if (resolution.kind !== 'RESOLVED') {
    return {
      protocolVersion: INTEGRATION_PROTOCOL_VERSION,
      kind: REQUEST_REFUSED_KIND,
      invocationId: request.invocationId,
      reason:
        resolution.kind === 'CREDENTIAL_REVOKED' ? 'CREDENTIAL_REVOKED' : 'CREDENTIAL_UNAVAILABLE',
    };
  }
  const credential = resolution.credential;

  /*
   * THE VIOLATION, AND IT IS AN OMISSION RATHER THAN A WRONG LINE.
   *
   * `configuration.expectedCredentialId` is in scope, populated, and correct. This host
   * simply never reads it, which is what the defect looked like: the echo was not missing,
   * the comparison was.
   */

  const invocation: AdapterInvocation = {
    adapterId: request.adapterId,
    method: request.method,
    actionClass: request.actionClass,
    recoverability: request.recoverability,
    authorisationRef: request.authorisationRef,
    companyId: request.companyId,
    effectId: request.effectId,
    outboxId: request.outboxId,
    claimId: request.claimId,
    idempotencyKey: request.idempotencyKey,
    correlationTag: request.correlationTag,
    resourceRef: request.resourceRef,
    requiresUnmirroredTag: request.requiresUnmirroredTag,
    overrideRef: request.overrideRef,
    dispatchPayloadHash: request.dispatchPayloadHash,
    dispatchPayloadBytes: payloadBytes,
    credential,
  };

  let crossed = false;
  const boundary: ProviderBoundary = {
    markProviderClientCrossed: (): void => {
      crossed = true;
    },
  };

  let outcome: WireOutcome;
  try {
    outcome = await configuration.adapter.invoke(invocation, boundary);
  } catch {
    outcome = crossed
      ? { kind: 'OUTCOME_UNKNOWN', reason: 'AMBIGUOUS' }
      : { kind: 'ADAPTER_FAILED', failureClass: 'ADAPTER_THREW_PRE_SEND' };
  }

  return {
    protocolVersion: INTEGRATION_PROTOCOL_VERSION,
    kind: DISPATCH_RESPONSE_KIND,
    invocationId: request.invocationId,
    adapterId: request.adapterId,
    outcome,
    credentialIdentity: credential.credentialIdentity,
    credentialVersion: credential.version,
  };
}

/* ================================================================================
 * CONTROL 14 — THE AUDIT READER THAT NEVER ASKS WHICH CREDENTIAL IT HOLDS
 * ============================================================================== */

/**
 * The production audit host with GUARD 7 REMOVED, and nothing else changed.
 *
 * =================================================================================
 * THE ATTACK IT ADMITS IS THE MIRROR IMAGE, AND IT IS WORSE
 *
 *     descriptor          credentialId `synthetic_esp.audit_read`
 *     signed class-5      audit_plane-scoped, READ_ONLY, external_mutation_capable false
 *     registry            ADMITS — correctly, on a correct record
 *     risk-class echo     READ_ONLY — correctly
 *     locator             not one the integration plane holds — correctly
 *     secret source       resolves a SEND-CAPABLE token
 *
 * Every control on this plane passes and the reader queries the provider with material
 * nobody classified. `48 §3.6`'s read-only exemption — the reason an audit-plane vendor read
 * carries no `authorisation_ref` — would be resting on a declaration about a different
 * credential, and the plane whose job is to catch the control plane lying would be the one
 * holding an unclassified write capability.
 */
export async function unsafeHandleWithoutAuditIdentityBinding(
  configuration: AuditReaderConfiguration,
  raw: unknown,
): Promise<AuditHostReply> {
  const decoded = decodeProviderReadRequest(raw);
  if (decoded.kind === 'REFUSED') {
    return {
      protocolVersion: AUDIT_READ_PROTOCOL_VERSION,
      kind: PROVIDER_READ_REFUSED_KIND,
      readId: '',
      reason: decoded.reason,
    };
  }
  const request = decoded.message;

  if (
    request.providerId !== configuration.providerId ||
    configuration.reader.providerId !== configuration.providerId ||
    configuration.secretSource.declaredProviderId !== configuration.providerId
  ) {
    return {
      protocolVersion: AUDIT_READ_PROTOCOL_VERSION,
      kind: PROVIDER_READ_REFUSED_KIND,
      readId: request.readId,
      reason: 'PROVIDER_IDENTITY_MISMATCH',
    };
  }
  if (configuration.credentialRiskClass !== 'READ_ONLY') {
    return {
      protocolVersion: AUDIT_READ_PROTOCOL_VERSION,
      kind: PROVIDER_READ_REFUSED_KIND,
      readId: request.readId,
      reason: 'CREDENTIAL_NOT_READ_ONLY',
    };
  }

  const resolution = await configuration.secretSource.resolve();
  if (resolution.kind !== 'RESOLVED') {
    return {
      protocolVersion: AUDIT_READ_PROTOCOL_VERSION,
      kind: PROVIDER_READ_REFUSED_KIND,
      readId: request.readId,
      reason: 'CREDENTIAL_UNAVAILABLE',
    };
  }

  // THE VIOLATION: `configuration.expectedCredentialId` is in scope and never read.

  const result = await configuration.reader.readFromProvider(resolution.credential, {
    operation: request.operation,
    periodStartMs: request.periodStartMs,
    periodEndMs: request.periodEndMs,
    correlationTag: request.correlationTag,
    providerMessageId: request.providerMessageId,
    maxRecords: request.maxRecords,
  });
  if (result.kind === 'PROVIDER_UNAVAILABLE') {
    return {
      protocolVersion: AUDIT_READ_PROTOCOL_VERSION,
      kind: PROVIDER_READ_REFUSED_KIND,
      readId: request.readId,
      reason: 'PROVIDER_UNAVAILABLE',
    };
  }
  return {
    protocolVersion: AUDIT_READ_PROTOCOL_VERSION,
    kind: PROVIDER_READ_RESPONSE_KIND,
    readId: request.readId,
    operation: request.operation,
    records: result.records,
    recordCount: result.recordCount,
    credentialIdentity: resolution.credential.credentialIdentity,
    providerQueriedAtMs: 0,
  };
}

/* ================================================================================
 * CONTROL 15 — LOCATOR INEQUALITY TREATED AS PROOF OF CREDENTIAL SEPARATION
 * ============================================================================== */

/**
 * "The two runtimes read different locators, therefore they hold different credentials."
 *
 * =================================================================================
 * THE ARGUMENT IS PLAUSIBLE, WHICH IS WHY IT NEEDS A CONTROL
 *
 * `createAuditReaderRegistry` really does refuse a descriptor whose `secretLocator` is one
 * the integration plane holds, and that check really does implement `§13`'s "not the same
 * secret source as the send credential". The mistake is reading it as more than it is.
 *
 * A LOCATOR SAYS WHERE TO LOOK. AN IDENTITY SAYS WHAT WAS FOUND.
 *
 *   two locators, one credential    `/secrets/audit.json` and `/secrets/audit-alias.json`
 *                                   may both resolve the SAME provider key. Locator
 *                                   inequality holds; separation does not.
 *   one locator, two credentials    the file at `/secrets/audit.json` may be rewritten to
 *                                   hold the send token. Locator equality holds across the
 *                                   change; the credential is a different one.
 *
 * This function answers "separated" on the first case, which is the case the test supplies:
 * two distinct locators resolving one identity. Production compares the RESOLVED IDENTITY to
 * the SIGNED one and answers the question that was actually asked.
 *
 * **BOTH CONTROLS ARE KEPT IN PRODUCTION.** This control does not argue the locator check is
 * worthless — it argues it is not this check, and the pairing in the test asserts the
 * production code still refuses a shared locator as well.
 */
export function unsafeLocatorInequalityProvesSeparation(
  auditDescriptor: AuditReaderDescriptor,
  integrationDescriptor: AdapterRuntimeDescriptor,
): boolean {
  // THE VIOLATION: the operands are locators, and the conclusion is about credentials.
  return auditDescriptor.secretLocator !== integrationDescriptor.secretLocator;
}

/**
 * The same mistake stated as the comparison a host might perform.
 *
 * A host holding the descriptor's locator and the source's own locator could compare those
 * two and believe it had bound the credential. It has bound the CONFIGURATION: it has proved
 * the source was pointed where the descriptor said, which says nothing about what was there.
 */
export function unsafeLocatorComparisonAsIdentityBinding(
  descriptorLocator: string,
  sourceLocator: string,
): boolean {
  // THE VIOLATION: locator equality returned as "this is the declared credential".
  return descriptorLocator === sourceLocator;
}
