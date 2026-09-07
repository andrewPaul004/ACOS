import { describe, expect, it } from 'vitest';

import { countIndependent } from '../../src/kernel/authority/evidence.js';

/**
 * `24 §13`'s independence rule, against a HAND-COUNTED oracle.
 *
 * `24 §13`, verbatim:
 *
 *   "**Independence is computed, not asserted.** Two claims corroborate only if their sources
 *    differ on **registrable domain** *and* on **owner entity where determinable** *and*
 *    neither cites the other as its source. **Two articles quoting the same press release are
 *    one source.**"
 *
 * ---------------------------------------------------------------------------------
 * THE ORACLE IS THE ARCHITECTURE SENTENCE, APPLIED BY HAND
 *
 * Every `expected` below is a number a reader can verify from the fixture and the sentence
 * above without running anything. Nothing in this file calls the production function to work
 * out what the answer should be, and nothing imports a second copy of the rule.
 *
 * The cases are chosen so that a plausible WRONG implementation fails at least one of them:
 *
 *   counting items rather than sources          fails cases 2 and 3
 *   comparing domains only                      fails case 4
 *   comparing owner entities only               fails case 2
 *   collapsing two unknown owners together      fails case 5
 *   ignoring the citation edge                  fails case 6
 *   checking the citation in one direction only fails case 7
 */

interface Item {
  readonly evidenceItemId: string;
  readonly sourceId: string;
  readonly registrableDomain: string;
  readonly ownerEntity: string | null;
  readonly tier: number;
  readonly fetchAt: Date;
  readonly accessStatus: string;
  readonly citesItemId: string | null;
  readonly loadBearing: boolean;
}

const AT = new Date('2026-09-01T00:00:00.000Z');

function item(
  id: string,
  domain: string,
  owner: string | null,
  cites: string | null = null,
): Item {
  return {
    evidenceItemId: id,
    sourceId: `src:${domain}`,
    registrableDomain: domain,
    ownerEntity: owner,
    tier: 3,
    fetchAt: AT,
    accessStatus: 'OK',
    citesItemId: cites,
    loadBearing: false,
  };
}

describe('`24 §13` — independence is computed', () => {
  it('case 1 — an empty set has zero independent sources', () => {
    expect(countIndependent([])).toBe(0);
  });

  it('case 2 — two items from the SAME domain are ONE source', () => {
    // "Two articles quoting the same press release are one source."
    const set = [item('a', 'example.com', 'Example Ltd'), item('b', 'example.com', 'Example Ltd')];
    expect(countIndependent(set)).toBe(1);
  });

  it('case 3 — three items across two domains are TWO sources', () => {
    const set = [
      item('a', 'example.com', 'Example Ltd'),
      item('b', 'example.com', 'Example Ltd'),
      item('c', 'other.org', 'Other Foundation'),
    ];
    expect(countIndependent(set)).toBe(2);
  });

  it('case 4 — two DOMAINS with the same OWNER ENTITY are ONE source', () => {
    // The "and on owner entity where determinable" half. A holding company operating two
    // publications is one interest, whatever the DNS says.
    const set = [
      item('a', 'example.com', 'Same Holdings'),
      item('b', 'example.org', 'Same Holdings'),
    ];
    expect(countIndependent(set)).toBe(1);
  });

  it('case 5 — two UNKNOWN owners on different domains are TWO sources', () => {
    // "where determinable". Two nulls are not evidence of a shared owner, and collapsing them
    // would make the rule STRICTER than the architecture in a way that silently denies
    // legitimate corroboration.
    const set = [item('a', 'example.com', null), item('b', 'other.org', null)];
    expect(countIndependent(set)).toBe(2);
  });

  it('case 6 — an item CITING another is not independent of it', () => {
    const set = [
      item('a', 'example.com', 'Example Ltd'),
      item('b', 'other.org', 'Other Foundation', 'a'),
    ];
    expect(countIndependent(set)).toBe(1);
  });

  it('case 7 — the citation edge counts in EITHER direction', () => {
    // The mirror of case 6, with the citing item first. An implementation checking only
    // `a.cites === b.id` would return 2 here and 1 above.
    const set = [
      item('a', 'example.com', 'Example Ltd', 'b'),
      item('b', 'other.org', 'Other Foundation'),
    ];
    expect(countIndependent(set)).toBe(1);
  });

  it('case 8 — the worked corroboration threshold: two independent, one dependent', () => {
    // `24 §13`'s "≥ 2 independent" band, with a third item that adds nothing.
    const set = [
      item('a', 'gov.example', 'Regulator'),
      item('b', 'press.example', 'Press Co'),
      item('c', 'press.example', 'Press Co'),
    ];
    expect(countIndependent(set)).toBe(2);
  });

  it('case 9 — five items, three domains, one shared owner, one citation', () => {
    // Hand-counted: a(alpha.example/Alpha) is independent. b(beta.example/Beta) is
    // independent of a. c(gamma.example/Beta) shares Beta's owner with b, so it collapses.
    // d(alpha.example/Alpha) shares a's domain, so it collapses. e(delta.example/Delta)
    // cites a, so it collapses. Independent = 2.
    const set = [
      item('a', 'alpha.example', 'Alpha'),
      item('b', 'beta.example', 'Beta'),
      item('c', 'gamma.example', 'Beta'),
      item('d', 'alpha.example', 'Alpha'),
      item('e', 'delta.example', 'Delta', 'a'),
    ];
    expect(countIndependent(set)).toBe(2);
  });
});
