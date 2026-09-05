import type { Money } from '../exposure/money.js';

/**
 * Authoritative economic cost components, as kernel-owned INPUTS to canonicalisation.
 *
 * `26 §2.1`, on the exposure block, verbatim:
 *
 *   "cost_components[] — retained processing fee · freight · COGS · compensator cost"
 *
 * `51 §5.1`, verbatim:
 *
 *   "Settled cost is fully determined pre-dispatch: refund amount plus the processor's
 *    published retained fee. Single currency only."
 *
 * ---------------------------------------------------------------------------------
 * WHY THIS IS AN AMOUNT AND NOT A SCHEDULE — S1B.1, owner clarification S1B-C3a
 *
 * The original S1B carried a `ProcessorFeeSchedule` on the authoritative context —
 * `{ percentage_numerator, percentage_denominator, fixed }` — and the refund constructor
 * derived the fee as `round_half_away(vendor_amount × 2.9%) + $0.30`. That reproduced the
 * architecture's printed `$1.03` exactly, and it was still wrong: the architecture
 * establishes that refunds may carry a retained processing fee, that the fee is an
 * authoritative cost component, and that the discriminating fixture is
 * `$25.00 / $1.03 / $26.03`. It establishes NO universal rate, NO universal fixed charge,
 * NO rounding formula and NO processor fee schedule. An implementation may not invent an
 * economic rule because the rule happens to reproduce a fixture.
 *
 * So ACOS does not know a fee schedule at S1B. It knows a fee AMOUNT, supplied by the
 * kernel from an authoritative record, together with the reference of the record it came
 * from. The constructor ADDS authoritative components; it derives none.
 *
 * Selecting a real processor's fee model — Stripe's, Shopify's, anyone's — belongs to the
 * adapter/state-ingestion slice, which will populate this same field from a real record
 * without touching the money path.
 *
 * NOT model-supplied, and structurally cannot be: this type appears only on
 * `AuthoritativeCanonicalisationContext`, whose every field is `KernelComputed`, and
 * `ProposedIntent` has no field that could reach it (`I21`, five wire keys, exactly).
 * ---------------------------------------------------------------------------------
 */
export interface AuthoritativeRetainedFee {
  /** The retained processing fee, as an amount. Not derived here and not derivable here. */
  readonly amount: Money;
  /**
   * The authoritative record this figure was read from.
   *
   * Recorded on the emitted `CostComponent.sourceRef`, so the audit trail names the record
   * rather than a formula — which is the whole point of S1B-C3a.
   */
  readonly sourceRef: string;
  /** `26 §2.1`: "the single ledger currency". Asserted against it by the constructor. */
  readonly currency: string;
}
