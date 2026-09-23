# 53 — Second Red Team Attack Register

**ACOS Operating Spine v1.1. Issued 2026-09-03. Companion to `52-second-redteam-executive-verdict.md`.**

Every attack attempted, including those that failed. Prefixes: `CAN` = R1 Effect Canonicaliser · `STD` = R2 StandingAuthorization · `AUD` = R3 audit ordering and split halt · `LIM` = R8 MAL/MIE/limits · `RES` = R9 + R17-P4 · `F` = attack constructed and defeated · `OOS` = out of scope.

---

## 0. Summary

| Severity | CAN | STD | AUD | LIM | RES | Total |
|---|---|---|---|---|---|---|
| FATAL | 0 | 0 | 0 | 0 | 0 | **0** |
| BLOCKING | 4 | 4 | 6 | 4 | 4 | **22** |
| MATERIAL | 5 | 3 | 3 | 5 | 5 | **21** |
| MINOR | 2 | 1 | 1 | 1 | 1 | **6** |
| WORDING | 1 | 0 | 1 | 1 | 0 | **3** |
| Defeated | — | — | — | — | — | **10** |

`46`'s reconsideration trigger for the ledger's own decision — *"any two classified BLOCKING against the same one of the five items"* — is met for all five items. That is recorded, not editorialised: the trigger exists to force reconsideration of the READY-FOR-SECOND-REDTEAM decision, and the correct reconsideration is the one in `57`.

---

## 1. R1 — Effect Canonicaliser

### CAN-01 — `I18`'s equality is ill-typed and false for every class with a cost component

**BLOCKING** · `26 §2.1`, `26 §2.2` row 12, `24 §3` K4 items 4 and 7, registry `I18`, `51 §5` · **implementation blocking: yes** · in scope

**Claimed invariant.** `I18`: `dispatch_payload.monetary_effect == authorisation.exposure == reservation.amount`.

**What must be true.** `exposure` must be a scalar with the same value as the money field of the vendor request.

**Constructed attack.** A `refund.create` of $25.00 on a Stripe-settled order. Per `24 §3` K4 item 4 the constructor computes exposure *including the retained processing fee* — call it $1.03, unrecoverable on refund under US Stripe terms. Per `26 §2.1` `exposure.cost_components[]` carries it. Now evaluate the equality:

- If `monetary_effect = $26.03`, it is not the dispatched amount. The vendor request carries `amount = $25.00`. `monetary_effect` becomes a second copy of a figure the kernel computed, compared against itself — **vacuous, and vacuous in exactly the way `36 §0` forbids.**
- If `monetary_effect = $25.00`, then `monetary_effect ≠ exposure` and **`I18` is violated by every correctly constructed refund**, every reship, and every COMPENSABLE class carrying a registered compensator cost.

`fulfilment.reship` makes it starker: the vendor request contains no money field at all. `monetary_effect` for a reship is a kernel-computed COGS-plus-freight figure with no counterpart in the payload, so the equality's first term has no referent.

**Result.** The headline invariant of the newest component in the package is unsatisfiable as written. It is cited in the MVP set under property 3 and it is the S1 fixture test. A developer resolving the contradiction by driving `cost_components` to zero **silently restores the v1.0 defect R1 exists to close** — `42 §8.2` row 12, "compensator cost unreserved".

**Remediation.** Split the field. `exposure.vendor_amount` (the money in the dispatched request, possibly null) and `exposure.total_exposure` (vendor amount plus cost components). Restate: `dispatch_payload.monetary_effect == exposure.vendor_amount`, `reservation.amount == exposure.total_exposure`, and `exposure.total_exposure ≥ exposure.vendor_amount` with equality only for zero-cost-component classes. The settlement leg then compares settled cost to `total_exposure`, which is the quantity that represents loss.

---

### CAN-02 — enumerate-then-select does not specify how the model obtains the enumeration

**BLOCKING** · `26 §2.0`, `26 §7` step C′, `23 §5.2`, `24 §3` K4 · **implementation blocking: yes** · in scope

**Claimed property.** *"The kernel enumerates, the model selects, the kernel computes"* (`23 §5.2`).

**What must be true.** The model must be able to see the enumeration before it can index into it.

**Constructed attack.** Trace the model-facing surface. `26 §2.0` gives exactly five fields, of which `selector` is *"an INDEX into a kernel-enumerated option set"*. `24 §3` K4's "What AI may do" is `propose_intent` plus reading the status of effects it proposed. No document specifies a capability that returns the enumeration. Two readings, both defective:

1. **The model never sees it.** Then `selector` is an uninformed integer. For `refund.create` the model cannot identify which line item the customer is complaining about, so the refund engine's classification output cannot be carried into the money path and the class stops doing its job. The `26 §7` sequence would produce economically arbitrary refunds that all pass policy.
2. **An unspecified read exists.** Then the highest-value read surface in the architecture — the one that tells a compromised model exactly what is currently permitted against which resource — has **no `context_spec`, no `max_age`, no journal row, no rate limit, and no entry in any invariant.** `26 §7`'s closing paragraph concedes the point precisely: *"the only probing channel left is the enumeration itself"* — and then bounds it by scoping enumerations to the resource the `context_spec` admits, which is a statement about a mechanism the package does not define.

**Result.** The central mechanism of R1 has an unspecified interface at the trust boundary it exists to create.

**Remediation.** Define `enumerate_effects(action_class, resource_ref) → EnumeratedOptionSet{enumeration_id, options[], computed_at, constructor_version}` as a first-class READ capability: inside the task's `tool_scope`, subject to the task's `context_spec`, journaled with its own row (not as an effect), rate-limited per principal per window, and returning **no field that is not already admitted by the `context_spec`**. Then `selector` references an option id from a named `enumeration_id` (see CAN-03).

---

### CAN-03 — positional selectors permit silent substitution of a different effect

**BLOCKING** · `26 §7` step C′, `26 §2.1` `selected_option`, `24 §3` K4 item 3 · **implementation blocking: yes** · in scope

**Claimed invariant.** `DENY: SELECTOR_INVALID` when *"the selector does not index a live option"* — the design's only stated protection against enumeration drift.

**What must be true.** Index *n* must denote the same effect at selection time and at canonicalisation time.

**Constructed attack.** Order 123 carries refundable lines `[A: $10.00, B: $20.00]`, enumerated in that order.

1. `t0` — the model reads the enumeration, wants line A, submits `selector = 0`.
2. `t0+δ` — a concurrent return workflow, or a partial refund arriving through the vendor by another actor, exhausts line A's refundable remainder. `26 §2.2` row 5 confirms the enumeration reads *remaining refundable per line at fetch time*.
3. `t1` — step C′ re-enumerates under the entity advisory lock. The live option set is now `[B: $20.00]`. **Index 0 is valid.** It denotes B.
4. The kernel computes exposure $20.00, ≤ the $25.00 per-action cap. `26 §8`'s refund policy passes: order exists at RECORD grade, `line_refundable_remaining ≥ amount`, instrument is original, reason code is in the enum, both refund windows have count headroom.
5. PERMIT. Reserve $20.00. Dispatch a refund of line B.

**Result.** The canonicaliser executes an economically different effect than the one selected, and **not one invariant fires.** `I18` holds — all three internal figures agree on $20.00. `I21` holds — no request field came from the intent beyond the four. `I2`, `I3`, `I29`, `I31` hold. The `SELECTOR_INVALID` guard fires only when the option set *shrinks past* the index, which is the benign case; the dangerous case is reordering, and reordering is undetectable by an ordinal.

The general form: any option set whose membership can change between read and canonicalisation admits substitution under a positional selector, and the design explicitly requires membership to be computed at fetch time.

**Remediation.** Content-address the options. `option_id = H(action_class ‖ resource_id ‖ semantic_option_digest)`. `selector` carries `(enumeration_id, option_id)`. C′ recomputes the enumeration and denies `SELECTOR_STALE` if `option_id` is absent, and `SELECTOR_ENUMERATION_STALE` if `enumeration_id`'s `computed_at` is older than the class's `max_age`. This also closes the `t0`-outside-the-lock hole in CAN-10.

---

### CAN-04 — `constructor_version` is not a recorded field anywhere

**BLOCKING** · `26 §2.1`, `26 §11` opening claim, `26 §12` approval binding, `24 §3` K4 outputs · **implementation blocking: yes** · in scope

**Claimed property.** `26 §11`: *"Every `AuthorizationDecision` records `policy_version`. A decision is reproducible: same inputs, same version, same verdict, forever."*

**What must be true.** The *inputs* must be reproducible. In v1.1 the inputs are constructed by a versioned constructor.

**Constructed attack.** `26 §2.1`'s `AuthorizationRequest` has sixteen named fields and none is `constructor_version`. `AuthorizationDecision` (`24 §3` K3) records `verdict, policy_version, evaluated_facts, matched_rules, reservation_id`. The approval binding (`26 §12`) is `proposal_hash` plus `dispatch_payload_hash`. So after any constructor deploy:

- A decision cannot be replayed, because the function that produced its operands is not identified. `35`'s walkthroughs are auditable after the fact only for the policy half.
- `I18`'s settlement-side investigation — *"divergence is a critical incident"* — cannot determine which constructor computed the exposure it is disputing.
- The `26 §11` reproducibility sentence is false as written for every decision on either side of a constructor change, which is the same class of over-strong claim `47` catalogued.

**Result.** A missing schema field on the S1 journal, in the one place `47 §1` said every monetary control now sits.

**Remediation.** `constructor_version` on `AuthorizationRequest`, on the `AuthorizationDecision`, on the journal row, and in the approval binding. `50-control-artifact-manifest.md` gains constructors as a seventeenth control-artifact class under B9 — they compute money and are currently not owner-signed.

---

### CAN-05 — enumeration cardinality is a probing oracle

**MATERIAL** · `26 §7` closing paragraph, `26 §2.0` · **implementation blocking: no** · in scope

**Attack.** `26 §7` states denial detail is coarse and identifies the enumeration as the remaining probing channel. Constructing the probe: for a resource in scope, submit `propose_intent` with `selector = 2^k` and binary-search on `DENY: SELECTOR_INVALID` versus any downstream denial. `O(log n)` proposals recover `|options|` exactly. For `refund.create` that is the count of still-refundable lines — i.e. prior refund history on an order the task may only hold status for. For `campaign.budget.set` it is the shape of the permitted-value set, from which the current budget and the increase rule are recoverable.

**Result.** Real, cheap, and noisy: every probe writes a denial audit row, and `29 §9` treats denial spikes as a compromise signal. Detection exists; a bound does not, and at MVP the attention budget that would bound it is deferred (R16). Classified MATERIAL because the leaked state is within one order of magnitude of what the `context_spec` already admits in the MVP catalogue, and the mitigation is cheap.

**Remediation.** Fixed-width padded enumerations per class, or a single `DENY: SELECTOR` category that does not distinguish out-of-range from downstream denial, plus a per-principal per-window enumeration/proposal quota.

---

### CAN-06 — thirteenth semantic error: FX spread at settlement

**MATERIAL** · `26 §2.2` row 3, `26 §2.1` `fx_rate_ref`, registry `I18` · **implementation blocking: no (T3 gate)** · in scope

**Attack.** The catalogue closes *wrong currency* with a RECORD-grade FX **rate** and `staleness_policy=BLOCK`. The settled figure is not determined by a rate; it is determined by the processor's conversion at settlement, which applies a spread (commonly 1–2%) and may use a different value date. Construct: a €23 line refund on a USD ledger. Pre-dispatch, `monetary_effect == exposure == reservation` at the RECORD mid rate. At settlement the processor's conversion is 1.5% worse. `reserved < settled loss`, systematically, in the loss direction, on every FX-bearing effect.

**Result.** Not preventable pre-dispatch — the spread is not knowable. Detectable only at settlement, where `I18` declares divergence a *critical incident*, so a structural commercial fact is routed to the security path. Two acceptable answers: gross up the reservation by a per-corridor maximum spread, or declare the class non-autonomous for cross-currency effects. The package does neither.

**Remediation.** Add `fx_spread_allowance` as a computed cost component per corridor, sourced from the processor's published maximum, and state that a class whose corridor has no published maximum is not autonomy-eligible.

---

### CAN-07 — fourteenth semantic error: split-tender refunds have no dimension in the enumeration

**MATERIAL** · `26 §2.2` row 4, `26 §8` refund policy, `24 §3` K4 item 2 · **implementation blocking: no** · in scope (interacts with RES-10)

**Attack.** The enumeration for `refund.create` is *"the refundable line items and the remaining maximum per item"* — a one-dimensional set over lines. An order paid by gift card plus card (ordinary on Shopify) has two parent transactions, and the refund must be **apportioned across them**. Nothing in the enumeration expresses which parent transaction receives which portion, and `26 §8` then reads `context.selected_option.instrument == "original"` — a field the described enumeration does not produce.

**Result.** Either the class denies `NOT_CANONICALISABLE` for split-tender orders (an operational gap on an ordinary payment shape), or the apportionment rule lives implicitly in the constructor, which is exactly the unexamined request-construction logic R1 exists to eliminate. The gift-card portion is also a settlement direction the P4/P4a cut does not contain (RES-03).

**Remediation.** Make the enumeration two-dimensional — `(line, parent_transaction)` — with apportionment as an enumerated option rather than a computed default, and declare the class non-autonomous where an order's tender structure has more than one non-original instrument.

---

### CAN-08 — `I18`'s settlement tolerance is undeclared, and one side of it is an ESTIMATE

**MATERIAL** · registry `I18` and rule 5, `51 §5`, `26 §5`, `26 §10.1` · **implementation blocking: no (T3)** · in scope

**Attack.** `I18` requires `settled_amount` *"within the named tolerance for the class"*. No document names one. The registry's own rule 5 states that an invariant with an unstated threshold is not an invariant. Worse, for every `MIE_discretionary` class the reserved figure is `unit_cost_estimate(c)`, explicitly `[ESTIMATE]`-graded (`26 §10.1`). A critical-incident equality with an estimate on one side produces a critical incident whenever an international reship costs more than $35 — which is the ordinary case, not the exceptional one.

**Result.** `I18`'s settlement leg will either be tuned wide enough to admit estimate error (at which point it no longer detects constructor omission, its stated purpose in `51 §5`) or it fires continuously. And `I12` forbids creating or widening a tolerance rule within 30 days of a discrepancy it would resolve, so the tolerance must be set **before** any settlement data exists.

**Remediation.** Declare per-class tolerance in the action catalogue as a control artifact under B9, with two separate thresholds: an exact-zero tolerance for classes whose exposure is fully determined pre-dispatch, and a named band for `[ESTIMATE]`-graded classes with the band's basis recorded. State that a band is set at catalogue authoring time and that `I12` applies to widening it.

---

### CAN-09 — C′ makes every monetary class dependent on the availability of every state source its constructor reads

**MATERIAL** · `23 §5.2` availability claim, `26 §7` step C′, `24 §3` K4 failure behaviour · **implementation blocking: no** · in scope

**Attack.** `23 §5.2` argues gateway availability is bought by being *"dependent only on Postgres"*. C′ now requires a RECORD-grade FX rate with `staleness_policy=BLOCK` and, for `supplier.order.place`, quantity-dependent supplier pricing that is not in ACOS state. Fail-closed on canonicaliser-state unavailability is correct and it means a stale FX feed denies **every monetary class**, and supplier API unavailability denies **order-driven fulfilment** — which `I30` says must never be blocked by a limit, and which is here blocked by an availability dependency instead.

**Result.** R1 introduced external availability dependencies into the chokepoint whose availability argument predates them. `23 §5.2`'s sentence is now false.

**Remediation.** Enumerate C′'s per-class state sources in `48-external-write-perimeter.md`'s style — one row per class, one column per source, with the denial consequence — and restate `23 §5.2`. For single-currency operation, record that the FX dependency is inert and becomes live at the first non-ledger currency.

---

### CAN-10 — "under the entity advisory lock" overstates what the lock reaches

**WORDING** (with a MATERIAL residual) · `24 §3` K4 item 1, `25 §14` · in scope

**Attack.** Advisory locks on `(company_id, entity_type, entity_id)` serialise ACOS processes. They do not bind the vendor, the customer editing their own address in the storefront, or a second refund issued in the Shopify admin. The canonicaliser enumerates from a **projection**, so "authoritative state under the lock" means "our projection, under our lock". Two entities also appear in single-entity locks: `order.address.edit` enumerates address sources from the *customer* record while locking the *order*; `refund.create` computes the retained fee from the *payment* record while locking the order.

**Residual.** The only real defence against vendor-side concurrency is an optimistic-concurrency token in the dispatched request, and `DispatchPayload` has no field for one. For refunds the vendor's own refundable-amount check substitutes; for `campaign.budget.set` and `order.address.edit` no such check exists.

**Remediation.** Reword to *"under the entity advisory lock and against the projection's declared `max_age`"*. Add `precondition_token` to `DispatchPayload` and populate it where the vendor supports conditional writes; record per class where it does not.

---

### CAN-11 — retained sales tax on a refund crossing a filing period

**MINOR** · `26 §2.2` row 8, `26 §6` `tax.filing.*` prohibition · in scope

**Attack.** Row 8 closes gross-versus-net by *"per-class cost model adds retained fees and tax treatment"* — a placeholder, not a rule. A $25 line refund in a destination-sourced jurisdiction returns ~$2 of collected tax to the customer. If the period's return is already filed and `tax.filing.*` is categorically prohibited, ACOS cannot reclaim it. The $2 is unrecoverable and unmodelled.

**Remediation.** Name the rule: tax is a cost component when the order's tax period is closed, and zero when it is open. State which system of record supplies period status.

---

### CAN-12 — an action class that resists canonicalisation and is operationally necessary

**MINOR** (finding is about automatability, per the brief's §1.4.6) · `26 §5`, `33 §9` · in scope

Three candidates in the MVP-adjacent catalogue:

| Class | Why canonicalisation is hard | Consequence |
|---|---|---|
| `supplier.order.place` | Quantity-dependent pricing quoted at order time; exposure is not a function of ACOS state | C′ must fetch from the supplier, so exposure integrity depends on an untrusted counterparty's quote, graded through a parser |
| `refund.create` on split tender | No apportionment dimension (CAN-07) | Non-autonomous for an ordinary payment shape |
| `entitlement.issue` (discretionary) | Exposure of disclosing a fenced asset is not a monetary quantity at all | Count-gating is the only available control, which `26 §5` already accepts |

**Result.** One, not several. The finding is therefore about the architecture rather than about the business model: the disqualifier logic works, and it disqualifies less than feared.

---

## 2. R2 — `StandingAuthorization`

### STD-01 — forward exposure and boundary re-reservation are undefined for rolling windows

**BLOCKING** · `51 §2`, `24 §3` K5, `26 §7` step R, `26 §10.1` · **implementation blocking: yes** · in scope

**Claimed mechanism.** *"Forward exposure to each referenced window's end is reserved at authorisation and re-reserved at every window boundary."*

**What must be true.** The window must have an end and a boundary.

**Constructed attack.** `51 §2` declares `W_DAY_ADSPEND` as **rolling 24h**, along with `W_DAY_REFUND`, `W_DAY_CREDIT` and `W_DAY_MIE`. A rolling window has no boundary and its "end" is `now`. Evaluate `s.forward_exposure_to_window_end(W_DAY_ADSPEND)`:

- Reading the window as `[now−24h, now]`: forward exposure to its end is **$0.00**, not the $6.00 printed in `51 §3.2`.
- Reading it as `[now, now+24h]`: forward exposure is $6.00, but there is never a boundary at which to re-reserve, so the re-reservation job has no schedule, and `I23`'s test — *"window-boundary test with expiry inside the window"* — has no boundary to test at.
- Either reading requires open reservations against a rolling window to **age out continuously**, which interacts with reservation reaping and with `I3`'s `Σ open reservations` term in a way no document specifies.

**Result.** `Standing(day) = $6.00` is not derivable from the declared semantics of the window it is computed against, and R2's containment mechanism — pause on failed boundary re-reservation — is unimplementable against four of the fixture's nine windows.

**Remediation.** Standing authorisations may reference **discrete** windows only. Either redeclare `W_DAY_*` as calendar days on the company timezone with the database clock, or forbid `standing.required` grants from referencing rolling windows and state that a rate class must carry at least one discrete window per period it spans. `51 §2` needs a `boundary_kind` column.

---

### STD-02 — the release condition for standing forward exposure is unspecified

**BLOCKING** · `24 §3` K5 failure behaviour and the concern table, `30 §5.1`, `35 §7` layer 4, registry `I3`, `I22`, `I23` · **implementation blocking: yes** · in scope

**Claimed invariant.** `I3` extended: open reservations **plus standing forward exposure** never exceed a window ceiling. `I23`: nothing live past `expires_at`; *"a paused standing authorisation that continues to accrue charges is an incident under I22."*

**What must be true.** Forward exposure must remain reserved until external spend has verifiably stopped.

**Constructed attack.** Follow every state through a failed pause.

1. Day-boundary re-reservation fails. K5 pauses the authorisation *"via `revocation_effect_class`"* — `campaign.pause`, itself a governed effect.
2. `campaign.pause` is dispatched. The adapter times out. Per `25 §10` the class is REVERSIBLE, so the unknown-outcome policy is *hold and resolve* — the reconciler queries later.
3. **Now: what is the `StandingAuthorization.status`?** `24 §3` K5 declares `LIVE | PAUSED | EXPIRED | REVOKED` and states no transition rule keyed to pause verification. If it moves to `PAUSED` on dispatch, its forward exposure leaves `I3`'s second term.
4. Google continues serving the campaign. Platform spend reporting lags by hours, so `realised spend` does not yet reflect it either.
5. `I3`'s sum has dropped by the released forward exposure while external spend continues. **Headroom is available for a new `campaign.budget.set`, which creates a second standing authorisation against the same window.**
6. `I22` eventually fires on the next recurring charge that matches no live authorisation — but the charge *does* match the second, live authorisation's `reconciler_match_rule` (same class, same resource, similar amount), so it does not fire at all.

**Result.** This is precisely the v1.0 defect R2 was created to close — *"headroom was returned while spend continued"* — reproduced through the pause path rather than through reservation expiry. The brief asks when headroom is allowed to return; the documents do not say, and every safe answer has a commercial cost:

- Release on **verified external cessation** requires reading platform spend over a lag window (hours), during which the headroom is unavailable — so pause-and-reauthorise within the same day window becomes impossible.
- Release on **pause dispatch** is unsound, as constructed above.
- Release on **`expires_at`** holds the exposure for the full window regardless, which is sound and makes mandatory expiry expensive.

**Remediation.** Add `PAUSE_PENDING` to the status enum. Forward exposure is released **only** on transition to `REVOKED`, and `REVOKED` requires a verification read showing zero incremental platform spend across a per-platform `cessation_lag` interval, declared per adapter. `I3` gains a fourth term: `Σ forward exposure of PAUSE_PENDING authorisations`. `I22`'s match rule must be scoped to a single `standing_authorization_id`, not to a class, so a second authorisation cannot absorb the first's charges.

---

### STD-03 — expiry triggers a revocation that expiry forbids

**BLOCKING** · `51 §3.2` (`expires_at` *"mirrors grant expiry"*), `26 §4` mandatory grant expiry, `26 §7` step I, `24 §3` K4 inputs · **implementation blocking: yes** · in scope

**Constructed attack.**

1. One grant covers `campaign.budget.set` and `campaign.pause` (the natural configuration — the fixture declares one advertising grant).
2. `expires_at` on the `StandingAuthorization` mirrors that grant's expiry, so both lapse at `T`.
3. At `T`, `I23` requires the authorisation to pause *"via its `revocation_effect_class"*.
4. `campaign.pause` enters the gateway. Step I: *"Matching grant exists after subset intersection?"* The grant expired at `T`. **`DENY: NO_GRANT`.**
5. The authorisation cannot pause. External spend continues. `I23` is violated by the mechanism that enforces it.

`24 §3` K4 accepts *"a fully specified action request from a kernel state machine"* as an input, which suggests a kernel-originated path — but `26 §7`'s sequence has **no branch for kernel-originated requests**, so either they traverse step I and deny, or they skip policy entirely, which is an undocumented authority bypass in the money path.

**Result.** A deterministic deadlock at every grant expiry with a live standing authorisation, and the only escape route in the documents is an unspecified policy bypass.

**Remediation.** Two changes. (a) `revocation_effect_class` executes under a **standing revocation authority** created at authorisation time and scoped to exactly that one class, that one resource and that one `standing_authorization_id`, with `expires_at = grant.expires_at + cessation_grace`. (b) `26 §7` gains an explicit KERNEL_SERVICE branch that names which steps a kernel-originated request skips (grants, evidence, autonomy) and which it must not (prohibitions, canonicalisation, reservation, journaling) — because that branch is load-bearing and currently implicit.

---

### STD-04 — forward exposure has no overdelivery allowance, so normal platform behaviour pauses healthy campaigns

**BLOCKING** · `51 §3.2`, `24 §3` K5, `26 §2.6` question 3 · **implementation blocking: yes** · in scope

**Constructed attack.** The fixture grants `$6.00/day` over 30 days and reserves `Standing(month) = $180.00`. Google's documented budget semantics deliver up to twice the average daily budget on an individual day and cap monthly delivery at `30.4 ×` the daily budget. So:

1. Month start: reserve `30 × $6 = $180` forward against `W_MONTH_ADSPEND`.
2. Day 1: the platform delivers $12.00 — within its own contract, outside ACOS's model.
3. Day-2 boundary re-reservation: `realised $12.00 + forward (29 × $6 = $174) = $186 > $180`.
4. **No headroom. The authorisation pauses on day 2 of a 30-day consent**, via a mechanism (STD-02, STD-03) that may not stop spend and may not be authorisable.

The month ceiling is also structurally below the platform's own monthly cap: `30.4 × $6 = $182.40 > $180.00`, so even with perfectly even delivery the last day of a 31-day month has no headroom (see LIM/MP-04).

**Result.** The layer `35 §7` calls *"the layer that actually bounds this scenario"* fails closed against documented vendor behaviour in the first week of ordinary operation. The failure direction is a commercially damaging pause, which is `26 §2.6`'s own question answered in the worst way, and the mechanism has **no slack parameter at all**.

**Remediation.** Forward exposure becomes `rate × remaining_periods × (1 + overdelivery_allowance)` with the allowance declared per platform from vendor documentation, and the month basis becomes `30.4` or the actual day count of the calendar window, whichever the platform uses. Boundary re-reservation failure raises `STANDING_HEADROOM_SHORT` at the *first* projected shortfall, not at the boundary, so the owner sees it before the pause.

---

### STD-05 — `reconciler_match_rule` carries all of `I22` and is unspecified, and its oracle is not independent

**MATERIAL** · `24 §3` K5, registry `I22`, `51 §5` · **implementation blocking: no** · in scope

**Attack.** `I22` — every recurring external charge matches a live `StandingAuthorization` or raises an incident — is the only detector for provider-initiated charges. Its entire discriminating power is `reconciler_match_rule`, whose form is unspecified. Construct the converse the brief asks for: a charge crafted to match. If the rule keys on merchant descriptor and class, then any charge from that platform matches, including one produced by a compromised ad adapter raising the **account** budget under the same `adwords` scope (`29 §3.3` establishes ACOS cannot be made incapable of this). `I22` stays silent on a $500 charge against a $6/day authorisation.

The oracle compounds it. `51 §5`'s I22 fixture is *"three legitimate renewals and one unauthorised charge"* — written by the same author as the match rule, which is the circularity `26 §9.5` corrected for escalation detectors and did not correct here.

**Remediation.** Specify the rule as a bounded predicate: `(payment_instrument, merchant_identifier, amount ≤ rate × period × (1 + overdelivery_allowance), window_contains(charge_date), standing_authorization_id)`. Any charge matching the descriptor but exceeding the amount bound is an incident, not a renewal. Add an **independently authored** crafted-charge case to the fixture, and record that the author differs.

---

### STD-06 — `Standing(month)` uses a 30-day basis against a calendar-month window

**MATERIAL** · `51 §3.2`, `51 §4.1`, `26 §10.1` · **implementation blocking: no** · in scope

**Attack.** `51 §2` declares `W_MONTH_ADSPEND` as a **calendar month**. `26 §10.1` defines `Standing(w) = Σ s.forward_exposure_to_window_end(w)`. In January, the forward exposure to the window's end at month start is `31 × $6.00 = $186.00`. `51 §4.1` prints `$180.00`, which is the **rate period** (30 days), not the window. My independent recomputation returns $168/$174/$180/$186 for 28/29/30/31-day months.

**Result.** `MAL_total(month)` is understated by up to $6.00 (1%) in seven months of twelve, and `I7` — which recomputes from this fixture — will either **fail in CI in January** or pass by reproducing the fixture's basis error. That is the shared-misconception failure the brief names, in the term R2 added.

**Remediation.** Compute forward exposure from the window's own boundary arithmetic on the database clock, never from the rate period. Add a `MAL_total(month)` recomputation for a 31-day month to the I7 fixture set.

---

### STD-07 — two rate grants on one window multiply `Standing(w)` with no precedence rule

**MATERIAL** · `26 §4` (named windows), `26 §10.1`, `51 §3.2` · **implementation blocking: no** · in scope

**Attack.** `26 §4` states the v1.0 defect being fixed: *"two grants permitting the same action class either doubled the headroom or conflicted with no precedence rule."* The fix is that grants *reference* windows. But `Standing(w)` sums over **authorisations**, and nothing caps the number of `StandingAuthorization` records against one window. Two `campaign.budget.set` grants at `$6.00/day` — one per campaign, the ordinary configuration once there is more than one campaign — produce `Standing(month) = $360.00` while `51` displays `$180.00`. Whether that is permitted depends entirely on the window ceiling, which does not exist (LIM-02).

**Result.** The composition defect is relocated rather than closed, and the single-grant fixture cannot exercise it.

**Remediation.** Resolve LIM-02 first; then `I3`'s standing term is bounded by the window ceiling and this becomes an arithmetic consequence rather than an ambiguity. Add a two-rate-grant case to the I7 fixture.

---

### STD-08 — mandatory expiry as a denial-of-service (attack partially defeated)

**MINOR** · `26 §2.6` question 3, `51 §3.2` · in scope

**Attack attempted.** Time an approval flood or an availability outage so that a healthy campaign's re-consent falls due at a commercially critical moment (a promotion, a seasonal peak).

**Result.** Partially defeated and partially subsumed. Re-consent is an OWNER-tier approval with no auto-expiry, so an unavailable owner pauses advertising at 30-day intervals — a real operational cost, but it is a bounded and *visible* one, and `26 §2.6`'s answer (expiry removes more risk than it creates) survives on the evidence. The genuinely damaging version of this attack is STD-04, which pauses campaigns without anyone timing anything.

---

## 3. R3 — Journal ordering and the split halt

### AUD-01 — `I17` is not evaluable by its declared owner

**BLOCKING** · registry `I17` (owner: **Audit**), `24 §3` K11 inputs, `30 §5` "Independent inputs" row, `46 R10` · **implementation blocking: yes** · in scope

**Claimed invariant.** `I17`: *"For every `journal_seq` in the control journal there exists exactly one audit row with a matching `row_hash`, and the audit store's `journal_seq` set is gap-free per company. Continuous and two-sided."* Owner: Audit. Test: kill at each ordering boundary and assert any divergence presents as a detectable sequence gap.

**What must be true.** The audit plane must be able to enumerate the control journal.

**Constructed attack.** `24 §3` K11 declares this plane's inputs exhaustively: *"The control plane's primary journal rows, pushed asynchronously and verified for gap-freedom; its own read-only vendor credentials; independently computed metrics."* R10 **deliberately removed** the control-database replica, and `30 §5` states why: reading a replica of the audited database is arithmetic independence, not evidential independence. So:

- The audit plane can check gap-freedom **of what it received**. That detects an omission in the middle of a pushed range.
- It cannot detect a **truncated tail**. If the control plane's journal reaches seq 1,000 and it pushes 1–900, the audit side is gap-free, every `row_hash` matches, and `I17b`'s `row_count` anchor reports 900 — consistent with itself. `I17b` bounds retroactive rewriting of rows the audit plane holds; it says nothing about rows it never received.
- If the audit plane *does* read the control journal to close this, R10's core decision is partly reversed and a compromised control plane can serve a filtered enumeration — which is the AUDA-10 failure R10 existed to fix.

**Result.** `I17` is specified as two-sided and is one-sided in construction. The registry's §3 item 1 concedes that under control-plane compromise `I17` *"detects divergence and cannot attribute it"*; it does not concede that in the tail-truncation case there is no divergence to detect. This is the single most important R3 finding because `I17` is what `30 §5.2` says *"makes the chain meaningful"*.

**Remediation.** The control plane pushes a periodic signed **attestation as a journal row** — `{company_id, max_journal_seq, row_count, head_hash, attested_at}` — occupying its own sequence value. Then: an absent attestation is a sequence gap; a truncated tail contradicts the last attestation the audit plane holds; and the audit plane needs no read of the control database. Cadence must be shorter than the anchor interval. Add `I17e` for attestation continuity, and restate `I17` as *"gap-free and consistent with the latest received attestation"*, which is a property the owner can actually evaluate.

---

### AUD-02 — degraded mode is self-declared by the audited party

**BLOCKING** · `30 §5.1` items 4–5, `25 §13` (lag check as a control-plane schedule), `24 §3` K11 failure behaviour · **implementation blocking: yes** · in scope

**Claimed property.** Halt by recoverability class *"while the mirror is unreachable"*, with lag past threshold raising `AUDIT_MIRROR_DEGRADED`.

**What must be true.** "Unreachable" must be an observation some party other than the audited one can make.

**Constructed attack.** `25 §13` lists *"audit-mirror lag check"* among **control-plane scheduled triggers**. The push is control-plane code. The `mirrored_at` column is a control-plane column. Therefore:

1. A compromised control plane stops pushing and sets its own degraded-mode flag.
2. From the audit side, this is indistinguishable from a provider outage. Its chain head stops advancing; its hourly anchor of `{head_hash, chain_seq, row_count}` continues to publish the *same, internally consistent* tuple. Nothing in `I17b` distinguishes "no new rows because nothing happened" from "no new rows because the writer stopped".
3. Degraded mode now permits dispatch of REVERSIBLE and of COMPENSABLE-inside-a-live-clock effects with only a local chain — the case `22 §3.1` names as unauditable under control-plane compromise.
4. The control plane also decides which class each effect is in, and the clock-bearing signal is reachable from model output (AUD-06).

**Result.** The mode that relaxes the audit guarantee is entered on the word of the component the guarantee is protecting against. `README` concedes the audit plane's silence is indistinguishable from correctness; this finding is that the architecture **makes silence profitable**.

**Remediation.** AUD-01's attestation closes this too, because an attestation gap is positive evidence of a stopped writer rather than an absence. Additionally: degraded mode must be entered only when the *audit plane* also publishes a `MIRROR_INPUT_STALL` finding through its own read endpoint, and the owner client's client-side diff (`30 §3` V7) must show the two declarations side by side. Any effect dispatched under degraded mode must be tagged `DISPATCHED_UNMIRRORED` in the journal so that `I8`'s later vendor read has a specific set to reconcile.

---

### AUD-03 — journal row canonicalisation is unspecified, and Postgres `jsonb` does not preserve key order

**BLOCKING** · `30 §5` "Hash and sequence writer" row, `30 §5.1` items 1–2, registry `I17d`, `I41` · **implementation blocking: yes** · in scope

**Claimed invariant.** `I41`: the local chain and the audit store's **independently recomputed** chain both verify, continuously. `I17d`: hashes computed by database functions inside **each** instance.

**What must be true.** Two independent triggers over the same logical row must produce the same bytes.

**Constructed attack.** The chain is *"a local hash chain over canonicalised rows"* and the canonicalisation is nowhere defined. Journal rows carry structured payloads (request hashes, exposure components, `evaluated_facts`, `matched_rules`), which in Postgres will be `jsonb`. **`jsonb` does not preserve key order and normalises duplicate keys and numeric representation.** So a row serialised from `jsonb` on the control instance and re-serialised from `jsonb` on the audit instance can differ in bytes while being logically identical — and can also *coincide* in bytes while differing logically (`25.0` versus `25.00` in a numeric field; `null` versus absent; timestamp precision truncation across instances with different `DateStyle`).

**Result.** Two failure directions, both bad. Benign divergence produces continuous `I41` critical incidents on ordinary traffic, and the operational response to a continuously-firing critical is to widen it. Coincident hashing means two different rows chain identically, which is the collision the brief's §3.4.6 asks for.

**Remediation.** Define the canonical form explicitly: a byte string with fixed field order, RFC 8785-style JSON canonicalisation for structured fields, fixed numeric scale per column, UTC timestamps at fixed precision. **Transmit the canonical byte string to the audit plane and hash that** — do not re-serialise from `jsonb` on the audit side. `50-control-artifact-manifest.md` gains the canonicalisation specification as a control-artifact class, because a change to it silently reinterprets every historical hash.

---

### AUD-04 — gap-free per-company sequencing implies an unstated serialisation point on the effect path

**BLOCKING** · `30 §5.1` items 1 and 3, `37 §3` (`effect_path` role across five schemas), registry `I17` · **implementation blocking: yes** · in scope

**Claimed property.** A *"company-scoped gap-free monotonic `journal_seq`"*, such that *"a missing `journal_seq` has exactly one interpretation."*

**What must be true.** No sequence value is ever allocated and abandoned.

**Constructed attack.** Postgres sequences are explicitly non-transactional and leave gaps on rollback — they cannot implement this. The available implementations are (a) a per-company counter row updated inside the authorising transaction, or (b) `SELECT max(journal_seq)+1 ... FOR UPDATE`. Both take a **company-scoped row lock held for the remainder of the transaction**, and the transaction is `30 §5.1`'s five-statement commit. Consequences the design does not state:

- Every authorising transaction for a company serialises on one row. At MVP volume this is free; it is nevertheless the mechanism, and `33`'s scale envelope was written without it.
- It is a denial-of-service surface on the effect path: any long-running transaction that touches the counter blocks all authorisations for that company, including refunds inside statutory clocks.
- Lock-ordering matters. The window balance row (LIM-05) and the journal counter are both hot rows in the same transaction; opposite acquisition orders across two code paths deadlock.
- A retry after a serialisation failure must re-read the counter, so the deterministic idempotency key must be stable across the retry — which `25 §7` provides, but only if `journal_seq` is not an input to it. It is not, and that should be stated.

**Result.** `I17`'s "exactly one interpretation" rests on a property whose only correct implementations impose a company-wide serialisation point that no document mentions.

**Remediation.** Specify the mechanism in `30 §5.1`: a `journal_counter(company_id, next_seq)` row, incremented inside the authorising transaction, acquired **after** the window balance row, with the lock order declared. State the throughput consequence in `33`'s scale envelope, and add a test that a rolled-back authorising transaction leaves no gap.

---

### AUD-05 — the ordinary crash-retry poisons the audit chain and the anchor

**BLOCKING** · `30 §5.1` items 1–3, registry `I17`, `I17b`, `I41` · **implementation blocking: yes** · in scope

**Constructed attack.** The fourth of the five ordering boundaries: the audit store commits the pushed row and acknowledges; the control plane dies before writing `mirrored_at`.

1. On recovery the pusher sees `mirrored_at IS NULL` for seq *N* and re-pushes.
2. The audit table's uniqueness on `(company_id, journal_seq)` is **not specified anywhere**. Absent it, seq *N* is inserted twice.
3. The audit-side trigger re-chains, so the audit chain now contains two rows for one sequence value with different `chain_seq`.
4. `I17` requires *"exactly one audit row"* per control `journal_seq`. It fails. `AUDIT_COMPLETENESS_GAP` at CRITICAL → dispatch halts by recoverability class → IRRECOVERABLE halts, order fulfilment stops.
5. `I17b`'s `row_count` no longer equals the distinct sequence count, so the hourly anchor publishes a tuple that will not reconcile with the control side.

**Result.** A single ordinary crash at one of the five boundaries the design names produces a **critical audit incident indistinguishable from tampering**, plus a poisoned anchor, plus a halt. The design specifies retry (*"push to audit store (async, retried, quota-bounded)"*) and does not specify what makes retry safe.

**Remediation.** `UNIQUE (company_id, journal_seq)` on the audit table with `INSERT ... ON CONFLICT DO NOTHING`, and the conflict path must verify the stored `row_hash` matches the re-pushed one — a mismatch on the same sequence value **is** tampering and must be distinguished from a duplicate. `row_count` becomes `count(DISTINCT journal_seq)`. `mirrored_at` becomes advisory, never a correctness input.

---

### AUD-10 — two rows of the split-halt table match one effect with opposite behaviour

**BLOCKING** · `30 §5.1` item 4, `22 §3.1`, `24 §3` K11, `35 §12.1`, `36 §6` · **implementation blocking: yes** · in scope

**Constructed attack.** The table has five rows and no precedence statement. Take the most likely real case during a mirror outage: a **$30 refund inside the FTC 7-working-day clock**, above the per-action autonomous floor and therefore approval-bearing.

| Matching row | Behaviour |
|---|---|
| *COMPENSABLE inside a live statutory clock* | **Dispatch.** The clock outranks the mirror. |
| *Anything above the per-action approval floor* | **Halt.** |

Both match. `35 §12.1` walks this exact scenario and says *"the refund dispatches"* without noticing that its own refund may be above the floor. `36 §6` restates the table without precedence. And a further ambiguity: for an effect resumed after approval, is it still "above the approval floor" once the approval exists?

**Result.** **Two mutually exclusive behaviours for one condition, in documents of equal standing, with no precedence note** — AUDA-01's exact defect signature, reproduced inside the remediation that was written to remove it, on the case the remediation was written to serve. A developer would implement one arbitrarily, which is `43 §2.1`'s wording.

**Remediation.** State precedence explicitly and order it: (1) IRRECOVERABLE → halt; (2) above the approval floor **and not clock-bearing** → halt; (3) clock-bearing, any recoverability except IRRECOVERABLE → dispatch, with `DISPATCHED_UNMIRRORED` tagged; (4) COMPENSABLE discretionary → suspend; (5) REVERSIBLE → dispatch. Then fix `35 §12.1` to walk a floor-exceeding clock-bearing refund, because that is the case that determines whether the trade-off is coherent.

---

### AUD-06 — the statutory-clock exemption is reachable from model output

**MATERIAL** · `30 §5.1` item 4 row 2, `30 §9`, `26 §9.5`, `24 §3` K10 · **implementation blocking: no** · in scope

**Attack.** The exemption keys on *"inside a live statutory clock"*. `30 §9` sources clocks from pre-generation detectors (DSAR, chargeback webhook) and from case state. The FTC refund clock attaches when a refund is *owed*, and "owed" is established by the triage worker's classification of a customer message. A compromised triage worker classifies every case as a refund request, creating clock-bearing cases at will, which converts the whole compensable-discretionary class from *suspend* to *dispatch* during a mirror outage.

**Result.** Loss is bounded by `MAL_monetary(month)` at $300, so this is not a money finding. It is an **auditability** finding: the attacker chooses which effects escape the mirror. Combined with AUD-02, the compromised party chooses both the mode and the classification.

**Remediation.** A clock is live only when it derives from a RECORD-grade external artifact — a processor dispute webhook, a DSAR detector firing on retained raw inbound content, or an owner action — never from a model classification. Where the trigger is a customer's plain request in text, the clock is real, so the correct construction is that the *raw inbound content* is the RECORD, hashed and retained, and the clock references it. `24 §3` K10 gains `clock.source_record_ref` as a not-null column.

---

### AUD-07 — the owner override is global, untimed and uncapped

**MATERIAL** · `30 §5.1` item 5, `24 §3` K11, `22 §3.1` · **implementation blocking: no** · in scope

**Attack.** *"Prolonged unreachability halts all classes including REVERSIBLE — the point at which the company stops — with an owner override recorded as a decision."* Manufacture the conditions per AUD-02, then manufacture the pressure: the owner sees a total company halt with statutory clocks running and a queue of real customers. The override is a single act with no declared scope, no expiry and no cap, and it unlocks IRRECOVERABLE — the class the boundary was placed at.

**Result.** The strongest halt in the architecture becomes the weakest state via one owner click, on a self-declared trigger, with no post-conditions.

**Remediation.** The override is **per recoverability class, time-boxed** (a declared maximum duration), **and count-capped** (a declared maximum number of effects), auto-expiring to halt. Every effect dispatched under it is tagged, and the tag set is the mandatory input to `I8`'s next inverse sweep. A second override within a declared interval requires a distinct approver.

---

### AUD-08 — the anchoring medium is unnamed and the owner's copy travels the audited path

**MATERIAL** · registry `I17b`, `30 §5` "External anchoring" row · **implementation blocking: no (S6)** · in scope

**Attack.** `I17b` requires anchoring *"to a medium the operator cannot rewrite, with a copy delivered to the owner"*. No medium is named. The property "the operator cannot rewrite it" is a property of a specific medium and cannot be assessed at design time; and the owner's copy is delivered by a notification path the control plane operates, so a compromised control plane can suppress the copy while the anchor itself is fine.

**Remediation.** Name candidate media with their trust assumptions before S6 (append-only object storage with a retention lock under a separate account; a third-party transparency log; a timestamping service), state which is selected, and deliver the owner's copy from the **audit plane's** own egress, not the control plane's. Add the anchor's own absence to `V7` as a first-class displayed condition.

---

### AUD-09 — "completeness" is stronger than what the mechanism establishes

**WORDING** · registry `I17` and §3 item 1, `30 §5` "Completeness" row · in scope

**Attack.** A compromised control plane that dispatches an effect while writing **no** row on either side produces perfect agreement. `I17` detects nothing; the chain detects nothing; the anchor detects nothing. The only detector is `I8`'s inverse sweep from the audit plane's own vendor reads, whose limits `README` already states.

**Result.** Not a new defect — the registry's §3 already says the chain does not prove completeness and that truthfulness comes from `I8`. But `30 §5`'s row is titled *"Completeness"* and `36 §1` lists *"the audit record is complete, not merely unaltered"* as **testable: yes**. It is testable against transport loss and against a dishonest transport. It is not testable against a control plane that omits from both sides.

**Remediation.** Restate as *"transport completeness"* and move the unqualified claim to `I8`, with `I8`'s coverage limits attached wherever it is cited as the answer.

---

### AUD-11 — `I17c` quota saturation and the removed flood lever (attack defeated, recorded)

**MINOR** · registry `I17c`, `30 §5.1` item 5 · in scope

**Attack attempted.** Reproduce AUDA-05: fill the audit store from the control principal to force a system-wide mode change.

**Result.** Defeated. `I17c` makes saturation an incident and `30 §5.1` removes blanket `REQUIRE_APPROVAL` explicitly. The residual is that quota saturation now stalls the *mirror*, which enters degraded mode — so the lever no longer produces an approval flood and instead produces AUD-02's condition. The attack is redirected rather than eliminated, which is a strictly better position and worth recording as such.

---

## 4. R8 — The four authorised-loss quantities

Full independent recomputation is in `54-money-path-verification.md §2`. Findings here.

### LIM-01 — `min()` over an absent window monetary cap has no stated semantics, and no window declares one

**BLOCKING** · `26 §10.1`, `51 §2`, `51 §4.1`, registry `I7` · **implementation blocking: yes** · in scope

**Attack.** `MAL_monetary(w) = Σ min(g.window(w).max_monetary, g.per_action_max.monetary × g.window(w).max_count)`. `51 §4.1` evaluates it as `min($25.00 × 10, no window monetary cap) = $250.00` — i.e. under an **absent = +∞** convention that appears in no formula, no schema and no prose. And `51 §2`'s window table has **no monetary column at all**: not one of the nine declared windows carries a `max_monetary`. So *every term* of `MAL_monetary` at both horizons depends on the unstated convention.

My independent implementation returns `$300.00 / $62.50` under absent=+∞, `$0.00 / $0.00` under absent=0, and undefined under strict evaluation. `I7` requires a second implementation to agree; two implementations agree here only if both authors guessed the same convention, which is precisely the shared misconception the brief's §4.4.5 names. Under absent=0 the displayed ceiling is $0 while $250 is realisable.

**Result.** v1.1 fixed v1.0's undefined `min(...)` by mandating a MONTH window and left the min's *other* operand undefined. The defect moved from "no MONTH window" to "MONTH window with no monetary attribute".

**Remediation.** Either give every window a `max_monetary` (see LIM-02, which requires it anyway) or state the convention in `26 §10.1` as a typed rule — `max_monetary: Money | UNBOUNDED`, with `min(UNBOUNDED, x) = x` — and add a fixture case where the window cap binds instead of the count, so the `min` is exercised in both directions.

---

### LIM-02 — window ceilings appear in `I3`'s statement and in no artifact

**BLOCKING** · registry `I3`, `51 §2`, `26 §4`, `24 §3` K5 · **implementation blocking: yes** · in scope

**Attack.** `I3`: *"For every named window: `Σ open reservations + Σ standing forward exposure + realised spend ≤ window ceiling`, always."* Enforcement `DB (exclusion constraint) + TX at serialisable`. Violation is a **security incident**. Now look for the ceiling. `51 §2` declares nine windows with `id`, `period` and `applies to`. No ceiling. Limits live on **grants** (`per_action_max`, `window_refs`, counts). So the invariant reads an attribute of an object that has none, and there are exactly two possible repairs with opposite consequences:

- **Ceiling := Σ over grants referencing the window.** Then `I3` is satisfied by construction whenever each grant's own count binds, i.e. **vacuous**, and named windows deliver nothing over v1.0's private per-grant windows — which is the defect `26 §4` says they fix. It also makes STD-07's doubling permitted.
- **Ceiling declared independently on the window.** Then `MAL_monetary`, which sums over grants, **over-counts** relative to the realisable ceiling whenever two grants share a window, and `51` omits the values that would make `I3` checkable.

`51`'s fixture cannot distinguish the two, because `W_DAY_REFUND`, `W_MONTH_REFUND`, `W_DAY_CREDIT`, `W_MONTH_CREDIT`, `W_DAY_ADSPEND` and `W_MONTH_ADSPEND` each have **exactly one** referencing grant. Only `W_DAY_MIE` and `W_MONTH_MIE` are shared, and there the units are counts of heterogeneous cost ($35 reship against $0.50 email), so a shared count ceiling would be a control that bounds actions and not money.

**Result.** The invariant the package describes as bounding the ledger is not evaluable, and the artifact created to make the limits derivable rather than asserted does not contain the operand.

**Remediation.** Windows carry `max_monetary`, `max_count` and `max_irrecoverable_units` as declared attributes; grants may only narrow, never widen; `MAL_monetary(w)` becomes `Σ min(grant-derived, …)` capped by `window.max_monetary`, so the window is the binding object and the sum cannot exceed it. Add to the I7 fixture a window shared by two grants of different classes and a window whose monetary cap binds below the grant sum.

---

### LIM-03 — order-driven irrecoverable cost is excluded, undisclosed and undeclared

**BLOCKING** · `26 §5`, `26 §10.1`, `26 §10.4`, `51 §3.3`, `51 §6`, registry `I30`, `33 §9` · **implementation blocking: yes** · in scope

**Attack.** R8's first stated defect was that *"MAL excluded the cost of every irrecoverable action by construction"*. v1.1 discloses the **discretionary** half as `MIE_cost` and leaves the **order-driven** half excluded by `I30`. Three compounding facts:

1. `33 §9` puts POD's dominant recoverability class at IRRECOVERABLE **for every fulfilled order**, so order-driven is the larger population by construction.
2. It appears in **neither** six-item exclusion list — not `26 §10.4`, not `51 §6` — so the disclosure discipline those lists exist to enforce is not applied to it.
3. Its three governing controls are named and **none is given a value**: the per-order rate limit, the template whitelist, and the anomaly threshold on the fulfilment-to-settled-order ratio. `51` declares a value for everything else, including a $150 model-spend ceiling.

Order of magnitude, using only the fixture's own numbers: `W_MONTH_UNGATED` permits 200 ungated actions per month, and the fixture's own reship unit cost is $35.00. `200 × $35.00 = $7,000` — **larger than the $5,205 figure `51 §4.2` argues is unreachable**, in a channel that enters no displayed quantity.

**Honest bound on the attack.** The loss is not freely reachable. Fulfilment requires a settled order, and against real settled orders the cost is COGS, not authorised loss. Two routes remain: **duplicate fulfilment** of a single order, which the per-order rate limit would stop if it had a declared value; and fabricated orders, which `I27`'s processor-settlement corroboration should stop **if the ratio's denominator is settlement-derived as `51 §3.3` says** ("settled orders") and if R6's corroboration is implemented as specified. So the finding is: **the only quantitative control on the largest irrecoverable population has no declared value, and its integrity is inherited from an out-of-scope remediation.**

**Remediation.** Declare all three values in `51 §3.3`. Add `OrderDriven_cost(w) = Σ order-driven fulfilments in w × unit_cost_estimate` as a **fifth displayed quantity** — not folded into `MAL_total`, since it is COGS against revenue, but displayed adjacent with its own utilisation, exactly as §3.4 treats cost ceilings. Add order-driven fulfilment cost to both six-item exclusion lists with its magnitude stated. State that the ratio denominator must be processor-settled orders and cite `I27`.

---

### LIM-04 — realisable loss exceeds `MAL_total` via released unresolved reservations plus the `I32` override

**BLOCKING** · registry `I3`, `I32`, `25 §12`, `35 §4`, `26 §10` · **implementation blocking: yes** · in scope

The full construction is in `52 §1` Path A and traced in `54 §4`. In summary: unresolved reservations are correctly held; `I32` provides an owner override to release headroom held past the class SLA; `I3`'s terms lose the exposure on release because the effect's spend is not yet realised; the window refills; `MAL_monetary` does not change, so `26 §10`'s re-signature requirement never fires. Realisable refund loss is `10 × $25 × k`.

**Why it is not simply "the owner re-authorised".** The override is presented in `25 §12` as an **availability** remedy for `HEADROOM_STARVATION` — the sentence is about refunds denying while the FTC clock runs. Nothing in the bundle tells the owner they are raising the loss ceiling, and no displayed quantity moves.

**Remediation.** A released-but-unresolved reservation becomes a fourth `I3` term, `Σ presumed exposure of PRESUMED_SETTLED effects`, which persists until settlement resolves it — so releasing the *reservation* does not release the *exposure*. If the owner needs headroom beyond that, it must come from a separate named `override_budget` window that enters `MAL_total` and requires re-signature. The override bundle must display the `MAL_total` delta, which `30 §10` item 3 already requires for approvals generally and which this path bypasses.

---

### LIM-05 — `I3`'s declared enforcement mechanism cannot express a sum bound

**MATERIAL** · registry `I3` enforcement column and the "12 are database-enforced" headline, `36 §2` · **implementation blocking: no** · in scope

**Attack.** The registry claims `DB (exclusion constraint)` for `I3` and presents database enforcement as *"the strongest form available"*. A Postgres exclusion constraint prevents rows whose specified operators conflict pairwise; it cannot express `SUM(amount) ≤ ceiling` over a set. The available correct mechanisms are a per-window balance row with a `CHECK` updated under `SELECT ... FOR UPDATE`, or serialisable isolation with an explicit `SELECT SUM` relying on SSI.

**Result.** An implementer following the registry writes something that either does not compile or does not bound sums, then falls back to an application-level `SUM` check — which is write-skew-vulnerable at anything below serialisable, and `36 §2`'s mandatory negative control is the only thing standing between that and a silent ceiling breach. The registry's strongest-enforcement headline is overstated for its most important row.

**Remediation.** Name the mechanism: `window_balance(company_id, window_id, reserved, standing, realised, ceiling)` with `CHECK (reserved + standing + realised <= ceiling)`, taken `FOR UPDATE` before AUD-04's journal counter. That **is** DB-enforced and it does serialise, so the claim becomes true rather than aspirational.

---

### LIM-06 — `MIE_cost` is an ESTIMATE inside a displayed ceiling, and `I18` treats it as exact

**MATERIAL** · `26 §10.1`, `51 §3.3`, registry `I18` · in scope · shares remediation with CAN-08

Construct the brief's §4.4.4: an international reship. Unit cost estimate $35.00; actual COGS plus expedited international freight $95.00. `MIE_cost(month)` displays $120.00 while realisable discretionary irrecoverable cost is $220.00 on two reships. No invariant fires — `I7` recomputes the *estimate* from the fixture and agrees with itself. `I18`'s settlement leg then reports a 170% divergence as a **critical incident** on a figure the architecture labels `[ESTIMATE]`.

**Remediation.** `MIE_cost` displays a band, not a point: `Σ count × unit_cost_p50` and `Σ count × unit_cost_p95`, with `MAL_total` displayed against the p95 basis, and the p95 basis is what `I18`'s tolerance admits. Where no p95 exists, the class is not autonomy-eligible until one is measured, which is a T3 obligation.

---

### LIM-07 — the I7 fixture is degenerate with respect to the property I7 exists to prove

**MATERIAL** · `51 §5` row 1, `51 §3`, `36 §0` · in scope

**Attack.** `I7`'s oracle is *"a second independent implementation performing brute-force enumeration of live grant combinations over this fixture"*. Enumerate the combinations that actually interact in `51 §3`: none. Six of nine windows have exactly one referencing grant; the two shared MIE windows have no declared ceiling to contend for; and there is exactly one rate grant, so `Standing(w)`'s summation is a sum of one term. The oracle is genuinely independent (I built one) and it has nothing to disagree about beyond arithmetic that is already correct.

**Result.** The differential oracle is sound and the fixture cannot exercise grant composition, window sharing, standing multiplicity, or a binding window monetary cap — i.e. every failure mode `43 §5.2` and `46 R8` identified.

**Remediation.** Extend the fixture with: two grants of the same class on one window; two grants of different classes on one window with a binding window cap; two live standing authorisations on one window; a grant whose window monetary cap binds below `per_action × count`; and a 31-day month. Each is one table row and each closes a construction v1.0 actually contained.

---

### LIM-08 — chargeback loss is agent-influenceable, unreserved, uncounted and undisclosed

**MATERIAL** · `26 §6` (`dispute.representment.submit` prohibited), `26 §11` P4a, `26 §10.4`, `51 §6` · in scope

**Attack.** A chargeback costs the disputed amount plus a processor fee, and representment is categorically prohibited, so ACOS cannot contest. It is provider-initiated, so no ACOS effect exists, so nothing reserves and nothing counts. It is nevertheless **agent-influenceable**: delayed fulfilment, a wrong T-U0 statement, or a denied refund all raise chargeback probability, and `26 §6` records Visa VAMP's non-compliant threshold at a 0.5% ratio **and a count of 5** — so at low volume a handful of agent-caused disputes is an account-level event.

**Compounding.** P4a lists *"chargeback acceptance"* among the destinations it covers, which implies a governed class exists. None does. Naming an ungoverned outcome inside a symbolic property is the shape of defect `47` catalogued.

**Remediation.** Either introduce `dispute.accept` as an explicit effect class with zero authority and a journaled record (so the acceptance is at least attributable and countable), or remove chargeback acceptance from P4a's enumeration and add chargeback exposure to the six-item exclusion lists with the VAMP count stated.

---

### LIM-09 — the anti-flooding arithmetic uses the wrong ceiling and the wrong binding constraint

**MINOR** · `26 §12`, `51 §3.1` · in scope

`26 §12` claims *"at `MAL_monetary(month)` of $600 and a $25 per-action cap the queue cannot exceed roughly 24 items"*. Two errors against v1.1's own fixture: `MAL_monetary(month)` is **$300**, not $600 ($600 is `MAL_total`); and the refund class's binding constraint is `W_MONTH_REFUND`'s count of **10**, not a monetary quotient. The correct bound is 10 pending refund approvals. The property is real and the arithmetic supporting it is wrong in the loose direction.

**Remediation.** Restate as `min(count_headroom, floor(monetary_headroom / per_action_max))` per window and per class, and note that the bound is per-class rather than global.

---

### LIM-10 — the cost ceiling is excluded from `MAL_total` while `26 §14` concedes the model can consume it

**WORDING** · `51 §3.4`, `26 §10.4` item 6, `26 §14` · in scope

`MAL_total(month)` is $600. `26 §14` lists *"consume the entire model budget"* as something a fully compromised model can do, bounded by the queue ceiling of $150. Both statements are correct and the composition — the owner's realisable cash loss to a fully compromised model is **$750** — is displayed nowhere, because §3.4 excludes cost on the grounds that it is not value moving to a counterparty. The distinction is real and the owner's question is not "did value reach a counterparty", it is "how much can I lose".

**Remediation.** Display `Total realisable cash exposure = MAL_total + cost ceilings` as a fourth line in V2, labelled with the counterparty distinction rather than omitting the sum.

---

## 5. R9 + R17-P4 — Approval resume and counterparty semantics

### RES-01 — OWNER approvals have no expiry; reservations do

**BLOCKING** · `26 §12` tier table and semantics, `24 §3` K5 invariants, `25 §12` steps 4–6, `26 §7` step R′ · **implementation blocking: yes** · in scope

**Constructed attack.** `26 §12`'s tier table: OWNER — *"No auto-expiry — it waits."* `26 §12`'s semantics: *"The exposure reservation is held across the wait and released on denial or expiry."* `24 §3` K5: *"Reservations expire; a reaper releases them."*

1. An OWNER-tier refund proposal reserves $30 and waits.
2. The reservation's TTL elapses. The reaper releases it. (If it does not, `I32` has nothing to measure and reservation reaping does not exist.)
3. The owner approves on day four.
4. A new workflow starts on `(approval_id, original_idempotency_key)`. Step R′ *"asserts that the held `reservation_id` still covers the recomputed exposure"*.
5. **The reservation does not exist.** R′'s specified behaviour covers *insufficient*, not *absent*. The correct outcome is DENY, and the design does not say so.

**Result.** For the tier that most needs the reserve-before-approval property, the two lifetimes are guaranteed to conflict, and the central assertion of the R9 redesign is undefined in the resulting state. `DBO-03`'s orphaned-suspension risk was removed and its lifetime contradiction was not.

**Remediation.** Reservation TTL is derived from the approval tier's SLA and OWNER-tier reservations are exempt from reaping, with their exposure attributed to `I32`'s starvation metric so the cost of an unattended approval is visible rather than silent. R′ gains an explicit clause: an absent, released or expired `reservation_id` denies `RESERVATION_ABSENT`, and the denial carries the remedy obligation of RES-05.

---

### RES-02 — the hand proof does not cover the fixture's own grant set

**BLOCKING** · `26 §11.2`, `51 §3`, `26 §5` worked assignments, `37 §7` · **implementation blocking: yes** · in scope

**Attack.** `26 §11.2`'s table is *"the only proof until the symcc gate returns"* and the brief calls it the highest-value target. Enumerate its rows against every class that carries authority in v1.1:

| Class | Granted in `51 §3`? | In the hand proof? |
|---|---|---|
| `catalog.update` | — | yes |
| `refund.create` | yes | yes |
| `email.send` | yes | yes |
| `campaign.budget.set` | yes | yes |
| `fulfilment.order.create`, `fulfilment.reship` | yes | yes |
| `payee.*`, `payment_method.add` | prohibited | yes |
| **`goodwill.credit.issue`** | **yes — $12.50 × 4/month** | **no** |
| **`order.address.edit`** | **yes — 1/day, 1/month** | **no** |
| `campaign.pause` | required by R2 as a revocation class | no |
| `webhook.subscription.assert` / `.delete` | required by R4 | no |
| reconciler resolution | required by R4 | no |
| `entitlement.issue` / `.revoke` | reclassified by R17 | no |

**Result.** Two classes the limits fixture actively grants are absent from the proof that P4 holds, and one of them — `goodwill.credit.issue` — has no `settlement_direction` the taxonomy can express (RES-03). `37 §7` records that the hand proof is the interim substitute for the symcc gate and *"that it is weaker"*; it is also incomplete over the catalogue it claims.

**Remediation.** Complete the table over the full v1.1 authority-bearing catalogue, one row per class, with `settlement_direction`, every reachable `counterparty.novelty` value, `customer_novelty` where applicable, and P4/P4a/P7 status. Any class whose direction is not expressible is a finding, not a blank.

---

### RES-03 — `settlement_direction` is a two-way cut and store credit is neither

**BLOCKING** · `26 §11` P4/P4a, `26 §2.1`, `51 §3.1`, `26 §5` · **implementation blocking: yes** · in scope

**Attack.** P4 governs `OUTBOUND_TO_COUNTERPARTY`; P4a governs destinations that are *"the original payment instrument of a RECORD-grade transaction"*. Find a monetary destination in neither:

- **`goodwill.credit.issue`** — the fixture's second monetary grant. Value does not leave ACOS; a liability is created. Not outbound to a counterparty. Not the original instrument. It enters `MAL_monetary` at $50/month and lands in neither property.
- **Gift-card / store-credit portion of a split-tender refund** (CAN-07). The refund's card portion is P4a; the gift-card portion re-credits an instrument that may be held by a **third party** — the gift purchaser, not the payer.
- **A remedy to a gift recipient** — the payer and the beneficiary differ, so "the payer of the original transaction" does not identify the destination.
- **Marketplace payout, affiliate payout, tax remittance, wallet replacement** — not in the MVP catalogue; each is outbound to a counterparty whose novelty is structurally NOVEL on first use, so P4 forbids them absolutely and the corresponding business models are foreclosed rather than governed. That is a legitimate design position and it should be stated as one.

**Result.** The two-way distinction is not complete for the MVP action catalogue, and the incompleteness lands on a class the fixture grants.

**Remediation.** A third direction: `INTERNAL_LIABILITY` — value that becomes a liability of the company rather than an outflow, governed by per-action and window caps and by an entitlement-redemption bound, with no novelty test because there is no external destination. And a fourth, `OUTBOUND_TO_THIRD_PARTY_BENEFICIARY`, where the destination is neither payer nor registered counterparty; P4's absolute prohibition on NOVEL should extend to it, which is the conservative and correct default.

---

### RES-04 — `I31` is cited for two distinct properties, and R9's central rule has no invariant

**BLOCKING** · registry `I31`, `26 §7` step R′, `26 §12`, `25 §5`, `25 §12` step 5 · **implementation blocking: yes** · in scope

**Attack.** Registry `I31`: *"No `Reservation` is created for an `AuthorizationDecision` that already holds one."* Enforcement: unique constraint on `authorisation_id`. Now find the citations:

- `26 §7` step R′: *"A recomputed exposure exceeding the held reservation **denies** (I31)."*
- `26 §12`: *"A recomputed exposure exceeding the held reservation denies rather than topping up (I31)."*
- `25 §12` step 5 and `25 §5`: same property, same citation.

These are different statements. A unique constraint on `authorisation_id` prevents a *second row*; it does not prevent a *top-up* (an `UPDATE` to the existing row's amount), and it says nothing about the deny-on-excess rule. So **the central rule of the R9 redesign — the one the brief calls the decision among three readings — is enforced by no invariant in the registry.**

**Result.** Citation drift, in the artifact created to end citation drift, on the redesign it was created alongside. `analysis/v1.1-internal-consistency-pass.md` C5 checked that every cited identifier *resolves*; it did not check that the resolved statement is the one being cited. That is a gap in the consistency pass's method, not only in this citation.

**Remediation.** Add `I51`: *"No effect is dispatched whose recomputed exposure exceeds its held reservation; verify mode never increases a reservation amount."* Enforcement: `RUNTIME` at step R′ plus a DB trigger forbidding any `UPDATE` that increases `reservation.amount`. Correct the four citations. Add a check to the consistency-pass method: for every citation, the citing sentence must be entailed by the registry statement.

---

### RES-05 — a correct verify-mode DENY leaves no bounded next state

**MATERIAL** · `25 §12` step 5, `26 §7` DR1, `26 §12`, registry `I13` · in scope

**Attack.** Take the brief's §5.4.1 and continue past the deny. A $30 refund is approved at 09:00. Between proposal and approval the processor's fee schedule changes, or a partial settlement lands, so the recomputed exposure is $31.50 against a $30.00 held reservation. R′ denies — correctly. Then:

1. `25 §12` step 5: *"The original authorisation and idempotency lineage are preserved on the denial record."* Nothing else happens.
2. The customer is still owed a refund, inside the FTC 7-working-day clock.
3. No mechanism creates a new proposal. No typed obligation object exists. The only backstop is `I13` — *"every statutory clock is within SLA, or an escalation exists"* — which fires at a warning threshold, producing another item in the queue the owner is already failing to clear, with no linkage to the denial that caused it.

**Result.** The system safely denies and the obligation is orphaned until a clock threshold rediscovers it. The brief asks whether a clean, bounded next state exists. It does not.

**Remediation.** A verify-mode denial for a class carrying an unmet obligation emits a typed `RemedyObligation{case_ref, clock_ref, denied_authorisation_ref, reason}` and **automatically enqueues a fresh proposal at the same approval tier**, pre-populated and linked to the original approval so the owner sees one thread rather than two unrelated items. `26 §7`'s DR1 branch gains that edge.

---

### RES-06 — every constructor deploy mass-denies the pending OWNER approval queue

**MATERIAL** · `26 §12` approval binding, `26 §7` step C′, CAN-04 · in scope

**Attack.** An approval binds to `proposal_hash` **and** `dispatch_payload_hash`. Verify mode re-runs the full sequence, which includes C′. A constructor deploy that changes any computed field — adding the FX spread allowance of CAN-06, correcting a cost component — produces a different `dispatch_payload` and therefore a different hash. Every pending approval whose class the deploy touched denies on resume. OWNER approvals wait days across deploys by design (`DBO-03`'s original observation), so at MVP cadence the queue is voided regularly and silently, each denial inheriting RES-05's orphaning.

**Result.** Safe, and operationally corrosive in the way that produces approval fatigue — which `README` names as *"the failure mode this architecture is most likely to actually experience"*.

**Remediation.** Record `constructor_version` in the binding (CAN-04). On resume under a newer version, recompute and **compare semantically**: if the recomputed exposure is unchanged and the payload differs only in fields the version bump declares non-semantic, resume; otherwise deny and re-propose per RES-05. Constructor versions declare their own semantic/non-semantic change class, and that declaration is a control artifact.

---

### RES-07 — P4 covers money and leaves goods redirection outside both properties

**MATERIAL** · `26 §11` P4/P4a, `26 §5` (`order.address.edit`), `24 §8`, `51 §3.3` · in scope

**Attack.** `26 §1` corollary 1 sources the boundary from `07 §9`'s *reversibility × counterparty novelty*, and P4's rewrite narrows "counterparty" to *"a party ACOS pays"*. `order.address.edit` redirects **goods** to an arbitrary destination, moves no money, and is therefore outside P4 (no payment) and outside P4a (no instrument). `07 §4.1` names address edit and free reshipment as the two highest-risk support actions *precisely because they move goods without tripping a monetary cap* — and the rewritten property now formalises exactly that blind spot.

Residual controls are real: `IMMUTABLE_AFTER_ORDER` unless changed by an owner-approved effect, recipient resolution as at order creation, and a 1/day 1/month count. So the loss is bounded at one item per month. But the *property* claims to encode EM17's content and does not.

**Remediation.** Generalise: `settlement_direction` becomes `value_direction`, with `OUTBOUND_GOODS_TO_ADDRESS` as a direction and a novelty test on the destination address (EXISTING = an address of record on the customer at order creation; NOVEL = anything else). P4 then reads *"no policy path permits a NOVEL destination for any class whose `value_direction` is outbound"*, which covers both BEC shapes with one property.

---

### RES-08 — P7 makes every legitimate owner out-of-band action an `I8` incident

**MATERIAL** · `26 §11` P7, `26 §8` (*"the owner separately creates the payment path out-of-band"*), registry `I8`, `25 §8.3` · in scope

**Attack.** P7 forbids payment-path mutation for **every** principal including the owner through the effect path, and `26 §8` directs the owner to do it out of band. `I8` states that no external effect exists in any vendor system that ACOS did not journal, and its violation is *"an incident routed to the security path, not the accounting path"*, with three interpretations all of which are incidents.

So the prescribed workflow for onboarding a supplier — the thing `26 §8` says is *"one of the places approval is doing real work"* — **generates a security incident every time it is performed correctly.** And the obvious fix is an exclusion rule, which `24 §3` K5 refuses for renewals on the explicit grounds that *"an exclusion rule is a permanent hole in the sweep."*

**Result.** A high-severity detector with a guaranteed false positive on a routine owner action, and no channel for recording that action as authorised.

**Remediation.** An owner-attested `OutOfBandAction{vendor, operation, resource_ref, attested_at, owner_signature}` record, written through the owner's own authenticated path, which `I8` matches against exactly as `I22` matches renewals — narrow, attested, single-use, expiring. Not an exclusion rule: a positive record whose absence is still an incident.

---

### RES-09 — the `Approval` object has no declared state machine

**MINOR** · `24 §3` K9, `26 §12` · in scope

`24 §3` K9 holds approvals as kernel state and lists no states. `26 §12` gives approve, reject, expire. Deny-then-approve, approve-then-revoke-before-resume, and approve-while-a-resume-is-already-running are unspecified; the last is the one that matters, because two concurrent resumes on the same `(approval_id, original_idempotency_key)` are prevented only by the effect-key uniqueness of `I42` at step T, which is after R′ and after the state transition.

**Remediation.** Declare the enum and the legal transitions, with a unique constraint on `(approval_id)` in a `resumed` state so a second resume cannot start.

---

### RES-10 — P4a's structural truth is processor-dependent, and the enumeration has no instrument dimension

**MATERIAL** · `26 §11` P4a, `26 §8` refund policy, `24 §3` K4 item 2 · in scope

**Attack.** The brief asks whether a destination can be made to *appear* to be the original instrument. On Stripe-family APIs it cannot: the refund destination is derived by the processor from the charge, so P4a is **structurally** true and not merely policy-true, which is a genuine strength worth recording. On Shopify's `refundCreate` it is not: the mutation admits transaction parents and gateways, so the destination is selectable in the payload. `26 §8`'s policy reads `context.selected_option.instrument == "original"`, but `24 §3` K4 item 2 describes the refund enumeration as *"the refundable line items and the remaining maximum per item"* — one dimension, no instrument. The field the policy tests is therefore a constructor assertion rather than an enumerated property.

**Result.** P4a's strength varies by adapter and the package states it uniformly. Under a compromised commerce adapter (the `35 §12.2` shape, contained not closed) the RECORD-grade transaction from which "original instrument" is resolved is adapter-derived, and `I27` corroborates only OBSERVATIONS used as policy preconditions, not the RECORD the canonicaliser reads.

**Remediation.** Make `instrument` an enumerated dimension per CAN-07, and record per adapter whether P4a is structurally or policy-enforced — the same per-class enforceability table `29 §3.3` already publishes for credentials, applied to settlement destinations.

---

## 6. Attacks constructed and defeated

Recorded because a register of only successful attacks overstates the yield.

| ID | Attack | Why it failed |
|---|---|---|
| **F-01** | Supply a money-bounding value through `resource_ref` | `resource_ref` must resolve to a RECORD-grade entity inside the task's `context_spec` scope, and exposure derives from the resource, not from the reference. **Residual:** choosing the resource chooses the amount from the set of in-scope resources — bounded by `per_action_max`, and worth stating explicitly in `26 §2.0` |
| **F-02** | Use `reason_code` as an authority channel | Closed enum; step L and step M read no monetary operand from it |
| **F-03** | Reach the engine through `rationale` | Never parsed, never interpolated (`26 §2.3`, B3, B7). This survives attack cleanly |
| **F-04** | Approve twice and dispatch twice | Step T's idempotency check on the original key returns the prior result (`26 §7` properties 8, and `I42`'s unique constraint) |
| **F-05** | Exceed a window by concurrent reservations | Sound **given** LIM-05's mechanism, and `36 §2`'s mandatory REPEATABLE READ negative control is the right test. The registry names the wrong enforcement primitive; the property is achievable |
| **F-06** | Fill the audit store to force blanket `REQUIRE_APPROVAL` | Removed in v1.1. `I17c` makes saturation an incident. Redirects into AUD-02 rather than disappearing |
| **F-07** | Top up a reservation on resume | R′ asserts and does not reserve; a second row is blocked by `I31`'s unique constraint. The *rule* has no invariant (RES-04) but the *mechanism* holds |
| **F-08** | Refund a novel counterparty on a Stripe-settled order | Structurally impossible — the processor derives the destination from the charge (see RES-10 for the Shopify contrast) |
| **F-09** | Reach `$5,205` through the fixture's declared non-rate grants | Defeated. My brute-force enumeration confirms the MONTH counts bind in every class: refund `min(10, 60) = 10`, credit `min(4, 30) = 4`, reship `min(2, 60) = 2`, address edit `min(1, 30) = 1`, email `min(40, 300) = 40`. `51 §4.2`'s composition argument is **correct as stated** |
| **F-10** | Fabricate orders to raise the order-driven allowance | Defeated **if** `I27`'s processor-settlement corroboration is implemented as specified and the ratio denominator is settled orders, which `51 §3.3` says it is. Contingent on an out-of-scope remediation (see LIM-03) |

---

## 7. Out-of-scope findings

Recorded and not expanded, per the brief.

### OOS-01 — the only real advertising containment is a cap ACOS cannot raise, and R2 prices the risk as though the cap worked

**OUT_OF_SCOPE** (R5/CRD-03, already withdrawn and disclosed) · why it matters: `29 §3.3` establishes SR10's corollary is unsatisfiable on Google and Meta, so the platform cap is a **detection surface**. `35 §7` layer 4 then presents `StandingAuthorization` as *"the layer that actually bounds this scenario"*, and `51 §3.2` prices advertising exposure at $180/month. A compromised ad adapter raising the account budget is bounded by neither. The in-scope consequence is only that `Standing(w)` should not be read as bounding advertising loss under adapter compromise, which `26 §10.4` item 5 and `49` already state.

### OOS-02 — `LIM-03`'s integrity is inherited from R6

**OUT_OF_SCOPE** (R6, endorsed) · why it matters: named above so the third pass does not assume LIM-03 is closed by declaring three values. The ratio's denominator must be processor-settled, which is `I27`'s corroboration, which is R6's parser split and `SpendAuthorityCondition` change. If R6 slips, LIM-03 becomes a loss channel rather than a disclosure defect.

### OOS-03 — three in-scope levers terminate in an unbounded owner-attention channel

**OUT_OF_SCOPE** (R16, deferred per red team) · why it matters: CAN-05's probing, RES-05's orphaned obligations and AUD-06's manufactured clocks all produce owner-visible items at zero monetary exposure, and the bound — the attention budget and per-cause caps (`I39`, `I40`) — is deferred to T2. `46 R16` directed the deferral and I do not reopen it. The register notes only that the deferral's cost is now three additional levers rather than the four `26 §12` enumerates.
