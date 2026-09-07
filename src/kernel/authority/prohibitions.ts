import { denyAuthority } from './errors.js';

/**
 * Step E — categorical prohibitions.
 *
 * `26 §6`, verbatim, and it is the whole specification of this file:
 *
 *   "Not 'requires approval.' **Architecturally unreachable**, enforced twice: a deny rule
 *    that no grant can override, and the absence of any credential the broker can issue to
 *    an AI-originated principal that could perform it."
 *
 * `26 §7`'s load-bearing property 1, verbatim:
 *
 *   "**Prohibitions are evaluated before grants** and are unappealable. No grant, no
 *    approval, no owner override at runtime can reach them. Changing a prohibition is a
 *    change to the policy artifact, deployed and reviewed like code."
 *
 * ---------------------------------------------------------------------------------
 * THE LIST IS A FROZEN CONSTANT IN THE CONTROL PLANE, NOT A DATABASE TABLE
 *
 * A prohibited-class table is a prohibited-class table someone can DELETE FROM. `26 §6`
 * says changing a prohibition is "a change to the policy artifact, deployed and reviewed
 * like code", so the list is code: a frozen set with no loader, no override, no environment
 * variable, no constructor parameter and no runtime setter.
 *
 * There is deliberately no `addProhibitedClass`, no `PROHIBITIONS_OVERRIDE` and no way to
 * construct an evaluator over a different list. `evaluateCategoricalProhibition` is a free
 * function closing over the module constant, so the "otherwise favourable state" attack has
 * nothing to arrange: seeding a grant for `payee.create`, an excellent evidence set and a
 * permissive Cedar policy changes nothing here, because none of them is an input.
 *
 * ---------------------------------------------------------------------------------
 * NONE OF THESE CLASSES IS IMPLEMENTED, AND THAT IS THE SECOND ENFORCEMENT
 *
 * `26 §6`'s "enforced twice" second leg is "the absence of any credential". S1E's analogue
 * is the absence of the class from the closed action catalogue: `actionCatalogue.ts` holds
 * four classes and none of them is here, so a `ProposedIntent` naming one denies
 * `UNKNOWN_ACTION` at step C long before step E is reached.
 *
 * `assertProhibitionsDisjointFromCatalogue` asserts that disjointness so it is a checked
 * property rather than an observation, and the S1E suite runs it. Step E is nonetheless
 * evaluated on every proposal — a gate that is only correct because another gate happens to
 * fire first is a gate one catalogue addition away from being wrong.
 * ---------------------------------------------------------------------------------
 */

/**
 * `26 §6`'s prohibited classes, transcribed row by row from its table.
 *
 * Neither expanded nor shrunk. Each entry is the identifier `26 §6` prints; where a row
 * prints several identifiers, each becomes its own member, and where it prints a wildcard
 * (`authority.*`, `credential.*`, `tax.filing.*`, `entity.*`) the wildcard is retained and
 * matched as a prefix by `isCategoricallyProhibited`.
 */
export const PROHIBITED_ACTION_CLASSES: readonly string[] = Object.freeze([
  // EM17. IC3 2025: BEC 24,768 complaints, $3.05B. `07 §4.3`.
  'payee.create',
  'payee.bank_details.modify',
  'payment_method.add',
  // `07 §10`, `06 §2.7`.
  'credential.create',
  'credential.rotate',
  'credential.export',
  'oauth.scope.modify',
  // PCI DSS SAQ A eligibility criterion effective 2025-03-31 (`07 §8`).
  'payment_page_code.write',
  'theme.checkout.write',
  // B9. `06 §2.7`: "authority expansion is the one action class with no safe failure mode."
  'authority.*',
  // EM16.
  'audit.write',
  'audit.close',
  'audit.delete',
  // SR10. The platform-enforced outer ring is only a control if ACOS cannot move it.
  'platform.spend_cap.raise',
  'platform.budget_limit.raise',
  // FTC 16 CFR Part 465 §465.2(a)(1). `17 §5.5`, `06 §2.4`.
  'review.create',
  'testimonial.create',
  // `06 §2.6`.
  'tax.filing.*',
  'entity.*',
  'contract.execute',
  'legal.response.send',
  // `06 §2.5`, `10 §2.2`. Visa VAMP's non-compliant threshold at a 0.5% ratio and a count of 5.
  'dispute.representment.submit',
]);

const EXACT: ReadonlySet<string> = new Set(
  PROHIBITED_ACTION_CLASSES.filter((entry) => !entry.endsWith('.*')),
);

const PREFIXES: readonly string[] = Object.freeze(
  PROHIBITED_ACTION_CLASSES.filter((entry) => entry.endsWith('.*')).map((entry) =>
    entry.slice(0, -1),
  ),
);

/**
 * Whether `actionClass` is categorically prohibited.
 *
 * Takes a STRING rather than the closed `ActionClass` union deliberately. The union has four
 * members and none of them is prohibited, so a signature over it would make this function
 * unable to express the check it exists to perform — and would make the adversarial fixture
 * inexpressible, which is how a prohibition gate comes to be tested only against inputs that
 * cannot fail it.
 *
 * `authority.*` matches `authority.` as a prefix, so `authority.grant.create` and
 * `authority.policy.deploy` are both caught, and `authorityx.foo` is not.
 */
export function isCategoricallyProhibited(actionClass: string): boolean {
  if (EXACT.has(actionClass)) return true;
  return PREFIXES.some((prefix) => actionClass.startsWith(prefix));
}

/**
 * `26 §7` step E. Denies `PROHIBITED`, unappealably.
 *
 * It takes ONE argument and reads no state. There is no grant parameter, no principal
 * parameter, no policy parameter and no company parameter, so `26 §6`'s "no grant, no
 * approval, no owner override at runtime can reach them" is a property of the signature.
 */
export function evaluateCategoricalProhibition(actionClass: string): void {
  if (isCategoricallyProhibited(actionClass)) {
    denyAuthority(
      'E',
      'PROHIBITED',
      'CATEGORICALLY_PROHIBITED_CLASS',
      `${actionClass} is categorically prohibited by 26 §6 and is unappealable`,
    );
  }
}

/**
 * `26 §6`'s second enforcement leg, as a checkable property.
 *
 * Returns the classes that appear in BOTH the prohibited list and the closed action
 * catalogue. It must always be empty: a prohibited class in the catalogue would be a class
 * with a registered adapter and method, which is the credential-side enforcement failing.
 */
export function prohibitedClassesInCatalogue(
  catalogueClasses: readonly string[],
): readonly string[] {
  return catalogueClasses.filter((actionClass) => isCategoricallyProhibited(actionClass));
}
