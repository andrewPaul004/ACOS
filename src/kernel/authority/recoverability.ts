import type { Recoverability } from '../canonicalisation/actionCatalogue.js';
import { denyAuthority } from './errors.js';
import { recoverabilityOrdinal, type EffectiveAuthority } from './grants.js';

/**
 * Step J — "recoverability ≤ grant.recoverability_max?"
 *
 * `26 §7`'s flowchart edge, verbatim: `J -->|no| D8[DENY: RECOVERABILITY]`.
 *
 * ---------------------------------------------------------------------------------
 * BOTH OPERANDS ARE KERNEL-OWNED AND NEITHER IS THE MODEL'S
 *
 * `26 §5`, verbatim: "EM3. Assigned per action class in the catalogue, **not per request,
 * and never by a model**."
 *
 * `26 §2.1`, on the request field: "recoverability // from the action catalogue — never
 * from the intent."
 *
 * So the left operand comes off `AuthorizationRequest.recoverability`, which the accepted
 * S1B canonicaliser copies from `ACTION_CATALOGUE[action_class]` and which `I21` makes
 * type-level unreachable from `ProposedIntent`. The right operand is the intersection over
 * the matching grants (`grants.ts`). This function takes those two and nothing else.
 *
 * `26 §7.1` evaluates step J on the `KERNEL_SERVICE` branch too — "Evaluated against the
 * authority's declared max" — so the gate has no principal-kind branch.
 * ---------------------------------------------------------------------------------
 */
export function evaluateRecoverability(
  requestRecoverability: Recoverability,
  authority: EffectiveAuthority,
): void {
  if (
    recoverabilityOrdinal(requestRecoverability) >
    recoverabilityOrdinal(authority.recoverabilityMax)
  ) {
    denyAuthority(
      'J',
      'RECOVERABILITY',
      'RECOVERABILITY_ABOVE_GRANT_MAX',
      `the class is ${requestRecoverability} and the effective grant ceiling is ${authority.recoverabilityMax}`,
    );
  }
}
