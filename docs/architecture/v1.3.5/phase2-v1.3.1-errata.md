# ACOS Operating Spine v1.3.1 — Normative Errata

**Phase 2.5a. Issued 2026-09-03. A mechanical and normative consistency correction to Operating Spine v1.3.**

This is not an architecture phase, a red-team pass, a redesign or an implementation. **No mechanism was introduced, no authority ceiling was changed, MAL was not changed, and the selected architecture (Option A) was not changed.** Seven corrections are recorded below; five were named in the owner's final gate review, one of those proved not to be present, and two further count defects were found while correcting the others and are recorded rather than left.

**Versioning convention.** The numbered deliverables continue to declare `Operating Spine v1.3` in their version lines, because the *architecture* is v1.3 and unchanged. `v1.3.1` names the **issue** of the package. `phase2-v1.3.1-verification.md` carries the verification result for this issue; `phase2-v1.3-verification.md` is retained unmodified except where a count it printed was itself corrected here.

---

## Summary

| # | Defect | Behaviour changed | Authority quantities changed |
|---|---|---|---|
| **1** | Step R described the rate class's forward exposure as an **ordinary** reservation, recreating TB-03 in seven normative passages | **No** — wording drift only; `26 §2.1.3`, `51 §5.1`, VC-S7, V6 and registry `I3` already agreed | **NO CHANGE** |
| **2** | Remediation-ledger disposition summary printed 8 / 6 against fourteen entries that are 7 / 7 | **No** | **NO CHANGE** |
| **3** | Eight deliverables cited the superseded v1.1 invariant registry as current authority, with superseded counts (TOS-02) | **No** — but `37` S6's build scope was scoped to a superseded invariant set, which is a scoping change to what S1 builds | **NO CHANGE** |
| **4** | The retired scalar `cessation_lag` was still the named live `I54` operand in eleven normative passages | **No** — the conservative default was already, and remains, *no `REVOKED` transition* | **NO CHANGE** |
| **5** | Implementation brief `§7` was reported as carrying a duplicate condition number | **N/A — defect not present** | **NO CHANGE** |
| **6** | Registry `§0`'s audit-plane ownership count (22) disagreed with its own owner column (23), and `30 §6.1` printed *"twenty of the registry's fifty-two"* (TOS-03) | **No** | **NO CHANGE** |
| **7** | Registry `§2.8`'s heading said *twenty-one* database-enforced rows; its own body and `§0` say twenty-three | **No** | **NO CHANGE** |

**Authority quantities, restated and reverified.** `MAL_monetary(month)` = **$300.00**. `Standing(month)` = **$182.40 / $186.00**. `MIE_cost(month)` p95 = **$270.00**. `MAL_total(month)` at the signature basis = **$756.00**. `analysis/recompute-v1.3.py` reproduces the recorded `analysis/recompute-v1.3-output.txt` **byte-identically** after every edit in this pass. **No owner re-signature is required.**

---

## 1. Rate-class Step R — the blocking erratum

### Defect

`26 §2.1.3` (v1.3, TB-03) declares the rate-class model unambiguously: `vendor_amount = NULL`, `total_exposure = 0.00`, `reservation.amount == total_exposure == 0.00`, and the whole economic quantity carried by `forward_integral` into `I3` **term 2** through `standing_window_exposure`. The later Step R table in the same file contradicted it:

> *"For rate-based classes it reserves `forward_exposure(s, w, t)` (`§10.1`) and creates the `StandingAuthorization` … atomically."*

Read literally that places the forward integral in `I3` **term 1** while the `StandingAuthorization` places the same money in term 2. Because `W_MONTH_ADSPEND.max_monetary` equals `standing_cap` exactly, the double count denies the first `campaign.budget.set` the company ever attempts — **which is TB-03, reintroduced by the wording of the repair's own sequence specification.**

**The occurrence was not singular.** A mechanical search for the term-1 reading found **seven** current normative sites, and the two worst were not in `26` at all:

| Site | Passage as it stood |
|---|---|
| `26 §7` step R table row | *"For rate-based classes it reserves `forward_exposure(s, w, t)`"* |
| `26 §7` authorisation flowchart, node `R` | `RESERVE atomically … forward integral for rate classes` |
| `26 §5`, standing declaration | *"creates a `StandingAuthorization` whose forward exposure is reserved to every referenced window's end"* |
| `26 §8`, worked-policy commentary | *"The reservation is the **forward integral to the window boundary**, not the delta"* |
| `27 §…`, the CEO's one effect class | *"the forward integral to each referenced window's end is reserved"* |
| `33 §…`, authorisation sequence diagram | `reserve against EVERY referenced named window (money · irrecoverable · forward integral)` |
| `24 §2`, Effect Canonicaliser step 4 · `34` ADR-021 step 4 | the forward integral listed **as a per-class cost component of exposure** |

The last row is the most consequential and neither the owner's review nor the third red team named it. `total_exposure` is defined as `vendor_amount + Σ cost_components + class-specific bounded loss`, and `I18b` binds `reservation.amount` to `total_exposure` **exactly, with no tolerance**. Listing the forward integral among the cost components therefore does not merely describe the wrong reservation — it makes `total_exposure ≠ 0.00` for the rate class by construction, which contradicts `§2.1.3`'s table, breaks `I18b` against the zero-amount row, and breaks `26 §8`'s `context.exposure.total_exposure == 0.00` conjunct. Two artifacts, `24` and `34`, would have led an implementer to the same defect from a different direction than Step R.

### Affected files

`deliverables/24-company-state-and-evidence-model.md` · `deliverables/26-authority-and-policy-model.md` · `deliverables/27-ai-ceo-and-agent-model.md` · `deliverables/33-recommended-architecture.md` · `deliverables/34-architecture-decision-records.md`

### Exact correction

**Step R is restated with two explicit branches** and no shared verb:

> **Ordinary, non-rate class.** Reserves `exposure.total_exposure` into the **ordinary reservation term — `I3` term 1** — against every named window instance the matching grants reference, `SELECT … FOR UPDATE` in ascending `window_id` then the journal counter, failing if any lacks headroom.
>
> **Rate class.** `exposure.total_exposure` is `0.00`, so step R creates a **real zero-amount reservation row** — `reservation.amount == exposure.total_exposure == 0.00`, satisfying `I2` without a carve-out and `I18b` exactly — and **in the same transaction** creates the `StandingAuthorization`, its `StandingRevocationAuthority` (`I55`) and the `standing_window_exposure` rows whose `forward_monetary` enters **`I3` term 2**. **`forward_integral` is never the ordinary reservation amount.** The transaction still locks and re-checks every referenced window instance in the declared order before committing.

The flowchart node, the `33` sequence diagram, `26 §5` and `26 §8` are restated in the same terms. `24` step 4 and `34` ADR-021 step 4 now list `forward_integral` as a **separate field that is not a component of `total_exposure`** and that enters `I3` term 2 rather than the ordinary reservation.

**A consistency condition is added to `26 §2.1.3`:**

> For every rate class, **no normative passage may describe `forward_integral` as the ordinary reservation amount.** Every normative passage must agree that `reservation.amount == exposure.total_exposure == 0.00`, and that the economic exposure is carried by `I3`'s standing term through `standing_window_exposure`.

`analysis/consistency-v1.3.py` condition **E1** enforces it over seven denylist patterns plus eight required positive statements.

### Behaviour changed

**No.** Every authoritative statement of the mechanism — `26 §2.1.3`'s field table, `51 §5.1`'s `BAND(standing_cap)` settlement leg, `51`'s zero-monetary-reservation declaration, `36 §2` VC-S7, `phase2-v1.3-verification.md` V6 and registry `I3`'s four-term form — already carried the correct model and agreed with each other. What was wrong was the **sequence specification an implementer reads first**, and three artifacts downstream of it. This is wording drift, not a second exposure model.

**This is the specific finding the gate asked about, so it is stated plainly: no genuine new mechanism conflict was found.** Had `§2.1.3` and Step R disagreed on a *mechanism* rather than on a *description* — for example had one required a reservation-to-standing conversion and the other a zero-amount row — this pass would have returned NOT READY rather than choosing between them.

### Authority quantities changed

**NO CHANGE.**

---

## 2. Remediation-ledger disposition arithmetic

### Defect

`phase2-v1.3-remediation-ledger.md §1` printed **8 APPLIED / 6 APPLIED WITH EXPLICIT RESIDUAL**. The fourteen entries are:

| Group | APPLIED | APPLIED WITH EXPLICIT RESIDUAL |
|---|---|---|
| TA-01 … TA-07 | 2 (TA-03, TA-07) | 5 (TA-01, TA-02, TA-04, TA-05, TA-06) |
| TB-01 … TB-06 | 5 (TB-01, TB-02, TB-03, TB-04, TB-06) | 1 (TB-05) |
| TJ-01 | 0 | 1 |
| **Total** | **7** | **7** |

**The per-group breakdown table was also wrong** and in a way the summary row concealed: it printed `Mechanism A 4/3` and `Mechanism B 4/2`, which are wrong in both groups and happen to sum to the wrong headline. The owner's review caught the headline; the group rows are recorded here because they are the same defect and a corrected headline over uncorrected group rows would be worse than either.

### Affected files

`phase2-v1.3-remediation-ledger.md` (`§1` summary, `§1` group table, `§4`'s *"three of the six residuals"*) · `phase2-v1.3-changelog.md` · `phase2-v1.3-verification.md` (`§…`'s ledger check and `§…`'s *"Six of the fourteen"*)

### Exact correction

Summary corrected to 7 / 7 / 0 **from the entries**. Group table corrected to 2/5, 5/1, 0/1 and given an explicit total row. Three downstream restatements propagated. **No individual disposition was changed to match the old summary** — this is expressly what the review forbade, and the residual count went *up*, which is the direction that cannot be self-serving.

`analysis/consistency-v1.3.py` condition **E2** now parses each entry's `Disposition` cell, tallies per group, and compares against every printed figure. The summary is no longer capable of being carried forward by hand.

### Behaviour changed

No. Seven of fourteen remediations carry explicit residuals rather than six; the residuals themselves are unchanged in content.

### Authority quantities changed

**NO CHANGE.**

---

## 3. Superseded invariant-registry references — TOS-02 applied

### Defect

Eight deliverables cited `phase2-v1.1-invariant-registry.md` as current authority, several with the v1.1 counts. `37` S6's build scope was the load-bearing one: *"The **MVP invariant set** as continuous checks (`phase2-v1.1-invariant-registry.md §2`)"* scopes an S1/S6 build to **55 of 68** under a composition that differs from v1.3's **57 of 70**.

### Affected files

`23-system-context-and-logical-architecture.md` · `28-financial-and-experiment-architecture.md` · `30-observability-audit-and-escalation.md` (×2) · `33-recommended-architecture.md` (×2) · `34-architecture-decision-records.md` · `35-failure-scenario-walkthroughs.md` · `36-architecture-validation-plan.md` · `37-acos-mvp-and-implementation-sequence.md` (×2)

### Exact correction

Every current-context reference repointed to `phase2-v1.3-invariant-registry.md` with the correct section and count:

| Site | Was | Now |
|---|---|---|
| `37 §…` S6 build scope | `v1.1 §2` | **57 identifiers, `v1.3 §2.7`** |
| `37 §…` MVP set statement | *39 identifiers, `v1.1 §2`* | **57 identifiers, `v1.3 §2.7`**, mapped to `37 §1`'s nine properties plus the registry's tenth grouping |
| `36 §…` replaceability test | *39 identifiers, `v1.1 §2`* | **57 identifiers, `v1.3 §2.7`** |
| `33 §…` audit-plane contents | *eighteen audit-plane-owned invariants* | **23 audit-plane-owned or co-owned, `v1.3 §1`** |
| `33 §…` correlated-failure residual | *52 identifiers, 39 in the MVP subset* | **70 identifiers, 57 in the MVP subset (`§2.7`)** |
| `23 §…` audit-plane sizing | *24 continuous invariants at MVP, `v1.1 §2`* | **17 audit-plane-owned invariants in the MVP set** (`§1` owner column ∩ `§2.7`) |
| `28`, `30 §6.1`, `34` ADR-007 | *"`v1.1` now owns every identifier"* | `v1.3` |
| `35`, `30`'s v1.1 change records | v1.1 filename asserted as current | qualified as the registry at the time of the v1.1 change, with v1.3 named as current |

Three references to a superseded registry remain and **all three are explicitly historical**: the v1.3 registry's own `Supersedes` line, `30`'s v1.1 change-record row, and the lower-severity register's TOS-02 row quoting the defect. `analysis/consistency-v1.3.py` condition **E3** fails on any reference not explicitly marked historical, using a stricter historical marker than the v1.3 `HIST` regex — the looseness of that regex is precisely why these survived the v1.3 pass, and why errata 1 and 4 did too.

**TOS-02's disposition in `phase2-v1.3-lower-severity-register.md` changes from `S1 BEFORE IMPLEMENTING RELATED COMPONENT` to `APPLIED in v1.3.1`.**

### Behaviour changed

**Yes, in one place, and it is the point of the erratum.** `37` S6 now scopes the build to the current 57-identifier MVP set rather than a superseded 55-identifier one. No invariant's content changed; what changed is which set an implementer builds.

### Authority quantities changed

**NO CHANGE.**

---

## 4. The retired `cessation_lag` scalar

### Defect

v1.3 already retired the single scalar `cessation_lag` as the `I54` operand and replaced it with a per-adapter **cessation specification** whose four fields are declared under TB-07 and are `UNDECLARED` for every adapter. The registry row and `51 §3.2` were updated; **eleven other normative passages still named the scalar as the live current parameter**, including two that matter more than prose:

- `50-control-artifact-manifest.md` class 21 listed `cessation_lag` as a member of the owner-signed **adapter parameter set** — a control artifact defined against a parameter that no longer exists.
- `24 §3.1`'s state-machine diagram labelled the `EXPIRED → REVOKED` edge *"cessation verified across cessation_lag (I54)"*, so the diagram described the transition as gated on a scalar the registry had retired.

### Affected files

`24-company-state-and-evidence-model.md` (×3) · `26-authority-and-policy-model.md` (×2) · `30-observability-audit-and-escalation.md` · `34-architecture-decision-records.md` · `50-control-artifact-manifest.md` · `phase2-v1.3-invariant-registry.md` (×2) · `phase2-v1.3-lower-severity-register.md` (×2) · `phase2-v1.3-implementation-brief.md` · `phase2-v1.3-verification.md` · `phase2-v1.3-changelog.md` · `phase2-v1.3-remediation-ledger.md`

### Exact correction

Every current-context occurrence now reads **cessation specification**, with a pointer to TB-07 where the fields are scheduled. The state-diagram edge is relabelled and annotated `TB-07 — UNDECLARED, so unavailable at MVP`. Control-artifact class 21 names the specification and records the scalar's retirement. The registry's `I54` slice cell reads *"S3 (cessation-specification measurement, after TB-07 declares it)"* rather than *"S3 (`cessation_lag` measurement)"*. `26 §10.5`'s pass-revoking sentence is restated against the specification and repointed from the superseded `58 §13` condition 3 to `62 §11` condition 3, which is the live list.

**Nothing was invented.** The four field values are not declared, no vendor measurement was attempted, and TB-07 remains `S1 BEFORE IMPLEMENTING RELATED COMPONENT`. **The conservative behaviour is unchanged and restated everywhere it appears: no `REVOKED` transition is available; forward exposure follows `24 §3.1`'s window-instance rules; TB-07 must land before the cessation-verification component is implemented.**

Fifteen references to the scalar remain across the operational corpus and **all fifteen are explicitly marked as retired, replaced or historical**. Condition **E4** fails on any that is not.

### Behaviour changed

No. The operand's name and referent were already corrected in the registry in v1.3; this pass makes the rest of the package say the same thing.

### Authority quantities changed

**NO CHANGE.**

---

## 5. Implementation-brief numbering — defect not present

### Defect as reported

`phase2-v1.3-implementation-brief.md §7` was reported to carry a duplicate pass-revocation condition number.

### Finding

**Not present.** `§7` contains exactly ten conditions, numbered 1 through 10, each number appearing once. Its source, `redteam3/62-implementation-gate-v2.md §11`, is likewise exactly ten and correctly numbered. `§6`'s seventeen empirical obligations were checked for the same defect and are also clean.

No correction was made. **Condition E5 asserts the property rather than a repair**, so the check exists whether or not the defect ever did — and a future edit that introduces the duplicate will now fail the gate.

### Behaviour changed

N/A.

### Authority quantities changed

**NO CHANGE.**

---

## 6. Audit-plane ownership count — TOS-03 applied

### Defect

Found while correcting erratum 3, which required quoting the current audit-plane-owned count.

`phase2-v1.3-invariant-registry.md §0` states **22** rows name the audit plane as owner or co-owner, *"unchanged"* from v1.2. Its own `§1` owner column contains **23**. The extra row is **`I54`**, whose v1.3 restatement (TB-12) declared *both* cessation-verification reads audit-plane owned — the count was carried forward from v1.2 and not recomputed after the very change that altered it. `30 §6.1`'s enumerated subset listed 22 identifiers, also omitting `I54`, and its prose read *"Twenty of the registry's fifty-two are owned here"* — three figures, none of them current, in the artifact that enumerates Mechanism A's owner set. This is TOS-03, whose own register row asked to be applied in a single pass with TOS-02.

### Affected files

`phase2-v1.3-invariant-registry.md` `§0` · `deliverables/30-observability-audit-and-escalation.md` `§6.1` · `phase2-v1.3-lower-severity-register.md`

### Exact correction

Registry `§0`: **23**, with the recount and its cause stated rather than asserted. `30 §6.1`: `I54` added to the enumerated subset, and the prose corrected to **"Twenty-three of the registry's seventy are owned or co-owned here — `23 + 47 = 70`"**, with the arithmetic displayed for the same reason the registry displays its own. TOS-03's disposition changes to `APPLIED in v1.3.1`.

Condition **E6** recomputes the owner column, compares it against `§0`'s printed figure and against `30 §6.1`'s enumerated list, and reports the symmetric difference. The count can no longer drift silently in any of the three places.

### Behaviour changed

No. `I54` was already audit-plane owned in v1.3's registry row; the counts that describe the set were stale.

### Authority quantities changed

**NO CHANGE.**

---

## 7. Database-enforced row count heading

### Defect

`phase2-v1.3-invariant-registry.md §2.8` is headed *"The twenty-one database-enforced rows, enumerated"*. Its own closing line reads *"That is **twenty-three** rows, matching `§0`. v1.2 had twenty-one."* — and `§0` says 23. The heading carried v1.2's figure.

### Affected files

`phase2-v1.3-invariant-registry.md`

### Exact correction

Heading corrected to *twenty-three*. Condition **E7** requires `§0`, the heading and the body to agree; condition **C28** already counted the enumeration itself and continues to.

### Behaviour changed

No.

### Authority quantities changed

**NO CHANGE.**

---

## What this pass deliberately did not do

**It did not implement TB-07.** The four cessation-specification fields are not declared here. Declaring them is design, the mission forbids design in an errata pass, and there is no fourth adversarial review to catch what the declaration would break. TB-07 remains the highest-priority item in the lower-severity register.

**It did not touch a ceiling, a window, a grant, MAL, or the selected architecture.** Every edit is a description of a mechanism that already existed, or a count computed from entries that already existed.

**It did not resolve `37 §1`'s nine properties against the registry `§2.7`'s ten groupings.** `37 §1` enumerates nine; the registry groups the MVP set by ten, the tenth being *"a safe denial leaves no orphaned obligation"*, new in v1.2. The v1.3.1 citation in `37` names both rather than silently picking one. Adding a tenth property to `37 §1` is an edit to what the MVP must demonstrate, which is not errata work. **Recorded here as an open minor inconsistency for the S1 gate rather than corrected.**

**It did not perform another adversarial review.** Six of the seven corrections were found by the owner's gate review or by mechanically searching for the phrases it named. The seventh — the canonicaliser's cost-component list in `24` and `34` — was found by the same mechanical search and is the reason the search was run across the whole package rather than only the file the review named.
