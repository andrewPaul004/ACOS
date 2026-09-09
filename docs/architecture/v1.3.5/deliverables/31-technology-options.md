# 31 — Technology Options

**ACOS Operating Spine v1.3. Version 1.3. Issued 2026-09-03. Supersedes v1.1 (2026-09-02).**
Covers Phase 2 brief Parts 14 and 21. Depends on `22`–`30`.

## v1.3 change record

No change in v1.3. Version line bumped so the package carries one version; `phase2-v1.3-changelog.md §7` records which artifacts were materially edited and which were not.

## v1.1 change record

| Change | Remediation | Section |
|---|---|---|
| **§3 restates the durable-execution guarantee's reach**: it eliminates re-execution across suspension and resume, and **narrows but does not close** the crash-during-dispatch window. An **S1 spike** compares DBOS against an ACOS-owned Postgres step journal on the same kill-point matrix — the option ADR-002 listed and never evaluated. The DBOS admin surface is disabled or network-isolated. | R18 | §3 |
| The Temporal fallback is corrected: it is the fallback for the **scale and multi-business** triggers only. For a DBOS *guarantee* failure the fallback is a hand-rolled step journal, because moving the checkpoint out of Postgres destroys R1. | R18 | §3, §13 |
| **§2 requires the audit instance on a different provider or, at minimum, a separate account** with separate payment method and operator credentials. | R4 | §2 |
| **Langfuse is dropped**; the observability egress inventory is a prerequisite for any exporter. | R4 | §10, §13 |
| symcc is deferred as an S1 gate, recorded as an `11 E6` amendment under `28 §9.2`. | R14, R19 | §4 |
| A payment-processor adapter (Stripe test mode) and a bank-line fixture are added; Stripe **restricted keys** are named as the one genuinely scope-separable credential in the stack. | R19, R5 | §11, §13 |
| **§14 added**: the credential-holding decision, and the deferred execution-proxy design. | R5 | §14 |


**Sequencing note.** Requirements were fixed in `22`–`30` before any candidate was named. Nothing below is selected because it appeared prominently in Phase 1.

**Licence basis.** Every licence claim traces to `17 §1` / `10 §V1.1.1`, where **38 projects were verified by fetching the LICENSE file and identifying the licence from its body text** — no badges, no landing pages, no package metadata. Where Phase 1 was wrong, the correction is carried, not the original.

---

## 1. Requirements, stated before candidates

| # | Requirement | Source |
|---|---|---|
| R1 | Transactional atomicity between **exposure reservation**, **effect journaling** and **authorisation decision** | SR5, `26 §7` step R |
| R2 | Completed workflow steps journaled and **never re-executed** on resume | `08 §8.1`; the LangGraph `interrupt()` double-refund case |
| R3 | Human approval as a **durable suspension** that survives process restart | `07 §5`, `26 §12` |
| R4 | Policy evaluation **outside the model's reach**, deterministic, versioned, and **provable** on money-bounding properties | EM2, DP3, `11 E6` |
| R5 | Append-only audit store with an **independent writer identity** and retention measured in years | EM16, `08 §10` |
| R6 | Full operation of control and integration planes **with all models offline** | B10, `08 §9` |
| R7 | **Per-task and per-day token/spend budgets enforced at the queue**, below the provider's tier cap | `08 §9`, `09 §11.4` |
| R8 | Idempotency keys deterministic and externally supplied to adapters | `25 §7` |
| R9 | Commerce integration via API with no UI automation | EM10 |
| R10 | Model binding **pinned per function**, with a regression eval suite and canary routing | SR6, `08 §9` |
| R11 | No orchestration topology inside a vendor product | `10 §8` |
| R12 | Permissive licence with no foreclosure on internal commercial operation or on future multi-business use | `10 §4`, `17 §1` |
| R13 | Operable by one developer; MVP small enough to attack | Quality gate 15 |
| R14 | Trajectory-level evaluation and adaptive red-teaming as first-class tooling | `11 E6`, `11 E7`, SR6 |

---

## 2. State and transactional core

**Requirements: R1, R5, R6, R13.**

| Candidate class | Options | Assessment |
|---|---|---|
| Single relational store | **Postgres** (Neon $0.106/CU-hr + $0.35/GB-mo; Supabase Pro $25/mo) | R1 is satisfied by the transaction, at zero architectural cost. Mature, boring, one dependency. |
| Relational + separate ledger DB | Postgres + a second Postgres for finance | Buys nothing R1 wants and costs the atomicity it needs. |
| Event store + projections | EventStoreDB, Kafka + KTables | Genuine fit for the causal chain, but R1 becomes a distributed problem and R13 fails hard for a single developer. Analysed as an architecture option in `32 §5`. |
| Document store | MongoDB, DynamoDB | Weak on multi-entity transactions; the reservation invariant becomes application logic, which is precisely the thing that must not be application logic. |

**Selection: Postgres**, one logical database, with the audit store as a **separate database instance** (not merely a separate schema) so R5's independent-writer property is enforced by credentials and network reachability rather than by a `GRANT`.

**v1.1 addition (R4, TEC-04): the two instances must not share an operator.** v1.0 placed both on managed Postgres at commodity pricing with no separation requirement, so **one cloud operator saw both sides of the separation EM16 depends on** — and a managed provider can read and write everything, including the audit chain, below the trigger layer. Requirement: **different providers, or at minimum separate accounts with separate payment methods and separate operator credentials.** The residual — that a managed database operator is a TCB member either way — is stated in `49` and bounded only by hourly external anchoring (I17b).

**Reconsideration trigger:** if reservation contention becomes a throughput problem — which at 100–3,000 orders/month it will not — or if a second company is added with genuinely independent operations.

---

## 3. Durable execution

**Requirements: R2, R3, R6, R12, R13.**

This is the choice most directly forced by evidence. `08 §8.1`, quoted: LangGraph's *"node restarts from the beginning of the node where the `interrupt` was called when resumed, so any code before the `interrupt` runs again"*, with LangChain's own anti-example being *"creating a new record before interrupt. This will create duplicate records on each resume."* Against that, DBOS states the required guarantee explicitly: *"Once a step completes and is checkpointed, it is never re-executed."*

| Candidate | Licence (file-text verified) | R2 | R3 | R1 coupling | Operational weight | Verdict |
|---|---|---|---|---|---|---|
| **DBOS Transact** | **MIT** | Yes — Postgres checkpoint per step, explicit never-re-execute guarantee | Yes — workflow steps + queues | **Same Postgres as business data.** Reservation and step journal in one transaction | Lowest: no new infrastructure | **PRIMARY** |
| **Temporal** | **MIT** | Yes — event-history replay, completed activities journaled | Yes — Signals / Updates | Separate cluster; R1 becomes cross-system | Cloud from $100/mo, or a cluster to run | **STRONG ALTERNATIVE** |
| **Trigger.dev** | **Apache-2.0** | Checkpoint semantics real; ships *"pause your tasks until a human can approve, reject or give feedback"* | Yes, first-class | Separate | Moderate. TS-first | **VIABLE (TS stacks)** |
| Cloudflare Workflows | Proprietary, no self-host | Yes, GA; `step.waitForEvent()` | Yes | Separate; **3–30 day state retention** | Very low | **REJECT** — retention and no self-host |
| AWS Step Functions | Proprietary | Yes, exactly-once, up to 1 year; `.waitForTaskToken` (AWS's own example is banking transfer confirmation) | Yes | Separate | Low, but heavy vendor coupling | **REJECT** for R11/R12 posture |
| **Restate** | **BSL 1.1** — verified | Yes; Awakeables are a clean approval primitive | Yes | Separate | Moderate | **REJECT.** Not open source; forbids a "Public Restate Platform Service"; imports licence-compliance obligation with **no capability gain over MIT Temporal or DBOS** |
| **Inngest** | Engine **SSPL**, SDKs Apache-2.0, **plus an irrevocable Apache-2.0 grant at each release's third anniversary** (`17 §1.2` correction) | Yes | `waitForEvent` unconfirmed from primary docs | Separate; 24h–90d retention | Low (cloud) | **REJECT for self-host.** Softer than a bare SSPL classification, but three years is not a plan |
| LangGraph as the durability layer | MIT | **No — R2 fails** | `interrupt()`, replay-based at node granularity | — | — | **REJECT for durability.** Fine as a graph-authoring library; not the engine around money |

**Selection: DBOS Transact — provisional, downgraded from decisive to convenient, and subject to an S1 spike** (v1.1, R18).

### 3.1 What the guarantee actually reaches

**What DBOS genuinely delivers** is the elimination of re-execution across **suspension and resume** — the documented LangGraph `interrupt()` re-execution that motivated the choice. That is a real failure mode and it is worth having.

**What it does not deliver** is the property v1.0's `33 §1` and `35 §4` implied: it **narrows but does not close** the crash-during-dispatch window, because an *incomplete* step is not a checkpointed step. Duplicate prevention at the dispatch boundary rests on vendor idempotency keys, a vendor query, or ACOS's own outbox claim. `23 §6` B8 and `25 §7` always said this plainly; the other two documents contradicted them and have been corrected (DBO-01).

**And the dispatch outbox is ACOS-owned code regardless of engine** (`25 §7`, R13), **so the engine is not load-bearing for the money path.** That is the single most useful consequence of this correction.

### 3.2 The fallback was wrong (DBO-02)

ADR-002 v1.0 named **Temporal** as the fallback. But migrating to Temporal **moves the checkpoint out of Postgres and destroys R1** — the property `33 §1` calls decisive and the reason Option A beat Option B. So v1.0's claim that the migration is *"a re-hosting rather than a rewrite"* was false, and taking that fallback is an **explicit return to Option B requiring a distributed-reservation design.**

Corrected:

| Trigger | Correct fallback |
|---|---|
| A **DBOS guarantee failure** — an observed defect in never-re-execute | An **ACOS-owned Postgres step journal**. Keeps the checkpoint in the same database and preserves R1. |
| **Scale or multi-business** — a second operating company with independent workflows, or a workflow routinely exceeding 30 days with external callbacks | Temporal, **and it is a return to Option B**, requiring a distributed reservation protocol and a new ADR. |

### 3.3 The S1 spike

**ADR-002 lists a hand-rolled Postgres step journal as an option and never evaluates it.** On this package's own criteria — one developer, low volume, and a loss-bounding mechanism simple enough to attack directly — it is a serious contender. **Spike both in S1 against the same kill-point matrix**, against a vendor sandbox for `refundCreate` and for the ESP rather than against mocks (VAL-04). DBOS remains the provisional recommendation; the spike decides.

**Do not switch to Temporal because it was v1.0's named fallback.** That is the specific error §3.2 corrects.

### 3.4 The admin surface (SPO-08)

DBOS exposes a workflow-management surface, and **`fork` re-drives a workflow from a chosen step** — a re-execution mechanism the never-re-execute guarantee does not address. **Disable it, or network-isolate it so it is unreachable from any process other than an owner-authenticated operator session.** Any fork is an owner-authenticated action recorded as a decision, and it is asserted as a test rather than assumed from configuration.

**The convergent-shape observation from `08 §10` is adopted:** *"durable engine outside, agent loop inside."* Temporal describes an explicit outer "Agent Harness" with *"a seam between the model deciding to use a capability and that capability actually executing."* **That seam is the Effect Gateway.**

---

## 4. Policy and authorisation

**Requirements: R4, R12.**

| Candidate | Licence (file-text verified) | Provable? | Maturity | Verdict |
|---|---|---|---|---|
| **Cedar** | **Apache-2.0**, v4.11.0 (2026-05-18), OpenSSF badge | **Yes** — `cedar-policy-symcc` v0.6.0, Apache-2.0 via workspace, **inside `cedar-policy/cedar`** (`17 §1.2`: `cedar-policy/cedar-symcc` does not exist; the capability claim stands, only the repo reference was wrong) | AWS-backed | **PRIMARY** |
| **OPA** | **Apache-2.0**, v1.17.0, CNCF-graduated | No symbolic verification | Very high | **FALLBACK** |
| Casbin | Apache-2.0, ASF | No | High | Learn from |
| SpiceDB | Apache-2.0 | No | High | Defer — relationship-based authz is not the shape of ACOS's problem |
| **Oso OSS** | Apache-2.0 | — | **`README.md` line 1 on `main` is literally `# Deprecated`**; last release 2023-12-18 | **REJECT** |

**Selection: Cedar.** The differentiator is P1–P7 in `26 §11` — proving *"no path permits a refund above $X"* with concrete counterexamples, as a CI gate, rather than sample-testing it. `11 E6` pre-registers **zero** policy-violating writes and **no symcc counterexample**, with the note that *"99.9% is not a passing grade for financial authority."* Sample-testing cannot produce that assurance.

**v1.1: symcc is deferred as an S1 gate** (R14, R19, `45 §3`). With a three-class action catalogue the policy set is hand-checkable, and symcc adds a toolchain plus the fragment-compatibility risk ADR-005 names as its own reconsideration trigger. The gate returns before the catalogue exceeds ten classes and before any real money. **This is recorded as a formal amendment to `11 E6` under `28 §9.2`**, not applied silently — `45 §3` is explicit that quietly moving a pre-registered gate is the goalpost move the constitution prohibits.

**And the honest limit is sharper than v1.0 stated.** `45 §7`: without the Effect Canonicaliser, *"symcc establishes that no policy path permits a refund above the cap, given a request, while the request's amount arrives from the model"* — property 3 proved about the wrong object. A symbolic proof about a request is worth exactly as much as the construction of the request, which is why R1 outranks symcc in the complexity budget.

**Honest limits, restated from `26 §11`:** symbolic verification proves properties of the *policy set*. It does not prove the engine is implemented correctly, that preconditions are fetched correctly, that recoverability assignments are right, or that adapters do what their action classes claim.

**Fallback condition:** if the policy set proves inexpressible in Cedar, OPA replaces it and nothing else in the architecture changes — the engine sits behind a `PolicyEngine` interface with one method.

---

## 5. Queue and event infrastructure

**Requirements: R6, R7, R13.**

At `09 §5.2` scale — 100–300 orders/month, ~3,000 steps/month — a message bus is unwarranted. **DBOS queues on the same Postgres** satisfy R7 (budget enforcement at the queue), R1 (same transaction) and R13 (no new infrastructure).

Webhook ingest needs to return 200 within Shopify's **5-second total timeout** with a **1-second connection timeout** (`08 §8.3`). A thin edge handler doing HMAC-verify → dedupe-insert → enqueue → 200 meets that comfortably on any runtime.

**Reconsideration trigger:** sustained ingest above what a single Postgres-backed queue absorbs, or a genuine fan-out requirement. Neither exists at proving-ground scale.

---

## 6. Commerce integration

**Requirements: R9, R12.**

| Candidate | Licence | Role |
|---|---|---|
| **Shopify custom app + `shopify-app-js`** | MIT (file-text verified); `@shopify/shopify-api@13.0.0`, 739 releases | **PRIMARY substrate.** `21 §4.5`: ToS expressly contemplate agents acting for the Store Owner; custom apps need no review; protected customer data at Levels 1 and 2 with no approval queue; non-expiring offline tokens; `refundCreate` carries an `@idempotent` directive as of API 2026-04. Do not reimplement OAuth or webhook HMAC — `10 §6` is right that it is pure downside risk. |
| **Medusa** | **MIT** (file-text verified), 34.3k stars, v2.15.5 | **Not adopted as the foundation** (`32 §7`), but its durable workflow engine **with per-step compensation inside a commerce domain model** is the reference implementation for the saga pattern in `25 §10`. Borrow the pattern. |
| Saleor | BSD-3-Clause | Learn from |
| **Vendure** | GPLv3 + a **GPL §7 plugin exception** (`17 §1.2` — materially better than plain GPLv3 implies) | Still avoid as a foundation: copyleft on the core of a commercial operating business for no capability gain over MIT Medusa |

**A hard constraint carried forward.** Shopify Functions are deterministic by mandate (no randomness, no clock, no network) — an excellent enforcement surface — but **custom apps containing Functions require Shopify Plus at $2,300/mo** (`10 §2.2`). Below Plus, price and discount enforcement falls back to ACOS's own policy layer plus platform-side caps. **Plan tier is forced by automation needs before it is forced by store size**, and the architecture must not assume Functions are available.

---

## 7. Model and provider abstraction

**Requirements: R10, R11, R6.** Phase 2 brief Part 14 asks what belongs in the architecture and what is an implementation detail. Both answers matter.

### 7.1 In the architecture

| Element | Why it is architectural |
|---|---|
| **`ModelBinding` registry** — `{binding_id, provider, model_id, version, prompt_version, params, cost_ceiling, eval_suite_ref}` | SR6 keys the autonomy ledger on it. Without a first-class binding there is nothing to demote. |
| **Pinned model id per function** | `08 §9`: Anthropic commits to a minimum 60 days' notice before retiring a released model, and several received exactly the minimum (`claude-opus-4-1-20250805`: announced 2026-06-05, retired 2026-08-05). Production lives ~12–13 months. |
| **Regression eval suite gating any binding change** | `08 §9` GAP: *"No source quantifies behaviour change across model versions on a fixed prompt suite. That is something to measure internally, not look up."* |
| **Canary routing** | A fraction of traffic on the candidate binding, with outcome comparison, before promotion. |
| **Autonomy demotion on binding change** | SR6. The new binding starts at probation. |
| **Per-function and per-day cost ceilings enforced at the queue** | `08 §9`: the Anthropic spend cap returns **429 with `enforced_spend_limit_reached` and no `retry-after`**, and access *"pauses until 00:00 UTC on the first day of the next month."* A runaway must degrade, not hard-stop for weeks. |
| **Outage behaviour: degrade, do not substitute** | A fallback to a different model does **not** inherit the primary's earned autonomy. The degraded mode is `REQUIRE_APPROVAL`, or skip the pass entirely for non-urgent work. |
| **No reliance on `temperature` / `top_p` / `top_k`** | `08 §9`: deprecated, and *"Return 400 error on Claude 4.7+ models."* A client that pinned `temperature=0` for determinism hard-fails on upgrade. |

### 7.2 Implementation detail

A thin `ModelClient` adapter with `complete(binding, messages, schema)`. Nothing more. **No universal provider abstraction layer, no routing platform, no gateway product.** The brief warns against abstraction for hypothetical providers; the concrete need is two or three providers and a table, and Pydantic AI (MIT, file-text verified, 19.6k stars, with first-party Temporal/DBOS/Prefect durable backends) covers the multi-provider surface without ACOS building one.

### 7.3 What must not happen

`10 §8`, with dates attached: OpenAI sunset the **Assistants API on 2026-08-26** and **Agent Builder on 2026-11-30**, the latter roughly a year after launch. Microsoft folded Semantic Kernel and AutoGen into Agent Framework. MCP has shipped two breaking redesigns in ~14 months. The Claude Agent SDK removed its experimental V2 session API in TypeScript 0.3.142. **Orchestration topology lives in ACOS's own code on a permissively-licensed durable engine. Putting the control plane inside a vendor's agent framework is a churn risk with dates already attached to it.**

### 7.4 Cost routing

`09 §9` ranks the levers, and the ranking is counter-intuitive enough to be worth encoding:

1. **Do not use AI at all** — the largest lever by a wide margin, and it is EM5.
2. **Prompt caching** — ~2.5× on volume lines, **plus 5× rate-limit headroom because cache reads do not count toward ITPM.** No other lever buys rate-limit headroom.
3. **Cheap-model routing** — ~9%. A distant third.

So the architecture supports per-function bindings (which makes cheap-model routing possible) but does not treat routing as a cost strategy. `09 §12` also flags a dated hazard: **Gemini 3.7/3.6 Flash pricing doubles on 2027-01-01** — any routing design leaning on it carries a scheduled 2× step.

---

## 8. Agent SDK

**Requirements: R11, R12.**

| Candidate | Licence (file-text verified) | Verdict |
|---|---|---|
| **Pydantic AI** | **MIT**, 19.6k stars, first-party Temporal/DBOS/Prefect durable backends | **ADOPT** — at the worker boundary only |
| Claude Agent SDK | **MIT** | **Learn from the hooks pattern.** Not used for authority: `08 §8.2`'s three documented bypass paths make in-process permission callbacks unusable as a control, and ACOS has no money tool in a model's tool list anyway |
| OpenAI Agents SDK | MIT | Learn from |
| LangGraph | MIT | Learn from. Not the durability layer (§3) |
| Mastra | Apache-2.0 core; **EE licence effective 2026-08-24 forbidding production use without a written agreement** | **Avoid** |
| **AIOS (`agiresearch/AIOS`)** | **NO LICENCE GRANTED.** `LICENSE` is **one byte — a bare newline**; a full-tree scan found no other licence file; the README contains zero occurrences of "licen" | **🚨 HARD BLOCKER.** `21 §7` and `10 §V1.1.1`: under default copyright no rights are granted. **Do not depend on, vendor, or ship anything derived from it.** Not adopted, not vendored, not referenced as an implementation dependency. |
| MetaGPT | MIT; last release 2025-02-19 | Learn from, negatively |

**The SDK's job here is narrow:** structured output, retries against the provider, and provider portability inside one bounded work item. Everything the SDK might otherwise do — orchestration, permissions, memory, delegation — is kernel responsibility.

---

## 9. Evaluation and red-teaming

**Requirement: R14.** This is not optional tooling; `11 E6` and `11 E7` are the acceptance gates for autonomy.

| Candidate | Licence (file-text verified) | Role |
|---|---|---|
| **promptfoo** | **MIT**, 24.2k stars | Evals **and** red-teaming in one. Primary harness for `11 E6`. |
| **DeepEval** | **Apache-2.0**, 17.5k stars | **Agent trajectory metrics** — what an audit function needs and what pass/fail on final answers misses. |
| **Inspect (UK AISI)** | **MIT**, 200+ evals | The harness public benchmarks run under. Using it makes ACOS's internal numbers comparable to published ones — which matters because `10 §2.4` records published browser/computer-use benchmarks spanning **42.33% to 97% on the same benchmark**, and *"the only usable number is one ACOS measures itself."* |
| Braintrust | SDK Apache-2.0, **platform proprietary** | **REJECT as the audit system of record.** `10 §2.4`: the auditor must not be suppressible. |

---

## 10. Observability

**Requirement: R5, and SR9.**

| Candidate | Licence | Role |
|---|---|---|
| **ACOS's own event schema in Postgres** | — | **Authoritative.** `08 §11`: no GenAI OTel span, event, metric or attribute is marked Stable; the conventions moved repository and the new one *"has no releases or tags yet"*; adoption is uneven — Strands defaults to frozen v1.36-era behaviour, the OpenAI Agents SDK does not emit them natively. Instrumenting against a moving unversioned target as the system of record is not defensible. |
| **Langfuse** | **MIT except `ee` folders**, self-hostable | **v1.1: DROPPED** (R4, SPO-06, `45 §3`). A secondary view by ADR-012's own framing, and an **unenumerated third-party egress channel** receiving prompt/completion pairs that for a support worker are case-scoped PII — appearing in no egress table while `29 §4` claimed kernel egress was *"Database; adapters; audit store."* Reconsider only after the observability egress inventory exists and self-hosting inside the VPC is in place. Copyright is now `ClickHouse, Inc.` (`17 §1.3`), a change of control on a nominated component. |
| **OpenLLMetry** | Apache-2.0 | Instrumentation, upstreamed conventions. |
| Arize Phoenix | **Elastic License 2.0** — *"You may not provide the software to third parties as a hosted or managed service"* | Permitted internally; unnecessary when Langfuse is MIT. |
| Sentry | Commercial, Team $26/mo | Incident alerting. Commodity — **and an egress channel from credential-holding processes.** Sentry payloads routinely carry request bodies, headers and environment. **Permitted only behind a code-enforced scrub allowlist of permitted fields** (`29 §4.1`), never a denylist, and never receiving support-worker context. |

---

## 11. Bookkeeping, tax, support, and the rest of the buy side

Not re-litigated. `10 §2` and `10 §6` are accepted as-is, and the buy-side roll-up at first-store scale is **$426–576/month**, against $122 for the AI side — **the buy side is 3.5–4.7× the AI side** (`10 §7`). The architectural consequences:

- **A2X (from $29/mo)** posts settlement journal entries that tie to the bank line. K6 consumes A2X's output as one input; it does not replace the cross-source reconciler, which A2X does not do (`10 §5.4`: A2X does this for a channel, not across AI cost, POD COGS and ad spend).
- **Do not build**: OAuth flows, webhook HMAC, durable execution, a policy engine, a tax engine, sending reputation, a helpdesk, a payment ledger, a scraping fleet, a chart of accounts, a mockup renderer (`10 §6`).
- **API access is a paywalled tier** on ShipStation, AfterShip, ParcelPanel and Loop (`10 §9`). **Autonomy cannot use the cheapest tier of anything**, and the budget must reflect that.
- **Three platform-enforced limits are free deterministic guardrails** and are inventoried deliberately (SR10): Meta `spend_cap` (server-side pause), Google's 2× daily / 30.4× monthly hard limits, Klaviyo's 100/day flow-creation cap.

---

## 12. Licence landmine register, carried forward

Every item verified from file text in `17 §1`.

| Component | Status | Foreclosure |
|---|---|---|
| **`agiresearch/AIOS`** | **NO LICENCE GRANTED** | Everything. Not usable at all. |
| Restate | BSL 1.1, Change Date +4yr → Apache-2.0 | Any hosted service offering; not adopted |
| Inngest engine | SSPL + irrevocable Apache-2.0 at each release's 3rd anniversary | Self-hosting inside a third-party offering; not adopted |
| n8n | Sustainable Use License v1.0; **non-`master` branches are not licensed at all**; `.ee.` files require an Enterprise Licence; **no copyright line** | Every path where automation is resold or exposed to third parties — which conflicts with the portfolio ambition. Keep replaceable; never a foundation |
| Vendure | GPLv3 + §7 plugin exception | Copyleft on a commercial core for no gain over MIT Medusa |
| Windmill | **Three licences**: AGPLv3 default; `*-client/` and the OpenAPI/OpenFlow spec Apache-2.0; **distributed CE binaries contain proprietary code** that may not be resold, wrapped or served as a managed service | Consuming the Apache-2.0 clients is safe. "AGPLv3" alone was not a sufficient basis for a decision |
| Arize Phoenix | Elastic License 2.0 | Managed-observability offering |
| Langfuse | MIT except `ee`; **copyright now ClickHouse, Inc.** | Nothing today; a change-of-control risk to monitor |
| Mastra | Apache-2.0 core; **EE licence effective 2026-08-24** forbids production use without a written agreement | Avoid |
| Oso OSS | Apache-2.0 but `# Deprecated` | Maintenance, not licence |
| Activepieces | MIT core / commercial `packages/ee` | Learn from |
| MCP specification | **Apache-2.0 + residual MIT + CC-BY-4.0 docs**, holder now **Model Context Protocol a Series of LF Projects, LLC** — not MIT as Phase 1 recorded | Practically permissive either way |

**Transferable lesson recorded in `10 §4` and adopted:** if ACOS ever mixes licences in its own code, keep the boundary at the **package** level from day one — do not replicate Windmill's or Activepieces' EE-boundary ambiguity.

---

## 13. Selection summary

| Need | Selection | Fallback | Rejected, and why |
|---|---|---|---|
| State | Postgres (single logical DB) | — | Event store (R13), document store (R1) |
| Audit store | Separate Postgres instance | — | Any closed-core platform (suppressibility) |
| Durable execution | **DBOS Transact (MIT), provisional — S1 spike against a hand-rolled Postgres step journal** | **ACOS-owned Postgres step journal** for a guarantee failure; Temporal (MIT) **only** for the scale/multi-business triggers, and taking it is a return to Option B | Restate (BSL), Inngest self-host (SSPL), Cloudflare (retention, no self-host), Step Functions (lock-in), LangGraph (R2 fails) |
| Policy | **Cedar (Apache-2.0) + `cedar-policy-symcc`** — symcc gate deferred past S1, recorded as an `11 E6` amendment | OPA (Apache-2.0) | Oso (deprecated), SpiceDB (wrong shape) |
| Queue | DBOS queues on Postgres | Any durable queue | A message bus (unwarranted at scale) |
| Commerce | Shopify custom app + `shopify-app-js` (MIT) | Medusa (MIT) self-host | Vendure (copyleft, no gain) |
| **Payment processor** (v1.1) | **Stripe test mode**, with **restricted keys** — the one scope-separable credential in the stack | — | Excluding it, which v1.0 did: with no processor and no bank line, property 6 is proved against a single source |
| **Bank line** (v1.1) | **Synthetic bank statement fixture** at MVP; a real bank feed at first real money | — | Omitting it, for the same reason |
| **Credential holding** (v1.1) | Platform secret manager, per-adapter secrets, no broker component | Broker as **execution proxy** at the first money-moving credential or the third adapter | The broker as v1.0 described it — it cannot issue what was described |
| Agent SDK | Pydantic AI (MIT), worker boundary only | Direct provider SDKs | **AIOS (no licence)**, Mastra (EE), any vendor agent-builder |
| Evals | promptfoo (MIT) + DeepEval (Apache-2.0) + Inspect (MIT) | — | Braintrust as record of audit |
| Observability | Own schema (authoritative). **No third-party exporter until the egress inventory and a code-enforced scrub allowlist exist** | OpenLLMetry, self-hosted | **Langfuse (dropped, v1.1 — unenumerated PII egress)**; OTel GenAI conventions as the record (unstable) |
| **External anchoring** (v1.1) | A medium the database operator cannot rewrite, hourly, plus a copy to the owner (I17b) | — | "Periodic" with no cadence, which left the maximum undetectable rewrite window undefined |
| Alerting | Sentry | — | — |
| Settlement bookkeeping | A2X | — | Order-level sync (never ties to a bank line) |

**One deliberate non-selection.** No vendor is chosen for **opportunity discovery**. `10 §5.3`: niche discovery has *"nothing mature and trustworthy"* behind it and vendor "winning product finder" tools are marketing-grade. The architecture supplies evidence plumbing; it does not claim the algorithm, and buying one would import exactly the vendor-marketing-laundering risk `11 E8` exists to measure.

---

## 14. Credential holding (v1.1, R5)

The decision v1.0 described but could not deliver. `29 §3` has the full analysis; this is the technology selection.

| Need | Selection | Trigger to change |
|---|---|---|
| Vendor secret storage | **Platform secret manager** (the managed Postgres provider's, or the host's), one long-lived secret per adapter, injected at process start, never shared between adapters | — |
| Credential broker component | **None at MVP.** Removed (`45 §3`). With two adapters and no money it adds a TCB member and does not do what `29 §3` v1.0 described | **Build the execution proxy at the first money-moving credential or the third adapter, whichever comes first** (ADR-024) |
| Scope separation where the vendor supports it | **Stripe restricted keys** — the one genuinely scope-separable credential in this stack | — |
| Scope separation where the vendor does not | **None available.** Shopify scopes are app-level; Google Ads requires the full `adwords` scope for any GAQL read; Meta's `ads_management` has no account-level sub-scope; ESP server tokens send anything to anyone. Compensated by the empirical probe (I15) and by audit-plane polling of platform caps (I33) | A vendor shipping per-action credentials |
| Revocation | **Per-credential revocation switch that revokes**, not one that stops the loop (`07 §10.6`) | — |
| Isolation | **Per-adapter** runtime, filesystem and dependency tree. Bank-line ingest in its own runtime | — |

**The honest statement of what this buys.** Not scope reduction — the vendor decides that, and on three of four platforms the answer is no. What it buys is **attribution, blast-radius separation between adapters, and a revocation path**. `42 §4` is right that there is no third design in which no ACOS component holds a credential capable of exceeding a single action, because that requires the vendor to issue per-action credentials and none of them does.
