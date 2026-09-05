import { describe, expect, it } from 'vitest';

import {
  MAX_RATIONALE_BYTES,
  parseProposedIntent,
  permittedFieldsOf,
} from '../../src/kernel/canonicalisation/intent.js';
import { CanonicalisationDenied } from '../../src/kernel/canonicalisation/errors.js';
import { makeRawIntent, makeRefundOption } from '../support/canonicalisationFixture.js';

/**
 * `26 §2.0` — the exact five-field model-facing write surface, and nothing else.
 *
 * `26 §7` step B, verbatim: "Schema valid? only 5 fields present?" -> no -> DENY: MALFORMED.
 *
 * `26 §2.0`'s boxed rule, verbatim:
 *
 *   "Model output may propose intent and select among kernel-enumerated options. It may
 *    never supply an authoritative precondition, an exposure figure, or any field of the
 *    dispatched request."
 */

const option = makeRefundOption();

function denialOf(raw: unknown): CanonicalisationDenied {
  try {
    parseProposedIntent(raw);
  } catch (error) {
    if (error instanceof CanonicalisationDenied) return error;
    throw error;
  }
  throw new Error('expected a denial, got a parsed intent');
}

describe('the five-field ProposedIntent parses exactly', () => {
  it('accepts the five declared fields', () => {
    const intent = parseProposedIntent(makeRawIntent(option));
    expect(intent.actionClass).toBe('refund.create');
    expect(intent.resourceRef).toBe('order:ORD-123');
    expect(intent.selector.enumerationId).toContain('enum:');
    expect(intent.selector.optionId).toHaveLength(64);
    expect(intent.reasonCode).toBe('CUSTOMER_REPORTED_DAMAGE');
    // Not a string. `rationale.ts`: the characters do not survive parsing.
    expect(typeof intent.rationale).toBe('object');
  });

  it('projects onto exactly the four fields I21 permits', () => {
    const permitted = permittedFieldsOf(parseProposedIntent(makeRawIntent(option)));
    // Registry I21: "action_class, resource_ref, selector and reason_code" — and v1.2:
    // "selector is {enumeration_id, option_id} and remains one field."
    expect(Object.keys(permitted).sort()).toEqual([
      'actionClass',
      'reasonCode',
      'resourceRef',
      'selector',
    ]);
    expect(Object.prototype.hasOwnProperty.call(permitted, 'rationale')).toBe(false);
  });
});

describe('every missing field denies MALFORMED', () => {
  for (const key of ['action_class', 'resource_ref', 'selector', 'reason_code', 'rationale']) {
    it(`missing ${key}`, () => {
      const raw = makeRawIntent(option);
      delete raw[key];
      const denial = denialOf(raw);
      expect(denial.code).toBe('MALFORMED');
      expect(denial.detail).toBe('MISSING_FIELD');
    });
  }
});

describe('every extra field denies — it is never accepted and ignored', () => {
  /**
   * `35 §4`, verbatim, on why ignoring is not good enough:
   *
   *   "The $5,000 is not expressible. In v1.0 it was: 26 §2's exposure.monetary_amount was
   *    a proposal field, so the injected instruction produced a proposal carrying that
   *    figure and the architecture's defence was that a limit would reject it. That is a
   *    weaker position than it appeared, because it relied on the limit rather than on the
   *    impossibility."
   *
   * Every name below is one `26 §2` v1.0 actually carried, or one `24 §3` K4 names in its
   * "what AI may not do" row.
   */
  const forbidden: readonly [string, unknown][] = [
    ['amount', '1.00'],
    ['exposure', { monetary_amount: '1.00', currency: 'USD' }],
    ['total_exposure', '0.00'],
    ['parameters', { amount: '1.00' }],
    ['vendor_parameters', {}],
    ['recoverability', 'REVERSIBLE'],
    ['counterparty', { id: 'x', novelty: 'EXISTING' }],
    ['value_direction', 'NONE'],
    ['constructor_version', 'ctor.refund.create@9.9'],
    ['idempotency_key', 'deadbeef'],
    ['irrecoverable_units', 0],
    ['customer_novelty', 'RETURNING'],
    ['window_refs', ['W_DAY_REFUND']],
    ['principal', 'principal:owner'],
  ];

  for (const [key, value] of forbidden) {
    it(`extra ${key}`, () => {
      const denial = denialOf({ ...makeRawIntent(option), [key]: value });
      expect(denial.code).toBe('MALFORMED');
      expect(denial.detail).toBe('EXTRA_FIELD');
    });
  }
});

describe('the selector is a two-field pair and nothing else', () => {
  it('a non-object selector denies SELECTOR_MALFORMED', () => {
    // v1.1's positional index, submitted against the v1.2 content-addressed pair.
    const denial = denialOf({ ...makeRawIntent(option), selector: 2 });
    expect(denial.code).toBe('SELECTOR_MALFORMED');
  });

  it('a missing selector member denies SELECTOR_MALFORMED', () => {
    const denial = denialOf({
      ...makeRawIntent(option),
      selector: { enumeration_id: 'enum:1' },
    });
    expect(denial.code).toBe('SELECTOR_MALFORMED');
    expect(denial.detail).toBe('MISSING_FIELD');
  });

  it('an extra selector member denies SELECTOR_MALFORMED', () => {
    const denial = denialOf({
      ...makeRawIntent(option),
      selector: { enumeration_id: 'enum:1', option_id: 'abc', index: 0 },
    });
    expect(denial.code).toBe('SELECTOR_MALFORMED');
    expect(denial.detail).toBe('EXTRA_FIELD');
  });

  it('an empty option_id denies SELECTOR_MALFORMED', () => {
    const denial = denialOf({
      ...makeRawIntent(option),
      selector: { enumeration_id: 'enum:1', option_id: '' },
    });
    expect(denial.code).toBe('SELECTOR_MALFORMED');
  });
});

describe('the closed enums close', () => {
  it('a reason_code outside the closed enum denies MALFORMED', () => {
    const denial = denialOf(makeRawIntent(option, { reasonCode: 'BECAUSE_I_SAID_SO' }));
    expect(denial.code).toBe('MALFORMED');
    expect(denial.detail).toBe('REASON_CODE_NOT_IN_CLOSED_ENUM');
  });

  it('an action_class outside the catalogue denies UNKNOWN_ACTION', () => {
    // `26 §7` step C. SR7: the catalogue is closed.
    const denial = denialOf(makeRawIntent(option, { actionClass: 'payee.create' }));
    expect(denial.code).toBe('UNKNOWN_ACTION');
  });

  it('schema (step B) is evaluated before the catalogue (step C)', () => {
    // Both defects at once. `26 §7` orders B before C, so this denies MALFORMED.
    const denial = denialOf({
      ...makeRawIntent(option, { actionClass: 'payee.create' }),
      amount: '5000.00',
    });
    expect(denial.code).toBe('MALFORMED');
  });
});

describe('shape and bounds', () => {
  for (const raw of [null, undefined, 'refund.create', 42, [], true]) {
    it(`${JSON.stringify(raw) ?? 'undefined'} is not a ProposedIntent`, () => {
      expect(denialOf(raw).code).toBe('MALFORMED');
    });
  }

  it('a rationale over the declared byte bound denies', () => {
    const denial = denialOf(makeRawIntent(option, { rationale: 'x'.repeat(MAX_RATIONALE_BYTES + 1) }));
    expect(denial.detail).toBe('RATIONALE_TOO_LONG');
  });

  it('a non-string rationale denies', () => {
    const raw = makeRawIntent(option);
    raw['rationale'] = { text: 'hello' };
    expect(denialOf(raw).code).toBe('MALFORMED');
  });

  it('an empty rationale is accepted — it is free text, and empty is a legal value', () => {
    const intent = parseProposedIntent(makeRawIntent(option, { rationale: '' }));
    expect(intent.rationale.byteLength).toBe(0);
  });
});
