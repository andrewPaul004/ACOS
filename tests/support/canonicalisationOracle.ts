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
 * here. `tests/canonicalisation/oracle-independence.test.ts` reads this file's source and
 * fails if an import of `src/` ever appears.
 *
 * `36 §0` permits the oracle to do elementary arithmetic itself, and it does: one
 * multiplication, one half-away-from-zero rounding, one addition.
 * ---------------------------------------------------------------------------------
 */

// =====================================================================================
// The oracle's own arithmetic.  Three operations, written out.
// =====================================================================================

/** `round_half_away_from_zero(a / b)` over integers. */
export function divideRoundHalfAway(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error('oracle: denominator must be positive');
  const negative = numerator < 0n;
  const magnitude = negative ? -numerator : numerator;
  const quotient = magnitude / denominator;
  const remainder = magnitude % denominator;
  const rounded = remainder * 2n >= denominator ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

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
 * `51 §3.1`'s note prints the same three figures. The fee SCHEDULE is not printed in the
 * architecture; it is the owner clarification S1B-C3 — the Stripe-family standard card
 * rate, 2.9% + $0.30 — and it is the schedule that reproduces the printed $1.03.
 */
export const VC_C1 = Object.freeze({
  // --- inputs, hand-authored -----------------------------------------------------------
  /** The refund amount visible to the vendor: $25.00. */
  refundAmountMinor: 2500n,
  /** The processor's published rate: 2.9%, as 29/1000. */
  feePercentNumerator: 29n,
  feePercentDenominator: 1000n,
  /** The processor's published fixed component: $0.30. */
  feeFixedMinor: 30n,
  currency: 'USD',

  // --- expected outputs, hand-authored ---------------------------------------------------
  /** $1.03.  $25.00 × 2.9% = $0.725 -> $0.73 half away from zero;  $0.73 + $0.30 = $1.03. */
  expectedRetainedFeeMinor: 103n,
  /** $25.00 — the money in the dispatched request (I18a). */
  expectedVendorAmountMinor: 2500n,
  /** $26.03 — the economic loss, and the reserved quantity (I18b). */
  expectedTotalExposureMinor: 2603n,

  // --- the per-action cap this fixture discriminates against ------------------------------
  /** `51 §3.1`: refund.create per_action_max is $25.00. */
  perActionCapMinor: 2500n,
} as const);

/**
 * The oracle's own recomputation of the fee, from the schedule, by its own arithmetic.
 *
 * `tests/canonicalisation/oracle-independence.test.ts` asserts this agrees with the
 * hand-authored `expectedRetainedFeeMinor`, so a typo in either is caught before the
 * fixture is used to judge production code. This is the same self-check discipline
 * `tests/integration/exposure/oracle-self-check.test.ts` applies in S1A.
 */
export function oracleRetainedFeeMinor(): bigint {
  const percentagePart = divideRoundHalfAway(
    VC_C1.refundAmountMinor * VC_C1.feePercentNumerator,
    VC_C1.feePercentDenominator,
  );
  return percentagePart + VC_C1.feeFixedMinor;
}

export function oracleTotalExposureMinor(): bigint {
  return VC_C1.refundAmountMinor + oracleRetainedFeeMinor();
}

// =====================================================================================
// The expected vendor payload and the expected semantic-digest inputs.
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
  destinationInstrumentRef: 'instrument:pm_original_CH-9001',
  lineRefundableRemainingMinor: 4000n,
  customerNovelty: 'RETURNING',
} as const);

/**
 * The dispatch payload a correct constructor must produce, hand-authored field by field.
 *
 * `26 §2.1`, verbatim: "The adapter receives the payload verbatim and constructs nothing."
 * The point of authoring it here is that the adapter's future input is pinned by the
 * fixture, not by whatever the constructor happens to emit.
 */
export const VC_C1_EXPECTED_VENDOR_PARAMETERS: Readonly<Record<string, string>> = Object.freeze({
  parent_transaction_id: 'txn:CH-9001',
  line_id: 'line:ORD-123:1',
  amount: '25.00',
  currency: 'USD',
  instrument: 'original',
  destination_instrument_ref: 'instrument:pm_original_CH-9001',
});

export const VC_C1_EXPECTED_ADAPTER = 'mock_processor';
export const VC_C1_EXPECTED_METHOD = 'refundCreate';
