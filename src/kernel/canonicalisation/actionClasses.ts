/**
 * THE CLOSED MEMBER SETS AND THEIR TYPESCRIPT TYPES — and NOT their authority values.
 *
 * =================================================================================
 * WHAT MAY STAY A CONSTANT AFTER S1K, AND WHAT MAY NOT
 *
 * `50 §3c`: "**A signed control artifact and a separate hard-coded production literal may
 * not both be authority sources**, with equality asserted only in a test; that arrangement
 * leaves the unsigned literal authoritative, because the test is not in the authority path."
 *
 * `§17` of the S1K mandate draws the line this file sits on: "Constants may remain for:
 * TypeScript enum names; parser machinery; structural schemas; but not for independent
 * authority values that can disagree with the signed artifact."
 *
 * SO THIS FILE HOLDS MEMBER SETS AND TYPES, AND NOTHING THAT DECIDES ANYTHING.
 *
 *   `ACTION_CLASSES`   the closed catalogue's MEMBER SET — `SR7`'s single extension point,
 *                      and the union every signature in `src/` is written against. Adding a
 *                      member here adds a TypeScript name; it adds no recoverability, no
 *                      adapter, no unit count and no authority, all of which arrive only
 *                      from the verified class-3 artifact.
 *
 *   `REASON_CODES`     the same, for `26 §2.0`'s closed enum.
 *
 *   the type unions    `Recoverability`, `ValueDirection`, `ReasonCodeScope` — the DOMAINS
 *                      `50 §2a` fields 2 and 3 and record 12 declare. A parser needs them to
 *                      refuse a value outside the domain; none of them says which value a
 *                      class has.
 *
 * WHAT IS NOT HERE, AND WAS BEFORE S1K: the per-class entry table and the reason-code scope
 * map. Both were authority values and both now come from `50 §2a`'s signed artifact through
 * `actionCatalogue.ts`'s accessors.
 *
 * =================================================================================
 * WHY IT IS A SEPARATE FILE
 *
 * The class-3 PARSER must refuse a member outside the closed set, so it needs these names;
 * `actionCatalogue.ts` must read the verified bundle, so it needs the registry. Leaving both
 * in one module would make `actionCatalogue -> registry -> verifier -> parser ->
 * actionCatalogue` a runtime import cycle. ES modules survive that, and a cycle on the
 * authority path is still a thing to remove rather than to reason about.
 * =================================================================================
 */

/** `26 §5`. Assigned per action class BY THE VERIFIED CATALOGUE, never per request. */
export type Recoverability = 'REVERSIBLE' | 'COMPENSABLE' | 'IRRECOVERABLE';

/** `26 §2.1`. "From the catalogue, never null (I59)." */
export type ValueDirection =
  | 'NONE'
  | 'INBOUND_ORIGINAL_INSTRUMENT'
  | 'OUTBOUND_TO_COUNTERPARTY'
  | 'INTERNAL_LIABILITY'
  | 'OUTBOUND_TO_THIRD_PARTY_BENEFICIARY'
  | 'OUTBOUND_GOODS_TO_ADDRESS';

/** `51 §5.1`, `I18d`. The domain of `50 §2a` field 8. */
export type SettlementTolerance = 'EXACT' | 'BAND' | 'NONE';

/**
 * `37 §2` S1's closed catalogue: "exactly three classes: one REVERSIBLE, one COMPENSABLE,
 * one IRRECOVERABLE, all against a mock adapter — plus one rate-based class against a mock".
 *
 * The MEMBERSHIP is here. Which of them is which is `50 §2a` field 2's business.
 */
export const ACTION_CLASSES = [
  'campaign.pause',
  'refund.create',
  'fulfilment.reship',
  'campaign.budget.set',
] as const;

export type ActionClass = (typeof ACTION_CLASSES)[number];

const ACTION_CLASS_SET: ReadonlySet<string> = new Set<string>(ACTION_CLASSES);

export function isActionClass(value: string): value is ActionClass {
  return ACTION_CLASS_SET.has(value);
}

/**
 * `26 §2.0`'s closed `reason_code` enum, as the S1B fixture declared it under clarification
 * S1B-C6. `50 §2a` record 11 is what SIGNS it.
 *
 * The point of the closure is that `reason_code` is NOT free text, which is what leaves
 * `rationale` as the only free text on the model-facing surface.
 */
export const REASON_CODES = [
  'CUSTOMER_REPORTED_DAMAGE',
  'CUSTOMER_REPORTED_NOT_RECEIVED',
  'ITEM_RETURNED',
  'DUPLICATE_CHARGE',
  'PRICING_ERROR',
] as const;

export type ReasonCode = (typeof REASON_CODES)[number];

const REASON_CODE_SET: ReadonlySet<string> = new Set<string>(REASON_CODES);

export function isReasonCode(value: string): value is ReasonCode {
  return REASON_CODE_SET.has(value);
}

/**
 * `26 §2.2`'s coarser grouping. The DOMAIN is here; `50 §2a` record 12's total map — which
 * code sits in which scope — is signed content and arrives from the verified artifact.
 */
export type ReasonCodeScope = 'GOODS_FAULT' | 'GOODS_RETURNED' | 'BILLING_ERROR';

/** `50 §2a` field 9's reserved sentinel. `I66`'s outbox scope predicate reads it. */
export const INTERNAL_ONLY_ADAPTER = 'internal_only';
