import { readFileSync } from 'node:fs';

import type {
  AdapterSecretSource,
  SecretResolution,
} from '../../../src/integration/runtime/adapterSecretSource.js';

/**
 * ADAPTER B's SECRET SOURCE — TEST-ONLY FIXTURE. `§9`.
 *
 * =================================================================================
 * WHY THIS IS A SEPARATE FILE RATHER THAN A SHARED ONE PARAMETERISED BY ADAPTER
 *
 * It would be shorter to write one fixture source and construct it twice. `§11` is exactly
 * the reason not to: "For adapter A: only A's integration package/dependencies should be
 * available through its declared runtime composition. Adapter B must not be able to import
 * A's provider-specific module. [...] **Do not solve by convention only.**"
 *
 * A shared module is a module in BOTH runtimes' import closures, and
 * `tools/integration-packaging/` would report it as one — correctly, because in a real
 * deployment a shared secret-loading module is a shared blast radius: one supply-chain
 * compromise of it reaches both credential scopes, which is precisely what `29 §3.5`'s
 * per-adapter dependency isolation exists to prevent and what `43 §6` needs for settlement
 * independence.
 *
 * So the two roots share NOTHING except the `src/integration/runtime/` TYPE declarations,
 * which carry no behaviour, and the packaging manifest asserts that as the only overlap.
 * =================================================================================
 */

interface FixtureDocument {
  readonly adapterId?: unknown;
  readonly secret?: unknown;
  readonly identity?: unknown;
  readonly version?: unknown;
  readonly revoked?: unknown;
}

class AdapterBSecretSource implements AdapterSecretSource {
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
    // Scoped to ONE adapter, and it refuses a document belonging to any other — the third
    // of the three mechanisms `adapterA/secretSource.ts` enumerates, here on B's side.
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
  return new AdapterBSecretSource(input.adapterId, input.locator);
}
