# ACOS Operating Spine v1.3.4 — Verification

**Phase 2.5d. The gate for the v1.3.4 normative errata pass. Every condition can fail, and every condition is demonstrated failing.**

This document gates **only** the v1.3.4 pass. `phase2-v1.3-verification.md` (V1–V16), `phase2-v1.3.1-verification.md` (E1–E7), `phase2-v1.3.2-verification.md` (F1–F3) and `phase2-v1.3.3-verification.md` (G1–G10) remain in force unchanged and are re-run by the same script.

---

## 0. What is being gated

Seven items in two groups. **Two are architecture defects** the S1I implementation reported and refused to route around — **IRN-01** (row 1 halted IRRECOVERABLE in `NORMAL`, making the class ADR-026 is titled for permanently undispatchable) and **CSB-01** (row 3's clock operand was keyed on a relation no artifact declared, leaving clock *selection* open where `I56` had closed clock *creation*). **Five are declarations** of load-bearing points the artifacts left to convention: **OBX-01** (the outbox state machine), **OBX-02** (its scope), **OBX-03** (the dispatching transaction), **JCS-02** (the per-row-kind field order `30 §5.3` requires and never gave) and **SEQ-01** (the S1/S4 split).

**The mechanical gate is `analysis/consistency-v1.3.py`, conditions H1–H13.** It exits non-zero on any failure and carries C1–C29, E1–E7, F1–F3, G1–G10 and H1–H13 together — **48 conditions**.

```
cd analysis
PYTHONUTF8=1 python consistency-v1.3.py                                  # 48 PASS / 0 FAIL, exit 0

PYTHONUTF8=1 python consistency-v1.3.py --seed-model-case-ref            # 47 PASS / 1 FAIL  -> H1
PYTHONUTF8=1 python consistency-v1.3.py --seed-claim-case-ref            # 46 PASS / 2 FAIL  -> H1, H2
PYTHONUTF8=1 python consistency-v1.3.py --seed-global-clock-search       # 47 PASS / 1 FAIL  -> H3
PYTHONUTF8=1 python consistency-v1.3.py --seed-irrecoverable-halt        # 47 PASS / 1 FAIL  -> H5
PYTHONUTF8=1 python consistency-v1.3.py --seed-irrecoverable-loose       # 46 PASS / 2 FAIL  -> H6, H7
PYTHONUTF8=1 python consistency-v1.3.py --seed-reclaim-timeout           # 47 PASS / 1 FAIL  -> H10
PYTHONUTF8=1 python consistency-v1.3.py --seed-outbox-irrecoverable-only # 47 PASS / 1 FAIL  -> H11
PYTHONUTF8=1 python consistency-v1.3.py --seed-swap-claim-fields         # 47 PASS / 1 FAIL  -> H12

# Retained, and all still fail — this pass did not disarm the previous ones.
PYTHONUTF8=1 python consistency-v1.3.py --seed-floor-25                  # 45 PASS / 3 FAIL  -> G1, G2, G3
PYTHONUTF8=1 python consistency-v1.3.py --seed-vendor-amount             # 46 PASS / 2 FAIL  -> G1, G4
PYTHONUTF8=1 python consistency-v1.3.py --seed-lag-10m                   # 47 PASS / 1 FAIL  -> G5
PYTHONUTF8=1 python consistency-v1.3.py --seed-full-halt-15m             # 46 PASS / 2 FAIL  -> G6, G7
PYTHONUTF8=1 python consistency-v1.3.py --seed-quota-as-cause            # 45 PASS / 3 FAIL  -> G8, G9, G10
PYTHONUTF8=1 python consistency-v1.3.py --seed-generic-insert-fail       # 46 PASS / 2 FAIL  -> G9, G10
PYTHONUTF8=1 python consistency-v1.3.py --seed-old-null-bytes            # 47 PASS / 1 FAIL  -> F3
PYTHONUTF8=1 python consistency-v1.3.py --seed-old-null-sentinel         # 44 PASS / 4 FAIL  -> F1, F2, F3, H12
```

Recorded runs: `analysis/consistency-v1.3.4-output.txt` and the eight `analysis/consistency-v1.3.4-negative-control-*-output.txt` files.

**`--seed-old-null-sentinel` now fails H12 as well as F1–F3, and that is correct rather than incidental.** The seed reverts control-artifact class 20 to its v1.2 identity statement, and class 20's signed content is *"column order per row kind"* — so reverting it also removes the pointer to the orders `§5.3a` declares. Two coupled facts about one artifact fail together, which is what coupling looks like when it is real.

**Every mutation modifies the corpus IN MEMORY only. Nothing on disk is touched by a seeded run.**

**`analysis/recompute-v1.3.py` reproduces `analysis/recompute-v1.3-output.txt` line for line after this pass.** No authority quantity moved.

---

## 1. The thirteen conditions

| # | Condition | Kind |
|---|---|---|
| **H1** | The effect→case binding is declared **kernel-owned, immutable and never model-supplied**; **all nine forbidden sources are excluded by name** inside `30 §9.2.1`; `24 §3` K7 forbids a model to influence `task.case_ref`; `26 §2.1` carries `case_ref` as a kernel-computed field; and `I64` states it | required statements + a named-exclusion set parsed from `§9.2.1` |
| **H2** | Clock-bearing derives **at the decision instant** from the effect's own immutable `case_ref` against a **currently live**, `I56`-provenanced clock of the **same company and same case**; **no enqueue-time boolean, persisted column or caller parameter** is authority; both directions are live; `I65` and `VC-A6c` carry it | required statements + registry and validation-plan cross-reference |
| **H3** | A NULL `case_ref` yields a **determinate false without a lookup**, and **no operational passage** admits a global clock search, a nearest-case match or an any-clock-that-fits fallback | required positives + denylist over the whole operational corpus |
| **H4** | Several qualifying live clocks resolve **deterministically** — earliest `deadline_at`, tie-broken by ascending `clock_ref` — the **selection is separated from the boolean**, the reference is persisted **only where row 3 is the reason**, and a caller never chooses it | required statements + the journal field's nullability |
| **H5** | An otherwise-valid IRRECOVERABLE effect is **dispatch-eligible in `NORMAL`** at **every** site that states a state-qualified answer; the eligibility is **scoped to item 4 alone**; and reaching it is stated **not to assert execution** | `22 §3.1` row 1 parsed into cells + required statements in `30` |
| **H6** | IRRECOVERABLE **halts in `UNCORROBORATED_STALL`** at every site that states it | parsed cell + required statements |
| **H7** | IRRECOVERABLE **halts in `CORROBORATED_DEGRADED`** at every site, and the preservation of the degraded invariant is stated **positively** rather than merely not contradicted | parsed cell + required positive |
| **H8** | The **FULL-HALT POSTURE** halts row 1 in every state and does **not** restore it, and `§5.1a`'s rows-3-and-4-only composition is **unchanged** | required statements + an unchanged-text check on the accepted v1.3.3 rule |
| **H9** | An ordinary degraded-mode owner override **cannot unlock IRRECOVERABLE in any state**; `§5.7.2`'s scope rule and its **structural** exclusion of the class are unchanged; `22 §3.1` still says so | required new statements + three unchanged accepted ones |
| **H10** | The outbox state machine is `ENQUEUED → CLAIMED` with **no transition out of `CLAIMED`**, and **no operational passage introduces a visibility timeout, a claim expiry, a stale-lease reaper or any reclaim as a mechanism** | required statements + denylist where a hit counts only outside a refusal |
| **H11** | The outbox scope is **every external-write effect and only those**, derived from the closed catalogue rather than from recoverability or from a caller; **all three narrowly-scoped sites are widened**; `I66` states it | required statements + three site checks + registry |
| **H12** | The claim journal row's field order is **declared field by field**, **numbered 1..20 without gaps**, **matches an independent transcription held in the gate**, is stated normative with the **independence and insertion-order** obligations, and **moves control-artifact class 20** | parsed table compared element-wise to a transcription in the script |
| **H13** | The sequence **splits the outbox**: S1 builds the durable schema, tag, recovery and non-reclaimable claim; the adapter, HTTP, provider idempotency/query, unknown-outcome transition, sandbox and reconciliation **remain later**; `I36`'s two legs are attributed to the two slices that can run them | required item lists in `37` + registry slice column |

**H5, H6, H7 and H12 are the sharp ones.**

**H5–H7 parse `22 §3.1`'s row 1 into its three state cells and assert each state independently**, so the two IRN-01 seeds discriminate exactly:

| Seed | Models | Fails | Proves |
|---|---|---|---|
| `--seed-irrecoverable-halt` | the v1.3.3 defect restored — Halt in `NORMAL` too | **H5 only** | H5 *is* the `NORMAL` condition, and it is the only one that moved |
| `--seed-irrecoverable-loose` | the over-correction — Dispatch in every state | **H6 and H7 only** | the degraded halts are checked **independently** of `NORMAL`, so the correction cannot widen without failing |

**That pair is the whole claim of IRN-01's narrowness, stated mechanically.** A correction that moved more than `NORMAL` fails H6 or H7; a correction that moved less fails H5.

**H12 does not check that the order is *present*.** It parses `§5.3a`'s numbered table, checks the numbering is `1..20` with no gaps or repeats, and compares the field sequence **element by element** against a transcription held in the gate script itself. `--seed-swap-claim-fields` transposes fields 8 and 9 — a mutation that leaves every field present, every number present and the table well-formed — and H12 fails on it. **A membership check would pass that seed.** This is what `30 §5.3`'s *"declared per row kind, in the specification"* has to mean if it is to be a constraint on two independent implementations.

---

## 2. What this gate does not check, stated

- **It does not check any implementation.** These are conditions over the architecture corpus. The repository's own verification — the migrations, the classifier, the claim service, the dual-plane journal suites and the ten-plus vulnerable controls — is where the corresponding behavioural properties are proved, and `docs/implementation/S1I-result.md` reports them.
- **It does not check that the class-20, class-3 or class-27 signatures exist.** They do not. All three remain owed, and runtime `I19` remains absent. The gate checks that the artifacts **say** the obligation is owed, not that it is discharged.
- **It does not check for external exactly-once.** No transport exists, none is enabled by this pass, and `I36`'s verification leg is explicitly reported as remaining at S4.
- **It does not bound live-clock volume.** TA-08's three rules stay at S5. `§9.2.5`'s deterministic selection is required *because* the population is unbounded at S1, and the gate checks the selection rule rather than the population.

---

## 3. Result

```
48 PASS / 0 FAIL, exit 0
```

Eight new negative controls, each failing at least one H condition; six retained v1.3.3 controls and two retained v1.3.2 controls, all still failing. **`docs/architecture/v1.3.3/` is byte-identical to its issue and is not modified by this pass.**
