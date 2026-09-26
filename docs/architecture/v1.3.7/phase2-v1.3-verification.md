# ACOS Operating Spine v1.3 — Verification-Only Consistency Pass

**Phase 2.5. Issued 2026-09-03. This is NOT an adversarial review and does not attempt to be one.**

It answers exactly one question:

> **Did we apply the fourteen remediations consistently everywhere?**

`62 §5` authorises a verification-only pass in place of a fourth adversarial red team, on the ground that none of the fourteen introduces a new mechanism. `§14` below records where that ground is thinner than it sounds.

**Every condition is stated so that it can FAIL, and this document is willing to return `NOT READY`.** Mechanical conditions are executed by `analysis/consistency-v1.3.py`, which exits non-zero on failure and is committed with the package. Arithmetic conditions are executed by `analysis/recompute-v1.3.py`, written from the formulae rather than the printed answers. Conditions requiring judgement say so and name what was inspected.

---

## V1 — Blocker disposition

**Condition.** All fourteen blocker ids exist exactly once in the remediation ledger. All fourteen are `APPLIED` or `APPLIED WITH EXPLICIT RESIDUAL`. Zero `NOT APPLIED — BLOCKING`.

**Method.** Mechanical, C1 and C2. Entry headings counted; disposition rows parsed.

| Id | Disposition |
|---|---|
| TA-01 | APPLIED WITH EXPLICIT RESIDUAL |
| TA-02 | APPLIED WITH EXPLICIT RESIDUAL |
| TA-03 | APPLIED |
| TA-04 | APPLIED WITH EXPLICIT RESIDUAL |
| TA-05 | APPLIED WITH EXPLICIT RESIDUAL |
| TA-06 | APPLIED WITH EXPLICIT RESIDUAL |
| TA-07 | APPLIED |
| TB-01 | APPLIED |
| TB-02 | APPLIED |
| TB-03 | APPLIED |
| TB-04 | APPLIED |
| TB-05 | APPLIED WITH EXPLICIT RESIDUAL |
| TB-06 | APPLIED |
| TJ-01 | APPLIED WITH EXPLICIT RESIDUAL |

14 headings, 14 dispositions, 7 APPLIED, 7 APPLIED WITH EXPLICIT RESIDUAL, 0 NOT APPLIED (recounted from the entries in v1.3.1, E2; the v1.3 summary printed 8/6). No merges: TJ-01 has its own entry and its own walk despite being a composition of four others, and TB-09 and TOS-04 are recorded separately in ledger `§5` rather than folded into a blocker.

**Result: PASS.**

---

## V2 — No weakened invariant

**Condition.** For every remediation, compare the before and after property. No blocker is "fixed" by removing the guarantee that exposed it.

**Method.** Judgement, argued item by item in ledger `§7`, with the four repairs `62 §11` condition 1 names specifically checked first. Reproduced here in the compressed form so this document is self-contained.

| Remediation | Property before | Property after | Weakened? |
|---|---|---|---|
| TA-01 | `I17e` claimed a 15-minute bound on suppression | Claims continuity plus attested-prefix consistency; the suppression case is named as undetectable | **No.** The *mechanism* is unchanged; the *claim* is narrowed to what it delivers. Narrowing a false claim adds a guarantee — that the gap is written down — rather than removing one |
| TA-02 | `I8` had no cadence | Per-adapter cadence, audit-plane scheduled, bound stated as a sum | **No.** Rule 5 satisfied where it was violated |
| TA-03 | Two readings, one narrowing coverage | One reading, additive, with a CI assertion | **No.** The surviving reading is the *wider* of the two |
| TA-04 | No converse check | `I17f(c)` added | **No.** Net addition |
| TA-05 | Unbounded override | Bounded per-override and in aggregate by `I63` | **No.** The escape is narrower than before in every dimension, including scope: rows 1 and 2 and `IRRECOVERABLE` are now structurally unreachable, which they were not |
| TA-06 | Undeclared signal | Signed, `max_age`-bounded, replay-protected, reachability characterised | **No.** The corroborated state is *harder* to reach than an undeclared signal made it |
| TA-07 | Two behaviours for one condition | One state-qualified behaviour model | **No.** The surviving behaviour is the *stricter* one — `UNCORROBORATED_STALL` suspends where the superseded rows dispatched |
| TB-01 | Three-term printed `CHECK` | Four-term guard | **No — term added** |
| TB-02 | Exposure retained in every status, in every instance, forever | Retained in every status, for every instance held; no new instance except for `LIVE` | **No.** The within-window property Mechanism B exists for — a successor cannot acquire a paused predecessor's headroom — is preserved exactly. What lapses is a future instance the authorisation acquired only through a formula with no instance term. **Checked explicitly against `62 §11` condition 1's named temptation, *"retaining forward exposure in fewer statuses"*: the status set is unchanged at four** |
| TB-03 | Ambiguous; every reading double-counted | `total_exposure = 0.00`, exposure in term 2 | **No.** `I18b` remains an exact equality and is satisfied exactly; `I2` is satisfied by a real row, not an exemption |
| TB-04 | `realised` inside a refusing `CHECK` | `realised` inside the *bound*, outside the *refusal* | **No, and this is the one to check carefully.** The guard reads `NEW.realised_monetary`, so realised spend still consumes headroom for the next commitment. What was removed is the database's ability to refuse an *observation*, which was never a safety property — registry `§3` item 3 already conceded settled cost may exceed the ceiling and simply had not noticed the excess was unrecordable |
| TB-05 | Six conjuncts, two unevaluable, identifier undeclared | Declared derivation, named timestamp, directional tie-break | **No.** The removed conjuncts referenced fields the source does not contain and could never have been evaluated. The tie-break is strictly conservative in both legs — earliest wins *and* exposure held on all candidates |
| TB-06 | No transition invariant; `any → EXPIRED` | `I62`, explicit source set | **No — invariant added** |
| TJ-01 | Path claimed bounded | Path stated as unbounded for one subset | **No.** An honest statement of a limit is not a weakened invariant; it is the removal of a false one |

**Two repairs were available and were deliberately not taken, because each would have failed this condition.** Making `standing_monetary` a generated column on the *aggregate* would have been simpler than the per-authorisation row plus trigger, and would have silently under-reserved whenever one authorisation overran, because `max(0, ·)` does not distribute over sums. And widening `max_override_*` until the eight-day outage in `61 §A3` is coverable would have made TA-05 read cleanly, at the cost of the property that makes it safe. Both are recorded in the ledger at the point of decision.

**Result: PASS.**

---

## V3 — Cross-artifact mechanism identity

**Condition.** Every mechanism stated in more than one normative artifact must have identical states, transitions, operands, limits, behaviour and thresholds. This is the mechanical defence against AUDA-01-style drift, which `62`'s closing observation records as having appeared in v1.0, in v1.1's remediation of it, and in v1.2's remediation of that.

**Method.** Mechanical where the mechanism has a machine-findable signature (C21, C22, C24, C25); by inspection for the rest, with the sites enumerated.

| Mechanism | Normative sites | Identical? |
|---|---|---|
| Mirror state machine and dispatch precedence | `30 §5.1`, `30 §5.6`, `22 §3.1`, `36 §6`, `36 §14`, `35 §12.1`, `34` ADR-013 | **Yes.** C21 finds zero operational statements lacking the state qualifier. This is TA-07 and it is the fourth occurrence of the defect class; the condition exists so there is not a fifth |
| `window_balance` schema and the four-term guard | `24 §3` K5 **only** — declared the single authoritative source, with `51 §2` and `36 §2` cross-referring rather than restating | **Yes, by construction.** One statement cannot disagree with itself. C22 compares it against the registry's operand list |
| `StandingAuthorization` transition set | `24 §3.1`, registry `I62`, `36 §2` VC-S2, `51 §5` | **Yes.** C24 finds no outbound `REVOKED` transition anywhere |
| `DegradedModeOverride` | `30 §5.7.2` (semantics), `51 §3.6` (limits), `24 §3` K9 (custody), registry `I63` (enforcement), `50 §2` class 25 | **Yes.** Semantics in one place, limits in one place, neither restated |
| `MirrorInputStallSignal` | `30 §5.7.1` (contract), `30 §5.6` (reachability), `30 §5.7` (signal table), registry `I17f` (`max_age` as operand), `50 §2` class 24 | **Yes** — see V11 |
| `I8` sweep cadence and scope | `30 §5.10` (rule and reasoning), `51 §3.2` (values), registry `I8` (operand block) | **Yes.** C25 finds no site still naming the undeclared quantity |
| Window-instance scoping | `24 §3.1` (rule), `26 §10.1` (formula), `51 §3.2` (fixture) | **Yes.** C23's denylist finds no surviving *"last referenced window"* |
| Attestation cadence and `k` | `30 §5.4`, registry `I17e`, `36 §2` VC-A1 | **Yes**, unchanged from v1.2 |

**Result: PASS.**

---

## V4 — DB CHECK entailment

**Condition.** Every printed DB `CHECK` or guard expression is mechanically compared with the authoritative invariant operand set. Specifically verify the corrected `I3` / `window_balance` expression.

**Method.** Mechanical, C22. Registry **rule 9** is the standing form of this condition and is new in v1.3.

The printed guard in `24 §3` K5:

```
IF (NEW.reserved_monetary  > OLD.reserved_monetary
 OR NEW.standing_monetary  > OLD.standing_monetary
 OR NEW.presumed_monetary  > OLD.presumed_monetary)
   AND (NEW.reserved_monetary + NEW.standing_monetary
      + NEW.presumed_monetary + NEW.realised_monetary) > NEW.max_monetary
THEN RAISE 'I3_WINDOW_EXHAUSTED';
```

Registry `I3`'s operand list: **reserved, standing, presumed_settled, realised**, against `w.ceiling_*`, per ledger. Printed operand set: `reserved_monetary`, `standing_monetary`, `presumed_monetary`, `realised_monetary`, `max_monetary`. **Exact match, four terms, no omission and no extra.** v1.2's printed expression carried three and omitted `standing`, which is TB-01.

One note the condition surfaces and does not fail on: **the enforcement is a guard rather than a bare `CHECK`**, because a `CHECK` is unconditional and TB-04 requires the four-term sum to gate a commitment while never refusing an observation. The condition compares operand sets, not SQL keywords, and the guard's operand set is the invariant's.

**Result: PASS.**

---

## V5 — Current figures only

**Condition.** Current operational artifacts contain only current v1.3 limits. Historical values may appear only in explicitly historical or change-log context.

**Method.** Mechanical, C5, C6 and C23 — the restated versions, implemented as **denylists of superseded values and semantic combinations** rather than as agreement checks over current ones. This is the specific repair for the two false PASSes.

Eight denylist patterns over the deliverables: `MAL_total` as `$600`; `$180` as a standing basis; `MAL_total(day)` as `$173.50`; `$5,205`; `$120 irrecoverable` as current; *"roughly 24 items"*; the retired scalar `cessation_lag` used as a live operand; *"the last referenced window"*. **Zero operational hits.** Three sites were corrected during the pass: `36 §12`, `37 §5` and `26 §10.5`. Two further sites — `22 §3` and `33 §2.5` — were corrected under TOS-01, which TB-09's semantic search surfaced.

**Deliberately not flagged:** `min(UNBOUNDED, $180.00) = $180.00` in `26 §10.1` and `36 §2` VC-L2. That is fixture F2's grant sum, it is correct, and it is why C23 keys on combinations rather than on bare figures. **A denylist that flagged it would have been turned off, which is how the v1.2 conditions came to test nothing.**

**Result: PASS.**

---

## V6 — Rate first-authorisation semantics

**Condition.** A specification-level trace of the first `campaign.budget.set` in an empty valid window yields **PERMIT**. If it denies, FAIL.

**Method.** Two independent computations. The specification-level trace is in `26 §2.1.3`. The numeric check is in `analysis/recompute-v1.3.py`, computed from `26 §2.1.3`'s declared field values and `51 §2`'s ceilings without reading the printed answer.

```
W_MONTH_ADSPEND   reserved=0.00 standing=186.00 presumed=0.00 realised=0.00
                    sum=186.00  vs ceiling=186.00  -> PERMIT
W_DAY_ADSPEND     reserved=0.00 standing=12.00  presumed=0.00 realised=0.00
                    sum=12.00   vs ceiling=12.00   -> PERMIT
```

`total_exposure = 0.00` for the rate class, so `I18b`'s exact equality holds against a zero-amount reservation row; `vendor_amount IS NULL`, so `I18a`'s null branch applies and `I18c` is vacuous; the economic quantity is `forward_integral` in `I3` term 2. **Terms 1 and 2 no longer describe the same money**, which is the whole of TB-03.

**VC-S7 asserts this at runtime and no pre-existing verification case did.**

**Result: PASS.**

---

## V7 — Window-crossing standing semantics

**Condition.** A paused old `StandingAuthorization` crosses a month boundary. Old current-window exposure lapses according to the declared instance rule. It does not acquire new-month forward exposure. A valid successor can obtain new-month authority. Late predecessor spend cannot silently become successor spend.

**Method.** Specification trace against `24 §3.1`'s declared rule and `51 §3.2.2`'s derivation. VC-S5 and VC-S6 are the runtime assertions.

| Step | State | Result |
|---|---|---|
| 1 Jan, `campaign.budget.set` $6.00/day | `LIVE`; `standing_window_exposure(s1, W_MONTH_ADSPEND, 2026-01)` created, `standing_cap = $186.00` | Permits (V6) |
| 3 Jan, pause dispatched and verified | `PAUSED`; realised $18.00; `forward_monetary = $168.00` | **Retained.** A second January authorisation denies `WINDOW_EXHAUSTED` — the property Mechanism B exists for, unchanged |
| 1 Feb, 00:00 company timezone, DB clock | Boundary job runs for `status = LIVE` only. `s1` is `PAUSED`, so **no February row is created** | February `standing_monetary = $0.00`; headroom **full at $186.00** |
| 1 Feb, successor `s2` authorised on campaign C | `LIVE`; February row created | **Permits.** Under v1.2's literal formula this denied, permanently |
| 5 Feb, Google Ads posts delayed **January** delivery | `derive_sa_id` keys on `segments.date` — the delivery date, in January — so `\|A\| = 1` and the candidate is **`s1`** | Attributed to the **predecessor**; raises `STANDING_SPEND_AFTER_EXPIRY`; **`s2` does not absorb it** |
| `s1` after `expires_at + cessation_grace` | Zero in-scope instances | **Exempt from `I55`**, so no permanent `STANDING_UNREVOCABLE` CRITICAL — the consequence that would otherwise have survived the fix |

**The one thing this condition does not assert, stated rather than glossed.** A `PAUSE_PENDING` authorisation — pause dispatched, outcome unknown — also acquires no February row, so if the platform is in fact still spending there is at most one instance of unreserved real spend. `24 §3.1` states the three controls that bound it and the ledger states why re-reserving `PAUSE_PENDING` indefinitely was rejected: it reintroduces the permanent exhaustion being repaired. **This is a declared residual of the chosen rule, not an unnoticed gap.**

**Result: PASS.**

---

## V8 — Override compositional bound

**Condition.** Repeated maximum-valid `DegradedModeOverride` exercises cannot exceed the owner-signed aggregate limits. Use an independent calculation.

**Method.** `analysis/recompute-v1.3.py`, computed from `51 §3.6` and `51 §2` rather than from the prose.

```
3 x per-override  ->  hours=72  effects=15  monetary=150.00
aggregate caps    ->  hours=72  effects=8   monetary=100.00
  hours     equal
  effects   AGGREGATE binds
  monetary  AGGREGATE binds
aggregate monetary 100.00 < W_MONTH_REFUND 250.00: True
aggregate effects  8      < W_MONTH_REFUND count 10: True
=> override cannot raise realisable loss above the signed MAL_total: True
```

**The aggregate leg binds before the per-override leg on both consumable quantities**, which is the point: rotating action classes, expiring and recreating, and stacking outages all run into the same rolling-window ceiling. A5's question — *can repeated bounded overrides compose into effectively unbounded degraded-mode authority?* — is now **answerable and answered no**, where against v1.2 it was unanswerable.

**And the safety argument is arithmetic rather than asserted.** Every aggregate is strictly below the already-signed ceiling it draws against, and an override releases a dispatch gate rather than an exposure gate, so `MAL_total` is unchanged and no re-signature is triggered.

**Result: PASS**, with the usability residual recorded in ledger TA-05 and revisited in `§13` below.

---

## V9 — Audit frozen-prefix wording

**Condition.** No current artifact states that `I17` or `I17e` detect attester suppression. The adversarial-attester negative control is present and expected **not** to fire `I17e`.

**Method.** Inspection of the eleven sites `61 §A8` enumerated, plus the four v1.3 restatements.

| Site | v1.3 statement |
|---|---|
| Registry `I17` honesty clause | Extended: says explicitly it does not establish that the attested maximum equals the true maximum |
| Registry `I17e` | Restated as continuity plus attested-prefix consistency, with an explicit non-assertion clause and a dedicated residual block |
| Registry `§3` item 9 | **New.** Names the frozen prefix and enumerates the no-detector class |
| `30 §5.4` | Three-facts statement; two distinct what-it-does-not-do cases |
| `30 §5.5` | Case 2 split into 2a and 2b with different detectors and different bounds |
| `30 §5.9` | Corrected: the 15-minute bound holds against transport loss, not against the attester |
| `30 §7` | Detector table gains a row for the frozen-prefix case marked *"Deterministic, partial"* |
| `22 §3.1` | Compensating-controls sentence qualified to the vendor-touching subset |
| `34` ADR-013 | v1.3 amendment states the claim correction first |
| `36 §2` VC-A1 | Now asserts seven cases and that case 2b's no-vendor-counterpart subset is caught by **nothing** |
| `37` S1 | States that `I8` proves nothing at S1, so cases 2b and 4 have no operative detector at that slice |

**The negative control.** `36 §2` **VC-A1d**: truncate the push at 900 of 1,000 **and adjust the attestation to the frozen prefix**; assert `I17e`, `I17` and `ATTESTATION_STALL` all **do not fire**; **a run in which any fires is a test failure.** `62 §10` obligation 13. VC-A1a is retained and now discriminates rather than conflates.

**Result: PASS.**

---

## V10 — `I8` coverage

**Condition.** The current specification says: independent vendor enumeration; tag list additive; sweep cadence explicitly declared; detection bound expressed with vendor lag separately.

| Requirement | Where |
|---|---|
| Independent vendor enumeration | `30 §5.10`: *"enumerates the audit plane's own vendor reads exhaustively over the period since the previous sweep"*; registry `I8` statement carries it in the invariant text, not a note |
| Tag list additive, never scoping | `30 §5.10` and registry `I8`: *"an additional mandatory verification list… never a restriction of the sweep's scope. The sweep's external query is never restricted to ACOS-provided effect identifiers or tags"*; CI/review assertion; control artifact class 26 |
| Sweep cadence explicitly declared | `51 §3.2` per adapter — 1 h processor / commerce / ESP, **6 h `google_ads`**, 1 h default; scheduling owner the audit plane; `30 §5.10` carries the justification |
| Detection bound with vendor lag separate | `I8_sweep_cadence(adapter) + vendor_reporting_lag(adapter)`, first `CONFIGURED`, second `UNMEASURED` / `IMPLEMENTATION_VALIDATION_REQUIRED`; **no artifact prints it as one number**, C25 checks it |

**Result: PASS.**

---

## V11 — Corroboration contract

**Condition.** Every artifact agrees on signal schema, signer, endpoint, `max_age`, replay rule and reachable outage classes.

| Element | Value | Stated in |
|---|---|---|
| Schema | Ten fields plus signature | `30 §5.7.1` only |
| Signer | Audit plane, Ed25519, key never leaves the audit host; control plane holds the public key as control artifact class 24 | `30 §5.7.1`, `50 §2` |
| Endpoint | `GET /audit/v1/mirror-input-stall`, audit plane's own read host, pull only, no writes accepted | `30 §5.7.1` |
| `max_age` | **5 minutes**, `CONFIGURED`, `= attestation_cadence × 1 < attestation_cadence × k = 15 min` | `30 §5.7.1`, registry `I17f` operand block |
| Replay rule | Consumed `signal_id` journaled and non-reusable; independently, `I17f(a)` against the audit plane's own published intervals | `30 §5.7.1`, registry `I17f` |
| Reachable outage classes | Five-row table; **not reachable** on partition or audit-plane outage | `30 §5.6`, echoed in `22 §3.1` and `35 §12.1` |

**`max_age` is an operand of the transition under rule 6**, which is the specific gap TA-06 identified. **No artifact states a different value for any element**, because each is stated once and cross-referred.

**Result: PASS.**

---

## V12 — Standing transition invariant

**Condition.** Every transition table, invariant and test agrees. `REVOKED` has zero outbound transitions.

| Site | Content |
|---|---|
| `24 §3.1` | T1–T8, plus a `REVOKED` row reading *"Terminal. Zero outbound transitions."* `any → EXPIRED` replaced by `{LIVE, PAUSE_PENDING, PAUSED} → EXPIRED` |
| Registry `I62` | *"Every `StandingAuthorization` transition is in the declared transition set of `24 §3.1` (T1–T8), and `REVOKED` has no outbound transition."* DB trigger over `(OLD.status, NEW.status)` |
| Registry `I23` | Enforcement corrected to the `I62` trigger plus the expiry sweep — a generated status cannot be transition-checked, so the two mechanisms were incompatible as printed |
| `36 §2` VC-S2 | Every permitted transition asserted; forbidden ones refused with the application check disabled; **`REVOKED → EXPIRED` called out and required to fail** |
| `51 §5` | Standing-lifecycle oracle row extended to the transition set |
| Registry `§2.8` | `I62` added; DB-enforced enumeration 21 → 23, counted from the list |

C24 finds no outbound `REVOKED` transition in any operational statement.

**Result: PASS.**

---

## 13. Additional conditions this pass added

Not required by the mission; added because the pass would otherwise not have been able to fail on things it should.

| Id | Condition | Result |
|---|---|---|
| **V13** | The consistency script exits non-zero on failure and is committed with the package, so a future edit that breaks a condition is caught by running one command rather than by re-reading twenty documents | **PASS** — `analysis/consistency-v1.3.py`, 15 conditions, exit code 1 on any FAIL |
| **V14** | The first run of the mechanical pass against the edited tree is **recorded rather than discarded** | **PASS** — 10 PASS / 5 FAIL, three real defects, all three fixed; recorded in `analysis/v1.3-consistency-audit.md §0` |
| **V15** | No numerical authority quantity changed, so no owner re-signature is required — computed rather than asserted | **PASS** — `analysis/recompute-v1.3-output.txt`; `MAL_monetary` $300.00, `Standing` $182.40/$186.00, `MAL_total` $756.00, all unchanged. TB-08(a), the one change that would have moved `MAL_total`, is deliberately scheduled rather than applied |
| **V16** | Every one of the seventeen `62 §10` obligations either points to an authoritative v1.3 section or is explicitly recorded as unchanged | **PASS** — `phase2-v1.3-implementation-brief.md §6` |

---

## 14. What this pass does not establish, and the honest cost of no fourth red team

`62 §5`'s authorisation rests on *"none of the fourteen introduces a new mechanism."* That is **true of the mechanisms and not quite true of the objects.**

**Three local specification objects are new in v1.3**, each required by a BLOCKING remediation rather than invented:

1. **`DegradedModeOverride`** (TA-05) — an entity, a state machine, an invariant and eight limits, where v1.2 had four prose sentences.
2. **`MirrorInputStallSignal`** (TA-06) — a signed artifact, a key, an endpoint and a freshness rule, where v1.2 had *"the audit plane's own signal."*
3. **`standing_window_exposure`** (TB-01, TB-02, TB-04) — a table with a generated column and a maintaining trigger, where v1.2 had a formula.

**None of them has been adversarially reviewed.** A verification pass checks that they are stated consistently and that they satisfy the conditions the third review named. It does not construct attacks against them. Three specific surfaces are worth naming so nobody has to rediscover that they were not attacked:

- **The override is the architecture's only remaining self-service relaxation**, and TA-15 established that the inversion converts unauthorised-dispatch risk into owner-manipulation risk. The bound is now quantified, but *whether a manipulated owner grants three overrides in thirty days* is a human question no invariant reaches.
- **The corroboration key is a new root of trust.** `50 §2` class 24 puts its public half in the manifest, so substitution is an `I19` mismatch. Compromise of the audit-plane host, which holds the private half, is `49`'s territory and is bounded by nothing inside ACOS.
- **The generated-column-plus-trigger construction is a concurrency claim**, and `62 §11` condition 8 already makes its failure pass-revoking. It is asserted from the specification here and **measured** at S1 by VC-S8, which is the correct order and is why obligation 16 exists.

**And the residual class that no review would remove.** Registry `§3` items 9, 10 and 11 are limits on what a push mirror plus an attestation can establish, not defects awaiting repair. TJ-01 is **not prevented** and v1.3 does not claim it is. What changed is that the architecture's claims now match what it can enforce, which is the standard `62 §12` sets.

---

# Gate

- All fourteen blockers applied: **yes** (V1)
- No blocker fixed by weakening an invariant: **yes** (V2)
- TB-09 applied: **yes** (ledger `§5`; V5)
- TOS-04 recorded and corrected: **yes** (ledger `§5`; `analysis/v1.3-consistency-audit.md §0`)
- V1–V12 all PASS: **yes**
- V13–V16 all PASS: **yes**
- Mechanical pass: **15 of 15**, exit 0
- Arithmetic oracle: **no discrepancy**; no signed quantity moved
- Any remaining consistency failure that changes the S1 money or audit path: **none**

# READY FOR S1 IMPLEMENTATION

**Scope of this statement.** It authorises the S1 boundary defined in `phase2-v1.3-implementation-brief.md`, and nothing beyond it. It does not authorise S2, production deployment, real money, real customers, live advertising, or any of the categorically prohibited capabilities `62 §9` enumerates and this pass neither adds to nor removes from. Seven of the fourteen remediations carry explicit residuals and four lower-severity findings carry `S1 BEFORE IMPLEMENTING RELATED COMPONENT` markers naming a component that may not be built until they land. **`READY` is a statement about the specification's implementability, not about the system's safety in production, and the ten pass-revocation conditions in `62 §11` remain live throughout S1.**

**Grade: DECISION.** Made by the ACOS architecture remediation team on the v1.3 package, 2026-09-03.
