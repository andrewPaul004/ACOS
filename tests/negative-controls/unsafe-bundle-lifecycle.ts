import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * TEST-ONLY VULNERABLE CONTROLS 13, 14, 17 AND 18 — the bundle's lifecycle, done wrongly.
 *
 * =================================================================================
 * 13. BACKING-FILE MUTATION AFFECTS AUTHORITY WITHOUT A RELOAD
 *
 * `50 §3f`: "**The runtime does NOT dynamically reread arbitrary backing bytes on each
 * authority operation. The active verified bundle is IMMUTABLE.** [...] **If files change on
 * disk after verification, they have NO AUTHORITY EFFECT until an explicit reload occurs**".
 *
 * The unsafe implementation re-reads the file on every authority read — which sounds MORE
 * careful and is strictly worse: an attacker who can write the file gets their value used
 * with no signature check at all, because the signature was checked once against different
 * bytes and nothing re-checks it.
 *
 * =================================================================================
 * 14. PARTIAL PUBLICATION ON A FAILED RELOAD
 *
 * `50 §3f`: "**Publication of a new verified bundle is ATOMIC**, and **a failed candidate
 * bundle NEVER replaces the current verified bundle.** There is no partial swap and no
 * per-artifact hot reload."
 *
 * The unsafe implementation publishes each class as it verifies it, so a candidate that
 * fails on class 27 has already replaced class 3 — `31` of the mandate's "class 3 from
 * release B with class 27 from release A".
 *
 * =================================================================================
 * 17. THE CONTROL PLANE VOUCHES FOR THE AUDIT PLANE
 *
 * `50 §3` property 2: "**The audit plane recomputes independently.** A manifest check run
 * only by the control plane is a check the control plane can pass by lying (`30 §5.2`)."
 *
 * The unsafe audit plane asks the control plane whether the artifacts verified and believes
 * the answer, so a control plane that lies — or that simply holds different bytes — is never
 * contradicted.
 *
 * =================================================================================
 * 18. A REAL EFFECT WITHOUT A VERIFIED BUNDLE
 *
 * `50 §3f`: "**external claim and dispatch cannot proceed if the verified bundle is
 * unavailable or invalid.**"
 *
 * The unsafe dispatcher takes the bundle as an OPTIONAL argument and proceeds when it is
 * absent, which is exactly the shape a future real-adapter composition would introduce by
 * accident.
 * =================================================================================
 */

// ---------------------------------------------------------------------------------
// 13 — re-read the backing file on every authority read.
// ---------------------------------------------------------------------------------

/**
 * A "helpfully fresh" catalogue reader. It never rehashes and never re-verifies; it simply
 * trusts whatever is on disk now because the package verified once at startup.
 */
export function unsafeRereadIrrecoverableUnits(root: string, actionClass: string): bigint {
  const bytes = readFileSync(join(root, 'class-03.action-catalogue.json'), 'utf8');
  const parsed = JSON.parse(bytes) as {
    action_classes: readonly { action_class: string; irrecoverable_units: string }[];
  };
  const entry = parsed.action_classes.find((row) => row.action_class === actionClass);
  return BigInt(entry!.irrecoverable_units);
}

/** The same defect for class 27's approval floor. */
export function unsafeRereadApprovalFloorMinorUnits(root: string): bigint {
  const parsed = JSON.parse(
    readFileSync(join(root, 'class-27.degraded-mode-config.json'), 'utf8'),
  ) as { degraded_per_action_approval_floor_monetary: string };
  const [units, cents] = parsed.degraded_per_action_approval_floor_monetary.split('.');
  return BigInt(units!) * 100n + BigInt(cents!);
}

// ---------------------------------------------------------------------------------
// 14 — publish per class, as each one verifies.
// ---------------------------------------------------------------------------------

export interface UnsafePublishedBundle {
  [artifactClass: number]: string;
}

/**
 * A per-class hot reload. Each artifact whose digest matches is published IMMEDIATELY; the
 * first mismatch throws, leaving the earlier classes already swapped.
 */
export function unsafePartialPublish(
  published: UnsafePublishedBundle,
  root: string,
  entries: readonly { readonly artifactClass: number; readonly fileName: string; readonly contentHash: string }[],
): void {
  for (const entry of entries) {
    const bytes = readFileSync(join(root, entry.fileName));
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (digest !== entry.contentHash) {
      throw new Error(`class ${String(entry.artifactClass)} failed; earlier classes are already live`);
    }
    // THE DEFECT: the swap happens inside the loop.
    published[entry.artifactClass] = digest;
  }
}

// ---------------------------------------------------------------------------------
// 17 — the audit plane asks the control plane.
// ---------------------------------------------------------------------------------

export interface ControlPlaneVouch {
  readonly verified: boolean;
  readonly manifestId: string;
  readonly artifactDigests: Readonly<Record<number, string>>;
}

/**
 * An audit plane that holds its own bytes and never hashes them, because the control plane
 * already said the package was fine.
 */
export function unsafeAuditAcceptsControlPlaneVouch(
  vouch: ControlPlaneVouch,
): { readonly verified: boolean; readonly manifestId: string } {
  return { verified: vouch.verified, manifestId: vouch.manifestId };
}

// ---------------------------------------------------------------------------------
// 18 — dispatch with an optional bundle.
// ---------------------------------------------------------------------------------

export interface UnsafeDispatchEnvironment {
  /** OPTIONAL — which is the whole defect. */
  readonly verifiedBundle?: unknown;
}

/** A dispatcher that proceeds when no verified bundle is available. */
export function unsafeMayDispatch(env: UnsafeDispatchEnvironment): boolean {
  return env.verifiedBundle === undefined ? true : true;
}
