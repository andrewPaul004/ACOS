# S1I — Owner Resolution

**Package issue `v1.3.4` is authoritative. Candidate reviewed: `2d5193b`. Implementation
commit: `dec85eb`. Accepted predecessor: `8ce0d41`.**

This document is the owner's disposition of the seven clarifications in
`S1I-owner-clarifications.md`, the record of what each cost in architecture and in
production, and the statement of what remains open.

**`OWNER DECISION STILL REQUIRED = 0.**

---

## 0. Summary

| Id | Subject | Disposition |
|---|---|---|
| **S1I-C1** | No declared binding from an effect to a `statutory_clock.case_ref` | **OWNER CLARIFICATION / ARCHITECTURE DEFECT RESOLVED** — a trusted effect→case binding is declared. Row 3 is **not** intentionally unreachable |
| **S1I-C2** | v1.3.3 names `CLAIMED` and declares no pre-claim state | **OWNER CLARIFICATION — ACCEPTED.** `ENQUEUED`, and `CLAIMED` has no timeout, lease, expiry or reclaim |
| **S1I-C3** | "the dispatching transaction" is undefined | **OWNER CLARIFICATION — ACCEPTED.** The claim transaction is it |
| **S1I-C4** | No declared byte order for a record of the claim | **OWNER CLARIFICATION — ACCEPTED AND MADE NORMATIVE.** `30 §5.3a` |
| **S1I-C5** | The outbox is scoped to "irrecoverable sends" in four places | **OWNER CLARIFICATION — ACCEPTED WITH EXTERNAL-WRITE SCOPE** |
| **S1I-C6** | Row 1 halts IRRECOVERABLE in `NORMAL` too | **ARCHITECTURE DEFECT RESOLVED** — IRRECOVERABLE is eligible in `NORMAL` **only** |
| **S1I-C7** | `37` schedules the outbox at S4 | **OWNER SEQUENCING CLARIFICATION — ACCEPTED** |

**Two of the seven were genuine architecture defects** — C1 and C6 — and the S1I
implementation reported both rather than routing around either. **Five were declarations**
of load-bearing points the artifacts left to convention.

`phase2-v1.3.4-errata.md` carries the normative record as **CSB-01**, **IRN-01**,
**OBX-01**, **OBX-02**, **OBX-03**, **JCS-02** and **SEQ-01**.

---

## 1. S1I-C1 — the effect→case binding

### The decision

> **ROW 3 IS NOT INTENTIONALLY UNREACHABLE.** The architecture requires a first-class
> trusted binding between a case-associated effect and its statutory case.

`30 §9.2` declares `effect.case_ref : CaseRef | NULL` — **kernel-owned, immutable, never
model-supplied** — inherited from the authoritative originating task, established no later
than the creation of the local effect and in the same transaction, `NULL` where there is no
case, and read at the decision instant against current clock state.

### Why the gap was a security defect and not an omission

`I56` closes clock **creation**. It says nothing about clock **selection**. `30 §9.1`
states the property the two together are supposed to have — *"the statutory clock is a
lever on the audit plane"* — and v1.3.3 closed one end of the lever and left the other
open: a `case_ref` chosen by a caller, or guessed by the kernel from a `resource_ref`,
obtains the row-3 exemption without needing to create a clock.

### What was built

| Leg | Mechanism |
|---|---|
| The authoritative source | `authority_task.case_ref` — `24 §3` K7's kernel state, whose "What AI may not do" now names it |
| The derivation | `0011`'s `effect_derive_case_ref`, a `BEFORE INSERT` trigger that **overwrites** whatever the caller supplied with `authority_task.case_ref`, resolved through `authorisation.task_id` |
| Immutability | `0007`'s existing `effect_append_only`. There is no UPDATE path to the column, for any role |
| The claim-time operand | `clockBearingAtClaim(client, {companyId, caseRef, now})`, where `caseRef` is `effect.case_ref` read from the committed row in the claim's own operand query |
| The NULL case | An early return. **No query is issued at all**, so there is no predicate to widen later |
| The evidentiary selection | `selectEvidentiaryClockOn` — earliest `deadline_at`, tie-broken by ascending `clock_id` |
| The persisted evidence | `dispatch_outbox.claim_clock_ref`, and `30 §5.3a` field 18 on the journal row |
| The database's own refusals | An FK carrying company agreement; a biconditional CHECK tying presence to row 3; and a trigger refusing a cross-case clock, a clock not live at `claimed_at`, and a clock cited by a case-less effect |

**DERIVED RATHER THAN CHECKED, DELIBERATELY.** A check is a check one code path can skip
and leaves a parameter for a later caller to find. The overwrite leaves nothing to skip: a
caller that supplies a case is not refused, it is **ignored**.

### The attacks, and their results

| Attack (`§3` of the mandate) | Result |
|---|---|
| 1. Effect created for case A; rewrite it to case B | `APPEND_ONLY_TABLE_effect` on UPDATE **and** on DELETE. The binding is unchanged |
| 1b. Move the TASK to case B afterwards | The committed effect keeps case A. A **new** effect under a newly-cased task gets the new case — the same rule, a different effect |
| 2. Model/direct INSERT supplies a case | The INSERT **succeeds** and the supplied case is **discarded**. The row carries the authoritative one |
| 3. Caller passes a claim-time case | Production reads the effect's own binding. The TEST-ONLY classifier that takes a caller case reaches row 3 where production does not |
| 3 reversed. Caller removes/changes the case on a real clock | Production still sees the real clock |
| 4. Sibling effect on the SAME resource carries a clock-bearing case | Production is unmoved. The TEST-ONLY resource-lookup classifier borrows the sibling's clock |

`tests/integration/outbox/effect-case-binding.test.ts` — 13 cases.
`tests/negative-controls/unsafe-caller-case-ref.ts` — the two discriminating controls.

### What the binding deliberately does not touch

**The dispatch payload.** `30 §9.2.6`. Asserted on the BYTES: the same order authorised
under two different cases produces a byte-identical `dispatch_payload` and an identical
hash. A support-case identifier does not leave the perimeter as a side effect of an audit
binding.

**The effect idempotency key.** `25 §7`'s key already contains `task_id`, and `case_ref` is
a **function of** `task_id` — so two effects with different case bindings necessarily carry
different keys. **This was determined rather than assumed, and it was observed rather than
argued:** the fixture cannot produce two differently-cased effects from one task, because
`I42` returns the prior result for the second. Two cases need two tasks, and needing two
tasks is the proof.

---

## 2. S1I-C6 — IRRECOVERABLE in `NORMAL`

### The decision

> **IRRECOVERABLE MAY PROCEED IN NORMAL OPERATION.** The v1.3.3 table cell that makes
> IRRECOVERABLE halt in `NORMAL` is a transcription / state-qualification defect.

### What the defect cost, stated

Composed with `30 §5.1` item 5 and `51 §3.6`'s DATABASE CHECK, the printed table made an
IRRECOVERABLE effect **never dispatch-eligible in any state, with or without an owner
override**. Five artifacts specify mechanisms whose subject is a dispatched irrecoverable
effect — ADR-026's title, `25 §7`'s outbox, `25 §5`'s `PRESUMED_EXECUTED` branch, `I20` and
`37` S4's autonomous sends — and every one of them was unreachable. **A table cell in a
degraded-mode section had silently repealed a capability four other artifacts specify.**

### The correction, and its exact bounds

| Mirror / posture | v1.3.3 | v1.3.4 |
|---|---|---|
| `NORMAL` | Halt | **DISPATCH_ELIGIBLE**, row 1 |
| `UNCORROBORATED_STALL` | Halt | **HALT**, row 1 — unchanged |
| `CORROBORATED_DEGRADED` | Halt | **HALT**, row 1 — unchanged |
| FULL-HALT POSTURE | Halt | **HALT**, row 1, not restorable — unchanged |
| + ordinary degraded override | Halt | **HALT** — unchanged |

**Row 1's condition is unchanged. Its position ahead of row 2 is unchanged.** So an
IRRECOVERABLE effect still never reaches row 2 — it did not at v1.3.3 either, because row 1
matched first — and no other row's reachability moves.

### The two consequences elsewhere, neither left implicit

**(a) `36 §6`'s *"`CORROBORATED_DEGRADED`: as `NORMAL`"* now holds for rows 2–5 and not for
row 1.** That is correct, in `§5.1a`'s own words: *"corroboration **proves** the stall
rather than curing it."* An IRRECOVERABLE effect in `CORROBORATED_DEGRADED` is still
unmirrored and unundoable. **The permissiveness ordering `NORMAL ≥ CORROBORATED ≥
UNCORROBORATED` is unchanged; what v1.3.4 removes is the EQUALITY, in the strict
direction.**

**(b) `§5.6`'s inversion gains a second row.** Rows 1 and 3 now differ between `NORMAL` and
`UNCORROBORATED_STALL`. **Both run the same way**: declaring the mirror unreachable costs
the declarer the clock-bearing COMPENSABLE dispatch *and* the irrecoverable one. The
inversion is strengthened, not weakened.

### The discrimination, and why the control runs backwards

`tests/negative-controls/unsafe-irrecoverable-blanket-halt.ts` is **stricter** than
production — the only vulnerable control in this repository that is. A correction can fail
two ways: it did not happen, or it went too far. Only a stricter control detects the first.

| Seed / control | Fails | Proves |
|---|---|---|
| `--seed-irrecoverable-halt` (v1.3.3 restored) | **H5 alone** | H5 *is* the `NORMAL` condition |
| `--seed-irrecoverable-loose` (eligible everywhere) | **H6 and H7 alone** | the degraded halts are checked independently |
| `unsafeIrrecoverableRow1` in `NORMAL` | denies where production permits | the correction landed |
| `unsafeIrrecoverableRow1` in every degraded condition | agrees with production | it landed **narrowly** |

### A claim is not an execution

`tests/integration/outbox/outbox-irrecoverable-claim.test.ts` runs the ADR-026 path end to
end — authorise → `NORMAL` → enqueue → claim → durable `CLAIMED` — **and stops**. Asserted:
no HTTP, no `DISPATCHED` state, no provider outcome, **all three irrecoverable ledgers
zero**, one journal row, a second claim refused `ALREADY_CLAIMED`, and no economic state
moved by the claim.

---

## 3. C2, C3, C4, C5, C7

| Id | Decision | Architecture | Production | Tests |
|---|---|---|---|---|
| **C2** | `ENQUEUED`; **no timeout, lease, expiry or reclaim out of `CLAIMED`** | `25 §7`'s state machine (OBX-01); ADR-026 amendment | None — `0010`'s trigger already admitted exactly this | Accepted `outbox-immutability.test.ts`, `unsafe-reclaimable-outbox.ts`, `unsafe-lease-reacquire.ts`; gate H10 with `--seed-reclaim-timeout` |
| **C3** | The claim transaction is `30 §5.7.2` item 3's dispatching transaction | `25 §7` (OBX-03); ADR-026 amendment | None — the accepted composition of `claimOverrideAllowanceOn` already reads it this way | Accepted `override-backed-claim-race.test.ts`, `unsafe-non-atomic-override-claim.ts` |
| **C4** | The order is **normative**, in the specification | New `30 §5.3a`; `50 §2` class 20; `36`'s `VC-A3` (JCS-02) | Field 18 added on both planes, independently transcribed; `emit_outbox_claimed` gains one parameter | New `outbox-claim-field-order.test.ts` (8); accepted `outbox-journal-rows.test.ts`; gate H12 with `--seed-swap-claim-fields` |
| **C5** | **Every external-write effect**, derived from the closed catalogue | `25 §7` (OBX-02); `24 §4` ERD, `33 §6`, `35 §4` widened; new `I66` | `requiresExternalDispatch`, `INTERNAL_ONLY_ADAPTER`, and an enqueue guard returning `EFFECT_IS_INTERNAL_ONLY` | New `outbox-scope.test.ts` (8); gate H11 with `--seed-outbox-irrecoverable-only` |
| **C7** | The foundation moves to S1; the vendor half stays at S4 | `37 §2` S1 and S4; `I36`'s slice and test columns (SEQ-01) | None | Gate H13 |

**C5's fourth case, stated honestly.** `§17` asks for an internal-only effect *"if such a
class currently exists"*. **None does** — `37` S1's closed catalogue is four classes all
against a mock adapter, so all four are external-write and the existing implementation
already conformed. Adding one to make a test pass would be inventing architecture. The
predicate's **false branch is therefore exercised over a local literal** rather than a
registered class, and `outbox-scope.test.ts` says which half is which.

---

## 4. The test defect

> **TEST DEFECT FOUND AND REPAIRED.**

The accepted `post-commit-and-crash-matrix.test.ts` carried a `CLAIMED` absence whose
pattern contained two literal `0x08` BACKSPACE bytes where `\b` word boundaries were
intended. **It could never fire.** S1I disclosed it and replaced it with six absences that
do fire; `§28` directs that the correction be retained rather than the no-op preserved for
historical purity, and it is.

**And the replacement is now demonstrated rather than asserted.** A new case seeds each
forbidden token into an in-memory copy of the pusher's source and requires the replacement
to detect it, reproduces the defective pattern with `String.fromCharCode(8)` and shows it
does **not** fire on the same seeded text, and shows the intended `\bCLAIMED\b` does.

---

## 5. What did not change

- **No degraded-state halt was weakened.** Only `NORMAL` moved.
- **No override quantity, scope rule or composition bound moved.** `51 §3.6` and `I63` are
  untouched, and an override still cannot reach rows 1 or 2 in any state.
- **No model-facing field was added.** `26 §2.1`'s `ProposedIntent` gains nothing.
- **The effect idempotency key is unchanged**, with the reason recorded.
- **`case_ref` is not in the dispatch payload.**
- **`ACOS-JCS-1`'s framing is unchanged** — field framing, NULL encoding, decimal scale,
  timestamp form, Unicode form and the hash function are as v1.3.2 issued them.
- **TA-08's clock-volume rules stay at S5.** At S1 the live-clock population is
  provenance-bounded and not volume-bounded, which is *why* `§9.2.5`'s deterministic
  selection is required.
- **No transport was implemented, enabled, planned or authorised.**
- **No control-artifact signature was discharged.** Classes 3, 20 and 27 remain owed and
  runtime `I19` remains absent.

---

## 6. The pre-live-execution gate, carried forward unchanged

> **No later slice may enable a real external effect until the owner/control-artifact
> signing and integrity sequencing has been re-evaluated against the then-current
> architecture.**

**v1.3.4 EXTENDS class 20's obligation and discharges nothing.** S1I remains admissible
with classes 3, 20 and 27 unsigned **only because it stops before any vendor call**.
