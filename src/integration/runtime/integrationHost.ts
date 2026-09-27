import { createHash } from 'node:crypto';

import {
  DISPATCH_RESPONSE_KIND,
  REQUEST_REFUSED_KIND,
  computeRequestBindingDigest,
  decodeDispatchRequest,
  type DispatchRequest,
  type DispatchResponse,
  type RefusalReason,
  type RequestRefused,
  type WireOutcome,
} from '../protocol/wire.js';
import { INTEGRATION_PROTOCOL_VERSION } from '../protocol/wire.js';
import type { AdapterSecretSource } from './adapterSecretSource.js';
import {
  adapterCredentialIdentityMismatch,
  credentialLabelsAreNonDerived,
} from './adapterSecretSource.js';
import type { AdapterInvocation, IntegrationAdapter, ProviderBoundary } from './integrationAdapter.js';

/**
 * THE INTEGRATION RUNTIME'S REQUEST HANDLER. Z2's SIDE OF THE PERIMETER.
 *
 * =================================================================================
 * WHAT RUNS HERE AND WHY IT IS A DIFFERENT PROCESS
 *
 * `I25`, verbatim from the invariant registry: "**No process in the control plane holds a
 * vendor credential.**" `48 §4` item 4 gives the enforcement: "CI-checked on the dependency
 * tree and the injected environment. This is what makes the plane boundary mean something:
 * a control-plane component that acquires a vendor call site fails the build twice."
 *
 * Before S1N the repository had no process this sentence could be true OF. `effectGateway.ts`
 * invoked `adapter.dispatch()` in its own process, so a real adapter's credential would have
 * been resolved in control-plane memory and `I25` would have been violated by the shape of
 * the composition rather than by anyone's mistake. S1M returned PARTIAL for exactly that
 * reason and this module is the answer to it.
 *
 * SO THE CREDENTIAL IS RESOLVED HERE, in a process the control plane spawned and cannot read
 * back from, from a source the control plane does not import and cannot construct.
 * =================================================================================
 *
 * =================================================================================
 * THE GUARD ORDER IS THE SECURITY PROPERTY — `§15`, `§16`, `§24`
 *
 * Every refusal below happens STRICTLY BEFORE the adapter is reached, and the order is:
 *
 *     1. decode                       closed schema (`§14`)
 *     2. adapter identity             this runtime serves exactly one (`§7`)
 *     3. authorisation_ref present    `I24`, at the runtime (`48 §4` item 3)
 *     4. authorisation binding        `§16` — bound to THIS effect, not merely non-null
 *     5. payload hash                 the bytes are the bytes the authorisation committed
 *     6. credential resolution        revoked or unavailable refuses here (`§24`)
 *     7. credential IDENTITY binding  the resolved material IS the declared credential
 *     8. adapter invocation           the FIRST line that runs adapter code
 *
 * `§15`: "Integration runtime validates presence before reaching adapter code. [...] No
 * adapter public method exists that can execute without it." Step 8 is the only call site of
 * `invoke` in this file and it is unreachable until 1..7 have all passed, because each is an
 * early return rather than a flag. The negative-control suite's permissive host
 * removes steps 3 and 4 and reaches the adapter, and
 * `unsafeHandleWithoutCredentialIdentityBinding` removes step 7 — which is the
 * discrimination for the v1.3.7 correction.
 * =================================================================================
 */

/** The result of handling one request: exactly one reply message, and nothing else. */
export type HostReply = DispatchResponse | RequestRefused;

function refuse(invocationId: string | null, reason: RefusalReason): RequestRefused {
  return Object.freeze({
    protocolVersion: INTEGRATION_PROTOCOL_VERSION,
    kind: REQUEST_REFUSED_KIND,
    invocationId,
    reason,
  });
}

/**
 * The runtime's own configuration. Built once, at process start, from the child environment.
 *
 * There is no member a REQUEST can influence, which is `§13`'s and `§37`'s shape: the
 * message carries work, and the launch carries capability.
 */
export interface IntegrationRuntimeConfiguration {
  /** The ONE adapter identity this runtime serves. `23 §7`: isolation is per adapter. */
  readonly adapterId: string;
  readonly adapter: IntegrationAdapter;
  readonly secretSource: AdapterSecretSource;
  /**
   * `50 §2g` FIELD 1, AS THE PARENT READ IT OUT OF THE VERIFIED CLASS-5 RECORD.
   *
   * Carried into this process so guard 7 can compare it to what the secret source actually
   * resolved, and NOT trusted as the authority: the authority is the signed record, the
   * parent checked it before forking, and this value is an echo only the parent produces.
   *
   * **THE PARENT CANNOT PERFORM THIS COMPARISON.** `I25` forbids the control plane holding a
   * vendor credential, so the only process that can see the resolved material's identity is
   * this one. That is why the echo exists at all: it moves one non-secret string across the
   * boundary so the comparison can happen on the side that has the other operand.
   */
  readonly expectedCredentialId: string;
}

/**
 * `§24` — PER-CREDENTIAL REVOCATION, AND IT IS THE SOURCE'S ANSWER RATHER THAN A FLAG HERE.
 *
 * ADR-024 requires "a per-credential revocation switch that **REVOKES** rather than stopping
 * the loop", and `07 §10.6` is the underlying rule: "A kill switch that revokes credentials,
 * not merely one that stops the loop."
 *
 * The distinction is which component the switch lives in. A boolean in this module would be
 * a loop-stopper: the credential would still be resolvable and a bug that skipped the check
 * would still reach a vendor. So the switch is a state of the SECRET SOURCE — `REVOKED` is a
 * member of `SecretResolution`, beside `RESOLVED` and `UNAVAILABLE` — and a revoked source
 * returns NO MATERIAL AT ALL. There is nothing to leak past a missed check because there is
 * nothing in hand.
 *
 * IT IS NOT MODEL-CONTROLLED AND NOT CONTROL-PLANE-CONTROLLED. `DispatchRequest` has no
 * member that could express an override and the decoder refuses unknown fields, so the
 * control plane cannot ask; the owner/deployment operation that flips it acts on the
 * deployment boundary, in this runtime's own secret source, with no ACOS code path in
 * between.
 */
export async function handleDispatchRequest(
  configuration: IntegrationRuntimeConfiguration,
  raw: unknown,
): Promise<HostReply> {
  // ---------------------------------------------------------------------------------
  // GUARD 1 — THE CLOSED SCHEMA. `§14`.
  // ---------------------------------------------------------------------------------
  const decoded = decodeDispatchRequest(raw);
  if (decoded.kind === 'REFUSED') return refuse(null, decoded.reason);
  const request: DispatchRequest = decoded.message;

  // ---------------------------------------------------------------------------------
  // GUARD 2 — ADAPTER IDENTITY. `§7`: one credential scope, one adapter runtime.
  //
  // The runtime refuses work addressed to another adapter even though it could not serve it
  // anyway. The refusal is what makes the property observable: a request for adapter B
  // arriving at adapter A's runtime is a wiring or routing defect, and a silent success on
  // the wrong runtime is how a credential ends up presented for a class it does not serve.
  // ---------------------------------------------------------------------------------
  if (
    request.adapterId !== configuration.adapterId ||
    configuration.adapter.adapterId !== configuration.adapterId ||
    configuration.secretSource.declaredAdapterId !== configuration.adapterId
  ) {
    return refuse(request.invocationId, 'ADAPTER_IDENTITY_MISMATCH');
  }

  // ---------------------------------------------------------------------------------
  // GUARD 3 — `I24`, AT THE RUNTIME. `48 §4` item 3: "A runtime assertion refuses an adapter
  // invocation carrying neither [an `authorisation_ref` nor an annotated exemption]. Defence
  // in depth against a call path CI did not see."
  //
  // The decoder already refuses an empty or absent `authorisationRef`, so reaching this line
  // with a blank one is impossible; the check is here anyway, explicitly, because `I24` is
  // named as a RUNTIME invariant and an invariant enforced only as a side effect of a
  // decoder's string rules is an invariant that disappears the day the decoder is relaxed.
  // ---------------------------------------------------------------------------------
  if (request.authorisationRef.trim().length === 0) {
    return refuse(request.invocationId, 'AUTHORISATION_REF_MISSING');
  }

  // ---------------------------------------------------------------------------------
  // GUARD 4 — `§16`. THE REFERENCE IS BOUND TO THIS EFFECT, NOT MERELY PRESENT.
  // ---------------------------------------------------------------------------------
  const expected = computeRequestBindingDigest(request);
  if (expected !== request.bindingDigest) {
    return refuse(request.invocationId, 'AUTHORISATION_BINDING_MISMATCH');
  }

  // ---------------------------------------------------------------------------------
  // GUARD 5 — THE PAYLOAD IS THE AUTHORISED PAYLOAD.
  //
  // `24 §3` K4: "adapter invocation with that payload **verbatim**". `25 §14.1`: "the
  // persisted payload remains the exact authorised payload". The hash is the one the
  // authorising transaction committed, and `enqueue.ts` computes it as `sha256` of the
  // canonical bytes, so this recomputation is the SAME function over the SAME bytes on the
  // far side of a process boundary — which is the one check that makes "verbatim" mean
  // something after the payload has been encoded, transported and decoded.
  // ---------------------------------------------------------------------------------
  const payloadBytes = Buffer.from(request.dispatchPayloadBase64, 'base64');
  const payloadHash = createHash('sha256').update(payloadBytes).digest('hex');
  if (payloadHash !== request.dispatchPayloadHash) {
    return refuse(request.invocationId, 'PAYLOAD_HASH_MISMATCH');
  }

  // ---------------------------------------------------------------------------------
  // GUARD 6 — THE CREDENTIAL. RESOLVED HERE, FROM THIS RUNTIME'S OWN SOURCE, PER INVOCATION.
  //
  // Per invocation rather than once at start, which is `§25`'s rotation requirement. A
  // source that re-reads its deployment boundary serves a rotated credential on the next
  // call with no control-plane involvement and no restart of anything the control plane owns.
  // ---------------------------------------------------------------------------------
  let resolution;
  try {
    resolution = await configuration.secretSource.resolve();
  } catch {
    // `§23`: the thrown value is DISCARDED rather than inspected. A secret source's
    // exception is the single most likely place for a path, an environment dump or the
    // material itself to appear, and there is no `catch (error)` binding here to be tempted
    // by. The control plane learns the closed reason and nothing else.
    return refuse(request.invocationId, 'CREDENTIAL_UNAVAILABLE');
  }
  if (resolution.kind === 'CREDENTIAL_REVOKED') {
    return refuse(request.invocationId, 'CREDENTIAL_REVOKED');
  }
  if (resolution.kind === 'UNAVAILABLE') {
    return refuse(request.invocationId, 'CREDENTIAL_UNAVAILABLE');
  }
  const credential = resolution.credential;
  if (!credentialLabelsAreNonDerived(credential)) {
    // `§25`. A source publishing a fingerprint of its own secret is refused rather than
    // sanitised: sanitising would leave the source believing it had published something.
    return refuse(request.invocationId, 'CREDENTIAL_UNAVAILABLE');
  }

  // ---------------------------------------------------------------------------------
  // GUARD 7 — `50 §2g` FIELD 1. **THE RESOLVED CREDENTIAL IS THE DECLARED CREDENTIAL.**
  //
  // Until this guard existed the chain ran in two halves that never met:
  //
  //     signed class-5 record  ->  risk class  ->  this runtime was admitted
  //     secret locator         ->  material    ->  about to be presented at a provider
  //
  // A locator repointed at another credential produced a runtime presenting
  // `budget_manage` (MONEY_MOVING) under `pause_only`'s NON_MONETARY_WRITE declaration, and
  // every other check on this path passed: the descriptor was well formed, the adapter was
  // in the catalogue, the signed record existed and said NON_MONETARY_WRITE, the
  // authorisation was bound, the payload hashed. The declaration simply governed a
  // credential the runtime was not holding.
  //
  // **LOCATOR SEPARATION IS A DIFFERENT CONTROL AND DOES NOT IMPLY THIS ONE.** Two locators
  // may name one credential; one locator may be repointed at another. `23 §7`'s per-adapter
  // source isolation and this binding are kept as two checks because they answer two
  // different questions: which source was read, and what was found there.
  //
  // IT RUNS BEFORE THE ADAPTER, so no provider boundary is reachable on a mismatch.
  // ---------------------------------------------------------------------------------
  if (
    adapterCredentialIdentityMismatch(
      configuration.expectedCredentialId,
      credential.credentialIdentity,
    ) !== null
  ) {
    // The REASON is not returned to the control plane. `§23`: a refusal teaches a closed
    // code and nothing else, and a message naming both credential identities would put the
    // deployment's credential topology on the wire for any caller that provoked a mismatch.
    return refuse(request.invocationId, 'CREDENTIAL_IDENTITY_MISMATCH');
  }

  // ---------------------------------------------------------------------------------
  // GUARD 8 — THE INVOCATION. THE FIRST LINE OF ADAPTER CODE, AND THE ONLY CALL SITE.
  // ---------------------------------------------------------------------------------
  const invocation: AdapterInvocation = Object.freeze({
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
  });

  let crossed = false;
  const boundary: ProviderBoundary = Object.freeze({
    markProviderClientCrossed: (): void => {
      crossed = true;
    },
  });

  let outcome: WireOutcome;
  try {
    outcome = await configuration.adapter.invoke(invocation, boundary);
  } catch {
    /*
     * `25 §7.2` AT THE PROCESS BOUNDARY, AND THE EXCEPTION IS NOT READ.
     *
     * "Anything for which the request MAY have escaped is `OUTCOME_UNKNOWN`." The
     * discriminating fact is the boundary flag, recorded by the adapter BEFORE its provider
     * call, and not anything about the exception — which is discarded unbound for the same
     * reason the secret source's is.
     *
     * NOT `NOT_SENT_CONFIRMED` WHERE THE BOUNDARY WAS CROSSED, EVER. `25 §7.2`: the
     * confirmed-not-sent classification "may be returned only by a trusted adapter, and only
     * where the adapter can positively establish [...] that NO EXTERNAL WRITE CROSSED THE
     * TRANSPORT BOUNDARY", and a thrown exception establishes nothing.
     */
    outcome = crossed
      ? Object.freeze({ kind: 'OUTCOME_UNKNOWN', reason: 'AMBIGUOUS' })
      : Object.freeze({ kind: 'ADAPTER_FAILED', failureClass: 'ADAPTER_THREW_PRE_SEND' });
  }

  const response: DispatchResponse = Object.freeze({
    protocolVersion: INTEGRATION_PROTOCOL_VERSION,
    kind: DISPATCH_RESPONSE_KIND,
    invocationId: request.invocationId,
    adapterId: request.adapterId,
    outcome,
    credentialIdentity: credential.credentialIdentity,
    credentialVersion: credential.version,
  });
  return response;
}
