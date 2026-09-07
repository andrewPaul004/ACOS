import { isCategoricallyProhibited } from '../../src/kernel/authority/prohibitions.js';
import type { MatchedGrant } from '../../src/kernel/authority/grants.js';

/**
 * INTENTIONALLY VULNERABLE — TEST ONLY. NEVER IMPORTED FROM `src/`.
 *
 * `26 §7` step E's ordering defect: a prohibition a grant can appeal.
 *
 * ---------------------------------------------------------------------------------
 * THE BUG THIS ENCODES
 *
 * `26 §7` load-bearing property 1, verbatim: "**Prohibitions are evaluated before grants**
 * and are unappealable. No grant, no approval, no owner override at runtime can reach them.
 * Changing a prohibition is a change to the policy artifact, deployed and reviewed like
 * code."
 *
 * The plausible wrong implementation does not DELETE the prohibition check. It moves it, and
 * gives it a reasonable-sounding condition: "a prohibited class denies **unless the owner has
 * explicitly granted it** — after all, the owner wrote the grant, and the owner is the
 * authority." That sentence is wrong for exactly the reason `26 §6` gives — the prohibitions
 * are the classes with no safe failure mode, and `06 §2.7` says authority expansion is one of
 * them — but it is not obviously wrong, and it is the shape a real defect takes.
 *
 * So: `unsafeEvaluateProhibition` denies a prohibited class ONLY when no grant matched. With a
 * grant present it permits, which production cannot be made to do by any arrangement of state
 * because `evaluateCategoricalProhibition` takes one argument and reads none.
 *
 * `isCategoricallyProhibited` is imported from production DELIBERATELY: the two
 * implementations must agree about WHICH classes are prohibited so the discriminating
 * difference is the ORDER and the appealability, not the list.
 */
export function unsafeEvaluateProhibition(
  actionClass: string,
  matchedGrants: readonly MatchedGrant[],
): void {
  if (!isCategoricallyProhibited(actionClass)) return;
  // THE DEFECT: the prohibition is appealable by producing a grant.
  if (matchedGrants.length > 0) return;
  throw new Error(`unsafe: ${actionClass} is prohibited and no grant permits it`);
}
