# 34 — Architecture Decision Records

**ACOS Operating Spine v1.3. Version 1.3. Issued 2026-09-03. Supersedes v1.1 (2026-09-02).**
Covers Phase 2 brief Part 25 and constitution `24`/`25`.

## v1.3 change record

ADR-013 gains a v1.3 amendment covering TA-01 through TA-07. Full disposition in `phase2-v1.3-remediation-ledger.md`.

Each record states context, alternatives, decision, rationale, evidence, consequences, and **the specific condition that would cause reconsideration**. A decision without a reconsideration trigger is a belief, not a decision.

Status values: ACCEPTED (in force), PROVISIONAL (in force, expected to be revisited on named evidence), **AMENDED** (in force with a v1.1 change record), SUPERSEDED.

## v1.1 change record

| ADR | Change | Remediation |
|---|---|---|
| **ADR-002** | Guarantee reach narrowed; **fallback corrected** (a hand-rolled Postgres step journal for a guarantee failure, Temporal only for scale/multi-business and only as an explicit return to Option B); S1 spike added; admin surface isolated; approval durability moved to kernel state. | R9, R18 |
| **ADR-003** | Consequences rewritten: per-module database roles are accidental-coupling detection, not isolation; the privileged `effect_path` role is named. | R4 |
| **ADR-006** | The single write capability is **`propose_intent`**, not `propose_effect`; the model no longer composes the effect. | R1 |
| **ADR-007** | The tolerance-rule temporal check is **I12**, not I7. | R20 |
| **ADR-008** | "Memoryless" replaced by "no private or ungoverned memory"; objective expiry and ratification added; the model-backed CEO is deferred. | R15 |
| **ADR-012** | Langfuse dropped pending an observability egress inventory. | R4 |
| **ADR-013** | Audit store becomes a **replicating verifier**; split halt by recoverability class; hash writer specified; anchoring cadence specified; own read endpoint; **own read-only vendor credentials**; different provider or account. **v1.3: the completeness claim is corrected to attestation-channel continuity plus attested-prefix consistency; `I8`'s cadence and scope are declared; the corroboration signal and the owner override are specified.** | R3, R10, **TA-01…TA-07** |
| **ADR-015** | T-U1 narrowed to twelve structural conditions and **deferred**; T-U0 gains staleness, normalisation, thread-level evaluation, a deterministic tier floor and the non-text rule; the escalation claim restated. | R12 |
| **ADR-016** | Grade lattice splits DECISION into `DECISION_OWNER` / `DECISION_DELEGATED`; grade for vendor-derived facts derives from `(parser_version, transport_identity)`. | R6, R7 |
| **ADR-017** | Irrecoverable currency splits into discretionary and order-driven; **duration** recognised as a third independent dimension; irrecoverable cost enters the disclosed ceiling. | R2, R8 |
| **ADR-021** | **New** — Effect Canonicaliser. | R1 |
| **ADR-022** | **New** — `StandingAuthorization`. | R2 |
| **ADR-023** | **New** — external-write perimeter as a maintained CI-enforced artifact. | R4 |
| **ADR-024** | **New** — credential holding; broker deferred to an execution proxy. | R5 |
| **ADR-025** | **New** — control-artifact manifest. | R11 |
| **ADR-026** | **New** — outbox and recoverability-keyed unknown outcomes. | R13 |

ADR-001, ADR-004, ADR-005, ADR-009, ADR-010, ADR-011, ADR-014, ADR-018, ADR-019 and ADR-020 are unchanged.


---

## ADR-001 — Authoritative company state is a single Postgres database, append-only and bitemporal

**Status:** ACCEPTED.

**Context.** EM14 forbids conversation history as company memory in any form. `24 §9` requires a named system of record per fact type. SR4 requires append-only bitemporal state with declared maximum age per fact type. R1 requires transactional atomicity between exposure reservation, authorisation and effect journaling.

**Alternatives.** Event store with projections (Option C); document store; relational store plus a separate ledger database; vendor agent-memory product.

**Decision.** One logical Postgres for the control plane, one schema per kernel module, append-only tables with no `UPDATE`/`DELETE` grant, two temporal column pairs, and `company_id` non-null everywhere.

**Rationale.** R1 is the hardest correctness property in the system and a single database satisfies it with a transaction rather than a protocol. Projections introduce a lag between the log and the exposure headroom that authorisation reads, which converts a performance property into a correctness hazard. A vendor memory product cannot satisfy EM16's unsuppressibility or R6's models-offline requirement.

**Evidence.** `24 §2` kernel derivation; `31 §2`; SR4, SR5.

**Consequences.** Vertical scaling until a pooler is needed. Schema migrations on append-only history require care. Temporal queries work natively, so `36`'s replay tests are meaningful.

**Reconsider if:** a second operating company requires independent write throughput that a single primary cannot serve, or if audit retention requirements force physical separation of historical partitions.

---

## ADR-002 — Durable execution is DBOS Transact, in-database

**Status:** PROVISIONAL.

**Context.** R2 requires that completed workflow steps are journaled and never re-executed on resume. R3 requires human approval to be a durable suspension surviving process restart. `08 §8.1` documents that LangGraph's `interrupt()` re-runs the interrupted node on resume, which in a refund workflow can re-issue the refund.

**Alternatives.** Temporal (MIT); Restate (BSL); Inngest self-hosted (SSPL); Cloudflare Workflows; AWS Step Functions; LangGraph checkpointing; hand-rolled state machine on Postgres.

**Decision.** DBOS Transact (MIT, v2.23.0, 2026-06-01) as primary — **provisional, and subject to an S1 spike against an ACOS-owned Postgres step journal on the same kill-point matrix.**

**Rationale.** DBOS's checkpoint lives in the same Postgres as the exposure ledger and the effect journal, so a step checkpoint and a reservation commit in one transaction — satisfying R1 and R2 simultaneously, which no external engine does. Restate is BSL and Inngest self-host is SSPL, both failing R12. Cloudflare cannot be self-hosted and its retention is not an audit record. Step Functions fails R11. LangGraph fails R2 outright.

**v1.1 amendments (R9, R18).**

**(a) The guarantee's reach is restated.** DBOS eliminates re-execution across **suspension and resume** — the documented LangGraph `interrupt()` case, and the real failure it was selected for. It **narrows but does not close** the crash-during-dispatch window, because an *incomplete* step is not a checkpointed step. **Duplicate prevention at the dispatch boundary rests on vendor idempotency, a vendor query, or ACOS's own outbox claim.** `23 §6` B8 and `25 §7` always said this; `33 §1` and `35 §4` contradicted them and are corrected. **This ADR no longer claims DBOS prevents the double refund.**

**(b) The fallback was wrong and is corrected.** Migrating to Temporal **moves the checkpoint out of Postgres and destroys R1** — the property `33 §1` calls decisive and the reason Option A beat Option B — so v1.0's *"re-hosting rather than a rewrite"* was false.

| Trigger | Fallback |
|---|---|
| An observed defect in the never-re-execute guarantee | **An ACOS-owned Postgres step journal.** Keeps the checkpoint in the same database and preserves R1. |
| A second operating business with independent workflows, or a workflow routinely exceeding 30 days with external callbacks | Temporal — **and taking it is an explicit return to Option B, requiring a distributed-reservation design and a new ADR.** |

**(c) The unevaluated option is spiked.** This ADR listed a hand-rolled Postgres step journal among its alternatives and never evaluated it. On this package's own criteria — one developer, low volume, and a loss-bounding mechanism simple enough to attack directly — it is a serious contender. **S1 spikes both against a vendor sandbox** for `refundCreate` and for the ESP, not against mocks (VAL-04).

**(d) The admin surface is closed.** `fork` re-drives a workflow from a chosen step, which is a re-execution mechanism the never-re-execute guarantee does not address (SPO-08). **Disable it or network-isolate it** so it is unreachable from any process other than an owner-authenticated operator session; assert this as a test. Any fork is an owner-authenticated action recorded as a decision.

**(e) Approval durability no longer rests on this engine.** R3 is satisfied by **kernel state**, not by workflow suspension (R9). Approval waits persist as `Approval` rows and the proposing workflow terminates; resumption starts a new workflow keyed on `(approval_id, original_idempotency_key)`. This removes the resume ambiguity in `26 §12` and the orphaned-suspension risk from OWNER approvals waiting across a deploy that pinned a different workflow version (DBO-03).

**Evidence.** `08 §8.1`; `31 §3`; `43 §5.2`; `47 §4`; R2, R3, R12.

**Consequences.** Smallest ecosystem of the durable-execution candidates and the youngest. Workflow language is coupled to the DBOS SDK; polyglot workers talk to the kernel over HTTP instead. **v1.1: because the outbox is ACOS-owned code either way, the engine is not load-bearing for the money path** — which is the most useful consequence of these amendments and the reason the choice can stay provisional without holding up S1.

**Reconsider if any of:** (a) an observed defect in the never-re-execute guarantee → the step journal; (b) a second operating business with independent workflows → Temporal, as Option B; (c) a durable workflow routinely exceeds 30 days with external callbacks → same; (d) DBOS releases stall for two consecutive quarters or the licence changes; (e) **the S1 spike shows the hand-rolled journal is simpler to attack and equally correct**. **Throughput alone is not a trigger.**

---

## ADR-003 — The system shape is a modular monolith, not services

**Status:** ACCEPTED.

**Context.** `32` compares four substrates. One developer, one proving-ground business, and a quality gate (15) requiring the MVP be small enough to build *and attack*.

**Alternatives.** Service-oriented with an external workflow engine (Option B); event-log-first (Option C); commerce-framework-anchored (Option D).

**Decision.** Option A. One control-plane deployable with fifteen internally enforced kernel modules; workers, adapters and the audit plane as separate processes.

**Rationale.** Distributing the reservation-authorisation-journal sequence puts the most likely location of a subtle concurrency bug inside the mechanism that bounds financial loss. Every hour of cluster operations is an hour not spent on `36 §9`'s injection harness, which is where `11 E6` and `11 E11` get their numbers. D is rejected separately under ADR-014.

**Evidence.** `32 §6` comparison; `26 §10` MAL dependency on reservation integrity; quality gate 15.

**Consequences (v1.1 rewritten, R4, MON-01/MON-02).** Single blast radius for a bad control-plane deploy. v1.0 offered the separately-deployed audit plane as the mitigation; **that protects the *record*, not the *company*** (`41 §3.2`), and the honest blast radius is larger than v1.0's §8 suggested: under control-plane compromise the only properties that survive are the audit store's resistance to retroactive alteration by an `INSERT`-only principal and the limits of the adapters' vendor credentials.

**And the enforcement claim is restated.** v1.0 said module boundaries *"must be enforced mechanically (per-module database roles)"*, and `33 §6` claimed a module reaching into another's tables *"fails at the database rather than in review."* That contradicted ADR-003's own decisive argument, because the R1 transaction spans `authorisations`, `effects`, `exposure_reservations` and `state_facts` — four module schemas — and therefore requires a role spanning them.

> **Per-module database roles provide accidental-coupling detection and SQL blast-radius limitation. They are not isolation against compromised in-process code.**

The **`effect_path` role**, spanning those four tables plus the journal, is named and **declared the privileged path**. It is the highest-value role in the company. Module-boundary tests retain their value — they catch the drift into a ball of mud that is this ADR's real risk — and they do not bound a compromise. **This is a downgrade of a claimed property and it carries this change record.**

**Reconsider if:** the ADR-002 triggers fire, or a team larger than three engineers makes service boundaries cheaper than they cost.

---

## ADR-004 — No message bus

**Status:** ACCEPTED.

**Context.** `25` requires event ingestion, queueing, retry and dead-lettering. Kafka, NATS, SQS and Redis Streams are the conventional answers.

**Alternatives.** Kafka; NATS; SQS; Redis Streams; Postgres-backed queues.

**Decision.** DBOS queues on the same Postgres. No separate broker.

**Rationale.** Expected volume is low thousands of orders per month and hundreds of gated effects per month. A broker at that volume buys operational surface and buys back nothing, and it breaks the R1 transaction by moving enqueue outside it. Postgres-backed queues let "enqueue the follow-up work" commit atomically with "record the effect", which removes an entire class of lost-work bug.

**Evidence.** `31 §5`; `33 §8` scale envelope.

**Consequences.** Queue throughput is bounded by Postgres. Fan-out patterns that a broker makes trivial require explicit work.

**Reconsider if:** sustained enqueue rate exceeds roughly 100/second, or a second company requires cross-company event distribution.

---

## ADR-005 — Authorisation is Cedar, evaluated in-process, with symbolic proofs in CI

**Status:** ACCEPTED.

**Context.** R4 requires policy evaluation outside the model's reach, deterministic, versioned, and **provable** on money-bounding properties. `11 E6`'s acceptance threshold is zero policy-violating writes and no symbolic counterexample.

**Alternatives.** OPA/Rego; Oso; SpiceDB; hand-written policy code; policy expressed in prompts.

**Decision.** Cedar (Apache-2.0) linked in-process, with `cedar-policy-symcc` (in the `cedar-policy/cedar` repository) running the properties P1, P2, P3, P4, P4a, P5, P5a, P6 and P7 from `26 §11` in CI. OPA is the named fallback.

**v1.1 amendment (R14, R19).** The CI gate is **deferred past S1** — with a three-class action catalogue the policy set is hand-checkable, and the complexity budget belongs to the Effect Canonicaliser (ADR-021). It returns before the catalogue exceeds ten classes and before any real money. **Recorded as a formal amendment to `11 E6` in `28 §9.2`, not applied silently.** P4's rewritten form is hand-proved over the MVP catalogue in `26 §11.2`.

**Rationale.** Cedar is the only candidate with a symbolic compliance checker, which is what turns "we believe the policy bounds spend" into a proof obligation that fails a build. In-process evaluation costs microseconds, so evaluating on *every* effect including cheap ones is free — which matters, because a chokepoint that is bypassed for cheap actions is not a chokepoint. Policy in prompts is excluded by EM2 and by the Cursor invented-policy incident, where a support agent stated a nonexistent device restriction as policy. Oso is deprecated. SpiceDB solves relationship graphs, not numeric envelopes.

**Evidence.** `31 §4`; `26 §11`; `11 E6`; EM2, DP3.

**A wording tension worth resolving explicitly.** EM2 in `22` states that policy evaluation is *"a separate process boundary from model inference"* and that enforcement is *"**never** in an in-process SDK callback."* Cedar here is in-process **to the control plane**, which is a different process from every model runtime. The boundary EM2 requires is between the policy engine and the *model*, and it holds: workers are separate sandboxed processes with no credentials, no policy-engine access, and one write capability. The failure EM2 names is the Agent SDK's `canUseTool` pattern, where enforcement lives inside the same process as inference and is bypassable by configuration. Linking Cedar into the deterministic kernel is the opposite arrangement. `36 §13`'s module-boundary test and `36 §10`'s compromised-worker test both verify that no model-bearing process can reach the engine.

**Consequences.** Cedar cannot express everything: numeric aggregation over time windows lives in the exposure ledger, not in policy, and `36 §4` states explicitly what symcc does not prove. In-process linkage means a policy-engine upgrade is a control-plane deploy.

**Reconsider if:** policy expressiveness requires constructs Cedar lacks and the exposure ledger cannot absorb, or if symcc's supported fragment excludes a property in P1–P7. **This is the risk that made deferral cheap: it is this ADR's own reconsideration trigger, and deferring the gate defers the trigger with it.**

---

## ADR-006 — Models hold exactly one write capability: `propose_intent(ProposedIntent)`

**Status:** **AMENDED** (v1.1, R1). Accepted in substance; the capability is renamed and narrowed.

**Context.** EM1, EM2, EM9. `08 §8.2` documents a `canUseTool` permission bypass that failed silently. MCP cannot express numeric authority envelopes. EM9 requires *ungated agent actions per month* to be exactly countable.

**Alternatives.** Per-vendor write tools with per-tool permissions; MCP scopes; a tool allowlist per agent; a single write tool.

**Decision.** SR1. No per-vendor write tool exists in any model's tool list. Every external state change originating in reasoning is a **typed intent** to the Effect Gateway, which is deterministic code **and which constructs the effect itself**.

**v1.1 amendment.** v1.0's capability was `propose_effect(typed_proposal)`, and the name was accurate about what the design did: the model composed the effect, including the figure that bounded it. `26 §2` v1.0 carried `exposure` and `parameters` as proposal fields; `26 §7` reserved against them; `26 §8`'s worked policies read `context.parameters.amount`. **So the number the entire governance model bounds was supplied by the component the architecture assumes is compromised**, and B3's wording was false as written (MOA-01, `47 §1` item 1).

The capability becomes **`propose_intent(ProposedIntent)`** with five fields — `action_class`, `resource_ref`, `selector`, `reason_code`, `rationale` — of which four reach the authorisation request and one is journaled and never parsed. **`selector` is an index into a kernel-enumerated option set, never a value.** ADR-021 specifies the constructor. I21 makes it a type-level property that no other `ProposedIntent` field reaches the request.

**The rename is not cosmetic.** `propose_effect` describes a model composing an effect, and the architecture must not do that.

**Rationale.** This collapses three separate hard problems — tool-permission correctness, MCP's inability to encode envelopes, and countability — into one schema-and-policy problem in code the model cannot reach. It also makes the closed action catalogue (SR7) the single extension point, so adding a capability is a deliberate act with a policy consequence rather than an incidental tool registration.

**Evidence.** `08 §8.2`; `29 §5` MCP posture; EM9; SR1, SR7.

**Consequences.** Every new capability requires an action-class definition, a policy, an adapter method **and a versioned canonical constructor**. This friction is intentional, and v1.1 increases it: **an action class that cannot be deterministically canonicalised is not eligible for autonomous execution** — the same disqualifier logic `25 §7` applies to idempotency. Model-side ergonomics are worse than native tool calling and worse than v1.0's, because the model must now reason about an enumerated option set rather than propose a value.

**Reconsider if:** a tool-permission mechanism appears with a *measured* bypass rate and formal guarantees comparable to in-process policy evaluation. Vendor assurance is not sufficient.

---

## ADR-007 — Financial truth is produced by deterministic code with no model in the accounting path

**Status:** ACCEPTED.

**Context.** EM7. `28 §4` requires a settlement-level equality check with exactly three outcomes. The constitution forbids optimising for traffic, impressions or gross revenue.

**Alternatives.** Model-assisted reconciliation; model-generated financial summaries as the record; order-level accounting sync; settlement-level bookkeeping.

**Decision.** The K6 Financial Truth **computation** contains no model client **and no vendor credential** (v1.1, R4 — ingest is split into the integration boundary; see `28 §3`), both CI-checked. Settlement-level bookkeeping via A2X. Three settlement states only: MATCHED, MATCHED_WITH_TOLERANCE(named_rule), UNMATCHED → Discrepancy. **A tolerance rule may never be created in response to an open discrepancy**, and audit invariant **`I12`** checks this.

**v1.1 correction (R20).** v1.0 attributed the tolerance-rule temporal check to `I7` here, in `28 §4`, in `35 §8` and in `36 §12`, while `30 §6.1` defined `I7` as the MAL sum and `I12` as this check. **It is I12.** `phase2-v1.3-invariant-registry.md` now owns every identifier. **And the audit plane recomputes the settlement equality from its own read-only processor and bank credentials** (R10), because v1.0 proved financial truth by comparing the control plane's projections to each other.

**Rationale.** A model in the accounting path means the number the owner sees can be wrong in a way that is fluent and undetectable. Order-level sync never ties to a bank line, so it cannot produce the equality check. The tolerance-rule prohibition exists because the natural failure mode is to widen tolerance until the discrepancy disappears.

**Evidence.** EM7; `28 §3`, `28 §4`; `31 §11`.

**Consequences.** Models may *narrate* finance from computed figures but never produce them. Reconciliation exceptions require human or deterministic resolution, which adds to the `06 §4` human residual.

**Reconsider if:** never for the accounting path. The narration boundary may move if grounding-coverage checks reach a measured false-negative rate.

---

## ADR-008 — The unit of reasoning work is a task, not an agent

**Status:** **AMENDED** (v1.1, R15). Accepted in substance; the memory claim is corrected and the model-backed CEO is deferred.

**Context.** EM9 makes agent count the wrong governed quantity. `20` shows the agent-outright capability count moves 4→9 (2.25×) under a plausible reclassification, so any architecture keyed to agent count is unstable. `27 §1` records the Project Vend CEO agent approving discounts roughly 8:1 against its own policy.

**Alternatives.** Persistent named agents with roles and memory; a hierarchical agent organisation; a swarm; bounded stateless tasks.

**Decision.** A task has a type, a `context_spec`, a model binding, a token budget, a step budget, an output schema, and an autonomy record. Workers are stateless. There is **no agent-to-agent channel**. Delegation depth ≤3 with signed capability-subset validation; worker subtask depth ≤2. Pydantic AI (MIT) is used at the worker boundary only, never for orchestration (R11).

**Rationale.** Statelessness makes `context_spec` the enforcement point for SR2's independence in time, and makes replay possible. Persistent agent memory recreates EM14's prohibited condition by another name. Agent-to-agent channels are an injection propagation path with no compensating benefit at this scale.

**v1.1 amendment (a): "memoryless" is replaced (CEO-01).** v1.0 called the CEO *memoryless* and `26 §14` asserted it *"cannot persist an instruction to a future pass."* Both were inaccurate: a CEO pass writes objectives, priority sets, decision proposals and forecasts, and later passes read them — **and a CEO-authored objective is an instruction to a future pass.** Operative wording:

> **The CEO has no private or ungoverned memory.** No conversational history, no reasoning traces, no session state, and no store it can write that is not a graded, provenanced kernel object subject to policy.

Persistent CEO-authored objects are legitimate, and three properties make them safe rather than merely visible: they are **`DECISION_DELEGATED`** grade and cannot gate a monetary or irrecoverable class (ADR-016, I28); objectives and priority sets carry **mandatory expiry and mandatory owner ratification**, and an unratified or expired objective cannot scope a grant or a budget envelope (I37); and each is **labelled in the snapshot with the pass that authored it**, so a later pass can see that a belief is its predecessor's rather than the company's.

**v1.1 amendment (b): the model-backed CEO is deferred out of the MVP** (`45 §3`, `47 §8`). The property it was scheduled to prove is *the CEO cannot omit adverse facts*, and the mechanism is the audit plane's deterministic diff. A **deterministic briefing generator** exercises that fully; the model adds narrative, not proof. `27 §2.0` marks the trigger and preserves the design.

**Evidence.** `20 §4`; `27 §4`, `27 §7`; EM9, EM14, SR2.

**Consequences.** Loses whatever coordination benefit multi-agent debate provides — accepted, because no measurement justifies it here. Context assembly becomes a first-class engineering concern.

**Reconsider if:** a measured task class shows materially better outcomes with persistent context *and* the persistence can be expressed as graded state rather than conversation.

---

## ADR-009 — Model bindings are pinned per function, and degradation never substitutes silently

**Status:** ACCEPTED.

**Context.** R10. `08 §9` records the Anthropic API at 99.61% uptime with a 3h38m outage on 2026-08-24, and that hitting a spend cap returns 429 **with no `retry-after`** and pauses until month end. SR6 requires that a model binding change demotes autonomy to probation.

**Alternatives.** Best-model-everywhere; automatic cross-provider failover; a routing layer optimising cost per call; pinned bindings with explicit degradation.

**Decision.** A `ModelBinding` registry with pinned model ids, a regression eval gate before any change, canary routing, and **degrade-don't-substitute**: on provider failure the task fails and its work item waits, or falls to a deterministic path where one exists. Queue-level token and spend ceilings sit **below** the provider tier cap. No reliance on `temperature`/`top_p` for behavioural guarantees.

**Rationale.** Silent substitution changes the model binding, which under SR6 must demote autonomy — so an automatic failover that preserved autonomy would violate the autonomy model. Because a provider spend cap pauses to month end with no retry hint, ACOS must hit its own ceiling first; that is why the queue ceiling is below the tier cap. The control plane runs with all models offline (R6), so "wait" is a safe state.

**Evidence.** `08 §9`; `09 §11.4`; SR6, R6, R7, R10.

**Consequences.** Provider outages become visible waits rather than invisible quality changes. Requires a maintained eval suite per binding.

**Reconsider if:** two bindings are shown equivalent on the full regression suite at pass^4, in which case they may be declared a single binding rather than a substitution.

---

## ADR-010 — All external content enters as untrusted data with zero authority

**Status:** ACCEPTED.

**Context.** EM8. Nasr et al. (arXiv:2510.09023) broke **12 of 12** published injection defences, with 71–100% attack success rates and 100% under human red-teaming; Agent Security Bench reports peak ASR 84.30%. Anthropic's own best figure of ~1% ASR carries its own caveat.

**Alternatives.** Injection classifiers as gates; instruction-hierarchy prompting; spotlighting/delimiting; capability restriction plus architectural containment.

**Decision.** K15 stamps every ingested item as untrusted at zero authority. Classifiers are **telemetry, never gates**. Containment is architectural: workers hold no credentials, hold one write capability, sit behind an egress allowlist with a per-task fetch budget, and cannot reach the policy engine or the audit store.

**Rationale.** With 12/12 defences broken, any design whose safety depends on detecting injection is unsound. The only defensible posture is that a fully compromised model still cannot do damage — which is what `26 §14` tabulates and `29 §9`/`29 §10` walk through.

**Evidence.** `07 §3`, `07 §11`; `29 §1`, `29 §4`; EM8.

**Consequences.** Some legitimate content is treated with more suspicion than necessary. Injection *detection* remains unsolved and is not claimed. `29 §8`'s competitor-poisoning threat is contained in loss but not detected.

**Reconsider if:** a defence appears with an independently reproduced adaptive-attack ASR below 1% — and even then it becomes defence-in-depth, not a gate.

---

## ADR-011 — MCP is an implementation detail behind an adapter, never a trust boundary

**Status:** ACCEPTED.

**Context.** MCP is the default integration idiom in 2026. It cannot express numeric authority envelopes, and its scope model is coarse relative to `26 §2`'s authority tuple.

**Alternatives.** MCP as the primary integration layer with scopes as authorisation; MCP servers called directly by models; MCP hidden behind adapters; no MCP.

**Decision.** If an MCP server is the most convenient way for an adapter to reach a vendor, the adapter may use it. **No model ever holds an MCP client**, and no MCP scope is ever treated as an authorisation decision. Authorisation happens in K3 before dispatch.

**Rationale.** MCP scopes answer "may this connection call this method", not "may this principal spend this amount on this resource given this evidence". Treating a scope as authority would move enforcement out of provable code and into a vendor's connection model, violating EM2 and R4.

**Evidence.** `29 §5`; `31 §8`; EM2, ADR-006.

**Consequences.** Loses MCP's ergonomics for model-side tool use — which is the intent of ADR-006 anyway.

**Reconsider if:** MCP gains an authorisation model expressing numeric envelopes with a formal semantics. Even then it would sit *behind* K3, not replace it.

---

## ADR-012 — ACOS emits its own event schema as the authoritative record; vendor tracing is a replaceable view

**Status:** ACCEPTED.

**Context.** SR9. Managed LLM-tracing platforms retain traces from 24 hours to 90 days depending on tier (`08 §10`), which is not an audit record. OpenTelemetry GenAI semantic conventions remain unstable.

**Alternatives.** Vendor tracing as the record; OTel GenAI conventions as the record; own schema with vendor tracing alongside.

**Decision.** ACOS's own event schema in the audit store is authoritative. **v1.1: Langfuse is dropped** (R4, SPO-06, `45 §3`) — a secondary view by this ADR's own framing, and an **unenumerated third-party egress channel** receiving prompt/completion pairs that for a support worker are case-scoped PII, while `29 §4` v1.0 claimed kernel egress was *"Database; adapters; audit store."* **No third-party exporter is wired until the observability egress inventory and a code-enforced field scrub allowlist exist**, and self-hosted OpenLLMetry inside the VPC is the intended replacement. Sentry remains for alerting, behind the same allowlist and never receiving support-worker context.

**Rationale.** EM16 requires an audit record the audited system cannot suppress and retention measured in years. A vendor whose retention is 30 days cannot be the record. Building on unstable semantic conventions would make the record's meaning drift.

**Evidence.** `08 §10`; `31 §10`; SR9, EM16, R5.

**Consequences.** Two emission paths to maintain. The vendor view can be dropped without loss.

**Reconsider if:** the vendor view's cost or maintenance exceeds its debugging value, in which case drop it — the authoritative path is unaffected.

---

## ADR-013 — The audit store is a separate database instance, insert-only, and a replicating verifier with its own reads

**Status:** **AMENDED** (v1.1, R3, R10). The independence property is unchanged; the ordering, the halt rule, the hash writer, the anchoring cadence, the read path and the input independence are all changed.

**Context.** EM16 and constitution `19`: the audited system must not be able to suppress or rewrite unfavourable findings. `27 §1` shows a CEO agent acting against its own stated policy, so self-reporting is not credible.

**Alternatives.** Audit as a schema in the same database; audit as a table with triggers; append-only S3 with object lock; a separate Postgres instance.

**Decision (v1.1).** Separate Postgres instance, **on a different provider or at minimum a separate account with a separate payment method and separate operator credentials**. Control plane holds `INSERT` only — no `UPDATE`, no `DELETE` — **under a per-principal quota** (I17c). Seven amendments:

1. **The primary journal moves to the control database.** Gap-free company-scoped `journal_seq`, a local hash chain computed by a control-DB trigger, and a `mirrored_at` column. **The audit store becomes a replicating verifier, not a write-ahead transaction coordinator for the company.** It re-chains independently and proves it holds every sequence value.
2. **Completeness is an invariant.** I17, two-sided and continuous. v1.0 had **none** — the chain proved order and non-alteration of rows *present* and nothing about rows *omitted* (AUDA-03).
3. **Halt applies by recoverability class**, not universally (`30 §5.1`). v1.0 specified two mutually exclusive behaviours across three documents for one condition, and neither was correct: buffering opened an unaudited window and handed the model an approval-flood lever, while halting did not stop control-plane writes and could force an EM15 statutory breach.
4. **The hash writer is specified.** Hashes and sequences are computed by database functions inside each instance, under roles the writing principal cannot execute as (I17d). v1.0 never said who computed them, and **a chain the writer computes is theatre.**
5. **Anchoring cadence and contents are specified.** `{head_hash, chain_seq, row_count}`, **hourly**, to a medium the operator cannot rewrite, with a copy to the owner (I17b). The maximum undetectable rewrite window becomes one hour, **stated**. `row_count` is required because head-only anchoring cannot detect tail truncation.
6. **The audit plane serves its own read endpoint on its own host.** The owner client fetches the briefing from the control plane and the appendix from the audit plane and diffs client-side (AUDA-08).
7. **The audit plane holds its own read-only vendor credentials** — commerce, processor, bank line, ESP, each advertising platform — and runs the inverse sweep (I8), the settlement equality recomputation (I4), the send reconciliation (I20) and platform-cap polling (I33) itself. **It leaves the "own store only" posture and becomes a TCB member with external read reach**, which `41 §3.9` establishes it effectively already was.

Chain verification is continuous invariant **`I41`** — not `I1`, which v1.0 cited here and in `33 §6` while `30 §6.1` defined I1 as authorisation coverage. The **adverse-facts appendix** is computed by the audit plane and auto-appended to every briefing, and **no briefing publishes without a hash-matching appendix** (I45).

**Rationale.** Two database grants enforce EM16's *integrity* property; a code review does not. A schema in the same database shares a superuser and therefore shares a compromise. **v1.1: but integrity is not completeness, and neither is truthfulness.** Completeness requires I17. Truthfulness requires I8's independent reads, because the audit plane's inputs were otherwise entirely the output of the plane it audits — *"arithmetic independence, not evidential independence"* (`43 §7`), and `47 §1` item 4's finding that the audit plane could not independently discover anything.

**Evidence.** EM16; `30 §5`, `30 §6`; `27 §5`; `43 §1`–`43 §3`, `43 §7`; `41 §3.5`, `41 §3.9`; AUDA-01 … AUDA-11.

**Consequences.** A second database to operate and back up, **on a second provider or account**. Cross-database joins are unavailable, so audit queries run against mirrored rows. **A second read credential per vendor.** Where a vendor offers no read-only scope — Google Ads — the audit credential is a separate login with viewer-level account access rather than API scope separation, and that residual is stated rather than engineered away. **And the tension with EM15 is recorded** in `22 §3.1` as a selected trade-off.

**Reconsider if:** never for the independence property. The storage substrate may change (object storage with retention lock is an acceptable variant) provided insert-only, independent re-chaining, the two-sided completeness diff and external anchoring all hold.

---

## ADR-014 — Commerce integration is a Shopify custom app over the Admin API; no UI automation; no commerce framework as foundation

**Status:** PROVISIONAL.

**Context.** EM10 and R9 forbid designing around UI automation. `21 §4.5` establishes Shopify as the substrate with the strongest agent posture. Option D proposed Medusa as the foundation.

**Alternatives.** Medusa as the foundation (Option D); Vendure; headless custom commerce; Shopify custom app; browser automation against any platform.

**Decision.** Shopify custom app using `shopify-app-js` (MIT) against the Admin GraphQL API. Medusa (MIT) is the named self-hosted fallback and is read as the reference implementation of the per-step compensation pattern. **No browser automation anywhere in the architecture.**

**Rationale.** Shopify's terms expressly contemplate agents, custom apps require no app review, offline tokens do not expire, `refundCreate` has been `@idempotent` since API 2026-04, and there is a first-party agent programme. Adopting Medusa as the *foundation* would presuppose physical commerce, failing quality gates 13 and 14 against `21 §5`'s ACTIVE ALTERNATIVES, and would invert the layering so that framework-native write paths bypass the Effect Gateway. UI automation is excluded because it is unattributable, unversioned, and typically a terms violation.

**Evidence.** `21 §4.5`; `10 §6`; `31 §6`; EM10, R9; quality gates 13–14.

**Consequences.** Platform dependency on Shopify, with the identity-loss risk that MAL explicitly does not bound (`26 §10`). Webhook unreliability must be absorbed by reconcilers (`25 §8`) since `08 §7` gives no delivery or ordering guarantee, a 5-second total timeout, and auto-unsubscribe after 8 failures in 4 hours.

**Reconsider if:** the chosen business model is not physical commerce (in which case the commerce adapter may be a different system entirely), or Shopify's agent posture or pricing changes materially, or the first business needs a self-hosted checkout.

---

## ADR-015 — Utterance authority is enforced by construction, not classification

**Status:** **AMENDED** (v1.1, R12). Construction remains the thesis; T-U0 is hardened, T-U1 is narrowed to twelve structural conditions and deferred, and the escalation claim is restated.

**Context.** EM4 separates utterance authority from execution authority. `07 §11.7` records that **response validation has no measured false-negative rate anywhere in the literature**. *Moffatt v. Air Canada* (2024 BCCRT 149) established that a company is bound by its chatbot's statements. The Cursor/Anysphere incident shows a support agent inventing a policy and stating it as fact.

**Alternatives.** A validator classifier gating all outbound text; human review of all outbound text; tiered construction with deterministic checks.

**Decision (v1.1).** Three tiers, with **T-U0 the only autonomous tier at MVP.**

**T-U0** — template assembly with slots filled from RECORD-grade state, **each slot within its own declared `max_age` with `staleness_policy=BLOCK`** (I35). Autonomous. Hardened by five additions:

- **Per-slot staleness.** v1.0's BLOCK examples were supplier cost, inventory, incremental CAC and platform policy version; **order and fulfilment status were not among them**, so a correctly-filling template could state that a parcel shipped four days after it was returned to sender. Grade is not freshness (UTT-01).
- **Canonical rendering as a control artifact.** ISO currency codes always, unambiguous dates, NFKC normalisation, rejection of bidi and format-control characters, per-currency precision, and failure-to-render rather than an empty slot. v1.0 specified no rendering policy at all, and rendering changes meaning (UTT-03).
- **Match the rendered form, and the rendered thread.** Normalise → strip format characters → confusable-fold → match. And the gate evaluates the **thread**, including prior ACOS utterances in the case, because three individually clean messages compose into a delivery commitment (I34, UTT-04/05).
- **The grammar applies to templates at authoring time in CI**, not only to generations at runtime. v1.0's grammar policed T-U1 output and never policed the corpus, so **the entire T-U0 commitment surface was an unversioned template file outside B9 and outside every invariant** (UTT-02).
- **A deterministic tier floor the model may only raise.** v1.0's tier came from the triage model's classification, and determinism of a function over model output is not determinism (UTT-08).

**T-U1** — grounded generation. **Narrowed to the twelve structural conditions in `26 §9.6` and deferred out of the MVP.** `44 §2.1` constructed six prohibited commitments that pass a closed lexical grammar — *"I'll make sure this gets sorted for you today"*, *"if it hasn't arrived by Friday, we'd of course make it right"* — because commitment is carried by implicature, conditionals, negation, litotes and commissive verbs whose surface forms are unbounded. **`07 §11.7`'s missing false-negative rate is not a gap construction avoids; it reappears inside construction the moment free generation is permitted.** Conditions 6–8 — no future tense with ACOS as subject, no conditionals, no first-person commissive verbs — are the ones that actually bound the Moffatt exposure and were absent from v1.0. Under all twelve, T-U1 collapses toward T-U0 with variable phrasing, which is the honest conclusion: **the value T-U1 adds is fluency, and fluency is what carries implicature.**

**T-U2** — free generation, human approval. **Everything not T-U0 at MVP.** Including, unconditionally, **any inbound message with a non-text part** (UTT-09).

Grounding coverage is computed **before** generation to force abstention. Ten escalation detectors run **before** any generation, **on the normalised rendered text**, and Z4 supplies a typed `red_class_signal` to Ingress for non-text parts (`23 §7`).

**Rationale.** A classifier gate would violate the project's own rule that classifiers are telemetry, never gates — and here that rule is not stylistic, because no false-negative rate exists to reason about. Construction sidesteps the unknown for T-U0. **v1.1: it does not sidestep it for T-U1, and v1.0's claim that T-U0 "cannot say anything not already a record" was true about provenance and false about meaning** — `44 §1` gives four ways individually accurate records combine into a misleading statement.

**The escalation claim is restated (UTT-10).** v1.0 and `36 §8.4` presented 0% false negatives as achievable *because the detectors are deterministic*. The 0% figure is a property of an **author-written corpus** whose author also wrote the detectors — circular in exactly the way `36 §9.4` refuses to be circular about competitor poisoning. Operative claim: 0% against the enumerated patterns **on an independently authored held-out corpus**; **unmeasured** on natural adversarial phrasing; **100% false-negative on non-text-borne triggers**, bounded to T-U2 by construction until the `red_class_signal` path is built and tested; and **production recall is the reported operating gate**.

**Evidence.** `07 §4`, `07 §11.7`; `26 §9`; `44 §1`–`44 §4`; EM4, EM15.

**Consequences.** Materially less fluent customer communication than v1.0 intended, because T-U1 is unbuilt. Template and rendering-policy maintenance cost, plus a certified language set. Abstention produces escalations, adding to the human residual — **and narrowing T-U1 increases T-U2 volume, so this ADR and the owner-attention budget pull against each other and the resolution is the budget, not a choice between them** (`44 §6.6`).

**Reconsider if:** a validator with an independently measured false-negative rate on adversarial inputs becomes available — then T-U1's scope may widen, with T-U2 still requiring approval. **Unchanged from v1.0, and it is still the right condition.**

---

## ADR-016 — Evidential grade is derived from writer identity, never asserted

**Status:** **AMENDED** (v1.1, R6, R7). The derivation is unchanged and survived every content-level attack; the lattice gains a split and vendor-derived facts gain a parser.

**Context.** The constitution's evidence discipline requires that assumptions not become facts by repetition. SR3 requires a deterministic promoter with a named rule.

**Alternatives.** Grade as a field the writer sets; grade inferred by a model; grade as a generated column derived from writer identity and promoter rule.

**Decision.** `grade` is a generated column computed by a database function from `writer_principal_type` and `promoter_rule_id`. A model-authored row cannot be RECORD grade because no code path produces one. Only RECORD and OBSERVATION may be policy preconditions. Promotion example: "supplier says shipped" is CLAIM until a carrier scan RECORD promotes it under a named rule.

**Rationale.** If grade were an input, the cheapest attack on the whole evidence system would be to assert a high grade. Deriving it means the promotion rules are the entire attack surface, and they are enumerable and testable. Generalising beyond AI matters: a supplier's belief and a platform's belief are also not records.

**Evidence.** `24 §5`, `24 §6`; SR3; `26 §7` step where the engine fetches its own preconditions.

**v1.1 amendment (a): the DECISION grade splits (R7, MOA-10).** v1.0 had one `DECISION` grade, writable *"on owner approval or within delegated authority"*, and gating everything. That is one hole in one row of one table, and it is the only place grade-from-writer leaked. The path: a CEO-authored recommendation is accepted within delegated authority, becomes a `DECISION`, and thereby reaches gating grade **without a promoter and without a corroborating RECORD**.

- **`DECISION_OWNER`** — written on owner approval. May gate policy.
- **`DECISION_DELEGATED`** — written by K9 within delegated authority, i.e. model-originated. May gate **only** the narrow action class the delegating grant names, and **never a monetary or irrecoverable class** (I28).

**v1.1 amendment (b): grade for vendor-derived facts derives from the parser, not the adapter (R6, REC-02).** v1.0's `content_hash` was *"hash of the raw upstream payload, retained"* — computed by the adapter. **A compromised adapter hashed its own fabrication**, and because grade derives from writer identity, an adapter wrote RECORD at will. Adapters become **transports**: the raw vendor response is retained verbatim by the control plane and a **versioned deterministic parser** derives the fact, so grade derives from `(parser_version, transport_identity)` and every RECORD-grade fact must resolve to a retained response with a matching hash (I26). **A compromised adapter must now produce a well-formed *vendor response*, not a well-formed ACOS fact.** Promoter rules become control artifacts under B9.

**And the stated bound on adapter compromise was too narrow.** `36 §10` v1.0 said *"a compromised adapter can move money within its credential scope."* The correct bound is **its credential scope plus the union of every authority whose preconditions its RECORD-grade writes can satisfy** (`24 §10` case 6) — a compromised commerce adapter unlocked the advertising authority without touching the advertising credential. I27 closes the specific path by requiring processor-settlement corroboration for `SpendAuthorityCondition`; the general residual stands and adapters are named TCB members for it.

**Consequences.** Every fact type needs a source classification, a parser and, where relevant, a promoter. Adds schema work at ingestion **and a retained-response store**. The parser split is the single highest-value provenance change and it is also what makes the deferred broker-as-execution-proxy worth building later (`42 §6.2`).

**Reconsider if:** a fact type is found for which no deterministic promoter is expressible — in which case it stays CLAIM permanently and cannot gate anything, which is the correct outcome rather than a reason to relax the rule.

---

## ADR-017 — Recoverability is a second budget currency, not a risk score — and duration is a third dimension

**Status:** **AMENDED** (v1.1, R2, R8). The insight is correct and the corrections extend it rather than replace it.

**Context.** EM3. `20 §5 I4`: a gate can refuse a send; it cannot unsend. `07 §4.1` names free reshipment and address edit as the two highest-risk support actions precisely because neither trips a monetary cap.

**Alternatives.** A single monetary budget; a composite risk score; recoverability as a policy attribute only; two independent budget currencies.

**Decision (v1.1).** Every action class is classified REVERSIBLE, COMPENSABLE or IRRECOVERABLE. The exposure ledger carries money and an irrecoverable-action count. **Three amendments.**

**(a) The irrecoverable currency splits.** v1.0's two-currency model carried an unexamined assumption — that irrecoverable actions are **rare**. They are rare only for the agent-*discretionary* class. `33 §9` puts POD's dominant class at IRRECOVERABLE for every fulfilled order, and for high-value digital, delivering the fenced asset is an irrecoverable disclosure; in both, a correctly calibrated single MIE would have to exceed order volume, at which point it gates nothing. And at v1.0's proposed MIE of 5/month with `email.send` at one unit, **the sixth customer message of the month required an owner approval** and the approval queue became the operating mode (`44 §6.3`).

- **`MIE_discretionary`** — reship, goodwill send, address edit, public post, campaign send, entitlement revocation. A small owner-signed integer. Gating.
- **Order-driven irrecoverable fulfilment** — the shipment or entitlement a paid order requires, and transactional order-state sends. Governed by a per-order rate limit, a template whitelist and an anomaly threshold on the **fulfilment-to-settled-order ratio**. **Consumes nothing from `MIE_discretionary`** (I30).

**This is a kernel change**, which is why `33 §9`'s "no kernel capability changes in any column" is withdrawn.

**(b) Irrecoverable actions have monetary cost, and the disclosed ceiling now includes it.** A reship costs COGS plus freight; a campaign send costs ESP volume and, on a bad day, the domain's bulk-sender classification. v1.0 built a second currency for exactly these actions and then omitted their cost from the number shown to the owner — $150–200 of unbounded authorised loss against a stated $600 (`43 §4.1`). Count remains the **gating** control; `MIE_cost`, `[ESTIMATE]`-graded and labelled, enters `MAL_total` (`26 §10`).

**(c) Duration is a third independent dimension.** Recoverability and magnitude do not capture a **rate**. One authorised advertising-budget change produces external spend every day until something stops it, and subscriptions, dunning schedules, saved mandates and metered plans share the shape. `StandingAuthorization` (ADR-022) governs it, with forward exposure reserved to each window's end, re-reservation at every boundary, and **mandatory expiry** — because `28 §7.4`'s trajectory policy governs *slope* and v1.0 governed *duration* nowhere.

**Rationale.** Collapsing recoverability into money hides exactly the actions that do damage without spending. A composite score is unauditable and cannot be proved by symcc. Separate currencies keep the bounds independently provable — **and separating *gating* from *disclosure* is what lets count remain the control while cost still reaches the owner.**

**Evidence.** `20 §5`; `07 §4.1`; `26 §5`, `26 §10`; EM3.

**Consequences.** Two budgets to calibrate, and `07 §9` is explicit that the literature calibrates neither — the magnitudes are owner inputs. Some actions are hard to classify and default to IRRECOVERABLE, which is deliberately conservative.

**Reconsider if:** operating data shows the irrecoverable counter binding so often that legitimate operations stall, which would indicate misclassification rather than a wrong model.

---

## ADR-018 — Autonomy is earned per `(task_type, action_class, model_binding, resource_class)` and a binding change demotes

**Status:** ACCEPTED.

**Context.** SR6. τ³-Banking shows Opus 5 at 48.71 pass^1 falling to 31.96 pass^4; `SPINE` finding 3 notes the 2026 pass^4/pass^1 ratio (0.6–0.7) is no better than Claude 3.5 Sonnet's 0.67 in 2024. `20` finds **0 of 56 capabilities** reach unsupervised authority under either classification.

**Alternatives.** Global autonomy levels; per-capability levels; per-tuple levels with automatic demotion on binding change.

**Decision.** Per-tuple. Promotion requires zero policy violations, zero RED-class escalation misses, and measured **pass^4 ≥ 90%** on the task's eval suite. A model binding change **automatically demotes to probation**.

**Rationale.** Capability rose between 2024 and 2026 while consistency did not, so autonomy earned by one binding is not evidence about another. Per-capability granularity is too coarse because the same capability at a different exposure level is a different risk. pass^4 rather than pass^1 because a business runs the task repeatedly.

**Evidence.** `SPINE` finding 3; `11 E7`; `20 §3`; SR6.

**Consequences.** A model upgrade is an operational event with a re-earning cost, which is the intended incentive. Requires a maintained per-tuple eval suite and an autonomy ledger (K14).

**Reconsider if:** a measurement shows binding changes within a family preserve pass^4 across the suite — then the demotion could narrow to cross-family changes.

---

## ADR-019 — AIOS is excluded outright on licence grounds

**Status:** ACCEPTED.

**Context.** R12 requires a permissive licence with no foreclosure on internal commercial operation. `agiresearch/AIOS` is a prominent agent-OS project.

**Alternatives.** Adopt; fork; vendor with counsel review; exclude.

**Decision.** Exclude. Its `LICENSE` file is **one byte**, so **no licence is granted**. This is a hard blocker, not a risk to weigh.

**Rationale.** Absent a licence grant, default copyright applies and use is infringement. No architectural benefit justifies that.

**Evidence.** `10 §4` licence landmine register; `31 §12`; R12.

**Consequences.** None material; the capability is not needed.

**Reconsider if:** the project publishes an actual permissive licence — and even then it competes on merit against ADR-008's task abstraction, which does not need it.

---

## ADR-020 — No vendor is selected for opportunity discovery

**Status:** ACCEPTED.

**Context.** `29` of the constitution makes the first objective determining what business provides the strongest proving ground. Numerous vendors sell "winning product finder" tooling.

**Alternatives.** Buy a product-research SaaS; build a discovery pipeline; supply evidence plumbing only and leave the algorithm unresolved.

**Decision.** Supply the evidence plumbing (K8, source tiering, corroboration gate, `24 §13`). Select no discovery vendor. Do not claim a discovery algorithm.

**Rationale.** `10 §5.3` finds nothing mature and trustworthy behind niche discovery, and vendor claims are marketing-grade. Buying one would import exactly the vendor-marketing-laundering risk `11 E8` exists to measure, and would let an unvalidated ranking enter the evidence store at a grade it has not earned.

**Evidence.** `10 §5.3`; `11 E8`; `31 §13` deliberate non-selection.

**Consequences.** The largest open problem in the project stays open, and `38` states it as such. The architecture cannot be blamed for a bad first business choice, but neither does it help make a good one.

**Reconsider if:** a discovery source is found whose outputs can be independently corroborated against RECORD-grade data — at which point it enters as a CLAIM-grade source like any other, not as an oracle.

---

# New in v1.1

Six records added in response to `47`. Each closes a defect the red team classified as blocking, and each carries a reconsideration trigger like every other record here.

---

## ADR-021 — A deterministic Effect Canonicaliser constructs every authorisation request and dispatch payload

**Status:** ACCEPTED. **New in v1.1 (R1).**

**Context.** `26 §2` v1.0 carried `exposure` and `parameters` as fields of a model-authored proposal. `26 §7` step M evaluated `per_action_max` against them and step R reserved against them. `26 §8`'s worked policies read `context.parameters.amount` and `context.parameters.delta_pct`. B3 — *"no model output is an input to the policy engine"* — was therefore false as written, and `36 §2`'s test that preconditions are *"structurally unavailable"* to the engine was a tautology over the fields that do not bound money and impossible for the ones that do.

`38 §7.2` named request-construction error as the most likely money-path bug in the system — *"if `exposure` is populated with unit price instead of line total, every policy is satisfied and the bound is wrong by the quantity"* — and the package then declined to add the component that would prevent it. `47 §1` ranks this first of ten findings, **because every other monetary control in the architecture sits downstream of a number the model supplied.**

**Alternatives.**

1. **Schema validation plus a request-construction test** (v1.0's implicit answer, `36 §3` layer 2). Rejected: a test asserting that omitting a tuple field fails closed cannot detect a field populated with the *wrong* value, which is the failure that matters.
2. **A typed proposal with stricter types.** Rejected: a type constrains the shape of the number, not its correctness. The model still chooses it.
3. **Post-hoc settlement reconciliation only.** Rejected as the sole control: it is the terminal check and it arrives weeks late. Retained as the T3 acceptance gate.
4. **Enumerate-then-select with kernel-side computation.** Adopted.

**Decision.** A deterministic component inside K4, positioned **between schema validation and policy evaluation**. Per action class it holds a **versioned constructor** that:

1. fetches authoritative state itself, under the entity advisory lock (`25 §14`);
2. **enumerates** the permissible effects for `(action_class, resource)`;
3. accepts the model's `selector` as an **index** into that enumeration and rejects anything else;
4. **computes** exposure from the selected option, including per-class cost components — retained processing fee, freight and COGS, registered compensator cost — and, for rate actions, the forward integral as the **separate** `forward_integral` field, carried by `I3` term 2 rather than by `total_exposure` or the ordinary reservation (`26 §2.1.3`, TB-03);
5. converts to the single ledger currency at a RECORD-grade FX rate with `staleness_policy=BLOCK`, journaling both amounts;
6. **computes** vendor parameters, counterparty identity and novelty, `customer_novelty` and recoverability;
7. emits the `AuthorizationRequest` **and** the exact `dispatch_payload` together, **hashed together**.

**The adapter receives the dispatch payload verbatim and constructs nothing.** The model-facing capability is renamed `propose_intent` (ADR-006).

**Where an action class cannot be deterministically canonicalised, it is not eligible for autonomous execution** — the same disqualifier logic `25 §7` applies to idempotency.

**Rationale.** The kernel enumerates, the model selects, the kernel computes. This is materially stronger than a typed proposal, because a typed proposal still lets the model choose the number. `42 §8.2` enumerates twelve semantic errors it closes, of which the unit-price case is only the most obvious. And it converts `36 §2`'s vacuous precondition test into I21, which is enforceable at type level **precisely because the fields that bound money are now on the other side of the boundary.**

**Evidence.** `42 §8`; `47 §1` item 1; MOA-01, MOA-02, MOA-03, MOA-05, MOA-06, MOA-07, MAL-06, VAL-01.

**Invariants.** **v1.2: `I18` is retired** — it asserted a three-way equality between two quantities that are unequal whenever a cost component exists, which is every refund carrying a retained fee (`26 §2.1.1`, CAN-08). Replaced by **I18a** (`exposure.vendor_amount` equals the payload's vendor-visible amount where one exists), **I18b** (`exposure.total_exposure == reservation.amount`, exact), **I18c** (`vendor_amount ≤ total_exposure`), **I18d** (`settled_total` within the class tolerance of `total_exposure` at settlement); divergence outside tolerance is a critical incident. **I21** — no `AuthorizationRequest` field is populated from `ProposedIntent` beyond `action_class`, `resource_ref`, `selector`, `reason_code`.

**Consequences.** A versioned constructor per action class is real work, and it is the largest single addition in v1.1. Adding a capability becomes a code change in one more place. Model-side ergonomics worsen: the model reasons about an enumerated set rather than proposing a value. **And the enumeration is itself a small information channel** — it tells the model what is currently permitted — which is why enumerations are scoped to the resource the task's `context_spec` already admits and why denial reasons remain coarse (`26 §7`).

**Testing.** Per-class construction tests whose expected values are computed **independently of the production constructor** — a second implementation or a hand-computed fixture table. `46 R1` is explicit: a test that calls the same function twice proves nothing. Plus the settled-cost oracle at the bank line (T3).

**Reconsider if:** an action class of real operational value proves impossible to canonicalise. The correct response is then to leave that class non-autonomous, not to relax the constructor — but if that happens repeatedly across classes the owner actually needs, the finding is about the business model's automatability rather than about this component.

---

**v1.2 amendment to ADR-021 (SR-C2, SR-C3, SR-C4).** Three additions, each closing an attack the canonicaliser as specified did not:

- **`enumerate_effects` is a named READ capability.** v1.0/v1.1 accepted a `selector` into an enumeration the model had no documented way to obtain, which left either a broken capability or an undocumented read in the money path. `24 §3` K4 now specifies it: journaled, `context_spec`-filtered, rate-limited.
- **Selectors are content-addressed `(enumeration_id, option_id)` pairs, not indices.** An ordinal is stable only against a static option set. `53 §1`'s reordering fixture dispatched a refund of a *different line* with `I18`, `I21`, `I2`, `I3`, `I29` and `I31` all holding. The kernel now denies `SELECTOR_STALE` and **never substitutes** (I53).
- **Constructors are versioned control artifacts** (`50 §2` class 19) carrying a `ConstructorVersionRecord`. Without it `§11`'s reproducibility claim was false across every deploy, settlement disputes could not identify the computing constructor, and every pending approval was silently voided by a payload-hash comparison.

## ADR-022 — Rate-based authorisations are represented as `StandingAuthorization` with reserved forward exposure and mandatory expiry

**Status:** ACCEPTED. **New in v1.1 (R2).**

**Context.** An advertising budget is a **rate**. One authorised `campaign.budget.adjust` produces external spend every day until something stops it, and subscriptions, dunning schedules, saved payment mandates, metered plans and recurring supplier commitments share the shape. v1.0 had no representation for any of it, with three consequences:

- `26 §8`'s worked policy checked `committed + exposure.monetary_amount ≤ 100`. With `exposure` as the **delta**, the check passed while the platform spent the resulting daily total. **A unit error in the package's own worked example** (MOA-04).
- `MAL`, computed from per-action caps × counts, **could not see the forward integral.** `37 §5`'s $10-per-increase cap and $40/day ceiling were different quantities and MAL used the wrong one (MAL-07).
- `25 §8.3`'s inverse sweep would have flagged **every renewal** as an unjournaled external mutation, producing either an incident flood or an exclusion rule that is a permanent hole in the sweep.

**Alternatives.**

1. **Reserve the delta and monitor spend.** Rejected — this is v1.0, and it is a unit error.
2. **Reserve the full window's spend at each authorisation without a durable object.** Rejected: it double-reserves across boundaries, has no revocation path, and cannot match renewals.
3. **Treat rate changes as requiring approval every time.** Rejected: it makes the only real spend class permanently non-autonomous, and it does not solve the representation problem — the *existing* rate still spends.
4. **A durable standing-authorisation entity with reserved forward exposure.** Adopted.

**Decision.** The entity in `24 §3` K5, owned by the exposure ledger rather than constituting a sixteenth kernel capability. Forward exposure to each referenced window's end is reserved at authorisation and **re-reserved at every window boundary**; a boundary that cannot be reserved **pauses** the authorisation through its registered `revocation_effect_class`; `expires_at` is **mandatory** and mirrors grant expiry; renewals and provider-initiated charges are matched by `reconciler_match_rule` in the financial and effect reconcilers. `Standing(w)` becomes a named component of `MAL_total(w)`.

**Rationale.** **A rate is not an amount, and the architecture must govern both.** Mandatory expiry is the single most valuable property in the entity: `28 §7.4`'s trajectory policy governs *slope*, and v1.0 governed *duration* nowhere — so an advertising budget authorised once continued indefinitely, which is exactly the shape of the runaway `35 §7` is about. Making renewals matchable also removes the inverse sweep's false-positive problem without an exclusion rule, which matters because an exclusion rule in the sweep is a permanent blind spot.

**Evidence.** `43 §4.2`; MAL-07, MOA-04, BMN-06.

**Invariants.** **I22** — every recurring external charge matches a live `StandingAuthorization` or raises an incident. **I23** — none live past `expires_at`. **I3 extended** — open reservations include standing forward exposure.

**Consequences.** Advertising budgets, like grants, must be **periodically re-consented**, which is a recurring owner action and will feel obstructive. A paused standing authorisation stops spend that may have been performing well. And the forward-exposure reservation is conservative: it reserves the full remainder of the window even though the platform may spend less.

**Testing.** Window-boundary re-reservation under insufficient headroom must **pause rather than continue**. Renewal matching against a fixture set including a renewal arriving after expiry. Inverse-sweep fixture with three renewals and one genuinely unauthorised charge, where **only the fourth is an incident**.

**Reconsider if:** the re-reservation cadence proves to pause healthy campaigns often enough to distort the acquisition measurement in `28 §8` — in which case the window granularity is wrong, not the entity.

---

**v1.2 amendment to ADR-022 (SR-S1–S4, SR-L1–L4).** The entity survives; four of its stated mechanics do not.

- **Forward exposure is the exposure remainder, not `rate × remaining_periods`.** The v1.1 form paused a healthy campaign on day 2 of a 30-day consent after one day of *documented* platform overdelivery, and understated `MAL_total(month)` in seven months of twelve by using a rate period against a calendar window. `26 §10.1`.
- **Five states, and forward exposure is released only on `REVOKED`**, which requires a cessation-verification read (I54). With the per-adapter **cessation specification** `UNDECLARED` on every declared adapter — the scalar `cessation_lag` is retired as the `I54` operand and TB-07 schedules its replacement — **no `REVOKED` transition is available at MVP** — pausing does not return headroom, and `26 §10.5` states that commercial cost rather than leaving it to be discovered.
- **A `StandingRevocationAuthority` accompanies every grant** (I55), because the pause is a governed effect whose authorising grant expires at the same instant the authorisation does — STD-03's deadlock in the money path.
- **Windows declare `boundary_kind` and typed ceilings.** `max_monetary : Money | UNBOUNDED`, not nullable; `window_balance` rows with a `CHECK` under `FOR UPDATE` replace v1.1's "exclusion constraint", which does not express a sum-over-rows against a scalar (LIM-05).

## ADR-023 — The external-write perimeter is a maintained artifact with a CI check

**Status:** ACCEPTED. **New in v1.1 (R4).**

**Context.** v1.0 asserted a chokepoint and never enumerated the perimeter. `42 §1`'s enumeration found **fourteen components capable of originating an external HTTP request, six of which could write with no authorisation row and no journal entry**: the webhook subscription watchdog, reconciler resolution, credential refresh, framework-managed OAuth and webhook registration, the finance cost credential, and the observability exporters. None is model-reachable — which is why `47` classified this as a wording defect rather than a fatal one — but EM9's exact-countability claim depended on the strong version.

**Alternatives.**

1. **Network policy.** Rejected, and `42 §1.3` explains why: every unauthorised path runs from a process that legitimately requires egress to the same vendor host, over the same port, with the same credential, to the same endpoint. **Network policy separates planes; it cannot separate purposes within a plane.**
2. **Another review round.** Rejected. `46`'s closing section is explicit: the enumeration **will** be incomplete — this review found six paths the author did not name, and the next reviewer will find more — so *"a perimeter is a standing obligation, not a gate that is passed once."*
3. **A maintained artifact plus a CI check.** Adopted.

**Decision.** `48-external-write-perimeter.md` is a maintained artifact, reviewed quarterly alongside the policy-set diff `30 §6.4` already requires. Enforcement:

- **One vendor-HTTP client per adapter.** No ad-hoc HTTP.
- **Every call site carries an `authorisation_ref` or an annotated `PERIMETER_EXEMPT(reason, ticket)`.**
- **CI fails the build on an unannotated vendor-call site**, and a runtime assertion refuses an adapter invocation carrying neither (I24).
- **Two of the six paths become governed effect classes**: `webhook.subscription.assert` / `.delete` with `callbackUrl` from configuration and never from a parameter, and reconciler resolution reusing the original authorisation and idempotency key.

**Rationale.** *"The only permitted path"* is a policy. *"The only capable path"* is an architecture. **The CI check is what converts one into the other**, and it is the only mechanism that survives the enumeration being incomplete — an unannotated call site fails the build whether or not anyone has thought about it.

**Evidence.** `42 §1`, `42 §9`; SPO-01 … SPO-12; MON-01, MON-02, REC-06, TEC-04.

**Invariants.** **I24** — annotated call sites, CI-enforced. **I25** — no control-plane process holds a vendor credential.

**Consequences.** A build gate that will annoy whoever adds the next vendor call, which is the point. A standing quarterly review. And an honest artifact that says four external-write paths exist outside the gateway, which reads worse than v1.0's claim and is true.

**Reconsider if:** never for the artifact or the check. The *contents* change with every adapter.

---

## ADR-024 — Vendor credentials are held per adapter; the broker is deferred and returns as an execution proxy

**Status:** ACCEPTED for option A. **New in v1.1 (R5).**

**Context.** `29 §3` v1.0 described the broker as issuing *"short-TTL, audience-bound, action-scoped tokens, to adapters only, per invocation."* Tested against the platform this architecture selects: **Shopify custom-app offline access tokens do not expire, and their scopes are set at the app, not per request.** There is no TTL to shorten, no audience to bind and no action to scope. So the broker could not have been issuing the vendor credential with the described properties, because no such credential exists to issue (CRD-01).

And an internal action-scoped token constrains the vendor credential **only if the component presenting the vendor credential enforces the constraint.** The presenter is the adapter. The adapter would be enforcing a restriction on itself — an audit tag, not a security boundary (CRD-02).

**Alternatives.** `42 §4` gives three and eliminates one.

1. **Option A — adapters hold their own secrets and are declared TCB members.** Honest, matches what the code will do anyway, and removes an MVP component that does not do what it claims.
2. **Option B — the broker as an execution proxy**: the only holder of vendor credentials and the only process that opens a vendor connection, receiving typed pre-authorised request descriptors, validating against the authorisation reference, signing its own audit record, performing the call and returning raw bytes.
3. **Option C — no component holds a credential exceeding a single action.** **Does not exist.** It requires the vendor to issue per-action credentials, and no platform in this stack does: Shopify scopes are app-level; Google Ads requires the full `adwords` scope for any GAQL query including a pure read; Meta's `ads_management` covers create/update/pause/delete; ESP server tokens send anything to anyone. **Stripe restricted keys are the one genuine exception.**

**Decision.** **Option A for the MVP; the broker component is removed** (`45 §3`). Per-adapter vendor secrets in the platform secret manager, injected at process start, never shared, with per-adapter runtime, filesystem and dependency-tree isolation, bank-line ingest in its own runtime, and a per-credential revocation switch that **revokes** rather than stopping the loop.

**Adapters are declared members of the Trusted Computing Base** (`49`), and this document does not claim internal capability tokens reduce external vendor credential scope.

**Option B is specified now and built at the first money-moving credential or the third adapter, whichever comes first.** Its two benefits are real and unavailable under A: action scoping becomes enforceable **at the point the credential is presented**, and raw vendor responses can be retained outside the adapter, which is what makes provenance stop being self-attested (ADR-016).

**Rationale.** With two adapters and no money, a broker adds a TCB member and delivers nothing. It also becomes the highest-value target in the company — a chokepoint behind a chokepoint — and **vendor credentials survive an ACOS rebuild while the control plane does not**, so the broker's compromise is worse than the control plane's (`41 §3.7`). Deferring it is the smaller residual now and the better design later.

**Evidence.** `42 §2`, `42 §4`, `42 §5`; `41 §3.7`, `41 §3.8`; CRD-01, CRD-02, CRD-05, CRD-07.

**Invariants.** **I25** — no control-plane process holds a vendor credential. **I15 replaced** — for each prohibited class with a reachable vendor endpoint, a scheduled probe attempts the operation against a sacrificial resource and asserts vendor-side failure; **a succeeding probe is a critical incident.** As written, I15 compared ACOS's own scope labels to its own prohibition list and passed vacuously.

**Consequences.** Two of twelve categorical prohibitions have **no credential-level enforcement at all** (`29 §3.3`) — `platform.spend_cap.raise` and the `email.send` / `email.campaign.send` distinction — and those classes are marked **non-autonomous**. `35 §7` layer 3's claim that the platform cap holds *"even if the entire control plane misbehaves"* is withdrawn. Each adapter's blast radius is its full vendor scope plus every authority its RECORD writes can satisfy.

**Reconsider if:** a vendor ships per-action credentials, or ACOS reaches the money-moving/third-adapter trigger — at which point build option B properly rather than reviving the v1.0 description.

---

## ADR-025 — Control artifacts are owner-signed and hash-verified against a manifest

**Status:** ACCEPTED. **New in v1.1 (R11).**

**Context.** B9 v1.0 prohibited self-modification of six artifact classes: grants, policies, the action catalogue, model bindings, credential scopes and audit records. It **omitted** the utterance template corpus, the approved policy corpus, the prohibited-commitment grammar, the ten escalation detectors and their patterns, promoter rules, `context_spec`s, metric computation specs, tolerance rules, the locale rendering policy and the adverse-facts threshold set — **and every one of those defeats a stated invariant if modified** (REC-05, UTT-02).

The sharpest case: the prohibited-commitment grammar was applied to T-U1 *generations at runtime* and never to *templates at authoring time*, so the entire T-U0 commitment surface was an unversioned, uninvarianted template file that anyone with the deploy path could edit. A tolerance rule's modification silently disables the terminal financial control. An adverse-facts threshold's modification changes what counts as bad news.

**Alternatives.** Code review (rejected — v1.0's implicit answer, and `21 §2` item 16 records two auditability failures inside this project's own review process); version control alone (rejected — proves history, not deployed state); an owner-signed content-hash manifest (adopted).

**Decision.** `50-control-artifact-manifest.md` defines sixteen control-artifact classes, each with a content hash, a version and an owner signature. **Every control artifact's deployed content hash must match the signed manifest (I19), and a mismatch halts effects in the affected class.** The audit plane recomputes the hashes independently. The prohibited-commitment grammar runs against **templates at authoring time in CI**, not only against generations at runtime. `30 §6.4`'s quarterly diff extends to the full set.

**Rationale.** The distinguishing question is not whether an artifact is code or data; it is **whether modifying it changes what ACOS may say, believe, calculate or authorise.** Sixteen artifacts pass that test and v1.0 protected six. Halting the affected class rather than the whole system keeps the response proportionate: a template mismatch stops that utterance class, not order fulfilment.

**Evidence.** `44 §1.1` attack 3; REC-05, UTT-02.

**Invariants.** **I19** — manifest hash match, halting the affected class. **I38** — the adverse-facts threshold set specifically, because the CEO must not shape the predicate that decides whether a fact is adverse.

**Consequences.** Editing a template becomes an owner-signed act, which slows customer-communication iteration — the cost EM4 already accepted for templates and v1.0 then failed to enforce. A signing ceremony the owner must actually perform, which is one more demand on the scarcest resource in the company.

**Reconsider if:** the signing burden proves to exceed the owner's attention budget, in which case the response is to reduce the number of artifacts requiring signature by making some of them derived — not to relax the invariant.

---

**v1.2 amendment to ADR-025 (SR-C4, SR-A3, SR-S4, SR-S3).** Five classes added — **19** effect constructors, **20** the `ACOS-JCS-1` journal canonicalisation specification, **21** adapter parameter sets with provenance grades, **22** `cessation_grace`, **23** anchor-medium selection. Nineteen and twenty are the consequential ones: a constructor computes every dispatched amount and was governed by code review alone, and `ACOS-JCS-1` defines what the integrity machinery hashes, so changing it is indistinguishable from breaking the chain. The manifest's own count is corrected: **twenty-three rows, twenty-one signed classes, one prohibition.**

**v1.3 amendment to ADR-013 (TA-01 … TA-07). Five corrections, none of which abandons the attestation, the inversion or the relocation of the completeness claim.**

1. **The claim is corrected, not the mechanism** (TA-01). `I17`/`I17e` establish *continuity of the attestation channel and internal consistency and completeness of the latest attested prefix*. They do **not** establish that the attested maximum equals the true control-journal maximum, and v1.2's `30 §5.5` case 2 claimed a 15-minute bound that holds against transport loss and not against the attester. Case 2 is split into 2a and 2b; registry `§3` item 9 records the class of suppressed rows with **no detector at all**; and VC-A1d is a mandatory negative control asserting `I17e` does **not** fire against an adjusted attestation.
2. **`I8` acquires a bound and a scope** (TA-02, TA-03). Per-adapter sweep cadence, `CONFIGURED`, audit-plane scheduled; detection bound written as `sweep_cadence + vendor_reporting_lag` with the second operand `UNMEASURED`; and the tag set restated as an **additive verification list that never scopes the sweep**.
3. **A dispatch→tag detector exists** (TA-04). `I17f(c)`, audit-plane owned, on a declared 15-minute evaluation interval.
4. **The corroboration signal is a contract** (TA-06). `MirrorInputStallSignal`, Ed25519-signed under an audit-plane-only key, pulled from a declared audit read endpoint, `max_age` 5 minutes, replay-protected — and `30 §5.6` now states plainly that partition and audit-plane outage do **not** reach `CORROBORATED_DEGRADED`.
5. **The override is kernel state** (TA-05). `DegradedModeOverride` with declared scope, time box, count cap, monetary cap, expiry-to-restrictive-state, second-approver rule, and the aggregate composition bound `I63`.

**What did not change and was not renegotiated:** the attestation, `k = 3` at a 5-minute cadence, the inversion, the three-state machine, the relocation of the unqualified completeness claim to `I8`, or R10's removal of the control-database replica.

**v1.2 amendment to ADR-013 (SR-A1, SR-A2, SR-A4, SR-A5).** The replicating verifier survives; its completeness claim is re-scoped. `I17` is *transport* completeness — what a push target can actually check — and the unqualified claim moves to `I8`, which is evaluated from the audit plane's own vendor reads. `JournalAttestation` at 5 minutes with k=3 makes silence distinguishable from idleness within 15 minutes, against an hourly anchor designed to bound rewrite rather than silence. **Degraded mode is no longer self-declared and no longer relaxes anything**: the uncorroborated state is *stricter* (`30 §5.6`), so a compromised control plane declaring degradation harms itself. `journal_seq` comes from a counter row rather than a `SEQUENCE`, under a declared lock order, and re-push is idempotent under `UNIQUE(company_id, journal_seq)`.

## ADR-026 — Irrecoverable dispatch goes through an ACOS-owned outbox, and unknown outcomes are keyed on recoverability

**Status:** ACCEPTED. **New in v1.1 (R13).**

**Context.** Two of this package's own rules collided and nobody noticed. `25 §7`: *"Where the adapter's API offers no idempotency, the effect class is downgraded: it cannot be autonomous, and if it is also irrecoverable it is excluded entirely."* `26 §5` classifies `email.send` as **IRRECOVERABLE**, and most ESPs offer neither an idempotency header nor a synchronous query primitive. **So the rule as written excludes autonomous email sending** — while `33 §9` planned a "T-U0 heavy" operating profile, `37 S4` built autonomous T-U0 sends and `37 S7` extended to a real recipient (DUP-01). The internal quality gate identified the ESP at-least-once exposure as its one real residual and did not notice the residual was prohibited.

And `35 §4` had **one** unknown-outcome policy for all classes — hold and resolve — which is right for money and wrong for an irrecoverable send in the same way (DUP-02). No invariant compared dispatched sends to reserved units or to the provider's own count (DUP-03).

**Alternatives.**

1. **Require vendor idempotency.** Rejected as the only answer: it eliminates most of the ESP market and it is not necessary, because the query primitive can be built.
2. **Hold-and-resolve for sends, as for money.** Rejected: holding does not help when there is nothing to query synchronously, and the retry that eventually follows is the duplicate.
3. **An ACOS-owned outbox with a recoverability-keyed policy.** Adopted.

**Decision.**

1. **ACOS-owned outbox.** One row per intended message, **unique on the effect idempotency key**, carrying a unique **correlation tag in a provider-visible field** (custom header, metadata, tag).
2. **At-most-once claim.** The row transitions to `CLAIMED` in a committed transaction **before** the HTTP call. **A `CLAIMED` row is never re-dispatched by any path** — recovery, workflow fork, or manual replay (I36).
3. **Recoverability-keyed unknown-outcome policy.**

| Class | On unknown outcome |
|---|---|
| REVERSIBLE / COMPENSABLE (money) | **Hold and resolve.** Reservation held; the reconciler queries or re-POSTs under the original authorisation; never a blind retry. |
| IRRECOVERABLE | **Assume it happened. Never re-dispatch.** Mark `PRESUMED_EXECUTED`, consume the irrecoverable unit, resolve later from the provider's delivery event. |

4. **Delivery-event reconciliation** on the correlation tag resolves `PRESUMED_EXECUTED` to `VERIFIED` or `NEVER_SENT`. **A `NEVER_SENT` row is a new proposal requiring fresh authorisation, never a retry** — which keeps the irrecoverable-unit accounting honest.
5. **ESP selection becomes an EM6 criterion.** A provider with neither an idempotency header nor a delivery-event webhook nor a queryable message log **cannot serve an IRRECOVERABLE class.** That is `25 §7`'s disqualifier applied where it belongs — to vendor selection rather than to engineering.

**Rationale.** The asymmetry is the point. For money the expensive error is duplication, so hold and ask. For an irrecoverable send the expensive error is **also** duplication — Gmail bulk-sender status has **no expiration** and spam rate must stay under 0.1%, so a duplicate storm is a permanent domain-reputation event rather than an annoyance — so **assume-executed is the safe direction and the missed message is recovered by detection rather than by retry.**


**v1.3.4 amendments (IRN-01, OBX-01, OBX-02, OBX-03). The decision is unchanged; four things it depended on are now declared.**

- **This ADR was unreachable as issued.** `30 §5.1` item 4 row 1 was printed as Halt in `NORMAL` too, so the class this ADR is titled for could never be dispatched at all and decision items 2 through 5 had no subject. `30 §5.1b` corrects row 1's `NORMAL` cell **only**: an otherwise-valid IRRECOVERABLE effect is dispatch-eligible in `NORMAL` and still halts in `UNCORROBORATED_STALL`, in `CORROBORATED_DEGRADED`, under the `30 §5.1a` full-halt posture, and against any owner override.
- **Decision item 2's state machine is declared** in `25 §7`: `ENQUEUED → CLAIMED`, one transition, and **no timeout, lease, expiry or reclaim out of `CLAIMED`**. *"Never re-dispatched by any path"* is a state machine, not a convention.
- **The outbox's scope is declared** in `25 §7`: **every effect crossing an external-write boundary**, not the irrecoverable class alone. This ADR's title names the case that forced the mechanism; it never bounded it.
- **"The committed transaction before the HTTP call" is identified** with the claim transaction, which is also `30 §5.7.2` item 3's *"dispatching transaction"* (`25 §7`, OBX-03).

**Decision items 3, 4 and 5 are unchanged and remain unbuilt.** `PRESUMED_EXECUTED`, MIE consumption at the execution point, delivery-event reconciliation, `VERIFIED`/`NEVER_SENT` and the ESP criterion all belong to the later execution/adapter slice (`37 §2`). **A claim is not an execution**, and reaching `CLAIMED` asserts none of them.

**Evidence.** `44 §5`; `25 §7`; DUP-01, DUP-02, DUP-03; quality-gate Gate 5's residual, now closed rather than accepted.

**Invariants.** **I36** — no outbox row transitions from `CLAIMED` to a second dispatch. **I20** — `Σ provider-reported accepted messages per window ≤ Σ reserved irrecoverable units`, reconciled by the **audit plane** from its own ESP read credential.

**Consequences.** A missed message is now possible and is detected rather than prevented — the correct trade, and it means abstention and re-authorisation appear in the human residual. ESP choice is constrained. And **the kill-point tests must run against a real ESP sandbox rather than a mock** (VAL-04), because duplicate prevention at the dispatch boundary is a vendor property and a mock with a naive idempotency implementation passes while the vendor would not.

**Reconsider if:** a provider offers a genuine idempotency key with a documented deduplication window longer than the reconciler's resolution latency — in which case the outbox remains (it is also the at-most-once claim) and the unknown-outcome policy for that provider can move toward hold-and-resolve.
