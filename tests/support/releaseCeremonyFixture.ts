import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  RELEASE_LAYOUT,
  releaseJson,
  writeReleaseCandidate,
  type ReleaseInputArtifact,
  type ReleaseInputDeclaration,
  type WrittenCandidate,
} from '../../tools/control-release/candidate.js';
import {
  approvePrimaryArtifacts,
  approveSecondFactorAndManifest,
  countersignPrimaryManifest,
  type CompletedRelease,
} from '../../tools/control-release/ceremony.js';
import { writeReleaseReview } from '../../tools/control-release/review.js';
import { testOnlySignerFromSeed, type SignerIdentity } from '../../tools/control-release/signerKey.js';
import {
  CLASS_20_ACCEPTED_CONTENT_HASH,
  REPO_ARTIFACT_ROOT,
  TEST_ONLY_AUDIT_SIGNING_SEED,
  TEST_ONLY_PRIMARY_SEED,
  TEST_ONLY_SECOND_FACTOR_SEED,
  TEST_ONLY_THIRD_PARTY_SEED,
  class24ArtifactBytes,
  testOnlyKeyPair,
} from './controlArtifactFixture.js';

/**
 * TEST-ONLY RELEASE CEREMONIES, DRIVEN THROUGH THE REAL OFFLINE TOOL.
 *
 * =================================================================================
 * `§24` OF THE S1L MANDATE: NO MOCK-GENERATED UNSIGNED SHORTCUT
 *
 *   "No mock-generated unsigned shortcut. **Use the real offline signing tool + real runtime
 *    verifier.**"
 *
 * Every package this module produces is built by `tools/control-release/`, signed through its
 * three-operation ceremony, and verified by `src/kernel/controlArtifacts/verifier.ts` and
 * `src/audit/controlArtifacts/auditPlaneVerifier.ts`. Nothing in this file forms a signature
 * message, computes a manifest identity, or writes a `manifest.json`.
 *
 * =================================================================================
 * THE KEYS ARE THE S1K TEST-ONLY SEEDS, AND EVERY RELEASE IS LABELLED `TEST_ONLY`
 *
 * `50 §3a`: "**Tests may use dedicated keys that are unambiguously test-only and are never a
 * production trust root.**" `§47` of the mandate: "Do NOT check a release signed with test
 * keys into a path that could be mistaken for a production release. **Test fixtures must
 * clearly identify `TEST ONLY`.**"
 *
 * So every declaration this module produces carries `release_channel: "TEST_ONLY"`, every
 * report it renders carries the TEST ONLY banner, and every release it writes lives in a
 * temporary directory that is never committed. The DECISIVE separation is not the label: it
 * is that these keys' `key_id`s are different from any production root's, so a package
 * signed here can never satisfy a deployment pinned to a production manifest.
 * =================================================================================
 */

/** `50 §6`'s six members, with the repository's deployed file names. */
export const RELEASE_ARTIFACT_SPECS: readonly {
  readonly artifactClass: number;
  readonly artifactId: string;
  readonly artifactVersion: string;
  readonly fileName: string;
}[] = Object.freeze([
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
    // v1.3.7, `50 §2g` (`S1N-C1`). The signed owner of ADR-024's option-B trigger operand,
    // and the seventh member of `50 §6`'s pre-live inventory.
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
  {
    // v1.3.8, `50 §2h` (`S1P-W1`). The provider-evidence trust record, and the eighth member
    // of `50 §6`'s pre-live inventory.
    artifactClass: 28,
    artifactId: 'acos.control.provider_evidence_trust',
    artifactVersion: 'acos.provider_evidence_trust.2026-10-03',
    fileName: 'class-28.provider-evidence-trust.json',
  },
]);

export const TEST_ONLY_PRIMARY = (): SignerIdentity =>
  testOnlySignerFromSeed(TEST_ONLY_PRIMARY_SEED);
export const TEST_ONLY_SECOND_FACTOR = (): SignerIdentity =>
  testOnlySignerFromSeed(TEST_ONLY_SECOND_FACTOR_SEED);
export const TEST_ONLY_ATTACKER = (): SignerIdentity =>
  testOnlySignerFromSeed(TEST_ONLY_THIRD_PARTY_SEED);

export function scratchDirectory(prefix = 'acos-s1l-'): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export interface ReleaseSourceOverride {
  readonly artifactClass: number;
  readonly bytes: Buffer;
}

export interface StagedInputs {
  readonly baseDir: string;
  readonly declarationPath: string;
  readonly declaration: ReleaseInputDeclaration;
}

/**
 * Stage a release INPUT set on disk: the six artifact source files plus the declaration.
 *
 * The class-24 artifact is generated, exactly as `tests/support/controlArtifactFixture.ts`
 * generates it, because `50 §2` row 24's content is the audit host's published public key — a
 * value a deployment produces rather than a value a repository carries.
 */
export function stageReleaseInputs(options: {
  readonly dir?: string;
  readonly manifestEpoch?: string;
  readonly primary?: SignerIdentity;
  readonly secondFactor?: SignerIdentity;
  readonly overrides?: readonly ReleaseSourceOverride[];
  readonly omitClasses?: readonly number[];
  readonly extraArtifacts?: readonly ReleaseInputArtifact[];
  readonly note?: string;
  readonly releaseChannel?: 'PRODUCTION' | 'TEST_ONLY';
  readonly auditPublicKey?: Buffer;
} = {}): StagedInputs {
  const baseDir = options.dir ?? scratchDirectory();
  const sourceDir = join(baseDir, 'sources');
  mkdirSync(sourceDir, { recursive: true });

  const primary = options.primary ?? TEST_ONLY_PRIMARY();
  const secondFactor = options.secondFactor ?? TEST_ONLY_SECOND_FACTOR();
  const overrides = new Map(
    (options.overrides ?? []).map((override) => [override.artifactClass, override.bytes] as const),
  );
  const omit = new Set(options.omitClasses ?? []);
  const auditPublicKey =
    options.auditPublicKey ?? testOnlyKeyPair(TEST_ONLY_AUDIT_SIGNING_SEED).rawPublicKey;

  const artifacts: ReleaseInputArtifact[] = [];
  for (const spec of RELEASE_ARTIFACT_SPECS) {
    if (omit.has(spec.artifactClass)) continue;
    const bytes =
      overrides.get(spec.artifactClass) ??
      (spec.artifactClass === 24
        ? class24ArtifactBytes(auditPublicKey)
        : readFileSync(join(REPO_ARTIFACT_ROOT, spec.fileName)));
    writeFileSync(join(sourceDir, spec.fileName), bytes);
    artifacts.push({
      artifactClass: spec.artifactClass,
      artifactId: spec.artifactId,
      artifactVersion: spec.artifactVersion,
      packageFileName: spec.fileName,
      sourcePath: join('sources', spec.fileName),
    });
  }
  for (const extra of options.extraArtifacts ?? []) artifacts.push(extra);

  const declaration: ReleaseInputDeclaration = {
    manifestEpoch: options.manifestEpoch ?? '1',
    releaseChannel: options.releaseChannel ?? 'TEST_ONLY',
    primaryPublicKeyHex: primary.rawPublicKey.toString('hex'),
    secondFactorPublicKeyHex: secondFactor.rawPublicKey.toString('hex'),
    artifacts,
    ...(options.note === undefined ? {} : { note: options.note }),
  };

  const declarationPath = join(baseDir, 'release-input.json');
  writeFileSync(
    declarationPath,
    releaseJson({
      release_input_version: 'ACOS-CONTROL-RELEASE-INPUT-V1',
      manifest_epoch: declaration.manifestEpoch,
      release_channel: declaration.releaseChannel,
      primary_public_key: declaration.primaryPublicKeyHex,
      second_factor_public_key: declaration.secondFactorPublicKeyHex,
      ...(declaration.note === undefined ? {} : { note: declaration.note }),
      artifacts: declaration.artifacts.map((artifact) => ({
        artifact_class: artifact.artifactClass,
        artifact_id: artifact.artifactId,
        artifact_version: artifact.artifactVersion,
        package_file_name: artifact.packageFileName,
        source_path: artifact.sourcePath,
      })),
    }),
    'utf8',
  );

  return { baseDir, declarationPath, declaration };
}

export interface BuiltReleaseFixture extends StagedInputs {
  readonly releaseRoot: string;
  readonly written: WrittenCandidate;
}

export function buildCandidateFixture(
  options: Parameters<typeof stageReleaseInputs>[0] = {},
): BuiltReleaseFixture {
  const staged = stageReleaseInputs(options);
  const releaseRoot = join(staged.baseDir, 'release');
  const written = writeReleaseCandidate(releaseRoot, staged.declaration, staged.baseDir);
  // `build` renders the review report before any signature exists; the fixture does the same,
  // so what the tests read is what an operator would have reviewed.
  writeReleaseReview(releaseRoot);
  return { ...staged, releaseRoot, written };
}

export interface CompletedReleaseFixture extends BuiltReleaseFixture {
  readonly completed: CompletedRelease;
  readonly primary: SignerIdentity;
  readonly secondFactor: SignerIdentity;
  /** A deployable copy of the package, per plane. */
  readonly controlPackageRoot: string;
  readonly auditPackageRoot: string;
  readonly controlEnv: Readonly<Record<string, string>>;
  readonly auditEnv: Readonly<Record<string, string>>;
}

/** Copy a completed package to a plane's own directory. A deployment step, not a signing one. */
export function deployPackage(packageRoot: string, destination: string): string {
  mkdirSync(destination, { recursive: true });
  for (const spec of RELEASE_ARTIFACT_SPECS) {
    try {
      writeFileSync(join(destination, spec.fileName), readFileSync(join(packageRoot, spec.fileName)));
    } catch {
      // A class omitted from this release simply has no file to copy.
    }
  }
  writeFileSync(
    join(destination, 'manifest.json'),
    readFileSync(join(packageRoot, 'manifest.json')),
  );
  return destination;
}

/** Run the WHOLE three-operation ceremony with the test-only keys, then stage both planes. */
export function completeReleaseFixture(
  options: Parameters<typeof stageReleaseInputs>[0] = {},
): CompletedReleaseFixture {
  const primary = options.primary ?? TEST_ONLY_PRIMARY();
  const secondFactor = options.secondFactor ?? TEST_ONLY_SECOND_FACTOR();
  const built = buildCandidateFixture({ ...options, primary, secondFactor });

  approvePrimaryArtifacts(built.releaseRoot, primary);
  approveSecondFactorAndManifest(built.releaseRoot, secondFactor);
  const completed = countersignPrimaryManifest(built.releaseRoot, primary);
  // And `countersign` re-renders it with the manifest identity now that one exists.
  writeReleaseReview(built.releaseRoot, { manifestId: completed.manifestId });

  const controlPackageRoot = deployPackage(
    completed.packageRoot,
    join(built.baseDir, 'deployed-control'),
  );
  const auditPackageRoot = deployPackage(
    completed.packageRoot,
    join(built.baseDir, 'deployed-audit'),
  );

  return {
    ...built,
    completed,
    primary,
    secondFactor,
    controlPackageRoot,
    auditPackageRoot,
    controlEnv: controlPlaneEnv(completed, controlPackageRoot),
    auditEnv: auditPlaneEnv(completed, auditPackageRoot),
  };
}

/**
 * The control plane's OWN deployment trust configuration, from the PUBLIC release outputs.
 *
 * `§23`: "deployment must configure each plane through its own trust boundary." The two
 * helpers below build the two configurations SEPARATELY and neither reads the other, so a
 * test can point one plane at a different pin or a different package and the other plane's
 * configuration does not move with it.
 */
export function controlPlaneEnv(
  completed: Pick<CompletedRelease, 'primaryPublicKeyHex' | 'secondFactorPublicKeyHex' | 'manifestId'>,
  packageRoot: string,
  pinOverride?: string,
): Readonly<Record<string, string>> {
  return Object.freeze({
    ACOS_OWNER_ARTIFACT_ROOT_KEY: completed.primaryPublicKeyHex,
    ACOS_OWNER_ARTIFACT_SECOND_FACTOR_KEY: completed.secondFactorPublicKeyHex,
    ACOS_EXPECTED_ACTIVE_MANIFEST_ID: pinOverride ?? completed.manifestId,
    ACOS_CONTROL_ARTIFACT_ROOT: packageRoot,
  });
}

export function auditPlaneEnv(
  completed: Pick<CompletedRelease, 'primaryPublicKeyHex' | 'secondFactorPublicKeyHex' | 'manifestId'>,
  packageRoot: string,
  pinOverride?: string,
): Readonly<Record<string, string>> {
  return Object.freeze({
    ACOS_AUDIT_OWNER_ARTIFACT_ROOT_KEY: completed.primaryPublicKeyHex,
    ACOS_AUDIT_OWNER_ARTIFACT_SECOND_FACTOR_KEY: completed.secondFactorPublicKeyHex,
    ACOS_AUDIT_EXPECTED_ACTIVE_MANIFEST_ID: pinOverride ?? completed.manifestId,
    ACOS_AUDIT_CONTROL_ARTIFACT_ROOT: packageRoot,
  });
}

/** Both planes' variables in one map, for the pre-live gate, which reads a single source. */
export function bothPlanesEnv(
  control: Readonly<Record<string, string>>,
  audit: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  return Object.freeze({ ...control, ...audit });
}

export { CLASS_20_ACCEPTED_CONTENT_HASH, RELEASE_LAYOUT, REPO_ARTIFACT_ROOT };
