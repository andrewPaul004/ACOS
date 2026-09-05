import { canonicalHash, hex, hashConcat } from './canonicalBytes.js';
import type { ActionClass } from './actionCatalogue.js';
import type { SelectedAuthoritativeRefundOption } from './types.js';

/**
 * `semantic_option_digest` and `option_id`.
 *
 * `26 §2.2`, verbatim:
 *
 *   "option_id = H(action_class ‖ resource_id ‖ semantic_option_digest), and the digest
 *    must cover every field whose change would make the option a different effect.
 *    Declared per class in the action catalogue, and a change to any digest definition is
 *    a semantic constructor bump"
 *
 * and, for this class, verbatim:
 *
 *   refund.create | line_id · parent_transaction_id · amount · instrument · reason_code_scope
 *
 * and the warning that closes the section, verbatim:
 *
 *   "An option whose digest omits a money-bounding field is a catalogue defect, and
 *    `36 §2.3`'s negative control exists to detect exactly that."
 *
 * `tests/canonicalisation/refund-semantic-digest.test.ts` mutates each of the five fields
 * one at a time and asserts both the digest and the `option_id` change. Five fields, five
 * mutations, no field left implicit.
 */

/** The declared field order. Written out; not a property of how the option object was built. */
export function refundSemanticOptionDigest(option: SelectedAuthoritativeRefundOption): Buffer {
  return canonicalHash('acos.semantic_option_digest.refund.create.v1', [
    { kind: 'text', value: option.lineId },
    { kind: 'text', value: option.parentTransactionId },
    { kind: 'money', value: option.amount },
    { kind: 'text', value: option.instrument },
    { kind: 'text', value: option.reasonCodeScope },
  ]);
}

/** `option_id = H(action_class ‖ resource_id ‖ semantic_option_digest)`. */
export function computeOptionId(
  actionClass: ActionClass,
  resourceId: string,
  semanticOptionDigest: Buffer,
): string {
  return hex(
    hashConcat('acos.option_id.v1', [actionClass, resourceId, semanticOptionDigest]),
  );
}
