/**
 * The independent oracle for S1B's canonicalisation fixtures.
 *
 * `36 §0`, the requirement that governs the whole validation plan, verbatim:
 *
 *   "Independent validation must not call the same production function twice and call
 *    agreement proof."
 *
 * ADR-021's Testing paragraph, verbatim:
 *
 *   "Per-class construction tests whose expected values are computed independently of the
 *    production constructor — a second implementation or a hand-computed fixture table.
 *    46 R1 is explicit: a test that calls the same function twice proves nothing."
 *
 * ---------------------------------------------------------------------------------
 * THIS FILE IMPORTS NOTHING FROM `src/`.
 *
 * Not the constructor, not the exposure calculator, not `money.ts`. Every figure below is
 * a hand-authored integer count of minor units and every operation below is written out
 * here. `tests/canonicalisation/source-rules.test.ts` reads this file's source and fails if
 * an import of `src/` ever appears.
 * ---------------------------------------------------------------------------------
 */

// =====================================================================================
// The oracle's own arithmetic.  One addition and one renderer, written out.
//
// S1B.1 removed `divideRoundHalfAway`. It existed only to reproduce the withdrawn 2.9%
// schedule, and a rounding primitive sitting in the oracle is a standing invitation to
// reintroduce the derivation. `tests/canonicalisation/source-rules.test.ts` asserts this
// file carries no percentage arithmetic at all.
// =====================================================================================

/** Render a minor-unit count at scale 2, the way a NUMERIC(18,2) prints. */
export function formatMinor(minor: bigint): string {
  const negative = minor < 0n;
  const magnitude = negative ? -minor : minor;
  return `${negative ? '-' : ''}${magnitude / 100n}.${(magnitude % 100n).toString().padStart(2, '0')}`;
}

// =====================================================================================
// The VC-C1 fixture table, hand-authored.
// =====================================================================================

/**
 * `36 §2`, verbatim:
 *
 *   "VC-C1 additionally asserts the negative case the retirement was about: a $25.00 line
 *    refund with a $1.03 retained fee computes total_exposure = $26.03 and denies
 *    PER_ACTION against a $25.00 cap."
 *
 * `51 §3.1`'s note prints the same three figures.
 *
 * ---------------------------------------------------------------------------------
 * S1B.1 — THERE IS NO FEE SCHEDULE HERE, clarification S1B-C3a
 *
 * The original oracle carried `29`, `1000` and `30` and recomputed `$1.03` as
 * `round_half_away(2500 × 29/1000) + 30`. Reproducing a printed figure is not the same as
 * being entitled to the rule that reproduces it. The architecture prints `$1.03` and names
 * its source as an authoritative record; it establishes no rate, no fixed charge and no
 * rounding convention. The derivation was withdrawn with owner clarification S1B-C3.
 *
 * What remains is what the architecture actually prints: hand-authored figures, and one
 * addition. That addition is `36 §0`-permitted elementary arithmetic and is the only
 * operation this file performs on them.
 * ---------------------------------------------------------------------------------
 */
export const VC_C1 = Object.freeze({
  // --- inputs, hand-authored -----------------------------------------------------------
  /** The refund amount visible to the vendor: $25.00. */
  refundAmountMinor: 2500n,
  /**
   * The AUTHORITATIVE retained processing fee for this fixture: $1.03.
   *
   * An amount, supplied to the canonicaliser by kernel-owned authoritative state. Not
   * derived here, and not derivable here — there is no schedule in this file to derive it
   * from, which is the point.
   */
  authoritativeRetainedFeeMinor: 103n,
  currency: 'USD',

  // --- expected outputs, hand-authored ---------------------------------------------------
  /** $1.03 — the authoritative fee, as the emitted cost component. */
  expectedRetainedFeeMinor: 103n,
  /** $25.00 — the money in the dispatched request (I18a). */
  expectedVendorAmountMinor: 2500n,
  /** $26.03 — the economic loss, and the reserved quantity (I18b).  $25.00 + $1.03. */
  expectedTotalExposureMinor: 2603n,

  // --- the per-action cap this fixture discriminates against ------------------------------
  /** `51 §3.1`: refund.create per_action_max is $25.00. */
  perActionCapMinor: 2500n,
} as const);

/**
 * The MUTATED authoritative fee, for the S1B.1 discriminating test.
 *
 * The same semantic refund option, at a different authoritative economic cost of performing
 * it: $1.03 -> $1.10. The vendor still sees $25.00 and the option identity does not move,
 * because `26 §2.2`'s declared `semantic_option_digest` for `refund.create` is
 * "line_id · parent_transaction_id · amount · instrument · reason_code_scope" and the
 * retained fee is not among its members. Total exposure moves $26.03 -> $26.10.
 *
 * This pair is what separates the IDENTITY of the vendor effect from the CURRENT
 * AUTHORITATIVE COST of performing it.
 */
export const VC_C1_MUTATED_FEE = Object.freeze({
  /** $1.10. */
  authoritativeRetainedFeeMinor: 110n,
  /** $26.10.  $25.00 + $1.10. */
  expectedTotalExposureMinor: 2610n,
} as const);

/** The fixture's fee, restated as the oracle's own value rather than read from production. */
export function oracleRetainedFeeMinor(): bigint {
  return VC_C1.authoritativeRetainedFeeMinor;
}

/**
 * The oracle's own total, by its own arithmetic.
 *
 * `tests/canonicalisation/source-rules.test.ts` asserts this agrees with the hand-authored
 * `expectedTotalExposureMinor`, so a typo in either is caught before the fixture is used to
 * judge production code — the same self-check discipline
 * `tests/integration/exposure/oracle-self-check.test.ts` applies in S1A.
 */
export function oracleTotalExposureMinor(): bigint {
  return VC_C1.refundAmountMinor + VC_C1.authoritativeRetainedFeeMinor;
}

export function oracleMutatedTotalExposureMinor(): bigint {
  return VC_C1.refundAmountMinor + VC_C1_MUTATED_FEE.authoritativeRetainedFeeMinor;
}

// =====================================================================================
// The expected vendor payload, the semantic-digest inputs, and the grant windows.
// =====================================================================================

/**
 * The `refund.create` fixture's authoritative option, as hand-authored strings.
 *
 * These five are `26 §2.2`'s declared `semantic_option_digest` members for this class:
 * "line_id · parent_transaction_id · amount · instrument · reason_code_scope".
 */
export const VC_C1_SEMANTIC_OPTION_FIELDS = Object.freeze({
  lineId: 'line:ORD-123:1',
  parentTransactionId: 'txn:CH-9001',
  amountMinor: 2500n,
  instrument: 'original',
  reasonCodeScope: 'GOODS_FAULT',
} as const);

export const VC_C1_ORDER = Object.freeze({
  resourceRef: 'order:ORD-123',
  resourceId: 'ORD-123',
  /**
   * `26 §8`: `context.selected_option.line_refundable_remaining`. $40.00.
   *
   * Current authoritative policy state, hand-authored here. NOT a member of
   * `semantic_option_digest` — S1B.2 finding 2 — so a change to it must move the recorded
   * selected option and must NOT move `option_id`.
   */
  lineRefundableRemainingMinor: 4000n,
  customerNovelty: 'RETURNING',
} as const);

/**
 * A SECOND authoritative refundable remaining, for the finding-2 discriminating pair.
 * $18.00: still above the $25.00 refund? No — deliberately below it, so the later policy
 * slice's `line_refundable_remaining >= amount` operand is one whose value actually
 * decides something.
 */
export const VC_C1_MUTATED_REFUNDABLE_REMAINING_MINOR = 1800n;

/**
 * The `reason_code -> reason_code_scope` mapping, HAND-AUTHORED — S1B-C6, and the fixture
 * S1B.2 finding 1D is checked against.
 *
 * Transcribed from the owner clarification, not imported from `src/`. That is the point: if
 * production and this table ever disagree, the cohesion suite says so instead of comparing
 * the production map with itself.
 *
 * A FIXTURE-LEVEL consistency rule tied to S1B-C6. Not a claim that this enum or this
 * grouping is universal production policy.
 */
export const VC_C1_REASON_CODE_SCOPES: Readonly<Record<string, string>> = Object.freeze({
  CUSTOMER_REPORTED_DAMAGE: 'GOODS_FAULT',
  CUSTOMER_REPORTED_NOT_RECEIVED: 'GOODS_FAULT',
  ITEM_RETURNED: 'GOODS_RETURNED',
  DUPLICATE_CHARGE: 'BILLING_ERROR',
  PRICING_ERROR: 'BILLING_ERROR',
});

/** The reason code the ordinary VC-C1 fixture proposes. In scope `GOODS_FAULT`. */
export const VC_C1_REASON_CODE = 'CUSTOMER_REPORTED_DAMAGE';

/** A valid reason code in a DIFFERENT scope, for the finding-1D negative case. */
export const VC_C1_OUT_OF_SCOPE_REASON_CODE = 'PRICING_ERROR';

/**
 * The window refs the fixture's authoritative grant/window boundary resolves — S1B-C5a.
 *
 * Hand-authored here, in the oracle, precisely because they are NOT derivable from anything
 * the production tree holds. `51 §2` scopes these two windows to `refund.create`, but that
 * is catalogue scoping and `26 §2.1` asks for "every named window the matching grants
 * reference". S1B resolves no grant, so the fixture states the answer and the contract
 * records that it is stated rather than derived.
 */
export const VC_C1_EXPECTED_WINDOW_REFS: readonly string[] = Object.freeze([
  'W_DAY_REFUND',
  'W_MONTH_REFUND',
]);

/**
 * The dispatch payload a correct constructor must produce, hand-authored field by field.
 *
 * `26 §2.1`, verbatim: "The adapter receives the payload verbatim and constructs nothing."
 * The point of authoring it here is that the adapter's future input is pinned by the
 * fixture, not by whatever the constructor happens to emit.
 */
/**
 * S1B.2 finding 3: there is NO `destination_instrument_ref` here any more.
 *
 * The destination of a refund is the RECORD-grade parent transaction's own instrument, and
 * the payload names it with `parent_transaction_id` and `instrument` — the architecture's
 * two-dimensional refund enumeration, both members of `26 §2.2`'s declared
 * `semantic_option_digest`. A separate identifier was an independent effect dimension
 * outside option identity, which `26 §2.2` forbids. Which concrete vendor fields a real
 * processor requires for that parent transaction is the adapter slice's question.
 */
export const VC_C1_EXPECTED_VENDOR_PARAMETERS: Readonly<Record<string, string>> = Object.freeze({
  parent_transaction_id: 'txn:CH-9001',
  line_id: 'line:ORD-123:1',
  amount: '25.00',
  currency: 'USD',
  instrument: 'original',
});

export const VC_C1_EXPECTED_ADAPTER = 'mock_processor';
export const VC_C1_EXPECTED_METHOD = 'refundCreate';
