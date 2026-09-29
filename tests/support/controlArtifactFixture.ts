import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildSignedManifest,
  ed25519FromSeed,
  writeSignedPackage,
  type BuildSignedManifestOptions,
  type PackageArtifactInput,
  type SigningKeyPair,
} from '../../tools/control-artifacts/signPackage.js';
import { filesystemArtifactPackage } from '../../src/kernel/controlArtifacts/artifactPackage.js';
import type { VerifiedControlArtifactBundle } from '../../src/kernel/controlArtifacts/bundle.js';
import { readDeploymentTrustConfiguration } from '../../src/kernel/controlArtifacts/trustConfig.js';
import { verifyControlArtifactBundle } from '../../src/kernel/controlArtifacts/verifier.js';

/**
 * TEST-ONLY control-artifact packages, signed by TEST-ONLY keys.
 *
 * =================================================================================
 * THESE KEYS ARE NOT PRODUCTION KEYS AND CANNOT BECOME ONE
 *
 * `50 §3a`, custody, verbatim: "**Neither private key exists in application source, in this
 * repository, in any database, in any environment variable available to the runtime, on the
 * runtime filesystem, in the manifest, or in any CI fixture used by production.** Production
 * signing is an **offline release ceremony**. **Tests may use dedicated keys that are
 * unambiguously test-only and are never a production trust root.**"
 *
 * The three seeds below are fixed, printed in full, and derived from a sentence that says
 * what they are. THAT IS THE POINT: a seed anybody can read out of a public repository is
 * one nobody can mistake for an owner root, and the deployment trust configuration that
 * would accept it exists only inside this test suite.
 *
 * `tests/controlArtifacts/key-hygiene.test.ts` asserts that no module under `src/` imports
 * this file or `tools/`, so the keys are unreachable from every production path rather than
 * merely unused by one.
 *
 * =================================================================================
 * THE ARTIFACT BYTES ARE THE REAL ONES
 *
 * Classes 2, 3, 19, 20 and 27 are read from `artifacts/control/`, which is what a deployment
 * ships. The fixture SIGNS them with test keys; it does not invent them. So a test that
 * proves the runtime reads `irrecoverable_units` from the verified class-3 artifact is
 * proving it about the bytes production will run, and `class-20.acos-jcs-1.spec.v1.txt` is
 * the byte-identical copy of the architecture's own file — asserted below against the digest
 * `50 §2b` froze.
 *
 * Class 24 is the exception and is GENERATED here, because `50 §2` row 24's content is the
 * audit plane's published public key: a value a deployment's audit host produces, not a
 * value a repository can carry. The fixture generates it from a test seed for the same
 * reason it generates the manifest.
 * =================================================================================
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');

/** Where a deployment's artifact bytes live in this repository. */
export const REPO_ARTIFACT_ROOT = join(REPO_ROOT, 'artifacts', 'control');

/**
 * `50 §2b`'s frozen class-20 digest, as an ACCEPTANCE REGRESSION FIXTURE.
 *
 * `§21` of the S1K mandate: "**Do NOT hard-code that digest as a substitute for manifest
 * verification.** The manifest remains authority. This value may be used as an acceptance
 * regression fixture only where appropriate."
 *
 * It is here, in test support, and deliberately NOT in `src/`: its job is to prove the file
 * this repository ships is the file the architecture froze, and it is outside every
 * authority path by construction.
 */
export const CLASS_20_ACCEPTED_CONTENT_HASH =
  '7af60fc564aef296679ae06a34b188d3454ac7ef69f448f7260a3d5d55a18f33';

/** `50 §2b`: "Size | **13479 bytes**". */
export const CLASS_20_ACCEPTED_BYTE_LENGTH = 13479;

/**
 * `50 §2e`: the accepted current `policy_version` — the Cedar-set digest, which is NOT the
 * class-2 content hash. Carried here so a test can assert both survive this slice.
 */
export const ACCEPTED_POLICY_VERSION =
  '47c2849b41bd0bdf433e75d7cf75b45f3133d93183c8fd447606ce1017c30ff6';

function testSeed(sentence: string): Buffer {
  // A fixed 32-byte seed, printed by its own sentence. Not random, not secret, not a key
  // ceremony, and reproducible across machines so a fixture is byte-stable.
  const bytes = Buffer.alloc(32, 0);
  Buffer.from(sentence, 'utf8').copy(bytes, 0, 0, Math.min(32, Buffer.byteLength(sentence)));
  return bytes;
}

export const TEST_ONLY_PRIMARY_SEED = testSeed('ACOS TEST-ONLY PRIMARY OWNER ROOT');
export const TEST_ONLY_SECOND_FACTOR_SEED = testSeed('ACOS TEST-ONLY SECOND FACTOR ROOT');
export const TEST_ONLY_THIRD_PARTY_SEED = testSeed('ACOS TEST-ONLY ATTACKER ROOT KEY');
export const TEST_ONLY_AUDIT_SIGNING_SEED = testSeed('ACOS TEST-ONLY AUDIT PLANE SIGNER');

export function testOnlyKeyPair(seed: Buffer): SigningKeyPair {
  return ed25519FromSeed(seed);
}

/**
 * `50 §6`'s inventory as the fixture assembles it, in manifest order.
 *
 * SEVEN members after v1.3.7. Class 5 is the one v1.3.7 adds, and the fixture reads its
 * bytes out of `artifacts/control/` like every other deployed artifact — a test that
 * needs a different credential set edits them through `mutate`, which is the byte-level
 * surface the signature covers.
 */
export interface FixtureArtifactSpec {
  readonly artifactClass: number;
  readonly artifactId: string;
  readonly artifactVersion: string;
  readonly fileName: string;
}

export const FIXTURE_ARTIFACT_SPECS: readonly FixtureArtifactSpec[] = Object.freeze([
  {
    artifactClass: 2,
    artifactId: 'acos.control.policy_set',
    artifactVersion: 'acos.policy_set.2026-09-24',
    fileName: 'class-02.policy-set.json',
  },
  {
    artifactClass: 3,
    artifactId: 'acos.control.action_catalogue',
    artifactVersion: 'acos.action_catalogue.2026-09-28',
    fileName: 'class-03.action-catalogue.json',
  },
  {
    // v1.3.7, `50 §2g` (`S1N-C1`). The signed owner of ADR-024's option-B trigger operand.
    artifactClass: 5,
    artifactId: 'acos.control.credential_scopes',
    artifactVersion: 'acos.credential_scopes.2026-09-26',
    fileName: 'class-05.credential-scopes.json',
  },
  {
    artifactClass: 19,
    artifactId: 'acos.control.effect_constructors',
    artifactVersion: 'acos.effect_constructors.2026-09-29',
    fileName: 'class-19.effect-constructors.json',
  },
  {
    artifactClass: 20,
    artifactId: 'acos.control.jcs1_specification',
    artifactVersion: 'ACOS-JCS-1',
    fileName: 'class-20.acos-jcs-1.spec.v1.txt',
  },
  {
    artifactClass: 24,
    artifactId: 'acos.control.audit_signing_key',
    artifactVersion: 'acos.audit_signing_key.2026-09-24',
    fileName: 'class-24.audit-signing-key.json',
  },
  {
    artifactClass: 27,
    artifactId: 'acos.control.degraded_mode_config',
    artifactVersion: 'acos.degraded_mode_config.2026-09-24',
    fileName: 'class-27.degraded-mode-config.json',
  },
]);

/** The class-24 artifact's exact bytes, for a given audit-plane verifying key. */
export function class24ArtifactBytes(rawPublicKey: Buffer): Buffer {
  return Buffer.from(
    `${JSON.stringify(
      {
        artifact_id: 'acos.control.audit_signing_key',
        artifact_version: 'acos.audit_signing_key.2026-09-24',
        public_key: rawPublicKey.toString('hex'),
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

/** Read the repository's deployed artifact bytes, plus a generated class 24. */
export function repositoryArtifacts(
  auditPublicKey: Buffer = testOnlyKeyPair(TEST_ONLY_AUDIT_SIGNING_SEED).rawPublicKey,
): PackageArtifactInput[] {
  return FIXTURE_ARTIFACT_SPECS.map((spec) => ({
    artifactClass: spec.artifactClass,
    artifactId: spec.artifactId,
    artifactVersion: spec.artifactVersion,
    fileName: spec.fileName,
    bytes:
      spec.artifactClass === 24
        ? class24ArtifactBytes(auditPublicKey)
        : readFileSync(join(REPO_ARTIFACT_ROOT, spec.fileName)),
  }));
}

export interface ControlArtifactFixtureOptions {
  /** Write the package here instead of a fresh temporary directory. */
  readonly dir?: string;
  readonly manifestEpoch?: string;
  readonly primary?: SigningKeyPair;
  readonly secondFactor?: SigningKeyPair;
  /** Rewrite the artifact set before signing — the byte-level attack surface. */
  readonly mutate?: (artifacts: PackageArtifactInput[]) => PackageArtifactInput[];
  /** Signature-level tampering. See `BuildSignedManifestOptions['tamper']`. */
  readonly tamper?: BuildSignedManifestOptions['tamper'];
  /** Pin the deployment to something other than the manifest actually written. */
  readonly pinOverride?: string;
  /** Configure one key in both deployment slots — `50 §3a`'s distinctness negative. */
  readonly sameKeyInBothSlots?: boolean;
  /** Write the audit plane's package with a different set of bytes. */
  readonly auditMutate?: (artifacts: PackageArtifactInput[]) => PackageArtifactInput[];
}

export interface ControlArtifactFixture {
  readonly controlRoot: string;
  readonly auditRoot: string;
  readonly manifestId: string;
  readonly manifestEpoch: string;
  readonly primary: SigningKeyPair;
  readonly secondFactor: SigningKeyPair;
  readonly artifacts: readonly PackageArtifactInput[];
  /** The deployment trust configuration a control-plane bootstrap reads. */
  readonly controlEnv: Readonly<Record<string, string>>;
  /** The audit plane's OWN deployment trust configuration. */
  readonly auditEnv: Readonly<Record<string, string>>;
}

/**
 * Write a complete, signed control-artifact package for both planes.
 *
 * `50 §2b`: "**The control plane and the audit plane each hold a BYTE-IDENTICAL COPY of this
 * artifact.**" The fixture writes two directories with the same bytes and the same manifest
 * by default, and `auditMutate` exists so a test can make ONE plane's copy differ and prove
 * the other plane does not cover for it.
 */
export function buildControlArtifactFixture(
  options: ControlArtifactFixtureOptions = {},
): ControlArtifactFixture {
  const primary = options.primary ?? testOnlyKeyPair(TEST_ONLY_PRIMARY_SEED);
  const secondFactor = options.secondFactor ?? testOnlyKeyPair(TEST_ONLY_SECOND_FACTOR_SEED);
  const manifestEpoch = options.manifestEpoch ?? '1';

  const base = repositoryArtifacts();
  const artifacts = options.mutate === undefined ? base : options.mutate(base);

  const dir =
    options.dir ?? mkdtempSync(join(tmpdir(), 'acos-s1k-'));
  const controlRoot = join(dir, 'control');
  const auditRoot = join(dir, 'audit');

  const signing: BuildSignedManifestOptions = {
    manifestEpoch,
    primary,
    secondFactor,
    artifacts,
    ...(options.tamper === undefined ? {} : { tamper: options.tamper }),
  };

  const written = writeSignedPackage(controlRoot, signing);

  // The audit plane's own copy. Same manifest bytes, its own artifact files.
  const auditArtifacts =
    options.auditMutate === undefined ? artifacts : options.auditMutate([...artifacts]);
  writeSignedPackage(auditRoot, { ...signing, artifacts: auditArtifacts });
  // A mutated audit copy must keep the SAME manifest as the control plane — the whole point
  // of `50 §3`'s property 2 is that both planes check their own bytes against ONE trusted
  // manifest. Re-writing the audit manifest over the mutated set would be checking a copy
  // against itself.
  writeFileSync(join(auditRoot, 'manifest.json'), written.manifestDocument, 'utf8');

  const pin = options.pinOverride ?? written.manifestId;
  const primaryHex = primary.rawPublicKey.toString('hex');
  const secondFactorHex = options.sameKeyInBothSlots === true
    ? primaryHex
    : secondFactor.rawPublicKey.toString('hex');

  return {
    controlRoot,
    auditRoot,
    manifestId: written.manifestId,
    manifestEpoch,
    primary,
    secondFactor,
    artifacts,
    controlEnv: Object.freeze({
      ACOS_OWNER_ARTIFACT_ROOT_KEY: primaryHex,
      ACOS_OWNER_ARTIFACT_SECOND_FACTOR_KEY: secondFactorHex,
      ACOS_EXPECTED_ACTIVE_MANIFEST_ID: pin,
      ACOS_CONTROL_ARTIFACT_ROOT: controlRoot,
    }),
    auditEnv: Object.freeze({
      ACOS_AUDIT_OWNER_ARTIFACT_ROOT_KEY: primaryHex,
      ACOS_AUDIT_OWNER_ARTIFACT_SECOND_FACTOR_KEY: secondFactorHex,
      ACOS_AUDIT_EXPECTED_ACTIVE_MANIFEST_ID: pin,
      ACOS_AUDIT_CONTROL_ARTIFACT_ROOT: auditRoot,
    }),
  };
}

/** Replace one artifact's bytes in a set, leaving its identity alone. */
export function withArtifactBytes(
  artifacts: readonly PackageArtifactInput[],
  artifactClass: number,
  rewrite: (bytes: Buffer) => Buffer,
): PackageArtifactInput[] {
  return artifacts.map((artifact) =>
    artifact.artifactClass === artifactClass
      ? { ...artifact, bytes: rewrite(artifact.bytes) }
      : artifact,
  );
}

/** Drop one artifact from a set. */
export function withoutArtifactClass(
  artifacts: readonly PackageArtifactInput[],
  artifactClass: number,
): PackageArtifactInput[] {
  return artifacts.filter((artifact) => artifact.artifactClass !== artifactClass);
}

/** Recompute a manifest over a set without writing it. Used by the pin negatives. */
export function manifestIdFor(options: BuildSignedManifestOptions): string {
  return buildSignedManifest(options).manifestId;
}

/**
 * THE DEFAULT PACKAGE EVERY TEST FILE BOOTSTRAPS AGAINST.
 *
 * `50 §3f` occasion 1 makes a verified bundle a precondition of every authority mechanism in
 * the kernel, so every test file needs one before it can exercise anything — exactly as a
 * deployment does. `tests/support/controlArtifactSetup.ts` is a vitest `setupFile` and runs
 * this once per worker.
 *
 * It writes to a FIXED directory rather than a fresh temporary one so that 145 test files do
 * not leave 145 packages behind, and it carries the repository's real artifact bytes signed
 * by the test-only roots. A test that needs a DIFFERENT package — a tampered one, an
 * unpinned one, a partially signed one — calls `buildControlArtifactFixture` directly and
 * gets its own directory, which is what keeps the adversarial fixtures from disturbing it.
 */
export const DEFAULT_PACKAGE_DIR = join(tmpdir(), 'acos-s1k-default-package');

let defaultFixture: ControlArtifactFixture | null = null;

export function defaultControlArtifactFixture(): ControlArtifactFixture {
  defaultFixture ??= buildControlArtifactFixture({ dir: DEFAULT_PACKAGE_DIR });
  return defaultFixture;
}

/**
 * Verify a fixture package WITHOUT publishing it.
 *
 * `50 §3f` separates verification from publication deliberately — "Publication of a new
 * verified bundle is ATOMIC" and a verifier that published as it went could publish early —
 * so a test that wants a bundle to hand to an authority consumer, while leaving the worker's
 * active bundle alone, verifies and keeps the capability to itself.
 */
export function verifyFixtureBundle(
  fixture: ControlArtifactFixture,
): VerifiedControlArtifactBundle {
  return verifyControlArtifactBundle(
    readDeploymentTrustConfiguration(fixture.controlEnv),
    filesystemArtifactPackage(fixture.controlRoot),
  );
}

/** One class-2 bundle document, as `50 §2e` declares its content. */
export interface Class2BundleDocument {
  artifact_id: string;
  artifact_version: string;
  schema: string;
  policies: { id: string; source: string }[];
  [extra: string]: unknown;
}

/** The repository's class-2 bundle, parsed for editing. */
export function repositoryClass2Document(): Class2BundleDocument {
  return JSON.parse(
    readFileSync(join(REPO_ARTIFACT_ROOT, 'class-02.policy-set.json'), 'utf8'),
  ) as Class2BundleDocument;
}

/**
 * Build and verify a package whose class-2 bundle has been edited, and RE-SIGNED.
 *
 * `50 §2e`'s O4 rule makes the Cedar bundle a signed artifact, so "stage a broken policy
 * directory" is no longer a thing a deployment can do: a broken policy set has to be an
 * artifact the owner signed. Re-signing the edit is what keeps these cases about the POLICY
 * LOADER — a signed set that does not parse, or does not match the expected ids — rather
 * than about the verifier, which has its own tests.
 */
export function stagedPolicyBundle(
  edit: (document: Class2BundleDocument) => Class2BundleDocument,
): VerifiedControlArtifactBundle {
  const document = edit(repositoryClass2Document());
  const bytes = Buffer.from(`${JSON.stringify(document, null, 2)}\n`, 'utf8');
  return verifyFixtureBundle(
    buildControlArtifactFixture({
      mutate: (artifacts) => withArtifactBytes(artifacts, 2, () => bytes),
    }),
  );
}
