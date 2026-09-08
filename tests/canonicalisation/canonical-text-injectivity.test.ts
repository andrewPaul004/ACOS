import { describe, expect, it } from 'vitest';

import {
  canonicalBytes,
  canonicalHash,
  hex,
  isCanonicalText,
  isWellFormedUnicode,
  jcs,
} from '../../src/kernel/canonicalisation/canonicalBytes.js';
import { CanonicalisationDenied } from '../../src/kernel/canonicalisation/errors.js';
import { parseProposedIntent } from '../../src/kernel/canonicalisation/intent.js';
import { makeRawIntent, makeRefundOption } from '../support/canonicalisationFixture.js';

/**
 * ACOS-JCS-1 CANONICAL TEXT MUST BE INJECTIVE OVER ACCEPTED STRINGS — S1B.2, finding 4.
 *
 * `30 §5.3` specifies the canonical form so that "the same fixture rows serialised by both
 * triggers must produce byte-identical output" can mean something. The unstated other half
 * is that DIFFERENT accepted values must produce DIFFERENT bytes. Independent review found
 * three places where they did not.
 *
 * ---------------------------------------------------------------------------------
 * 4A  null versus U+0000 text.  As S1B found it, `30 §5.3` encoded null as a single 0x00
 *     byte and a text value containing U+0000 UTF-8 encodes to the same single byte.
 *     PostgreSQL `text` cannot store U+0000, so it is excluded, and injectivity over text
 *     was restored. **v1.3.2 erratum JCS-01 superseded the reason**: the same argument did
 *     not extend to `bytea`, whose payload can be exactly one 0x00 byte, so NULL now uses
 *     the reserved framing word `0xFFFFFFFF` and injectivity against NULL is structural
 *     for every type. The U+0000 exclusion is RETAINED, unchanged and unrelaxed.
 *
 * 4B  Unpaired UTF-16 surrogates.  Node substitutes U+FFFD for each lone surrogate when
 *     encoding UTF-8, so two DISTINCT JavaScript strings — one holding U+D800, one holding
 *     U+D801 — encode to identical bytes. RFC 8785 §3.2.2.2 requires malformed Unicode data
 *     to fail; ACOS rejects before NFC and before encoding.
 *
 * 4C  NFC-normalised JSON key collisions.  ACOS adds an NFC rule RFC 8785 does not have, so
 *     two distinct source keys can normalise to one canonical name. Sorting pre-normalised
 *     keys and normalising while writing would emit an object carrying that name twice. The
 *     order is fixed — validate, normalise, REJECT a collision, sort the normalised names,
 *     serialise those.
 *
 * WHAT THIS FILE DOES NOT CHANGE, and deliberately does not touch: money encoding, timestamp
 * precision and field framing. Those rules are unchanged from S1B and are asserted by
 * `canonical-bytes.test.ts`.
 * ---------------------------------------------------------------------------------
 */

/**
 * The two lone surrogates, built from code units rather than written as literals — a source
 * file holding a lone surrogate is itself not well-formed text, which is the hazard.
 */
const LONE_HIGH_SURROGATE = String.fromCharCode(0xd800);
const ANOTHER_LONE_HIGH_SURROGATE = String.fromCharCode(0xd801);
const LONE_LOW_SURROGATE = String.fromCharCode(0xdc00);
/** U+1F600, a legitimate supplementary character — a properly paired surrogate pair. */
const SUPPLEMENTARY = String.fromCodePoint(0x1f600);
const NUL = String.fromCharCode(0);

describe('the hazard is real — this is why the rules exist', () => {
  it("Node's UTF-8 encoder collapses two DISTINCT lone surrogates to identical bytes", () => {
    // Stated first, against Node itself, so the rules below are demonstrably not theatre.
    expect(LONE_HIGH_SURROGATE).not.toBe(ANOTHER_LONE_HIGH_SURROGATE);
    expect(hex(Buffer.from(LONE_HIGH_SURROGATE, 'utf8'))).toBe(
      hex(Buffer.from(ANOTHER_LONE_HIGH_SURROGATE, 'utf8')),
    );
    // Both become U+FFFD, the replacement character.
    expect(hex(Buffer.from(LONE_HIGH_SURROGATE, 'utf8'))).toBe('efbfbd');
  });

  it('and a one-character NUL string encodes to the byte v1.2 used as the null sentinel', () => {
    expect(hex(Buffer.from(NUL, 'utf8'))).toBe('00');
    // v1.2's withdrawn sentinel was exactly this byte, which is the hazard S1B found and
    // closed for text by excluding U+0000. `30 §5.3` no longer carries NULL in a payload
    // byte at all (v1.3.2, JCS-01), so the sentinel this test names is historical — and
    // the exclusion below is still enforced, because JCS-01 did not relax it.
    expect(hex(canonicalBytes('k', [{ kind: 'text', value: null }]))).toBe('000000016bffffffff');
    expect(hex(canonicalBytes('k', [{ kind: 'text', value: null }]))).not.toContain('0000000100');
  });
});

describe('4A — null, empty string and U+0000', () => {
  it('null and the empty string remain DISTINCT, and both remain valid', () => {
    // Unchanged from S1B, and restated here because finding 4A must not have narrowed it.
    // The NULL bytes are v1.3.2's reserved word; the empty string is unchanged.
    expect(hex(canonicalBytes('k', [{ kind: 'text', value: null }]))).toBe('000000016bffffffff');
    expect(hex(canonicalBytes('k', [{ kind: 'text', value: '' }]))).toBe('000000016b00000000');
    expect(hex(canonicalHash('k', [{ kind: 'text', value: null }]))).not.toBe(
      hex(canonicalHash('k', [{ kind: 'text', value: '' }])),
    );
  });

  it('a text value containing U+0000 is REJECTED, so it cannot imitate the sentinel', () => {
    expect(() => canonicalHash('k', [{ kind: 'text', value: NUL }])).toThrow(
      /contains U\+0000/,
    );
    expect(() => canonicalHash('k', [{ kind: 'text', value: `a${NUL}b` }])).toThrow(
      /contains U\+0000/,
    );
  });

  it('U+0000 is rejected in a JSON string value and in a JSON object key', () => {
    expect(() => jcs({ note: NUL })).toThrow(/contains U\+0000/);
    expect(() => jcs({ [`k${NUL}`]: 'v' })).toThrow(/contains U\+0000/);
  });

  it('and the predicate agrees, so the wire boundary and the byte layer share one rule', () => {
    expect(isCanonicalText('')).toBe(true);
    expect(isCanonicalText('ordinary text')).toBe(true);
    expect(isCanonicalText(NUL)).toBe(false);
  });
});

describe('4B — unpaired UTF-16 surrogates are rejected, not substituted', () => {
  it('a lone HIGH surrogate is rejected', () => {
    expect(isWellFormedUnicode(LONE_HIGH_SURROGATE)).toBe(false);
    expect(() => canonicalHash('k', [{ kind: 'text', value: LONE_HIGH_SURROGATE }])).toThrow(
      /well-formed Unicode/,
    );
  });

  it('ANOTHER lone high surrogate is rejected too — neither reaches a hash', () => {
    // The pair is the point: if either were accepted they would hash identically, and the
    // byte layer would map two distinct values onto one.
    expect(isWellFormedUnicode(ANOTHER_LONE_HIGH_SURROGATE)).toBe(false);
    expect(() =>
      canonicalHash('k', [{ kind: 'text', value: ANOTHER_LONE_HIGH_SURROGATE }]),
    ).toThrow(/well-formed Unicode/);
  });

  it('a lone LOW surrogate is rejected', () => {
    expect(isWellFormedUnicode(LONE_LOW_SURROGATE)).toBe(false);
    expect(() => canonicalHash('k', [{ kind: 'text', value: LONE_LOW_SURROGATE }])).toThrow(
      /well-formed Unicode/,
    );
  });

  it('a high surrogate followed by a non-low code unit is rejected', () => {
    expect(isWellFormedUnicode(`${LONE_HIGH_SURROGATE}a`)).toBe(false);
  });

  it('a VALID supplementary character is ACCEPTED — the rule is not "reject surrogates"', () => {
    // Without this the rule could be satisfied by refusing every astral character, which
    // would be a different and much worse specification.
    expect(isWellFormedUnicode(SUPPLEMENTARY)).toBe(true);
    expect(isCanonicalText(SUPPLEMENTARY)).toBe(true);
    const digest = hex(canonicalHash('k', [{ kind: 'text', value: SUPPLEMENTARY }]));
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    // And it round-trips as four UTF-8 bytes, not as a replacement character.
    expect(hex(Buffer.from(SUPPLEMENTARY, 'utf8'))).toBe('f09f9880');
  });

  it('distinct supplementary characters still hash differently', () => {
    const other = String.fromCodePoint(0x1f601);
    expect(hex(canonicalHash('k', [{ kind: 'text', value: SUPPLEMENTARY }]))).not.toBe(
      hex(canonicalHash('k', [{ kind: 'text', value: other }])),
    );
  });

  it('lone surrogates are rejected in JSON string values and in JSON object keys', () => {
    expect(() => jcs({ note: LONE_HIGH_SURROGATE })).toThrow(/well-formed Unicode/);
    expect(() => jcs({ [LONE_HIGH_SURROGATE]: 'v' })).toThrow(/well-formed Unicode/);
    expect(() => jcs([LONE_LOW_SURROGATE])).toThrow(/well-formed Unicode/);
  });

  it('and in the structure kind, which is framed as a field of its own', () => {
    expect(() => canonicalBytes(LONE_HIGH_SURROGATE, [])).toThrow(/well-formed Unicode/);
  });
});

describe('4B — rationale is validated BEFORE its lineage commitment', () => {
  const option = makeRefundOption();

  function denialOf(raw: unknown): CanonicalisationDenied {
    try {
      parseProposedIntent(raw);
    } catch (error) {
      if (error instanceof CanonicalisationDenied) return error;
      throw error;
    }
    throw new Error('expected a denial');
  }

  it('a rationale holding a lone surrogate denies MALFORMED / NOT_CANONICAL_TEXT', () => {
    const denial = denialOf(makeRawIntent(option, { rationale: LONE_HIGH_SURROGATE }));
    expect(denial.code).toBe('MALFORMED');
    expect(denial.detail).toBe('NOT_CANONICAL_TEXT');
  });

  it('so does a DIFFERENT lone surrogate — neither is admitted to commit identically', () => {
    const denial = denialOf(makeRawIntent(option, { rationale: ANOTHER_LONE_HIGH_SURROGATE }));
    expect(denial.detail).toBe('NOT_CANONICAL_TEXT');
  });

  it('a rationale containing U+0000 denies too', () => {
    expect(denialOf(makeRawIntent(option, { rationale: `a${NUL}b` })).detail).toBe(
      'NOT_CANONICAL_TEXT',
    );
  });

  it('an ordinary rationale carrying a supplementary character is accepted', () => {
    // The positive control. Without it the four denials above would be satisfied by a parser
    // that rejected every rationale.
    const intent = parseProposedIntent(
      makeRawIntent(option, { rationale: `Cracked on arrival ${SUPPLEMENTARY}` }),
    );
    expect(intent.rationale.byteLength).toBeGreaterThan(0);
  });

  it('resource_ref and the selector components are validated at the wire boundary too', () => {
    expect(denialOf(makeRawIntent(option, { resourceRef: LONE_HIGH_SURROGATE })).detail).toBe(
      'NOT_CANONICAL_TEXT',
    );
    const selectorDenial = denialOf(
      makeRawIntent(option, { enumerationId: `enum${NUL}1` }),
    );
    expect(selectorDenial.code).toBe('SELECTOR_MALFORMED');
    expect(selectorDenial.detail).toBe('NOT_CANONICAL_TEXT');
    expect(denialOf(makeRawIntent(option, { optionId: LONE_LOW_SURROGATE })).code).toBe(
      'SELECTOR_MALFORMED',
    );
  });
});

describe('4C — NFC key handling', () => {
  /**
   * Two spellings of the same accented name. `e` + U+0301 (combining acute) normalises under
   * NFC to U+00E9, so `cafe` + combining acute and `caf` + U+00E9 are DISTINCT JavaScript
   * strings with ONE canonical name.
   */
  const DECOMPOSED_KEY = `cafe${String.fromCharCode(0x0301)}`;
  const COMPOSED_KEY = `caf${String.fromCharCode(0x00e9)}`;

  it('the two keys really are distinct strings with one NFC form, so the test discriminates', () => {
    expect(DECOMPOSED_KEY).not.toBe(COMPOSED_KEY);
    expect(DECOMPOSED_KEY.normalize('NFC')).toBe(COMPOSED_KEY.normalize('NFC'));
  });

  it('an object whose keys collide under NFC is REJECTED, not silently deduplicated', () => {
    // The alternative outcomes are both wrong: emitting the name twice produces something
    // that is not a JSON object, and picking one spelling maps two distinct objects onto one
    // canonical form.
    expect(() => jcs({ [DECOMPOSED_KEY]: 1, [COMPOSED_KEY]: 2 })).toThrow(
      /normalise to the same canonical name/,
    );
  });

  it('the rejection does not depend on insertion order', () => {
    expect(() => jcs({ [COMPOSED_KEY]: 2, [DECOMPOSED_KEY]: 1 })).toThrow(
      /normalise to the same canonical name/,
    );
  });

  it('and it is detected at any nesting depth', () => {
    expect(() => jcs({ outer: { [DECOMPOSED_KEY]: 1, [COMPOSED_KEY]: 2 } })).toThrow(
      /normalise to the same canonical name/,
    );
  });

  it('a single canonically-equivalent key is fine, and serialises in its NORMALISED form', () => {
    // The positive control, and the ordering rule: the emitted name is the normalised one,
    // not the spelling that happened to be supplied.
    expect(jcs({ [DECOMPOSED_KEY]: 1 })).toBe(jcs({ [COMPOSED_KEY]: 1 }));
    expect(jcs({ [DECOMPOSED_KEY]: 1 })).toBe(`{${JSON.stringify(COMPOSED_KEY)}:1}`);
  });

  it('keys are SORTED after normalisation, not before', () => {
    /**
     * The two orderings differ. Pre-normalisation, the decomposed key begins `cafe` (0x65 at
     * index 3); post-normalisation it begins `caf` + U+00E9 (0xE9 at index 3). Against a key
     * sorting between them the two orders disagree, so this discriminates the specified
     * order from the wrong one.
     */
    const between = 'cafz';
    const serialised = jcs({ [DECOMPOSED_KEY]: 1, [between]: 2 });
    const normalisedFirst = jcs({ [COMPOSED_KEY]: 1, [between]: 2 });
    expect(serialised).toBe(normalisedFirst);
    // U+00E9 (0xE9) sorts AFTER 'z' (0x7A) by UTF-16 code unit, so the accented key is last.
    expect(serialised.indexOf(JSON.stringify(between))).toBeLessThan(
      serialised.indexOf(JSON.stringify(COMPOSED_KEY)),
    );
  });

  it('NFC normalisation of VALUES is unchanged — two forms of one string hash alike', () => {
    // From S1B, restated so finding 4C is not read as having disturbed it.
    const composed = `caf${String.fromCharCode(0x00e9)}`;
    const decomposed = `cafe${String.fromCharCode(0x0301)}`;
    expect(hex(canonicalHash('k', [{ kind: 'text', value: composed }]))).toBe(
      hex(canonicalHash('k', [{ kind: 'text', value: decomposed }])),
    );
    expect(jcs({ v: composed })).toBe(jcs({ v: decomposed }));
  });
});

describe('nothing else about the byte layer moved', () => {
  it('money still renders at exactly scale 2 and frames unchanged', () => {
    // Finding 4 was told not to change money encoding, timestamp precision or framing.
    expect(hex(canonicalBytes('k', [{ kind: 'text', value: 'ab' }]))).toBe(
      '000000016b000000026162',
    );
  });

  it('and a boundary still cannot be forged by concatenation', () => {
    expect(
      hex(
        canonicalBytes('k', [
          { kind: 'text', value: 'ab' },
          { kind: 'text', value: 'c' },
        ]),
      ),
    ).not.toBe(
      hex(
        canonicalBytes('k', [
          { kind: 'text', value: 'a' },
          { kind: 'text', value: 'bc' },
        ]),
      ),
    );
  });
});
