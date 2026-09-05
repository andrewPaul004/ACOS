/**
 * NEGATIVE — assigning `rationale` into an authority-bearing request field must not compile.
 *
 * Registry `I21`: "No AuthorizationRequest field is populated from ProposedIntent other
 * than action_class, resource_ref, selector and reason_code."
 */

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
export const option: RecordedSelectedOption = {
  optionId: 'abc',
  semanticOptionDigest: 'def',
  description: intent.rationale, // EXPECT_ERROR TS2322
};
