import type { ControlArtifactByteSource } from './artifactPackage.js';
import {
  parseClass19ConstructorSet,
  parseClass20Specification,
  parseClass24AuditSigningKey,
  parseClass27DegradedModeConfiguration,
  parseClass2PolicySet,
  parseClass3ActionCatalogue,
} from './artifactParsers.js';
import {
  sealVerifiedBundle,
  type VerifiedArtifactIdentity,
  type VerifiedControlArtifactBundle,
} from './bundle.js';
import { artifactSignatureMessage, manifestSignatureMessage } from './casSig.js';
import { hexOf, sha256, verifyControlSignature } from './ed25519.js';
import { integrityFailure } from './errors.js';
import { parseManifestDocument, type ManifestEntry } from './manifestCore.js';
import {
  REQUIRED_PRE_LIVE_ARTIFACTS,
  RETIRED_ARTIFACT_CLASS,
  requiredArtifactForClass,
} from './requiredSet.js';
import type { DeploymentTrustConfiguration } from './trustConfig.js';

/**
 * `50 §3f` OCCASION 1 — THE BOOTSTRAP CEREMONY, in its declared order.
 *
 * =================================================================================
 * THE EIGHT STEPS, VERBATIM FROM `50 §3f`
 *
 *   1. load the two root public keys from the deployment trust configuration;
 *   2. check `primary_public_key != second_factor_public_key`;
 *   3. compute `manifest_id` and check it equals `EXPECTED_ACTIVE_MANIFEST_ID`;
 *   4. verify **both** manifest signatures against the two provisioned keys;
 *   5. check `expected_primary_key_id` and `expected_second_factor_key_id` in the core
 *      equal the provisioned keys' ids;
 *   6. verify the **complete** manifest set — every required class present, `entry_count`
 *      exact, order as declared;
 *   7. for **every** required artifact: recompute `SHA-256` over its exact bytes and compare
 *      to its entry's `content_hash`;
 *   8. for **every** required artifact: verify **both** signatures under `§3b`'s envelope.
 *
 *   "**On any failure the kernel FAILS CLOSED BEFORE ANY AUTHORITY EXECUTION.** It does not
 *    become READY, it does not serve a degraded subset, and it does not admit a single
 *    effect."
 *
 * STEPS 1 AND 2 ARE DISCHARGED BY `trustConfig.ts`, which is why this function takes a
 * `DeploymentTrustConfiguration` and cannot be handed loose key bytes: a configuration
 * object only exists when both steps have already passed.
 *
 * =================================================================================
 * THE PIN IS CHECKED BEFORE THE SIGNATURES, AND THAT ORDER IS NORMATIVE
 *
 * `50 §3e`: "**The pin is checked *before* the signatures**, because a signature check on a
 * manifest the deployment did not intend proves only that someone once signed something."
 *
 * `50 §3e` also states what the pin does NOT do, and it is transcribed because an
 * implementation that believed otherwise would drop step 7: "**THE PIN IS NOT THE ONLY
 * REJECTION, AND IT IS NOT CLAIMED TO BE.** [...] **Both legs are required**: the pin alone
 * authenticates the set and not the bytes, and the per-artifact checks alone authenticate
 * the bytes and not the set."
 *
 * > **"THE HIGHEST EPOCH FOUND ON DISK" IS NOT ROLLBACK PROTECTION AND IS NOT USED.**
 *
 * There is no epoch comparison anywhere in this file. `manifest_epoch` is read, carried into
 * the bundle for lineage, and never compared to anything.
 *
 * =================================================================================
 * THERE IS NO PARTIAL SUCCESS
 *
 * `50 §3f` occasion 2: "**Publication of a new verified bundle is ATOMIC**, and **a failed
 * candidate bundle NEVER replaces the current verified bundle.** There is no partial swap
 * and no per-artifact hot reload."
 *
 * This function either returns a sealed bundle or throws. It never returns a partially
 * populated one, and it never publishes: publication is `registry.ts`'s single assignment,
 * made only with the value this function returned.
 * =================================================================================
 */
export function verifyControlArtifactBundle(
  config: DeploymentTrustConfiguration,
  source: ControlArtifactByteSource,
): VerifiedControlArtifactBundle {
  // ---------------------------------------------------------------------------------
  // STEP 3 — the manifest's identity, and the deployment pin, BEFORE any signature.
  // ---------------------------------------------------------------------------------
  const manifest = parseManifestDocument(source.readManifestDocument());

  if (manifest.manifestId !== config.expectedActiveManifestId) {
    integrityFailure(
      'MANIFEST_IDENTITY_NOT_PINNED',
      `the manifest at ${source.describe} computes manifest_id ${manifest.manifestId}, ` +
        `which is not this deployment's pinned EXPECTED_ACTIVE_MANIFEST_ID ` +
        `${config.expectedActiveManifestId}; no epoch comparison is performed and no ` +
        'other manifest is searched for (50 §3e)',
    );
  }

  // ---------------------------------------------------------------------------------
  // STEP 4 — BOTH manifest signatures, under `§3d`'s SEPARATE manifest domain.
  //
  // `50 §4`: "An artifact or a manifest presenting one valid signature is **REFUSED**, and
  // is never reported as verified." The two checks are separate statements over separate
  // messages under separate keys; there is no loop over "the signatures" that could be
  // satisfied twice by one of them.
  // ---------------------------------------------------------------------------------
  const primaryManifestMessage = manifestSignatureMessage(
    'PRIMARY',
    manifest.header,
    manifest.coreSha256,
  );
  if (
    !verifyControlSignature(
      primaryManifestMessage,
      config.primaryPublicKey,
      manifest.primarySignature,
    )
  ) {
    integrityFailure(
      'MANIFEST_PRIMARY_SIGNATURE_INVALID',
      'the manifest core carries no valid PRIMARY signature under the provisioned ' +
        'OWNER_ARTIFACT_ROOT_KEY (50 §3d)',
    );
  }

  const secondFactorManifestMessage = manifestSignatureMessage(
    'SECOND_FACTOR',
    manifest.header,
    manifest.coreSha256,
  );
  if (
    !verifyControlSignature(
      secondFactorManifestMessage,
      config.secondFactorPublicKey,
      manifest.secondFactorSignature,
    )
  ) {
    integrityFailure(
      'MANIFEST_SECOND_FACTOR_SIGNATURE_INVALID',
      'the manifest core carries no valid SECOND_FACTOR signature under the provisioned ' +
        'OWNER_ARTIFACT_SECOND_FACTOR_KEY; one valid signature is refused and is never ' +
        'reported as verified (50 §4)',
    );
  }

  // ---------------------------------------------------------------------------------
  // STEP 5 — the core's declared key ids against the PROVISIONED keys' derived ids.
  //
  // `50 §3a`: "**The manifest may carry key IDs for consistency checking, but it CANNOT
  // DEFINE WHICH PUBLIC KEYS ARE TRUSTED.** [...] these are checked **against** the
  // deployment-provisioned keys. **If the manifest names a different key: FAIL CLOSED.**
  // The manifest is never the source of the key."
  //
  // The direction of this comparison is the whole of the non-circularity argument. The
  // verification above used `config.primaryPublicKey`; this step confirms the manifest
  // agrees about which key that was. A verifier that had instead SELECTED a key from
  // `expected_primary_key_id` would be letting the manifest establish its own verifier.
  // ---------------------------------------------------------------------------------
  if (manifest.header.expectedPrimaryKeyId !== config.primaryKeyId) {
    integrityFailure(
      'MANIFEST_KEY_ID_MISMATCH',
      'the manifest core names a different expected_primary_key_id from the deployment ' +
        'trust configuration; the manifest is never the source of the key (50 §3a)',
    );
  }
  if (manifest.header.expectedSecondFactorKeyId !== config.secondFactorKeyId) {
    integrityFailure(
      'MANIFEST_KEY_ID_MISMATCH',
      'the manifest core names a different expected_second_factor_key_id from the ' +
        'deployment trust configuration; the manifest is never the source of the key ' +
        '(50 §3a)',
    );
  }

  // ---------------------------------------------------------------------------------
  // STEP 6 — THE COMPLETE SET. `entry_count` and the declared order were checked by the
  // parser, over the same bytes `manifest_id` was taken from; membership is checked here
  // against `50 §6`'s closed inventory.
  // ---------------------------------------------------------------------------------
  const byClass = new Map<number, ManifestEntry>();
  for (const entry of manifest.entries) {
    if (entry.artifactClass === RETIRED_ARTIFACT_CLASS) {
      // `50 §2d`: class 17 is retired, reserved and deprecated, and "**No empty or
      // signature-only artifact is retained to preserve numbering.**" A manifest reviving
      // it is refused rather than ignored.
      integrityFailure(
        'RETIRED_CLASS_PRESENT',
        `the manifest carries a class-${String(RETIRED_ARTIFACT_CLASS)} entry; that class ` +
          'is retired from the deploy-time signed manifest, reserved and deprecated, and ' +
          'per-company window_registry rows are runtime state governed by 50 §3h',
      );
    }
    const required = requiredArtifactForClass(entry.artifactClass);
    if (required === undefined) {
      integrityFailure(
        'UNEXPECTED_ARTIFACT_CLASS',
        `the manifest carries a class-${String(entry.artifactClass)} entry, which is ` +
          'outside 50 §6’s closed pre-live set',
      );
    }
    if (entry.artifactId !== required.artifactId) {
      integrityFailure(
        'ARTIFACT_IDENTITY_UNEXPECTED',
        `the class-${String(entry.artifactClass)} entry declares artifact_id ` +
          `${JSON.stringify(entry.artifactId)}; 50 §6 declares ` +
          `${JSON.stringify(required.artifactId)}`,
      );
    }
    if (required.declaredVersion !== null && entry.artifactVersion !== required.declaredVersion) {
      integrityFailure(
        'ARTIFACT_IDENTITY_UNEXPECTED',
        `the class-${String(entry.artifactClass)} entry declares artifact_version ` +
          `${JSON.stringify(entry.artifactVersion)}; 50 §6 declares ` +
          `${JSON.stringify(required.declaredVersion)}`,
      );
    }
    // The parser already refused a duplicate `(class, id, version)`. A second entry for one
    // CLASS with a different id or version is a separate defect, and is refused here,
    // because the runtime resolves an artifact BY CLASS and two candidates would make that
    // resolution a choice.
    if (byClass.has(entry.artifactClass)) {
      integrityFailure(
        'MANIFEST_DUPLICATE_ENTRY',
        `the manifest carries two class-${String(entry.artifactClass)} entries`,
      );
    }
    byClass.set(entry.artifactClass, entry);
  }

  for (const required of REQUIRED_PRE_LIVE_ARTIFACTS) {
    if (!byClass.has(required.artifactClass)) {
      integrityFailure(
        'REQUIRED_ARTIFACT_MISSING',
        `the manifest carries no class-${String(required.artifactClass)} entry ` +
          `(${required.artifactId}); 50 §6's set is closed and no member is optional`,
      );
    }
  }

  // ---------------------------------------------------------------------------------
  // STEPS 7 AND 8 — for EVERY required artifact, in one pass per artifact but in the
  // declared order of the two checks: content hash first, then both signatures.
  //
  // `50 §3e`'s attack table is what the ordering buys. An artifact whose bytes changed under
  // an unchanged entry fails step 7. An artifact whose bytes changed AND whose entry was
  // updated to match, with the old signatures kept, passes step 7 and fails step 8 —
  // "`§3b`'s envelope binds `content_sha256`, so a signature over the old digest does not
  // verify over the new one" — and would in any case have moved `manifest_id` and been
  // rejected by the pin first.
  // ---------------------------------------------------------------------------------
  const verifiedBytes = new Map<number, Uint8Array>();
  const identities: VerifiedArtifactIdentity[] = [];

  for (const required of REQUIRED_PRE_LIVE_ARTIFACTS) {
    const entry = byClass.get(required.artifactClass)!;
    const bytes = source.readArtifactBytes(required.fileName);

    // STEP 7 — `SHA-256` over the EXACT bytes. No parse, no reserialise, no normalisation,
    // no trim. `50 §3c`.
    const computed = sha256(bytes);
    const computedHex = hexOf(computed);
    if (computedHex !== entry.contentHash) {
      integrityFailure(
        'ARTIFACT_CONTENT_HASH_MISMATCH',
        `class ${String(required.artifactClass)} (${required.artifactId}): the exact bytes ` +
          `at ${required.fileName} hash to ${computedHex} and the signed manifest entry ` +
          `declares ${entry.contentHash} (50 §3c)`,
      );
    }

    // STEP 8 — BOTH signatures, under `§3b`'s envelope, over the identity the manifest bound.
    const identity = {
      artifactClass: entry.artifactClass,
      artifactId: entry.artifactId,
      artifactVersion: entry.artifactVersion,
      contentSha256: entry.contentSha256,
    };
    if (
      !verifyControlSignature(
        artifactSignatureMessage('PRIMARY', identity),
        config.primaryPublicKey,
        entry.primarySignature,
      )
    ) {
      integrityFailure(
        'ARTIFACT_PRIMARY_SIGNATURE_INVALID',
        `class ${String(required.artifactClass)} (${required.artifactId}) carries no valid ` +
          'PRIMARY signature under the provisioned OWNER_ARTIFACT_ROOT_KEY (50 §3b)',
      );
    }
    if (
      !verifyControlSignature(
        artifactSignatureMessage('SECOND_FACTOR', identity),
        config.secondFactorPublicKey,
        entry.secondFactorSignature,
      )
    ) {
      integrityFailure(
        'ARTIFACT_SECOND_FACTOR_SIGNATURE_INVALID',
        `class ${String(required.artifactClass)} (${required.artifactId}) carries no valid ` +
          'SECOND_FACTOR signature under the provisioned OWNER_ARTIFACT_SECOND_FACTOR_KEY; ' +
          'one valid signature is refused (50 §4)',
      );
    }

    verifiedBytes.set(required.artifactClass, bytes);
    identities.push(
      Object.freeze({
        artifactClass: entry.artifactClass,
        artifactId: entry.artifactId,
        artifactVersion: entry.artifactVersion,
        contentHash: entry.contentHash,
        byteLength: bytes.length,
      }),
    );
  }

  // ---------------------------------------------------------------------------------
  // ONLY NOW: parse. `50 §3c`: "a parsed immutable representation derived EXCLUSIVELY from
  // those verified bytes."
  // ---------------------------------------------------------------------------------
  const class20Entry = byClass.get(20)!;

  const contents = {
    manifestId: manifest.manifestId,
    manifestEpoch: manifest.header.manifestEpoch,
    identities: Object.freeze(identities),
    policySet: parseClass2PolicySet(verifiedBytes.get(2)!),
    actionCatalogue: parseClass3ActionCatalogue(verifiedBytes.get(3)!),
    constructorSet: parseClass19ConstructorSet(verifiedBytes.get(19)!),
    jcs1Specification: parseClass20Specification(verifiedBytes.get(20)!, {
      artifactVersion: class20Entry.artifactVersion,
      contentHash: class20Entry.contentHash,
    }),
    auditSigningKey: parseClass24AuditSigningKey(verifiedBytes.get(24)!),
    degradedModeConfiguration: parseClass27DegradedModeConfiguration(verifiedBytes.get(27)!),
  };

  // The artifact's own declared version against the version the manifest bound. Both are
  // things the owner signed, so a disagreement is a defect in the signed package rather
  // than an attack, and it fails closed for the same reason a catalogue defect does: two
  // declarations of one fact that disagree leave no reading that is safe to use.
  assertDeclaredVersion(byClass, 2, contents.policySet.artifactVersion);
  assertDeclaredVersion(byClass, 3, contents.actionCatalogue.artifactVersion);
  assertDeclaredVersion(byClass, 19, contents.constructorSet.artifactVersion);
  assertDeclaredVersion(byClass, 24, contents.auditSigningKey.artifactVersion);
  assertDeclaredVersion(byClass, 27, contents.degradedModeConfiguration.artifactVersion);

  return sealVerifiedBundle(contents);
}

function assertDeclaredVersion(
  byClass: ReadonlyMap<number, ManifestEntry>,
  artifactClass: number,
  declaredInArtifact: string,
): void {
  const entry = byClass.get(artifactClass)!;
  if (entry.artifactVersion !== declaredInArtifact) {
    integrityFailure(
      'ARTIFACT_IDENTITY_UNEXPECTED',
      `class ${String(artifactClass)}: the signed manifest entry declares artifact_version ` +
        `${JSON.stringify(entry.artifactVersion)} and the artifact's own verified bytes ` +
        `declare ${JSON.stringify(declaredInArtifact)}`,
    );
  }
}
