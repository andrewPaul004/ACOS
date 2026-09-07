import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as cedar from '@cedar-policy/cedar-wasm/nodejs';

import { canonicalHash, hex } from '../canonicalisation/canonicalBytes.js';
import { policyDefect } from './errors.js';

/**
 * The Cedar schema and policy set, loaded as CONTROL ARTIFACTS.
 *
 * `50 §2` class 2, verbatim row: "**Policy set** (Cedar source + compiled artifact) | ✔ |
 * Owner, second factor | All effects".
 *
 * `26 §11`, verbatim:
 *
 *   "**Versioned.** Every `AuthorizationDecision` records `policy_version` **and
 *    `constructor_version`** [...] A decision is reproducible: **same inputs, same
 *    `policy_version`, same `constructor_version`, same verdict, forever.**"
 *
 *   "**Change-controlled.** Policy changes are code changes: reviewed, tested against a
 *    regression corpus, deployed. **No runtime editing, no admin UI that mutates rules, no
 *    model in the path.**"
 *
 * ---------------------------------------------------------------------------------
 * FOUR PROPERTIES, EACH FAIL-CLOSED
 *
 * 1. THE SET IS EXACT. `EXPECTED_POLICY_IDS` is a frozen list. A missing artifact, an
 *    unexpected artifact, or a second file claiming an id already loaded is a
 *    `POLICY_ARTIFACT_INVALID` defect. `50 §3`'s I19 mechanism halts the class's halt scope
 *    on a control-artifact mismatch; it does not fall back.
 *
 * 2. THERE IS NO FALLBACK POLICY. This module has no default policy text, no permissive
 *    branch, no "if the directory is empty then …". `tests/policy/source-rules-s1d.test.ts`
 *    asserts that structurally.
 *
 * 3. LOADING IS DETERMINISTIC. Files are read in sorted id order and the digest is taken
 *    over a length-framed canonical structure, so neither `readdir` order nor a filesystem
 *    reorder can move `policyVersion`.
 *
 * 4. MALFORMED IS REFUSED BEFORE USE. `cedar.checkParseSchema` and
 *    `cedar.checkParsePolicySet` run at load. A policy set that only fails at the first
 *    authorization call is a policy set that fails at the worst moment.
 *
 * ---------------------------------------------------------------------------------
 * WHAT THIS IS NOT
 *
 * It is not signing. `50 §3`'s manifest row is
 * `{class, artifact_id, version, content_hash, signed_at, signature}`; S1D computes and
 * binds the **content hash** and builds no key management, because the S1D mandate forbids
 * inventing signing infrastructure that the current architecture does not already require of
 * this slice. The signature half is an OPEN obligation, recorded in `S1D-result.md`.
 * ---------------------------------------------------------------------------------
 */

/**
 * The complete, closed policy set for S1D.
 *
 * A policy id is a FILENAME under `artifacts/policies/`, so the set on disk and the set in
 * this constant are two independently authored statements of the same fact and the loader
 * diffs them. Adding a policy without adding it here fails closed; adding it here without
 * the file fails closed.
 */
export const EXPECTED_POLICY_IDS: readonly string[] = Object.freeze([
  'acos.refund.create.grant',
  'acos.refund.create.per_action_max',
]);

/**
 * The policy ids whose determination means `26 §7` step M denied.
 *
 * Exactly one member. A Cedar denial in which this policy is determining is
 * `DENY: PER_ACTION` and nothing else has to be inspected — no amount is read, no limit is
 * re-derived, and no near-miss is computed. See `denialCategory.ts`.
 */
export const PER_ACTION_POLICY_ID = 'acos.refund.create.per_action_max';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The deployed artifact root. Overridable ONLY by tests, which is what makes §4 testable. */
export const DEFAULT_ARTIFACT_ROOT = join(HERE, 'artifacts');

const SCHEMA_FILENAME = 'acos.cedarschema';
const POLICY_DIRNAME = 'policies';
const POLICY_SUFFIX = '.cedar';

export interface LoadedPolicyArtifacts {
  /** The Cedar schema source, verbatim. */
  readonly schema: string;
  /** id -> policy source, in `EXPECTED_POLICY_IDS` order. Frozen. */
  readonly staticPolicies: Readonly<Record<string, string>>;
  /**
   * `26 §11`'s `policy_version`: the content hash over the schema and the whole policy set.
   *
   * Recorded on every decision this artifact set produces, so a decision is replayable
   * against the exact artifacts that produced it and a substituted artifact is visible in
   * the audit record without diffing the files.
   */
  readonly policyVersion: string;
  /** Where these were loaded from, for the audit record. */
  readonly artifactRoot: string;
}

function readArtifact(path: string, what: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    // Absent, unreadable, or a directory where a file was expected. `50 §3`: halt, never
    // fall back.
    return policyDefect('POLICY_ARTIFACT_INVALID', `${what} could not be read at ${path}`);
  }
}

function listPolicyFiles(dir: string): readonly string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return policyDefect('POLICY_ARTIFACT_INVALID', `the policy directory ${dir} does not exist`);
  }
  const unexpected = entries.filter(
    (entry) => !entry.isFile() || !entry.name.endsWith(POLICY_SUFFIX),
  );
  if (unexpected.length > 0) {
    // An unexpected entry is not ignored. A stray file in a control-artifact directory is
    // either an accident that changes nothing or an artifact nobody reviewed, and the loader
    // cannot tell which.
    policyDefect(
      'POLICY_ARTIFACT_INVALID',
      `the policy directory ${dir} carries non-policy entries: ${unexpected.map((e) => e.name).sort().join(', ')}`,
    );
  }
  // Sorted, so loading order is a property of the ids and not of the filesystem.
  return entries.map((entry) => entry.name).sort();
}

/**
 * Load, validate and digest the policy artifacts. Throws `PolicyEvaluationDefect` on any
 * defect; there is no partial success and no degraded mode.
 */
export function loadPolicyArtifacts(
  artifactRoot: string = DEFAULT_ARTIFACT_ROOT,
  expectedIds: readonly string[] = EXPECTED_POLICY_IDS,
): LoadedPolicyArtifacts {
  const schemaPath = join(artifactRoot, SCHEMA_FILENAME);
  const schema = readArtifact(schemaPath, 'the Cedar schema');

  const schemaParse = cedar.checkParseSchema(schema);
  if (schemaParse.type !== 'success') {
    policyDefect(
      'POLICY_ARTIFACT_INVALID',
      `the Cedar schema at ${schemaPath} does not parse: ${describeErrors(schemaParse.errors)}`,
    );
  }

  const policyDir = join(artifactRoot, POLICY_DIRNAME);
  const filenames = listPolicyFiles(policyDir);

  const loaded = new Map<string, string>();
  for (const filename of filenames) {
    const id = filename.slice(0, -POLICY_SUFFIX.length);
    if (loaded.has(id)) {
      // Unreachable on a case-sensitive filesystem and reachable on a case-insensitive one;
      // either way a duplicate id silently overwriting the first is exactly the failure this
      // check exists for.
      policyDefect('POLICY_ARTIFACT_INVALID', `duplicate policy id ${id} in ${policyDir}`);
    }
    loaded.set(id, readArtifact(join(policyDir, filename), `policy ${id}`));
  }

  // The exact-set diff, both directions, reported together so a reviewer sees the whole
  // discrepancy rather than the first half of it.
  const found = [...loaded.keys()].sort();
  const expected = [...expectedIds].sort();
  const missing = expected.filter((id) => !loaded.has(id));
  const unexpected = found.filter((id) => !expected.includes(id));
  if (missing.length > 0 || unexpected.length > 0) {
    policyDefect(
      'POLICY_ARTIFACT_INVALID',
      `the deployed policy set does not match the expected set — missing [${missing.join(', ')}], unexpected [${unexpected.join(', ')}]`,
    );
  }

  // In EXPECTED order, so the object's own key order is declared rather than incidental.
  const staticPolicies: Record<string, string> = {};
  for (const id of expected) staticPolicies[id] = loaded.get(id)!;

  const setParse = cedar.checkParsePolicySet({ staticPolicies });
  if (setParse.type !== 'success') {
    policyDefect(
      'POLICY_ARTIFACT_INVALID',
      `the Cedar policy set does not parse: ${describeErrors(setParse.errors)}`,
    );
  }

  return Object.freeze({
    schema,
    staticPolicies: Object.freeze(staticPolicies),
    policyVersion: policySetDigest(schema, staticPolicies, expected),
    artifactRoot,
  });
}

/**
 * `26 §11`'s `policy_version`, as a content hash.
 *
 * Length-framed through `canonicalBytes`, over the schema and then every (id, source) pair
 * in sorted id order. `30 §5.3`'s framing is what stops `("ab","c")` and `("a","bc")` from
 * digesting alike, so a policy id renamed into another policy's text cannot hold the digest
 * still.
 */
function policySetDigest(
  schema: string,
  staticPolicies: Readonly<Record<string, string>>,
  orderedIds: readonly string[],
): string {
  return hex(
    canonicalHash('acos.policy_set.v1', [
      { kind: 'bytes', value: Buffer.from(schema, 'utf8') },
      { kind: 'integer', value: BigInt(orderedIds.length) },
      ...orderedIds.flatMap(
        (id) =>
          [
            { kind: 'text', value: id },
            { kind: 'bytes', value: Buffer.from(staticPolicies[id]!, 'utf8') },
          ] as const,
      ),
    ]),
  );
}

export function describeErrors(errors: readonly { readonly message: string }[]): string {
  return errors.map((error) => error.message).join(' | ');
}
