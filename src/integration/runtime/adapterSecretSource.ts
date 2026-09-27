/**
 * `§9` — THE NARROW SECRET-SOURCE INTERFACE. NO CLOUD VENDOR IS SELECTED HERE.
 *
 * =================================================================================
 * WHAT THE ARCHITECTURE SAYS, AND WHAT IT DELIBERATELY DOES NOT SAY
 *
 * ADR-024's decision, verbatim: "Per-adapter vendor secrets **in the platform secret
 * manager**, injected at process start, never shared, with per-adapter runtime, filesystem
 * and dependency-tree isolation, bank-line ingest in its own runtime, and a per-credential
 * revocation switch that **revokes** rather than stopping the loop."
 *
 * `29 §3.2`'s option A block says the same in five lines. `48 §6` puts "Secret-manager IAM"
 * in the credential inventory under "Deployment only — Not held by any adapter".
 *
 * WHAT NO DELIVERABLE IN v1.3.6 SAYS IS *WHICH* PLATFORM SECRET MANAGER. `31 §12`'s
 * technology table names none, and `§9` of the mandate is explicit about the consequence:
 * "Do NOT select a cloud vendor in S1N."
 *
 * So this file declares the CONTRACT and nothing else. There is no AWS SDK, no Azure SDK,
 * no GCP SDK, no Vault client, no HTTP client and no network of any kind in this directory;
 * the S1N implementations of this interface are TEST-ONLY fixtures under
 * `tests/integration-plane/`, and the production posture is that a runtime launched without
 * a source resolves nothing and refuses `CREDENTIAL_UNAVAILABLE`.
 * =================================================================================
 *
 * =================================================================================
 * WHY THE INTERFACE IS PER-ADAPTER AND TAKES NO ADAPTER ID
 *
 * `23 §7`: "one adapter cannot read another's secret from its own environment or
 * filesystem." A source with a `resolve(adapterId)` signature is a source that CAN be asked
 * for another adapter's secret, and the only thing standing between the ask and the answer
 * would be a check inside the source — which is `29 §3.1`'s own objection to internal
 * capability tokens, one layer down: "The adapter would be enforcing a restriction on
 * itself. That is an audit tag, not a security boundary."
 *
 * So `AdapterSecretSource` is SCOPED AT CONSTRUCTION to exactly one adapter identity and
 * `resolve()` takes NO argument. `declaredAdapterId` is there so the HOST can refuse a
 * mis-wired runtime at start — it is a wiring assertion, not a selector — and
 * `unsafeSharedSecretSource` in the negative-control suite is the discriminating control: a
 * source with the selector signature, which adapter A uses to read adapter B's secret.
 * =================================================================================
 */

/**
 * `50 §2g` field 1's identity-provenance set, TRANSCRIBED rather than imported.
 *
 * `credentialRisk.ts` holds the canonical list, and importing it would put the control
 * plane's trust chain into the integration RUNTIME's module graph — the one process
 * `I25` is about, whose import closure `tools/integration-packaging/` proves disjoint.
 * Two independent transcriptions of one closed list disagree loudly;
 * `tests/integration/perimeter/source-boundary.test.ts` is where the disagreement is
 * caught, from the TEST's graph, where importing both is harmless.
 */
export const ADAPTER_CREDENTIAL_IDENTITY_PROVENANCES = [
  'PROVIDER_KEY_ID',
  'DEPLOYMENT_SECRET_VERSION',
  'SYNTHETIC_TEST_IDENTITY',
] as const;

export type CredentialIdentityProvenance =
  (typeof ADAPTER_CREDENTIAL_IDENTITY_PROVENANCES)[number];

/**
 * The resolved credential material, and the non-secret labels that describe it.
 *
 * =================================================================================
 * `secret` IS THE ONLY MEMBER THAT MAY LEAVE THIS OBJECT, AND IT MAY ONLY GO TO ONE PLACE
 *
 * `§29`: the sentinel "must appear nowhere except its integration-only test credential
 * source / private adapter memory fixture." The host hands this whole object to the
 * adapter's `invoke` and to nothing else: it is not logged, not encoded, not attached to an
 * outcome and not readable from any wire type — `DispatchResponse` carries
 * `credentialIdentity` and `credentialVersion` and has no member the secret could occupy.
 *
 * `credentialIdentity` and `version` are NON-SECRET VALUES THE SOURCE DECLARES (`§25`),
 * not digests of the secret. `§25`: "Do not log secret fingerprint unless explicitly
 * architecture-approved", and v1.3.6 approves none. A fingerprint under a rotation schedule
 * is a confirm-a-guess oracle, which is why `credentialLabelsAreNonDerived` below refuses a
 * source whose labels are derivable from its own secret material. `credentialIdentity` is
 * more than a label, though: it is `50 §2g` field 1's BINDING, and the host compares it to
 * the signed expected identity before the adapter is reached.
 * =================================================================================
 */
export interface AdapterCredential {
  /** The vendor secret. NEVER serialised, NEVER logged, NEVER returned to the control plane. */
  readonly secret: string;
  /**
   * `50 §2g` FIELD 1 — **WHICH CREDENTIAL THIS MATERIAL IS.** MANDATORY, NON-SECRET.
   *
   * =================================================================================
   * IT IS NOT A LABEL, AND THE DIFFERENCE IS THE WHOLE CONTROL
   *
   * Before this field existed, the chain ran in two disconnected halves:
   *
   *     signed class-5 `credential_id`  ->  risk class  ->  registry admits the runtime
   *     `secretLocator`                 ->  resolved secret  ->  presented at the provider
   *
   * and NOTHING compared them. A locator repointed at another credential produced a runtime
   * whose risk declaration governed a credential it was not holding:
   * `pause_only = NON_MONETARY_WRITE` declared, `budget_manage = MONEY_MOVING` presented.
   *
   * So the source must now say WHICH CREDENTIAL IT RESOLVED, and `integrationHost.ts`
   * compares that answer to the signed expected identity the parent echoed into the launch
   * configuration. A mismatch is `CREDENTIAL_IDENTITY_MISMATCH`, refused before the adapter
   * is reached and therefore before any provider boundary.
   *
   * **NULL IS NOT A VALUE HERE.** `50 §2g`: a configured credential has an identity, and a
   * source that cannot name what it resolved has not supplied a usable credential. The type
   * carries `string` rather than `string | null` so the absence is a compile error on a
   * source rather than a runtime surprise at a boundary.
   *
   * **AND IT IS NEVER DERIVED FROM THE MATERIAL.** Not the secret, not a hash or fingerprint
   * of it, not a token prefix. `credentialLabelsAreNonDerived` below is the structural half.
   */
  readonly credentialIdentity: string;
  /**
   * WHAT ESTABLISHES THAT IDENTITY. Declared, so a reviewer can tell a binding from a label.
   *
   * `§14` of the S1O correction: "The secret source is a TCB component, but document exactly
   * what establishes its returned credential identity." A source returning
   * `SYNTHETIC_TEST_IDENTITY` is a fixture and is admissible only in a TEST/pre-live package;
   * a production source must return `PROVIDER_KEY_ID` — the provider's own stable key id —
   * or `DEPLOYMENT_SECRET_VERSION`, an immutable secret-manager identity for that exact
   * material. **A source does not become a provider binding by labelling itself one**, which
   * is why this is recorded and reviewed rather than trusted as proof.
   */
  readonly identityProvenance: CredentialIdentityProvenance;
  /** A non-secret, source-declared rotation label. May be `null`. `§25`. */
  readonly version: string | null;
}

/** What a resolution can say. A closed set; there is no exception with a message. */
export type SecretResolution =
  | { readonly kind: 'RESOLVED'; readonly credential: AdapterCredential }
  /** `§24`'s revocation switch, as the source's own answer. */
  | { readonly kind: 'CREDENTIAL_REVOKED' }
  /** No material is provisioned, or the deployment boundary cannot answer. */
  | { readonly kind: 'UNAVAILABLE' };

/**
 * ONE ADAPTER'S SECRET BOUNDARY. THE INTEGRATION RUNTIME'S ONLY ROUTE TO A VENDOR SECRET.
 *
 * `resolve` is called PER INVOCATION rather than once at start, which is `§25`'s rotation
 * requirement: "S1N should support replacing an adapter credential at the integration
 * deployment boundary without restarting/reconfiguring the control process." A source
 * backed by a platform secret manager re-reads; a source backed by a file re-reads the
 * file; the control plane is not involved in either and learns neither the value nor the
 * fact that it changed, beyond the non-secret `version` label it may already see.
 */
export interface AdapterSecretSource {
  /** The ONE adapter identity this source serves. A wiring assertion, never a selector. */
  readonly declaredAdapterId: string;
  resolve(): Promise<SecretResolution>;
}

/**
 * `§25`'s structural form of "do not publish a fingerprint".
 *
 * Refuses a credential whose non-secret labels CONTAIN the secret, are contained BY it, or
 * are a hex/base64 encoding of it. It cannot refuse every derivation — a source determined
 * to publish a keyed digest of its own secret could — and it is not claimed to. What it
 * closes is the accident: a source that set `identity` to the token because the token was
 * the handiest unique string, which is how fingerprints actually reach logs.
 */
export function credentialLabelsAreNonDerived(credential: AdapterCredential): boolean {
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
 * A SECOND implementation of `credentialRisk.ts`'s `credentialIdentityMismatch`, kept inside
 * the integration runtime's own package for the reason the provenance list is transcribed
 * here: this module is loaded by the credential-holding child, and that child's import
 * closure does not contain the control plane's trust chain.
 *
 * **AN EMPTY RESOLVED IDENTITY IS NOT EQUALITY WITH AN EMPTY EXPECTATION.** Absence refuses.
 */
export function adapterCredentialIdentityMismatch(
  expectedCredentialId: string,
  resolvedCredentialIdentity: string,
): string | null {
  if (expectedCredentialId.length === 0) {
    return (
      'the runtime was launched with no expected credential identity; 50 §2g field 1 is the ' +
      'identity of the exact material the runtime may present, and an absent expectation ' +
      'cannot bind one'
    );
  }
  if (resolvedCredentialIdentity.length === 0) {
    return (
      'the secret source returned no credential identity for the material it resolved; a ' +
      'null identity is not sufficient for a configured credential'
    );
  }
  if (expectedCredentialId !== resolvedCredentialIdentity) {
    return (
      `the signed class-5 record governs credential "${expectedCredentialId}" and the secret ` +
      `source resolved material identified as "${resolvedCredentialIdentity}"; the risk ` +
      'declaration would govern the wrong credential'
    );
  }
  return null;
}
