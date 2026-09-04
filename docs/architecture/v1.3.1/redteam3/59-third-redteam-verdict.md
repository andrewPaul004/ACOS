# 59 — Third Independent Architecture Red Team: Verdict

**Phase 2.4. Issued 2026-09-03. Package under review: `acos-phase2-architecture-v1.2.zip`, unmodified.**
**Scope: `phase2-v1.2-third-redteam-brief.md` §1 — Review Mechanism A (SR-A1, SR-A2) and Review Mechanism B (SR-S2). Nothing else.**
**Reviewer: third independent architecture red team. Did not author v1.0, v1.1, v1.2, `39`–`47`, or `52`–`58`.**

---

# CONDITIONAL PASS — REMEDIATION REQUIRED

---

## 1. The determining finding

**TJ-01. A realistic sequence exists in which an external effect escapes the record the package claims for it, with no invariant firing, and the sequence runs entirely through Mechanism A's own components.**

The construction, in full:

1. The control plane is compromised. It does **not** declare degradation. It stays in `NORMAL`, where `30 §5.1`'s precedence list does not apply and the full dispatch table is live.
2. It stops pushing journal rows at `journal_seq = 900` while the control journal advances to 1,000.
3. It **continues emitting `JournalAttestation` rows at the declared 5-minute cadence**, each attesting `max_journal_seq = 900`, `row_count = 900`, and the genuine `head_hash` of the true chain at 900. Every attestation is internally consistent and independently recomputable.
4. `I17` passes: the audit store's `journal_seq` set is gap-free and consistent with the latest received attestation.
5. `I17e` passes: attestations are continuous within `cadence × k`, every `journal_seq ≤ max_journal_seq` is present, and the recomputed `head_hash` matches.
6. `ATTESTATION_STALL` does not fire. Attestations are arriving.
7. `I17f` has nothing to evaluate. No effect carries `DISPATCHED_UNMIRRORED`, because the declared state is `NORMAL` and the tag is only required outside it — so clause (a) is vacuous. The audit plane has not published `MIRROR_INPUT_STALL`, because it is receiving attestations — so clause (b) is vacuous.
8. `I17b` anchors the audit store's own frozen holdings, hourly, and they are self-consistent.
9. Effects dispatched in the suppressed range reach vendors. They are bounded by `I3`'s window ceilings and by adapter credential scope, and by nothing else.
10. The **only** detector is `I8`. Its sweep cadence is declared in no artifact. `30 §5.5`'s bound column for the analogous case reads *"Inverse-sweep cadence"* — the name of an undeclared quantity. And `I8`'s row states that the `DISPATCHED_UNMIRRORED` tag set is *"a mandatory input to each sweep, so the reconciliation target is a specific set rather than a time period"*, which admits a reading in which the sweep's **scope** is the tag set. Under that reading the tag set is empty and `I8` detects nothing, ever.

**What this defeats.** `30 §5.5` case 2 — *"Row written locally, push permanently suppressed → caught by `I17e` → bound ≤ 15 min"* — is false whenever the suppressing party is the attesting party, which is the only party that suppresses. Case 2's detection depends on the attestation being honest about `max_journal_seq`, so it bounds **transport loss**, not **suppression**. `30 §5.4`'s *"What it does not do"* paragraph identifies a neighbouring case (rows omitted *before* attesting, where *"`max_journal_seq` is simply lower, and the attestation is truthful about a chain that never contained the omitted effect"*) and does not identify this one, in which the control chain **does** contain the omitted rows and the attestation is therefore **false** — and undetectably so.

**What it does not defeat.** Mechanism A obtains a genuine independent input. The *absence* of attestations is an observation the other party makes and the control plane cannot forge, and it closes the stopped-writer case at 15 minutes as claimed. `55 §8`'s condition 1 is satisfied. `58 §13` condition 2 is **not** triggered: the audit plane has acquired an independent input path without reading the control database and without opening a new suppression channel. The attestation channel is not a new suppression channel — it is the existing push path carrying one more row kind.

**Why BLOCKING and not FATAL.** Every leg has a local repair, specified in `60` and summarised in `§4` below: restate case 2, declare the sweep cadence, close the tag-set reading, and add the missing dispatch→tag detector. None requires abandoning the attestation, the inversion, or the relocation of the completeness claim to `I8`.

**Why it is the determining finding.** The brief's `§3` J2 asks precisely this question and states that an affirmative answer is FATAL or BLOCKING regardless of the brief's narrowness. The answer is affirmative.

---

## 2. Severity counts

| Severity | Mechanism A | Mechanism B | Joint | Out of scope | Total |
|---|---|---|---|---|---|
| **FATAL** | 0 | 0 | 0 | 0 | **0** |
| **BLOCKING** | 7 | 6 | 1 | 0 | **14** |
| **MATERIAL** | 2 | 7 | 0 | 1 | **10** |
| **MINOR** | 1 | 2 | 0 | 2 | **5** |
| **WORDING** | 1 | 0 | 0 | 0 | **1** |
| **Attacks constructed and defeated** | 5 | 4 | 1 | — | **10** |

Zero FATAL. `47` found zero across 92 defects, `52` found zero across 56, and this pass found zero across 30. The base rate holds and no BLOCKING has been inflated to justify the conditional verdict — the two mechanisms' central concepts both work.

---

## 3. Did each mechanism pass?

### Mechanism A — audit independent input and degraded-mode corroboration: **CONDITIONAL PASS**

**What is sound, and should not be renegotiated.**

- **The inversion is correct and it is the most valuable single change in v1.2.** Making `UNCORROBORATED_STALL` stricter than `NORMAL` removes the incentive to lie about the mirror rather than trying to gate a lie that cannot be gated. Attack TA-11 attempted unilateral entry into `CORROBORATED_DEGRADED` and was defeated: the relaxation requires an audit-plane signal, and `I17f(a)` is evaluated from the audit plane's own record of what it published, so a fabricated or replayed corroboration is detected against a fact the control plane does not hold. `52 §1` Path B is closed.
- **The attestation delivers a real, previously absent property**: silence is distinguishable from idleness within 15 minutes by an observation the audited party cannot forge.
- **Relocating the unqualified completeness claim to `I8` is honest, not relabelling.** Registry `§3` items 1, 2 and 7 and `30 §5.5` case 4 all say plainly what transport completeness does not establish. A8's answer is that the relocation is honest at every site this review checked, with one residual overclaim (TA-01) and one undeclared bound (TA-02) attached to the receiving invariant rather than to the claim.

**What blocks.** Seven items, all local:

| Id | Defect | Severity |
|---|---|---|
| TA-01 | `30 §5.5` case 2's 15-minute bound does not hold against the attester; `VC-A1`'s test passes for the wrong reason and has no adversarial-attester negative control | BLOCKING |
| TA-02 | `I8` — now the sole detector for both omission residuals — has **no declared sweep cadence** anywhere in the package. Registry rules 5 and 6, violated in the invariant v1.2 relocated the load-bearing claim onto | BLOCKING |
| TA-03 | `I8`'s tag-set sentence admits a reading in which the tag set **scopes** the sweep rather than adding to it. Two readings, opposite coverage, no precedence — AUDA-01's signature, third occurrence | BLOCKING |
| TA-04 | Nothing detects a dispatch under degradation that carries **no** tag. `I17f(a)` checks tag → corroboration and never dispatch → tag | BLOCKING |
| TA-05 | **The owner override that escapes `UNCORROBORATED_STALL` is specified nowhere.** The ledger and the brief both describe it as per-class, time-boxed, count-capped, auto-expiring, tagged and requiring a distinct second approver. `30 §5.6` and `22 §3.1` state only that it is journaled, displays the affected classes and the elapsed clock time, and changes no ceiling. No duration, no count, no expiry, no second-approver rule, no state, no invariant. AUD-07 is recorded as closed and is not closed | BLOCKING |
| TA-06 | The transport, authentication and freshness of the `MIRROR_INPUT_STALL` signal the control plane consumes are undeclared, so the transition that unlocks the relaxation has an undeclared operand — registry rule 6 applied to a state transition | BLOCKING |
| TA-07 | `36 §6`'s *"Audit mirror unreachable"* row and `36 §14`'s chaos row state the **pre-inversion** behaviour with no v1.2 amendment, contradicting `30 §5.6` and `36 §2`'s own `VC-A2`. Tests are written from `36` | BLOCKING |

TA-05 is the one to note beyond the determining finding. The override is now **load-bearing** — it is the sole escape from a state the architecture deliberately made stricter — and it is the one component of Mechanism A that received no specification at all. The brief's `§1` in-scope list describes six properties it should have; the architecture declares none of them. A5's question — *can repeated bounded overrides compose into effectively unbounded degraded-mode authority?* — cannot be answered against v1.2, because there are no bounds to compose. Under the brief's own instruction that a yes is BLOCKING, an unanswerable is not better.

### Mechanism B — standing exposure cessation and release: **CONDITIONAL PASS**

**What is sound.**

- **The lifecycle's shape is right.** Releasing forward exposure in exactly one state, and requiring evidence rather than a status change or a successful API response to reach it, closes `54 §4.2` at the level of design intent. `PAUSE_PENDING` is the state v1.1 lacked and needed.
- **The conservative default is the right direction.** No `REVOKED` transition while `cessation_lag` is `UNMEASURED` fails closed on the axis that matters, and the commercial cost is stated in two artifacts rather than discovered.
- **The flagged deviation from `57 §2` is correct on the axis it was raised for, and this review vindicates it.** Attack TB-15 attempted to defeat the exposure-remainder form through under-reported spend, delayed posting and negative adjustments, and failed: because `realised + forward ≡ standing_cap` identically, under-reporting **over**-reserves. The remainder form is strictly stronger than `rate × remaining_periods × (1 + allowance)` against reporting error, not merely more permissive on day 2. B8 is answered in the deviation's favour, with one cost (TB-08).
- **Retaining exposure in `EXPIRED` is safe as a strengthening**, subject to TB-02. `24 §3.1`'s property 3 — that `EXPIRED` is not an absorbing safe state — is the correct reading.

**What blocks.** Six items:

| Id | Defect | Severity |
|---|---|---|
| TB-01 | `24 §3` K5's printed `window_balance` `CHECK` is `reserved + presumed + realised <= max_monetary` — **the standing term is absent**, and the row's column set contradicts registry `I3`'s. If implemented as printed, Mechanism B's sole claimed property is enforced by nothing in the artifact that declares the enforcement | BLOCKING |
| TB-02 | *"Held until the last referenced window closes"* is defined nowhere, and `forward_exposure(s, w, t) = max(0, standing_cap(s,w) − realised_spend(s,w,t))` recomputes to the **full** `standing_cap` in every subsequent instance of a recurring named window for any non-`REVOKED` authorisation. Two implementations get permanent exhaustion of `W_MONTH_ADSPEND` and correct lapse respectively | BLOCKING |
| TB-03 | No declared handoff between the rate class's own reservation (`I3` term 1, `I18b`-bound to `total_exposure`) and the `StandingAuthorization`'s forward exposure (term 2). `total_exposure` for a rate class is undefined against the separate `forward_integral` field. Every literal reading double-counts, and the **first** `campaign.budget.set` denies `WINDOW_EXHAUSTED` | BLOCKING |
| TB-04 | The atomicity between the asynchronous realised-spend update and the standing term's recomputation is undeclared. Since `forward = cap − realised`, the two must move in one row update: realised-first transiently breaches the `CHECK`; standing-first transiently creates headroom acquirable without the standing authorisation's own lock | BLOCKING |
| TB-05 | `charge.standing_authorization_id`'s provenance is undeclared and is **not** vendor-carried on the one declared adapter. The `reconciler_match_rule`'s six conjuncts require fields from two different vendor reads and neither source carries all of them. The SR-S2 repair is a self-assertion | BLOCKING |
| TB-06 | **No invariant asserts that `StandingAuthorization` transitions lie in the declared set.** The Approval machine got `I60`; the other new state machine in the same release got nothing. And `any → EXPIRED` literally includes `REVOKED`, which resurrects released exposure and guarantees an `I55` `STANDING_UNREVOCABLE` at CRITICAL | BLOCKING |

TB-01 is the one to note. It is the same class of defect as LIM-05 — an enforcement column naming a primitive that cannot express the property — except inverted: the registry now names a mechanism that *can* express it and the artifact declaring the mechanism prints an expression that omits the term the mechanism exists for. Registry rule 2 gives the registry precedence over inconsistent *citation*; it does not repair a schema, and S1 builds the schema from `24 §3` K5.

---

## 4. Remediation summary

Fourteen BLOCKING items. All fourteen have local repairs and none requires returning to a rejected alternative. Full specifications are in `60`; the shape of each is:

**Mechanism A.** Split `30 §5.5` case 2 into transport-loss and attester-suppression, attribute the second to `I8` alone, and add registry `§3` item 9 for the class of suppressed rows that touch no vendor and therefore have no detector at all. Declare `I8`'s sweep cadence as an operand with a value. Restate `I8`'s tag-set sentence so the tag set is an additional mandatory verification list and never a scope restriction. Add a dispatch→tag detector (a third clause on `I17f`, or a new identifier) owned by the audit plane. **Specify the override**: its scope, its duration, its count cap, its expiry behaviour, its second-approver interval, its journal representation, and an invariant that bounds composition across consecutive exercises. Declare the `MIRROR_INPUT_STALL` signal contract — endpoint, signature, `max_age` — and make the `max_age` an operand of the `CORROBORATED_DEGRADED` transition. Amend `36 §6` and `36 §14`.

**Mechanism B.** Correct `24 §3` K5's `CHECK` and column set to match registry `I3`, or state which is authoritative and correct the other. Declare forward exposure's window-instance scoping and the re-reservation job's status filter. Declare `total_exposure` for rate classes and the reservation/standing handoff. Make the standing term a generated column over `(standing_cap, realised)` or declare the joint update under the declared lock order, and move an over-ceiling realised figure out of the `CHECK` into a breach event so financial truth can always be recorded. Declare the charge record's source and field set per adapter and the derivation of `standing_authorization_id` with an explicit ambiguity rule that never favours a successor. Add a transition invariant for the five-state machine and exclude `REVOKED` from `any`.

---

## 5. What would have produced each other verdict

**PASS** was available if the two questions in the prompt's final decision discipline both answered no. Both answer yes.

- *Can a compromised control plane use Mechanism A to relax its own audit requirements?* It cannot enter `CORROBORATED_DEGRADED` — the inversion holds. It **can** avoid the audit requirement entirely by staying in `NORMAL` and freezing the attested prefix, for a period bounded only by an undeclared quantity (TJ-01, TA-01, TA-02).
- *Can Mechanism B return economic headroom while the provider may still create spend attributable to the old authority?* Yes, by two routes: if K5's printed `CHECK` is implemented, the standing term never occupied the window at all (TB-01); and at the window boundary, whether exposure lapses and how a late-posted predecessor charge is attributed both turn on undeclared operands (TB-02, TB-05, TB-07).

**FAIL** was available on Mechanism A under `58 §13` condition 2 and on Mechanism B under condition 3. Neither is reached.

- Condition 2 requires that the audit plane **cannot** obtain an independent input path without reading the control database or introducing a new suppression channel. It has obtained one. The independent input is the audit-side absence of an expected signal, and it is genuinely unforgeable by the audited party. `I17`'s completeness claim does not degrade to WORDING; it degrades to *transport completeness plus a 15-minute bound on channel liveness*, which is what v1.2 already says it is, minus one case (TA-01) it claims and does not deliver.
- Condition 3 is not reached because it is about the *measurement*, and the measurement has not been taken. What this review adds is that `58 §12` item 9 is **not executable as written** (TB-07): `cessation_lag` cannot be measured without first declaring the authoritative timestamp and the interval start, and `I54` declares neither.

---

## 6. Two things this verdict deliberately does not do

**It does not treat the commercial restriction as a defect.** `26 §10.5` and `51 §3.2` are right that whole-window advertising commitment is a business-model consequence and not an engineering failure, and the correct response is not to weaken the release rule. TB-10 and TB-17 are findings about the **completeness of the disclosure**, not about the trade: the stated cost is that pause-and-reauthorise is impossible within a window, and the unstated costs are that a paused campaign cannot be resumed at all (there is no `PAUSED → LIVE` transition) and that a budget *change* on a live campaign is subject to the same arithmetic as a replacement (TB-17). An owner reading `26 §10.5` would expect to be able to tune a running campaign. On the specification as written, they cannot.

**It does not expand around what it found outside the two mechanisms.** Four out-of-scope items are recorded in `60 §5` with severities and no remediation pressure, and one of them bears on how much weight the package's own self-verification should carry: `analysis/v1.2-consistency-audit.md` conditions **C5** and **C6** returned PASS, and both are false. `$756.00` appears in exactly one deliverable; `36 §12` and `37 §5` still state `MAL_total(month) = $600` composed of `$180` standing — the superseded multiplicative basis — and `36 §12` is the artifact that specifies `I7`'s oracle. That is in scope for B as a stale statement of Mechanism B's own quantity (TB-09), and out of scope as a finding about the gate. The audit's own `§4` item 2 anticipates the general risk. It did not anticipate that two mechanical conditions would return the wrong answer.

---

## 7. Status

**ACOS Operating Spine v1.2 does not enter S1 implementation on this verdict.** The gate decision, the amended validation obligations and the exact next authorised boundary are in `62-implementation-gate-v2.md`.

Fourteen BLOCKING items must be applied. Ten MATERIAL and lower are scheduled per `62 §9`. On application, a **verification-only pass** over the fourteen is sufficient — none of them introduces a new mechanism, so none requires a fourth adversarial review.

**Grade: DECISION.** Made by the third independent architecture red team on the package as delivered, 2026-09-03.
