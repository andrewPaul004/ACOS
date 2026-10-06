import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

import {
  INGRESS_PERMITTED_PACKAGES,
  INGRESS_RUNTIME_NAME,
  S1N_PACKAGED_RUNTIMES,
  computeClosure,
} from '../integration-packaging/packagingManifest.js';

/**
 * S1P-WD — THE PROVIDER-EVIDENCE INGRESS CONTAINER IMAGE, DERIVED, NEVER HAND-LISTED.
 *
 * =================================================================================
 * ONE SOURCE OF TRUTH FOR WHAT THE IMAGE CONTAINS
 *
 * The image's application files are NOT a list someone maintains beside the code. They are:
 *
 *   1. the ingress runtime's STATIC IMPORT CLOSURE, computed by the same
 *      `tools/integration-packaging/` walk that `npm run verify:packaging` evaluates against
 *      `48 §8`'s "MUST NOT hold" obligations — so a module the gate refuses cannot be staged;
 *   2. the bare packages that closure imports, which the same gate restricts to `pg`;
 *   3. those packages' installed dependency trees, read from the repository's OWN
 *      `package-lock.json` (no second lockfile, no `npm install` of anything new).
 *
 * The Docker build stage compiles the closure with `tsc` and runs `stage` below, and the
 * runtime stage copies the staged directory and nothing else. `inspect` checks a BUILT image's
 * exported filesystem against the same derivation, so the claim "the image holds only the
 * ingress" is a measurement of the image, not of the Dockerfile.
 *
 * =================================================================================
 * NO NETWORK, NO PROVIDER, NO AZURE
 *
 * This module reads repository files and writes a staging directory. It imports no client, no
 * child-process API and no socket, and it is never part of the image it describes.
 * =================================================================================
 */

/** Where the application lives inside the image. */
export const IMAGE_APP_ROOT = '/app';
/** The compiled entry point, relative to the app root. The ONLY process the image starts. */
export const IMAGE_ENTRY_POINT = 'src/audit/providerEvidence/ingressMain.js';
/** The container-local HTTP port behind the Container Apps TLS front end. */
export const IMAGE_LISTEN_PORT = 8080;
/** Where the deployment mounts the audit plane's signed control-artifact package, read-only. */
export const CONTROL_ARTIFACT_MOUNT = '/etc/acos/control-artifacts';
/** The image's own manifest of what it contains, written by `stage`. */
export const IMAGE_MANIFEST_FILE = 'IMAGE-MANIFEST.json';

export interface IngressImagePlan {
  /** Repository-relative TypeScript modules of the ingress closure, sorted. */
  readonly sourceModules: readonly string[];
  /** The compiled files staged for them, relative to the app root, sorted. */
  readonly applicationFiles: readonly string[];
  /** The bare packages the closure imports. Must be within `INGRESS_PERMITTED_PACKAGES`. */
  readonly importedPackages: readonly string[];
  /** Installed package directories staged, `node_modules/...`, sorted, with versions. */
  readonly packageDirectories: readonly { readonly path: string; readonly version: string }[];
}

interface LockPackage {
  readonly version?: string;
  readonly dev?: boolean;
  readonly optional?: boolean;
  readonly dependencies?: Readonly<Record<string, string>>;
}

/** The ingress runtime definition, from the packaging manifest — not re-declared here. */
function ingressRuntime(): (typeof S1N_PACKAGED_RUNTIMES)[number] {
  const runtime = S1N_PACKAGED_RUNTIMES.find((entry) => entry.name === INGRESS_RUNTIME_NAME);
  if (runtime === undefined) throw new Error(`${INGRESS_RUNTIME_NAME} is not a packaged runtime`);
  return runtime;
}

/**
 * Resolve an installed dependency the way Node does from a package directory: the nearest
 * `node_modules/<name>` walking up from the dependent. Only lockfile entries count.
 */
function resolveInstalled(
  packages: Readonly<Record<string, LockPackage>>,
  fromPath: string,
  name: string,
): string | null {
  let base = fromPath;
  for (;;) {
    const candidate = base === '' ? `node_modules/${name}` : `${base}/node_modules/${name}`;
    if (packages[candidate] !== undefined) return candidate;
    if (base === '') return null;
    const index = base.lastIndexOf('/node_modules/');
    base = index === -1 ? '' : base.slice(0, index);
  }
}

/**
 * The installed dependency closure of `roots`, from `package-lock.json` v3. REQUIRED
 * dependencies only: optional ones (`pg-cloudflare`, `pg-native`) are needed only on other
 * runtimes and are not staged. A dev-only package reaching the closure is refused.
 */
export function lockfilePackageClosure(
  lockfile: { readonly lockfileVersion: number; readonly packages: Readonly<Record<string, LockPackage>> },
  roots: readonly string[],
): readonly { readonly path: string; readonly version: string }[] {
  if (lockfile.lockfileVersion < 2) throw new Error('package-lock.json v2+ is required');
  const seen = new Map<string, string>();
  const queue = roots.map((name) => {
    const path = resolveInstalled(lockfile.packages, '', name);
    if (path === null) throw new Error(`${name} is not installed according to package-lock.json`);
    return path;
  });
  while (queue.length > 0) {
    const path = queue.shift()!;
    if (seen.has(path)) continue;
    const entry = lockfile.packages[path]!;
    if (entry.dev === true) throw new Error(`${path} is a DEV dependency and cannot reach the image`);
    if (entry.version === undefined) throw new Error(`${path} has no locked version`);
    seen.set(path, entry.version);
    for (const name of Object.keys(entry.dependencies ?? {})) {
      const resolved = resolveInstalled(lockfile.packages, path, name);
      if (resolved === null) throw new Error(`${path} depends on ${name}, which is not installed`);
      queue.push(resolved);
    }
  }
  return Object.freeze(
    [...seen.entries()]
      .map(([path, version]) => Object.freeze({ path, version }))
      .sort((left, right) => (left.path < right.path ? -1 : 1)),
  );
}

/** Compute what the image must contain. Pure over the repository's files. */
export async function ingressImagePlan(cwd: string = process.cwd()): Promise<IngressImagePlan> {
  const closure = await computeClosure(ingressRuntime(), cwd);
  const forbidden = closure.packages.filter((name) => !INGRESS_PERMITTED_PACKAGES.includes(name));
  if (forbidden.length > 0) {
    throw new Error(`the ingress closure imports packages outside its permitted set: ${forbidden.join(', ')}`);
  }
  const lockfile = JSON.parse(readFileSync(resolve(cwd, 'package-lock.json'), 'utf8')) as Parameters<
    typeof lockfilePackageClosure
  >[0];
  return Object.freeze({
    sourceModules: closure.modules,
    applicationFiles: Object.freeze(
      closure.modules.map((module) => module.replace(/\.ts$/, '.js')).sort(),
    ),
    importedPackages: closure.packages,
    packageDirectories: lockfilePackageClosure(lockfile, closure.packages),
  });
}

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

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/**
 * STAGE the image's application directory: the compiled closure, the locked package trees
 * (each WITHOUT its own nested `node_modules` — nested dependencies are closure entries of their
 * own), a minimal `package.json` declaring ESM, and a manifest of every staged file's hash.
 */
export async function stageIngressImage(input: {
  readonly cwd: string;
  /** `tsc -p deploy/provider-evidence-ingress/tsconfig.build.json`'s output directory. */
  readonly compiledRoot: string;
  readonly outDir: string;
}): Promise<IngressImagePlan> {
  const plan = await ingressImagePlan(input.cwd);
  mkdirSync(input.outDir, { recursive: true });
  for (const file of plan.applicationFiles) {
    const from = resolve(input.compiledRoot, file);
    const to = resolve(input.outDir, file);
    mkdirSync(dirname(to), { recursive: true });
    cpSync(from, to);
  }
  for (const { path } of plan.packageDirectories) {
    cpSync(resolve(input.cwd, path), resolve(input.outDir, path), {
      recursive: true,
      filter: (source) => {
        const rel = relative(resolve(input.cwd, path), source).split(sep).join('/');
        return !(rel === 'node_modules' || rel.startsWith('node_modules/'));
      },
    });
  }
  writeFileSync(
    resolve(input.outDir, 'package.json'),
    `${JSON.stringify({ name: 'acos-s1p-provider-evidence-ingress', private: true, type: 'module' }, null, 2)}\n`,
  );
  const files = filesUnder(input.outDir).filter((file) => file !== IMAGE_MANIFEST_FILE);
  writeFileSync(
    resolve(input.outDir, IMAGE_MANIFEST_FILE),
    `${JSON.stringify(
      {
        entryPoint: IMAGE_ENTRY_POINT,
        sourceModules: plan.sourceModules,
        packages: plan.packageDirectories,
        files: files.map((file) => ({ path: file, sha256: sha256(resolve(input.outDir, file)) })),
      },
      null,
      2,
    )}\n`,
  );
  return plan;
}

/**
 * CONTENT that must never appear in an application file of the image. Each is a marker of
 * something `48 §8` says the receiver must not hold, or of material that is not deployable.
 */
export const FORBIDDEN_IMAGE_CONTENT: readonly { readonly name: string; readonly pattern: RegExp }[] =
  Object.freeze([
    { name: 'PRIVATE_KEY_PEM', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
    { name: 'TEST_ONLY_MATERIAL', pattern: /TEST_ONLY/ },
    { name: 'SENDGRID_API_KEY_SHAPE', pattern: /SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/ },
    { name: 'AZURE_SDK', pattern: /@azure\// },
    { name: 'SENDGRID_API_HOST', pattern: /api\.sendgrid\.com/ },
    { name: 'SENDGRID_SEND_PATH', pattern: /\/v3\/mail\/send/ },
    { name: 'SENDGRID_ACTIVITY_PATH', pattern: /\/v3\/messages/ },
    { name: 'SECRET_SOURCE_MODULE', pattern: /secretSource/ },
    { name: 'INTEGRATION_RUNTIME', pattern: /integration\/(runtime|control)\// },
    { name: 'AUDIT_PROVIDER_READ_RUNTIME', pattern: /audit\/provider\/(runtime|plane)\// },
    { name: 'VALIDATION_PACKAGE', pattern: /validation\/sendgrid/ },
    { name: 'INTEGRATION_LOCATOR', pattern: /ACOS_S1P_INTEGRATION_LOCATOR|ACOS_S1P_AUDIT_LOCATOR/ },
  ]);

/** PATHS that must never appear anywhere in the image filesystem. */
export const FORBIDDEN_IMAGE_PATHS: readonly { readonly name: string; readonly pattern: RegExp }[] =
  Object.freeze([
    { name: 'TESTS', pattern: /(^|\/)app\/tests(\/|$)|(^|\/)tests\/(support|sendgrid|providerEvidence)\// },
    { name: 'TEST_DOUBLES', pattern: /sendgrid-doubles|integration-plane|audit-plane\// },
    { name: 'VALIDATION_PACKAGE', pattern: /(^|\/)validation\// },
    { name: 'GIT', pattern: /(^|\/)\.git(\/|$)/ },
    { name: 'ENV_FILE', pattern: /(^|\/)\.env(\.|$)/ },
    // OUR source, uncompiled. Locked packages keep their published files (including `.d.ts`).
    { name: 'TYPESCRIPT_SOURCE', pattern: /^app\/src\/.*\.ts$/ },
    { name: 'AZURE_SDK', pattern: /node_modules\/@azure\// },
    { name: 'CEDAR', pattern: /node_modules\/@cedar-policy\// },
    { name: 'REVIEW_ARTIFACT', pattern: /S1[A-Z]-[^/]*review[^/]*\.(md|diff)$/ },
    { name: 'BAKED_CONTROL_ARTIFACTS', pattern: /^etc\/acos\// },
    { name: 'LOCKFILE', pattern: /^app\/package-lock\.json$/ },
    // The development module that derives audit-role URLs with committed passwords. The deployed
    // ingress uses `evidenceIngressPool.ts` instead; this module must never be staged.
    { name: 'DEV_CREDENTIAL_MODULE', pattern: /^app\/src\/audit\/db\/auditPool\.js$/ },
  ]);

/**
 * CODE that derives a database credential, forbidden in the image's APPLICATION files (not in
 * `pg` itself, whose client necessarily handles a password field). The deployed ingress uses the
 * URL it is handed, verbatim; it never assigns a password or rewrites a role into a URL.
 */
export const FORBIDDEN_APPLICATION_CODE: readonly { readonly name: string; readonly pattern: RegExp }[] =
  Object.freeze([
    { name: 'CREDENTIAL_DERIVATION', pattern: /\.password\s*=(?!=)|\.username\s*=(?!=)|\basRole\s*\(/ },
    { name: 'DEV_CREDENTIAL_MODULE_IMPORT', pattern: /auditPool\.js/ },
  ]);

/**
 * EVERY database password literal committed to this repository, DERIVED from the files that
 * commit them — never a hand-kept list: role passwords in `src/**\/*.sql` (`PASSWORD '…'`),
 * password constants in TypeScript (`…PASSWORD = '…'`), `POSTGRES_PASSWORD` in
 * `docker-compose.yml`, and the credentials in `.env.example` URLs. The built image must contain
 * NONE of them, anywhere.
 */
export function knownCommittedDatabasePasswords(cwd: string = process.cwd()): readonly string[] {
  const found = new Set<string>();
  const walk = (dir: string, extension: string): string[] => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    return entries.flatMap((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : walk(full, extension);
      return full.endsWith(extension) ? [full] : [];
    });
  };
  for (const file of walk(resolve(cwd, 'src'), '.sql')) {
    for (const match of readFileSync(file, 'utf8').matchAll(/PASSWORD\s+'([!-&(-~]{4,})'/g)) found.add(match[1]!);
  }
  for (const root of ['src', 'tests', 'tools', 'validation']) {
    for (const file of walk(resolve(cwd, root), '.ts')) {
      for (const match of readFileSync(file, 'utf8').matchAll(/[A-Z_]*PASSWORD\s*=\s*'([!-&(-~]{4,})'/g)) {
        found.add(match[1]!);
      }
    }
  }
  const read = (name: string): string => {
    try {
      return readFileSync(resolve(cwd, name), 'utf8');
    } catch {
      return '';
    }
  };
  for (const match of read('docker-compose.yml').matchAll(/POSTGRES_PASSWORD:\s*(\S+)/g)) found.add(match[1]!);
  for (const match of read('.env.example').matchAll(/:\/\/[^:/\s]+:([^@\s]+)@/g)) found.add(match[1]!);
  return Object.freeze([...found].sort());
}

/** A digest-qualified image reference: `name[:tag]@sha256:<64 lowercase hex>`. */
const DIGEST_PINNED_IMAGE = /^[a-z0-9][a-z0-9._\/-]*(:[A-Za-z0-9._-]+)?@sha256:[0-9a-f]{64}$/;

/**
 * THE SUPPORTED RUNTIME FAMILY SELECTED BY S1P-WD (owner ruling, 2026-10-05): Node 24 LTS.
 * Node 20 is end-of-life and must not run a newly exposed public webhook. A digest-pinned image of
 * any other family — including a perfectly pinned Node 20 — is refused. Changing the Node major
 * is a reviewed change to these two patterns.
 */
export const SUPPORTED_BASE_IMAGE_FAMILIES: Readonly<Record<'BUILD_IMAGE' | 'RUNTIME_IMAGE', RegExp>> = Object.freeze({
  BUILD_IMAGE: /^node:24\.\d+\.\d+-trixie-slim@sha256:[0-9a-f]{64}$/,
  RUNTIME_IMAGE: /^gcr\.io\/distroless\/nodejs24-debian13:nonroot@sha256:[0-9a-f]{64}$/,
});

/**
 * The Dockerfile's base images must be DIGEST-PINNED build ARG defaults. A tag — even a precise
 * one — is mutable, so a tag-only default is a problem; so is a `FROM` that does not use the ARG.
 */
export function baseImagePinProblems(dockerfile: string): readonly string[] {
  const problems: string[] = [];
  for (const name of ['BUILD_IMAGE', 'RUNTIME_IMAGE']) {
    const match = new RegExp(`^ARG ${name}=(.+)$`, 'm').exec(dockerfile);
    if (match === null) {
      problems.push(`${name} has no ARG default`);
      continue;
    }
    const value = match[1]!.trim();
    if (!DIGEST_PINNED_IMAGE.test(value)) {
      problems.push(`${name} default is not digest-pinned (name@sha256:<64 hex>): ${value}`);
    } else if (!SUPPORTED_BASE_IMAGE_FAMILIES[name as 'BUILD_IMAGE' | 'RUNTIME_IMAGE'].test(value)) {
      problems.push(`${name} default is not the supported Node 24 / Debian 13 family: ${value}`);
    }
  }
  const froms = [...dockerfile.matchAll(/^FROM\s+(\S+)/gm)].map((match) => match[1]);
  if (JSON.stringify(froms) !== JSON.stringify(['${BUILD_IMAGE}', '${RUNTIME_IMAGE}'])) {
    problems.push(`FROM lines must use the pinned ARGs: ${froms.join(', ')}`);
  }
  return Object.freeze(problems);
}

export interface ImageFinding {
  readonly rule: string;
  readonly path: string;
}

/**
 * INSPECT a BUILT image: every path of its exported filesystem, and the extracted `app/`
 * directory. The app's file set must equal the plan EXACTLY (no extra file, none missing),
 * every file's hash must match the image's own manifest, and no forbidden path or content may
 * appear. Returns the findings; an empty list is the only pass.
 */
export async function inspectIngressImage(input: {
  readonly cwd: string;
  /** Every path in the exported image filesystem, relative to `/`, `/`-separated. */
  readonly imagePaths: readonly string[];
  /** The image's `app/` directory, extracted. */
  readonly appDir: string;
  /**
   * The raw bytes of the WHOLE exported image filesystem (`docker export`), when available. Every
   * committed database password is searched for in it — every file, base image included.
   */
  readonly imageExport?: Buffer;
}): Promise<readonly ImageFinding[]> {
  const plan = await ingressImagePlan(input.cwd);
  const findings: ImageFinding[] = [];
  const passwords = knownCommittedDatabasePasswords(input.cwd);
  if (input.imageExport !== undefined) {
    for (const password of passwords) {
      if (input.imageExport.includes(Buffer.from(password, 'latin1'))) {
        findings.push({ rule: 'DB_PASSWORD_LITERAL_IN_IMAGE', path: `<image export> contains a committed database password (${String(password.length)} chars)` });
      }
    }
  }

  for (const path of input.imagePaths) {
    const normalised = path.replace(/^\.?\//, '');
    for (const rule of FORBIDDEN_IMAGE_PATHS) {
      if (rule.pattern.test(normalised)) findings.push({ rule: rule.name, path: normalised });
    }
  }

  const actual = filesUnder(input.appDir);
  const manifest = JSON.parse(readFileSync(join(input.appDir, IMAGE_MANIFEST_FILE), 'utf8')) as {
    readonly entryPoint: string;
    readonly files: readonly { readonly path: string; readonly sha256: string }[];
  };
  if (manifest.entryPoint !== IMAGE_ENTRY_POINT) {
    findings.push({ rule: 'ENTRY_POINT', path: manifest.entryPoint });
  }
  const listed = new Map(manifest.files.map((file) => [file.path, file.sha256]));
  for (const file of actual) {
    if (file === IMAGE_MANIFEST_FILE) continue;
    const expected = listed.get(file);
    if (expected === undefined) findings.push({ rule: 'UNLISTED_FILE', path: file });
    else if (expected !== sha256(join(input.appDir, file))) findings.push({ rule: 'HASH_MISMATCH', path: file });
  }
  for (const file of listed.keys()) {
    if (!actual.includes(file)) findings.push({ rule: 'MISSING_FILE', path: file });
  }

  // The application files must be EXACTLY the closure, and the package roots exactly the locked set.
  const applicationFiles = actual.filter((file) => file.startsWith('src/'));
  if (JSON.stringify(applicationFiles) !== JSON.stringify(plan.applicationFiles)) {
    findings.push({ rule: 'APPLICATION_FILES_NOT_THE_CLOSURE', path: applicationFiles.join(',') });
  }
  const packageRoots = new Set(
    actual
      .filter((file) => file.startsWith('node_modules/'))
      .map((file) => plan.packageDirectories.find((dir) => file.startsWith(`${dir.path}/`))?.path ?? file),
  );
  for (const root of packageRoots) {
    if (!plan.packageDirectories.some((dir) => dir.path === root)) {
      findings.push({ rule: 'PACKAGE_NOT_IN_LOCKED_CLOSURE', path: root });
    }
  }
  const otherTopLevel = actual.filter(
    (file) =>
      !file.startsWith('src/') &&
      !file.startsWith('node_modules/') &&
      file !== 'package.json' &&
      file !== IMAGE_MANIFEST_FILE,
  );
  for (const file of otherTopLevel) findings.push({ rule: 'UNEXPECTED_APP_FILE', path: file });

  for (const file of actual) {
    const text = readFileSync(join(input.appDir, file), 'latin1');
    for (const password of passwords) {
      if (text.includes(password)) findings.push({ rule: 'DB_PASSWORD_LITERAL', path: file });
    }
    // The image's own manifest names modules; the rules below are about CODE and DATA.
    if (file === IMAGE_MANIFEST_FILE) continue;
    for (const rule of FORBIDDEN_IMAGE_CONTENT) {
      if (rule.pattern.test(text)) findings.push({ rule: rule.name, path: file });
    }
    if (file.startsWith('src/')) {
      for (const rule of FORBIDDEN_APPLICATION_CODE) {
        if (rule.pattern.test(text)) findings.push({ rule: rule.name, path: file });
      }
    }
  }
  return Object.freeze(findings);
}
