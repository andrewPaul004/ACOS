/**
 * NEGATIVE — an AuthorizationRequest cannot be populated from a fifth model-controlled field.
 *
 * `36 §2`, verbatim: "A test attempting to construct a request from any other intent field
 * must not compile."
 *
 * The four permitted fields are `PermittedIntentField`-branded and the rest of the request
 * is `KernelComputed`-branded, so the fifth field has no assignable position anywhere on
 * the structure — including via a spread of the whole intent.
 */

import {
  parseProposedIntent,
  permittedFieldsOf,
  type PermittedIntentFields,
} from '../../src/kernel/canonicalisation/intent.js';

const intent = parseProposedIntent({
  action_class: 'refund.create',
  resource_ref: 'order:ORD-123',
  selector: { enumeration_id: 'enum:1', option_id: 'abc' },
  reason_code: 'ITEM_RETURNED',
  rationale: 'the model said so',
});

// EXPECT_ERROR: PermittedIntentFields has no `rationale` member.
export const widened: PermittedIntentFields = {
  ...permittedFieldsOf(intent),
  rationale: intent.rationale, // EXPECT_ERROR TS2353
};
