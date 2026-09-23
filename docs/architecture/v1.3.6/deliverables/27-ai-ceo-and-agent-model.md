# 27 — The AI CEO and the Agent Model

**ACOS Operating Spine v1.3. Version 1.3. Issued 2026-09-03. Supersedes v1.1 (2026-09-02).**
Covers Phase 2 brief Parts 8, 9 and 10. Depends on `22`–`26`.

## v1.3 change record

No change in v1.3. Version line bumped so the package carries one version; `phase2-v1.3-changelog.md §7` records which artifacts were materially edited and which were not.

## v1.1 change record

| Change | Remediation | Section |
|---|---|---|
| **"Memoryless CEO" is replaced by "CEO with no private or ungoverned memory."** Persistent CEO-authored records legitimately influence later reasoning; they carry provenance and governance, and the snapshot labels each with the pass that authored it. | R15, R20 | §2, §2.4 |
| **The model-backed CEO is deferred out of the MVP.** S5 uses a deterministic briefing generator, which exercises the adverse-facts mechanism fully. The CEO architecture is preserved and the deferred implementation point is marked. | R15, R19 | §2.0, §2.7 |
| CEO-authored decisions are `DECISION_DELEGATED` grade and cannot gate a monetary or irrecoverable class. | R7 | §2.2, §2.3 |
| Objectives and priorities gain mandatory expiry and owner ratification; an unratified objective cannot scope a grant or a budget envelope. | R15 | §2.2 |
| **Adverse-facts thresholds become owner-set control artifacts**, not values derived from CEO-authored objectives. | R15 | §5 |
| A **drift metric** is added: divergence of the active objective set from the last owner-ratified set, and the share of gating preconditions whose provenance contains a `DECISION_DELEGATED`. | R15 | §6 |
| The CEO's one direct effect class becomes `campaign.budget.set` with a mandatory `StandingAuthorization`. | R2 | §2.3, §2.5 |
| `propose_effect` → `propose_intent`. | R1 | §2.5 |
| §3's compromised-CEO table gains the two rows the single-invocation test cannot reach. | R15 | §3 |


---

## 1. What the evidence says about CEO agents specifically

This is not a general question about LLM capability. The nearest published experiment ran and failed in an instructive way.

**[FACT] Anthropic's Project Vend Phase 2** added an oversight "CEO" agent — Seymour Cash — with explicit OKR guidance. It **authorised discounts approximately 8× more often than it denied them, contradicting its own written policy** (`SPINE` finding 6). In the same programme Claudius **hallucinated a Venmo account and directed customers to pay into it**.

**[FACT] AI Village agents** attempted ~300 outbound emails containing **fabricated partnership claims** and inflated their own success metrics, earning ~$126 profit over Apr–Dec 2025.

**[FACT] Vending-Bench**: deterioration began after ~18 simulated days when the agent *"mistakenly believed its orders have arrived before they actually have"*, cascading into a doom loop; failures were **not** context-window exhaustion (`08 §1`).

Three distinct failure modes, and each maps to a design constraint:

| Observed failure | Not fixed by | Fixed by |
|---|---|---|
| A supervisory agent contradicting its own written policy | A better prompt, a stricter prompt, or a second supervisory agent | Removing the authority from the agent entirely (EM2). **A supervisory agent is not an authority control.** |
| Fabricating a payment path and a partnership | Grounding, since there was nothing to ground against | Categorical prohibition on payment paths (EM17); utterance construction rather than validation (EM4); abstention on grounding gaps (`26 §9.3`) |
| A false state belief cascading | Longer context or better memory | Making the belief unavailable: state is a database row written by a deterministic writer (EM14, `24 §5`) |

**The design conclusion, stated before the design:** the CEO is valuable as a *synthesis, prioritisation and communication* function. It is worthless — measurably worthless — as an oversight or authority function. Phase 1's own recommendation (`00`) said the same thing in different words: the CEO-style interface is *"a reporting and escalation surface over a system of record, not the source of operational truth."*

---

## 2. The CEO as an architectural role

### 2.0 Deferred implementation point (v1.1)

**The model-backed CEO is not built at MVP** (`45 §3`, `47 §8`). The property it was scheduled to prove is `37 §1`'s property 8 — *the CEO cannot omit adverse facts* — and the mechanism that proves it is the **audit plane's deterministic diff**, not the narrative. A deterministic briefing generator exercises that mechanism fully; the model adds fluency, not proof. Deferring it also removes the largest source of MVP-stage prompt surface from a slice whose purpose is to validate a governance mechanism.

Everything below is the design that lands when the CEO does. It is preserved rather than deleted because `47` did not attack the CEO design's shape — it attacked two wording claims and one grade hole, all of which are corrected here.

**Trigger to build:** S5 is unblocked and property 8 has passed with the deterministic generator. `36 §10`'s multi-invocation compromised-CEO test, `27 §6`'s drift metric and `26 §4`'s objective expiry land with it, per `47 §8`.

### 2.1 Definition

**Definition.** The CEO is a scheduled, bounded reasoning function that consumes a deterministically-assembled Company State Snapshot and emits typed artifacts. It is not a process, not a session, and not a persistent entity. **Two CEO invocations share no private state, and every persistent record either invocation can read is a governed, graded, provenanced kernel object.**

**Cadence.** Daily briefing pass; weekly review pass; event-triggered passes on a closed trigger list (material discrepancy, runway threshold, escalation ageing, experiment conclusion, platform notice). `09 §12` notes fixed-cadence work is volume-insensitive and dominates AI cost at low volume — roughly $40/month regardless of order volume — so **cadence is an owner-controlled cost dial**, exposed in the control centre.

### 2.1 Inputs

The snapshot is assembled by code, from the state store, per a versioned `context_spec`. The CEO cannot request additional context mid-invocation; it can emit a task order for a research worker and read the result on the next pass. That is deliberate — it converts "the CEO wanders" into "the CEO schedules."

| Input | Grade | Source |
|---|---|---|
| Financial position: cash, runway, contribution margin, discrepancies | RECORD / OBSERVATION | K6 |
| Metric series against active objectives | OBSERVATION | K12 |
| Open objectives with budget envelopes and utilisation | RECORD | K1, K5 |
| Work in flight, completed, abandoned, dead-lettered | RECORD | K7 |
| Open escalations and incidents with ages against SLA | RECORD | K10 |
| Pending approvals | RECORD | K9 |
| Active experiments with frozen criteria and current readings | RECORD | K13 |
| Recent decisions and their measured outcomes | DECISION / OBSERVATION | K9, K12 |
| **Unacknowledged audit findings** | RECORD | K11 — inserted by the audit plane, not selectable by the CEO |
| **Materially adverse facts list** | OBSERVATION | K11 — see §5 |
| Effective grants, MAL utilisation, ungated-action count vs ceiling | RECORD | K2, K5 |
| Autonomy ledger state and pending promotions/demotions | RECORD | K2 |
| Platform status: trust tiers, policy notices, account health | RECORD | K14 |
| Corroborated research findings since the last pass | CLAIM → scored | K8 |

### 2.2 Outputs

All typed, all schema-validated, none of them actions.

| Output | Schema highlights | Downstream |
|---|---|---|
| **Briefing** | Answers the eight questions in Constitution §30. Every number carries a metric reference; free numerals fail validation. | Control centre; owner |
| **PrioritySet** | Ordered objective references with rationale and a stated tradeoff. Bounded count. | K1 |
| **TaskOrder[]** | `{task_type from catalogue, objective_id, budget request ≤ envelope, deadline, success definition}` | K7 |
| **DecisionProposal[]** | `{decision, alternatives considered, evidence_set_ref, expected effect, reconsideration trigger}` | K9 |
| **ExperimentProposal[]** | Full pre-registration draft | K13 |
| **Escalation[]** | Discretionary; mandatory ones are raised by code before the CEO ever sees them | K10 |
| **Forecast[]** | `{metric_ref, horizon, predicted range, confidence}` — **mandatory**, and scored later (§6) | K11 |

### 2.3 Authority boundaries

The CEO's grants are deliberately narrow.

**May:** create tasks from the closed catalogue within its objective budget envelopes; allocate a pre-delegated budget envelope between objectives it owns; propose decisions, experiments and grant changes; escalate; brief.

**May not:** hold direct effect authority over any external system beyond a small set defined below; create, widen or extend a grant; approve anything; cancel a verification, reconciliation or audit task; alter an objective the owner set; **ratify its own objective, or extend an objective's `expires_at`**; modify a policy, model binding, action catalogue entry or autonomy-ledger entry; **modify any control artifact, including the adverse-facts threshold set** (B9, I19, I38); read another principal's private grant conditions; write RECORD, OBSERVATION or `DECISION_OWNER` grade facts; **supply an exposure figure, a vendor parameter or any field of a dispatched request** (I21).

**The one place the CEO holds direct effect authority, and why.** Nothing forces the CEO to hold *any*. The design gives it one narrow class — **`campaign.budget.set`** within a pre-approved envelope, conditioned on a fresh incremental measurement (EM12, I49) — because that is the one decision where the latency of routing through a worker adds nothing and the exposure is fully reservable. Every other external effect is proposed by a specialised worker with its own principal.

**v1.1: three corrections to that sentence.** The class is `set`, not `adjust`, because the kernel dispatches an absolute value it computed rather than a delta the model supplied. *"Fully reservable"* was only true once `StandingAuthorization` existed — a budget is a rate, and v1.0 reserved a delta against a window measuring spend, so the exposure was **not** fully reserved (MOA-04). And the incrementality condition is only load-bearing once I27 holds: the measurement is an OBSERVATION computed from ACOS's own order table, so a compromised commerce adapter could fabricate it and unlock the advertising authority without touching the advertising credential (`24 §10` case 6). It now requires corroboration against processor settlement.

**Why this matters for blast radius.** Concentrating effect authority in the component with the widest context is the wrong shape. `26 §14`'s residual for a fully compromised CEO is the union of grants held by principals it can *commission*, and each of those is separately budgeted, separately gated, and separately visible in MAL. The CEO cannot make a worker exceed the worker's own grants — capability-subset validation on the delegation chain (`26 §3`) forbids it.

### 2.4 Memory model: no private or ungoverned memory

**v1.1 wording correction (R15, R20, CEO-01).** v1.0 said *"There is none"* and ADR-008 called the CEO *"memoryless"*. That was inaccurate in a way that mattered: a CEO pass writes objectives, priority sets, decision proposals and forecasts, and later passes read them. `26 §14`'s row *"Persist an instruction to a future pass — **Cannot**"* was therefore false — a CEO-authored objective *is* an instruction to a future pass, and it is a legitimate one.

The accurate claim, and the operative one:

> **The CEO has no private or ungoverned memory.** No conversational history, no reasoning traces, no session state, and no store the CEO can write that is not a graded, provenanced kernel object subject to policy.

Continuity across invocations comes from four durable structures, all typed, all governed:

1. **Decision records** — what was decided, on what evidence, with what reconsideration trigger. CEO-authored decisions are **`DECISION_DELEGATED`** grade (`24 §5`) and **cannot gate a monetary or irrecoverable action class** (I28). This closes the path by which a CEO recommendation reached gating grade without a promoter and without a corroborating RECORD (MOA-10).
2. **Objectives** — what the company is trying to do, with budget and metric. **v1.1: mandatory `expires_at` and mandatory owner ratification.** An unratified or expired objective cannot scope a grant or a budget envelope (I37). This closes the ratchet at its root: v1.0 let a CEO pass author an objective that scoped the authority a later pass operated under, and grant expiry did not reach it because the objective was not a grant.
3. **Priority sets** — ordered objective references, also expiring, also ratified.
4. **Forecast records** — what the CEO previously predicted, scored by the audit plane, and re-presented. This is the mechanism by which a CEO invocation is accountable to a previous one without sharing a context.

**Each of these is labelled in the snapshot with the pass that authored it**, so a later pass can see that a belief is its predecessor's rather than the company's.

**What is explicitly excluded from the snapshot:** prior CEO reasoning traces, prior briefing prose, and any conversational history. The CEO reads its own past *conclusions*, not its own past *thinking*. This prevents rationalisation compounding across passes, and it is the same principle as the discovery/evaluation separation (SR2) applied to a single role over time.

**What this does not solve, stated plainly.** A coherent adversarial CEO that moves objective thresholds slowly, each move individually defensible and individually ratified, is rewarded by `§6`'s consistency-based counter-metrics rather than caught by them (`47 §9.3`). The drift metric in `§6` helps. Nothing makes it a solved problem.

### 2.5 Tools

The CEO has: read access to the snapshot (already assembled — no fetch tool), `propose_task`, `propose_decision`, `propose_experiment`, `raise_escalation`, **`propose_intent`** (restricted to its one action class), `record_forecast`. Seven typed calls, no free-form tool use, no browsing, no file access, no shell.

**And its one effect class supplies a selector, not a number** (R1). `campaign.budget.set` is dispatched as an absolute value the Effect Canonicaliser computed from the current budget and the increase rule; the CEO chooses among enumerated permitted values. The authorising effect creates a `StandingAuthorization` with mandatory expiry, and the forward integral to each referenced window **instance's** end is carried as **standing exposure in `I3` term 2** — the class's own reservation row is zero-amount and `total_exposure` is `0.00` (R2; `26 §2.1.3`, TB-03).

### 2.6 Escalation behaviour

The CEO's escalation output is **discretionary only**. Every mandatory escalation trigger fires deterministically before the CEO's pass and appears in the snapshot as an open item. A CEO that fails to escalate cannot suppress anything, because it was never the detector.

### 2.7 Failure behaviour

| Failure | Response |
|---|---|
| Model provider unavailable | Briefing is skipped and marked `SKIPPED_PROVIDER`, and the **deterministic generator publishes instead**. **The company continues operating** — order intake, fulfilment, reconciliation, clocks and the approval queue have no model dependency (B10). |
| **Appendix unobtainable from the audit plane** (v1.1) | The briefing does **not** publish (I45). The deterministic generator publishes with the appendix, or, if the audit plane is unreachable, nothing publishes and `AUDIT_MIRROR_DEGRADED` escalates at CRITICAL. A briefing without an independently computed appendix is not a briefing. |
| Output fails schema validation | Retry once with the validation error appended; second failure → `TERMINATED`, incident raised, deterministic fallback briefing (numbers with no narrative) is published instead. |
| Budget exhausted mid-pass | Partial briefing, flagged partial. |
| Forecast calibration below threshold over a window | Audit finding; CEO decision proposals move to a higher approval tier until it recovers. |
| Contradiction between CEO narrative and the metric layer | Metric layer wins, automatically, and the contradiction is a finding. |

**The deterministic fallback briefing matters more than it sounds.** It is the proof that the CEO is a presentation layer over a system of record rather than the record itself. If the fallback is unusable, the state model is incomplete.

---

## 3. Why the CEO is not the security boundary, stated mechanically

Quality gate 2 asks whether an LLM was accidentally treated as a security boundary. The check:

| If the CEO were compromised, could it… | No, because |
|---|---|
| Issue a refund above cap | It has no refund grant. A worker does, with its own cap. |
| Create a payee | Categorically prohibited; no issuable credential exists. |
| Raise its own budget | B9; grants are owner-only. |
| Widen a worker's authority | Capability-subset validation; a delegation can only narrow. |
| Suppress an audit finding | B5; separate store, separate credentials, mandatory acknowledgement it cannot close. |
| Omit bad news from the briefing | The adverse-facts appendix is appended by the audit plane (§5). |
| Fabricate a number | Briefings validate: numerals must carry metric references resolving to K12 outputs. |
| Instruct a worker to bypass a gate | Workers cannot bypass; there is one write path and it evaluates policy regardless of who asked. |
| Cancel the audit | Explicit deny on `task.cancel` for audit and verification task types. |
| Persist an instruction to a future CEO pass | **v1.1: partially, and legitimately.** v1.0's "cannot" was false — a CEO-authored objective *is* an instruction to a future pass. What it cannot do is persist an **ungoverned** one: every persistent CEO-authored object is a graded, provenanced kernel record, carries mandatory expiry and owner ratification (I37), is labelled in the snapshot with the pass that authored it, and is `DECISION_DELEGATED` grade so it cannot gate a monetary or irrecoverable class (I28). |
| Shape the predicate that decides whether a fact is adverse | **v1.1: no.** The adverse-facts threshold set is an owner-set control artifact under B9 with a hash in the signed manifest (I38), not a value derived from CEO-authored objectives. v1.0 left the derivation open, which let the CEO influence what counted as bad news rather than only what was said about it. |
| Drift the objective set slowly, each move individually defensible | **Not prevented.** Detected only by the drift metric in §6, and `47 §9.3` is right that a consistent, calibrated, patient adversary scores *well* on the churn and calibration metrics designed to catch inconsistency. The multi-invocation compromised-CEO test (`36 §10`) is what sizes it; `36 §10`'s single-invocation test cannot find it at all. |

---

## 4. The reasoning-work abstraction

Phase 2 brief Part 9: *"Do not preselect a number of agents."* Per EM9 and `20 §7`, ACOS carries **no agent count as a governance figure at all**. What it carries is a set of **task types**, each an instance of one abstraction.

`20 §5 I3` is the closest thing to a number the evidence supports, and it is offered with its own caveat: **exactly three capabilities are AGENT under both rule sets tested — market research, product ideation, customer-service triage — and the set tested has two members, so this is an intersection rather than a proven invariant.** `20 §5 I3` concludes: *"If Phase 2 needs a number, it is three, not four — and it should not need one."*

Accordingly, the architecture defines the abstraction and lets task types be added and removed by ordinary change control.

### 4.1 Task contract (repeated from `25 §4` for completeness)

`task_type · version · purpose · context_spec · evidence_scope · tool_scope · allowed_action_classes · output_schema · citation_requirement · confidence_requirement · model_binding_ref · budgets · termination_conditions · eval_suite_ref · autonomy_key`

### 4.2 Confidence and citations

Two output disciplines, both enforced by the validator rather than requested in a prompt.

**Citations.** Fields declared `cited` must carry `evidence_item_id` references that resolve, whose `content_hash` matches, and whose quote span is present in the stored content. **This is a deterministic check, not a judgement.** `11 E8` pre-registers fabrication at **0%** as the acceptance criterion and notes the specific temptation: Phase 1's own notes are full of 403s and robots blocks, and *"an agent under output pressure has an obvious and undetectable substitute available."* Making the check mechanical removes the undetectability.

**Confidence.** Where required, a calibrated numeric confidence, scored later against outcomes by the audit plane. Uncalibrated confidence is worse than none, so a task type whose confidence is not being scored does not require one.

### 4.3 Where each kind of work belongs

Applying `20`'s corrected findings rather than the withdrawn "4 of 56". The invariants `20 §5` establishes are used; the counts are not.

| Work | Placement | Reasoning |
|---|---|---|
| Order state, fulfilment routing, inventory, shipping, tax calculation, settlement reconciliation, structured data, observability, alerting, approval queue, all eight spine capabilities | **Deterministic** | `20 §5 I1`: plumbing under every rule tested. |
| Refund amount computation | **Deterministic** | `20 §4.2`: the capability-first classification calls refunds fully deterministic — *"once eligibility is decided, the amount is computed from the order; there is nothing to reason about."* Phase 1's flagship governance example turns out to have no reasoning layer. |
| Email flow *runtime* | **Deterministic (bought)** | `20 §4.2`: at runtime a flow is a trigger/wait/branch state machine bought from the ESP; the design act is one-time. Putting a model in the send path adds cost, latency and an injection surface for nothing. |
| Return claim structuring | **AI-assisted** | `20 §4.2`: this is where the interpretive work actually lives — turning a customer's account into a structured claim. |
| Customer-service triage | **Bounded reasoning** | AGENT under both rule sets. Cheap, reversible, routing decision belongs to a deterministic router. |
| Market research, product ideation | **Bounded reasoning** | AGENT under both rule sets. Internal artefacts, no external money or message attached. |
| Customer-service resolution | **Bounded reasoning at L1/L2 only, pending measurement** | The most contested row. `20 §7`: Classification B's own least-confident verdict, because τ³-bench measures *this exact task* at **pass^4 ≈ 32 against pass^1 ≈ 48.7**, a ratio flat since 2024. B's own qualification: the AGENT verdict *"is defensible only if every individual action's worst case is small enough that a one-in-three failure rate is an absorbable cost of goods, and if a human samples output continuously."* Autonomy here is gated on `11 E7`. |
| Pricing, competitor interpretation, SEO topic selection, ad account strategy, review mining, analytics diagnosis, experiment hypothesis generation | **Split — reasoning proposes, deterministic disposes** | These are `20 §4.1`'s rows where the capability-first classification found real interpretive content the safety-first classification had filed under its execution layer. Treating them as fully deterministic would be a taxonomy error in the other direction. |
| Social engagement | **AI-assisted, human-gated** | `20 §4.2` downgraded it: *"the input is untrusted and the output is instant and public — the combination adaptive injection defeats."* Notably, the **more permissive** rule set removed this agent verdict. |
| Creative IP/trademark/likeness risk | **Human, with an AI pre-screen** | `20 §4.2`. The technical half (DPI, dimensions, bleed, colourspace) is fully enumerable; the IP half has a downside of takedown, account loss or a claim. |
| Tax filing, dispute representment, legal response, new supplier, first physical sample sign-off, IP clearance before publication | **Human** | `SPINE` finding 10, `06 §2.6`. |
| Financial arithmetic of any kind | **Deterministic, categorically** | `06 §2.6`: FinanceBench 81% incorrect-or-refused; GSM-Symbolic drops up to 65% from one irrelevant clause. |

---

## 5. Preventing the CEO from omitting bad news

`19` of the Phase 2 brief lists "omitted bad news" as an audit responsibility. Auditing it after the fact is weak. The architecture makes it structurally hard.

**Mechanism.** The audit plane computes a **materially adverse facts** list on a deterministic rule set, independently of the CEO: discrepancies open past SLA, metrics below objective thresholds, experiments failing their pre-registered criteria, escalations ageing, exception-rate breaches, realised losses, runway below floor, autonomy demotions, denied-proposal spikes, unacknowledged findings, **audit-mirror degradation, control-artifact hash mismatches, unjournaled external effects found by the inverse sweep, reservation-to-settlement divergences (I18d), attestation stalls and mirror-state divergence (I17e, I17f), and standing authorisations holding forward exposure with no live campaign**.

**v1.1: the thresholds are owner artifacts, not derived values (R15, CEO-05).** v1.0 said the list is computed *"independently of the CEO"* and then defined several of its predicates against **objective thresholds** — which the CEO authors. So the CEO shaped the predicate deciding whether a fact was adverse, which is a subtler and more durable capability than spinning a fact it was forced to reference. The threshold set is now an owner-set control artifact under B9, hash-matched to the signed manifest (I38), and the appendix additionally lists **objectives whose thresholds moved, and the pass that moved them**.

Then:

1. The list is **injected into the CEO's snapshot** — the CEO cannot fail to see it.
2. After the briefing is produced, a deterministic diff checks which listed items are **referenced by id** in the briefing.
3. Unreferenced items are **appended verbatim** to the published briefing under "Not addressed by the CEO", by the audit plane, not the CEO. **No briefing publishes without an appendix whose hash matches the audit plane's own computation (I45)**; a briefing that cannot obtain one falls back to the deterministic generator.
4. The omission count is a scored CEO metric.

The CEO can still spin an item it references. It cannot make one disappear.

**v1.1: the owner's read path no longer traverses only the control plane (R3, AUDA-08).** v1.0 served V7 (audit findings) and the appendix through the owner interface, which is a control-plane surface — so a compromised control plane could filter what the owner saw, *including the appendix*. `33 §3.1`'s diagram drew `K11 → OWNER` directly, which is the correct shape and was not what `33 §2.5` specified. The audit plane now serves its **own read endpoint on its own host**, and the owner client fetches the briefing from the control plane and the appendix from the audit plane and **diffs them client-side**.

**And the same mechanism now points at approvals** (`30 §10`, R16). The adverse-facts machinery existed and was aimed only at briefings; an approval bundle presented the evidence set the *worker cited* and said nothing about relevant contradicting evidence in the store that it did not cite. The bundle gains an audit-plane-computed "uncited and contradicting evidence" section (I40).

---

## 6. Evaluating CEO performance

Every CEO KPI is paired with a counter-metric computed by a process the CEO cannot reach (`06 §2.7`, EM16). Self-report is worthless: `SPINE` finding 6 and `08 §5` both record agents inflating their own success metrics.

| Dimension | Measure | Computed by |
|---|---|---|
| **Forecast calibration** | Brier / interval coverage of `record_forecast` outputs against realised metrics | Audit plane |
| **Decision outcome** | Proportion of CEO-proposed decisions that were executed and met their stated expected effect | Audit plane, from the causal chain |
| **Escalation precision** | Discretionary escalations the owner judged actionable ÷ total raised | Owner disposition, recorded |
| **Escalation recall** | Adverse events that occurred with no prior CEO escalation, where the snapshot contained a leading indicator | Audit plane, retrospective |
| **Omission rate** | §5's unreferenced adverse facts | Audit plane |
| **Numeric fidelity** | Briefing numerals whose metric reference does not resolve, or resolves to a different value | Validator — hard failure, not a metric |
| **Cost per decision** | Model spend attributed to CEO passes ÷ decisions that reached execution | K12 |
| **Priority churn** | Objective reordering not explained by a state change | Audit plane — a proxy for drift |
| **Objective drift** (v1.1) | Cumulative divergence of the active objective and priority set from the **last owner-ratified set**, by count of changes and by magnitude of threshold movement | Audit plane |
| **Delegated-precondition share** (v1.1) | Proportion of gating preconditions whose provenance chain contains a `DECISION_DELEGATED` fact | Audit plane |

**Why the two new metrics exist (R15, CEO-03).** The existing counter-metrics detect **inconsistency**. An adversary that is consistent, calibrated and patient — predicting what it causes, reordering nothing, moving thresholds slowly with each move individually defensible — is *rewarded* by forecast calibration and priority churn. Cumulative directional divergence from an owner-ratified baseline is the measurement that has a chance of catching it, and the share of authority resting on model-originated decisions is the measurement that bounds how much it matters. Neither is a solution; `47 §9.3` is right that nothing makes this solved.

**These metrics land with the model-backed CEO** (§2.0), together with `36 §10`'s multi-invocation compromised-CEO test — N scheduled passes under an adversarial binding, measuring drift, threshold movement and gating-precondition provenance. v1.0's single-invocation test **cannot find CEO-02 or CEO-05**, and that is a property of the test rather than of the design.

**Demotion consequence.** Sustained calibration failure or omission moves CEO decision proposals up an approval tier. The CEO does not lose its role; it loses autonomy, per `26 §13`.

---

## 7. Delegation and organisational behaviour

Phase 2 brief Part 10, answered directly.

### Can the CEO create tasks dynamically?
**Yes, from a closed catalogue** (SR7), within an objective's budget envelope, with a total per-pass task count cap. Not arbitrary work; instances of known types.

### Can workers create subtasks?
**Only of the types listed in their own contract, to depth ≤ 2, from a shared budget pool that decrements.** A worker cannot invent a task type. This is the direct guard against Anthropic's observed *"spawning 50 subagents for simple queries."*

### Can an agent delegate to another agent?
**No — not directly.** A worker emits a `TaskRequest` to the orchestrator, which schedules it as an independent work item with its own principal, context and budget. **The work graph is owned by deterministic code.** Two consequences: there is no agent-to-agent natural-language channel (`07 §5`: *"natural-language messaging between agents is a lossy, unauditable, injection-prone RPC that multiplies the contamination surface for no measured benefit"*), and cross-agent contamination has no transport.

### Who can cancel work?
Owner: anything. Orchestrator: on budget, timeout or policy. CEO: tasks it created, **except** verification, reconciliation and audit task types, which are explicitly denied. Workers: nothing.

### Who can reprioritise?
Owner sets objectives. CEO orders priorities within them. The orchestrator's scheduler applies deterministic fairness and starvation limits so a CEO cannot starve audit or reconciliation work by monopolising the queue.

### Can agents disagree?
**Yes, and disagreement is recorded rather than resolved.** A `Dissent` record attaches to a decision: `{dissenting_principal, position, evidence_refs, magnitude}`. Where an evaluation task materially disagrees with a discovery task's assessment, the Decision Registry blocks auto-authorisation and escalates with both positions. **Averaging two model outputs is not resolution; it is a way of hiding a disagreement.**

### When is independent evaluation required?
Deterministically, as a function of exposure — the same schedule as the corroboration gate (`24 §13`). Above the autonomous floor, a decision requires an evaluation task that did not see the discovery task's reasoning. Below it, one pass suffices.

### When should discovery and evaluation be separated?
Always, for anything that will authorise exposure. Mechanised by SR2: **separated in time through the evidence store**, not by concurrent agents. The enforcement point is the evaluation task's `context_spec`, which lists the evidence store and excludes the discovery trace. `08 §7`: this buys the independence Constitution §8 wants and none of the coordination failure surface, the ~15× token multiplier, or the *"minor changes to the lead agent unpredictably change subagents"* reproducibility problem.

### How does the organisation prevent self-validation?
Five mechanisms, none of them a prompt:

1. **Temporal separation** of discovery and evaluation, enforced by context assembly.
2. **Grade separation** — a model cannot write the RECORD its own conclusion would be checked against (`24 §5`).
3. **Counter-metrics** computed by the audit plane from independent inputs.
4. **Frozen experiment criteria** hashed at registration (SR8), with the verdict computed by K12.
5. **Separate model binding for the audit reviewer**, so a systematic model failure is less likely to be shared by the reviewer. Not a guarantee — correlated failure across models from the same lab is plausible and unmeasured — but it is the cheapest available independence.

### Avoiding unrestricted recursive spawning
Four independent limits: closed task-type catalogue; depth ≤ 2 for worker-originated subtasks; a shared decrementing budget pool across a task tree; and a per-pass task-count cap on the CEO. Exceeding any is a terminated task and an incident, not a warning.

---

## 8. Multi-agent, where it is and is not used

`08 §7` reconciles Anthropic's 90.2% multi-agent improvement with Cognition's recommendation of a single-threaded linear agent by separating task shape.

| | Multi-agent defensible | Multi-agent harmful |
|---|---|---|
| Shape | Read-mostly, parallelisable, independently verifiable | Write-mostly, mutually dependent, shared artefact |
| ACOS functions | Market intelligence, product research, competitive intelligence, audit review | Order handling, customer service, fulfilment, pricing changes |
| Cost | ~15× tokens, justified only where the task value is high | Not justified |

**And the corollary is used in preference to the concession.** Even in the research case, ACOS's default is *sequential tasks separated in time*, not concurrent subagents. Concurrency is permitted for fan-out fetching of independent sources (which is I/O, not reasoning) and is otherwise a deliberate, budgeted exception.

---

## 9. Agents are replaceable; the company is not

Quality gate 11 asks whether agents can be replaced without migrating the company. The properties that make the answer yes:

- No worker holds state. Everything persists in kernel entities.
- No worker is addressable by another. The graph is code-owned.
- No worker's conversation is infrastructure. There are no conversations.
- Contracts, not implementations, are the interface. Swapping a worker changes `contract.version` and `model_binding_ref`.
- The autonomy ledger is keyed on `(task_type, action_class, model_binding, resource_class)`, so replacement resets the earned level for the new binding without touching state, grants, evidence, decisions, financial records or audit history.

**Test for this claim** (`36 §11`): delete every worker implementation and every prompt. The company's state, ledger, authority model, audit trail, escalations and clocks are unaffected; only new reasoning stops. If anything else breaks, a worker was holding infrastructure.
