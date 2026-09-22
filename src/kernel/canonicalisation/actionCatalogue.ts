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
   * THERE IS DELIBERATELY NO WINDOW FIELD ON THIS TYPE — S1B.1, clarification S1B-C5a.
   *
   * The original S1B carried `declaredWindows` here and the refund constructor read it into
   * `window_refs`. `26 §2.1` defines `window_refs` as "every named window the matching
   * grants reference", and catalogue membership is not grant resolution: the catalogue says
   * what a class CAN touch, a grant says what this principal MAY touch, and only the second
   * answers the question the field asks. Rather than leave a field whose only plausible
   * reader is the wrong one, the field is gone. `window_refs` arrive through
   * `grantWindows.ts`'s authoritative boundary, and
   * `tests/canonicalisation/window-ref-provenance.test.ts` asserts the catalogue cannot
   * manufacture a different set.
   */
  /**
   * `51 §2.3`'s per-action-class irrecoverable-unit count — v1.3.5 (MIE-01, S1J-C1).
   *
   * =================================================================================
   * THE DECLARATION, VERBATIM
   *
   * `51 §2.3`: "**`irrecoverable_units` is declared here, per action class, as part of the
   * closed catalogue's execution metadata.**" and, on ownership:
   *
   *   "**THE VALUE IS KERNEL- AND CATALOGUE-OWNED AND IS NEVER MODEL- OR CALLER-SUPPLIED.**
   *    It is a property of the action class in exactly the sense `26 §5`'s recoverability
   *    is [...] **There is no generic caller parameter for it, and no request field carries
   *    one.** A REVERSIBLE or COMPENSABLE class declares `0` and therefore moves the
   *    irrecoverable ledger not at all."
   *
   * `25 §10.1` is the lifecycle it feeds: step R reserves this many units against EVERY
   * applicable MIE window instance, `PRESUMED_EXECUTED` moves them `reserved → presumed`,
   * and `DISPATCH_NOT_SENT_CONFIRMED` releases them.
   * =================================================================================
   *
   * =================================================================================
   * IT IS A FIELD OF THE FROZEN ENTRY AND NOT AN ARGUMENT ANYWHERE
   *
   * `src/kernel/exposure/stepR.ts` reads it through `irrecoverableUnitsFor(actionClass)`
   * and NOT from its request object, so the reservation writer cannot be handed a unit
   * count. `tests/type-negative/mie-units-as-argument.ts` asserts that no worker-facing or
   * kernel-facing reservation surface accepts one, and
   * `tests/integration/exposure/mie-reservation.test.ts` asserts the catalogue's values
   * against a HAND-AUTHORED transcription of `51 §2.3`'s table.
   *
   * `bigint`, matching the `BIGINT` ledger columns `24 §3` K5 declares, so no unit count
   * ever passes through a `number` on the way to the ledger.
   * =================================================================================
   */
  readonly irrecoverableUnits: bigint;
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
    // `51 §2.3`: "`campaign.pause` | REVERSIBLE | **0**".
    irrecoverableUnits: 0n,
    settlementTolerance: 'NONE',
    adapter: 'mock_ads',
    method: 'campaignPause',
  }),
  // `26 §5`: "refund.create | COMPENSABLE | Money left; the goods relationship persists."
  // `26 §11.2` row 3: INBOUND_ORIGINAL_INSTRUMENT.
  // `51 §5.1`: EXACT — "Settled cost is fully determined pre-dispatch: refund amount plus
  // the processor's published retained fee."
  'refund.create': Object.freeze({
    actionClass: 'refund.create',
    recoverability: 'COMPENSABLE',
    valueDirection: 'INBOUND_ORIGINAL_INSTRUMENT',
    carriesVendorMonetaryField: true,
    costComponentFree: false,
    rateBased: false,
    // `51 §2.3`: "`refund.create` | COMPENSABLE | **0**".
    irrecoverableUnits: 0n,
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
    // `51 §2.3`: "`fulfilment.reship` | IRRECOVERABLE | **1**". The only class in this
    // catalogue that moves ledger 3 at all.
    irrecoverableUnits: 1n,
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
    // `51 §2.3`: "`campaign.budget.set` | COMPENSABLE (rate) | **0**".
    irrecoverableUnits: 0n,
    settlementTolerance: 'BAND',
    adapter: 'mock_ads',
    method: 'campaignBudgetSet',
  }),
});


/**
 * `I66` / `25 §7`'s OUTBOX SCOPE PREDICATE — v1.3.4 (OBX-02), resolving `S1I-C5`.
 *
 * =================================================================================
 * THE DECLARATION, VERBATIM
 *
 * `25 §7`: "**The ACOS dispatch outbox applies to every effect that will cross an
 * external-write boundary** (`48`), whatever its recoverability class. [...] **The scope
 * predicate is `effect requires external dispatch`.** It is **not**
 * `effect.recoverability == IRRECOVERABLE`, and it is **not** every catalogue action
 * unconditionally [...] **The predicate is derived from the closed action catalogue's
 * execution metadata**, so it is a property of the catalogue that a model cannot choose
 * and a caller cannot pass."
 *
 * `I66`: "Every effect that will cross an external-write boundary takes exactly one
 * outbox row, and an internal-only effect takes none."
 * =================================================================================
 *
 * =================================================================================
 * WHY IT IS DERIVED FROM THE ADAPTER AND NOT DECLARED AS A FLAG
 *
 * A boolean field on the catalogue entry would be a second place the fact lives, and
 * `48 §2`'s perimeter enumeration already decides it: a class executes by calling an
 * ADAPTER, and an adapter is by construction a component in the integration plane whose
 * rows in `48 §2` are the external writes. So the predicate reads the execution metadata
 * that already has to be right for the class to execute at all — `26 §5`'s catalogue
 * assignment of `adapter` and `method` — rather than a flag someone must remember to set
 * correctly beside it.
 *
 * **`INTERNAL_ONLY_ADAPTER` IS THE EXPLICIT REPRESENTATION OF AN INTERNAL-ONLY CLASS.**
 * `37` S1's closed catalogue has no such class today — all four run against a mock
 * adapter standing in for a real external one — so at S1 the predicate is TRUE for every
 * catalogue member and the existing enqueue behaviour already conforms. It is declared
 * anyway, and tested through `requiresExternalDispatchFor`, because `I66` has two halves
 * and a predicate whose false branch is unrepresentable proves only one of them.
 * `outbox-scope.test.ts` exercises both.
 * =================================================================================
 *
 * THERE IS NO OVERRIDE AND NO PARAMETER. This function takes an `ActionClass` and reads
 * the frozen catalogue. It has no options argument, no allow list and no escape, so
 * `I66`'s "never a caller's or a model's choice" is a property of the signature rather
 * than of a check inside it.
 */
export const INTERNAL_ONLY_ADAPTER = 'internal_only';

export function requiresExternalDispatch(entry: ActionCatalogueEntry): boolean {
  return entry.adapter !== INTERNAL_ONLY_ADAPTER;
}

/** The same predicate, resolved from the closed catalogue by class. */
export function requiresExternalDispatchFor(actionClass: ActionClass): boolean {
  return requiresExternalDispatch(ACTION_CATALOGUE[actionClass]);
}


/**
 * `51 §2.3`'s unit count, RESOLVED FROM THE CLOSED CATALOGUE BY CLASS — v1.3.5 (MIE-01).
 *
 * =================================================================================
 * THE SIGNATURE IS THE AUTHORITY PROPERTY. READ IT BEFORE THE BODY.
 *
 * One parameter, an `ActionClass`. There is no units argument, no options bag, no override,
 * no allow list and no default parameter, so `51 §2.3`'s "**there is no generic caller
 * parameter for it, and no request field carries one**" is a property of this signature
 * rather than of a check inside it. `26 §1` Corollary 3 — "the request must be built by the
 * ceiling's enforcer, not by its subject" — applied to a ceiling whose subject is an
 * authorised effect.
 *
 * `src/kernel/exposure/stepR.ts` is the only production caller, and
 * `tests/integration/gateway/no-real-transport-boundary.test.ts` asserts that no reservation
 * surface under `src/` accepts a unit count as an argument.
 * =================================================================================
 *
 * =================================================================================
 * A CLASS WITH NO DECLARED VALUE THROWS. IT DOES NOT DEFAULT — `51 §2.3`.
 *
 * "**A future action class needing a value other than 1 must declare it here, and `NO
 *  IMPLICIT DEFAULT MAY WIDEN AUTHORITY.`** A class present in the catalogue with no
 *  declared value is a **catalogue-validation failure, not a class with a value of one** —
 *  the same fail-closed rule SR7 applies to every other undeclared catalogue dimension."
 *
 * TypeScript makes the field mandatory on `ActionCatalogueEntry`, so the omission cannot
 * compile; the runtime throw below covers the one remaining route — an entry reaching this
 * function from outside the frozen literal — and it is an ASSERTION, not a fallback.
 * =================================================================================
 */
export function irrecoverableUnitsFor(actionClass: ActionClass): bigint {
  const entry = ACTION_CATALOGUE[actionClass];
  if (entry === undefined) {
    throw new Error(
      `${actionClass} is not in the closed action catalogue; an undeclared class has no ` +
        'irrecoverable_units and no implicit default may widen authority (51 §2.3)',
    );
  }
  const units = entry.irrecoverableUnits;
  if (typeof units !== 'bigint' || units < 0n) {
    throw new Error(
      `${actionClass} declares no valid irrecoverable_units; a catalogued class with no ` +
        'declared value is a catalogue-validation failure, not a class with a value of ' +
        'one (51 §2.3)',
    );
  }
  return units;
}

/**
 * `51 §2.3`'s COHERENCE RULE, checked at module load.
 *
 * "**For every IRRECOVERABLE class in the current catalogue the declared value is `1`, and
 *  for every REVERSIBLE and COMPENSABLE class it is `0`.**" (`25 §10.1` prints the same
 * sentence.)
 *
 * A REVERSIBLE class declaring a positive count would move ledger 3 for an effect that is
 * not irrecoverable, and an IRRECOVERABLE class declaring `0` would remove the class from
 * the MIE ceiling entirely — `51 §2.3` names exactly that as the reason the table is signed
 * control-artifact class 17 content. Both are startup failures rather than runtime
 * surprises, for the same reason `preReservation.ts` asserts its step order at construction.
 */
for (const actionClass of ACTION_CLASSES) {
  const entry = ACTION_CATALOGUE[actionClass];
  const units = entry.irrecoverableUnits;
  if (entry.recoverability === 'IRRECOVERABLE') {
    if (units < 1n) {
      throw new Error(
        `catalogue defect: ${actionClass} is IRRECOVERABLE and declares ` +
          `irrecoverable_units = ${String(units)}; 51 §2.3 declares 1 for every current ` +
          'IRRECOVERABLE class and a 0 would remove the class from the MIE ceiling',
      );
    }
  } else if (units !== 0n) {
    throw new Error(
      `catalogue defect: ${actionClass} is ${entry.recoverability} and declares ` +
        `irrecoverable_units = ${String(units)}; 51 §2.3 declares 0 for every REVERSIBLE ` +
        'and COMPENSABLE class, which move the irrecoverable ledger not at all',
    );
  }
}
