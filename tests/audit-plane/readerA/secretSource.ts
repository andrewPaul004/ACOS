import { readFileSync } from 'node:fs';

import type {
  AuditReadSecretSource,
  AuditSecretResolution,
} from '../../../src/audit/provider/runtime/auditSecretSource.js';

/**
 * READER A's AUDIT READ SECRET SOURCE — TEST-ONLY FIXTURE. `§13`, `§17`.
 *
 * =================================================================================
 * WHAT THIS STANDS IN FOR, AND WHAT IT DELIBERATELY IS NOT
 *
 * The audit-plane counterpart of `tests/integration-plane/adapterA/secretSource.ts`, and
 * the `§9` restraint carries over unchanged: **no cloud secret manager is selected.** There
 * is no SDK, no network, no IAM and no vendor. This is a file fixture that reads ONE JSON
 * document from the locator its runtime was launched with.
 *
 * `§13`'s third prohibition is the one this file is the subject of: "Do not put audit
 * credentials into: [...] **same secret source as send credential**."
 *
 * TWO MECHANISMS MAKE THAT TRUE, AND NEITHER IS A NAMING CONVENTION.
 *
 *   1. THE TYPE. This module exports `createAuditReadSecretSource`, which returns an
 *      `AuditReadSecretSource` keyed by PROVIDER. `main.ts` refuses a module that does not
 *      export exactly that factory, so an integration secret source — which exports
 *      `createAdapterSecretSource` and returns a source keyed by ADAPTER — cannot be loaded
 *      by an audit reader even when handed its specifier.
 *   2. THE LOCATOR. `createAuditReaderRegistry` refuses a descriptor whose `secretLocator`
 *      is one the integration plane holds. A locator names a source, so two runtimes sharing
 *      a locator are two runtimes sharing a source whatever their module specifiers say.
 *
 * =================================================================================
 * THE DOCUMENT IS KEYED BY PROVIDER, AND A MISMATCH IS `UNAVAILABLE`
 *
 * A fixture document whose `providerId` is not this source's own yields no credential. Three
 * independent mechanisms already stop reader A from reaching another scope's file — the
 * locator is per runtime, the environment is a constructed allowlist, and the registry
 * refuses a shared locator — and this is the fourth, inside the one component that would
 * otherwise be a willing accomplice.
 *
 * `unsafeSharedAuditSecretSource` in the negative-control suite is the discriminating
 * control: a source with a `resolve(scopeId)` selector, through which the audit reader
 * reaches the integration plane's SEND credential.
 * =================================================================================
 */

interface AuditFixtureDocument {
  readonly providerId?: unknown;
  readonly secret?: unknown;
  readonly credentialIdentity?: unknown;
  readonly identityProvenance?: unknown;
  readonly version?: unknown;
  readonly revoked?: unknown;
}

class FileBackedAuditSecretSource implements AuditReadSecretSource {
  public readonly declaredProviderId: string;

  private readonly locator: string;

  public constructor(providerId: string, locator: string) {
    this.declaredProviderId = providerId;
    this.locator = locator;
  }

  public resolve(): Promise<AuditSecretResolution> {
    let document: AuditFixtureDocument;
    try {
      document = JSON.parse(readFileSync(this.locator, 'utf8')) as AuditFixtureDocument;
    } catch {
      return Promise.resolve({ kind: 'UNAVAILABLE' });
    }

    if (document.providerId !== this.declaredProviderId) {
      return Promise.resolve({ kind: 'UNAVAILABLE' });
    }
    // The revocation switch is a state of the SOURCE, outside every ACOS process, and a
    // revoked source returns NO MATERIAL. There is nothing in hand for a missed check to
    // leak, and revoking the audit read credential is operable without restarting the audit
    // plane or touching the integration plane at all.
    if (document.revoked === true) return Promise.resolve({ kind: 'CREDENTIAL_REVOKED' });
    if (typeof document.secret !== 'string' || document.secret.length === 0) {
      return Promise.resolve({ kind: 'UNAVAILABLE' });
    }

    if (typeof document.credentialIdentity !== 'string' || document.credentialIdentity.length === 0) {
      /*
       * `50 §2g` FIELD 1 — A SOURCE THAT CANNOT NAME WHAT IT RESOLVED HAS NOT RESOLVED ONE.
       *
       * The fixture refuses rather than returning `null`, because `null` is what the
       * pre-correction contract allowed and is exactly the shape that let a risk declaration
       * govern an unidentified credential. `§10` of the correction: "Null identity is not
       * sufficient for a configured real credential."
       */
      return Promise.resolve({ kind: 'UNAVAILABLE' });
    }

    return Promise.resolve({
      kind: 'RESOLVED',
      credential: {
        secret: document.secret,
        credentialIdentity: document.credentialIdentity,
        /*
         * A FIXTURE'S PROVENANCE IS `SYNTHETIC_TEST_IDENTITY`, AND IT SAYS SO.
         *
         * `§14` of the correction: a production source must explain what establishes the
         * identity it returns — a provider key ID or an immutable secret-manager identity.
         * This one establishes nothing except that a test wrote it into a JSON file, and
         * declaring that is the difference between a fixture and a claimed binding.
         */
        identityProvenance: 'SYNTHETIC_TEST_IDENTITY',
        version: typeof document.version === 'string' ? document.version : null,
      },
    });
  }
}

export function createAuditReadSecretSource(input: {
  readonly providerId: string;
  readonly locator: string;
}): AuditReadSecretSource {
  return new FileBackedAuditSecretSource(input.providerId, input.locator);
}
