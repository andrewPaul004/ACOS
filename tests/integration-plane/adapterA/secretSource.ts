import { readFileSync } from 'node:fs';

import type {
  AdapterSecretSource,
  SecretResolution,
} from '../../../src/integration/runtime/adapterSecretSource.js';

/**
 * ADAPTER A's SECRET SOURCE — TEST-ONLY FIXTURE. `§9`.
 *
 * =================================================================================
 * WHAT THIS STANDS IN FOR, AND WHAT IT DELIBERATELY IS NOT
 *
 * `§9`: "Architecture says per-adapter secret in a cloud secret manager. If no concrete
 * cloud secret manager is currently chosen: implement a narrow interface [...] with a
 * production contract; TEST-ONLY in-memory/file fixture implementation; no actual
 * AWS/Azure/GCP/Vault dependency. **Do NOT select a cloud vendor in S1N.**"
 *
 * This is the file fixture. It reads ONE JSON document from the locator its runtime was
 * launched with and answers from it. There is no SDK, no network, no IAM and no vendor.
 *
 * `§9` also forbids the shortcut it would have been easiest to take: "Do NOT fall back to
 * `process.env.GENERIC_VENDOR_SECRET` inside the control process." The material is not in
 * the control process's environment, not in this runtime's environment either, and not on
 * any wire — it is on a filesystem path only this runtime was told about. The ENV carries a
 * LOCATOR; the locator names a file; the file holds the material.
 * =================================================================================
 *
 * =================================================================================
 * `§24` — THE REVOCATION SWITCH, AT THE DEPLOYMENT BOUNDARY
 *
 * ADR-024: "a per-credential revocation switch that **REVOKES** rather than stopping the
 * loop." The switch is the `revoked` member of the fixture document — a state of the
 * SOURCE, outside every ACOS process — and a revoked source returns `CREDENTIAL_REVOKED` with NO
 * MATERIAL. There is nothing in hand for a missed check to leak.
 *
 * It is re-read on EVERY `resolve()`, which is what makes it operable without restarting
 * anything (`§24`: "A later owner/deployment operation may change it") and what makes
 * `§25`'s rotation work: replacing the material in the file replaces the credential the
 * next invocation presents, with no control-plane involvement and no control-plane
 * knowledge beyond the non-secret `version` label.
 * =================================================================================
 */

interface FixtureDocument {
  readonly adapterId?: unknown;
  readonly secret?: unknown;
  readonly identity?: unknown;
  readonly version?: unknown;
  readonly revoked?: unknown;
}

class FileBackedSecretSource implements AdapterSecretSource {
  public readonly declaredAdapterId: string;

  private readonly locator: string;

  public constructor(adapterId: string, locator: string) {
    this.declaredAdapterId = adapterId;
    this.locator = locator;
  }

  public resolve(): Promise<SecretResolution> {
    let document: FixtureDocument;
    try {
      document = JSON.parse(readFileSync(this.locator, 'utf8')) as FixtureDocument;
    } catch {
      return Promise.resolve({ kind: 'UNAVAILABLE' });
    }

    /*
     * `§7`, `23 §7` — THE SOURCE SERVES ONE ADAPTER AND REFUSES THE REST.
     *
     * A fixture document whose `adapterId` is not this source's own is UNAVAILABLE, not a
     * credential for another adapter. Two independent mechanisms already stop adapter A's
     * runtime from reaching adapter B's file — the locator is per runtime and the
     * environment is an allowlist — and this is the third, inside the one component that
     * would otherwise be a willing accomplice.
     *
     * `unsafeSharedSecretSource` in the negative-control suite is the discriminating
     * control: a source with a `resolve(adapterId)` selector, which answers for whichever
     * adapter it is asked about.
     */
    if (document.adapterId !== this.declaredAdapterId) {
      return Promise.resolve({ kind: 'UNAVAILABLE' });
    }
    if (document.revoked === true) return Promise.resolve({ kind: 'CREDENTIAL_REVOKED' });
    if (typeof document.secret !== 'string' || document.secret.length === 0) {
      return Promise.resolve({ kind: 'UNAVAILABLE' });
    }

    return Promise.resolve({
      kind: 'RESOLVED',
      credential: {
        secret: document.secret,
        identity: typeof document.identity === 'string' ? document.identity : null,
        version: typeof document.version === 'string' ? document.version : null,
      },
    });
  }
}

export function createAdapterSecretSource(input: {
  readonly adapterId: string;
  readonly locator: string;
}): AdapterSecretSource {
  return new FileBackedSecretSource(input.adapterId, input.locator);
}
