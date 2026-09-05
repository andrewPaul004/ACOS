import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { money } from '../../src/kernel/exposure/money.js';
import { hex } from '../../src/kernel/canonicalisation/canonicalBytes.js';
import { CanonicalisationDenied } from '../../src/kernel/canonicalisation/errors.js';
import { parseProposedIntent } from '../../src/kernel/canonicalisation/intent.js';
import { computeOptionId } from '../../src/kernel/canonicalisation/optionDigest.js';
// S1B.2 finding 6: the per-class digest now lives with the constructor that owns it.
import {
  refundOptionDescriptionFields,
  refundSemanticOptionDigest,
} from '../../src/kernel/canonicalisation/constructors/refundCreate.js';
import { projectOptionDescription } from '../../src/kernel/enumeration/contextSpec.js';
import {
  makeCanonicaliser,
  makeContext,
  makeContextSpec,
  makeRawIntent,
  makeRefundOption,
  optionIdFor,
  type OptionOverrides,
} from '../support/canonicalisationFixture.js';

/**
 * `semantic_option_digest` for `refund.create`, field by field.
 *
 * `26 §2.2`, the declared row, verbatim:
 *
 *   refund.create | line_id · parent_transaction_id · amount · instrument · reason_code_scope
 *
 * and, verbatim:
 *
 *   "the digest must cover every field whose change would make the option a different
 *    effect [...] An option whose digest omits a money-bounding field is a catalogue
 *    defect, and 36 §2.3's negative control exists to detect exactly that."
 *
 * `36 §2` VC-C3, verbatim: "semantic_option_digest changes whenever any declared semantic
 * field changes, asserted field by field per class."
 *
 * Five declared fields, five one-at-a-time mutations, no field left implicit.
 */

const baseline = makeRefundOption();
const baselineDigest = hex(refundSemanticOptionDigest(baseline));
const baselineOptionId = optionIdFor(baseline);

const mutations: readonly [string, OptionOverrides][] = [
  ['line_id', { lineId: 'line:ORD-123:2' }],
  ['parent_transaction_id', { parentTransactionId: 'txn:CH-9002' }],
  ['amount', { amount: money('20.00') }],
  ['instrument', { instrument: 'store_credit' }],
  ['reason_code_scope', { reasonCodeScope: 'BILLING_ERROR' }],
];

describe('every declared semantic field changes the digest and the option_id', () => {
  for (const [field, override] of mutations) {
    it(`${field} changes both`, () => {
      const mutated = makeRefundOption(override);
      expect(hex(refundSemanticOptionDigest(mutated)), field).not.toBe(baselineDigest);
      expect(optionIdFor(mutated), field).not.toBe(baselineOptionId);
    });
  }

  it('all five mutations produce five distinct option_ids', () => {
    const ids = new Set([
      baselineOptionId,
      ...mutations.map(([, override]) => optionIdFor(makeRefundOption(override))),
    ]);
    expect(ids.size).toBe(mutations.length + 1);
  });

  it('an unchanged option reproduces the same digest and id', () => {
    expect(hex(refundSemanticOptionDigest(makeRefundOption()))).toBe(baselineDigest);
    expect(optionIdFor(makeRefundOption())).toBe(baselineOptionId);
  });
});

describe('option_id = H(action_class ‖ resource_id ‖ semantic_option_digest)', () => {
  it('the resource id is part of the address', () => {
    // The same refund shape against another order is a different effect.
    const elsewhere = makeRefundOption({ resourceId: 'ORD-999' });
    expect(optionIdFor(elsewhere)).not.toBe(baselineOptionId);
  });

  it('the action class is part of the address', () => {
    const digest = refundSemanticOptionDigest(baseline);
    expect(computeOptionId('refund.create', baseline.resourceId, digest)).not.toBe(
      computeOptionId('fulfilment.reship', baseline.resourceId, digest),
    );
  });

  it('the address is a 32-byte hash, not an ordinal', () => {
    // `26 §2.0`, v1.2, SR-C3: "the dangerous case is reordering, and reordering is
    // undetectable by an ordinal."
    expect(baselineOptionId).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('the selector must content-address the authoritative option', () => {
  const { canonicaliser } = makeCanonicaliser();

  function denialOf(fn: () => unknown): CanonicalisationDenied {
    try {
      fn();
    } catch (error) {
      if (error instanceof CanonicalisationDenied) return error;
      throw error;
    }
    throw new Error('expected a denial');
  }

  it('an option_id that does not address the authoritative option denies SELECTOR_INVALID', () => {
    // S1B-owner-clarifications.md S1B-C7: this is the flowchart's SELECTOR_INVALID, NOT
    // SELECTOR_STALE. SELECTOR_STALE is a property of live re-enumeration under the C′
    // lock, which the enumeration/selector increment adds. Emitting it here would claim a
    // check nobody performed.
    const intent = parseProposedIntent(
      makeRawIntent(baseline, { optionId: optionIdFor(makeRefundOption({ amount: money('20.00') })) }),
    );
    const denial = denialOf(() => canonicaliser.canonicalise(intent, makeContext(), baseline));
    expect(denial.code).toBe('SELECTOR_INVALID');
    expect(denial.detail).toBe('OPTION_ID_MISMATCH');
  });

  it('an enumeration_id other than the resolved one denies SELECTOR_INVALID', () => {
    const intent = parseProposedIntent(makeRawIntent(baseline, { enumerationId: 'enum:someone-elses' }));
    const denial = denialOf(() => canonicaliser.canonicalise(intent, makeContext(), baseline));
    expect(denial.code).toBe('SELECTOR_INVALID');
  });

  it('an authoritative option for another resource denies SELECTOR_INVALID', () => {
    const elsewhere = makeRefundOption({ resourceId: 'ORD-999' });
    const intent = parseProposedIntent(makeRawIntent(elsewhere));
    const denial = denialOf(() => canonicaliser.canonicalise(intent, makeContext(), elsewhere));
    expect(denial.code).toBe('SELECTOR_INVALID');
    expect(denial.detail).toBe('OPTION_RESOURCE_MISMATCH');
  });

  it('the kernel never substitutes another option — it denies', () => {
    // `I53`'s no-substitution rule is proven under the C′ lock by the next increment. What
    // S1B proves is the weaker half: a mismatch produces a denial and no canonical effect,
    // rather than an effect for whatever option the kernel happened to hold.
    const intent = parseProposedIntent(makeRawIntent(baseline, { optionId: 'f'.repeat(64) }));
    expect(() => canonicaliser.canonicalise(intent, makeContext(), baseline)).toThrow(
      CanonicalisationDenied,
    );
  });
});

// =====================================================================================
// S1C additions — 13. Content-address mutation, extended.
//
// The mandate: "Retain and extend the S1B semantic-digest tests. […] Do not alter the
// declared five-field digest."
//
// The five-field matrix above is UNCHANGED and is retained verbatim. What S1C adds is the
// other half of the same property: the fields that must NOT move `option_id`.
// =====================================================================================

describe('13 — non-semantic and current-state changes leave option_id UNCHANGED', () => {
  it('line_refundable_remaining is NOT a digest member — changing it moves nothing', () => {
    // `26 §8` reads `context.selected_option.line_refundable_remaining` as a POLICY operand,
    // and S1B.2 finding 2 keeps it out of `semantic_option_digest` deliberately: it is
    // current state, not effect identity. If it were a member, every partial refund against
    // any line would invalidate every outstanding selector for that line — and CAN-03's
    // denial would become indistinguishable from ordinary churn.
    const moved = makeRefundOption({ lineRefundableRemaining: money('18.00') });
    expect(hex(refundSemanticOptionDigest(moved))).toBe(baselineDigest);
    expect(optionIdFor(moved)).toBe(baselineOptionId);
  });

  it('the option CURRENCY is not a digest member either', () => {
    // The MVP is single-currency (`26 §11.2`, `51 §5.1`) and the constructor's cohesion check
    // (S1B.2 finding 1C) refuses a mismatch outright, so currency cannot silently change the
    // effect. It is therefore not identity — and asserting so keeps the declared five-field
    // digest honest rather than quietly six.
    const other = makeRefundOption({ currency: 'USD' });
    expect(optionIdFor(other)).toBe(baselineOptionId);
  });

  it('PROJECTED DESCRIPTION WORDING is non-semantic — it cannot move option_id', () => {
    // `26 §2.1.2` classes `description_string` among the NON-SEMANTIC change fields, against
    // the semantic-by-definition set that includes `the semantic_option_digest`.
    //
    // The property matters operationally: a `context_spec` edit that narrows or widens what a
    // task may see changes every description it renders. If that moved `option_id`, every
    // outstanding selector in the system would go stale on a `context_spec` deploy, and
    // `SELECTOR_STALE` would stop meaning "the world moved".
    //
    // Asserted through the real projection, over the real candidate fields, under two specs.
    const option = makeRefundOption();
    const wide = projectOptionDescription(
      makeContextSpec(),
      'refund.create',
      refundOptionDescriptionFields(option),
    );
    const narrow = projectOptionDescription(
      makeContextSpec({ admittedDescriptionFields: new Set(['amount']) }),
      'refund.create',
      refundOptionDescriptionFields(option),
    );
    expect(narrow).not.toBe(wide);
    // Two different descriptions, one identity.
    expect(optionIdFor(option)).toBe(baselineOptionId);
    expect(hex(refundSemanticOptionDigest(option))).toBe(baselineDigest);
  });

  it('the digest reads exactly five fields, and the source says which', () => {
    // `26 §2.2`'s declared row: line_id · parent_transaction_id · amount · instrument ·
    // reason_code_scope. Asserted against the source so that widening it is a visible edit
    // rather than an incidental one — the digest is `26 §2.1.2`'s semantic-by-definition
    // change class, so a sixth member is a semantic constructor bump, never a refactor.
    const code = readFileSync(
      join('src', 'kernel', 'canonicalisation', 'constructors', 'refundCreate.ts'),
      'utf8',
    );
    const start = code.indexOf("canonicalHash('acos.semantic_option_digest.refund.create.v1'");
    const block = code.slice(start, code.indexOf(']);', start));
    const fields = [...block.matchAll(/value: option\.(\w+)/g)].map((match) => match[1]!);
    expect(fields).toEqual([
      'lineId',
      'parentTransactionId',
      'amount',
      'instrument',
      'reasonCodeScope',
    ]);
  });
});
