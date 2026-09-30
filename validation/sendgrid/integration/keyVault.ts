/*
 * PERIMETER_EXEMPT(credential_material_resolution, 50-2g)
 *
 * THE SECOND OUTBOUND DESTINATION THIS PACKAGE HAS, NAMED SO A REVIEWER CAN FIND IT.
 *
 * `48 §3`: "An exemption is not a hole. It is a **named, annotated, reviewed** hole." The
 * Azure Key Vault data plane is dialled to resolve the EXACT secret version whose returned
 * identifier becomes the `50 §2g` field-1 credential identity. It is NOT a provider boundary:
 * it dispatches no effect, it carries no `authorisation_ref`, and it can only READ one secret
 * version that the closed locator already named.
 *
 * The exemption covers the import of the capability. Each CONSTRUCTION and each READ carries
 * its own annotation below, because `48 §4` item 2 annotates sites rather than files.
 */
// PERIMETER_EXEMPT(credential_material_resolution, 50-2g) — the Azure identity this
// process authenticates as. See the block above for what the exemption covers.
import { ManagedIdentityCredential } from '@azure/identity';
// PERIMETER_EXEMPT(credential_material_resolution, 50-2g) — the Key Vault data plane,
// read-only and confined to the one secret version the closed locator names.
import { SecretClient } from '@azure/keyvault-secrets';

/**
 * OWNER DECISION — **AZURE KEY VAULT IMMUTABLE SECRET VERSION BINDING**, INTEGRATION PLANE.
 *
 * =================================================================================
 * WHAT `50 §2g` FIELD 1 ASKS FOR, AND WHY A VERSIONED KEY VAULT SECRET ID ANSWERS IT
 *
 * Field 1 requires the identity of THE EXACT MATERIAL a runtime may present. A file that
 * carries a secret and a label beside it has asserted an ADJACENCY: anyone who can edit the
 * file can make any secret claim any identity. That is the defect correction 3 closed by
 * making `FILE_FIXTURE` assign `SYNTHETIC_TEST_IDENTITY` whatever the file says.
 *
 * An Azure Key Vault secret VERSION is immutable, and Key Vault returns the version's full
 * identifier IN THE SAME RESPONSE as the material it versions:
 *
 *     https://<vault>.vault.azure.net/secrets/<secret-name>/<version>
 *
 * So the identity is of the exact bytes returned, established by the mechanism that returned
 * them, and the provenance `DEPLOYMENT_SECRET_VERSION` is earned rather than declared.
 *
 * =================================================================================
 * THE RULE THIS MODULE ENFORCES, AND IT IS THE LOAD-BEARING ONE
 *
 * **ACOS ALWAYS FETCHES AN EXACT VERSION. IT NEVER RESOLVES `latest`.**
 *
 * `secretVersion` is REQUIRED. `getSecret` is called with an explicit version, never with a
 * name alone; no version listing happens; no other version, name or vault is ever tried after
 * a failure. And the RETURNED identity is checked to describe the configured vault, name and
 * version before it is allowed to become the credential identity.
 *
 * The reason is rotation. A signed class-5 record names one exact versioned secret id. If
 * ACOS resolved a mutable alias, creating a new Key Vault version would silently move the
 * material underneath an unchanged signature — the authority would follow the vault instead
 * of the owner. `resolveExactSecretVersion` makes that impossible: a new version has a new
 * id, the returned id no longer equals the signed one, and the accepted host refuses on the
 * identity comparison BEFORE any SendGrid boundary.
 *
 * =================================================================================
 * THE IDENTITY IS THE RETURNED ID, NOT A RECONSTRUCTED ONE
 *
 * `credentialIdentity` is `secret.properties.id` — the string KEY VAULT SENT. The configured
 * vault, name and version are used to CHECK it and never to BUILD it. Concatenating the
 * configuration into a URL and calling the result "the Key Vault identity" would be the same
 * category of error as the rejected file source: a value this process composed, presented as
 * a value a trusted mechanism established.
 *
 * =================================================================================
 * AUTHENTICATION IS DETERMINISTIC, BY OWNER DECISION
 *
 * `ManagedIdentityCredential` with an EXPLICIT user-assigned client id, and nothing else. No
 * `DefaultAzureCredential`, no CLI credential, no environment credential, no client secret,
 * no chained fallback. The identity that retrieves vendor material must not be able to
 * silently become a developer's login or another Azure principal, and a credential CHAIN is
 * exactly a mechanism for silently becoming something else.
 *
 * The managed-identity client id is NON-SECRET deployment configuration. **NO AZURE ACCESS
 * TOKEN, CLIENT SECRET OR CERTIFICATE CROSSES IPC OR THE ENVIRONMENT**: this process obtains
 * its own token through managed identity, inside the credential-holding child.
 *
 * =================================================================================
 * WHY THIS CODE IS DUPLICATED IN THE AUDIT PACKAGE
 *
 * `validation/sendgrid/integration/` and `validation/sendgrid/audit/` share NO module, and
 * `tests/sendgrid/prerequisites-and-separation.test.ts` asserts that over both import
 * closures. A shared Key Vault helper would be the first module they had in common, and the
 * owner direction is explicit: "Duplication of a small amount of Azure binding code across
 * the two packages is preferable to weakening the plane boundary."
 *
 * The audit copy is INDEPENDENT: its own managed identity, its own vault, its own secret, its
 * own validation. Neither package can see the other's locator or client id.
 * =================================================================================
 */

/**
 * Why an exact-version resolution refused. A CLOSED set of NON-SECRET reasons.
 *
 * Every member names a property of the CONFIGURATION or of the RETURNED METADATA. None can
 * carry secret material, an access token or an SDK exception body — `§12`: "Do not log SDK
 * exception bodies wholesale."
 */
export const KEY_VAULT_REFUSALS = [
  /** The locator document did not carry the closed Key Vault operand set. */
  'LOCATOR_MALFORMED',
  /** `vaultUrl` is not the canonical `https://<vault>.vault.azure.net` form. */
  'VAULT_URL_NOT_CANONICAL',
  /** The secret name is absent or is not a legal Key Vault object name. */
  'SECRET_NAME_INVALID',
  /**
   * **THE VERSION IS REQUIRED AND WAS NOT SUPPLIED.**
   *
   * A missing version is the one input that would otherwise mean "latest", so it refuses here
   * rather than reaching a call that could resolve a mutable alias.
   */
  'SECRET_VERSION_ABSENT',
  /** The managed-identity client id is absent or malformed. */
  'MANAGED_IDENTITY_CLIENT_ID_INVALID',
  /** Key Vault did not answer, or answered an error. The detail is NOT carried. */
  'KEY_VAULT_UNREACHABLE',
  /** The response carried no usable secret value. */
  'SECRET_VALUE_ABSENT',
  /** The response carried no full versioned identifier, so no identity was established. */
  'RETURNED_ID_ABSENT',
  /** The returned identifier is not a parseable versioned Key Vault secret id. */
  'RETURNED_ID_MALFORMED',
  /** The returned identifier names a different vault than the one configured. */
  'RETURNED_VAULT_MISMATCH',
  /** The returned identifier names a different secret than the one configured. */
  'RETURNED_NAME_MISMATCH',
  /**
   * **THE RETURNED VERSION IS NOT THE CONFIGURED VERSION.**
   *
   * The refusal that makes "never latest" real rather than intended.
   */
  'RETURNED_VERSION_MISMATCH',
  /** Key Vault reports the secret version as disabled. */
  'SECRET_DISABLED',
  /** Key Vault reports the version as not yet valid or already expired. */
  'SECRET_NOT_CURRENTLY_VALID',
  /** The identity is derived from the material it claims to identify. */
  'IDENTITY_DERIVED_FROM_SECRET',
  /**
   * **THE DOCUMENT CARRIED A FIELD A LIVE KEY VAULT LOCATOR MAY NOT CARRY.**
   *
   * The previous parser read the four operands it wanted and IGNORED everything else, so a
   * live document carrying an `apiKey`, a fabricated `credentialIdentity` or an Azure
   * `accessToken` was accepted — the forbidden values reached nothing, but they were
   * TOLERATED, and a locator that tolerates a secret is not a closed locator.
   *
   * The rule is now REJECTION rather than projection: an unknown or forbidden field refuses
   * the whole document, before any credential is constructed and before any vault is dialled.
   */
  'LOCATOR_FIELDS_NOT_CLOSED',
] as const;

export type KeyVaultRefusal = (typeof KEY_VAULT_REFUSALS)[number];

/**
 * THE CLOSED KEY VAULT LOCATOR OPERANDS. FIVE FIELDS, NONE OF THEM SECRET.
 *
 * `§4`: no field may carry SendGrid material, an Azure token, an Azure client secret, an
 * expected class-5 identity copied as an assertion, or an arbitrary URL beyond the closed
 * Key Vault operands. The shape below has nowhere to put any of them.
 *
 * **THE EXPECTED CLASS-5 IDENTITY IS DELIBERATELY ABSENT.** The locator says WHERE and WHICH
 * VERSION to resolve; it does not say what identity to CLAIM. The expected identity reaches
 * the runtime independently, through the accepted host machinery, and the comparison happens
 * there.
 */
export interface KeyVaultSecretLocator {
  readonly vaultUrl: string;
  readonly secretName: string;
  /** REQUIRED. An empty or absent version refuses rather than meaning "latest". */
  readonly secretVersion: string;
  /** The USER-ASSIGNED managed identity this plane authenticates as. Non-secret. */
  readonly managedIdentityClientId: string;
}

/**
 * **THE COMPLETE SET OF FIELDS A LIVE `SECRET_MANAGER_VERSION` DOCUMENT MAY CARRY.**
 *
 =================================================================================
 * WHY THIS IS A LIST AND NOT A HABIT
 *
 * The owner decision says the live Key Vault locator contains ONLY what is needed to
 * locate an exact secret version and authenticate as a user-assigned managed identity.
 * The first implementation honoured that by READING only those fields — which is a
 * different and weaker property: a document carrying `apiKey` alongside them still
 * parsed, and its secret simply went unread.
 *
 * **A LOCATOR THAT TOLERATES A SECRET IS NOT A CLOSED LOCATOR.** An operator who put a
 * key there would get a working run and no signal; the material would sit in a
 * deployment file that nothing audits, and the next reader of that file would
 * reasonably conclude it belonged there.
 *
 * So the set is enumerated and the check is EXACT. `assertExactFields` in
 * `artifactParsers.ts` applies the same discipline to signed artifacts, for the same
 * reason: what a document MAY contain is part of its contract.
 *
 * `revoked` is admitted because `§24`'s revocation switch is a property of the source
 * rather than of the mechanism — a deployment must be able to turn a live credential off
 * without rewriting its locator into another shape.
 *
 * `FILE_FIXTURE` keeps its OWN, wider, test-only schema. It is not permitted to widen
 * this one.
 =================================================================================
 */
export const LIVE_KEY_VAULT_DOCUMENT_FIELDS: readonly string[] = Object.freeze([
  'adapterId',
  'sourceKind',
  'revoked',
  'vaultUrl',
  'secretName',
  'secretVersion',
  'managedIdentityClientId',
]);

/**
 * Fields a live document may never carry, named individually.
 *
 * The closed set above already refuses every one of them — this list exists so a
 * REFUSAL can be traced to an intent rather than to an omission, and so a reviewer
 * reading the module can see which values were considered and forbidden rather than
 * merely unlisted.
 */
export const FORBIDDEN_LIVE_DOCUMENT_FIELDS: readonly string[] = Object.freeze([
  'apiKey',
  'credentialIdentity',
  'identityProvenance',
  'version',
  'accessToken',
  'clientSecret',
  'tenantId',
  'certificatePath',
  'privateKey',
  'simulatedAccountPath',
]);

/**
 * The canonical Azure Public Cloud Key Vault data-plane host form.
 *
 * `§5`: no HTTP, no credentials in the URL, no port override, no query, no fragment, no path,
 * no arbitrary hostname, no IP literal. **NOT WIDENED TO AZURE GOVERNMENT, CHINA OR PRIVATE
 * CLOUD ENDPOINTS** — the owner direction scopes S1P to Azure Public Cloud, and an explicit
 * future extension is the correct way to add another sovereign cloud rather than a looser
 * pattern that admits all of them today.
 */
const VAULT_HOST = /^[a-z0-9](?:[a-z0-9-]{1,22}[a-z0-9])?\.vault\.azure\.net$/;

/** Key Vault object names: alphanumerics and dashes, 1–127 characters. */
const SECRET_NAME = /^[0-9a-zA-Z-]{1,127}$/;

/** A Key Vault secret version is a 32-character hex identifier. */
const SECRET_VERSION = /^[0-9a-f]{32}$/;

/** A managed-identity client id is a GUID. Non-secret, and checked for shape only. */
const CLIENT_ID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Validate a configured vault URL to the canonical form, and return its host.
 *
 * **THIS RUNS BEFORE `SecretClient` IS CONSTRUCTED.** `§5`: "Do not turn Key Vault access into
 * an arbitrary network capability." The SDK would happily dial whatever origin it was handed,
 * so the narrowing has to happen on this side of the constructor.
 */
export function canonicalVaultHost(vaultUrl: unknown): string | null {
  if (typeof vaultUrl !== 'string' || vaultUrl.length === 0) return null;
  let parsed: URL;
  try {
    parsed = new URL(vaultUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  if (parsed.username.length > 0 || parsed.password.length > 0) return null;
  if (parsed.port.length > 0) return null;
  if (parsed.search.length > 0 || parsed.hash.length > 0) return null;
  // A bare origin only. `new URL('https://x.vault.azure.net')` normalises `pathname` to `/`.
  if (parsed.pathname !== '/' && parsed.pathname !== '') return null;
  if (!VAULT_HOST.test(parsed.hostname)) return null;
  return parsed.hostname;
}

/**
 * Parse the closed locator operands out of a deployment document.
 *
 * Constructed FIELD BY FIELD and never spread, for the reason `deploymentConfig.ts` gives:
 * a spread would carry an `apiKey` into the result the moment a confused operator added one,
 * and the only thing between that and a log line would be every caller's discipline.
 */
export function parseKeyVaultLocator(
  document: unknown,
): { readonly kind: 'LOCATOR'; readonly locator: KeyVaultSecretLocator } | { readonly kind: 'REFUSED'; readonly reason: KeyVaultRefusal } {
  if (typeof document !== 'object' || document === null || Array.isArray(document)) {
    return { kind: 'REFUSED', reason: 'LOCATOR_MALFORMED' };
  }
  const raw = document as Record<string, unknown>;

  /*
   * **THE CLOSED CHECK, AND IT RUNS FIRST.**
   *
   * Before the vault, before the name, before the version, before the managed identity: a
   * document carrying anything outside `LIVE_KEY_VAULT_DOCUMENT_FIELDS` is refused whole. That
   * ordering is the point — `§1` requires an unknown field to fail closed BEFORE
   * `ManagedIdentityCredential` is constructed, before `SecretClient` is constructed and
   * before any Key Vault read, and the earliest place that can be guaranteed is here, in the
   * parse that gates all three.
   *
   * The refusal names no value, only that the shape was wrong. A reason that echoed the
   * offending field's CONTENT would be a reason that could carry the secret it was refusing.
   */
  const offending = Object.keys(raw).filter(
    (field) => !LIVE_KEY_VAULT_DOCUMENT_FIELDS.includes(field),
  );
  if (offending.length > 0) {
    return { kind: 'REFUSED', reason: 'LOCATOR_FIELDS_NOT_CLOSED' };
  }

  if (canonicalVaultHost(raw['vaultUrl']) === null) {
    return { kind: 'REFUSED', reason: 'VAULT_URL_NOT_CANONICAL' };
  }
  const secretName = raw['secretName'];
  if (typeof secretName !== 'string' || !SECRET_NAME.test(secretName)) {
    return { kind: 'REFUSED', reason: 'SECRET_NAME_INVALID' };
  }
  const secretVersion = raw['secretVersion'];
  if (typeof secretVersion !== 'string' || secretVersion.length === 0) {
    /*
     * `§6` — AN ABSENT VERSION IS A REFUSAL, NOT A DEFAULT.
     *
     * This is the single most load-bearing branch in the module. Everything else here is a
     * check on something Key Vault said; this one stops the question that would have meant
     * "latest" from ever being asked.
     */
    return { kind: 'REFUSED', reason: 'SECRET_VERSION_ABSENT' };
  }
  if (!SECRET_VERSION.test(secretVersion)) {
    return { kind: 'REFUSED', reason: 'SECRET_VERSION_ABSENT' };
  }
  const managedIdentityClientId = raw['managedIdentityClientId'];
  if (typeof managedIdentityClientId !== 'string' || !CLIENT_ID.test(managedIdentityClientId)) {
    return { kind: 'REFUSED', reason: 'MANAGED_IDENTITY_CLIENT_ID_INVALID' };
  }

  return {
    kind: 'LOCATOR',
    locator: Object.freeze({
      vaultUrl: raw['vaultUrl'] as string,
      secretName,
      secretVersion,
      managedIdentityClientId,
    }),
  };
}

/**
 * The three things a versioned Key Vault secret id asserts, parsed strictly.
 *
 * `§5`: "If the SDK exposes an authoritative identifier parser suitable for validating a
 * returned Key Vault secret ID, use it. Otherwise implement the narrowest strict parser
 * necessary." `@azure/keyvault-secrets` v4 exposes no public id parser — `parseKeyVaultSecretIdentifier`
 * is not part of its published surface — so this is the narrow one, and it accepts ONLY the
 * canonical three-segment data-plane form.
 */
export function parseVersionedSecretId(
  id: unknown,
): { readonly vaultHost: string; readonly name: string; readonly version: string } | null {
  if (typeof id !== 'string' || id.length === 0) return null;
  let parsed: URL;
  try {
    parsed = new URL(id);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  if (parsed.username.length > 0 || parsed.password.length > 0) return null;
  if (parsed.port.length > 0) return null;
  if (parsed.search.length > 0 || parsed.hash.length > 0) return null;
  if (!VAULT_HOST.test(parsed.hostname)) return null;

  const segments = parsed.pathname.split('/').filter((segment) => segment.length > 0);
  // EXACTLY three: `secrets`, the name, the version. A two-segment id is the VERSIONLESS
  // form — the mutable alias — and it is refused here rather than accepted as a match.
  if (segments.length !== 3) return null;
  if (segments[0] !== 'secrets') return null;
  const name = segments[1]!;
  const version = segments[2]!;
  if (!SECRET_NAME.test(name) || !SECRET_VERSION.test(version)) return null;
  return { vaultHost: parsed.hostname, name, version };
}

/**
 * What one Key Vault answer carries, narrowed to what this module reads.
 *
 * A STRUCTURAL subset of `KeyVaultSecret`, so the production path passes the SDK's own object
 * unchanged and a test double is a plain literal. Widening this would be widening what the
 * binding depends on.
 */
export interface KeyVaultSecretAnswer {
  readonly value?: string | undefined;
  readonly properties: {
    readonly id?: string | undefined;
    readonly name?: string | undefined;
    readonly version?: string | undefined;
    readonly vaultUrl?: string | undefined;
    readonly enabled?: boolean | undefined;
    readonly notBefore?: Date | undefined;
    readonly expiresOn?: Date | undefined;
  };
}

/**
 * ONE read of ONE exact version. There is no parameter through which another could be asked.
 *
 * `§10`: the seam exists for MODULE TESTING, not for IPC. The exported production factory
 * always constructs the real `ManagedIdentityCredential` and the real `SecretClient`, and the
 * control plane cannot hand this process a network client — `createAdapterSecretSource` takes
 * a locator string and nothing else.
 */
export type KeyVaultReader = (
  secretName: string,
  secretVersion: string,
) => Promise<KeyVaultSecretAnswer>;

export type KeyVaultReaderFactory = (locator: KeyVaultSecretLocator) => KeyVaultReader;

/**
 * THE PRODUCTION FACTORY. **`ManagedIdentityCredential` AND `SecretClient`, AND NOTHING ELSE.**
 *
 * The client id is passed EXPLICITLY, in the object form, so the credential is pinned to one
 * user-assigned identity. The two-argument `(clientId, options)` overload would do the same
 * thing; the object form is used because it names the field, and a reviewer should not have to
 * know an overload to see which identity this process authenticates as.
 */
export const createKeyVaultReader: KeyVaultReaderFactory = (locator) => {
  // PERIMETER_EXEMPT(credential_material_resolution, 50-2g) — ONE deterministic
  // principal. The owner decision forbids a credential chain, so this construction is
  // the whole of how this process authenticates to Azure, and it is annotated as such.
  const credential = new ManagedIdentityCredential({
    // `@azure/identity` v4 names this option `clientId` on
    // `ManagedIdentityCredentialClientIdOptions`. The LOCATOR field is
    // `managedIdentityClientId` because that is what it is to a deployment operator; the
    // mapping happens here, once, and the object form is used so a reviewer can see WHICH
    // identity is pinned without knowing the positional overload.
    clientId: locator.managedIdentityClientId,
  });
  // PERIMETER_EXEMPT(credential_material_resolution, 50-2g) — the deployment secret manager,
  // not a provider boundary. It carries no authorisation_ref because it dispatches no effect;
  // it resolves the exact material an effect's adapter will later present.
  const client = new SecretClient(locator.vaultUrl, credential);
  return (secretName, secretVersion) =>
    // EXPLICIT VERSION, ALWAYS. `getSecret(name)` — the versionless call — appears nowhere in
    // this package, and `tests/sendgrid/key-vault-binding.test.ts` asserts that by source scan.
    client.getSecret(secretName, { version: secretVersion });
};

/** The resolution this module produces. Material plus the identity KEY VAULT established. */
export type KeyVaultResolution =
  | {
      readonly kind: 'RESOLVED';
      readonly secret: string;
      /** `secret.properties.id` — the string Key Vault sent, unmodified. */
      readonly credentialIdentity: string;
      readonly version: string;
    }
  | { readonly kind: 'REFUSED'; readonly reason: KeyVaultRefusal };

/**
 * Whether a candidate identity is derived from the material it claims to identify.
 *
 * A THIRD implementation of the rule `secretSource.ts` and the accepted host each carry, and
 * it is restated for the reason the audit copy of this file exists: these packages share no
 * module. It runs here so a derived identity never leaves this function — and a versioned
 * Key Vault id could only be derived from the secret if the vault had been configured
 * pathologically, which is exactly the case a control must cover rather than assume away.
 */
function identityIsDerivedFromSecret(identity: string, secret: string): boolean {
  if (identity.length === 0 || secret.length === 0) return true;
  if (identity.includes(secret) || secret.includes(identity)) return true;
  if (identity === Buffer.from(secret, 'utf8').toString('hex')) return true;
  if (identity === Buffer.from(secret, 'utf8').toString('base64')) return true;
  return false;
}

/**
 * RESOLVE THE CONFIGURED EXACT SECRET VERSION, OR REFUSE.
 *
 * =================================================================================
 * THE ORDER OF CHECKS IS THE SAFETY PROPERTY
 *
 *   1  the locator is parsed, so a missing version refuses BEFORE any call;
 *   2  ONE call, with the explicit version;
 *   3  the RETURNED metadata is validated against the configuration — vault, name, version —
 *      and a mismatch in any of the three refuses;
 *   4  usability metadata is checked;
 *   5  only then does the returned id become the credential identity.
 *
 * **THERE IS NO STEP 6.** No retry, no second version, no other secret name, no fallback
 * vault. A refusal is final for this resolution, and the next `resolve()` re-reads the
 * locator from scratch — which is what makes `§24`'s revocation switch and `§25`'s rotation
 * operable without restarting anything.
 * =================================================================================
 */
export async function resolveExactSecretVersion(
  locator: KeyVaultSecretLocator,
  readSecret: KeyVaultReader,
  now: Date = new Date(),
): Promise<KeyVaultResolution> {
  const configuredHost = canonicalVaultHost(locator.vaultUrl);
  if (configuredHost === null) {
    return { kind: 'REFUSED', reason: 'VAULT_URL_NOT_CANONICAL' };
  }

  let answer: KeyVaultSecretAnswer;
  try {
    answer = await readSecret(locator.secretName, locator.secretVersion);
  } catch {
    /*
     * `§12` — THE SDK EXCEPTION IS NOT CARRIED, AND THAT IS DELIBERATE.
     *
     * An Azure error body can contain a request id, headers and occasionally echoed request
     * detail. Mapping every failure onto one non-secret reason means no exception body can
     * reach a log, an error message or the evidence bundle through this path.
     */
    return { kind: 'REFUSED', reason: 'KEY_VAULT_UNREACHABLE' };
  }

  /*
   * `typeof null === 'object'`, SO THE NULL CHECK IS NOT REDUNDANT.
   *
   * A response whose `properties` is `null` satisfies the `typeof` test and then throws
   * on the first field read — which would escape this function as an exception rather
   * than as a refusal, and an exception here is one the caller maps to `UNAVAILABLE`
   * without a reason. A malformed answer is a refusal, and it is named.
   */
  if (
    typeof answer !== 'object' ||
    answer === null ||
    typeof answer.properties !== 'object' ||
    answer.properties === null
  ) {
    return { kind: 'REFUSED', reason: 'KEY_VAULT_UNREACHABLE' };
  }
  const properties = answer.properties;

  const returned = parseVersionedSecretId(properties.id);
  if (properties.id === undefined || properties.id === null || properties.id === '') {
    // NO RETURNED ID MEANS NO ESTABLISHED IDENTITY. The material is not handed on.
    return { kind: 'REFUSED', reason: 'RETURNED_ID_ABSENT' };
  }
  if (returned === null) return { kind: 'REFUSED', reason: 'RETURNED_ID_MALFORMED' };

  /*
   * THE CONFIGURATION CHECKS THE RETURNED ID. IT DOES NOT BUILD IT.
   *
   * Three independent comparisons, each with its own refusal, so a reviewer reading a refusal
   * learns WHICH of the three disagreed. A single "identity mismatch" reason would hide
   * whether a vault was misconfigured or a version had rotated.
   */
  if (returned.vaultHost !== configuredHost) {
    return { kind: 'REFUSED', reason: 'RETURNED_VAULT_MISMATCH' };
  }
  if (returned.name !== locator.secretName) {
    return { kind: 'REFUSED', reason: 'RETURNED_NAME_MISMATCH' };
  }
  if (returned.version !== locator.secretVersion) {
    return { kind: 'REFUSED', reason: 'RETURNED_VERSION_MISMATCH' };
  }

  /*
   * AND THE SEPARATELY-REPORTED `properties.version` MUST AGREE TOO.
   *
   * Key Vault reports the version twice — inside `id` and as its own field — and this checks
   * both. A response where they disagreed would be one this module could not interpret, and
   * accepting the half that matched would be choosing the convenient reading.
   */
  if (properties.version === undefined || properties.version !== locator.secretVersion) {
    return { kind: 'REFUSED', reason: 'RETURNED_VERSION_MISMATCH' };
  }
  if (properties.name !== undefined && properties.name !== locator.secretName) {
    return { kind: 'REFUSED', reason: 'RETURNED_NAME_MISMATCH' };
  }
  if (properties.vaultUrl !== undefined) {
    const answeredHost = canonicalVaultHost(properties.vaultUrl);
    if (answeredHost === null || answeredHost !== configuredHost) {
      return { kind: 'REFUSED', reason: 'RETURNED_VAULT_MISMATCH' };
    }
  }

  /*
   * `§6` — USABILITY, AS KEY VAULT REPORTS IT.
   *
   * **WHAT IS CHECKED**: `enabled === false` refuses; `notBefore` in the future refuses;
   * `expiresOn` in the past refuses.
   *
   * **WHAT IS NOT CHECKED, AND WHY**: no clock policy is invented beyond those three
   * comparisons. Key Vault itself refuses a disabled or out-of-window secret on the service
   * side, so these are a defence in depth against a response that reached this process
   * anyway — not a reimplementation of the service's rule. `now` is injected so the boundary
   * is testable without freezing a global clock.
   */
  if (properties.enabled === false) return { kind: 'REFUSED', reason: 'SECRET_DISABLED' };
  if (properties.notBefore instanceof Date && properties.notBefore.getTime() > now.getTime()) {
    return { kind: 'REFUSED', reason: 'SECRET_NOT_CURRENTLY_VALID' };
  }
  if (properties.expiresOn instanceof Date && properties.expiresOn.getTime() <= now.getTime()) {
    return { kind: 'REFUSED', reason: 'SECRET_NOT_CURRENTLY_VALID' };
  }

  const secret = answer.value;
  if (typeof secret !== 'string' || secret.length === 0) {
    return { kind: 'REFUSED', reason: 'SECRET_VALUE_ABSENT' };
  }
  if (identityIsDerivedFromSecret(properties.id, secret)) {
    return { kind: 'REFUSED', reason: 'IDENTITY_DERIVED_FROM_SECRET' };
  }

  return {
    kind: 'RESOLVED',
    secret,
    /*
     * **THE RETURNED ID, VERBATIM.**
     *
     * Not `${locator.vaultUrl}/secrets/${name}/${version}`. The configuration has already
     * been used to check this string; using it to BUILD the string would make the identity a
     * value this process composed and then attributed to Key Vault.
     */
    credentialIdentity: properties.id,
    version: properties.version,
  };
}
