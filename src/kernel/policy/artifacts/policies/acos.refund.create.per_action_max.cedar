// acos.refund.create.per_action_max
//
// Control artifact, `50 §2` class 2. Signer: Owner, second factor. Halt scope: all effects.
//
// ---------------------------------------------------------------------------------
// WHY THIS IS A `forbid` AND NOT MERELY A CONJUNCT OF THE GRANT
//
// `26 §11`, property P1, verbatim:
//
//   "P1 | No policy path permits `refund.create` whose **`exposure.total_exposure`**
//    exceeds the configured per-action cap. *(v1.2: the operand is `total_exposure`, not
//    the vendor amount -- SR-C1.)*"
//
// "No policy path permits" is a statement about the entire policy set. A `when` clause
// inside one `permit` cannot carry it: a second permit added later, for another role, for
// another resource group, under another grant, would satisfy P1's negation without touching
// this file. In Cedar a `forbid` is the only construct that holds regardless of what permits
// exist, so P1 is expressed as one.
//
// The `<= 25.00` term ALSO appears in `acos.refund.create.grant`, exactly as `26 §8` writes
// it. That duplication is deliberate and is asserted by
// tests/policy/policy-artifacts.test.ts: the two literals must be the same figure, and
// `51 §3.1`'s figure.
//
// ---------------------------------------------------------------------------------
// THE OPERAND, AND THE LIMIT
//
// `51 §3.1`, verbatim:
//
//   "| `refund.create` | **$25.00** | 2 | **10** | `INBOUND_ORIGINAL_INSTRUMENT` |
//    COMPENSABLE | `EXACT` |"
//
//   "`per_action_max.monetary` is compared against **`exposure.total_exposure`**, not
//    `exposure.vendor_amount` (SR-C1, `26 §8`). For a $25.00 line refund carrying a $1.03
//    retained processing fee, `total_exposure = $26.03` and the action **denies**
//    `PER_ACTION`."
//
// `26 §8` fixes the comparison as `<=`, and `26 §11.2` row 3 repeats it as
// "Bounded by `total_exposure <= $25.00`". At the limit is INSIDE the limit.
//
// The figure is a literal HERE, in the owner-signed artifact, and nowhere else in the tree.
// It is not a request field, not a constructor parameter, not an environment variable and
// not a fixture: a caller has no position in which to supply or replace it, and a substituted
// artifact moves the policy-set digest that every decision records (`26 §11`).
//
// ---------------------------------------------------------------------------------
// ATTRIBUTION
//
// Cedar's `diagnostics.reason` names the determining policy. This policy's id is the sole
// member of the PER_ACTION family in `src/kernel/policy/denialCategory.ts`, so a denial in
// which it is determining maps onto `26 §7` step M's terminal `D11 -- DENY: PER_ACTION`,
// deterministically and without inspecting any amount.

forbid(
  principal,
  action == Acos::Action::"refund.create",
  resource
)
unless {
  context.exposure.total_exposure.lessThanOrEqual(decimal("25.00"))
};
