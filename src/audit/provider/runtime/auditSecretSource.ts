/**
 * `§13`, `§14` — THE AUDIT PLANE'S OWN SECRET BOUNDARY. A SEPARATE CONTRACT, DELIBERATELY.
 *
 * =================================================================================
 * WHY THIS IS NOT `AdapterSecretSource`
 *
 * `§13`: "Do not put audit credentials into: control process; control integration adapter
 * runtime; **same secret source as send credential**."
 *
 * `src/integration/runtime/adapterSecretSource.ts` declares a source SCOPED TO ONE ADAPTER,
 * whose credential the integration host hands to an adapter's `invoke`. Reusing that type
 * here would mean:
 *
 *   1. the audit reader's module graph contains the integration plane's secret contract,
 *      so `29 §3.5`'s per-credential isolation would be a convention rather than a shape;
 *   2. a source implementation written for one plane would TYPE-CHECK in the other, and
 *      "same secret source as send credential" is exactly the mistake that makes possible;
 *   3. `declaredAdapterId` would key the audit credential by an ACOS-side concept, which
 *      `readerIdentity.ts` explains is the wrong key for a plane whose job is to ask the
 *      provider rather than to trust ACOS.
 *
 * So the contract is separate, it is keyed by PROVIDER, and the two source types share no
 * module. `tests/integration/audit/audit-plane-packaging.test.ts` asserts the disjointness.
 *
 * =================================================================================
 * `§9` OF S1N STILL HOLDS: NO CLOUD SECRET MANAGER IS SELECTED
 *
 * v1.3.6 and v1.3.7 name no platform secret manager, so this file declares the CONTRACT and
 * nothing else. There is no AWS SDK, no Azure SDK, no GCP SDK, no Vault client, no HTTP
 * client and no network of any kind in this directory. The S1O implementations are TEST-ONLY
 * fixtures under `tests/audit-plane/`, and the production posture is that a reader launched
 * without a source resolves nothing and refuses `CREDENTIAL_UNAVAILABLE`.
 * =================================================================================
 */

/**
 * `50 §2g` field 1's identity-provenance set, TRANSCRIBED a THIRD time.
 *
 * The same discipline `readerEnvironment.ts` applies to the integration plane's key list and
 * `auditPlaneVerifier.ts` applies to `50 §6`'s inventory: this plane imports neither the
 * kernel's `credentialRisk.ts` nor the integration plane's `adapterSecretSource.ts`, because
 * either import would make the audit reader's module graph contain a plane it is supposed to
 * be independent of. `tests/integration/perimeter/source-boundary.test.ts` asserts the three
 * transcriptions agree.
 */
export const AUDIT_CREDENTIAL_IDENTITY_PROVENANCES = [
  'PROVIDER_KEY_ID',
  'DEPLOYMENT_SECRET_VERSION',
  'SYNTHETIC_TEST_IDENTITY',
] as const;

export type AuditCredentialIdentityProvenance =
  (typeof AUDIT_CREDENTIAL_IDENTITY_PROVENANCES)[number];

/**
 * The resolved READ-ONLY credential material, and the non-secret labels describing it.
 *
 * `secret` is the only member that may leave this object, and it may only go to the
 * provider-read client's own boundary. It is not logged, not encoded, not attached to a
 * response and not readable from any wire type — `ProviderReadResponse` carries
 * `credentialIdentity` and has no member the material could occupy.
 */
export interface AuditReadCredential {
  /** The read-only provider secret. NEVER serialised, NEVER logged, NEVER sent to a parent. */
  readonly secret: string;
  /**
   * `50 §2g` FIELD 1 — **WHICH CREDENTIAL THIS MATERIAL IS.** MANDATORY, NON-SECRET.
   *
   * =================================================================================
   * THE AUDIT PLANE'S HALF OF THE BINDING, AND ITS ATTACK IS THE MIRROR IMAGE
   *
   *     signed audit record   `synthetic_esp.audit_read`  ->  READ_ONLY  ->  reader admitted
   *     secret locator        resolves ........................  a SEND-CAPABLE token
   *
   * Every existing control passes. The class-5 record is genuinely `READ_ONLY`, the
   * `audit_plane` sentinel is genuinely present, the locator is genuinely not one the
   * integration plane holds — and the material in the reader's hand can send. `48 §3.6`'s
   * exemption would then rest on a declaration about a credential the reader is not using.
   *
   * So the source must name what it resolved, and `auditReadHost.ts` compares that answer to
   * the signed expected identity the audit plane echoed into the launch configuration, in a
   * guard that runs BEFORE `readFromProvider`. A mismatch is `CREDENTIAL_IDENTITY_MISMATCH`.
   *
   * **NULL IS NOT A VALUE HERE**, for the reason it is not one on the integration plane.
   */
  readonly credentialIdentity: string;
  /**
   * WHAT ESTABLISHES THAT IDENTITY. Declared, so a reviewer can tell a binding from a label.
   *
   * `§14` of the S1O correction: a source returning a friendly label such as
   * `"audit-read-key"` has returned a STRING, and that string is not a provider binding
   * merely because the source chose it. A production audit source must return the PROVIDER'S
   * OWN non-secret key identifier (`PROVIDER_KEY_ID`) or an immutable secret-manager identity
   * for that exact token (`DEPLOYMENT_SECRET_VERSION`); `SYNTHETIC_TEST_IDENTITY` is a
   * fixture's answer and belongs only to a TEST/pre-live package.
   *
   * **WHICH PROVIDER THAT IS IS NOT THIS FILE'S BUSINESS.** No vendor is named anywhere under
   * `src/audit/`, and `audit-read-boundary.test.ts` asserts the absence: the provider
   * selection lives in `tools/provider-selection/`, as dated documentation evidence, and a
   * plane whose job is to observe independently does not carry a vendor's name in its
   * contract.
   */
  readonly identityProvenance: AuditCredentialIdentityProvenance;
  /** A non-secret, source-declared rotation label. May be `null`. */
  readonly version: string | null;
}

/** What a resolution can say. A closed set; there is no exception with a message. */
export type AuditSecretResolution =
  | { readonly kind: 'RESOLVED'; readonly credential: AuditReadCredential }
  /** The revocation switch, as the SOURCE's own answer rather than a flag in ACOS. */
  | { readonly kind: 'CREDENTIAL_REVOKED' }
  /** No material is provisioned, or the audit deployment boundary cannot answer. */
  | { readonly kind: 'UNAVAILABLE' };

/**
 * ONE PROVIDER'S AUDIT READ CREDENTIAL. THE AUDIT READER'S ONLY ROUTE TO A PROVIDER SECRET.
 *
 * `resolve()` TAKES NO ARGUMENT, for the reason `AdapterSecretSource.resolve` takes none: a
 * source with a selector signature is a source that CAN be asked for another scope's
 * material, and the only thing between the ask and the answer would be a check inside the
 * source — `29 §3.1`'s own objection to internal capability tokens, one layer down.
 *
 * `declaredProviderId` is a WIRING ASSERTION so the host can refuse a mis-wired reader at
 * start. It is not a selector, and `unsafeSharedAuditSecretSource` in the negative-control
 * suite is the discriminating control: a source with the selector signature, through which
 * the audit reader reaches the integration plane's send credential.
 */
export interface AuditReadSecretSource {
  /** The ONE provider identity this source serves. A wiring assertion, never a selector. */
  readonly declaredProviderId: string;
  resolve(): Promise<AuditSecretResolution>;
}

/**
 * The structural form of "do not publish a fingerprint", for the audit plane's labels.
 *
 * Refuses a credential whose non-secret labels CONTAIN the secret, are contained BY it, or
 * are a hex/base64 encoding of it. It cannot refuse every derivation and is not claimed to;
 * what it closes is the accident — a source that set `identity` to the token because the
 * token was the handiest unique string, which is how fingerprints actually reach logs.
 *
 * Deliberately a SECOND implementation rather than an import of
 * `credentialLabelsAreNonDerived`: the two planes share no module, and a rule this small is
 * cheaper to restate than a coupling is to justify.
 */
export function auditCredentialLabelsAreNonDerived(credential: AuditReadCredential): boolean {
  const { secret } = credential;
  if (secret.length === 0) return false;
  for (const label of [credential.credentialIdentity, credential.version]) {
    if (label === null) continue;
    if (label.length === 0) return false;
    if (label.includes(secret) || secret.includes(label)) return false;
    if (label === Buffer.from(secret, 'utf8').toString('hex')) return false;
    if (label === Buffer.from(secret, 'utf8').toString('base64')) return false;
  }
  return true;
}

/**
 * The binding comparison, for THIS plane. Returns the reason the resolved credential is the
 * wrong one, or `null` when the signed record and the resolved material agree.
 *
 * Deliberately a SECOND implementation of `credentialRisk.ts`'s
 * `credentialIdentityMismatch`, for the reason `auditCredentialLabelsAreNonDerived` is a
 * second implementation: the two planes share no module, and a rule this small is cheaper to
 * restate than a coupling is to justify. `tests/integration/audit/audit-read-boundary.test.ts`
 * asserts the two agree on every case it exercises.
 *
 * **AN EMPTY RESOLVED IDENTITY IS NOT EQUALITY WITH AN EMPTY EXPECTATION.** Absence refuses.
 */
export function auditCredentialIdentityMismatch(
  expectedCredentialId: string,
  resolvedCredentialIdentity: string,
): string | null {
  if (expectedCredentialId.length === 0) {
    return (
      'the reader was launched with no expected credential identity; 50 §2g field 1 is the ' +
      'identity of the exact material the reader may present, and an absent expectation ' +
      'cannot bind one'
    );
  }
  if (resolvedCredentialIdentity.length === 0) {
    return (
      'the audit secret source returned no credential identity for the material it ' +
      'resolved; a null identity is not sufficient for a configured credential'
    );
  }
  if (expectedCredentialId !== resolvedCredentialIdentity) {
    return (
      `the signed class-5 audit record governs credential "${expectedCredentialId}" and the ` +
      `audit secret source resolved material identified as "${resolvedCredentialIdentity}"; ` +
      "48 §3.6's read-only exemption would govern the wrong credential"
    );
  }
  return null;
}
