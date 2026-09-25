import { createHash } from 'node:crypto';

import {
  DISPATCH_RESPONSE_KIND,
  INTEGRATION_PROTOCOL_VERSION,
  REQUEST_REFUSED_KIND,
  computeRequestBindingDigest,
  decodeDispatchRequest,
  type WireOutcome,
} from '../../src/integration/protocol/wire.js';
import type { HostReply, IntegrationRuntimeConfiguration } from '../../src/integration/runtime/integrationHost.js';
import type {
  AdapterInvocation,
  IntegrationAdapter,
  ProviderBoundary,
} from '../../src/integration/runtime/integrationAdapter.js';

/**
 * UNSAFE — TEST-ONLY. THE INTEGRATION HOST, WITH ITS GUARDS REMOVED ONE AT A TIME.
 *
 * `§52` controls 5, 6 and 11:
 *
 *   5.  "invocation missing authorisation_ref"
 *   6.  "authorisation A used for effect B"
 *   11. "secret appears in error/log"
 *
 * Each option below removes exactly ONE production mechanism, so a discrimination is
 * attributable to that mechanism rather than to the difference between two implementations.
 */

export interface UnsafeHostOptions {
  /** CONTROL 5 — do not require an authorisation reference. */
  readonly skipAuthorisationRefCheck?: boolean;
  /**
   * CONTROL 6 — check only that the reference is non-null.
   *
   * `§16`: "**Do not merely assert `authorisation_ref != null`.** Bind the request to the
   * correct effect/claim." This is the "merely" version, and it is the version that looks
   * correct in review: it does check the field, it does refuse a blank one, and it accepts
   * a perfectly valid authorisation spent on somebody else's effect.
   */
  readonly bindingCheckIsNullCheckOnly?: boolean;
  /** CONTROL 11 — put the failure's detail, including the credential, on the wire. */
  readonly leakCredentialInRefusal?: boolean;
  /** CONTROL 11b — write the resolved credential into the runtime log. */
  readonly logSink?: (line: string) => void;
}

/**
 * A refusal WITH a detail string. The shape `§23` forbids and the reason it forbids it.
 *
 * `wire.ts`'s `RequestRefused` has four members and the control-side decoder refuses a fifth,
 * so this message does not decode in production — which is itself half the discrimination.
 * The other half is what the test observes directly: the sentinel is in the bytes this host
 * hands the transport, and is in no byte the production host hands it.
 */
export interface UnsafeRefusalWithDetail {
  readonly protocolVersion: string;
  readonly kind: typeof REQUEST_REFUSED_KIND;
  readonly invocationId: string | null;
  readonly reason: string;
  readonly detail: string;
}

export async function unsafeHandleDispatchRequest(
  configuration: IntegrationRuntimeConfiguration,
  raw: unknown,
  options: UnsafeHostOptions = {},
): Promise<HostReply | UnsafeRefusalWithDetail> {
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

  if (request.adapterId !== configuration.adapterId) {
    return {
      protocolVersion: INTEGRATION_PROTOCOL_VERSION,
      kind: REQUEST_REFUSED_KIND,
      invocationId: request.invocationId,
      reason: 'ADAPTER_IDENTITY_MISMATCH',
    };
  }

  // CONTROL 5 — the `I24` runtime assertion, absent.
  if (options.skipAuthorisationRefCheck !== true && request.authorisationRef.trim().length === 0) {
    return {
      protocolVersion: INTEGRATION_PROTOCOL_VERSION,
      kind: REQUEST_REFUSED_KIND,
      invocationId: request.invocationId,
      reason: 'AUTHORISATION_REF_MISSING',
    };
  }

  // CONTROL 6 — the binding check, weakened to a null check.
  if (options.bindingCheckIsNullCheckOnly === true) {
    if (request.authorisationRef.length === 0) {
      return {
        protocolVersion: INTEGRATION_PROTOCOL_VERSION,
        kind: REQUEST_REFUSED_KIND,
        invocationId: request.invocationId,
        reason: 'AUTHORISATION_REF_MISSING',
      };
    }
  } else if (computeRequestBindingDigest(request) !== request.bindingDigest) {
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
      reason: resolution.kind === 'CREDENTIAL_REVOKED' ? 'CREDENTIAL_REVOKED' : 'CREDENTIAL_UNAVAILABLE',
    };
  }
  const credential = resolution.credential;

  // CONTROL 11b — the log line that carries the material.
  options.logSink?.(
    JSON.stringify({
      event: 'ADAPTER_INVOKED',
      adapterId: request.adapterId,
      // THE VIOLATION. `§43`: "Must not include: credential".
      credential: credential.secret,
      environment: process.env,
    }),
  );

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
  } catch (error: unknown) {
    // CONTROL 11 — the exception's own text, and the credential beside it, on the wire.
    if (options.leakCredentialInRefusal === true) {
      return {
        protocolVersion: INTEGRATION_PROTOCOL_VERSION,
        kind: REQUEST_REFUSED_KIND,
        invocationId: request.invocationId,
        reason: 'CREDENTIAL_UNAVAILABLE',
        // THE VIOLATION. `§23`: "IPC errors visible to control plane must not contain:
        // credential; provider auth header; secret source path; entire integration
        // environment; stack containing secret".
        detail: `${String(error)} while presenting ${credential.secret}`,
      };
    }
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
    credentialIdentity: credential.identity,
    credentialVersion: credential.version,
  };
}

/**
 * AN ADAPTER THAT RECORDS EVERY INVOCATION IT REACHES.
 *
 * The instrument for controls 5 and 6: the discrimination is whether adapter code ran at
 * all, and `§15` states the property as "refused **before** provider adapter method". A
 * counter on the adapter is the only way to observe "before".
 */
export interface RecordingAdapter extends IntegrationAdapter {
  readonly invocations: readonly AdapterInvocation[];
}

export function createRecordingAdapter(
  adapterId: string,
  outcome: WireOutcome = { kind: 'ADAPTER_RETURNED', providerReference: 'recorded', rawResponseHash: null },
): RecordingAdapter {
  const invocations: AdapterInvocation[] = [];
  return {
    adapterId,
    invocations,
    invoke: (invocation: AdapterInvocation, boundary: ProviderBoundary): Promise<WireOutcome> => {
      invocations.push(invocation);
      boundary.markProviderClientCrossed();
      return Promise.resolve(outcome);
    },
  };
}

/**
 * CONTROL — AN ADAPTER THAT MARKS THE PROVIDER BOUNDARY AFTER ITS OWN SEND POINT.
 *
 * `integrationAdapter.ts`'s `ProviderBoundary` says why the mark must precede the call: "a
 * flag set afterwards would be unset in precisely the case it exists for, which is a call
 * that crossed and then died."
 *
 * This adapter sends and then marks, and then throws. The host sees `crossed === false` and
 * classifies `ADAPTER_THREW_PRE_SEND`, which the control plane reads as a failure with no
 * local outcome — while the request may have escaped. `25 §7.2`: labelling a possible escape
 * as a confirmed non-send "would release a commitment for an effect that happened."
 */
export function createUnsafeLateMarkingAdapter(
  adapterId: string,
  send: () => void,
): IntegrationAdapter {
  return {
    adapterId,
    invoke: (_invocation: AdapterInvocation, boundary: ProviderBoundary): Promise<WireOutcome> => {
      // THE REQUEST GOES OUT HERE. Everything after this line may have escaped.
      send();
      // ...and the provider faults before control returns.
      if (send !== undefined) throw new Error('SYNTHETIC_FAULT_AFTER_SEND');
      /*
       * THE VIOLATION: the mark is BELOW the send, so the throw above skips it and the host
       * sees `crossed === false` for a request that was sent. Adapter A marks FIRST and the
       * same fault becomes `OUTCOME_UNKNOWN`.
       */
      boundary.markProviderClientCrossed();
      return Promise.resolve({ kind: 'ADAPTER_RETURNED', providerReference: null, rawResponseHash: null });
    },
  };
}
