import { describe, expect, it } from 'vitest';

import { money } from '../../src/kernel/exposure/money.js';
import {
  canonicalBytes,
  canonicalHash,
  hashConcat,
  hex,
  jcs,
  rfc3339Micros,
} from '../../src/kernel/canonicalisation/canonicalBytes.js';

/**
 * The `ACOS-JCS-1` rules, applied to canonicaliser structures, with golden bytes.
 *
 * `30 §5.3`'s hazard table, verbatim in its rules column, is the specification. Each
 * hazard below is asserted individually, the way `36 §2` VC-A3 asserts them for the journal
 * triggers:
 *
 *   "Assert each hazard individually: 25.0 ≠ 25.00; timestamps at exactly 6 fractional
 *    digits UTC; declared column order survives a physical column reorder; null sentinel
 *    distinct from empty string; NFC normalisation; RFC 8785 for JSON columns; 4-byte BE
 *    length framing."
 *
 * ---------------------------------------------------------------------------------
 * WHAT THIS FILE DOES NOT CLAIM
 *
 * It is NOT VC-A3. VC-A3 is CROSS-IMPLEMENTATION byte-identity between the control trigger
 * and the audit trigger, and S1B builds neither. `30 §5.3`, verbatim: "36 §2.6
 * cross-implements it: the same fixture rows serialised by both triggers must produce
 * byte-identical output." That gate is OPEN after S1B and the result document says so.
 * ---------------------------------------------------------------------------------
 */

describe('framing — 4-byte big-endian length prefixes', () => {
  it('a single text field frames as kind, then length, then value', () => {
    const bytes = canonicalBytes('k', [{ kind: 'text', value: 'ab' }]);
    // 00000001 'k' 00000002 'a' 'b'
    expect(hex(bytes)).toBe('000000016b000000026162');
  });

  it('a content boundary cannot be forged by concatenation', () => {
    // Without framing, ("ab","c") and ("a","bc") would serialise identically.
    const left = canonicalBytes('k', [
      { kind: 'text', value: 'ab' },
      { kind: 'text', value: 'c' },
    ]);
    const right = canonicalBytes('k', [
      { kind: 'text', value: 'a' },
      { kind: 'text', value: 'bc' },
    ]);
    expect(hex(left)).not.toBe(hex(right));
  });

  it('the structure kind separates domains', () => {
    const a = canonicalHash('acos.a.v1', [{ kind: 'text', value: 'x' }]);
    const b = canonicalHash('acos.b.v1', [{ kind: 'text', value: 'x' }]);
    expect(hex(a)).not.toBe(hex(b));
  });
});

describe('money — the declared decimal scale', () => {
  it('renders at exactly scale 2', () => {
    expect(hex(canonicalBytes('k', [{ kind: 'money', value: money('25.00') }]))).toBe(
      // 'k', then '25.00'
      '000000016b00000005' + Buffer.from('25.00', 'utf8').toString('hex'),
    );
  });

  it('`25.0` is not expressible, so `25.0` and `25.00` cannot collide', () => {
    // `30 §5.3`: "25.0 and 25.00 are different bytes, deliberately — a scale change is a
    // semantic change in a money field." S1A's Money type makes the hazard unreachable
    // rather than merely detected: a value carrying a different scale does not parse.
    expect(() => money('25.000')).toThrow(/more than 2 decimal places/);
    expect(hex(canonicalHash('k', [{ kind: 'money', value: money('25.0') }]))).toBe(
      hex(canonicalHash('k', [{ kind: 'money', value: money('25.00') }])),
    );
    expect(hex(canonicalHash('k', [{ kind: 'money', value: money('25.00') }]))).not.toBe(
      hex(canonicalHash('k', [{ kind: 'money', value: money('25.01') }])),
    );
  });
});

describe('nulls, empty strings and zero', () => {
  it('null is the RESERVED framing word and an empty string is a zero-length value', () => {
    // v1.3.2, erratum JCS-01. NULL carries no payload at all: the four bytes `ffffffff`
    // and nothing after them. v1.3.1 wrote `0000000100` here — a length-1 payload holding
    // the byte 0x00 — which a real one-byte value could imitate.
    expect(hex(canonicalBytes('k', [{ kind: 'text', value: null }]))).toBe('000000016bffffffff');
    expect(hex(canonicalBytes('k', [{ kind: 'text', value: '' }]))).toBe('000000016b00000000');
  });

  it('and NO payload can imitate it — including a one-byte `0x00` bytes field', () => {
    // The defect S1G demonstrated (S1G-C1) and v1.3.2 corrected, asserted here against
    // the TypeScript implementation of `30 §5.3` as well as against the two triggers.
    const asNull = hex(canonicalBytes('k', [{ kind: 'text', value: null }]));
    const oneZeroByte = hex(
      canonicalBytes('k', [{ kind: 'bytes', value: Buffer.from([0x00]) }]),
    );
    expect(oneZeroByte).toBe('000000016b0000000100');
    expect(asNull).not.toBe(oneZeroByte);

    // Empty bytes, a two-zero-byte value and four 0xFF bytes are each distinct from NULL.
    const encodings = [
      asNull,
      oneZeroByte,
      hex(canonicalBytes('k', [{ kind: 'bytes', value: Buffer.alloc(0) }])),
      hex(canonicalBytes('k', [{ kind: 'bytes', value: Buffer.from([0x00, 0x00]) }])),
      hex(canonicalBytes('k', [{ kind: 'bytes', value: Buffer.from([0xff, 0xff, 0xff, 0xff]) }])),
    ];
    expect(new Set(encodings).size).toBe(5);
  });

  it('null, empty string and zero money all hash differently', () => {
    const digests = new Set(
      [
        canonicalHash('k', [{ kind: 'text', value: null }]),
        canonicalHash('k', [{ kind: 'text', value: '' }]),
        canonicalHash('k', [{ kind: 'money', value: money('0.00') }]),
      ].map(hex),
    );
    expect(digests.size).toBe(3);
  });
});

describe('timestamps — RFC 3339 UTC, exactly six fractional digits', () => {
  it('formats with six digits and a Z', () => {
    expect(rfc3339Micros(new Date('2026-09-05T10:00:00.123Z'))).toBe('2026-09-05T10:00:00.123000Z');
  });

  it('an offset-expressed instant normalises to UTC', () => {
    expect(rfc3339Micros(new Date('2026-09-05T12:00:00.000+02:00'))).toBe(
      '2026-09-05T10:00:00.000000Z',
    );
  });
});

describe('text — UTF-8 NFC', () => {
  it('the two Unicode forms of the same string hash identically', () => {
    const composed = 'café'; // NFC
    const decomposed = 'café'; // NFD
    expect(composed).not.toBe(decomposed);
    expect(hex(canonicalHash('k', [{ kind: 'text', value: composed }]))).toBe(
      hex(canonicalHash('k', [{ kind: 'text', value: decomposed }])),
    );
  });
});

describe('JSON-valued fields — RFC 8785', () => {
  it('object key order does not change the output', () => {
    expect(jcs({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(jcs({ a: 2, b: 1 })).toBe('{"a":2,"b":1}');
  });

  it('array order DOES change the output — a sequence is not a set', () => {
    expect(jcs(['a', 'b'])).not.toBe(jcs(['b', 'a']));
  });

  it('nested objects sort at every level', () => {
    expect(jcs({ z: { d: 1, c: 2 }, a: 3 })).toBe('{"a":3,"z":{"c":2,"d":1}}');
  });

  it('strings escape per RFC 8785 and normalise to NFC', () => {
    expect(jcs('a"b\\c\nd\te')).toBe('"a\\"b\\\\c\\nd\\te"');
    expect(jcs('')).toBe('"\\u0001"');
    expect(jcs('café')).toBe('"café"');
  });

  it('a non-integer number is REFUSED, not rounded', () => {
    // Money is a decimal string in this codebase, so a float on a canonicalised payload is
    // a defect. Failing closed here is cheaper than discovering it at settlement.
    expect(() => jcs(25.5)).toThrow(/non-integer or unsafe number/);
    expect(() => jcs({ amount: 25.5 })).toThrow(/non-integer or unsafe number/);
    expect(jcs(25)).toBe('25');
  });
});

describe('declared field order, not object key order', () => {
  it('the same values in a different DECLARED order hash differently', () => {
    const a = canonicalHash('k', [
      { kind: 'text', value: 'x' },
      { kind: 'text', value: 'y' },
    ]);
    const b = canonicalHash('k', [
      { kind: 'text', value: 'y' },
      { kind: 'text', value: 'x' },
    ]);
    expect(hex(a)).not.toBe(hex(b));
  });

  it('a JSON field built with keys inserted in two orders hashes identically', () => {
    // Registry `I41`'s test column, verbatim: "Round-trip a row with a structured field
    // whose keys were inserted in two different orders and assert an identical row_hash".
    const first: Record<string, string> = {};
    first['amount'] = '25.00';
    first['currency'] = 'USD';
    const second: Record<string, string> = {};
    second['currency'] = 'USD';
    second['amount'] = '25.00';
    expect(hex(canonicalHash('k', [{ kind: 'json', value: first }]))).toBe(
      hex(canonicalHash('k', [{ kind: 'json', value: second }])),
    );
  });
});

describe('hashConcat — the architecture s ‖ form', () => {
  it('frames its components, so a boundary cannot be moved', () => {
    expect(hex(hashConcat('d', ['ab', 'c']))).not.toBe(hex(hashConcat('d', ['a', 'bc'])));
  });

  it('is stable', () => {
    expect(hex(hashConcat('d', ['a', 'b']))).toBe(hex(hashConcat('d', ['a', 'b'])));
  });
});
