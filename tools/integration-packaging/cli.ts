import {
  computeAllClosures,
  evaluateSeparation,
  renderPackagingManifest,
} from './packagingManifest.js';

/**
 * `npm run verify:packaging` — the separation half of `§46`.
 *
 * Exits non-zero when any obligation fails. The same evaluation runs inside `npm run verify`
 * so the gate cannot be passed by not running this command.
 */
async function main(): Promise<void> {
  const closures = await computeAllClosures();
  const findings = evaluateSeparation(closures);
  process.stdout.write(`${renderPackagingManifest(closures, findings)}\n`);
  process.exit(findings.every((finding) => finding.satisfied) ? 0 : 1);
}

void main();
