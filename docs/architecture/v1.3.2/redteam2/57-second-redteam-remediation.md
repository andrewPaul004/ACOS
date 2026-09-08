# 57 — Second Red Team Remediation

**ACOS Operating Spine v1.1 → v1.2. Issued 2026-09-03.**
Created because `52-second-redteam-executive-verdict.md` returns **CONDITIONAL PASS — REMEDIATION REQUIRED**.

**This document specifies changes. It does not implement them.** No code, no schema, no vendor provisioning.

Twenty-two BLOCKING defects. Each entry gives the exact defect, the exact architecture change, the invariant affected, the test required, and whether a third review is required for that item specifically.

**Third review is required for two items only — SR-A1 and SR-B2 — because they are new mechanisms rather than stated values or corrected sentences.** The other twenty are remediate-and-verify.

---

## 0. Tiering

`46`'s tier vocabulary, reused. **T1** = before S1/S2 code · **T2** = before the slice introducing the capability · **T3** = before any real credential, money, customer or advertising spend.

| Item | Defect | Tier | 3rd review |
|---|---|---|---|
| SR-C1 | `I18` equality ill-typed | T1 | No |
| SR-C2 | Enumeration transport unspecified | T1 | No |
| SR-C3 | Positional selector permits substitution | T1 | No |
| SR-C4 | `constructor_version` unrecorded | T1 | No |
| SR-S1 | Rolling-window forward exposure undefined | T1 | No |
| SR-S2 | Standing headroom release condition unspecified | T1 | **Yes** |
| SR-S3 | Expiry/revocation deadlock | T1 | No |
| SR-S4 | No overdelivery allowance | T1 | No |
| SR-A1 | `I17` not evaluable by its owner | T1 | **Yes** |
| SR-A2 | Degraded mode self-declared | T1 | **Yes** (with SR-A1) |
| SR-A3 | Row canonicalisation undefined | T1 | No |
| SR-A4 | Gap-free sequencing mechanism unstated | T1 | No |
| SR-A5 | Re-push duplicates poison the chain and anchor | T1 | No |
| SR-A6 | Split-halt rows conflict | T1 | No |
| SR-L1 | `min()` over absent cap | T1 | No |
| SR-L2 | Window ceilings undeclared | T1 | No |
| SR-L3 | Order-driven cost excluded and undeclared | T1 | No |
| SR-L4 | Headroom laundering via the `I32` override | T1 | No |
| SR-R1 | Reservation vs OWNER approval lifetime | T1 | No |
| SR-R2 | Hand proof incomplete | T1 | No |
| SR-R3 | `settlement_direction` incomplete | T1 | No |
| SR-R4 | R9's central rule has no invariant | T1 | No |

All twenty-two are T1 because every one lands in the S1 schema, constructor, exposure ledger, journal or policy set.

---

## 1. R1 — Effect Canonicaliser

### SR-C1 — split exposure so `I18` is satisfiable

**Defect.** `I18` requires `dispatch_payload.monetary_effect == authorisation.exposure == reservation.amount` while `26 §2.1` defines exposure to include `cost_components[]`. For a $25.00 refund with a $1.03 retained fee the equality is either vacuous (`monetary_effect` is a copy of a kernel figure) or false (`monetary_effect` is the $25.00 in the vendor request). For `fulfilment.reship` the vendor request has no money field, so the first term has no referent.

**Change.** `26 §2.1`: replace `exposure.monetary_amount` with two fields.

```
exposure {
  vendor_amount,          // the money in the dispatched request; null where the request carries none
  total_exposure,         // vendor_amount + Σ cost_components; the reserved quantity
  currency, fx_rate_ref, original_amount, original_currency,
  cost_components[], forward_integral, irrecoverable_units, irrecoverable_class
}
```

Restate `I18` as three separate assertions: `dispatch_payload.monetary_effect == exposure.vendor_amount`; `reservation.amount == exposure.total_exposure`; `total_exposure ≥ vendor_amount`, with equality only for classes declaring no cost components. Propagate to `24 §3` K4, `26 §8`'s refund policy (which must test `total_exposure` against the cap, not `vendor_amount`), `36 §2`, `51 §5`.

**Invariants.** `I18` restated. `I3`'s reservation term now unambiguously references `total_exposure`.

**Test.** Per-class construction fixture with a hand-computed table containing at least one class with a null `vendor_amount` (reship) and one with non-zero cost components (refund). The fixture must be authored from the processor's published fee schedule, not from the production constructor.

**Third review: no.** The change is a field split with a mechanical propagation.

### SR-C2 — specify the enumeration read

**Defect.** Enumerate-then-select requires the model to see the enumeration and no capability returns it. Either `selector` is uninformed (and the class stops working) or an unspecified read exists at the trust boundary with no `context_spec`, no journal and no quota.

**Change.** `24 §3` K4 and `25 §4` gain a READ capability:

```
enumerate_effects(action_class, resource_ref)
  → EnumeratedOptionSet { enumeration_id, computed_at, constructor_version,
                          options[ { option_id, description, … } ] }
```

Inside the task's `tool_scope`; subject to the task's `context_spec`, which must admit every field an option's `description` exposes; journaled as a read row, not an effect; rate-limited per principal per window. `26 §7`'s closing paragraph is corrected: enumeration scoping is now a mechanism rather than an assertion.

**Invariants.** New `I52`: no `EnumeratedOptionSet` option description contains a field outside the requesting task's `context_spec`. Enforcement CI (spec review) plus RUNTIME.

**Test.** For each class, assert the option description's field set is a subset of the `context_spec`'s admitted fields; assert an out-of-scope `resource_ref` denies.

**Third review: no.**

### SR-C3 — content-address the options

**Defect.** `53 §1` CAN-03's constructed path: the option set is enumerated at *t* and re-enumerated at C′; membership changes reorder it; index *n* denotes a different effect; the executed effect is economically different from the selected one and **no invariant fires**.

**Change.** `option_id = H(action_class ‖ resource_id ‖ semantic_option_digest)`. `ProposedIntent.selector` becomes `selector { enumeration_id, option_id }`. Step C′ re-enumerates and denies `SELECTOR_STALE` if `option_id` is absent from the live set, and `SELECTOR_ENUMERATION_STALE` if `enumeration_id.computed_at` exceeds the class's `max_age`. `26 §2.0`'s field list, `26 §7`'s C′ row and `I21`'s permitted-field list are updated (`selector` remains one field).

**Invariants.** `I21` unchanged in content. New `I53`: no effect is dispatched whose `option_id` was absent from the enumeration computed under the C′ lock.

**Test.** The reordering scenario in `53 §1` CAN-03, executed with an injected concurrent partial refund, asserting `SELECTOR_STALE` rather than a successful refund of a different line. Negative control: the same test with positional selectors must produce the substitution, demonstrating the test detects the bug.

**Third review: no.**

### SR-C4 — record `constructor_version`

**Defect.** `26 §11`'s reproducibility claim is false across any constructor change, and `I18`'s settlement-side investigation cannot identify which constructor computed the disputed exposure.

**Change.** `constructor_version` on `AuthorizationRequest`, on `AuthorizationDecision`, on the journal row, and in the approval binding alongside `dispatch_payload_hash`. `50-control-artifact-manifest.md` gains **constructors as a seventeenth control-artifact class** under B9 — they compute money and are currently not owner-signed. Constructor versions declare their own semantic/non-semantic change class, consumed by SR-R1's resume rule.

**Invariants.** `I19` extended to constructors.

**Test.** Replay a recorded decision under a bumped constructor and assert the replay is refused rather than silently producing a different result.

**Third review: no.**

---

## 2. R2 — `StandingAuthorization`

### SR-S1 — standing authorisations reference discrete windows only

**Defect.** Four of `51 §2`'s nine windows are rolling 24h. A rolling window has no end to integrate to and no boundary at which to re-reserve, so `Standing(day) = $6.00` does not follow from the declared semantics and R2's pause mechanism has no trigger point.

**Change.** `51 §2` gains a `boundary_kind` column ∈ `{DISCRETE, ROLLING}`. A grant with `standing.required = true` may reference **DISCRETE windows only**; referencing a rolling window is a catalogue defect and denies (SR7's fail-closed applied to the new dimension). Redeclare `W_DAY_ADSPEND` as a calendar day on the company timezone, evaluated on the database clock.

**Invariants.** `I3` gains the statement that standing forward exposure is defined only against DISCRETE windows. `I23`'s test acquires a boundary to test at.

**Test.** A rate grant referencing a rolling window must deny at catalogue validation. Boundary re-reservation at a calendar-day boundary with expiry inside the window, asserting pause.

**Third review: no.**

### SR-S2 — define when standing forward exposure returns

**Defect.** `53 §2` STD-02 and `54 §4.2`. On a pause whose outcome is unknown, releasing the forward exposure returns headroom while the platform continues spending — the v1.0 defect R2 exists to close, reached through the pause path — and a second authorisation's `reconciler_match_rule` then absorbs the first's charges so `I22` stays silent.

**Change.** Three parts.

1. `24 §3` K5's status enum gains `PAUSE_PENDING`: `LIVE | PAUSE_PENDING | PAUSED | EXPIRED | REVOKED`. Forward exposure is retained in `LIVE` and `PAUSE_PENDING` and released **only** on `REVOKED`.
2. `REVOKED` requires a **verification read** showing zero incremental platform spend across a per-adapter `cessation_lag` interval, declared per adapter from vendor documentation. `PAUSED` is a display state, not a release state.
3. `I3` gains a fourth term: `Σ forward exposure of PAUSE_PENDING authorisations`. `reconciler_match_rule` is scoped to a single `standing_authorization_id` so a successor cannot absorb a predecessor's charges.

**Stated consequence, because it is commercial.** Headroom is unavailable for `cessation_lag` after a pause, so pause-and-reauthorise within one window is not possible. That is the correct trade and it must be visible in V2, not discovered.

**Invariants.** `I3` extended. `I22` narrowed to a per-authorisation match. New `I54`: no `StandingAuthorization` transitions to `REVOKED` without a verification read showing zero incremental spend across `cessation_lag`.

**Test.** Pause dispatch → adapter timeout → assert forward exposure retained, status `PAUSE_PENDING`, and a second `campaign.budget.set` denied `WINDOW_EXHAUSTED`. Then a verification read showing continued spend → assert `I22` incident against the original authorisation.

**Third review: YES.** This is a new mechanism with a commercial cost, and "when may headroom return" has no safe answer that is also cheap. A reviewer should attack the `cessation_lag` construction before it is built.

### SR-S3 — break the expiry/revocation deadlock

**Defect.** `expires_at` mirrors grant expiry; the revocation effect requires a matching grant at step I; the grant has expired; `DENY: NO_GRANT`; the authorisation cannot pause and spend continues. `I23` is defeated by the mechanism enforcing it.

**Change.** Two parts.

1. Authorising a rate class creates a **standing revocation authority** alongside the `StandingAuthorization`: scoped to exactly one class (`revocation_effect_class`), one resource, one `standing_authorization_id`, zero monetary exposure, with `expires_at = grant.expires_at + cessation_grace`. It is created by the kernel, not by a grant, and it can authorise nothing else.
2. `26 §7` gains an explicit **KERNEL_SERVICE branch** naming which steps a kernel-originated request skips (grants, evidence requirements, autonomy ledger) and which it must not (prohibitions, C′, reservation, journaling, audit write). `24 §3` K4 already accepts *"a fully specified action request from a kernel state machine"* and `26 §7` has no branch for it, so this closes an implicit authority bypass as well as the deadlock.

**Invariants.** `I23` becomes achievable. New `I55`: every live `StandingAuthorization` has a live standing revocation authority.

**Test.** Expire the advertising grant with a live standing authorisation and assert the pause dispatches. Assert the standing revocation authority cannot authorise any other class or resource.

**Third review: no.**

### SR-S4 — add an overdelivery allowance and fix the month basis

**Defect.** Documented platform behaviour delivers up to twice the daily budget on an individual day and caps monthly delivery at 30.4× the daily budget. The fixture reserves `30 × $6 = $180`, so a single day of overdelivery makes the next boundary re-reservation fail and a healthy campaign pauses in the first week.

**Change.** `forward_exposure = rate × remaining_periods × (1 + overdelivery_allowance)`, with `overdelivery_allowance` declared per adapter from vendor documentation and cited. The month basis becomes the calendar window's actual day count, or the platform's own basis where it is larger. `24 §3` K5 raises `STANDING_HEADROOM_SHORT` at the **first projected** shortfall rather than at the boundary, so the owner sees it before the pause.

**Invariants.** `I3` unchanged; `Standing(w)` now includes the allowance, so `MAL_total` rises and requires re-signature — which is correct, since the allowance is authorised loss.

**Test.** Simulate 2× day-1 delivery and assert the day-2 boundary re-reserves successfully. Simulate sustained overdelivery to the allowance ceiling and assert pause with the projected-shortfall warning raised earlier.

**Third review: no.**

---

## 3. R3 — Audit ordering and degraded mode

### SR-A1 — give `I17` the side it does not have

**Defect.** `I17` is owned by Audit and requires enumerating the control journal; `24 §3` K11's declared inputs contain no control-journal read, and R10 removed the replica deliberately. The audit plane can detect mid-range omission and cannot detect tail truncation: a push that stops at seq 900 of 1,000 leaves a gap-free, hash-consistent audit side whose `row_count` anchor agrees with itself.

**Change.** A periodic control-plane **attestation carried as a journal row**, occupying its own sequence value:

```
JournalAttestation { company_id, max_journal_seq, row_count, head_hash, attested_at }
```

Pushed on the same path as every other row. Cadence strictly shorter than the anchor interval. Then a stopped writer is a sequence gap rather than a silence, and truncation contradicts the last attestation the audit plane holds. **No control-database read is introduced**, so R10's decision stands.

**Invariants.** New `I17e`: attestation rows are continuous at the declared cadence, and the latest attestation's `max_journal_seq` and `row_count` are consistent with the audit store's holdings. `I17` restated as *"gap-free and consistent with the latest received attestation"*. `30 §5`'s "Completeness" row becomes "Transport completeness" and the unqualified claim moves to `I8` with its limits attached (`53 §3` AUD-09).

**Test.** Truncate the push at seq 900 out of band and assert detection **from the audit plane alone**, with no control-database access. Assert that a suppressed attestation presents as a sequence gap.

**Third review: YES.** This changes what the audit plane is and what it can prove. It should be attacked before it is built.

### SR-A2 — degraded mode must be corroborated

**Defect.** The push, the `mirrored_at` column, the lag check (`25 §13`) and the degraded-mode flag are all control-plane state. From the audit side, provider outage and declining-to-push are the same observation, so the mode that relaxes the audit guarantee is entered on the word of the component it protects against — which also classifies each effect into the halt row that determines its treatment.

**Change.** Three parts.

1. Degraded mode is entered only when the **audit plane** also publishes `MIRROR_INPUT_STALL` through its own read endpoint, derived from SR-A1's attestation continuity. `30 §3` V7's client-side diff displays both declarations side by side.
2. Every effect dispatched under degradation is tagged `DISPATCHED_UNMIRRORED` in the journal. The tag set is a **mandatory input** to `I8`'s next inverse sweep, so the reconciliation target is a specific set rather than a time period.
3. A clock is live only when it references a RECORD-grade external artifact. `24 §3` K10 gains a not-null `clock.source_record_ref` — a processor dispute webhook, a retained raw inbound message with its content hash, or an owner action. Never a model classification (`53 §3` AUD-06).

**Invariants.** New `I17f`: no effect dispatches under degraded mode without a concurrent audit-plane `MIRROR_INPUT_STALL` finding. New `I56`: every statutory clock resolves to a RECORD-grade `source_record_ref`.

**Test.** A control plane that stops pushing while the mirror is reachable must fail to enter degraded mode. A triage worker classifying every case as a refund request must not create live clocks.

**Third review: YES**, jointly with SR-A1.

### SR-A3 — define the canonical row form

**Defect.** The chain is over *"canonicalised rows"* and the canonicalisation is undefined. Postgres `jsonb` does not preserve key order or numeric representation, so two independent triggers over one logical row can produce different bytes — continuous false `I41` criticals — and two logically different rows can canonicalise identically.

**Change.** Define the canonical byte string in `30 §5`: fixed field order, RFC 8785-style canonicalisation for structured fields, fixed numeric scale per column, UTC timestamps at fixed precision, explicit null encoding. **Transmit the canonical byte string** to the audit plane and hash the transmitted bytes on both sides; never re-serialise from `jsonb`. The canonicalisation specification becomes a control artifact under B9 — changing it reinterprets every historical hash.

**Invariants.** `I41` becomes achievable. `I17d` unchanged.

**Test.** Round-trip a row containing a structured field with keys inserted in two different orders and assert identical `row_hash` on both instances. Assert that two rows differing only in a numeric scale (`25.0` vs `25.00`) produce **different** hashes.

**Third review: no.**

### SR-A4 — state the sequencing mechanism and its lock order

**Defect.** Postgres sequences gap on rollback and cannot deliver gap-freedom. The only correct implementations impose a company-scoped serialisation point on the effect path, which no document states, and they introduce a lock-ordering requirement against the window balance row.

**Change.** `30 §5.1` specifies `journal_counter(company_id, next_seq)`, incremented inside the authorising transaction. **Declared lock order: window balance row, then journal counter.** `33`'s scale envelope records the per-company serialisation and its throughput consequence. State that `journal_seq` is not an input to the effect idempotency key, so a serialisation-failure retry regenerates the same key.

**Invariants.** `I17` unchanged in content; its precondition is now specified.

**Test.** Roll back an authorising transaction and assert no gap. Run two concurrent authorisations for one company and assert both commit with adjacent sequence values. Assert no deadlock between the two hot rows under reversed access attempts.

**Third review: no.**

### SR-A5 — make re-push idempotent and distinguish duplication from tampering

**Defect.** A crash between the audit acknowledgement and the `mirrored_at` update causes a re-push. Audit-side uniqueness is unspecified, so seq *N* is inserted twice, `I17`'s *"exactly one audit row"* fails, dispatch halts by class, and the `row_count` anchor is poisoned. **An ordinary crash produces a tamper signature.**

**Change.** `UNIQUE (company_id, journal_seq)` on the audit table with `INSERT ... ON CONFLICT DO NOTHING`, and the conflict path compares the stored `row_hash` to the re-pushed one: **same seq and same hash is a duplicate; same seq and different hash is tampering** and raises a critical incident. `row_count` becomes `count(DISTINCT journal_seq)`. `mirrored_at` is advisory and never a correctness input.

**Invariants.** `I17`, `I17b` become robust to retry.

**Test.** Kill at the ack boundary, retry, and assert no incident. Then push a different row under an existing sequence value and assert a critical incident.

**Third review: no.**

### SR-A6 — give the split-halt table a precedence order

**Defect.** A $30 refund inside a live FTC clock, above the per-action approval floor, matches *"COMPENSABLE inside a live statutory clock — dispatch"* and *"anything above the per-action approval floor — halt"*. No precedence exists in `30 §5.1`, `24 §3` K11, `36 §6`, `22 §3.1` or `35 §12.1`, and `35 §12.1` walks exactly this case assuming the first row wins. **This is AUDA-01's signature reproduced inside its own remediation.**

**Change.** `30 §5.1` item 4 becomes an ordered list, evaluated first-match:

1. IRRECOVERABLE → **halt**
2. Above the approval floor **and not clock-bearing** → **halt**
3. Clock-bearing, any class except IRRECOVERABLE → **dispatch**, tagged `DISPATCHED_UNMIRRORED`
4. COMPENSABLE discretionary → **suspend**
5. REVERSIBLE → **dispatch**

Plus a stated rule: an effect carrying a recorded approval is evaluated at row 3 or 5, not row 2, because the approval floor's purpose is satisfied. Propagate to `24 §3` K11, `36 §6`, `22 §3.1`. Rewrite `35 §12.1` to walk a **floor-exceeding, clock-bearing** refund, since that is the case that determines whether the trade-off is coherent.

**Invariants.** No new invariant; the table becomes deterministic.

**Test.** Fixture per row, including one effect matching rows 2 and 3 simultaneously, asserting the declared precedence.

**Third review: no.**

---

## 4. R8 — MAL / MIE / limits

### SR-L1 — state the `min()` semantics

**Defect.** Every term of `MAL_monetary` takes a `min` against an absent operand, because no window in `51 §2` declares a monetary cap. My independent implementation returns $300.00, $0.00 or undefined depending on a convention stated nowhere. `I7`'s two implementations agree only if both authors guess alike — the shared misconception the brief names.

**Change.** `26 §10.1` types the field: `window.max_monetary : Money | UNBOUNDED`, with `min(UNBOUNDED, x) = x` stated explicitly. Resolved in practice by SR-L2, which gives every window a value.

**Invariants.** `I7` becomes well-defined.

**Test.** An I7 fixture case where the **window cap binds** below `per_action × count`, so the `min` is exercised in both directions rather than only one.

**Third review: no.**

### SR-L2 — declare window ceilings

**Defect.** `I3` reads `window ceiling` and no artifact declares one. The two possible repairs have opposite consequences: ceiling as the sum over referencing grants makes `I3` vacuous and named windows pointless; an independently declared ceiling makes `MAL_monetary` over-count when grants share a window. `51`'s fixture cannot distinguish them because six of nine windows have one referencing grant.

**Change.** `51 §2` gains `max_monetary`, `max_count` and `max_irrecoverable_units` as declared window attributes. **Grants may only narrow, never widen.** `MAL_monetary(w)` becomes `min(window.max_monetary, Σ grant-derived terms)`, so the window is the binding object and the grant sum cannot exceed it. `26 §4` and `24 §3` K5 restated. Resolve `W_DAY_MIE` / `W_MONTH_MIE`'s heterogeneous count units by declaring them per-class sub-ceilings within one named window, or by splitting them per class — either is acceptable; leaving it implicit is not.

**Invariants.** `I3` becomes evaluable. `I7` gains the window cap as a term.

**Test.** Two grants of different classes on one window with a binding window cap; assert the second denies `WINDOW_EXHAUSTED` before its own grant count is reached, and assert `MAL_monetary` displays the window cap rather than the grant sum.

**Third review: no.**

### SR-L3 — declare and display the order-driven channel

**Defect.** Order-driven irrecoverable cost is excluded from `MAL_total` by `I30`, absent from **both** six-item exclusion lists, and its three governing controls have no declared values — in the class `33 §9` says dominates POD by volume. Order of magnitude from the fixture's own numbers: `200 × $35 = $7,000` against a displayed $600.

**Change.** Four parts.

1. `51 §3.3` declares the **per-order fulfilment rate limit** (recommended: 1, with a second fulfilment requiring approval), the **template whitelist**, and the **fulfilment-to-settled-order ratio threshold** with its value and its evaluation window.
2. A fifth displayed quantity: `OrderDriven_cost(w) = Σ order-driven fulfilments in w × unit_cost_estimate`, shown adjacent to `MAL_total` with its own utilisation and **not folded in**, exactly as `51 §3.4` treats cost ceilings. It is COGS against revenue, not authorised loss — and it must be visible.
3. Order-driven fulfilment cost is added to `26 §10.4` and `51 §6` as a **seventh** exclusion with its magnitude stated.
4. `51 §3.3` states that the ratio's denominator is **processor-settled** orders and cites `I27`, so the dependency on R6 is explicit rather than inherited silently.

**Invariants.** `I30` unchanged. New `I57`: the fulfilment-to-settled-order ratio is below its declared threshold, computed with a processor-settled denominator.

**Test.** Attempt a second fulfilment of one order and assert refusal. Fabricate orders through a compromised commerce adapter and assert the ratio detects them because the denominator is settlement-derived.

**Third review: no.**

### SR-L4 — released-but-unresolved exposure must keep counting

**Defect.** `54 §4.1`'s Path A. Ten unresolved refund reservations trigger `I32`; the owner exercises the override, framed in `25 §12` as an availability remedy; `I3`'s terms lose the exposure because released reservations are not open and unresolved spend is not realised; the window refills; `MAL_monetary` never changes so `26 §10`'s re-signature never fires. Realisable loss is `10 × $25 × k`.

**Change.** Three parts.

1. `I3` gains a term: `Σ presumed exposure of effects in PRESUMED_SETTLED`, persisting until settlement resolves it. Releasing the **reservation** does not release the **exposure**.
2. Headroom beyond that comes only from a separate named `W_*_OVERRIDE` window that **enters `MAL_total`** and requires owner re-signature under `26 §10`.
3. The override bundle displays the `MAL_total` delta, which `30 §10` item 3 already requires of every approval bundle and which this path bypasses.

**Invariants.** `I3` extended. `I32`'s override becomes an authorised ceiling increase rather than a liquidity action.

**Test.** Execute Path A and assert the second batch of ten refunds denies `WINDOW_EXHAUSTED` unless an override window with a signed ceiling exists. Assert the override bundle shows a non-zero MAL delta.

**Third review: no.**

---

## 5. R9 + R17-P4

### SR-R1 — reconcile reservation lifetime with approval lifetime

**Defect.** `26 §12` gives OWNER approvals no expiry; `24 §3` K5 reaps reservations. The reservation is therefore guaranteed to be reaped before an OWNER approval arrives, and R′ covers *insufficient*, not *absent*.

**Change.** Three parts.

1. Reservation TTL derives from the approval tier's SLA. **OWNER-tier reservations are exempt from reaping** and are attributed to `I32`'s starvation metric, so the cost of an unattended approval is visible rather than silent.
2. R′ gains an explicit clause: an absent, released or expired `reservation_id` denies `RESERVATION_ABSENT` and emits SR-R1's obligation record below.
3. **A bounded next state after any verify-mode denial.** `26 §7`'s DR1 branch emits `RemedyObligation{case_ref, clock_ref, denied_authorisation_ref, reason}` and auto-enqueues a fresh proposal at the same approval tier, linked to the original approval so the owner sees one thread. This also serves the constructor-deploy mass-denial case, which is the volume case: on resume under a newer constructor, compare **semantically** — unchanged exposure plus a payload differing only in fields the version bump declares non-semantic resumes; anything else denies and re-proposes.

**Invariants.** New `I58`: no denied verify-mode resume for a class carrying an unmet obligation exists without a linked `RemedyObligation`.

**Test.** Approve after the reservation's TTL and assert `RESERVATION_ABSENT` plus an obligation record. Deploy a constructor bump mid-queue and assert semantically-equivalent approvals resume while others re-propose.

**Third review: no.**

### SR-R2 — complete the hand proof

**Defect.** `26 §11.2` covers eleven of nineteen authority-bearing classes and omits `goodwill.credit.issue` and `order.address.edit`, **both granted in `51 §3`**, plus `campaign.pause`, `webhook.subscription.*`, reconciler resolution, `entitlement.issue/revoke` and `supplier.relationship.create`. It is the only proof of P4 until symcc returns, and the symcc deferral's justification is the completeness of this substitute.

**Change.** Complete the table over all nineteen classes with four columns: `value_direction`, reachable `counterparty.novelty`, reachable `customer_novelty`, and P4/P4a/P6/P7 status. **Include P6 reachability**, absent from the current table — a hand proof of safety properties without a reachability check can certify an outage. Any class whose direction is not expressible is a finding, not a blank cell.

**Invariants.** None new; P4's interim evidence becomes complete.

**Test.** The table is the artifact. A CI check asserts one row per class in the action catalogue, so a new class cannot be added without a row — the same generate-and-diff discipline `I14` applies to capability declarations.

**Third review: no**, provided the completed table contains no class whose direction requires SR-R3's extension beyond what SR-R3 specifies.

### SR-R3 — extend `settlement_direction`

**Defect.** `goodwill.credit.issue` — a monetary class entering `MAL_monetary`, granted in the fixture — is neither outbound to a counterparty nor inbound to the original instrument. The same gap covers the gift-card portion of a split-tender refund, a remedy to a gift recipient, and goods redirection.

**Change.** Rename `settlement_direction` to `value_direction` and extend to six values (`56 §2.1`'s table): `NONE`, `INBOUND_ORIGINAL_INSTRUMENT`, `OUTBOUND_TO_COUNTERPARTY`, `INTERNAL_LIABILITY`, `OUTBOUND_TO_THIRD_PARTY_BENEFICIARY`, `OUTBOUND_GOODS_TO_ADDRESS`. Restate P4 as *"no policy path permits a NOVEL destination for any class whose `value_direction` is outbound"*, which covers both BEC shapes — money and goods — with one property. `INTERNAL_LIABILITY` is governed by per-action and window caps plus a redemption bound and carries no novelty test. Make refund `instrument` an **enumerated dimension** (with SR-C3's option ids), so `26 §8`'s `instrument == "original"` tests an enumerated property rather than a constructor assertion, and split-tender orders become expressible.

**Invariants.** P4 restated; P4a unchanged in content. New `I59`: no class in the catalogue has a null `value_direction`.

**Test.** Assert every catalogue class has a direction. Assert a split-tender refund enumerates per `(line, parent_transaction)` and that a gift-card destination held by a third party is treated as `OUTBOUND_TO_THIRD_PARTY_BENEFICIARY`.

**Third review: no.**

### SR-R4 — give R9's central rule an invariant

**Defect.** `I31` states *"no `Reservation` is created for an `AuthorizationDecision` that already holds one"* and is cited in four places for *"a recomputed exposure exceeding the held reservation denies"*. These are different statements: a unique constraint prevents a second row, not an `UPDATE` that raises the amount, and it says nothing about the deny rule. **The decision the brief calls the central choice among three readings is enforced by no invariant.**

**Change.** New `I51`: *"No effect is dispatched whose recomputed exposure exceeds its held reservation, and verify mode never increases a reservation amount."* Enforcement: RUNTIME at step R′ plus a DB trigger forbidding any `UPDATE` that increases `reservation.amount`. Correct the four citations in `26 §7`, `26 §12`, `25 §5`, `25 §12`.

**And a method change.** `analysis/v1.1-internal-consistency-pass.md` C5 verified that every cited identifier **resolves**; it did not verify that the resolved statement **entails the citing sentence**. Add that check: for every citation, the citing sentence must be entailed by the registry statement. This defect is the evidence that the weaker check is insufficient, and it will find others.

**Invariants.** New `I51`.

**Test.** Attempt a top-up `UPDATE` and assert the trigger refuses. Assert a resume with a larger recomputed exposure denies and that the denial is attributed to `I51`.

**Third review: no.**

---

## 6. What the third review covers, and what it does not

**Covers:** SR-A1, SR-A2 (jointly — they are one mechanism), and SR-S2.

Scope for that pass, stated now so it stays narrow:

1. Does the attestation row close tail truncation **and** the stopped-writer case, without introducing a control-database read and without a new suppression channel of its own?
2. Does corroborated degraded mode remain enterable during a genuine two-sided provider outage — i.e. does the fix create an availability deadlock where neither plane can declare degradation?
3. Does `cessation_lag` produce a coherent standing lifecycle, and what is the commercial cost of a window in which advertising cannot be reauthorised?
4. Does `I3`'s four-term sum (open + standing + `PAUSE_PENDING` + `PRESUMED_SETTLED` + realised) remain enforceable as a single DB-checked bound under SR-L2's declared ceilings?

**Does not cover** the other nineteen items. They are stated values, schema fields, precedence orders, table completions and corrected sentences, and re-reviewing them would trade the concentration that made this pass useful for a survey.

## 7. What must not happen in remediation

One instruction, because it is the failure mode this project has twice recorded in itself.

**Do not answer a BLOCKING finding by weakening the invariant.** `I18` must not be relaxed to a tolerance that admits omitted cost components; `I17` must not be restated as one-sided and called complete; `I3` must not drop the `PRESUMED_SETTLED` term because it is inconvenient; P4 must not be narrowed further to make the hand proof shorter. Every finding here has a repair that supplies a missing mechanism or a missing value. `52 §6` records that a remediation weakening an invariant instead is itself the reconsideration trigger for this verdict.
