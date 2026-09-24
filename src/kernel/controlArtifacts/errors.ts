/**
 * Control-artifact integrity failures: a STRUCTURED reason code for the security log and
 * ONE COARSE SENTENCE for anything a worker or a model can see.
 *
 * =================================================================================
 * THE COARSENING RULE IS THE PACKAGE'S OWN, APPLIED TO A NEW SURFACE
 *
 * `26 §2.2`'s probing rule and the accepted worker-facing denial modules
 * (`workerFacingAuthorityDenial.ts`, `workerFacingPolicyDenial.ts`,
 * `workerFacingLocalDenial.ts`) already establish the shape: a denial names a CATEGORY and
 * never a near miss. A control-artifact failure is the same problem with a sharper edge,
 * because the near miss here is cryptographic material.
 *
 * WHAT A WORKER-FACING MESSAGE MAY NEVER CARRY, and each one is an oracle if it does:
 *
 *   expected/actual signature bytes   a signing oracle, one bit at a time
 *   root public keys                  the deployment trust configuration, exfiltrated
 *   manifest differences              which entry to forge, and to what value
 *   artifact internals                the authority values the gate exists to protect
 *   Cedar source                      the policy set, readable by the subject of it
 *   canonicalisation internals        the framing, which is the thing being attacked
 *
 * `ControlArtifactIntegrityFailure` therefore carries a `reasonCode` for the SECURITY LOG
 * and a `detail` for the SECURITY LOG, and `coarseControlArtifactDenial()` is the only
 * function that produces a string for anything outside the kernel. Tests inspect
 * `reasonCode` because tests are inside the trust boundary; no worker-facing surface may.
 * =================================================================================
 */

/**
 * The closed reason-code set for a control-artifact integrity failure.
 *
 * Closed, and ordered by `50 §3f`'s bootstrap step sequence, so a reader can see which step
 * of the eight-step ceremony rejected without reading the verifier.
 */
export const CONTROL_ARTIFACT_REASON_CODES = [
  // Step 1 — the deployment trust configuration itself.
  'TRUST_CONFIG_MISSING',
  'TRUST_CONFIG_MALFORMED',
  // Step 2 — `50 §3a`'s distinctness rule.
  'TRUST_ROOTS_NOT_DISTINCT',
  // The manifest document, before any of the eight steps can run on it.
  'MANIFEST_UNREADABLE',
  'MANIFEST_MALFORMED',
  'MANIFEST_UNKNOWN_FIELD',
  'MANIFEST_ENTRY_COUNT_MISMATCH',
  'MANIFEST_ENTRY_ORDER_INVALID',
  'MANIFEST_DUPLICATE_ENTRY',
  // Step 3 — `50 §3e`'s deployment pin.
  'MANIFEST_IDENTITY_NOT_PINNED',
  // Step 4 — `50 §3d`'s dual manifest signatures.
  'MANIFEST_PRIMARY_SIGNATURE_INVALID',
  'MANIFEST_SECOND_FACTOR_SIGNATURE_INVALID',
  // Step 5 — the core's declared key ids against the provisioned keys.
  'MANIFEST_KEY_ID_MISMATCH',
  // Step 6 — set completeness and membership.
  'REQUIRED_ARTIFACT_MISSING',
  'UNEXPECTED_ARTIFACT_CLASS',
  'RETIRED_CLASS_PRESENT',
  'ARTIFACT_IDENTITY_UNEXPECTED',
  // Step 7 — exact-byte content integrity.
  'ARTIFACT_BYTES_UNREADABLE',
  'ARTIFACT_CONTENT_HASH_MISMATCH',
  // Step 8 — the dual artifact signatures.
  'ARTIFACT_PRIMARY_SIGNATURE_INVALID',
  'ARTIFACT_SECOND_FACTOR_SIGNATURE_INVALID',
  // After verification: the verified bytes must still parse to the closed schema.
  'ARTIFACT_CONTENT_INVALID',
  // `50 §3f` occasion 3 — the capability boundary.
  'NO_ACTIVE_VERIFIED_BUNDLE',
] as const;

export type ControlArtifactReasonCode = (typeof CONTROL_ARTIFACT_REASON_CODES)[number];

/**
 * THE ONE COARSE SENTENCE. Fixed, and identical for every reason code.
 *
 * It is a single constant rather than a per-category message because a per-category message
 * is a one-bit oracle repeated once per category, and `50 §3f`'s failure list gives a worker
 * nothing to do differently in any of them: the kernel fails closed and the operator reads
 * the security log.
 */
export const COARSE_CONTROL_ARTIFACT_DENIAL =
  'the control-artifact integrity gate refused; no authority is available and no effect is ' +
  'admitted (50 §3f)';

/** The worker-facing string, and the only function that produces one. */
export function coarseControlArtifactDenial(): string {
  return COARSE_CONTROL_ARTIFACT_DENIAL;
}

/**
 * A control-artifact integrity failure.
 *
 * `50 §3f`'s failure semantics, verbatim: "**fail closed**; **do not use the candidate
 * artifact**; raise the declared **CRITICAL security incident**; **journal it** where the
 * current architecture permits a trusted journal to remain operational; **do not silently
 * fall back to an older artifact**; **do not fetch a replacement from the network**."
 *
 * There is no `recoverable` flag and no `retryAfter`. Every instance of this class is
 * terminal for the bundle it refers to.
 */
export class ControlArtifactIntegrityFailure extends Error {
  public readonly reasonCode: ControlArtifactReasonCode;

  /** Internal only. Never returned to a worker, a model or an HTTP surface. */
  public readonly detail: string;

  public constructor(reasonCode: ControlArtifactReasonCode, detail: string) {
    // The Error message is the COARSE one, so an accidental `String(error)` in a
    // worker-facing path leaks nothing. The detail lives on its own property.
    super(COARSE_CONTROL_ARTIFACT_DENIAL);
    this.name = 'ControlArtifactIntegrityFailure';
    this.reasonCode = reasonCode;
    this.detail = detail;
  }
}

export function integrityFailure(
  reasonCode: ControlArtifactReasonCode,
  detail: string,
): never {
  throw new ControlArtifactIntegrityFailure(reasonCode, detail);
}

/** A verdict, for the paths that report rather than throw. */
export type VerificationVerdict =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reasonCode: ControlArtifactReasonCode;
      readonly detail: string;
    };

export function refused(
  reasonCode: ControlArtifactReasonCode,
  detail: string,
): VerificationVerdict {
  return { ok: false, reasonCode, detail };
}
