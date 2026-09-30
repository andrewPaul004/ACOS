import { readFileSync } from 'node:fs';

import {
  createAuditKeyVaultReader,
  parseAuditKeyVaultLocator,
  resolveAuditExactSecretVersion,
  type AuditKeyVaultReaderFactory,
} from './keyVault.js';

import type {
  AuditCredentialIdentityProvenance,
  AuditReadSecretSource,
  AuditSecretResolution,
} from '../../../src/audit/provider/runtime/auditSecretSource.js';

/**
 * THE SENDGRID AUDIT READ CREDENTIAL'S SOURCE — `§13`, `48 §3.6`, `50 §2g` FIELD 1.
 *
 * =================================================================================
 * IT IS A DIFFERENT SOURCE, IN A DIFFERENT PACKAGE, READING A DIFFERENT DOCUMENT
 *
 * `§14` of the S1O mandate requires the audit plane to hold "separate credential source;
 * separate environment allowlist; no control send credential". All three are properties of
 * the composition rather than checks this file performs:
 *
 *   - this module is loaded from `ACOS_AUDIT_READ_SECRET_SOURCE_MODULE`, a key that does not
 *     exist in the integration plane's eight-key allowlist;
 *   - its locator arrives on `ACOS_AUDIT_READ_SECRET_LOCATOR`, likewise;
 *   - `createAuditReaderRegistry` refuses `READER_LOCATOR_SHARED_WITH_INTEGRATION` when the
 *     two locators collide, so the deployment cannot point them at one document.
 *
 * **AND THE INTEGRATION PACKAGE IS NOT IMPORTED HERE.** `validation/sendgrid/integration/`
 * and `validation/sendgrid/audit/` share no module, which
 * `tests/sendgrid/prerequisites-and-separation.test.ts` asserts over the two import closures.
 *
 * =================================================================================
 * CORRECTION 3, APPLIED INDEPENDENTLY TO THIS PLANE
 *
 * `§3.4` of the S1P correction mandate: "Apply the same correction independently to
 * integration and audit credentials." The defect and the rule are the same as the send side's
 * and are restated rather than imported, for the reason the derived-label refusal below is
 * restated: these two packages share no module by construction.
 *
 * **PROVENANCE IS A PROPERTY OF THE MECHANISM THAT RESOLVED THE MATERIAL, NEVER A FIELD OF
 * THE DOCUMENT.** A file can carry a secret and a label; it cannot bind them, so a file-backed
 * source assigns `SYNTHETIC_TEST_IDENTITY` whatever the file says, and the live preflight
 * refuses on `AUDIT_IDENTITY_NOT_MATERIAL_BOUND`.
 *
 * The two binding mechanisms — an immutable secret-manager credential version, or a
 * provider-issued key id established by a mechanism that can say the id belongs to the exact
 * material returned — are DECLARED and UNPROVISIONED. Neither exists in this repository, and
 * `§3.2` prefers an honest UNPROVISIONED to a fake binding.
 *
 * **THIS MATTERS MORE ON THE AUDIT PLANE THAN ON THE SEND PLANE, NOT LESS.** `48 §3.6`'s
 * read-only exemption rests on a signed declaration, and the declaration is only ABOUT the
 * credential in hand if the source can name what it resolved in a form the provider or the
 * secret manager establishes. An audit reader admitted on a document's own word about which
 * key it holds is an audit plane whose independence rests on a text file.
 * =================================================================================
 */

/** The mechanisms a deployment may declare. A declaration selects; it does not assert. */
export const AUDIT_CREDENTIAL_SOURCE_KINDS = [
  'FILE_FIXTURE',
  'SECRET_MANAGER_VERSION',
  'PROVIDER_KEY_ID_BINDING',
] as const;

export type AuditCredentialSourceKind = (typeof AUDIT_CREDENTIAL_SOURCE_KINDS)[number];

export function isAuditCredentialSourceKind(value: unknown): value is AuditCredentialSourceKind {
  return (
    typeof value === 'string' &&
    (AUDIT_CREDENTIAL_SOURCE_KINDS as readonly string[]).includes(value)
  );
}

/** The provenance each mechanism is ENTITLED to assign. Read by the source, never the file. */
export const AUDIT_PROVENANCE_BY_SOURCE_KIND: Readonly<
  Record<AuditCredentialSourceKind, AuditCredentialIdentityProvenance>
> = Object.freeze({
  FILE_FIXTURE: 'SYNTHETIC_TEST_IDENTITY',
  SECRET_MANAGER_VERSION: 'DEPLOYMENT_SECRET_VERSION',
  PROVIDER_KEY_ID_BINDING: 'PROVIDER_KEY_ID',
});

/** The provenances a REAL audit credential may carry. The fixture one is absent. */
export const LIVE_AUDIT_IDENTITY_PROVENANCES: readonly AuditCredentialIdentityProvenance[] =
  Object.freeze(['PROVIDER_KEY_ID', 'DEPLOYMENT_SECRET_VERSION']);

export function isLiveAuditIdentityProvenance(
  value: unknown,
): value is AuditCredentialIdentityProvenance {
  return (
    typeof value === 'string' &&
    (LIVE_AUDIT_IDENTITY_PROVENANCES as readonly string[]).includes(value)
  );
}

/**
 * A SECOND implementation of the derived-label refusal, for the reason the accepted planes
 * each carry their own: these two packages share no module, and a rule this small is cheaper
 * to restate than a coupling between the send side and the audit side is to justify.
 */
export function auditIdentityIsDerivedFromSecret(identity: string, secret: string): boolean {
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
export interface AuditSourcePrincipalReport {
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
 * accepted `AuditReadSecretSource` contract in `src/`: the Azure principal is a property of the
 * S1P validation mechanism, and widening a production interface for a validation-only concern
 * would put it on every adapter source that will ever exist.
 */
export interface AuditSourcePrincipalDescriber {
  describeSourcePrincipal(): AuditSourcePrincipalReport;
}

interface AuditDeploymentDocument {
  readonly providerId?: unknown;
  readonly sourceKind?: unknown;
  readonly apiKey?: unknown;
  readonly credentialIdentity?: unknown;
  readonly version?: unknown;
  readonly revoked?: unknown;
  /*
   * THIS PLANE'S OWN KEY VAULT OPERANDS — its own vault, its own secret, its own managed
   * identity. The integration plane's values never reach this document, because the audit
   * runtime's environment allowlist has no slot for the integration locator and
   * `createAuditReaderRegistry` refuses `READER_LOCATOR_SHARED_WITH_INTEGRATION` when the two
   * locators collide.
   */
  readonly vaultUrl?: unknown;
  readonly secretName?: unknown;
  readonly secretVersion?: unknown;
  readonly managedIdentityClientId?: unknown;
}

class SendGridAuditSecretSource implements AuditReadSecretSource {
  public readonly declaredProviderId: string;

  private readonly locator: string;

  /**
   * THE AZURE SDK BOUNDARY, AS A MODULE-TEST SEAM. `§10`, and it is THIS PLANE'S OWN.
   *
   * Defaults to `createAuditKeyVaultReader` — the audit package's factory, constructing the
   * real `ManagedIdentityCredential` and the real `SecretClient`. It is not the integration
   * package's factory, and it could not be: these two packages share no module.
   */
  private readonly readerFactory: AuditKeyVaultReaderFactory;

  public constructor(
    providerId: string,
    locator: string,
    readerFactory: AuditKeyVaultReaderFactory = createAuditKeyVaultReader,
  ) {
    this.declaredProviderId = providerId;
    this.locator = locator;
    this.readerFactory = readerFactory;
  }

  /**
   * `resolve()` TAKES NO ARGUMENT, and that is the accepted contract rather than a
   * convenience: a source with a selector signature is a source that CAN be asked for
   * another scope's material, and the only thing between the ask and the answer would be a
   * check inside the source.
   */
  /**
   * REPORT THIS PLANE'S OWN AZURE PRINCIPAL. Independently, through its own closed parser.
   *
   * A second implementation rather than a shared one, for the reason every rule in these two
   * packages is stated twice: they share no module, and the audit plane's independence is what
   * `48 §3.6`'s read-only exemption rests on.
   */
  public describeSourcePrincipal(): AuditSourcePrincipalReport {
    let document: AuditDeploymentDocument;
    try {
      document = JSON.parse(readFileSync(this.locator, 'utf8')) as AuditDeploymentDocument;
    } catch {
      return { principalIdentity: null, mechanism: null };
    }
    if (document.providerId !== this.declaredProviderId) {
      return { principalIdentity: null, mechanism: null };
    }
    if (!isAuditCredentialSourceKind(document.sourceKind)) {
      return { principalIdentity: null, mechanism: null };
    }
    if (document.sourceKind !== 'SECRET_MANAGER_VERSION') {
      // A fixture authenticates to no Azure principal. `null`, and the mechanism named.
      return { principalIdentity: null, mechanism: document.sourceKind };
    }
    const parsed = parseAuditKeyVaultLocator(document);
    return parsed.kind === 'LOCATOR'
      ? {
          principalIdentity: parsed.locator.managedIdentityClientId,
          mechanism: 'SECRET_MANAGER_VERSION',
        }
      : { principalIdentity: null, mechanism: 'SECRET_MANAGER_VERSION' };
  }

  public resolve(): Promise<AuditSecretResolution> {
    let document: AuditDeploymentDocument;
    try {
      document = JSON.parse(readFileSync(this.locator, 'utf8')) as AuditDeploymentDocument;
    } catch {
      return Promise.resolve({ kind: 'UNAVAILABLE' });
    }

    if (document.providerId !== this.declaredProviderId) {
      return Promise.resolve({ kind: 'UNAVAILABLE' });
    }
    if (document.revoked === true) return Promise.resolve({ kind: 'CREDENTIAL_REVOKED' });

    if (!isAuditCredentialSourceKind(document.sourceKind)) {
      return Promise.resolve({ kind: 'UNAVAILABLE' });
    }
    /*
     * `§9` — THE SAME MECHANISM, APPLIED INDEPENDENTLY ON THIS PLANE.
     *
     * Azure Key Vault immutable secret VERSION binding, resolved through the audit package's
     * OWN `keyVault.ts` with the audit plane's own managed identity, vault, secret name and
     * version. The integration implementation is not imported and is not reachable from here.
     */
    if (document.sourceKind === 'SECRET_MANAGER_VERSION') {
      return this.resolveFromKeyVault(document);
    }

    // `PROVIDER_KEY_ID_BINDING` remains declared and UNPROVISIONED. See this module's header:
    // no mechanism binds a SendGrid `api_key_id` to material this process holds.
    if (document.sourceKind !== 'FILE_FIXTURE') {
      return Promise.resolve({ kind: 'UNAVAILABLE' });
    }

    const secret = document.apiKey;
    if (typeof secret !== 'string' || secret.length === 0) {
      return Promise.resolve({ kind: 'UNAVAILABLE' });
    }
    const identity = document.credentialIdentity;
    if (typeof identity !== 'string' || identity.length === 0) {
      return Promise.resolve({ kind: 'UNAVAILABLE' });
    }
    if (auditIdentityIsDerivedFromSecret(identity, secret)) {
      return Promise.resolve({ kind: 'UNAVAILABLE' });
    }

    return Promise.resolve({
      kind: 'RESOLVED',
      credential: {
        secret,
        credentialIdentity: identity,
        // ASSIGNED BY THE MECHANISM. A file established this label, so the provenance is the
        // fixture one and a live audit read cannot proceed on it.
        identityProvenance: AUDIT_PROVENANCE_BY_SOURCE_KIND.FILE_FIXTURE,
        version: typeof document.version === 'string' ? document.version : null,
      },
    });
  }

  /**
   * RESOLVE THIS PLANE'S EXACT AZURE KEY VAULT SECRET VERSION.
   *
   * The document's own `credentialIdentity` is NOT read on this path. The identity is
   * `properties.id` from the audit plane's own Key Vault response and nothing else, so an
   * operator who wrote an identity beside the vault operands wrote a value nothing reads.
   */
  private async resolveFromKeyVault(
    document: AuditDeploymentDocument,
  ): Promise<AuditSecretResolution> {
    const parsed = parseAuditKeyVaultLocator(document);
    if (parsed.kind === 'REFUSED') return { kind: 'UNAVAILABLE' };

    const resolution = await resolveAuditExactSecretVersion(
      parsed.locator,
      this.readerFactory(parsed.locator),
    );
    if (resolution.kind === 'REFUSED') return { kind: 'UNAVAILABLE' };

    return {
      kind: 'RESOLVED',
      credential: {
        secret: resolution.secret,
        // THE IDENTITY KEY VAULT RETURNED, for this plane's own secret version.
        credentialIdentity: resolution.credentialIdentity,
        // EARNED BY AN IMMUTABLE SECRET-MANAGER VERSION, independently of the send plane.
        identityProvenance: AUDIT_PROVENANCE_BY_SOURCE_KIND.SECRET_MANAGER_VERSION,
        version: resolution.version,
      },
    };
  }
}

/**
 * THE PRODUCTION FACTORY. Two fields, and no seam through which a network client could arrive.
 */
export function createAuditReadSecretSource(input: {
  readonly providerId: string;
  readonly locator: string;
}): AuditReadSecretSource {
  return new SendGridAuditSecretSource(input.providerId, input.locator);
}

/**
 * TEST-ONLY construction, for this plane's own Key Vault binding test.
 *
 * A SECOND such export rather than a shared one, for the reason every other rule in these two
 * packages is stated twice: they share no module, and the audit plane's independence is what
 * `48 §3.6`'s read-only exemption rests on.
 */
export function createAuditReadSecretSourceForTest(input: {
  readonly providerId: string;
  readonly locator: string;
  readonly readerFactory: AuditKeyVaultReaderFactory;
}): AuditReadSecretSource {
  return new SendGridAuditSecretSource(input.providerId, input.locator, input.readerFactory);
}
