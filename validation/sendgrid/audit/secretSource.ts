import { readFileSync } from 'node:fs';

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

interface AuditDeploymentDocument {
  readonly providerId?: unknown;
  readonly sourceKind?: unknown;
  readonly apiKey?: unknown;
  readonly credentialIdentity?: unknown;
  readonly version?: unknown;
  readonly revoked?: unknown;
}

class SendGridAuditSecretSource implements AuditReadSecretSource {
  public readonly declaredProviderId: string;

  private readonly locator: string;

  public constructor(providerId: string, locator: string) {
    this.declaredProviderId = providerId;
    this.locator = locator;
  }

  /**
   * `resolve()` TAKES NO ARGUMENT, and that is the accepted contract rather than a
   * convenience: a source with a selector signature is a source that CAN be asked for
   * another scope's material, and the only thing between the ask and the answer would be a
   * check inside the source.
   */
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
    // The two binding mechanisms are declared and UNPROVISIONED. See this module's header.
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
}

export function createAuditReadSecretSource(input: {
  readonly providerId: string;
  readonly locator: string;
}): AuditReadSecretSource {
  return new SendGridAuditSecretSource(input.providerId, input.locator);
}
