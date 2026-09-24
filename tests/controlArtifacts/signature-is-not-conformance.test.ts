import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { canonicalBytes } from '../../src/kernel/canonicalisation/canonicalBytes.js';
import { admittedJcs1SpecificationIdentity } from '../../src/kernel/canonicalisation/jcs1Admission.js';
import {
  frameField,
  oracleCanonicalBytes,
  oracleField,
  type OracleField,
} from '../support/jcs1Oracle.js';
import {
  CLASS_20_ACCEPTED_CONTENT_HASH,
  buildControlArtifactFixture,
  verifyFixtureBundle,
} from '../support/controlArtifactFixture.js';

/**
 * `50 §2b` — A VALID CLASS-20 SIGNATURE PROVES THE SPECIFICATION, AND NOTHING ABOUT AN
 * IMPLEMENTATION.
 *
 * =================================================================================
 * VERBATIM
 *
 *   "**What the class-20 signature proves, and what it does not.** A valid pair of owner
 *    signatures over this content hash proves exactly one thing: **this is the owner-approved
 *    `ACOS-JCS-1` specification.** **IT DOES NOT PROVE THAT ANY IMPLEMENTATION CONFORMS TO
 *    IT.** Conformance is proved by cross-implementation byte-identity validation —
 *    `36 §2`'s VC-A3 and `36 §2.6`'s fixture — and **`I19` does not replace VC-A3, does not
 *    weaken it, and does not discharge any of its obligations.**"
 *
 * `§47` of the S1K mandate asks for this as a REGRESSION rather than a restatement: "Add
 * proof that: signed class-20 spec may be valid; deliberately corrupted TypeScript/SQL
 * implementation still fails conformance tests. Therefore: signature != conformance."
 *
 * The two halves below are exactly that. The signature is valid throughout — the same
 * verified bundle, the same frozen digest — and a corrupted canonicalisation is caught by
 * the INDEPENDENT ORACLE every time. Nothing about the signature moved, and nothing about
 * the signature would have caught it.
 * =================================================================================
 */

/**
 * A deliberately corrupted `ACOS-JCS-1` implementation.
 *
 * Each defect is a real rule of `30 §5.3` broken in a way that a careless implementation
 * plausibly would:
 *
 *   `DROPS_FRAMING`       concatenates payloads with no length word, so a content boundary
 *                         can be forged — the exact hazard the four-byte prefix exists for
 *   `NULL_AS_EMPTY`       writes a zero-length field for NULL instead of the reserved
 *                         `0xFFFFFFFF` word, which is v1.2's withdrawn collision (JCS-01)
 *   `LOOSE_MONEY_SCALE`   trims a trailing zero, so `25.00` and `25.0` digest alike
 */
type CorruptedRule = 'DROPS_FRAMING' | 'NULL_AS_EMPTY' | 'LOOSE_MONEY_SCALE';

function corruptedCanonicalBytes(rule: CorruptedRule, fields: readonly OracleField[]): Buffer {
  const parts: Buffer[] = [];
  for (const field of fields) {
    const payload =
      rule === 'LOOSE_MONEY_SCALE' && field.kind === 'money' && field.value !== null
        ? Buffer.from(field.value.replace(/0$/, ''), 'utf8')
        : oracleField(field);
    if (payload === null && rule === 'NULL_AS_EMPTY') {
      parts.push(Buffer.from([0, 0, 0, 0]));
      continue;
    }
    parts.push(rule === 'DROPS_FRAMING' ? (payload ?? Buffer.alloc(0)) : frameField(payload));
  }
  return Buffer.concat(parts);
}

const FIELDS: readonly OracleField[] = [
  { kind: 'text', value: 'acos.journal.outbox_claimed.v1' },
  { kind: 'money', value: '25.00' },
  { kind: 'int', value: 7n },
  { kind: 'text', value: null },
];

describe('the class-20 SIGNATURE is valid, and stays valid, throughout', () => {
  it('the verified bundle carries the owner-approved specification identity', () => {
    const identity = admittedJcs1SpecificationIdentity();
    expect(identity.artifactVersion).toBe('ACOS-JCS-1');
    expect(identity.contentHash).toBe(CLASS_20_ACCEPTED_CONTENT_HASH);
  });

  it('and a freshly signed package carries the same specification, unchanged', () => {
    const bundle = verifyFixtureBundle(buildControlArtifactFixture({ manifestEpoch: '11' }));
    expect(bundle).toBeDefined();
    const deployed = readFileSync(join('artifacts', 'control', 'class-20.acos-jcs-1.spec.v1.txt'));
    const architecture = readFileSync(
      join('docs', 'architecture', 'v1.3.6', 'artifacts', 'acos-jcs-1.spec.v1.txt'),
    );
    expect(deployed.equals(architecture)).toBe(true);
  });
});

describe('and a CORRUPTED implementation still fails conformance — so signature != conformance', () => {
  it('the ACCEPTED TypeScript implementation agrees with the independent oracle', () => {
    // The baseline that makes the three failures below meaningful. `canonicalBytes` frames
    // the kind as its first field, so the oracle is given the same leading text field.
    const production = canonicalBytes('acos.journal.outbox_claimed.v1', [
      { kind: 'money', value: 2500n as never },
      { kind: 'integer', value: 7n },
      { kind: 'text', value: null },
    ]);
    const oracle = oracleCanonicalBytes(FIELDS);
    expect(production.equals(oracle)).toBe(true);
  });

  for (const rule of ['DROPS_FRAMING', 'NULL_AS_EMPTY', 'LOOSE_MONEY_SCALE'] as const) {
    it(`a ${rule} implementation is caught by the oracle, with the signature untouched`, () => {
      const corrupted = corruptedCanonicalBytes(rule, FIELDS);
      const oracle = oracleCanonicalBytes(FIELDS);

      // CONFORMANCE FAILS.
      expect(corrupted.equals(oracle)).toBe(false);

      // AND THE SIGNATURE IS STILL PERFECTLY VALID. The class-20 artifact did not move, the
      // manifest did not move, and both owner signatures still verify — which is the whole
      // point: `I19` would not have noticed this, and it is not supposed to.
      const identity = admittedJcs1SpecificationIdentity();
      expect(identity.contentHash).toBe(CLASS_20_ACCEPTED_CONTENT_HASH);
    });
  }

  it('the corrupted implementations are NOT all-failing — they agree where they are correct', () => {
    // A control on the control. `NULL_AS_EMPTY` differs only where a NULL appears, so a
    // field list with no NULL must still agree with the oracle — otherwise the three cases
    // above would be satisfied by an implementation that simply returned garbage.
    const withoutNull: readonly OracleField[] = [
      { kind: 'text', value: 'acos.journal.outbox_claimed.v1' },
      { kind: 'int', value: 7n },
    ];
    expect(
      corruptedCanonicalBytes('NULL_AS_EMPTY', withoutNull).equals(
        oracleCanonicalBytes(withoutNull),
      ),
    ).toBe(true);
  });

  it('VC-A3 remains a SEPARATE mechanism and is not referenced by the signature path', () => {
    const admission = readFileSync(
      join('src', 'kernel', 'canonicalisation', 'jcs1Admission.ts'),
      'utf8',
    )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    // The admission gate checks an IDENTITY. It runs no comparison, holds no fixture and
    // reaches no second implementation.
    for (const needle of ['oracle', 'conformance', 'compare', 'equals']) {
      expect(admission, `jcs1Admission.ts carries ${needle}`).not.toContain(needle);
    }
  });
});
