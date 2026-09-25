import { INTEGRATION_PROTOCOL_VERSION } from './wire.js';
import { integrationAdapterRuntimeIdentity } from './runtimeIdentity.js';

/**
 * `§12`, `§30` — THE CHILD ENVIRONMENT, AS A CLOSED ALLOWLIST AND NOT A FILTER.
 *
 * =================================================================================
 * WHY AN ALLOWLIST AND NOT A DENYLIST, STATED ONCE
 *
 * `§30`: "When launching integration runtime, use an explicit allowlist. Test child-visible
 * environment exactly. **Do not merely blacklist likely secret names.**"
 *
 * `23 §7`'s zone rule is what this implements: "one adapter cannot read another's secret
 * from its own environment or filesystem". A denylist of likely secret names is a list of
 * the secrets somebody thought of, and the control plane's environment in any real
 * deployment holds the control database password, the audit-instance grant, the owner
 * signing material's locators and whatever else the platform injected. Every one of those
 * reaches a child that inherits, and the ONE that matters is the one nobody named.
 *
 * SO THE CHILD'S ENVIRONMENT IS CONSTRUCTED, NOT FILTERED. `buildIntegrationRuntimeEnvironment`
 * returns a fresh object whose keys are exactly `INTEGRATION_RUNTIME_ENV_KEYS`, and
 * `integrationClient.ts` passes it as `env` to `fork`, which REPLACES the environment rather
 * than extending it. There is no code path in this repository that copies a key out of
 * `process.env` into a child.
 * =================================================================================
 *
 * =================================================================================
 * WHAT THE PLATFORM ADDS ANYWAY, NAMED RATHER THAN IGNORED
 *
 * On Windows, libuv adds a small fixed set of OS variables to every spawned process
 * regardless of the `env` option, because a Win32 process without them cannot resolve its
 * own user profile or temporary directory. They are listed in
 * `PLATFORM_INJECTED_ENV_KEYS` so the boundary test can assert the child's observed
 * environment against `allowlist ∪ platform` EXACTLY rather than against a lower bound —
 * `§30`'s "test child-visible environment exactly" is only a real assertion if the expected
 * set is closed on both sides.
 *
 * None of them is a secret and none is ACOS-specific. The test that matters is the negative
 * one, and it is not about this list: a parent holding `ADAPTER_B_SECRET`, a control
 * database password and an audit database password must produce a child holding none of
 * them, and that is asserted by name.
 * =================================================================================
 */

/** The protocol version, restated into the child so a mismatched pair cannot start. */
export const ENV_PROTOCOL_VERSION = 'ACOS_INTEGRATION_PROTOCOL_VERSION';
/** `§6`'s closed runtime identity — `INTEGRATION_ADAPTER:<adapter_id>`. */
export const ENV_RUNTIME_IDENTITY = 'ACOS_INTEGRATION_RUNTIME_IDENTITY';
/** The ONE adapter identity this runtime serves. `26 §5`'s catalogue value. */
export const ENV_ADAPTER_ID = 'ACOS_INTEGRATION_ADAPTER_ID';
/**
 * `§11` — THE DEPENDENCY-TREE CONFINEMENT ROOT.
 *
 * `29 §3.5`: "**Per-adapter** runtime, filesystem and dependency isolation — not merely
 * per-plane (v1.1)". The runtime refuses to load an adapter module or a secret-source module
 * that does not resolve INSIDE this directory, so adapter B's runtime cannot load adapter
 * A's provider-specific module even when handed its specifier. The static counterpart —
 * that A's import closure and B's are disjoint — is the packaging manifest in
 * `tools/integration-packaging/`.
 */
export const ENV_RUNTIME_ROOT = 'ACOS_INTEGRATION_RUNTIME_ROOT';
/** The adapter module specifier. TRUSTED LAUNCH CONFIGURATION, never message content. */
export const ENV_ADAPTER_MODULE = 'ACOS_INTEGRATION_ADAPTER_MODULE';
/** The secret-source module specifier. Same provenance, same confinement. */
export const ENV_SECRET_SOURCE_MODULE = 'ACOS_INTEGRATION_SECRET_SOURCE_MODULE';
/**
 * `§30`'s "adapter-A secret-source locator if needed".
 *
 * A LOCATOR, NOT A SECRET. It names where this runtime's own secret source should look —
 * a secret-manager resource name in a real deployment, a fixture path in S1N — and the
 * control plane holds the locator, never the material it locates. `48 §6` is the
 * corresponding row: "Secret-manager IAM | Deployment only | Not held by any adapter".
 *
 * ONE LOCATOR PER RUNTIME. Adapter A's environment carries A's and nothing else, which is
 * `§30`'s required negative: "adapter A [...] does NOT see: adapter-B locator".
 */
export const ENV_SECRET_LOCATOR = 'ACOS_INTEGRATION_SECRET_LOCATOR';

/** THE CLOSED ALLOWLIST. Seven keys. A child sees these and, from ACOS, nothing else. */
export const INTEGRATION_RUNTIME_ENV_KEYS = [
  ENV_PROTOCOL_VERSION,
  ENV_RUNTIME_IDENTITY,
  ENV_ADAPTER_ID,
  ENV_RUNTIME_ROOT,
  ENV_ADAPTER_MODULE,
  ENV_SECRET_SOURCE_MODULE,
  ENV_SECRET_LOCATOR,
] as const;

export type IntegrationRuntimeEnvKey = (typeof INTEGRATION_RUNTIME_ENV_KEYS)[number];

/**
 * The OS variables the platform adds to any child regardless of the `env` option.
 *
 * Declared so the boundary assertion can be an EQUALITY rather than a containment. Empty on
 * POSIX, where `env` genuinely replaces the environment.
 */
export const PLATFORM_INJECTED_ENV_KEYS: readonly string[] =
  process.platform === 'win32'
    ? [
        'HOMEDRIVE',
        'HOMEPATH',
        'LOGONSERVER',
        'PATH',
        'SYSTEMDRIVE',
        'SYSTEMROOT',
        'TEMP',
        'TMP',
        'USERDOMAIN',
        'USERNAME',
        'USERPROFILE',
        'WINDIR',
      ]
    : [];

/** Everything a runtime needs to exist, and nothing a request could influence. */
export interface IntegrationRuntimeLaunchConfiguration {
  readonly adapterId: string;
  readonly runtimeRoot: string;
  readonly adapterModule: string;
  readonly secretSourceModule: string;
  readonly secretLocator: string;
}

/**
 * Build the child's complete environment. THE ONLY PRODUCER, AND IT READS NOTHING.
 *
 * Note what this function does not take and does not touch: it has no access to
 * `process.env`, no parameter that could carry one, and no branch that adds a key. A future
 * change that wanted to pass one more variable has to add it to
 * `INTEGRATION_RUNTIME_ENV_KEYS` first, which is the list the boundary test asserts against
 * by hand.
 */
export function buildIntegrationRuntimeEnvironment(
  configuration: IntegrationRuntimeLaunchConfiguration,
): Readonly<Record<IntegrationRuntimeEnvKey, string>> {
  return Object.freeze({
    [ENV_PROTOCOL_VERSION]: INTEGRATION_PROTOCOL_VERSION,
    [ENV_RUNTIME_IDENTITY]: integrationAdapterRuntimeIdentity(configuration.adapterId),
    [ENV_ADAPTER_ID]: configuration.adapterId,
    [ENV_RUNTIME_ROOT]: configuration.runtimeRoot,
    [ENV_ADAPTER_MODULE]: configuration.adapterModule,
    [ENV_SECRET_SOURCE_MODULE]: configuration.secretSourceModule,
    [ENV_SECRET_LOCATOR]: configuration.secretLocator,
  });
}
