# 37 — ACOS MVP and Implementation Sequence

**ACOS Operating Spine v1.3. Version 1.3. Issued 2026-09-03. Supersedes v1.1 (2026-09-02).**
Covers Phase 2 brief Part 28. Depends on `33`, `34`, `36`. Constrained by `21 §9`, constitution `28`, and `45 §9`.

## v1.3 change record

§5's superseded standing basis corrected (TB-09); S1 records that `I8` proves nothing against mock adapters. Full disposition in `phase2-v1.3-remediation-ledger.md`.

## v1.1 change record

| Change | Remediation | Section |
|---|---|---|
| **Slices rewritten** per `45 §9`. S1 gains the Effect Canonicaliser, `StandingAuthorization`, named windows, the journal sequence and the DBOS-versus-step-journal spike, and **loses symcc** as a completion gate. | R1, R2, R14, R18, R19 | §2 |
| **S3 gains a payment-processor adapter (Stripe test mode), a development-store payout and a synthetic bank line** — v1.0 proved property 6 against a single source. | R10, R19 | §2 |
| **S4 builds T-U0 only.** T-U1 is deferred. The outbox, the non-text rule and control-artifact protection land here. | R12, R13, R19 | §2 |
| **S5 uses a deterministic briefing generator.** The model-backed CEO is deferred. | R15, R19 | §2 |
| **S2 loses the research-with-citations worker.** Property 2 is proved by the triage worker plus the harness. | R19 | §2 |
| **§5 is replaced by a pointer to `51-limits-fixture.md`.** v1.0's table contained arithmetic that contradicted its own MAL — a $40/day ad ceiling is $1,200/month against a stated $600, and a $25 per-action refund at 20/day is $15,000/month. | R8, R14 | §5 |
| §3's invariant subset is replaced by the registry's MVP set. | R20 | §3 |
| §4's exclusion of a payment-processor adapter is **reversed**; new exclusions and deferrals are listed explicitly. | R10, R19 | §4 |
| §7 gains the three falsification conditions from `46 R19`, and the DBOS row's fallback is corrected. | R18, R19 | §7 |
| `propose_effect` → `propose_intent` throughout. | R1 | §2 |

---

## 1. What the MVP is for

**The MVP exists to prove the spine, not to run a business.** `21 §9` authorises Phase 2 to run *in parallel with Stages 0–2, on the spine only*, and `21 §5` forecloses choosing a business model. So the MVP has no products, no customers, and no advertising spend. It has a Shopify development store, a synthetic order stream, an adversarial message stream, **a Stripe test-mode account and a synthetic bank statement**, and real money nowhere.

The nine properties it must demonstrate:

1. No LLM is the last component before an irreversible external effect.
2. A fully compromised model cannot move money, egress data, or emit a prohibited commitment.
3. Authority is enforced by code the model cannot reach, and the money-bounding properties are proved in CI.
4. Exposure reservation, authorisation and effect journaling commit atomically, and reservations hold across an approval wait.
5. A completed workflow step is never re-executed on resume.
6. Financial truth computes with no model in the path.
7. Company state is graded, append-only, bitemporal, and grade is derived from writer identity.
8. The audit record cannot be altered or suppressed by the audited system, and the CEO cannot omit adverse facts.
9. The control plane operates fully with all model providers unreachable.

**v1.1: three of the nine are proved differently, and one is proved for the first time.**

- **Property 3** was proved in v1.0 by symcc over the policy set — *"given a request"*, while the request's amount arrived from the model. The Effect Canonicaliser is what makes property 3 a statement about the right object, and it is why symcc's deferral costs less than the canonicaliser's absence would (`45 §7`).
- **Property 6** was proved against a **single source**: v1.0 excluded a payment-processor adapter, so the settlement equality check — the terminal financial control — had nothing to tie. S3 adds a processor and a bank line.
- **Property 8** was **not proved at all** in v1.0's audit design: the chain established integrity of rows present and there was no invariant asserting control-to-audit correspondence, no specification of who computed the hashes, no anchoring cadence, and the audit plane's only inputs were rows the audited plane wrote. I17, I17b, I17d and I8 are what prove it.
- **Property 4** additionally required `StandingAuthorization`: a rate-based authorisation's exposure was not reserved at all, so "reservations hold" was true of amounts and false of rates.

If the MVP demonstrates these nine and nothing else, it has succeeded. If it processes a real order beautifully and fails property 4, it has failed.

---

## 2. Slices

Seven slices, each ending in something attackable. **The ordering is deliberate: the effect spine and the untrusted ingress come before anything that resembles a business capability**, because every later slice's safety is an argument about S1 and S2.

**v1.1: the slices are rewritten per `45 §9`, and the shape of the change is consistent.** Four capabilities are **added** — the canonicaliser, standing authorisations, the processor/bank line, the outbox — and four are **deferred** — symcc, the research worker, T-U1, the model-backed CEO. Every addition closes a defect in a property the MVP claims to prove; every deferral removes something that proves nothing the remaining slices do not already prove. Net scope is roughly flat and the proof value is materially higher.

### S1 — Effect spine skeleton

**Build.** Postgres with append-only bitemporal `state_facts`, `effects`, `authorisations`, `exposure_reservations`, `decisions`, and a **company-scoped gap-free `journal_seq` with a local chain computed by a control-DB trigger**. K4 Effect Gateway with **`propose_intent(ProposedIntent)`** as the sole write capability. **The Effect Canonicaliser** with a versioned constructor per action class, emitting the `AuthorizationRequest` and the `dispatch_payload` hashed together. K3 Cedar in-process. K5 exposure ledger with **named company-scoped windows**, money, split irrecoverable counters, and **`StandingAuthorization`** with forward exposure and mandatory expiry. DBOS Transact workflows. Closed action catalogue with exactly three classes: one REVERSIBLE, one COMPENSABLE, one IRRECOVERABLE, all against a mock adapter — **plus one rate-based class against a mock, because a rate cannot be tested with an amount**. Separate audit Postgres **on a separate account** with insert-only grant under quota, its own trigger-computed chain, and the two-sided completeness diff.

**Prove.** Properties 3, 4, 5, 7. Specifically:

- **Canonical effect equality** (**I18a–I18d**, v1.2 — I18 retired) against a **hand-computed fixture table** independent of the production constructor, per class and per enumerated option, **including VC-C1's negative case**: a $25.00 line refund carrying a $1.03 retained fee must deny `PER_ACTION` against a $25.00 cap.
- **I21 as a type-level property** — a test constructing an `AuthorizationRequest` from any non-permitted `ProposedIntent` field must not compile.
- **v1.2 — `enumerate_effects` and content-addressed selectors** (VC-C2, VC-C3). Enumeration is a journaled, `context_spec`-filtered, rate-limited READ capability; the reordering fixture denies `SELECTOR_STALE` and dispatches nothing; out-of-range and downstream denials are indistinguishable at the worker.
- **v1.2 — `ACOS-JCS-1` cross-implementation byte-identity** (VC-A3) and **`JournalAttestation` at 5 minutes with k=3** (VC-A1). Both are S1 because both are properties of the journal S1 builds, and neither can be retrofitted onto a chain already in use without a re-anchor.
- **v1.2 — the three-state mirror machine** (VC-A2), including the Path B fixture: a unilateral degradation declaration must make the system **stricter**.
- **v1.3 — the adversarial-attester negative control** (VC-A1d, TA-01). Truncate the push **and** adjust the attestation to the frozen prefix; assert `I17e` does **not** fire. **A run in which it fires is a failure.** The control exists so the suite states its own blind spot.
- **v1.3 — dispatch→tag detection** (VC-A2c, TA-04), the **corroboration-signal contract** including the reachability assertions (VC-A2d, TA-06), and the **override with its composition bound** (VC-A2e, VC-A2f, TA-05, `I63`).
- **v1.3 — the four-term commitment guard and realised/standing atomicity** (VC-L2, VC-S8, TB-01, TB-04), both interleaving orderings with the mandatory `REPEATABLE READ` negative control, and the financial-truth assertion that an over-ceiling realised figure **is written** and raises `WINDOW_CEILING_BREACHED` / `STANDING_OVERDELIVERY` rather than being refused.
- **v1.3 — the standing lifecycle corrections**: the `I62` transition trigger with `REVOKED → EXPIRED` required to fail (VC-S2, TB-06); the cross-boundary instance case (VC-S5, TB-02); attribution authored independently of both the rule and the derivation (VC-S6, TB-05); and **the first `campaign.budget.set` in a clean window asserting PERMIT** (VC-S7, TB-03).

**v1.3.4 (SEQ-01, S1I-C7): the generic outbox and claim foundation moves from S4 into S1, and the adapter half stays at S4.** S4's Build list named *"the ACOS-owned outbox"* as one item covering four separable things. **The mechanism is a precondition for safely enabling any real external dispatch** — a slice that builds transport before an at-most-once claim exists has a window in which a crash duplicates an irrecoverable send, and that is the exact window ADR-026 was raised to close. The split is:

**S1 — the ACOS-owned durable outbox foundation:**

- the ACOS-owned durable outbox schema, with its two-state machine (`25 §7`);
- the immutable authorised payload snapshot, bound to the committed `dispatch_payload_hash`;
- the provider-visible correlation tag, minted locally;
- deterministic enqueue and enqueue recovery;
- the **exclusive, non-reclaimable claim**, taken against current claim-time authority state;
- the crash-before-HTTP proof, against real PostgreSQL.

**S1 — the ACOS-owned local execution semantics, against a deterministic in-process mock (v1.3.5, SEQ-02):**

- the **adapter port and Effect Gateway boundary**, with no adapter, no HTTP client, no vendor SDK and no credential under production code;
- **`26 §7` step R's irrecoverable-unit reservation** at local authorisation, into `reserved_irrecoverable` on every applicable MIE window instance (`25 §10.1`, MIE-01);
- the **closed adapter outcome taxonomy** and its recoverability-keyed local states (`25 §7.1`, OBX-04);
- the **`reserved → presumed` MIE movement at `PRESUMED_EXECUTED`**, atomic with the effect state, the outcome state and the outcome journal row, with its kill-point matrix against real PostgreSQL;
- **`NOT_SENT_CONFIRMED` and the terminal `DISPATCH_NOT_SENT_CONFIRMED`**, with its commitment release (`25 §7.2`, OBX-05);
- the **two serialization epochs and mandatory dispatch-time revalidation** (`25 §14.1`, SER-01), with the async-gap staleness proof and the dispatch-epoch mutation-exclusion proof against real PostgreSQL;
- the **`acos.journal.dispatch_outcome.v1`** row kind, cross-implemented in both planes against a third independent oracle (`30 §5.3a`, JCS-03).

**S1K — THE PRE-LIVE CONTROL-ARTIFACT INTEGRITY GATE (v1.3.6, SEQ-03, `S1K-C1`..`S1K-C10`):**

**BEFORE THE FIRST REAL EXTERNAL VENDOR CALL, ACOS MUST HAVE:**

- **externally rooted owner signature verification** — `50 §3a`'s two provisioned Ed25519 public keys, with no trust-on-first-use and no caller-supplied key;
- **second-factor verification** — a second, distinct Ed25519 approval signature on every artifact (`50 §4`);
- **signed manifest set integrity** — `50 §3d`'s dual-signed manifest core with `50 §3e`'s deployment-pinned active manifest identity;
- **a verified class-3 action catalogue** (`50 §2a`);
- **a verified class-20 `ACOS-JCS-1` specification artifact** (`50 §2b`);
- **a verified class-27 degraded-mode configuration** (`50 §2c`);
- **signed Cedar policy / `O4` verification** before the engine is constructed (`50 §2e`);
- **runtime verified-bundle gating as `I19` requires** — bootstrap before READY, verification before publication, and a `VerifiedControlArtifactBundle` capability as the only authority-consumer surface (`50 §3f`);
- **the migration of classes 3 and 27 off duplicated unsigned production literals onto the verified bundle** (`50 §3f`).

**This is the S1K PRE-LIVE GATE, and ONLY this subset moves forward from S4.** `37 §2`'s S4 Build list previously carried *"`50-control-artifact-manifest.md` with owner-signed hashes across all sixteen classes (`I19`)"* as one undivided item at S4. **The pre-live subset is pulled forward because the mechanism is a precondition for safely enabling any real external dispatch**: the action catalogue decides what may be dispatched and how many irrecoverable units it costs, the degraded configuration decides whether it may be dispatched at all, the Cedar bundle decides whether it is authorised, and an unsigned literal deciding any of those at the moment a real vendor call becomes possible is the window this gate exists to close. **This is the same shape as SEQ-01's and SEQ-02's arguments, one level up.**

**WHAT DOES NOT MOVE FORWARD, AND STAYS AT S4 OR LATER:**

- **external anchoring / `I17b`** — an **S3** deliverable, and it is **NOT** the bootstrap root of trust for S1K. `50 §3e`'s deployment pin is what rejects a rollback; the anchor may later add historical and non-repudiation protection, and adds none of it here. **S1K does not depend on `I17b` and must not be made to;**
- **owner-signed hashes across the remaining classes** — classes 1, 4–16, 18, 21–23, 25–26 enter the manifest when their consumers do (`50 §6`);
- **the later owner briefing**, the unrelated S4 audit mechanisms, and **provider reconciliation**;
- **class 19's migration onto the same externally provisioned roots** (`50 §3i`) — declared future work, not a pre-live blocker.

**NO PRODUCTION SIGNING CODE EXISTS AT v1.3.6.** This entry is the sequencing declaration the S1K runtime slice implements against; the architecture pass that issued it implemented no key, no signature, no manifest loader, no verification and no runtime `I19`.

**LATER EXECUTION / ADAPTER SLICE — everything that needs a vendor:**

- the real adapter and the HTTP or vendor-SDK call;
- provider idempotency headers and the provider query primitive;
- the **provider-evidenced MIE resolution** — `presumed → realised` at `VERIFIED`, and the presumed release at a proven `NEVER_SENT` (`25 §10.1`);
- the provider sandbox, delivery-event reconciliation, `VERIFIED` and `NEVER_SENT`;
- `I36`'s declared verification — the six kill points of `44 §5.2` against a **real ESP sandbox**, measured by the provider's own accepted count — and `I20`.

**The split is between LOCAL SEMANTICS and PROVIDER TRUTH, and v1.3.5 moves only the first (SEQ-02).** v1.3.4's SEQ-01 assigned *"the unknown-outcome runtime transition and `PRESUMED_EXECUTED`"* and *"MIE consumption at the execution/outcome point"* to the later slice as a single undivided item. **Both have a local half that needs no vendor and a resolution half that needs one**, and the local half is a **precondition** for enabling any real send: an implementation that reserved no irrecoverable unit and had no declared consumption would have nothing for a provider's accepted count to be bounded against. So the reservation, the state transitions, the ledger movement, the release and the serialization protocol land at **S1**, against a mock; **the provider query, the webhook, the reconciliation, `VERIFIED` and `NEVER_SENT` stay later.** This is the same shape as SEQ-01's own argument one level down.

**A MOCK'S ACCEPTANCE COUNT IS NOT A PROVIDER ACCEPTED COUNT.** `I20`'s left-hand side is *"provider-reported accepted"* and it is the **audit plane's** own independent provider read. **No local quantity may be substituted for it** — not an outbox row count, not a claim count, not an outcome row count, and not the number of times an in-process mock reached its own acceptance point. **`I20` remains OPEN after S1**, and what S1 makes true is only that its right-hand side — the historical committed reservation basis — is structurally present.

**`I36`'s enforcement leg therefore lands at S1 and its verification leg stays at S4.** The registry's enforcement column is *"DB (state machine constraint)"*, which S1 builds and can prove; the verification column requires a provider's accepted count, which S1 cannot produce and does not claim. **An outbox row count is not a provider accepted count**, and S1 asserts no external exactly-once property. **v1.3.5 adds the local composition — the gateway, the outcome taxonomy and the MIE movement — to the enforcement leg, and moves nothing to the verification leg.** The six kill points of `44 §5.2` are exercised at S1 **against the mock**, which proves the ACOS-side state machine and proves nothing about a vendor; **the real-provider six-kill-point validation remains OPEN.**

**And one thing S1 explicitly does not prove** (v1.3, TA-02). **`I8` proves nothing at S1.** All four action classes run against mock adapters, so there is no vendor side for the inverse sweep to enumerate. `I8` is the only detector for `30 §5.5` cases 2b and 4 — the frozen attested prefix and the omit-before-attesting case — so **at S1 those two residuals have no operative detector at all.** `I8` becomes real at S3 against sandboxes and at T3 against real accounts, and its detection bound is `sweep_cadence + vendor_reporting_lag` with the second operand measured at S3 (`62 §10` obligation 8). v1.2's S1 scope did not say this and a reader could have taken the S1 audit gates as covering source completeness. They do not.
- **Selector rejection**: a class with no constructor denies as `NOT_CANONICALISABLE`.
- **Reservation concurrency with a mandatory negative control** at `REPEATABLE READ` that must fail, using targeted interleaving with injected delays rather than load.
- **Standing re-reservation**: a window boundary that cannot be reserved **pauses** rather than continues.
- **Kill-and-resume** at every checkpoint, and the **approval-resume path in verify mode** (kernel-state approvals, new workflow, no re-reservation).
- **The DBOS-versus-step-journal spike** (`31 §3.3`) on the same kill-point matrix. ADR-002 listed a hand-rolled Postgres step journal and never evaluated it; on this project's own criteria it is a serious contender, and the outbox is ACOS-owned code either way.

**Deferred out of S1:** the symcc proof gate. `45 §3`: with three action classes the policy set is hand-checkable, and the complexity budget belongs to the canonicaliser. Recorded as a formal amendment to `11 E6` in `28 §9.2` — **not moved silently**, because `45 §3` is explicit that quietly moving a pre-registered gate is the goalpost move the constitution prohibits.

**v1.2: and the substitute is now actually complete, which is what the deferral rests on** (SR-R2, `56 §3.3`). The deferral's justification is not that hand proof is adequate in general; it is that hand proof over a *small, fully covered* catalogue is adequate. v1.1's hand proof covered **eleven of nineteen** classes and omitted two the fixture actively grants — so the justification did not hold. `26 §11.2` now covers **22 classes with five explicit exclusions and a P6 reachability column**, CI-enforced at one row per catalogue class (I59). **A new action class cannot be added without a `value_direction` and a proof row**, which is what keeps the substitute complete as S1 grows rather than only at the moment it was written.

### S2 — Untrusted ingress and bounded reasoning work

**Build.** K15 ingress with webhook dedup, HMAC verification, and untrusted-at-zero-authority stamping. K7 work orchestrator with `context_spec` assembly, token and step budgets, and a queue-level spend ceiling below the provider tier cap. **One** reasoning worker: **customer-message triage**, stateless, credential-free, one write capability, behind an egress allowlist. K8 evidence store with retrieval snapshots. The injection harness from `36 §9.1`. **The external-write perimeter artifact (`48`) and its CI check** (I24) — every vendor call site carries an `authorisation_ref` or an annotated `PERIMETER_EXEMPT`. **`webhook.subscription.assert`/`.delete` as governed effect classes** with `callbackUrl` from configuration, never from a parameter.

**Prove.** Properties 1, 2. The harness scores effects outside authority, money moved, irrecoverable actions, prohibited utterances and egress — **each reported with attempts, attacker budget, adaptivity and corpus provenance**, because a zero with no denominator is not a measurement.

**Deferred out of S2:** the research-with-citations worker. `45 §9`: property 2 is demonstrated by the triage worker plus the harness, and the evidence store's fabrication and false-closure checks are a **Stage 1** deliverable (`11 E8`) rather than an MVP property. Two workers do not prove containment twice.

### S3 — Financial truth, models offline

**Build.** K6 **split into finance ingest (credentialed, integration plane) and finance computation (no credential, no model client, both CI-checked)**. Settlement equality with three states only, contribution margin with the exact/blended labelling, cash, runway scenarios, both ceilings stored separately with `m`'s denominator basis explicit. Commerce adapter against a Shopify development store, read paths first, **with the parser split — raw response retained by the control plane, versioned parser derives the fact** (I26). **A payment-processor adapter against Stripe test mode using restricted keys.** **A development-store payout** and **a synthetic bank statement fixture.** The three reconcilers from `25 §8`, with **reconciler resolution as a governed effect class** reusing the original authorisation and idempotency key. Discrepancy objects with owners and clocks. **The audit plane's own read-only vendor credentials**, its **own read endpoint on its own host**, the **inverse sweep run from those reads** (I8), and **hourly anchoring of `{head_hash, chain_seq, row_count}`** (I17b).

**Prove.** Property 6 — **against three sources rather than one.** `45 §4` identifies v1.0's exclusion of a processor adapter as the one exclusion in §4 that was wrong: without it, the settlement equality check tied nothing, and *"financial truth proved by comparing one system to itself is not proved."*

**Also prove.** The `refundCreate` `@idempotent` key scope and deduplication window, **empirically**. Until this runs, the fourth idempotency layer's strength is unverified.

### S4 — Utterance gate

**Build.** **T-U0 only, and T-U2 for everything else.** T-U0 template engine with slots bound to RECORD-grade state, **each slot carrying its own `max_age` with `staleness_policy=BLOCK`** (I35). **Canonical locale rendering** as a control artifact — ISO 4217 codes always, unambiguous dates, per-currency precision, rejection of bidi and zero-width characters, failure-to-render on an empty optional slot. **The prohibited-commitment grammar run against the template corpus in CI**, matched on the **rendered** form after NFKC and confusable folding, and evaluated over the **rendered thread** (I34). **A deterministic tier floor the model may only raise.** All ten escalation detectors, running before any generative call, **plus the structural and behavioural triggers**. **Any non-text part forces T-U2, unconditionally**, and Z4 emits `red_class_signal` to Ingress. **The vendor half of the ACOS-owned outbox** — the recoverability-keyed unknown-outcome policy, `PRESUMED_EXECUTED`, delivery-event reconciliation and `I36`'s six-kill-point verification against the real sandbox (I36, I20). **The outbox schema, the at-most-once `CLAIMED` transition and the provider-visible correlation tag are built at S1** (v1.3.4, SEQ-01) — the claim is a precondition for enabling any real send, not a consequence of it. **`50-control-artifact-manifest.md` with owner-signed hashes across the REMAINING classes** (I19). **v1.3.6 (SEQ-03): the PRE-LIVE SUBSET — the trust roots, the signature envelope, the dual-signed manifest core and its deployment pin, classes 2, 3, 20 and 27, and the runtime verified-bundle gate — IS PULLED FORWARD TO S1 and is listed there.** What remains at S4 is the extension of the signed set to the classes whose consumers arrive at S4 and later. **The pre-live gate is sequenced BEFORE the first real vendor call; the rest of this item is not.** Communications adapter against a **real ESP sandbox** — **to a controlled internal address only.**

**Prove.** Property 2's utterance half, and the outbox's six kill points measured by the **provider's own accepted count**.

**Deferred out of S4:** T-U1. ADR-015 and `26 §9.6` narrow it to twelve structural conditions; `44 §2.1` shows a closed lexical grammar admits commitments carried by implicature. T-U0 plus escalation proves the property; T-U1 adds fluency, and fluency is what carries implicature.

### S5 — Briefing, approvals, escalations

**Build.** **A deterministic briefing generator** over the same assembled snapshot, with the **audit-plane-computed adverse-facts appendix** and the hash match that gates publication (I45). K9 approval semantics with signatures, expiry, **kernel-state persistence and verify-mode resume**. K10 escalations with statutory clocks and decision-ready bundles, **including the audit-plane "uncited and contradicting evidence" section** (I40) and the AI-drafted recommendation **placed last**. Owner interface: the nine views and three write actions, **fetching the briefing from the control plane and the appendix and findings from the audit plane, and diffing them client-side**. **Per-cause escalation caps.**

**Prove.** Property 8. The mechanism that proves *the CEO cannot omit adverse facts* is the **deterministic diff**, and a deterministic generator exercises it fully.

**Deferred out of S5:** the model-backed CEO, its single direct effect class, the objective-drift metrics and the multi-invocation compromised-CEO test. `45 §3`, `47 §8`: the model adds narrative, not proof, and it is the largest source of MVP-stage prompt surface in a slice whose purpose is to validate a governance mechanism. `27 §2.0` names the trigger.

### S6 — Audit plane completion and autonomy ledger

**Build.** The **MVP invariant set** as continuous checks — the 57 identifiers in `phase2-v1.3-invariant-registry.md §2.7`. The four audit classes. K13 experiment registry with frozen hashed pre-registrations. K12 metric layer with explicit denominators, freshness stamps and **metric computation specs as control artifacts**. **Platform-cap polling** from the audit plane's own credentials (I33). **The continuous prohibited-class credential probe** (I15) against sacrificial resources.

**Deferred out of S6:** K14's agent profile registry and the per-tuple autonomy ledger, with the model-backed CEO (`45 §3`). I47 lands with it. This is honest rather than convenient: `26 §13` concedes no published model meets pass^4 ≥ 90% on the nearest analogue, and **no capability is expected to promote during the MVP** anyway.

### S7 — Adversarial validation and the first irrecoverable path

**Build.** Nothing new architecturally. Run `36` end to end: the adaptive human red team, the compromised-agent tests **including the compromised-adapter-escalates-into-another-authority scenario** (`35 §12.2`), the correlated-failure probe, chaos with **targeted interleaving rather than 10× load**, and one real outbound send to a consenting recipient with the full gate and the outbox in place.

---

## 3. Component inventory at MVP

**One Postgres schema set** across fifteen module schemas, **with the `effect_path` role spanning five of them** — `authorisations`, `effects`, `exposure_reservations`, `state_facts`, `journal` — declared the privileged path, because `33 §1`'s decisive transaction requires it. **One separate audit Postgres, on a separate provider or account.**

**Eleven logical services** in one control-plane deployable: ingress, work, effects (**including the Effect Canonicaliser**), authority, exposure (**including standing authorisations**), state, evidence, decisions, escalation, finance **computation**, metrics. (Experiments arrive in S6; profiles are deferred; the audit plane is a separate deployable **with its own read endpoint**.)

**Four adapters:** commerce (Shopify development store, Admin GraphQL), communications (**real ESP sandbox**, controlled address), **payment processor (Stripe test mode, restricted keys)** and **finance ingest** (provider cost APIs, development-store payout, synthetic bank line). A mock ad adapter and a mock rate-based class for S1. **v1.1: the exclusion of a payment-processor adapter is reversed** — property 6 cannot be proved against a single source.

**One reasoning task type:** customer-message triage. v1.0 had three; the research worker is deferred to Stage 1 where its acceptance criteria live (`11 E8`), and the model-backed CEO is deferred with its slice. **One is the minimum that exercises the containment argument, and containment is what the MVP proves.**

**The MVP invariant set is the 57 identifiers in `phase2-v1.3-invariant-registry.md §2.7`**, mapped there to the nine properties in §1 plus the tenth grouping the registry adds (`10 — a safe denial leaves no orphaned obligation`). v1.0 listed six under a numbering that matched neither `30 §6.1` nor `35` nor ADR-013 — its "`I1` chain integrity" is I41 here, its "`I3` no dispatched effect without authorisation" is I1, its "`I4` idempotency uniqueness" is I42, its "`I6` no stale `OUTCOME_UNKNOWN`" is I9, its "`I7` tolerance-rule temporality" is I12, and its "`I9` `context_spec` compliance" is I43. **Six citations, six wrong numbers**, which is why the registry exists.

**One attack harness**, standing, expanding continuously.

**One credential model:** per-adapter vendor secrets in the platform secret manager, per-adapter runtime and dependency isolation, no broker component (ADR-024).

---

## 4. Explicit exclusions

Not built, and their absence is a decision rather than an omission. Constitution `28`: do not design a multi-store autonomous empire before one business proves the core model.

- Multi-store, portfolio management, cross-company workers, any portfolio leadership role. (`company_id` is present everywhere; nothing consumes it.)
- Real advertising spend, real customers, real supplier orders, real payment **movement**. (**v1.1: a payment-processor adapter in test mode is now in scope** — the exclusion of one was the single wrong exclusion in v1.0's list, because it left property 6 proved against a single source.)
- Marketing automation, email lifecycle, SEO tooling, content pipelines.
- Any product-specific pipeline: sourcing, listing generation, merchandising, pricing.
- Image or video generation.
- **Browser automation, anywhere, for anything** (EM10, ADR-014).
- Multi-agent research swarms, agent debate, agent-to-agent channels of any kind.
- Any UI beyond the nine read-only views plus approve, deny, and revise-then-approve.
- An opportunity-discovery algorithm (ADR-020).
- Tax filing, dispute representment, review generation — all categorical prohibitions.
- **A credential broker component** (ADR-024). Deferred to an execution proxy at the first money-moving credential or the third adapter.
- **Langfuse or any third-party trace exporter** until the observability egress inventory and a code-enforced scrub allowlist exist (`31 §10`).

**And five capabilities are deferred rather than excluded** — designed, specified, with a named trigger, and not built at MVP:

| Deferred | Trigger | Where specified |
|---|---|---|
| The symcc proof gate | Before the action catalogue exceeds ten classes, and before any real money | `28 §9.2` (an `11 E6` amendment), `36 §3` |
| The research-with-citations worker | Stage 1, where its acceptance criteria live | `11 E8`, `35 §6` |
| T-U1 grounded generation | An independently measured false-negative rate on adversarial inputs | ADR-015, `26 §9.6` |
| The model-backed CEO, K14, the autonomy ledger, the drift metrics | S5 complete and property 8 passing with the deterministic generator | `27 §2.0`, ADR-008 |
| The credential broker as an execution proxy | First money-moving credential, or the third adapter | ADR-024 |

**The distinction matters.** An exclusion is a decision not to build something. A deferral is a decision about *when*, with the trigger written down — and `21 §2` item 16 records two cases in this project's own history where a change was made without a record. Every deferral above appears in `phase2-v1.1-remediation-ledger.md` with its disposition.

---

## 5. Authority limits

**Replaced in v1.1 by `51-limits-fixture.md`**, which is a machine-readable grant-registry fixture rather than a table in prose. This section states why.

**Grade: ESTIMATE and RECOMMENDATION. Not a decision.** `07 §9` is explicit that the numbers are illustrative and the structure is the finding — nothing in the literature calibrates them. They require owner signature per `26 §10` and should be tightened on evidence, not loosened on inconvenience. Anchored to `21 §9`: Stage 1 is $1,000–$3,300 with no store; Stage 2 is $5,000–$6,000 and is the decisive test.

**Why the table had to go** (R8, R14, MAL-07, `43 §4.3`). v1.0's numbers were not the output of `26 §10`'s formula, and three of them contradicted the MAL they were presented alongside:

- A **$40/day** ACOS-enforced ad ceiling is **$1,200/month** against a stated monthly MAL of **$600**. *(Historical: v1.0's figures, recorded to explain why the table was removed. Not current.)*
- A **$25** per-action refund cap at **20/day** — the figure `26 §8`'s worked policy carried — is **$15,000/month**.
- A **$10** per-action campaign-increase cap and a **$40/day** ceiling are different quantities, and MAL used the wrong one.
- For a grant carrying only a DAY window, `min(g.window_limit(MONTH).max_monetary, …)` was **undefined**.

**I7 exists precisely to catch this and was never run against these numbers.** The remedy is not a corrected table — it is to stop asserting the ceiling in prose. `51` instantiates the grant registry, and I7's CI check asserts that the displayed `MAL_monetary` and `MAL_total` equal what a **second independent implementation** recomputes from the fixture by brute-force enumeration of grant combinations.

**What `51` contains:** named company-scoped windows with every grant carrying a MONTH window (so `MAL_total(month)` is always defined); Stage-1 and Stage-2 grant sets; the standing advertising authorisation with its rate, period and expiry; per-class irrecoverable unit costs for `MIE_cost`; the **degraded-mode override limit set** (v1.3, `51 §3.6`); the per-adapter **`I8` sweep cadences** and charge-record field sets (v1.3, `51 §3.2`); and **the displayed arithmetic** — Stage-2 **`MAL_total(month)` = $756.00** at the p95 signature basis in a 31-day month, composed of **$300.00** monetary, **$186.00** standing and **$270.00** irrecoverable cost, with **`MAL_total(day)` p95 = $329.50** and an explicit demonstration that thirty times the daily figure (**$9,885.00**) is **not** reachable because the MONTH window binds every reservation. The inference v1.0 left implicit is the inference v1.0 got wrong.

**v1.3 (TB-09).** This paragraph previously stated `$600` / `$180` / `$120` / `$173.50` / `$5,205` — the **superseded v1.1 multiplicative standing basis**, which v1.2 deviated from and replaced with the exposure-remainder form. The figures above are `51 §4.1`'s and `51 §4.2`'s, reproduced by `analysis/recompute-v1.3-output.txt`. **No numerical authority quantity changed in v1.3; what changed is that two operational artifacts stopped printing the previous version's answers.**

**Six things the ceiling does not bound**, displayed adjacent to it per `26 §10.4`: platform identity loss, utterance liability, IP asset freeze as a working-capital event, reputational effects of irrecoverable communications, **the residual under a compromised Trusted Computing Base member**, and — shown separately, never folded in — model and infrastructure spend, which is a cost ceiling rather than authorised loss.

---

## 6. Sequencing against Stages 0–2

`21 §9` authorises Phase 2 in parallel with Stages 0–2 on the spine only. The dependency runs one way in most cases and both ways in one.

- **S1–S2 have no dependency on Stage 1 or 2.** They are pure spine and should start immediately.
- **S2's injection harness is the Stage 1 deliverable** "red-team the deterministic authority layer with adaptive attacks". Build once, report to both.
- **S3's financial truth is a prerequisite for Stage 2**, which measures incremental CAC against contribution margin. Stage 2 cannot produce a trustworthy number without K6, so S3 must complete before Stage 2 begins. This is the one hard cross-dependency.
- **S4's escalation detectors are the Stage 1 deliverable** for measuring the research loop's fabrication and vendor-laundering rate, together with S2's evidence store.
- **S5–S7 are independent of the stages** and should not block them.

The consequence worth naming: **S3 is on the critical path for the decisive commercial test**, so if any slice deserves schedule protection it is that one, not the CEO slice that looks more impressive.

---

## 7. What would falsify the architecture

The MVP should be able to fail. These are the failures that would mean the design is wrong rather than the implementation is buggy.

- **Reservation overrun under concurrency that cannot be fixed within a single transaction.** Would undermine MAL and therefore the entire governance argument.
- **A symcc counterexample on P1–P8 that cannot be resolved without abandoning a required policy** (v1.2: P8 added for `INTERNAL_LIABILITY`, which carries no novelty test and therefore had no property at all in v1.1). Would mean the authority model is internally inconsistent. **v1.1: the gate is deferred past S1** (`28 §9.2`), so this falsification condition is decided later than v1.0 planned — and the interim substitute is `26 §11.2`'s hand proof over the MVP catalogue, which is weaker and is labelled as such.
- **DBOS re-executing a checkpointed step.** ADR-002 fallback trigger; not fatal to the architecture. **v1.1: the fallback is an ACOS-owned Postgres step journal, not Temporal** — migrating to Temporal moves the checkpoint out of Postgres and destroys R1, the property `33 §1` calls decisive, so v1.0's *"re-hosting rather than a rewrite"* was false (DBO-02).
- **The replaceability test failing irrecoverably** — some essential function that cannot be made model-free. Would mean B10 is unachievable and the autonomy story rests on model availability.
- **The injection harness producing a non-zero effect-outside-authority count** that is not attributable to a fixable gap. Would mean architectural containment does not work and the project's core security assumption fails.
- **Escalation detectors unable to reach 0% false negatives** on the enumerable trigger list **against an independently authored held-out corpus**. Would mean the statutory floor in `29 §11` cannot be met deterministically, which is a legal exposure rather than an engineering preference.

**v1.1 adds three, from `46 R19`.** Each is a condition under which the *design* is wrong rather than the implementation buggy, and each is decided inside the MVP.

- **No canonical constructor can be written for an action class of real operational value.** The correct response is to leave that class non-autonomous — but if it recurs across the classes the owner actually needs, **the finding is about the business model's automatability rather than about the architecture.**
- **The state-qualified split-halt rule of `30 §5.6` cannot be made to satisfy both EM15 and EM16 in practice** — statutory clocks expiring while the system is in `UNCORROBORATED_STALL`, or irrecoverable effects blocked long enough to damage the business. **v1.3 sharpens this falsification condition**: the corroborated state is unreachable in a partition or an audit-plane outage (`30 §5.6`), so the practical question is whether `DegradedModeOverride`'s 24 h / 5 effects / $50.00 escape is sufficient in operation, which `62 §11` condition 10 makes pass-revoking. The tension is recorded in `22 §3.1` as a **selected trade-off**; if the trade proves unworkable in operation, one of the two invariants must be renegotiated with the owner, and that is a governance decision rather than an engineering one.
- **No detector can be made to fire on a non-text-borne RED-class trigger.** `47 §10`: in that case **autonomous customer communication is out of scope for the first business.** The non-text-forces-T-U2 rule bounds the exposure by construction, so this falsifies a capability rather than the spine — but it falsifies it decisively.

**Two are the ones to watch: reservation overrun and injection containment.** Both are decided in S1 and S2, which is why they are first. **And the canonicaliser is now the third**, because it is new, it is the largest single addition in v1.1, and every monetary control sits downstream of it.
