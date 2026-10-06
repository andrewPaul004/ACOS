import { readFileSync, writeFileSync } from 'node:fs';

import {
  operatorCommands,
  operatorSequenceProblems,
  operatorSteps,
  renderBindingProbeCommands,
  renderContainerApp,
  type ContainerAppParams,
} from './containerApp.js';

/**
 * `npm run deploy:render-ingress -- <params.json> <rendered-out.json>`
 *
 * Renders and validates the Container App definition, writes it, and PRINTS the owner's command
 * sequence and the public binding probes. It executes nothing and contacts nothing.
 */
function main(argv: readonly string[]): number {
  if (argv.length !== 2) {
    process.stderr.write('usage: containerAppCli.ts <params.json> <rendered-out.json>\n');
    return 2;
  }
  const params = JSON.parse(readFileSync(argv[0]!, 'utf8')) as ContainerAppParams;
  const outcome = renderContainerApp(params);
  if (!outcome.ok) {
    for (const problem of outcome.problems) process.stderr.write(`REFUSED: ${problem}\n`);
    return 1;
  }
  // The printed sequence is checked against the ordering rule (lock + verified lock before any
  // deployment reference) before anything is written.
  const sequence = operatorSequenceProblems(operatorSteps(params, argv[1]!));
  if (sequence.length > 0) {
    for (const problem of sequence) process.stderr.write(`REFUSED (operator sequence): ${problem}\n`);
    return 1;
  }
  writeFileSync(argv[1]!, `${JSON.stringify(outcome.rendered, null, 2)}\n`);
  process.stdout.write(`rendered ${argv[1]!} for ${outcome.reservedIngressIdentity}\n\n`);
  process.stdout.write('# NOTHING BELOW HAS BEEN RUN. Review, then run by hand.\n');
  for (const line of operatorCommands(params, argv[1]!)) process.stdout.write(`${line}\n`);
  process.stdout.write('\n# --- Phase A binding probes (after the app is READY; before any webhook delivers)\n');
  for (const line of renderBindingProbeCommands(outcome.reservedIngressIdentity)) {
    process.stdout.write(`${line}\n`);
  }
  return 0;
}

process.exit(main(process.argv.slice(2)));
