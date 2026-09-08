# S1I — Final Acceptance

**Architecture: Operating Spine v1.3. Package issue: v1.3.4.**
**Candidate reviewed: `2d5193b`. Implementation commit: `dec85eb`. Accepted predecessor: `8ce0d41`.**

This document is the S1I freeze. `S1I-owner-resolution.md` is the disposition of the seven
clarifications; `docs/architecture/v1.3.4/phase2-v1.3.4-errata.md` is the normative record;
`S1I-result.md` is the implementation report, carrying a supersession banner for the parts
v1.3.4 changed.

---

## 1. Baseline, confirmed before any edit

```
$ git rev-parse HEAD          2d5193b24c7ec85d8b555263c0468adfb959b7fa
$ git status --porcelain      (clean)
$ npm run verify              120 files / 1797 tests / 1797 passed / 0 failed / 0 skipped
                              exit 0, 644.79s
```

---

## 2. What this pass changed, in one table

| Item | Kind | Behaviour changed | Authority quantities |
|---|---|---|---|
| **CSB-01** (S1I-C1) | **Architecture defect** | `effect.case_ref` declared; row 3 reachable and unforgeable | **None** |
| **IRN-01** (S1I-C6) | **Architecture defect** | Row 1 state-qualified: eligible in `NORMAL` only | **None** |
| **OBX-01** (S1I-C2) | Declaration | `ENQUEUED → CLAIMED`, no reclaim | **None** |
| **OBX-02** (S1I-C5) | Declaration | Scope is external-write, catalogue-derived | **None** |
| **OBX-03** (S1I-C3) | Declaration | The claim transaction is the dispatching transaction | **None** |
| **JCS-02** (S1I-C4) | Declaration | Row-kind field order is normative; field 18 added | **None** |
| **SEQ-01** (S1I-C7) | Sequencing | Outbox foundation at S1; vendor half at S4 | **None** |

`recompute-v1.3.py` reproduces `recompute-v1.3-output.txt` **line for line**.

---

## 3. The two defects, and what each cost

**CSB-01.** Row 3's operand is keyed on `statutory_clock.case_ref` and **no artifact related
a `case_ref` to an effect**. `I56` closes clock *creation* and says nothing about clock
*selection*, so the one relaxation in the architecture was answerable only by a guess a
model could steer — `30 §9.1`'s lever, reached from the other end.

**IRN-01.** `22 §3.1` printed row 1 Halt/Halt/Halt. Composed with `30 §5.1` item 5 and
`51 §3.6`'s DATABASE CHECK, **an IRRECOVERABLE effect was never dispatch-eligible anywhere,
with or without an owner override** — so ADR-026's title, `25 §7`'s outbox, `25 §5`'s
`PRESUMED_EXECUTED` branch, `I20` and `37` S4's autonomous sends specified mechanisms with
no reachable subject.

**Both were reported by the S1I implementation and routed around by neither.** That is the
outcome `§51` of the S1I mandate was written to produce, and it is the reason this pass had
something to resolve rather than something to discover.

---

## 4. The narrowness of the IRN-01 correction, proved twice

| Seed | Models | Fails |
|---|---|---|
| `--seed-irrecoverable-halt` | v1.3.3 restored — Halt in `NORMAL` too | **H5 alone** |
| `--seed-irrecoverable-loose` | over-correction — eligible in every state | **H6 and H7 alone** |

A correction that moved more than `NORMAL` fails H6 or H7; one that moved less fails H5.
The runtime control `unsafeIrrecoverableRow1` says the same thing about production: it
**denies where production permits in `NORMAL`** and **agrees with production in every
degraded condition**.

---

## 5. Verification

| Gate | Result |
|---|---|
| `analysis/consistency-v1.3.py` | **48 PASS / 0 FAIL**, exit 0 |
| Eight new seeded controls (H1–H13) | all fail; each maps to its declared conditions |
| Six retained v1.3.3 controls, two retained v1.3.2 controls | **all still fail** — no pass was disarmed |
| `recompute-v1.3.py` | line-for-line identical |
| `docs/architecture/v1.3.1/`, `v1.3.2/`, `v1.3.3/` | **byte-identical**, 84 files each, zero diff |
| `npm run verify` | see `§12` of the final report |

---

## 6. What is still open

Everything `S1I-result.md §18` carried, minus the two legs the resolutions closed, plus one
extended obligation:

- **Real external dispatch, `I36`'s six-kill-point verification against a real ESP sandbox,
  external exactly-once, provider idempotency, provider query, the unknown-outcome
  transition, `PRESUMED_EXECUTED`, delivery-event reconciliation, `VERIFIED`, `NEVER_SENT`
  — OPEN.** No transport of any kind exists.
- **`I20`** — no provider. An outbox row count is not a provider accepted count. **OPEN.**
- **`I8`** — no vendor credential. **OPEN.**
- **`VC-C3`** — the external execute span. **PARTIAL.**
- **`O4`**, control-artifact key management, runtime **`I19`** — **OPEN / NOT IMPLEMENTED.**
- **Control-artifact signatures: classes 3, 20 and 27 all remain owed**, and **v1.3.4
  EXTENDS class 20's obligation** to cover a further declared row-kind order.
- **TA-08's clock-volume rules** stay at S5. At S1 the live-clock population is
  provenance-bounded and not volume-bounded.
- **Two PostgreSQL containers on one machine** are not `30 §5`'s separation. Carried from
  S1G. **OPEN.**

### The pre-live-execution gate, carried forward unchanged

> **No later slice may enable a real external effect until the owner/control-artifact
> signing and integrity sequencing has been re-evaluated against the then-current
> architecture.**

S1I remains admissible with classes 3, 20 and 27 unsigned and runtime `I19` absent **only
because it stops before any vendor call**.

---

## 7. Recommended next slice

**S1J — the effect gateway's dispatch composition against a mock adapter, with the
unknown-outcome transition and the recoverability-keyed policy.**

**Name only. Not implemented, not designed, and not begun.**
