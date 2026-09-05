import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CanonicalisationDenied } from '../../src/kernel/canonicalisation/errors.js';
import { parseProposedIntent } from '../../src/kernel/canonicalisation/intent.js';
import { projectDenialToWorker } from '../../src/kernel/enumeration/workerFacingDenial.js';

/**
 * 18 — no cardinality probing by positional selector.
 *
 * `26 §2.0`, verbatim: "`selector` remains **one** field for `I21`'s purposes; **it is a pair
 * rather than an integer**."
 *
 * `26 §7`'s v1.2 paragraph, verbatim:
 *
 *   "the probing oracle `53 §1` CAN-05 constructed — binary-searching `selector = 2^k`
 *    against `SELECTOR_INVALID` to recover `|options|` in `O(log n)` — is closed twice over:
 *    **content-addressed `option_id`s are not searchable by index**, and a single
 *    `DENY: SELECTOR` category no longer distinguishes out-of-range from downstream denial."
 *
 * The S1C mandate: "Do not implement an index compatibility layer."
 *
 * Three layers of evidence, and each is needed:
 *
 *   here                                   the WIRE parser rejects every ordinal form
 *   tests/type-negative/positional-selector.ts   no TYPE can express one
 *   the source scan below                  no index compatibility layer exists in `src/`
 */

describe('the wire form rejects every positional selector', () => {
  const base = {
    action_class: 'refund.create',
    resource_ref: 'order:ORD-123',
    reason_code: 'ITEM_RETURNED',
    rationale: 'the model said so',
  };

  it('`selector: 4` is malformed', () => {
    // The mandate's first form, exactly.
    const error = attempt({ ...base, selector: 4 });
    expect(error.code).toBe('SELECTOR_MALFORMED');
    expect(error.detail).toBe('NOT_AN_OBJECT');
  });

  it('`selector: { index: 4 }` is malformed', () => {
    // The mandate's second form, exactly. It fails on the MISSING pair members before the
    // extra one, which is the order `26 §7` step B implies: the shape is wrong, not merely
    // decorated.
    const error = attempt({ ...base, selector: { index: 4 } });
    expect(error.code).toBe('SELECTOR_MALFORMED');
    expect(error.detail).toBe('MISSING_FIELD');
  });

  it('a well-formed pair CARRYING an index is malformed too — accept-and-ignore is prohibited', () => {
    // The dangerous middle case. A parser that dropped the extra field would leave the index
    // expressible at the boundary with something downstream trusted to have ignored it —
    // which is exactly the weaker position `35 §4` describes for the v1.0 `$5,000`.
    const error = attempt({
      ...base,
      selector: { enumeration_id: 'enum:1', option_id: 'abc', index: 4 },
    });
    expect(error.code).toBe('SELECTOR_MALFORMED');
    expect(error.detail).toBe('EXTRA_FIELD');
  });

  it.each([0, 1, 2, 4, 8, 16, 1024])('the CAN-05 probe `selector: %i` is malformed', (probe) => {
    // `53 §1` CAN-05's binary search over `2^k`. Every probe returns the SAME thing, so no
    // sequence of them recovers `|options|`.
    const error = attempt({ ...base, selector: probe });
    expect(error.code).toBe('SELECTOR_MALFORMED');
    expect(error.detail).toBe('NOT_AN_OBJECT');
  });

  it('every probe is INDISTINGUISHABLE at the worker — the oracle returns one bit, always', () => {
    // The property that actually closes CAN-05. Not "the probe fails" but "every probe fails
    // identically", so `O(log n)` search yields nothing.
    const responses = [0, 1, 2, 4, 8, 16, 1024, 1 << 20].map((probe) =>
      JSON.stringify(projectDenialToWorker(attempt({ ...base, selector: probe }))),
    );
    expect(new Set(responses).size).toBe(1);
    expect(responses[0]).toBe(JSON.stringify({ deny: 'SELECTOR' }));
  });

  it('and an ordinal is not distinguishable from a well-formed but wrong pair', () => {
    // The last separation a prober could use: "is my selector shaped wrong, or merely
    // stale?" Both collapse to `DENY: SELECTOR`.
    const ordinal = projectDenialToWorker(attempt({ ...base, selector: 4 }));
    const wrongPair = projectDenialToWorker(
      attempt({ ...base, selector: { enumeration_id: '', option_id: 'abc' } }),
    );
    expect(ordinal).toEqual(wrongPair);
  });

  it('a string ordinal is not coerced', () => {
    // No `Number(selector)` anywhere, and no leniency that would let `"4"` become an index.
    const error = attempt({ ...base, selector: '4' });
    expect(error.code).toBe('SELECTOR_MALFORMED');
    expect(error.detail).toBe('NOT_AN_OBJECT');
  });

  it('an ARRAY selector is not an option list to index into', () => {
    const error = attempt({ ...base, selector: ['abc', 'def'] });
    expect(error.code).toBe('SELECTOR_MALFORMED');
    expect(error.detail).toBe('NOT_AN_OBJECT');
  });
});

describe('no index compatibility layer exists in src/', () => {
  it('no production module reads a numeric selector or an index field off an intent', () => {
    // The structural assertion. `26 §7`'s oracle is closed by the ABSENCE of an index, so
    // the absence is asserted rather than assumed — the same discipline
    // `tests/integration/exposure/lock-order.test.ts` applies to the lock order.
    const offenders: string[] = [];
    for (const file of walk(join('src'))) {
      const code = stripComments(readFileSync(file, 'utf8'));
      // A selector used as a number, or an `index` member on anything selector-shaped.
      if (/selector\s*\[\s*\d/.test(code)) offenders.push(`${file}: selector[n]`);
      if (/selector\.index/.test(code)) offenders.push(`${file}: selector.index`);
      if (/Number\s*\(\s*[\w.]*selector/.test(code)) offenders.push(`${file}: Number(selector)`);
      if (/parseInt\s*\(\s*[\w.]*selector/.test(code)) offenders.push(`${file}: parseInt(selector)`);
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('`ProposedSelector` declares exactly two members, both strings', () => {
    const code = readFileSync(join('src', 'kernel', 'canonicalisation', 'intent.ts'), 'utf8');
    const start = code.indexOf('export interface ProposedSelector {');
    const block = code.slice(start, code.indexOf('\n}', start));
    const members = [...block.matchAll(/readonly (\w+): (\w+);/g)].map(
      (m) => `${m[1]!}:${m[2]!}`,
    );
    expect(members).toEqual(['enumerationId:string', 'optionId:string']);
  });

  it('the wire parser declares exactly the two selector keys', () => {
    const code = readFileSync(join('src', 'kernel', 'canonicalisation', 'intent.ts'), 'utf8');
    expect(code).toContain("const SELECTOR_KEYS = ['enumeration_id', 'option_id'];");
  });
});

function attempt(raw: unknown): CanonicalisationDenied {
  try {
    parseProposedIntent(raw);
  } catch (error) {
    if (error instanceof CanonicalisationDenied) return error;
    throw error;
  }
  throw new Error('the parser ACCEPTED a positional selector');
}

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (path.endsWith('.ts')) out.push(path);
  }
  return out;
}
