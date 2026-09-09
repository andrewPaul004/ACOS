# 38 — Phase 2 Review Brief

**ACOS Operating Spine v1.3. Version 1.3. Issued 2026-09-03. Supersedes v1.1 (2026-09-02).**
For an independent adversarial reviewer coming to the package fresh. Read this first, then `33`, then attack.

## v1.3 change record

Superseded as a review brief; retained for history and excluded from the authoritative implementation set. Full disposition in `phase2-v1.3-remediation-ledger.md`.

**Scope note.** This is the **general** review brief, updated for v1.1. The **narrow second red team** has a different and deliberately restricted scope — exactly five items — and its brief is `phase2-v1.1-second-redteam-brief.md`. If you were commissioned for the narrow pass, read that instead; this document is context, not your assignment.

## v1.1 change record

| Change | Remediation | Section |
|---|---|---|
| §1 records the first adversarial review and its verdict. | — | §1 |
| §2's one-paragraph recommendation is rewritten: the chokepoint claim is narrowed to `42 §9`'s wording, the canonicaliser is named, DBOS is provisional, symcc is deferred, and the audit store is a replicating verifier with its own reads. | R1, R3, R4, R5, R10, R14, R18 | §2 |
| §3's ten decisions are re-ranked. Three are new; four had a claim corrected; the `propose_effect` naming is fixed. | R1, R2, R3, R6, R12, R15, R18 | §3 |
| §4 keeps the EM list verbatim and adds the EM15↔EM16 conflict record and the three EM claims that were false as written. | R3, R4, R8 | §4 |
| §5 adds three newly-arguable preferences and removes the `37 §5` limits, which are now a fixture. | R8, R19 | §5 |
| §6's unresolved questions are re-ordered: the TCB residual enters at rank 2, the neutrality claim at 3 is corrected, and three items are added. | R4, R5, R15, R17 | §6 |
| §7's risk 2 (request construction) is now **closed by design**; risk 4's per-module-role enforcement claim is **withdrawn**; four risks are added. | R1, R4 | §7 |
| §8 restates the implementation boundary: v1.1 is still architecture, and the decision is READY FOR NARROW SECOND RED TEAM, not READY TO IMPLEMENT. | — | §8 |
| §9's twenty questions are updated: five are answered by v1.1 and marked as such, four are re-aimed, and six are added. | multiple | §9 |

---

## 1. What was authorised, what was produced, and what was found

`21` issued a **CONDITIONAL GO TO PHASE 2 — spine and authority layer only**, explicitly withholding any business-model decision and authorising Phase 2 to run in parallel with Stages 0–2. This package designs the business-model-independent operating spine. It selects no niche, no product, no channel, and no first business.

**v1.0** produced seventeen deliverables, `22`–`38`, with no production code.

**Phase 2R** was an independent adversarial review producing nine artifacts, `39`–`47`. Its operative verdict (`47`) is **CONDITIONAL PASS — REMEDIATION REQUIRED**, with **zero FATAL findings**, ninety-two numbered defects, and twenty remediation items R1–R20. `47 §3` endorsed the core structural choices — Option A, grade-from-writer, reserve-before-approval, the separate audit plane, construction-over-classification — more strongly than v1.0 argued them, and found that **every serious defect was in a claim about a mechanism rather than in the mechanism's shape.**

**v1.1** is the remediated package: twenty-one deliverables (`22`–`38` plus `48`–`51`), three v1.1 control documents (changelog, remediation ledger, invariant registry), and still no production code. `phase2-v1.1-remediation-ledger.md` records the disposition of all twenty items: **fourteen APPLIED, five APPLIED-AS-RULE with implementation deferred, one DEFERRED PER RED TEAM (R16), zero superseded.**

**What a fresh reviewer should know about the shape of the remediation.** Almost nothing about the architecture's structure changed. What changed is that eight claims were withdrawn or narrowed, forty-one invariant citations were corrected against a new authoritative registry, one missing component was added (the Effect Canonicaliser), one missing entity was added (`StandingAuthorization`), and four capabilities were deferred out of the MVP. **If you find v1.1 making a strong claim, check whether v1.0 made a stronger one and why it stopped.**

---

## 2. The recommendation, in one paragraph

**ACOS Operating Spine v1.1**: a Postgres-centric modular monolith with DBOS Transact for in-database durable execution — **provisional, with an S1 spike against an ACOS-owned Postgres step journal** — Cedar linked into the deterministic kernel with `cedar-policy-symcc` proving money-bounding properties in CI **at a gate deferred past S1**, stateless credential-free reasoning workers holding exactly one write capability, **a deterministic Effect Canonicaliser that constructs every authorisation request and dispatch payload from authoritative state**, credential-holding adapters with no model clients that act as **transports rather than fact authors**, and a physically separate hash-chained audit store that is a **replicating verifier with its own read-only vendor credentials and its own read endpoint**. Four planes divided by trust and determinism rather than by business domain.

**On the chokepoint, in the wording it can defend.** Every external state change **that originates in AI reasoning** passes through one deterministic chokepoint, the Effect Gateway. A small, enumerated set of deterministic components — reconcilers, the subscription watchdog, credential refresh, framework-managed registration, observability exporters — can also reach external systems; each is inventoried in `48`, each is annotated at its call site, and **none is reachable from a model-bearing runtime**. v1.0 claimed the strong version; `42 §1` found six unauthorised paths, and the CI check is what converts *"the only permitted path"* into *"the only capable path"*.

**The decisive property, unchanged:** the exposure reservation, the authorisation decision, the effect journal row **with its gap-free sequence and local chain hash**, and the state transition commit or fail together as one Postgres transaction. `26 §10`'s authorised-loss quantities govern the entire system and depend on reservations being uncheatable under concurrency. Option B makes that a distributed protocol; Option C makes it a race between a log append and a projection. A makes it a `BEGIN`. **`47 §3` endorses this. Note that ADR-002's v1.0 Temporal fallback silently destroyed it, which is corrected.**

---

## 3. The ten decisions most worth attacking

Ranked by how much breaks if the decision is wrong. **Re-ranked for v1.1; three entries are new.**

1. **Single write capability, `propose_intent(ProposedIntent)`, plus kernel-side canonicalisation** (SR1, ADR-006, ADR-021). Everything rests on there being no other path out **and on the kernel constructing the request rather than receiving it**. v1.0's capability was `propose_effect(typed_proposal)` and the model supplied the exposure figure — `47 §1`'s first finding, and the reason every other monetary control was downstream of model output. If a reviewer finds a second path out, or a field of the dispatched request that still comes from the model, the architecture's central claim fails.
2. **The Trusted Computing Base is fourteen components, four of which v1.0 never named** (`49`, new in v1.1). Adapters are irreducibly inside it, because vendor OAuth scopes are coarser than ACOS action classes on every platform examined. **`MAL_total` bounds a compromised model and bounds nothing about a compromised TCB member.** This is now the largest residual in the architecture and it was absent from v1.0's risk list.
3. **Recoverability as a budget currency, split into discretionary and order-driven, with duration as a third dimension** (EM3, ADR-017, ADR-022). If irrecoverable actions can be taken without consuming `MIE_discretionary`, the highest-consequence actions are ungoverned — **and if a rate-based authorisation is not represented at all, one authorised budget change spends indefinitely, invisible to the ceiling.** v1.0 had the first half and not the second.
4. **Reserve before the approval wait** (SR5). The only control against accumulation-of-plausible-decisions, which is the Project Vend failure mode. **v1.1 additionally claims what v1.0 did not: it bounds the monetary approval queue structurally.** It does not bound the non-monetary one, which is why an owner-attention budget exists.
5. **The audit store is a replicating verifier with independent inputs, not a write-ahead dependency** (ADR-013, R3, R10). v1.0's version proved integrity of rows present, had no completeness invariant, did not specify who computed the hashes, gave no anchoring cadence, and its only inputs were rows written by the plane it audits. **Halt now applies by recoverability class**, which is a selected trade-off against EM15's statutory clocks rather than a resolution of the conflict (`22 §3.1`).
6. **Grade derived from writer identity, never asserted — with DECISION split and a parser between the adapter and the fact** (SR3, ADR-016). The derivation survived every content-level attack in `40`. It leaked in exactly two places: a model-originated decision reaching gating grade within delegated authority, and an adapter computing its own content hash.
7. **Utterance authority by construction, not classification — and T-U0 only at MVP** (EM4, ADR-015). Chosen because `07 §11.7` records no measured false-negative rate for response validation anywhere. **v1.0's claim that a T-U0 response "cannot say anything not already a record" was true about provenance and false about meaning**, and `44 §2.1` constructed six prohibited commitments that pass a closed lexical grammar. If construction is insufficient for T-U0 too, there is no fallback that is not depending on an unknown.
8. **Modular monolith over services** (ADR-003). Trades scale and isolation for transactional atomicity and buildability. **Note that v1.1 withdraws the per-module-role isolation claim** — the `effect_path` role spans four schemas because the decisive transaction requires it, so the roles are drift detection, not compromise containment.
9. **DBOS over the alternatives** (ADR-002, PROVISIONAL). The youngest and smallest candidate, chosen for one specific guarantee **whose reach v1.1 narrows: it eliminates re-execution across suspension and resume and does not close the crash-during-dispatch window.** The outbox is ACOS-owned code either way, so the engine is not load-bearing for the money path.
10. **The CEO as a scheduled function with no private or ungoverned memory, deferred out of the MVP** (ADR-008, `27 §2.0`). v1.0 called it *memoryless*, which was false — a CEO-authored objective is an instruction to a future pass. The property the CEO slice exists to prove is proved by a deterministic briefing generator plus the audit plane's diff.

**Dropped from the top ten:** *no message bus* (ADR-004) and *Shopify custom app* (ADR-014). Both survived review untouched and neither is where the risk is.

---

## 4. The evidence-mandated constraints, reproduced verbatim

From `22 Part A`. These are not preferences. Each is traced to a Phase 1 finding and an architecture that violates one is wrong, not merely different.

- **EM1** — An LLM is never the last component before an irreversible external effect
- **EM2** — Authority is enforced by code the model cannot reach, call, or modify
- **EM3** — Recoverability is a property of the action, not of the permission
- **EM4** — Utterance authority is modelled separately from execution authority
- **EM5** — Roughly half the capability surface has no interpretive content and must stay conventional software
- **EM6** — Work is bounded, idempotent, capturable and independently reconcilable
- **EM7** — Financial truth is produced deterministically, with no model in the accounting path
- **EM8** — All external content enters as untrusted data with zero authority
- **EM9** — The governed quantity is ungated agent actions per month, not agent count
- **EM10** — Operate through APIs. Do not design around UI automation
- **EM11** — Agent identity and capability declaration are architectural surfaces
- **EM12** — Platform-attributed ROAS is never authoritative and never the sole optimisation signal for an authority-bearing loop
- **EM13** — Marketing intensity is a trajectory constrained by runway, not a threshold
- **EM14** — Conversation history is never company memory, in any form
- **EM15** — Named human obligations are architectural objects with statutory clocks, not process notes
- **EM16** — The audited system cannot write to, alter, or suppress the audit record
- **EM17** — No AI system may create a payment path; it may only move along one

The eleven **SR** design preferences (`22 Part B`) are inferences, not mandates, and are the correct place to push back. SR1, SR2, SR3, SR5 and SR6 are the ones doing the most work.

**v1.1: the list above is unchanged, and three of the claims made about it were false as written.** `22 §3.1` carries the full record; the summary a reviewer needs:

- **EM9's exact-countability** depended on every external write carrying an authorisation row. Six deterministic paths could write without one (`42 §1`). The perimeter artifact and its CI check (`48`, I24) are what restore it.
- **EM16 and EM15 are in genuine conflict**, and v1.1 records this rather than dissolving it. Enforcing EM16 strictly — halt effects when the audit mirror is unreachable — blocks refunds while the FTC 7-working-day clock and GDPR Art. 12(3) run. `30 §5.1`'s split halt by recoverability class is a **selected trade-off**: reversible and statutory-clock-bearing effects dispatch against a locally committed, locally chained, gap-free journal row; irrecoverable effects halt. **A reviewer who thinks the trade is wrong should say which invariant to renegotiate, because both cannot be absolute.**
- **EM17's double enforcement is real for eight of twelve prohibited classes, conditional for two, and absent for two** (`29 §3.3`). v1.0 asserted it for all of them. The two with no credential-level enforcement — the account-level spend cap and the `email.send`/`email.campaign.send` distinction — are marked non-autonomous.

**And SR10's mandatory corollary is unsatisfiable on the selected platforms.** *Prefer platform-enforced limits over self-enforced ones* is sound; the Google Ads API requires the full `adwords` scope for any GAQL read and mutates account budgets under that same scope, so the cap is a **detection surface** polled by the audit plane (I33), not an independent control. `35 §7`'s claim that it *"holds even if the entire control plane misbehaves"* is withdrawn.

---

## 5. Design preferences that are genuinely arguable

Stated so the review can target inference rather than evidence.

- **SR1's strong form.** That models hold *exactly one* write capability rather than a small set of scoped ones is an inference. Its cost is real: every new capability is a code change (`22 EM1` calls this the single largest velocity cost in the architecture, accepted deliberately).
- **SR2's mechanism.** Independence in time via an evidence store, rather than concurrent independent evaluators. Cheaper and more auditable; loses whatever concurrent disagreement provides.
- **No agent-to-agent channel at all.** Defensible on injection-propagation grounds, but it is an absolute where a bounded typed channel might suffice.
- **The three-tier utterance model.** The tier boundaries are judgement. **v1.1: T-U1's boundary is now twelve structural conditions and the tier is deferred** — a reviewer who thinks that is over-conservative should attack `26 §9.6` conditions 6–8 (no future tense with ACOS as subject, no conditionals, no first-person commissives), because those are what actually bound the Moffatt exposure and they are also what makes T-U1 collapse toward T-U0.
- **`m`'s denominator basis.** Unresolved in `18 §8` item 4 and unresolved here.
- **The split halt boundary sitting at IRRECOVERABLE** (v1.1). Reversible and statutory-clock-bearing effects dispatch against a local journal row while the audit mirror is down. A stricter reviewer would halt everything and accept the statutory exposure; a looser one would dispatch everything and accept the audit gap. **This is the most arguable single decision in v1.1.**
- **Deferring T-U1, the model-backed CEO, the research worker and symcc out of the MVP** (v1.1). Each deferral is defended in `45 §3` and `45 §9` on the ground that it proves nothing the remaining slices do not, and each has a written trigger. A reviewer may reasonably argue that deferring the CEO removes the only slice that exercises the *system* rather than its parts.
- **`MIE_cost` being `[ESTIMATE]`-graded while entering a displayed ceiling** (v1.1). The alternative — omitting it, as v1.0 did — understated authorised loss by 25–33%. Neither option is clean.

**Removed from this list:** *the proposed authority limits in `37 §5`*. They are no longer a table in prose. `51-limits-fixture.md` instantiates the grant registry and I7's CI check asserts the displayed ceiling equals a second implementation's recomputation, because v1.0's table contained three figures that contradicted the MAL printed beside them.

---

## 6. Unresolved questions, in order of consequence

1. **Acquisition economics.** `21 §1`: CPA is the binding constraint on viability, and no architectural choice affects it. Automation makes the operator cheaper; it does not make the customer cheaper. Stage 2 decides this, not Phase 2.
2. **The Trusted Computing Base residual** (v1.1, `49`). Fourteen members, four of which appeared nowhere in v1.0: CI/CD, the migration/DDL principal, the cloud database operator, and the observability vendors. **Adapters cannot be removed from it**, because vendor OAuth scopes are coarser than ACOS action classes on every platform examined (`42 §4`), so the residual under a compromised adapter is its full credential scope **plus every authority whose preconditions its RECORD writes can satisfy**. The mitigations are empirical — probe continuously, read independently, anchor hourly — and none of them closes it.
3. **The opportunity-discovery algorithm is not solved and no vendor is selected** (ADR-020). `10 §5.3` finds nothing mature and trustworthy behind niche discovery. This is the largest open problem in the project and the architecture does not address it.
4. **No business model is chosen**, per `21 §5`. **v1.1 narrows the neutrality claim.** `33 §9` v1.0 said the test *"passes only if no kernel capability changes"* and reported "none" in every column; two of v1.1's own corrections — the MIE split and the counterparty/`customer_novelty` split — **are kernel changes, and each is forced by two of the four columns.** The defensible claim is that the core *write-governance* architecture is largely model-independent while exposure classification, compliance surfaces and counterparty semantics may require model-specific extensions. And micro-SaaS strains it hardest: **a GDPR Art. 17 erasure request requires an authorised effect inside the sold product's data plane**, so "outside the effect model" is not an available answer.
4. **Competitor poisoning has no benchmark and no measured defence** (`29 §8`). The architecture bounds the *loss*; it cannot reliably *detect* the poisoning. `36 §9.4` deliberately declines to construct a bespoke test and report a number from it.
5. **T-U1's utterance false-negative rate is unmeasured anywhere** (`07 §11.7`). Mitigated by scope reduction, not by measurement.
6. **Long-trajectory degradation is outside all published evaluations.** The arithmetic — 1,000 steps at 95% monthly reliability requires 99.9949% per step; 3,000 steps at 99.9% yields a 4.9% clean-month probability — shows bounded work units are necessary, not sufficient.
7. **Correlated failure between operating models and the audit reviewer.** `36 §10`'s probe sizes it; nothing solves it.
7a. **The audit plane's inputs still cannot be made fully independent** (v1.1). Its own vendor reads are a large improvement over reading a replica of the audited database. It still cannot audit what never touched a vendor, and **its silence remains indistinguishable from correctness** (`47 §9.2`).
7b. **A coherent adversarial CEO scores well on the counter-metrics designed to catch it** (v1.1). `27 §6`'s churn and calibration metrics detect inconsistency; a consistent, calibrated, patient adversary is rewarded by them. The drift metric shrinks the window and nothing closes it.
7c. **Approval fatigue is the failure mode this architecture is most likely to actually experience** (v1.1, `44 §6`). v1.0 measured approval dwell time and approval-without-inspection rate and connected them to **no state change** — so the architecture detected the failure of its own human control and did nothing. The owner-attention budget (I39) and the two new demotion triggers in `26 §13` are the response, and R16 is DEFERRED, so **the mechanism is designed and not built.**
8. **`m` gross-profit normalisation** (`18 §8` item 4).
9. **Amazon Agent Policy operative text was never retrieved**, and **Meta's policy pages remain the largest platform-shaped hole** in the evidence base. Both are Stage 0 human actions in `21 §9`.
10. **Owner and insider credential compromise is out of scope** (`29 §14`).

---

## 7. The largest risks in this architecture

**Architectural, ranked.**

1. **A second path out.** The entire security argument is that the Effect Gateway is the only one. An adapter with a convenience method, a debug endpoint, a migration script with production credentials, or a vendor SDK's side effect all break it. `36 §7` tests for it; the reviewer should assume the test is incomplete.
2. **Request-construction error — closed by design in v1.1, and now the newest and least-tested component.** v1.0 named this as the most likely money-path bug and then declined to add the component that prevents it. The Effect Canonicaliser (ADR-021) is that component: the kernel enumerates permissible effects, the model selects by index, the kernel computes exposure, parameters, counterparty and FX, and emits the authorisation request and the dispatch payload hashed together. `42 §8.2` enumerates twelve semantic errors it closes. **The risk has moved rather than vanished:** a versioned constructor per action class is the largest single addition in v1.1, its tests must be written against an independently computed fixture table (a test that calls the same function twice proves nothing), and every monetary control in the architecture now sits downstream of it.
3. **Reservation arithmetic under concurrency.** The only place isolation level is a correctness matter rather than a performance one. It is small, hot, and load-bearing for MAL.
4. **Monolith drift, and the withdrawn isolation claim.** Fifteen modules in one deployable degrade into a ball of mud unless boundaries are mechanically enforced. **v1.1 withdraws what v1.0 claimed for the enforcement mechanism.** `33 §6` v1.0 said a module reaching into another's tables *"fails at the database rather than in review"* — but `33 §1`'s decisive transaction spans `authorisations`, `effects`, `exposure_reservations` and `state_facts`, four module schemas, and therefore requires a role spanning them. Either the transaction is impossible or the roles do not constrain the path that matters. The defensible statement: **per-module roles are accidental-coupling detection and SQL blast-radius limitation, not isolation against compromised in-process code.** The `effect_path` role is named and declared the privileged path. Drift detection retains its value; compromise containment was never there.

4a. **The four TCB members v1.0 never named** (v1.1, `49`). CI/CD runs every check that constitutes this architecture's evidence, so a green pipeline is the only artifact anyone sees — **and all three supply-chain incidents `29 §7` cites were build-time compromises while v1.0's rule protected only the runtime.** The migration/DDL principal can alter the audit schema. The cloud database operator sees both sides of the separation EM16 depends on unless the instances are on different accounts. The observability vendors received prompt/completion pairs and exception payloads from credential-holding processes while appearing in no egress table.

4b. **The journal ordering and the split halt** (v1.1). Cross-database atomicity does not exist and is not attempted; what replaces it is a gap-free company-scoped `journal_seq` the audit store can prove it holds all of. A reviewer should attack the five ordering boundaries and the recoverability-class table directly.
5. **Model dependency creeping into the deterministic path.** The replaceability test (`36 §11`) is the guard and it is the test most likely to fail on a first attempt, because the natural drift is for something convenient to acquire a model dependency.
6. **Escalation volume.** `06 §4` puts the human residual at 9–30 h/month scaling with product introductions and platform events rather than orders. If the utterance gate abstains too readily, that number grows and the owner starts approving without reading — which converts an approval control into a rubber stamp.
7. **DBOS immaturity, and a fallback that was wrong.** ADR-002 is PROVISIONAL for this reason. **v1.1 corrects the fallback:** migrating to Temporal moves the checkpoint out of Postgres and destroys R1, the property `33 §1` calls decisive, so v1.0's *"re-hosting rather than a rewrite"* was false and taking that path is an explicit return to Option B. A guarantee failure falls back to an **ACOS-owned Postgres step journal**; Temporal is reserved for the scale and multi-business triggers. ADR-002 also listed a hand-rolled journal as an alternative and never evaluated it, which is why S1 spikes both.

8. **The `refundCreate` `@idempotent` deduplication window is unmeasured** (v1.1). Its key scope and window are undocumented in this package, and if the window is shorter than the reconciler's resolution latency it does not cover the case it is relied on for. v1.0 asserted the layer was *"real rather than aspirational"* on the strength of an annotation.

9. **Escalation recall on non-text-borne triggers was 100% false-negative** (v1.1, `44 §3.1`). The detectors are lexical checks on inbound text; a DSAR as a PDF, a legal threat photographed, a chargeback notice forwarded as an image, a product-safety complaint in a voice note — none reached a detector, and `23 §7`'s zone rule foreclosed the obvious fix. Bounded by forcing any non-text part to T-U2, and by a typed `red_class_signal` from Z4 to Ingress. **`47 §10`: if no detector can be made to fire on a non-text-borne RED-class trigger, autonomous customer communication is out of scope for the first business.**

**Business, restated because architecture cannot fix them.** CPA; platform identity loss (which MAL explicitly does not bound); IP asset freeze as a working-capital event; the 4.8×–12.8× platform-attribution overstatement making the most available optimisation signal untrustworthy; and pass^k consistency not having improved between 2024 and 2026 despite capability gains.

---

## 8. Implementation boundary

**No production code was written, in v1.0, v1.1 or v1.2.** The package contains architecture documents, decision records, mermaid diagram sources, a remediation ledger, an invariant registry and analysis. `31` selects technologies and `37` sequences slices, but nothing is implemented, no schema is created, no repository is initialised, and no vendor account is provisioned.

**The v1.1 decision was READY FOR NARROW SECOND RED TEAM.** Five items were re-designed rather than merely re-worded and had not been attacked in their new form: R1 (the Effect Canonicaliser), R2 (`StandingAuthorization`), R3 (journal ordering and the split halt), R8 (the four authorised-loss quantities), and R9 combined with R17-P4 (kernel-state approvals with verify-mode resume, and the rewritten counterparty property). That review was performed and returned CONDITIONAL PASS with **zero FATAL and 22 BLOCKING** findings, all 22 of which are applied in v1.2.

**The v1.2 decision is READY FOR NARROW THIRD RED TEAM.** Not ready to implement. **Two mechanisms** are new in their present form and have never been attacked: **Mechanism A** — the `JournalAttestation` and inverted three-state mirror machine (SR-A1, SR-A2), which turns the audited party's own degradation declaration into a self-penalty and is the single most novel construction in the package; and **Mechanism B** — the five-state `StandingAuthorization` with cessation-verified release and the `StandingRevocationAuthority` (SR-S2, SR-S3), which holds forward exposure in four of five states and creates a kernel-issued authority that outlives the grant it derives from. `phase2-v1.2-third-redteam-brief.md` is scoped to exactly those two and to nothing else.

**One v1.2 deviation from the authoritative remediation spec is flagged for that review.** `57 §2` SR-S4 specifies forward exposure as `rate × remaining_periods × (1 + overdelivery_allowance)`. That form still fails the constructed day-2 attack in a 31-day month. v1.2 uses the **exposure-remainder** form instead (`26 §10.1`), which does not. The substitution is deliberate, is recorded in `phase2-v1.2-remediation-ledger.md` under SR-S4, and is question B8 of the third brief.

The MVP defined in `37` deliberately has no real money, no real customers, no real advertising, no real supplier orders, and no browser automation. Its purpose is to prove nine spine properties, not to trade. **v1.1 adds a Stripe test-mode account, a development-store payout and a synthetic bank line**, because v1.0 excluded a processor adapter and thereby proved property 6 against a single source.

One cross-dependency to flag: **`37 §6` places S3 (financial truth) on the critical path for Stage 2**, because Stage 2 measures incremental CAC against contribution margin and cannot produce a trustworthy number without K6. If schedule pressure forces a choice, S3 is protected — and in v1.1 the CEO slice it competes with is largely deferred anyway.

---

## 9. Questions for the red team

Specific enough to be actionable. Answering "the architecture handles it" is not a finding; showing the path is.

**v1.1 annotates each question.** ✅ = answered by v1.1 and the answer is in the package. ↻ = re-aimed, because v1.1 changed what the question should target. ✱ = new in v1.1. Unmarked questions stand as written.

**On the chokepoint.**
1. ↻ Find a second path to an external state change **that is not already in `48`**. `42 §1` found six; the perimeter artifact and its CI check (I24) are the answer, and `46`'s closing note is explicit that the enumeration **will** be incomplete. The interesting finding is a class of path the CI check cannot see.
2. ✅ *Can a proposal's parameters carry an instruction that changes adapter behaviour in a way the action class does not describe?* — **Closed.** The intent has five fields and none of them is a parameter; the adapter receives the kernel's `dispatch_payload` verbatim (I21, ADR-021). **Attack the constructor instead** (question 3).

**On authority.**
3. ↻ **Construct a canonical constructor that computes the wrong exposure.** v1.0's version of this question was about a model populating `exposure` with a unit price; that path is closed. The live version is: find an action class whose exposure has a cost component the constructor omits — a retained processor fee, freight, a compensator's own cost, an FX spread, a tax treatment — such that the reservation is smaller than the settled cost. `42 §8.2` lists twelve; find a thirteenth.
4. Find an action class that should exist and does not, such that its absence forces a permissive workaround under operational pressure.
5. ↻ Can two concurrent proposals each observe the same reservation headroom? **Consider specifically: the standing-authorisation window-boundary re-reservation racing an ordinary reservation, and an approval resumed in verify mode against a reservation that has been partially settled.**
6. Is there an irrecoverable action that is not classified as one? **And is there an order-driven irrecoverable action misclassified as discretionary, or vice versa?** The second is new: exhausting the discretionary counter must not stop order fulfilment (I30).
7. ✱ **Break the four-quantity ceiling.** Given `51-limits-fixture.md`, construct a live grant set whose realisable authorised loss exceeds the displayed `MAL_total` without I7's CI check failing. v1.0's table contained three such constructions and I7 was never run against it.
8. ✱ **Make the split halt cause a statutory breach or an unaudited irrecoverable effect.** `30 §5.1`'s table is the target. Both directions are interesting: an FTC clock expiring because a class suspended, and an irrecoverable effect dispatching with only a local chain behind it.

**On the evidence and grade system.**
9. Find a path by which model-authored content reaches RECORD grade. **`40` failed at this repeatedly; the two paths that existed were `DECISION` within delegated authority and an adapter's self-computed content hash, both closed (I28, I26).**
10. ↻ Find a promoter rule whose named condition can be satisfied without the underlying fact being true. The carrier-scan promoter is still the obvious target, **and promoter rules are now control artifacts (I19), so also attack the rule set's integrity rather than only its logic.**
11. Can absence of evidence be made to look like evidence of absence anywhere in the decision path?
12. ✱ **Find a second REC-01.** A compromised adapter writes RECORD-grade facts that satisfy the preconditions of an authority its own credential does not reach. I27 closes the commerce→advertising path specifically; the general shape is open and adapters are TCB members for it.

**On the CEO and audit.**
13. ↻ Can the CEO influence the adverse-facts appendix? **The threshold set is now an owner-signed control artifact (I38) and the appendix is served from the audit plane's own endpoint.** The live version: find a fact that is materially adverse and that no deterministic rule in the set will classify as such.
14. ✅ *Can the audited system delay or degrade the audit path without halting effects, given `36 §6` mandates halt?* — **The premise is gone.** v1.0 specified two mutually exclusive behaviours in documents of equal standing; v1.1 specifies split halt by recoverability class. See question 8.
15. ✅ *Is the memoryless claim actually true?* — **No, and v1.1 says so.** ADR-008's claim is now *"no private or ungoverned memory"*. The live version: find a persistent CEO-authored object that is **not** graded, provenanced, expiring and ratified.
16. ✱ **Defeat the completeness diff.** Omit journal rows such that the two-sided diff over `journal_seq` and the hourly `{head_hash, chain_seq, row_count}` anchor both pass. Head-only anchoring could not detect tail truncation; find the residual.

**On the utterance gate.**
17. Construct a prohibited commitment that passes the closed grammar. **`44 §2.1` produced six; T-U1 is deferred as a result. The live target is T-U0: produce one from approved templates and RECORD-grade slots.**
18. ↻ Find a T-U0 template whose slots can be filled to produce a materially misleading statement from individually accurate records. **`44 §1` found four mechanisms — staleness, composition, an unpoliced corpus, promoter error. Three are closed (I35, I34, I19). Find a fifth, or defeat one of the three.**
19. ↻ Can an escalation detector be evaded by a message that clearly warrants escalation? **The non-text-borne answer was yes at 100%, and is bounded by forcing T-U2. The live version is natural adversarial phrasing on text-only inbound, which is unmeasured.**

**On the architecture as a whole.**
20. Is Option A wrong? Specifically: is there a scenario in the first eighteen months where the monolith's single blast radius or vertical ceiling causes a loss larger than the distributed-reservation bug risk Option B introduces? **`47 §3` endorses Option A; a reviewer who disagrees should engage that endorsement.**
21. ↻ Does the four-business-model test in `33 §9` pass honestly? **v1.1 already concedes it does not pass in v1.0's strong form** — two kernel changes were forced by two of the columns. Find a third.
22. Which of the seventeen EM constraints is actually violated somewhere in `22`–`38` despite the claim that none is? **Three claims about EMs were false as written (EM9, EM16-versus-EM15, EM17); `22 §3.1` records them. Find a fourth.**
23. ↻ What is in `37 §4`'s exclusion list that should not be? **v1.1 reversed one — the payment-processor adapter — on `45 §4`'s finding. And attack the five *deferrals*, which are a different claim: each asserts that the deferred thing proves nothing the remaining slices do not.**
24. Where has an ESTIMATE been treated as a FACT? **v1.1 tagged two undeclared instances (`33 §7`'s infrastructure cost, `26 §13`'s promotion thresholds) and introduced one deliberate `[ESTIMATE]` inside a displayed ceiling (`MIE_cost`). Find an untagged third.**
25. ✱ **Find a test in `36` that still validates a production function by calling it.** `47` found seven; `36 §0` names a separate oracle for each. An eighth is a real finding, because a gate that agrees with itself is how a wrong specification ships.
