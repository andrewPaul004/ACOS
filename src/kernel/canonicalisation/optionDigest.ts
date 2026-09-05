import { hex, hashConcat } from './canonicalBytes.js';
import type { ActionClass } from './actionCatalogue.js';

/**
 * `option_id` — the CLASS-AGNOSTIC half of `26 §2.2`.
 *
 * `26 §2.2`, verbatim:
 *
 *   "option_id = H(action_class ‖ resource_id ‖ semantic_option_digest), and the digest
 *    must cover every field whose change would make the option a different effect.
 *    Declared per class in the action catalogue, and a change to any digest definition is
 *    a semantic constructor bump"
 *
 * ---------------------------------------------------------------------------------
 * WHY THE PER-CLASS DIGEST IS NOT IN THIS FILE — S1B.2, finding 6
 *
 * The addressing form above is the same for every class, so it lives here. The DIGEST is
 * declared per class, so it lives with the class: `refundSemanticOptionDigest` moved to
 * `constructors/refundCreate.ts` and is reached through the registered constructor's
 * `computeSemanticOptionDigest`.
 *
 * That is what makes the closed catalogue plus a registered constructor a real extension
 * point. Before the move, `EffectCanonicaliser` imported the refund digest directly, so a
 * second money-bearing class would have required editing the canonicaliser core — the
 * per-class branch the S1B contract says must not exist.
 * ---------------------------------------------------------------------------------
 */

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
