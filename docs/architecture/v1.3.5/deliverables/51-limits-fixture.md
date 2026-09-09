# 51 — Authority Limits Fixture

**ACOS Operating Spine v1.3. Issued 2026-09-03. Supersedes v1.2 (2026-09-03) and v1.1 (2026-09-02).**
Rebuilt for v1.2 in response to SR-L1, SR-L2, SR-L3, SR-L4, SR-S1, SR-S2, SR-S4 and SR-C1. Governed by `26 §10` and ADR-022. Verified by `I7`, whose reference oracle output is `analysis/recompute-v1.3-output.txt`.

**v1.3.3 changes (package issue v1.3.3; S1H-C1, S1H-C10).** **`§3.7` is new**: `degraded_per_action_approval_floor_monetary` = **USD 20.00**, compared against `total_exposure`, strict. **`§3.8` is new**: `mirror_lag_critical_threshold` = **PT15M** and `audit_unreachable_full_halt_threshold` = **PT30M**, both inclusive at the threshold. All three are OWNER DECISIONS recorded as such. **No numerical authority quantity changed.** `MAL_monetary(month)` remains $300.00 and `MAL_total(month)` at the signature basis remains $756.00 — all three quantities gate *dispatch*, never *exposure*, so no re-signature of the MAL basis is required. Fresh signatures are owed on control-artifact class 3 and on the new class 27 (`50 §2`).

**v1.3 changes (TA-02, TA-05, TB-05, TB-02, TB-03).** `§3.2` declares the `I8` sweep cadence per adapter, separates `vendor_reporting_lag` from the cessation specification, replaces the single scalar `cessation_lag` with a pointer to the four-field specification TB-07 schedules, and scopes forward exposure to window instances. `§3.2.1` declares each adapter's actual charge-record field set with absent fields marked absent. `§3.2.2` declares the `standing_authorization_id` derivation, its authoritative timestamp and its directional ambiguity rule. **`§3.6` is new**: the degraded-mode override limit set. **No numerical authority quantity changed. `MAL_monetary(month)` remains $300.00, `Standing(month)` remains $182.40 / $186.00, `MAL_total(month)` at the signature basis remains $756.00, and no owner re-signature is required** — every override limit is a sub-limit of an already-signed ceiling and an override changes no ceiling (`§3.6`).

**Grade: ESTIMATE and RECOMMENDATION. Not a decision.** `07 §9` is explicit that the numbers are illustrative and the structure is the finding. `MAL_monetary` requires an owner signature per `26 §10.3`. These should be tightened on evidence, never loosened on inconvenience.

---

## 0. What changed, and why patching the totals would not have been enough

`52 §3` identified the dominant failure mode of the v1.1 remediation: **a quantity or a threshold that the mechanism needs, that the artifact declaring quantities does not declare.** Nine of the twenty-two BLOCKING findings had that shape and **six of the nine landed in this document.** v1.1's arithmetic was independently reproduced and was correct (`54 §2.1`); its *semantics* were not, and correcting printed totals would have left every one of the six.

| v1.1 defect | What was missing | Where it is now declared |
|---|---|---|
| LIM-01 | The `min()` convention over an absent window cap | `§2`, and `26 §10.1`'s type |
| LIM-02 | Window ceilings — `I3`'s operand existed in no artifact | `§2`, three ceilings on every window |
| LIM-03 | The three order-driven controls, all named and none valued | `§3.4` |
| LIM-04 | Any mechanism preventing released-but-unresolved exposure from refilling the window | `§2` override windows + `26 §10.1`'s `PRESUMED_SETTLED` term |
| STD-01 | `boundary_kind` — four windows were rolling, and forward exposure to a rolling window's end is undefined | `§2`, all windows DISCRETE |
| STD-04 / STD-06 | The overdelivery allowance and the month basis | `§3.2` |
| LIM-07 | A fixture capable of exercising grant composition at all | `§7`, fixture F2 |
| CAN-08 | A per-class settlement tolerance | `§5.1` |

**And one structural change.** v1.1 said *"stop asserting the ceiling and start computing it"* and then computed it from grants while `I3` read an undeclared window attribute. v1.2 closes that: **the window is the binding object.** Grants narrow; windows bind; `MAL_monetary` and `I3` read the same declared operand.

---

## 1. Reading conventions, stated before any number

Because `54 §2.3` had to infer a convention from a printed answer, which is the circularity `36 §0` exists to prevent.

- **`max_monetary` is typed `Money | UNBOUNDED` and is not nullable.** `min(UNBOUNDED, x) = x`. `0.00` means the window admits no monetary exposure and every reservation against it denies. **`null` is a schema violation rejected at catalogue validation.** There is no third convention to guess.
- **Grants may only narrow.** Each individual grant's derived term must be `≤` the window's ceiling. **The *sum* over grants referencing a window may exceed the ceiling, and the ceiling binds.** This is the distinction LIM-02 said had opposite consequences, and v1.2 selects the second: the window is the binding object, so `I3` is not vacuous and `MAL_monetary` does not over-count.
- **Every window is `DISCRETE`.** Calendar day or calendar month, company timezone, evaluated on the database clock only, never a worker's (`36 §6`). `ROLLING` remains in the type and is `NOT_ADMISSIBLE_AT_MVP` — see `§2.1`.
- **All money is in the single ledger currency.** Cross-currency monetary classes are non-autonomous at MVP (`58 §11`, CAN-06).
- **`[ESTIMATE]` and `IMPLEMENTATION_VALIDATION_REQUIRED` are distinct markers.** The first means the number is a judgement; the second means the number is a placeholder for a measurement with a named slice and a conservative default until it is taken.

---

## 2. Named windows, with declared ceilings

Windows are **company-scoped named objects**; grants reference them; an effect reserves against **every** window its matching grants reference and fails if **any** lacks headroom (`26 §7` step R). **Named exposure windows are a control artifact** (`50 §2` class 17): changing a ceiling is an owner-signed act with a second factor.

| Window id | `boundary_kind` | Period | `max_monetary` | `max_count` | `max_irrecoverable_units` | Applies to |
|---|---|---|---|---|---|---|
| `W_DAY_REFUND` | DISCRETE | calendar day | **$50.00** | **2** | n/a | `refund.create` |
| `W_MONTH_REFUND` | DISCRETE | calendar month | **$250.00** | **10** | n/a | `refund.create` |
| `W_DAY_CREDIT` | DISCRETE | calendar day | **$12.50** | **1** | n/a | `goodwill.credit.issue` |
| `W_MONTH_CREDIT` | DISCRETE | calendar month | **$50.00** | **4** | n/a | `goodwill.credit.issue` |
| `W_DAY_ADSPEND` | DISCRETE | calendar day | **$12.00** | UNBOUNDED | n/a | `campaign.budget.set` (rate) |
| `W_MONTH_ADSPEND` | DISCRETE | calendar month | **$186.00** | UNBOUNDED | n/a | `campaign.budget.set` (rate) |
| `W_DAY_MIE` | DISCRETE | calendar day | UNBOUNDED | **per class, `§2.2`** | **13** | discretionary irrecoverable classes |
| `W_MONTH_MIE` | DISCRETE | calendar month | UNBOUNDED | **per class, `§2.2`** | **43** | discretionary irrecoverable classes |
| `W_MONTH_UNGATED` | DISCRETE | calendar month | UNBOUNDED | **200** | n/a | every action class — the EM9 governed count |
| `W_LIABILITY_OUTSTANDING` | DISCRETE | rolling balance, not a period — **see note** | **$200.00** | UNBOUNDED | n/a | `INTERNAL_LIABILITY` classes: outstanding unredeemed store credit |
| `W_MONTH_REFUND_OVERRIDE` | DISCRETE | calendar month | **$0.00** | **0** | n/a | `refund.create`, override headroom only |
| `W_MONTH_CREDIT_OVERRIDE` | DISCRETE | calendar month | **$0.00** | **0** | n/a | `goodwill.credit.issue`, override headroom only |

**`W_MONTH_ADSPEND`'s $186.00.** This is the annual worst case of `standing_cap(month)` — `$6.00 × 31` in a 31-day month (`§3.2`). The ceiling is a declared constant; the standing cap varies below it by month. A ceiling that varied by month would be a control artifact whose value changes without a signature, which is exactly what `50` exists to prevent.

**`W_LIABILITY_OUTSTANDING` is a balance, not a period window.** It is the redemption bound SR-R3 requires for `INTERNAL_LIABILITY`: outstanding unredeemed store credit may not exceed $200.00 at any instant. It carries `boundary_kind = DISCRETE` because it is evaluated at a single commit point like every other `window_balance` row, and its "period" is the life of the company. It is stated separately because it is the only window whose balance is not reset by a boundary.

**Window ceilings are enforced per window *instance* (v1.3, TB-01, TB-02).** `window_balance` is keyed `(company_id, window_id, window_instance_key)` and carries **four** monetary terms — reserved, standing, presumed, realised — with the commitment guard over all four. `24 §3` K5 is the single authoritative schema; v1.2's printed three-term `CHECK` over a row with no standing column is corrected there and nowhere else declares it. **The irrecoverable ledger carries THREE terms — reserved, presumed, realised — and no standing term, and v1.3.5 declares its transitions in `24 §3` K5 and `25 §10.1`; `§2.3` declares what contributes a unit to it.**

**The two override windows exist at zero.** They are the SR-L4 mechanism. The schema always contains them; raising either is an explicit change to an authority quantity, which recomputes `MAL_total` and triggers `26 §10.3`'s re-signature. **An owner resolving stuck refunds cannot raise a loss ceiling by accident, because the liquidity action changes no ceiling and the ceiling action is a signed window change** (`§4.4`).

### 2.1 `ROLLING` windows: the method, and why none is declared

STD-01 found four rolling 24h windows and showed that `forward_exposure_to_window_end` is undefined against them: read as `[now−24h, now]` it is $0.00; read as `[now, now+24h]` there is never a boundary at which to re-reserve. `57`'s SR-S1 permits either redeclaring them or forbidding standing grants from referencing them.

**v1.2 redeclares all nine production windows as DISCRETE**, so no calendar-boundary algorithm is being silently reused for a rolling interval — no rolling interval remains.

The `ROLLING` method is nonetheless specified, once, so the type is not an empty option with hidden semantics:

> A `ROLLING(d)` window's balance at time `t` is the sum of contributions whose `effective_at` lies in `(t−d, t]`. Contributions age out continuously. There is no boundary, so `forward_exposure_to_window_end` is undefined and `standing.required` grants may not reference one (denied at catalogue validation, SR7's fail-closed applied to the new dimension).

**`ROLLING` is `NOT_ADMISSIBLE_AT_MVP`, and the reason is mechanical rather than stylistic.** `I3`'s enforcement is a `window_balance` row with a `CHECK` on the sum, taken `FOR UPDATE` inside the authorising transaction (`24 §3` K5, LIM-05). A continuously-ageing balance cannot be a single `CHECK`-constrained row at a single commit point; it requires an aggregate over a time-filtered set, which is write-skew-vulnerable below serialisable and is the exact defect `36 §2`'s mandatory negative control exists to catch. Admitting `ROLLING` would trade `I3`'s strongest available enforcement for a burst-shaping nicety.

**What is lost.** A calendar-day window resets at midnight, so an actor can take the day-`n` allowance late and the day-`n+1` allowance early — twice the daily count inside a few hours. **The MONTH window is what binds** (`§4.2`), so this shapes burst rate and does not raise the realisable total. Recorded as a stated consequence rather than discovered.

### 2.2 Per-class sub-ceilings inside the MIE windows

LIM-02's residual: `W_DAY_MIE` and `W_MONTH_MIE` are the only shared windows and their counts are heterogeneous — a $35 reship against a $0.50 email — so a shared count ceiling bounds actions and not money. `57`'s SR-L2 permits per-class sub-ceilings or a per-class split; **v1.2 declares sub-ceilings within the named window**, because splitting would multiply named windows without changing any bound.

| Window | `max_count` (aggregate) | `max_count_by_class` |
|---|---|---|
| `W_DAY_MIE` | 13 | `fulfilment.reship: 2` · `order.address.edit: 1` · `email.send (discretionary): 10` |
| `W_MONTH_MIE` | 43 | `fulfilment.reship: 2` · `order.address.edit: 1` · `email.send (discretionary): 40` |

The aggregate equals the sum of the sub-ceilings at Stage 2 (`2+1+10 = 13`, `2+1+40 = 43`). It is declared separately because it must bind independently once a fourth discretionary class is granted, and because a sub-ceiling table whose aggregate is implicit is the same defect as a window whose ceiling is implicit.

### 2.3 `irrecoverable_units` per action class (v1.3.5, MIE-01, S1J-C1)

`§2`'s MIE windows carry **both** a `max_count` and a `max_irrecoverable_units`, at the same figures. **Both bind, and they bind different quantities.** `max_count` — with `§2.2`'s per-class sub-ceilings — is the effect count every governed action moves. **`max_irrecoverable_units` is the ceiling `25 §10.1`'s irrecoverable-unit lifecycle runs against**, and it was the ceiling with no declared contributor: no artifact said what reserved a unit, or how many.

**`irrecoverable_units` is declared here, per action class, as part of the closed catalogue's execution metadata.**

| Action class | Recoverability | `irrecoverable_units` |
|---|---|---|
| `refund.create` | COMPENSABLE | **0** |
| `goodwill.credit.issue` | COMPENSABLE | **0** |
| `campaign.pause` | REVERSIBLE | **0** |
| `campaign.budget.set` | COMPENSABLE (rate) | **0** |
| `fulfilment.reship` | IRRECOVERABLE | **1** |
| `order.address.edit` | IRRECOVERABLE | **1** |
| `email.send` (discretionary) | IRRECOVERABLE | **1** |

**THE VALUE IS KERNEL- AND CATALOGUE-OWNED AND IS NEVER MODEL- OR CALLER-SUPPLIED.** It is a property of the action class in exactly the sense `26 §5`'s recoverability is — *"Assigned per action class in the catalogue, not per request, and never by a model."* **There is no generic caller parameter for it, and no request field carries one.** A REVERSIBLE or COMPENSABLE class declares `0` and therefore moves the irrecoverable ledger not at all.

**A future action class needing a value other than 1 must declare it here, and `NO IMPLICIT DEFAULT MAY WIDEN AUTHORITY.`** A class present in the catalogue with no declared value is a catalogue-validation failure, not a class with a value of one — the same fail-closed rule SR7 applies to every other undeclared catalogue dimension. **This table is part of control artifact class 17's signed content** (`50 §2`), because a unit count is an authority quantity: raising `fulfilment.reship` to 2 would halve the reships the MIE ceiling admits, and lowering `email.send` to 0 would remove the class from the ceiling entirely.

**Authority quantities are unchanged by this declaration.** At Stage 2 every IRRECOVERABLE class declares exactly `1`, which is the figure `§2.2`'s per-class count sub-ceilings and `§4`'s `MIE_cost` computation already assume — one authorised effect is one unit. **`MIE_cost(month)` p95, `MAL_monetary(month)` and `MAL_total(month)` are unmoved**, and `analysis/recompute-v1.3.py` reproduces line for line.

---

## 3. Stage-2 grant set

Anchored to `21 §9`: Stage 2 is the $5,000–$6,000 decisive test, so a total control failure should cost roughly a tenth of it rather than ending it.

### 3.1 Monetary grants (non-rate)

| Action class | `per_action_max` | `W_DAY` count | `W_MONTH` count | `value_direction` | Recoverability | `settlement_tolerance` |
|---|---|---|---|---|---|---|
| `refund.create` | **$25.00** | 2 | **10** | `INBOUND_ORIGINAL_INSTRUMENT` | COMPENSABLE | `EXACT` |
| `goodwill.credit.issue` | **$12.50** | 1 | **4** | `INTERNAL_LIABILITY` | COMPENSABLE | `EXACT` |

`per_action_max.monetary` is compared against **`exposure.total_exposure`**, not `exposure.vendor_amount` (SR-C1, `26 §8`). For a $25.00 line refund carrying a $1.03 retained processing fee, `total_exposure = $26.03` and the action **denies** `PER_ACTION`. The refundable amount the constructor may enumerate is therefore bounded by `per_action_max − Σ cost_components`, and the enumeration reflects that. This is a real behavioural change from v1.1 and it is the point of the field split: **the cap bounds economic loss, and economic loss includes the fee that does not come back.**

`goodwill.credit.issue` is additionally bounded by `W_LIABILITY_OUTSTANDING` at $200.00 outstanding (SR-R3's redemption bound). It carries no counterparty-novelty test because `INTERNAL_LIABILITY` has no external destination.

**Count discipline.** `26 §8`'s worked policies reference these windows **by name** — the same objects the MAL computation consumes and the same objects `I3` bounds. v1.0's private `count < 20` reconciled with nothing, which is how a $25 cap became $15,000/month.

### 3.2 Rate grants (standing)

| Action class | Rate ceiling | Period | Windows | `expires_at` | `revocation_effect_class` | Adapter |
|---|---|---|---|---|---|---|
| `campaign.budget.set` | **$6.00 / day** | day | `W_DAY_ADSPEND`, `W_MONTH_ADSPEND` | mandatory; grant expiry, with a `StandingRevocationAuthority` at `grant.expires_at + cessation_grace` | `campaign.pause` | `google_ads` |

**Forward exposure uses the exposure-remainder form** (`26 §10.1`), which is what closes STD-04, **scoped to a window instance** (v1.3, TB-02):

```
standing_cap(s, w)              = s.rate.amount × periods_basis(w, adapter)
periods_basis(W_DAY,   a)       = a.daily_overdelivery_multiplier
periods_basis(W_MONTH, a)       = max( days_in_window(w), a.monthly_basis_multiplier )
forward_exposure(s, i, t)       = 0                                        if i ∉ in_scope_instances(s)
                                = max( 0, standing_cap(s, w(i)) − realised_spend(s, i, t) )
```

`in_scope_instances(s)` and the `LIVE`-only boundary re-reservation rule are declared once in `24 §3.1`. **`campaign.budget.set` is a documented zero-monetary-reservation class**: `total_exposure = 0.00`, `vendor_amount = NULL`, and the whole economic quantity is `forward_integral` entering `I3` term 2 (`26 §2.1.3`, TB-03).

**Adapter characteristics, with provenance (registry rule 8).**

| Adapter | Parameter | Value | Provenance | Source |
|---|---|---|---|---|
| `google_ads` | `daily_overdelivery_multiplier` | **2.0** | `DOCUMENTED` | Google Ads average-daily-budget semantics: delivery may reach twice the average daily budget on an individual day |
| `google_ads` | `monthly_basis_multiplier` | **30.4** | `DOCUMENTED` | Google Ads monthly spending limit: average daily budget × 30.4 |
| `google_ads` | cessation specification | **UNDECLARED** | `UNMEASURED` · `IMPLEMENTATION_VALIDATION_REQUIRED` (`62 §10` obligation 9) | v1.2 carried a single scalar `cessation_lag`; `61 §B7` shows a scalar cannot express *"zero across an interval"* whose endpoints are vendor-defined. The four-field specification is **TB-07**, scheduled `S1 BEFORE IMPLEMENTING RELATED COMPONENT` — and `62 §9` prohibition 3 forbids attempting the measurement until it is declared |
| `google_ads` | `cessation_grace` | **72 h** | `CONFIGURED` | Chosen to exceed any plausible settlement latency; re-derived once the cessation specification is declared and measured. **Also the terminal bound on the in-scope interval** (`24 §3.1`) |
| `google_ads` | `I8_sweep_cadence` | **6 hours** | `CONFIGURED` (v1.3, TA-02) | Ads reporting is not final on retrieval; a cadence shorter than the reporting lag produces reads whose content cannot have changed. `30 §5.10` carries the reasoning |
| `google_ads` | `vendor_reporting_lag` | **UNMEASURED** | `UNMEASURED` · `IMPLEMENTATION_VALIDATION_REQUIRED` (`62 §10` obligation 8) | Interval between a vendor-side event occurring and its first appearance in the audit plane's read surface. **Distinct from the cessation specification**, measured on the same surfaces at S3 |
| `stripe` | `I8_sweep_cadence` | **1 hour** | `CONFIGURED` (v1.3, TA-02) | Balance transactions are queryable within seconds, so cadence is the whole bound; one hour aligns with `I17b`'s anchor interval |
| `stripe` | `vendor_reporting_lag` | **UNMEASURED** | `UNMEASURED` · `IMPLEMENTATION_VALIDATION_REQUIRED` | As above |
| `shopify` | `I8_sweep_cadence` | **1 hour** | `CONFIGURED` (v1.3, TA-02) | Order, refund and fulfilment mutations are immediately queryable |
| `shopify` | `vendor_reporting_lag` | **UNMEASURED** | `UNMEASURED` · `IMPLEMENTATION_VALIDATION_REQUIRED` | As above |
| ESP | `I8_sweep_cadence` | **1 hour** | `CONFIGURED` (v1.3, TA-02) | Feeds `I20`; a duplicate irrecoverable send is the fastest-moving irrecoverable class |
| ESP | `vendor_reporting_lag` | **UNMEASURED** | `UNMEASURED` · `IMPLEMENTATION_VALIDATION_REQUIRED` | As above |
| Any new adapter | `I8_sweep_cadence` | **1 hour** default | `CONFIGURED` | A longer value is an explicit signed act in this table |
| `meta_ads` | all of the above | **UNMEASURED** | `UNMEASURED` · `IMPLEMENTATION_VALIDATION_REQUIRED` | Meta's published budget documentation states no equivalent bound |

**`I8`'s omission-detection bound, with both operands named** (v1.3, TA-02):

```
I8_detection_bound(adapter) = I8_sweep_cadence(adapter) + vendor_reporting_lag(adapter)
                              CONFIGURED, above     +   UNMEASURED, S3
```

**This is not a number and no artifact may print it as one.** The configured operand is decided; the vendor operand is a measurement. Every site that previously read *"inverse-sweep cadence"* now reads the sum. The sweep's scheduling owner is the **audit plane** and the tag set is **additive, never scoping** — `30 §5.10`.

**Conservative defaults where a parameter is `UNMEASURED`, stated as behaviour rather than as intent:**

- **Cessation specification undeclared → no `REVOKED` transition exists.** `I54` cannot be satisfied, so forward exposure is **held to the close of the last in-scope window instance**, at which point it lapses with the instance (`24 §3.1`). No headroom returns early within a window. Ever.
- **`vendor_reporting_lag` unmeasured → `I8`'s detection bound has no numeric value**, so `30 §5.5` cases 2b and 4 have a *declared form* and an *unmeasured magnitude*. At S1 all four action classes run against mocks, so `I8` proves nothing at all and `37` S1 says so.
- **`daily_overdelivery_multiplier` or `monthly_basis_multiplier` unmeasured → the adapter is not autonomy-eligible for rate classes.** Meta is therefore excluded from `standing.required` grants at MVP.

**The commercial consequence, stated because it is commercial** (SR-S2's stated consequence, and `62 §11` condition 3's trigger):

> While the cessation specification is undeclared, **pause-and-reauthorise within one window is impossible.** Pausing a campaign does not return headroom; the headroom returns when the window **instance** closes, on a date V2 displays per authorisation. Pausing is also **one-way** — there is no `PAUSED → LIVE` transition — so a paused campaign is replaced, never resumed. Advertising at MVP is a whole-window commitment and a mid-month strategy change costs the remainder of the month's authorised exposure. **This is a real cost and it is not disguised.** If measurement returns a long settlement latency, that is a business-model finding about advertising under this architecture, not an engineering defect.

#### 3.2.1 The charge record: what each vendor read actually contains (v1.3, TB-05)

v1.2's `reconciler_match_rule` was a six-conjunct predicate over fields **no single declared source carries**, and the identifying conjunct — `charge.standing_authorization_id` — is carried by neither candidate source. The scoping was a self-assertion. Two charge record kinds are declared, per adapter, with absent fields marked absent rather than written into a predicate.

| Field | `ADS_DELIVERY_LINE` — Google Ads reporting, campaign × day | `BILLING_LINE` — processor card line / vendor invoice |
|---|---|---|
| Vendor resource identifier | `campaign.id` → `resource_ref` — **present** | **ABSENT** — one aggregate line per period |
| Account | `customer_id` — **present** | `merchant_identifier` — present |
| Event / delivery timestamp | `segments.date` — **present**, advertising-account timezone | **ABSENT** |
| Posting timestamp | **ABSENT** | posting date — present |
| Amount | `metrics.cost_micros` — **present** | present |
| Payment instrument | **ABSENT** | present |
| Invoice / billing identifier | **ABSENT** at campaign-day granularity; available only from the account-level `Invoice` resource | present |
| `standing_authorization_id` | **ABSENT — no vendor carries it** | **ABSENT** |
| Other vendor metadata | Campaign labels and tracking parameters exist but are **mutable and re-resolve historically**, so relabelling for a successor would retroactively re-attribute a predecessor's spend. **Not usable as an identifier** | — |

**Consequence, stated rather than worked around: `I22` operates on `ADS_DELIVERY_LINE` only.** The `BILLING_LINE` has no `resource_ref` and can never derive a `standing_authorization_id`; it is reconciled at the **account** level against `Σ ADS_DELIVERY_LINE` for the period by `I4`'s three-way settlement tie, not by `I22`. Writing a per-authorisation predicate over a field the card line does not contain is the defect, not the repair.

#### 3.2.2 Deriving `standing_authorization_id` (v1.3, TB-05)

**It is an ACOS derivation and it is declared as one.**

```
authoritative timestamp := c.segments.date          -- the DELIVERY date
    converted from the advertising account timezone to the company timezone by the
    declared rule, evaluated on the database clock.

derive_sa_id(c : ADS_DELIVERY_LINE) :=
  A := { s : s.adapter          = google_ads
           AND s.resource_ref   = campaign_ref(c.customer_id, c.campaign_id)
           AND delivery_date(c) ∈ [ s.created_at , s.expires_at + cessation_grace ) }

  |A| = 1  ->  that s
  |A| = 0  ->  UNATTRIBUTED. Unauthorised charge. I8 / I22 incident, security path.
  |A| > 1  ->  attribute to the EARLIEST s by created_at;
               mark charge.attribution = AMBIGUOUS;
               RETAIN exposure on EVERY candidate until reconciled;
               raise STANDING_ATTRIBUTION_AMBIGUOUS at CRITICAL.
```

**Delivery, not posting, and the reason is directional.** Delivery is the event the authorisation authorised; posting is a billing artefact whose timing the vendor controls. Keying on posting date — or on *"the authorisation live at posting time"* — attributes a predecessor's delayed January delivery to a February successor, which is STD-02's defect reached one layer down through the derivation rather than through the match rule.

**The ambiguity rule is directional and never favours the successor.** Where two non-`REVOKED` authorisations could match, the **earliest** wins, exposure is held on **both** until reconciled, and an incident is raised. Both legs are conservative: attributing to the predecessor is the safe direction, and double-holding over-reserves rather than under-reserves.

**The restated `reconciler_match_rule`**, with the absent conjuncts removed and recorded as removed:

```
matches(c, s) :=  c.kind = ADS_DELIVERY_LINE
              AND derive_sa_id(c) = s.id
              AND c.amount <= standing_cap(s, window_of(delivery_date(c)))
              AND window_instance_of(delivery_date(c)) ∈ in_scope_instances(s)

  REMOVED for this adapter, recorded rather than silently dropped:
    charge.payment_instrument  == s.payment_instrument    -- ABSENT from ADS_DELIVERY_LINE
    charge.merchant_identifier == s.merchant_identifier   -- ABSENT from ADS_DELIVERY_LINE
    charge.standing_authorization_id == s.id              -- ABSENT from every vendor read;
                                                          --   replaced by derive_sa_id
```

Removing the two absent conjuncts removes nothing that was ever evaluable. The identifying work moves from an unevaluable equality to a **declared derivation with a named timestamp and a directional tie-break**, which is checkable. A charge matching the descriptor but exceeding the amount bound is an **incident**, not a renewal.

**Fixture, extended and independently authored twice over** (`§5`, VC-S6): predecessor `s1` on campaign C, paused day 3; window boundary crossed; successor `s2` created in the new month; Google Ads posts delayed January delivery during February. Assert the delayed charge attributes to **`s1`**, raises `STANDING_SPEND_AFTER_EXPIRY`, and that `s2` **never** absorbs it. The crafted case must be authored independently of **both** the match rule **and** the derivation, with both authorships recorded — v1.2's fixture tested the rule against a wrong derivation and would have passed.

**`STANDING_HEADROOM_SHORT` fires at the first projected shortfall**, evaluated on every re-reservation, not at the boundary — so the owner sees it before the pause (SR-S4).

### 3.3 Discretionary irrecoverable classes

**Count is the gating control. Cost is disclosed as a p50/p95 band and enters `MAL_total` at the p95 basis** (ADR-017; band added per SR-C1's tolerance requirement and LIM-06).

| Class | `W_DAY_MIE` | `W_MONTH_MIE` | `unit_cost_p50` | `unit_cost_p95` | `settlement_tolerance` | p95 provenance |
|---|---|---|---|---|---|---|
| `fulfilment.reship` (discretionary) | 2 | **2** | $35.00 `[ESTIMATE]` | **$95.00** | `BAND(p95)` | `[ESTIMATE]` · `UNMEASURED` · `IMPLEMENTATION_VALIDATION_REQUIRED` — interim value adopted from `54 §3.2` construction 2, an international reship at COGS plus expedited freight |
| `order.address.edit` | 1 | **1** | $30.00 `[ESTIMATE]` | **$60.00** | `BAND(p95)` | `[ESTIMATE]` · `UNMEASURED` · `IMPLEMENTATION_VALIDATION_REQUIRED` — interim value is 2 × p50; **no measured distribution exists and none is claimed** |
| `email.send` (goodwill / discretionary) | 10 | **40** | $0.50 | $0.50 | `EXACT` | ESP unit price is contractual, not estimated |

**Why the band exists and what it costs.** LIM-06 constructed an international reship at $95 against a $35 estimate and showed `I18d` reporting a 170% divergence as a critical incident on a figure the architecture itself labels `[ESTIMATE]`. A boolean equality against an estimate either fires continuously or is widened until it detects nothing. The band is the mechanism; **the p95 is the basis `MAL_total` is displayed against and the figure the owner signs**, so the disclosed ceiling is the conservative one. Where no p95 has been measured, the interim value is what the owner signs and the class is autonomy-eligible only within it. `I12` forbids widening a band within 30 days of a discrepancy it would resolve, so a band cannot be tuned after the fact.

**Order-driven irrecoverable fulfilment and transactional order-state sends consume none of these counters** (`I30`). They are governed by `§3.4`.

### 3.4 Order-driven irrecoverable controls — declared (SR-L3)

v1.1 named three controls and valued none, in the class `33 §9` says dominates POD by volume. All are declared here.

| Control | Value | Kind | Notes |
|---|---|---|---|
| **Per-order fulfilment rate limit** | **1** | Hard, enforced at TX on a per-order counter | A second fulfilment of the same order requires **TIER_2** approval. A second *attempt* without approval is refused and counted. |
| **Template whitelist** | The enumerated transactional order-state template set | Control artifact (`50 §2` class 7) | Only whitelisted templates may be sent on the order-driven path; `I19` halts the class on a hash mismatch |
| **Fulfilment-to-settled-order ratio threshold** | **1.05** | `[ESTIMATE]` | Denominator is **processor-settled orders**, per `I27` |
| — its evaluation window | **trailing 7 calendar days, evaluated daily on the DB clock** | Metric window | **This is a metric window, not an exposure window.** `boundary_kind` does not apply to it and it is not a `window_balance` row. |
| — its minimum denominator | **20 settled orders** | `[ESTIMATE]` | Below this the ratio returns `INSUFFICIENT_DATA` |
| **Duplicate-fulfilment-attempt count** | **> 0 per day is an anomaly** | Hard, denominator-independent | The second anomaly trigger, which works at any volume |

**Two residuals, stated rather than resolved.**

1. **Below 20 settled orders the ratio control is inert**, and the per-order limit and the duplicate-attempt trigger are the only controls. At Stage-2 volumes this is the ordinary condition, not the exception. That is why the duplicate-attempt trigger exists: it is the control that works at n=1.
2. **`I57`'s integrity is inherited from `I27`**, which is R6 and out of the second review's scope (OOS-02). If R6's processor-settlement corroboration is not implemented as specified, this is a **loss channel** rather than a disclosure defect. `53 §7` OOS-02 says so and this document does not pretend otherwise.

**`unit_cost` for order-driven fulfilment is `NOT_DECLARABLE_UNTIL_BUSINESS_MODEL_SELECTED`.** Phase 1 deliberately left the model open and this document does not invent one. `OrderDriven_cost(w)` computes at runtime from actual fulfilment cost records; the fixture states the **magnitude** rather than a fabricated unit price (`§4.5`).

### 3.6 Degraded-mode override limits (v1.3, TA-05)

`DESIGN LIMIT — OWNER SIGNED.` **These are non-production MVP test-fixture values, not production policy.** The entity, its scope rule and its semantics are specified once in `30 §5.7.2`; enforcement is `I63`; it is control-artifact class 25 (`50 §2`).

| Quantity | Value | Kind |
|---|---|---|
| `max_override_duration` | **24 hours** | Per override, hard |
| `max_override_effect_count` | **5** | Per override, hard |
| `max_override_monetary_exposure` | **$50.00** | Per override, hard |
| `max_override_count` | **3** per rolling 30 days | Aggregate, hard |
| `max_cumulative_override_hours` | **72 hours** per rolling 30 days | Aggregate, hard |
| `max_cumulative_override_effects` | **8** per rolling 30 days | Aggregate, hard |
| `max_cumulative_override_monetary` | **$100.00** per rolling 30 days | Aggregate, hard |
| `second_approver_required_from` | the **2nd** override inside a rolling 30-day window | Aggregate, hard |
| Grantable `recoverability_classes` | `{ COMPENSABLE, REVERSIBLE }` | Structural — `IRRECOVERABLE` has no grant path |
| Grantable `precedence_rows` | `{ 3, 4 }` | Structural — rows 1 and 2 are unreachable by override |

**Why these values, and why they change no signed quantity.** Every monetary and count aggregate is **strictly below** the already-signed window ceiling it draws against: `$100.00` against `W_MONTH_REFUND`'s `$250.00`, and 8 effects against its count of 10. An override releases a **dispatch gate**, never an exposure gate — every effect dispatched under one still reserves and is still bound by `I3` — so **no override or sequence of overrides can raise realisable loss above the signed `MAL_total`, and `MAL_total` is therefore unchanged by this section. No re-signature is triggered by v1.3.** `§4` is unchanged and `analysis/recompute-v1.3-output.txt` reproduces every figure identically.

**Composition, calculated independently** (`phase2-v1.3-verification.md` V8). Three overrides is the count cap; 3 × 24 h = 72 h, exactly the hours cap; 3 × 5 = 15 effects, cut to **8** by the aggregate; 3 × $50.00 = $150.00, cut to **$100.00** by the aggregate. **The aggregate legs bind before the per-override legs on both consumable quantities**, which is the point: rotating action classes, expiring and recreating, and stacking outages all run into the same rolling-window ceiling, and `I63`'s aggregate leg is what makes A5's *"repeated bounded overrides compose into unbounded authority"* question answerable and answered **no**.

**The honest usability statement, because `62 §11` condition 10 requires the trade to be settled before S1 rather than during it.** At MVP exactly one OWNER-tier principal is registered, so overrides 2 and 3 are structurally unavailable and **the practically reachable escape is 24 hours, 5 effects and $50.00**. That covers a one-day audit-provider outage. It does not cover the eight-day outage `61 §A3` walks, which therefore ends in a statutory breach unless the owner **registers a second approver principal** first. That is an owner decision about how much availability to buy with a second human, not an engineering deadlock, and the registered-approver set is a control artifact so registering one is a signed act. **Recorded as TA-05's residual rather than resolved by widening the bound.**

### 3.7 The degraded-mode per-action approval floor (v1.3.3, S1H-C1)

`DESIGN LIMIT — OWNER DECISION.` **This is a non-production MVP test-fixture value, not production policy.** The mechanism that reads it is `30 §5.1` item 4 row 2, specified in `30 §5.1a`; it is a field of control-artifact **class 3** (`50 §2`), which already enumerates *"approval floor"*.

| Quantity | Value | Units | Boundary semantics | Kind |
|---|---|---|---|---|
| `degraded_per_action_approval_floor_monetary` | **USD 20.00** | single ledger currency, scale 2 (`§1`) | **strict**: `total_exposure > 20.00` is ABOVE. `$20.00` is not above; `$20.01` — one minor unit — is | Per action, degraded-mode dispatch precedence only |

| | |
|---|---|
| **Provenance** | **OWNER DECISION / v1.3.3.** Not `[ESTIMATE]`, not `IMPLEMENTATION_VALIDATION_REQUIRED`, not measured. It is a declared judgement, recorded as one |
| **Comparison operand** | `effect.request.exposure.total_exposure`. **Not** `exposure.vendor_amount`, not a dispatch amount, not a model-supplied amount, not a figure in a `rationale`, not grant prose. The same operand `§3.1` declares for `per_action_max`, for the same reason |
| **Affected mechanism** | `30 §5.1` item 4 row 2 — whether an above-floor, non-clock-bearing, unapproved effect halts while the mirror is unreachable. It is evaluated **inside** `30 §5.6`'s declared mirror state and applies in all three states |
| **What it is not** | Not `per_action_max`. Not a Cedar DENY ceiling. Not MAL or any MAL term. Not a window ceiling. Not a reservation amount. Not an override monetary cap. It denies nothing and reserves nothing |
| **Control artifact** | **Class 3** (`50 §2`), Owner + second factor. Declaring the value moves class 3's `content_hash` and a fresh signature is owed before deployment. **No production owner-signing mechanism and no runtime `I19` verification exist yet**, and nothing here claims otherwise |
| **Signed-quantity effect** | **None.** The floor gates dispatch, never exposure: an effect that passes row 2 still reserves and is still bound by `I3`. `MAL_monetary(month)` remains **$300.00**, `MAL_total(month)` at the signature basis remains **$756.00**, `§4` is unchanged and `analysis/recompute-v1.3-output.txt` is reproduced identically. **No re-signature of the MAL basis is triggered** |

**Why $20.00 and not $25.00.** At a floor equal to `refund.create`'s `$25.00` `per_action_max` the band in which row 2 is reachable would be **empty** — every effect above the floor would already have been denied `PER_ACTION` — and row 2 would be dead code for the whole S1 catalogue while appearing to be a live control. `$20.00` leaves the band `$20.01 … $25.00`, in which an admissible effect exists and requires the declared recorded-approval behaviour. `30 §5.1a` prints the band.

### 3.8 Degraded-mode timing thresholds (v1.3.3, S1H-C10)

`DESIGN LIMIT — OWNER DECISION.` **Non-production MVP test-fixture values.** The mechanisms that read them are `30 §5.1` item 5 and `30 §5.1a`. Both are control-artifact **class 27** (`50 §2`), added by v1.3.3.

| Quantity | Value | Notation | Boundary semantics | Kind |
|---|---|---|---|---|
| `mirror_lag_critical_threshold` | **15 minutes** | `PT15M` | **inclusive**: `mirror_lag >= PT15M` is at or over the threshold. `14:59.999999` under, `15:00.000000` at, `15:00.000001` over | Escalation / state input, per company |
| `audit_unreachable_full_halt_threshold` | **30 minutes** | `PT30M` | **inclusive**: `continuous_unreachability >= PT30M` enters the FULL-HALT POSTURE. `29:59.999999` outside, `30:00.000000` inside, `30:00.000001` inside | Dispatch posture, per company, hard |

| | |
|---|---|
| **Provenance** | **OWNER DECISION / v1.3.3**, both. `PT30M > PT15M` is required by `30 §5.1` item 5's *"a longer threshold"* and is asserted mechanically rather than assumed |
| **`mirror_lag` operand** | `now() − min(occurred_at)` over this company's `effect_journal` rows with `mirrored_at` null; **control database clock** (`36 §6`). `mirrored_at` is advisory (`30 §5.2`), so the operand is control-derived — admissible because the condition it raises is an escalation only |
| **`continuous_unreachability` operand** | `now() − opened_at` of the company's **open** `AUDIT_MIRROR_DEGRADED` declaration (`30 §5.7`), and `0` when none is open. At most one is open per company, so the interval is single-valued. **Timer starts on declaration open; resets only on declaration close.** Not reset by a state change between the two degraded states, by a signal arriving, expiring or being re-issued, or by a restart of either plane |
| **Affected mechanism — 15 minutes** | Raises `AUDIT_MIRROR_DEGRADED` at CRITICAL urgency, owner-visible immediately. It creates no state, fabricates no signal, grants no override and moves no monetary limit |
| **Affected mechanism — 30 minutes** | Reduces **every** `30 §5.1` item 4 disposition to Halt, including REVERSIBLE at row 5. The only escape is an in-scope `DegradedModeOverride`, which reaches **rows 3 and 4 only** (`30 §5.7.2`, `§3.6`) — so rows 1, 2 and 5 have no escape in the posture |
| **Relationship to attestation** | `attestation_cadence` = 5 minutes and `k` = 3 give an existing 15-minute attestation-silence bound (`30 §5.4`), and `mirror_lag_critical_threshold` is **aligned** with it deliberately. **The concepts are not merged.** Attestation staleness, mirror lag and audit-endpoint unreachability remain three distinct operands owned by different planes, and none of them is `§3.6`'s `max_age` |
| **Control artifact** | **Class 27** (`50 §2`), Owner + second factor. New in v1.3.3, so a first owner signature is owed before deployment. **No production owner-signing mechanism and no runtime `I19` verification exist yet** |
| **Signed-quantity effect** | **None.** Both thresholds only ever make dispatch **less** eligible. `MAL_monetary(month)` remains **$300.00** and `MAL_total(month)` at the signature basis remains **$756.00**; `§4` is unchanged and no re-signature of the MAL basis is triggered |

**A timer alone cannot relax anything.** Neither threshold is an operand of `30 §5.6`'s entry conditions. Entry into `CORROBORATED_DEGRADED` still requires a fresh, valid, audit-signed `MirrorInputStallSignal` and *"nothing else will do"* (`30 §5.7`).

### 3.5 Cost ceilings — not authorised loss

Shown separately and **never folded into `MAL_total`**, because a cost is not value moving to a counterparty (`26 §10.4` item 6). **v1.2 additionally displays their sum with `MAL_total`** as a realisable-cash line, because the owner's question is *how much can I lose*, not *did value reach a counterparty* (LIM-10).

| Ceiling | Value | Enforced at |
|---|---|---|
| Model spend, monthly | **$150.00** | The work queue, **below the provider tier cap** — hitting the provider cap returns 429 with no `retry-after` and pauses to month end (`08 §9`) |
| Model spend, per task | **$0.50** | Per-trajectory budget |
| Ungated agent actions, monthly (`W_MONTH_UNGATED`) | **200** | The EM9 governed quantity |

Reference: `10`'s AI-side estimate is $122/month, so $150 binds before the provider does.

---

## 4. The arithmetic, displayed and independently recomputed

Every figure below is reproduced by `analysis/recompute-v1.2.py`, an implementation written from `26 §10.1`'s formulae and this document's declared data. Its raw output is `analysis/recompute-v1.2-output.txt`. **The S1 `I7` oracle must be written independently again** — this one shares an author with the fixture and therefore proves internal consistency, not correctness (`36 §0`).

### 4.1 `MAL_total(month)`, by month length

```
MAL_monetary(month) = min( window.max_monetary, Σ_g min(window.max_monetary, per_action × count) )

  W_MONTH_REFUND    min($250.00, $25.00 × 10 = $250.00) = $250.00   cap == grant sum
  W_MONTH_CREDIT    min( $50.00, $12.50 ×  4 =  $50.00) =  $50.00   cap == grant sum
                                                subtotal = $300.00

Standing(month)     = Σ_s standing_cap(s, W_MONTH_ADSPEND)
  28-day month      $6.00 × max(28, 30.4) = $6.00 × 30.4          = $182.40
  29-day month      $6.00 × max(29, 30.4) = $6.00 × 30.4          = $182.40
  30-day month      $6.00 × max(30, 30.4) = $6.00 × 30.4          = $182.40
  31-day month      $6.00 × max(31, 30.4) = $6.00 × 31.0          = $186.00

MIE_cost(month)     p50                       p95            [ESTIMATE]
  fulfilment.reship        2 × $35.00 = $70.00      2 × $95.00 = $190.00
  order.address.edit       1 × $30.00 = $30.00      1 × $60.00 =  $60.00
  email.send (discr.)     40 ×  $0.50 = $20.00     40 ×  $0.50 =  $20.00
                              subtotal = $120.00      subtotal = $270.00

MAL_total(month)  =  MAL_monetary + Standing + MIE_cost
  28/29/30-day, p50   $300.00 + $182.40 + $120.00 = $602.40
  31-day,       p50   $300.00 + $186.00 + $120.00 = $606.00
  28/29/30-day, p95   $300.00 + $182.40 + $270.00 = $752.40
  31-day,       p95   $300.00 + $186.00 + $270.00 = $756.00
```

**`MAL_monetary(month) = $300.00` is the figure the owner signs.**
**`MAL_total(month) = $756.00`, at the p95 basis in a 31-day month, is the figure the owner should look at, and it is the declared signature basis** — the annual worst case, so a February does not silently change what was signed.

v1.1 printed `$600.00`. The $156.00 difference is entirely composed of quantities v1.1 excluded or mis-based: `$6.00` of month-basis error (STD-06), `$150.00` of MIE p95 band (LIM-06). **No ceiling was loosened; a ceiling was corrected upward because it had been understated.**

### 4.2 `MAL_total(day)`, and why thirty of them is not the monthly figure

```
MAL_monetary(day)
  W_DAY_REFUND      min($50.00, $25.00 × 2 = $50.00)  = $50.00
  W_DAY_CREDIT      min($12.50, $12.50 × 1 = $12.50)  = $12.50
                                          subtotal    = $62.50

Standing(day)       $6.00 × daily_overdelivery_multiplier 2.0     = $12.00

MIE_cost(day)       p50                        p95
  fulfilment.reship        2 × $35.00 = $70.00     2 × $95.00 = $190.00
  order.address.edit       1 × $30.00 = $30.00     1 × $60.00 =  $60.00
  email.send (discr.)     10 ×  $0.50 =  $5.00    10 ×  $0.50 =   $5.00
                              subtotal = $105.00     subtotal = $255.00

MAL_total(day) p50  = $62.50 + $12.00 + $105.00 = $179.50
MAL_total(day) p95  = $62.50 + $12.00 + $255.00 = $329.50
30 × MAL_total(day) p95                          = $9,885.00
MAL_total(month)    p95, 31-day                  =   $756.00
```

**$9,885 is not reachable, and the reason is stated rather than left as an inference.** Every reservation must satisfy **every** named window its grants reference. Brute-force enumeration over the grant set, honouring both horizons:

| Class | Day count | Month count | Realisable actions | Realisable value |
|---|---|---|---|---|
| `refund.create` | 2 | 10 | `min(10, 2 × 31) = 10` | $250.00 |
| `goodwill.credit.issue` | 1 | 4 | `min(4, 1 × 31) = 4` | $50.00 |
| `fulfilment.reship` (discr.) | 2 | 2 | `min(2, 2 × 31) = 2` | $190.00 p95 |
| `order.address.edit` | 1 | 1 | `min(1, 1 × 31) = 1` | $60.00 p95 |
| `email.send` (discr.) | 10 | 40 | `min(40, 10 × 31) = 40` | $20.00 |

**The MONTH window binds in every class**, exactly as `54 §2.2` verified for v1.1 and attack F-09 recorded as defeated. The DAY window shapes the burst rate within the month; it does not raise the total. And **the window ceilings now bind independently of the grant counts**, so the composition cannot silently exceed the displayed figure even if a second grant is added — which is what LIM-02 was about and what fixture F2 (`§7`) exercises.

### 4.3 The overdelivery case that pauses v1.1 and does not pause v1.2

STD-04's constructed attack, walked against the exposure-remainder form. January, 31 days, `W_MONTH_ADSPEND.max_monetary = $186.00`, `standing_cap(month) = $186.00`.

| Step | v1.1 (`rate × remaining_periods`) | v1.2 (exposure remainder) |
|---|---|---|
| Month start | reserve `30 × $6 = $180.00` | reserve `max(0, $186.00 − $0) = $186.00` |
| Day 1: platform delivers $12.00 (its own documented contract) | realised $12.00 | realised $12.00 |
| Day-2 re-reservation | `$12.00 + (29 × $6 = $174.00) = $186.00 > $180.00` → **no headroom → pause on day 2 of a 30-day consent** | forward becomes `max(0, $186.00 − $12.00) = $174.00`; `$12.00 + $174.00 = $186.00 ≤ $186.00` → **re-reserves; no pause** |
| Sustained delivery reaching $186.00 | — | forward → $0.00; `STANDING_HEADROOM_SHORT` fired at the **first projection**, before the boundary; then pause |

The exposure-remainder form works because the platform's own documented monthly cap **is** the total, so the correct forward quantity is the unrealised remainder rather than a per-period product. Front-loading does not create a shortfall; it consumes the same total earlier. The `2.0` daily multiplier bounds the DAY window, where front-loading is the whole question.

### 4.4 The headroom-laundering path, walked (SR-L4)

`52 §1` Path A, step by step, against v1.2. `I3`'s terms are shown after each step for `W_MONTH_REFUND`, ceiling $250.00.

| Step | v1.1 | v1.2 |
|---|---|---|
| 1. Adversary induces ten refund timeouts | open $250 · standing 0 · realised 0 | open $250 · standing 0 · **presumed 0** · realised 0 |
| 2. Reservations correctly held on `OUTCOME_UNKNOWN` | unchanged | unchanged |
| 3. `I32` fires `HEADROOM_STARVATION` | unchanged | unchanged |
| 4. Owner exercises the override | open **0** · realised **0** → **headroom returns** | reservations move to `PRESUMED_SETTLED`: open 0 · **presumed $250** · realised 0 → **headroom does not return** |
| 5. Ten further refunds proposed | authorise | **`DENY: WINDOW_EXHAUSTED`** |
| 6. Owner wants genuine additional headroom | no mechanism; ceiling silently raised by `k × $250` | must sign `W_MONTH_REFUND_OVERRIDE.max_monetary`, which **enters `MAL_total`** and triggers `26 §10.3`'s re-signature; the bundle **displays the `MAL_total` delta** |
| 7. Settlement resolves | — | `MATCHED` → presumed becomes realised · `FAILED` → presumed released · unresolved → **stays counted indefinitely** |

**The owner may resolve workflow blockage. The owner cannot raise the signed loss ceiling by accident, because the liquidity action changes no ceiling and the ceiling action is a signed window change with a displayed delta.** That is the SR-L4 requirement, mechanised.

### 4.5 The fifth displayed quantity, and the seventh exclusion (SR-L3)

```
OrderDriven_cost(w) = Σ order-driven fulfilments in w × unit_cost_p95(class)
```

Displayed **adjacent to `MAL_total` with its own utilisation and never folded in**, exactly as `§3.5` treats cost ceilings. It is COGS against revenue, not authorised loss — and it must be visible, because in the class `33 §9` says dominates POD by volume it is the largest number on the page.

**Magnitude, stated rather than omitted.** With `unit_cost` not declarable until a business model is selected, the honest statement is a bound rather than a figure:

- **Uncontrolled magnitude**, using only this fixture's own numbers as LIM-03 did: `W_MONTH_UNGATED` permits 200 ungated actions and the discretionary reship p95 is $95.00, so `200 × $95.00 = $19,000` — against a displayed `MAL_total(month)` of $756.00.
- **Controlled magnitude**: bounded by `settled_orders(w) × 1 × unit_cost`, because the per-order limit is 1 and every fulfilment requires a processor-settled order. Against real settled orders this is COGS on revenue-bearing work, not authorised loss.
- **The gap between the two is exactly the two abuse routes**: duplicate fulfilment, closed by the per-order limit and the duplicate-attempt trigger; and fabricated orders, closed by `I57`'s settlement-derived denominator — **which inherits its integrity from `I27`/R6** (OOS-02).

### 4.6 Realisable cash exposure (LIM-10)

```
Total realisable cash exposure = MAL_total(month) + cost ceilings
                               = $756.00 + $150.00 = $906.00
```

Displayed as a fourth line in V2, labelled with the counterparty distinction rather than omitting the sum. `26 §14` concedes a fully compromised model can consume the entire model budget; both statements were true in v1.1 and their composition was displayed nowhere.

### 4.7 Stage-1 grant set

Stage 1 is $1,000–$3,300 with no store, and **nothing at Stage 1 needs to spend.**

```
MAL_monetary(month)   refund $0 ungated at S1–S4 · credit not granted        =  $0.00
Standing(month)       no advertising grant at Stage 1                        =  $0.00
MIE_cost(month) p95   email.send internal address only, 20 × $0.50           = $10.00
MAL_total(month)                                                             = $10.00
```

The Stage-1 **owner-signed authorisation envelope** remains $250.00 — the maximum the owner is willing to sign for — while the **computed** `MAL_total` is $10.00. Displaying both is the honest presentation: if they diverge by a large factor, either the envelope is theatre or the grants are about to widen.

---

## 5. Verification

`36 §0`'s oracle requirement, applied here.

| Check | Oracle | Failure mode it catches |
|---|---|---|
| **I7** — displayed quantities equal the registry recomputation | **A second independent implementation** by brute-force enumeration over `§3` **and** fixture F2 (`§7`) | A displayed ceiling the grants exceed; a `min()` convention guessed alike by two authors; a fixture too degenerate to disagree about anything |
| **I3** — no window ceiling exceeded across four terms | The reservation ledger, with a **negative control at REPEATABLE READ that must fail**, plus a deadlock test against the journal counter under reversed acquisition order | Write skew on the sum guard; lock-order deadlock on the two hot rows |
| **I18a / I18b / I18c** — construction side | A hand-computed fixture table per class, **including one null-`vendor_amount` class and one with non-zero cost components**, authored from the processor's published fee schedule | A constructor that omits a cost component — a retained fee, freight, an FX spread |
| **I18d** — settlement side | The bank line, weeks later; at MVP a synthetic statement authored **from the fee schedule, never from ACOS's computed exposure** | A constructor and a fixture sharing an omission and agreeing with each other |
| **I22 / I23 / I54 / I62** — standing lifecycle | Inverse-sweep fixture: three legitimate renewals, one unauthorised charge, one renewal after `expires_at`, and **one crafted charge authored independently of *both* the match rule and the `standing_authorization_id` derivation, with both authorships recorded** (v1.3, TB-05). Plus every permitted transition in `24 §3.1` and representative forbidden ones, **including `REVOKED → EXPIRED`, which must fail** (v1.3, TB-06) | Both the false-positive flood and the crafted charge that matches; an illegal transition with no detector; a match rule tested against a wrong derivation |
| **I3 / window instance** — cross-boundary standing (v1.3, TB-02) | Pause mid-month, cross the boundary: assert the predecessor holds exposure to instance close, acquires **no** new-instance exposure, that the new instance's headroom is **full**, that a successor authorisation permits, and that a late predecessor charge attributes to the **predecessor** as an exception | Permanent window exhaustion; a successor silently absorbing a predecessor's spend |
| **I3 / first rate authorisation** (v1.3, TB-03) | A specification-level and runtime trace of the **first** `campaign.budget.set` in a clean 31-day window asserting **PERMIT** | Terms 1 and 2 describing the same money, denying the company's first advertising action |
| **I63** — override composition (v1.3, TA-05) | Repeated maximum-valid overrides across consecutive outages, rotating action classes and recreating after expiry, against an **independently calculated** aggregate | Bounded overrides composing into unbounded degraded-mode authority |
| **I17e adversarial-attester negative control** (v1.3, TA-01) | Truncate the push **and** adjust the attestation to match; assert `I17e` does **not** fire | A test certifying a property it does not exercise — `36 §0`'s own prohibition |
| **I51 / I60** — approval lifecycle | A top-up `UPDATE` against the DB trigger; two concurrent resumes against the partial unique index | The central R9 rule enforced by nothing (RES-04); two resumes racing past R′ (RES-09) |
| **I57** — order-driven ratio | Fabricated orders through a compromised commerce adapter, plus an `INSUFFICIENT_DATA` case below `min_denominator` | The only quantitative control on the largest irrecoverable population having no value |
| **T3 — realised authorised loss** | **The bank line, weeks later.** `Σ settled cost attributable to agent-authorised effects ≤ MAL_total(w)` | Everything above being internally consistent and economically wrong |

**The last row is the one that matters.** `Σ reserved ≤ ceiling` is a property of the reservation ledger. `Σ settled ≤ ceiling` is a property of the business, measurable only after money has moved (VAL-05, `58 §12` item 12). Until Stage 2, **every figure in this document is a designed bound and not a measured one**, and no amount of CI turns one into the other.

### 5.1 Declared settlement tolerances (SR-C1, CAN-08)

`I18d` requires a named tolerance per class. The registry's rule 5 makes an unstated one invalid, and `I12` forbids widening one within 30 days of a discrepancy it would resolve — so these are set **before** any settlement data exists, which is the correct direction and a real constraint.

| Action class | Tolerance | Basis |
|---|---|---|
| `refund.create` | `EXACT` | Settled cost is fully determined pre-dispatch: refund amount plus the processor's published retained fee. Single currency only. |
| `goodwill.credit.issue` | `EXACT` | Internal liability; no external settlement |
| `campaign.budget.set` | `BAND(standing_cap)` | Settled spend is bounded above by `standing_cap(s, w)`; any settled figure exceeding it is an `I22`/`I54` incident, not a tolerance question |
| `fulfilment.reship` | `BAND(p95)` | `[ESTIMATE]`-graded unit cost; band is `[p50, p95]` with p95 as the reserved basis |
| `order.address.edit` | `BAND(p95)` | As above |
| `email.send` | `EXACT` | Contractual ESP unit price |
| `fulfilment.order.create` | `BAND(p95)` | Order-driven; not in `MAL_total`, but `I18d` still applies to the effect |
| Any cross-currency class | **n/a — non-autonomous** | Settled cost is not computable pre-dispatch; a per-corridor spread allowance does not exist (CAN-06, `58 §11`) |

---

## 6. Seven things these ceilings do not bound

Displayed adjacent to `MAL_total` in the control centre, labelled as out of scope for it (`26 §10.4`). **Six in v1.1; seven in v1.2, and the addition is the one LIM-03 found in neither list.**

1. **Platform identity loss.** Google's Misrepresentation and Circumventing-systems policies both carry suspension *"upon detection and without prior warning"* with no route back. No spend cap touches it — and ACOS **cannot be made incapable of raising the platform cap that would otherwise contain the spend**, because one `adwords` scope covers reads, campaign budgets and account budget proposals (`29 §3.3`).
2. **Utterance liability.** Bounded structurally by `26 §9`, not numerically.
3. **IP asset freeze**, modelled as a working-capital event in the runway projection.
4. **Reputational and account-quality effects** of irrecoverable communications. Gmail bulk-sender status has **no expiration**.
5. **The residual under a compromised Trusted Computing Base member** (`49`). **This is the largest of the seven.** `MAL_total` bounds a compromised model; it bounds nothing about a compromised adapter, control plane, CI pipeline or database operator.
6. **Model and infrastructure spend**, a cost ceiling rather than authorised loss (`§3.5`) — now displayed in the realisable-cash line (`§4.6`).
7. **Order-driven irrecoverable fulfilment cost** (v1.2, SR-L3). Magnitude in `§4.5`: uncontrolled order of magnitude $19,000/month against a displayed $756.00; controlled to `settled_orders × unit_cost` by the three controls in `§3.4`, **one of which inherits its integrity from R6**.

**And one exposure that is not a ceiling at all, recorded because P4a named it and no class governs it** (LIM-08): **chargeback loss.** It is provider-initiated so no ACOS effect exists, nothing reserves and nothing counts — and it is nevertheless agent-influenceable through delayed fulfilment, a wrong T-U0 statement or a denied refund. Representment is categorically prohibited (`26 §6`) so ACOS cannot contest. **Visa VAMP's non-compliant threshold is a 0.5% ratio and a count of 5**, so at Stage-2 volume a handful of agent-caused disputes is an account-level event. Chargeback acceptance has been **removed from P4a's enumeration** because naming an ungoverned outcome inside a symbolic property is the defect `47` catalogued.

**A number that silently excludes the largest tail risks is worse than no number.** v1.0 displayed one quantity and named four exclusions. v1.1 displayed four and named six. v1.2 displays **six** — `MAL_monetary`, `MIE_cost` (banded), `Standing`, `MAL_total`, `OrderDriven_cost`, realisable cash — and names **seven** exclusions plus one uncounted exposure.

---

## 7. Fixture F2 — the non-degenerate composition fixture

LIM-07: v1.1's fixture could not exercise grant composition, window sharing, standing multiplicity or a binding window cap, because six of nine windows had exactly one referencing grant and no window carried a ceiling. **A differential oracle with nothing to disagree about proves nothing.** F2 exists to be disagreed about. It is a test fixture, not a grant set: **no principal is ever bound to it.**

### 7.1 F2 windows

| Window id | `boundary_kind` | Period | `max_monetary` | `max_count` |
|---|---|---|---|---|
| `F2_W_MONTH_SHARED` | DISCRETE | calendar month | **$300.00** | 30 |
| `F2_W_DAY_SHARED` | DISCRETE | calendar day | $60.00 | 4 |
| `F2_W_MONTH_ADS_SHARED` | DISCRETE | calendar month | **$400.00** | UNBOUNDED |
| `F2_W_MONTH_UNBOUNDED` | DISCRETE | calendar month | **UNBOUNDED** | 12 |

### 7.2 F2 grants

| # | Action class | `per_action_max` | Windows and counts | Grant-derived term (month) |
|---|---|---|---|---|
| G1 | `refund.create` | $25.00 | `F2_W_MONTH_SHARED: 10`, `F2_W_DAY_SHARED: 2` | $250.00 |
| G1b | `refund.create` | $25.00 | `F2_W_MONTH_SHARED: 4`, `F2_W_DAY_SHARED: 2` | $100.00 |
| G2 | `goodwill.credit.issue` | $20.00 | `F2_W_MONTH_SHARED: 8` | $160.00 |
| G3 | `entitlement.issue` | $15.00 | `F2_W_MONTH_UNBOUNDED: 12` | $180.00 |
| S1 | `campaign.budget.set` (rate) | $6.00/day | `F2_W_MONTH_ADS_SHARED` | standing |
| S2 | `campaign.budget.set` (rate) | $5.00/day | `F2_W_MONTH_ADS_SHARED` | standing |

### 7.3 What F2 exercises, and the recomputed answers

| `46 R8` / LIM-07 interaction | Present in F2? | Result |
|---|---|---|
| Two grants of the **same class** on one window (STD-07) | Yes — G1 and G1b | Sum $350.00 against a $300.00 cap |
| Two grants of **different classes** on one window | Yes — G1/G1b and G2 | Sum $510.00 against a $300.00 cap |
| A window monetary cap **binding below** `per_action × count` | Yes — `F2_W_MONTH_SHARED` | **`MAL_monetary = min($300.00, $510.00) = $300.00`. The cap binds.** |
| A window where the **grant sum binds** instead | Yes — `F2_W_MONTH_UNBOUNDED` | `min(UNBOUNDED, $180.00) = $180.00`. `min(UNBOUNDED, x) = x` exercised. |
| **Two live standing authorisations** on one window | Yes — S1 and S2 | 31-day: `$186.00 + $155.00 = $341.00` ≤ $400.00 · 28/29/30-day: `$182.40 + $152.00 = $334.40` |
| 28-, 29-, 30- and 31-day months | Yes | `MAL_monetary` $480.00 in all; `Standing` $334.40 / $334.40 / $334.40 / $341.00 |

```
F2 MAL_monetary(month) = $300.00 (F2_W_MONTH_SHARED, cap binds)
                       + $180.00 (F2_W_MONTH_UNBOUNDED, grant sum binds)
                       = $480.00

F2 Standing(month)       28/29/30-day = $334.40   ·   31-day = $341.00
F2 MAL_total(excl. MIE)  28/29/30-day = $814.40   ·   31-day = $821.00
```

**Every composition here is non-vacuous.** The `min` is exercised in both directions in the same fixture; the shared window is contended by three grants across two classes; standing multiplicity is a sum of two terms rather than one; and the month basis changes the answer. Each of these is a construction v1.0 actually contained and v1.1's fixture could not represent.

### 7.4 The behavioural assertion F2 exists for

Beyond arithmetic agreement, F2 carries one runtime assertion that distinguishes LIM-02's two repairs:

> Under G1, G1b and G2 against `F2_W_MONTH_SHARED`, issue refunds and credits until the window's $300.00 monetary ceiling is reached. **Assert that the next authorisation denies `WINDOW_EXHAUSTED` before any individual grant's own count is reached**, and assert that `MAL_monetary` displays $300.00 — the window cap — rather than $510.00, the grant sum.

If the implementation instead computes the ceiling as the sum over referencing grants, this test fails, `I3` is vacuous and named windows deliver nothing over v1.0's private per-grant windows. That is the failure LIM-02 said the v1.1 fixture could not detect.
