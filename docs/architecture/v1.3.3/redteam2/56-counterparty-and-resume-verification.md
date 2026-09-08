# 56 — Counterparty and Resume Verification

**ACOS Operating Spine v1.1. Second red team. Issued 2026-09-03.**
Dedicated verification of R9 and R17-P4: `26 §12` · `26 §7` steps R, R′, S · `26 §11`, `§11.1`, `§11.2` · `26 §2` · `25 §12` · `24 §3` K9 · `33 §3.2`, `§6` · `36 §2` · ADR-002(e) · `35 §4`. Findings registered in `53 §5`.

---

## 1. Verify-mode approvals

### 1.1 The structural choice is right

Three v1.1 decisions survive attack and should be recorded as surviving, because `47 §3` endorsed the shape and this pass attacks the instance:

- **Kernel state rather than workflow suspension.** This removes DBO-03's orphaned-suspension class entirely. A workflow pinned to a version cannot outlive a deploy if there is no workflow. Nothing is lost that the suspension provided: the suspension provided a resume point, and `(approval_id, original_idempotency_key)` provides a better one, because it is durable against the engine as well as against the process.
- **Deny rather than top-up or release-and-retake.** Top-up defeats the ceiling by construction. Release-and-retake loses the slot to a concurrent proposal — the exact race SR5 exists to close. Deny is the only option preserving both, and `26 §12`'s reasoning is correct.
- **Binding to both the proposal hash and `dispatch_payload_hash`.** An approval authorises one constructed effect rather than a class of them. This is strictly stronger than v1.0 and it is what makes CAN-04's missing `constructor_version` a schema gap rather than a design gap.

### 1.2 The lifecycle attacks

| Attack | Outcome | Finding |
|---|---|---|
| Approve twice | Second resume reaches step T, finds the prior effect terminal, returns the prior result | Defeated (F-04) |
| Deny then approve | **Unspecified.** No `Approval` state machine exists in `24 §3` K9; denial released the reservation, so a later approval reaches R′ with nothing to assert | RES-09, RES-01 |
| Approve after expiry | `26 §12`: *"Never auto-approve on timeout. Expiry denies."* Clean | Sound |
| Replay a resume | Two concurrent resumes on one `(approval_id, key)` are prevented only by `I42`'s effect-key uniqueness at step T — **after** R′ and after the state transition | RES-09 |
| Reservation reaped while the approval waits | **Guaranteed for OWNER tier.** `26 §12` gives OWNER approvals no expiry; `24 §3` K5 reaps reservations. R′ covers *insufficient*, not *absent* | **RES-01, BLOCKING** |
| Resource state changes while waiting | Full re-evaluation catches it — `25 §12`'s 09:00/17:00 example is correct and the mechanism does what it claims | Sound |
| Recomputed exposure decreases | R′'s *"still covers"* passes; the surplus stays reserved until settlement. Conservative and correct, at the cost of `I32` headroom | Minor |
| Recomputed exposure increases | Denies — and the obligation is orphaned | RES-05 |
| Constructor version changes | `dispatch_payload_hash` mismatch denies. Every constructor deploy therefore voids the pending queue silently | RES-06 |
| Effect already occurred via the reconciler | Step T returns the prior result; `25 §8.3` refuses resolution if the reservation was released. Coherent | Sound |
| Original idempotency key collides | `H(task_id ‖ action_class ‖ resource_id ‖ semantic_param_digest)` — a collision requires identical semantics, in which case returning the prior result is correct | Sound |

### 1.3 Past the correct denial: what obligation remains?

The brief's instruction is not to stop at *"the system safely denied."*

Constructed: a $30 refund approved at 09:00; a fee-schedule change or partial settlement makes the recomputed exposure $31.50 against a $30.00 held reservation; R′ denies. Then:

1. `25 §12` step 5 preserves the authorisation and idempotency lineage on the denial record. **That is the whole of the specified behaviour.**
2. The customer is still owed a refund, inside the FTC 7-working-day clock.
3. No mechanism creates a new proposal. No typed obligation object exists.
4. `I13` — *"every statutory clock is within SLA, or an escalation exists"* — is the only backstop. It fires at a warning threshold, producing an item unlinked to the denial that caused it, in the queue the owner is already failing to clear.

**A clean bounded next state does not exist** (RES-05). The remediation is one edge on `26 §7`'s DR1 branch: emit `RemedyObligation{case_ref, clock_ref, denied_authorisation_ref, reason}` and auto-enqueue a fresh proposal at the same tier, linked to the original approval so the owner sees one thread.

The same edge serves RES-06's mass denial on constructor deploy, which is the volume case: every pending approval in a touched class denies at once, each inheriting the orphaning.

### 1.4 Reservation lifetime versus approval lifetime

The direct contradiction, stated in three places in the package:

| Source | Statement |
|---|---|
| `26 §12` tier table | OWNER — *"No auto-expiry — it waits."* |
| `26 §12` semantics | *"The exposure reservation is held across the wait and released on denial or expiry."* |
| `24 §3` K5 invariants | *"Reservations expire; a reaper releases them."* |

For the tier whose approvals wait days, the reservation is guaranteed to be reaped first, and R′'s central assertion has no subject. `I32` compounds it: the reaper's alternative is that OWNER reservations are never reaped, in which case they accumulate as the dominant term in the starvation metric and the `I32` override becomes routine — which is LIM-04's laundering path.

**Remediation.** Reservation TTL derives from the approval tier's SLA; OWNER reservations are exempt from reaping and attributed to `I32` so the cost of an unattended approval is visible; R′ gains an explicit `RESERVATION_ABSENT` denial that emits the RemedyObligation of §1.3.

### 1.5 Approval-flood interaction with R2

`26 §12` claims reserve-before-wait bounds the monetary queue *"at roughly 24 items"*. Two arithmetic errors against v1.1's own fixture: `MAL_monetary(month)` is $300, not $600 ($600 is `MAL_total`), and the refund class's binding constraint is `W_MONTH_REFUND`'s **count of 10**, not a monetary quotient. The correct bound is 10 pending refund approvals (LIM-09).

**Can standing exposure starve the approval queue, or vice versa?** Not in the fixture, because advertising and refunds reference disjoint windows. It becomes possible the moment two classes share a window — which LIM-02 must resolve before the question is even well-posed, since a shared window has no ceiling to contend for. The property to preserve when it is resolved: **standing forward exposure and pending-approval reservations must draw on separately declared shares of a window's ceiling**, or a single 30-day advertising authorisation reserves the window and every refund approval denies `WINDOW_EXHAUSTED` while the FTC clock runs.

---

## 2. `counterparty`, `customer_novelty`, P4, P4a, P7

### 2.1 The distinction is the right cut, and it is not complete

`26 §11.1`'s diagnosis is correct and its fix is the right kind of fix. v1.0's P4 read literally forbade refunding a first-time buyer, and *"a symbolic property that means something narrower than it says is not a proof of anything"* is exactly right. Defining `counterparty` as a payee/supplier/settlement destination and `customer_novelty` as a property of the original payer restores the content of EM17: **money returning along the path it arrived on is categorically different from money leaving along a new path.**

Two defects in the completeness of the cut.

**RES-03 — a third direction is missing.** `goodwill.credit.issue` is the fixture's second monetary grant, at $12.50 × 4/month, entering `MAL_monetary`. Value does not leave ACOS; a liability is created. It is not `OUTBOUND_TO_COUNTERPARTY` and not the original payment instrument. **It lands in neither P4 nor P4a.** The same gap covers the gift-card portion of a split-tender refund and any remedy to a third-party beneficiary — a gift recipient is neither the payer nor a registered payee.

Recommended extension:

| Direction | Definition | Governing property |
|---|---|---|
| `NONE` | No value leaves or is committed | Out of scope |
| `INBOUND_ORIGINAL_INSTRUMENT` | Destination is the original instrument of a RECORD-grade transaction | **P4a** — bounds size, never prohibits |
| `OUTBOUND_TO_COUNTERPARTY` | A payee, supplier or settlement destination that is not the original payer | **P4** — NOVEL absolutely forbidden |
| **`INTERNAL_LIABILITY`** (new) | Value becomes a liability of the company; no external destination | Per-action and window caps plus a redemption bound; no novelty test |
| **`OUTBOUND_TO_THIRD_PARTY_BENEFICIARY`** (new) | Destination is neither the payer nor a registered counterparty | **P4 extended** — NOVEL forbidden, conservatively |
| **`OUTBOUND_GOODS_TO_ADDRESS`** (new) | Goods, not money, leave to a destination address | **P4 extended** — see §2.2 |

**RES-07 — P4 covers money and leaves goods outside.** `07 §4.1` names address edit and free reshipment as the two highest-risk support actions *precisely because they move goods without tripping a monetary cap*, and the rewritten P4 now formalises that blind spot: `order.address.edit` moves no money, so it is outside P4 (no payment) and outside P4a (no instrument). Residual controls are real — `IMMUTABLE_AFTER_ORDER`, recipient resolution as at order creation, owner-approved effect, 1/day and 1/month — so the loss is bounded at one item per month. The *property* nevertheless claims to encode EM17 and does not. Generalising `settlement_direction` to `value_direction` with a novelty test on the destination address covers both BEC shapes with one property.

### 2.2 Manufacturing P4a's boundary

The brief asks whether a destination can be made to appear to be the original instrument. Four attempts:

| Attempt | Result |
|---|---|
| Re-tokenised card at the processor | **Defeated on Stripe-family APIs.** The refund destination is derived by the processor from the charge; ACOS cannot supply it. P4a is **structurally** true here, not merely policy-true — a genuine strength |
| Shopify `refundCreate` with a selected gateway or parent transaction | **Succeeds in principle.** The mutation admits transaction parents and gateways, so the destination is selectable in the payload. `26 §8` tests `context.selected_option.instrument == "original"`, but the described enumeration has **no instrument dimension** — it enumerates line items only. The tested field is a constructor assertion, not an enumerated property (RES-10, CAN-07) |
| Wallet redirection | Same shape as the above; adapter-dependent |
| RECORD grade from a compromised adapter | **Partially open.** The transaction from which "original instrument" is resolved is adapter-derived. `I26`'s parser split raises the cost — the adapter must forge a well-formed *vendor response* — and `I27` corroborates only OBSERVATIONS used as policy preconditions, **not the RECORD the canonicaliser reads.** `35 §12.2` labels this contained, not closed, and that label is accurate here |

**Consequence.** P4a's strength varies by adapter and the package states it uniformly. The remediation is the per-adapter enforceability table `29 §3.3` already publishes for credentials, applied to settlement destinations: for each monetary class and each adapter, is the destination processor-derived (structural) or payload-selectable (policy-only)? A policy-only destination on an irrecoverable or high-value class is a non-autonomy candidate.

### 2.3 P7 relocates the risk rather than removing it

P7 forbids `payee.create`, `payee.bank_details.modify` and `payment_method.add` for **every** principal including the owner through the effect path, and `26 §8` directs the owner to create the payment path out of band. Verified: the owner can still do it, so P7 does not break supplier onboarding. And extending the prohibition past `AI_ROLE` is correct — v1.0's P2 left the owner's own effect-path actions unproved, and a confused-deputy path through an owner approval is exactly the escalation `26 §3` rule 4 guards elsewhere.

**The relocation has a cost the package does not account for (RES-08).** `I8` states that no external effect exists in any vendor system that ACOS did not journal, and its violation is *"an incident routed to the security path"* with three interpretations, all incidents. So **the prescribed onboarding workflow generates a security incident every time it is performed correctly** — on the action `26 §8` identifies as one of the places approval is doing real work. And the obvious fix is an exclusion rule, which `24 §3` K5 explicitly refuses for renewals: *"an exclusion rule is a permanent hole in the sweep."*

**Remediation.** Not an exclusion rule — a positive record. `OutOfBandAction{vendor, operation, resource_ref, attested_at, owner_signature}`, written through the owner's own authenticated path, narrow, single-use and expiring, which `I8` matches exactly as `I22` matches renewals. An unmatched vendor mutation remains an incident.

---

## 3. The hand proof in `26 §11.2`

The brief is right that until the symcc gate returns this table is doing security work and must not be read as documentation. Treated accordingly.

### 3.1 It does not cover the catalogue it claims

`26 §11.2` presents itself as a *"hand proof, MVP catalogue (three classes … plus the S3/S4 additions)"*. Enumerating every class carrying authority in v1.1 against the table's rows:

| Class | Authority-bearing in v1.1 | In the table |
|---|---|---|
| `catalog.update` | yes | ✅ |
| `refund.create` | yes, granted in `51 §3.1` | ✅ |
| `email.send` | yes, granted in `51 §3.3` | ✅ |
| `campaign.budget.set` | yes, granted in `51 §3.2` | ✅ |
| `fulfilment.order.create` / `fulfilment.reship` | yes, granted in `51 §3.3` | ✅ |
| `payee.*`, `payment_method.add` | prohibited | ✅ (vacuous + P7) |
| **`goodwill.credit.issue`** | **granted in `51 §3.1`** | ❌ |
| **`order.address.edit`** | **granted in `51 §3.3`** | ❌ |
| `campaign.pause` | required by R2 as `revocation_effect_class` | ❌ |
| `webhook.subscription.assert` / `.delete` | created by R4 | ❌ |
| Reconciler resolution | created by R4 | ❌ |
| `entitlement.issue` / `.revoke` | reclassified IRRECOVERABLE by R17 | ❌ |
| `supplier.relationship.create` | OWNER-tier, `26 §8` | ❌ |

**Two classes the limits fixture actively grants are absent from the only proof that P4 holds**, and one of them has no expressible `settlement_direction` (§2.1). `37 §7` records that the hand proof is a weaker interim substitute for symcc; it is also incomplete over its own catalogue, which is a different and more fixable defect. Registered as **RES-02, BLOCKING**.

### 3.2 Are the reachable novelty values correctly stated?

For the rows present, yes, with one caveat worth recording.

- `campaign.budget.set` — `EXISTING` only, the platform account established at owner-performed onboarding. Correct, and it is the right reason: the counterparty is not selectable, so no policy path admits anything else.
- `fulfilment.*` — `EXISTING` only, with `supplier.relationship.create` at OWNER tier. Correct, and the two-step split (`26 §8`) is what makes it correct: a supplier relationship approved on a plausible story does not carry a payment path with it.
- `refund.create` — *"n/a — destination is the original instrument, resolved by the canonicaliser from the RECORD-grade transaction, never from the intent."* Correct on Stripe-family APIs; adapter-dependent on Shopify (§2.2).

**The caveat.** The table's rightmost column asserts P4 status; it does not assert *how the novelty value is computed*. `26 §11.2`'s closing paragraph makes the right general point — *"a symbolic proof about a request is worth exactly as much as the construction of the request"* — and the construction of `counterparty.novelty` is a constructor behaviour with no test named anywhere. `36 §2`'s canonicaliser construction tests cover exposure per class and per option; they do not name counterparty novelty as a construction test target. **Add it**: for each class, a construction test asserting the computed `counterparty.id` and `novelty` against a hand-authored fixture, including the case where the allowlist is stale.

### 3.3 Is P4 provable at all before symcc returns?

**A complete hand proof is sufficient for a catalogue this size, and this hand proof is not complete.** The argument in `45 §3` — that a three-class catalogue is hand-checkable — is sound, and it justifies the symcc deferral. But the deferral's justification is *the completeness of the substitute*, and the substitute covers eleven of nineteen authority-bearing classes.

Two further limits, both stated correctly by `26 §11` and worth restating because they bound what any proof buys:

1. Symbolic verification proves properties of the policy set **given a request**. `45 §7`'s diagnosis of v1.0 — *"property 3 proved about the wrong object"* — is exactly right, and it means the canonicaliser's correctness is a **premise** of P4 rather than a consequence of it. CAN-01, CAN-02 and CAN-03 are therefore findings against P4's premise, not only against R1.
2. P6's reachability requirement (*"a policy set that denies everything passes the safety properties trivially"*) is the right companion property, and it is not in the hand proof at all. A hand proof over safety properties without a reachability check can certify an outage. For the classes the table covers, reachability is evidenced by `26 §8`'s worked policies; for the eight it omits, nothing evidences either direction.

**Recommendation.** Complete the table over all nineteen classes with four columns — `value_direction`, reachable `counterparty.novelty`, reachable `customer_novelty`, P4/P4a/P7/P6 status — before S1 code, and treat any class whose direction is not expressible as a finding rather than a blank cell. That is a one-page artifact and it is currently the load-bearing security document for the money path.

---

## 4. Answers to the brief's §5.6 questions

| Question | Answer |
|---|---|
| Is **deny** right when recomputed exposure exceeds the held reservation? | **Yes**, and it is the only option preserving both the ceiling and SR5. The defects are that no invariant states it (RES-04) and no bounded next state follows it (RES-05) |
| Does terminating the proposing workflow lose anything? | **No.** It removes DBO-03's orphaned-suspension class and replaces a version-pinned resume point with a durable key. What it exposes is that the reservation's lifetime was never reconciled with the approval's (RES-01) — a defect the suspension design concealed rather than avoided |
| Is the counterparty / `customer_novelty` distinction the right cut, or is there a third category? | **Right cut, and there are three more categories**: internal liability (which the fixture already grants), third-party beneficiary, and goods-to-address. §2.1 gives the extension |
| Is P4 provable before symcc returns? | **Yes for a catalogue this size, and `26 §11.2` does not do it** — eight authority-bearing classes are missing, two of them granted in `51 §3`. And P4's premise is the canonicaliser, so CAN-01 to CAN-03 weaken it independently of the table |
