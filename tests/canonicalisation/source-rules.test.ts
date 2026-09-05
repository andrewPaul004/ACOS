import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Rules about the source tree, asserted against the source tree.
 *
 * S1A established the technique in `tests/integration/exposure/lock-order.test.ts`, which
 * reads `src/` and fails if a second `FOR UPDATE` acquisition site exists. A rule written
 * only as a comment is a rule a future edit breaks silently; a rule with a test is a rule.
 *
 * Four rules here, each closing a way an S1B property could erode without anyone noticing.
 */

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

/** Source with block and line comments removed. The rules are about executable code. */
function codeOf(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('rule 1 — nothing in src/ may parse rationale', () => {
  /**
   * `26 §2.0`: "NEVER parsed, NEVER interpreted as authority."
   *
   * Two modules may NAME it: `intent.ts`, which seals it at the wire boundary, and
   * `rationale.ts`, which holds the seal. `lineage.ts` consumes the commitment through
   * `rationaleCommitment` and never touches the text.
   */
  const permitted = new Set([
    join('src', 'kernel', 'canonicalisation', 'intent.ts'),
    join('src', 'kernel', 'canonicalisation', 'rationale.ts'),
    join('src', 'kernel', 'canonicalisation', 'lineage.ts'),
    // errors.ts names the deny detail RATIONALE_TOO_LONG and nothing else. That is a
    // schema-validation OUTCOME, not a read of content, and the assertion below pins it to
    // exactly that one token so the exemption cannot quietly widen.
    join('src', 'kernel', 'canonicalisation', 'errors.ts'),
  ]);

  it('errors.ts names only the deny detail, never the field', () => {
    const code = codeOf(join('src', 'kernel', 'canonicalisation', 'errors.ts'));
    const hits = [...code.matchAll(/\w*rationale\w*/gi)].map((m) => m[0]);
    expect([...new Set(hits)]).toEqual(['RATIONALE_TOO_LONG']);
  });

  it('no other file in src/ references rationale at all', () => {
    const offenders = walk('src').filter(
      (file) => !permitted.has(file) && /rationale/i.test(codeOf(file)),
    );
    expect(offenders, `unexpected rationale references: ${offenders.join(', ')}`).toHaveLength(0);
  });

  it('and the three permitted files still exist, so the rule is not vacuous', () => {
    for (const file of permitted) {
      expect(readFileSync(file, 'utf8').length).toBeGreaterThan(0);
    }
  });

  it('lineage.ts touches only the commitment, never the text', () => {
    const code = codeOf(join('src', 'kernel', 'canonicalisation', 'lineage.ts'));
    expect(code).toContain('rationaleCommitment(intent.rationale)');
    // `sealRationale` is the only producer of text-bearing input and belongs to intent.ts.
    expect(code).not.toContain('sealRationale');
  });
});

describe('rule 2 — JSON.stringify is never an authority-bearing byte representation', () => {
  /**
   * `30 §5.3`'s whole point is that a serialisation used for hashing must be specified.
   * `JSON.stringify` preserves object insertion order, so a hash taken over it is a hash
   * over how an object happened to be built.
   */
  it('no file under src/kernel/canonicalisation/ calls JSON.stringify', () => {
    const offenders = walk(join('src', 'kernel', 'canonicalisation')).filter((file) =>
      codeOf(file).includes('JSON.stringify'),
    );
    expect(offenders, `JSON.stringify in: ${offenders.join(', ')}`).toHaveLength(0);
  });

  it('the RFC 8785 string serialiser is written out rather than delegated', () => {
    const code = codeOf(join('src', 'kernel', 'canonicalisation', 'canonicalBytes.ts'));
    expect(code).toContain('function jcsString');
    expect(code).toContain("normalize('NFC')");
  });
});

describe('rule 3 — the independent oracle imports nothing from src/', () => {
  /**
   * `36 §0`, verbatim: "Independent validation must not call the same production function
   * twice and call agreement proof."
   *
   * `ADR-021`: "a second implementation or a hand-computed fixture table. 46 R1 is
   * explicit: a test that calls the same function twice proves nothing."
   */
  const oracle = join('tests', 'support', 'canonicalisationOracle.ts');

  it('there is no import of src/ anywhere in the oracle', () => {
    const source = readFileSync(oracle, 'utf8');
    expect(source).not.toMatch(/from\s+['"][^'"]*src\//);
    expect(source).not.toMatch(/import\s*\(\s*['"][^'"]*src\//);
    expect(source).not.toMatch(/require\s*\(/);
  });

  it('the oracle has no imports at all, which is the strongest form of the rule', () => {
    const code = codeOf(oracle);
    expect(code).not.toMatch(/^\s*import\s/m);
  });

  it('the oracle reproduces its own hand-authored figures by its own arithmetic', async () => {
    // The S1A oracle-self-check discipline: a typo in either the constant or the arithmetic
    // is caught before the fixture is used to judge production code.
    const {
      VC_C1,
      VC_C1_MUTATED_FEE,
      oracleMutatedTotalExposureMinor,
      oracleRetainedFeeMinor,
      oracleTotalExposureMinor,
    } = await import('../support/canonicalisationOracle.js');
    expect(oracleRetainedFeeMinor()).toBe(VC_C1.expectedRetainedFeeMinor);
    expect(oracleRetainedFeeMinor()).toBe(103n);
    expect(oracleTotalExposureMinor()).toBe(VC_C1.expectedTotalExposureMinor);
    expect(oracleTotalExposureMinor()).toBe(2603n);
    expect(oracleMutatedTotalExposureMinor()).toBe(VC_C1_MUTATED_FEE.expectedTotalExposureMinor);
    expect(oracleMutatedTotalExposureMinor()).toBe(2610n);
  });
});

describe('rule 5 — S1B knows no processor fee schedule (S1B.1, clarification S1B-C3a)', () => {
  /**
   * The withdrawn S1B-C3 asserted `round_half_away(vendor_amount × 2.9%) + $0.30` on the
   * strength of the architecture's printed `$1.03`. Reproducing a figure does not entitle
   * an implementation to the rule that reproduces it, and a fee schedule left lying in the
   * tree is a standing invitation to derive from it again.
   *
   * So the rule is asserted rather than intended: no percentage arithmetic, no fee-schedule
   * type, and no rate constant anywhere on the S1B surface. The fee is an AMOUNT on the
   * authoritative context.
   */
  const surface = [
    ...walk(join('src', 'kernel', 'canonicalisation')),
    join('tests', 'support', 'canonicalisationOracle.ts'),
    join('tests', 'support', 'canonicalisationFixture.ts'),
  ];

  it('no fee schedule type or rate constant survives anywhere', () => {
    for (const file of surface) {
      const code = codeOf(file);
      for (const needle of [
        'ProcessorFeeSchedule',
        'feeSchedule',
        'percentageNumerator',
        'percentageDenominator',
        'feePercentNumerator',
        'scheduleRef',
        'divideRoundHalfAway',
      ]) {
        expect(code, `${file} still carries ${needle}`).not.toContain(needle);
      }
    }
  });

  it('the refund constructor performs no multiplication and no rounding', () => {
    const code = codeOf(join('src', 'kernel', 'canonicalisation', 'constructors', 'refundCreate.ts'));
    // `add` is the only money operation a constructor that ADDS authoritative components
    // needs. `mulByRational` is S1A's rate primitive and has no business on this path.
    expect(code).not.toContain('mulByRational');
    expect(code).toMatch(/import \{ add, toDb, type Money \}/);
  });

  it('the oracle carries no rate, no fixed charge and no rounding primitive', () => {
    const code = codeOf(join('tests', 'support', 'canonicalisationOracle.ts'));
    expect(code).not.toMatch(/29n|1000n|30n/);
    expect(code).not.toMatch(/2\.9|0\.029/);
    // What it DOES carry: the two hand-authored figures the architecture prints.
    expect(code).toContain('103n');
    expect(code).toContain('2603n');
  });
});

describe('rule 6 — window_refs are not catalogue-derived (S1B.1, clarification S1B-C5a)', () => {
  /**
   * `26 §2.1`: "every named window the matching grants reference". The superseded S1B-C5
   * read them off the closed action catalogue. Catalogue membership is not grant
   * resolution, so the catalogue no longer declares windows at all and this rule keeps it
   * that way. The behavioural proof is
   * `tests/canonicalisation/window-ref-provenance.test.ts`.
   */
  it('the action catalogue declares no windows', () => {
    const code = codeOf(join('src', 'kernel', 'canonicalisation', 'actionCatalogue.ts'));
    expect(code).not.toContain('declaredWindows');
    expect(code).not.toMatch(/W_[A-Z_]+/);
  });

  it('no module in src/ reads a catalogue window field into window_refs', () => {
    for (const file of walk(join('src', 'kernel', 'canonicalisation'))) {
      expect(codeOf(file), `${file} derives windows from the catalogue`).not.toMatch(
        /catalogue\w*\.\w*[Ww]indow/,
      );
    }
  });

  it('the grant/window boundary is a declaration and resolves nothing', () => {
    // No Cedar, no policy engine, no grant matching — the boundary is a type and its
    // rationale, and S1B claims nothing more. The check is on EXECUTABLE code: the prose
    // above the type says "It is not Cedar", which is the disclaimer, not an engine.
    const code = codeOf(join('src', 'kernel', 'canonicalisation', 'grantWindows.ts'));
    expect(code).not.toMatch(/^\s*(export\s+)?(function|const|class)\s/m);
    for (const needle of ['cedar', 'Cedar', 'permit(']) {
      expect(code, `grantWindows.ts references ${needle}`).not.toContain(needle);
    }
  });
});

describe('rule 4 — S1B did not touch the accepted S1A exposure ledger', () => {
  /**
   * `phase2-v1.3-implementation-brief.md §7` treats a weakened `I3` as a PASS-revocation
   * trigger, and S1A's suite is the detector for it. S1B's own guarantee is narrower and
   * simpler: it added no code to that tree at all.
   */
  it('the canonicaliser imports only Money from src/kernel/exposure/', () => {
    const imports = walk(join('src', 'kernel', 'canonicalisation'))
      .flatMap((file) => [...codeOf(file).matchAll(/from '([^']*exposure\/[^']*)'/g)])
      .map((match) => match[1]!);
    expect(imports.length).toBeGreaterThan(0);
    for (const specifier of imports) {
      expect(specifier, `unexpected exposure import ${specifier}`).toMatch(/money\.js$/);
    }
  });

  it('the reservation handoff is a port and opens no transaction', () => {
    const code = codeOf(join('src', 'kernel', 'canonicalisation', 'ports', 'reservationHandoff.ts'));
    for (const needle of ['FOR UPDATE', 'BEGIN', 'query(', 'Client', 'pool']) {
      expect(code, `reservationHandoff.ts references ${needle}`).not.toContain(needle);
    }
  });
});
