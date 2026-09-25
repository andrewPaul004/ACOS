import { readCandidateAndPackage, type ReleaseCandidate } from './candidate.js';
import {
  CLASS_27_QUANTITY_NAMES,
  decodeClass19,
  decodeClass2,
  decodeClass20,
  decodeClass24,
  decodeClass27,
  decodeClass3,
  type DecodedActionClass,
} from './decode.js';

/**
 * THE AUTHORITY DIFF BETWEEN TWO RELEASES — `§32` OF THE S1L MANDATE.
 *
 * =================================================================================
 * IT INFORMS. IT DOES NOT DECIDE.
 *
 * `§32`: "**Do not let the tool decide whether a release is 'safe.' It informs the human
 * owner.**"
 *
 * So every row this produces is a STATEMENT OF FACT — this field was X and is now Y — and
 * there is no severity column, no risk score, no "acceptable" flag and no exit code that
 * means approval. The owner reads the list.
 *
 * =================================================================================
 * IT COMPARES DECODED CONTENT, NOT ONLY DIGESTS
 *
 * `§49` control 12 — "release diff misses degraded-threshold change" — is the reason this
 * file decodes every class rather than comparing `content_hash` values and stopping. A digest
 * comparison tells an owner that class 27 moved; it does not tell them that the full-halt
 * threshold went from thirty minutes to six hours, which is the fact they need in order to
 * refuse. Both are reported: the digest change AND the field that caused it.
 * =================================================================================
 */

export interface ReleaseChange {
  /** A stable machine-readable kind, so a test can assert a specific change was surfaced. */
  readonly kind: string;
  readonly subject: string;
  readonly before: string;
  readonly after: string;
}

export interface ReleaseComparison {
  readonly beforeCandidateId: string;
  readonly afterCandidateId: string;
  readonly changes: readonly ReleaseChange[];
}

interface Loaded {
  readonly candidate: ReleaseCandidate;
  readonly bytesByClass: ReadonlyMap<number, Buffer>;
}

function change(kind: string, subject: string, before: string, after: string): ReleaseChange {
  return Object.freeze({ kind, subject, before, after });
}

function compareIdentities(before: Loaded, after: Loaded, out: ReleaseChange[]): void {
  if (before.candidate.manifestEpoch !== after.candidate.manifestEpoch) {
    out.push(
      change(
        'MANIFEST_EPOCH_CHANGED',
        'manifest_epoch (lineage only; NEVER a selector)',
        before.candidate.manifestEpoch,
        after.candidate.manifestEpoch,
      ),
    );
  }
  for (const field of ['expectedPrimaryKeyId', 'expectedSecondFactorKeyId'] as const) {
    if (before.candidate[field] !== after.candidate[field]) {
      out.push(
        change(
          'TRUST_ROOT_KEY_ID_CHANGED',
          field,
          before.candidate[field],
          after.candidate[field],
        ),
      );
    }
  }

  const beforeByClass = new Map(before.candidate.entries.map((e) => [e.artifactClass, e] as const));
  const afterByClass = new Map(after.candidate.entries.map((e) => [e.artifactClass, e] as const));
  for (const artifactClass of [...new Set([...beforeByClass.keys(), ...afterByClass.keys()])].sort(
    (a, b) => a - b,
  )) {
    const left = beforeByClass.get(artifactClass);
    const right = afterByClass.get(artifactClass);
    if (left === undefined) {
      out.push(change('ARTIFACT_ADDED', `class ${String(artifactClass)}`, 'ABSENT', right!.artifactId));
      continue;
    }
    if (right === undefined) {
      out.push(change('ARTIFACT_REMOVED', `class ${String(artifactClass)}`, left.artifactId, 'ABSENT'));
      continue;
    }
    if (left.artifactVersion !== right.artifactVersion) {
      out.push(
        change(
          'ARTIFACT_VERSION_CHANGED',
          `class ${String(artifactClass)} artifact_version`,
          left.artifactVersion,
          right.artifactVersion,
        ),
      );
    }
    if (left.contentHash !== right.contentHash) {
      out.push(
        change(
          'ARTIFACT_CONTENT_HASH_CHANGED',
          `class ${String(artifactClass)} content_hash`,
          left.contentHash,
          right.contentHash,
        ),
      );
    }
  }
}

function compareClass3(before: Buffer | undefined, after: Buffer | undefined, out: ReleaseChange[]): void {
  if (before === undefined || after === undefined) return;
  const left = decodeClass3(before);
  const right = decodeClass3(after);
  const leftByClass = new Map(left.actionClasses.map((row) => [row.actionClass, row] as const));
  const rightByClass = new Map(right.actionClasses.map((row) => [row.actionClass, row] as const));

  for (const actionClass of [...new Set([...leftByClass.keys(), ...rightByClass.keys()])].sort()) {
    const a = leftByClass.get(actionClass);
    const b = rightByClass.get(actionClass);
    if (a === undefined) {
      out.push(change('ACTION_CLASS_ADDED', actionClass, 'ABSENT', 'PRESENT'));
      continue;
    }
    if (b === undefined) {
      out.push(change('ACTION_CLASS_REMOVED', actionClass, 'PRESENT', 'ABSENT'));
      continue;
    }
    const fields: readonly (readonly [string, keyof DecodedActionClass])[] = [
      ['RECOVERABILITY_CHANGED', 'recoverability'],
      ['VALUE_DIRECTION_CHANGED', 'valueDirection'],
      ['VENDOR_MONETARY_FIELD_CHANGED', 'carriesVendorMonetaryField'],
      ['COST_COMPONENT_FREE_CHANGED', 'costComponentFree'],
      ['RATE_BASED_CHANGED', 'rateBased'],
      ['IRRECOVERABLE_UNITS_CHANGED', 'irrecoverableUnits'],
      ['SETTLEMENT_TOLERANCE_CHANGED', 'settlementTolerance'],
      ['ADAPTER_CHANGED', 'adapter'],
      ['METHOD_CHANGED', 'method'],
      ['EXTERNAL_DISPATCH_CHANGED', 'externalDispatch'],
    ];
    for (const [kind, field] of fields) {
      if (String(a[field]) !== String(b[field])) {
        out.push(change(kind, `${actionClass}.${String(field)}`, String(a[field]), String(b[field])));
      }
    }
  }

  if (left.reasonCodes.join(',') !== right.reasonCodes.join(',')) {
    out.push(
      change('REASON_CODES_CHANGED', 'reason_codes', left.reasonCodes.join(','), right.reasonCodes.join(',')),
    );
  }
  for (const key of [
    ...new Set([
      ...Object.keys(left.reasonCodeScopes),
      ...Object.keys(right.reasonCodeScopes),
    ]),
  ].sort()) {
    const a = String(left.reasonCodeScopes[key] ?? 'ABSENT');
    const b = String(right.reasonCodeScopes[key] ?? 'ABSENT');
    if (a !== b) out.push(change('REASON_CODE_SCOPE_CHANGED', key, a, b));
  }
  for (const key of [
    ...new Set([
      ...Object.keys(left.semanticOptionDigestFields),
      ...Object.keys(right.semanticOptionDigestFields),
    ]),
  ].sort()) {
    const a = (left.semanticOptionDigestFields[key] ?? ['ABSENT']).join(',');
    const b = (right.semanticOptionDigestFields[key] ?? ['ABSENT']).join(',');
    if (a !== b) out.push(change('SEMANTIC_OPTION_DIGEST_FIELDS_CHANGED', key, a, b));
  }
  for (const key of [
    ...new Set([
      ...Object.keys(left.enumerationMaxAgeSeconds),
      ...Object.keys(right.enumerationMaxAgeSeconds),
    ]),
  ].sort()) {
    const a = String(left.enumerationMaxAgeSeconds[key] ?? 'ABSENT');
    const b = String(right.enumerationMaxAgeSeconds[key] ?? 'ABSENT');
    if (a !== b) out.push(change('ENUMERATION_MAX_AGE_CHANGED', key, a, b));
  }
}

function compareClass27(before: Buffer | undefined, after: Buffer | undefined, out: ReleaseChange[]): void {
  if (before === undefined || after === undefined) return;
  const left = decodeClass27(before);
  const right = decodeClass27(after);
  for (const name of [
    ...new Set([
      ...CLASS_27_QUANTITY_NAMES,
      ...Object.keys(left.quantities),
      ...Object.keys(right.quantities),
    ]),
  ].sort()) {
    const a = String(left.quantities[name] ?? 'ABSENT');
    const b = String(right.quantities[name] ?? 'ABSENT');
    if (a !== b) out.push(change('DEGRADED_THRESHOLD_CHANGED', name, a, b));
  }
}

function compareClass2(before: Buffer | undefined, after: Buffer | undefined, out: ReleaseChange[]): void {
  if (before === undefined || after === undefined) return;
  const left = decodeClass2(before);
  const right = decodeClass2(after);
  if (left.policyVersion !== right.policyVersion) {
    out.push(change('CEDAR_POLICY_VERSION_CHANGED', 'policy_version', left.policyVersion, right.policyVersion));
  }
  if (left.schemaDigest !== right.schemaDigest) {
    out.push(change('CEDAR_SCHEMA_CHANGED', 'cedar schema digest', left.schemaDigest, right.schemaDigest));
  }
  const leftPolicies = new Map(left.policies.map((p) => [p.id, p.sourceDigest] as const));
  const rightPolicies = new Map(right.policies.map((p) => [p.id, p.sourceDigest] as const));
  for (const id of [...new Set([...leftPolicies.keys(), ...rightPolicies.keys()])].sort()) {
    const a = leftPolicies.get(id) ?? 'ABSENT';
    const b = rightPolicies.get(id) ?? 'ABSENT';
    if (a !== b) out.push(change('CEDAR_POLICY_CHANGED', id, a, b));
  }
}

function compareClass20(before: Buffer | undefined, after: Buffer | undefined, out: ReleaseChange[]): void {
  if (before === undefined || after === undefined) return;
  const left = decodeClass20(before);
  const right = decodeClass20(after);
  if (left.byteLength !== right.byteLength) {
    out.push(
      change(
        'JCS1_SPECIFICATION_CHANGED',
        'acos-jcs-1 specification bytes',
        String(left.byteLength),
        String(right.byteLength),
      ),
    );
  }
  if (left.carriesCarriageReturn !== right.carriesCarriageReturn) {
    out.push(
      change(
        'JCS1_LINE_ENDINGS_CHANGED',
        'acos-jcs-1 specification contains 0x0D',
        String(left.carriesCarriageReturn),
        String(right.carriesCarriageReturn),
      ),
    );
  }
}

function compareClass19(before: Buffer | undefined, after: Buffer | undefined, out: ReleaseChange[]): void {
  if (before === undefined || after === undefined) return;
  const left = decodeClass19(before);
  const right = decodeClass19(after);
  const leftById = new Map(left.records.map((r) => [r.constructorId, r] as const));
  const rightById = new Map(right.records.map((r) => [r.constructorId, r] as const));
  for (const id of [...new Set([...leftById.keys(), ...rightById.keys()])].sort()) {
    const a = leftById.get(id);
    const b = rightById.get(id);
    const render = (r: typeof a): string =>
      r === undefined
        ? 'ABSENT'
        : `${r.actionClass} ${String(r.semanticMajor)}.${String(r.nonSemanticMinor)}`;
    if (render(a) !== render(b)) {
      out.push(change('CONSTRUCTOR_RECORD_CHANGED', id, render(a), render(b)));
    }
  }
}

function compareClass24(before: Buffer | undefined, after: Buffer | undefined, out: ReleaseChange[]): void {
  if (before === undefined || after === undefined) return;
  const left = decodeClass24(before);
  const right = decodeClass24(after);
  if (left.publicKeyId !== right.publicKeyId) {
    out.push(
      change('AUDIT_SIGNING_KEY_CHANGED', 'class-24 published key_id', left.publicKeyId, right.publicKeyId),
    );
  }
}

/** Compare two release directories, and report every authority-relevant difference. */
export function compareReleases(beforeRoot: string, afterRoot: string): ReleaseComparison {
  const before = readCandidateAndPackage(beforeRoot);
  const after = readCandidateAndPackage(afterRoot);
  const changes: ReleaseChange[] = [];

  compareIdentities(before, after, changes);
  compareClass3(before.bytesByClass.get(3), after.bytesByClass.get(3), changes);
  compareClass27(before.bytesByClass.get(27), after.bytesByClass.get(27), changes);
  compareClass2(before.bytesByClass.get(2), after.bytesByClass.get(2), changes);
  compareClass20(before.bytesByClass.get(20), after.bytesByClass.get(20), changes);
  compareClass19(before.bytesByClass.get(19), after.bytesByClass.get(19), changes);
  compareClass24(before.bytesByClass.get(24), after.bytesByClass.get(24), changes);

  return Object.freeze({
    beforeCandidateId: before.candidate.candidateId,
    afterCandidateId: after.candidate.candidateId,
    changes: Object.freeze(changes),
  });
}

/** Render a comparison deterministically, for an operator to read. */
export function renderComparison(comparison: ReleaseComparison): string {
  const out: string[] = [];
  out.push('ACOS CONTROL-ARTIFACT RELEASE COMPARISON');
  out.push('');
  out.push('THIS TOOL REPORTS WHAT CHANGED. IT DOES NOT SAY WHETHER THE CHANGE IS SAFE.');
  out.push('');
  out.push(`before candidate_id: ${comparison.beforeCandidateId}`);
  out.push(`after  candidate_id: ${comparison.afterCandidateId}`);
  out.push('');
  if (comparison.changes.length === 0) {
    out.push('No authority-relevant difference was found.');
    out.push('');
    out.push('NOTE: identical authority content still requires its own ceremony if any byte');
    out.push('differs — 50 §3c hashes EXACT BYTES, so a whitespace-only edit is a different');
    out.push('artifact with a different identity and unusable old signatures (§33).');
    return `${out.join('\n')}\n`;
  }
  out.push(`${String(comparison.changes.length)} authority-relevant change(s):`);
  for (const row of comparison.changes) {
    out.push('');
    out.push(`  ${row.kind}`);
    out.push(`    subject: ${row.subject}`);
    out.push(`    before:  ${row.before}`);
    out.push(`    after:   ${row.after}`);
  }
  out.push('');
  return `${out.join('\n')}\n`;
}
