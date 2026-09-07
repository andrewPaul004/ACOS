import type { ValueDirection } from '../canonicalisation/actionCatalogue.js';
import type { Counterparty } from '../canonicalisation/types.js';
import { denyAuthority } from './errors.js';
import { noveltyOrdinal, type CounterpartyNovelty, type EffectiveAuthority } from './grants.js';

/**
 * Step K — "counterparty.novelty ≤ grant limit?"
 *
 * `26 §7`'s flowchart edge, verbatim: `K -->|no| D9[DENY: NOVEL_COUNTERPARTY]`.
 *
 * ---------------------------------------------------------------------------------
 * APPLICABILITY COMES FROM THE CATALOGUE'S `value_direction`, NOT FROM THE INTENT
 *
 * `26 §1` Corollary 1, verbatim: "**'counterparty' means a payee, supplier or settlement
 * destination** — not a customer. A first-time buyer receiving their own refund to their own
 * original instrument is not a novel counterparty, and conflating the two produced a formal
 * property (P4) that either forbade refunding a new customer or was misdescribed."
 *
 * `26 §2.1`, on `value_direction`: "**From the catalogue, never null (I59)**", with the six
 * declared values. `51 §3.1` states the consequence for the one class in that position:
 * "`goodwill.credit.issue` […] carries no counterparty-novelty test because
 * `INTERNAL_LIABILITY` has no external destination."
 *
 * So the three-way split below is read off the CLASS's catalogue row, which `I21` puts on
 * the far side of the intent boundary:
 *
 *   NONE                              no external destination     -> K not applicable
 *   INBOUND_ORIGINAL_INSTRUMENT       money returns to its payer  -> K not applicable
 *   INTERNAL_LIABILITY                internal, no destination    -> K not applicable
 *   OUTBOUND_TO_COUNTERPARTY          external destination        -> K APPLIES
 *   OUTBOUND_TO_THIRD_PARTY_BENEFICIARY  external destination     -> K APPLIES
 *   OUTBOUND_GOODS_TO_ADDRESS         external destination        -> K APPLIES
 *
 * `26 §14` names the attack this closes, verbatim: "**Move goods to an arbitrary destination
 * without tripping a monetary cap** (v1.2) | **P4 over `OUTBOUND_GOODS_TO_ADDRESS`.**"
 *
 * ---------------------------------------------------------------------------------
 * NON-APPLICABILITY IS ASSERTED, NOT ASSUMED
 *
 * The dangerous shape is a gate that returns early on `value_direction != OUTBOUND_*` and
 * therefore never looks at the counterparty. A constructor that computed an outbound
 * destination while the catalogue declared the class `NONE` would then move goods with step
 * K skipped — `36 §2` VC-R2/VC-R3 names exactly that: "a compromised constructor declaring
 * an outbound class `NONE` must fail these, since it would otherwise remove the class from
 * P4's scope entirely."
 *
 * So both directions are checked and both fail closed:
 *
 *   outbound direction with NO counterparty     -> DENY NOVEL_COUNTERPARTY
 *   non-outbound direction WITH a counterparty  -> DENY NOVEL_COUNTERPARTY
 *
 * The second is a denial rather than a defect deliberately. It is reachable by a catalogue /
 * constructor disagreement, and `26 §7`'s terminal for "this action's destination is not one
 * this authority admits" is D9.
 * ---------------------------------------------------------------------------------
 */

const OUTBOUND_DIRECTIONS: ReadonlySet<ValueDirection> = new Set<ValueDirection>([
  'OUTBOUND_TO_COUNTERPARTY',
  'OUTBOUND_TO_THIRD_PARTY_BENEFICIARY',
  'OUTBOUND_GOODS_TO_ADDRESS',
]);

/** Whether step K applies to a class, decided by the CATALOGUE's declared direction. */
export function stepKApplies(valueDirection: ValueDirection): boolean {
  return OUTBOUND_DIRECTIONS.has(valueDirection);
}

export function evaluateCounterparty(
  valueDirection: ValueDirection,
  counterparty: Counterparty | null,
  authority: EffectiveAuthority,
): void {
  if (!stepKApplies(valueDirection)) {
    if (counterparty !== null) {
      denyAuthority(
        'K',
        'NOVEL_COUNTERPARTY',
        'COUNTERPARTY_PRESENT_ON_NON_OUTBOUND_CLASS',
        `the catalogue declares ${valueDirection} and the request carries a counterparty`,
      );
    }
    return;
  }

  if (counterparty === null) {
    denyAuthority(
      'K',
      'NOVEL_COUNTERPARTY',
      'COUNTERPARTY_ABSENT_ON_OUTBOUND_CLASS',
      `the catalogue declares ${valueDirection} and the request carries no counterparty`,
    );
  }

  // `26 §4`: `counterparty_selector { novelty_max: EXISTING | ALLOWLISTED }`. A grant with no
  // selector permits no external counterparty at all — the closed default — so an outbound
  // class under such a grant denies rather than defaulting to the broadest value.
  if (authority.counterpartyNoveltyMax === null) {
    denyAuthority(
      'K',
      'NOVEL_COUNTERPARTY',
      'GRANT_PERMITS_NO_COUNTERPARTY',
      'the effective grant authority declares no counterparty novelty ceiling',
    );
  }

  const novelty: CounterpartyNovelty = counterparty.novelty;
  if (noveltyOrdinal(novelty) > noveltyOrdinal(authority.counterpartyNoveltyMax)) {
    denyAuthority(
      'K',
      'NOVEL_COUNTERPARTY',
      'COUNTERPARTY_NOVELTY_ABOVE_GRANT_MAX',
      `counterparty novelty ${novelty} exceeds the effective ceiling ${authority.counterpartyNoveltyMax}`,
    );
  }
}
