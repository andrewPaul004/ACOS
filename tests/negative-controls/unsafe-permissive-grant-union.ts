import type { Recoverability } from '../../src/kernel/canonicalisation/actionCatalogue.js';
import {
  noveltyOrdinal,
  recoverabilityOrdinal,
  type EffectiveAuthority,
  type MatchedGrant,
} from '../../src/kernel/authority/grants.js';

/**
 * INTENTIONALLY VULNERABLE — TEST ONLY. NEVER IMPORTED FROM `src/`.
 *
 * `26 §7` step I's composition defect: "the most permissive matching grant wins".
 *
 * ---------------------------------------------------------------------------------
 * WHY THIS IS THE PLAUSIBLE BUG RATHER THAN A STRAWMAN
 *
 * When two owner-written grants both select a request, "does the owner get the union or the
 * intersection of what they wrote?" has an intuitive wrong answer. A grant reads as a
 * permission, and permissions feel additive: if the owner wrote one grant permitting
 * IRRECOVERABLE actions and another permitting only REVERSIBLE ones, the natural reading of
 * "this principal has both grants" is that the broader one applies.
 *
 * `26 §3` rule 2 and `26 §4` v1.2 both say the opposite, in the same word: "A delegation can
 * only **narrow**", and "a grant may only **narrow**". Under the union reading, an owner who
 * adds a broad grant silently erases every narrow restriction they wrote earlier, and nothing
 * in the system reports that it happened.
 *
 * This file takes the MAXIMUM of every bound where production takes the minimum. Everything
 * else — the matching, the window union, the grant rows — is identical, so the discriminating
 * test differs in exactly one operator.
 */
export function unsafePermissiveAuthority(grants: readonly MatchedGrant[]): EffectiveAuthority {
  if (grants.length === 0) throw new Error('unsafe: no grants');

  let recoverabilityMax: Recoverability = grants[0]!.recoverabilityMax;
  let counterpartyNoveltyMax = grants[0]!.counterpartyNoveltyMax;
  let perActionMaxMonetary = grants[0]!.perActionMaxMonetary;
  let evidenceMinSources = grants[0]!.evidenceMinSources;

  for (const grant of grants.slice(1)) {
    // THE DEFECT: `>` where production has `<`.
    if (recoverabilityOrdinal(grant.recoverabilityMax) > recoverabilityOrdinal(recoverabilityMax)) {
      recoverabilityMax = grant.recoverabilityMax;
    }
    if (
      grant.counterpartyNoveltyMax !== null &&
      (counterpartyNoveltyMax === null ||
        noveltyOrdinal(grant.counterpartyNoveltyMax) > noveltyOrdinal(counterpartyNoveltyMax))
    ) {
      counterpartyNoveltyMax = grant.counterpartyNoveltyMax;
    }
    if (
      grant.perActionMaxMonetary !== null &&
      (perActionMaxMonetary === null || grant.perActionMaxMonetary > perActionMaxMonetary)
    ) {
      perActionMaxMonetary = grant.perActionMaxMonetary;
    }
    // And the weakest evidence requirement, for the same reason.
    if (grant.evidenceMinSources !== null) {
      evidenceMinSources =
        evidenceMinSources === null
          ? grant.evidenceMinSources
          : Math.min(evidenceMinSources, grant.evidenceMinSources);
    }
  }

  const windowRefs = [...new Set(grants.flatMap((grant) => [...grant.windowRefs]))].sort();
  return Object.freeze({
    grants,
    recoverabilityMax,
    counterpartyNoveltyMax,
    perActionMaxMonetary,
    evidenceMinSources,
    evidenceMaxTier: grants[0]!.evidenceMaxTier,
    evidenceMaxAgeDays: grants[0]!.evidenceMaxAgeDays,
    approvalRequirement: 'NONE',
    autonomyKeyBindings: Object.freeze([grants[0]!.autonomyKeyBinding]),
    windowRefs: Object.freeze(windowRefs),
  });
}
