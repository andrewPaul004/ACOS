import { readFileSync } from 'node:fs';

import {
  RELEASE_LAYOUT,
  parseReleaseInputDeclaration,
  readCandidateAndPackage,
  readReleaseMetadata,
  releaseBaseDir,
  writeReleaseCandidate,
} from './candidate.js';
import { compareReleases, renderComparison } from './compare.js';
import {
  approvePrimaryArtifacts,
  approveSecondFactorAndManifest,
  countersignPrimaryManifest,
} from './ceremony.js';
import { ReleaseRefusal } from './inventory.js';
import { writeReleaseReview } from './review.js';
import { signerFromKeyFile } from './signerKey.js';
import { verifyReleaseDirectory } from './verifyRelease.js';

/**
 * `acos-control-release` — THE OFFLINE RELEASE CEREMONY COMMAND LINE.
 *
 * =================================================================================
 * IT IS NOT REACHABLE FROM THE RUNTIME, AND THAT IS STRUCTURAL
 *
 * `§3` of the S1L mandate: the release tooling "must not be reachable from: application
 * bootstrap; control kernel; audit runtime; worker/model surfaces; Effect Gateway; web
 * routes." `tests/release/release-boundaries.test.ts` asserts that nothing under `src/`
 * imports anything under `tools/`, over the whole production tree, as a property of the
 * import graph rather than as a promise in a comment.
 *
 * =================================================================================
 * `--key-file` IS THE ONLY WAY A PRIVATE KEY ENTERS THIS PROCESS
 *
 * There is no `--key-hex`, no `--seed`, no `ACOS_*_PRIVATE_KEY` variable and no default
 * path. `§35`, `§36`. The test-only seed constructor exists in `signerKey.ts` and is not
 * wired to any flag here.
 *
 * Output is written with `process.stdout.write` rather than `console`, which keeps this file
 * inside the repository's `no-console` lint rule without an exemption.
 * =================================================================================
 */

const USAGE = `acos-control-release — the offline control-artifact release ceremony

  build            --input <release-input.json> --out <release dir>
  review           --release <release dir>
  approve-primary  --release <release dir> --key-file <primary private key>
  approve-second   --release <release dir> --key-file <second-factor private key>
  countersign      --release <release dir> --key-file <primary private key>
  verify           --release <release dir> --primary-key <64 hex> --second-factor-key <64 hex>
  compare          --before <release dir> --after <release dir>

The ceremony is THREE operations because 50 §3d puts both per-entry signatures inside the
manifest core, so the manifest identity does not exist until both custodians have approved
every artifact. No command takes two private keys, and none exists that would.
`;

function argument(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  if (index < 0) return undefined;
  return argv[index + 1];
}

function required(argv: readonly string[], name: string): string {
  const value = argument(argv, name);
  if (value === undefined || value.startsWith('--')) {
    throw new ReleaseRefusal('RELEASE_CLI_ARGUMENT_MISSING', `--${name} is required`);
  }
  return value;
}

function write(text: string): void {
  process.stdout.write(`${text}\n`);
}

function rawKey(hex: string, what: string): Buffer {
  if (!/^[0-9a-f]{64}$/.test(hex)) {
    throw new ReleaseRefusal(
      'RELEASE_KEY_MALFORMED',
      `${what} must be 64 lowercase hex characters (32 raw Ed25519 public-key bytes)`,
    );
  }
  return Buffer.from(hex, 'hex');
}

export function runReleaseCli(argv: readonly string[]): number {
  const command = argv[0];
  try {
    switch (command) {
      case 'build': {
        const inputPath = required(argv, 'input');
        const out = required(argv, 'out');
        const declaration = parseReleaseInputDeclaration(readFileSync(inputPath, 'utf8'));
        const written = writeReleaseCandidate(out, declaration, releaseBaseDir(inputPath));
        writeReleaseReview(out);
        write(`candidate_id ${written.candidate.candidateId}`);
        write(`entries      ${String(written.candidate.entryCount)}`);
        write(`review       ${RELEASE_LAYOUT.reviewFile}`);
        write('');
        write('NO SIGNATURE EXISTS YET. 50 §3e’s manifest_id is not computable until both');
        write('custodians have approved every artifact, because 50 §3d puts both per-entry');
        write('signatures inside the core.');
        return 0;
      }
      case 'review': {
        const releaseRoot = required(argv, 'release');
        write(writeReleaseReview(releaseRoot));
        return 0;
      }
      case 'approve-primary': {
        const releaseRoot = required(argv, 'release');
        const signer = signerFromKeyFile(required(argv, 'key-file'));
        const approval = approvePrimaryArtifacts(releaseRoot, signer);
        write(`PRIMARY artifact approval recorded for candidate ${approval.candidateId}`);
        write(`signer key_id ${approval.signerKeyId}`);
        write('Hand the release to the SECOND custodian. Do not hand over the key.');
        return 0;
      }
      case 'approve-second': {
        const releaseRoot = required(argv, 'release');
        const signer = signerFromKeyFile(required(argv, 'key-file'));
        const approval = approveSecondFactorAndManifest(releaseRoot, signer);
        write(`SECOND_FACTOR approval recorded for candidate ${approval.candidateId}`);
        write(`signer key_id ${approval.signerKeyId}`);
        write(`manifest_id   ${approval.manifestId}`);
        write('Return the release to the PRIMARY custodian for the manifest countersignature.');
        return 0;
      }
      case 'countersign': {
        const releaseRoot = required(argv, 'release');
        const signer = signerFromKeyFile(required(argv, 'key-file'));
        const completed = countersignPrimaryManifest(releaseRoot, signer);
        writeReleaseReview(releaseRoot, { manifestId: completed.manifestId });
        write(`RELEASE COMPLETE — release_channel ${completed.releaseChannel}`);
        write(`manifest_id ${completed.manifestId}`);
        write(`package     ${completed.packageRoot}`);
        write(`deployment  ${RELEASE_LAYOUT.deploymentFile}`);
        write('');
        write('Treat the release directory as IMMUTABLE from here. Deploying it requires');
        write('setting EXPECTED_ACTIVE_MANIFEST_ID to the manifest_id above on EACH PLANE’s');
        write('own trusted deployment configuration (50 §3e).');
        return 0;
      }
      case 'verify': {
        const releaseRoot = required(argv, 'release');
        const report = verifyReleaseDirectory(
          releaseRoot,
          rawKey(required(argv, 'primary-key'), 'the primary public key'),
          rawKey(required(argv, 'second-factor-key'), 'the second-factor public key'),
        );
        if (!report.verified) {
          for (const finding of report.findings) write(`REFUSED ${finding.code}: ${finding.detail}`);
          return 1;
        }
        write(`VERIFIED manifest_id ${String(report.manifestId)}`);
        for (const entry of report.entries) {
          write(
            `  class ${String(entry.artifactClass).padStart(2)} ${entry.artifactId.padEnd(38)} ` +
              `${entry.contentHash} (${String(entry.byteLength)} bytes)`,
          );
        }
        write('');
        write('This offline check DOES NOT replace 50 §3f occasion 1. A plane becomes READY');
        write('only by running the kernel’s own bootstrap ceremony against its own pin.');
        return 0;
      }
      case 'compare': {
        write(renderComparison(compareReleases(required(argv, 'before'), required(argv, 'after'))));
        return 0;
      }
      case 'deployment': {
        const releaseRoot = required(argv, 'release');
        const { candidate } = readCandidateAndPackage(releaseRoot);
        const metadata = readReleaseMetadata(releaseRoot, candidate);
        write(`release_channel ${metadata.releaseChannel}`);
        write(`OWNER_ARTIFACT_ROOT_KEY              ${metadata.primaryPublicKeyHex}`);
        write(`OWNER_ARTIFACT_SECOND_FACTOR_KEY     ${metadata.secondFactorPublicKeyHex}`);
        write('EXPECTED_ACTIVE_MANIFEST_ID          see deployment.json (after countersign)');
        return 0;
      }
      default:
        write(USAGE);
        return command === undefined || command === '--help' ? 0 : 2;
    }
  } catch (error) {
    if (error instanceof ReleaseRefusal) {
      write(`REFUSED ${error.message}`);
      return 1;
    }
    throw error;
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && process.argv[1].replace(/\\/g, '/').endsWith('control-release/cli.ts');
if (invokedDirectly) {
  process.exitCode = runReleaseCli(process.argv.slice(2));
}
