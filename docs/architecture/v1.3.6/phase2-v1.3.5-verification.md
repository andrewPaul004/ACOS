# ACOS Operating Spine v1.3.5 — Verification

**Phase 2.5e. The gate for the v1.3.5 normative errata pass. Every condition can fail, and every condition is demonstrated failing.**

This document gates **only** the v1.3.5 pass. `phase2-v1.3-verification.md` (V1–V16), `phase2-v1.3.1-verification.md` (E1–E7), `phase2-v1.3.2-verification.md` (F1–F3), `phase2-v1.3.3-verification.md` (G1–G10) and `phase2-v1.3.4-verification.md` (H1–H13) remain in force unchanged and are re-run by the same script.

---

## 0. What is being gated

Six items in two groups. **Two are architecture defects** the S1J implementation reported and refused to route around — **MIE-01** (*"consume the irrecoverable unit"* stated four times as a ledger movement, with no declared movement, no declared reservation, and therefore no unit to consume) and **SER-01** (`25 §14`'s single continuous propose→authorise→execute lease, which `25 §7`'s own asynchronous outbox makes unachievable). **Three are declarations** of load-bearing points the artifacts left open: **OBX-04** (the adapter outcome taxonomy, and `24 §3` K4's retry corrected where it contradicted OBX-01), **OBX-05** (`NOT_SENT_CONFIRMED` and known-not-sent local state) and **JCS-03** (`acos.journal.dispatch_outcome.v1`'s field order). **One is a re-sequencing**: **SEQ-02** moves the local execution semantics to S1 and leaves every provider-dependent item later.

**The mechanical gate is `analysis/consistency-v1.3.py`, conditions J1–J16.** It exits non-zero on any failure and carries C1–C29, E1–E7, F1–F3, G1–G10, H1–H13 and J1–J16 together — **64 conditions**.

```
cd analysis
PYTHONUTF8=1 python consistency-v1.3.py                                      # 64 PASS / 0 FAIL, exit 0

PYTHONUTF8=1 python consistency-v1.3.py --seed-no-mie-reservation            # 63 PASS / 1 FAIL  -> J1
PYTHONUTF8=1 python consistency-v1.3.py --seed-caller-mie-units              # 63 PASS / 1 FAIL  -> J2
PYTHONUTF8=1 python consistency-v1.3.py --seed-unknown-to-realised           # 63 PASS / 1 FAIL  -> J3
PYTHONUTF8=1 python consistency-v1.3.py --seed-unknown-releases-mie          # 62 PASS / 2 FAIL  -> J3, J4
PYTHONUTF8=1 python consistency-v1.3.py --seed-returned-awaiting-irrecoverable # 63 PASS / 1 FAIL -> J5
PYTHONUTF8=1 python consistency-v1.3.py --seed-i20-current-balance           # 63 PASS / 1 FAIL  -> J6
PYTHONUTF8=1 python consistency-v1.3.py --seed-not-sent-as-never-sent        # 63 PASS / 1 FAIL  -> J7
PYTHONUTF8=1 python consistency-v1.3.py --seed-known-failure-requeues        # 62 PASS / 2 FAIL  -> J8, J9
PYTHONUTF8=1 python consistency-v1.3.py --seed-optional-dispatch-lease       # 62 PASS / 2 FAIL  -> J10, J14
PYTHONUTF8=1 python consistency-v1.3.py --seed-old-one-session               # 62 PASS / 2 FAIL  -> J10, J11
PYTHONUTF8=1 python consistency-v1.3.py --seed-no-dispatch-revalidation      # 62 PASS / 2 FAIL  -> J12, J13
PYTHONUTF8=1 python consistency-v1.3.py --seed-gap-mutation-dispatches       # 62 PASS / 2 FAIL  -> J13, J15
PYTHONUTF8=1 python consistency-v1.3.py --seed-swap-outcome-fields           # 63 PASS / 1 FAIL  -> J16

# Retained, and all still fail — this pass did not disarm any previous control.
PYTHONUTF8=1 python consistency-v1.3.py --seed-model-case-ref            # 63 PASS / 1 FAIL  -> H1
PYTHONUTF8=1 python consistency-v1.3.py --seed-claim-case-ref            # 62 PASS / 2 FAIL  -> H1, H2
PYTHONUTF8=1 python consistency-v1.3.py --seed-global-clock-search       # 63 PASS / 1 FAIL  -> H3
PYTHONUTF8=1 python consistency-v1.3.py --seed-irrecoverable-halt        # 63 PASS / 1 FAIL  -> H5
PYTHONUTF8=1 python consistency-v1.3.py --seed-irrecoverable-loose       # 62 PASS / 2 FAIL  -> H6, H7
PYTHONUTF8=1 python consistency-v1.3.py --seed-reclaim-timeout           # 63 PASS / 1 FAIL  -> H10
PYTHONUTF8=1 python consistency-v1.3.py --seed-outbox-irrecoverable-only # 63 PASS / 1 FAIL  -> H11
PYTHONUTF8=1 python consistency-v1.3.py --seed-swap-claim-fields         # 62 PASS / 2 FAIL  -> H12, J16
PYTHONUTF8=1 python consistency-v1.3.py --seed-floor-25                  # 61 PASS / 3 FAIL  -> G1, G2, G3
PYTHONUTF8=1 python consistency-v1.3.py --seed-vendor-amount             # 62 PASS / 2 FAIL  -> G1, G4
PYTHONUTF8=1 python consistency-v1.3.py --seed-lag-10m                   # 63 PASS / 1 FAIL  -> G5
PYTHONUTF8=1 python consistency-v1.3.py --seed-full-halt-15m             # 62 PASS / 2 FAIL  -> G6, G7
PYTHONUTF8=1 python consistency-v1.3.py --seed-quota-as-cause            # 61 PASS / 3 FAIL  -> G8, G9, G10
PYTHONUTF8=1 python consistency-v1.3.py --seed-generic-insert-fail       # 62 PASS / 2 FAIL  -> G9, G10
PYTHONUTF8=1 python consistency-v1.3.py --seed-old-null-bytes            # 63 PASS / 1 FAIL  -> F3
PYTHONUTF8=1 python consistency-v1.3.py --seed-old-null-sentinel         # 59 PASS / 5 FAIL  -> F1, F2, F3, H12, J16
```

Recorded runs: `analysis/consistency-v1.3.5-output.txt` and the thirteen `analysis/consistency-v1.3.5-negative-control-*-output.txt` files.

**Two retained seeds now fail one additional condition each, and both are real coupling rather than incidental breakage.**

- **`--seed-swap-claim-fields` now fails J16 as well as H12.** Fields 8 and 9 — `effect_id` and `authorisation_id` — are **identically named in both declared row kinds**, so the transposition lands in both tables. One mutation, two row kinds, two failures. That is what a shared field pair looks like when the coupling is real.
- **`--seed-old-null-sentinel` now fails J16 as well as F1–F3 and H12.** The seed reverts control-artifact class 20 to its v1.2 identity statement, and class 20's signed content is *"column order per row kind"* — so reverting it removes the pointer to **both** orders `§5.3a` declares. v1.3.4 recorded the same coupling for H12; v1.3.5 extends it for the same reason.

**Every mutation modifies the corpus IN MEMORY only. Nothing on disk is touched by a seeded run.**

**`analysis/recompute-v1.3.py` reproduces `analysis/recompute-v1.3-output.txt` line for line after this pass.** No authority quantity moved.

---

## 1. The sixteen conditions

| # | Condition | Kind |
|---|---|---|
| **J1** | Every authorised IRRECOVERABLE external effect **reserves** its declared irrecoverable units at local authorisation, into `reserved_irrecoverable`, on **every** applicable MIE window instance — not the first, not a primary, not the most permissive; `26 §7` step R states it; `24 §3` K5 prints the RESERVE transition; `I67` carries it | required statements in three artifacts + registry |
| **J2** | `irrecoverable_units` is **declared per action class in the closed catalogue**, is `1` for every IRRECOVERABLE class and `0` otherwise, is **never model- or caller-supplied**, admits **no implicit default**, and is signed control-artifact content | required positives + required negatives + the printed table + class 17 |
| **J3** | An IRRECOVERABLE effect with an unknown outcome reaches `PRESUMED_EXECUTED` and the movement is **`reserved → presumed`**, stated **positively** as *not* `reserved → realised`; `24 §3` K5 prints it; and **`I3`'s term 3 has exactly one producer per ledger** | required statements + the transition row in two artifacts + registry operand |
| **J4** | The movement leaves the **three-term sum unchanged** and **creates no headroom**, stated in `25 §10.1`, `24 §3` K5 and `I3`; and **nothing is released on an unknown outcome** | required positives in three artifacts |
| **J5** | `ADAPTER_RETURNED` on an IRRECOVERABLE effect reaches **`PRESUMED_EXECUTED`** and performs the same movement **exactly once**, while REVERSIBLE and COMPENSABLE keep the awaiting-verification state; and **an adapter response is never independent verification** | parsed taxonomy rows + required statements + ADR-026 |
| **J6** | `I20`'s right-hand side is the **immutable historical committed-reservation basis**, not the current `reserved_irrecoverable` column, **with the inversion reason stated**; no ACOS-side or mock quantity may stand in for its left-hand side; and `I20` is recorded **OPEN** | required statements + registry + the substitution ban |
| **J7** | `NOT_SENT_CONFIRMED` is admissible only on **positive trusted-adapter proof** and **never from an error string**, reaches a state **distinct** from the later provider-reconciled `NEVER_SENT`, releases with **no presumed or realised increment**, **touches no presumed unit**, and anything that may have escaped is `OUTCOME_UNKNOWN` | 7 required statements + K4's distinctness + `I69` |
| **J8** | `DISPATCH_NOT_SENT_CONFIRMED` is **terminal** and never returns the same claimed row to `ENQUEUED`, `READY`, a retry state or a second claim; a further attempt is a **new proposal, authorisation and effect/outbox identity**; and `I36` records that **no outcome makes a claimed row claimable again** | the full forbidden-destination set + registry |
| **J9** | The generic post-claim `ADAPTER_FAILED → retry` is **prohibited**: `24 §3` K4's wording is **CORRECTED**, `ADAPTER_FAILED` carries no local policy and reaches no state, ADR-026 records it, and **the old unqualified sentence survives nowhere in the operational corpus** | required corrections + a denylist over the whole operational corpus |
| **J10** | **Two epochs are declared by name** — an authority lease and a **dispatch lease** — each held **continuously with no release or reacquisition inside it**; the gap holds **no session lock as an explicit property** with its **five named** safety mechanisms; the dispatch lease is stated **NOT to be the same lease**; `I70` carries it | required statements + the named mechanism set + registry |
| **J11** | v1.3.4's single-continuous-lease wording is **explicitly superseded with its reason**, VC-C3 states the old wording **is not the guarantee and is not to be asserted**, a later reacquisition is stated not to be the same lease, and **no operational passage still prints the unqualified span** | required supersession + denylist where a hit counts only outside the supersession |
| **J12** | Dispatch-time revalidation is **mandatory**, revalidates the **originally authorised** effect against **current** state using the original identity facts, is the **equivalent of C′'s content-addressed non-substitution check**, **constructs no payload** and **substitutes no option**; `I53` extends to the dispatch boundary | 7 required statements + registry + `26 §7` |
| **J13** | **The claim cannot occur before revalidation.** `30 §5.1`'s ordering block places the dispatch lease and the revalidation **ahead of the claim's `BEGIN`** — checked by string **position**, not membership — a claim before revalidation is a declared defect, a revalidation outside the lease **proves nothing**, and a stale effect **REFUSES** the claim | required statements + a printed-order position check |
| **J14** | The dispatch lease **spans all seven steps in order** — revalidation, claim-time authority, CLAIM, CLAIM COMMIT, adapter, outcome transaction, OUTCOME COMMIT — held continuously with no release or reacquisition inside the epoch, and VC-C3(b) validates the exclusion with a **real two-session test** | the seven-step list, checked **in printed order** + continuity + validation plan |
| **J15** | A stale effect after a legitimate gap mutation **REFUSES** the claim with nothing dispatched and nothing substituted; the reservation is **left held with no invented release**; the denial is **coarse**; VC-C3(b) requires **both** unsafe implementations to fail; and a **crash inside the dispatch epoch is not a reclaim path** | required statements in three artifacts + the must-fail obligation |
| **J16** | `acos.journal.dispatch_outcome.v1`'s order is **declared field by field**, **numbered 1..20 without gaps**, **matches an independent transcription held in the gate element-wise**, **names the adjacent same-typed swap pair**, **carries no MIE quantity**, must fail VC-A3 on a seeded swap, and **moves control-artifact class 20 a third time** | parsed table compared element-wise + required obligations + manifest |

**J13, J14, J16 and J9 are the sharp ones.**

**J13 and J14 check ORDER, not membership.** J13 asserts that `30 §5.1`'s printed ordering block has `acquire the DISPATCH LEASE` **before** `dispatch-time revalidation` **before** `SELECT ... FOR UPDATE on the dispatch_outbox row`, by comparing string offsets. J14 walks the seven span steps and requires each to appear **at a later offset than the last**. A block that listed the right steps in the wrong order would pass a membership check and fails both of these. That matters because **the whole content of SER-01 is an ordering claim** — a revalidation performed after the claim, or a lease acquired after the revalidation, proves nothing at all.

**J16 does not check that the order is present.** It parses `§5.3a`'s second numbered table, checks the numbering is `1..20` with no gaps or repeats, and compares the field sequence **element by element** against a transcription held in the gate script. `--seed-swap-outcome-fields` transposes fields 15 and 16 — same type, same framing, adjacent, both still present, numbering still well-formed — and J16 fails on it. **A membership check would pass that seed.**

**J9 is a denylist with a deliberate exemption, and the exemption is the interesting part.** The old sentence *"bounded retry with jitter against the same idempotency key"* must survive **nowhere** in the operational corpus as a live rule — but `25 §7.1` legitimately **quotes** it in order to correct it. The condition therefore exempts only lines that attribute the quote (`K4's failure behaviour said`) or state the correction on the same line (`is corrected to`), and counts every other occurrence as a hit. **An unattributed reappearance of the sentence fails J9**, which is exactly the regression the condition exists to catch: `S1J-C2`'s defect was two artifacts of equal standing giving one condition two behaviours, and the way that returns is by someone restoring the shorter sentence.

**J1–J4 form a matched set over the MIE lifecycle, and the two ledger seeds discriminate between them:**

| Seed | Models | Fails | Proves |
|---|---|---|---|
| `--seed-no-mie-reservation` | the v1.3.4 defect restored — nothing reserves a unit | **J1 only** | J1 *is* the reservation condition, and removing it moves nothing else |
| `--seed-unknown-to-realised` | the consumption realises directly | **J3 only** | J3 owns the destination of the movement |
| `--seed-unknown-releases-mie` | the consumption releases instead of moving | **J3 and J4** | the movement's destination and the sum's invariance are checked **together on one row**, because they are one fact about one row |
| `--seed-caller-mie-units` | the unit count becomes a request field | **J2 only** | the ownership condition is independent of the lifecycle conditions |

**That set is the whole claim of MIE-01's narrowness, stated mechanically.** A declaration that reserved but consumed wrongly fails J3 or J4; one that consumed correctly but reserved nothing fails J1; one that got both right but handed the unit count to a caller fails J2.

**J10, J11 and J14 are likewise matched over SER-01:**

| Seed | Models | Fails | Proves |
|---|---|---|---|
| `--seed-old-one-session` | v1.3.4's wording restored, no async protocol | **J10 and J11** | the supersession and the two-epoch declaration are separable, and reverting the wording takes out both |
| `--seed-optional-dispatch-lease` | the second epoch made advisory | **J10 and J14** | the epoch's *existence* and its *span* are separate conditions |
| `--seed-no-dispatch-revalidation` | the revalidation gate deleted | **J12 and J13** | the gate's existence and its position relative to the claim are separate conditions |
| `--seed-gap-mutation-dispatches` | the stale effect dispatches | **J13 and J15** | the refusal and the ordering that makes it possible are checked together, because a refusal that ran after the claim would not be a refusal |

---

## 2. What the gate does NOT prove

**The gate is a mechanical consistency pass over the architecture corpus. It reads documents.** It does not execute code, does not touch a database, and proves nothing whatsoever about an implementation.

In particular, and stated here so no reader takes the 64/0 result for more than it is:

- **it does not prove that any implementation reserves an irrecoverable unit**, only that the architecture declares that one must be reserved;
- **it does not prove that any ledger movement is atomic**, only that the artifacts require it to be;
- **it does not prove that a dispatch lease is held**, only that the architecture declares its span;
- **it does not prove that a stale effect is refused at runtime**, only that refusal is the declared behaviour;
- **and it proves nothing at all about a vendor.** `I20`, `I36`'s verification leg and VAL-04 are untouched by a document check.

The runtime obligations are `36 §2.3`'s VC-C3(a), VC-C3(b) and VC-C3(c), and they require real PostgreSQL, real two-session concurrency, real kill points and — for the vendor half — a real provider that does not yet exist.

---

## 3. Package integrity

**`docs/architecture/v1.3.4/` is unmodified by this pass and is byte-identical to its issued state.** So are `v1.3.3`, `v1.3.2` and `v1.3.1`. v1.3.5 is a new directory; no prior issue is edited in place.

**Architecture = Operating Spine v1.3. Package issue = v1.3.5.** Every numbered deliverable continues to declare `Operating Spine v1.3` in its version line.
