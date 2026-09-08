# 61 — Mechanism Verification

**Phase 2.4. Issued 2026-09-03. Answers every numbered question in `phase2-v1.2-third-redteam-brief.md §3`, in order, so completeness is checkable. `§3` of this document answers the additional questions posed by the Phase 2.4 review prompt where they are not already covered.**

Finding ids reference `60-third-redteam-attack-register.md`.

---

# 1. Mechanism A

## A1 — Does the attestation close tail truncation *and* the stopped-writer case, without a control-database read and without a new suppression channel? What stops truthful-looking attestations for a truncated journal?

**Stopped writer: closed.** `ATTESTATION_STALL` at `k × cadence` = 15 minutes, on an **absence** observed by the audit plane. The control plane cannot forge an absence at the other party, and `30 §5.7` row 2 is correct that this is the one control-plane-facing signal that is not forgeable. This is the property `55 §8` condition 1 required and it is delivered.

**Tail truncation: closed against a transport failure or an out-of-band truncation. Not closed against the attester.** The distinction is the whole answer.

- **Out-of-band truncation** — rows removed from the mirror by a third party while the control plane attests honestly at `max_journal_seq = 1,000` — is detected by `I17e`'s consistency leg within one cadence, and this is what `36 §13.1` VC-A1a tests.
- **Attester-side truncation** — the control plane withholds rows 901–1,000 and attests `max_journal_seq = 900` with the genuine head hash at 900 — is **not detected by anything**. TA-01.

**What independent fact does the audit plane actually possess?** Exactly three, and they are worth separating because the package's prose runs them together:

1. **That attestations are arriving at cadence.** Unforgeable. Bounds channel liveness at 15 minutes.
2. **That the rows it holds are internally consistent, gap-free, and match the attested prefix's independently recomputed `head_hash`.** Unforgeable, because the audit store re-chains over the transmitted `ACOS-JCS-1` bytes under its own trigger (`I17d`, `I41`). This is what defeats TA-13.
3. **Nothing whatsoever about the control journal's true maximum sequence.** The audit plane has no independent reading of it, and by construction cannot — R10 removed the replica deliberately and `24 §3` K11's declared inputs contain no control-journal read.

**So the honest statement is the one the brief asks for directly: the mechanism proves completeness relative to the latest attested prefix, plus liveness of the attestation channel.** It does not prove liveness or completeness of the journal. `30 §5.5` case 2 claims the second and delivers the first.

**Is that enough combined with `I8`'s vendor-side inverse sweep?** Partially, and the qualification is where the review lands.

- For the subset of suppressed rows describing effects that reached a **readable vendor system**, `I8` is a genuine independent detector. Its bound is `sweep_cadence + vendor_reporting_lag`, and **`sweep_cadence` is declared in no artifact in the package** (TA-02) while `vendor_reporting_lag` is the same unmeasured quantity as `cessation_lag` (TB-07). So the bound exists and its value does not.
- For the subset describing **no vendor-touching effect** — authorisations, denials, reservations, approvals, state facts, escalations, clock creations, override exercises, and the `DISPATCHED_UNMIRRORED` tags themselves — there is **no detector at all**, under any reading. This class is large and it is precisely the record of authority use.
- And under `I8`'s coverage-narrowing reading (TA-03), even the vendor-touching subset is uncovered when the tag is omitted (TA-04).

**No control-database read is introduced.** Confirmed: the attestation travels the existing push path as one more `journal_row_kind`. R10's decision stands.

**No new suppression channel is introduced.** Confirmed, and this is the reason `58 §13` condition 2 is not triggered. The attestation adds a row kind to a channel the control plane already controlled; it does not create a second unverified path. `30 §5.4`'s first bullet — *"an attestation that could be pushed outside the chain would be a second unverified channel"* — anticipated the risk correctly and the design avoids it.

**Verdict on A1.** The mechanism is real, the independence is real and narrower than claimed, and one enumerated case is claimed and not delivered. **TA-01 BLOCKING, TA-02 BLOCKING.** Not FAIL.

---

## A2 — Is 15 minutes the right number, and what does an attacker achieve inside it? Is cadence-shorter-than-anchor the right constraint, or is the binding relationship to something else?

**What 15 minutes means operationally, which is the part the prompt insists on.** It is *not* a window of degraded dispatch. It is a window of **full-table dispatch**, and that is the finding.

A control plane that stops pushing has two options.

- **Declare the stall.** It enters `UNCORROBORATED_STALL`, `30 §5.1` applies, and row 3 **suspends**. It has made itself stricter. This is the inversion working.
- **Say nothing.** Its declared state remains `NORMAL`. `30 §5.1`'s precedence list is titled *"Dispatch precedence while the mirror is unreachable"* and applies to the degraded states; in `NORMAL` there is no mirror-derived restriction at all. So for up to 15 minutes it dispatches **IRRECOVERABLE effects, above-floor effects, discretionary compensable effects — everything** — with no mirror behind any of them, and no tag on any of them because the tag attaches to effects *"dispatched outside `NORMAL`"*.

**The second option is strictly better for the attacker and the architecture does not discuss it.** `30 §5.6`'s inversion argument — *"there is no longer anything to gain by lying"* — is correct about lying in the direction of declaring degradation. It does not address lying in the direction of declaring health, which is TA-01's frozen prefix and which extends the 15 minutes to indefinite.

**What is achieved inside the window, quantified against the fixture.** Containment is `I3`, not Mechanism A:

| Bound | Value |
|---|---|
| Refunds | `W_DAY_REFUND`: $50.00, count 2 |
| Store credit | `W_DAY_CREDIT`: $12.50, count 1 |
| Discretionary irrecoverable | `W_DAY_MIE`: 13 units — 2 reships, 1 address edit, 10 emails |
| Advertising | `W_DAY_ADSPEND`: $12.00 |
| Total | `MAL_total(day)` p95 = **$329.50** |

Plus the unbounded tails `26 §10.4` already enumerates: platform identity, utterance liability, reputational effect of 10 irrecoverable sends, chargeback exposure. **The irrecoverable sends are the real cost inside the window**, because `30 §5.1` row 1 exists specifically to prevent unmirrored irrecoverable dispatch and the `NORMAL`-declared path walks straight past it.

**Does detection occur before or after damage? After.** `ATTESTATION_STALL` at 15 minutes reports that the channel died; the effects already went. Recovery information is available — the control journal holds the rows, locally chained, and `I8` can read the vendor side — so the posture is *detectable after the fact with recovery possible*, which is an acceptable posture and is not the posture `30 §5.5` describes.

**Which invariant fires.** `I17e` (`ATTESTATION_STALL`) at ≤15 min in the stop-pushing case; then `I17f(b)` raises `ATTESTATION_DIVERGENCE` at CRITICAL because the audit plane published `MIRROR_INPUT_STALL` with no journaled control declaration. In the frozen-prefix case **none of them fires**, ever, which is TA-01.

**Is 15 minutes the right number?** For its stated purpose — *"a control plane that cries wolf every Tuesday teaches the owner to ignore it"* — `k = 3` is well reasoned and `k = 1` would be wrong. The number is defensible.

**Is cadence-shorter-than-anchor the right constraint? No — it is a necessary consequence, not the binding relationship.** The anchor bounds *rewrite*; the attestation bounds *silence*; `30 §5.4` says so itself. Requiring `cadence < anchor_interval` guarantees only that the finer-grained detector is finer-grained. The three relationships that actually bind are:

1. **`k × cadence` against the fastest irrecoverable dispatch path.** The window's cost is measured in irrecoverable effects, not in minutes, so the constraint should be stated against `W_DAY_MIE`'s replenishment and the outbox's dispatch rate. Fifteen minutes is 10 discretionary emails at the daily ceiling.
2. **`k × cadence` against `I17f`'s own evaluation interval**, which is `SCHED` with no value. A 15-minute stall detection feeding a corroboration check that runs hourly bounds nothing at 15 minutes.
3. **`k × cadence` against `I8`'s sweep cadence**, because `I8` is the backstop for everything the transport checks miss and its cadence is undeclared (TA-02).

**Verdict on A2.** The parameter is defensible; the constraint it is declared against is the wrong one; and the operational meaning of the window is materially worse than stated because the `NORMAL`-declared path is not considered. Folded into **TA-01** and **TA-02**; the constraint restatement is part of TA-02's remediation.

---

## A3 — Does corroborated degraded mode remain enterable during a genuine two-sided outage? Is `UNCORROBORATED_STALL` an acceptable availability posture or an availability deadlock with an owner-shaped hole? Construct the case where the owner is unavailable and a statutory clock expires.

**Enterable? Almost never, and less often than `30 §5.6` implies.** `30 §5.6` frames the residual as the *genuine two-sided outage* case. The real characterisation is stronger: because the corroboration signal must travel from the audit plane to the control plane and that transport is undeclared (TA-06), the set of outages in which `CORROBORATED_DEGRADED` is reachable is approximately:

| Outage | Audit can observe? | Audit can publish? | Control can read it? | Reachable? |
|---|---|---|---|---|
| Network partition between planes | yes | yes | **no** | **No** |
| Audit store down | no (its checks cannot run) | no | — | **No** |
| Audit plane host down | no | no | — | **No** |
| Audit insert quota saturated (`I17c`) | yes | yes | yes | **Yes** — but `30 §5.1` item 5 declares saturation *"an incident, not a mode change"* |
| Push path degraded, read path healthy | yes | yes | yes | **Yes** |

So the relaxation is available in a narrow slice, and in the one case the architecture explicitly names it is declared not to be a mode change at all. **The corroborated state is close to unreachable and nothing says so.** That is TA-06's second leg and it should be stated in `30 §5.6`, because it changes how the residual reads: the residual is not an edge case, it is the common case.

**The constructed case, walked to expiry.**

1. 09:00 Friday. A customer's retained raw inbound message (`I56` RECORD, content-hashed) starts an FTC 7-working-day refund clock. `refund.create`, `$30.00`, COMPENSABLE, above the `$25.00` per-action floor, so `TIER_1` approval is required and given at 09:20.
2. 09:30. Managed-Postgres incident at the audit provider. Both the audit store and its read endpoint are unavailable.
3. 09:31. The control plane observes push failures. Declares `AUDIT_MIRROR_DEGRADED`, journals it locally, enters `UNCORROBORATED_STALL`.
4. 09:46. The audit plane cannot publish `MIRROR_INPUT_STALL` — it is the thing that is down. No corroboration exists or can exist.
5. Precedence evaluation for the refund: row 1 no (COMPENSABLE), row 2 no (approval recorded, so it evaluates at row 3 per `30 §5.1`), row 3 **matches and degrades to suspend** in `UNCORROBORATED_STALL`.
6. The refund suspends. `I13` escalates with urgency from remaining time. `I58` is not engaged — this is a suspension, not a verify-mode denial — so no `RemedyObligation` is emitted, which is correct but means the obligation is tracked only by the clock.
7. The owner is unavailable. The outage runs eight days.
8. **The clock expires.** FTC 7-working-day breach on a $30 refund, with the money available, the approval given, the effect constructed, and the architecture declining to dispatch it because a *different database* is unreachable.

**Answers to the prompt's A4 sub-questions, which this case is the vehicle for.**

1. **What does ACOS do?** Suspends, escalates on the clock, breaches.
2. **What should it do?** For this specific case — COMPENSABLE, approved, clock-bearing, inside `MAL_monetary`, reversible in economic effect — **dispatch**, which is what `55 §6.3` endorsed and `58 §3` endorsed again. v1.2 reverses that behaviour for the uncorroborated state. The reversal is *defensible* (it closes Path B) and it is *recorded* (`34`'s ADR-013 v1.2 amendment states it), so this review does not call it a defect. It does call it a change in the endorsed behaviour that two artifacts still describe the old way (TA-07).
3. **Is violating availability preferable to allowing an unaudited effect?** For IRRECOVERABLE, yes, unambiguously — that is why row 1 is where it is. For an approved COMPENSABLE effect inside a statutory clock, against a **locally committed, locally chained, gap-free journal row**: no. `22 §3.1` argues this correctly and at length. The mirror adds unsuppressibility, and unsuppressibility matters most where the action cannot be undone. A $30 refund can be undone; a federal deadline cannot be un-breached.
4. **Does the bounded owner override solve the problem or transfer it to owner availability?** **It transfers it**, and the transfer is the correct choice — a human decision is the right resolution for a conflict between two evidence-mandated constraints. But the transfer is only sound if the override is specified, and it is not (TA-05). As written, the escape from the architecture's fail-closed state is a sentence saying the owner may override, with no scope, duration, cap, expiry or second-approver rule.
5. **Is there a configuration satisfying both requirements?** Yes, and it does not weaken the safety property. Three parts: (i) an **audit-plane-issued, signed, short-TTL stall attestation** that the audit plane publishes *proactively* on a rolling basis, so the control plane holds a recent one at the moment a partition begins and can enter `CORROBORATED_DEGRADED` on evidence issued *before* the outage — this converts a large part of the partition class from uncorroborated to corroborated without letting the control plane self-certify, because the artifact is audit-signed and time-bounded; (ii) a **third-party timestamping or transparency-log witness** (`30 §5.8` already evaluates candidates for `I17b`) as an alternative corroboration source, so corroboration does not depend on the same two-party path; (iii) the **specified override** as the residual escape. Recommended as the remediation direction for TA-06 rather than as an architecture change.

**Verdict on A3.** Not a deadlock — there is an escape and the fail-closed direction is right. It is an availability posture whose common case is worse than stated and whose escape is unspecified. **TA-05 BLOCKING, TA-06 BLOCKING.**

---

## A4 — Is there any effect class, state or composition in which unilaterally declaring `UNCORROBORATED_STALL` *benefits* the declaring party? Consider the case where the attacker's goal is a halt rather than a dispatch.

**For dispatch: no. The inversion holds and it is the strongest element of v1.2.** TA-11 constructed the declaration and it buys strictly less than silence. Enumerated across the precedence list, in `UNCORROBORATED_STALL` versus `NORMAL`:

| Row | `NORMAL` | `UNCORROBORATED_STALL` | Gain to declarer |
|---|---|---|---|
| 1 IRRECOVERABLE | dispatch | halt | negative |
| 2 above floor, not clock-bearing | dispatch | halt | negative |
| 3 clock-bearing COMPENSABLE | dispatch | **suspend** | negative |
| 4 COMPENSABLE discretionary | dispatch | suspend | negative |
| 5 REVERSIBLE | dispatch | dispatch | none |

Every row is worse or equal. There is no effect class for which declaring helps a party seeking to act.

**For a halt: yes, partially, and the architecture does not enumerate it.** TA-15. The declaration is a lever on availability rather than on authority, and the attacker goals the prompt lists divide cleanly:

| Goal | Achieved? | Why |
|---|---|---|
| Denial of service | **Partially.** One precedence row (clock-bearing COMPENSABLE) suspends; the company does not halt | Rows 1, 2, 4, 5 unchanged from `NORMAL`'s degraded behaviour |
| Approval flooding | **No.** Closed twice over | Blanket `REQUIRE_APPROVAL` removed (`30 §5.1` item 5); `I17c` makes saturation an incident; `30 §11`'s per-cause caps suspend the causing capability |
| Delaying customer remedies | **Yes** | Row 3 suspension is precisely a delayed customer remedy |
| Creating statutory deadline pressure | **Yes** | The suspended class is the clock-bearing class, by construction |
| Forcing owner intervention | **Yes** | The pressure has one declared resolution and it is the owner |
| Causing the owner to use the override | **Yes** | Follows from the above |
| Creating conditions under which a later override grants greater freedom | **Unknown, and unanswerable** | The override has no declared scope, duration, count, expiry or approver rule (TA-05), so what it grants is undefined |

**The last row is the finding.** The inversion converts an unauthorised-dispatch risk into an owner-manipulation risk, which the prompt correctly says still has an attack surface. Whether the converted risk is smaller depends entirely on what the override grants, and that is unspecified — so v1.2 has traded a *quantified* risk (row 3 dispatch, bounded by `MAL_monetary` and by the count of live clocks) for an *unquantified* one.

**Is the inversion nonetheless the correct trade? Yes, and unambiguously.** A self-declared *stricter* state is a categorically weaker lever than a self-declared *looser* one: the first can only deny, and denial is visible, escalating, clock-tracked and owner-facing; the second silently removes the external record from the effects the attacker most wants unrecorded. `52 §1` Path B was an authority escape; TA-15 is a pressure campaign. **Do not reverse the inversion. Specify the override.**

**Verdict on A4.** The load-bearing claim holds in the direction it was made. It is incomplete in the halt direction and the incompleteness is entirely absorbed by TA-05.

---

## A5 — Find a signal `30 §5.7`'s actor/signal table omits, an actor it mis-assigns, or a path by which a signal's consumer can influence its producer.

**Three omissions, one mis-scoping, no mis-assignment.**

**Omitted signal 1 — the transport of `MIRROR_INPUT_STALL` from audit to control.** The table lists what each actor *observes*. It does not list the signal the control plane must **consume** to enter `CORROBORATED_DEGRADED`, which is the only signal in the mechanism that crosses the trust boundary in the audit→control direction. Its producer, path, authentication and freshness are all absent. TA-06.

**Omitted signal 2 — the control plane's `AUDIT_MIRROR_DEGRADED` journal row as an input to `I17f(b)`.** The registry's rule-7 note says *"the control plane's degraded-mode declaration is itself a journal row, so the audit plane receives it on the same path as everything else — or does not, which is `I17e`."* That is the correct reasoning and the row belongs in the table, because it is the one signal whose *non-arrival* is definitionally indistinguishable from the condition it declares. A6 is about exactly this and the table is where it should have been visible.

**Omitted signal 3 — `DISPATCHED_UNMIRRORED` itself.** The tag is a degraded-mode signal, it is created by the control plane, it is consumed by `I8`, and it can be forged in the *negative* direction (omission) with no detector. The table's forgeability column would have exposed TA-04 immediately: *"Control plane | `DISPATCHED_UNMIRRORED` tag | **Yes, by omission**"*. Its absence from the table is why the defect survived.

**Mis-scoping — `I17f(b)`.** The table's framing treats both legs of `I17f` as invariants. Leg (b)'s violation raises the incident that satisfies leg (b), so it is a detector and cannot be falsified (TA-09). Not a mis-assignment of actor; a mis-classification of kind.

**Consumer influencing producer.** One path, and it is bounded. The audit plane's `MIRROR_INPUT_STALL` is produced from the absence of attestations — attestations the **control plane** produces. So the consumer of the corroboration signal is the producer of the signal's own input. The control plane can therefore *cause* the audit plane to publish `MIRROR_INPUT_STALL` by ceasing to attest, and then consume that publication as corroboration for `CORROBORATED_DEGRADED`.

**Why this does not break the mechanism.** `I17f(b)` catches it: a `MIRROR_INPUT_STALL` with no corresponding journaled `AUDIT_MIRROR_DEGRADED` declaration raises `ATTESTATION_DIVERGENCE` at CRITICAL. And if the control plane *does* journal the declaration to satisfy (b), it has entered the degraded path openly, with the declaration owner-visible in V7's side-by-side display, and it still had to stop attesting — which is itself the CRITICAL-severity condition. **The loop exists, it is detected in both branches, and the detection is on the audit plane's own facts.** Recorded as a defeated attack, not a finding; it is the structural reason `I17f`'s two-sidedness is worth having even though leg (b) is a detector rather than an invariant.

**On the prompt's A5 — can repeated bounded overrides compose into unbounded degraded-mode authority?** Unanswerable against v1.2, therefore BLOCKING under the prompt's own rule. There is no declared time box to expire, no count cap to exhaust, no per-class scoping to rotate through, no interval after which a distinct second approver is required, and no `Override` entity in `24 §3` to hold any of it. The composition attacks the prompt names — repeated outage, repeated override, rotating action classes, expiry and recreation, establishing a durable new authority state — are each unconstrained by anything written down. **TA-05 BLOCKING.**

---

## A6 — Is `I17f` clause (b) evaluable by its declared owner, given that the control plane's declaration reaches the audit plane over the very path whose failure is being detected? This is the circularity to look for.

**The circularity is real, the architecture resolves it, and the resolution is fail-closed and correct — but it is a routing rule dressed as an invariant.**

**The construction.** Control declares the stall and journals `AUDIT_MIRROR_DEGRADED`. The push path is down, so the declaration cannot reach the audit plane. The audit plane independently observes missing attestations and publishes `MIRROR_INPUT_STALL`. Now evaluate (b): *"No audit-plane `MIRROR_INPUT_STALL` exists without either a corresponding journaled control-plane declaration or an open `ATTESTATION_DIVERGENCE` incident."* The declaration exists but has not arrived. So (b) appears violated — and the violation's consequence is to raise `ATTESTATION_DIVERGENCE`, which is the second disjunct, which satisfies (b).

**What state results.** `UNCORROBORATED_STALL`, with an open `ATTESTATION_DIVERGENCE` at CRITICAL, and no path to `CORROBORATED_DEGRADED` because the corroboration signal cannot traverse the broken path either (TA-06).

**Does the inability to transport the declaration prevent the corroboration the design requires? Yes, and that is the intended result.** The prompt is right that failure to enter degraded mode is not automatically defective when fail-closed is intended. It is intended here: `30 §5.6`'s residual states it explicitly and prices it at an owner override. So the answer to the brief's question is **the three-state machine does not need another input path for correctness** — it needs one for *availability*, and whether to add one is the trade `A3` question 5 addresses.

**Two consequences worth recording.**

1. **`ATTESTATION_DIVERGENCE` cannot distinguish a lying control plane from a broken network.** In the honest-outage case it fires at CRITICAL on a routine infrastructure event; in the compromise case it fires identically. The severity is right (both are interesting) and the *attribution* is impossible, which registry `§3` item 1 already concedes for divergence generally. It means the owner sees a CRITICAL on every network partition, and `30 §11`'s aggregation applies to escalations rather than to invariant incidents, so the alert-fatigue path is open. MINOR, folded into TA-09's remediation.
2. **Leg (b) is unfalsifiable** (TA-09). Restate it as a detector so an invariant-health report does not show a check that always passes.

**Verdict on A6.** No defect in the machine's logic. **TA-09 MINOR**; the availability consequence is TA-06.

---

## A7 — `I56` claims a clock is created by a deterministic detector over a retained RECORD and never by a triage classification. For the FTC refund clock the RECORD is the customer's own raw inbound message. Does that make *every* inbound message a potential clock, and is the detector's determinism doing any work — or has the model's influence merely moved from classification to the choice of what gets retained and ingested?

**Every inbound message is a potential clock. The detector's determinism does real work. And the influence has moved further than the question suggests — not to the model, but outside the system entirely.**

**Does the determinism do work? Yes, three specific pieces.**

1. **It makes the citation checkable.** `source_record_ref` is not-null with an FK to the retained artifact and a content hash. A clock with an unresolvable reference is a critical incident. So *post hoc*, every clock's basis is verifiable against a retained artifact — which is exactly what AUD-06 said was missing, since a triage classification leaves nothing to check.
2. **It removes the model from the creation path.** `36 §13.2` VC-A2b — *"a triage worker classifying every case as a refund request must create **zero** live clocks"* — is a real discriminating test and it will pass, because the detector runs over retained content and not over the worker's output. `24 §3` K10's *"What AI may not do"* now includes *"Create a clock, or influence the fact a clock cites"*.
3. **It makes the grade gates apply.** `I28`, `I29` and policy steps G/H′/H″ apply to the citation as to any other precondition, so a contradicted or delegated fact cannot start a clock.

**What it does not do.** The model's influence has not moved to *what gets retained* — `K15` retains inbound content at ingress before any model sees it, so the retention decision is not model-influenceable, which is the right design. It has moved **outside ACOS**: the sender chooses. Three gaps follow (TA-08):

- **Population.** Anyone who can send to the support address can create clock-bearing cases, and `30 §5.1` row 3 is the relaxation. AUD-06's *"the attacker chooses which effects escape the mirror"* is narrowed from *a compromised internal component* to *any external sender*, which is a large improvement in the attacker's required position and not a closure.
- **Duplicates.** `I56` requires a non-null reference; it does not require uniqueness. **Duplicate records create duplicate clocks**, and no rule collapses them. `K15` dedupes webhooks on the platform's event id; for inbound mail the analogous identifier is sender-controlled. A resent message, a forwarded thread and a quoted reply all present retainable content.
- **Rate.** No bound on clock-bearing case creation. `30 §11`'s per-cause caps bound owner-visible escalation items; a clock is state swept by `I13` and is not an escalation until a threshold fires.

**Can an attacker manufacture expensive clock-bearing cases?** They can manufacture the *cases*. The expense is bounded by `I3` — `W_DAY_REFUND` at `$50.00`/2 and `W_MONTH_REFUND` at `$250.00`/10 — and each case still traverses the full policy sequence including the `$25.00` per-action cap against `total_exposure`. So this is an **auditability** finding of the same class as AUD-06 and not a money finding.

**Who creates the retained RECORD?** `K15` ingress, before any model. **Who deterministically decides that the record begins a clock?** A detector in `26 §9.5`'s pre-generation set — and *which* detector, with what predicate, is not written down for the FTC case. That matters because `30 §4` and `30 §7` place *"a detector pattern"* inside `I19`'s control-artifact classes, so the predicate is coverable; it is simply not enumerated. **Can a model influence record retention or the clock start time?** No, and no — `started_at` derives from the record. Good.

**Verdict on A7.** `I56` is a genuine and well-placed repair that closes the fabrication path and leaves the volume path open, and the claim *"a model classification can route a case; it can never create a clock"* is true as written. **TA-08 MATERIAL.**

---

## A8 — `I8` now carries the unqualified completeness claim with its coverage limits attached. Is the relocation honest? Does any document still read as though `I17` plus `I17e` establishes that no effect escaped the record?

**The relocation is honest at every site checked. One residual overclaim and one undeclared bound are attached to the receiving invariant rather than to the claim.**

**Checked sites, and what each says.**

| Site | Reading |
|---|---|
| Registry `I17` statement | *"**Transport completeness.**"* Titled, with a rule-7 honesty clause: *"transport completeness says nothing about an effect dispatched with **no row written on either side**. That property belongs to `I8` and to nothing else."* **Honest.** |
| Registry `§3` item 7 | *"`I17` and `I17e` do not detect an effect dispatched with no row written on either side."* **Honest, and new in v1.2.** |
| Registry `I8` row | Carries the unqualified claim with a coverage-limits block: cannot audit what never touched a vendor; silence is not evidence; out-of-band owner actions matched by a positive `OutOfBandAction` record and never by an exclusion rule. **Honest.** |
| `30 §5` table | Row renamed *"Transport completeness"*, with the AUD-01 reasoning stated in full. **Honest.** |
| `30 §5.4` closing | *"Only `I8`'s independent vendor reads catch that, which is precisely why the unqualified completeness claim was moved onto `I8`."* **Honest.** |
| `30 §5.5` | Six cases with detectors and bounds. **Case 4 honest; case 2 is TA-01's overclaim.** |
| `30 §5.9` | *"`I17` bounds *transport* omission and `I17e` bounds it to 15 minutes; only `I8`'s independent vendor reads bound omission at the source."* **Honest.** |
| `24 §3` K11 | Restated with the AUD-01 reasoning inline. **Honest.** |
| `22 §3.1` | Names `I8` as a compensating control. **Honest.** |
| `36 §1`, `36 §15` | Gate split into transport / attestation / two-sided state. **Honest** — `36 §1`'s *"complete, not merely unaltered"* carries the qualification per the ledger. |
| `34` ADR-013 v1.2 amendment | *"Its completeness claim is re-scoped."* **Honest.** |

**No document reads as though `I17` plus `I17e` establishes source completeness.** The relocation is not relabelling. `30 §5.5`'s six-case table is the single most useful artifact in Mechanism A and the review's recommendation is to keep its structure and repair one row.

**What is not honest, and it is on the receiving end.** Having moved the load-bearing claim onto `I8`, the package did not give `I8` a **bound**. Case 4's bound column reads *"Inverse-sweep cadence"* — the name of a quantity no artifact declares (TA-02). So the claim is honestly located and its strength is undeclared, which under registry rules 5 and 6 means the invariant carrying the package's strongest audit claim is not, by the package's own definition, an invariant. And the tag-set sentence on the same row admits a reading that narrows its coverage to a set the audited party populates (TA-03).

**Verdict on A8.** Relocation honest. **TA-02 BLOCKING, TA-03 BLOCKING, TA-01 BLOCKING** for case 2.

---

## A9 — `DISPATCHED_UNMIRRORED` is a mandatory input to the next `I8` sweep. What happens to the tag set if the control plane is the party writing the tag? Construct the case where an effect dispatched under degradation carries no tag.

**Construction.** The control plane is in `CORROBORATED_DEGRADED` — legitimately, with the audit plane's `MIRROR_INPUT_STALL` published and covering the interval. It dispatches a clock-bearing COMPENSABLE refund at row 3 and writes the effect row **without** the tag. Then walk every candidate detector:

| Check | Sees it? |
|---|---|
| `I17` transport completeness | No. The row may be present and gap-free in the mirror; a column's value is not a transport property |
| `I17e` attestation completeness | No. Same |
| `I17f(a)` | **No — vacuous.** It quantifies over effects that *carry* the tag |
| `I17f(b)` | No. It concerns the existence of `MIRROR_INPUT_STALL` |
| `I42`, `I1`, `I2`, `I3` | No. All hold; the effect is fully authorised, reserved and journaled |
| `I8` under reading (i) | **Yes, if the effect touched a readable vendor system**, at the undeclared cadence |
| `I8` under reading (ii) | **No.** The effect is not in the target set |

**Answers to the prompt's A8 sub-questions.**

- **Dispatch without tagging?** Yes. Nothing checks the converse direction. TA-04.
- **Remove the tag?** The tag is a column on a control-plane row. The local chain (`I41`, `I17d`) makes post-insertion alteration detectable *if the altered row is re-pushed or re-chained*; a control plane holding DDL or elevated credentials is outside that boundary and `49` says so. Within the `INSERT`-only model, removal after mirroring is detectable as a chain divergence.
- **Tag a different effect?** Yes, and it is worse than omission: it satisfies `I17f(a)` for the decoy while the real effect is untagged, and under reading (ii) it *redirects* the sweep.
- **Omit the tagged journal row?** That is TA-01 — and it composes: tag an effect, omit its row, freeze the prefix. `I17f(a)` cannot fire on a row the audit plane never received.
- **Alter the tag before mirroring?** Yes. `ACOS-JCS-1` hashes the transmitted bytes, so an alteration before transmission produces a self-consistent chain on both sides. The chain proves nothing about content truth — registry `§3` item 2 says exactly this.

**If the same compromised component both dispatches and tags, what independently discovers an omitted tag?** Under reading (i), `I8`'s vendor reads, for the subset that touched a readable vendor system, at an undeclared cadence. Under reading (ii), **nothing**. And for the non-vendor-touching subset, **nothing under either reading**.

**Exactly what classes `I8` can and cannot observe** — the prompt asks for this and the package does not enumerate it:

**Can observe** (a vendor-side artifact exists and the audit plane holds a read credential for it): `refund.create` (processor), `goodwill.credit.issue` (commerce platform), `campaign.budget.set` and `campaign.pause` (ads platform), `email.send` (ESP accepted-message counts, via `I20`), `fulfilment.order.create` and `fulfilment.reship` (commerce/fulfilment), `order.address.edit` (commerce), `price.change` (commerce), `social.post` (platform, if credentialed), `webhook.subscription.*` (commerce).

**Cannot observe**: every authorisation decision and denial · every reservation, release and `PRESUMED_SETTLED` transition · every approval, resume and `RemedyObligation` · every state fact and supersession · every escalation, incident and clock creation · every override exercise · every `StandingAuthorization` state transition · every `DISPATCHED_UNMIRRORED` tag · every enumeration read · every `OutOfBandAction` record. Plus, among effects: any class whose vendor system the audit plane holds no read credential for, any effect whose vendor-side trace is not retained long enough to be swept, and any effect on a mock adapter — which at S1 is **all four action classes**, so `I8` proves nothing at S1 by construction and `37` S1 does not say so.

**This class list is the honest answer to "what does Mechanism A actually prove" and it belongs in the package.**

**Verdict on A9.** **TA-04 BLOCKING**, with the class enumeration as part of its remediation.

---

# 2. Mechanism B

## B1 — Does `cessation_lag` produce a coherent standing lifecycle? Walk every transition in `24 §3.1` and find one that cannot be reached, one that cannot be left, or one whose forward-exposure accounting is wrong at the boundary.

**Full walk.**

| # | From → To | Trigger | Authority | External call | External verification | Exposure | Reachable | Escapable |
|---|---|---|---|---|---|---|---|---|
| 1 | `LIVE` → `PAUSE_PENDING` | Pause dispatched | `StandingRevocationAuthority` (`I55`) | `campaign.pause` | none yet | Retained | Yes | Yes |
| 2 | `PAUSE_PENDING` → `PAUSED` | Verification read confirms stop | — | none | **owner undeclared (TB-12)** | Retained | Yes | Yes |
| 3 | `PAUSE_PENDING` → `PAUSE_PENDING` | Pause fails/times out | same | retry, same idempotency key | none | Retained | Yes | **bound undeclared (TB-11)** |
| 4 | any → `EXPIRED` | `expires_at` | generated status (`I23`) | pause dispatch | none | Retained | Yes | Only via 5 |
| 5 | `PAUSED`/`EXPIRED` → `REVOKED` | `I54` cessation verification | audit-plane read | none | **the verification** | **Released** | **No at MVP** | — |
| 6 | `REVOKED` → — | terminal | — | — | — | — | — | — |

**Four defects.**

1. **Transition 5 is unreachable at MVP.** Declared, deliberate, correctly disclosed. Not a defect; it is the conservative default. It does mean transitions 4 and 2 lead to states with **no exit**, which the brief anticipates in B5.
2. **No `PAUSED → LIVE` transition exists.** Pausing is one-way. A paused campaign cannot be resumed, only replaced — and replacement needs headroom the paused authorisation holds. `26 §10.5` discloses that pause-and-reauthorise is impossible and does not disclose that *resume* is impossible, which is what an owner would actually attempt. TB-10.
3. **Transition 4's `any` literally includes `REVOKED`.** A revoked authorisation re-enters `EXPIRED` at `expires_at`, re-acquiring released forward exposure, while `I55` fires `STANDING_UNREVOCABLE` at CRITICAL because the revocation authority was destroyed on reaching `REVOKED`. Every pre-expiry revocation produces a guaranteed CRITICAL and an exposure resurrection. Unreachable at MVP; live the moment `cessation_lag` is measured. TB-06.
4. **No invariant asserts the transition set.** The Approval machine got `I60` for exactly this in the same release. The machine that gates money release got nothing. TB-06.

**The boundary accounting is wrong, and this is the answer to the brief's "one whose forward-exposure accounting is wrong at the boundary."** Every non-`REVOKED` state retains exposure, and `forward_exposure(s, w, t) = max(0, standing_cap(s,w) − realised_spend(s,w,t))` has no window-*instance* scoping. At the next `DISCRETE` boundary the balance resets, `realised_spend` in the new instance is zero, and the formula returns the **full** `standing_cap` for an authorisation that is dead and unrevocable. `I54`'s prose says exposure *"is held until the last referenced window closes"*; the formula holds it forever, because *"the last referenced window"* has no referent for a recurring named window. **TB-02 BLOCKING** — and it is the single defect that decides whether the company can advertise more than once.

**Verdict on B1.** The lifecycle's shape is coherent. Its termination is deliberate and disclosed. Its boundary accounting is undeclared and the two readings differ by *permanent exhaustion versus normal operation*. **TB-02, TB-06 BLOCKING; TB-10, TB-11, TB-12 MATERIAL/MINOR.**

---

## B2 — Is holding exposure to window close actually conservative, or does it create a worse failure — an accumulating set of unrevocable authorisations that exhausts `W_MONTH_ADSPEND` permanently, so advertising can never restart even after the campaigns genuinely stopped?

**Both, depending on an undeclared operand — which is the finding.**

The prompt directs: *"Determine whether exposure actually leaves the window when the window closes even though the authorisation remains non-REVOKED. If yes, identify the precise mechanism. If no, the architecture may accumulate unrevocable authorisations indefinitely. This must be explicit."*

**It is not explicit, and there is no mechanism.** The walk:

1. Day 1, 31-day January. `standing_cap(W_MONTH_ADSPEND) = $186.00`, ceiling `$186.00`.
2. Day 3: pause. `realised = $18.00`, `forward = $168.00`, retained. The platform actually stops immediately.
3. `cessation_lag` `UNMEASURED` → no `REVOKED` → permanently non-`REVOKED`.
4. **Daily boundary:** `W_DAY_ADSPEND` resets. `standing_cap(W_DAY) = $6.00 × 2.0 = $12.00`; `realised` in the new day is `$0.00`; `forward = $12.00`. The dead authorisation consumes the entire daily advertising ceiling, every day, forever.
5. **Monthly boundary:** `W_MONTH_ADSPEND` resets. `forward = max(0, $182.40 − $0.00) = $182.40` of a `$186.00` ceiling. `$3.60` of headroom remains — not enough for one day at `$6.00`.
6. **Grant expiry:** `expires_at` moves the status to `EXPIRED`. Exposure still retained. No change.
7. **`StandingRevocationAuthority`:** expires at `grant.expires_at + 72h`. After that, `I55` fires `STANDING_UNREVOCABLE` at CRITICAL — *"the authorisation cannot be created, or if already live, `STANDING_UNREVOCABLE` at CRITICAL"* — permanently, because the authorisation can never reach `REVOKED` and `I55` requires a live authority for every non-`REVOKED` one. **A permanent CRITICAL incident is the specified steady state for every standing authorisation ACOS ever creates.**
8. **New campaign attempt:** `DENY: WINDOW_EXHAUSTED`. Forever.

**So on the literal reading, B2's constructed worse failure is not a hypothetical — it is the specified behaviour, and it is worse than the prompt suggests because it also generates a permanent CRITICAL via `I55`.**

**The prose says otherwise.** `I54`'s default: *"forward exposure is held until the last referenced window closes, at which point it lapses with the window."* `51 §3.2`: *"the headroom returns when the window closes."* `26 §10.5`: *"a mid-month strategy change costs the remainder of the month's authorised exposure"* — *the remainder of the month*, implying the next month is clean.

**Two artifacts state the intent; no artifact states the mechanism.** LIM-02's exact signature.

**Is the conservative default the right direction?** Yes. `26 §10.5` is right that releasing on pause dispatch is unsound and right that releasing on `expires_at` is equivalent to holding to window close. The direction is correct and the *scope* of the hold is undeclared.

**Remediation (TB-02).** Declare `forward_exposure(s, w_instance, t) = 0` for every instance of `w` beginning after `s.expires_at` and for every instance in which `s` was non-`LIVE` throughout; declare that the boundary re-reservation job runs only for `status = LIVE`; replace *"the last referenced window"* with a phrase that has a referent; and add the cross-boundary case to VC-S2, which no current verification case covers. Additionally, exempt authorisations whose exposure has lapsed from `I55`'s live-authority requirement, or the permanent-CRITICAL consequence survives the fix.

---

## B3 — What is the commercial cost of a window in which advertising cannot be reauthorised? Is `26 §10.5` and `51 §3.2`'s statement complete? Consider a mid-month creative failure, a platform policy suspension, a supplier outage requiring an immediate spend stop, and a seasonal peak falling the day after a pause.

**The statement is honest and incomplete in three ways, one of which is a capability an owner would assume exists.**

**Stated.** *"Pausing a campaign does not return headroom. Pause-and-reauthorise within one window is not possible. At MVP, advertising is a whole-window commitment: a mid-month strategy change costs the remainder of the month's authorised exposure."* Displayed in V2 with status across all five states, `cessation_verified_at`, and the explicit fact that pausing does not return headroom — so the owner does not learn it from a denial. That is good disclosure and better than most of the package's peers.

**The four cases.**

| Case | Behaviour | Stated? |
|---|---|---|
| Mid-month strategy change | Costs the month's remaining exposure | **Yes** |
| **Mid-month creative failure** | Owner pauses to fix, then cannot resume — **no `PAUSED → LIVE` transition exists**. Replacement needs headroom the paused authorisation holds | **No**, and this is the gap that matters |
| **Platform policy suspension** | Platform stops spend; ACOS cannot verify cessation; exposure held to window close; Meta is not autonomy-eligible for rate classes (`51 §3.2`), so no substitute channel | **No** |
| **Supplier outage requiring an immediate stop** | The stop works correctly. The headroom does not return, so spend cannot be redirected for the rest of the window | **No** |
| **Seasonal peak the day after a pause** | Unreachable within the window | **No** |

**And a fifth the brief does not name, which is worse than any of them.** A `campaign.budget.set` on a campaign with a live `StandingAuthorization` — the ordinary operation, and the subject of `26 §8`'s headline worked policy — has no declared supersession. Either it mutates the existing authorisation (undeclared, and it would change `standing_cap` under a live reservation with no re-signature) or it creates a second non-`REVOKED` authorisation whose `standing_cap` **sums** into `Standing(w)`: `$186.00 + $213.90 = $399.90` against `$186.00`. **Deny.** So budget *tuning* is unavailable within a window for the same arithmetic reason as pause-and-reauthorise, and `26 §8`'s example of what the CEO may do describes an operation the exposure model forbids. **TB-13 MATERIAL.**

**Would the owner understand what this economically means?** Given V2's display, they would understand that pausing does not return headroom now. They would **not** understand that: a paused campaign is dead rather than paused; the budget of a running campaign cannot be changed; and when headroom returns depends on TB-02's undeclared rule.

**Is this a FAIL?** No, and the brief is right that a commercial restriction is not automatically an architecture defect. `26 §10.5` is also right that this is a business-model finding if `cessation_lag` measures long, and `58 §13` condition 3 is the right place for it. **Do not fix it by weakening the release rule.** Fix the disclosure, add the supersession rule, and let the owner decide whether advertising is viable under it.

**Plain statement of the prompt's B9, since it asks for one.** A campaign paused on day 2 of a 31-day month, with `cessation_lag` unmeasured and the platform having actually stopped immediately: `$12.00` realised, `$174.00` of forward exposure retained against a `$186.00` monthly ceiling. **93.5% of the month's advertising authority is unavailable for 29 days, and the campaign it was authorising is not running.** Under the literal reading of TB-02 it is unavailable permanently. **ACOS advertising is committed in whole-window chunks and, at MVP, in one chunk per window per resource.** That is the honest sentence and it should appear in `26 §10.5`.

---

## B4 — Does `I3`'s four-term sum remain enforceable as a single DB-checked bound under `51 §2`'s declared ceilings, at one commit point, with the declared lock order? Attack the claim that four terms fit in one `CHECK`.

**Four terms fit in one `CHECK` arithmetically. The claim fails for four other reasons, three of which are BLOCKING.**

**(a) The declared `CHECK` has three terms, not four.** `24 §3` K5 prints `CHECK (reserved_monetary + presumed_monetary + realised_monetary <= max_monetary)` over a row with no standing column, against registry `I3`'s `window_balance(company_id, window_id, reserved, standing, presumed_settled, realised, …)`. Different arity, different column names, different primary key. If K5 is implemented, **Mechanism B's term is enforced by nothing** and STD-02 reopens with no invariant firing. Registry rule 2 governs inconsistent citation of an identifier, not a schema, and S1 builds the schema from K5. **TB-01 BLOCKING.**

**(b) Two of the four terms describe the same money.** A rate class's own reservation (term 1, `I18b`-bound to `total_exposure`) and the `StandingAuthorization` it creates (term 2) are not distinguished, `total_exposure` for a rate class is undefined against the separate `forward_integral` field, and every literal reading double-counts — so the **first** `campaign.budget.set` denies `WINDOW_EXHAUSTED` against a ceiling that equals `standing_cap` exactly. **TB-03 BLOCKING.**

**(c) Term 2 is a function of term 4, and term 4 arrives asynchronously.** `forward = cap − realised`, so the two must move together in one row update. Nothing declares the atomicity or the lock. Realised-first transiently breaches the `CHECK` and **the spend cannot be recorded**; standing-first transiently creates headroom that a concurrent authorisation can consume by taking the row in the declared lock order **without touching the standing authorisation or any lock associated with it**. The prompt's sub-question — *can it create headroom without acquiring the same lock?* — answers **yes**. **TB-04 BLOCKING.**

**(d) `realised` inside a refusing `CHECK` makes truth conditional on compliance.** With zero slack between `standing_cap` ($186.00) and the ceiling ($186.00), any vendor delivery above the documented `30.4` basis produces a `realised` figure the `CHECK` refuses to store, and if stored would fire `I3` as *"a security incident — the control model itself has been breached"* for a vendor billing event. Registry `§3` item 3 already concedes settled cost may exceed the ceiling; it does not notice that the enforcement makes the excess unrecordable. **TB-08 MATERIAL.**

**Point-by-point against the prompt's B8 sub-questions.**

- *Can the standing component change outside the transaction?* **Yes** — on every vendor spend observation. TB-04.
- *Does it depend on stale vendor spend?* **Yes**, necessarily. The remainder form is safe under staleness (TB-15 proves `realised + forward ≡ cap`), so staleness makes the reservation conservative rather than wrong — the failure is in the *update path*, not the formula.
- *Can it be recomputed concurrently?* **Yes**, and nothing serialises the recomputation against an authorisation.
- *Can it age across a boundary?* **Yes**, and what happens is undeclared. TB-02.
- *Can it create headroom without acquiring the same lock?* **Yes.** TB-04.

**How does the DB balance row stay conservative between observations?** By the identity `realised + forward ≡ standing_cap`, which holds for any `realised ≤ cap` and is the exposure-remainder form's strongest property. So the *value* is conservative between observations; the *update* is not atomic. Making `standing_monetary` a generated column over `(standing_cap, realised_monetary)` fixes both at once and removes an independently writable authority quantity from the control plane's reach — that is the recommended repair.

**Verdict on B4.** Four terms are enforceable at one commit point with one declared `CHECK`, a generated standing column and a corrected rate-class handoff. **They are not enforceable as specified. TB-01, TB-03, TB-04 BLOCKING; TB-08 MATERIAL.**

---

## B5 — Forward exposure is retained in every non-`REVOKED` status, including `EXPIRED`. `57`'s SR-S2 required retention in `LIVE` and `PAUSE_PENDING` only. Is the strengthening safe, or does it create a terminal-but-not-terminal state?

**The strengthening is safe and correct. It creates exactly the terminal-but-not-terminal state the question anticipates, and whether that state is survivable is TB-02.**

**Why the strengthening is right.** `24 §3` K5's reason is sound: *"None of them establishes that the platform stopped spending."* `PAUSED` means the vendor acknowledged the pause, which is a statement about the vendor's control plane and not about its billing pipeline. `EXPIRED` means ACOS's authority lapsed, which is a statement about ACOS. Neither is evidence of cessation, and `24 §3.1` property 3 is right that `EXPIRED` is not an absorbing safe state — an expired authorisation whose platform is still spending produces charges that must match *it* and raise `STANDING_SPEND_AFTER_EXPIRY`, rather than being absorbed by a successor, which is how `I22` was defeated in v1.1.

**The state that results.** An authorisation that is `EXPIRED`, unrevocable because `cessation_lag` is `UNMEASURED`, holding forward exposure, with a `StandingRevocationAuthority` that itself expires at `grant.expires_at + 72h`, after which `I55` fires `STANDING_UNREVOCABLE` at CRITICAL and cannot be cleared because clearing requires `REVOKED`. **A permanent CRITICAL incident is the specified steady state for every standing authorisation ACOS creates.** Neither `24 §3.1`, `26 §10.5`, `51 §3.2` nor the ledger's SR-S2 entry mentions it.

**Is there a path forward? Exactly one, and it is undeclared.** Window lapse. If TB-02's declared reading is *exposure lapses with the window instance*, the state is uncomfortable but survivable: exposure clears monthly, `I55`'s CRITICAL persists as noise, and advertising resumes next window. If the reading is the literal formula, there is no path forward at all.

**Verdict on B5.** The strengthening is safe and should be kept. The state it creates has one exit and the exit is undeclared. **TB-02 BLOCKING; the `I55` interaction is part of its remediation.**

---

## B6 — `reconciler_match_rule` is scoped to a single `standing_authorization_id`. Where does the charge's `standing_authorization_id` come from? If it is derived by ACOS rather than carried by the vendor, the scoping is a self-assertion. Construct the case where a predecessor's charge is attributed to a successor anyway.

**It is derived by ACOS. The scoping is a self-assertion. The construction succeeds across a window boundary.**

**Provenance: undeclared, and not vendor-carried.** No artifact states where `charge.standing_authorization_id` comes from. Checked against both plausible sources:

| Conjunct | Google Ads spend report | Processor card line |
|---|---|---|
| `charge.payment_instrument == s.payment_instrument` | absent | present |
| `charge.merchant_identifier == s.merchant_identifier` | absent | present |
| `charge.resource_ref == s.resource_ref` | present (campaign) | **absent** — one aggregate line |
| `charge.amount <= standing_cap(s, window_of(charge.date))` | present | present |
| `window_of(charge.date) ∈ s.window_refs` | delivery date | posting date |
| **`charge.standing_authorization_id == s.id`** | **absent** | **absent** |

**No single source carries all six**, and the identifying conjunct is carried by neither. The declared adapter's API exposes no per-charge field ACOS controls: labels and tracking parameters attach to campaigns, are mutable, and re-resolve historically when changed — so relabelling for a successor would retroactively re-attribute the predecessor's spend, which is worse than no identifier.

**So the derivation reduces to `(vendor, resource_ref, date)` plus a rule for choosing among authorisations that governed that resource — which is the v1.1 rule SR-S2 replaced, one layer down.**

**The construction.**

1. January: `s1` on campaign C. Paused day 3. `PAUSED`, non-`REVOKED`, exposure retained.
2. 1 February: exposure lapses with the window (TB-02's intended reading). `s2` created on campaign C.
3. Google Ads posts delayed January delivery during February.
4. **Delivery-date keying** → `window_of(charge.date)` is January → `s1` → correct, and `STANDING_SPEND_AFTER_EXPIRY` fires per `24 §3.1` property 3.
5. **Posting-date or live-at-posting keying** → `s2` → **the predecessor's spend is absorbed by the successor and `I22` is silent.** STD-02's defect, reached through the derivation.

Which keying applies is TB-07's undeclared operand — `I54` does not say which timestamp is authoritative and neither does the match rule, since `charge.date` is not defined.

**Can two authorisations overlap?** Within a window, no — the predecessor holds the headroom (which is why TB-16 is a defeated attack). Across a boundary, yes. And with TB-13's missing supersession rule, an attempted budget change *within* a window would create an overlap if the arithmetic permitted it, which it does not — so the overlap case is currently prevented by exhaustion rather than by design.

**What happens when attribution is ambiguous?** Undeclared. `I22`'s on-violation covers *no match* (incident to the security path) and not *two candidate matches*.

**Must a successor wait beyond cessation verification, or must residual exposure stay reserved?** Given that cessation verification is structurally unavailable at MVP, the operative answer is the second: residual exposure stays reserved to window close, and the successor waits for the window. That is what the conservative default already delivers. **The finding is not that the successor should wait longer — it is that the attribution rule is unverifiable and must be declared as a derivation with a directional tie-break.**

**Remediation (TB-05).** Declare the charge record's source and field set per adapter; mark absent conjuncts as absent rather than writing a predicate over fields that do not exist; declare the derivation and its authoritative timestamp; declare the ambiguity rule as *attribute to the earliest candidate and raise an incident, never to the successor*; and extend `I22`'s fixture with a cross-boundary predecessor/successor pair and a late-posted charge, with the crafted case authored independently of the **derivation** and not only of the rule.

---

## B7 — `I54` requires a verification read from the audit plane's own vendor credential. What if that credential is unavailable, rate-limited, or returns a stale figure? Does `I54` fail closed, and is failing closed the right direction given B2?

**It fails closed, structurally, and failing closed is the right direction — but the operands that decide *what counts as a passing read* are undeclared, and one consequence is that the S3 measurement obligation is not executable.**

**Does it fail closed?** Yes, by construction. `I54`'s enforcement is a transition gate: *"No `StandingAuthorization` transitions to `REVOKED` without a verification read…"* On violation: *"The transition is refused. Forward exposure stays counted in `I3`."* Unavailable, rate-limited and stale reads all fail to establish the predicate, so no transition occurs and exposure is retained. There is no timeout-to-permit path anywhere in the mechanism. **This is correct and it is the right direction.**

**Is failing closed right given B2?** Yes. B2's worse failure — permanent exhaustion — is caused by the **missing window-instance scoping** (TB-02), not by `I54`'s direction. With TB-02 declared, the failure-closed direction costs a window's headroom, which is a bounded commercial cost. Without it, the direction costs the capability permanently. **Fix TB-02; do not relax `I54`.**

**What is undeclared** (TB-07) — attacking every word, as the prompt's B5 requires:

- **zero** — over which reporting surface, at what completeness. A zero read is consistent with unreported spend.
- **incremental** — relative to which prior observation, and what happens when that observation is revised.
- **attributable** — TB-05. Undeclared and not vendor-carried.
- **across `cessation_lag`** — **when does the interval begin?** Pause request, vendor acknowledgement, last observed spend, or first zero-spend observation. These differ by hours, and *first zero-spend observation* restarts on every late-posted charge and may never complete.
- **verification read** — no freshness requirement; no declared behaviour under stale reporting, eventual consistency, missing periods, rate limits, or an account timezone differing from the company timezone the windows are evaluated in.

**And the structural answer the prompt asks for: `cessation_lag` should not be one scalar.** *"Zero across an interval"* cannot be evaluated when the interval's endpoints are vendor-defined and the figures inside it are revisable. The required declaration is a per-adapter **cessation specification**: reporting settlement latency, the authoritative timestamp kind, the revision window during which a posted figure may still change, and a minimum observation count. Four fields, four provenances.

**The consequence for the gate.** `58 §12` item 9 — *"`cessation_lag` per adapter — how long after a pause the platform's spend reporting settles"* — is **not executable as written**, because the quantity is not defined until the timestamp and the interval start are declared. So the parameter gating `REVOKED` cannot be measured, the conservative default is permanent for a procedural rather than an empirical reason, and `58 §13` condition 3 is waiting on a measurement that cannot be taken. **This changes what item 9 must say and `62 §10` amends it.**

**Verdict on B7.** Fails closed, correctly. **TB-07 MATERIAL**, with an amended S3 obligation.

---

## B8 — The exposure-remainder form is not what `57` specified. `51 §4.3` argues it is strictly better against the constructed attack. Check that argument. Find a delivery pattern under which the remainder form under-reserves where the multiplicative form would not.

**No such pattern exists. The attack is defeated and the argument is correct — `51 §4.3` in fact understates its own case.**

**The proof.** `forward_exposure(s, w, t) = max(0, standing_cap(s,w) − realised_spend(s,w,t))`. For all `realised ≤ cap`:

`realised + forward ≡ standing_cap`

identically, **for every value of `realised`, including wrong ones.** So the pair of `I3` terms contributed by one standing authorisation is invariant under any error in `realised_spend`, and the true remaining authorised spend (`cap − true_realised`) is bounded above by the reserved `forward` whenever `realised` is understated. Every pattern the prompt lists:

| Pattern | Effect | Under-reserves? |
|---|---|---|
| Front-loaded overdelivery | `realised` rises early, `forward` falls equally | No — the sum is invariant |
| Delayed posting | `realised` understated, `forward` **over**stated | No — strictly conservative |
| Spend corrections upward | Absorbed | No |
| Negative adjustments | `realised` falls, `forward` rises equally | No |
| Timezone boundary changes | A charge moves between instances; both sides move | No |
| Month crossing | `standing_cap` re-derives via `periods_basis`; the identity re-establishes | No (but see TB-02 for the *instance* question) |
| Budget edits | Changes `s.rate` and therefore `standing_cap` — a **new authorisation**, not a mutation | No, and it is TB-13 |
| Spend reported after pause | `realised` rises, `forward` falls; exposure retained regardless of status | No |
| Charge reclassified to another day | Moves between DAY instances; MONTH unaffected; MONTH binds | No |

**And the comparison the argument does not make.** The multiplicative form `rate × remaining_periods × (1 + allowance)` is **independent of `realised`**, so it *adds* to a wrong `realised` rather than compensating for it: under-reported spend makes the multiplicative form's total under-reserve by exactly the under-reporting. The remainder form is therefore not merely more permissive on day 2 — it is **structurally insensitive to realised-spend reporting error**, and reporting error is the one thing about advertising spend the package knows it cannot measure (`cessation_lag` `UNMEASURED`, TB-07). **The deviation should be accepted, and for a stronger reason than the one recorded.**

**The one cost.** The identity holds only while `realised ≤ cap`. Above the cap, `forward = 0` and `realised` alone exceeds the ceiling — and with zero slack between `standing_cap` ($186.00) and `W_MONTH_ADSPEND.max_monetary` ($186.00), any delivery beyond the documented `30.4` basis lands there. The multiplicative form's `(1 + allowance)` would have created that slack in the reservation; the remainder form places it nowhere. **TB-08 MATERIAL**, repaired by putting the slack in the *ceiling* rather than in the *reservation* — which is the right place for it, because the slack is authorised loss and belongs in a signed window quantity, not in an unsigned formula.

**Recommendation.** Record the deviation as **VALIDATED** rather than merely flagged, with TB-08 as its declared cost. `analysis/v1.2-consistency-audit.md §4` item 5 correctly declined to validate it; this pass validates it.

---

# 3. Joint

## J1 — What happens to a `PAUSE_PENDING` standing authorisation during an audit-plane outage?

**Bounded, fails closed, and one operand is undeclared.**

| Question | Answer |
|---|---|
| `StandingAuthorization` state | Stays `PAUSE_PENDING`. The `→ PAUSED` transition needs a verification read; **whose read is undeclared (TB-12)**. If audit-plane: stranded until recovery. If control-plane: `PAUSED` is reachable, and gains the control plane nothing but the closure of a CRITICAL incident |
| Forward exposure | **Retained.** Every non-`REVOKED` status retains, and `PAUSE_PENDING` is the strictest case by design |
| Next-window reservation | Governed by TB-02's undeclared rule — the composition inherits Mechanism B's boundary ambiguity rather than adding one |
| Ability to start another campaign | Denied. `WINDOW_EXHAUSTED` while exposure is retained |
| Reconciliation | `I22` is audit-owned and `SCHED`; during the outage it does not run. Charges accumulate unreconciled and are swept on recovery. No release occurs in the interim, so the direction is safe |
| Owner visibility | V7 is served from the audit plane's own endpoint, so during an audit-plane outage **the owner cannot see the audit-side state at all**. The control plane's declared state remains visible. `30 §3` V7's side-by-side display degrades to one side, and the design does not say what the owner client shows for the missing side — a blank must not read as agreement |
| `I54` | Cannot be satisfied. No `REVOKED`. Correct |

**The composition is sound in the direction that matters: a Mechanism A failure makes Mechanism B stricter.** Neither mechanism's documentation walks it, and the brief is right that it is the obvious composition. **Does headroom stay reserved? Yes.** **Is the answer bounded? Yes** — bounded by the window, subject to TB-02.

**One addition the design should make.** V7's degradation needs a declared representation: an audit-side value that is *unavailable* must render as unavailable, never as absent and never as matching. A compromised control plane that can induce an audit-plane outage otherwise obtains a display in which its own declaration is the only value on screen.

**TB-12 MATERIAL**; the V7 degradation note folds into TA-06's remediation.

---

## J2 — Does a realistic sequence exist in which the system exceeds its declared authority boundary, or escapes its declared audit record, through Mechanism A or Mechanism B, without a required invariant firing?

**Authority boundary: no. Declared audit record: yes.**

**Authority boundary — not exceeded.** Across every constructed sequence, `I3` held. Mechanism B's failure directions all retain rather than release: pause retains, `PAUSED` retains, `EXPIRED` retains, an unavailable verification read refuses the transition, and an audit-plane outage blocks `REVOKED`. The only headroom-return paths found are **specification defects that would return it by accident** — TB-01's omitted `CHECK` term and TB-02's undeclared boundary rule — not attacker-driven paths. That is a meaningful distinction: the mechanism's *design* does not leak authority, and two of its *specifications* would if implemented as written.

**Declared audit record — escaped.** TJ-01, stated in full in `59 §1`. A compromised control plane that stays in `NORMAL`, freezes its attested prefix, and dispatches untagged effects satisfies `I17`, `I17e`, `I17f(a)`, `I17f(b)` and `I17b` simultaneously, and is caught only by `I8` — at an undeclared cadence, under a reading of `I8`'s own row that may have narrowed its scope to a tag set the attacker populates, and not at all for the large class of journal rows describing no vendor-touching effect.

**Does an invariant fire? Before or after damage? With enough information to recover? With the authority boundary intact?**

| | Answer |
|---|---|
| Fires? | Only `I8`, and only for the vendor-touching subset, and only under the additive reading |
| Before or after damage? | **After.** The effects are dispatched; detection is a subsequent reconciliation |
| Enough information to recover? | **Yes.** The control journal holds the rows locally chained; the vendor holds its side; the two can be reconciled once the divergence is known |
| Authority boundary intact? | **Yes.** `I3` bounded the exposure in the control database throughout — `MAL_total(day)` p95 = $329.50 per day, plus the enumerated unbounded tails |

**Severity: BLOCKING, not FATAL.** The escape is a composition of four specification defects each with a local repair, not a property the mechanism cannot deliver. With case 2 restated, `I8`'s cadence declared, `I8`'s scope clarified as additive, and a dispatch→tag detector added, the posture becomes *detectable after the fact within a declared bound, with recovery information available, and with the authority boundary intact* — which is an honest and acceptable posture for a compromised-control-plane scenario that `49` already declares unbounded by anything inside ACOS.

**And the honest four-way statement the prompt's A9 asks for.**

### Proven structurally

- No effect is dispatched without a committed, locally chained, gap-free journal row in the control database (`I17d`, `I41`, `I42`, `30 §5.1` ordering).
- No row present in either chain has been altered, removed or reordered after insertion by a principal holding only `INSERT` (`I41`, `I17d`).
- The audit store's holdings are gap-free, internally consistent, and match the independently recomputed head of the attested prefix (`I17`, `I17e`, `ACOS-JCS-1`).
- A control plane cannot enter `CORROBORATED_DEGRADED` on its own word (`30 §5.6`'s inversion, `I17f(a)`).
- A model cannot create a statutory clock (`I56`).
- Forward exposure is released in exactly one state, and reaching it requires an audit-plane read (`I54`).
- Non-`REVOKED` forward exposure is retained in every status — **provided `24 §3` K5's `CHECK` is corrected** (TB-01).

### Detectable after the fact

- Attester-side journal truncation, for the subset of effects that reached a readable vendor system, at `I8`'s undeclared cadence (TA-01, TA-02).
- An effect dispatched under degradation with no tag, same subset, same caveat (TA-04).
- A replayed corroboration signal, by `I17f(a)` at its undeclared evaluation interval (TA-12).
- Retroactive rewrite, within one hour (`I17b`).
- Post-pause platform spend, by `I22` — subject to TB-05's undeclared attribution.

### Bounded but not prevented

- Effects dispatched inside the 15-minute attestation window, or inside a replay window, bounded by `I3`'s window ceilings and not by any audit mechanism (A2).
- Externally manufactured clock-bearing cases, bounded by `W_DAY_REFUND` and `W_MONTH_REFUND` (TA-08).
- Owner-manipulation pressure via a declared stall, bounded by whatever the override grants — **currently undefined** (TA-15, TA-05).

### Not detectable by this mechanism

- A control plane that omits a row from **both** sides (registry `§3` item 7, `30 §5.5` case 4 — correctly stated).
- A control plane that **freezes its own attested prefix** (TA-01 — **not stated, and it should be registry `§3` item 9**).
- Suppression of any journal row describing something with **no vendor counterpart**: authorisations, denials, reservations, approvals, resumes, state facts, escalations, clock creations, override exercises, standing transitions, enumeration reads, and the tags themselves. **No detector exists under any reading, and no artifact says so.**
- Truthfulness of inserted content (registry `§3` item 2 — correctly stated).

**Do not call transport completeness complete auditability.** The package largely does not — `30 §5` and registry `§3` are careful. The two places the care runs out are `30 §5.5` case 2 and the undeclared bound on `I8`.

---

# 4. Additional questions from the Phase 2.4 review prompt

Mapped to where each is answered, so the prompt's numbering is also checkable. Prompt items with no brief counterpart are answered in full at the location given.

| Prompt item | Answered at |
|---|---|
| A1 — attack the independence claim; what independent fact does audit possess | `§1` A1 |
| A2 — stopped writer, exact timeline, what 15 minutes means operationally | `§1` A2 |
| A3 — corroborated degraded mode; can a compromised plane benefit from declaring | `§1` A4 (all seven attacker goals tabulated) |
| A4 — genuine two-sided outage, five sub-questions | `§1` A3 (each sub-question answered numbered) |
| A5 — owner override, eight properties verified, composition | `§1` A5 closing; **TA-05** — none of the eight is specified |
| A6 — `I17f` circularity | `§1` A6 |
| A7 — clock-source integrity, seven sub-questions | `§1` A7 |
| A8 — `DISPATCHED_UNMIRRORED`, five sub-questions, `I8` class enumeration | `§1` A9 |
| A9 — the four-way statement | `§3` J2 closing |
| B1 — walk every transition, seven columns | `§2` B1 |
| B2 — `cessation_lag` `UNMEASURED`, five-step follow-through | `§2` B2 |
| B3 — successor/predecessor attribution | `§2` B6 |
| B4 — pause failure and unknown outcome | `§2` B1 transition 3, `§3` J1 |
| B5 — attack every word of `I54`; one scalar or a richer specification | `§2` B7 |
| B6 — audit outage × standing pause | `§3` J1 |
| B7 — defeat the exposure-remainder formula | `§2` B8 |
| B8 — single-commit `I3` | `§2` B4 |
| B9 — commercial truth, stated plainly | `§2` B3 closing |
| Joint final attack | `§3` J2, and TJ-03 in `60 §5` |
| Final discipline, questions 1–4 | `59 §5` |

**One prompt sub-question deserves its own answer because it is not covered above.** *Is every residual genuinely something that requires implementation measurement rather than missing architecture?*

**No — three are not, and one of the three is recorded as closed.**

| Residual | Genuine measurement? | |
|---|---|---|
| `cessation_lag` `UNMEASURED` (SR-S2) | **Partly.** The measurement is genuine; the *specification* of what is measured is missing architecture (TB-07), and the S3 obligation is not executable without it |
| Transport completeness ≠ source completeness (SR-A1) | **Yes.** Honestly stated, correctly located on `I8`, with the qualification that `I8`'s own bound is undeclared architecture rather than a measurement (TA-02) |
| Two-sided outage costs an owner override (SR-A2) | **No.** This is not a measurement at all. The override is missing architecture, and the ledger records AUD-07's remediation as applied when no artifact specifies any of its six properties (TA-05) |
| `unit_cost_p95` (SR-C1) | **Yes.** Out of scope, but checked: a genuine measurement with a conservative interim the owner signs |
| Meta multipliers `UNMEASURED` (SR-S4) | **Yes.** Genuine, with a conservative default that excludes Meta from rate grants |
| Order-driven ratio inert below n=20 (SR-L3) | **Yes.** Out of scope; a stated consequence with a denominator-independent second trigger |

So `54 §4`'s standard — *a residual that hides a decision behind a measurement is a finding* — is met once, at TA-05, and the brief `§4` was right to ask.
