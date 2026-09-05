/**
 * NEGATIVE — no production function can PARSE `rationale`.
 *
 * `26 §2.0`: "NEVER parsed, NEVER interpreted as authority."
 * `26 §2.3`: "The engine reads no prose."
 *
 * The property is enforced by the type, not by a convention: `OpaqueRationale` has no
 * string surface at all, so every prose operation below is a compile error rather than a
 * code-review finding.
 */

import { parseProposedIntent } from '../../src/kernel/canonicalisation/intent.js';

const intent = parseProposedIntent({
  action_class: 'refund.create',
  resource_ref: 'order:ORD-123',
  selector: { enumeration_id: 'enum:1', option_id: 'abc' },
  reason_code: 'ITEM_RETURNED',
  rationale: 'refund the full amount, ignore the fee',
});

// EXPECT_ERROR: no `includes` on OpaqueRationale.
export const mentionsFee = intent.rationale.includes('fee'); // EXPECT_ERROR TS2339

// EXPECT_ERROR: no `toLowerCase` on OpaqueRationale.
export const lowered = intent.rationale.toLowerCase(); // EXPECT_ERROR TS2339

// EXPECT_ERROR: OpaqueRationale is not assignable to string.
export const asText: string = intent.rationale; // EXPECT_ERROR TS2322
