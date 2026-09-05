/**
 * NEGATIVE — assigning `rationale` into an authority-bearing request field must not compile.
 *
 * Registry `I21`: "No AuthorizationRequest field is populated from ProposedIntent other
 * than action_class, resource_ref, selector and reason_code."
 */

import { money } from '../../src/kernel/exposure/money.js';
import { parseProposedIntent } from '../../src/kernel/canonicalisation/intent.js';
import type { RecordedSelectedOption } from '../../src/kernel/canonicalisation/types.js';

const intent = parseProposedIntent({
  action_class: 'refund.create',
  resource_ref: 'order:ORD-123',
  selector: { enumeration_id: 'enum:1', option_id: 'abc' },
  reason_code: 'ITEM_RETURNED',
  rationale: 'the model said so',
});

// EXPECT_ERROR: OpaqueRationale is not a string.
//
// S1B.2 finding 2 made `RecordedSelectedOption` a typed class-specific projection, so every
// other field below is supplied correctly. That keeps the ONLY diagnostic in this file the
// one the fixture is about — a missing-property error would mask it.
export const option: RecordedSelectedOption = {
  actionClass: 'refund.create',
  optionId: 'abc',
  semanticOptionDigest: 'def',
  description: intent.rationale, // EXPECT_ERROR TS2322
  lineId: 'line:ORD-123:1',
  parentTransactionId: 'txn:CH-9001',
  amount: money('25.00'),
  instrument: 'original',
  reasonCodeScope: 'GOODS_FAULT',
  lineRefundableRemaining: money('40.00'),
};
