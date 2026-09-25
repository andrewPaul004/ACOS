import { renderPerimeterReport, scanPerimeter } from './perimeterScan.js';

/**
 * `npm run verify:perimeter` — `48 §4` item 2's BUILD GATE.
 *
 * Exits non-zero on an unannotated vendor-call site. `§17`: "Unknown/unannotated call:
 * **BUILD FAILURE.**"
 *
 * The same scan also runs inside `npm run verify` as
 * `tests/integration/integration/perimeter-enumeration.test.ts`, so the gate cannot be
 * passed by not running this command. `48 §7` question 4 is why both exist: "Has the CI
 * check been disabled, weakened, or worked around for any build? **Question 4 is the one
 * that matters most**, and it is the one a reviewer is least likely to ask."
 */
async function main(): Promise<void> {
  const report = await scanPerimeter();
  process.stdout.write(`${renderPerimeterReport(report)}\n`);
  process.exit(report.pass ? 0 : 1);
}

void main();
