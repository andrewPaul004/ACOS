/**
 * `50 §6`'s CLOSED pre-live inventory, transcribed INDEPENDENTLY for the release tooling.
 *
 * =================================================================================
 * WHY THIS IS A SECOND TRANSCRIPTION AND NOT AN IMPORT
 *
 * `§16` of the S1L mandate: the offline release tooling "must not import `src/...`
 * production framing helpers. Use v1.3.6 as its specification."
 *
 * `src/kernel/controlArtifacts/requiredSet.ts` is the RUNTIME's transcription of the same
 * `50 §6` table. If the release builder imported it, a mistake in one would be a mistake in
 * both and the runtime's refusal of a malformed release would prove nothing. Two independent
 * transcriptions of one printed table disagree loudly; one shared constant cannot disagree
 * at all.
 *
 * `tests/release/release-boundaries.test.ts` asserts the two agree, which is the correct
 * direction for the check: the AGREEMENT is asserted in a test, and neither module reads the
 * other in the path that matters.
 *
 * =================================================================================
 * THIS IS NOT A SECOND AUTHORITY OVER ARTIFACT CONTENT
 *
 * `50 §3c`: "**A signed control artifact and a separate hard-coded production literal may
 * not both be authority sources**". What this file declares is the closed MEMBERSHIP of
 * `50 §6`'s table — which classes and which `artifact_id`s exist — and nothing about any
 * artifact's CONTENT. Every content value in a release comes from the artifact bytes the
 * declaration points at, and is never regenerated from a constant here.
 * =================================================================================
 */

/** `50 §2d`. Reserved, deprecated, never reassigned, never a manifest member. */
export const RETIRED_ARTIFACT_CLASS = 17;

/** `50 §3d`'s manifest framing version. */
export const MANIFEST_FORMAT_VERSION = 'ACOS-CONTROL-MANIFEST-CORE-V1';

/** The manifest document's file name inside a deployable package. */
export const MANIFEST_FILE_NAME = 'manifest.json';

export interface InventoryMember {
  readonly artifactClass: number;
  readonly artifactId: string;
  /** The version `50` declares LITERALLY, or `null` when `50 §6` writes "the declared version". */
  readonly declaredVersion: string | null;
  /** Which `50` section closes this artifact's content boundary. */
  readonly boundary: string;
}

/**
 * `50 §6`'s EIGHT pre-live members, in ascending class order.
 *
 * **v1.3.7 adds class 5** (`50 §2g`, `S1N-C1`), and nothing else. `37 §2`'s SEQ-04 gives
 * the reason: ADR-024's option-B money-moving trigger had no mechanised operand, and a
 * trigger operand read from anywhere unsigned is unsigned authority over whether the
 * execution proxy is required.
 */
export const PRE_LIVE_INVENTORY: readonly InventoryMember[] = Object.freeze([
  Object.freeze({
    artifactClass: 2,
    artifactId: 'acos.control.policy_set',
    declaredVersion: null,
    boundary: '50 §2e',
  }),
  Object.freeze({
    artifactClass: 3,
    artifactId: 'acos.control.action_catalogue',
    declaredVersion: null,
    boundary: '50 §2a',
  }),
  Object.freeze({
    artifactClass: 5,
    artifactId: 'acos.control.credential_scopes',
    declaredVersion: null,
    boundary: '50 §2g',
  }),
  Object.freeze({
    artifactClass: 19,
    artifactId: 'acos.control.effect_constructors',
    declaredVersion: null,
    boundary: '50 §2 row 19, §3i',
  }),
  Object.freeze({
    artifactClass: 20,
    artifactId: 'acos.control.jcs1_specification',
    declaredVersion: 'ACOS-JCS-1',
    boundary: '50 §2b',
  }),
  Object.freeze({
    artifactClass: 24,
    artifactId: 'acos.control.audit_signing_key',
    declaredVersion: null,
    boundary: '50 §2 row 24',
  }),
  Object.freeze({
    artifactClass: 27,
    artifactId: 'acos.control.degraded_mode_config',
    declaredVersion: null,
    boundary: '50 §2c',
  }),
  Object.freeze({
    // v1.3.8 adds class 28 (`50 §2h`, `S1P-W1`), and nothing else: the provider-evidence
    // trust record — a closed discriminated union over `evidence_mode` — joins `50 §6`.
    artifactClass: 28,
    artifactId: 'acos.control.provider_evidence_trust',
    declaredVersion: null,
    boundary: '50 §2h',
  }),
]);

const BY_CLASS: ReadonlyMap<number, InventoryMember> = new Map(
  PRE_LIVE_INVENTORY.map((member) => [member.artifactClass, member] as const),
);

export function inventoryMember(artifactClass: number): InventoryMember | undefined {
  return BY_CLASS.get(artifactClass);
}

/** A release-tooling refusal. Never thrown by anything under `src/`. */
export class ReleaseRefusal extends Error {
  readonly code: string;

  constructor(code: string, detail: string) {
    super(`${code}: ${detail}`);
    this.name = 'ReleaseRefusal';
    this.code = code;
  }
}

export function refuse(code: string, detail: string): never {
  throw new ReleaseRefusal(code, detail);
}
