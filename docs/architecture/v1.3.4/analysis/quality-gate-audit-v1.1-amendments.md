# Quality Gate Audit — v1.1 Amendments

**Performed 2026-09-02, after remediation. Amends `quality-gate-audit.md` (v1.0, 2026-09-01).**

`quality-gate-audit.md` is retained unchanged in this package. This document amends five of its fifteen verdicts. **It does not re-run the other ten**, which stand as issued.

---

## Why an amendment rather than a rewrite

The v1.0 audit was performed by the same author as the architecture, which it disclosed. `47 §6` tested it against the independent review's findings and reached a conclusion worth reproducing:

> The internal gate was **directionally honest and systematically insufficient.** It found real notes — Shopify adapter gravity, the ESP at-least-once residual, two untagged estimates — and it certified as PASS four properties the package did not have, because **it verified claims against the documents rather than against the mechanisms the documents described.**

That is the failure pattern worth naming, because it recurs: **a gate that reads the specification cannot detect a specification that is wrong.** Gate 10 is the clearest instance — it certified that the audit record cannot be suppressed by citing `36 §6`, which was one of two documents specifying mutually exclusive behaviours, and the property it certified (completeness) had no invariant behind it at all.

Five amendments follow. Two upgrade a verdict; three downgrade one.

---

## Gate 5 — Can retries create duplicate financial or customer actions?

**v1.0: PASS WITH NOTE, "and the note is the honest answer."**
**v1.1: PASS. The note is closed rather than accepted.**

The v1.0 note identified the ESP at-least-once exposure as the residual and called it *"the residual worth naming"*. It was right that this was the exposed case. **It did not notice that the exposure was prohibited by the package's own rule.**

`25 §7`: *"Where the adapter's API offers no idempotency, the effect class is downgraded: it cannot be autonomous, and if it is also irrecoverable it is excluded entirely."* `26 §5` classifies `email.send` as IRRECOVERABLE. Most ESPs offer neither an idempotency header nor a synchronous query primitive. **So the rule as written excluded autonomous email sending** — while `33 §9` planned a T-U0-heavy operating profile, `37 S4` built autonomous T-U0 sends, and `37 S7` extended to a real recipient (DUP-01).

The gate looked at the residual and asked whether it was acceptable. It did not ask whether the architecture permitted it.

**What closes it** (ADR-026, R13): an ACOS-owned outbox with an at-most-once `CLAIMED` transition committed before the HTTP call; a provider-visible correlation tag; a **recoverability-keyed** unknown-outcome policy — hold-and-resolve for money, `PRESUMED_EXECUTED` and never re-dispatch for irrecoverable; delivery-event reconciliation resolving to `VERIFIED` or `NEVER_SENT`, where `NEVER_SENT` requires a **fresh authorisation and never a retry**; and I20, which reconciles the provider's own accepted count against reserved irrecoverable units **from the audit plane's own ESP credential**. ESP capability becomes an EM6 selection criterion, which is `25 §7`'s disqualifier applied where it belongs.

**The new residual, stated:** a message that was genuinely never sent is delayed until reconciliation resolves it. That is a customer-experience cost and it is the correct trade against a permanent domain-reputation event — Gmail bulk-sender status has **no expiration**.

---

## Gate 9 — Is every number in the package graded?

**v1.0: PASS WITH NOTE** (two untagged engineering judgements in `33 §8` and ADR-004).
**v1.1: PASS WITH NOTE. Two further untagged instances found, both now tagged. One deliberate estimate introduced.**

The v1.0 note was correct and its two instances were not load-bearing. `47` found two that were.

| Instance | Why it mattered | v1.1 |
|---|---|---|
| **`33 §7`'s "under $150/month of infrastructure"** | Stated as a bound, not an estimate — **and it omitted the second Postgres instance, Sentry at $26/month per `31 §10`, the worker sandbox and the egress proxy.** | Tagged `[ESTIMATE]`, omissions named, and the v1.1 additions (a second database provider, an anchoring destination, a processor sandbox) noted as moving it upward. The comparison that matters does not depend on the precision. |
| **`26 §13`'s autonomy promotion thresholds** | Presented as an operating mechanism while `26 §13` conceded in the same section that **no published model meets pass^4 ≥ 90% on the nearest analogue.** Both true; the combination misleading. | Tagged `[ESTIMATE]`, and `36 §8.2` now states the sample size, interval and eval cost required to distinguish 90% from 80% at pass^4. **`37 §7` carries the plain statement that no capability is expected to promote during the MVP.** |

**And v1.1 introduces one deliberate `[ESTIMATE]` inside a displayed ceiling**, which is a new thing for this gate to consider. `MIE_cost` — the monetary cost of authorised irrecoverable actions — enters `MAL_total` as an estimate, because unit costs are estimates. The alternative is v1.0's construction, which **omitted the cost of every irrecoverable action from a figure named Maximum Authorised Loss**, understating it by 25–33% at the proposed limits (`43 §4.1`). Neither option is clean; the estimate is labelled everywhere it appears and `MAL_monetary` remains the signed figure.

**Note retained for the reviewer:** the v1.0 note's two instances (`33 §8`'s "low thousands of orders per month", ADR-004's "roughly 100/second") are still untagged. They remain non-load-bearing and are left as-is, with the same reasoning as v1.0.

---

## Gate 10 — Can the audit record be suppressed?

**v1.0: PASS.**
**v1.1: FAIL as assessed in v1.0. PASS for the amended design, and the failure is instructive.**

This is the amendment that matters most, because **the gate certified a property the specification did not contain.**

The v1.0 verdict cited: separate instance, separate credentials, insert-only grant, hash chain, continuous verification via `I1`, adverse-facts appendix, `36 §13`'s grant test, and *"`36 §6` mandates that effects **halt** when the audit store is unreachable rather than buffering locally, which closes the window a more convenient design would leave open."*

Five problems, each found by the independent review:

1. **`36 §6` was one of two mutually exclusive specifications.** `24 §3` K11 and `30 §5` specified buffer-and-continue with degradation to blanket `REQUIRE_APPROVAL`; `36 §6` specified halt and explicitly rejected buffering. **The gate resolved a contradiction in the package's favour by citing one side of it** (AUDA-01).
2. **Halt did not close the window it claimed to close.** Halting *effects* does not halt authorisations, reservations, expiries, state facts, escalations or clock evaluation. After recovery the control database holds rows the audit database never saw, and **that divergence is indistinguishable from suppression** (AUDA-02).
3. **The chain proved integrity and not completeness.** Omission leaves no trace, and **v1.0 had no invariant asserting control-to-audit correspondence at all** (AUDA-03). The gate's word was *suppressed*; omission is the cheapest form of suppression.
4. **Nobody specified who computed the hashes.** If the writer computes `prev_hash` and `row_hash`, a compromised control plane constructs a consistent-but-false chain (AUDA-06).
5. **The audit plane's only inputs were rows the audited plane wrote.** It could recompute; it could not independently discover (`47 §1` item 4).

And the v1.0 design contained a **model-reachable approval-flood lever** in the mechanism the gate praised: the control plane held `INSERT` with no quota, so filling the audit store triggered blanket `REQUIRE_APPROVAL` (AUDA-05).

**What the amended design provides** (ADR-013, R3, R10): the primary journal in the control database with a company-scoped gap-free `journal_seq` and a trigger-computed local chain; the audit store as a **replicating verifier** that re-chains independently and proves it holds every sequence value (I17); hashes computed by database functions under roles the writer cannot assume (I17d); a per-principal insert quota with saturation as an **incident rather than a mode change** (I17c); **hourly** anchoring of `{head_hash, chain_seq, row_count}` to a medium the operator cannot rewrite, with a copy to the owner (I17b); **halt by recoverability class** rather than universally (`30 §5.1`); the audit plane's **own read-only vendor credentials** running the inverse sweep and the settlement equality check (I8, I4); its **own read endpoint on its own host** so the owner's path to findings does not traverse the control plane (AUDA-08); and separate accounts so one cloud operator does not see both sides of the separation.

**The residual, which no verdict should hide:** during a mirror outage, reversible and statutory-clock-bearing effects dispatch with only a local chain behind them. If the control plane were compromised **and** the mirror unreachable, those effects are unauditable from the record. And **the audit plane's silence remains indistinguishable from correctness.** `47 §9` is right that this is a genuine tension and that the split halt is a **chosen trade-off**, recorded as such in `22 §3.1`.

---

## Gate 13 — Does the architecture work for a materially different business model?

**v1.0: PASS** — *"No kernel capability changes in any column."*
**v1.1: PASS WITH NOTE. The strong claim is withdrawn.**

The claim was falsified by v1.1's own remediation. **Two of the corrections in this package are kernel changes, and each is forced by two of the four columns** (`33 §9`, BMN-01):

- **The MIE split** into discretionary and order-driven. POD's dominant recoverability class is IRRECOVERABLE for **every fulfilled order**, and for high-value fenced digital, delivering the asset is an irrecoverable disclosure. A correctly calibrated single MIE would have had to exceed order volume in both, at which point it gates nothing.
- **The counterparty / `customer_novelty` split**, forced by any model where the payer of a remedy is a first-time customer. Read literally, v1.0's P4 forbade refunding a first-time buyer.

Two further corrections to the table itself: the digital column's dominant recoverability was **COMPENSABLE while the same row's "hardest governance problem" cell said asset leakage is irrecoverable** (BMN-02), and the subscription column needed `StandingAuthorization` for dunning schedules — a dimension v1.0 could not represent at all (BMN-06).

**The defensible claim, now in `33 §9`:** the core *write-governance* architecture is largely business-model independent — one chokepoint, one write capability, kernel-constructed effects, grade from writer, reservation before approval, a separate audit plane. **Exposure classification, compliance surfaces, customer and counterparty semantics, and product-originated authority may require model-specific kernel extensions.**

Weaker than v1.0's claim, and true.

---

## Gate 14 — Does the architecture privilege the Phase 1 lead?

**v1.0: PASS, with a residual note on micro-SaaS.**
**v1.1: PASS. The residual is upgraded from a scope boundary to a finding.**

The gate's core verdict stands: the POD column is not privileged, Etsy is excluded at the adapter level, PA-API v5 does not appear, and Option D was rejected on exactly this ground.

**The residual note requires correction.** v1.0 said micro-SaaS strains the model because *"tenant data isolation is a property of the product being sold rather than of ACOS's write path"*, and called that *"a scope boundary, not a business-model dependency."* It is not a scope boundary for compliance: **a GDPR Art. 17 erasure request requires an authorised effect inside the sold product's data plane**, and a governance architecture that cannot reach there cannot discharge the obligation (BMN-04). *"Outside the effect model"* is not an available answer to an erasure request.

**And a second problem was not noticed at all.** If usage metering inside the sold software becomes a RECORD source, **B4 — no value in a financial record has a model in its derivation graph — extends into a data plane the effect model does not govern** (BMN-05). `28 §10` item 6 gives three acceptable postures and requires one to be chosen before any micro-SaaS model is selected.

**Consequence:** either that data plane comes inside the effect model, or micro-SaaS is out of scope for an ACOS-operated business. **That is a finding about the business model, not a gap in the architecture** — which is the more useful thing for the gate to have said.

---

## Amended summary

Only the five amended rows are reproduced. The other ten stand as issued in `quality-gate-audit.md`.

| Gate | v1.0 | v1.1 |
|---|---|---|
| 5 Retry duplication | PASS WITH NOTE (ESP at-least-once) | **PASS** — note closed by ADR-026 |
| 9 Number grading | PASS WITH NOTE (two untagged) | **PASS WITH NOTE** — two further instances tagged; one deliberate estimate inside a ceiling |
| 10 Audit suppression | PASS | **FAIL as assessed; PASS for the amended design** |
| 13 Business-model independence | PASS | **PASS WITH NOTE** — strong claim withdrawn |
| 14 Phase 1 lead privilege | PASS | **PASS** — residual upgraded to a finding |

**One methodological note for whoever runs this gate next.** Four of the five amendments above exist because the v1.0 gate checked a claim against the document that made it. The cheapest available improvement is to require, for each gate, **the name of the mechanism and the test that exercises it** — not the section that asserts it. `36 §0`'s oracle requirement is the same discipline applied to validation, and it exists for the same reason.
