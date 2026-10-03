# ACOS Operating Spine v1.3 — Implementation Brief

**Phase 2.5. Issued 2026-09-03. Handoff for S1. Read this first; it tells you which documents are normative and which are history.**

**Architecture version: ACOS Operating Spine v1.3.**
**Gate: `phase2-v1.3-verification.md` — READY FOR S1 IMPLEMENTATION.**
**Operative gate document: `redteam3/62-implementation-gate-v2.md`, which supersedes `58`.**

---

## 1. The authoritative set — what a developer treats as normative

**These, and nothing else.** Anything not on this list is history, review material, or an oracle.

| Artifact | Authority |
|---|---|
| `phase2-v1.3-invariant-registry.md` | **The single authoritative definition of every invariant identifier.** No other document defines one. Where a document cites an identifier inconsistently, this wins and the document is corrected |
| `deliverables/22-architecture-principles.md` | The EM/SR principles and the EM15↔EM16 selected trade-off |
| `deliverables/23-system-context-and-logical-architecture.md` | System context |
| `deliverables/24-company-state-and-evidence-model.md` | Kernel capabilities and entities. **`§3` K5 is the single authoritative schema for `window_balance` and `standing_window_exposure`; `§3.1` is the single authoritative `StandingAuthorization` state machine and window-instance scoping rule** |
| `deliverables/25-workflow-and-event-architecture.md` | Workflow and event model |
| `deliverables/26-authority-and-policy-model.md` | The authority tuple, the policy sequence, the exposure block, **`§2.1.3`'s rate-class handoff**, and `§10`'s six displayed quantities |
| `deliverables/27-ai-ceo-and-agent-model.md` | Agent model — S5 and later |
| `deliverables/28-financial-and-experiment-architecture.md` | Financial truth — S3 and later |
| `deliverables/29-security-threat-model.md` | Threat model |
| `deliverables/30-observability-audit-and-escalation.md` | Audit architecture. **`§5.6` is the single authoritative mirror state machine; `§5.7.1` the corroboration contract; `§5.7.2` the override; `§5.10` `I8`'s cadence and scope** |
| `deliverables/31`, `32`, `33` | Technology and architecture options; the recommended architecture |
| `deliverables/34-architecture-decision-records.md` | ADRs, with v1.3 amendments |
| `deliverables/35-failure-scenario-walkthroughs.md` | Failure walkthroughs |
| `deliverables/36-architecture-validation-plan.md` | **The document S1's tests are authored from.** Verification cases, gates, oracles |
| `deliverables/37-acos-mvp-and-implementation-sequence.md` | Slice definitions and scope |
| `deliverables/48`, `49`, `50` | External-write perimeter; Trusted Computing Base; control-artifact manifest |
| `deliverables/51-limits-fixture.md` | **The single copy of the authority limits fixture.** `phase2-v1.3-limits-fixture.md` is a pointer |
| `phase2-v1.3-remediation-ledger.md`, `-changelog.md`, `-lower-severity-register.md`, `-verification.md` | Disposition, change record, schedule, gate |

**Explicitly NOT normative.** `deliverables/38-phase2-review-brief.md` — **superseded**; it briefs an adversarial reviewer for a review that has now happened three times. `redteam2/` and `redteam3/` — review findings, authoritative about *defects*, not about *design*. `phase2-v1.2-*.keep` — history. `analysis/` — oracles and self-checks; `recompute-v1.3.py` in particular is a **reference** oracle that shares an author with the fixture and therefore proves internal consistency, not correctness. **The S1 `I7` oracle must be written independently again.**

**If two normative artifacts disagree, that is a defect, not a choice.** Report it rather than picking one. That defect class — AUDA-01 — has appeared in v1.0, v1.1, v1.2 and v1.3's inputs, and `analysis/consistency-v1.3.py` C21 and C22 are the standing mechanical defences.

---

## 2. The S1 boundary — what to build

`37` S1, unchanged in scope by v1.3 and extended in what it must prove.

**Build.** Postgres with append-only bitemporal `state_facts`, `effects`, `authorisations`, `exposure_reservations`, `decisions`, and a **company-scoped gap-free `journal_seq`** with a local chain computed by a control-DB trigger. K4 Effect Gateway with `propose_intent(ProposedIntent)` as the sole write capability. The **Effect Canonicaliser** with a versioned constructor per action class. K3 Cedar in-process. K5 exposure ledger: named company-scoped windows, **`window_balance` keyed `(company_id, window_id, window_instance_key)` with four terms per ledger and the commitment guard**, **`standing_window_exposure` with the generated `forward_monetary` column and its maintaining trigger**, and `StandingAuthorization` with the five-state machine under `I62`. DBOS Transact workflows. Closed action catalogue, **four classes against mocks**: one REVERSIBLE, one COMPENSABLE, one IRRECOVERABLE, one rate-based. Separate audit Postgres **on a separate account**, insert-only under quota, own trigger-computed chain, two-sided diff, `JournalAttestation` at 5 minutes with k=3.

**New in S1 because v1.3 put it there:** `DegradedModeOverride` as kernel state with `I63`; `MirrorInputStallSignal` verification on the control side, against the audit-plane public key in the manifest; `I17f(c)`'s dispatch→tag check on the audit side; and `I62`'s transition trigger.

**Exact first implementation target.** **The `window_balance` row, its four-term commitment guard, `standing_window_exposure` with its generated column and trigger, and the declared lock order — with `36 §2` VC-S8's targeted interleaving and its mandatory `REPEATABLE READ` negative control written before the production path.** Everything else in S1 sits downstream of that row: the canonicaliser computes what reserves against it, the journal counter is locked after it, and `62 §11` condition 8 makes its failure the first finding in four passes that would bear on the substrate choice. **Do not start with the canonicaliser.** It is the largest component and the most interesting, and it is not the one that decides whether Option A holds.

---

## 3. S1 non-goals

Not scope creep — each is deferred with a named trigger in `37 §4`.

- **S2 and anything in it.** `62 §8`: S2's proof that a compromised model cannot move money is an argument about the constructor, the named windows and `I21`, and TB-03 changed the constructor's `exposure` block for rate classes.
- **Real adapters.** All four S1 classes are mocks. **Consequence, stated because v1.2 did not: `I8` proves nothing at S1**, so `30 §5.5` cases 2b and 4 have no operative detector at that slice.
- **The symcc proof gate** — deferred past S1 per the `11 E6` amendment in `28 §9.2`, with `26 §11.2`'s hand proof as the labelled-weaker substitute.
- **Any live clock.** `I56`'s schema is S1; live clocks are S5.
- **The owner path.** `DegradedModeOverride`'s *fixture* is S1; its owner-facing grant path is S5.
- **Any production ceiling on `W_MONTH_ADSPEND`** until TB-08(a) lands — see `§5`.
- Model bindings, briefings, research workers, utterance tiers, T-U1.

---

## 4. Permitted spike, and audit provisioning

**The DBOS-versus-step-journal spike is authorised** (`62 §6`), unchanged and re-authorised. Gap-free `journal_seq` requires a counter row inside the authorising transaction, which is a property of the substrate and not of the workflow engine, and the outbox is ACOS-owned either way. **Add to its kill-point matrix:** the TB-04 interleavings — an asynchronous realised-spend update against a concurrent authorisation on the same `window_balance` row, **in both orderings**. It decides whether the generated-column construction holds, and it is cheaper to learn in the spike than in the build.

**Separate audit-account provisioning is authorised** (`62 §7`), with v1.3's extension: **provision the audit-plane Ed25519 signing key and the `GET /audit/v1/mirror-input-stall` read endpoint**, and register the public key as control-artifact class 24 in the owner-signed manifest. This is audit separation, not S1 build, it takes calendar time, and doing it now removes a dependency from the remediation. **Nothing else** — no schema, no constructor, no ledger, no journal, no repository beyond what the spike requires.

---

## 5. Components blocked pending a scheduled finding

**S1 may begin. These four components may not**, per `phase2-v1.3-lower-severity-register.md`.

| Component | Blocked by | Until |
|---|---|---|
| Any cessation measurement (the retired scalar or any specification field) | **TB-07** | The four-field per-adapter cessation specification is declared. `62 §9` prohibition 3 |
| Seeding production ceilings on `W_MONTH_ADSPEND` | **TB-08(a)** | The overdelivery band is declared, `MAL_total` recomputed and **re-signed** |
| The `PAUSE_PENDING` retry implementation | **TB-11** | Attempts and backoff are declared, bounded strictly below `cessation_grace` (72 h) |
| Any `campaign.budget.set` supersession path | **TB-13** | `SUPERSEDED` status and max-over-instance `standing_cap` are declared, **written together with TB-05** |

Also outstanding and mechanical: **TOS-02** (eight deliverables cite the superseded v1.1 registry — `37`'s S6 build scope is the one that matters) and **TOS-03** (`30 §6.1`'s audit-ownership count, correct to 22 of 70). Both `S1 BEFORE IMPLEMENTING RELATED COMPONENT`.

---

## 6. The seventeen empirical obligations

**`62 §10`'s seventeen, carried forward and not replaced.** Amended only where a v1.3 remediation changed the prerequisite; every obligation whose architecture prerequisite is now specified points to its authoritative v1.3 section.

| # | Obligation | Slice | v1.3 status |
|---|---|---|---|
| 1 | Gap-free `journal_seq` under concurrency and rollback, declared lock order, no deadlock against the window balance row | S1 | Carried unchanged. `30 §5.2` |
| 2 | `I3`'s multi-term sum as a single DB-checked bound, with the mandatory `REPEATABLE READ` negative control that **must fail** | S1 | **Prerequisite now specified.** Four terms, `24 §3` K5's commitment guard. VC-L2 |
| 3 | Independent cross-instance re-chaining over rows with structured fields — the `jsonb` ordering question is empirical | S1 | Carried unchanged. `30 §5.3`, VC-A3 |
| 4 | The five dispatch/mirror ordering kill points, asserting duplicate versus tamper is distinguished | S1 | Carried unchanged. `30 §5.2`, VC-A5 |
| 5 | Standing boundary re-reservation against simulated overdelivery, asserting the day-2 pause does **not** occur, **extended to the cross-boundary case** | S1 | **Prerequisite now specified.** `24 §3.1`'s instance rule; **VC-S5** is the extended case verbatim |
| 6 | Verify-mode resume after reservation reaping, a constructor bump, and an out-of-band settlement | S1 | Carried unchanged. `26 §12.2`, VC-R1 |
| 7 | `refundCreate`'s `@idempotent` key scope and deduplication window, empirically | S3 | Carried unchanged |
| 8 | Whether the audit plane's own vendor reads detect an out-of-band mutation the control plane suppresses, **and the measured end-to-end detection latency** | S3 | **Prerequisite now specified.** `sweep_cadence` is `CONFIGURED` in `51 §3.2`; what is measured is `vendor_reporting_lag`. `30 §5.10` |
| 9 | **Declare the per-adapter cessation specification first**, then measure each field | S1 declare / S3 measure | **Not yet declarable — TB-07 is scheduled.** `51 §3.2` marks it `UNDECLARED` and points at the register rather than carrying the retired scalar. `62 §9` prohibition 3 stands |
| 10 | Whether `reconciler_match_rule` distinguishes a renewal from a crafted charge, crafted case authored independently of **both** the rule and the **derivation** | S3 | **Prerequisite now specified.** `51 §3.2.2`'s derivation; **VC-S6** |
| 11 | Outbox kill points against a real ESP sandbox, measured by the provider's own accepted count | S4 | Carried unchanged |
| 12 | `Σ settled cost attributable to agent-authorised effects ≤ MAL_total(w)` — at the bank line, weeks later | T3 | Carried unchanged. **Still the only unforgeable MAL test and still the one that matters** |
| 13 | **Adversarial-attester negative control** — truncate the push *and* adjust the attestation; assert `I17e` does **not** fire | S1 | **Prerequisite now specified.** `30 §5.5` case 2b; **VC-A1d** |
| 14 | **Dispatch→tag detection** — dispatch inside a published stall interval with the tag omitted; assert a critical incident | S1 fixture / S6 live | **Prerequisite now specified.** `I17f(c)`; **VC-A2c** |
| 15 | **Override composition** — repeated exercises across consecutive outages, rotating classes, recreating after expiry; assert the aggregate bound | S1 fixture / S5 owner path | **Prerequisite now specified.** `30 §5.7.2`, `51 §3.6`, `I63`; **VC-A2f**. v1.2 recorded this as *"cannot be written until the override is specified"* |
| 16 | **Realised/standing atomicity** — targeted interleaving both orderings with the mandatory weaker-isolation negative control | S1 | **Prerequisite now specified.** `24 §3` K5; **VC-S8** |
| 17 | **First-authorisation permit** — assert the **first** `campaign.budget.set` in a clean window **permits** | S1 | **Prerequisite now specified.** `26 §2.1.3`; **VC-S7**; verified at specification level by V6 |

**Obligation 12 remains the one no amount of CI converts into a proof.**

---

## 7. The ten pass-revocation conditions

**`62 §11`'s ten, carried forward verbatim in force.** Any one of them, reached during S1, revokes the architecture PASS and returns the package to remediation.

1. **A remediation that answers a BLOCKING finding by weakening the invariant** rather than supplying the missing mechanism or value. For this pass specifically: retaining forward exposure in fewer statuses to make TB-02 tractable; relaxing `I54` to admit a timed-out verification read; adding a tolerance to `I18b`; or dropping the standing term from `I3`. **Each is the tempting repair for a finding above and each is prohibited.** `phase2-v1.3-verification.md` V2 checks that none was taken.
2. **The audit plane's independent input path is found, in implementation, to require a control-database read or to open a second unverified channel** — specifically, if TA-06's signed stall artifact cannot be made to work without the control plane reading audit-side state it should not hold, or if the fix introduces a second independently suppressible path. Then `I17`'s claim degrades permanently to WORDING.
3. **The cessation specification proves undeclarable for the adapter, or the measured latency is long enough that pause-and-reauthorise within a window is impossible.** Both are **business-model findings** about advertising under this architecture, not engineering findings.
4. **The S1 concurrency harness cannot produce a failing negative control at `REPEATABLE READ`** — covering obligations 2 and 16.
5. **Independent re-chaining cannot be made to agree across two instances** for rows with structured fields, after `ACOS-JCS-1`.
6. **`I18` divergence between reserved and settled amounts persists** after SR-C1's field split and CAN-06's per-corridor spread allowance.
7. **More than one additional action class proves non-canonicalisable during S1** beyond the two `58` added.
8. **The standing term cannot be made atomic with the realised term** without either serialising every vendor spend observation behind the authorisation path or admitting a transient state in which headroom exists that no authorisation created. **Either outcome means `I3`'s four-term bound is not enforceable at one commit point, which is `58 §8`'s decisive property for Option A and would be the first finding in four passes to bear on the substrate choice.**
9. **`charge.standing_authorization_id` cannot be derived unambiguously** from any combination of the audit plane's own vendor reads, in a real sandbox, across a predecessor/successor pair with delayed posting. Then `I22`'s per-authorisation scoping is unenforceable and STD-02 is open.
10. **The specified override's aggregate bound cannot be set at a value that is both safe and usable.** **v1.3 partially settles this and does not close it.** The bound is safe by arithmetic (V8) and usable for 24 hours; with one registered OWNER-tier principal, overrides 2 and 3 are structurally unavailable, so a multi-day outage still ends in a statutory breach unless a second approver is registered. **That is an owner decision and it should be taken before S5, not discovered during it.**

---

## 8. Explicitly prohibited production capabilities

**Unchanged from `62 §9`. v1.3 adds nothing to this list and removes nothing from it.**

**Categorically prohibited** (`26 §6`, architecturally unreachable, no grant overrides): `payee.create` · `payee.bank_details.modify` · `payment_method.add` · `credential.create/rotate/export` · `oauth.scope.modify` · `payment_page_code.write` · `theme.checkout.write` · `authority.*` · `audit.write/close/delete` · `platform.spend_cap.raise` · `platform.budget_limit.raise` · `review.create` · `testimonial.create` · `tax.filing.*` · `entity.*` · `contract.execute` · `legal.response.send` · `dispute.representment.submit`.

**Prohibited by the MVP's non-production boundary, and this document authorises none of them:** production deployment · real customers · real money · live advertising · supplier commitments · autonomous business operation · any real platform identity · any public storefront.

**Non-autonomous by disqualifier:** `email.campaign.send` · any class with no registered constructor · any class whose API offers no idempotency and which is also irrecoverable · cross-currency monetary classes · split-tender refunds.

**And one v1.3 structural prohibition, which is a property of the override rather than a policy on it:** a `DegradedModeOverride` **cannot** be granted over `IRRECOVERABLE` effects or over precedence rows 1 and 2. There is no grant path, not merely no permitted grant.

---

## 9. Three things to carry into S1 that are not requirements

**The residuals are not measurement placeholders.** Registry `§3` items 9, 10 and 11 state that a compromised control plane freezing its own attested prefix is **undetectable** for the class of rows with no vendor counterpart — authorisations, denials, reservations, approvals, state facts, escalations, override exercises, standing transitions and the tags themselves. No implementation resolves that. If S1's audit gates start being described as proving source completeness, that is drift, and `30 §5.4` is the sentence to reread.

**`I8` proves nothing at S1.** Every action class is a mock. The audit gates S1 can actually pass are transport, attestation, canonicalisation and the two-sided state machine. Source completeness begins at S3.

**Three specification objects in this package have never been attacked.** `DegradedModeOverride`, `MirrorInputStallSignal` and `standing_window_exposure` were each required by a BLOCKING remediation and each was written in a verification-only pass with no adversarial review after it (`phase2-v1.3-verification.md §14`). The override is the architecture's only remaining self-service relaxation; the corroboration key is a new root of trust; and the generated-column-plus-trigger construction is a concurrency claim asserted from specification and measured by obligation 16. **Treat surprises in those three as findings about the architecture rather than as implementation details.**

---

**Grade: DECISION.** Issued by the ACOS architecture remediation team, 2026-09-03. Authorises S1 as bounded above, and nothing else.
