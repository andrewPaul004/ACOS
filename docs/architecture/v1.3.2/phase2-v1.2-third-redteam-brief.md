# ACOS Operating Spine v1.2 — Narrow Third Red Team Brief

**Phase 2.3. Issued 2026-09-03. Commissioned by `52 §4` and `58 §9`.**
**Package under review:** `acos-phase2-architecture-v1.2.zip`, unmodified.
**Reviewer:** a third independent architecture red team. Must not have authored v1.0, v1.1, v1.2, the first red team (`39`–`47`) or the second (`52`–`58`).

---

## 0. Why this review exists, and why it is this small

The second red team returned **CONDITIONAL PASS — REMEDIATION REQUIRED**: 0 FATAL, 22 BLOCKING, 24 MATERIAL, 6 MINOR, 4 WORDING, 10 attacks constructed and defeated. All twenty-two BLOCKING items are now `APPLIED` or `APPLIED WITH EXPLICIT RESIDUAL` (`phase2-v1.2-remediation-ledger.md`).

**Twenty of the twenty-two were stated values, missing schema fields, precedence orders, corrected sentences and one taxonomy extension.** They are remediation-and-verify. Re-reviewing them would trade the concentration that made the second pass useful for a survey, and `52 §4` says so explicitly.

**Two were new mechanisms.** A new mechanism has failure modes that did not exist to be found before it was written, and both of these change what a component *is*:

- **Mechanism A** gives the audit plane an independent input it did not have and a **veto** over a dispatch relaxation it previously could not observe.
- **Mechanism B** introduces a lifecycle whose release condition **has a commercial cost**, and `52 §4` is right that *"when may headroom return"* has no safe answer that does not also make pause-and-reauthorise impossible within a window.

Attack these two. Nothing else.

---

## 1. What is in scope — exactly two mechanisms

### Review Mechanism A — audit independent input and degraded-mode corroboration

**Findings:** SR-A1, SR-A2 (reviewed jointly; they are one mechanism).

**Primary artifacts:** `30 §5.4` (attestation), `30 §5.5` (the six omission cases), `30 §5.6` (the three-state mirror machine), `30 §5.7` (the actor/signal table), `30 §9.1` (the `source_record_ref` contract), `30 §5.1` (the split-halt precedence list, insofar as SR-A2 changes when its rows apply), `24 §3` K10, `24 §3` K11, registry `I17`, `I17e`, `I17f`, `I56`, `I8`, `22 §3.1`.

**In scope for A:**

- `JournalAttestation` rows: their sequence allocation, their transport, their cadence, and whether their absence is genuinely a positive signal rather than another silence.
- Attestation continuity as an audit-side check (`I17e`), and its parameters `attestation_cadence = 5 min`, `k = 3`, anchor interval 60 min.
- Audit-side stall detection and the publication of `MIRROR_INPUT_STALL` on the audit plane's own read endpoint.
- Degraded-mode corroboration: the three states `NORMAL`, `UNCORROBORATED_STALL`, `CORROBORATED_DEGRADED`, and specifically **the inversion** — that the uncorroborated state is stricter than normal operation, not looser.
- `DISPATCHED_UNMIRRORED` as a durable tag and as a mandatory input to `I8`'s next inverse sweep.
- The RECORD-grade clock source contract: `clock.source_record_ref`, its enumerated kinds, and the claim that a model classification can route a case but never create a clock (`I56`).
- The interaction with `I8`: what transport completeness does and does not prove, and whether the relocation of the unqualified claim to `I8` is honest or is relabelling.
- The owner override that escapes `UNCORROBORATED_STALL`: per-class, time-boxed, count-capped, auto-expiring, tagged, distinct second approver.

### Review Mechanism B — standing exposure cessation and release

**Finding:** SR-S2.

**Primary artifacts:** `24 §3` K5, `24 §3.1` (the five-state machine and its transition table), `26 §10.1` (the exposure-remainder form), `26 §10.5` (the commercial statement), `51 §3.2` (adapter characteristics and provenance), `51 §2` (window ceilings), registry `I3`, `I22`, `I23`, `I54`, `I55`.

**In scope for B:**

- The five states `LIVE | PAUSE_PENDING | PAUSED | EXPIRED | REVOKED` and every transition.
- Forward-exposure retention in **every non-`REVOKED` status** — a deliberate strengthening beyond `57`'s two-status retention. Attack the strengthening as well as the rule: does retaining in `EXPIRED` create a state from which nothing escapes?
- The release condition: `REVOKED` requires `I54`'s verification read showing zero incremental spend attributable to the `standing_authorization_id` across `cessation_lag`.
- `cessation_lag` as an adapter characteristic with declared provenance, and the **conservative default when it is `UNMEASURED`**: no `REVOKED` transition exists at all.
- Successor/predecessor charge matching: `reconciler_match_rule` scoped to one `standing_authorization_id`.
- Revocation under uncertainty, including the `StandingRevocationAuthority` (SR-S3) insofar as B depends on it — the revocation path must be *available* for B's lifecycle to terminate.
- The commercial inability to pause-and-reauthorise within a window, and whether `26 §10.5` and `51 §3.2` state it honestly enough that an owner would not be surprised.

---

## 2. What is explicitly out of scope

**Do not attack:**

- All twenty-two remediations as a set.
- **R1 generally.** SR-C1's field split, SR-C2's `enumerate_effects`, SR-C3's content-addressed options and SR-C4's constructor versioning are remediate-and-verify.
- **MAL generally.** SR-L1's `min()` typing, SR-L2's window ceilings, SR-L3's order-driven declarations and SR-L4's `PRESUMED_SETTLED` are remediate-and-verify. **Exception:** `I3`'s multi-term sum enters scope *only* through §3 question B4, and only as a question about whether Mechanism B's retained term remains enforceable at one commit point.
- **Approvals generally.** SR-R1's lifetime reconciliation, the Approval state machine, `RemedyObligation`, SR-R2's proof table, SR-R3's `value_direction` and SR-R4's `I51`.
- **Audit mechanics generally.** SR-A3's canonical bytes, SR-A4's sequencing, SR-A5's re-push handling and SR-A6's precedence order. **Exception:** SR-A4 and SR-A5 enter scope *only* where Mechanism A depends on them — attestation rows use the same counter (A4) and the same idempotent push path (A5), so a defect in A's *use* of them is in scope while the mechanisms themselves are not.
- The whole architecture, Option A, the technology selection, the MVP slice order, the business model, or anything Phase 1 settled.
- Anything the first red team (`39`–`47`) or the second (`52`–`58`) already classified and that `57` did not require changing.

**If a defect outside these two mechanisms is found**, record it in an out-of-scope section with its severity and do not expand the pass. `53 §7`'s discipline, applied again.

---

## 3. The questions the review must answer

Numbered so the response can be checked for completeness. **`57 §6` poses four; they are A1, A3, B1 and B4 below. The remainder are the questions v1.2's specific construction raises and the second review could not have posed.**

### Mechanism A

**A1.** Does the attestation row close **tail truncation** *and* the **stopped-writer** case, without introducing a control-database read and without introducing a new suppression channel of its own? Specifically: an attestation is itself a control-plane-authored row on a control-plane-operated push path. What stops a compromised control plane from emitting *truthful-looking attestations for a truncated journal* — that is, attesting `max_journal_seq = 900` while the journal is at 1,000?

**A2.** `I17e`'s parameters are `attestation_cadence = 5 min` and `k = 3`, against a 60-minute anchor interval. Is a 15-minute detection latency the right number, and what does an attacker achieve inside it? Is the cadence-shorter-than-anchor constraint the right constraint, or is the binding relationship to something else?

**A3.** Does corroborated degraded mode remain **enterable during a genuine two-sided provider outage**? `30 §5.6`'s answer is that it does not — a genuine audit-plane outage leaves ACOS in `UNCORROBORATED_STALL`, where clock-bearing compensable effects **suspend**, and the escape is the bounded owner override. Is that an acceptable availability posture, or is it an availability deadlock with an owner-shaped hole in it? Construct the case where the owner is unavailable and a statutory clock expires.

**A4.** **The inversion is the load-bearing claim.** `30 §5.6` asserts that an uncorroborated stall is *stricter* than normal operation, so a compromised control plane declaring degradation harms itself. Attack that: is there any effect class, any state, or any composition in which unilaterally declaring `UNCORROBORATED_STALL` **benefits** the declaring party? Consider the case where the attacker's goal is a halt rather than a dispatch.

**A5.** `30 §5.7`'s actor/signal table claims to say exactly which actor can create, attest, change and consume every degraded-mode signal. Find a signal it omits, an actor it mis-assigns, or a path by which a signal's consumer can influence its producer.

**A6.** `I17f` is two-sided: (a) no `DISPATCHED_UNMIRRORED` without a concurrent audit-side `MIRROR_INPUT_STALL`; (b) no `MIRROR_INPUT_STALL` without a journaled control-plane declaration or an open `ATTESTATION_DIVERGENCE`. Is clause (b) evaluable by its declared owner, given that the control plane's declaration reaches the audit plane over the very path whose failure is being detected? This is the circularity to look for.

**A7.** `I56` claims a clock is created by a deterministic detector over a **retained RECORD** and never by a triage classification. For the FTC refund clock, the RECORD is the customer's own raw inbound message. Does that make *every* inbound message a potential clock, and if so, is the detector's determinism doing any work — or has the model's influence merely moved from classification to the choice of what gets retained and ingested?

**A8.** `I8` now carries the unqualified completeness claim with its coverage limits attached. Is the relocation honest? Specifically: does any document still read as though `I17` plus `I17e` establishes that no effect escaped the record?

**A9.** `DISPATCHED_UNMIRRORED` is a mandatory input to the next `I8` sweep. What happens to the tag set if the control plane is the party writing the tag? Construct the case where an effect dispatched under degradation carries no tag.

### Mechanism B

**B1.** Does `cessation_lag` produce a **coherent standing lifecycle**? Walk every transition in `24 §3.1` and find one that cannot be reached, one that cannot be left, or one whose forward exposure accounting is wrong at the boundary.

**B2.** The conservative default when `cessation_lag` is `UNMEASURED` is that **no `REVOKED` transition exists**. Is holding exposure to window close actually conservative, or does it create a worse failure — an accumulating set of unrevocable authorisations that exhausts `W_MONTH_ADSPEND` permanently, so that advertising can never restart even after the campaigns genuinely stopped?

**B3.** **What is the commercial cost of a window in which advertising cannot be reauthorised?** `26 §10.5` and `51 §3.2` state it. Is the statement complete? Consider: a mid-month creative failure, a platform policy suspension, a supplier outage requiring an immediate spend stop, and a seasonal peak falling the day after a pause.

**B4.** Does `I3`'s four-term sum — open reservations + non-`REVOKED` standing forward exposure + `PRESUMED_SETTLED` + realised — **remain enforceable as a single DB-checked bound** under `51 §2`'s declared ceilings, at one commit point, with the declared lock order? `24 §3` K5's `window_balance` row is the claimed mechanism. Attack the claim that four terms fit in one `CHECK`.

**B5.** Forward exposure is retained in **every** non-`REVOKED` status, including `EXPIRED`. `57`'s SR-S2 required retention in `LIVE` and `PAUSE_PENDING` only. Is the strengthening safe, or does it create a terminal-but-not-terminal state — an authorisation that is expired, unrevocable because `cessation_lag` is unmeasured, and holding exposure with no path forward?

**B6.** `reconciler_match_rule` is scoped to a single `standing_authorization_id`. Where does the charge's `standing_authorization_id` come from? If it is derived by ACOS rather than carried by the vendor, the scoping is a self-assertion. Construct the case where a predecessor's charge is attributed to a successor anyway.

**B7.** `I54` requires a verification read **from the audit plane's own vendor credential**. Attack the composition: what if the audit plane's advertising read credential is unavailable, rate-limited, or returns a stale figure? Does `I54` fail closed, and is failing closed the right direction here given B2?

**B8.** The exposure-remainder form (`26 §10.1`) is v1.2's answer to STD-04, and it is not what `57` specified — `57` specified `rate × remaining_periods × (1 + overdelivery_allowance)`. `51 §4.3` argues the remainder form is strictly better against the constructed attack. **Check that argument.** Find a delivery pattern under which the remainder form under-reserves where the multiplicative form would not.

### Joint

**J1.** Mechanisms A and B compose in one place: `I54`'s verification read is an audit-plane action, and `30 §5.6`'s `UNCORROBORATED_STALL` is a state in which the audit plane may be unavailable. **What happens to a `PAUSE_PENDING` standing authorisation during an audit-plane outage?** Neither mechanism's documentation walks this and it is the obvious composition.

**J2.** The final gate, asked exactly as `52 §1` asked it: **does a realistic sequence exist in which the system exceeds its declared authority boundary, or escapes its declared audit record, through Mechanism A or Mechanism B, without a required invariant firing?** If one exists, it is FATAL or BLOCKING regardless of how narrow this brief is.

---

## 4. What the reviewer should assume

- **The other twenty remediations are applied as described.** Read them for context; do not attack them. `phase2-v1.2-remediation-ledger.md` states each disposition and each residual.
- **The v1.1 architecture that survived two passes stands.** Option A, the Postgres-centric modular monolith, the kernel-side Effect Canonicaliser, kernel-state approvals, the separate hash-chained audit store, the split halt's IRRECOVERABLE boundary. `55 §1` endorsed the EM15/EM16 trade explicitly and `58 §3` endorsed it again; do not renegotiate it.
- **Nothing is implemented.** No schema exists, no code exists, no vendor account exists beyond the audit-separation provisioning `58 §9` permits. Attack the specification.
- **`IMPLEMENTATION_VALIDATION_REQUIRED` markers are honest, not evasive** — or say so if they are not. Each names a slice in `58 §12` and a conservative default. A residual that hides a decision behind a measurement is a finding.

---

## 5. Severity vocabulary

Reused from `46` and `52` so the three passes are comparable.

| Severity | Meaning |
|---|---|
| **FATAL** | The mechanism cannot work as designed. Requires abandoning it or returning to a rejected alternative. |
| **BLOCKING** | The mechanism can work and the specification is wrong in a way that must be repaired before S1 code. |
| **MATERIAL** | A real defect with a local repair that can be scheduled after S1 begins. |
| **MINOR** | A defect worth recording that does not change behaviour materially. |
| **WORDING** | A claim stronger than its mechanism, repaired by restating the claim. |

**Report attacks that fail as well as attacks that succeed.** `53 §6` recorded ten defeated attacks and that record is what made its twenty-two findings credible.

**Base-rate note.** The first pass found 0 FATAL across 92 defects; the second found 0 FATAL across 56. Do not inflate a BLOCKING into a FATAL to justify a conditional verdict, and do not deflate one to reach a pass.

---

## 6. Required deliverables from the third pass

1. **`59-third-redteam-verdict.md`** — one of `PASS`, `CONDITIONAL PASS — REMEDIATION REQUIRED`, or `FAIL`, with the finding that determines the verdict stated first.
2. **`60-third-redteam-attack-register.md`** — every attack attempted, including defeated ones, with severity, affected artifacts, the constructed path, and a specified remediation for each finding.
3. **`61-mechanism-verification.md`** — the answers to every numbered question in `§3`, so completeness is checkable.
4. **`62-implementation-gate-v2.md`** — whether S1 implementation is now permitted, what remains prohibited regardless, and what must be tested during implementation rather than proved on paper. `58 §12`'s twelve obligations carry forward and should be amended rather than replaced.

---

## 7. The gate this review controls

`58 §9`: S1 is permitted once `57`'s twenty-two T1 items are applied **and** the third review returns on SR-A1, SR-A2 and SR-S2. The first condition is met. **This review is the second condition and nothing else in the package is waiting on anything else.**

Two consequences the reviewer should hold in view.

- **A `PASS` here opens S1**, and S1 builds the constructor, the exposure ledger, the journal with its sequence and chain, and the kernel-state approval path — the surface all twenty-two defects landed in. A defect missed here is a defect built.
- **A `FAIL` on Mechanism A specifically** triggers `58 §13` condition 2: `I17`'s completeness claim degrades permanently to WORDING and the split halt's unsuppressibility argument loses its second leg. That is a large consequence and it should not be reached casually — but it should be reached if the mechanism cannot obtain an independent input path without either reading the control database or introducing a new suppression channel.
- **A `FAIL` on Mechanism B** is more likely to be a business-model finding than an engineering one (`58 §13` condition 3), and saying so plainly is more useful than an engineering remedy that hides the cost.

**This brief does not authorise implementation and neither does a passing verdict on its own.** `62-implementation-gate-v2.md` is where that decision is recorded.
