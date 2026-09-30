import { readFileSync } from 'node:fs';

import {
  createKeyVaultReader,
  parseKeyVaultLocator,
  resolveExactSecretVersion,
  type KeyVaultReaderFactory,
} from './keyVault.js';

import type {
  AdapterSecretSource,
  CredentialIdentityProvenance,
  SecretResolution,
} from '../../../src/integration/runtime/adapterSecretSource.js';

/**
 * THE SENDGRID SEND CREDENTIAL'S SOURCE — `§30`, `50 §2g` FIELD 1.
 *
 * =================================================================================
 * THE DEFECT THIS FILE WAS REWRITTEN TO CLOSE — S1P INDEPENDENT REVIEW, CORRECTION 3
 *
 * The rejected source read THREE values out of one mutable JSON document — `apiKey`,
 * `credentialIdentity` and `identityProvenance` — and admitted a live run whenever the third
 * of them said the string `PROVIDER_KEY_ID`. The review, verbatim:
 *
 *     A document containing: secret B / credentialIdentity A / identityProvenance
 *     PROVIDER_KEY_ID is still only a labelled mismatch unless some trusted
 *     provider/secret-manager mechanism establishes the binding.
 *
 * That is correct and it is fatal to the old design. `50 §2g` field 1 requires the identity
 * of THE EXACT MATERIAL the runtime may present, and a file that asserts an identity beside a
 * secret has asserted an adjacency, not a binding. Anyone who can edit the file can make any
 * secret claim any identity.
 *
 * =================================================================================
 * THE RULE THIS FILE NOW ENFORCES
 *
 * **PROVENANCE IS A PROPERTY OF THE MECHANISM THAT RESOLVED THE MATERIAL. IT IS NEVER A
 * FIELD OF THE DOCUMENT.**
 *
 * `identityProvenance` is no longer read from the document at all. It is ASSIGNED by the
 * source that produced the material, and each source may assign only the provenance its own
 * mechanism actually establishes:
 *
 *   `FILE_FIXTURE`             -> `SYNTHETIC_TEST_IDENTITY`. A file can carry material and a
 *                                 label. It cannot bind them. So the honest provenance is the
 *                                 fixture one, whatever the file says, and `preflight.ts`
 *                                 refuses a LIVE run on it (`INTEGRATION_IDENTITY_NOT_
 *                                 MATERIAL_BOUND`). `§3.1`: "If retained as a credential
 *                                 fixture, its live preflight status must fail closed."
 *   `SECRET_MANAGER_VERSION`   -> assigns `DEPLOYMENT_SECRET_VERSION`: an IMMUTABLE
 *                                 secret-manager version identity returned BY THE MANAGER
 *                                 ALONGSIDE the material it versions, in one answer, so the
 *                                 identity is of the exact bytes returned.
 *   `PROVIDER_KEY_ID_BINDING`  -> would assign `PROVIDER_KEY_ID`: a provider-issued stable
 *                                 non-secret key id, established by a mechanism that can say
 *                                 the id belongs to the exact material returned.
 *
 * =================================================================================
 * **`SECRET_MANAGER_VERSION` IS NOW PROVISIONED — AZURE KEY VAULT, EXACT VERSION.**
 *
 * The owner has selected the mechanism: Azure Key Vault immutable secret VERSION binding. The
 * secret material is a Key Vault secret; ACOS always fetches an EXACT version and never
 * resolves `latest`; and the signed class-5 `credential_id` is the FULL VERSIONED SECRET ID
 * Key Vault returns for that exact material:
 *
 *     https://<vault>.vault.azure.net/secrets/<secret-name>/<version>
 *
 * `keyVault.ts` in THIS package implements it, and the branch below is the only way into it.
 * The material and the identity come out of ONE Key Vault response, which is what makes the
 * binding real rather than adjacent — the defect correction 3 closed.
 *
 * `PROVIDER_KEY_ID_BINDING` REMAINS UNPROVISIONED AND STILL REFUSES. It is not implemented
 * merely because it exists in the enum: no mechanism binds a SendGrid `api_key_id` to material
 * this process holds, obtaining one would need a broad administrative credential no accepted
 * architecture permits, and `§3.3` forbids adding one for this purpose.
 *
 * =================================================================================
 * `§3.3` — THE NONEXISTENT PROOF IS GONE
 *
 * The rejected file's comment claimed that "`§8.7`'s read-back probe is what establishes that
 * the id written here is the id of the key whose material is in `apiKey`". **NO SUCH PROBE
 * EXISTS**, and the one `scopeProbes.ts` does implement measures a capability, not an
 * identity: it asks whether a credential can perform an operation, which answers nothing
 * about which key id the credential IS. The claim is removed rather than reworded, and the
 * live path stays blocked. Obtaining a real `api_key_id` binding would need a broad SendGrid
 * administrative credential to enumerate keys, which no accepted architecture permits and
 * which `§3.3` forbids adding for this purpose.
 *
 * =================================================================================
 * `§24` — THE REVOCATION SWITCH IS A STATE OF THE SOURCE, NOT A FLAG IN ACOS
 *
 * `revoked: true` returns `CREDENTIAL_REVOKED` **with no material**. There is nothing in hand
 * for a missed check to leak. The document is re-read on EVERY `resolve()`, which is what
 * makes the switch operable without restarting anything and what makes `§25`'s rotation work.
 *
 * **THE DOCUMENT IS NOT IN THIS REPOSITORY.** The locator names a path on the deployment
 * host. Nothing in this tree names one, no fixture writes a real key, and `§19` forbids
 * committing one.
 * =================================================================================
 */

/**
 * The mechanisms a deployment may declare. **THE DECLARATION SELECTS A MECHANISM; IT DOES
 * NOT ASSERT AN OUTCOME.** An unknown value resolves nothing.
 */
export const CREDENTIAL_SOURCE_KINDS = [
  /** A file holding material and a label. Binds nothing, and says so. */
  'FILE_FIXTURE',
  /** An immutable secret-manager version. UNPROVISIONED in this repository. */
  'SECRET_MANAGER_VERSION',
  /** A provider-issued key id bound to the exact material. UNPROVISIONED. */
  'PROVIDER_KEY_ID_BINDING',
] as const;

export type CredentialSourceKind = (typeof CREDENTIAL_SOURCE_KINDS)[number];

export function isCredentialSourceKind(value: unknown): value is CredentialSourceKind {
  return typeof value === 'string' && (CREDENTIAL_SOURCE_KINDS as readonly string[]).includes(value);
}

/**
 * The provenance each mechanism is ENTITLED to assign. Read by the source, never by the
 * document, and exported so `tests/sendgrid/credential-binding.test.ts` can assert the map
 * rather than the file's own word for it.
 */
export const PROVENANCE_BY_SOURCE_KIND: Readonly<
  Record<CredentialSourceKind, CredentialIdentityProvenance>
> = Object.freeze({
  FILE_FIXTURE: 'SYNTHETIC_TEST_IDENTITY',
  SECRET_MANAGER_VERSION: 'DEPLOYMENT_SECRET_VERSION',
  PROVIDER_KEY_ID_BINDING: 'PROVIDER_KEY_ID',
});

/**
 * The provenances that may carry a REAL live run. `SYNTHETIC_TEST_IDENTITY` is absent, and
 * its absence is the point.
 *
 * Kept exported because `preflight.ts` evaluates the same question one layer up, on a fact
 * rather than on a resolution: a harness that could not see the provenance would have to
 * trust the source's refusal, and `§8.5` wants the gate to be evaluable offline.
 */
export const LIVE_IDENTITY_PROVENANCES: readonly CredentialIdentityProvenance[] = Object.freeze([
  'PROVIDER_KEY_ID',
  'DEPLOYMENT_SECRET_VERSION',
]);

/** Whether a declared provenance may govern a real provider credential. */
export function isLiveIdentityProvenance(value: unknown): value is CredentialIdentityProvenance {
  return (
    typeof value === 'string' && (LIVE_IDENTITY_PROVENANCES as readonly string[]).includes(value)
  );
}

/**
 * Whether a candidate identity is derived from the material it claims to identify.
 *
 * A SECOND implementation of the accepted host's `credentialLabelsAreNonDerived`, applied
 * BEFORE the resolution is constructed rather than after. Both are kept: the host's is the
 * one that runs on every plane, and this one means a derived identity never leaves this file.
 */
export function identityIsDerivedFromSecret(identity: string, secret: string): boolean {
  if (identity.length === 0 || secret.length === 0) return true;
  if (identity.includes(secret) || secret.includes(identity)) return true;
  if (identity === Buffer.from(secret, 'utf8').toString('hex')) return true;
  if (identity === Buffer.from(secret, 'utf8').toString('base64')) return true;
  return false;
}

/**
 * THE NON-SECRET AZURE PRINCIPAL A SOURCE IS CONFIGURED TO RESOLVE AS.
 *
 * =================================================================================
 * WHY THE SOURCE REPORTS THIS, AND NOT THE COORDINATOR
 *
 * The owner decision makes DISTINCT user-assigned managed identities part of the security
 * boundary: the Azure principal allowed to read the send key must not be the one allowed to
 * read the audit key. Enforcing that needs the parent to compare two values — and the parent
 * must not obtain them by reading either plane's locator file, because a coordinator that
 * could read a locator could read whatever a confused operator had put in it.
 *
 * So each SOURCE reports its own, through the ACCEPTED one-shot identity-probe boundary that
 * already carries `resolvedIdentity` and `identityProvenance`. The integration child reports
 * only the integration value; the audit child reports only the audit value; neither is ever
 * handed the other's locator.
 *
 * **THE VALUE IS A GUID AND IS NON-SECRET.** A managed-identity client id names a principal;
 * it authenticates nobody. Possession of it grants nothing, which is why it may cross the
 * probe reply when a token or a client secret may not.
 *
 * **IT IS A DIFFERENT CONTROL FROM THE CREDENTIAL-IDENTITY CHECK, AND NEITHER SUBSTITUTES.**
 * The Key Vault credential identity says WHICH SendGrid material and version was resolved; the
 * managed-identity client id says WHICH AZURE PRINCIPAL was allowed to resolve it. Two planes
 * could hold two distinct secrets behind one over-privileged identity, and that is exactly the
 * configuration this reports.
 * =================================================================================
 */
export interface SourcePrincipalReport {
  /**
   * The non-secret principal, or `null` when the mechanism has none.
   *
   * `FILE_FIXTURE` reports `null` and MUST: a file-backed fixture authenticates to no Azure
   * principal, and reporting a plausible GUID would let an offline mechanism satisfy a live
   * gate. `§2`'s requirement that the fixture path stay honestly synthetic is this `null`.
   */
  readonly principalIdentity: string | null;
  /** Which mechanism answered, so a reviewer can tell a `null` apart from an absence. */
  readonly mechanism: string | null;
}

/**
 * The optional capability a secret source may implement.
 *
 * Feature-detected structurally by `probeRuntime.ts`, and declared HERE rather than on the
 * accepted `AdapterSecretSource` contract in `src/`: the Azure principal is a property of the
 * S1P validation mechanism, and widening a production interface for a validation-only concern
 * would put it on every adapter source that will ever exist.
 */
export interface SourcePrincipalDescriber {
  describeSourcePrincipal(): SourcePrincipalReport;
}

interface DeploymentDocument {
  readonly adapterId?: unknown;
  readonly sourceKind?: unknown;
  readonly apiKey?: unknown;
  readonly credentialIdentity?: unknown;
  readonly version?: unknown;
  readonly revoked?: unknown;
  /*
   * THE KEY VAULT OPERANDS. Declared as `unknown` and parsed by `parseKeyVaultLocator`.
   *
   * **NONE OF THEM IS READ ON THE `FILE_FIXTURE` PATH, AND `apiKey` IS NEVER READ ON THE
   * KEY VAULT PATH.** The two branches consume disjoint field sets, so a document cannot
   * carry a fixture secret into a live resolution or a vault address into a fixture one.
   */
  readonly vaultUrl?: unknown;
  readonly secretName?: unknown;
  readonly secretVersion?: unknown;
  readonly managedIdentityClientId?: unknown;
}

class SendGridSecretSource implements AdapterSecretSource {
  public readonly declaredAdapterId: string;

  private readonly locator: string;

  /**
   * THE AZURE SDK BOUNDARY, AS A MODULE-TEST SEAM. `§10`.
   *
   * Defaults to `createKeyVaultReader`, which constructs the REAL
   * `ManagedIdentityCredential` and the REAL `SecretClient`. `createAdapterSecretSource`
   * below does not expose it, so the CONTROL PLANE cannot hand this process a network client
   * — it passes an adapter id and a locator path and nothing else. The seam exists so
   * `tests/sendgrid/key-vault-binding.test.ts` can drive every refusal without contacting
   * Azure, and for no other reason.
   */
  private readonly readerFactory: KeyVaultReaderFactory;

  public constructor(
    adapterId: string,
    locator: string,
    readerFactory: KeyVaultReaderFactory = createKeyVaultReader,
  ) {
    this.declaredAdapterId = adapterId;
    this.locator = locator;
    this.readerFactory = readerFactory;
  }

  /**
   * REPORT THE AZURE PRINCIPAL THIS SOURCE IS CONFIGURED TO RESOLVE AS.
   *
   * It re-reads and re-parses its OWN locator through the CLOSED parser — the same parse
   * `resolve()` performs — so a document this source would refuse cannot report a principal
   * either. A malformed or non-closed document answers `null`, and the stage-2 gate then
   * refuses on `INTEGRATION_SOURCE_PRINCIPAL_UNAVAILABLE` rather than on a guess.
   *
   * **NO MATERIAL IS TOUCHED.** This never contacts Azure, never constructs a credential and
   * never reads the vault; it reads a GUID out of a configuration file it already reads.
   */
  public describeSourcePrincipal(): SourcePrincipalReport {
    let document: DeploymentDocument;
    try {
      document = JSON.parse(readFileSync(this.locator, 'utf8')) as DeploymentDocument;
    } catch {
      return { principalIdentity: null, mechanism: null };
    }
    if (document.adapterId !== this.declaredAdapterId) {
      return { principalIdentity: null, mechanism: null };
    }
    if (!isCredentialSourceKind(document.sourceKind)) {
      return { principalIdentity: null, mechanism: null };
    }
    if (document.sourceKind !== 'SECRET_MANAGER_VERSION') {
      /*
       * A FIXTURE AUTHENTICATES TO NO AZURE PRINCIPAL, AND SAYS SO.
       *
       * Returning a plausible GUID here would let `FILE_FIXTURE` satisfy a gate that exists to
       * constrain a live Azure configuration. The mechanism is named so the absence is
       * legible; the principal is `null` because there is not one.
       */
      return { principalIdentity: null, mechanism: document.sourceKind };
    }
    const parsed = parseKeyVaultLocator(document);
    return parsed.kind === 'LOCATOR'
      ? {
          principalIdentity: parsed.locator.managedIdentityClientId,
          mechanism: 'SECRET_MANAGER_VERSION',
        }
      : { principalIdentity: null, mechanism: 'SECRET_MANAGER_VERSION' };
  }

  public resolve(): Promise<SecretResolution> {
    let document: DeploymentDocument;
    try {
      document = JSON.parse(readFileSync(this.locator, 'utf8')) as DeploymentDocument;
    } catch {
      return Promise.resolve({ kind: 'UNAVAILABLE' });
    }

    /*
     * `§7`, `23 §7` — THE SOURCE SERVES ONE ADAPTER AND REFUSES THE REST.
     *
     * A document whose `adapterId` is not this source's own is UNAVAILABLE, never a
     * credential for another adapter. `resolve()` takes no selector, so there is no ask this
     * check could be asked to answer differently.
     */
    if (document.adapterId !== this.declaredAdapterId) {
      return Promise.resolve({ kind: 'UNAVAILABLE' });
    }
    if (document.revoked === true) return Promise.resolve({ kind: 'CREDENTIAL_REVOKED' });

    if (!isCredentialSourceKind(document.sourceKind)) {
      // An UNDECLARED mechanism is not a default mechanism. A document written before this
      // correction — one carrying `identityProvenance` and no `sourceKind` — lands here and
      // resolves NOTHING, which is the intended migration: the old shape cannot be
      // reinterpreted as any of the three, least of all as a binding one.
      return Promise.resolve({ kind: 'UNAVAILABLE' });
    }

    /*
     * `§8` — THE PROVISIONED MECHANISM: AZURE KEY VAULT, EXACT SECRET VERSION.
     *
     * Everything that decides the outcome happens in `keyVault.ts`: the closed operand parse,
     * the canonical-vault narrowing, the single explicit-version read, the validation of the
     * RETURNED identifier against the configuration, and the usability metadata. This branch
     * only assigns the provenance the mechanism has earned.
     */
    if (document.sourceKind === 'SECRET_MANAGER_VERSION') {
      return this.resolveFromKeyVault(document);
    }

    /*
     * `PROVIDER_KEY_ID_BINDING` IS STILL UNPROVISIONED, AND THE REFUSAL IS HERE RATHER THAN
     * IN A DOCUMENT.
     *
     * A deployment that declares it is declaring an intention this repository cannot honour:
     * no provider read-back establishes that a SendGrid `api_key_id` belongs to material this
     * process holds, and `scopeProbes.ts` measures a CAPABILITY rather than an identity.
     * Returning the material with a borrowed provenance is precisely the fake binding `§3`
     * rejects, so the source resolves nothing.
     */
    if (document.sourceKind !== 'FILE_FIXTURE') {
      return Promise.resolve({ kind: 'UNAVAILABLE' });
    }

    const secret = document.apiKey;
    if (typeof secret !== 'string' || secret.length === 0) {
      return Promise.resolve({ kind: 'UNAVAILABLE' });
    }

    const identity = document.credentialIdentity;
    if (typeof identity !== 'string' || identity.length === 0) {
      // `§10` of the S1O correction: "Null identity is not sufficient for a configured real
      // credential." A source that cannot name what it resolved has not resolved one.
      return Promise.resolve({ kind: 'UNAVAILABLE' });
    }
    if (identityIsDerivedFromSecret(identity, secret)) {
      return Promise.resolve({ kind: 'UNAVAILABLE' });
    }

    return Promise.resolve({
      kind: 'RESOLVED',
      credential: {
        secret,
        credentialIdentity: identity,
        /*
         * ASSIGNED BY THE MECHANISM. The document has no vote.
         *
         * This is the single line that closes correction 3 for this plane: whatever a file
         * claims about how its label was established, a FILE established it, and a file
         * cannot bind a label to bytes.
         */
        identityProvenance: PROVENANCE_BY_SOURCE_KIND.FILE_FIXTURE,
        version: typeof document.version === 'string' ? document.version : null,
      },
    });
  }

  /**
   * RESOLVE THE EXACT AZURE KEY VAULT SECRET VERSION THE LOCATOR NAMES.
   *
   * =================================================================================
   * THE DOCUMENT'S OWN `credentialIdentity` IS NOT READ ON THIS PATH, AND THAT IS THE POINT
   *
   * A deployment document may carry a `credentialIdentity` field — the `FILE_FIXTURE` path
   * requires one. On THIS path it is ignored entirely: the identity comes from
   * `properties.id` in the Key Vault response and from nowhere else, so an operator who wrote
   * a flattering identity beside the vault operands has written a value nothing reads.
   *
   * `tests/sendgrid/key-vault-binding.test.ts` drives exactly that case.
   * =================================================================================
   */
  private async resolveFromKeyVault(document: DeploymentDocument): Promise<SecretResolution> {
    const parsed = parseKeyVaultLocator(document);
    if (parsed.kind === 'REFUSED') {
      /*
       * `§12` — THE REASON DOES NOT LEAVE THIS FUNCTION.
       *
       * `AdapterSecretSource` has exactly three outcomes and no diagnostic channel, which is
       * the accepted contract: a source that could describe its failure to the host would be
       * a source that could describe its material. The non-secret reason exists for the
       * module's own tests, which call `keyVault.ts` directly.
       */
      return { kind: 'UNAVAILABLE' };
    }

    const resolution = await resolveExactSecretVersion(
      parsed.locator,
      this.readerFactory(parsed.locator),
    );
    if (resolution.kind === 'REFUSED') return { kind: 'UNAVAILABLE' };

    return {
      kind: 'RESOLVED',
      credential: {
        secret: resolution.secret,
        /*
         * **THE IDENTITY KEY VAULT RETURNED.** Not one this source composed, and not one the
         * document offered.
         */
        credentialIdentity: resolution.credentialIdentity,
        /*
         * EARNED, NOT DECLARED. An immutable secret-manager version returned the material and
         * its identifier in one answer, so `DEPLOYMENT_SECRET_VERSION` is what that mechanism
         * establishes — and `preflight.ts` admits it for a LIVE run because of that, not
         * because a document said so.
         */
        identityProvenance: PROVENANCE_BY_SOURCE_KIND.SECRET_MANAGER_VERSION,
        version: resolution.version,
      },
    };
  }
}

/**
 * THE PRODUCTION FACTORY. **NO SEAM IS EXPOSED HERE.**
 *
 * `§10`: "Do NOT make the production source accept an arbitrary caller-provided network
 * client from the control plane." Two fields — an adapter id and a locator path — and there
 * is no third through which a client, a credential or a token could arrive. The runtime host
 * calls this; the test seam is reachable only from inside this module's own test.
 */
export function createAdapterSecretSource(input: {
  readonly adapterId: string;
  readonly locator: string;
}): AdapterSecretSource {
  return new SendGridSecretSource(input.adapterId, input.locator);
}

/**
 * TEST-ONLY construction, for `tests/sendgrid/key-vault-binding.test.ts`.
 *
 * It exists so the Azure SDK boundary can be replaced by a double WITHOUT weakening the
 * runtime contract above: the exported production factory still always uses the real
 * credential and the real client, and this export is never referenced by `src/` or by the
 * runtime host. `tests/sendgrid/prerequisites-and-separation.test.ts` computes the closures
 * that keep that true.
 */
export function createAdapterSecretSourceForTest(input: {
  readonly adapterId: string;
  readonly locator: string;
  readonly readerFactory: KeyVaultReaderFactory;
}): AdapterSecretSource {
  return new SendGridSecretSource(input.adapterId, input.locator, input.readerFactory);
}
