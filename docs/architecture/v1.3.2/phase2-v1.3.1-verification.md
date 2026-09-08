# ACOS Operating Spine v1.3.1 — Errata Verification

**Phase 2.5a. Issued 2026-09-03. Mechanical verification of the corrections recorded in `phase2-v1.3.1-errata.md`.**

Two scripts were run against the corrected tree: `analysis/consistency-v1.3.py`, extended with conditions **E1–E7**, and `analysis/recompute-v1.3.py`, unmodified. The full run is retained verbatim at `analysis/consistency-v1.3.1-output.txt`.

**Headline: 22 conditions, 22 PASS, 0 FAIL. Recomputation byte-identical to the recorded v1.3 output.**

---

## 1. Existing verification result — all fifteen v1.3 conditions still pass

Every pre-existing condition was rerun after every edit. None was weakened, disabled or rewritten.

| Condition | Result | Detail |
|---|---|---|
| C1 | **PASS** | 14/14 BLOCKING ids with exactly one ledger heading |
| C2 | **PASS** | 14 dispositions, all APPLIED or APPLIED WITH EXPLICIT RESIDUAL, zero NOT APPLIED |
| C3 | **PASS** | 9/9 v1.3 verification cases present in `36` |
| C4 | **PASS** | 21/21 deliverables declare v1.3 in their version line |
| C5 | **PASS** | No operational passage states `$600` as a current `MAL_total` |
| C6 | **PASS** | No operational passage states `$180` as a standing basis |
| C21 | **PASS** | Every operational mirror-outage statement is state-qualified |
| C22 | **PASS** | The printed `I3` commitment guard carries all four operands |
| C23 | **PASS** | 8 semantic-denylist patterns, 0 operational hits |
| C24 | **PASS** | `REVOKED` has zero outbound transitions in every operational statement |
| C25 | **PASS** | No site states the `I8` bound as a bare *"inverse-sweep cadence"* |
| C26 | **PASS** | `I62` and `I63` resolve and are multiply cited |
| C27 | **PASS** | Every invariant identifier used operationally resolves in the registry |
| C28 | **PASS** | `§2.8`'s enumeration contains 23 rows, matching `§0` |
| C29 | **PASS** | `57 + 13 = 70` |

**C4 note.** The numbered deliverables still declare `Operating Spine v1.3`, which is correct: the architecture is v1.3 and unchanged. `v1.3.1` is the package issue, not an architecture version. C4 was not relaxed to accommodate this — the string it tests is unchanged.

---

## 2. E1 — rate-class semantics

**Result: PASS.**

Two halves, both required.

**Positive.** Eight statements must be present, and are:

| Required statement | Site |
|---|---|
| `exposure.total_exposure` = **`0.00`** for a rate class | `26 §2.1.3` field table |
| `reservation.amount == total_exposure == 0.00` | `26 §2.1.3` |
| Step R states the ordinary branch explicitly | `26 §7` |
| Step R states the rate branch explicitly | `26 §7` |
| *"`forward_integral` is never the ordinary reservation amount"* | `26 §7` |
| `context.exposure.total_exposure == 0.00` in the worked policy | `26 §8` |
| The E1 consistency condition itself | `26 §2.1.3` |
| `total_exposure = 0.00` for `campaign.budget.set` | `51` |

**Negative.** Seven denylist patterns, evaluated over the operational corpus with a strict historical marker:

| Pattern | Normative hits |
|---|---|
| `rate-based classes it reserves` | **0** |
| `reserves? \`?forward_exposure` | **0** |
| `reserves? (the )?forward integral` | **0** |
| `reservation is the \*\*forward integral` | **0** |
| `forward integral for rate classes` | **0** |
| `reserve[sd]? \`?forward_integral` | **0** |
| `forward exposure is reserved to` | **0** |

**Seven normative sites carried the term-1 reading before this pass; zero carry it now.** The corrected sites are `26 §5`, `26 §7` (table row and flowchart node), `26 §8`, `27`, `33`'s sequence diagram, and the Effect Canonicaliser's step 4 in both `24 §2` and `34` ADR-021.

**No mechanism conflict.** `26 §2.1.3`, `51 §5.1`, `51`'s zero-monetary-reservation declaration, `36 §2` VC-S7, `phase2-v1.3-verification.md` V6 and registry `I3` all already carried the same model and agreed with one another. The defect was confined to descriptions of the sequence. Had the disagreement been between two mechanisms rather than between a mechanism and its descriptions, this document would read **NOT READY**.

---

## 3. E2 — remediation-ledger disposition counts

**Result: PASS.**

Computed from the fourteen entries' `Disposition` cells, not read from the summary:

| | Computed | Printed |
|---|---|---|
| APPLIED | **7** | 7 |
| APPLIED WITH EXPLICIT RESIDUAL | **7** | 7 |
| NOT APPLIED — BLOCKING | **0** | 0 |
| Entries | **14** | 14 |

Per-group, also computed and compared against the printed table:

| Group | Computed (applied / residual) | Printed |
|---|---|---|
| Mechanism A — TA-01 … TA-07 | **2 / 5** | 2 / 5 |
| Mechanism B — TB-01 … TB-06 | **5 / 1** | 5 / 1 |
| Joint — TJ-01 | **0 / 1** | 0 / 1 |

**No individual disposition was altered.** The correction moved one entry's worth of count from APPLIED to APPLIED WITH EXPLICIT RESIDUAL in the *summary only*, which is the conservative direction — the pass now claims one fewer clean application than it did before.

---

## 4. E3 — superseded invariant-registry references

**Result: PASS.**

| Measure | Count |
|---|---|
| Total references to `phase2-v1.1-` or `phase2-v1.2-invariant-registry.md` in the operational corpus | **3** |
| Of those, **normative / current-context** | **0** |
| Before this pass: normative references | **11**, across 8 deliverables |

The three surviving references, each explicitly historical:

| Site | Why it may remain |
|---|---|
| `phase2-v1.3-invariant-registry.md:3` | *"Supersedes `phase2-v1.2-invariant-registry.md`"* — the supersession statement itself |
| `deliverables/30-…:30` | v1.1 change-record row, qualified *"at the time of this v1.1 change"* with v1.3 named as current |
| `phase2-v1.3-lower-severity-register.md:35` | TOS-02's row quoting the defect it records, and marked `superseded` |

**The implementation-sequence check that motivated TOS-02.** `37`'s S6 build scope now reads *"the 57 identifiers in `phase2-v1.3-invariant-registry.md §2.7`"*. **No implementation instruction in the package now scopes the MVP invariant set to a superseded registry.**

E3's historical marker is deliberately stricter than the v1.3 `HIST` regex. The looser regex treated any line mentioning `v1.2` or a `TB-0x` id as history, which is why these eleven references — and erratum 4's eleven — passed the v1.3 pass. That is recorded rather than quietly fixed: **a filter that exempts a line because it mentions a finding id will exempt most of this package.**

---

## 5. E4 — the retired `cessation_lag` scalar

**Result: PASS.**

| Measure | Count |
|---|---|
| Total `cessation_lag` references in the operational corpus | **15** |
| Of those, **active / current-operand** | **0** |
| Before this pass: active references | **11** |

Distribution of the fifteen surviving references, all marked retired, replaced or historical:

| Artifact | Refs |
|---|---|
| `24-company-state-and-evidence-model.md` | 1 |
| `26-authority-and-policy-model.md` | 1 |
| `34-architecture-decision-records.md` | 1 |
| `50-control-artifact-manifest.md` | 1 |
| `51-limits-fixture.md` | 2 |
| `phase2-v1.3-invariant-registry.md` | 2 |
| `phase2-v1.3-changelog.md` | 2 |
| `phase2-v1.3-remediation-ledger.md` | 2 |
| `phase2-v1.3-limits-fixture.md` | 1 |
| `phase2-v1.3-lower-severity-register.md` | 1 |
| `phase2-v1.3-verification.md` | 1 |

E4 additionally asserts, positively, that the **per-adapter cessation specification** is named as the operand in the registry, in `51` and in `24`, and that the conservative default — *no `REVOKED` transition is available* — is still stated in `24`. A pass that removed the scalar without leaving a live operand and a live default would be a regression, and the condition would fail.

**TB-07 is not implemented.** No field values were declared, no vendor measurement was attempted, and the four-field specification remains `UNDECLARED` for every adapter and `S1 BEFORE IMPLEMENTING RELATED COMPONENT`.

---

## 6. E5 — implementation-brief numbering

**Result: PASS. The reported defect was not present.**

| Measure | Value |
|---|---|
| Conditions in `phase2-v1.3-implementation-brief.md §7` | **10** |
| Numbers found, in order | `1, 2, 3, 4, 5, 6, 7, 8, 9, 10` |
| Duplicated numbers | **none** |
| Source list, `redteam3/62-implementation-gate-v2.md §11` | also exactly ten, correctly numbered |

`§6`'s seventeen empirical obligations were checked for the same defect and are also clean. **No edit was made.** E5 remains in the condition set as an assertion, so a future edit introducing the duplicate fails the gate.

---

## 7. E6 — audit-plane ownership count

**Result: PASS.**

| Measure | Value |
|---|---|
| Rows naming the audit plane as owner or co-owner, computed from `§1`'s owner column | **23** |
| Printed in registry `§0` | **23** (was 22) |
| Enumerated in `30 §6.1`'s subset list | **23** (was 22) |
| Symmetric difference between the computed set and `30 §6.1`'s list | **none** |

The identifier that moved the count is **`I54`**, whose v1.3 restatement (TB-12) declared both cessation-verification reads audit-plane owned. `30 §6.1`'s prose now reads **23 of 70 with `23 + 47 = 70` displayed**.

---

## 8. E7 — database-enforced row count

**Result: PASS.** Registry `§0` (**23**), `§2.8`'s heading (**twenty-three**) and `§2.8`'s closing line (**twenty-three**) agree, and C28 independently counts the enumeration at 23.

---

## 9. Negative control — every new condition can fail

A consistency pass that has never failed is indistinguishable from one that cannot. Each of E1–E7 was run against a seeded copy of the tree with its defect reintroduced:

| Condition | Seeded defect | Result |
|---|---|---|
| E1 | Step R's *"For rate-based classes it reserves `forward_exposure(s, w, t)`"* restored | **FAIL** |
| E2 | Summary reverted to 8 APPLIED | **FAIL** |
| E3 | `37` S6 repointed to `phase2-v1.1-invariant-registry.md §2` | **FAIL** |
| E4 | *"Since `cessation_lag` is UNMEASURED"* restored in `24` | **FAIL** |
| E5 | A duplicate condition `9.` inserted in the brief `§7` | **FAIL** |
| E6 | Registry `§0` reverted to 22 | **FAIL** |
| E7 | `§2.8` heading reverted to *twenty-one* | **FAIL** |

**7 FAIL / 15 PASS under the seeded tree; 22 PASS / 0 FAIL under the corrected tree.** The seeded copy was discarded.

---

## 10. Recomputation — no authority-number change

`analysis/recompute-v1.3.py` was rerun unmodified against the corrected tree and its output **diffs clean against the recorded `analysis/recompute-v1.3-output.txt`** — byte-identical, zero differing lines.

| Quantity | v1.3 | v1.3.1 |
|---|---|---|
| `MAL_monetary(month)` | $300.00 | **$300.00** |
| `Standing(month)`, 28/29/30-day | $182.40 | **$182.40** |
| `Standing(month)`, 31-day | $186.00 | **$186.00** |
| `MIE_cost(month)`, p95 | $270.00 | **$270.00** |
| `MAL_total(month)`, signature basis | $756.00 | **$756.00** |
| `MAL_total(day)`, p95 | $329.50 | **$329.50** |
| Realisable cash line | $906.00 | **$906.00** |
| First `campaign.budget.set` in a clean window | PERMIT ($186.00 ≤ $186.00; $12.00 ≤ $12.00) | **PERMIT**, unchanged |

**No authority quantity changed. No owner re-signature is required.**

The last row is the one this pass most needed to hold. Erratum 1 is a correction to how the rate class's exposure is *described*; had it been a correction to how it is *computed*, the four-term sum in the recomputation would have moved and V6 would have flipped to DENY.

---

## 11. Scope statement

This was a mechanical and normative consistency gate. **No adversarial review was performed, no implementation code was written, no mechanism was introduced, no ceiling or window was changed, MAL was not changed, and Option A remains the selected architecture.**

Three things this pass leaves open and does not pretend to have closed:

1. **TB-07** — the per-adapter cessation specification is still `UNDECLARED` and still `S1 BEFORE IMPLEMENTING RELATED COMPONENT`. The cessation-verification component may not be implemented.
2. **TB-08(a), TB-11, TB-13** — unchanged in disposition. Production ceiling seeding on `W_MONTH_ADSPEND`, `PAUSE_PENDING` retry implementation and the `campaign.budget.set` supersession path remain blocked on their findings.
3. **`37 §1`'s nine properties against registry `§2.7`'s ten groupings** — a minor inconsistency found during erratum 3 and deliberately not corrected, because adding a tenth property to what the MVP must demonstrate is design. Recorded in `phase2-v1.3.1-errata.md`.

The ten pass-revocation conditions in `62 §11`, carried into `phase2-v1.3-implementation-brief.md §7`, remain live throughout S1.
