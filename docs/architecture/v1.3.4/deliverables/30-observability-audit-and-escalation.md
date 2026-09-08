# 30 — Observability, Audit and Escalation

**ACOS Operating Spine v1.3. Version 1.3. Issued 2026-09-03. Supersedes v1.1 (2026-09-02).**
Covers Phase 2 brief Parts 17, 18 and 19. Depends on `22`–`29`.

## v1.3.3 change record (package issue v1.3.3)

New `§5.1a` declares the three quantities `§5.1` needed and did not have — `degraded_per_action_approval_floor_monetary` ($20.00, operand `total_exposure`), `mirror_lag_critical_threshold` (15 minutes) and `audit_unreachable_full_halt_threshold` (30 minutes) — together with their boundary semantics, the FULL-HALT POSTURE and its override composition (S1H-C1, S1H-C10). New `§5.7.1a` declares the closed audit-owned derivation of `STORE_WRITE_REJECTED` and the semantic class `AUDIT_STORE_WRITE_UNAVAILABLE`, with quota saturation and every security or integrity failure excluded normatively (S1H-C8). `§5.1` item 4 row 2 and item 5 now name their operands; `§5.6`'s reachability table gains two rows. **No mechanism was introduced, no ceiling moved, MAL is unchanged, no Step ordering changed and no audit cadence changed.** Full record in `phase2-v1.3.3-errata.md`.

## v1.3 change record

§5.4's claim corrected and §5.5 split into seven cases (TA-01); §5.6 gains `I17f(c)` and the corroborated-state reachability table (TA-04, TA-06); new §5.7.1 the `MirrorInputStallSignal` contract (TA-06); new §5.7.2 `DegradedModeOverride` (TA-05); new §5.10 `I8`'s cadence, additive scope and detection bound (TA-02, TA-03); V2 and V7 display rules added. Full disposition in `phase2-v1.3-remediation-ledger.md`.

## v1.2 change record

| Change | Finding | Section |
|---|---|---|
| **I17 restated as *transport* completeness.** The unqualified two-sided claim was not checkable by a store that only sees what it is sent; it moves to **I8**, which is evaluated from the audit plane's own vendor reads. | SR-A1 | §5, **new §5.4** |
| **`JournalAttestation` added** — a positive 5-minute liveness signal, itself a journal row, with k=3 before `ATTESTATION_STALL`. Silence and idleness become distinguishable within 15 minutes rather than one hour. New **I17e**. | SR-A1 | **new §5.4**, **new §5.5** |
| **Degraded mode replaced by a three-state machine** in which the uncorroborated state is **stricter** than normal operation. Self-declared degradation is now self-harming. New **I17f** (two-sided). | SR-A2 | **new §5.6**, **new §5.7** |
| **§5.1's five-row halt table replaced by a single ordered first-match precedence list**, because two rows matched simultaneously for the largest refund class and the table declared no precedence. | SR-A6 | §5.1 |
| **`journal_seq` allocation and lock order specified.** A `journal_counter(company_id, next_seq)` row, taken **after** the window-balance rows in ascending `window_id`. `journal_seq` is **not** an idempotency-key input. | SR-A4 | **new §5.2** |
| **Re-push is idempotent.** `UNIQUE(company_id, journal_seq)` with `ON CONFLICT DO NOTHING`; same hash is INFO, different hash is CRITICAL; `row_count` counts distinct sequences. | SR-A5 | **new §5.2** |
| **`ACOS-JCS-1` canonical serialisation specified.** The transmitted bytes are what is hashed. Without it the two independently-computed chains diverge on decimal scale, timestamp precision, null encoding and Unicode form. | SR-A3 | **new §5.3** |
| **V2 displays six quantities**, not four, plus realisable cash exposure and seven exclusions. **V7 displays both mirror-state declarations side by side.** | SR-L3, SR-L4, SR-A2 | §3 |
| **§10's approval bundle must display the `MAL_total` delta**, which the override path bypassed. | SR-L4 | §10 |
| **`clock.source_record_ref`** contract, because the statutory clock is a lever on the dispatch precedence. | SR-A2 | **new §9.1** |

## v1.1 change record

| Change | Remediation | Section |
|---|---|---|
| **§5 rewritten.** The audit store becomes a **replicating verifier**; the primary journal moves to the control database with a gap-free `journal_seq` and a locally computed chain; halt applies **by recoverability class**; degradation to blanket `REQUIRE_APPROVAL` is removed. The audit plane gains its own read endpoint and its own read-only vendor credentials. | R3, R10 | §5 |
| **§6.1 is no longer the definition of the invariant set.** The invariant registry is authoritative — `phase2-v1.1-invariant-registry.md` at the time of this v1.1 change, `phase2-v1.3-invariant-registry.md` now. This section lists the audit-plane-owned subset and points at the registry. I7, I8 and I15 are amended; I12 is confirmed as the tolerance-rule check. | R3, R5, R8, R10, R20 | §6.1 |
| V2 displays four exposure quantities, not one. | R8 | §3 |
| V7 is served from the audit plane's own endpoint, not through a control-plane surface. | R3 | §3, §5 |
| Metric computation specs, tolerance rules and the adverse-facts threshold set are control artifacts under B9. | R11 | §4 |
| Escalation gains **per-cause per-window caps** on mandatory classes, because the manufacturable escalation classes were the ones exempt from the discretionary budget. | R16 | §11 |
| The approval bundle gains an audit-plane "uncited and contradicting evidence" section, and the AI-drafted recommendation moves below it. | R16 | §10 |


---

## 1. The seven questions

Constitution §21 and the Phase 2 brief converge on the same set. Each maps to a materialised structure, not to a screen.

| Question | Answered by | Structure |
|---|---|---|
| What is happening? | Work in flight, open escalations, active experiments, exposure utilisation | K7, K10, K13, K5 |
| Why? | The causal chain (§2) | K9 → K7 → K8 |
| Who or what decided it? | Principal on the authorisation decision, plus delegation chain | K3, K2 |
| What evidence supported it? | Frozen evidence set on the decision | K8, K9 |
| What did it cost? | Effect exposure, model cost attribution, realised financial events | K5, K6, K12 |
| What authority was used? | Grant reference, policy version, matched rules, gate class | K3 |
| What happened afterward? | Verification status, reconciliation, measured outcome against the decision's expected effect | K4, K6, K12 |

**"Do not design detailed UI screens yet"** — so what follows is information architecture and required views.

---

## 2. The causal chain

The single most important queryable structure. Every consequential thing that happened must be traversable in both directions, with no gaps and no inference.

```
Source
  → EvidenceItem (url, fetch_at, content_hash, access_status, tier)
    → Claim (extracted_by, quote_span)
      → EvidenceSet (frozen_hash)
        → Decision (alternatives, rationale, reconsideration_trigger)
          → Task (contract version, budget, principal, model_binding)
            → EffectProposal (proposal_hash, context_digest)
              → AuthorizationDecision (verdict, policy_version, matched_rules,
                                       evaluated_facts, grant_ref, gate_class)
                → Reservation (window, amount, irrecoverable_units)
                → Approval? (approver, timestamp, approved_hash)
                  → Effect (idempotency_key, adapter, request/response hashes)
                    → Verification (external read-back)
                    → Compensation?
                      → FinancialEvent(s)
                        → MetricSeries
                          → Outcome vs the decision's expected effect
```

**The chain is materialised, not reconstructed by joins at query time.** Each link is a foreign key written at the moment the link is created. A gap in the chain is itself an audit finding — an effect with no authorisation, a decision with no evidence set, an authorisation with no policy version — and the invariant checks in §7 look for exactly those gaps.

**Retention is ACOS's own.** `08 §10`: Inngest 24h–90d, Cloudflare 3–30d, Trigger.dev 7–30d, Braintrust 14–30d, Arize AX 15–30d, Langfuse 30d Hobby / 90d Core. *"A business that must reconstruct why it refunded a customer in March, in September, cannot do it from any of these."* The chain lives in ACOS's own append-only store, and vendor tracing is a secondary, replaceable view (SR9).

---

## 3. Required views

Nine. Each is a read model over kernel state; none introduces a new source of truth.

### V1 — Financial position
Cash by location (bank vs **platform-held, shown separately**), runway under the three registered scenarios, contribution margin before and after marketing (the latter labelled), open discrepancies with ages, reconciliation status per payout, burn decomposition split into cadence cost and per-event cost (`09 §12`).

### V2 — Exposure and authority

**Six exposure quantities per named window** (v1.2, `26 §10.1`): `MAL_monetary` (the signed figure), `MIE_cost` (labelled ESTIMATE, **displayed at both p50 and p95**, with `MAL_total` composed from p95), `Standing` (forward exposure over every **non-`REVOKED`** authorisation), **`OrderDriven_cost`** (v1.2 — displayed, never folded into `MAL_total`, because `I30` keeps it out of the discretionary ledger and v1.1 kept it out of the display too, which made an order-of-magnitude-larger channel invisible), `MAL_total`, and **realisable cash exposure** = `MAL_total + cost ceilings`. Each with utilisation. **`MAL_total` at the p95 basis in a 31-day month is labelled the signature basis**, so a February does not silently change what the owner signed. Each window shows its **`boundary_kind`** and all three declared ceilings, with `UNBOUNDED` rendered as the word, never as a blank. **Live `StandingAuthorization` records with their rates, periods and `expires_at`** — because duration is the dimension v1.0 could not display at all. **`MIE_discretionary` per channel with utilisation, shown separately from order-driven fulfilment counts** (I30). **Ungated agent actions this month against ceiling, segmented by recoverability class** — the EM9 governed quantity, and the headline governance number. Grant inventory with expiry dates and the named windows each references. Autonomy ledger with levels, pending promotions, recent demotions. Denial-rate trend by principal and reason. **Owner-attention window utilisation** (I39, when built).

**The seven things `MAL_total` does not bound are displayed adjacent to it** (v1.2, `26 §10.4`): platform identity loss, utterance liability, IP asset freeze as a working-capital event, reputational effects of irrecoverable communications, **the residual under a compromised Trusted Computing Base member**, model and infrastructure spend (a cost ceiling rather than authorised loss — now also summed into the realisable-cash line, because the owner's question is *how much can I lose*), and **order-driven irrecoverable fulfilment cost** (v1.2, SR-L3), whose integrity depends on `I27`'s processor-settlement corroboration and therefore on R6. **Chargeback loss is displayed as an ungoverned exposure with no ceiling at all** (LIM-08), against the VAMP count of 5. A ceiling that silently excludes the largest tails is worse than no ceiling.

**Live `StandingAuthorization` records show status across all five states, `cessation_verified_at`, and the fact that pausing does not return headroom** (`26 §10.5`). The owner should not discover that from a denied re-authorisation. **v1.3 (TB-02, TB-10): each non-`REVOKED` authorisation additionally displays the `window_instance_key` of the last instance in which its forward exposure is in scope and the calendar date on which that exposure lapses**, so the owner sees *when* headroom returns and not only that it has not returned now.

**Degraded-mode overrides** (v1.3, TA-05). Any `ACTIVE` `DegradedModeOverride` is displayed with its affected effect classes, `expires_at`, `effects_dispatched / effect_count_cap`, `monetary_dispatched / monetary_exposure_cap`, and — per affected statutory clock — **elapsed clock time and time remaining**. Rolling 30-day consumption against every `I63` aggregate limit is shown alongside, so the owner sees composition rather than one grant at a time.

### V3 — Work and decisions
Work in flight by state; recent decisions with evidence coverage and corroboration state; dissent records; abandoned and dead-lettered work with reasons; the causal chain, traversable from any node.

### V4 — Approvals and escalations
The owner's actual inbox. Sorted by SLA urgency, not by arrival. Each item carries the decision-ready bundle (§9). **Approval dwell time and approval-without-inspection rate are shown** — because a rubber-stamping owner is a governance failure and the system should say so.

### V5 — Experiments
Active experiments with frozen criteria, current readings against them, budget consumed, boundary remaining, stopping conditions. Amendment history with dates and whether the amendment post-dated data. Completed experiments with verdicts and the decisions they informed.

### V6 — Incidents
Open incidents by severity and age; recurrence patterns; effects in non-terminal states past SLA; unresolved discrepancies; platform notices.

### V7 — Audit findings

**Served from the audit plane's own read endpoint on its own host** (v1.1, R3, AUDA-08). v1.0 served this view through the owner interface, which is a control-plane surface — so a compromised control plane could filter what the owner saw, **including the adverse-facts appendix**. `33 §3.1`'s diagram drew `K11 → OWNER` directly, which is the correct shape and was not what `33 §2.5` specified. The owner client fetches the briefing from the control plane and the appendix and findings from the audit plane, and **diffs them client-side**.

Open findings by severity and age; **unacknowledged findings prominently**, because they auto-append to the briefing; counter-metric divergence; invariant-check status **including the I17 transport-completeness diff, the I17e attestation-completeness check and the I17b anchor chain**; unjournaled external effects found by the inverse sweep (I8); CEO performance scores (`27 §6`).

**v1.2: the mirror state is displayed twice, side by side** (SR-A2) — the control plane's **declared** state and the audit plane's **own observed** state, from its own signals. `I17f` fires on divergence in either direction, and the owner sees the disagreement rather than a reconciled single value. A single reconciled figure is exactly what a compromised control plane would want displayed. `§5.7` gives the actor/signal table.

**v1.3: the degradation rule for this view is declared** (`61 §J1`). V7 is served from the audit plane, so during an audit-plane outage the audit-side column cannot be fetched. **An unavailable audit-side value renders as `UNAVAILABLE`, never as blank and never as matching the control-plane value.** A blank that reads as agreement is exactly the display a compromised control plane able to induce an audit-plane outage would want. The owner client asserts this rendering; it is part of `36 §13`'s V7 test.

### V8 — Cost
Model cost by function and by cadence-vs-event; tool and search cost; SaaS subscriptions reconciled against card lines; **cost per decision**; cost per resolved contact. `09 §12` frames the priority: at 2,500 orders each percentage point of escalation rate is worth ~$50/month while each point of token efficiency is worth ~$2 — **a 25:1 ratio**. The view puts escalation rate above token efficiency for that reason.

### V9 — CEO briefing
The narrative layer, with the adverse-facts appendix appended by the audit plane (`27 §5`), and every numeral resolving to a metric reference.

---

## 4. Metric discipline

| Rule | Reason |
|---|---|
| Every metric has a **named computation spec with a version**, and **the spec is a control artifact under B9** with a hash in the owner-signed manifest (I19) | Reproducibility; a metric that changes definition silently is a lie about a trend. **v1.1: v1.0 required the version and left the spec itself outside B9's enumeration**, so a spec edit could change a gating OBSERVATION with no invariant noticing (REC-05) |
| **Tolerance rules and the adverse-facts threshold set are control artifacts** (v1.1) | A tolerance rule's modification silently disables the terminal financial control (`28 §4`); an adverse-facts threshold's modification changes what counts as bad news, which is a more durable capability than spinning a fact (I38) |
| Every metric has an **input lineage** to RECORD-grade facts | EM7 |
| **Metrics are never model-produced** | EM7 |
| Missing inputs → `INCOMPLETE`, **never interpolated** | Constitution §6 |
| Every agent KPI has a **counter-metric** computed by the audit plane from independent inputs | EM16; `06 §2.7` |
| Vanity metrics are **not displayed by default** | Constitution §17: traffic, impressions, followers, product count, AI tasks completed, content output, gross revenue alone. They may be recorded; they do not lead. |

**One display convention matters enough to be a rule.** Grade is shown on every figure. A CLAIM-grade attributed ROAS and an OBSERVATION-grade incremental CAC must not look alike on a screen. `28 §8` suppresses platform ROAS entirely during an active incrementality measurement; outside one, it is visibly labelled.

---

# Part II — Audit architecture

## 5. Structural independence

`10 §2.4` states the disqualifying criterion plainly: *"Do not adopt Braintrust or any closed-core platform as the audit system of record — the auditor must not be suppressible."*

| Property | Implementation |
|---|---|
| Separate store | Distinct database instance on a **different provider or, at minimum, a separate account with a separate payment method and separate operator credentials** (v1.1, TEC-04). v1.0 put both instances on managed Postgres with no separation requirement, so **one cloud operator saw both sides of the separation EM16 depends on**. |
| Append-only | Enforced at the database layer: the control plane holds `INSERT` and nothing else, under a **per-principal insert quota** (I17c). |
| Independent writer | The audit writer identity is not reachable from any operating principal (B5). |
| **Hash and sequence writer** (v1.1) | Computed by **database functions inside each instance, under roles the writing principal cannot execute as** (I17d). v1.0 never said who computed `prev_hash`, `row_hash` and `chain_seq`; if the writer computes them, a compromised control plane constructs a consistent-but-false chain and tamper-evidence is theatre (AUDA-06). |
| **External anchoring** (v1.1) | `{head_hash, chain_seq, row_count}` anchored **hourly** to a medium the operator cannot rewrite, with a copy delivered to the owner (I17b). v1.0 said "periodic" and "on a schedule" with no value, leaving the **maximum undetectable rewrite window undefined**; it is now one hour, stated. `row_count` is included because **head-only anchoring cannot detect truncation of the tail**. |
| **Transport completeness** (v1.2, restated) | The two-sided control↔audit diff over a gap-free per-company `journal_seq` (I17): **every row the control plane produced and attested is present in the mirror, and no row is present that the control plane did not produce.** A hash chain proves order and non-alteration of rows *present*; **it proves nothing about rows omitted** (AUDA-03). v1.1 stated I17 unqualified — *"every authorisation and effect appears in both"* — which **the audit plane cannot check**, because it only ever sees what it is sent and a control plane that stops pushing produces a perfectly gap-free mirror (AUD-01). The unqualified claim now lives on **I8**, evaluated from the audit plane's own vendor reads, which is the only place it is checkable. |
| **Attestation completeness** (v1.2, new) | For every `JournalAttestation` received, every `journal_seq ≤ max_journal_seq` is present and the independently recomputed `head_hash` matches (I17e). §5.4. |
| **Two-sided state agreement** (v1.2, new) | The control plane's declared mirror state and the audit plane's own observation agree; divergence **in either direction** is an incident (I17f). §5.6. |
| **Independent inputs** (v1.1; bounded v1.3, TA-02) | The audit plane holds **its own read-only vendor credentials** — commerce, processor, bank line, ESP, each advertising platform — and runs the inverse sweep and the settlement equality check itself (I8, I4, I20, I33), at the per-adapter cadence declared in `§5.10` and under the audit plane's own scheduler. v1.0 gave it a replica of the database the control plane writes and credentials to its own store, and claimed *"counter-metrics are recomputed from source facts."* The source facts were rows the audited component wrote. **That is arithmetic independence, not evidential independence.** |
| **Own read path** (v1.1) | Its own read endpoint on its own host. The owner client diffs briefing against appendix client-side (AUDA-08). |
| Non-suppressible findings | Mandatory acknowledgement workflow; the CEO cannot close a finding; unacknowledged findings auto-append to the briefing, and no briefing publishes without a hash-matching appendix (I45). |
| Independent reasoning | The audit reviewer uses a **separate model binding** from every operating role, and holds no `propose_intent` capability at all. |

### 5.1 Journal ordering and the dispatch precedence rule (v1.1 R3; ordering corrected v1.2, SR-A6)

**What v1.0 specified, and why it was replaced.** This section and `24 §3` K11 specified *continue with `AUDIT_PENDING` and drain a durable local buffer, degrading to `REQUIRE_APPROVAL` past a threshold*. `36 §6` specified **halt**, and explicitly named local buffering as the wrong answer. `38 §9.11` asked the reviewer a question that presupposed halt. The internal quality gate certified the audit-suppression property by citing `36 §6` alone. **Two mutually exclusive behaviours for one condition, in documents of equal standing, with no supersession note** (AUDA-01) — a developer would have implemented one arbitrarily.

And neither behaviour was correct.

- **Buffer-and-continue** opens a window in which effects occur unaudited, which is what EM16 forbids. Worse, its degradation to blanket `REQUIRE_APPROVAL` was a **model-reachable approval-flood lever**: the control plane holds `INSERT` with no quota, so filling the audit store converted the whole system into an approval queue (AUDA-05, APP-08).
- **Halt** does not close the window; it moves it. Halting *effects* does not halt authorisations, reservations, reservation expiries, state facts, escalations or statutory-clock evaluation — all of which are control-plane writes generating audit rows. After recovery the control database contains rows the audit database never saw, and **that divergence is indistinguishable from suppression** (AUDA-02). Halt also makes the audit database a hard availability dependency for money: an outage blocks refunds while the FTC 7-working-day clock and GDPR Art. 12(3) run, so **EM16 enforced strictly can force an EM15 breach** (AUDA-04, `22 §3.1`).

**The resolution separates durability from externalisation.**

1. **The primary journal lives in the control database** — where it already lived — with three additions: a **company-scoped gap-free monotonic `journal_seq`** (allocation in §5.2), a **local hash chain** over `ACOS-JCS-1` canonical bytes (§5.3) computed by a control-DB trigger, and a `mirrored_at` column, null until the audit store acknowledges.
2. **The audit store is a replicating verifier**, not a write-ahead dependency. It receives rows, re-chains them under its own trigger, and verifies that the chain it received is internally consistent and gap-free by `journal_seq` — and, v1.2, that it is **complete against the attestations** (§5.4).
3. **Ordering.**

```
BEGIN
  SELECT ... FOR UPDATE on window_balance rows, ascending window_id   -- §5.2 lock order
  SELECT ... FOR UPDATE on journal_counter(company_id)                -- last
  authorisation row
  effect row (status = AUTHORISED)
  reservation row
  state transition
  journal row (journal_seq, local prev_hash/row_hash over ACOS-JCS-1 bytes)
COMMIT                                  -- durable, locally chained, gap-free
  ↓
push to audit store (async, retried, quota-bounded, idempotent per §5.2)
  ↓
dispatch, per (4)
```

Cross-database atomicity is not attempted, because it does not exist. What replaces it is **a gap-free local sequence the audit store can prove it has all of.** A missing `journal_seq` has exactly one interpretation.

4. **Dispatch precedence while the mirror is unreachable — an ordered first-match list, v1.2.**

v1.1 presented five independent rows and **two of them matched simultaneously for the most consequential case.** A refund inside a live FTC clock is COMPENSABLE-inside-a-clock (*"dispatch — the clock outranks the mirror"*) **and** above the per-action approval floor (*"halt"*). v1.1 stated that floor in prose as the same `$25` figure as `refund.create`'s `per_action_max`, which was the conflation `§5.1a` corrects: **the two are different quantities with different kinds, and v1.3.3 declares the floor separately at $20.00.** The table declared no precedence, so the largest and most time-critical refund class had two contradictory specified behaviours — which is the same defect class R3 was raised to close, reproduced one level down (AUD-05). And a rule that *"halts anything above the approval floor"* is not a mirror rule at all: an above-floor action requires approval whether or not the mirror is up, so as written it conflated an approval gate with an availability gate.

**Evaluate in order. First match wins.**

| # | Condition | Behaviour |
|---|---|---|
| **1** | `recoverability == IRRECOVERABLE` | **State-qualified (v1.3.4, IRN-01).** In `NORMAL`, **dispatch** — subject to every ordinary authority requirement, which is where an irrecoverable effect is actually gated. In `UNCORROBORATED_STALL` and in `CORROBORATED_DEGRADED`, **halt**: no send, no reship, no public post, no address edit. Unmirrored and unundoable is the combination the mirror exists for, and `NORMAL` is the state in which the effect is *not* unmirrored. Unreachable by override in either degraded state, and halted by `§5.1a`'s posture. |
| **2** | Above the per-action approval floor (`degraded_per_action_approval_floor_monetary`, **$20.00**, `51 §3.7`; compared against `effect.request.exposure.total_exposure`) **and not** clock-bearing | **Halt.** The approval itself proceeds normally; what halts is *dispatch* of an already-approved above-floor effect while unmirrored. |
| **3** | Clock-bearing (a live statutory clock citing a RECORD-grade fact, `§9.1`) and `recoverability == COMPENSABLE` | **Dispatch**, in `NORMAL` and `CORROBORATED_DEGRADED` only. Journal `DISPATCHED_UNMIRRORED` and raise it in V6. **In `UNCORROBORATED_STALL`, suspend** (§5.6) — this row is the inversion, and the only escape is a `DegradedModeOverride` scoped to this row (§5.7.2). |
| **4** | `recoverability == COMPENSABLE`, discretionary | **Suspend.** |
| **5** | `recoverability == REVERSIBLE` | **Dispatch** against the committed, locally chained journal. |

**Row 2 before row 3, and row 1 before both.** An above-floor clock-bearing COMPENSABLE effect — the $30 refund — reaches row 3 and dispatches, because the approval has already been given and the statutory clock is the reason the architecture accepted this trade in the first place. An above-floor *non*-clock-bearing effect halts at row 2. An IRRECOVERABLE effect matches row 1 regardless of clock or approval, and row 1 is where the trade is refused **in the two degraded states**. **Approval-bearing effects evaluate at rows 3 or 5 once approved**; the approval gate is `26 §12`'s concern and is not re-litigated here.

**Row 1 matches first in every state, `NORMAL` included, and that is unchanged by v1.3.4.** What v1.3.4 changes is row 1's *behaviour* in `NORMAL` only. The ordering is untouched, so an IRRECOVERABLE effect still never reaches row 2 — it did not reach row 2 at v1.3.3 either, because row 1 matched first — and no other row's reachability moves. `§5.1b` records the correction and its bounds.

5. **Degradation.** Mirror lag at or above `mirror_lag_critical_threshold` (**15 minutes**, `51 §3.8`) raises `AUDIT_MIRROR_DEGRADED` at **CRITICAL** urgency, owner-visible immediately. Mirror unreachable continuously for at or beyond `audit_unreachable_full_halt_threshold` (**30 minutes**, `51 §3.8`) halts **all** classes including REVERSIBLE — the point at which the company stops. **Both boundaries are inclusive at the threshold and both are specified in `§5.1a`.** **The only escape from either the halt or `UNCORROBORATED_STALL`'s row-3 suspension is a `DegradedModeOverride`, specified as kernel state in `§5.7.2` with a declared scope, time box, count cap, monetary cap, expiry behaviour, second-approver rule and the aggregate composition bound `I63`.** An override restores precedence rows 3 and 4 only, never rows 1 or 2. **Blanket `REQUIRE_APPROVAL` is removed.** Audit-store saturation is an incident, not a mode change (I17c).

**Rationale, and the honest label.** EM16's purpose is that no effect escapes the record. A locally committed, locally chained, gap-free journal row satisfies that purpose. What the mirror adds is *unsuppressibility*, and that matters most exactly where the action cannot be undone — which is why row 1 sits where it does, and why row 1 halts **the moment the mirror stops corroborating** rather than at all times (`§5.1b`, v1.3.4). **This is a chosen trade-off, not a resolution.** `47 §9` puts it plainly: the audit plane's availability requirement and the statutory clocks are in genuine tension, and the split halt is a selected trade rather than a dissolution of the conflict. Recorded as such in `22 §3.1`.

### 5.1a The three quantities `§5.1` needs, declared (v1.3.3, S1H-C1, S1H-C10)

**The defect.** `§5.1` item 4 row 2 and item 5 each read an operand no artifact declared. Row 2 compares against *"the per-action approval floor"*; item 5 compares against *"threshold"* and *"a longer threshold"*. `51` declared none of the three, `50 §2` class 3 listed *"approval floor"* as a signed catalogue **field** with no value, and `§5.1`'s own AUD-05 narrative stated the floor in prose as the same `$25` figure as `refund.create`'s `per_action_max`. **Registry rule 6 applied to the dispatch rule itself**: three quantities the mechanism needs that the artifact declaring quantities does not declare. S1H reported the affected legs PARTIAL rather than inventing them (`S1H-owner-clarifications.md` S1H-C1, S1H-C10). This section is the owner disposition. **The authoritative values are declared once, in `51 §3.7` and `51 §3.8`; every value printed here is a transcription of those two sections.**

#### The per-action approval floor

> **`degraded_per_action_approval_floor_monetary` = USD 20.00** (`51 §3.7`).
>
> **The comparison operand is `effect.request.exposure.total_exposure`, and nothing else.** Not `exposure.vendor_amount`, not a dispatch amount, not a model-supplied amount, not an amount recovered from a `rationale`, and not a figure appearing in grant prose. This is the same operand `51 §3.1` already declares for `per_action_max` — *"compared against `exposure.total_exposure`, not `exposure.vendor_amount` (SR-C1, `26 §8`)"* — for the same reason: **the cap bounds economic loss, and economic loss includes the fee that does not come back.**
>
> **Comparison semantics.** `total_exposure > 20.00` is ABOVE the floor. The comparison is **strict**, evaluated in minor units of the single ledger currency (`51 §1`), so `$20.00` exactly is **not** above the floor and `$20.01` — one minor unit above — **is**. There is no tolerance and no rounding step.
>
> **Kind.** A **degraded-mode dispatch-precedence approval floor**. It is **not** `per_action_max`, **not** a Cedar DENY ceiling, **not** MAL or any MAL term, **not** a window ceiling, **not** a reservation amount and **not** an override monetary limit. It denies nothing and it reserves nothing: its only effect is to decide whether row 2 of item 4's ordered list matches.
>
> **A non-monetary effect is not above the floor.** A rate class reserves `0.00` (`26 §2.1.3`) and an action class with no monetary field carries `total_exposure = 0.00`, so the predicate is false and row 2 does not match. The floor is a monetary predicate and is exhaustively so.

**The `$25.00` per-action Cedar bound is unchanged and is a different gate, evaluated earlier.** `51 §3.1` gives `refund.create` a `per_action_max` of **$25.00** and `26 §8` makes it a DENY boundary — `context.exposure.total_exposure <= 25.00`, and an effect above it *"denies `PER_ACTION`"*. **A denied effect never reaches item 4's precedence list at all**, so `per_action_max` cannot be row 2's operand and the two quantities never compete. The ordering is: policy evaluates `per_action_max` and may DENY; only a surviving effect is classified by item 4.

**The reachable band, stated.** Under the S1 fixture the two bounds compose to a single open band:

| `total_exposure` | `per_action_max` ($25.00, DENY) | Above the floor ($20.00)? | Item 4 |
|---|---|---|---|
| `$19.99` | admits | No | row 2 does not match; classified by class and clock |
| `$20.00` | admits | **No** — the comparison is strict | row 2 does not match |
| `$20.01` | admits | **Yes** | row 2 matches unless clock-bearing or approval-bearing |
| `$25.00` | admits (`<=`) | Yes | row 2 matches unless clock-bearing or approval-bearing |
| `$25.01` | **DENIES `PER_ACTION`** | not evaluated | **never reaches item 4** |

**`$20.01 … $25.00` is therefore the whole band in which row 2 is reachable for `refund.create`**, and it is non-empty, which is what v1.3.2's silence left undecidable: at a floor equal to `per_action_max` the band would be empty and row 2 unreachable for the entire S1 catalogue.

#### The mirror-lag CRITICAL threshold

> **`mirror_lag_critical_threshold` = 15 minutes (`PT15M`)** (`51 §3.8`).
>
> **Boundary semantics, normative and inclusive.** Let `mirror_lag` be the age of the **oldest journal row this company has committed that the audit store has not acknowledged** — `now() − min(occurred_at)` over `effect_journal` rows whose `mirrored_at` is null, evaluated on the **control database clock** (`36 §6`). `mirror_lag >= 15 minutes` **is at or over the threshold** and raises `AUDIT_MIRROR_DEGRADED` at CRITICAL urgency. `mirror_lag < 15 minutes` does not. At `ACOS-JCS-1` timestamp precision — 6 fractional digits (`§5.3`) — the boundary is: `14:59.999999` is under, `15:00.000000` is at, `15:00.000001` is over.
>
> **What it is.** An **escalation and state input**. It raises the CRITICAL condition item 5 names and it does nothing else. It **cannot** create `CORROBORATED_DEGRADED`, **cannot** fabricate or substitute for a `MirrorInputStallSignal`, **cannot** grant or extend a `DegradedModeOverride`, and **cannot** move any monetary limit. `§5.6`'s entry conditions are unchanged by it.
>
> **`mirrored_at` remains advisory** (`§5.2`), so this operand is control-plane-derived and control-plane-forgeable. That is admissible **in this direction only**: the condition it raises is strictly an escalation, and a control plane understating its own lag suppresses an alarm rather than obtaining authority. The unforgeable detector for the understated case is the audit plane's own attestation-absence check (`§5.4`) and `I17f(b)`.

#### The prolonged audit-unreachability FULL-HALT threshold

> **`audit_unreachable_full_halt_threshold` = 30 minutes (`PT30M`)** (`51 §3.8`).
>
> **The operand, and its timer semantics, normatively.** The timer is the **open control-side declaration** `§5.7` already requires: entry into `UNCORROBORATED_STALL` or `CORROBORATED_DEGRADED` journals an `AUDIT_MIRROR_DEGRADED` row and opens a declaration with an `opened_at` instant; leaving the degraded path journals the close and sets `closed_at`. **At most one declaration is open per company**, so *"continuous unreachability"* has exactly one reading:
>
> ```
> continuous_unreachability = now() − declaration.opened_at   , for the open declaration
> continuous_unreachability = 0                               , when no declaration is open
> ```
>
> **The timer STARTS when a declaration opens and RESETS only when one closes.** It is not reset by a state change between `UNCORROBORATED_STALL` and `CORROBORATED_DEGRADED`, by a signal arriving or expiring, by a re-issued signal, by a restart of either plane, or by the passage of an attestation interval — none of those closes a declaration. Evaluated on the **control database clock** (`36 §6`); a model cannot supply, advance or reset it, and no elapsed interval is ever inferred from model input.
>
> **Boundary semantics, normative and inclusive.** `continuous_unreachability >= 30 minutes` **enters the FULL-HALT POSTURE**. At `ACOS-JCS-1` timestamp precision the boundary is: `29:59.999999` is not in the posture, `30:00.000000` is, `30:00.000001` is.
>
> **`30 minutes > 15 minutes` is required and is the point.** The CRITICAL escalation must precede the halt so the owner sees the condition before the company stops. The two thresholds are separate quantities and neither is derived from the other.

**The FULL-HALT POSTURE, specified.**

> The posture is a **fourth behaviour over `§5.6`'s three states, not a fourth state.** `§5.6` declares three states and there is no fourth; the posture is a predicate on the declaration's age that composes with whichever of the three holds. It applies in **both** degraded states, including `CORROBORATED_DEGRADED`: item 5 qualifies the halt by no state, and corroboration **proves** the stall rather than curing it — the record that is not being made is not made any more by the audit plane confirming so.
>
> **In the posture, item 4's ordered list is evaluated and then every disposition is reduced to Halt**, for **every** recoverability class including REVERSIBLE — item 5's *"halts **all** classes including REVERSIBLE"*. Nothing becomes eligible for future dispatch locally.
>
> **The one escape is the already-specified `DegradedModeOverride`**, and it escapes exactly as far as `§5.7.2` already permits and no further. Item 5 states both halves and they compose determinately:
>
> * *"The only escape from **either the halt** or `UNCORROBORATED_STALL`'s row-3 suspension is a `DegradedModeOverride`"* — so the override does reach the full halt; and
> * *"An override restores precedence rows **3 and 4 only**, never rows 1 or 2"*, and `51 §3.6` makes `{3, 4}` the structural grantable set.
>
> **Therefore, in the posture: rows 3 and 4 are restorable by an in-scope override; rows 1, 2 and 5 are not.** Row 5's REVERSIBLE dispatch, which the posture is what halts, has **no** override path — `precedence_rows` cannot hold `5`. This is deliberate and is the honest reading of the two sentences together: the override is a bounded escape for the clock-bearing and discretionary COMPENSABLE cases the statutory clocks run against, not a general resumption of trading while the record cannot be made.
>
> **Every override quantity is unchanged by v1.3.3.** 24 hours, 5 effects, $50.00 per override; 3 overrides, 72 hours, 8 effects, $100.00 per rolling 30 days; the second-approver rule from the 2nd override — all as `51 §3.6` declares them, and `I63` enforces them. The posture changes **what** an override may be needed for. It does not widen **what** an override may do, and an override in the posture still changes no ceiling.

**None of the three quantities is a mode-transition operand.** `§5.6`'s three entry conditions are unchanged by this section, `§5.7.1`'s corroboration contract is unchanged, and **a timer alone cannot enter `CORROBORATED_DEGRADED`**: that state still requires a fresh, valid, audit-signed `MirrorInputStallSignal` and *"nothing else will do"* (`§5.7`).

**Control-artifact effect.** The approval floor is a field of control-artifact **class 3** (`50 §2`), which already enumerates *"approval floor"*; declaring its value moves class 3's `content_hash`. The two thresholds are **class 27**, added by v1.3.3 (`50 §2`). Both require a fresh owner signature with a second factor before any deployment. **No production owner-signing or runtime `I19` mechanism exists yet**, and the class-20 residual carried from v1.3.2 is unaffected and still owed.

### 5.1b Row 1 is state-qualified: IRRECOVERABLE dispatches in `NORMAL` (v1.3.4, IRN-01, S1I-C6)

**The defect.** `§5.1` item 4 is introduced as *"Dispatch precedence **while the mirror is unreachable**"* and row 1's own rationale is a statement about being **unmirrored**: *"Unmirrored and unundoable is the combination the mirror exists for."* `22 §3.1`'s state-qualified table nevertheless printed row 1 as **Halt / Halt / Halt**, halting IRRECOVERABLE in `NORMAL` — a state in which the effect is not unmirrored at all. Composed with item 5's *"An override restores precedence rows 3 and 4 only, never rows 1 or 2"* and `51 §3.6`'s `recoverability_classes[] ⊆ {COMPENSABLE, REVERSIBLE}` DATABASE CHECK, the consequence was total: **under v1.3.3 as issued an IRRECOVERABLE effect was never dispatch-eligible, in any state, with or without an owner override.**

**That is not a policy the package elsewhere holds.** `34` ADR-026 is titled *"**Irrecoverable dispatch** goes through an ACOS-owned outbox"*; `25 §7` builds the outbox specifically because `26 §5` classifies `email.send` IRRECOVERABLE and most ESPs offer no idempotency header; `25 §5` gives IRRECOVERABLE its own unknown-outcome branch ending in `PRESUMED_EXECUTED`; `37` S4 plans autonomous T-U0 sends through a real ESP sandbox; and `I20` bounds *provider-accepted* irrecoverable units against reserved ones. **Every one of those mechanisms is unreachable if an IRRECOVERABLE effect can never be dispatched in healthy operation.** A table cell in a degraded-mode section had silently repealed a capability four other artifacts specify.

**Provenance.** Reported during S1I as `S1I-owner-clarifications.md` S1I-C6, which implemented the printed table — the fail-closed direction — reported the consequence as a finding, and refused to route around it. This section is the owner disposition.

#### The correction, stated exactly

> **Row 1's CONDITION is unchanged:** `recoverability == IRRECOVERABLE`. **Its POSITION is unchanged:** first, ahead of row 2, in every state.
>
> **Row 1's BEHAVIOUR is state-qualified:**
>
> | Mirror state (`§5.6`) | Row 1 behaviour |
> |---|---|
> | `NORMAL` | **Dispatch** |
> | `UNCORROBORATED_STALL` | **Halt** |
> | `CORROBORATED_DEGRADED` | **Halt** |
>
> **In the FULL-HALT POSTURE (`§5.1a`, at or beyond `audit_unreachable_full_halt_threshold`): Halt**, as for every other row, and **not** restorable — the posture restores rows 3 and 4 only.
>
> **A `DegradedModeOverride` can never unlock row 1**, in any state. Item 5's *"never rows 1 or 2"* is unchanged, `51 §3.6`'s structural `{COMPENSABLE, REVERSIBLE}` CHECK is unchanged, and `precedence_rows` still cannot hold `1`.

#### What "dispatch in `NORMAL`" does and does not mean

**`DISPATCH_ELIGIBLE` at row 1 in `NORMAL` is a statement about item 4 and about nothing else.** Item 4 is the *degraded-mode dispatch precedence*. It is evaluated only over an effect that has already satisfied every ordinary authority requirement, and it grants no relief from any of them:

* `26 §7`'s ordered, fail-closed step sequence — principal, grants, preconditions, evidence, autonomy, policy, exposure, reservation;
* `26 §8`'s Cedar DENY boundaries, including `per_action_max`;
* `26 §12`'s approval tier, where the class carries one. An effect awaiting approval is not `AUTHORISED` and cannot be enqueued at all;
* `26 §5`'s catalogue-assigned recoverability, and the MIE window ceilings the irrecoverable counters draw against;
* `25 §7`'s idempotency layers, including the outbox claim;
* the claim-time re-evaluation of current state (`§5.1` item 3, and the outbox claim it orders).

**An IRRECOVERABLE effect is gated by the authority model, not by the mirror table.** The mirror table's job is to say what happens to an already-authorised effect **when the record cannot be made**, and its answer for the irrecoverable class is now what its own rationale always said it was: halt while unmirrored.

**And `NORMAL` is the only state that changes.** The invariant the mirror exists for is preserved exactly: the combination row 1 refuses — *unmirrored* and *unundoable* — still refuses, in both degraded states, in the posture, and against an owner override.

#### The reachability consequence, stated so it can be checked

Under v1.3.4, for an otherwise-valid IRRECOVERABLE effect:

| Mirror / posture | Item 4 disposition | Reachable by override? |
|---|---|---|
| `NORMAL` | **DISPATCH_ELIGIBLE**, row 1 | n/a — already eligible |
| `UNCORROBORATED_STALL` | **HALT**, row 1 | **No** |
| `CORROBORATED_DEGRADED` | **HALT**, row 1 | **No** |
| FULL-HALT POSTURE, any state | **HALT**, row 1 | **No** |

**Nothing about a claim in `NORMAL` asserts execution.** Reaching `DISPATCH_ELIGIBLE`, and taking the outbox claim item 3 orders after it, records that the effect **may be handed to transport**. It is not a dispatch, not a `DISPATCHED` state, not a provider acceptance, not `PRESUMED_EXECUTED`, and not an MIE execution consumption. `25 §5`'s unknown-outcome branch and `§8`'s reconciliation own those transitions and they are unchanged by this section.

#### Two consequences for statements made elsewhere, and neither is left implicit

**(a) `36 §6`'s *"`CORROBORATED_DEGRADED`: as `NORMAL`"* now holds for rows 2 through 5 and NOT for row 1.**

Before v1.3.4 the two states agreed at every row, because row 1 halted in both. They no longer agree at row 1, and **that is the correct behaviour rather than an oversight**: `§5.1a` already gives the reason in its own words, about the posture —

> *"corroboration **proves** the stall rather than curing it — the record that is not being made is not made any more by the audit plane confirming so."*

An IRRECOVERABLE effect in `CORROBORATED_DEGRADED` is still **unmirrored and unundoable**, which is exactly the combination row 1 refuses. A corroborated stall is a stall with a witness.

**The permissiveness ordering is unchanged and still total.** For every row and every operand tuple:

> `NORMAL` ≥ `CORROBORATED_DEGRADED` ≥ `UNCORROBORATED_STALL`

with `Dispatch > Suspend > Halt`. Row 1 now reads `Dispatch ≥ Halt ≥ Halt`, which satisfies it. **What v1.3.4 removes is the EQUALITY between `NORMAL` and `CORROBORATED_DEGRADED`, not the ordering** — and it removes it in the strict direction, so `CORROBORATED_DEGRADED` is never looser than `NORMAL` at any row.

**(b) `§5.6`'s inversion now has a second row.**

`§5.6`'s inversion is the property that a unilateral control-side declaration makes the system **stricter**. Before v1.3.4 exactly one row differed between `NORMAL` and `UNCORROBORATED_STALL` — row 3, Dispatch versus Suspend. **Now rows 1 and 3 differ**, row 1 by Dispatch versus Halt.

**This strengthens the inversion; it does not weaken it.** Both differences run in the same direction: declaring the mirror unreachable costs the declarer the clock-bearing COMPENSABLE dispatch *and* the irrecoverable one. A control plane that lies about its mirror now forfeits more than it did, which is what `§5.6` exists to arrange.

**Nothing about the corroborated path becomes self-serviceable.** Entry to `CORROBORATED_DEGRADED` still requires a fresh, valid, audit-signed `MirrorInputStallSignal` (`§5.7`, `§5.7.1`) and a control plane cannot mint one — and reaching that state does not restore row 1 in any case.

#### Authority quantities

**NO CHANGE.** No ceiling, cap, floor, threshold, window, MAL term or override quantity is altered by this section. `recompute-v1.3.py` reproduces `recompute-v1.3-output.txt` line for line after this pass.

#### Control-artifact effect

**None of its own.** Row 1's behaviour is not a control-artifact field: it is not a catalogue field (class 3), not a limit (`51`), not a threshold (class 27) and not a canonicalisation rule (class 20). The degraded-precedence table lives in `30` and `22`, which are architecture text.

### 5.2 Sequence allocation, lock order and re-push (v1.2, SR-A4, SR-A5)

**`journal_seq` must be gap-free per company, which forbids a sequence.** PostgreSQL sequences are non-transactional: `nextval` outside the transaction leaves permanent gaps on rollback, and a gap is the one signal `I17` reads as suppression. The allocator is therefore a row:

```
journal_counter(company_id PK, next_seq BIGINT)
```

taken `SELECT … FOR UPDATE` inside the same transaction as the journal insert. This **serialises all journal writes per company**, which is the intended cost — `I3`'s window balances already serialise the money path, and the throughput ceiling is `33 §6`'s scale envelope, not this.

**Lock order, declared once and cited everywhere** (AUD-04). v1.1 specified two lock-taking mechanisms in the same transaction — the entity advisory lock in `25 §14` and the exposure reservation — and adding a per-company counter to an unstated order is a deadlock waiting for the first concurrent refund on the same order:

> **1. `window_balance` rows, `FOR UPDATE`, ascending `window_id`. 2. `journal_counter(company_id)`, `FOR UPDATE`. 3. Everything else.**

The counter is taken **last** because it is the most contended and holding it across the balance checks would serialise every company operation behind the slowest one. `36 §2.5`'s concurrency test asserts no deadlock under N concurrent same-order refunds.

**`journal_seq` is not an idempotency-key input** (SR-A4). The key is a deterministic function of `(task_id, action_class, resource_id, semantic_parameter_digest)`, computed **before** the transaction that allocates the sequence — otherwise a retry after a crash would compute a different key from a different sequence and `I42`'s uniqueness would authorise a duplicate. Stated here because the sequence is new and the temptation is obvious.

**Re-push is idempotent** (SR-A5). Retry is specified — *"async, retried, quota-bounded"* — and v1.1 never said what the audit store does when it receives `journal_seq = N` twice. It matters because the naive answers are all wrong: rejecting the duplicate breaks the retry; accepting it duplicates a row inside a hash chain; and counting it inflates `row_count`, which is an **anchored** quantity, so a benign retry storm would corrupt the anchor and produce a permanent unresolvable `I17b` discrepancy.

| Case | Behaviour |
|---|---|
| `UNIQUE(company_id, journal_seq)` conflict, **identical `row_hash`** | `ON CONFLICT DO NOTHING`. Emit `AUDIT_PUSH_DUPLICATE` at **INFO**. This is the expected retry. |
| Conflict, **differing `row_hash`** | Reject. Emit `AUDIT_SEQUENCE_COLLISION` at **CRITICAL**. Two different rows claiming one sequence is either a control-plane bug or a rewrite attempt, and it is never benign. |
| `row_count` | `count(DISTINCT journal_seq)`. Anchored quantities are unaffected by retries. |
| `mirrored_at` | Set on first successful acknowledgement, **advisory only**. It is a control-plane column, so a compromised control plane can set it freely; nothing depends on it. `I17` and `I17e` are evaluated from the audit side. |

### 5.3 `ACOS-JCS-1`: what exactly is hashed (v1.2, SR-A3; NULL framing corrected v1.3.2, JCS-01)

Two independent hash chains over the same logical rows — one in each database, by design, because a chain the writer computes proves nothing (I17d) — **agree only if both canonicalise identically.** v1.1 said the trigger computes the hash "over canonicalised rows" and defined canonicalisation nowhere. Every one of the following produces a silent permanent divergence between two correct implementations:

| Hazard | `ACOS-JCS-1` rule |
|---|---|
| `NUMERIC` scale: `25.0` vs `25.00` | **Per-column declared decimal scale**, serialised as a string at that exact scale. `25.0` and `25.00` are **different bytes**, deliberately — a scale change is a semantic change in a money field. |
| Timestamp precision and zone | RFC 3339, **UTC**, exactly 6 fractional digits, `Z` suffix. |
| Column order | **Fixed, declared per row kind**, in the specification — never the physical column order, which a migration reorders. **The declarations are `§5.3a` (v1.3.4, JCS-02); a row kind in service without one there is a defect.** |
| Nulls vs empty strings | **A field-level NULL is carried by the framing word, not by a payload byte** — see the framing rule below. A NULL has **no payload bytes at all**; an empty string and an empty `bytea` are **zero-length values** with an ordinary length word of `0`. *(NULL framing corrected v1.3.2, JCS-01. v1.2's `0x00` sentinel byte is withdrawn: it was not injective against a one-byte `bytea` payload.)* |
| Unicode form | **UTF-8, NFC.** |
| JSON-valued columns | **RFC 8785 (JCS)**, applied to the field's value. |
| Field framing | Every field is prefixed with a **4-byte big-endian unsigned length/discriminator word**, so no separator can be forged by content. **`0xFFFFFFFF` is RESERVED and means NULL**, and a NULL field is that word alone with no payload. A **non-null** field is `uint32_be(payload_length) \|\| payload` with `0 <= payload_length <= 0xFFFFFFFE`; a payload whose length would reach `0xFFFFFFFF` **is not representable and the implementation must fail closed** rather than truncate or wrap. *(v1.3.2, JCS-01.)* |
| What is hashed on the wire | **The transmitted bytes are what is hashed.** The audit store re-chains over the bytes it received, not over a re-serialisation of its own parsed columns. A parse-then-reserialise step would reintroduce every hazard above at the receiving end. |

**The five representations that must never collapse onto one another (v1.3.2, JCS-01).** Stated as bytes, because prose about this rule is what produced the defect:

| Value | `ACOS-JCS-1` framed bytes |
|---|---|
| SQL `NULL` | `FF FF FF FF` — the reserved word, **no payload** |
| empty string (`''`) | `00 00 00 00` — length 0, no payload |
| empty `bytea` (`'\x'`) | `00 00 00 00` — length 0, no payload |
| `bytea` `'\x00'` — one byte, value zero | `00 00 00 01 00` |
| JSON literal `null` in a JSON-valued column | an **ordinary non-null field** carrying the RFC 8785 bytes `null`: `00 00 00 04 6E 75 6C 6C` |

An **absent** optional structure member, where the row kind's schema makes absence a state distinct from a present null, is a field-level NULL and frames as `FF FF FF FF`. Where the schema makes the field mandatory there is no absent state and none may be invented.

**The injectivity consequence, stated so it can be checked.** The reserved word is outside the range of every non-null length, so the NULL encoding and the set of all non-null encodings are **disjoint by construction**: no payload, of any type, of any length, of any content, can produce the four bytes a NULL produces. Injectivity of the whole field encoding therefore reduces to injectivity of each type's payload rule, and no type's payload rule needs to exclude a byte value in order to stay clear of NULL. This section's Unicode rule and the `U+0000` exclusion that supports it remain in force as written and are unchanged — they are simply no longer what separates NULL from text.

**What v1.2's rule got wrong, recorded rather than quietly replaced.** A single `0x00` sentinel byte for NULL frames as `00 00 00 01 00`. A `bytea` value whose content is exactly the one byte `0x00` frames as `00 00 00 01 00`. **The two are the same bytes**, so the v1.2 encoding was not injective over the generic field types `ACOS-JCS-1` declares, and two conforming implementations could hash a NULL and a real one-byte payload to one value. `text` was accidentally safe, because PostgreSQL `text` cannot hold `U+0000`; `bytea` was not, and these rules are declared generically and not per column type. `phase2-v1.3.2-errata.md` carries the full disposition.

**No non-null payload rule changed in v1.3.2.** Decimal scale, timestamp form, column order, Unicode form, RFC 8785 for JSON, the hash function and the row-chain formula are all as v1.3.1 issued them, byte for byte. Only the NULL framing changed, and only NULL-bearing rows change hash.

`ACOS-JCS-1` is a **control artifact, class 20** (`50 §2`), versioned in its name. A change is a chain break by construction and requires a declared migration with a re-anchor. **The v1.3.2 correction changes class 20's signed content and therefore its `content_hash` (`50 §3`); the artifact name is unchanged by owner decision, and the class-20 signature and manifest digest are what carry the new identity.** A deployed chain could not adopt this framing without a declared chain-versioning and re-anchor procedure; at v1.3.2 there is no deployed chain. `36 §2.6` cross-implements it: the same fixture rows serialised by both triggers must produce byte-identical output.

### 5.3a Declared row-kind field orders (v1.3.4, JCS-02, S1I-C4)

**The defect.** `§5.3` requires a hashed row's column order to be *"**Fixed, declared per row kind**, in the specification"* — and the specification declared an order for **no row kind at all**. Every order in service was an implementation convention agreed between two independently written triggers. Because `ACOS-JCS-1`'s framing is a concatenation of length-prefixed fields, **the order IS part of the hash**: two conforming implementations that disagree on it produce a permanent silent chain divergence of exactly the kind `§5.3` exists to prevent, and there was no artifact either could be judged against.

**This section is that specification for the outbox claim row.** The remaining kinds are declared as they are cross-implemented; a row kind in service without a declared order here is a defect of this class.

#### `acos.journal.outbox_claimed.v1`

The record of `25 §7`'s claim — the last committed local record before an effect can cross the perimeter, and therefore a `23 §6` B8 record.

| # | Field | Type | Note |
|---|---|---|---|
| 1 | `'acos.journal.outbox_claimed.v1'` | text | domain tag |
| 2 | `company_id` | text | |
| 3 | `journal_seq` | int | `§5.2`'s gap-free company-scoped sequence |
| 4 | `'OUTBOX_CLAIMED'` | text | the row kind |
| 5 | `outbox_id` | text | |
| 6 | `outbox_claim_id` | text | |
| 7 | `outbox_correlation_tag` | text | what a future delivery event matches on |
| 8 | `effect_id` | text | joins to the `EFFECT_AUTHORISATION` row |
| 9 | `authorisation_id` | text | |
| 10 | `idempotency_key` | text | |
| 11 | `action_class` | text | |
| 12 | `resource_ref` | text | |
| 13 | `dispatch_payload_hash` | text | |
| 14 | `outbox_matched_row` | int | `§5.1` item 4's matched row |
| 15 | `outbox_mirror_state` | text | `§5.6`'s state at the claim |
| 16 | `outbox_requires_unmirrored_tag` | bool | `§5.7.2` item 5 / `36 §6`'s requirement, carried forward |
| 17 | `override_id` | text, **NULLABLE** | `§5.7.2` item 5 |
| 18 | `outbox_claim_clock_ref` | text, **NULLABLE** | `§9.2.5`'s deterministically selected evidentiary clock. **Non-NULL only where the matched row is 3**; NULL otherwise |
| 19 | `occurred_at` | ts | RFC 3339, UTC, 6 fractional digits |
| 20 | `prev_hash` | bytes | the chain link |

**Required-absent on this kind:** `decision_id`, `reservation_id`, `approval_id`, `verdict`, `vendor_amount`, `total_exposure`, `forward_integral`, `is_rate_class`, the constructor version, `policy_version`, the attestation triple, the mirror/corroboration columns, `override_event` and `override_actor`. **Each is a fact about the AUTHORISATION and is already in the chained row that authorised the effect**; duplicating an authority-bearing value into a second chained row creates a second place it can disagree with itself.

**`case_ref` is deliberately NOT a field of this row.** `§9.2.6` keeps the case binding off the vendor payload; it is equally unnecessary here, because field 18 already records the *clock* the binding selected, which is the fact an audit needs, and it is the narrower disclosure.

**Every field is a scalar.** `§5.3`'s RFC-8785 leg is not engaged by this kind; no JSON-valued column appears.

#### Two obligations this section creates

> **The order is normative, not conventional.** A control-plane implementation and an audit-plane implementation must each transcribe **this table** independently. Neither may read the other, and neither may read a shared canonicalisation helper that would make agreement automatic — an agreement two implementations obtain from one source is not a cross-implementation check (`36 §0`).
>
> **The order may not depend on an object's or a map's insertion order** in any implementation. `36 §2.6`'s byte-identity fixture is what detects a violation, and a seeded swap of two fields of this row kind must make it fail.

**Control-artifact effect.** `ACOS-JCS-1` is control artifact **class 20** (`50 §2`), whose signed content is *"column order per row kind"*. **Declaring an order for a row kind that had none moves class 20's `content_hash` and therefore its signature.** That signature has been owed since v1.3.2's NULL-framing correction and is **still owed**; v1.3.4 extends the same obligation to cover this kind and discharges nothing.

### 5.4 `JournalAttestation`: making silence distinguishable from idleness (v1.2, SR-A1; claim corrected v1.3, TA-01)

The mirror is a push target. **A control plane that simply stops pushing at `journal_seq = N` produces a mirror whose newest row is `N`, whose chain is gap-free, and whose every invariant passes** — a state indistinguishable from a company that has done nothing since. The hourly anchor bounds the exposure at one hour, which for a system dispatching refunds and irrecoverable sends is a long time to be blind, and the anchor was designed to bound *rewrite*, not *silence*.

```
JournalAttestation {
  company_id, max_journal_seq, row_count, head_hash, attested_at
}
```

- **It is itself a journal row**, so it is chained, mirrored and anchored like everything else. An attestation that could be pushed outside the chain would be a second unverified channel.
- **Cadence: 5 minutes**, against the hourly anchor. Emitted **whether or not** any journal row was produced in the interval — the empty attestation is the entire point.
- **k = 3.** Three consecutively missed attestations raise `ATTESTATION_STALL`, bounding undetected silence at **15 minutes**. k=3 rather than k=1 because a single missed 5-minute push is ordinary network weather and a control plane that cries wolf every Tuesday teaches the owner to ignore it.
- **`I17e`** is what makes it a check rather than a heartbeat: for every attestation received, the audit plane verifies every `journal_seq ≤ max_journal_seq` is present **and independently recomputes `head_hash`.** A liveness ping that did not commit the sender to the content of the chain would be trivially forgeable by a control plane that has stopped pushing rows.

**What the attestation establishes, stated exactly (v1.3, TA-01).** v1.2 stated this loosely and `30 §5.5` case 2 overclaimed as a result. The three facts the audit plane actually obtains are:

1. **That attestations are arriving at cadence.** Unforgeable — it is an absence observed by the other party. Bounds **liveness of the attestation channel** at 15 minutes.
2. **That the rows the audit store holds are gap-free, internally consistent, and match the independently recomputed `head_hash` of the latest attested prefix.** Unforgeable, because the audit store re-chains over the transmitted `ACOS-JCS-1` bytes under its own trigger (`I17d`, `I41`).
3. **Nothing whatsoever about the control journal's true maximum sequence.** The audit plane has no independent reading of it and by construction cannot: R10 removed the replica deliberately, and `24 §3` K11's declared inputs contain no control-database read.

**So the honest statement is: `I17`/`I17e` establish continuity of the attestation channel and internal consistency and completeness of the latest attested prefix. They do not establish that the attested maximum equals the true control-journal maximum.**

**What it does not do — two distinct cases, which v1.2 ran together.**

- **Rows omitted *before* attesting.** `max_journal_seq` is simply lower and the attestation is truthful about a chain that never contained the omitted effect. This is `§5.5` case 4.
- **Rows written locally and then withheld, with the attested prefix frozen to match (v1.3, TA-01).** The control journal advances to 1,000; the push stops at 900; attestations continue at cadence claiming `max_journal_seq = 900`, `row_count = 900` and the genuine head hash at 900. Every attestation is internally consistent and independently recomputable. `I17` passes, `I17e` passes, `ATTESTATION_STALL` does not fire. This is `§5.5` case 2b, it is **not detectable by any transport check**, and v1.2's case 2 claimed a 15-minute bound over it that does not exist.

**Only `I8`'s independent vendor reads catch either**, and only for the subset of suppressed rows describing an effect that reached a readable vendor system. That is why the unqualified completeness claim was moved onto `I8`, and why `§5.10` now declares `I8`'s cadence and scope — a claim relocated onto an invariant with no declared bound is a claim with no bound.

### 5.5 The seven omission cases, and which check catches each (v1.2, SR-A1; case 2 split v1.3, TA-01)

`57 §3` requires this enumeration explicitly, because "completeness" was doing work no single check performs. v1.2 listed six cases; **v1.3 splits case 2 into 2a and 2b, because the two have different detectors, different bounds and different residual owners.**

| # | Case | Caught by | Bound |
|---|---|---|---|
| 1 | Row written locally, push fails transiently | Retry; then `I17` diff | Minutes |
| **2a** | Row written locally, push suppressed **by a third party or a transport fault, while the control plane attests honestly** at the true `max_journal_seq` | **`I17e`** — the row's `journal_seq ≤ max_journal_seq` and is absent | ≤ 15 min |
| **2b** | Row written locally, push suppressed **by the attesting party, which freezes its attested prefix to match** | **`I8` only**, and **only** for rows describing an effect that reached a readable vendor system. **No transport check detects this, ever.** For rows with no vendor counterpart: **no detector exists** | `I8_sweep_cadence(adapter) + vendor_reporting_lag(adapter)` (`§5.10`); **unbounded** for the no-vendor-counterpart class |
| 3 | Control plane stops pushing entirely | **`ATTESTATION_STALL`** (k=3) | ≤ 15 min |
| 4 | Control plane pushes attestations but omits rows *before* attesting | **`I8`** independent vendor reads only. **Not caught by any transport check** | `I8_sweep_cadence + vendor_reporting_lag` (`§5.10`) |
| 5 | Row rewritten after insertion in the control DB | Chain break at the audit store; `I17b` anchor | ≤ 1 h |
| 6 | Row inserted into the mirror that the control plane never produced | **`I17`'s second direction** — attested `head_hash` will not recompute | ≤ 15 min |
| **7** | Effect dispatched inside an audit-published `MIRROR_INPUT_STALL` interval **carrying no `DISPATCHED_UNMIRRORED` tag** | **`I17f(c)`** (v1.3, TA-04), owned by the audit plane, which holds both operands | `I17f` evaluation interval, **15 minutes** (`§5.10`) |

**Cases 2b and 4 are the residuals and are stated as such.** They are the cases that require evidential rather than transport independence, and they are the reason the audit plane holds its own read-only vendor credentials (R10). Case 2b's *no-vendor-counterpart* subset — authorisation decisions, denials, reservations, releases, approvals, resumes, state facts, escalations, incidents, clock creations, override exercises, standing transitions, enumeration reads and the `DISPATCHED_UNMIRRORED` tags themselves — has **no detector under any mechanism in this architecture**, and registry `§3` item 9 says so.

### 5.6 The mirror state machine, inverted (v1.2, SR-A2; corroboration contract and override specified v1.3, TA-05, TA-06)

**The defect.** v1.1's degraded mode was **declared by the control plane** and it **relaxed** the dispatch rule — clock-bearing COMPENSABLE effects dispatch unmirrored. So a compromised control plane declares degradation and dispatches refunds with no external record, which is a self-authorising escape from the audit plane. `52 §1` Path B. The obvious remediation — *require audit-plane corroboration before entering degraded mode* — has an obvious failure of its own: during a genuine two-sided outage nobody can corroborate anything, and a refund inside an FTC clock is blocked by the safety mechanism. That is `47 §9`'s tension, resurfacing.

**The resolution is to invert the incentive rather than gate the transition.**

| State | Entered when | Clock-bearing COMPENSABLE (precedence row 3) | Everything else |
|---|---|---|---|
| **`NORMAL`** | Mirror acknowledging within threshold | Dispatch | Per §5.1 |
| **`UNCORROBORATED_STALL`** | Control plane observes the mirror unreachable; **no valid, unexpired `MirrorInputStallSignal` is held** | **Suspend** | Per §5.1, unchanged |
| **`CORROBORATED_DEGRADED`** | The control plane holds a **valid, signed, unexpired `MirrorInputStallSignal`** issued by the audit plane (`§5.7.1`) | Dispatch, journal `DISPATCHED_UNMIRRORED` | Per §5.1 |

**The uncorroborated state is stricter than normal operation, not looser.** A control plane that unilaterally declares a problem thereby **loses** the relaxation it was declaring in order to obtain — it suspends the very refunds Path B wanted to dispatch. There is no longer anything to gain by lying, so the transition does not need to be gated against a lie.

**`I17f` is three-clause (v1.3).** (a) no tagged effect without a covering published stall interval — an invariant; (b) an audit-observed stall with no journaled control declaration raises `ATTESTATION_DIVERGENCE` at CRITICAL — a **detector**, restated as one in v1.3 because its violation raises the condition that satisfies it (TA-09); and **(c), new in v1.3 (TA-04): every effect dispatched inside an audit-published `MIRROR_INPUT_STALL` interval carries `DISPATCHED_UNMIRRORED`.** Clause (c) is the converse of (a) and it is the check v1.2 lacked entirely: (a) quantified over tagged effects and asserted corroboration, and nothing quantified over dispatches and asserted the tag. The audit plane owns (c) because it holds both operands — its own published intervals and the mirrored effect rows — so rule 7 is satisfied.

**What (c) does not close, stated so it is not over-read.** It closes the case where the audit plane **did** publish a stall. It does not close the case in which the control plane declares `NORMAL`, freezes its attested prefix and withholds the effect row itself: the audit plane never receives the row, so there is nothing for (c) to evaluate. That case is `§5.5` case 2b and TJ-01, and its only detector is `I8`.

**When `CORROBORATED_DEGRADED` is actually reachable (v1.3, TA-06).** v1.2 framed the residual as the *genuine two-sided outage* case. The honest characterisation is stronger and the owner should read it before relying on the state:

| Outage class | Audit plane can observe the stall? | Can publish the signal? | Control plane can fetch it? | `CORROBORATED_DEGRADED` reachable? |
|---|---|---|---|---|
| Network partition between the planes | Yes | Yes | **No** — the fetch path is the severed path | **No.** Stays `UNCORROBORATED_STALL` |
| Audit store down | No — its own checks cannot run | No | — | **No** |
| Audit-plane host down | No | No | — | **No** |
| Audit insert quota saturated (`I17c`) | Yes | Yes | Yes | **Yes**, but `§5.1` item 5 declares saturation *an incident, not a mode change* |
| Push path degraded, audit read path healthy | Yes | Yes | Yes | **Yes** |
| Audit store unavailable for writes to the journal holdings only, audit-owned tables writable (v1.3.3) | Yes | Yes | Yes | **Yes**, and this is the only case in which `§5.7.1a`'s `STORE_WRITE_REJECTED` is derivable |
| Audit store unavailable for writes entirely | No — it cannot record or publish anything | No | — | **No** |

**So the relaxation is available in a narrow slice, and the two commonest real outages — partition and audit-plane unavailability — are not in it.** The signal's `max_age` is 5 minutes (`§5.7.1`), so a rolling signal held at the instant a partition begins buys at most five further minutes of corroborated operation and is not a solution to the partition case. **This is an availability trade and it is not disguised: for the common outage the answer is `UNCORROBORATED_STALL`, and the escape is the specified owner override in `§5.7.2`.**

**The residual, stated plainly.** A **genuine two-sided outage** leaves the system in `UNCORROBORATED_STALL`, suspending clock-bearing refunds while the FTC clock runs. **That costs an owner override**, which v1.3 specifies as kernel state in `§5.7.2` with a declared scope, time box, count cap, monetary cap, expiry behaviour, second-approver rule and an aggregate composition bound (`I63`). This is a real availability cost accepted deliberately, and it is the honest price of not letting the audited party decide when it is being audited.

### 5.7 Who observes what, and what each signal can prove (v1.2, SR-A2; three signals added v1.3, TA-04, TA-06)

| Actor | Signal | Direction | Can it be forged by a compromised control plane? |
|---|---|---|---|
| Control plane | Mirror push acknowledgement timeout | internal | **Yes** — trivially. Which is why it only reaches `UNCORROBORATED_STALL`, the stricter state. |
| Control plane | `AUDIT_MIRROR_DEGRADED` journal row — the declaration itself | control → audit, **over the push path whose failure it declares** | **Yes, in both directions.** It can be emitted falsely, and its non-arrival is definitionally indistinguishable from the condition it declares. That indistinguishability is `I17f(b)`'s subject and is why (b) is a detector rather than an invariant. *(v1.3, TA-06 / A5 omission 2.)* |
| Control plane | `DISPATCHED_UNMIRRORED` tag on an effect row | control → audit | **Yes, by omission**, and omission is the dangerous direction. Closed by `I17f(c)` for effects whose rows reach the mirror; **not** closed for a withheld row (`§5.5` case 2b). *(v1.3, TA-04 / A5 omission 3.)* |
| Audit plane | Absence of expected attestations (k=3) | audit-internal observation | **No.** It is an absence observed by the other party. |
| Audit plane | Its own reachability probe of its own store | audit-internal observation | **No.** |
| **Audit plane** | **`MirrorInputStallSignal`** — the signed artifact the control plane must fetch to reach `CORROBORATED_DEGRADED` | **audit → control**, pull, over a declared path | **No.** Signed under a key held only by the audit plane; the control plane holds the public key and can verify but not mint or extend. Replay is bounded by `max_age` and detected by `I17f(a)`. *(v1.3, TA-06 / A5 omission 1 — the only signal crossing the trust boundary in the audit→control direction, and v1.2's table omitted it.)* |
| Audit plane | Independent vendor reads (`I8`, `§5.10`) | audit-internal | **No.** The only signal that catches omission cases 2b and 4. |
| Anchor medium | `{head_hash, chain_seq, row_count}`, hourly | audit → external | **No**, by construction of the medium (`§5.8`). |
| Owner client | Client-side diff of briefing against appendix | external | **No.** Requires both endpoints to be compromised consistently. |

**Entry into `CORROBORATED_DEGRADED` requires a valid `MirrorInputStallSignal` and nothing else will do.** An audit-plane observation the control plane cannot fetch does not unlock the state; that is the fail-closed direction and `§5.6`'s reachability table is its cost.

**One loop exists and is detected in both branches.** The control plane produces the attestations whose absence causes the audit plane to publish the stall signal, so the consumer of the corroboration is the producer of its input: ceasing to attest *causes* the corroboration it then consumes. `I17f(b)` catches it — a published stall with no journaled `AUDIT_MIRROR_DEGRADED` declaration raises `ATTESTATION_DIVERGENCE` at CRITICAL — and if the control plane journals the declaration to satisfy (b), it has entered the degraded path openly, owner-visible in V7's side-by-side display, having stopped attesting, which is itself CRITICAL.

### 5.7.1 The `MirrorInputStallSignal` contract (v1.3, TA-06)

The transition that unlocks the only dispatch relaxation in the architecture had an undeclared operand: v1.2 said the control plane enters `CORROBORATED_DEGRADED` on *"the audit plane's own signal"* and declared no endpoint, no transport, no authentication, no signature and — the load-bearing one — no freshness. Registry rule 6 applied to a state transition.

```
MirrorInputStallSignal {
  signal_id          UUID              -- unique per issuance; never reused
  company_id
  observed_at        timestamptz       -- audit-plane clock, RFC 3339 UTC, 6 fractional digits
  interval_start     timestamptz       -- start of the stall interval this signal covers
  last_attestation_seq        BIGINT   -- the newest max_journal_seq the audit plane received
  last_attestation_received_at timestamptz
  reason             enum { ATTESTATION_STALL, PUSH_PATH_UNREACHABLE, STORE_WRITE_REJECTED }
                                       -- STORE_WRITE_REJECTED is derived under §5.7.1a and nowhere else
  expires_at         timestamptz       -- observed_at + max_age
  audit_instance_id                    -- which audit-plane instance issued it
  signature          bytea             -- Ed25519 over ACOS-JCS-1 canonical bytes of the fields above
}
```

| Property | Declaration |
|---|---|
| **Signer** | The audit plane, under an Ed25519 key generated on and never leaving the audit-plane host. The control plane holds **only the public key**, distributed as control artifact class 24 (`50 §2`) and hashed into the owner-signed manifest, so a substituted public key is an `I19` mismatch. |
| **Endpoint** | The audit plane's own read endpoint on its own host (`§5` *Own read path*, the same host that serves V7): `GET /audit/v1/mirror-input-stall?company_id=…`. It is a **read** endpoint; the audit plane never pushes and never initiates a connection to the control plane. |
| **Transport** | HTTPS, control plane → audit plane, pull only. The control plane authenticates with a read-only bearer credential scoped to this endpoint and to V7. **The audit plane accepts no writes on this path**, so the fetch opens no new suppression channel and `58 §13` condition 2 is not engaged. |
| **Issuance** | Issued when the audit plane's own checks establish a stall condition, and **re-issued every `attestation_cadence` (5 minutes) for as long as the condition holds**, each issuance carrying a fresh `signal_id` and `observed_at`. No signal is issued when no stall condition holds. |
| **`max_age`** | **5 minutes** = `attestation_cadence × 1`, `CONFIGURED`. Strictly less than `attestation_cadence × k` = 15 minutes, as required, and equal to the re-issuance interval so a control plane in a live corroborated stall always holds a valid one. |
| **Freshness rule** | `now() − signal.observed_at ≤ max_age` **and** `now() < signal.expires_at`, evaluated on the **control database clock** (`36 §6`'s clock rule). A signal failing either test **cannot enter the state machine**; the state remains or reverts to `UNCORROBORATED_STALL`. |
| **Replay protection** | `signal_id` is recorded in the journal on consumption; a `signal_id` already consumed cannot re-enter the state machine. Independently, `I17f(a)` evaluates every `DISPATCHED_UNMIRRORED` dispatch timestamp against the audit plane's **own record of the intervals it published**, so a dispatch justified by a replayed signal is a critical incident on a fact the control plane does not hold and cannot rewrite. |
| **Minting and extension** | Structurally unavailable to the control plane: it holds no private key. Extending a signal's life by rewriting `expires_at` breaks the signature. Extending it by holding it is bounded by `max_age`, evaluated at every state evaluation and not only at entry. |
| **Operand of the transition** | `max_age` is a declared operand of the `→ CORROBORATED_DEGRADED` transition under registry rule 6, and appears on `I17f`'s operand block. |

**Provisioning.** The signing key and the read endpoint are part of audit separation, not part of the S1 build, and `62 §7` authorises provisioning them now.

**What this does not deliver, stated where the claim is made.** A signed signal makes corroboration unforgeable. It does not make it *available*: in a partition or an audit-plane outage the signal cannot be fetched, `CORROBORATED_DEGRADED` is unreachable, and the answer is `UNCORROBORATED_STALL` plus the override. `§5.6`'s reachability table is the complete statement.

### 5.7.1a `STORE_WRITE_REJECTED`, derived (v1.3.3, S1H-C8)

**The defect.** `§5.7.1` declares `reason enum { ATTESTATION_STALL, PUSH_PATH_UNREACHABLE, STORE_WRITE_REJECTED }` and declares a derivation for the first two only. The third had none, and the single reading a reader would reach for — insert-quota saturation — is **explicitly forbidden as a mode change** by `§5.1` item 5 and by `§5.6`'s reachability table. So the member was either dead or a route by which a refusal could be converted into a relaxation. S1H refused to derive it and reported the leg PARTIAL (`S1H-owner-clarifications.md` S1H-C8). This section is the owner disposition: the member is **kept** and given a **closed, audit-owned, narrow** derivation.

**`STORE_WRITE_REJECTED` is an AUDIT-OWNED derivation.** The control plane cannot cause it, cannot claim it and cannot assert it. It is derived on the audit plane, from the audit plane's own observation of its own ingress path, and it reaches the control plane only inside a signed `MirrorInputStallSignal` subject to `§5.7.1`'s signature, freshness, company and reason binding, unchanged.

#### The predicate, closed and conjunctive

> The audit plane may derive `cause = STORE_WRITE_REJECTED` for a company if and only if **all ten** of the following hold of one control→audit replication attempt:
>
> 1. the attempt **actually reached audit ingress** — the audit plane executed its ingest entry point for this attempt, rather than inferring an attempt from a silence;
> 2. **replication identity and authentication succeeded** — the attempt arrived as the scoped replication principal;
> 3. the **structured record is admissible** — every declared field present, typed and within its declared domain, and the row kind is one the store declares;
> 4. **`ACOS-JCS-1` reconstruction succeeded** — the audit store's own canonicalisation of the structured fields completed;
> 5. every **transmitted / canonical / row-hash check required before storage succeeded**;
> 6. the attempt is **not a conflicting sequence collision**;
> 7. the attempt is **not an exact benign duplicate**;
> 8. **audit insertion quota is available** for the principal in the current window;
> 9. the audit plane **attempted the required audit-store write**; and
> 10. that write **could not commit because of a STORE-WRITE AVAILABILITY failure**, classified by trusted audit-side code as the semantic class `AUDIT_STORE_WRITE_UNAVAILABLE` below.
>
> Conditions 1–8 are the conditions under which the store would otherwise have **accepted** the row. The member therefore names exactly one situation: **an otherwise-valid, authenticated, in-quota row that the audit storage layer could not durably accept.** Any failure of any one of the ten yields **no** `STORE_WRITE_REJECTED`, and the observation is disposed of as whatever it actually is.

#### The semantic failure class

> **`AUDIT_STORE_WRITE_UNAVAILABLE`.** The genuine inability of an otherwise healthy, authenticated audit ingress path to make a **valid** write durable, because the **audit storage layer is unavailable for writes.**
>
> **The architecture declares the semantic class. The storage implementation declares which of its concrete failures map into it.** The mapping must be a **closed enumeration**, documented at the point of implementation, tested, and **fail-closed for every unknown or unenumerated storage error**. The architecture does not depend on, and must not restate, a vendor-specific error-code list; conversely no implementation may widen the class by mapping a code the architecture's definition does not cover. For each mapped failure the implementation must state **why it is a store-availability failure rather than a security, integrity or policy failure.**

#### Excluded, exhaustively

> The following **MUST NOT** produce a corroboration-capable `STORE_WRITE_REJECTED` cause. Each is already a declared outcome or a declared incident, and each keeps its existing disposition:
>
> audit insert-quota saturation · malformed payload · unsupported row kind · `ACOS-JCS-1` canonical mismatch · row-hash mismatch · predecessor / hash-chain mismatch · sequence collision · exact benign duplicate · invalid credentials · invalid signature · insufficient privilege or unauthorised principal · policy rejection · caller cancellation · a control-side timeout **before audit ingress observed the attempt** · a serialization failure that is still retryable · a deadlock · any unknown or unclassified storage error.
>
> **Existing security and integrity incidents remain incidents.** They do not become a route to degraded-mode relaxation, and the exclusion is normative rather than advisory: an implementation that mapped any of them into the class would be converting a refusal into a relaxation, which is `52 §1` Path B arriving through the audit plane's own enum.
>
> **AUDIT QUOTA SATURATION REMAINS INCIDENT-ONLY AND MUST NEVER CHANGE MIRROR MODE.** `§5.1` item 5: *"Audit-store saturation is an incident, not a mode change (I17c)."* `§5.6`'s reachability table says the same. v1.3.3 changes neither, and the exclusion above is the mechanical statement of both.

#### What this does not create

> **It creates no new state and no new relaxation.** A `STORE_WRITE_REJECTED` signal is an ordinary `MirrorInputStallSignal`: it enters the state machine only if it is genuinely signed by the audit key, fresh under `max_age`, bound to this company, and held against an **open control-side declaration** (`§5.6`). It confers exactly what `ATTESTATION_STALL` confers and nothing more.
>
> **It is narrow, and the narrowness is honest.** The audit plane must be able to write its own interval and signal rows in order to publish anything at all, so the derivation is reachable only where the storage layer is unavailable for the **journal holdings** while the audit plane's own tables remain writable — a per-tablespace or per-relation write failure. Where the whole store is unavailable for writes, nothing is published and the answer is `UNCORROBORATED_STALL` plus the override, exactly as `§5.6`'s reachability table already says. `§5.6`'s table gains one row for this case.

### 5.7.2 `DegradedModeOverride`: the escape, specified (v1.3, TA-05)

**Why this is here.** SR-A2 made the owner override the **sole** escape from a state the design deliberately made stricter, and v1.2 specified none of it. `30 §5.1` item 5, `22 §3.1`, `35 §12.1` and `36 §6` between them said only that it is journaled, displays the affected classes and the elapsed clock time, and changes no ceiling. AUD-07's own words — *"the override is a single act with no declared scope, no expiry and no cap"* — were still true, and the ledger recorded AUD-07 as closed. It is kernel state now.

```
DegradedModeOverride {
  id                        UUID PK
  company_id                                          -- per company; never global
  requested_at, requested_by
  granted_at, granted_by                              -- OWNER-tier principal
  second_approver, second_approved_at                 -- NULL only where the rule below permits
  effect_classes[]                                    -- explicit enumeration from the action catalogue
  recoverability_classes[]                            -- ⊆ { COMPENSABLE, REVERSIBLE }
  precedence_rows[]                                   -- ⊆ { 3, 4 } — see the scope rule
  starts_at, expires_at                               -- expires_at − starts_at ≤ max_override_duration
  effect_count_cap, effects_dispatched
  monetary_exposure_cap, monetary_dispatched
  reason                    text NOT NULL
  incident_ref              NOT NULL FK               -- the open incident it responds to
  status                    REQUESTED | ACTIVE | EXHAUSTED | EXPIRED | REVOKED
}
```

**Scope rule, and it is narrow.** An override may restore **precedence rows 3 and 4 only** — clock-bearing COMPENSABLE, and discretionary COMPENSABLE. It may **never** restore row 1 (IRRECOVERABLE) or row 2 (above-floor, not clock-bearing). `recoverability_classes[]` therefore excludes `IRRECOVERABLE` structurally at MVP, not by policy: there is no grant path that admits it. This keeps the halt boundary exactly where `§5.1`'s rationale puts it — unmirrored *and* unundoable is the combination the mirror exists for — and it means the override cannot become a general dispatch permit.

**Semantics.**

1. **It changes no ceiling.** Every effect dispatched under it still traverses the full policy sequence, still reserves, and is still bound by `I3`. The override releases a **dispatch gate**, never an exposure gate. `MAL_total` is unchanged by an override's existence and no re-signature is triggered — which is checkable, because every override limit in `51 §3.6` is strictly below the corresponding already-signed window ceiling.
2. **Time-boxed.** `expires_at` is mandatory and bounded by `max_override_duration`.
3. **Count-capped and monetary-capped.** `effects_dispatched` and `monetary_dispatched` are incremented in the dispatching transaction; reaching either cap moves the override to `EXHAUSTED` immediately.
4. **Auto-expiry is to the restrictive state, never to `NORMAL`.** On `expires_at` or exhaustion the system returns to whichever of `UNCORROBORATED_STALL` or full halt the underlying condition implies. An override never certifies that the mirror recovered.
5. **Every dispatch under it is tagged** `DISPATCHED_UNMIRRORED` **and** carries `override_id`, so the two are distinguishable in the mirror and in `I8`'s verification list.
6. **Every dispatch under it enters `I8`'s additive verification list** (`§5.10`), exactly as any other `DISPATCHED_UNMIRRORED` effect.
7. **Creation, grant, second approval, each cap decrement, exhaustion, expiry and revocation are journaled**, each as its own row.
8. **Owner display.** The grant bundle and V2 show, for every affected clock: elapsed statutory-clock time and time remaining; the affected effect classes; the caps and the amount consumed; and an explicit statement that **audit-side state is unavailable** — rendered as *unavailable*, never as blank and never as agreement (`30 §3` V7's degradation rule).
9. **Second approver.** The **first** override inside a rolling 30-day window requires the owner alone. **Every subsequent override inside that window requires a distinct second approver** — a registered OWNER-tier principal that is not `granted_by`. The registered approver set is a control artifact.
10. **Composition is bounded by `I63`**, over a rolling 30-day window, across duration, count, effect count and monetary exposure. Rotating action classes, expiry-and-recreation and establishing a durable degraded posture are each bounded by the aggregate legs rather than by the per-override legs.

**Limits — `51 §3.6`, `DESIGN LIMIT — OWNER SIGNED`, non-production MVP values.**

| Quantity | MVP value |
|---|---|
| `max_override_duration` | **24 hours** |
| `max_override_effect_count` | **5** |
| `max_override_monetary_exposure` | **$50.00** |
| `max_override_count(30-day rolling)` | **3** |
| `max_cumulative_override_hours(30-day rolling)` | **72 hours** |
| `max_cumulative_override_effects(30-day rolling)` | **8** |
| `max_cumulative_override_monetary(30-day rolling)` | **$100.00** |
| `second_approver_required_from` | the **2nd** override inside a 30-day rolling window |

**The honest consequence, because `62 §11` condition 10 asks whether a value exists that is both safe and usable.** *Safe:* the aggregate caps are strictly below the already-signed monthly ceilings they draw against — $100.00 against `W_MONTH_REFUND`'s $250.00, 8 effects against its count of 10 — so no override or sequence of overrides can raise realisable loss above the signed `MAL_total`. *Usable:* one override covers 24 hours of a provider outage, and three cover 72. **And at MVP there is exactly one registered OWNER-tier principal, so overrides 2 and 3 are structurally unavailable until a second approver is registered — which makes the practically available escape 24 hours, 5 effects and $50.00.** An outage longer than 24 hours therefore ends in a statutory breach unless the owner registers a second approver principal first. That is a real limitation, it is an owner decision rather than an engineering one, and it is recorded as the residual on TA-05 rather than resolved by relaxing the bound.

### 5.8 The anchor medium (v1.2)

`I17b` requires anchoring to *"a medium the operator cannot rewrite"* and v1.1 named none, which makes the invariant unimplementable as written. Candidates, with the property each actually delivers:

| Candidate | Delivers | Does not deliver |
|---|---|---|
| Email to the owner's independently-controlled mailbox | Owner-held copy, out-of-band | Not tamper-proof; the owner must retain it |
| A third-party transparency log or timestamping service (RFC 3161) | Third-party attested time and content | A dependency and a cost |
| Object storage with **object lock / WORM** on a third account | Operator-resistant retention | Same-cloud correlation unless a different provider |
| Public chain anchor | Strongest immutability | Cost, and it publishes a hash of private activity |

**MVP selection: the owner mailbox copy plus WORM object storage on a separate provider**, both hourly, both carrying `{head_hash, chain_seq, row_count}`. Two independent media, neither of which the control plane can rewrite, and the owner holds one of them personally. The selection is a control artifact and appears in `50 §2`. **`58 §9` records provisioning the separate audit account as permitted-but-not-performed at this phase.**

---
### 5.9 What the hash chain proves, precisely

Stated because a chain creates confidence in proportion to how impressive it sounds.

- **Proves:** no row present in the chain has been altered, removed or reordered *after insertion*, by any principal holding only `INSERT`.
- **Does not prove** that inserted content is true. A control plane with `INSERT` rights writes plausible false rows freely. Truthfulness comes from I8's independent vendor reads and I4's three-way settlement tie.
- **Does not prove completeness.** Omission leaves no trace. **v1.2: I17 bounds *transport* omission and I17e bounds it to 15 minutes for an honest attester; only I8's independent vendor reads bound omission at the source** (§5.5 cases 2b and 4). **v1.3 (TA-01): the 15-minute bound holds against transport loss and a third-party truncation. It does not hold against the attester itself. A control plane that freezes its own attested prefix satisfies I17 and I17e indefinitely, and for the class of suppressed rows with no vendor counterpart there is no detector at all** (registry `§3` item 9).
- **Does not prove liveness.** A chain that stops growing is indistinguishable from a chain with nothing to add. I17e and `ATTESTATION_STALL` are what make *channel* silence visible — not journal liveness, which the audit plane has no independent reading of.
- **Proves nothing at all** if the writer computes the hashes. I17d.
- **Proves nothing across two databases unless both canonicalise identically.** `ACOS-JCS-1`, §5.3.
- **External anchoring adds** a bound on retroactive rewrite by a principal holding DDL or by the database operator: **maximum undetectable rewrite window = the anchor interval**, one hour.

---
### 5.10 `I8`'s inverse sweep: cadence, scope and the detection bound (v1.3, TA-02, TA-03)

v1.2 relocated the unqualified completeness claim onto `I8` and gave it no bound. `§5.5` case 4's bound column read *"Inverse-sweep cadence"* — the name of a quantity no artifact declared — and `I8`'s enforcement column read `SCHED (inverse sweep)` with no interval. Registry rules 5 and 6, violated in the invariant carrying the package's strongest audit claim. And `I8`'s tag-set sentence admitted a reading in which the tag set **scoped** the sweep, which composed with a missing tag to produce zero coverage. Both are closed here.

**The sweep enumerates the vendor side independently. The tag set is additive and never scoping.**

> `I8`'s sweep enumerates the audit plane's **own vendor reads exhaustively over the period since the previous sweep**, subject to the coverage limits declared on the invariant's row. The `DISPATCHED_UNMIRRORED` tag set — including every effect dispatched under a `DegradedModeOverride` — is an **additional mandatory verification list**, every member of which must be found present and correctly recorded. **It is never a restriction of the sweep's scope. The sweep's external query is never restricted to ACOS-provided effect identifiers or tags.**

The audit side discovers external activity first and compares to ACOS's record afterwards. The comparison runs in both directions: vendor activity with no ACOS journal row is the `I8` violation; a tag-set member with no vendor-side counterpart is a separate finding routed the same way. **CI and review assertion:** the sweep implementation's vendor query must be **period-bounded**, and a query parameterised by an ACOS-side identifier set fails review. This is an `I19`-covered property of the sweep specification, class 26.

**Configured sweep cadence, per adapter.** `CONFIGURED`, declared here and instantiated in `51 §3.2`. The scheduling owner is the **audit plane**, on its own host's scheduler, under its own credentials. The control plane cannot defer, skip or reschedule a sweep; a missed sweep is an audit-plane incident.

| Adapter | Sweep cadence | Why this value |
|---|---|---|
| Processor (`stripe`) | **1 hour** | Balance transactions are queryable within seconds of the event, so cadence is the whole bound. One hour aligns with `I17b`'s anchor interval: an omission detector slower than the rewrite detector would make the slower bound govern everything. |
| Commerce (`shopify`) | **1 hour** | Same reasoning; order, refund and fulfilment mutations are immediately queryable. |
| ESP | **1 hour** | Feeds `I20`'s accepted-message reconciliation, whose subject — a duplicate irrecoverable send — is the fastest-moving irrecoverable class. |
| `google_ads` | **6 hours** | Ads reporting is not final on retrieval and the vendor's own reporting settlement dominates. A cadence shorter than the reporting lag produces reads whose content cannot have changed, consuming quota to buy detection latency it cannot deliver. Re-derived downward once `vendor_reporting_lag` is measured. |
| Any newly registered adapter | **1 hour**, unless a longer cadence is declared here with provenance | Fail-fast default; a longer value is an explicit act. |

**The detection bound, with every operand's provenance.**

```
I8_detection_bound(adapter) = I8_sweep_cadence(adapter) + vendor_reporting_lag(adapter)
```

- `I8_sweep_cadence` — **`CONFIGURED`**, the table above, `51 §3.2`.
- `vendor_reporting_lag` — **`UNMEASURED`** for every adapter, `IMPLEMENTATION_VALIDATION_REQUIRED`. It is the interval between a vendor-side event occurring and its appearance in the read surface the audit plane queries. **It is not the same quantity as the cessation specification's reporting settlement latency** — that one is about spend *reporting settling to a stable figure after a pause*, this one is about *first appearance* — but they are measured against the same surfaces and `62 §10` obligations 8 and 9 are run together at S3.
- **The sum is the bound. It is not currently a number, and no artifact may state it as one.** Every site that previously read *"inverse-sweep cadence"* now reads the sum with both operands named.

**Two consequences worth stating where the claim is made.**

1. **At S1, `I8` proves nothing.** All four MVP action classes run against mock adapters, so there is no vendor side to enumerate. `37` S1 says so in v1.3. `I8` becomes a real detector at S3 against sandboxes and at T3 against real accounts, and until then case 2b and case 4 have **no operative detector at all**.
2. **The binding relationship for the attestation cadence is not the anchor interval** (v1.3, A2). `attestation_cadence × k < anchor_interval` is a necessary consequence, not the constraint that binds. The three that bind are: `k × cadence` against the fastest irrecoverable dispatch path (15 minutes is 10 discretionary emails at `W_DAY_MIE`'s ceiling); `k × cadence` against `I17f`'s own evaluation interval, **declared here as 15 minutes** so a 15-minute stall detection is not fed into an hourly corroboration check; and `k × cadence` against `I8`'s sweep cadence, since `I8` is the backstop for everything the transport checks miss.


---
## 6. The four audit classes

Phase 2 brief Part 18 asks which audits are continuous deterministic, scheduled AI, independent model evaluation, and human review. Assigning them by kind is the point: putting a model on a check that has an enumerable answer adds cost and an injection surface for nothing (EM5).

### 6.1 Continuous deterministic invariants

Run on every write or on a tight schedule. Fail loudly. **These are the backbone.**

**v1.1: this section is no longer the definition of the invariant set.** `phase2-v1.3-invariant-registry.md` is the single authoritative table, with one owner and one enforcement location per identifier (the v1.1 pass introduced the registry; v1.3 is the current issue and supersedes the v1.1 and v1.2 files). v1.0 defined I1–I16 here and four other documents disagreed with it: `28 §4`, ADR-007, `35 §8` and `36 §12` treated **I7** as the tolerance-rule check while this section defined I7 as the MAL sum and **I12** as the tolerance check; `33 §6` and ADR-013 called chain verification **I1** while this section defined I1 as authorisation coverage; `35` cited nine identifiers under numbers matching nothing here; and `37 §3` enumerated a six-invariant MVP subset under a third numbering. The registry resolves all of it, and properties that other documents cited under wrong numbers were given **new** identifiers (I41–I50) rather than renumbering the existing set, because renumbering is how drift starts.

**Three amendments to the identifiers this section defined.**

| ID | v1.0 | v1.1 |
|---|---|---|
| **I7** | `Σ live grant ceilings == MAL` as displayed, with an owner signature | `Σ live grant window ceilings == MAL_monetary(w)`, **and** `MAL_total(w) = MAL_monetary + MIE_cost + Standing` recomputes from the same registry, with a **CI check that the displayed value equals a second implementation's recomputation** from `51-limits-fixture.md`. I7 would have caught v1.0's `37 §5` arithmetic and was never run against it. |
| **I8** | No effect exists in the external system that ACOS did not journal (inverse sweep, `25 §8.3`) | **Relocated to the audit plane and strengthened**: evaluated from the audit plane's own independently provisioned read credentials. v1.0 listed it here as an audit invariant while `25 §8.3` implemented it in the control plane — worthless under control-plane compromise, and reporting the adapter's own account under mere adapter compromise (AUDA-10). |
| **I15** | No principal holds a credential scope covering a prohibited action class | **Replaced** with a continuous empirical probe: for each prohibited class with a reachable vendor endpoint, a scheduled attempt against a sacrificial resource must fail vendor-side. **A succeeding probe is a critical incident.** As written I15 compared ACOS's own scope labels to ACOS's own prohibition list and passed vacuously (CRD-07). |

**I12 is the tolerance-rule temporal check.** Not I7. Every citing document has been corrected.

**The audit-plane-owned subset** — the invariants this plane computes rather than merely records, per the registry's ownership column:

I4 (independent recomputation) · I7 (verify side) · I8 (inverse sweep from own reads) · I11 · I12 · I15 · I17 · I17b · I17c · I17d (jointly with control) · **I17e** · **I17f** · I18d (settlement side) · I19 (independent recompute) · I20 · I22 · I33 · I38 · I40 · I41 (mirror side) · I45 · I47 · **I54** (both cessation-verification reads — added v1.3 by `I54`'s restatement, TB-12; the list and the registry's `§0` count both missed it until v1.3.1).

**Twenty-three of the registry's seventy are owned or co-owned here** — `23 + 47 = 70`, the arithmetic displayed because `analysis/v1.1-internal-consistency-pass.md` found arithmetic errors in a registry's own counts (v1.3.1, TOS-03; v1.1's *"twenty of fifty-two"* was stale in both terms) — and that is the point of the plane. The remainder are control-plane properties the audit plane *verifies* rather than *computes*.

**A failed invariant is an incident, not a log line.** I3, I5, I7, I15, I17, I17e, I17f, I18b, I19, I51 and I25 failing are **security incidents** specifically — they indicate the control model itself has been breached rather than that an operation went wrong.

### 6.2 Scheduled deterministic analysis

Statistical rather than boolean. Weekly or on threshold.

Spend anomaly detection against the trajectory model; reservation-velocity anomalies; denial-rate spikes by principal and reason; escalation rate and precision; exception rate by capability; abandonment rate; effect verification latency; discrepancy ageing; **decision-to-outcome tracking** — for each decision with a stated expected effect, did it occur; forecast calibration scoring; approval dwell time and approval-without-inspection rate; model cost velocity; **repeated failed experiments on the same hypothesis** (a sunk-cost detector).

### 6.3 Scheduled AI review

An audit reviewer with a **separate model binding**, reading only append-only records, writing only findings. Its scope is the work with no enumerable answer:

- **Unsupported claims** — decisions whose rationale asserts more than the frozen evidence set supports.
- **Confirmation bias** — evidence sets that are systematically one-sided relative to what the store contains.
- **Bad attribution** — outcome claims that do not follow from the causal chain.
- **Stale strategy** — objectives unchanged while their underlying assumptions have been contradicted.
- **Sunk-cost behaviour** — continued investment against a stated reconsideration trigger that has fired.
- **Self-serving interpretation** — CEO narrative diverging from the metric layer in a consistent direction.
- **Omitted bad news** — beyond §7's deterministic diff, whether referenced items were materially addressed or merely name-checked.

**Its outputs are findings, not verdicts, and never actions.** It has no `propose_intent` capability at all.

### 6.4 Human review

Quarterly, plus triggered by: any I3/I5/I7/I15 failure; any autonomy promotion to L3 or above; any unresolved discrepancy above a threshold; any realised loss above a threshold; any platform notice; any model-binding change affecting a capability at L3+.

**And one item the evidence specifically demands.** `21 §2` item 16 records that a silent partial remediation entered the Phase 1 package with no change record, and a second instance occurred inside Phase 1R — *"two auditability failures in the audit trail are more decision-relevant than several of the items in the table above."* The corresponding operating control: **quarterly human review includes a diff of the policy set, the action catalogue, the grant registry and the metric specs against the previous quarter, with every change matched to a change record.** An unmatched change is a finding of the same class as the one Phase 1R found in itself.

## 7. Detecting the specific failures the brief names

| Failure | Detector | Class |
|---|---|---|
| Unsupported claims | Evidence-coverage computation + AI review | Deterministic + AI |
| Inaccurate financial conclusions | Numeral-to-metric-reference validation (hard failure) | Deterministic |
| Bad attribution | Causal-chain traversal; CLAIM-grade ROAS never presented as OBSERVATION | Deterministic |
| Confirmation bias | Evidence-set one-sidedness vs store contents | AI review |
| Runaway spending | Reservation velocity, trajectory deviation, window utilisation | Deterministic |
| Repeated unsuccessful experiments | Hypothesis-recurrence analysis across experiment records | Deterministic |
| Sunk-cost behaviour | Reconsideration-trigger firing without a corresponding decision | Deterministic |
| Misleading KPIs | Counter-metric divergence | Deterministic |
| Hallucinated evidence | Citation resolution + content-hash + quote-span match | **Deterministic** — `11 E8` pre-registers fabrication at 0% |
| Policy violations | I1–I16 | Deterministic |
| Unauthorised activity | I8 inverse sweep; denial-spike analysis | Deterministic |
| Stale strategy | Objective assumptions vs contradicting facts | AI review |
| Conflicting records | `Contradiction` objects | Deterministic |
| Unreported failures | Adverse-facts diff (`27 §5`) | Deterministic |
| Excessive model/software cost | V8 with per-function attribution | Deterministic |
| CEO self-serving interpretation | Narrative-vs-metric divergence, directional | AI review + deterministic |

**Note the balance.** Eleven of sixteen are deterministic. That is EM5 applied to the audit function itself: an audit that is mostly a model is an audit whose findings are as trustworthy as the thing it audits.

**v1.1: four detectors added, all deterministic** (R3, R10, R11, R13).

| Failure | Detector | Class |
|---|---|---|
| An external effect ACOS never journaled | I8's inverse sweep, run in the audit plane from its own vendor reads, **period-bounded and independently enumerated**, at the per-adapter cadence in `§5.10`; bound = `sweep_cadence + vendor_reporting_lag` | Deterministic |
| Audit rows omitted rather than altered **by transport or a third party** | I17's two-sided completeness diff; I17b's `row_count` anchor for tail truncation | Deterministic |
| **Audit rows omitted by the attesting party, with the attested prefix frozen** (v1.3, TA-01) | **`I8` only, and only for rows with a vendor counterpart.** No detector for the rest — registry `§3` item 9 | Deterministic, partial |
| **An effect dispatched inside a published stall interval carrying no tag** (v1.3, TA-04) | `I17f(c)`, audit-plane owned, at the 15-minute evaluation interval | Deterministic |
| A control artifact modified out of band — a template, the grammar, a detector pattern, a promoter rule, a metric spec, a tolerance rule, an adverse-facts threshold | I19's manifest hash comparison, halting effects in the affected class | Deterministic |
| A duplicate irrecoverable send | I20: provider-reported accepted messages ≤ reserved irrecoverable units, reconciled from the audit plane's own ESP credential | Deterministic |

All four were absent from v1.0, and `45 §5` identifies them as *"four of the most important invariants… not in the set of sixteen at all."*

---

# Part III — Escalation architecture

## 8. Escalation as a first-class entity

```
Escalation {
  id, company_id, class, urgency, opened_at,
  trigger,                 // MANDATORY_RULE | THRESHOLD | DISCRETIONARY | INVARIANT_FAILURE
  statutory_clock?         { obligation, deadline, warning_at },
  owner,                   // who must act — a person, not a queue
  state,                   // OPEN | ACKNOWLEDGED | AWAITING_EXTERNAL | RESOLVED | EXPIRED
  evidence_bundle_ref,
  blocked_work_item_refs[],
  recommended_resolution?, // AI-drafted, clearly labelled
  resolution               { action, actor, at, rationale },
  sla_breaches[]
}
```

## 9. Reasons, mapped to triggers

| Reason | Trigger class | Urgency | Detected by |
|---|---|---|---|
| Policy requires human | MANDATORY | Per class | Policy engine |
| Authority exceeded | MANDATORY | Medium | Policy engine |
| Confidence insufficient / grounding coverage below threshold | MANDATORY | Low–medium | Context assembler, **pre-generation** |
| Contradictory data on a load-bearing fact | MANDATORY | Medium | Contradiction detector |
| **Legal threat** | MANDATORY | **Critical** | Pre-generation detector (`26 §9.4`) |
| **Privacy request (DSAR/CCPA)** | MANDATORY + clock | High | Pre-generation detector; clock at 25 days (GDPR) / 40 days (CCPA) |
| **Chargeback / dispute** | MANDATORY + clock | High | Processor webhook; evidence window <5 days |
| New supplier relationship | MANDATORY | Medium | Policy |
| **New payee / bank details** | **Prohibited, not escalated** | — | It never becomes a proposal |
| Physical quality / first sample sign-off | MANDATORY | Medium | Product-introduction workflow |
| **Security incident** | MANDATORY | **Critical** | Invariant failure; 72h GDPR Art. 33 clock starts on awareness |
| Model disagreement above threshold | MANDATORY | Medium | Dissent record |
| Repeated workflow failure | THRESHOLD | Medium | Dead-letter rate |
| Unresolved discrepancy past SLA | THRESHOLD | High | Reconciler |
| Runway below floor | THRESHOLD | High | K6 |
| Ungated-action count approaching ceiling | THRESHOLD | Medium | K5 |
| Autonomy demotion | THRESHOLD | Low–medium | Autonomy ledger |
| Platform notice / trust-tier change | MANDATORY | High | K14 |
| Product-safety complaint, threats/abuse, media enquiry, account-security event | MANDATORY | Critical | Pre-generation detector |
| Discretionary | DISCRETIONARY | Low | CEO or worker |

**Mandatory triggers are deterministic and run before any model sees the content.** A model cannot suppress, downgrade or fail to raise them, because it is not the detector. This is `26 §9.4`, and it is the difference between an escalation policy and an escalation architecture.

### 9.1 The statutory-clock contract (v1.2, SR-A2)

`§5.1`'s precedence row 3 privileges clock-bearing COMPENSABLE effects over the mirror, so **the statutory clock is a lever on the audit plane** and its provenance is a security property rather than a compliance detail.

```
Clock { id, statute, case_ref, started_at, deadline_at,
        source_record_ref }          // MANDATORY, RECORD grade
```

`I56` (RECORD-grade): a clock may be created, extended or restarted **only** by citing a RECORD-grade fact — the processor's refund request object, the GDPR erasure request as received at the ingress, the platform's own dispute record. **No OBSERVATION, no CLAIM, no `DECISION_DELEGATED` fact may start a clock**, and no model-authored summary may. `I28`'s and `I29`'s gates (policy steps H′ and G) apply to the citation exactly as they apply to any other precondition.

Without this, a model that can cause a clock to exist can manufacture the row-3 exemption it wants. With it, and with `§5.6`'s inversion, both ends of the lever are closed: the clock cannot be fabricated, and the state in which the clock buys a relaxation cannot be self-declared.

**v1.3.4 (CSB-01) closes the third end: clock SELECTION.** `I56` bounds which facts may *create* a clock. It says nothing about which clock an effect *reads*, and v1.3.3 declared no relation between an effect and a `case_ref` at all — so row 3's operand was answerable only by guessing, and a guess a caller or a model can steer is the same lever from the other side. **`§9.2` declares the binding, its kernel ownership, its immutability, its transaction, the NULL case, the claim-time derivation and the deterministic selection when several live clocks qualify.**

### 9.2 The effect→case binding, and claim-time clock derivation (v1.3.4, CSB-01, S1I-C1)

**The defect.** `§5.1` item 4 row 3's operand is *"a **live** statutory clock citing a RECORD-grade fact"*, and `§9.1`'s `Clock` is keyed on `case_ref`. So the operand is answerable only as *"is there a live RECORD-backed clock for **this** `case_ref`"*. **v1.3.3 related a `case_ref` to nothing.** Not `§9.1`, not `§5.1`, not `26 §5`, not `26 §2.1`'s `AuthorizationRequest` field list, not `24 §3` K10, not `24 §4`'s ERD. `case_ref` was a free identifier in the clock table and no artifact resolved one from an effect, an authorisation, a `resource_ref` or a `task_id`.

**Why that is a security defect and not an omission.** `§9.1` states the property itself: *"the statutory clock is a lever on the audit plane and its provenance is a security property rather than a compliance detail [...] a model that can cause a clock to exist can manufacture the row-3 exemption it wants."* `I56` closes clock **creation**. It does not close clock **selection**. A COMPENSABLE discretionary effect suspends at row 4; the same effect, clock-bearing, dispatches at row 3. **So a `case_ref` chosen by a caller at claim time — or guessed by the kernel from a `resource_ref`, a customer identifier or a similar order — is the same lever reached from the other end: a model that can make the kernel look up the WRONG clock obtains the exemption without needing to create one.**

**Provenance.** Reported during S1I as `S1I-owner-clarifications.md` S1I-C1, which took the stop `§51` of that mandate directs: the operand was hard-coded `false`, row 3 was made unreachable at claim time, and the leg was reported PARTIAL in the fail-closed direction rather than guessed. This section is the owner disposition, and **row 3 is not intentionally unreachable.**

#### 9.2.1 The binding, declared

> **`effect.case_ref : CaseRef | NULL`.**
>
> **KERNEL-OWNED. IMMUTABLE. NEVER MODEL-SUPPLIED.**
>
> For a case-associated effect, `case_ref` is **inherited from the authoritative originating task**: `24 §3` K7 owns task records, the task carries the case it is running under, and the kernel stamps the effect from it. `task.case_ref` is likewise kernel-owned; K7's *"What AI may not do"* extends to it, exactly as `24 §3` K10 already forbids a model to *"create a clock, or influence the fact a clock cites"*.
>
> **It MUST NOT come from any of:** `ProposedIntent`; `rationale`; the dispatch payload; a free-text reason; a model classification; a caller-supplied claim-time argument; inference from a customer identifier; inference from a similar order; or an arbitrary resource lookup selected at claim time. **None of these is a permitted source, and a `case_ref` parameter on a claim surface is a defect of the same class as a caller-supplied `clockBearing` boolean.**
>
> **It is not a model-facing field.** `26 §2.1`'s `AuthorizationRequest` is *"every field below is kernel-computed"*; `case_ref` joins it under that heading, alongside `principal` and `recoverability`, as authority **provenance**.

#### 9.2.2 Lifetime, and the transaction

> **The binding is established no later than the creation of the authoritative local effect**, in the same transaction that creates it.
>
> `task.case_ref` → kernel canonical/authorisation context → **immutable `effect.case_ref`**.
>
> **This is authority provenance that a later dispatch decision depends on**, so it belongs inside the one transaction `25 §12` and `26 §7` step T already commit the effect in. A **post-hoc mutable mapping is forbidden**: a mapping that can change after authorisation can change *which statutory clock applies* to an already-authorised effect, which is the row-3 lever restated as a write.
>
> **For a case-associated effect, the effect row and its `case_ref` commit together or neither commits.** No crash window may leave a committed effect with a missing or later-written case binding.

#### 9.2.3 Effects with no case

> **`case_ref = NULL` is a declared, ordinary state.** An effect not associated with a statutory or customer case has no case binding, and none is invented for it.
>
> **For such an effect `clock_bearing` is `false`**, unless some other explicit current mechanism of this architecture declares a case binding — and at v1.3.4 none does.
>
> **A NULL `case_ref` never means "search for any clock that fits."** There is no global clock search, no nearest-case match, no fallback and no heuristic. Absence of a binding is a determinate `false`, not a query.

#### 9.2.4 Claim-time derivation: the clock is read now, not at enqueue

> **`clock_bearing` is derived at the decision instant from CURRENT authoritative clock state.** It is never read from an enqueue-time boolean, never persisted as authority, and never accepted as a parameter.
>
> **The effect supplies exactly one thing: its immutable authoritative `case_ref`.** Everything else is read from the authoritative tables inside the deciding transaction. The qualifying set is:
>
> ```
> StatutoryClock.company_id = effect.company_id
>   AND StatutoryClock.case_ref = effect.case_ref        -- effect.case_ref IS NOT NULL
>   AND the clock is LIVE under 9.1's state              -- not closed, deadline not passed
>   AND its provenance satisfies I56                     -- source_record_ref resolves, RECORD grade
> ```
>
> **The boolean operand row 3 reads is `there exists at least one qualifying live clock`**, and nothing else. `clock_bearing` is not a stored column of `effect`, of the authorisation, or of any dispatch queue row.
>
> **Both directions are live.** A clock that opens between enqueue and the decision makes row 3 apply. A clock that closes, expires, or whose citation ceases to resolve, between enqueue and the decision makes row 3 stop applying. A process restart changes neither answer. **Failing to resolve is `false`** — the fail-closed direction, consistent with `I56`'s *"a clock with an unresolvable `source_record_ref` is a critical incident"*.

#### 9.2.5 Several qualifying clocks: deterministic evidentiary selection

> Nothing bounds the number of live clocks on one case at S1 — `phase2-v1.3-lower-severity-register.md` TA-08 schedules the volume rules at S5 and they are not brought forward here. So **the evidentiary clock must be selected deterministically**:
>
> 1. **earliest authoritative statutory deadline** (`deadline_at` ascending); then
> 2. **stable `clock_ref` ascending**, as the total tie-break.
>
> **The selection does not change the boolean.** The operand remains *"at least one qualifying live clock exists"*; the selection names **which** clock is recorded as the reason.
>
> **Where row 3 is the reason a dispatch decision resolved permissively, the selected `clock_ref` is persisted as evidence on that decision**, so that a later audit can answer: *which live statutory obligation justified this?* Where row 3 is not the reason, the field is **NULL or absent** per the declared schema.
>
> **The decision selects the clock. A caller never does.** A caller-supplied clock reference is the row-3 lever a third time and is refused structurally, not checked.

#### 9.2.6 What the binding does not touch

> **`case_ref` is authority provenance, not vendor data.** It does **not** enter the dispatch payload unless a constructor's own vendor semantics independently require it, and at v1.3.4 none does. Its existence changes no refund amount, no recipient, no payment instrument and no external vendor field. `26 §2.1`'s `DispatchPayload` field list is unchanged. **A support-case identifier must not leak to a vendor as a side effect of an audit binding.**
>
> **It does not change the effect idempotency key.** `25 §7`'s key is `H(task_id ‖ action_class ‖ resource_id ‖ semantic_param_digest)`. `case_ref` is a **function of `task_id`**, so two effects with different case bindings necessarily carry different `task_id`s and already have different keys; adding `case_ref` to the key would be redundant and would change every existing key for no property gained. **The key is unchanged, and this is a determination rather than an omission.**
>
> **It carries no new control artifact.** The binding is a schema relation and a kernel rule, not a signed quantity, a catalogue field or a canonicalisation rule.

#### 9.2.7 Obligation lineage

> `26 §12.3`'s `RemedyObligation` already carries `case_ref` and `clock_ref`. **Where a fresh proposal originates from a `RemedyObligation`, its task inherits that obligation's `case_ref`, and the resulting effect inherits it from the task by §9.2.1's ordinary rule.** The owner is not asked to re-enter it and no model re-derives it: `I58` exists so that a correctly-refused obligation is not stranded, and an obligation whose case lineage were dropped at re-proposal would be stranded in exactly the way `I58` forbids.

#### 9.2.8 Authority quantities

**NO CHANGE.** No ceiling, cap, floor, threshold, window or MAL term is altered. The binding decides *which* clock a row-3 evaluation reads; it reserves nothing and denies nothing.

## 10. The decision-ready bundle

`07 §5`, on Trail of Bits: human review fails when users *"are generally poorly equipped to identify subtle malicious modifications."* An escalation that presents an opaque payload is theatre. Every escalation carries, assembled deterministically:

1. **What is being asked**, in one sentence, from a template.
2. **What happens if you do nothing** — including whether a clock expires and what then.
3. **Exposure**: `vendor_amount` and **`total_exposure`** shown separately (`26 §2.1.1`), irrecoverable units, and **the `MAL_total` delta — mandatory, not conditional** (v1.2, SR-L4). v1.1 said *"the MAL delta if this establishes a precedent"*, and the qualifier is what `52 §1` Path A walked through: an `I32` headroom-starvation override changes no grant and sets no precedent, so under the conditional reading **no delta was displayed** and the owner raised a realisable loss ceiling while answering a liquidity question. The delta is now computed and displayed for **every** bundle; where it is zero, it says zero. An override that would activate a `W_*_OVERRIDE` window additionally displays the recomputed `MAL_total` against the signed figure and **requires re-signature** (`26 §10.3`).
4. **Recoverability** of the action, stated explicitly.
5. **The preconditions the engine verified**, with grades and ages.
6. **The evidence set**, with tiers, corroboration state, coverage figure, and any contradictions.
7. **Why approval was required** — the specific rule.
8. **What was already tried**, if this follows a failure.
9. **An audit-plane-computed "uncited and contradicting evidence" section** (v1.1, R16, APP-06). The bundle presents the frozen evidence set — which is what the *worker cited*. v1.0 contained no deterministic account of relevant evidence **in the store that was not cited**, and filed one-sidedness under `§6.3`'s scheduled **AI** review, i.e. after the decision had been made. The adverse-facts machinery already existed and was pointed at briefings only; it is now pointed at approvals too, computed at bundle-assembly time with a matching hash (I40). This is the highest-value approval remediation and it costs a query.
10. **What this blocks** — which work items are suspended.
11. **A recommended resolution**, clearly labelled as AI-drafted, **placed last** (v1.1, R16, APP-07). v1.0 put it at position 9, inside the owner's decision path, governed by nothing — the utterance gate covers external communication only, so **the one channel where a compromised model addresses the human with root authority was the one channel with no grammar, no grounding requirement and no tier.** It is now either constrained to a closed template with slots (recommended option, exposure, precedent set, what changes if declined) **or** placed below the adverse section, so the last thing read is the case against.

Constitution §30's standard is that the owner *"should not need to interrogate individual agents to discover the state of the business."* The bundle is where that is either true or false.

## 11. Keeping the signal high

The failure mode is not too few escalations. It is too many, so the owner stops reading.

| Mechanism | Effect |
|---|---|
| **Aggregation** | N instances of one recurring cause become one escalation with a count, not N items. |
| **Suppression windows** | A recurring known-cause escalation is suppressed for a window after acknowledgement, with the count retained. |
| **Urgency from consequence, not from source** | A discretionary escalation from the CEO does not outrank a statutory clock. |
| **Escalation-rate budget** | A per-day ceiling on discretionary escalations. Exceeding it is itself a finding — it means either the world got worse or a capability is mis-tuned, and both need investigating. |
| **Per-cause caps on mandatory escalations** (v1.1, R16, APP-05) | v1.0's budget covered **discretionary** escalations only. Abstentions, stale-precondition denials and contradiction escalations are MANDATORY and were exempt — **and they are the manufacturable ones.** A compromised model asks questions the state store cannot support, proposes against stale preconditions, or proposes against contradicted facts, and each attempt produces an owner-visible item at zero monetary exposure. Escalations are now aggregated **by cause**, with a per-cause per-window cap on distinct owner-visible items; **exceeding it suspends the causing capability**, not the owner's inbox. |
| **Owner-attention budget** (v1.1, `26 §12`) | Every approval request consumes an `attention` reservation from a per-window ceiling. Exhaustion suspends the requesting capability (I39). This is MIE applied to the scarcest resource in the company, and it is the only control that bounds the non-monetary approval classes at all. |
| **Precision scoring** | The owner's disposition (actionable / not) is recorded, and precision per trigger class is measured. Low-precision triggers are re-tuned or removed. |
| **Recall scoring** | Retrospectively: adverse events that occurred with no prior escalation, where the state contained a leading indicator. **Recall matters more than precision and is harder to measure**, so it is measured deliberately rather than assumed. |

## 12. What escalation cannot fix

`06 §4`, and it is the load-bearing operational finding for the whole thesis:

> **The residual human work does not shrink with order volume.** It scales with *product introductions*, *exceptions* and *platform events* — none of which are proportional to orders. So the labour curve flattens rather than falling to zero, and the marginal value of further autonomy work declines faster than intuition suggests.

Estimated at 9–30 hours/month at a first store (`06 §4`), and `11 E4` records that **every human-labour figure in the package traces to one interested vendor** and has never been measured for an AI-operated store. The architecture's contribution is to make the number *measurable*: every escalation records its class, its resolution time and its actor, so `11 E4` becomes a report rather than an estimate.

**And `09 §8`'s ratio is the reason it matters more than model cost:** at 2,500 orders each percentage point of escalation rate is worth ~$50/month; each point of token efficiency ~$2. **Reducing escalation rate is worth 25× more than optimising tokens.** Any effort allocation that inverts that is optimising the wrong thing.
