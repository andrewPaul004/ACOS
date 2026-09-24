import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Assemble `50 §2e`'s class-2 BUNDLE from the authored Cedar sources.
 *
 * =================================================================================
 * `50 §2e`, verbatim
 *
 *   "Artifact | the `acos.control.policy_set` **bundle**: the Cedar schema file and every
 *    `.cedar` policy source file, in one immutable byte object"
 *   "`content_hash` | `SHA-256` over the bundle's exact bytes (`§3c`)"
 *
 * The `.cedar` files under `src/kernel/policy/artifacts/` are where a policy is AUTHORED and
 * reviewed. The bundle under `artifacts/control/` is what is DEPLOYED, hashed and signed.
 * This tool is the one-way step between them, run as part of a release rather than at
 * runtime, and `tests/policy/policy-set-bundle-assembly.test.ts` re-runs it in CI and
 * asserts the checked-in bundle is byte-identical to what the current sources assemble to.
 *
 * THAT CI CHECK IS NOT AN AUTHORITY PATH. `50 §3c` is explicit that a signed artifact and a
 * separate literal may not both be authority sources "with equality asserted only in a
 * test". The `.cedar` files are not a second AUTHORITY: after this slice nothing in `src/`
 * reads them, the Cedar engine is constructed only from the verified bundle, and the CI
 * check exists so that a reviewer editing a policy cannot forget to re-assemble — a drift
 * alarm, not a fallback.
 * =================================================================================
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');

export const POLICY_SOURCE_ROOT = join(REPO_ROOT, 'src', 'kernel', 'policy', 'artifacts');
export const CLASS_2_BUNDLE_PATH = join(
  REPO_ROOT,
  'artifacts',
  'control',
  'class-02.policy-set.json',
);

const SCHEMA_FILENAME = 'acos.cedarschema';
const POLICY_DIRNAME = 'policies';
const POLICY_SUFFIX = '.cedar';

/** The bundle's declared version. It is bound into every signature by `50 §3b`. */
export const CLASS_2_ARTIFACT_VERSION = 'acos.policy_set.2026-09-24';

/**
 * Assemble the bundle's exact bytes.
 *
 * The policies are emitted in ASCENDING ID ORDER and the JSON is emitted with a fixed
 * two-space indent and a trailing newline, so the byte object is a function of the sources
 * alone: two runs over one tree produce identical bytes, which is what makes a release
 * reproducible and a CI drift check meaningful.
 */
export function assemblePolicySetBundle(sourceRoot: string = POLICY_SOURCE_ROOT): Buffer {
  const schema = readFileSync(join(sourceRoot, SCHEMA_FILENAME), 'utf8');
  const policyDir = join(sourceRoot, POLICY_DIRNAME);
  const filenames = readdirSync(policyDir)
    .filter((name) => name.endsWith(POLICY_SUFFIX))
    .sort();

  const policies = filenames.map((filename) => ({
    id: filename.slice(0, -POLICY_SUFFIX.length),
    source: readFileSync(join(policyDir, filename), 'utf8'),
  }));

  const document = {
    artifact_id: 'acos.control.policy_set',
    artifact_version: CLASS_2_ARTIFACT_VERSION,
    schema,
    policies,
  };
  return Buffer.from(`${JSON.stringify(document, null, 2)}\n`, 'utf8');
}

/** Write the assembled bundle to its checked-in location. Release step; never runtime. */
export function writePolicySetBundle(): void {
  writeFileSync(CLASS_2_BUNDLE_PATH, assemblePolicySetBundle());
}

if (process.argv[1] !== undefined && process.argv[1].endsWith('assemblePolicySet.ts')) {
  writePolicySetBundle();
}
