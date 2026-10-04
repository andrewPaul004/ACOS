import { readFileSync } from 'node:fs';

import { isOwnerControlledSink, isUsableAddress } from '../integration/validationPayload.js';

/**
 * THE TRUSTED, NON-SECRET S1P DEPLOYMENT CONFIGURATION.
 *
 * =================================================================================
 * WHY IT IS HERE, IN THE HARNESS, AND NO LONGER IN THE INTEGRATION PACKAGE
 *
 * Before the S1P independent review this document lived beside the integration runtime's
 * secret, and the ADAPTER read it: the recipient of the validation email was launch
 * configuration. The review rejected exactly that, so the adapter now takes every semantic
 * field from the authorised dispatch payload and reads NO configuration at all.
 *
 * What is left for a configuration document to say is what the HARNESS needs in order to
 * decide two things BEFORE any effect is authorised and before any secret is touched:
 *
 *   1. WHICH EFFECT TO AUTHORISE — the sender identity and the owner-controlled sink that
 *      the validation-authority seeder will commit into the payload, where the hash covers
 *      them.
 *   2. WHICH CREDENTIALS ARE EXPECTED — the EXACT non-secret class-5 credential identities
 *      for the integration plane and for the audit plane.
 *
 * =================================================================================
 * CORRECTION 6 — THE CREDENTIAL IDENTITIES ARE NAMED, NEVER INFERRED
 *
 * The rejected harness scanned every signed class-5 record and kept whichever one it
 * encountered LAST with a matching adapter or provider. The review: "That is ambiguous once
 * more than one credential exists for an adapter/provider. [...] A duplicate/multiple
 * matching record set does not give the harness permission to guess."
 *
 * So the two identities are DECLARED HERE, by the operator, and the harness SELECTS the
 * signed record by identity. A configuration naming an identity the signed artifact does not
 * carry is a refusal; a signed artifact carrying two records for one adapter is no longer
 * ambiguous, because the configuration names which one this run expects.
 *
 * **NAMING AN IDENTITY IS NOT TRUSTING ONE.** The expectation selects the SIGNED record; the
 * credential-holding child then compares that record's `credential_id` against the identity
 * the SOURCE MECHANISM material-bound. A configuration that names the wrong credential
 * therefore fails the binding comparison rather than silently authorising the wrong key.
 *
 * =================================================================================
 * CORRECTION 7 — AND IT IS NOT THE NON-PRODUCTION DECLARATION
 *
 * The rejected preflight computed `nonProductionDeclared` as `configuration.kind === 'CONFIG'`
 * — a parseable document was treated as evidence that the account was dedicated
 * non-production. It is not. `§7`: "Do not infer non-production merely from an environment
 * label, a sender address, the sink marker."
 *
 * The declaration is therefore an explicit operator ACKNOWLEDGEMENT, carried in the
 * environment as a long sentence nobody sets by accident, and evaluated by `preflight.ts`.
 * This document carries the LABEL so evidence can say WHICH environment ran; it does not
 * carry the claim.
 *
 * =================================================================================
 * **THE DOCUMENT HOLDS NO SECRET AND CANNOT.**
 *
 * The returned record is constructed FIELD BY FIELD and never spread from the parsed
 * document, so an `apiKey` member added to the file by a confused operator reaches nothing.
 * `tests/sendgrid/preflight.test.ts` asserts that property against a document that contains
 * one, which is the only way to assert it.
 * =================================================================================
 */

/** The non-secret configuration one validation run needs. NO MEMBER CAN CARRY A KEY. */
export interface S1PDeploymentConfig {
  /**
   * The non-production environment's own non-secret label — a subuser name or an account
   * nickname — carried into evidence so a reviewer can tell WHICH environment ran.
   *
   * `§16` admits it: "SendGrid non-production environment identifier **if safely
   * non-secret**". A value that is not safely non-secret is one the operator should not put
   * here, and the length bound below is what stops a key being pasted into the slot.
   */
  readonly environmentLabel: string;
  /** The verified non-production sending identity the seeder will AUTHORISE. */
  readonly senderAddress: string;
  /** The OWNER-CONTROLLED sink the seeder will AUTHORISE. Never a customer. */
  readonly sinkAddress: string;
  /** `50 §2g` field 1 — the EXACT expected integration credential identity. */
  readonly integrationCredentialId: string;
  /**
   * `50 §2g` field 1 — the EXACT expected audit-READ credential identity, or `null`.
   *
   * v1.3.8: whether a SendGrid audit-read credential exists at all is decided by the VERIFIED
   * class-28 mode, not by this document. Under `PROVIDER_READ` the preflight REQUIRES it; under
   * `SIGNED_PROVIDER_PUSH` the preflight REFUSES one being supplied. So the document may omit it,
   * and an omitted identity is `null` — never an empty string or a placeholder.
   */
  readonly auditCredentialId: string | null;
}

/** Why the configuration could not be read. A closed set. */
export const CONFIG_REFUSALS = [
  'CONFIG_UNREADABLE',
  'CONFIG_MALFORMED',
  'SENDER_MISSING',
  'SENDER_MALFORMED',
  'SINK_MISSING',
  'SINK_NOT_OWNER_CONTROLLED',
  'ENVIRONMENT_LABEL_MISSING',
  /** The label is long enough to be a key. Refused rather than redacted. */
  'ENVIRONMENT_LABEL_SUSPICIOUS',
  /** Correction 6: a run must name the exact credential it expects, for each plane. */
  'INTEGRATION_CREDENTIAL_ID_MISSING',
  /**
   * The audit-read identity is PRESENT but empty, non-string or key-shaped. Its ABSENCE is not
   * this refusal: v1.3.8 makes it a mode-dependent preflight gate instead.
   */
  'AUDIT_CREDENTIAL_ID_MISSING',
  /** Two planes naming ONE credential is the composition `§13` of S1O forbids. */
  'CREDENTIAL_IDS_NOT_DISTINCT',
] as const;

export type ConfigRefusal = (typeof CONFIG_REFUSALS)[number];

export type ConfigResult =
  | { readonly kind: 'CONFIG'; readonly config: S1PDeploymentConfig }
  | { readonly kind: 'REFUSED'; readonly reason: ConfigRefusal };

/**
 * A SendGrid API key is `SG.` followed by two base64url segments and is comfortably over 60
 * characters. An environment label is a subuser name. The bound is deliberately well below
 * a key's length and well above any plausible label.
 */
export const MAX_ENVIRONMENT_LABEL_LENGTH = 48;

/** A credential identity is a short non-secret name. The same bound, for the same reason. */
export const MAX_CREDENTIAL_ID_LENGTH = 128;

function suspiciousLabel(value: string, maxLength: number): boolean {
  return value.length > maxLength || value.includes('SG.');
}

/** Parse an S1P deployment configuration. PURE over its argument. */
export function parseDeploymentConfig(raw: unknown): ConfigResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { kind: 'REFUSED', reason: 'CONFIG_MALFORMED' };
  }
  const document = raw as Record<string, unknown>;

  const sender = document.senderAddress;
  if (typeof sender !== 'string' || sender.length === 0) {
    return { kind: 'REFUSED', reason: 'SENDER_MISSING' };
  }
  if (!isUsableAddress(sender)) return { kind: 'REFUSED', reason: 'SENDER_MALFORMED' };

  const sink = document.sinkAddress;
  if (typeof sink !== 'string' || sink.length === 0) {
    return { kind: 'REFUSED', reason: 'SINK_MISSING' };
  }
  if (!isOwnerControlledSink(sink)) {
    return { kind: 'REFUSED', reason: 'SINK_NOT_OWNER_CONTROLLED' };
  }

  const label = document.environmentLabel;
  if (typeof label !== 'string' || label.length === 0) {
    return { kind: 'REFUSED', reason: 'ENVIRONMENT_LABEL_MISSING' };
  }
  if (suspiciousLabel(label, MAX_ENVIRONMENT_LABEL_LENGTH)) {
    return { kind: 'REFUSED', reason: 'ENVIRONMENT_LABEL_SUSPICIOUS' };
  }

  const integrationCredentialId = document.integrationCredentialId;
  if (
    typeof integrationCredentialId !== 'string' ||
    integrationCredentialId.length === 0 ||
    suspiciousLabel(integrationCredentialId, MAX_CREDENTIAL_ID_LENGTH)
  ) {
    return { kind: 'REFUSED', reason: 'INTEGRATION_CREDENTIAL_ID_MISSING' };
  }
  /*
   * OPTIONAL, AND STILL STRICT WHEN PRESENT. Absent (the member not in the document) is `null`.
   * Present but empty, not a string, or key-shaped is refused exactly as before — `null` is the
   * only representation of "no audit-read credential", so no placeholder can stand in for one.
   */
  const rawAuditCredentialId = document.auditCredentialId;
  let auditCredentialId: string | null = null;
  if (rawAuditCredentialId !== undefined) {
    if (
      typeof rawAuditCredentialId !== 'string' ||
      rawAuditCredentialId.length === 0 ||
      suspiciousLabel(rawAuditCredentialId, MAX_CREDENTIAL_ID_LENGTH)
    ) {
      return { kind: 'REFUSED', reason: 'AUDIT_CREDENTIAL_ID_MISSING' };
    }
    auditCredentialId = rawAuditCredentialId;
  }
  if (auditCredentialId !== null && integrationCredentialId === auditCredentialId) {
    return { kind: 'REFUSED', reason: 'CREDENTIAL_IDS_NOT_DISTINCT' };
  }

  /*
   * THE RETURN IS CONSTRUCTED FIELD BY FIELD, NEVER SPREAD FROM THE DOCUMENT.
   *
   * `{ ...document }` would carry an `apiKey` into the result the moment the document had
   * one, and the only thing standing between that and a log line would be every caller's
   * discipline. Five named fields is the structural version of the same rule the child
   * environment follows: constructed, not filtered.
   */
  return {
    kind: 'CONFIG',
    config: Object.freeze({
      environmentLabel: label,
      senderAddress: sender,
      sinkAddress: sink,
      integrationCredentialId,
      auditCredentialId,
    }),
  };
}

/** Read the configuration document a locator names. The locator is launch configuration. */
export function readDeploymentConfig(locator: string): ConfigResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(locator, 'utf8')) as unknown;
  } catch {
    return { kind: 'REFUSED', reason: 'CONFIG_UNREADABLE' };
  }
  return parseDeploymentConfig(parsed);
}
