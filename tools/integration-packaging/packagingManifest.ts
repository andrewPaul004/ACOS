import { readFile } from 'node:fs/promises';
import { dirname, extname, relative, resolve, sep } from 'node:path';

/**
 * `§46`, `§11` — THE DETERMINISTIC PACKAGING MANIFEST.
 *
 * =================================================================================
 * WHY A MANIFEST RATHER THAN A DOCKERFILE
 *
 * `§46`: "If repository has deploy/build definitions: prove the control runtime artifact
 * does not contain integration credential-loading code/provider dependencies. Prove each
 * adapter runtime artifact includes only its declared adapter code. **If separate
 * image/container build is not yet represented in repo: create a deterministic packaging
 * manifest/test that proves module/dependency separation. Do not invent Docker/Kubernetes
 * architecture merely for S1N.**"
 *
 * This repository's only deploy definition is `docker-compose.yml`, which starts two
 * PostgreSQL containers and builds no application image. So there is no image boundary to
 * assert against, and inventing one would be inventing architecture: `31 §12` selects no
 * container platform and `37` sequences no deployment slice.
 *
 * What CAN be computed today, deterministically and from the repository alone, is each
 * runtime's STATIC IMPORT CLOSURE — the exact set of first-party modules a process reaches
 * by following `import` from its entry point. That is what a bundler would put in an image,
 * and the separation properties `§11` and `§46` ask for are properties of those sets:
 *
 *   1. the CONTROL closure contains no secret source, no provider client and no adapter;
 *   2. adapter A's closure contains no module of adapter B's, and B's none of A's;
 *   3. each adapter runtime's closure contains its own adapter and its own secret source.
 *
 * `29 §3.5`, the rule being implemented: "**Per-adapter** runtime, filesystem and dependency
 * isolation — not merely per-plane (v1.1) [...] settlement independence requires the
 * commerce, processor and bank adapters not to be co-compromised."
 * =================================================================================
 */

/** One runtime whose closure is computed and asserted. */
export interface PackagedRuntime {
  readonly name: string;
  /** Entry points, repository-relative. */
  readonly entryPoints: readonly string[];
}

export interface RuntimeClosure {
  readonly name: string;
  /** Repository-relative module paths, sorted. Deterministic across runs and platforms. */
  readonly modules: readonly string[];
  /**
   * THE BARE PACKAGE SPECIFIERS THE CLOSURE IMPORTS, SORTED. S1P KEY VAULT ADDITION.
   *
   * `resolveSpecifier` returns `null` for anything that does not start with `.`, so a package
   * dependency was previously INVISIBLE to this manifest: the walk followed repository modules
   * and silently dropped `@azure/identity`, `pg` and everything else.
   *
   * That was adequate while the only question was which of OUR modules a runtime carried. The
   * Azure Key Vault credential binding makes it inadequate: the owner decision says the
   * credential-holding children hold an Azure SDK and the coordinator holds none, and a
   * closure that cannot see packages cannot state either half.
   *
   * So the specifiers are COLLECTED rather than followed. Their own transitive graph is not
   * walked — that is `package-lock.json`'s job, not this manifest's — and the property this
   * field supports is "which runtimes import a package at all", which is exactly the
   * separation question `§16` asks.
   */
  readonly packages: readonly string[];
}

/**
 * The runtimes S1N packages.
 *
 * CONTROL's entry point is the Effect Gateway, because that is the module a control process
 * actually composes for dispatch and the one whose closure `I25` is a statement about. It is
 * not the whole control plane — the audit plane, the release tooling and the migration
 * runner are separate processes with separate closures — and the manifest says so rather
 * than implying a single artifact that does not exist.
 */
export const S1N_PACKAGED_RUNTIMES: readonly PackagedRuntime[] = [
  {
    name: 'CONTROL_PLANE',
    entryPoints: [
      'src/kernel/gateway/effectGateway.ts',
      'src/integration/control/integrationClient.ts',
      'src/integration/control/adapterRuntimeRegistry.ts',
    ],
  },
  {
    name: 'INTEGRATION_ADAPTER:mock_ads',
    entryPoints: [
      'src/integration/runtime/main.ts',
      'tests/integration-plane/adapterA/adapter.ts',
      'tests/integration-plane/adapterA/secretSource.ts',
    ],
  },
  {
    name: 'INTEGRATION_ADAPTER:mock_commerce',
    entryPoints: [
      'src/integration/runtime/main.ts',
      'tests/integration-plane/adapterB/adapter.ts',
      'tests/integration-plane/adapterB/secretSource.ts',
    ],
  },
];

const IMPORT_SPECIFIER = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+['"]([^'"]+)['"]/g;
const SIDE_EFFECT_IMPORT = /(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g;

/**
 * Resolve one relative specifier to a repository-relative `.ts` path.
 *
 * The repository compiles ESM with `.js` specifiers pointing at `.ts` sources, which is the
 * TypeScript `NodeNext` convention `tsconfig.json` selects. Package specifiers — anything
 * not starting with `.` — are third-party and are deliberately NOT followed: the property
 * being asserted is about FIRST-PARTY module separation, and `node_modules` would make every
 * closure the same size and prove nothing.
 */
/**
 * The PACKAGE a bare specifier belongs to. `@azure/identity` and `@azure/identity/x` are one
 * dependency, and reporting them separately would let a deep import hide behind a name a
 * separation assertion did not list.
 */
function packageNameOf(specifier: string): string {
  const segments = specifier.split('/');
  return specifier.startsWith('@') ? segments.slice(0, 2).join('/') : (segments[0] ?? specifier);
}

function resolveSpecifier(fromFile: string, specifier: string, cwd: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const absolute = resolve(dirname(resolve(cwd, fromFile)), specifier);
  const asTypescript = extname(absolute) === '.js' ? `${absolute.slice(0, -3)}.ts` : absolute;
  return relative(cwd, asTypescript).split(sep).join('/');
}

/**
 * Compute one runtime's static import closure. A breadth-first walk, no dynamic imports.
 *
 * DYNAMIC IMPORTS ARE DELIBERATELY NOT FOLLOWED, and that is the correct reading rather than
 * a limitation. `main.ts`'s one `await import(...)` is how each adapter runtime loads ITS
 * OWN adapter, confined to its own runtime root: following it statically would put every
 * adapter into every runtime's closure and would destroy exactly the separation this
 * manifest measures. The adapter's own entry point is listed on the runtime that loads it,
 * which is what a per-adapter image build would also do.
 */
export async function computeClosure(
  runtime: PackagedRuntime,
  cwd: string = process.cwd(),
): Promise<RuntimeClosure> {
  const seen = new Set<string>();
  const packages = new Set<string>();
  const queue = [...runtime.entryPoints];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined || seen.has(current)) continue;
    seen.add(current);
    let source: string;
    try {
      source = await readFile(resolve(cwd, current), 'utf8');
    } catch {
      continue;
    }
    const stripped = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    for (const pattern of [IMPORT_SPECIFIER, SIDE_EFFECT_IMPORT]) {
      pattern.lastIndex = 0;
      for (const match of stripped.matchAll(pattern)) {
        const specifier = match[1];
        if (specifier === undefined) continue;
        const resolved = resolveSpecifier(current, specifier, cwd);
        if (resolved !== null) {
          if (!seen.has(resolved)) queue.push(resolved);
          continue;
        }
        /*
         * A BARE SPECIFIER. Recorded, not followed.
         *
         * `node:` builtins are excluded because they are not dependencies in the sense `§16`
         * asks about — every runtime has `node:fs` available whether it imports it or not, and
         * listing them would bury the one fact this field exists to surface.
         */
        if (!specifier.startsWith('node:')) packages.add(packageNameOf(specifier));
      }
    }
  }

  return Object.freeze({
    name: runtime.name,
    modules: Object.freeze([...seen].sort()),
    packages: Object.freeze([...packages].sort()),
  });
}

export async function computeAllClosures(
  cwd: string = process.cwd(),
  runtimes: readonly PackagedRuntime[] = S1N_PACKAGED_RUNTIMES,
): Promise<readonly RuntimeClosure[]> {
  const out: RuntimeClosure[] = [];
  for (const runtime of runtimes) out.push(await computeClosure(runtime, cwd));
  return Object.freeze(out);
}

/** A separation obligation and whether the closures satisfy it. */
export interface SeparationFinding {
  readonly obligation: string;
  readonly satisfied: boolean;
  readonly offending: readonly string[];
}

/**
 * The obligations, evaluated against computed closures.
 *
 * Each is one sentence of `§11`, `§45` or `§46` turned into a set operation, and each names
 * the module or modules that break it rather than only reporting a boolean.
 */
export function evaluateSeparation(closures: readonly RuntimeClosure[]): readonly SeparationFinding[] {
  const byName = new Map(closures.map((closure) => [closure.name, closure] as const));
  const control = byName.get('CONTROL_PLANE');
  const adapterA = byName.get('INTEGRATION_ADAPTER:mock_ads');
  const adapterB = byName.get('INTEGRATION_ADAPTER:mock_commerce');
  const findings: SeparationFinding[] = [];

  const controlModules = control?.modules ?? [];
  const aModules = adapterA?.modules ?? [];
  const bModules = adapterB?.modules ?? [];

  // `§10`, `I25` — the control closure holds no secret loader and no integration runtime.
  const controlForbidden = controlModules.filter(
    (module) =>
      module.startsWith('src/integration/runtime/') ||
      module.includes('secretSource') ||
      module.includes('providerClient') ||
      module.startsWith('tests/integration-plane/'),
  );
  findings.push({
    obligation:
      'I25 / §10 — the CONTROL closure contains no secret source, no provider client, no ' +
      'adapter implementation and no integration-runtime module',
    satisfied: controlForbidden.length === 0,
    offending: controlForbidden,
  });

  // `§11` — A's closure holds nothing of B's, and B's nothing of A's.
  const aHoldsB = aModules.filter((module) => module.startsWith('tests/integration-plane/adapterB/'));
  findings.push({
    obligation: "§11 — adapter A's closure contains no module of adapter B's",
    satisfied: aHoldsB.length === 0,
    offending: aHoldsB,
  });
  const bHoldsA = bModules.filter((module) => module.startsWith('tests/integration-plane/adapterA/'));
  findings.push({
    obligation: "§11 — adapter B's closure contains no module of adapter A's",
    satisfied: bHoldsA.length === 0,
    offending: bHoldsA,
  });

  // `§11` — the ONLY overlap between the two adapter closures is the shared Z2 declarations.
  const overlap = aModules.filter((module) => bModules.includes(module));
  const disallowedOverlap = overlap.filter(
    (module) =>
      !module.startsWith('src/integration/protocol/') &&
      !module.startsWith('src/integration/runtime/') &&
      !module.startsWith('src/kernel/canonicalisation/'),
  );
  findings.push({
    obligation:
      '§11 — the two adapter closures overlap only in the shared integration protocol, the ' +
      'integration-runtime host and the closed catalogue member sets',
    satisfied: disallowedOverlap.length === 0,
    offending: disallowedOverlap,
  });

  // `§45` — each adapter runtime DOES hold its own adapter and its own secret source.
  for (const [name, modules, root] of [
    ['mock_ads', aModules, 'tests/integration-plane/adapterA/'],
    ['mock_commerce', bModules, 'tests/integration-plane/adapterB/'],
  ] as const) {
    const holdsAdapter = modules.includes(`${root}adapter.ts`);
    const holdsSource = modules.includes(`${root}secretSource.ts`);
    findings.push({
      obligation: `§45 — the ${name} runtime holds its OWN adapter and its OWN secret source`,
      satisfied: holdsAdapter && holdsSource,
      offending: holdsAdapter && holdsSource ? [] : [`${root}adapter.ts`, `${root}secretSource.ts`],
    });
  }

  // `§12` — no adapter runtime reaches the control database.
  for (const [name, modules] of [
    ['mock_ads', aModules],
    ['mock_commerce', bModules],
  ] as const) {
    const reachesDatabase = modules.filter(
      (module) => module.startsWith('src/db/') || module.startsWith('src/audit/'),
    );
    findings.push({
      obligation: `§12 — the ${name} runtime's closure reaches no control or audit database module`,
      satisfied: reachesDatabase.length === 0,
      offending: reachesDatabase,
    });
  }

  return Object.freeze(findings);
}

export function renderPackagingManifest(
  closures: readonly RuntimeClosure[],
  findings: readonly SeparationFinding[],
): string {
  const lines: string[] = [];
  lines.push('ACOS INTEGRATION PACKAGING MANIFEST — §11, §45, §46');
  lines.push('');
  for (const closure of closures) {
    lines.push(`${closure.name}  (${closure.modules.length} first-party modules)`);
    for (const module of closure.modules) lines.push(`    ${module}`);
    lines.push('');
  }
  lines.push('SEPARATION OBLIGATIONS');
  for (const finding of findings) {
    lines.push(`  ${finding.satisfied ? 'PASS' : 'FAIL'}  ${finding.obligation}`);
    for (const offender of finding.offending) lines.push(`          ${offender}`);
  }
  lines.push('');
  lines.push(findings.every((finding) => finding.satisfied) ? 'RESULT: PASS' : 'RESULT: FAIL');
  return lines.join('\n');
}
