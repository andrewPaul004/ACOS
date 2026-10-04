/**
 * The EXACT pre-live signed artifact set, from `50 §6`.
 *
 * =================================================================================
 * `50 §6`, verbatim, and it is a CLOSED inventory
 *
 *   "**The pre-live signed set. No `etc.` No `including`.** Every entry's content boundary
 *    is closed by the section named in its row. **Every entry requires both signatures.
 *    Every entry is a manifest member.**"
 *
 * The table's four printed rows are classes **2**, **3**, **20** and **27**. `§6` then adds,
 * verbatim:
 *
 *   "**Also in the manifest at the pre-live gate, unchanged in content by this pass and
 *    carried here so the set is complete rather than partial:** **class 19** (effect
 *    constructors and their `ConstructorVersionRecord`s — `§3i` declares the key migration
 *    as follow-on work) and **class 24** (the audit-plane signing key's published public
 *    half [...]). **Both require both signatures and both are manifest members.**"
 *
 * So the required set was SIX classes at v1.3.6 — SEVEN after v1.3.7 adds class 5 (`50 §2g`) and
 * EIGHT after v1.3.8 adds class 28 (`50 §2h`) — and `37 §2`'s S1K gate list — which names classes 3,
 * 20, 27 and the Cedar bundle — is the list of classes whose RUNTIME CONSUMERS this slice
 * migrates, not the list of manifest members. The two lists are different lengths on
 * purpose and both are transcribed here rather than reconciled into one.
 * =================================================================================
 *
 * =================================================================================
 * CLASS 17 IS RETIRED, AND ITS ABSENCE IS ENFORCED RATHER THAN ASSUMED
 *
 * `50 §2d`: "**PER-COMPANY `window_registry` ROWS ARE NOT DEPLOY-TIME SIGNED CONTROL
 * ARTIFACTS.** They are runtime authoritative database state." and "**No empty or
 * signature-only artifact is retained to preserve numbering.** Class number **17 is reserved
 * and deprecated**; it is never reassigned".
 *
 * A manifest presenting a class-17 entry is therefore REFUSED — not ignored, not tolerated
 * as an unknown class. `§6`'s closed membership means an entry outside the set is an entry
 * nobody reviewed, and a revived class 17 specifically would be an attempt to reintroduce a
 * deploy-time signature over runtime state that `§3h` governs by other means.
 * =================================================================================
 *
 * =================================================================================
 * THE ARTIFACT IDS THAT `50` PRINTS, AND THE TWO IT DOES NOT
 *
 * `50 §6`'s table prints `artifact_id` for classes 2, 3, 20 and 27, and those four are
 * transcribed exactly. `§6`'s carried paragraph names classes 19 and 24 without printing an
 * id, so this module declares one for each.
 *
 * THAT CHOICE CANNOT MOVE AUTHORITY, which is why it is made here rather than returned as
 * an architecture gap: `§3b` binds `artifact_id` INSIDE the signature message and `§3d`
 * binds every entry inside the signed core, so whichever identifier a release ceremony
 * signs is the only one the deployment pin admits. A different identifier is a different
 * manifest and a different `manifest_id`. The choice is recorded in
 * `docs/implementation/S1K-contract.md` as an implementation-level identifier rather than a
 * normative one.
 * =================================================================================
 */

/** `50 §2d`. Reserved, deprecated, never reassigned, and never a manifest member. */
export const RETIRED_ARTIFACT_CLASS = 17;

/** One member of the closed pre-live set. */
export interface RequiredArtifact {
  readonly artifactClass: number;
  readonly artifactId: string;
  /**
   * The version the manifest entry must carry, when `50` declares one literally.
   *
   * `null` means the version is declared by the artifact package rather than by `50` —
   * `§6` writes "the catalogue's declared version", "the configuration's declared version"
   * and "the bundle's declared version" — and in that case the parser cross-checks the
   * manifest entry's version against the version the ARTIFACT'S OWN VERIFIED BYTES declare.
   * That is a consistency check between two things the owner signed, never a value this
   * module supplies.
   */
  readonly declaredVersion: string | null;
  /** The file inside the deployment's artifact package that carries the exact bytes. */
  readonly fileName: string;
  /** Which `50` section closes this artifact's content boundary. */
  readonly boundary: string;
}

/**
 * `50 §6`'s inventory, in `§3d`'s declared manifest order — ascending `artifact_class`.
 *
 * The ordering here is incidental to correctness (the verifier checks the manifest's own
 * order element-wise) and deliberate for legibility: this list reads in the same order the
 * signed core does.
 */
export const REQUIRED_PRE_LIVE_ARTIFACTS: readonly RequiredArtifact[] = Object.freeze([
  Object.freeze({
    artifactClass: 2,
    artifactId: 'acos.control.policy_set',
    declaredVersion: null,
    fileName: 'class-02.policy-set.json',
    boundary: '50 §2e',
  }),
  Object.freeze({
    artifactClass: 3,
    artifactId: 'acos.control.action_catalogue',
    declaredVersion: null,
    fileName: 'class-03.action-catalogue.json',
    boundary: '50 §2a',
  }),
  Object.freeze({
    // v1.3.7, `S1N-C1`. `50 §2g` closes class 5 and `37 §2`'s SEQ-04 pulls it into the
    // pre-live subset, because ADR-024's option-B money-moving trigger has no operand
    // without it and a trigger operand read from anywhere unsigned is unsigned authority
    // over whether the execution proxy is required.
    artifactClass: 5,
    artifactId: 'acos.control.credential_scopes',
    declaredVersion: null,
    fileName: 'class-05.credential-scopes.json',
    boundary: '50 §2g',
  }),
  Object.freeze({
    artifactClass: 19,
    artifactId: 'acos.control.effect_constructors',
    declaredVersion: null,
    fileName: 'class-19.effect-constructors.json',
    boundary: '50 §2 row 19, §3i',
  }),
  Object.freeze({
    // `50 §2b`: the artifact IS `artifacts/acos-jcs-1.spec.v1.txt`, and its
    // `artifact_version` is the literal `ACOS-JCS-1`.
    artifactClass: 20,
    artifactId: 'acos.control.jcs1_specification',
    declaredVersion: 'ACOS-JCS-1',
    fileName: 'class-20.acos-jcs-1.spec.v1.txt',
    boundary: '50 §2b',
  }),
  Object.freeze({
    artifactClass: 24,
    artifactId: 'acos.control.audit_signing_key',
    declaredVersion: null,
    fileName: 'class-24.audit-signing-key.json',
    boundary: '50 §2 row 24',
  }),
  Object.freeze({
    artifactClass: 27,
    artifactId: 'acos.control.degraded_mode_config',
    declaredVersion: null,
    fileName: 'class-27.degraded-mode-config.json',
    boundary: '50 §2c',
  }),
  Object.freeze({
    // v1.3.8, `S1P-W1`. `50 §6`: "v1.3.8 adds exactly one more — class 28 — because `§2h`
    // gives inbound provider evidence a trust root, and a verification key read from anywhere
    // unsigned is unsigned authority over what ACOS believes a provider did." A closed
    // discriminated union over `evidence_mode` (`S1P-W2`).
    artifactClass: 28,
    artifactId: 'acos.control.provider_evidence_trust',
    declaredVersion: null,
    fileName: 'class-28.provider-evidence-trust.json',
    boundary: '50 §2h',
  }),
]);

/** The four classes `37 §2`'s S1K gate migrates a runtime consumer onto. */
export const CLASSES_WITH_S1K_CONSUMERS: readonly number[] = Object.freeze([2, 3, 20, 27]);

const BY_CLASS: ReadonlyMap<number, RequiredArtifact> = new Map(
  REQUIRED_PRE_LIVE_ARTIFACTS.map((artifact) => [artifact.artifactClass, artifact]),
);

export function requiredArtifactForClass(artifactClass: number): RequiredArtifact | undefined {
  return BY_CLASS.get(artifactClass);
}

/**
 * `50 §2b`'S ACCEPTED CLASS-20 DIGEST IS DELIBERATELY NOT IN THIS FILE.
 *
 * `7af60fc5…a18f33` is the digest the architecture freeze recorded for
 * `artifacts/acos-jcs-1.spec.v1.txt`. A constant here would become a SECOND authority
 * source for class 20's content — exactly the arrangement `50 §3c` forbids — and a runtime
 * that compared against it would be verifying against a literal a code change can move
 * rather than against an owner-signed manifest entry.
 *
 * THE MANIFEST IS THE AUTHORITY. The accepted digest lives in
 * `tests/support/controlArtifactFixture.ts` as an ACCEPTANCE REGRESSION FIXTURE, where it
 * proves the bytes shipped in the artifact package are the bytes the architecture froze,
 * and where it is outside every authority path.
 */
