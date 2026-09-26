# ACOS Operating Spine v1.3 — Changelog

**Phase 2.5. Issued 2026-09-03. Complete record of v1.2 → v1.3.**

**What this release is.** The application of the fourteen BLOCKING findings from the third independent architecture red team (`redteam3/59`, `60`, `61`), plus TB-09 and TOS-04 as required accompanying corrections, plus a verification-only consistency pass. **It is not a redesign and it introduces no new mechanism.** Three local specification objects are new because a BLOCKING remediation required each — `DegradedModeOverride`, `MirrorInputStallSignal` and `standing_window_exposure` — and `phase2-v1.3-verification.md §14` records that they have not been adversarially reviewed.

**What this release explicitly did not reopen**, per the mission: Option A, the Postgres-centric architecture, the Effect Canonicaliser generally, the audit-plane separation decision, the standing-exposure design generally, Phase 1 business-model decisions, or any previously resolved red-team finding.

---

## 0. Issue v1.3.1 — normative errata (Phase 2.5a)

**Seven corrections, no mechanism, no authority change.** Full record in `phase2-v1.3.1-errata.md`; gate in `phase2-v1.3.1-verification.md`.

| # | Correction |
|---|---|
| 1 | **Rate-class step R.** Seven normative passages described the rate class's `forward_integral` as an ordinary reservation, recreating TB-03 by counting the same money in `I3` terms 1 and 2. Step R is restated with explicit ordinary and rate branches; `24 §2` and `34` ADR-021 no longer list the forward integral as a cost component of `total_exposure` |
| 2 | **Ledger arithmetic.** The disposition summary printed 8 / 6 against entries that are **7 / 7 / 0**; the per-group table was also wrong. Both computed from the entries now |
| 3 | **TOS-02 applied.** Eleven normative citations of the superseded v1.1 invariant registry across eight deliverables repointed to `phase2-v1.3-invariant-registry.md` with current sections and counts. `37` S6's build scope now reads 57 of 70 |
| 4 | **Retired `cessation_lag`.** Eleven passages still named the scalar as the live `I54` operand, including control-artifact class 21 and `24 §3.1`'s state diagram. All restated against the per-adapter cessation specification. TB-07 is **not** implemented |
| 5 | **Implementation brief `§7`** — the reported duplicate condition number **was not present**. No edit; E5 asserts the property |
| 6 | **TOS-03 applied.** Registry `§0`'s audit-plane count was 22 against an owner column of 23 (`I54`, added by TB-12 and not recounted); `30 §6.1` read *"twenty of fifty-two"*. Both corrected to 23 of 70 |
| 7 | **Registry `§2.8`'s heading** said twenty-one database-enforced rows against its own body's twenty-three |

`analysis/consistency-v1.3.py` gains **E1–E7**, each verified able to fail against a seeded tree. **22 PASS / 0 FAIL.** `analysis/recompute-v1.3.py` reproduces `recompute-v1.3-output.txt` byte-identically.

---

## 1. Verdict transition

| | v1.2 | v1.3 |
|---|---|---|
| Status | READY FOR NARROW THIRD RED TEAM | **READY FOR S1 IMPLEMENTATION** |
| Operative gate | `58-implementation-gate.md` | **`62-implementation-gate-v2.md`** |
| Open BLOCKING | 14 (third review) | **0** |
| Adversarial reviews to date | 3 | 3 — **no fourth is required and none was run** (`62 §5`) |
| FATAL, cumulative across three passes | 0 of 178 findings | **0 of 178** |

---

## 2. The fourteen, in one table

Full entries in `phase2-v1.3-remediation-ledger.md`.

| Id | One-line change | Disposition |
|---|---|---|
| TA-01 | `30 §5.5` case 2 split into 2a (transport loss, `I17e`, ≤15 min) and 2b (attester suppression, `I8` only, or **no detector**); `I17e` restated; registry `§3` item 9 added; VC-A1d adversarial-attester negative control | RESIDUAL |
| TA-02 | `I8` sweep cadence declared per adapter, audit-plane scheduled; bound written as `sweep_cadence + vendor_reporting_lag`; new `30 §5.10` | RESIDUAL |
| TA-03 | `I8`'s tag set restated as **additive, never scoping**, with a period-bounded-query CI assertion and control artifact class 26 | APPLIED |
| TA-04 | `I17f(c)` added — dispatch→tag detection, audit-plane owned, 15-minute evaluation interval; `30 §5.5` case 7 | RESIDUAL |
| TA-05 | `DegradedModeOverride` specified as kernel state; limits in `51 §3.6`; composition bound `I63`; control artifact class 25 | RESIDUAL |
| TA-06 | `MirrorInputStallSignal` contract — signer, key, endpoint, transport, issuance, `max_age` 5 min, replay; reachable outage classes tabulated | RESIDUAL |
| TA-07 | `36 §6`, `36 §14`, `35 §12.1`, `22 §3.1` and ADR-013 corrected to one state-qualified behaviour model; consistency condition C21 added | APPLIED |
| TB-01 | `24 §3` K5's `window_balance` corrected to four terms, instance-keyed; registry **rule 9** added | APPLIED |
| TB-02 | Window-instance scoping declared; `LIVE`-only boundary re-reservation; `I55` lapsed-exposure exemption | APPLIED |
| TB-03 | Rate classes declared **zero-monetary-reservation**; new `26 §2.1.3`; first authorisation traced to PERMIT | APPLIED |
| TB-04 | `forward_monetary` a generated column; one-statement realised/standing update under one lock order; realised moved out of the *refusing* path while staying in the *bound* | APPLIED |
| TB-05 | Per-adapter charge-record field sets with absent fields marked absent; `derive_sa_id` declared with the **delivery date** as authoritative and an **earliest-wins** directional tie-break | RESIDUAL |
| TB-06 | `I62` added; `any → EXPIRED` replaced by an explicit source set; `REVOKED` terminal; `I23`'s enforcement corrected | APPLIED |
| TJ-01 | Walked again after TA-01…TA-04. **Not prevented, and not claimed to be.** Disposition in four terms in the ledger | RESIDUAL |

**7 APPLIED, 7 APPLIED WITH EXPLICIT RESIDUAL, 0 NOT APPLIED.**

---

## 3. New identifiers

| Id | Property | Finding |
|---|---|---|
| **I62** | Every `StandingAuthorization` transition is in `24 §3.1`'s declared set; `REVOKED` has no outbound transition. DB trigger over `(OLD.status, NEW.status)` | TB-06 |
| **I63** | Per-override and rolling-30-day aggregate bounds on `DegradedModeOverride` | TA-05 |

**Registry counts: 68 → 70 identifiers; 55 → 57 MVP; 21 → 23 database-enforced.** All shown rather than asserted, and C28/C29 check the arithmetic.

**Eight rows restated:** `I3`, `I8`, `I17`, `I17e`, `I17f`, `I22`, `I23`, `I54`, `I55`. **`§3` gains items 9, 10 and 11** — the frozen-prefix class with no detector, `I17f(c)`'s boundary, and `I8`'s declared-but-unmeasured bound including its emptiness at S1. **Rule 9 added:** a printed enforcement expression must contain exactly its invariant's operand set.

---

## 4. New specification objects

| Object | Home | Why it is not a new mechanism |
|---|---|---|
| `DegradedModeOverride` | `24 §3` K9; specified `30 §5.7.2`; limits `51 §3.6` | The override existed in v1.2 as a load-bearing escape described in four sentences. TA-05's remediation is to give it a shape, not to add a capability. Its scope is **narrower** than v1.2's unbounded version in every dimension |
| `MirrorInputStallSignal` | `30 §5.7.1` | The signal existed in v1.2 as *"the audit plane's own signal"*. TA-06's remediation declares its transport, authentication and freshness. It makes the corroborated state **harder** to reach, not easier |
| `standing_window_exposure` | `24 §3` K5 | The quantity existed in v1.2 as a formula with no instance term and no declared atomicity. TB-01/02/04 materialise it so it can be enforced and updated atomically |

---

## 5. Control artifacts

Three classes added, all in the second-factor tier. **26 rows for 24 signed classes**, from v1.2's 23 for 21.

| # | Class | Halt scope |
|---|---|---|
| 24 | Audit-plane signing key identity and published public key | Entry into `CORROBORATED_DEGRADED` |
| 25 | Degraded-mode override limit set and the registered OWNER-tier approver set | Grant of any new override |
| 26 | `I8` sweep specification — cadence, coverage, the period-bounded query rule | `I8` for the affected adapter |

Class 26 is the first control artifact whose subject is *an audit check's own coverage*, which is the mechanical answer to `47 §5`'s point that an audit whose scope the audited party can narrow is worse than no audit.

---

## 6. Figures

**No numerical authority quantity changed and no owner re-signature is required.** Verified by `analysis/recompute-v1.3.py`, written from the formulae.

`MAL_monetary(month)` $300.00 · `Standing(month)` $182.40 / $186.00 · `MIE_cost(month)` p50 $120.00 / p95 $270.00 · **`MAL_total(month)` p95 31-day $756.00 (signature basis)** · `MAL_total(day)` p95 $329.50 · realisable cash $906.00 · F2 `MAL_monetary` $480.00.

**Two new quantities are declared and neither is an authority quantity.** The `I8` sweep cadences are operational parameters. The eight override limits are **sub-limits of already-signed ceilings** — an override releases a dispatch gate, never an exposure gate — which is why `MAL_total` is unchanged, and the oracle checks the inequality rather than the prose asserting it.

**The one change that would have moved `MAL_total` was deliberately not made.** TB-08(a) — widening `W_MONTH_ADSPEND.max_monetary` above `standing_cap` by an overdelivery band — is authorised loss and would require re-signature. It is scheduled, and the reasoning is in the lower-severity register: with TB-04 applied, realised spend is out of the refusing path, so the zero-slack problem is no longer an unrecordability defect and (a) is genuinely deferrable.

**TB-09's semantic search.** Five operational sites carried superseded figures: `36 §12` and `37 §5` (the `$600` / `$180` / `$120` / `$173.50` / `$5,205` combination — the v1.1 multiplicative standing basis), `22 §3` and `33 §2.5` (LIM-09's *"$600 / roughly 24 items"*, which is TOS-01), and `26 §10.5` (the retired `cessation_lag` scalar and *"the last referenced window"*). All corrected. `min(UNBOUNDED, $180.00)` in `26 §10.1` and `36 §2` is fixture F2's grant sum, is correct, and was deliberately not touched — which is why the check keys on semantic combinations rather than on bare figures.

---

## 7. Artifacts changed

**Materially edited (13):** `22`, `24`, `26`, `30`, `33`, `34`, `35`, `36`, `37`, `48`, `50`, `51`, and the invariant registry.

**Version line bumped, no material change (8):** `23`, `25`, `27`, `28`, `29`, `31`, `32`, `49`. Bumped so the package carries one version, per condition C4.

**Superseded and excluded from the authoritative implementation set (1):** `38-phase2-review-brief.md`. It briefs an adversarial reviewer for a review that has now happened three times; it is retained for history and named in the implementation brief as non-normative.

**Root documents.** `phase2-v1.2-changelog.md` and `phase2-v1.2-remediation-ledger.md` are retained as `.keep` files — history, not authority. `phase2-v1.2-limits-fixture.md`'s pointer is replaced by `phase2-v1.3-limits-fixture.md`. `phase2-v1.2-third-redteam-brief.md` is retained; its review is complete.

**New:** `phase2-v1.3-changelog.md`, `-remediation-ledger.md`, `-invariant-registry.md`, `-limits-fixture.md`, `-lower-severity-register.md`, `-verification.md`, `-implementation-brief.md`; `analysis/consistency-v1.3.py`, `analysis/v1.3-consistency-audit.md`, `analysis/recompute-v1.3.py`, `analysis/recompute-v1.3-output.txt`; `redteam3/` carrying `59`–`62` unmodified.

---

## 8. TOS-04 — the record of this project's own failed audit

**Required by `62 §5`(c) and recorded here rather than corrected silently, because `21 §2` item 16's finding is that an unrecorded failure in the audit trail is more decision-relevant than the defect it concealed.**

### What happened

`analysis/v1.2-consistency-audit.md` ran twenty mechanical conditions and reported **20 of 20 PASS**. Two of those PASSes were false.

| Condition | Stated as | Returned | Truth at the time |
|---|---|---|---|
| **C5** | *"`MAL_total` signature basis stated as $756.00 consistently"* | **PASS** | `$756.00` appeared in **exactly one** deliverable. `$600` appeared in two operational passages — `36 §12`, which specifies `I7`'s own oracle, and `37 §5` |
| **C6** | *"`Standing(month)` 31-day stated as $186.00 consistently"* | **PASS** | Two deliverables stated **`$180`** as the standing component — `30 × $6.00`, the v1.1 multiplicative basis v1.2 had explicitly deviated from |

### What allowed each

**The word *"consistently"*, and it allowed both in the same way.** Each condition was implemented as *every occurrence of the current figure agrees with every other occurrence of the current figure*. That predicate is **satisfied trivially when the current figure appears once**, and it never examines the superseded value at all. A figure appearing once with its predecessor appearing twice is the exact case the condition was written to catch and the exact case it cannot see.

Two aggravating factors are worth recording because they generalise.

1. **The conditions were written by the same process that produced the artifacts**, which the v1.2 audit's own `§4` item 2 concedes. What it anticipated was that the conditions might be the *wrong conditions*. What happened was that two were the *right questions evaluated wrongly*, which is a failure mode its disclaimers did not cover.
2. **The false PASS landed on the artifact that specifies a differential oracle.** `36 §12` tells the S1 oracle author what `I7` compares. An author reading it would have computed $600, disagreed with `51`'s $756.00, and — per `54 §2.3`'s recorded precedent — resolved the disagreement by adopting the printed answer. **A consistency check that passes over an oracle specification carrying the previous version's answers is worse than no check**, because it licenses the circularity `36 §0` exists to prevent.

### How v1.3 makes this failure class detectable

Three changes, and the first is the substantive one.

1. **C5 and C6 are restated** as *"stated identically wherever stated, **and stated nowhere in a superseded form**"*. The second leg is implemented as an **explicit denylist of prior-version values**, not as an agreement check over current ones. **A denylist is falsifiable in the direction an agreement check is not:** it fails when the old value is present, which is the condition that actually matters, rather than passing when the new value is unanimous among its one occurrence.
2. **C23 is new** and generalises it to **semantic combinations** rather than bare figures — `MAL_total` as `$600`, `$180` *as a standing basis*, `$173.50`, `$5,205`, the retired scalar `cessation_lag` used as a live operand, *"the last referenced window"*, *"six omission cases"*, `any → EXPIRED`. The distinction matters: `$180.00` is a **correct current value** in fixture F2 and a superseded one as a standing basis, and a condition that flagged both would have been turned off, which is how the v1.2 conditions came to test nothing.
3. **C22 is new** and implements registry rule 9 — every printed enforcement expression compared mechanically against its invariant's operand set. **That is the condition that would have caught TB-01**, which no v1.2 condition looked for.

### And one change to how the pass itself is run

**The v1.3 pass is a committed script that exits non-zero on failure**, not a table of results in prose. On its first run against the edited tree it returned **10 PASS / 5 FAIL**, of which three were real defects — `26 §10.5` still carrying the retired scalar and the referentless phrase, `22 §3.1` and `37` still describing mirror-outage behaviour without the state qualifier, and `48`'s version line displaced by an inserted note. **That run is recorded in `analysis/v1.3-consistency-audit.md §0` rather than discarded.** A consistency pass with no failed runs in its history is indistinguishable from one that cannot fail, which is precisely what C5 and C6 turned out to be.

---

## 9. Status

**`phase2-v1.3-verification.md` returns READY FOR S1 IMPLEMENTATION.** The authorised boundary, the non-goals, the seventeen empirical obligations and the ten pass-revocation conditions are in `phase2-v1.3-implementation-brief.md`. **No production code is authorised by this release and none was written for it.**
