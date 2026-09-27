import {
  AUDIT_READ_PROTOCOL_VERSION,
  PROVIDER_READ_REFUSED_KIND,
  PROVIDER_READ_RESPONSE_KIND,
  decodeProviderReadRequest,
  type ProviderReadRefused,
  type ProviderReadRefusal,
  type ProviderReadRequest,
  type ProviderReadResponse,
} from '../protocol/readWire.js';
import {
  auditCredentialIdentityMismatch,
  auditCredentialLabelsAreNonDerived,
  type AuditReadSecretSource,
} from './auditSecretSource.js';
import {
  isAuditProviderReader,
  type AuditProviderReader,
} from './auditProviderReader.js';

/**
 * THE AUDIT READER'S REQUEST HANDLER. Z4's SIDE OF THE PROVIDER-READ PERIMETER.
 *
 * =================================================================================
 * `§13`, `§14` — WHAT RUNS HERE AND WHY IT IS ITS OWN PROCESS
 *
 * `§13`: "The audit plane must use **AN INDEPENDENT PROVIDER READ CREDENTIAL INCAPABLE OF
 * EXTERNAL MUTATION.** Do not put audit credentials into: control process; control
 * integration adapter runtime; same secret source as send credential."
 *
 * `§14`: "separate OS process / architecture-equivalent trust boundary; separate credential
 * source; separate environment allowlist; **no control send credential**; **no write
 * capability**; **no reliance on control adapter result**."
 *
 * The audit read credential is resolved HERE, in a process the audit plane spawned, from a
 * source the control plane does not import and the integration runtime cannot construct, and
 * it never leaves this process: `ProviderReadResponse` carries `credentialIdentity` — the
 * source's own non-secret label — and has no member the material could occupy.
 *
 * =================================================================================
 * THE GUARD ORDER IS THE SECURITY PROPERTY
 *
 * Every refusal below happens STRICTLY BEFORE the provider reader is reached:
 *
 *     1. decode                     closed read-only schema; unknown operation REFUSED
 *     2. provider identity          this reader serves exactly one provider
 *     3. reader shape               no mutation member, checked at runtime not by type
 *     4. credential risk class      the SIGNED class-5 value must be `READ_ONLY`
 *     5. credential resolution      revoked or unavailable refuses here
 *     6. label non-derivation       a source publishing its own secret as a label refuses
 *     7. credential IDENTITY        the resolved material IS the signed audit credential
 *     8. provider read              the FIRST line that reaches a provider boundary
 *
 * Step 8 is the only call site of `readFromProvider` in this file and is unreachable until
 * 1..7 have all passed, because each is an early return rather than a flag.
 * `unsafeHandleProviderReadRequest` in the negative-control suite removes steps 3 and 4 and
 * reaches the reader, and `unsafeHandleWithoutAuditIdentityBinding` removes step 7 — which
 * is the discrimination for the v1.3.7 correction.
 *
 * =================================================================================
 * `§14` AGAIN — AND NOTHING HERE READS A CONTROL-PLANE RESULT
 *
 * "Do not make audit verification depend on a control-plane `verified=true`."
 *
 * This module imports no control-plane module, reads no control database, receives no
 * control-plane verdict on the wire and produces no `verified` field. What it produces is
 * what the PROVIDER answered, verbatim and unmapped — `providerStatus` is the provider's own
 * word — and the audit plane forms its own comparison from that. `independentFinding.ts` is
 * where the comparison lives, and it takes provider evidence and an expectation the AUDIT
 * plane derived, never a control-plane belief.
 * =================================================================================
 */

export type AuditHostReply = ProviderReadResponse | ProviderReadRefused;

function refuse(readId: string | null, reason: ProviderReadRefusal): ProviderReadRefused {
  return Object.freeze({
    protocolVersion: AUDIT_READ_PROTOCOL_VERSION,
    kind: PROVIDER_READ_REFUSED_KIND,
    // A refusal raised before the request decoded has no read id to echo, and inventing one
    // would put a value the parent never sent into the parent's own correlation.
    readId: readId ?? '',
    reason,
  });
}

/**
 * The reader's own configuration. Built once, at process start, from the child environment.
 *
 * There is no member a REQUEST can influence. The message carries work; the launch carries
 * capability.
 */
export interface AuditReaderConfiguration {
  /** The ONE provider identity this reader serves. */
  readonly providerId: string;
  readonly reader: AuditProviderReader;
  readonly secretSource: AuditReadSecretSource;
  /**
   * `50 §2g` field 6, AS THE AUDIT PLANE'S PARENT READ IT OUT OF THE VERIFIED BUNDLE.
   *
   * Carried into this process so guard 4 can refuse locally, and NOT trusted as the
   * authority: the authority is the signed class-5 record, the parent checked it before
   * forking, and this value is an echo the parent alone produced. A child whose echo is
   * anything but `READ_ONLY` refuses every read, which is the fail-closed direction — the
   * echo can only narrow, never widen.
   */
  readonly credentialRiskClass: string;
  /**
   * `50 §2g` FIELD 1, AS THE AUDIT PLANE'S OWN VERIFIER READ IT.
   *
   * The risk-class echo above answers "what class does the signed record declare?". This one
   * answers "which credential is that record about?", and only the second question can catch
   * a reader holding a send-capable token under a genuinely `READ_ONLY` declaration.
   *
   * **THE PARENT CANNOT PERFORM THIS COMPARISON EITHER.** The audit plane's own process does
   * not hold the read credential — that is the whole point of forking this one — so the
   * identity of the resolved material is visible only here.
   */
  readonly expectedCredentialId: string;
}

/**
 * `§13`'s decisive property, as the one string this module compares against.
 *
 * `50 §2g`: `READ_ONLY` means "every reachable provider permission is a read or a query; the
 * credential performs no external mutation of any kind". `48 §3.6`'s exemption rests on
 * exactly that, and `NON_MONETARY_WRITE` — which is what a send credential is — does not
 * earn it.
 */
export const REQUIRED_AUDIT_CREDENTIAL_RISK_CLASS = 'READ_ONLY';

export async function handleProviderReadRequest(
  configuration: AuditReaderConfiguration,
  raw: unknown,
): Promise<AuditHostReply> {
  // ---------------------------------------------------------------------------------
  // GUARD 1 — THE CLOSED READ-ONLY SCHEMA. `§16`: "Unknown operation: REFUSED."
  // ---------------------------------------------------------------------------------
  const decoded = decodeProviderReadRequest(raw);
  if (decoded.kind === 'REFUSED') return refuse(null, decoded.reason);
  const request: ProviderReadRequest = decoded.message;

  // ---------------------------------------------------------------------------------
  // GUARD 2 — PROVIDER IDENTITY. One credential scope, one reader runtime.
  //
  // Three operands rather than one: the request's, the configured reader's, and the secret
  // source's. A reader wired to provider A holding provider B's source is a mis-wiring that
  // would otherwise present the wrong credential at the right boundary.
  // ---------------------------------------------------------------------------------
  if (
    request.providerId !== configuration.providerId ||
    configuration.reader.providerId !== configuration.providerId ||
    configuration.secretSource.declaredProviderId !== configuration.providerId
  ) {
    return refuse(request.readId, 'PROVIDER_IDENTITY_MISMATCH');
  }

  // ---------------------------------------------------------------------------------
  // GUARD 3 — THE READER CANNOT MUTATE. `§16`: "No send operation."
  //
  // Checked AT RUNTIME rather than left to the type, because TypeScript's structural typing
  // admits extra members: an object with `readFromProvider` AND `send` satisfies
  // `AuditProviderReader` at compile time. `isAuditProviderReader` refuses it here, before
  // any credential is resolved, so a mutation-capable reader never sees material.
  // ---------------------------------------------------------------------------------
  if (!isAuditProviderReader(configuration.reader)) {
    return refuse(request.readId, 'CREDENTIAL_NOT_READ_ONLY');
  }

  // ---------------------------------------------------------------------------------
  // GUARD 4 — THE SIGNED CLASS-5 RISK CLASS. `50 §2g` field 6, `48 §3.6`.
  //
  // A reader whose credential is not declared `READ_ONLY` refuses every read. The value is
  // the parent's echo of the verified bundle (see `credentialRiskClass` above); the parent
  // is the authority and already refused to fork a reader whose bundle record said anything
  // else, so this guard is defence in depth against a launch path the parent did not take.
  // ---------------------------------------------------------------------------------
  if (configuration.credentialRiskClass !== REQUIRED_AUDIT_CREDENTIAL_RISK_CLASS) {
    return refuse(request.readId, 'CREDENTIAL_NOT_READ_ONLY');
  }

  // ---------------------------------------------------------------------------------
  // GUARD 5 — CREDENTIAL RESOLUTION. Revocation is the SOURCE's answer, not a flag here.
  // ---------------------------------------------------------------------------------
  const resolution = await configuration.secretSource.resolve();
  if (resolution.kind !== 'RESOLVED') {
    return refuse(request.readId, 'CREDENTIAL_UNAVAILABLE');
  }

  // ---------------------------------------------------------------------------------
  // GUARD 6 — THE LABELS ARE NOT THE SECRET.
  //
  // `credentialIdentity` travels back to the audit plane on every response, so a source that
  // set its label to its own token would publish the credential on the wire. The refusal is
  // `CREDENTIAL_UNAVAILABLE` rather than a new code, deliberately: a source that cannot
  // describe its credential safely has not supplied a usable one.
  // ---------------------------------------------------------------------------------
  if (!auditCredentialLabelsAreNonDerived(resolution.credential)) {
    return refuse(request.readId, 'CREDENTIAL_UNAVAILABLE');
  }

  // ---------------------------------------------------------------------------------
  // GUARD 7 — `50 §2g` FIELD 1. **THE RESOLVED CREDENTIAL IS THE SIGNED AUDIT CREDENTIAL.**
  //
  // The attack this refuses passes every check above it:
  //
  //     signed record   `synthetic_esp.audit_read`, audit_plane-scoped, READ_ONLY   ok
  //     risk echo       READ_ONLY                                                   ok
  //     locator         not one the integration plane holds                         ok
  //     resolved token  SEND-CAPABLE                                                NO
  //
  // `48 §3.6`'s exemption rests on the reader's credential being incapable of external
  // mutation. Without this guard it rests on a declaration about a DIFFERENT credential, and
  // the audit plane would be querying — and could be sending — with material nobody
  // classified.
  //
  // **AND IT IS NOT A LOCATOR COMPARISON.** `auditReaderRegistry` already refuses a locator
  // the integration plane holds, and that check cannot decide this one: two locators may
  // name one credential, and one locator may be repointed at another. Both controls are
  // kept because they answer different questions.
  //
  // IT RUNS BEFORE `readFromProvider`, so no provider query is made with the wrong material.
  // ---------------------------------------------------------------------------------
  if (
    auditCredentialIdentityMismatch(
      configuration.expectedCredentialId,
      resolution.credential.credentialIdentity,
    ) !== null
  ) {
    // The reason is not returned to the parent: a refusal teaches a closed code and nothing
    // else, and a message naming both identities would publish the audit plane's credential
    // topology to any caller that could provoke a mismatch.
    return refuse(request.readId, 'CREDENTIAL_IDENTITY_MISMATCH');
  }

  // ---------------------------------------------------------------------------------
  // GUARD 8 — THE PROVIDER READ. THE ONLY CALL SITE, AND THE FIRST LINE THAT REACHES OUT.
  // ---------------------------------------------------------------------------------
  const result = await configuration.reader.readFromProvider(resolution.credential, {
    operation: request.operation,
    periodStartMs: request.periodStartMs,
    periodEndMs: request.periodEndMs,
    correlationTag: request.correlationTag,
    providerMessageId: request.providerMessageId,
    maxRecords: request.maxRecords,
  });

  if (result.kind === 'PROVIDER_UNAVAILABLE') {
    return refuse(request.readId, 'PROVIDER_UNAVAILABLE');
  }

  // A reader that returned more than the request bounded is a reader that did not honour the
  // bound, and truncating here would hide it. The refusal is the honest answer: the audit
  // plane learns that the read did not happen as asked rather than receiving a silently
  // shortened page it would then treat as complete evidence.
  if (result.records.length > request.maxRecords) {
    return refuse(request.readId, 'RECORD_BOUND_EXCEEDED');
  }

  return Object.freeze({
    protocolVersion: AUDIT_READ_PROTOCOL_VERSION,
    kind: PROVIDER_READ_RESPONSE_KIND,
    readId: request.readId,
    operation: request.operation,
    records: result.records,
    recordCount: result.recordCount,
    // The SOURCE's declared label, never a digest of the material — guard 6 already refused
    // a label derived from it.
    credentialIdentity: resolution.credential.credentialIdentity,
    providerQueriedAtMs: Date.now(),
  });
}
