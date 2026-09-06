// acos.refund.create.grant
//
// Control artifact, `50 §2` class 2. Signer: Owner, second factor. Halt scope: all effects.
//
// `26 §8`, "Support may refund an existing order up to $25 for an approved reason",
// transcribed. The architecture's sketch, verbatim:
//
//   permit(principal in Role::"support_reasoner",
//          action == Action::"refund.create",
//          resource is Order)
//   when {
//     resource.exists && resource.grade == "RECORD" &&
//     context.exposure.total_exposure <= 25.00 &&            // v1.2: TOTAL, incl. retained fee
//     context.selected_option.line_refundable_remaining >=
//         context.selected_option.amount &&                  // enumerated from the order at fetch time
//     context.selected_option.instrument == "original" &&    // v1.2: an ENUMERATED dimension
//     context.reason_code in ApprovedReasons &&
//     context.customer_novelty in [NEW, RETURNING] &&        // v1.1: NOT a counterparty test
//     exposure.window("W_DAY_REFUND").count_headroom > 0 &&
//     exposure.window("W_MONTH_REFUND").count_headroom > 0 &&
//     exposure.window("W_DAY_REFUND").monetary_headroom >=
//         context.exposure.total_exposure &&
//     exposure.window("W_MONTH_REFUND").monetary_headroom >=
//         context.exposure.total_exposure
//   };
//
// and the sentence governing every operand, verbatim:
//
//   "v1.1: every operand below is a kernel-computed field. [...] The `context.exposure.*`
//    and `context.selected_option.*` values here are produced by the Effect Canonicaliser
//    (§2.1) from authoritative state, and I21 makes it a type-level property that they
//    cannot come from anywhere else."
//
// ---------------------------------------------------------------------------------
// THE FOUR WINDOW TERMS ARE ABSENT, AND THE ABSENCE IS DECLARED
//
// `26 §7` puts window headroom at STEP R -- "R -- any window lacks headroom -> D13
// DENY: WINDOW_EXHAUSTED" -- and step R is the reservation, which S1D does not implement.
// ADR-005's consequences paragraph, verbatim: "Cedar cannot express everything: numeric
// aggregation over time windows lives in the exposure ledger, not in policy". `36 §4` item
// 2 says the same.
//
// The four terms are therefore NOT silently dropped and NOT faked: `acos.cedarschema`
// declares no window attribute at all, so there is no position in which a fixture-supplied
// headroom could be presented to Cedar as an evaluated operand. The obligation is carried
// openly in docs/implementation/S1D-result.md.
//
// Consequence a reader must hold: a PERMIT from this policy set is a STEP-M permit. It is
// not an `AuthorizationDecision`, and `PolicyPermit` in `decision.ts` says so in its type
// name and its comment.
//
// ---------------------------------------------------------------------------------
// `ApprovedReasons`, AND WHY IT IS A LITERAL SET IN THE SIGNED ARTIFACT
//
// `26 §2.0` types `reason_code` as "from a closed enum" and never enumerates the members;
// S1B declared the closed enum as a fixture under clarification S1B-C6 and recorded it as a
// fixture rather than an architecture claim. `ApprovedReasons` is the APPROVED SUBSET of
// that enum, and it is a grant/policy fact.
//
// It lives here, as a literal, because here is the only place a caller cannot reach: the
// artifact is owner-signed under `50 §2` class 2, its digest is bound into every decision,
// and there is no request field, entity attribute or constructor parameter through which a
// different approved set could be supplied. Putting it in an entity store built at request
// time would have moved it back onto the code path.
//
// The set below is every member of S1B's closed `REASON_CODES` fixture. `26 §8` gives no
// grounds for excluding any of the five, and inventing an exclusion in order to have a
// smaller set would be an invented policy quantity. It is recorded as an S1D fixture
// decision (S1D-C4), not as an architecture claim.
//
// Cedar renders `in` over a value set as `.contains()`; `in` is reserved for entity
// hierarchy. The principal clause below does use entity `in`, exactly as `26 §8` writes it.

permit(
  principal in Acos::Role::"support_reasoner",
  action == Acos::Action::"refund.create",
  resource is Acos::Order
)
when {
  resource.exists &&
  resource.grade == "RECORD" &&
  // SR-C1. TOTAL, including the retained fee. Duplicated by design from
  // acos.refund.create.per_action_max, which carries the same figure as a `forbid` so that
  // P1 holds over the whole policy set and not merely over this permit.
  context.exposure.total_exposure.lessThanOrEqual(decimal("25.00")) &&
  context.selected_option.line_refundable_remaining.greaterThanOrEqual(
    context.selected_option.amount
  ) &&
  context.selected_option.instrument == "original" &&
  ["CUSTOMER_REPORTED_DAMAGE",
   "CUSTOMER_REPORTED_NOT_RECEIVED",
   "ITEM_RETURNED",
   "DUPLICATE_CHARGE",
   "PRICING_ERROR"].contains(context.reason_code) &&
  // `26 §2.1` types this nullable. The `has` guard is what makes an absent novelty fail the
  // grant CLOSED rather than short-circuiting into a Cedar evaluation error.
  context has customer_novelty &&
  ["NEW", "RETURNING"].contains(context.customer_novelty)
};
