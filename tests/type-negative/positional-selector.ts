/**
 * NEGATIVE — a POSITIONAL selector has no expressible form in production.
 *
 * `26 §2.0`, the v1.2 note on the selector, verbatim:
 *
 *   selector {                         // v1.2: content-addressed, never positional
 *     enumeration_id                   // names one EnumeratedOptionSet the kernel computed
 *     option_id                        // = H(action_class ‖ resource_id ‖ semantic_option_digest)
 *   }
 *
 * and: "`selector` remains **one** field for `I21`'s purposes; **it is a pair rather than an
 * integer**."
 *
 * ---------------------------------------------------------------------------------
 * WHY A TYPE TEST AND NOT ONLY A RUNTIME ONE
 *
 * `tests/canonicalisation/positional-selector-rejected.test.ts` proves the WIRE parser
 * rejects `{"selector": 4}` and `{"selector": {"index": 4}}`. This file proves the stronger
 * property: even inside the kernel, with the parser bypassed entirely, there is no type in
 * which an ordinal selector can be written down.
 *
 * That distinction is the difference between "the parser happens to reject it" and "the
 * architecture has no index". `26 §7`'s CAN-05 probing oracle — "binary-searching
 * `selector = 2^k` against `SELECTOR_INVALID` to recover `|options|` in `O(log n)`" — is
 * closed by the absence, not by the rejection.
 *
 * The S1C mandate: "Do not implement an index compatibility layer." There is none, and this
 * file is the evidence that adding one would be a visible type change.
 * ---------------------------------------------------------------------------------
 */

import type { ProposedIntent, ProposedSelector } from '../../src/kernel/canonicalisation/intent.js';
import { sealRationale } from '../../src/kernel/canonicalisation/rationale.js';

// EXPECT_ERROR: a bare integer is not a ProposedSelector.
export const ordinal: ProposedSelector = 4; // EXPECT_ERROR TS2322

// EXPECT_ERROR: an object carrying an index is not a ProposedSelector either — the pair is
// exactly `{ enumeration_id, option_id }` and `index` has no position on it.
export const indexed: ProposedSelector = {
  enumerationId: 'enum:1',
  optionId: 'abc',
  index: 4, // EXPECT_ERROR TS2353
};

// EXPECT_ERROR: and neither form can be smuggled onto a whole intent.
export const positionalIntent: ProposedIntent = {
  actionClass: 'refund.create',
  resourceRef: 'order:ORD-123',
  selector: 4, // EXPECT_ERROR TS2322
  reasonCode: 'ITEM_RETURNED',
  rationale: sealRationale('the model said so'),
};
