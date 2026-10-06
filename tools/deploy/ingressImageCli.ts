import { readFileSync } from 'node:fs';

import { ingressImagePlan, inspectIngressImage, stageIngressImage } from './ingressImage.js';

/**
 * `npm run deploy:ingress-image -- plan | stage <compiledRoot> <outDir> | inspect <pathList> <appDir> [<exportTar>]`
 *
 * `stage` runs inside the Docker BUILD stage; `inspect` runs on the host against a BUILT image's
 * exported filesystem. Neither touches a network.
 */
async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  const cwd = process.cwd();
  if (command === 'plan' && rest.length === 0) {
    process.stdout.write(`${JSON.stringify(await ingressImagePlan(cwd), null, 2)}\n`);
    return 0;
  }
  if (command === 'stage' && rest.length === 2) {
    const plan = await stageIngressImage({ cwd, compiledRoot: rest[0]!, outDir: rest[1]! });
    process.stdout.write(
      `staged ${String(plan.applicationFiles.length)} application files and ` +
        `${String(plan.packageDirectories.length)} locked packages into ${rest[1]!}\n`,
    );
    return 0;
  }
  if (command === 'inspect' && (rest.length === 2 || rest.length === 3)) {
    const imagePaths = readFileSync(rest[0]!, 'utf8')
      .split(/\r?\n/)
      .filter((line) => line.length > 0);
    const findings = await inspectIngressImage({
      cwd,
      imagePaths,
      appDir: rest[1]!,
      // The raw `docker export` tarball: every committed DB password is searched for in ALL of it.
      ...(rest[2] === undefined ? {} : { imageExport: readFileSync(rest[2]) }),
    });
    for (const finding of findings) process.stdout.write(`FAIL ${finding.rule} ${finding.path}\n`);
    process.stdout.write(
      findings.length === 0 ? 'RESULT: PASS\n' : `RESULT: FAIL (${String(findings.length)})\n`,
    );
    return findings.length === 0 ? 0 : 1;
  }
  process.stderr.write(
    'usage: ingressImageCli.ts plan | stage <compiledRoot> <outDir> | inspect <pathList> <appDir> [<exportTar>]\n',
  );
  return 2;
}

void main(process.argv.slice(2)).then((code) => process.exit(code));
