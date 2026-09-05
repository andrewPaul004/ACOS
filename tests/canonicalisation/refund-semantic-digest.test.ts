import { describe, expect, it } from 'vitest';

import { money } from '../../src/kernel/exposure/money.js';
import { hex } from '../../src/kernel/canonicalisation/canonicalBytes.js';
import { CanonicalisationDenied } from '../../src/kernel/canonicalisation/errors.js';
import { parseProposedIntent } from '../../src/kernel/canonicalisation/intent.js';
import {
  computeOptionId,
  refundSemanticOptionDigest,
} from '../../src/kernel/canonicalisation/optionDigest.js';
import {
  makeCanonicaliser,
  makeContext,
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
