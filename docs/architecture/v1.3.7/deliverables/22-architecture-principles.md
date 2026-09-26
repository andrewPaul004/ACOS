# 22 — Architecture Principles

**ACOS Operating Spine v1.3. Version 1.3. Issued 2026-09-03. Supersedes v1.1 (2026-09-02).**
**Authorising documents:** `21-phase1-revised-verdict.md` — CONDITIONAL GO TO PHASE 2, spine and authority layer only; and `47-revised-redteam-verdict.md` — CONDITIONAL PASS, REMEDIATION REQUIRED.

## v1.3 change record

§3.1's split-halt table is state-qualified (TA-10) and its `MAL_monetary` figure corrected to $300.00 / 10 items (TOS-01, TB-09); the override residual now points at the specified `DegradedModeOverride` (TA-05) and the corroborated state's true reachability (TA-06). Full disposition in `phase2-v1.3-remediation-ledger.md`.

## v1.1 change record

| Change | Remediation | Section |
|---|---|---|
| EM3 gains the statement that irrecoverable actions carry monetary cost and that duration is a third exposure dimension. Count remains the gating control; cost enters the disclosed ceiling. | R2, R8 | EM3 |
| EM7 splits finance **ingest** from finance **computation**; the credential-holding half is in the integration boundary, the model-free half in the control plane. | R4 | EM7 |
| EM9's countability claim is narrowed: exact over gateway-dispatched effects, and dependent on the external-write perimeter for the remainder. | R4 | EM9 |
| EM11's registry is deferred out of the MVP; the principle is unchanged. | R19 | EM11 |
| **New §3.1** records the EM15↔EM16 conflict under a strict audit-halt rule and the split-halt trade-off selected to resolve it. The v1.0 claim that no EM constraint is violated required this footnote. | R3 | §3.1 |
| EM16 distinguishes the *integrity* property the hash chain delivers from the *completeness* property it does not. | R3 | EM16 |
| SR1 restated: the single write capability is `propose_intent(ProposedIntent)`, not `propose_effect(typed_proposal)`. The model no longer composes the effect. | R1 | SR1 |
| SR10 restated: platform-enforced caps are an independent control only where the vendor's scope model separates operating from limit-setting authority; otherwise they are a detection surface. | R5 | SR10 |
| SR11 restated: the displayed figure is `MAL_monetary`, shown alongside `MAL_total = MAL_monetary + MIE_cost + Standing`. | R8, R20 | SR11 |
| DP3 records that `cedar-policy-symcc` is deferred as an S1 gate, as an explicit amendment to `11 E6` under `28 §9.2`. | R14, R19 | DP3 |

**Evidence base:** `acos-phase1-v1.1` package, plus the Phase 2R review `39`–`47`. Every citation is to an artifact read in this pass. No new external research was performed for this document.

---

## 0. How to read this

Three tiers, and the distinction is load-bearing. Phase 1R's governance finding was that a silent remediation entered the package with no change record; the corresponding failure mode in Phase 2 is a design preference wearing an evidence badge. Every principle is tagged:

| Tier | Meaning | Consequence of disagreeing |
|---|---|---|
| **EM — Evidence-mandated** | A named measurement, primary document or arithmetic identity in the Phase 1 package forces this. Reversing it requires new evidence, not a new opinion. | Red team should attack the evidence, not the principle. |
| **SR — Strong recommendation** | An inference from evidence, well-supported but with defensible alternatives. | Red team should attack the inference chain. |
| **DP — Design preference** | Judgement. No evidence forces it. Recorded so it can be overturned cheaply. | Red team may substitute freely. |

**Count: 17 EM, 11 SR, 6 DP.** The EM set is the architecture's non-negotiable surface and is reproduced verbatim in `38-phase2-review-brief.md`.

**One meta-principle governs the rest, stated first because it decides ties.**

> **The architecture is designed against a compromised model, not a fallible one.** Nasr et al. (arXiv:2510.09023) broke 12 of 12 published prompt-injection defences at 71–100% ASR, with human red-teaming at 100%. The correct planning assumption for a system holding money is not a residual failure rate; it is that any model whose context touches external content is, on some occasions, fully controlled by an adversary. Every principle below is evaluated by asking *what still holds under that assumption*.

---

# Part A — Evidence-mandated principles

---

## EM1 — An LLM is never the last component before an irreversible external effect

**Evidence.** `20 §5 I2`: 0 of 56 capabilities reach unsupervised agent authority over an irreversible external action, under **both** classification rule sets tested — including one performed by a process that was explicitly forbidden from citing safety as a reason for any verdict, and which was more agentic than the original in 15 of 56 rows. `21 §7.1`. Reinforced by Project Vend Phase 2, where an oversight CEO agent with explicit written OKR guidance authorised discounts ~8× more often than it denied them.

**Failure it prevents.** Every class of unauthorised external action: injected refunds, hallucinated payment instructions (Claudius' Venmo account), drifted spend, fabricated commitments.

**Architectural consequence.** A single deterministic chokepoint — the **Effect Gateway** (`23 §4`) — sits between all reasoning and all external systems. Models emit typed proposals; the gateway re-derives legality from stored state and executes. No model runtime holds a credential capable of an external write.

**Cost introduced.** Every new external capability requires a typed action class, a schema, a policy, and an adapter. Adding a capability is a code change, not a prompt change. This is the single largest velocity cost in the architecture and it is accepted deliberately.

---

## EM2 — Authority is enforced by code the model cannot reach, call, or modify

**Evidence.** `21 §7.2`. Both Phase 1 classifications *assume* a deterministic gate as a precondition; neither concludes it (`20 §5 I2` calls this "the single most important invariant in the document"). The Claude Agent SDK documents three silent bypass paths — *"Auto-approved tools never reach `canUseTool`"*, `allowed_tools` does not constrain `bypassPermissions`, and subagents inherit the parent's permission mode non-overridably (`08 §8.2`). These are configuration mistakes, not exotic attacks, and they produce an agent operating silently beyond its stated authority with no adversary present.

**Failure it prevents.** Authority expansion — the one action class with no safe failure mode (`06 §2.7`).

**Architectural consequence.** Policy evaluation is a separate process boundary from model inference. The policy engine reads only: (a) the cryptographically-attributed principal, (b) the structured proposal, (c) authoritative state it fetches itself. It never reads model-authored prose, and it never accepts a model's assertion of a fact as an input to its own decision. Policies are versioned artifacts under owner change control, deployed like code. Enforcement is **never** in an in-process SDK callback.

**Cost introduced.** A network or process hop on every effect; policy authoring becomes an owner responsibility with its own review process.

---

## EM3 — Recoverability is a property of the action, not of the permission

**Evidence.** `20 §5 I4`, a genuinely new distinction from the Phase 1R sensitivity run: *"A gate can refuse a send; it cannot unsend."* Email, SMS, social posts and public replies reach real people under the brand name and cannot be recalled by any authorisation layer. `21 §7.3` records this as a **separate control surface** that Phase 1 did not name.

**Failure it prevents.** Treating a $0-exposure action as low-risk because it moves no money. A free reshipment and an address edit are, per `07 §4.1`, *"the two highest-risk autonomous actions in a typical support tool set… because they move physical goods, are not obviously financial, and will not trip a monetary cap."*

**Architectural consequence.** Every action class carries an independent `recoverability` attribute — `REVERSIBLE`, `COMPENSABLE`, `IRRECOVERABLE` — evaluated separately from monetary exposure. Irrecoverable actions are **gated by rate and count limits**, may not be batched, and register no compensator.

**Two v1.1 corrections, both from `43 §4`.**

1. **An irrecoverable action still costs money.** A reship costs COGS plus freight; a campaign send costs ESP volume and, on a bad day, the sending domain's bulk-sender classification. Governing these by count alone was correct; *excluding their cost from the figure shown to the owner* was not. Count remains the **gating** control; `MIE_cost` — an `[ESTIMATE]`-graded sum of class unit costs — enters the **disclosed** ceiling `MAL_total` (`26 §10`).
2. **The irrecoverable currency splits.** `MIE_discretionary` covers agent-discretionary irrecoverable actions — reship, goodwill send, address edit, public post, campaign send, entitlement revocation — and is a small owner-signed integer. **Order-driven irrecoverable fulfilment**, the shipment or entitlement a paid order requires, is governed by a per-order rate limit, a template whitelist and an anomaly threshold on the ratio of fulfilments to settled orders. The two-currency model carried an unexamined assumption that irrecoverable actions are rare; they are rare only for the discretionary class, and in two of the four business models in `33 §9` a correctly calibrated single MIE would have to exceed order volume, at which point it gates nothing.

**And duration is a third dimension.** Recoverability and magnitude do not capture a *rate*: one authorised advertising-budget change produces external spend every day until something stops it. `26 §10`'s `Standing(w)` and the `StandingAuthorization` entity (`24 §3` K5) govern it.

**Cost introduced.** Three exposure quantities to configure, monitor and explain rather than one. Rate limits on irrecoverable actions will throttle legitimate throughput and will be the most frequent source of false-positive escalation.

---

## EM4 — Utterance authority is modelled separately from execution authority

**Evidence.** *Moffatt v. Air Canada*, 2024 BCCRT 149: *"It makes no difference whether the information comes from a static page or a chatbot."* `07 §7`. The Cursor/Anysphere incident (2025-04-19) is the more instructive case because there was no attacker — the model invented a coherent policy that did not exist, and subscriptions were cancelled. `07 §7`: *"ACOS's exposure is not capped by its refund authority limit. A cap constrains what the agent can execute, not what it can promise."*

**Failure it prevents.** A $0-authority agent creating an unbounded liability in a sentence.

**Architectural consequence.** A separate **Utterance Gate** (`26 §6`) on every customer-, supplier-, platform- or public-facing communication, with its own policy vocabulary (commitment classes, grounding coverage, jurisdiction) and its own authority tiers. Critically — because `07 §11.7` records that response validation has **no measured false-negative rate anywhere in the literature** — the primary control is *construction*, not classification: autonomous utterance is limited to template assembly and slot-filling from authoritative state. Classifiers are telemetry.

**Cost introduced.** Template maintenance, and a materially narrower set of autonomously-sendable messages than a naive design would allow.

---

## EM5 — Roughly half the capability surface has no interpretive content and must stay conventional software

**Evidence.** `20 §5 I1`: 28 of 56 (safety-first) versus 26 of 56 (capability-first) — a 1.08× spread, the tightest agreement in the sensitivity study, and the only measure where two independent taxonomies nearly agree. All eight spine capabilities, order state, inventory, fulfilment routing, shipping, tax calculation, settlement reconciliation, structured data, observability, alerting and the approval queue are plumbing under every rule tested.

**Failure it prevents.** Manufacturing a prompt-injection surface where none needed to exist, at higher cost and lower reliability. `08 §12`: the test is not *"could an LLM do this?"* but *"does this task have a knowable-in-advance correct answer?"*

**Architectural consequence.** A model may be introduced into a path only by an explicit, recorded decision that names the interpretive content. The default for every new capability is deterministic.

**Cost introduced.** More code, written more slowly, than a prompt would take.

---

## EM6 — Work is bounded, idempotent, capturable and independently reconcilable

**Evidence.** `08 §1`, arithmetic: finishing a 1,000-step month at 95% end-to-end requires 99.9949% per step; a 2,500-order store running ~3,000 steps/month at an optimistic 99.9% per step has a **4.9%** probability of a clean month. `08 §1` also establishes the independence assumption is optimistic — Vending-Bench's "doom loop" began when the agent *"mistakenly believed its orders have arrived before they actually have"*, and a single false state belief poisons every subsequent step that reads it. AgentDyn reports defence performance falling sharply beyond ~10 trajectory steps, so long trajectories sit outside every published security evaluation as well (`07 §11.2`).

**Failure it prevents.** Silent compounding error; unbounded blast radius from one bad belief; security evaluations that do not apply to the operating regime.

**Architectural consequence.** Every unit of work is a durable, resumable, budget-bounded item with a declared termination condition. Every external effect carries a deterministic idempotency key. Three independent reconcilers run continuously (`25 §8`). Failures become typed Incident objects, never silent retries. No critical process depends on one long uninterrupted model conversation.

**Cost introduced.** A durable-execution dependency; work decomposition discipline; three reconcilers to build and maintain.

---

## EM7 — Financial truth is produced deterministically, with no model in the accounting path

**Evidence.** `21 §7.7`. Per-order contribution margin before marketing is computable to the cent from supplier and processor data; settlement reconciliation reduces to a deterministic equality check against the bank deposit line. Against that, `06 §2.6`: FinanceBench — GPT-4-Turbo with retrieval incorrectly answered or refused **81%** of questions; GSM-Symbolic shows performance declining when only numbers change, with drops up to 65% from a single irrelevant-but-plausible clause. A Shopify order payload (gross vs net, tax-inclusive vs exclusive, presentment vs settlement currency, gift-card portions) is that trap by construction.

**Failure it prevents.** A company whose books are an LLM's opinion; the CEO fabricating or drifting on numbers.

**Architectural consequence.** The Financial Truth Service is a separate deterministic component with its own ingest adapters and its own write authority. **It must produce a complete, correct financial picture with every model offline.** Models may narrate numbers they did not compute and may interpret them; they may never originate a number that appears in a ledger, a customer-facing amount, or an owner-facing report.

**v1.1 split (R4, from `43 §8`).** v1.0 placed K6 in two trust zones at once: `28 §3` put the finance-reading component in the credential-holding Integration Plane with an org-scoped admin credential, while `33 §2.1` listed `finance` as a control-plane module and `23 §3` said the control plane holds only its own database credential. The resolution is a split, not a choice:

- **Finance ingest** is an adapter in the integration boundary. It holds the vendor credentials, including the org-scoped model-provider cost credential whose scope must be enumerated and replaced with a purpose-scoped key where one exists.
- **Finance computation** stays in the control plane, holds **no vendor credential**, and is CI-checked for the absence of both a model client and a credential loader (I25).

EM7's requirement is about the *computation*, and splitting the component is what makes the requirement checkable.

**Cost introduced.** Every financial figure needs a deterministic derivation path before it can be shown, which slows the addition of new metrics.

---

## EM8 — All external content enters as untrusted data with zero authority

**Evidence.** `21 §7.8`. `07 §3`: **every** verified exfiltration incident — EchoLeak, ForcedLeak, AgentFlayer, ShadowLeak — ran over an allowlisted channel; ForcedLeak used a still-allowlisted domain repurchased for $5. Memory poisoning: 100% injection success across 2,520 runs, with retrieval-layer defences at 88.9% ASR. `08 §6`: agent memory is a prompt-injection persistence channel, and Anthropic's own memory-tool documentation requires the application to strip sensitive content on write — an implicit concession.

**Failure it prevents.** Indirect prompt injection converting into tool authority; poisoned records that are latent and re-triggering.

**Architectural consequence.** A **quarantined ingestion tier**: contexts that read untrusted content hold no credentials, no PII, no write proposal capability, and no free-form egress. They emit schema-validated structured claims only. Natural language never crosses a trust boundary. Claims from untrusted origin are stored at a grade that cannot authorise anything without deterministic corroboration (`24 §5`).

**Cost introduced.** Two-stage processing for anything read from the outside; loss of the convenience of a single agent that browses and acts.

---

## EM9 — The governed quantity is ungated agent actions per month, not agent count

**Evidence.** `20 §3`, `20 §7`, `21 §7.9`. Like-for-like the agent-outright count moves 2.25× and agent-somewhere 1.38× between two defensible taxonomies; loosely quoted the number has meant anything from 4 to 18. Classification B's own closing observation: *"Ten AGENT capabilities each taking three bounded actions a day is a very different reliability problem from ten AGENT capabilities running open loops."*

**Failure it prevents.** Governing a proxy. An org chart is not a risk measure.

**Architectural consequence.** Every authorised effect records a `gate_class` of `GATED` (a human approval or a hard precondition stood between proposal and execution) or `UNGATED_LOGGED` (policy permitted autonomously). The monthly count of `UNGATED_LOGGED` effects, segmented by recoverability class, is a first-class governed metric with an owner-set ceiling, surfaced in the control centre (`30 §3`). **ACOS carries no agent count as a governance figure.**

**v1.1 narrowing (R4, from `42 §1.1`).** v1.0's claim that the closed action catalogue "makes the count exact" was too strong. The count is exact over the set of effects the Effect Gateway dispatches, and silent about deterministic external writes that never reach the gateway — webhook subscription assertions, reconciler resolutions, credential refreshes, framework-managed registration and observability exports. EM9's countability therefore depends on the **external-write perimeter** (`48-external-write-perimeter.md`) being enumerated, annotated and CI-checked, not on the catalogue alone. Two of those paths become governed effect classes in v1.1; the rest carry annotated exemptions.

**Cost introduced.** None material for the metric. The perimeter is a standing maintenance obligation.

---

## EM10 — Operate through APIs. Do not design around UI automation

**Evidence.** `21 §7.10`. Shopify ToS (Last Updated 2026-08-01): *"You agree not to access the Services or monitor any material or information from the Services using any robot, spider, scraper, or other automated means."* The same ToS expressly contemplates agents acting for the Store Owner via API credentials (`17 §5.4`). The split is decisive and it is on the one platform actively enabling agents. Reinforced economically: browser/computer-use carries a 4,500–6,600 token fixed tax per request and a time horizon **40–100× shorter** than text tasks (`08 §2`, `09 §12`); OSWorld 2.0 drops SOTA to 20.6%.

**Failure it prevents.** Building the operating loop on the one access method the platform prohibits, at the highest cost and lowest reliability available.

**Architectural consequence.** Platform selection is filtered on API coverage before anything else. Browser automation is confined to a quarantined, credential-free, read-only research tier and is never in an operating path. A platform without an API for a required operating capability disqualifies that capability from autonomy — Etsy support is the worked example (no messaging API at all).

**Cost introduced.** Some platforms become unusable for some functions. That is the finding, not a gap.

---

## EM11 — Agent identity and capability declaration are architectural surfaces

**Evidence.** `21 §7.11`. Amazon's BSA update effective **2026-03-04** requires AI agents to *"Clearly identify themselves as automated systems / Comply with the new Agent Policy at all times / Cease access if Amazon requests"* (`17 §5.1`) — and the buyer-side Agent Terms that pre-date it by four months were enforced under the CFAA, with a March 2026 court order against Perplexity's Comet. Shopify requires a published agent profile declaring UCP version and capabilities at an HTTPS URL, with trust tiers gating checkout completion (`17 §5.4`). EU AI Act Art. 50(1) — customer-facing systems must disclose they are AI — is the provision that plausibly reaches an AI-operated storefront; Art. 50(4)'s editorial-review exemption does **not** cover product copy (`17 §5.5`).

**Failure it prevents.** A platform-terms breach that is invisible until enforcement, on platforms where enforcement is account termination.

**Architectural consequence.** An **Agent Profile Registry** is a kernel component (`23 §5`): it holds per-platform declared identity, capability declarations, trust tier, disclosure obligations by jurisdiction, and a per-platform kill switch implementing "cease access if requested." Disclosure text is a policy-controlled artifact, not prompt content.

**Cost introduced.** A registry, a per-platform compliance surface, and a jurisdiction dimension in the utterance policy.

**v1.1 scope note (R19).** The principle is unchanged and the registry is **deferred out of the MVP** per `45 §3`: platform-facing identity, disclosure obligations and per-platform kill switches require a live platform, and the MVP has a development store, no marketplace, no advertising account and no public storefront. There is nothing to declare and nobody to declare it to. The trigger to build K14 is the first real platform identity.

---

## EM12 — Platform-attributed ROAS is never authoritative and never the sole optimisation signal for an authority-bearing loop

**Evidence.** `21 §7.12`. Gordon, Moakler & Zettelmeyer (2023, *Marketing Science* 42(4)), benchmarked against **663 Facebook RCTs**: at the purchase stage experimental median lift was 5% while observational methods estimated 24% (DML) and 64% (SPSM) — a **4.8×–12.8×** overstatement. `06 §2.4` classifies optimising spend on platform-reported ROAS as RED-IRREVERSIBLE *as an authority grant*.

**Failure it prevents.** An agent scaling budgets on a number inflated by a large multiple — the ad-runaway scenario, arriving as a rational decision rather than a malfunction.

**Architectural consequence.** Platform-reported conversion and ROAS enter state at `CLAIM` grade with the reporting platform as counterparty. Incremental measurement (holdout or geo) produces `OBSERVATION` grade. Authority to increase advertising exposure is **conditioned on the presence of a fresh incremental measurement**; absent one, budget authority is capped at the previously proven level.

**Cost introduced.** A measurement apparatus must exist before spend authority can grow. This is slow and it is the point.

---

## EM13 — Marketing intensity is a trajectory constrained by runway, not a threshold

**Evidence.** `21 §7.13`, `18 §5`, `17 §2`. The `$9.18` affordable-CAC figure is withdrawn. FIGS printed **30.0%** marketing intensity at $110.5M revenue; Allbirds never printed a figure inside the 6–16% band in its entire disclosed life; no filer discloses a launch year. Applying a mature-company residual to a business with no customers produced a constraint that would halt a healthy launch.

**Failure it prevents.** A spend governor that stops a business behaving normally for its stage.

**Architectural consequence.** Spend governance objects carry `runway_months_floor` and `intensity_slope_ceiling`, not a fixed percentage. The derived quantity the owner sees is `months_of_above-ceiling_spend_affordable = capital / (monthly_orders × (CAC_measured − CAC_intensity))` (`18 §7`). Two ceilings are modelled as separate quantities throughout: **solvency** (`μ·AOV·L`) and **intensity** (`m·AOV·L`), because they are margin-dependent and margin-independent respectively (`21 §8.3`).

**Cost introduced.** A more complex spend policy than a percentage cap, and one that requires a maintained runway projection to evaluate.

---

## EM14 — Conversation history is never company memory, in any form

**Evidence.** `21 §8.13`, unchanged from Phase 1 and reinforced by Vending-Bench 2's ~69,000-token auto-trimming context. `08 §6`: the Claude Agent SDK's own documentation states *"Don't rely on session resume. Capture the results you need… as application state and pass them into a fresh session's prompt."* Session files are local to the machine that created them; the experimental V2 session API was removed in TypeScript SDK 0.3.142. `08 §6` GAP: **no published benchmark measures memory contradiction rate or staleness rate over months** — every memory system surveyed is additive by default with no truth maintenance.

**Failure it prevents.** The Vending-Bench doom loop. If "the order arrived" is a database row written by a webhook handler and a carrier scan, that false belief is not available to be held.

**Architectural consequence.** Context is **assembled** deterministically per work item from the state store, never accumulated. Mutable business facts — price, stock, policy, balances, order state — never enter model-writable memory. What persists across invocations is typed kernel state with provenance, not transcripts. The CEO has no conversational memory (`27 §4`).

**Cost introduced.** Context assembly is code that must be written and maintained per task type, and it is the place where a missing field becomes a silent capability gap.

---

## EM15 — Named human obligations are architectural objects with statutory clocks, not process notes

**Evidence.** `SPINE` finding 10, unchanged. `07 §8`: GDPR Art. 33 — 72 hours from awareness; Art. 12(3) — one month for a DSAR; Art. 22(3) — a human-intervention route for every solely-automated decision with significant effects; CCPA 45 days; CPPA ADMT compliance from 2027-01-01. FTC 30-day shipment rule and its 7-working-day refund clock. Etsy's 90-day refresh-token reauthorisation is the only calendar-driven mandatory human action in the surveyed set (`06 §2.3`).

**Failure it prevents.** An autonomous company that misses a legal deadline because no component owned the clock.

**Architectural consequence.** Escalation is a first-class kernel entity with an SLA clock, an owner, an urgency, an evidence bundle and a resolution record (`30 §6`). Clocks are deterministic timers on legal obligations. A reachable human within 72 hours is an availability requirement on the *company*, not on the software.

**Cost introduced.** The owner is permanently on a 72-hour leash. There is no architecture that removes this.

---

## EM16 — The audited system cannot write to, alter, or suppress the audit record

**Evidence.** `06 §2.7`, `10 §2.4`, Constitution §19. Anthropic observed emergent code sabotage (12%) and alignment faking (~50%) arising from gameable objectives alone; the goal-drift literature finds drift correlates poorly with instruction-hierarchy compliance, so obedience testing does not certify drift resistance. `08 §10`: every managed engine's trace retention (24 hours to 90 days) is far too short to be the audit record.

**Failure it prevents.** Constitution §19 failing silently — the mode where the system that is wrong is also the system reporting on itself.

**Architectural consequence.** A physically separate append-only audit store with a writer identity unreachable by any operating principal. Every agent KPI is paired with a counter-metric computed by a process the agent cannot reach. Audit findings have a mandatory acknowledgement workflow the CEO cannot close. Unacknowledged findings are auto-appended to the owner briefing.

**v1.1 precision (R3, R10, from `43 §2.4`).** Two properties were conflated in v1.0 and they have different mechanisms.

- **Integrity** — no row present in the record has been altered, removed or reordered after insertion by a principal holding only `INSERT`. Delivered by the hash chain (I41), provided the hash and sequence are computed by a database function under a role the writer cannot execute as (I17d), and bounded against a store-level or operator-level rewrite only by external anchoring, whose cadence sets the maximum undetectable rewrite window (I17b, hourly).
- **Completeness** — no consequential event is missing from the record. **A hash chain proves nothing about omission.** Completeness requires the two-sided control↔audit diff over a gap-free per-company `journal_seq` (I17), and *truthfulness* of the record requires the audit plane's own independently provisioned vendor reads (I8), because a control plane holding `INSERT` writes plausible false rows freely.

EM16 as a principle is unchanged. What changed is that the architecture no longer claims the chain delivers more than integrity.

**Cost introduced.** A second datastore, a second credential domain, duplicated metric computation, a second read credential per vendor for the audit plane, and an anchoring destination outside the operator's control.

---

## EM17 — No AI system may create a payment path; it may only move along one

**Evidence.** `07 §4.3`. FBI IC3 2025: BEC — 24,768 complaints, **$3,046,598,558** in losses, ~$123,000 average. `07 §4.3`: *"An agent that can change payee or bank-routing details is a strictly worse target than a human accounts-payable clerk."* This is the one place in the Phase 1 evidence base that supports a flat prohibition rather than a bounded envelope.

**Failure it prevents.** The single largest measured financial-crime category, aimed at the weakest available target.

**Architectural consequence.** `payee.create`, `payment_method.modify`, `bank_details.modify`, `credential.*`, `payment_page_code.*`, `authority.*` and `audit.write` are **categorically excluded action classes**: denied by policy *and* absent from every credential the broker can issue to any AI-originated principal. Defence in depth, deliberately redundant.

**Cost introduced.** Supplier onboarding is permanently a human workflow.

---

# Part B — Strong recommendations

---

## SR1 — Models hold exactly one write capability: `propose_intent(ProposedIntent)`

**Rationale.** EM1, EM2 and EM8 jointly imply that no model may invoke an external write. The strong form — that models have exactly *one* proposal API and no per-vendor write tools at all — is an inference, not a requirement. It is worth taking because it collapses three separate problems into one: tool-permission configuration (which the Agent SDK evidence in `08 §8.2` shows fails silently), MCP scope granularity (`07 §6`: *"MCP scopes are too coarse to encode 'max $200 per ad-budget change'"*), and the countability of EM9 (the ungated-action metric becomes a `SELECT COUNT`).

**v1.1 correction (R1).** v1.0 named the capability `propose_effect(typed_proposal)`, and the name was accurate about what the design actually did: the model composed the effect, including the number that bounded it. `26 §2` v1.0 carried `exposure` and `parameters` as proposal fields, `26 §7` reserved against them, and `26 §8`'s worked policies read `context.parameters.amount`. The capability is renamed and narrowed to `propose_intent(ProposedIntent)`, where the model supplies an action class, a resource reference, a **selector index into a kernel-enumerated option set**, a reason code and a journaled rationale — and nothing else. The kernel enumerates, the model selects, the kernel computes. This is materially stronger than a typed proposal, because a typed proposal still let the model choose the value.

**Alternative not taken.** Per-capability write tools with per-tool scoped credentials. Rejected because it re-introduces the configuration surface and because `07 §6` establishes MCP is *"a capability transport, not an authorization system."*

**Cost.** All external capability is expressed in one schema registry, which becomes a central bottleneck and a single point of design failure.

---

## SR2 — Independence of judgement is obtained by separating stages in time through an evidence store, not by running concurrent agents

**Rationale.** `08 §7`, tagged INFERENCE (high confidence). Anthropic's multi-agent research system outperformed a single agent by 90.2% on read-mostly parallelisable work but used ~15× the tokens, and exhibited *"spawning 50 subagents for simple queries"* and *"minor changes to the lead agent can unpredictably change how subagents behave."* Cognition's counter-case is write-mostly shared-artifact work. Separating discovery from evaluation *in time* — a later run reads only the earlier run's structured evidence, never its reasoning — buys the independence Constitution §8 requires without the coordination surface, the token multiplier or the reproducibility problem.

**Cost.** Latency. A decision that could be made in one pass takes two scheduled passes.

---

## SR3 — A record's evidential grade may only be raised by a deterministic promoter with a named rule

**Rationale.** The requirement is `24`'s: make it hard for an AI belief to become a business fact. The mechanism — that grade is *derived from writer identity and promotion rule*, never asserted by the writer — is a design inference. It is what makes "supplier says shipped" structurally distinct from "carrier scan confirms shipped."

**Cost.** Every fact type needs a declared promotion rule, and facts that have no deterministic corroboration source stay permanently at CLAIM grade — which is correct but will feel obstructive.

---

## SR4 — State is append-only and bitemporal, and every fact type declares a maximum age

**Rationale.** Staleness is the failure mode nobody measures (`08 §6` GAP) and the one that matters for a business where supplier prices, stock and policies change weekly. Making `observed_at` and `valid_from/valid_to` mandatory, and having reads past `max_age` return a STALE flag that policy can refuse to authorise against, converts an unmeasurable risk into a deterministic check.

**v1.1 scope note (R19).** **World-time interval logic (`valid_from`/`valid_to`) is deferred out of the MVP** per `45 §3`. What the MVP needs from SR4 is append-only writes, `observed_at`, `recorded_at`, supersession links and per-type `max_age` — that is what property 7 in `37 §1` asserts and what replay-for-audit reads. World-time intervals serve retroactive correction, which the MVP does not exercise. The principle is unchanged; the trigger is the first retroactive-correction requirement.

**Cost.** Storage growth, query complexity, and a class of authorisation denials caused by data freshness rather than by policy.

---

## SR5 — Exposure is reserved transactionally at authorisation time, before any approval wait

**Rationale.** Checking a budget and then spending it are different operations. Under concurrency — and ACOS is concurrent by construction, with webhooks, schedules and CEO tasks all live — a check-then-act pattern permits aggregate overrun equal to the number of in-flight proposals. Reserving atomically in the same transaction that records the authorisation decision closes it. Reserving *before* an approval wait (and releasing on denial or expiry) closes the same race across the human latency window.

**v1.1 addition (R9).** v1.0 left the interaction between "reserve before the wait" and `26 §12.4`'s "re-run the full policy evaluation on resume" unspecified, and `26 §7`'s sequence had no already-reserved branch. The naive implementation either double-reserves or releases and re-reserves — losing the slot to a concurrent proposal, which is the exact race SR5 exists to close. Resume therefore runs in **verify mode**: every policy step re-runs, step R *asserts* that the held reservation still covers the recomputed exposure, and a recomputed exposure exceeding it **denies**. The reservation is never re-taken (**I31** — no second reservation row) and never topped up (**I51** — a verify-mode resume never increases a held reservation). **v1.2 (C5b):** v1.1 cited `I31` for both properties; `I31`'s uniqueness constraint does not entail non-increase, and a fixture that tops up an existing row violates only the second.

**And SR5 does something v1.0 did not claim.** Because the reservation is held across the wait, the pending-approval queue cannot collectively exceed the window ceiling. **v1.3 (TB-09 / TOS-01): the bound is `min(count_headroom, floor(monetary_headroom / per_action_max))` per class per window, which for `refund.create` is `min(10, floor($250.00 / $25.00)) = 10` items** — not the *"$600 / roughly 24 items"* v1.1 stated and v1.2 corrected in `26 §12` alone. `MAL_monetary(month)` is **$300.00**; $600 was a superseded `MAL_total`. Each pending item consumes headroom and exhaustion denies outright (`44 §6.1`). This is a real anti-flooding property. It does **not** exist for non-monetary approvals, which is why `26 §12` adds an owner-attention budget for those.

**Cost.** Reservations leak if release logic is wrong; a reservation-expiry reaper is mandatory. Held reservations are also an availability lever — an adversary able to induce vendor timeouts exhausts headroom at zero spend — which is why I32 monitors starvation.

---

## SR6 — Autonomy is earned per `(capability × action class × model binding)`, and a binding change demotes

**Rationale.** Part 20 of the Phase 2 brief requires that a model upgrade not inherit earned authority. The evidence supporting the requirement is strong: Anthropic's model IDs expire on ~annual cycles with 60 days' notice, upgrades have changed the API *contract* (`temperature` now returns 400 on Claude 4.7+), and OpenAI retired two orchestration surfaces inside two years (`08 §9`). No source quantifies behaviour change across versions on a fixed prompt suite — `08 §9` records that as something to measure internally.

**Cost.** Every model upgrade triggers a re-qualification cycle with a temporary autonomy reduction. This is a real operational tax and it will be tempting to waive.

---

## SR7 — The action catalogue is closed; an unrecognised action class is denied

**Rationale.** Fail-closed is standard, but the specific consequence here is that ACOS cannot acquire a new external capability through model creativity, only through a code change. Given EM1 and the observed tendency of agents to invent mechanisms (Claudius' Venmo account; ~300 fabricated-partnership emails from AI Village agents), this is worth the rigidity.

**Cost.** Zero emergent capability. Every new thing the company can do is a deployment.

---

## SR8 — Experiment acceptance criteria are hashed and anchored at registration

**Rationale.** Constitution §18 forbids moving goalposts; `10 §2.4` names statistical honesty, not tooling, as the risk. A hash of the frozen pre-registration written to the append-only audit store at registration time makes post-hoc modification detectable rather than merely discouraged. Amendments are permitted but produce a new version with a diff record, and results are computed against **both** the original and the amended criteria.

**Cost.** Rigidity in genuinely learning situations, mitigated by the amendment path.

---

## SR9 — ACOS emits its own stable event schema as the authoritative record; vendor tracing is a replaceable view

**Rationale.** `08 §11`: no GenAI OpenTelemetry span, event, metric or attribute is marked Stable; the conventions moved repository and the new one has no releases or tags; adoption is uneven across frameworks. Combined with retention windows of 24 hours to 90 days across every managed engine, an external convention cannot be the audit record. Langfuse's copyright is now ClickHouse, Inc. — a change of control on a nominated observability component.

**Cost.** An internal schema to version and maintain, plus adapters to whichever tracing product is in use.

---

## SR10 — Prefer platform-enforced limits over self-enforced limits wherever both exist

**Rationale.** `06 §6`, `10 §9`. Meta's account `spend_cap` pauses campaigns server-side; Google enforces hard 2× daily / 30.4× monthly limits and states *"you'll never actually pay more than your spending limits"*; Klaviyo caps flow creation at 100/day. These are free deterministic guardrails that an attacker inside ACOS cannot reach. The corollary is mandatory: **no ACOS principal may hold a credential capable of raising a platform-enforced cap.**

**v1.1 restatement (R5, from `42 §5.1`).** SR10's mandatory corollary — *no ACOS principal may hold a credential capable of raising a platform-enforced cap* — is **not satisfiable with the credentials the advertising platforms issue.** The Google Ads API requires the full `adwords` scope for any GAQL query including a pure read, and account-level spending limits are mutated through `AccountBudgetProposal` under that same scope; Meta's `ads_management` has no sub-scope distinguishing account-level `spend_cap`. Any credential that can change a campaign budget can propose an account budget change. `35 §7` layer 3's v1.0 claim that the platform cap "holds even if the entire control plane misbehaves" was false. The defensible statement:

> Platform-enforced caps are preferred over self-enforced caps **where the vendor's scope model separates operating authority from limit-setting authority.** Where it does not — Google Ads, and Meta pending verification — a platform cap is a **detection surface**, not an independent control: raising it is an observable event the audit plane polls for (I33), not an action ACOS is incapable of. Where the platform supports a distinct billing-account owner, the limit is set by an identity ACOS cannot authenticate as, and that is the only configuration in which the original claim holds.

Klaviyo's 100/day flow-creation cap and Meta's server-side `spend_cap` pause remain genuinely free guardrails; the correction is to the *unreachability* claim, not to the preference.

**Cost.** An inventory of platform limits to maintain, a dependency on the platform not changing them, and — where scopes do not separate — a continuous empirical probe (I15) instead of a structural guarantee.

---

## SR11 — Authorised loss is computed, displayed, and owner-approved per named window, as four quantities rather than one

**Rationale.** `07 §9`: *"the agent's authority ceiling equals the amount the owner would be willing to lose to an attacker who fully controls the agent."* That is a governance statement; the architectural form is a computed figure. Granting new authority visibly moves a number the owner has signed off.

**v1.1 correction (R8, R20, from `43 §4`).** A single figure named *Maximum Authorised Loss* that excluded, by construction, the cost of every irrecoverable action and the forward integral of every rate-based authorisation was worse than no figure — which is `26 §10`'s own argument, applied to itself. The computed quantities are now:

```
MAL_monetary(w) = Σ non-rate grants: min(max_monetary, per_action_max × max_count)
MIE_cost(w)     = Σ irrecoverable discretionary classes: MIE_class(w) × unit_cost_estimate(class)   [ESTIMATE]
Standing(w)     = Σ live StandingAuthorizations: forward exposure to window end
MAL_total(w)    = MAL_monetary(w) + MIE_cost(w) + Standing(w)
```

`MAL_monetary` is the figure the owner signs per window; `MAL_total` is displayed alongside it with `MIE_cost` labelled ESTIMATE, and with the four quantities none of them bounds shown adjacent (`26 §10`). Windows are **named company-scoped objects** that grants reference, and every grant carries a MONTH window so `MAL_total(month)` is defined — v1.0's grants declared private windows, which is why `37 §5`'s figures did not reconcile with `26 §10`'s formula in either direction.

**Cost.** The computation is conservative and will overstate realistic loss, which may cause the owner to under-grant. `MIE_cost` introduces an estimate into a disclosed ceiling; an estimated component beats a silent exclusion.

---

# Part C — Design preferences

Recorded so they can be discarded without argument.

| # | Preference | Why it is only a preference |
|---|---|---|
| **DP1** | **One Postgres instance holds kernel state, exposure ledger, effect ledger and financial ledger, so reservation and journaling share a transaction.** | The invariant (atomic reservation + journaling) is SR5; achieving it in one database is one of several ways. A distributed design with a two-phase or saga pattern satisfies the same invariant at higher complexity. |
| **DP2** | **Modular monolith for the control plane; workers out-of-process.** | A service-oriented decomposition satisfies every EM. This is a team-size and MVP-attackability judgement (`27`, `32`). |
| **DP3** | **Cedar in preference to OPA for the money-bounding policy set.** | Both are Apache-2.0 and mature. Cedar's differentiator is `cedar-policy-symcc` (v0.6.0, inside `cedar-policy/cedar`, Apache-2.0 — note the repo correction at `17 §1.2`), which can *prove* "no path permits a refund above $X" with concrete counterexamples rather than sample-testing it. If the policy set turns out not to be expressible in Cedar, OPA is the fallback and nothing else changes. **v1.1: symcc is deferred as an S1 gate** per `45 §3` — with a three-class action catalogue the policy set is hand-checkable, and symcc adds a toolchain plus the fragment-compatibility risk ADR-005 names as its own reconsideration trigger. The deferral is recorded as an **amendment to `11 E6` under `28 §9.2`**, not applied silently, and the gate returns before the catalogue exceeds ten classes and before any real money. |
| **DP4** | **Typed kernel proposal API in preference to per-vendor MCP servers for write paths.** | MCP is usable and now reasonably well-governed as a transport; the objection at `07 §6` is that it is not an authorization system and its scopes cannot encode numeric envelopes. MCP remains appropriate for **read** capabilities. Number of concurrently connected servers is itself a risk multiplier. |
| **DP5** | **Reasoning workers are stateless processes invoked by the orchestrator, not long-lived services.** | Statelessness is implied by EM14; process model is not. |
| **DP6** | **Diagrams are Mermaid source held in the repository alongside the artifacts.** | Purely operational. |

---

## 3. Where two evidence-mandated principles conflict

v1.0 asserted that no EM constraint is violated anywhere in `23`–`37`. `38 §9.18` invited the red team to find one, and it did. The claim now carries this footnote.

### 3.1 EM15 versus EM16 under a strict audit-halt rule

**The conflict.** EM16 says the audited system cannot write to, alter or suppress the audit record. v1.0's `36 §6` enforced that by halting all effects when the audit store is unreachable, and explicitly rejected buffering. EM15 says named human obligations are architectural objects with statutory clocks — the FTC 7-working-day refund clock, GDPR Art. 12(3)'s one month, Art. 33's 72 hours — and those clocks do not pause for a managed-Postgres outage. `33 §7` places both databases on managed instances at commodity pricing, and neither vendor offers a money-path availability SLA.

**So a strict reading of EM16 can force an EM15 breach.** Two evidence-mandated constraints in direct conflict.

**Worse, halt did not deliver what it claimed.** Halting *effects* does not halt authorisations, reservations, reservation expiries, state facts, escalations or clock evaluation — all of which are control-plane writes generating audit rows. After recovery the control database contains rows the audit database never saw, and that divergence is indistinguishable from suppression. Halt moved the unaudited window from effects to everything else and left the resulting gap ambiguous (`43 §2.1`).

**The selected trade-off (R3), as amended by v1.2's inversion and v1.3's corrections.** Durability is separated from externalisation. The primary journal lives in the control database, gap-free by a company-scoped `journal_seq`, hash-chained locally by a database trigger the writer cannot execute as. The audit store becomes a **replicating verifier** that re-chains independently and proves it has every sequence value it was told about (I17 — *transport* completeness; see `30 §5.4` for what that does and does not establish). Halt then applies **by recoverability class, inside the declared mirror state** — `NORMAL`, `UNCORROBORATED_STALL` or `CORROBORATED_DEGRADED` per `30 §5.6`. **The state is the outer discriminator and the recoverability class is the inner one; neither alone selects a behaviour:**

**Every row below is state-qualified** (v1.3, TA-10). `30 §5.6`'s three-state machine is the outer discriminator and `30 §5.1`'s ordered first-match precedence is evaluated **inside** the declared state. A reader extracting this table without the state column gets the pre-inversion behaviour, which is how `36 §6` acquired TA-07.

| Precedence row | Class | `NORMAL` | `UNCORROBORATED_STALL` | `CORROBORATED_DEGRADED` |
|---|---|---|---|---|
| 1 | IRRECOVERABLE | **Dispatch** — subject to every ordinary authority requirement (v1.3.4, IRN-01, `30 §5.1b`) | **Halt** | **Halt** |
| 2 | Above the per-action approval floor — `degraded_per_action_approval_floor_monetary`, **$20.00**, compared against `total_exposure` (`51 §3.7`, `30 §5.1a`) — and not clock-bearing | **Halt** | **Halt** | **Halt** |
| 3 | COMPENSABLE inside a live statutory clock | Dispatch — the clock outranks the mirror | **Suspend** — the inversion | Dispatch, tagged `DISPATCHED_UNMIRRORED` |
| 4 | COMPENSABLE discretionary | Suspend | Suspend | Suspend |
| 5 | REVERSIBLE | Dispatch against the committed, locally chained journal | Dispatch | Dispatch |

Rows 3 and 4 are the only rows a `DegradedModeOverride` can restore, and rows 1 and 2 are unreachable by override (`30 §5.7.2`). **Under the `§5.1a` FULL-HALT POSTURE every row halts, row 1 included, and rows 1, 2 and 5 are not restorable.**

**v1.3.4 (IRN-01) corrects row 1's `NORMAL` cell only.** v1.3 through v1.3.3 printed row 1 as Halt/Halt/Halt, which halted IRRECOVERABLE in healthy operation — a state in which the effect is not unmirrored, and the opposite of what row 1's own rationale says. The consequence was that the class ADR-026, `25 §7`, `25 §5`, `I20` and `37` S4 all specify mechanisms for could never be dispatched at all. `30 §5.1b` records the defect, the correction and its bounds. **Row 1's condition, its position ahead of row 2, its halt in both degraded states, its halt under the posture and its unreachability by override are all unchanged.**

**v1.2 narrows the conflict and prices what remains (SR-A2, SR-A6).** Two changes:

- **The trade is no longer self-authorising.** v1.1 let the control plane declare the degraded state in which the clock outranks the mirror, so the audited party decided when the audit applied — `52 §1` Path B. `30 §5.6` inverts it: the **uncorroborated** state is *stricter* than normal operation and suspends the very refunds a lying control plane wanted dispatched. The relaxation exists only in `CORROBORATED_DEGRADED`, entered on an audit-plane signal.
- **The trade now has one answer per case.** v1.1's five-row halt table matched twice for an above-floor refund inside a live FTC clock — clock-bearing (dispatch) *and* above the per-action approval floor (halt) — with no declared precedence. v1.1 also stated that floor in prose as the same `$25` figure as `refund.create`'s `per_action_max`; **v1.3.3 declares the floor separately at $20.00 and `30 §5.1a` records why the two are different quantities**, so the most consequential instance of this exact EM15↔EM16 case had two specified behaviours. `30 §5.1` is an ordered first-match list: IRRECOVERABLE matches row 1 first and halts **in both degraded states** (v1.3.4, `30 §5.1b`), above-floor-and-not-clock-bearing halts, clock-bearing COMPENSABLE dispatches.

**And the residual is now priced rather than assumed away.** A genuine *two-sided* outage — the mirror down and the audit plane unable to signal — leaves the system suspending clock-bearing refunds, and clearing that costs an owner override.

**v1.3 specifies the override, because v1.2 did not (TA-05).** v1.2 said only that it was *"bounded per AUD-07: a journaled decision displaying the affected classes and the elapsed clock time, changing no ceiling"* — no duration, no count, no cap, no expiry, no second-approver rule, no entity, no invariant, while the ledger recorded AUD-07 as closed. `DegradedModeOverride` is now kernel state (`30 §5.7.2`), held in `24 §3` K9, limited in `51 §3.6`, bounded per-instance and in aggregate by `I63`, restricted to precedence rows 3 and 4, auto-expiring to the restrictive state and never to `NORMAL`, and changing no ceiling — which is checkable, because every aggregate limit is strictly below the signed window ceiling it draws against. **The honest cost: at MVP one OWNER-tier principal is registered, so the practically reachable escape is 24 hours, 5 effects and $50.00, and a longer outage ends in a statutory breach unless the owner registers a second approver.**

**And the reachability of the corroborated state is narrower than v1.2 implied** (v1.3, TA-06). The corroboration signal travels from the audit plane to the control plane, so in a network partition or an audit-plane outage — the two commonest real cases — it cannot be fetched and `CORROBORATED_DEGRADED` is **unreachable**. `30 §5.6` tabulates the outage classes. The residual is not an edge case; it is the common case.

**This is a chosen trade-off, not a resolution.** It is stated as such in `30 §5`, `36 §6` and `47 §9`. EM16's purpose — that no effect escapes the record — is satisfied by a locally committed, locally chained, gap-free journal row. What the mirror adds is *unsuppressibility*, and that matters most exactly where the action cannot be undone, which is why **the degraded halt boundary** sits at IRRECOVERABLE rather than at zero. **It is a boundary on degraded operation, not a prohibition** — in `NORMAL` the record *is* being made, and v1.3.4 corrects the table that had said otherwise (`30 §5.1b`). Trading the mirror for a statutory deadline on a reversible or compensable action is the better of two bad options, and making the trade explicit is better than a rule that would breach the law in the name of an audit property.

**What is given up.** During a mirror outage **in `NORMAL` or `CORROBORATED_DEGRADED`** — and, for REVERSIBLE effects, in `UNCORROBORATED_STALL` too — an effect is dispatched with only a local chain behind it. In `UNCORROBORATED_STALL` the statutory-clock-bearing case **suspends** instead, which is the inversion, and clearing it costs the specified override (`30 §5.7.2`). If the control plane is compromised *and* the mirror is unreachable, those effects are unauditable. The compensating controls are the anchoring cadence (I17b, one hour) and the audit plane's independent vendor reads (I8) at `I8_sweep_cadence + vendor_reporting_lag` (`30 §5.10`, `51 §3.2`), which can discover the effect from the vendor's side afterwards — **for the subset that touched a readable vendor system, and for no other** (registry `§3` item 9).

---

## 4. What these principles deliberately do not decide

Stated so the red team can distinguish an omission from a decision.

1. **How opportunity discovery actually works.** `10 §5.3` records that niche discovery has *"nothing mature and trustworthy"* behind it. `11` never closes it. The architecture supports the evidence plumbing (`31`, `24 §7`); it does not claim the discovery algorithm.
2. **Which business model is first.** By construction (`21 §5`: no ACTIVE LEAD). The architecture is tested against four candidate shapes in `33 §9`.
3. **What the numeric authority limits should be.** `07 §9`: *"The numbers in the Green row are illustrative. The structure is the finding."* Nothing in the literature calibrates them; the owner sets them against risk appetite.
4. **Whether competitor poisoning of the decision process can be defended at all.** `07 §4.4`, `07 §11.1`: no benchmark, no measured defence, and it presents as a bad business decision rather than a security incident. `29 §7` designs the best available controls and states plainly that their efficacy is unmeasured.
5. **Whether the utterance validator's false-negative rate is acceptable.** `07 §11.7`: no published benchmark exists. EM4's construction-first response is a way of not needing the answer; it is not the answer.

---

## 5. Principle-to-evidence index

| Principle | Primary Phase 1 anchor | Evidence class in Phase 1 |
|---|---|---|
| EM1 | `20 §5 I2`, `21 §7.1` | Two independent classifications, 0 of 56 both |
| EM2 | `21 §7.2`, `08 §8.2`, Nasr et al. | Measured ASR + vendor documentation |
| EM3 | `20 §5 I4`, `21 §7.3` | Independent classification finding |
| EM4 | `07 §7`, `21 §7.4` | Tribunal decision + documented incident |
| EM5 | `20 §5 I1` | 28/56 vs 26/56 across two taxonomies |
| EM6 | `08 §1`, `07 §11.2` | Arithmetic + benchmark degradation |
| EM7 | `21 §7.7`, `06 §2.6` | Computability + FinanceBench/GSM-Symbolic |
| EM8 | `21 §7.8`, `07 §3` | Four verified in-the-wild exfiltrations |
| EM9 | `20 §3`, `20 §7` | Taxonomy sensitivity, 2.25× / 1.38× |
| EM10 | `17 §5.4`, Shopify ToS 2026-08-01 | Primary policy text |
| EM11 | `17 §5.1`, `17 §5.4`, `17 §5.5` | Primary policy text, three platforms |
| EM12 | Gordon et al. 2023, 663 RCTs | Peer-reviewed field experiment |
| EM13 | `18 §5`, `17 §2` | SEC XBRL, ten filers |
| EM14 | `08 §6`, `21 §8.13` | Vendor documentation + simulation evidence |
| EM15 | `07 §8` | Statutory text |
| EM16 | `06 §2.7`, `08 §10` | Drift literature + retention facts |
| EM17 | `07 §4.3`, IC3 2025 | Federal crime statistics |
