import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  INGRESS_PERMITTED_PACKAGES,
  INGRESS_RUNTIME_NAME,
  computeAllClosures,
} from '../../tools/integration-packaging/packagingManifest.js';
import {
  CONTROL_ARTIFACT_MOUNT,
  IMAGE_ENTRY_POINT,
  baseImagePinProblems,
  knownCommittedDatabasePasswords,
  IMAGE_LISTEN_PORT,
  ingressImagePlan,
  inspectIngressImage,
  lockfilePackageClosure,
  stageIngressImage,
} from '../../tools/deploy/ingressImage.js';

/**
 * S1P-WD — THE PROVIDER-EVIDENCE INGRESS IMAGE CONTAINS THE INGRESS AND NOTHING ELSE.
 *
 * The image's application files are DERIVED from the same import closure the packaging gate
 * evaluates (`48 §8` "MUST NOT hold"), so these tests assert three things: the derivation is
 * that closure; a staged image built from it passes the image inspection; and the inspection
 * itself FAILS on each prohibited thing that could be smuggled in. The Dockerfile and the build
 * context are asserted statically. The real `docker build` and the inspection of the built image
 * are recorded in the S1P-WD review (they need a container engine, which `npm run verify` does
 * not assume).
 */

const DOCKERFILE = readFileSync(join('deploy', 'provider-evidence-ingress', 'Dockerfile'), 'utf8');
const DOCKERIGNORE = readFileSync('.dockerignore', 'utf8');

function filesUnder(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(relative(root, full).split(sep).join('/'));
    }
  };
  walk(root);
  return out.sort();
}

describe('the image contents are the ingress closure, derived — never hand-listed', () => {
  it('the application modules ARE the packaging gate’s ingress closure', async () => {
    const plan = await ingressImagePlan();
    const closure = (await computeAllClosures()).find((runtime) => runtime.name === INGRESS_RUNTIME_NAME)!;
    expect(plan.sourceModules).toEqual(closure.modules);
    expect(plan.applicationFiles).toEqual(closure.modules.map((module) => module.replace(/\.ts$/, '.js')));
    expect(plan.importedPackages).toEqual([...INGRESS_PERMITTED_PACKAGES]);
    expect(plan.sourceModules).toContain('src/audit/providerEvidence/ingressMain.ts');
  });

  it('the DEVELOPMENT credential module is not in it; the image-safe ingress pool is', async () => {
    const plan = await ingressImagePlan();
    expect(plan.sourceModules).not.toContain('src/audit/db/auditPool.ts');
    expect(plan.applicationFiles).not.toContain('src/audit/db/auditPool.js');
    expect(plan.sourceModules).toContain('src/audit/providerEvidence/evidenceIngressPool.ts');
  });

  it('every committed database password literal is DERIVED from the repository, and none is in any closure module', async () => {
    const passwords = knownCommittedDatabasePasswords();
    for (const known of ['acos_audit_ingress_dev', 'acos_audit_eval_dev', 'acos_audit_repl_dev', 'acos_audit_signal_dev', 'acos_local_dev']) {
      expect(passwords).toContain(known);
    }
    for (const module of (await ingressImagePlan()).sourceModules) {
      const source = readFileSync(module, 'utf8');
      for (const password of passwords) expect(source, `${module} carries a committed password`).not.toContain(password);
      expect(source, module).not.toMatch(/\.password\s*=(?!=)|\basRole\s*\(|auditPool\.js/);
    }
  });

  it('no integration, provider-read, credential, validation or test module is in it', async () => {
    const plan = await ingressImagePlan();
    for (const module of plan.sourceModules) {
      expect(module, module).toMatch(/^src\/(audit\/(providerEvidence|controlArtifacts|db)|db)\//);
      expect(module).not.toMatch(/integration|secretSource|keyVault|audit\/provider\/|kernel|validation|tests/);
    }
  });

  it('the package trees are exactly pg’s REQUIRED locked dependencies — no Azure, no Cedar, no optional, no dev', async () => {
    const plan = await ingressImagePlan();
    const names = plan.packageDirectories.map((entry) => entry.path);
    expect(names).toContain('node_modules/pg');
    for (const name of names) {
      expect(name).not.toMatch(/@azure|@cedar-policy|pg-cloudflare|pg-native|tsx|typescript|esbuild|vitest/);
    }
    const lock = JSON.parse(readFileSync('package-lock.json', 'utf8')) as {
      packages: Record<string, { version?: string }>;
    };
    for (const entry of plan.packageDirectories) expect(entry.version).toBe(lock.packages[entry.path]?.version);
  });

  it('a DEV dependency reaching the closure is refused, and optional dependencies are not followed', () => {
    expect(() =>
      lockfilePackageClosure(
        { lockfileVersion: 3, packages: { 'node_modules/a': { version: '1.0.0', dependencies: { b: '^1' } }, 'node_modules/b': { version: '1.0.0', dev: true } } },
        ['a'],
      ),
    ).toThrow(/DEV dependency/);
    expect(
      lockfilePackageClosure(
        { lockfileVersion: 3, packages: { 'node_modules/a': { version: '1.0.0' }, 'node_modules/opt': { version: '1.0.0', optional: true } } },
        ['a'],
      ).map((entry) => entry.path),
    ).toEqual(['node_modules/a']);
  });
});

describe('a STAGED image passes inspection, and inspection fails on every prohibited addition', () => {
  let workspace: string;
  let appDir: string;
  let compiled: string;
  /** A plausible distroless filesystem around `app/`. */
  const BASE_PATHS = ['etc/passwd', 'etc/ssl/certs/ca-certificates.crt', 'nodejs/bin/node', 'usr/share/doc/libc6/copyright'];

  beforeAll(async () => {
    workspace = mkdtempSync(join(tmpdir(), 'acos-s1p-wd-image-'));
    compiled = join(workspace, 'compiled');
    execFileSync(process.execPath, [join('node_modules', 'typescript', 'bin', 'tsc'), '-p', join('deploy', 'provider-evidence-ingress', 'tsconfig.build.json'), '--outDir', compiled], { stdio: 'pipe' });
    appDir = join(workspace, 'app');
    await stageIngressImage({ cwd: process.cwd(), compiledRoot: compiled, outDir: appDir });
  }, 120_000);

  afterAll(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  const imagePaths = (): string[] => [...BASE_PATHS, ...filesUnder(appDir).map((file) => `app/${file}`)];

  it('tsc emits exactly the closure, and the staged image inspects clean', async () => {
    expect(filesUnder(compiled)).toEqual((await ingressImagePlan()).applicationFiles);
    expect(await inspectIngressImage({ cwd: process.cwd(), imagePaths: imagePaths(), appDir })).toEqual([]);
    expect(filesUnder(appDir)).toContain(IMAGE_ENTRY_POINT);
    expect(filesUnder(appDir).filter((file) => file.startsWith('src/') && file.endsWith('.ts'))).toEqual([]);
  });

  it('the staged application code carries no prohibited marker', () => {
    for (const file of filesUnder(appDir).filter((name) => name.startsWith('src/'))) {
      const text = readFileSync(join(appDir, file), 'utf8');
      expect(text, file).not.toMatch(/TEST_ONLY|BEGIN [A-Z ]*PRIVATE KEY|@azure\/|api\.sendgrid\.com|\/v3\/mail\/send|secretSource|ACOS_S1P_INTEGRATION_LOCATOR/);
    }
  });

  for (const [rule, mutate] of [
    ['TESTS', (paths: string[]) => paths.push('app/tests/support/providerEvidenceFixture.ts')],
    ['TEST_DOUBLES', (paths: string[]) => paths.push('opt/tests/sendgrid-doubles/audit/reader.ts')],
    ['VALIDATION_PACKAGE', (paths: string[]) => paths.push('app/validation/sendgrid/integration/keyVault.js')],
    ['AZURE_SDK', (paths: string[]) => paths.push('app/node_modules/@azure/identity/package.json')],
    ['ENV_FILE', (paths: string[]) => paths.push('app/.env')],
    ['BAKED_CONTROL_ARTIFACTS', (paths: string[]) => paths.push('etc/acos/control-artifacts/manifest.json')],
    ['GIT', (paths: string[]) => paths.push('app/.git/config')],
  ] as const) {
    it(`a ${rule} path anywhere in the image FAILS inspection`, async () => {
      const paths = imagePaths();
      mutate(paths);
      const findings = await inspectIngressImage({ cwd: process.cwd(), imagePaths: paths, appDir });
      expect(findings.map((finding) => finding.rule)).toContain(rule);
    });
  }

  // Assembled at runtime so no complete SendGrid-shaped literal exists in the source tree (secret
  // scanners, GitHub push protection). The joined value still matches SENDGRID_API_KEY_SHAPE, and
  // the test below proves the detector fires on it.
  const sendgridShapedFixture = ['SG', 'abcdefghijklmnopqrstuv', 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG'].join('.');

  for (const [rule, file, content] of [
    ['PRIVATE_KEY_PEM', 'src/audit/providerEvidence/receiver.js', '\n-----BEGIN PRIVATE KEY-----\nMC4CAQ\n'],
    ['TEST_ONLY_MATERIAL', 'src/db/pool.js', '\nconst k = "TEST_ONLY_WEBHOOK_SIGNER";\n'],
    ['SENDGRID_API_KEY_SHAPE', 'src/db/pool.js', `\nconst k = "${sendgridShapedFixture}";\n`],
    ['SECRET_SOURCE_MODULE', 'src/db/pool.js', '\nimport "./secretSource.js";\n'],
    ['INTEGRATION_LOCATOR', 'src/db/pool.js', '\nprocess.env.ACOS_S1P_INTEGRATION_LOCATOR;\n'],
  ] as const) {
    it(`${rule} content in an application file FAILS inspection`, async () => {
      const path = join(appDir, file);
      const original = readFileSync(path);
      try {
        writeFileSync(path, Buffer.concat([original, Buffer.from(content)]));
        const findings = await inspectIngressImage({ cwd: process.cwd(), imagePaths: imagePaths(), appDir });
        expect(findings.map((finding) => finding.rule)).toContain(rule);
        // And the manifest hash no longer matches: the file is not the one staged.
        expect(findings.map((finding) => finding.rule)).toContain('HASH_MISMATCH');
      } finally {
        writeFileSync(path, original);
      }
    });
  }

  it('an EXTRA module or package directory FAILS inspection', async () => {
    const extra = join(appDir, 'src', 'kernel', 'gateway', 'effectGateway.js');
    mkdirSync(join(appDir, 'src', 'kernel', 'gateway'), { recursive: true });
    writeFileSync(extra, 'export {};\n');
    const extraPackage = join(appDir, 'node_modules', '@cedar-policy', 'cedar-wasm', 'package.json');
    mkdirSync(join(appDir, 'node_modules', '@cedar-policy', 'cedar-wasm'), { recursive: true });
    writeFileSync(extraPackage, '{}\n');
    try {
      const rules = (await inspectIngressImage({ cwd: process.cwd(), imagePaths: imagePaths(), appDir })).map((finding) => finding.rule);
      expect(rules).toContain('UNLISTED_FILE');
      expect(rules).toContain('APPLICATION_FILES_NOT_THE_CLOSURE');
      expect(rules).toContain('PACKAGE_NOT_IN_LOCKED_CLOSURE');
    } finally {
      rmSync(join(appDir, 'src', 'kernel'), { recursive: true, force: true });
      rmSync(join(appDir, 'node_modules', '@cedar-policy'), { recursive: true, force: true });
    }
  });

  for (const [rule, file, content] of [
    ['DB_PASSWORD_LITERAL', 'src/db/pool.js', '\nconst p = "acos_audit_ingress_dev";\n'],
    ['DB_PASSWORD_LITERAL', 'node_modules/pg/package.json', ' acos_local_dev '],
    ['CREDENTIAL_DERIVATION', 'src/db/pool.js', '\nparsed.password = x;\n'],
    ['DEV_CREDENTIAL_MODULE_IMPORT', 'src/audit/providerEvidence/ingressMain.js', '\nimport "../db/auditPool.js";\n'],
  ] as const) {
    it(`${rule} (${file}) FAILS inspection`, async () => {
      const path = join(appDir, file);
      const original = readFileSync(path);
      try {
        writeFileSync(path, Buffer.concat([original, Buffer.from(content)]));
        const rules = (await inspectIngressImage({ cwd: process.cwd(), imagePaths: imagePaths(), appDir })).map((finding) => finding.rule);
        expect(rules).toContain(rule);
      } finally {
        writeFileSync(path, original);
      }
    });
  }

  it('the DEVELOPMENT credential module staged anywhere in the image FAILS inspection', async () => {
    const paths = [...imagePaths(), 'app/src/audit/db/auditPool.js'];
    const rules = (await inspectIngressImage({ cwd: process.cwd(), imagePaths: paths, appDir })).map((finding) => finding.rule);
    expect(rules).toContain('DEV_CREDENTIAL_MODULE');
  });

  it('a committed password ANYWHERE in the exported image bytes FAILS; a clean export passes', async () => {
    const clean = Buffer.from('distroless base bytes /nodejs/bin/node etc/passwd', 'latin1');
    expect(await inspectIngressImage({ cwd: process.cwd(), imagePaths: imagePaths(), appDir, imageExport: clean })).toEqual([]);
    for (const password of knownCommittedDatabasePasswords()) {
      const dirty = Buffer.concat([clean, Buffer.from(`\u0000usr/lib/x\u0000${password}\u0000`, 'latin1')]);
      const rules = (await inspectIngressImage({ cwd: process.cwd(), imagePaths: imagePaths(), appDir, imageExport: dirty })).map((finding) => finding.rule);
      expect(rules, password).toContain('DB_PASSWORD_LITERAL_IN_IMAGE');
    }
  });

  it('a MISSING closure file FAILS inspection', async () => {
    const path = join(appDir, 'src', 'audit', 'providerEvidence', 'class28.js');
    const original = readFileSync(path);
    rmSync(path);
    try {
      const rules = (await inspectIngressImage({ cwd: process.cwd(), imagePaths: imagePaths(), appDir })).map((finding) => finding.rule);
      expect(rules).toContain('MISSING_FILE');
    } finally {
      writeFileSync(path, original);
    }
  });
});

describe('the Dockerfile runs the ingress and nothing else, as non-root, from a pinned base', () => {
  const stages = DOCKERFILE.split(/^FROM /m).slice(1);
  const runtime = stages.at(-1)!;

  it('two stages; the runtime stage copies ONLY the staged directory from the build stage', () => {
    expect(stages).toHaveLength(2);
    const copies = runtime.split('\n').filter((line) => /^(COPY|ADD)\b/.test(line));
    expect(copies).toEqual(['COPY --from=build --chown=0:0 /stage/ /app/']);
    expect(runtime).not.toMatch(/^RUN\b/m);
    expect(DOCKERFILE).not.toMatch(/^ADD\b/m);
  });

  it('the ENTRYPOINT is the compiled ingress entry point and there is no CMD override', () => {
    const entry = runtime.split('\n').filter((line) => line.startsWith('ENTRYPOINT'));
    expect(entry).toEqual([`ENTRYPOINT ["/nodejs/bin/node", "/app/${IMAGE_ENTRY_POINT}"]`]);
    expect(runtime).not.toMatch(/^CMD\b/m);
  });

  it('runs as a numeric NON-ROOT user, exposes exactly the listen port, and sets no secret', () => {
    expect(runtime).toMatch(/^USER 65532:65532$/m);
    expect(runtime).not.toMatch(/^USER (0|root)\b/m);
    expect(runtime.match(/^EXPOSE .*$/gm)).toEqual([`EXPOSE ${String(IMAGE_LISTEN_PORT)}`]);
    const envLines = DOCKERFILE.split('\n').filter((line) => /^(ENV|ARG)\b/.test(line) || /^\s+NPM_CONFIG/.test(line));
    for (const line of envLines) {
      expect(line).not.toMatch(/SENDGRID|SG\.|PASSWORD|SECRET|PG_URL|KEY_VAULT|AZURE|LOCATOR|PRIVATE|TOKEN/i);
    }
  });

  it('BOTH base images are Node 24 LTS / Debian 13, DIGEST-PINNED ARG defaults (the reviewed digests), used by both FROM lines', () => {
    expect(baseImagePinProblems(DOCKERFILE)).toEqual([]);
    expect(DOCKERFILE).toMatch(
      /^ARG BUILD_IMAGE=node:24\.21\.0-trixie-slim@sha256:8ec5d7557396cfe32d21c3f9c13072355ceab22b584578ca4bb28af31120cffe$/m,
    );
    expect(DOCKERFILE).toMatch(
      /^ARG RUNTIME_IMAGE=gcr\.io\/distroless\/nodejs24-debian13:nonroot@sha256:9eeb7f5887d0e239e78264b06f7f11d2e14be534050481803a9e4728fcdd278e$/m,
    );
    expect(DOCKERFILE).not.toMatch(/nodejs20|node:20|debian12|bookworm/);
    for (const arg of DOCKERFILE.match(/^ARG (BUILD_IMAGE|RUNTIME_IMAGE)=(.+)$/gm) ?? []) {
      expect(arg).toMatch(/@sha256:[0-9a-f]{64}$/);
      expect(arg).not.toMatch(/latest/);
    }
  });

  for (const [label, mutate] of [
    ['a tag-only build image (even a precise tag)', (text: string) => text.replace(/^(ARG BUILD_IMAGE=[^@\n]+)@sha256:[0-9a-f]{64}$/m, '$1')],
    ['a tag-only runtime image', (text: string) => text.replace(/^(ARG RUNTIME_IMAGE=[^@\n]+)@sha256:[0-9a-f]{64}$/m, '$1')],
    ['a latest runtime image', (text: string) => text.replace(/^ARG RUNTIME_IMAGE=.+$/m, 'ARG RUNTIME_IMAGE=gcr.io/distroless/nodejs24-debian13:latest')],
    // DIGEST-PINNED, AND STILL REFUSED: the family is wrong. Node 20 is end-of-life.
    ['a digest-pinned NODE 20 build image', (text: string) => text.replace(/^ARG BUILD_IMAGE=.+$/m, 'ARG BUILD_IMAGE=node:20.19.5-bookworm-slim@sha256:9e70124bd00f47dd023e349cd587132ae61892acc0e47ed641416c3e18f401c3')],
    ['a digest-pinned distroless NODE 20 / Debian 12 runtime', (text: string) => text.replace(/^ARG RUNTIME_IMAGE=.+$/m, 'ARG RUNTIME_IMAGE=gcr.io/distroless/nodejs20-debian12:nonroot@sha256:2cd820156cf039c8b54ae2d2a97e424b6729070714de8707a6b79f20d56f6a9a')],
    ['a digest-pinned distroless Node 24 on DEBIAN 12', (text: string) => text.replace(/^ARG RUNTIME_IMAGE=.+$/m, `ARG RUNTIME_IMAGE=gcr.io/distroless/nodejs24-debian12:nonroot@sha256:${'a'.repeat(64)}`)],
    ['a digest-pinned Node 24 build on bookworm', (text: string) => text.replace(/^ARG BUILD_IMAGE=.+$/m, `ARG BUILD_IMAGE=node:24.21.0-bookworm-slim@sha256:${'b'.repeat(64)}`)],
    ['a digest-pinned floating node:24 major tag', (text: string) => text.replace(/^ARG BUILD_IMAGE=.+$/m, `ARG BUILD_IMAGE=node:24-trixie-slim@sha256:${'c'.repeat(64)}`)],
    ['a truncated digest', (text: string) => text.replace(/^(ARG BUILD_IMAGE=.+@sha256:)[0-9a-f]{64}$/m, '$19e70124b')],
    ['a FROM that bypasses the pinned ARG', (text: string) => text.replace('FROM ${RUNTIME_IMAGE} AS runtime', 'FROM gcr.io/distroless/nodejs24-debian13:nonroot AS runtime')],
  ] as const) {
    it(`the pin check REFUSES ${label}`, () => {
      const mutated = mutate(DOCKERFILE);
      expect(mutated).not.toBe(DOCKERFILE);
      expect(baseImagePinProblems(mutated).length).toBeGreaterThan(0);
    });
  }

  it('the build stage never copies tests, validation, artifacts, docs or the git directory', () => {
    const copied = DOCKERFILE.split('\n').filter((line) => line.startsWith('COPY ')).join('\n');
    expect(copied).not.toMatch(/tests\/|validation\/|artifacts\/|docs\/|\.git|spikes\//);
    expect(DOCKERFILE).toMatch(/npm ci --ignore-scripts/);
  });

  it('the image never bakes the control-artifact package; it is mounted at the documented root', () => {
    expect(DOCKERFILE).not.toContain(CONTROL_ARTIFACT_MOUNT);
    expect(DOCKERFILE).not.toMatch(/manifest\.json|class-\d+/);
  });
});

describe('the build context is an ALLOWLIST', () => {
  const lines = DOCKERIGNORE.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0 && !line.startsWith('#'));

  it('excludes everything first, then re-includes exactly the build inputs', () => {
    expect(lines.slice(0, 2)).toEqual(['*', '**']);
    expect(lines.filter((line) => line.startsWith('!'))).toEqual([
      '!package.json',
      '!package-lock.json',
      '!tsconfig.json',
      '!src/',
      '!src/**',
      '!tools/integration-packaging/',
      '!tools/integration-packaging/**',
      '!tools/deploy/',
      '!tools/deploy/**',
      '!deploy/provider-evidence-ingress/tsconfig.build.json',
    ]);
  });

  it('re-excludes local secret material even inside the allowlisted trees', () => {
    for (const pattern of ['**/.env', '**/.env.*', '**/*.local.json', '**/*.sendgrid-deployment.json', '**/*.pem', '**/*.key', '**/node_modules', '**/.git']) {
      expect(lines).toContain(pattern);
    }
  });

  it('no allowlisted tree holds a private key, a SendGrid key shape or test material', () => {
    const roots = ['src', join('tools', 'integration-packaging'), join('tools', 'deploy')];
    for (const root of roots) {
      for (const file of filesUnder(root)) {
        const text = readFileSync(join(root, file), 'utf8');
        expect(text, `${root}/${file}`).not.toMatch(/-----BEGIN [A-Z ]*PRIVATE KEY-----|SG\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/);
      }
    }
  });
});
