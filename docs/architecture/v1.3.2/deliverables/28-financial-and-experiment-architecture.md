# 28 — Financial and Experiment Architecture

**ACOS Operating Spine v1.3. Version 1.3. Issued 2026-09-03. Supersedes v1.1 (2026-09-02).**
Covers Phase 2 brief Parts 12 and 13. Depends on `22`, `24`, `25`, `26`.

## v1.3 change record

No change in v1.3. Version line bumped so the package carries one version; `phase2-v1.3-changelog.md §7` records which artifacts were materially edited and which were not.

## v1.1 change record

| Change | Remediation | Section |
|---|---|---|
| **K6 splits** into finance ingest (integration boundary, credentialed) and finance computation (control plane, no vendor credential). The org-scoped model-provider cost credential is enumerated rather than assumed benign. | R4 | §3 |
| The tolerance-rule temporal check is **I12, not I7**. v1.0 cited I7 here, in ADR-007, in `35 §8` and in `36 §12`; `30 §6.1` defined I7 as the MAL sum. | R20 | §4 |
| **The audit plane runs the settlement equality check independently** from its own read-only processor and bank credentials. | R10 | §4, §6.2 |
| Provisional advertising spend is reconciled against a `StandingAuthorization` rather than held as an expiring commitment. | R2 | §6.4 |
| `SpendAuthorityCondition` requires order counts corroborated against **processor settlement**, not the commerce projection. | R6 | §8 |
| The symcc deferral is recorded here as a formal **amendment to `11 E6`** under §9.2, not applied silently. | R14, R19 | §9.2 |
| Product-originated metering is OBSERVATION with a declared deterministic spec, or the metering component is model-free and CI-checked like the finance computation. | R17 | §10 |


---

## 1. Required properties of financial truth

Stated as properties first, so the design can be checked against them.

| # | Property | Source |
|---|---|---|
| F1 | **No model appears in the derivation graph of any financial value.** | EM7; `06 §2.6` — FinanceBench: GPT-4-Turbo with retrieval incorrectly answered or refused **81%** of questions; GSM-Symbolic performance declines when only numbers change, with drops up to 65% from a single irrelevant-but-plausible clause. |
| F2 | **The complete financial picture is producible with every model offline.** | B10; `08 §9` — ~2.8 hours/month of provider degradation, with a documented 3h38m global outage. |
| F3 | **Every figure ties to an external record**, and the terminal tie is the bank deposit line. | `SPINE`'s second pro-project finding; `10 §5.4`. |
| F4 | **Reconciliation is a falsifiable equality check**, not a judgement. | `10 §2.2`: *"Summary total == deposit amount, or the books are wrong."* |
| F5 | **Unresolved discrepancy is a valid terminal state.** Invented reconciliation is not. | Phase 2 brief Part 12; Constitution §6. |
| F6 | **Committed exposure and realised cost are separate ledgers.** | SR5, `24 §3` K5. |
| F7 | **Contribution margin before marketing is exact; after marketing it is labelled.** | `06 §2.6` — CM-before-marketing is computable to the cent; CM-after-marketing is *"structurally unreliable"* and must be reported as observation, not fact. |
| F8 | **Platform-reported attribution is CLAIM grade and cannot drive authority.** | EM12; Gordon et al. against 663 RCTs — 4.8×–12.8× overstatement at the purchase stage. |
| F9 | **Per-order AI cost is a modelled allocation and must be labelled one.** | `09 §11.5` — both Anthropic and OpenAI expose cost APIs at **daily granularity only**. |
| F10 | **Two ceilings — solvency and intensity — are carried as separate quantities.** | `21 §8.3`; `18 §2.1`. |

---

## 2. Objects

```
FinancialEvent {
  id, company_id, occurred_at, recorded_at,
  source_system,                 // stripe | shopify | bank | supplier | ad_platform | model_provider
  source_external_id,            // the upstream primary key — uniqueness enforced
  category,                      // from a closed enum, §3
  gross_amount, fee_amount, net_amount, currency,
  presentment_currency, settlement_currency, fx_rate_ref,
  order_ref?, payout_ref?, campaign_ref?,
  content_hash,                  // hash of the raw upstream payload, retained
  grade = RECORD
}

Payout        { id, source_system, external_id, period, expected_net, bank_reference }
BankLine      { id, value_date, amount, reference, statement_hash }
ReconciliationRun { id, scope, ran_at, status, rule_version, matched_count, unmatched_count }
Discrepancy   { id, run_id, subject_refs[], expected, actual, delta, status, opened_at, resolution? }
ContributionMarginRecord { order_ref, revenue, cogs, shipping, fulfilment_fee,
                           processing_fee, platform_fee, refund_allocation,
                           cm_before_marketing, computed_by_spec_version }
CommitmentEntry { id, window_ref, amount, irrecoverable_units, state, effect_ref, expires_at }
CashPosition  { as_of, bank_balances[], platform_held_balances[], unsettled_receivables,
                committed_unpaid, available }
RunwayProjection { as_of, horizon, monthly_burn_components[], months_remaining, scenario }
```

**`source_external_id` uniqueness is the primary defence against double-counting.** A retried ingest of the same Stripe balance transaction is a no-op, not a second event. This is the financial-plane equivalent of the effect idempotency key.

---

## 3. Where each number comes from

| Figure | Source of record | Mechanism | Grade |
|---|---|---|---|
| Gross revenue | Commerce platform orders, reconciled against processor charges | Poller + reconciler | RECORD |
| Refunds | Processor refund objects (**not** the commerce platform's refund intent) | Ingest | RECORD |
| Payment fees | Processor balance transactions, keyed on `reporting_category` **not** `type` | Ingest | RECORD |
| Platform fees | Commerce platform payout detail | Ingest | RECORD |
| COGS | Supplier cost API at order time, snapshotted onto the order | Adapter at fulfilment | RECORD, with a short `max_age` on the quote |
| Shipping cost | Supplier or carrier invoice line | Ingest | RECORD |
| Fulfilment fees | Supplier invoice | Ingest | RECORD |
| Chargebacks & dispute fees | Processor dispute objects | Ingest | RECORD |
| Advertising spend | Ad platform billing endpoint | Ingest, with a **posting-lag window** (§6.4) | RECORD |
| Model & tool cost | Provider cost APIs — **daily granularity only** | Ingest | RECORD at day level; per-order is ESTIMATE (F9) |
| SaaS subscriptions | Owner-maintained register, reconciled against card statement lines | Ingest + manual register | RECORD |
| Cash | Bank statement lines | Ingest | RECORD — the terminal tie |
| Contribution margin before marketing | Computed | Deterministic spec | OBSERVATION |
| Contribution margin after marketing | Computed, period-level, blended | Deterministic spec | **OBSERVATION, labelled** |
| Attributed ROAS / platform conversions | Ad platform | Ingest | **CLAIM** (F8) |
| Incremental CAC | ACOS's own holdout/geo design, computed from ACOS's order table | K12 | OBSERVATION |
| Runway | Computed from cash, burn components and commitments | Deterministic spec | OBSERVATION |

**Two mappings are called out because Phase 1 named them specifically.**

`reporting_category`, not `type`, on Stripe balance transactions (`10 §2.2`). Using `type` produces a ledger that looks right and does not tie.

The credential that reads model-provider cost data is **org-scoped admin** and cannot be substituted by a workspace key (`10 §2.2`). `09 §11.5` draws the consequence: *"the finance-reading component must hold a credential strictly more powerful than anything the operating agents hold — an argument for reading cost data from a separate, non-agentic service."*

**v1.1: that credential is a perimeter member and a prohibited-class hazard, and v1.0 treated it as neither (R4, from `43 §8`).** Org-admin scopes on both named model providers include **API-key and workspace management**, which touches `credential.*` — a categorical prohibition in `26 §6` — and plausibly spend-limit configuration, which touches `platform.spend_cap.raise`. I15 as written asserted that no principal holds a scope covering a prohibited class and could not verify this. Three consequences:

1. **The scope is enumerated** in `48-external-write-perimeter.md`, not assumed.
2. **It is replaced with a purpose-scoped key** if the provider offers one; where it cannot be narrowed, the residual is stated and I15's **empirical probe** applies to it — a scheduled attempt against a sacrificial resource, with a succeeding probe treated as a critical incident.
3. **It is held by a finance ingest adapter and never by the computation module.** v1.0 placed this capability in two trust zones at once: `§3` here put it in the Integration Plane while `33 §2.1` listed `finance` as a control-plane module and `23 §3` said the control plane holds only its own database credential. All three could not be true. **Ingest holds credentials and computes nothing; computation holds no credential and is CI-checked for the absence of both a model client and a credential loader (I25).**

---

## 4. The settlement-level equality check

The single best automated integrity control available, and it requires no AI (`10 §2.2`).

```
for each Payout P:
    events   := FinancialEvents where payout_ref = P
    computed := Σ events.net_amount
    bank     := BankLine matched to P by reference and value date

    if computed == P.expected_net == bank.amount     → MATCHED
    elif |computed − bank.amount| ≤ tolerance(rule)  → MATCHED_WITH_TOLERANCE(rule_id)
    else                                             → UNMATCHED → Discrepancy
```

**Three states. No fourth.** No "approximately", no "pending investigation" that silently ages into acceptance, no model-authored explanation that closes the item.

**Tolerance rules are named, versioned artifacts** with an explicit justification — FX rounding on a documented settlement currency conversion, a known sub-cent processor rounding convention. **v1.1: they are control artifacts under B9**, hash-matched to the owner-signed manifest (I19), because a tolerance rule is the one artifact whose modification silently disables the terminal financial control.

**A tolerance rule may never be created in response to an open discrepancy**; that is the mechanism by which a reconciliation control quietly stops being one. The audit plane checks for tolerance rules created within `[ESTIMATE: 30 days]` of a discrepancy they would have resolved, and reports it as a finding. **This is invariant I12, not I7** — v1.0 cited I7 here, in ADR-007, in `35 §8` and in `36 §12`, while `30 §6.1` defined I7 as `Σ live grant ceilings == MAL` and I12 as this check. Three documents disagreed about which invariant did what, which is why `phase2-v1.3-invariant-registry.md` now owns every identifier.

**v1.1: the audit plane runs this check independently (R10).** v1.0's version compared the control plane's projection of the processor to the control plane's projection of the bank — both read by adapters in one plane with no per-adapter isolation, while `29 §19` rates supply-chain compromise MODERATE and catastrophic. The audit plane recomputes the equality from **its own read-only processor and bank credentials** (I4, I8). Financial truth proved by comparing one system to itself is not proved, and the MVP additions in `37 S3` — Stripe test mode, a development-store payout, a synthetic bank statement — exist so that the three-way tie is exercisable before real money.

---

## 5. Contribution margin

**Before marketing — exact.**

```
cm_before_marketing = revenue
                    − cogs
                    − outbound_shipping
                    − fulfilment_fee
                    − processing_fee
                    − platform_fee
                    − allocated_refund_and_return_cost
```

Every term is a RECORD-grade FinancialEvent tied to the order. `06 §2.6` confirms this is computable to the cent, and `21 §7.7` makes it a business-model-independent constraint. `18 §7`'s solvency test (`CAC_incremental < CM₀`) reads this figure directly, which is why its exactness matters.

**After marketing — labelled, period-level, blended.**

```
cm_after_marketing(period) = Σ cm_before_marketing(orders in period)
                           − advertising_spend(period)
                           − marketing_software(period)
```

Not attributed per order. `06 §2.6`: ATT removed the deterministic identifier, modelled conversions are estimates, attribution windows are a parameter choice, and platforms grade their own homework. Any per-order marketing allocation is a modelling choice, and if it is shown at all it carries `ESTIMATE` grade with its allocation basis stated.

**AI and infrastructure cost is period-level, allocated.** F9. The control centre shows daily provider cost as RECORD and per-order allocation as ESTIMATE, with the divisor stated. `09 §12` also notes the specific decomposition that matters: **fixed-cadence work is volume-insensitive and runs ~$40/month whether the store does 100 or 300 orders**, so the report separates cadence cost from per-event cost. Otherwise a falling per-order AI cost at rising volume reads as an efficiency gain when it is arithmetic.

---

## 6. Reconciliation when sources disagree

The brief names five cases. Each is a `Discrepancy`, and **none auto-resolves**.

### 6.1 Commerce platform says one amount, processor says another

Processor is authoritative for money; the commerce platform is authoritative for the order. A mismatch is usually a partial capture, a gift-card portion, a currency-presentation difference or a platform-side refund with no processor counterpart. The reconciler classifies against a set of named patterns; unclassified → `UNMATCHED`, escalation, and the affected order's contribution-margin record is marked `INCOMPLETE` rather than computed from the plausible-looking side.

### 6.2 Bank settlement differs from the payout

The bank is terminal. A payout that does not tie to a deposit means either the payout has not landed (timing — resolved by the value-date window) or the books are wrong. Beyond the window it is `UNMATCHED` and it is a high-urgency escalation, because it is the one check that catches a whole class of upstream mapping errors at once.

### 6.3 Supplier charge differs from the quoted cost

The quote was RECORD-at-fetch-time with a short `max_age`. A divergence updates COGS on the order, recomputes the contribution-margin record, **and increments a supplier-quality metric**. Repeated divergence is a supplier finding, not an accounting nuisance — it is exactly the signal a human supplier evaluation would catch and an API-only relationship would otherwise miss (`06 §2.2` classes supplier evaluation as RED-UNECONOMIC precisely because most quality signals are not observable from any API; charge-vs-quote divergence is one of the few that is).

### 6.4 Ad platform posts delayed spend

Normal, not a discrepancy. The design carries a **posting-lag window** per platform: spend within the window is `PROVISIONAL`, becomes RECORD on final posting, and the exposure ledger holds the provisional figure so authorisation cannot double-spend against unposted spend. Spend that posts *outside* the window, or that exceeds the provisional figure by more than a tolerance, is a discrepancy — and because ad spend is the fastest-moving exposure class, this check is the early warning for the runaway scenario in `35 §7`.

**v1.1: provisional spend is reconciled against a `StandingAuthorization`, not held as an expiring commitment (R2, from `43 §8`).** v1.0's provisional commitment interacted badly with reservation expiry: reservations expire and are reaped (`24 §3` K5), so if a reservation for a rate-changing action expired while the platform kept spending, **headroom was returned while spend continued**. The fix is structural rather than a longer expiry — forward exposure belongs to the standing authorisation and is **re-reserved at each window boundary**, and a boundary that cannot be reserved *pauses* the authorisation through its revocation class (I22, I23). A recurring charge matching no live standing authorisation is an incident, which also means the inverse sweep stops false-positiving on every renewal without an exclusion rule.

### 6.5 A refund exists downstream with no upstream request

Reported by the effect reconciler's inverse sweep (`25 §8.3`): an external mutation ACOS did not journal. Three possibilities — a bug, a second uncontrolled actor, or a compromise. All three are security incidents, and the discrepancy is routed to the incident path rather than the accounting path.

**The rule across all five:** *prefer an unresolved discrepancy over an invented reconciliation.* Discrepancies age, escalate, and appear in the owner briefing's adverse-facts list. They do not quietly resolve.

---

## 7. Cash, runway and the two ceilings

### 7.1 Cash position

```
available = Σ bank_balances
          + Σ platform_held_balances_available
          − Σ open_commitments
```

**Platform-held balances are shown separately and are not treated as available by default.** Two evidenced reasons: Etsy reserves funds *"up to 180 days"* on triggers a new shop fails by construction (`SPINE` finding 8), and `21 §4.3` reclassifies the Schedule A asset-freeze exposure as *a pre-appearance freeze of platform-held funds plus defence costs, bounded by account balances*. Both are working-capital events on platform-held money. Modelling that money as cash is the error; modelling it as an infinite loss is the error `21 §4.3` retracts. The design does neither: it is a separately-tracked balance with a scenario that removes it.

### 7.2 Runway

```
months_remaining = available / monthly_burn
monthly_burn     = fixed_saas + model_and_tools + marketing + fulfilment_overhead + other
```

Three registered scenarios, computed deterministically:

| Scenario | Assumption |
|---|---|
| `BASE` | Current burn, current revenue trajectory |
| `NO_MARKETING` | Marketing to zero — the floor scenario, and the one that answers "how long do we have if we stop spending" |
| `PLATFORM_HOLD` | Platform-held balances unavailable for 180 days — the Etsy-reserve and Schedule-A working-capital case |

### 7.3 The two ceilings, as separate quantities

EM13, `21 §8.3`, `18 §2.1`. Phase 1 conflated these and produced the withdrawn `$9.18`.

```
solvency ceiling:   CAC_max_solvency  = μ · AOV · L        // margin-dependent
intensity ceiling:  CAC_max_intensity = m · AOV · L        // margin-INDEPENDENT when m is on revenue
```

Both are computed and displayed, never merged. `18 §6` carries an unresolved caveat that must travel with the intensity figure: the margin-independence is an artefact of normalising `m` on **revenue**, and `18 §2.2` argues the correct normalisation is marketing as a share of **gross profit**, under which `CAC_intensity = m_gp · μ · AOV · L` and margin re-enters. **That normalisation question is open** (`18 §8` item 4, a one-hour XBRL job). The architecture therefore stores `m` with its **denominator basis** as an explicit field, so both normalisations are computable when the data arrives and neither is hard-coded.

### 7.4 Marketing intensity as a trajectory

EM13. The governance object is not a percentage cap.

```
SpendTrajectoryPolicy {
  objective_id,
  runway_months_floor,           // hard: spend that would breach this is denied
  intensity_slope_ceiling,       // m must be non-increasing over a rolling window
  organic_repeat_share_floor,    // must be rising
  review_cadence,
  measured_incremental_cac_required  // EM12
}
```

The owner-facing derived quantity, from `18 §7`:

```
months_of_above-ceiling_spend_affordable
    = capital / (monthly_orders × (CAC_measured − CAC_intensity))
```

**What must not be built:** a hard cap at 15% of revenue. `21 §8.2` — FIGS printed **30.0%** at $110.5M revenue; Allbirds never printed a figure inside 6–16% in its entire disclosed life; no filer discloses a launch year. *"Hard-coding it produces a system that halts a healthy launch."*

**And the pro-ACOS point that was never made** (`SPINE` v1.1 framing amendment): the mature band is a residual after a public company's full cost stack, and a business with materially less opex can rationally sustain a higher intensity at the same margin. The trajectory model accommodates that; a threshold cannot.

---

## 8. Acquisition measurement

EM12 in mechanical form.

| Object | Purpose |
|---|---|
| `AttributionClaim` | Platform-reported conversions and ROAS. **CLAIM grade.** Stored, displayed, labelled, never a policy precondition. |
| `IncrementalityMeasurement` | `{design: HOLDOUT \| GEO, cells[], window, spend, orders_by_cell, incremental_orders, incremental_cac, confidence_interval, computed_by_spec}`. OBSERVATION grade. |
| `SpendAuthorityCondition` | A grant condition requiring a fresh `IncrementalityMeasurement` for the objective (I49). Absent or stale → advertising exposure capped at the last proven level. **v1.1 (R6, REC-01): the measurement's order counts must be corroborated against processor settlement, not taken from the commerce projection (I27).** v1.0's version was computed by K12 from ACOS's own order table, so a compromised **commerce** adapter could write plausible RECORD-grade orders, produce a favourable incremental CAC, and unlock the **advertising** adapter's authority without touching the advertising credential. The escalation is documented in `24 §10` case 6. |

**Cell assignment is deterministic and pre-registered.** Assignment logic is code, the seed is recorded, and the assignment is frozen before the window opens. `11 E2`'s stated hard part is *"not looking at platform-reported ROAS mid-flight"* — so the architecture removes the temptation structurally: during an active incrementality measurement, platform ROAS for the affected campaigns is **suppressed from the control centre and from every assembled context**, and the suppression is logged. It returns when the window closes.

**The incrementality multiple is a live unknown, not a constant.** `18 §8` item 2: the 4.8–12.8× literature figure is for established advertisers; `18 §4.4` argues it is smaller for a zero-brand store, and that is an inference. It is a measured output of the experiment, never a hard-coded adjustment factor.

---

## 9. Experiments as first-class objects

Phase 2 brief Part 13. Constitution §18 forbids moving goalposts; `10 §2.4` names statistical honesty, not tooling, as the risk.

```
Experiment {
  id, company_id, type,               // DECISION_GATE | PARAMETER_ESTIMATE | SAFETY_GATE
  question, hypothesis,
  decision_informed_ref,              // the decision this result will feed — mandatory
  metrics[] { metric_ref, computation_spec_version, primary: bool },
  success_criteria[],                 // executable predicates over metric outputs
  failure_criteria[],
  budget { usd, tokens, exposure_window_refs[] },
  boundary { duration \| sample_size \| both },
  assignment { design, unit, seed, cell_spec },   // null for observational
  stopping_conditions[],
  registered_at, registered_by,
  frozen_hash,                        // SHA-256 of the above, anchored in the audit store
  status, amendments[], result?, verdict?, verdict_computed_at
}
```

### 9.1 Freezing

SR8. At registration, the canonicalised pre-registration is hashed and the hash is written to the **audit store** (K11) — a store no operating principal can write to. Post-hoc modification is not merely discouraged; it is detectable by anyone who recomputes the hash.

### 9.2 Amendment

Permitted, because rigidity in genuinely learning situations is its own failure. An amendment produces a new version with a diff, a stated reason, an author, and a new anchored hash. **Results are computed against both the original and the amended criteria and both are reported.** An amendment made after any result data has been observed is flagged as such in the record, permanently.

#### Amendment to `11 E6`, recorded 2026-09-02 (v1.1)

**What changed.** `11 E6` pre-registers *zero policy-violating writes and no symcc counterexample* as the acceptance criterion for the deterministic authority layer, and `37 S1` v1.0 made the symcc proof an S1 completion gate. **The symcc gate moves from S1 to a later point:** before the action catalogue exceeds ten classes, and before any real money.

**Why.** `45 §3`: with a three-class action catalogue the policy set is hand-checkable, and symcc adds a toolchain plus the fragment-compatibility risk ADR-005 names as its own reconsideration trigger. The complexity budget is better spent on the Effect Canonicaliser, which `45 §7` shows is the difference between proving property 3 about the policy set and proving it about *the wrong object* — symcc establishes that no path permits a refund above the cap **given a request**, while under v1.0 the request's amount arrived from the model.

**What is unchanged.** The acceptance criterion itself. Zero policy-violating writes remains an S1 gate, tested by the injection harness and by property tests. The symcc counterexample criterion is deferred, not weakened, and P4's re-proof is a hand proof over the MVP catalogue now (`26 §11.2`) with the mechanical re-run at the gate.

**Why this is recorded here rather than applied quietly.** `21 §2` item 16 found a silent partial remediation entering the Phase 1 package with no change record, and a second instance inside Phase 1R. `45 §3` is explicit that *"silently moving a pre-registered `11 E6` gate is the goalpost move the package prohibits."* This is the amendment path this section exists to provide, and using it is the point.

### 9.3 Verdict

Computed by K12 against the frozen predicates. `PASS | FAIL | INVALID | INCONCLUSIVE_AT_BOUNDARY`.

`INVALID` exists deliberately: an experiment whose metrics cannot be computed — missing data, broken assignment, a contaminated cell — is invalid, **not** "inconclusive but directionally positive." The model may interpret a verdict; it cannot produce one, revise one, or characterise an `INVALID` as anything else.

### 9.4 The three types

**`DECISION_GATE`** — a pass/fail that unblocks or blocks a decision. E2's solvency test.

**`PARAMETER_ESTIMATE`** — no pass/fail. Reports an estimate and an interval. This type exists because `18 §7` requires it for **β**, the elasticity of CPA to AOV: *"Report the estimate and its interval. No pass/fail — this is a parameter, not a gate."* Forcing a parameter into a gate schema is how a measurement becomes an argument.

**`SAFETY_GATE`** — pass required before an autonomy promotion. `11 E6` (deterministic authority layer under adversarial input, acceptance **zero** violations) and `11 E7` (pass^k, acceptance **pass^4 ≥ 90%** with zero RED-class escalation misses) are of this type, and their verdicts write directly to the autonomy ledger (`26 §13`).

### 9.5 Supporting E2 without baking it in

`18 §7` restructures E2 to measure four quantities. The schema supports all four with no product-specific fields:

| E2 component | Type | Schema support |
|---|---|---|
| **E2.1** Measured incremental CAC vs contribution margin | `DECISION_GATE` | `assignment.design = GEO`, primary metric `incremental_cac`, success predicate `incremental_cac < cm_before_marketing` |
| **E2.2** β, elasticity of CPA to AOV | `PARAMETER_ESTIMATE` | Multi-arm assignment across price points in one category; output is an estimate with an interval |
| **E2.3** Trajectory of `m` | `DECISION_GATE` | Metric series with a slope predicate over the window, plus the organic/repeat share floor |
| **E2.4** Observed early `L` | `PARAMETER_ESTIMATE` with a **censoring horizon field** | `boundary.duration` plus a mandatory `censoring_horizon`; the schema forbids extrapolating a lifetime value from a bounded window by making the horizon a required output field |

**The NO-GO conditions are encoded as predicates, not prose** (`18 §7`): `CAC_incremental > CM₀` on two distinct niches; or `m` flat/rising with no organic or repeat contribution appearing; or `β ≥ 0.9` **combined with** `μ < 0.45`.

**And the condition that must not be encoded:** failing to reach 6–16% marketing intensity during launch. `18 §7`: *"FIGS did not. Allbirds never did."* A schema that permits a mature-company ratio as a stopping rule would reintroduce the withdrawn `$9.18` by the back door.

### 9.6 What the architecture prevents

| Failure | Mechanism |
|---|---|
| Changing success criteria after seeing results | Frozen hash anchored in the audit store; amendments are visible, dated and attributed |
| Peeking and stopping early | Stopping conditions are pre-registered predicates evaluated by K12; a stop outside them is a policy violation and an audit finding |
| Reporting the arm that worked | The primary metric is declared at registration; secondary metrics are reported but cannot carry the verdict |
| Silently abandoning a failed experiment | Status transitions are recorded; an abandoned experiment appears in the adverse-facts list |
| Contaminating a cell | Assignment is deterministic with a recorded seed; the effect journal records which cell each effect touched, so contamination is detectable after the fact |
| Optimising on the platform's number mid-flight | ROAS suppression during an active measurement (§8), logged |

---

## 10. What the financial architecture does not solve

1. **Attribution.** Structurally broken, and no design fixes it. The architecture's contribution is to stop pretending otherwise: platform numbers are CLAIM, incrementality is the only OBSERVATION, and authority is gated on the latter.
2. **Per-order AI cost.** Modelled, not measured. Both providers expose daily granularity only.
3. **Supplier cost drift between quote and invoice.** Detected, not prevented.
4. **The unresolved `m` normalisation.** Stored with its basis so both readings survive; not resolved here (`18 §8` item 4).
5. **`L`, the repeat rate, for any candidate category.** `03:446` found no benchmark and `11 A21` says one may not exist. It is a measured output of E2.4, and the schema's mandatory censoring horizon is there to stop a 60-day observation becoming a lifetime value.
6. **Product-originated metering, for a micro-SaaS model** (v1.1, R17, BMN-05). If usage metering inside the sold product becomes a RECORD source, B4's *"no value in a financial record has a model in its derivation graph"* extends into a data plane the effect model does not govern. Three acceptable postures, in preference order: the metering component is **model-free and CI-checked** exactly as the finance computation is; or metering enters as **OBSERVATION with a declared deterministic spec** and cannot gate; or B4 is stated as breaking **through the product** rather than through the accounting path, which is a business-model finding rather than an architecture one. No stage has selected a micro-SaaS model, so this is recorded and not built — but the neutrality claim in `33 §9` is narrowed accordingly rather than left implying the question is closed.
