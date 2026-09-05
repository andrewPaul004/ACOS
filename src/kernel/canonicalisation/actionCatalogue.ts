/**
 * The closed action catalogue, and the closed reason-code enum.
 *
 * SR7 and ADR-006: the catalogue is the single extension point. ADR-006, verbatim:
 *
 *   "It also makes the closed action catalogue (SR7) the single extension point, so adding
 *    a capability is a deliberate act with a policy consequence rather than an incidental
 *    tool registration."
 *
 * `37 §2` S1 scope, verbatim:
 *
 *   "Closed action catalogue with exactly three classes: one REVERSIBLE, one COMPENSABLE,
 *    one IRRECOVERABLE, all against a mock adapter — plus one rate-based class against a
 *    mock, because a rate cannot be tested with an amount."
 *
 * So four classes. S1B registers a constructor for exactly ONE of them — `refund.create`,
 * the money-bearing one. The other three are in the catalogue and have no constructor, so
 * they deny `NOT_CANONICALISABLE` at step C2, which is the behaviour `36 §2` asks for:
 *
 *   "an action class with no registered constructor must produce DENY: NOT_CANONICALISABLE."
 */

import type { Money } from '../exposure/money.js';

/** `26 §5`. Assigned per action class in the catalogue, never per request, never by a model. */
export type Recoverability = 'REVERSIBLE' | 'COMPENSABLE' | 'IRRECOVERABLE';

/** `26 §2.1`. "From the catalogue, never null (I59)." */
export type ValueDirection =
  | 'NONE'
  | 'INBOUND_ORIGINAL_INSTRUMENT'
  | 'OUTBOUND_TO_COUNTERPARTY'
  | 'INTERNAL_LIABILITY'
  | 'OUTBOUND_TO_THIRD_PARTY_BENEFICIARY'
  | 'OUTBOUND_GOODS_TO_ADDRESS';

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
 * The closed `reason_code` enum for the S1B fixture catalogue.
 *
 * `26 §2.0`, verbatim: "reason_code       // from a closed enum". `26 §8`'s refund policy
 * sketch reads `context.reason_code in ApprovedReasons`. The architecture requires the
 * enum to be closed and never enumerates its members, so S1B declares a fixture set and
 * records that as a clarification rather than an architecture claim — see
 * docs/implementation/S1B-owner-clarifications.md S1B-C6.
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
 * `reason_code_scope` — the coarser grouping the `refund.create` semantic option digest
 * covers (`26 §2.2`). Two reason codes in one scope select the same effect; a scope change
 * makes it a different effect and therefore a different `option_id`.
 */
export type ReasonCodeScope = 'GOODS_FAULT' | 'GOODS_RETURNED' | 'BILLING_ERROR';

export const REASON_CODE_SCOPES: Readonly<Record<ReasonCode, ReasonCodeScope>> = Object.freeze({
  CUSTOMER_REPORTED_DAMAGE: 'GOODS_FAULT',
  CUSTOMER_REPORTED_NOT_RECEIVED: 'GOODS_FAULT',
  ITEM_RETURNED: 'GOODS_RETURNED',
  DUPLICATE_CHARGE: 'BILLING_ERROR',
  PRICING_ERROR: 'BILLING_ERROR',
});

export interface ActionCatalogueEntry {
  readonly actionClass: ActionClass;
  /** `26 §5`. */
  readonly recoverability: Recoverability;
  /** `26 §2.1`, `26 §11.2`, `I59`. */
  readonly valueDirection: ValueDirection;
  /**
   * Whether the dispatched vendor request carries a monetary field at all.
   *
   * `I18a`, verbatim: "Where the vendor request carries a monetary field,
   * dispatch_payload.monetary_effect == exposure.vendor_amount. Where it does not, both
   * are NULL."
   */
  readonly carriesVendorMonetaryField: boolean;
  /**
   * `I18c`, verbatim: "with equality only for action classes declaring an empty
   * cost_components[] in the catalogue."
   */
  readonly costComponentFree: boolean;
  /** `26 §2.1.3` — a rate class reserves `0.00` and carries its economics in `I3` term 2. */
  readonly rateBased: boolean;
  /**
   * The named windows `51 §2` scopes to this class.
   *
   * `26 §2.1` sources `window_refs` from "every named window the matching grants
   * reference". Grant matching is step I and is not implemented in S1B, so S1B populates
   * this from the catalogue, which is a superset grant matching can only narrow. See
   * S1B-owner-clarifications.md S1B-C5.
   */
  readonly declaredWindows: readonly string[];
  /** `51 §5.1`'s settlement tolerance. Recorded; `I18d` is not implemented in S1B. */
  readonly settlementTolerance: 'EXACT' | 'BAND' | 'NONE';
  /** The mock adapter and method this class dispatches through. No adapter exists in S1B. */
  readonly adapter: string;
  readonly method: string;
}

/**
 * `26 §5`'s worked assignments and `26 §11.2`'s hand-proof table, transcribed. Every row
 * below is quoted in docs/implementation/S1B-contract.md §7.1.
 */
export const ACTION_CATALOGUE: Readonly<Record<ActionClass, ActionCatalogueEntry>> = Object.freeze({
  // `26 §5`: "campaign.pause | REVERSIBLE". `26 §11.2` row 6: value_direction NONE,
  // "Out of scope — zero exposure, REVERSIBLE".
  'campaign.pause': Object.freeze({
    actionClass: 'campaign.pause',
    recoverability: 'REVERSIBLE',
    valueDirection: 'NONE',
    carriesVendorMonetaryField: false,
    costComponentFree: true,
    rateBased: false,
    declaredWindows: Object.freeze([]),
    settlementTolerance: 'NONE',
    adapter: 'mock_ads',
    method: 'campaignPause',
  }),
  // `26 §5`: "refund.create | COMPENSABLE | Money left; the goods relationship persists."
  // `26 §11.2` row 3: INBOUND_ORIGINAL_INSTRUMENT.
  // `51 §2`: W_DAY_REFUND and W_MONTH_REFUND are scoped to refund.create.
  // `51 §5.1`: EXACT — "Settled cost is fully determined pre-dispatch: refund amount plus
  // the processor's published retained fee."
  'refund.create': Object.freeze({
    actionClass: 'refund.create',
    recoverability: 'COMPENSABLE',
    valueDirection: 'INBOUND_ORIGINAL_INSTRUMENT',
    carriesVendorMonetaryField: true,
    costComponentFree: false,
    rateBased: false,
    declaredWindows: Object.freeze(['W_DAY_REFUND', 'W_MONTH_REFUND']),
    settlementTolerance: 'EXACT',
    adapter: 'mock_processor',
    method: 'refundCreate',
  }),
  // `26 §5`: "fulfilment.reship | IRRECOVERABLE, discretionary".
  // `26 §11.2` row 9: OUTBOUND_GOODS_TO_ADDRESS.
  // `26 §2.1.1` names it as the class whose vendor request "contains no money field at
  // all", which is I18a's null branch.
  'fulfilment.reship': Object.freeze({
    actionClass: 'fulfilment.reship',
    recoverability: 'IRRECOVERABLE',
    valueDirection: 'OUTBOUND_GOODS_TO_ADDRESS',
    carriesVendorMonetaryField: false,
    costComponentFree: false,
    rateBased: false,
    declaredWindows: Object.freeze(['W_DAY_RESHIP', 'W_MONTH_RESHIP']),
    settlementTolerance: 'BAND',
    adapter: 'mock_commerce',
    method: 'fulfilmentReship',
  }),
  // `26 §5`: "campaign.budget.set | COMPENSABLE, and rate-based".
  // `26 §2.1.3`: vendor_amount NULL, total_exposure 0.00, forward_integral carries the
  // economics through I3 term 2. `51 §5.1`: BAND(standing_cap).
  'campaign.budget.set': Object.freeze({
    actionClass: 'campaign.budget.set',
    recoverability: 'COMPENSABLE',
    valueDirection: 'OUTBOUND_TO_COUNTERPARTY',
    carriesVendorMonetaryField: false,
    costComponentFree: true,
    rateBased: true,
    declaredWindows: Object.freeze(['W_DAY_ADSPEND', 'W_MONTH_ADSPEND']),
    settlementTolerance: 'BAND',
    adapter: 'mock_ads',
    method: 'campaignBudgetSet',
  }),
});

/**
 * The processor's published fee schedule, as an authoritative RECORD-grade input.
 *
 * `36 §12`'s oracle row requires the fixture table to be "authored from the processor's
 * published fee schedule", and `51 §5.1` says settled cost is "refund amount plus the
 * processor's published retained fee". The architecture prints the resulting $1.03 and
 * does not print the schedule; the derivation is S1B-owner-clarifications.md S1B-C3.
 *
 * It is a value on the authoritative context, not a constant inside the constructor, so a
 * later slice fetching it from a real processor record changes the fixture and not the
 * money path.
 */
export interface ProcessorFeeSchedule {
  readonly scheduleRef: string;
  readonly percentageNumerator: bigint;
  readonly percentageDenominator: bigint;
  readonly fixed: Money;
  readonly currency: string;
}
