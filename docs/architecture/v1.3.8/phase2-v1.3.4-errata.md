# ACOS Operating Spine v1.3.4 — Normative Errata

**Phase 2.5d. Issued 2026-09-08. Two architecture defects resolved, four declarations made, and one implementation sequence corrected, applied to Operating Spine v1.3.**

This is not an architecture phase, a red-team pass, a redesign or an implementation. **No new mechanism was introduced, no authority ceiling was changed, MAL was not changed, no Step ordering was changed, no audit cadence was changed, and the selected architecture (Option A) was not changed.** Six items are recorded below. All six were found during S1I implementation; two are genuine architecture defects that the implementation reported and refused to route around, and four are declarations of load-bearing points the artifacts left to convention.

**Versioning convention, as v1.3.1 established it and v1.3.2 and v1.3.3 followed it.** The numbered deliverables continue to declare `Operating Spine v1.3` in their version lines, because the *architecture* is v1.3 and unchanged. `v1.3.4` names the **issue** of the package. **`docs/architecture/v1.3.3/` is not modified by this pass** and remains on disk as the previous issue, byte for byte; `docs/architecture/v1.3.1/` and `docs/architecture/v1.3.2/` likewise. Every prior errata and verification document is carried forward unmodified as history.

**What this pass changes about control artifacts.** **One signature obligation is extended and none is discharged: class 20**, whose signed content is *"column order per row kind"* and which gains a declared order for `acos.journal.outbox_claimed.v1`. That residual has been owed since v1.3.2 and remains owed. **Classes 3 and 27 remain owed from v1.3.3, unchanged.** No production owner-signing mechanism and no runtime `I19` verification exist in the accepted implementation, and nothing in this pass claims otherwise. **No new control-artifact class is created.**

---

## Summary

| # | Defect | Behaviour changed | Authority quantities changed |
|---|---|---|---|
| **IRN-01** | `30 §5.1` item 4 row 1 was printed **Halt / Halt / Halt** by `22 §3.1`, halting IRRECOVERABLE in `NORMAL` — a state in which the effect is not unmirrored, and the opposite of row 1's own rationale. Composed with item 5's *"never rows 1 or 2"* and `51 §3.6`'s DATABASE CHECK, **an IRRECOVERABLE effect was never dispatch-eligible in any state, with or without an owner override** — so ADR-026, `25 §7`'s outbox, `25 §5`'s `PRESUMED_EXECUTED` branch, `I20` and `37` S4's autonomous sends all specified mechanisms with no reachable subject | **Yes, in `NORMAL` only.** Row 1 becomes state-qualified: dispatch in `NORMAL`, halt in both degraded states, halt under the `§5.1a` posture, unreachable by override in every state. Row 1's condition and its position ahead of row 2 are unchanged | **NO CHANGE.** Row 1 gates dispatch, never exposure |
| **CSB-01** | `30 §5.1` row 3's operand is *"a live statutory clock"* and `§9.1`'s clock is keyed on `case_ref`, but **no artifact related a `case_ref` to an effect, an authorisation, a `resource_ref` or a `task_id`.** `I56` closes clock *creation* and says nothing about clock *selection*, so the operand was answerable only by a guess a caller or a model could steer — the row-3 lever `§9.1` exists to close, reached from the other end | **Yes.** `effect.case_ref` is declared: kernel-owned, immutable, inherited from the authoritative task, never model-supplied, NULL where there is no case. `clock_bearing` is derived at the decision instant from current clock state keyed on it, with a deterministic evidentiary selection and persisted evidence. Row 3 becomes **reachable** where it legitimately applies, and **unreachable by substitution** | **NO CHANGE.** The binding decides which clock is read; it reserves nothing and denies nothing |
| **OBX-01** | `25 §7` and ADR-026 required a *transition* to `CLAIMED` and declared no prior state and no state machine, so *"never re-dispatched by any path"* was a sentence rather than a constraint | **No — declared.** Two states, `ENQUEUED` and `CLAIMED`; one transition; **no timeout, lease, expiry or reclaim out of `CLAIMED`** | **NO CHANGE** |
| **OBX-02** | The outbox was scoped to *"irrecoverable sends"* in four places and presented as a general dispatch-boundary layer in two | **No — declared.** The scope predicate is **`effect requires external dispatch`**, derived from the closed catalogue's execution metadata. Not the irrecoverable class alone; not every catalogue action unconditionally; not a caller's or a model's choice | **NO CHANGE** |
| **OBX-03** | `30 §5.7.2` item 3 increments the override counters *"in the dispatching transaction"* and no artifact said which transaction that is | **No — declared.** It is the **claim** transaction, which is the last committed local transaction before an effect can leave. The HTTP call remains outside it | **NO CHANGE** |
| **JCS-02** | `30 §5.3` requires a hashed row's column order to be *"declared per row kind, **in the specification**"* — and the specification declared an order for **no row kind at all**. Order is part of the hash, so two conforming implementations could diverge permanently with no artifact to judge either against | **No — declared.** `30 §5.3a` declares the order for `acos.journal.outbox_claimed.v1`, with the independence and insertion-order obligations stated normatively | **NO CHANGE** |
| **SEQ-01** | `37 §2` scheduled *"the ACOS-owned outbox"* at S4 as one item covering four separable things, the first of which is a **precondition** for the other three | **No — re-sequenced.** The durable outbox schema, correlation tag, deterministic enqueue/recovery and the non-reclaimable claim land at **S1**; the adapter, HTTP, provider idempotency/query, unknown-outcome transition, sandbox and reconciliation stay at **S4** | **NO CHANGE** |

**Authority quantities, restated and reverified.** `MAL_monetary(month)` = **$300.00**. `Standing(month)` = **$182.40 / $186.00**. `MIE_cost(month)` p95 = **$270.00**. `MAL_total(month)` at the signature basis = **$756.00**. `refund.create`'s `per_action_max` = **$25.00**. `degraded_per_action_approval_floor_monetary` = **$20.00**. `mirror_lag_critical_threshold` = **PT15M**; `audit_unreachable_full_halt_threshold` = **PT30M**. Every `51 §3.6` override quantity unchanged. `attestation_cadence` = 5 minutes, `k` = 3, anchor interval = 60 minutes, signal `max_age` = 5 minutes — all unchanged. **No owner re-signature of the MAL basis is required.**

---

## 1. IRN-01 — row 1 is state-qualified

### Defect

`30 §5.1` item 4 row 1, verbatim as issued:

> | **1** | `recoverability == IRRECOVERABLE` | **Halt.** No send, no reship, no public post, no address edit. Unmirrored and unundoable is the combination the mirror exists for. |

`22 §3.1`'s state-qualified table printed it across all three states:

| Precedence row | Class | `NORMAL` | `UNCORROBORATED_STALL` | `CORROBORATED_DEGRADED` |
|---|---|---|---|---|
| 1 | IRRECOVERABLE | **Halt** | **Halt** | **Halt** |

Composed with `30 §5.1` item 5 — *"An override restores precedence rows **3 and 4 only**, never rows 1 or 2"* — and `51 §3.6`'s `recoverability_classes[] ⊆ {COMPENSABLE, REVERSIBLE}` DATABASE CHECK, the three statements admit exactly one reading: **an IRRECOVERABLE effect was never dispatch-eligible, in any mirror state, with or without an owner override.**

### Why that is a defect and not a policy

**Five artifacts specify mechanisms whose subject is a dispatched irrecoverable effect, and every one of them was unreachable:**

- `34` **ADR-026** is titled *"**Irrecoverable dispatch** goes through an ACOS-owned outbox"*, and its decision items 2 through 5 all presuppose a claim that can happen.
- `25 §7` builds the outbox **specifically** because `26 §5` classifies `email.send` IRRECOVERABLE and most ESPs offer no idempotency header — *"the rule as written **excludes autonomous email sending**"* was the defect it was raised to fix.
- `25 §5` and ADR-026 item 3 give IRRECOVERABLE its own unknown-outcome branch — *"Assume it happened. Never re-dispatch. Mark `PRESUMED_EXECUTED`, consume the irrecoverable unit"*.
- `I20` bounds *"Σ provider-reported accepted messages per window ≤ Σ reserved irrecoverable units"*, which counts something that cannot occur.
- `37` **S4** builds *"autonomous T-U0 sends"* against a real ESP sandbox, and `37` **S7** extends them to a real recipient.

**A single table cell in a degraded-mode section had silently repealed a capability four other artifacts specify.** That is a transcription and state-qualification defect, not a decision.

### The reading that resolves it, from the text itself

`§5.1` item 4 is introduced as *"Dispatch precedence **while the mirror is unreachable**"*. Row 1's rationale is a statement about being unmirrored: *"**Unmirrored** and unundoable is the combination the mirror exists for."* `§5.1`'s own closing rationale says the same: *"What the mirror adds is unsuppressibility, and that matters most exactly where the action cannot be undone — which is why row 1 sits where it does."*

**`NORMAL` is precisely the state in which the effect is not unmirrored.** The rule's own justification does not reach it. `22 §3.1`'s table was written to state-qualify a list that had been written about degraded operation, and row 1's `NORMAL` cell was filled in by transcription rather than by decision.

### Exact correction

> **Row 1's CONDITION is unchanged:** `recoverability == IRRECOVERABLE`. **Its POSITION is unchanged:** first, ahead of row 2, in every state.
>
> **Row 1's BEHAVIOUR is state-qualified:** `NORMAL` → **Dispatch**. `UNCORROBORATED_STALL` → **Halt**. `CORROBORATED_DEGRADED` → **Halt**. **FULL-HALT POSTURE (`§5.1a`) → Halt**, and not restorable.
>
> **A `DegradedModeOverride` can never unlock row 1, in any state.** Item 5's *"never rows 1 or 2"* is unchanged and `51 §3.6`'s structural CHECK is unchanged.

**`DISPATCH_ELIGIBLE` at row 1 in `NORMAL` is a statement about item 4 and nothing else.** Item 4 is evaluated only over an effect that has already passed `26 §7`'s ordered fail-closed sequence, `26 §8`'s Cedar DENY boundaries, `26 §12`'s approval tier, the MIE window ceilings, `25 §7`'s idempotency layers and the claim-time re-evaluation of current state. **An IRRECOVERABLE effect is gated by the authority model, not by the mirror table.**

**And a claim is not an execution.** Reaching `DISPATCH_ELIGIBLE`, and taking the outbox claim, records that the effect **may be handed to transport**. It is not a dispatch, not a `DISPATCHED` state, not a provider acceptance, not `PRESUMED_EXECUTED` and not an MIE execution consumption.

**Provenance.** Reported during S1I as `S1I-owner-clarifications.md` S1I-C6, which implemented the printed table — the fail-closed direction — reported the consequence as a finding and refused to route around it.

### Affected files

`deliverables/30-observability-audit-and-escalation.md` `§5.1` item 4 row 1, its narrative and its rationale, **new `§5.1b`** · `deliverables/22-architecture-principles.md` `§3.1` table and two narrative statements · `deliverables/34-architecture-decision-records.md` ADR-026 · `deliverables/36-architecture-validation-plan.md` `VC-A6`, **new `VC-A6a`** · `analysis/consistency-v1.3.py` conditions **H1–H4**

---

## 2. CSB-01 — the effect→case binding and claim-time clock derivation

### Defect

`30 §5.1` item 4 row 3, verbatim:

> | **3** | Clock-bearing (a live statutory clock citing a RECORD-grade fact, `§9.1`) and `recoverability == COMPENSABLE` | **Dispatch**, in `NORMAL` and `CORROBORATED_DEGRADED` only. […] |

`30 §9.1` gives the clock's shape:

> ```
> Clock { id, statute, case_ref, started_at, deadline_at, source_record_ref }
> ```

So the operand is answerable only as *"is there a live RECORD-backed clock for **this** `case_ref`"* — **and v1.3.3 related a `case_ref` to nothing.** Checked: `30 §9.1`, `30 §5.1`, `26 §5`, `26 §2.1`'s `AuthorizationRequest` field list, `24 §3` K10, `24 §4`'s ERD, `51`. `case_ref` was a free identifier in the clock table and no artifact resolved one from an effect.

### Why that is a security defect

`30 §9.1` states the property itself:

> *"`§5.1`'s precedence row 3 privileges clock-bearing COMPENSABLE effects over the mirror, so **the statutory clock is a lever on the audit plane** and its provenance is a security property rather than a compliance detail. […] Without this, a model that can cause a clock to exist can manufacture the row-3 exemption it wants."*

**`I56` closes clock CREATION. It does not close clock SELECTION.** A COMPENSABLE discretionary effect suspends at row 4; the same effect, clock-bearing, dispatches at row 3. So a `case_ref` chosen by a caller at claim time — or guessed by the kernel from a `resource_ref`, a customer identifier or a similar order — is **the same lever reached from the other end**: a model that can make the kernel look up the *wrong* clock obtains the exemption without needing to create one.

S1H did not surface this because `classifyDispatchPrecedence` is pure and its tests hand it the operand. **S1I was the first slice that had to derive it from state**, and it stopped: the operand was hard-coded `false`, row 3 was made unreachable at claim time, and the leg was reported PARTIAL in the fail-closed direction rather than guessed (`S1I-owner-clarifications.md` S1I-C1).

### Exact correction

**Row 3 is not intentionally unreachable.** `30 §9.2` declares, in full:

> **`effect.case_ref : CaseRef | NULL` — KERNEL-OWNED, IMMUTABLE, NEVER MODEL-SUPPLIED**, inherited from the authoritative `task.case_ref` (`24 §3` K7) in the same transaction that creates the effect. Forbidden sources are enumerated by name: `ProposedIntent`, `rationale`, the dispatch payload, a free-text reason, a model classification, a caller-supplied claim-time argument, inference from a customer identifier, inference from a similar order, and an arbitrary resource lookup at claim time.
>
> **A post-hoc mutable mapping is forbidden**, because a mapping that can change after authorisation can change which statutory clock applies to an already-authorised effect.
>
> **`case_ref = NULL` is a declared ordinary state**, yields `clock_bearing = false`, and **never** means "search for any clock that fits."
>
> **`clock_bearing` is derived at the decision instant** from current authoritative clock state keyed on the effect's own `case_ref` — company match, case match, live under `§9.1`, provenance satisfying `I56`. Never an enqueue-time boolean, never a persisted column, never a parameter. **Both directions are live**: a clock opening before the decision makes row 3 apply; one closing or expiring makes it stop.
>
> **Where several qualifying live clocks exist**, the evidentiary clock is selected by **earliest `deadline_at`, tie-broken by ascending `clock_ref`**. The boolean operand is unchanged — *at least one qualifying live clock exists*. Where row 3 is the reason a decision resolved permissively, **the selected reference is persisted as evidence**; otherwise it is NULL or absent.
>
> **`case_ref` does not enter the dispatch payload** and **does not change the effect idempotency key** — it is a function of `task_id`, which the key already contains, so no two semantically distinct case-bound effects can collide under the existing key. Both are determinations, not omissions.
>
> **`RemedyObligation` lineage is preserved**: a fresh proposal originating from one inherits its `case_ref` through the task, and no owner or model re-enters it.

**Two invariants carry it: `I64`** (the binding is kernel-owned and immutable) and **`I65`** (claim-time derivation, deterministic selection, persisted evidence, database-enforced evidence integrity).

### Affected files

`deliverables/30-observability-audit-and-escalation.md` `§9.1` pointer, **new `§9.2`** · `deliverables/26-authority-and-policy-model.md` `§2.1`'s `AuthorizationRequest` field list and the payload note · `deliverables/24-company-state-and-evidence-model.md` `§3` K7 and K10 · `phase2-v1.3-invariant-registry.md` **new `I64`, `I65`**, `§2.8`'s DB-enforced enumeration · `deliverables/36-architecture-validation-plan.md` **new `VC-A6b`, `VC-A6c`** · `analysis/consistency-v1.3.py` conditions **H5–H8**

---

## 3. OBX-01, OBX-02, OBX-03 — the outbox's state machine, scope and transaction

### Defect

Three load-bearing points, each left to convention by the artifacts that use them.

**OBX-01 — no state machine.** `25 §7` and ADR-026 item 2 both say the row *"transitions to `CLAIMED`"*. A transition has a prior state, and the six places the outbox appears declared `CLAIMED` and nothing else. *"Never re-dispatched by any path"* was therefore a sentence about intent rather than a constraint on a state machine — and **every published outbox and job-runner library defaults to a visibility timeout that reclaims**, which is exactly the property this one must not have.

**OBX-02 — contradictory scope.** Four passages scope the outbox to *"irrecoverable sends"* (`24 §4`'s ERD, `33 §6`, `35 §4` item 3, ADR-026's title). Two present it generally (`25 §7`'s idempotency-layer table, where the other three layers are not class-scoped; and `31 §2` / `33 §1` / ADR-002, which state it of *"the dispatch boundary"* as such).

**OBX-03 — an unnamed transaction.** `30 §5.7.2` item 3: *"`effects_dispatched` and `monetary_dispatched` are incremented in the **dispatching transaction**"* — and no artifact says which transaction that is.

### Exact corrections

> **OBX-01.** Two states, `ENQUEUED` and `CLAIMED`. One transition, `ENQUEUED → CLAIMED`. **No transition out of `CLAIMED`, and no second transition into it. No timeout, no lease, no expiry, no reclaim, no attempt counter that resets a claim, and no elapsed time of any length that returns a `CLAIMED` row to `ENQUEUED`.**
>
> **OBX-02.** The scope predicate is **`effect requires external dispatch`** — every effect crossing an external-write boundary (`48`), whatever its recoverability class; **not** `recoverability == IRRECOVERABLE`; **not** every catalogue action unconditionally. **Derived from the closed catalogue's execution metadata**, so neither a model nor a caller can choose it. An internal-only kernel effect takes no row. ADR-026's title names the case that *forced* the mechanism, not a bound on it.
>
> **OBX-03.** The **claim transaction** is `30 §5.7.2` item 3's dispatching transaction. Its position is: current claim-time authority evaluation → exclusive durable claim → COMMIT → transport. It is the last committed local transaction before an effect can leave, and it is irreversible — so a later increment would admit N+1 against a cap of one. **This does not place the HTTP request inside the database transaction**; `25 §7`'s own *"in a committed transaction **before** the HTTP call"* is what puts the call outside it.

**A new invariant carries OBX-02: `I66`.** OBX-01 is carried by `I36`, whose statement is unchanged. OBX-03 is carried by `I63(a)`, whose statement is unchanged.

**Provenance.** `S1I-owner-clarifications.md` S1I-C2, S1I-C5 and S1I-C3, each of which implemented the only sound reading, disclosed it as an implementation declaration, and requested confirmation rather than asserting architecture.

### Affected files

`deliverables/25-workflow-and-event-architecture.md` `§7` · `deliverables/24-company-state-and-evidence-model.md` `§4`'s ERD · `deliverables/33-recommended-architecture.md` `§6` · `deliverables/35-failure-scenario-walkthroughs.md` `§4` item 3 · `deliverables/34-architecture-decision-records.md` ADR-026 · `phase2-v1.3-invariant-registry.md` `I36`, **new `I66`** · `deliverables/36-architecture-validation-plan.md` **new `VC-A6d`** · `analysis/consistency-v1.3.py` conditions **H9–H11**

---

## 4. JCS-02 — declared row-kind field orders

### Defect

`30 §5.3`, verbatim:

> | Column order | **Fixed, declared per row kind**, in the specification — never the physical column order, which a migration reorders. |

**The specification declared an order for no row kind at all.** Every order in service was an implementation convention agreed between two independently written triggers. Because `ACOS-JCS-1` frames a row as a concatenation of length-prefixed fields, **the order is part of the hash**: two conforming implementations that disagree on it produce a permanent silent chain divergence — the exact hazard `§5.3` was written to close — with no artifact either could be judged against.

This is the same shape as `S1H-C9`, which recorded the gap for three row kinds and resolved it as an implementation declaration. `S1I-C4` recorded it for `acos.journal.outbox_claimed.v1`. **v1.3.4 makes the declaration normative rather than conventional**, beginning with that kind.

### Exact correction

`30 §5.3a` declares the twenty-field order for `acos.journal.outbox_claimed.v1`, its required-absent set, and two obligations:

> **The order is normative, not conventional.** The control-plane and audit-plane implementations must each transcribe **the specification** independently. Neither may read the other, and **neither may read a shared canonicalisation helper that would make agreement automatic** — agreement two implementations obtain from one source is not a cross-implementation check (`36 §0`).
>
> **The order may not depend on an object's or a map's insertion order** in any implementation, and `36 §2.6`'s byte-identity fixture must fail on a seeded swap of two fields.

**Field 18 is new: `outbox_claim_clock_ref`, nullable, non-NULL only where the matched row is 3.** It is `§9.2.5`'s deterministically selected evidentiary clock, so a later audit can answer *which live statutory obligation justified this*. **`case_ref` itself is deliberately not a field of this row** — the clock reference is the fact an audit needs and is the narrower disclosure.

### Control-artifact and version effect

**`ACOS-JCS-1` is control artifact class 20**, whose signed content is *"column order per row kind"*. **Declaring an order for a kind that had none moves class 20's `content_hash` and therefore its signature.** That signature has been owed since v1.3.2's NULL-framing correction and is **still owed**; this pass extends the same obligation and discharges nothing. **No deployed chain exists**, so no re-anchor procedure is triggered.

### Affected files

`deliverables/30-observability-audit-and-escalation.md` `§5.3`'s column-order row, **new `§5.3a`** · `deliverables/50-control-artifact-manifest.md` `§2` class 20 · `deliverables/36-architecture-validation-plan.md` `VC-A3` · `analysis/consistency-v1.3.py` condition **H12**

---

## 5. SEQ-01 — the outbox foundation moves to S1

### Defect

`37 §2` S4's Build list, verbatim:

> *"**The ACOS-owned outbox** with at-most-once `CLAIMED`, provider-visible correlation tag, recoverability-keyed unknown-outcome policy and delivery-event reconciliation (I36, I20)."*

**That is one line covering four separable things, the first of which is a precondition for the other three.** A slice that builds transport before an at-most-once claim exists has a window in which a crash duplicates an irrecoverable send — the exact window ADR-026 was raised to close.

### Exact correction

> **S1 builds:** the ACOS-owned durable outbox schema with its two-state machine; the immutable authorised payload snapshot bound to the committed `dispatch_payload_hash`; the provider-visible correlation tag; deterministic enqueue and enqueue recovery; the exclusive, non-reclaimable claim taken against current claim-time authority state; and the crash-before-HTTP proof against real PostgreSQL.
>
> **The later execution/adapter slice builds:** the real adapter and the HTTP or vendor-SDK call; provider idempotency headers and the provider query primitive; the unknown-outcome runtime transition and `PRESUMED_EXECUTED`; MIE consumption at the execution/outcome point; the provider sandbox, delivery-event reconciliation, `VERIFIED` and `NEVER_SENT`; and `I36`'s declared verification against a real ESP sandbox, together with `I20`.

**`I36`'s enforcement leg therefore lands at S1 and its verification leg stays at S4.** The registry's enforcement column is *"DB (state machine constraint)"*, which S1 builds and can prove; its verification column requires a provider's accepted count, which S1 cannot produce and does not claim. **An outbox row count is not a provider accepted count**, and **S1 asserts no external exactly-once property.**

**Provenance.** `S1I-owner-clarifications.md` S1I-C7, recorded as an owner sequencing decision rather than an architecture conflict.

### Affected files

`deliverables/37-acos-mvp-and-implementation-sequence.md` `§2` S1 and S4 · `phase2-v1.3-invariant-registry.md` `I36`'s slice and test columns · `analysis/consistency-v1.3.py` condition **H13**

---

## 6. What this pass deliberately did not do

- **It did not weaken any degraded-state halt.** IRRECOVERABLE still halts in `UNCORROBORATED_STALL`, in `CORROBORATED_DEGRADED`, under the full-halt posture and against an owner override. Only `NORMAL` moved.
- **It did not change any override quantity, scope rule or composition bound.** `51 §3.6` and `I63` are untouched, and an override still cannot reach rows 1 or 2.
- **It did not add a model-facing field.** `case_ref` is kernel state; `26 §2.1`'s `ProposedIntent` gains nothing.
- **It did not change the effect idempotency key**, and records why not rather than leaving the question open.
- **It did not put `case_ref` in the dispatch payload**, so no support-case identifier leaves the perimeter.
- **It did not redesign `ACOS-JCS-1`'s framing.** Field framing, NULL encoding, decimal scale, timestamp form, Unicode form and the hash function are as v1.3.2 issued them, byte for byte.
- **It did not bring TA-08's clock-volume rules forward** from S5. At S1 the live-clock population remains provenance-bounded and not volume-bounded, which is why `§9.2.5`'s deterministic selection is required rather than optional.
- **It did not implement, enable, plan or authorise any real external transport.** No adapter, no HTTP, no vendor SDK, no provider outcome and no `DISPATCHED` state.
- **It did not discharge any control-artifact signature.** Classes 3, 20 and 27 remain owed, and runtime `I19` remains absent. **The pre-live-execution gate recorded at S1I stands: no later slice may enable a real external effect until owner signing and integrity sequencing have been re-evaluated.**
