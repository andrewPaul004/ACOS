import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  RELEASE_LAYOUT,
  readCandidateAndPackage,
  readReleaseMetadata,
  type ReleaseCandidate,
} from './candidate.js';
import {
  CLASS_27_QUANTITY_NAMES,
  decodeClass19,
  decodeClass2,
  decodeClass20,
  decodeClass24,
  decodeClass27,
  decodeClass3,
} from './decode.js';

/**
 * THE DETERMINISTIC HUMAN-REVIEW REPORT — `§31` OF THE S1L MANDATE.
 *
 * =================================================================================
 * WHAT IT IS, AND THE ONE THING IT IS NOT
 *
 * `§31`: "Generate a deterministic human-review report BEFORE signatures. [...] The report
 * is for human approval. **It is NOT signed authority unless architecture says it is part of
 * the signed envelope.**"
 *
 * `50 §3d`'s core carries six fields and this report is none of them. It is written beside
 * the release, it is never hashed into anything, and deleting it would not change one byte
 * of `candidate_id` or `manifest_id`. `tests/release/review-and-diff.test.ts` proves that by
 * building the same release with and without the report and comparing both identities.
 *
 * =================================================================================
 * EVERY PRINTED VALUE COMES OUT OF THE ARTIFACT BYTES
 *
 * `§8` and `§9` forbid the builder from carrying an alternate authority. There is no
 * expected value in this file. The report shows what the bytes say, in a fixed order, so
 * that two builds of one release produce byte-identical reports and a reviewer diffing two
 * reports sees only what actually moved.
 *
 * `§49` control 11 — "release review omits authority-changing class-3 field" — is why every
 * one of `50 §2a`'s ten per-class fields is printed on its own line, plus the DERIVED
 * external-dispatch consequence of `adapter`. A report that omitted `adapter` would let a
 * change from `mock_processor` to `internal_only` — which removes an effect from the outbox
 * entirely — pass an owner's eye unchanged.
 * =================================================================================
 */

function line(label: string, value: string | number | boolean): string {
  return `${label}: ${String(value)}`;
}

function section(title: string): string {
  return `\n${'='.repeat(78)}\n${title}\n${'='.repeat(78)}`;
}

export interface ReleaseReviewOptions {
  readonly releaseChannel: string;
  readonly note: string | null;
  /** Present only once the ceremony has completed. */
  readonly manifestId?: string;
}

/**
 * Render the report from a candidate and the exact artifact bytes it points at.
 *
 * Deterministic by construction: no clock, no hostname, no path, no random value, and every
 * map printed in sorted key order.
 */
export function renderReleaseReview(
  candidate: ReleaseCandidate,
  bytesByClass: ReadonlyMap<number, Buffer>,
  options: ReleaseReviewOptions,
): string {
  const out: string[] = [];

  out.push('ACOS CONTROL-ARTIFACT RELEASE REVIEW');
  out.push('');
  out.push(
    'THIS REPORT IS FOR HUMAN APPROVAL. IT IS NOT SIGNED AUTHORITY AND NO RUNTIME READS IT.',
  );
  out.push(
    'The signed authority is the artifact bytes and 50 §3d’s manifest core. This report is a',
  );
  out.push('rendering of those bytes and nothing else.');
  if (options.releaseChannel === 'TEST_ONLY') {
    out.push('');
    out.push('*** TEST ONLY — THIS RELEASE IS NOT A PRODUCTION RELEASE ***');
    out.push('*** Its signatures were produced by keys that are not owner production roots. ***');
  }

  out.push(section('1. RELEASE IDENTITY'));
  out.push(line('release_channel', options.releaseChannel));
  out.push(line('candidate_id (review identity, NOT the deployment pin)', candidate.candidateId));
  out.push(
    line(
      'manifest_id (50 §3e, the deployment pin)',
      options.manifestId ??
        'NOT YET COMPUTABLE — 50 §3d puts both per-entry signatures inside the core, ' +
          'so the manifest identity exists only after both approvals',
    ),
  );
  out.push(line('manifest_format_version', candidate.manifestFormatVersion));
  out.push(line('manifest_epoch (lineage and legibility only; NEVER a selector)', candidate.manifestEpoch));
  out.push(line('expected_primary_key_id', candidate.expectedPrimaryKeyId));
  out.push(line('expected_second_factor_key_id', candidate.expectedSecondFactorKeyId));
  out.push(line('entry_count', candidate.entryCount));
  if (options.note !== null) out.push(line('operator note (NON-AUTHORITATIVE)', options.note));

  out.push(section('2. THE CLOSED ARTIFACT SET (50 §6)'));
  for (const entry of candidate.entries) {
    out.push('');
    out.push(`  class ${String(entry.artifactClass)}`);
    out.push(`    artifact_id      ${entry.artifactId}`);
    out.push(`    artifact_version ${entry.artifactVersion}`);
    out.push(`    content_hash     ${entry.contentHash}`);
    out.push(`    bytes            ${String(entry.byteLength)}`);
    out.push(`    package file     ${entry.packageFileName}`);
  }

  const class3 = bytesByClass.get(3);
  if (class3 !== undefined) {
    const decoded = decodeClass3(class3);
    out.push(section('3. CLASS 3 — THE ACTION CATALOGUE (50 §2a)'));
    out.push(line('artifact_id', decoded.artifactId));
    out.push(line('artifact_version', decoded.artifactVersion));
    out.push(line('action classes', decoded.actionClasses.length));
    for (const entry of decoded.actionClasses) {
      out.push('');
      out.push(`  ${entry.actionClass}`);
      out.push(`    recoverability                 ${entry.recoverability}`);
      out.push(`    value_direction                ${entry.valueDirection}`);
      out.push(`    carries_vendor_monetary_field  ${String(entry.carriesVendorMonetaryField)}`);
      out.push(`    cost_component_free            ${String(entry.costComponentFree)}`);
      out.push(`    rate_based                     ${String(entry.rateBased)}`);
      out.push(`    irrecoverable_units            ${entry.irrecoverableUnits}`);
      out.push(`    settlement_tolerance           ${entry.settlementTolerance}`);
      out.push(`    adapter                        ${entry.adapter}`);
      out.push(`    method                         ${entry.method}`);
      out.push(`    external dispatch (DERIVED from adapter, 50 §2f)  ${entry.externalDispatch}`);
    }
    out.push('');
    out.push(line('reason_codes', decoded.reasonCodes.join(', ')));
    out.push('reason_code_scopes:');
    for (const key of Object.keys(decoded.reasonCodeScopes).sort()) {
      out.push(`    ${key} -> ${String(decoded.reasonCodeScopes[key])}`);
    }
    out.push('semantic_option_digest_fields:');
    for (const key of Object.keys(decoded.semanticOptionDigestFields).sort()) {
      out.push(`    ${key} -> [${(decoded.semanticOptionDigestFields[key] ?? []).join(', ')}]`);
    }
    out.push('enumeration max_age (seconds):');
    for (const key of Object.keys(decoded.enumerationMaxAgeSeconds).sort()) {
      out.push(`    ${key} -> ${String(decoded.enumerationMaxAgeSeconds[key])}`);
    }
  }

  const class27 = bytesByClass.get(27);
  if (class27 !== undefined) {
    const decoded = decodeClass27(class27);
    out.push(section('4. CLASS 27 — THE DEGRADED-MODE CONFIGURATION (50 §2c)'));
    out.push(line('artifact_id', decoded.artifactId));
    out.push(line('artifact_version', decoded.artifactVersion));
    out.push('');
    out.push('  50 §2c closes this class at EXACTLY FOUR static quantities:');
    for (const name of CLASS_27_QUANTITY_NAMES) {
      out.push(`    ${name.padEnd(46)} ${String(decoded.quantities[name])}`);
    }
    for (const key of Object.keys(decoded.quantities).sort()) {
      if (CLASS_27_QUANTITY_NAMES.includes(key)) continue;
      out.push(`    ${key} ${String(decoded.quantities[key])}`);
    }
  }

  const class20 = bytesByClass.get(20);
  if (class20 !== undefined) {
    const decoded = decodeClass20(class20);
    const entry = candidate.entries.find((row) => row.artifactClass === 20);
    out.push(section('5. CLASS 20 — THE ACOS-JCS-1 SPECIFICATION (50 §2b)'));
    out.push(line('artifact_version', entry?.artifactVersion ?? 'ABSENT'));
    out.push(line('content_hash', entry?.contentHash ?? 'ABSENT'));
    out.push(line('bytes', decoded.byteLength));
    out.push(line('first line', decoded.specificationVersionLine));
    out.push(line('contains a 0x0D byte (a CRLF copy is a DIFFERENT artifact)', decoded.carriesCarriageReturn));
    out.push(line('ends with LF', decoded.endsWithNewline));
    out.push('');
    out.push('  A valid class-20 signature proves this is the OWNER-APPROVED specification.');
    out.push('  IT PROVES NO IMPLEMENTATION CONFORMS TO IT. Conformance remains 36 §2’s VC-A3.');
  }

  const class2 = bytesByClass.get(2);
  if (class2 !== undefined) {
    const decoded = decodeClass2(class2);
    const entry = candidate.entries.find((row) => row.artifactClass === 2);
    out.push(section('6. CLASS 2 — THE CEDAR POLICY-SET BUNDLE (50 §2e)'));
    out.push(line('artifact_id', decoded.artifactId));
    out.push(line('artifact_version', decoded.artifactVersion));
    out.push(line('content_hash (THE SIGNED CLASS-2 IDENTITY)', entry?.contentHash ?? 'ABSENT'));
    out.push(
      line('policy_version (26 §11 decision-record digest — NOT the content hash)', decoded.policyVersion),
    );
    out.push(line('schema digest', decoded.schemaDigest));
    out.push(line('schema bytes', decoded.schemaByteLength));
    out.push(line('policy files', decoded.policies.length));
    for (const policy of decoded.policies) {
      out.push(`    ${policy.id.padEnd(40)} ${policy.sourceDigest} (${String(policy.sourceByteLength)} bytes)`);
    }
  }

  const class19 = bytesByClass.get(19);
  if (class19 !== undefined) {
    const decoded = decodeClass19(class19);
    const entry = candidate.entries.find((row) => row.artifactClass === 19);
    out.push(section('7. CLASS 19 — THE EFFECT CONSTRUCTORS (50 §2 row 19, 50 §3i)'));
    out.push(line('artifact_id', decoded.artifactId));
    out.push(line('artifact_version', decoded.artifactVersion));
    out.push(line('content_hash', entry?.contentHash ?? 'ABSENT'));
    out.push(line('constructor records', decoded.records.length));
    for (const record of decoded.records) {
      out.push(
        `    ${record.constructorId.padEnd(40)} ${record.actionClass.padEnd(24)} ` +
          `semantic_major=${String(record.semanticMajor)} ` +
          `non_semantic_minor=${String(record.nonSemanticMinor)}`,
      );
    }
  }

  const class24 = bytesByClass.get(24);
  if (class24 !== undefined) {
    const decoded = decodeClass24(class24);
    const entry = candidate.entries.find((row) => row.artifactClass === 24);
    out.push(section('8. CLASS 24 — THE AUDIT-PLANE PUBLISHED VERIFYING KEY (50 §2 row 24)'));
    out.push(line('artifact_id', decoded.artifactId));
    out.push(line('artifact_version', decoded.artifactVersion));
    out.push(line('content_hash', entry?.contentHash ?? 'ABSENT'));
    out.push(line('published key_id', decoded.publicKeyId));
    out.push('  This is a PUBLIC key. No private half appears in a release.');
  }

  out.push(section('9. WHAT THIS REVIEW DOES NOT DECIDE'));
  out.push('  * It does not say the release is safe. 50 §5: "A signed artifact that is wrong"');
  out.push('    is outside what the manifest protects.');
  out.push('  * It does not prove any implementation conforms to class 20 (36 §2, VC-A3).');
  out.push('  * It does not prove Cedar semantic correctness (50 §2e).');
  out.push('  * It does not prove a human custodian separation. That is operational evidence');
  out.push('    outside this repository (§38).');
  out.push('');

  return out.join('\n');
}

/** Render and write the report beside a release. Never inside `package/`. */
export function writeReleaseReview(
  releaseRoot: string,
  options?: { readonly manifestId?: string },
): string {
  const { candidate, bytesByClass } = readCandidateAndPackage(releaseRoot);
  const metadata = readReleaseMetadata(releaseRoot, candidate);
  const report = renderReleaseReview(candidate, bytesByClass, {
    releaseChannel: metadata.releaseChannel,
    note: metadata.note,
    ...(options?.manifestId === undefined ? {} : { manifestId: options.manifestId }),
  });
  writeFileSync(join(releaseRoot, RELEASE_LAYOUT.reviewFile), report, 'utf8');
  return report;
}
