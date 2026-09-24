import { ED25519_PUBLIC_KEY_BYTES, SHA256_DIGEST_BYTES } from './casSig.js';
import { decodeLowercaseHex, keyIdOf, samePublicKey } from './ed25519.js';
import { integrityFailure } from './errors.js';

/**
 * The DEPLOYMENT TRUST CONFIGURATION — the three things `50 §3e` pins, and the top of
 * `50 §3g`'s dependency graph.
 *
 * =================================================================================
 * WHERE THESE COME FROM, AND EVERY PLACE THEY DO NOT — `50 §3a`, verbatim
 *
 *   "**Both public keys are TRUSTED DEPLOYMENT ROOTS. They are not control artifacts. They
 *    are not manifest rows. They are not discovered from a database, from the manifest,
 *    from the network, from a model, from a caller, from an API, or from the first
 *    signature observed.**"
 *
 *   "**TRUST-ON-FIRST-USE IS FORBIDDEN.** There is no "remember the key that first verified"
 *    path, no "accept any valid Ed25519 key" path, and no per-request key parameter."
 *
 * `50 §3e`: "**THE TRUSTED DEPLOYMENT CONFIGURATION PINS THREE THINGS:** 1.
 * `OWNER_ARTIFACT_ROOT_KEY` [...] 2. `OWNER_ARTIFACT_SECOND_FACTOR_KEY` [...] 3.
 * `EXPECTED_ACTIVE_MANIFEST_ID` — the manifest identity this deployment is intended to run."
 *
 * =================================================================================
 * THE ABSTRACTION IS NARROW ON PURPOSE
 *
 * The architecture declares that the roots are provisioned "out of band through the trusted
 * deployment mechanism" and does NOT declare a physical transport, so this module chooses
 * one — process environment, read once, at bootstrap — and keeps the choice as small as it
 * can be made:
 *
 *   * the reader takes a flat string map and returns a FROZEN configuration object. It has
 *     no network, no filesystem, no database and no default key;
 *   * there is NO per-request, per-call or per-verification key parameter anywhere in
 *     `src/`. `verifyControlArtifactBundle` takes this configuration, and
 *     `tests/controlArtifacts/trust-root-confinement.test.ts` asserts against a
 *     hand-authored list that `readDeploymentTrustConfiguration` has exactly one production
 *     call site per plane;
 *   * NOTHING remembers a key between runs. There is no keystore, no cache, no "last good"
 *     file and no learned state, so `§3e`'s "This introduces no mutable runtime trust state"
 *     is a property of the module rather than a claim about it.
 *
 * `50 §3i` is the warning this module exists to answer: S1B's `ConstructorVersionResolver`
 * "takes the verifying public key **as a constructor argument** and holds no keystore" —
 * "**A CALLER-SUPPLIED VERIFICATION KEY IS NOT A TRUST ROOT**, and it must not become the
 * general S1K pattern."
 * =================================================================================
 */

/** `50 §3e`'s three pinned values, and the two key ids derived from the first two. */
export interface DeploymentTrustConfiguration {
  /** `OWNER_ARTIFACT_ROOT_KEY` — the 32 RAW Ed25519 public-key bytes. */
  readonly primaryPublicKey: Uint8Array;
  /** `OWNER_ARTIFACT_SECOND_FACTOR_KEY` — the 32 RAW Ed25519 public-key bytes. */
  readonly secondFactorPublicKey: Uint8Array;
  /** `SHA-256(raw primary public key)`, lowercase hex. DERIVED, never supplied. */
  readonly primaryKeyId: string;
  /** `SHA-256(raw second-factor public key)`, lowercase hex. DERIVED, never supplied. */
  readonly secondFactorKeyId: string;
  /** `EXPECTED_ACTIVE_MANIFEST_ID` — `SHA-256(CORE)`, lowercase hex. */
  readonly expectedActiveManifestId: string;
  /** Where this deployment's artifact package lives. Not a trust anchor; a location. */
  readonly artifactPackageRoot: string;
}

/** A flat string map. `process.env` is one; a test's own record is another. */
export type TrustConfigurationSource = Readonly<Record<string, string | undefined>>;

/** The control plane's deployment variable names. */
export const CONTROL_TRUST_CONFIG_KEYS = Object.freeze({
  primaryPublicKey: 'ACOS_OWNER_ARTIFACT_ROOT_KEY',
  secondFactorPublicKey: 'ACOS_OWNER_ARTIFACT_SECOND_FACTOR_KEY',
  expectedActiveManifestId: 'ACOS_EXPECTED_ACTIVE_MANIFEST_ID',
  artifactPackageRoot: 'ACOS_CONTROL_ARTIFACT_ROOT',
});

/**
 * The AUDIT plane's own deployment variable names.
 *
 * `50 §3` property 2, verbatim: "**The audit plane recomputes independently.** A manifest
 * check run only by the control plane is a check the control plane can pass by lying
 * (`30 §5.2`)."
 *
 * The audit plane's roots and pin therefore arrive through ITS OWN trusted deployment
 * boundary rather than being handed across from the control plane. The VALUES are expected
 * to be equal — they are the same owner's roots and the same active manifest — and the
 * PROVENANCE is not, which is the whole point: a control plane that lied about its
 * configuration would not move the audit plane's.
 */
export const AUDIT_TRUST_CONFIG_KEYS = Object.freeze({
  primaryPublicKey: 'ACOS_AUDIT_OWNER_ARTIFACT_ROOT_KEY',
  secondFactorPublicKey: 'ACOS_AUDIT_OWNER_ARTIFACT_SECOND_FACTOR_KEY',
  expectedActiveManifestId: 'ACOS_AUDIT_EXPECTED_ACTIVE_MANIFEST_ID',
  artifactPackageRoot: 'ACOS_AUDIT_CONTROL_ARTIFACT_ROOT',
});

/** The four variable names one plane's trust configuration is read from. */
export interface TrustConfigKeyNames {
  readonly primaryPublicKey: string;
  readonly secondFactorPublicKey: string;
  readonly expectedActiveManifestId: string;
  readonly artifactPackageRoot: string;
}

function required(source: TrustConfigurationSource, name: string): string {
  const value = source[name];
  if (value === undefined || value === '') {
    integrityFailure(
      'TRUST_CONFIG_MISSING',
      `the deployment trust configuration does not provide ${name}; the runtime has no ` +
        'default root, no keystore and no discovery path (50 §3a)',
    );
  }
  return value;
}

function rawPublicKey(source: TrustConfigurationSource, name: string): Uint8Array {
  const decoded = decodeLowercaseHex(required(source, name), ED25519_PUBLIC_KEY_BYTES);
  if (decoded === null) {
    integrityFailure(
      'TRUST_CONFIG_MALFORMED',
      `${name} is not ${String(ED25519_PUBLIC_KEY_BYTES * 2)} lowercase hex characters; an ` +
        'Ed25519 root is 32 RAW public-key bytes and never a DER, SPKI, PEM or base64 ' +
        'wrapper (50 §3a)',
    );
  }
  return decoded;
}

/**
 * Read the deployment trust configuration, once, at bootstrap.
 *
 * `50 §3f` bootstrap steps 1 and 2 are BOTH discharged here, because a configuration that
 * names the same key twice must never become a configuration object at all:
 *
 *   1. "load the two root public keys from the deployment trust configuration";
 *   2. "check `primary_public_key != second_factor_public_key`".
 *
 * `50 §3a`, on step 2: "A deployment configuring the same key in both slots **fails closed
 * at bootstrap** and never becomes READY. **A second signature produced under the primary
 * key does not satisfy the second-factor requirement**, whatever its `signer_role` claims."
 *
 * The distinctness check compares the RAW 32 PUBLIC-KEY BYTES and not the key ids, because
 * `§3a` declares the bytes to be the anchor and the ids to be derived; comparing ids alone
 * would make the check depend on `SHA-256` being injective over a set an operator controls,
 * which is true and is not the reason the check passes.
 */
export function readDeploymentTrustConfiguration(
  source: TrustConfigurationSource = process.env,
  names: TrustConfigKeyNames = CONTROL_TRUST_CONFIG_KEYS,
): DeploymentTrustConfiguration {
  const primaryPublicKey = rawPublicKey(source, names.primaryPublicKey);
  const secondFactorPublicKey = rawPublicKey(source, names.secondFactorPublicKey);

  // STEP 2. Before anything is derived, and before any manifest byte is read.
  if (samePublicKey(primaryPublicKey, secondFactorPublicKey)) {
    integrityFailure(
      'TRUST_ROOTS_NOT_DISTINCT',
      `${names.primaryPublicKey} and ${names.secondFactorPublicKey} carry the same 32 raw ` +
        'public-key bytes; a second signature under the primary key does not satisfy the ' +
        'second-factor requirement, whatever its signer_role claims (50 §3a, 50 §4)',
    );
  }

  const expectedActiveManifestIdRaw = required(source, names.expectedActiveManifestId);
  if (decodeLowercaseHex(expectedActiveManifestIdRaw, SHA256_DIGEST_BYTES) === null) {
    integrityFailure(
      'TRUST_CONFIG_MALFORMED',
      `${names.expectedActiveManifestId} is not ${String(SHA256_DIGEST_BYTES * 2)} ` +
        'lowercase hex characters; the pin is SHA-256 over the exact manifest CORE bytes ' +
        '(50 §3e)',
    );
  }

  const primaryKeyId = keyIdOf(primaryPublicKey);
  const secondFactorKeyId = keyIdOf(secondFactorPublicKey);

  // Implied by the raw-byte distinctness above, and asserted rather than assumed because
  // `50 §3a` states both: "**`primary_public_key != second_factor_public_key`** [...] and
  // therefore **`primary_key_id != second_factor_key_id`**".
  if (primaryKeyId === secondFactorKeyId) {
    integrityFailure(
      'TRUST_ROOTS_NOT_DISTINCT',
      'the two provisioned roots derive the same key_id (50 §3a)',
    );
  }

  // The two key arrays are NOT `Object.freeze`d — a typed array cannot be frozen while it
  // has elements — so the configuration object is frozen and the bytes are private by
  // confinement: this module is their only producer, nothing exports them, and the only
  // consumer (`verifier.ts`) reads them.
  return Object.freeze({
    primaryPublicKey,
    secondFactorPublicKey,
    primaryKeyId,
    secondFactorKeyId,
    expectedActiveManifestId: expectedActiveManifestIdRaw,
    artifactPackageRoot: required(source, names.artifactPackageRoot),
  });
}

/**
 * The audit plane's reader. Same rules, different variables, and a SEPARATE call.
 *
 * It is a distinct function rather than a parameter default so that a source-boundary test
 * can assert the control plane never reads the audit plane's configuration and the audit
 * plane never reads the control plane's.
 */
export function readAuditDeploymentTrustConfiguration(
  source: TrustConfigurationSource = process.env,
): DeploymentTrustConfiguration {
  return readDeploymentTrustConfiguration(source, AUDIT_TRUST_CONFIG_KEYS);
}
