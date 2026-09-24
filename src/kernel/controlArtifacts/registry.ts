import { filesystemArtifactPackage, type ControlArtifactByteSource } from './artifactPackage.js';
import { bundleManifestId, type VerifiedControlArtifactBundle } from './bundle.js';
import { ControlArtifactIntegrityFailure, integrityFailure } from './errors.js';
import { isControlArtifactIntegrityFailure, raiseControlArtifactIncident } from './incidents.js';
import {
  readDeploymentTrustConfiguration,
  type DeploymentTrustConfiguration,
  type TrustConfigKeyNames,
  type TrustConfigurationSource,
} from './trustConfig.js';
import { verifyControlArtifactBundle } from './verifier.js';

/**
 * THE ACTIVE VERIFIED BUNDLE, AND THE TWO OCCASIONS THAT SET IT — `50 §3f`.
 *
 * =================================================================================
 * OCCASION 1 — BOOTSTRAP, and the READY gate
 *
 * `50 §3f`: "**Before the kernel becomes READY** [...] **On any failure the kernel FAILS
 * CLOSED BEFORE ANY AUTHORITY EXECUTION.** It does not become READY, it does not serve a
 * degraded subset, and it does not admit a single effect."
 *
 * `kernelAuthorityReady()` is that gate, and it is a QUESTION ABOUT THE HOLDER BELOW rather
 * than a flag someone sets: there is no `setReady`, no `markReady` and no boolean anywhere
 * in this module. The kernel is READY exactly when a bundle this process verified is
 * published, and it stops being READY only if a process never published one.
 *
 * =================================================================================
 * OCCASION 2 — PUBLICATION / RELOAD, and why publication is one assignment
 *
 * `50 §3f`: "**Any artifact or manifest reload is verified COMPLETELY BEFORE BECOMING
 * ACTIVE.** The full ceremony of occasion 1 runs against the candidate bundle. **Publication
 * of a new verified bundle is ATOMIC**, and **a failed candidate bundle NEVER replaces the
 * current verified bundle.** There is no partial swap and no per-artifact hot reload."
 *
 * The whole of publication is the single assignment `active = candidate`. JavaScript has no
 * interleaving point inside one assignment, so a reader either sees the complete old bundle
 * or the complete new one and there is no window in which it could see class 3 from one
 * release and class 27 from another. That is also why `verifyControlArtifactBundle` returns
 * a bundle rather than publishing one: a verifier that published as it went would have to
 * be trusted not to publish early, and this way it cannot publish at all.
 *
 * `reloadControlArtifactAuthority` is `async` and takes an optional hook between
 * verification and publication SPECIFICALLY so a concurrency test can hold the candidate at
 * that point and prove readers still see the old bundle — `35 §12`'s instrumentation
 * pattern, and the same one `effectGateway.ts`'s `DispatchHooks` uses. Production passes no
 * hook.
 *
 * =================================================================================
 * OCCASION 3 — VERIFIED-CAPABILITY USE, and what is NOT here
 *
 * `50 §3f`: "**Re-verifying signatures inside every request is NOT required**, because the
 * immutable capability already proves bootstrap or publication verification".
 *
 * And the negative, verbatim: "**`I19` IS EVENT- AND USE-GATED. IT IS NOT PERIODIC-TIMER
 * SECURITY.** No polling cadence is introduced — not 30 seconds, not 60 seconds, not 5
 * minutes, not any interval."
 *
 * SO THERE IS NO TIMER IN THIS FILE. No `setInterval`, no `setTimeout`, no scheduler, no
 * watcher, no `fs.watch`, no re-hash on read. `tests/controlArtifacts/i19-no-timer.test.ts`
 * asserts that over the whole of `src/kernel/controlArtifacts/`, because "continuous" here
 * means continuity of the capability rather than frequency of a check.
 *
 * `50 §3f`, "Backing-store changes": "**If files change on disk after verification, they
 * have NO AUTHORITY EFFECT until an explicit reload occurs.**" Nothing in this module reads
 * the filesystem except the two entry points below, and both of them run the full ceremony.
 * =================================================================================
 */

let active: VerifiedControlArtifactBundle | null = null;

export interface ControlArtifactBootstrapOptions {
  /** Where the deployment trust configuration is read from. Defaults to `process.env`. */
  readonly configurationSource?: TrustConfigurationSource;
  /** Which variable names to read. Defaults to the control plane's. */
  readonly configurationKeys?: TrustConfigKeyNames;
  /**
   * An already-read configuration, for callers that hold one.
   *
   * It is a `DeploymentTrustConfiguration`, which only `readDeploymentTrustConfiguration`
   * can produce, so this is not a route by which loose key bytes reach the verifier.
   */
  readonly configuration?: DeploymentTrustConfiguration;
  /** The byte source. Defaults to the filesystem package the configuration names. */
  readonly source?: ControlArtifactByteSource;
}

function resolveConfiguration(
  options: ControlArtifactBootstrapOptions,
): DeploymentTrustConfiguration {
  if (options.configuration !== undefined) return options.configuration;
  return readDeploymentTrustConfiguration(options.configurationSource, options.configurationKeys);
}

function resolveSource(
  options: ControlArtifactBootstrapOptions,
  configuration: DeploymentTrustConfiguration,
): ControlArtifactByteSource {
  return options.source ?? filesystemArtifactPackage(configuration.artifactPackageRoot);
}

/**
 * `50 §3f` OCCASION 1. Verify, then publish, then the kernel may become READY.
 *
 * THROWS on any failure, having raised the declared CRITICAL incident with occasion
 * `BOOTSTRAP` — which is the occasion on which `§3f` accepts local startup evidence as the
 * only signal, because no verified `ACOS-JCS-1` identity exists yet to journal under.
 *
 * It does not catch its own failure and continue, and it publishes nothing on the failing
 * path: `active` is assigned exactly once, on the last line, from a value verification
 * returned.
 */
export function bootstrapControlArtifactAuthority(
  options: ControlArtifactBootstrapOptions = {},
): VerifiedControlArtifactBundle {
  let verified: VerifiedControlArtifactBundle;
  try {
    const configuration = resolveConfiguration(options);
    verified = verifyControlArtifactBundle(configuration, resolveSource(options, configuration));
  } catch (error) {
    if (isControlArtifactIntegrityFailure(error)) {
      raiseControlArtifactIncident('BOOTSTRAP', error);
    }
    throw error;
  }
  active = verified;
  return verified;
}

export interface ControlArtifactReloadHooks {
  /**
   * Called after the candidate verified and BEFORE it is published.
   *
   * Instrumentation only. `35 §12`'s pattern: it cannot change the verdict, cannot publish,
   * and cannot see the candidate's contents — it is handed nothing.
   */
  readonly afterVerificationBeforePublication?: () => Promise<void>;
}

/**
 * `50 §3f` OCCASION 2. The full ceremony against a candidate, then an atomic publication.
 *
 * `50 §3f`: "**a failed candidate bundle NEVER replaces the current verified bundle.**"
 * On the failing path this function throws and `active` is not touched by any statement —
 * there is no assignment before the `await`, no `active = null`, and no clearing in a
 * `finally`. The previously verified bundle therefore remains active and every authority
 * consumer keeps using it, which is what `§3f` means by "no silent fall back to an older
 * artifact": the OLD one is still the one that was verified, and no OTHER older artifact is
 * reached for.
 */
export async function reloadControlArtifactAuthority(
  options: ControlArtifactBootstrapOptions = {},
  hooks: ControlArtifactReloadHooks = {},
): Promise<VerifiedControlArtifactBundle> {
  let candidate: VerifiedControlArtifactBundle;
  try {
    const configuration = resolveConfiguration(options);
    candidate = verifyControlArtifactBundle(configuration, resolveSource(options, configuration));
  } catch (error) {
    if (isControlArtifactIntegrityFailure(error)) {
      raiseControlArtifactIncident('RELOAD', error);
    }
    throw error;
  }

  if (hooks.afterVerificationBeforePublication !== undefined) {
    await hooks.afterVerificationBeforePublication();
  }

  // PUBLICATION. One assignment, no interleaving point inside it, no partial swap.
  active = candidate;
  return candidate;
}

/**
 * `50 §3f` OCCASION 3. The ONLY way production authority code obtains the capability.
 *
 * Throws `NO_ACTIVE_VERIFIED_BUNDLE` when nothing has been published. That is the fail-closed
 * behaviour rather than a `null` a caller might branch on and continue past: `§3f` requires
 * that the kernel "does not serve a degraded subset, and it does not admit a single effect",
 * and a nullable return is how a degraded subset gets served by accident.
 */
export function activeVerifiedControlArtifacts(): VerifiedControlArtifactBundle {
  if (active === null) {
    integrityFailure(
      'NO_ACTIVE_VERIFIED_BUNDLE',
      'no verified control-artifact bundle is active; the kernel has not completed 50 §3f ' +
        'occasion 1 and no authority value is available',
    );
  }
  return active;
}

/**
 * `50 §3f`'s READY gate, as a question rather than a flag.
 *
 * The kernel's authority mechanisms are READY exactly when a bundle verified by THIS process
 * is published. There is no other input, so there is no way to become READY without having
 * run the ceremony.
 */
export function kernelAuthorityReady(): boolean {
  return active !== null;
}

/** The active manifest identity, for evidence. Throws when nothing is active. */
export function activeManifestId(): string {
  return bundleManifestId(activeVerifiedControlArtifacts());
}

/** Re-exported so consumers need not import the error module to narrow a failure. */
export { ControlArtifactIntegrityFailure };
