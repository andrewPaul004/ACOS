import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { RELEASE_LAYOUT, readCandidateAndPackage } from '../../tools/control-release/candidate.js';
import { compareReleases, renderComparison } from '../../tools/control-release/compare.js';
import { decodeClass2, policyVersionDigest } from '../../tools/control-release/decode.js';
import { renderReleaseReview, writeReleaseReview } from '../../tools/control-release/review.js';
import {
  unsafeDiffIgnoringDegradedConfiguration,
  unsafeReleaseReviewOmittingAdapter,
} from '../negative-controls/unsafe-release-ceremony.js';
import { ACCEPTED_POLICY_VERSION } from '../support/controlArtifactFixture.js';
import {
  buildCandidateFixture,
  completeReleaseFixture,
  scratchDirectory,
} from '../support/releaseCeremonyFixture.js';

/**
 * `§31` AND `§32` — THE HUMAN-REVIEW REPORT AND THE AUTHORITY DIFF.
 *
 * =================================================================================
 * THE REPORT IS FOR A PERSON. IT IS NOT AUTHORITY.
 *
 * `§31`: "The report is for human approval. **It is NOT signed authority unless architecture
 * says it is part of the signed envelope.**" `50 §3d`'s core carries six fields; a review
 * report is none of them, and the first test below proves that by deleting the report and
 * rebuilding the release to the same identity.
 * =================================================================================
 */

function rewriteClass3(bytes: Buffer, edit: (document: Record<string, unknown>) => void): Buffer {
  const document = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>;
  edit(document);
  return Buffer.from(`${JSON.stringify(document, null, 2)}\n`, 'utf8');
}

function repositoryBytes(artifactClass: number): Buffer {
  const fixture = buildCandidateFixture({ dir: scratchDirectory('acos-s1l-bytes-') });
  return readCandidateAndPackage(fixture.releaseRoot).bytesByClass.get(artifactClass)!;
}

describe('§31 — the review report shows every authority-relevant field', () => {
  it('is deterministic and outside both identities', () => {
    const a = completeReleaseFixture({ dir: scratchDirectory('acos-s1l-rep-a-') });
    const b = completeReleaseFixture({ dir: scratchDirectory('acos-s1l-rep-b-') });
    const reportA = readFileSync(join(a.releaseRoot, RELEASE_LAYOUT.reviewFile), 'utf8');
    const reportB = readFileSync(join(b.releaseRoot, RELEASE_LAYOUT.reviewFile), 'utf8');
    expect(reportB).toBe(reportA);

    // Deleting the report changes no identity: it is beside the release, never inside it.
    rmSync(join(a.releaseRoot, RELEASE_LAYOUT.reviewFile));
    const { candidate } = readCandidateAndPackage(a.releaseRoot);
    expect(candidate.candidateId).toBe(b.written.candidate.candidateId);
    // And the package manifest is untouched by the report's absence.
    expect(readFileSync(join(a.completed.packageRoot, 'manifest.json'), 'utf8')).toBe(
      readFileSync(join(b.completed.packageRoot, 'manifest.json'), 'utf8'),
    );
  });

  it('CLASS 3 — all ten 50 §2a fields plus the DERIVED external-dispatch setting', () => {
    const fixture = buildCandidateFixture();
    const report = writeReleaseReview(fixture.releaseRoot);
    for (const field of [
      'recoverability',
      'value_direction',
      'carries_vendor_monetary_field',
      'cost_component_free',
      'rate_based',
      'irrecoverable_units',
      'settlement_tolerance',
      'adapter',
      'method',
      'external dispatch (DERIVED from adapter, 50 §2f)',
      'reason_codes',
      'reason_code_scopes',
      'semantic_option_digest_fields',
      'enumeration max_age',
    ]) {
      expect(report, `the review omits ${field}`).toContain(field);
    }
    // And the actual current values a reviewer would judge.
    expect(report).toContain('refund.create');
    expect(report).toContain('COMPENSABLE');
    expect(report).toContain('mock_processor');
    expect(report).toContain('fulfilment.reship');
    expect(report).toContain('IRRECOVERABLE');
    expect(report).toContain('EXTERNAL_DISPATCH');
  });

  it('CLASS 27 — 50 §2c’s exactly four quantities, at their current values', () => {
    const fixture = buildCandidateFixture();
    const report = writeReleaseReview(fixture.releaseRoot);
    expect(report).toContain('mirror_lag_critical_threshold');
    expect(report).toContain('PT15M');
    expect(report).toContain('audit_unreachable_full_halt_threshold');
    expect(report).toContain('PT30M');
    expect(report).toContain('degraded_per_action_approval_floor_monetary');
    expect(report).toContain('20.00');
    expect(report).toContain('corroboration_signal_max_age');
    expect(report).toContain('PT5M');
  });

  it('CLASS 20 — the specification identity, its size and its line endings', () => {
    const fixture = buildCandidateFixture();
    const report = writeReleaseReview(fixture.releaseRoot);
    expect(report).toContain('ACOS-JCS-1');
    expect(report).toContain('7af60fc564aef296679ae06a34b188d3454ac7ef69f448f7260a3d5d55a18f33');
    expect(report).toContain('13479');
    expect(report).toContain('contains a 0x0D byte');
    // And the honest limit of what a class-20 signature proves.
    expect(report).toContain('IT PROVES NO IMPLEMENTATION CONFORMS TO IT');
  });

  it('CEDAR — the content hash and `policy_version` are printed SEPARATELY and labelled', () => {
    // `50 §2e`: "`policy_version` is NOT the class-2 content hash, and neither replaces the
    // other." `§11`: "Both may appear in release review output but must remain semantically
    // distinct."
    const fixture = buildCandidateFixture();
    const report = writeReleaseReview(fixture.releaseRoot);
    expect(report).toContain('content_hash (THE SIGNED CLASS-2 IDENTITY)');
    expect(report).toContain('policy_version (26 §11 decision-record digest — NOT the content hash)');
    expect(report).toContain(ACCEPTED_POLICY_VERSION);

    const { candidate } = readCandidateAndPackage(fixture.releaseRoot);
    const class2Entry = candidate.entries.find((entry) => entry.artifactClass === 2)!;
    expect(class2Entry.contentHash).not.toBe(ACCEPTED_POLICY_VERSION);
    expect(report).toContain(class2Entry.contentHash);
  });

  it('the release tool’s INDEPENDENT policy_version transcription reproduces the accepted digest', () => {
    // The tool re-derives `26 §11`'s digest from `30 §5.3`'s framing rather than importing
    // the production loader, so the agreement below is a real cross-check.
    const decoded = decodeClass2(repositoryBytes(2));
    expect(decoded.policyVersion).toBe(ACCEPTED_POLICY_VERSION);

    // And it is length-framed: a policy id renamed into another's text does not hold it still.
    const shifted = policyVersionDigest('schema', [
      { id: 'ab', source: 'c' },
      { id: 'a', source: 'bc' },
    ]);
    const other = policyVersionDigest('schema', [
      { id: 'a', source: 'bc' },
      { id: 'ab', source: 'c' },
    ]);
    // Sorted by id, so these two are the SAME set and digest alike…
    expect(other).toBe(shifted);
    // …while a genuine shift of bytes across the id/source boundary does not.
    expect(policyVersionDigest('schema', [{ id: 'abc', source: '' }])).not.toBe(
      policyVersionDigest('schema', [{ id: 'ab', source: 'c' }]),
    );
  });

  it('CLASS 19 — the constructor records the release carries', () => {
    const fixture = buildCandidateFixture();
    const report = writeReleaseReview(fixture.releaseRoot);
    expect(report).toContain('acos.constructor.refund.create');
    expect(report).toContain('semantic_major=1');
    expect(report).toContain('non_semantic_minor=0');
  });

  it('a TEST_ONLY release is banner-labelled, and a PRODUCTION one is not (§47)', () => {
    const test = buildCandidateFixture({ dir: scratchDirectory('acos-s1l-lbl-t-') });
    expect(writeReleaseReview(test.releaseRoot)).toContain('*** TEST ONLY');

    const production = buildCandidateFixture({
      dir: scratchDirectory('acos-s1l-lbl-p-'),
      releaseChannel: 'PRODUCTION',
    });
    expect(writeReleaseReview(production.releaseRoot)).not.toContain('*** TEST ONLY');
  });

  it('before the ceremony the report says the manifest identity does not exist yet', () => {
    const fixture = buildCandidateFixture();
    expect(writeReleaseReview(fixture.releaseRoot)).toContain('NOT YET COMPUTABLE');
  });

  it('VULNERABLE CONTROL 11 — a review omitting `adapter` hides an outbox-scope change', () => {
    const original = repositoryBytes(3);
    // `50 §2f`: `adapter = internal_only` "removes an effect from the outbox entirely".
    const rewired = rewriteClass3(original, (document) => {
      const classes = document.action_classes as Record<string, unknown>[];
      classes.find((row) => row.action_class === 'refund.create')!.adapter = 'internal_only';
    });

    // THE DEFECT: byte-identical reports for two catalogues with different external-write
    // scope. An owner comparing them sees nothing.
    expect(unsafeReleaseReviewOmittingAdapter(rewired)).toBe(
      unsafeReleaseReviewOmittingAdapter(original),
    );

    // PRODUCTION: the change is on the face of the report, twice — the adapter itself and
    // the derived dispatch consequence.
    const before = buildCandidateFixture({ dir: scratchDirectory('acos-s1l-vc11-a-') });
    const after = buildCandidateFixture({
      dir: scratchDirectory('acos-s1l-vc11-b-'),
      overrides: [{ artifactClass: 3, bytes: rewired }],
    });
    const reportBefore = writeReleaseReview(before.releaseRoot);
    const reportAfter = writeReleaseReview(after.releaseRoot);
    expect(reportAfter).not.toBe(reportBefore);
    expect(reportBefore).toContain('mock_processor');
    expect(reportAfter).toContain('internal_only');
    expect(reportAfter).toContain('INTERNAL_ONLY');
  });

  it('the renderer takes the bytes it is given and invents no value', () => {
    const fixture = buildCandidateFixture();
    const { candidate, bytesByClass } = readCandidateAndPackage(fixture.releaseRoot);
    const report = renderReleaseReview(candidate, bytesByClass, {
      releaseChannel: 'TEST_ONLY',
      note: null,
    });
    // Every digest printed is one the candidate carries, and the candidate's digests were
    // computed from the bytes. No constant in the tool supplied any of them.
    for (const entry of candidate.entries) expect(report).toContain(entry.contentHash);
  });
});

describe('§32 — the diff exposes authority changes, and decides nothing', () => {
  const before = (): ReturnType<typeof buildCandidateFixture> =>
    buildCandidateFixture({ dir: scratchDirectory('acos-s1l-diff-a-') });

  function afterWith(overrides: { artifactClass: number; bytes: Buffer }[]): string {
    return buildCandidateFixture({ dir: scratchDirectory('acos-s1l-diff-b-'), overrides })
      .releaseRoot;
  }

  it('surfaces a recoverability change', () => {
    const base = before();
    const bytes = rewriteClass3(repositoryBytes(3), (document) => {
      const classes = document.action_classes as Record<string, unknown>[];
      classes.find((row) => row.action_class === 'refund.create')!.recoverability = 'IRRECOVERABLE';
    });
    const comparison = compareReleases(base.releaseRoot, afterWith([{ artifactClass: 3, bytes }]));
    expect(comparison.changes.map((row) => row.kind)).toContain('RECOVERABILITY_CHANGED');
  });

  it('surfaces an adapter change AND the derived external-dispatch change', () => {
    const base = before();
    const bytes = rewriteClass3(repositoryBytes(3), (document) => {
      const classes = document.action_classes as Record<string, unknown>[];
      classes.find((row) => row.action_class === 'refund.create')!.adapter = 'internal_only';
    });
    const kinds = compareReleases(
      base.releaseRoot,
      afterWith([{ artifactClass: 3, bytes }]),
    ).changes.map((row) => row.kind);
    expect(kinds).toContain('ADAPTER_CHANGED');
    expect(kinds).toContain('EXTERNAL_DISPATCH_CHANGED');
  });

  it('surfaces an irrecoverable-units change', () => {
    const base = before();
    const bytes = rewriteClass3(repositoryBytes(3), (document) => {
      const classes = document.action_classes as Record<string, unknown>[];
      classes.find((row) => row.action_class === 'fulfilment.reship')!.irrecoverable_units = '9';
    });
    expect(
      compareReleases(base.releaseRoot, afterWith([{ artifactClass: 3, bytes }])).changes.map(
        (row) => row.kind,
      ),
    ).toContain('IRRECOVERABLE_UNITS_CHANGED');
  });

  it('surfaces an added and a removed action class', () => {
    const base = before();
    const bytes = rewriteClass3(repositoryBytes(3), (document) => {
      const classes = document.action_classes as Record<string, unknown>[];
      document.action_classes = classes.filter((row) => row.action_class !== 'campaign.pause');
    });
    const kinds = compareReleases(
      base.releaseRoot,
      afterWith([{ artifactClass: 3, bytes }]),
    ).changes.map((row) => row.kind);
    expect(kinds).toContain('ACTION_CLASS_REMOVED');
  });

  it('surfaces a degraded-threshold change, and names the quantity', () => {
    const base = before();
    const bytes = Buffer.from(
      repositoryBytes(27).toString('utf8').replace('"PT30M"', '"PT6H"'),
      'utf8',
    );
    const comparison = compareReleases(base.releaseRoot, afterWith([{ artifactClass: 27, bytes }]));
    const row = comparison.changes.find((entry) => entry.kind === 'DEGRADED_THRESHOLD_CHANGED');
    expect(row?.subject).toBe('audit_unreachable_full_halt_threshold');
    expect(row?.before).toBe('PT30M');
    expect(row?.after).toBe('PT6H');
  });

  it('surfaces a Cedar policy change and a moved policy_version', () => {
    const base = before();
    const document = JSON.parse(repositoryBytes(2).toString('utf8')) as {
      policies: { id: string; source: string }[];
    };
    document.policies[0]!.source = `${document.policies[0]!.source}\n// reviewed\n`;
    const bytes = Buffer.from(`${JSON.stringify(document, null, 2)}\n`, 'utf8');
    const kinds = compareReleases(
      base.releaseRoot,
      afterWith([{ artifactClass: 2, bytes }]),
    ).changes.map((row) => row.kind);
    expect(kinds).toContain('CEDAR_POLICY_CHANGED');
    expect(kinds).toContain('CEDAR_POLICY_VERSION_CHANGED');
    expect(kinds).toContain('ARTIFACT_CONTENT_HASH_CHANGED');
  });

  it('surfaces an ACOS-JCS-1 specification change, including line endings alone', () => {
    const base = before();
    const crlf = Buffer.from(repositoryBytes(20).toString('utf8').replace(/\n/g, '\r\n'), 'utf8');
    const kinds = compareReleases(
      base.releaseRoot,
      afterWith([{ artifactClass: 20, bytes: crlf }]),
    ).changes.map((row) => row.kind);
    expect(kinds).toContain('JCS1_SPECIFICATION_CHANGED');
    expect(kinds).toContain('JCS1_LINE_ENDINGS_CHANGED');
  });

  it('surfaces a constructor-record change', () => {
    const base = before();
    const document = JSON.parse(repositoryBytes(19).toString('utf8')) as {
      records: Record<string, unknown>[];
    };
    document.records[0]!.semantic_major = 2;
    const bytes = Buffer.from(`${JSON.stringify(document, null, 2)}\n`, 'utf8');
    expect(
      compareReleases(base.releaseRoot, afterWith([{ artifactClass: 19, bytes }])).changes.map(
        (row) => row.kind,
      ),
    ).toContain('CONSTRUCTOR_RECORD_CHANGED');
  });

  it('reports no change between two builds of the same inputs, and says why that is not a licence', () => {
    const a = buildCandidateFixture({ dir: scratchDirectory('acos-s1l-same-a-') });
    const b = buildCandidateFixture({ dir: scratchDirectory('acos-s1l-same-b-') });
    const comparison = compareReleases(a.releaseRoot, b.releaseRoot);
    expect(comparison.changes).toEqual([]);
    expect(renderComparison(comparison)).toContain('still requires its own ceremony');
  });

  it('never renders a verdict about safety', () => {
    const a = buildCandidateFixture({ dir: scratchDirectory('acos-s1l-verdict-a-') });
    const bytes = Buffer.from(
      repositoryBytes(27).toString('utf8').replace('"PT30M"', '"PT6H"'),
      'utf8',
    );
    const text = renderComparison(
      compareReleases(a.releaseRoot, afterWith([{ artifactClass: 27, bytes }])),
    );
    expect(text).toContain('IT DOES NOT SAY WHETHER THE CHANGE IS SAFE');
    expect(text.toLowerCase()).not.toContain('approved');
    expect(text.toLowerCase()).not.toContain('safe to');
  });

  it('VULNERABLE CONTROL 12 — a diff scoped to the policy classes misses the halt threshold', () => {
    const base = before();
    const bytes = Buffer.from(
      repositoryBytes(27).toString('utf8').replace('"PT30M"', '"PT6H"'),
      'utf8',
    );
    const afterRoot = afterWith([{ artifactClass: 27, bytes }]);

    // THE DEFECT: class 27 is never read, so the quantity that decides whether the company
    // halts when the audit plane is unreachable moves silently.
    expect(unsafeDiffIgnoringDegradedConfiguration(base.releaseRoot, afterRoot)).toEqual([]);

    // PRODUCTION: it is reported, with the before and after values.
    const comparison = compareReleases(base.releaseRoot, afterRoot);
    expect(comparison.changes.map((row) => row.kind)).toContain('DEGRADED_THRESHOLD_CHANGED');
    expect(renderComparison(comparison)).toContain('PT6H');
  });
});
