import { readFileSync } from 'node:fs';

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
 *   `SECRET_MANAGER_VERSION`   -> would assign `DEPLOYMENT_SECRET_VERSION`: an IMMUTABLE
 *                                 secret-manager version identity returned BY THE MANAGER
 *                                 ALONGSIDE the material it versions, in one answer, so the
 *                                 identity is of the exact bytes returned.
 *   `PROVIDER_KEY_ID_BINDING`  -> would assign `PROVIDER_KEY_ID`: a provider-issued stable
 *                                 non-secret key id, established by a mechanism that can say
 *                                 the id belongs to the exact material returned.
 *
 * **THE LAST TWO ARE UNPROVISIONED, AND THEY REFUSE.** No platform secret manager is selected
 * anywhere in this repository — `§9` of the S1N mandate forbids selecting one, `31 §12`'s
 * technology table names none — and no mechanism exists that binds a SendGrid `api_key_id` to
 * material this process holds. `§3.2`: "If no concrete secret manager is selected, implement
 * the contract and leave the real live source UNPROVISIONED/PARTIAL. That is preferable to a
 * fake binding."
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

interface DeploymentDocument {
  readonly adapterId?: unknown;
  readonly sourceKind?: unknown;
  readonly apiKey?: unknown;
  readonly credentialIdentity?: unknown;
  readonly version?: unknown;
  readonly revoked?: unknown;
}

class SendGridSecretSource implements AdapterSecretSource {
  public readonly declaredAdapterId: string;

  private readonly locator: string;

  public constructor(adapterId: string, locator: string) {
    this.declaredAdapterId = adapterId;
    this.locator = locator;
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
     * THE TWO BINDING MECHANISMS ARE UNPROVISIONED, AND THE REFUSAL IS HERE RATHER THAN IN A
     * DOCUMENT.
     *
     * A deployment that declares one of them is declaring an intention this repository cannot
     * honour: there is no secret-manager client in this tree and no provider read-back that
     * establishes a key id belongs to held material. Returning the material with a borrowed
     * provenance is precisely the fake binding `§3` rejects, so the source resolves nothing.
     * When a real mechanism is selected and built, it is implemented HERE, behind this
     * branch, and every gate downstream already reads the provenance it assigns.
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
}

export function createAdapterSecretSource(input: {
  readonly adapterId: string;
  readonly locator: string;
}): AdapterSecretSource {
  return new SendGridSecretSource(input.adapterId, input.locator);
}
