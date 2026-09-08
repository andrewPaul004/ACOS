# ACOS Operating Spine v1.3.2 — Errata Verification

**Phase 2.5b. The gate for `phase2-v1.3.2-errata.md`.**

**RESULT: 25 conditions, 25 PASS, 0 FAIL.** The twenty-two conditions v1.3.1 gated on are re-run unmodified and all still pass; three new conditions — **F1, F2, F3** — gate the `ACOS-JCS-1` NULL-framing correction (JCS-01). Both seeded negative controls **FAIL as required**.

`analysis/consistency-v1.3.py` is the executable gate and exits non-zero on any failure. The recorded runs are `analysis/consistency-v1.3.2-output.txt` (clean) and `analysis/consistency-v1.3.2-negative-control-output.txt` (both seeded runs, with process exit codes).

**No mechanism was introduced. No authority quantity moved. `analysis/recompute-v1.3.py` reproduces `analysis/recompute-v1.3-output.txt` line-for-line identically.**

---

## 1. Prior conditions — all twenty-two still pass

`consistency-v1.3.py` carries C1–C6, C21–C29 (v1.3) and E1–E7 (v1.3.1). Every one was re-run against the v1.3.2 tree **with its condition text unmodified**, and every one passes:

| Group | Conditions | Result |
|---|---|---|
| v1.3 blockers, counts and denylists | C1, C2, C3, C4, C5, C6 | **6 PASS** |
| v1.3 semantic denylists and registry arithmetic | C21, C22, C23, C24, C25, C26, C27, C28, C29 | **9 PASS** |
| v1.3.1 errata conditions | E1, E2, E3, E4, E5, E6, E7 | **7 PASS** |

**22 PASS / 0 FAIL on the carried conditions.** In particular **E1 still passes** — the rate-class Step R denylist is untouched by this pass — and **C4 still passes**: every deliverable still declares `Operating Spine v1.3` in its version line, because the architecture is v1.3 and `v1.3.2` is the package issue.

---

## 2. F1 — the corrected NULL framing is stated, and the withdrawn rule is not

**Two halves, and both must hold.**

**Positive.** Seven statements must be present in `30 §5.3`:

| # | Required statement |
|---|---|
| 1 | ``**`0xFFFFFFFF` is RESERVED and means NULL**`` |
| 2 | *"a NULL field is that word alone with no payload"* |
| 3 | ``` `0 <= payload_length <= 0xFFFFFFFE` ``` |
| 4 | *"is not representable and the implementation must fail closed"* |
| 5 | *"disjoint by construction"* — the injectivity consequence |
| 6 | **"No non-null payload rule changed in v1.3.2."** — the compatibility guarantee |
| 7 | *"changes class 20's signed content and therefore its `content_hash`"* |

**Negative.** Three denylist patterns must have **zero** non-historical hits across the operational corpus:

| Pattern | What it catches |
|---|---|
| `sentinel byte for null` | v1.2's withdrawn NULL rule stated as the rule |
| ``single `0x00` sentinel`` | the one-byte sentinel named as current |
| `4-byte big-endian byte length**, so` | the v1.2 framing row, i.e. framing stated without the reserved word |

A hit is **historical** only where the line says so. F1 extends v1.3.1's strict `EXPLICIT_HIST` marker set with the words `30 §5.3` actually uses to record the defect — `withdrawn`, `got wrong`, `not injective`, `v1.2's rule` — so the paragraph that records what v1.2 got wrong does not trip the condition it exists to explain, and a line that merely *mentions* `v1.2` still does.

**F1 PASS** — 7 required statements present; 3 denylist patterns, 0 normative hits.

---

## 3. F2 — the two cross-references agree with `30 §5.3`

`ACOS-JCS-1` is cited normatively in two other places, and a correction that left either behind would leave the package self-contradictory.

| Artifact | Required statement | Result |
|---|---|---|
| `36 §2`, the `VC-A3` case | *"SQL NULL (`FF FF FF FF`) distinct from empty string"* | **present** |
| `36 §2`, the `VC-A3` case | *"restoring v1.2's one-byte `0x00` NULL sentinel **must fail this case**"* | **present** |
| `50 §2`, class 20 | ``**NULL framing under the reserved `0xFFFFFFFF` length word**`` | **present** |
| `50 §2`, class 20 | *"changes this class's `content_hash` and requires a fresh owner signature"* | **present** |

The second row is deliberately the **whole clause** rather than the phrase *"must fail this case"* on its own: `36` carries an unrelated mandatory negative control (the REPEATABLE READ race) whose text contains that phrase, and a needle that another passage can satisfy is not a condition.

**F2 PASS** — 4 required cross-reference statements present.

---

## 4. F3 — the worked examples are parsed and compared, not merely present

F1 and F2 check that text exists. **F3 checks that the bytes are right**, because the defect JCS-01 corrects was two representations printing the same bytes, and that is a computable property.

The condition parses `30 §5.3`'s worked-example table, extracts the single hex-byte code span from each row's second cell, and asserts:

| Assertion | Why |
|---|---|
| exactly five rows parse | a row silently dropped would remove a distinction |
| SQL `NULL` = `FF FF FF FF` | the reserved word |
| **no other row** encodes to `FF FF FF FF` | the reserved word belongs to NULL alone |
| empty string = empty `bytea` = `00 00 00 00` | both are zero-length values, deliberately equal |
| `bytea` `'\x00'` ≠ SQL `NULL` | **the demonstrated defect, now closed** |
| `bytea` `'\x00'` ≠ empty string | length 1 versus length 0 |
| JSON literal `null` ∉ {SQL `NULL`, empty string, `bytea` `'\x00'`} | RFC 8785 `null` is an ordinary non-null payload |
| five rows yield exactly four distinct encodings | the only permitted equality is the two zero-length rows |

**F3 PASS** — parsed 5 rows: `null=FF FF FF FF`, `emptyText=00 00 00 00`, `emptyBytes=00 00 00 00`, `bytes00=00 00 00 01 00`, `jsonNull=00 00 00 04 6E 75 6C 6C`; 4 distinct.

---

## 5. Negative controls — the new conditions can fail, and the old rule makes them fail

A consistency pass that has never failed is indistinguishable from one that cannot. `consistency-v1.3.py` takes two flags, each of which **restores the withdrawn v1.2 rule in the in-memory corpus only** — nothing on disk is modified — and each of which must produce failures.

### Control A — `--seed-old-null-sentinel`

The whole withdrawn rule is restored: `30 §5.3`'s NULL row, its framing row, its worked-example table, its injectivity statement, its defect record and its class-20 sentence, plus the `36` and `50` cross-references. Six edits, all applied.

| Condition | Result | Why |
|---|---|---|
| F1 | **FAIL** | all 7 required statements missing; all 3 denylist patterns hit, including `30 §5.3` line 261 *"Single `0x00` sentinel byte for null"* |
| F2 | **FAIL** | 3 of 4 cross-reference statements missing |
| F3 | **FAIL** | 0 rows parse — the worked-example table is gone |

**22 PASS / 3 FAIL, process exit code 1.**

### Control B — `--seed-old-null-bytes` — the sharper one

The worked-example table **survives** and only SQL `NULL`'s bytes revert to v1.2's framed sentinel `00 00 00 01 00`. Everything else in the package is the corrected text, so F1 and F2 still pass and **F3 fails on the collision itself**:

```
F3    FAIL
      parsed 5 rows: null=00 00 00 01 00 emptyText=00 00 00 00
      emptyBytes=00 00 00 00 bytes00=00 00 00 01 00
      jsonNull=00 00 00 04 6E 75 6C 6C; distinct=3
```

`null` and `bytes00` are the same five bytes, and five rows yield three distinct encodings rather than four. **This is JCS-01, reproduced mechanically, and it is what the corrected package no longer permits.**

**24 PASS / 1 FAIL, process exit code 1.**

Both runs are recorded verbatim in `analysis/consistency-v1.3.2-negative-control-output.txt`.

---

## 6. Recomputation — no authority-number change

`analysis/recompute-v1.3.py` was rerun **unmodified** against the v1.3.2 tree and its output **diffs clean against the recorded `analysis/recompute-v1.3-output.txt`** — every line identical, zero differing lines.

| Quantity | v1.3.1 | v1.3.2 |
|---|---|---|
| `MAL_monetary(month)` | $300.00 | **$300.00** |
| `Standing(month)`, 28/29/30-day | $182.40 | **$182.40** |
| `Standing(month)`, 31-day | $186.00 | **$186.00** |
| `MIE_cost(month)`, p95 | $270.00 | **$270.00** |
| `MAL_total(month)`, signature basis | $756.00 | **$756.00** |
| `MAL_total(day)`, p95 | $329.50 | **$329.50** |
| Realisable cash line | $906.00 | **$906.00** |
| First `campaign.budget.set` in a clean window | PERMIT | **PERMIT**, unchanged |

**No authority quantity changed. No owner re-signature of the MAL basis is required.**

This pass could not have moved these numbers — it corrects a byte encoding, not a quantity — and the recomputation is run anyway, because that is the only way the claim is worth making.

---

## 7. What did change, stated exactly

| | |
|---|---|
| Normative rule changed | **one** — `ACOS-JCS-1` field-level NULL framing |
| Deliverables edited | **three** — `30 §5.3`, `36 §2`'s `VC-A3` case, `50 §2` class 20 |
| Mechanisms introduced | **none** |
| Authority ceilings, windows, MAL | **unchanged** |
| Step ordering (`26 §7`) | **unchanged** |
| Audit cadence, k, staleness bounds (`30 §5.4`) | **unchanged** |
| Mirror state machine, `MirrorInputStallSignal`, `DegradedModeOverride` (`30 §5.6`, `§5.7.1`, `§5.7.2`) | **unchanged** |
| Dispatch precedence list (`30 §5.1`) | **unchanged** |
| Grant, exposure and policy semantics (`26`) | **unchanged** |
| Invariant registry | **unchanged** — no invariant added, removed, or restated |
| Control-artifact classes affected | **one** — class 20's `content_hash`, requiring a fresh class-20 signature |
| `docs/architecture/v1.3.1/` | **not modified** |

---

## 8. Scope statement

This was a normative errata gate over one control artifact. **No adversarial review was performed, no mechanism was introduced, no ceiling or window was changed, MAL was not changed, and Option A remains the selected architecture.** `redteam3/62 §5` is unchanged and no fourth review is scheduled.

Three things this pass leaves open and does not pretend to have closed:

1. **The chain-versioning and re-anchor procedure for a canonical-format change on a deployed chain.** `30 §5.3` says such a change *"requires a declared migration with a re-anchor"*, and that procedure is still undeclared. It is not owed at v1.3.2 — nothing is deployed and no anchor has been published — and it **is** owed before any canonical-format change is ever applied to a live journal. Recorded in `phase2-v1.3.2-errata.md §1` *Deployment*.
2. **A fresh class-20 owner signature.** The manifest content hash for `ACOS-JCS-1` moves with this correction and `50 §3`'s signing ceremony has not been performed. No deployment is authorised, so nothing is blocked by this today.
3. **Everything v1.3.1 §11 left open**, unchanged in disposition: TB-07's per-adapter cessation specification, TB-08(a), TB-11, TB-13, and `37 §1`'s nine properties against registry `§2.7`'s ten groupings.

The ten pass-revocation conditions in `62 §11`, carried into `phase2-v1.3-implementation-brief.md §7`, remain live throughout S1.
