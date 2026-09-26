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
  /** A non-secret, source-declared label. May be `null`. */
  readonly identity: string | null;
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
  for (const label of [credential.identity, credential.version]) {
    if (label === null) continue;
    if (label.length === 0) return false;
    if (label.includes(secret) || secret.includes(label)) return false;
    if (label === Buffer.from(secret, 'utf8').toString('hex')) return false;
    if (label === Buffer.from(secret, 'utf8').toString('base64')) return false;
  }
  return true;
}
