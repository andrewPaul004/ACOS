# 60 — Third Red Team Attack Register

**Phase 2.4. Issued 2026-09-03. Companion to `59-third-redteam-verdict.md`.**

Thirty entries: **twenty findings** and **ten attacks constructed and defeated**. `53 §6` recorded ten defeated attacks and the brief `§5` is right that the record is what makes the findings credible, so the defeated set is recorded at the same level of detail as the findings.

**Column conventions.** *Claimed property* is quoted or paraphrased from the artifact that makes the claim, so the finding is checkable against a specific sentence. *S1 blocking* means the repair must land before S1 code, not merely before the property is exercised — an artifact that S1's fixtures are authored from is S1-blocking even when the mechanism it describes lands later.

---

## 1. Mechanism A — findings

### TA-01 — `30 §5.5` case 2's detection bound does not hold against the attester

**BLOCKING** · Mechanism A · `30 §5.4`, `30 §5.5` case 2, registry `I17e`, `36 §13.1` VC-A1a/b/c, `36 §15` attestation gate · **S1 blocking: yes** · in scope

**Claimed property.** `30 §5.5` case 2: *"Row written locally, push permanently suppressed → caught by `I17e` — the row's `journal_seq ≤ max_journal_seq` and is absent → bound ≤ 15 min."*

**Constructed path.** The suppressing party is the attesting party. A control plane that permanently suppresses the push of rows 901–1,000 emits attestations claiming `max_journal_seq = 900` with the genuine `head_hash` at 900. `I17e`'s two legs both pass: continuity holds because attestations arrive at cadence, and consistency holds because every `journal_seq ≤ 900` is present and the recomputed head matches. The suppressed rows are never `≤ max_journal_seq`, so case 2's detection predicate is never satisfied.

**Result.** **Succeeded.** Case 2 bounds *transport loss* at 15 minutes. It does not bound *suppression* at all. `30 §5.4`'s *"What it does not do"* paragraph identifies the neighbouring case in which rows are omitted before attesting and the attestation is therefore truthful; it does not identify this one, in which the control chain contains the rows and the attestation is false. The distinction matters because the two have different residual owners: the truthful case is a genuine `I8`-only residual, and this case is a **false claim of a 15-minute bound**.

**Why the test does not catch it.** `36 §13.1` VC-A1a truncates the push *out of band*, so the attestation still reports `max_journal_seq = 1,000` and `I17e` fires correctly. The test passes, and it certifies a property it does not exercise — `36 §0`'s own prohibition, and the shape `45 §7` names.

**Remediation.** (a) Split case 2 into **2a — transport loss with an honest attester**, caught by `I17e`, bound 15 min; and **2b — suppression by the attester**, caught by `I8` only, bound = `I8`'s declared sweep cadence, and **not caught at all** for rows describing no vendor-touching effect. (b) Restate `I17e` as *continuity of the attestation channel and internal consistency of the attested prefix* — it is not a completeness check over the control journal and cannot be. (c) Add registry `§3` item 9: no invariant detects a control plane that freezes its own attested prefix; the class of rows with no vendor counterpart has no detector. (d) Add a **mandatory negative control** to VC-A1: the same truncation performed *by* the attester, with the attestation adjusted, asserting that `I17e` does **not** fire — so the test discriminates the two cases instead of conflating them.

---

### TA-02 — `I8` has no declared sweep cadence

**BLOCKING** · Mechanism A · registry `I8`, `30 §5.5` case 4, `30 §7`, `37` S3, `22 §3.1` · **S1 blocking: yes** · in scope

**Claimed property.** `30 §5.5` case 4's bound column: *"Inverse-sweep cadence."* Registry `I8` enforcement: `SCHED (inverse sweep)`, with no interval.

**Constructed path.** Grep the package. No artifact declares how often the inverse sweep runs. `37` S3 builds *"the inverse sweep run from those reads"* with no cadence. `22 §3.1` names it as a compensating control alongside *"the anchoring cadence (`I17b`, one hour)"* — stating the anchor's value and not the sweep's, in the same sentence.

**Result.** **Succeeded.** Registry rule 5: *"An invariant with an unstated threshold is not an invariant."* Registry rule 6: *"An invariant with an undeclared operand is not an invariant."* Both are violated by the invariant onto which v1.2 relocated the unqualified completeness claim, and case 4's bound column literally names the missing quantity as if naming it declared it. This is `52 §3`'s dominant pattern — a quantity a mechanism needs that the artifact declaring quantities does not declare — reproduced in the load-bearing invariant of the pass written to eliminate it.

**Remediation.** Declare the cadence in `51` as an operand with provenance, per adapter where the vendor's reporting latency differs, and attach it to `I8`'s row under the rule-6 operand block. State the resulting bound explicitly at every site that currently reads *"inverse-sweep cadence"*. Note the dependency: the bound on undetected omission is `sweep_cadence + vendor_reporting_lag`, and the second term is the same unmeasured quantity as `cessation_lag` (TB-07) — so the two obligations should be measured together at S3.

---

### TA-03 — `I8`'s tag-set sentence admits a coverage-narrowing reading

**BLOCKING** · Mechanism A · registry `I8`, `30 §5.6`, `24 §3` K11 · **S1 blocking: yes** · in scope

**Claimed property.** Registry `I8`: *"The `DISPATCHED_UNMIRRORED` tag set is a **mandatory input** to each sweep, so the reconciliation target is a specific set rather than a time period."*

**Constructed path.** Two readings.

- **(i) Additive.** The sweep enumerates the vendor side independently and completely, subject to `I8`'s declared coverage limits, and the tag set is an additional checklist every member of which must be verified present and correctly recorded. Coverage unchanged; focus added.
- **(ii) Scoping.** The sweep's *target* is the tag set. Coverage narrowed to a set the audited party populates.

The clause *"so the reconciliation target is a specific set rather than a time period"* reads as (ii), and (ii) is the reading an implementer optimising vendor API calls will choose, because it is cheaper. Under (ii), composed with TA-04, an effect dispatched with no tag is outside `I17` (no row) and outside `I8` (not in the target set) simultaneously.

**Result.** **Succeeded.** Two mutually exclusive readings of one sentence with opposite coverage consequences and no precedence statement. This is AUDA-01's defect signature — which `52 §3` called out as reproduced inside its own remediation at AUD-10 — occurring a third time, in the invariant AUD-09's remediation moved the completeness claim onto.

**Remediation.** Restate: *"`I8`'s sweep enumerates the audit plane's own vendor reads exhaustively over the period since the previous sweep, subject to the coverage limits on this row. The `DISPATCHED_UNMIRRORED` tag set is an **additional mandatory verification list** and is never a restriction of the sweep's scope."* Add a CI or review assertion that the sweep implementation's vendor query is period-bounded and not tag-bounded.

---

### TA-04 — no detector for a dispatch under degradation that carries no tag

**BLOCKING** · Mechanism A · registry `I17f(a)`, `30 §5.6`, `30 §5.7`, `36 §13.2` VC-A2 · **S1 blocking: yes** · in scope

**Claimed property.** `I17f(a)`: *"No effect carries `DISPATCHED_UNMIRRORED` without a concurrent audit-plane `MIRROR_INPUT_STALL` covering its dispatch timestamp."* Ledger SR-A2: *"`DISPATCHED_UNMIRRORED` is a not-null tag on every effect dispatched outside `NORMAL`."*

**Constructed path.** `I17f(a)` quantifies over tagged effects and asserts corroboration. The needed property is the converse: over effects dispatched while degraded, assert the tag. The control plane writes the tag, so the party required to mark its own unmirrored dispatches is the party that benefits from not marking them. Ask each candidate detector what it sees:

- `I17` — the row may be present in the mirror and simply carry no tag; transport completeness says nothing about a column's value.
- `I17e` — same.
- `I17f(a)` — vacuous over untagged effects.
- `I17f(b)` — concerns the existence of `MIRROR_INPUT_STALL`, not the tagging of effects.
- `I8` — under reading (ii) of TA-03, the untagged effect is not in the target set. Under reading (i), it is caught if and only if it touched a readable vendor system, at the cadence TA-02 does not declare.

**Result.** **Succeeded.** `24 §3` K11's *"What AI may not do"* constrains operating principals; nothing constrains the control plane's own tag write. A9's answer is that an omitted tag is discovered by `I8` under reading (i) and by nothing under reading (ii), and in neither case by the invariant the package cites for the tag.

**Remediation.** Add `I17f(c)`, owned by the **audit plane**: *"For every effect whose dispatch timestamp falls inside an audit-plane-published `MIRROR_INPUT_STALL` interval, the mirrored effect row carries `DISPATCHED_UNMIRRORED`. An untagged effect dispatched inside a published stall interval is a critical incident."* The audit plane holds both operands — its own published intervals and the mirrored rows — so rule 7 is satisfied. Note the residual honestly: this closes the case where the audit plane *did* publish a stall, and does not close the `NORMAL`-declared case, which is TJ-01.

---

### TA-05 — the owner override escaping `UNCORROBORATED_STALL` is specified nowhere

**BLOCKING** · Mechanism A · `30 §5.6`, `30 §5.1` item 5, `22 §3.1`, `35 §12.1`, `36 §6`, ledger SR-A2 residual, ledger `§3.1` AUD-07 · **S1 blocking: yes** · in scope

**Claimed property.** Ledger SR-A2's residual: *"The escape is the owner override, now per recoverability class, time-boxed, count-capped, auto-expiring to halt, fully tagged, and requiring a distinct approver for a second override inside a declared interval (AUD-07's remediation, applied here because SR-A2 makes the override load-bearing)."* Ledger `§3.1` records AUD-07 as **closed** by SR-A2. The brief `§1` lists the same six properties as in scope for this review.

**Constructed path.** Read every site the override appears at.

| Site | What it says |
|---|---|
| `30 §5.6` | *"It is a decision, journaled, with the affected effect classes and the elapsed clock time displayed, and it does not change any ceiling."* |
| `22 §3.1` | *"Bounded per AUD-07: a journaled decision displaying the affected classes and the elapsed clock time, changing no ceiling."* |
| `30 §5.1` item 5 | *"With an owner override recorded as a decision and the override itself journaled."* |
| `35 §12.1`, `36 §6` | *"Owner override recorded as a decision."* |

No duration. No count cap. No expiry. No second-approver interval. No `Override` entity in `24 §3`. No identifier in the registry. No row in `51`. No control-artifact class in `50`. `AUD-07` appears in exactly two sentences in the deliverables and both are the sentence above.

**Result.** **Succeeded, and it is the cleanest finding in the pass.** AUD-07's own words were *"the override is a single act with no declared scope, no expiry and no cap"* and *"the strongest halt in the architecture becomes the weakest state via one owner click."* That is still true. The severity has increased rather than decreased, because SR-A2 made the override the **sole** escape from a state the design deliberately made stricter, and the ledger records the remediation as applied.

**Consequence for A5.** The brief asks whether repeated bounded overrides compose into effectively unbounded degraded-mode authority, and instructs that a yes is BLOCKING. The question cannot be evaluated: there are no bounds, so composition is trivially unbounded. Rotating action classes, expiry-and-recreation and durable-authority-establishment are all unconstrained by anything written down. Under the brief's own rule this is BLOCKING whether or not composition would have been the failure.

**Consequence for A3.** The availability posture is a deliberate and defensible trade **with an owner-shaped hole in it**, and the hole is unspecified. A3's constructed case — owner unavailable, statutory clock expiring — is walked in `61 §A3`; the outcome is a statutory breach that the architecture accepts, which is coherent. What is not coherent is that the escape from it is the least specified component of the mechanism.

**Remediation.** Specify the override as kernel state with a declared shape, at minimum: `DegradedModeOverride { id, company_id, granted_by, granted_at, effect_classes[] (subset of the recoverability classes, never IRRECOVERABLE without a separate act), expires_at (declared maximum duration), effect_count_cap, effects_dispatched, second_approver_required_after (declared interval), second_approver }`. Auto-expiry to halt, not to `NORMAL`. Every effect dispatched under it carries the tag and enters `I8`'s verification list per TA-03. Add an invariant bounding composition — a ceiling on total overridden effects and total override hours per window, entering `V2` as a displayed governed quantity in the same way `W_MONTH_UNGATED` does. Declare the values in `51` with provenance. It is a control artifact and belongs in `50 §2`.

---

### TA-06 — the corroboration signal's transport, authentication and freshness are undeclared

**BLOCKING** · Mechanism A · `30 §5.6`, `30 §5.7`, registry `I17f`, `36 §15` two-sided gate · **S1 blocking: yes** · in scope

**Claimed property.** `30 §5.6`: `CORROBORATED_DEGRADED` is *"Entered when the audit plane's **own** signal confirms the outage (§5.7)."* `30 §5.7`: *"Entry into `CORROBORATED_DEGRADED` requires a signal from the second or third row"* — the audit plane's observation of missing attestations, or its own reachability probe. `I17e`'s on-violation: *"The audit plane publishes `MIRROR_INPUT_STALL` on its own read endpoint."*

**Constructed path.** The control plane must **read** that signal to change state. Nothing declares how. Specifically undeclared: which endpoint, over which path, under which credential, whether the signal is signed, and — the load-bearing one — **how fresh it must be**. Three consequences.

1. **Reachability.** In the broad class of real outages — audit plane down, or a network partition between the planes — the corroboration signal traverses the same broken path as the push, so `CORROBORATED_DEGRADED` is structurally unreachable. This is A6's circularity and the architecture's answer (fail closed, stay in `UNCORROBORATED_STALL`) is correct. But it means the state is reachable only in the narrow class where the audit store rejects writes while its read endpoint and its checks remain healthy — chiefly `I17c` quota saturation, which `30 §5.1` item 5 declares *"an incident, not a mode change"*. **The set of outages in which the relaxation is actually available is close to empty and is nowhere characterised.**
2. **Staleness.** With no `max_age`, a control plane may enter `CORROBORATED_DEGRADED` on a cached signal from a resolved earlier outage.
3. **Rule 6.** The transition that unlocks the only dispatch relaxation in the architecture has an undeclared operand.

**Result.** **Succeeded as a specification defect.** The replay variant is separately detected — see TA-12 — so the exposure is bounded, not open.

**Remediation.** Declare the signal as a signed, timestamped artifact served from the audit plane's own read endpoint under its own key, with a declared `max_age` shorter than `attestation_cadence × k`, fetched by the control plane over a declared path. Make `max_age` an operand of the transition under rule 6. And **characterise the reachable outage class** in `30 §5.6` rather than leaving the reader to derive that the corroborated state is nearly unreachable — an honest statement here changes how the residual should be read.

---

### TA-07 — `36`'s expected-behaviour and chaos rows state the pre-inversion behaviour

**BLOCKING** · Mechanism A · `36 §6` *"Audit mirror unreachable"* row, `36 §14` chaos row, against `30 §5.6` and `36 §2` VC-A2 · **S1 blocking: yes** · in scope

**Claimed property.** `36 §6`: *"**Audit mirror unreachable** (v1.1, replaced) | **Halt by recoverability class**, per `30 §5.1`: REVERSIBLE dispatches; **COMPENSABLE inside a live statutory clock dispatches**; COMPENSABLE discretionary suspends; IRRECOVERABLE halts…"* `36 §14`: *"Random network partition between control plane and audit store, **asserting the split halt rule by recoverability class** rather than a single behaviour (`30 §5.1`)."*

**Constructed path.** Under `30 §5.6`, a network partition puts the system in `UNCORROBORATED_STALL`, where precedence row 3 **suspends** rather than dispatches. `36 §2`'s VC-A2 states the inversion correctly. `36 §6` and `36 §14` state the superseded behaviour, unqualified, and `36`'s v1.2 change record amends `§2`, `§3.2` and four gates and does not mention `§6` or `§14`.

**Result.** **Succeeded.** Two statements of one condition with opposite behaviours in one document, no precedence note — AUDA-01's signature for the fourth time in this package's history, this time inside the validation plan. `36` is the artifact S1's tests are authored from, so the chaos test as written asserts a dispatch the architecture forbids. It will either fail and be "corrected" against the implementation, or pass because the implementation reproduced `36` rather than `30`.

**Remediation.** Amend `36 §6`'s row to state the three-state machine and the state-qualified precedence, and amend `36 §14`'s chaos row to assert `UNCORROBORATED_STALL` and the suspension of row 3. Add both to `36`'s v1.2 change record. Then re-run consistency check C15 — it asserts the dispatch rule is an ordered first-match list and passed, which it is; it does not assert that every site states the state qualifier, which is the defect.

---

### TA-08 — `I56` closes model-created clocks and does not bound externally-manufactured or duplicate clocks

**MATERIAL** · Mechanism A · registry `I56`, `I13`, `30 §9.1`, `24 §3` K10, `26 §9.5`, `30 §11` · **S1 blocking: no (schema is S1; the bound is S5)** · in scope

**Claimed property.** `I56`: *"A model classification can route a case; it can never create a clock."* `30 §9.1`: the clock cites *"a retained raw inbound message with its content hash."*

**Constructed path.** A7's question, pursued. The FTC refund clock's RECORD is the customer's own raw inbound message — correctly, because a genuine textual refund request creates a genuine obligation. Three consequences follow that `I56` does not address.

1. **The clock population is externally controlled.** Any party who can send to the support address can create clock-bearing cases. `30 §5.1` row 3 is the relaxation, so the party choosing which effects reach row 3 is the sender, not the model. `I56` moved the lever from the model to the outside world; it did not remove it. AUD-06's *"the attacker chooses which effects escape the mirror"* is narrowed, not closed.
2. **No clock-uniqueness rule.** `I56` requires a not-null `source_record_ref` with an FK. It does not require uniqueness. A resent message, a forwarded thread and a reply chain quoting the original all present retainable inbound content. `K15` dedupes webhooks *"on the platform's own event id"*; no equivalent is declared for inbound mail, where the analogous identifier (`Message-ID`) is sender-controlled.
3. **No rate bound on clock creation.** `30 §11`'s per-cause caps bound owner-visible *escalation items*. A clock is state, swept by `I13`, and is not an escalation until a threshold fires.

**Result.** **Succeeded as a bound gap, not as a fabrication path.** `I56`'s determinism does real work: it makes the citation checkable, it makes the triage-classifies-everything test (`36 §13.2` VC-A2b) meaningful, and it forces the clock to reference an artifact whose hash is retained. What it does not do is bound the population. The loss is bounded by `I3` — `W_DAY_REFUND` at `$50.00` and 2 — so this is an auditability finding, as AUD-06 was, not a money finding.

**Remediation.** (a) Declare the detector predicate for each clock kind and register it as a control artifact under `I19` (the class already covers *"a detector pattern"*, so this is an enumeration gap, not a new class). (b) Add a uniqueness rule: at most one live clock per `(case_ref, statute)`, and a declared collapse rule for duplicate `source_record_ref` content hashes. (c) Declare a per-window bound on newly created clock-bearing cases, with breach as an anomaly rather than a denial — because denying a genuine clock is worse than the anomaly. (d) State in `30 §9.1` that `I56` bounds *provenance*, not *volume*, so the residual is visible where the claim is made.

---

### TA-09 — `I17f(b)`'s violation is defined to raise the condition that satisfies it

**MINOR** · Mechanism A · registry `I17f(b)` · **S1 blocking: no** · in scope

**Claimed property.** `I17f(b)`: *"No audit-plane `MIRROR_INPUT_STALL` exists without either a corresponding journaled control-plane `AUDIT_MIRROR_DEGRADED` declaration or an open `ATTESTATION_DIVERGENCE` incident."* On violation: *"(b) raises `ATTESTATION_DIVERGENCE` at CRITICAL."*

**Constructed path.** The disjunct's second branch is the incident the violation raises. So the moment (b) would be violated, the violation's own consequence satisfies it. The clause cannot be false for longer than one evaluation.

**Result.** **Succeeded as a classification defect.** (b) is a **routing rule**, not a falsifiable invariant, and it is sound as a routing rule: audit observing a stall the control plane has not declared is exactly as interesting as the converse, and it should raise CRITICAL. But it will never appear as a violation in any invariant report, so a reader tracking invariant health sees a check that always passes. Registry rule 5's spirit — an invariant that cannot be false is not an invariant — applies.

**Remediation.** Restate (b) as the detector it is: *"An audit-plane `MIRROR_INPUT_STALL` with no corresponding journaled control-plane declaration raises `ATTESTATION_DIVERGENCE` at CRITICAL."* Keep (a) as the invariant. Note in `§2.4` that the two-sidedness is one invariant plus one detector, not two invariants.

---

### TA-10 — `22 §3.1`'s selected-trade table omits the state qualifier

**WORDING** · Mechanism A · `22 §3.1` · **S1 blocking: no** · in scope

**Claimed property.** The table row: *"COMPENSABLE inside a live statutory clock | Dispatch proceeds — the clock outranks the mirror."*

**Result.** True in `NORMAL` and `CORROBORATED_DEGRADED`, false in `UNCORROBORATED_STALL`. The bullets immediately following the table state the inversion correctly, so a reader who continues is not misled. A reader who extracts the table is. Recorded because table extraction is exactly how `36 §6` acquired TA-07.

**Remediation.** Add the state column to the table, or a one-line note under it.

---

## 2. Mechanism A — attacks constructed and defeated

### TA-11 — unilateral entry into `CORROBORATED_DEGRADED`

**DEFEATED** · claimed property: `30 §5.6` — the relaxation requires an audit-plane signal.

**Path.** Compromised control plane declares degradation and attempts to dispatch clock-bearing COMPENSABLE effects unmirrored, per `52 §1` Path B.

**Why it fails.** The declaration reaches only `UNCORROBORATED_STALL`, where precedence row 3 **suspends**. The declaring party loses the exemption it declared in order to obtain. This is the inversion and it works. `52 §1` Path B is closed and the closure is the strongest element of Mechanism A.

---

### TA-12 — replay a stale `MIRROR_INPUT_STALL` to obtain the relaxation

**DEFEATED WITH RESIDUAL** · claimed property: `I17f(a)`.

**Path.** Given TA-06's missing freshness contract, the control plane presents a cached `MIRROR_INPUT_STALL` from a resolved outage, enters `CORROBORATED_DEGRADED` while the mirror is healthy, and dispatches row-3 effects tagged `DISPATCHED_UNMIRRORED`.

**Why it fails.** `I17f(a)` is evaluated by the **audit plane** against its own record of which intervals it published. A dispatch timestamp outside every published interval is a critical incident on a fact the control plane does not hold and cannot rewrite. Replay is detected.

**Residual.** Detection is at `SCHED` cadence, so the dispatches inside the replay window occur and are discovered afterwards. **Bounded but not prevented.** The bound is `I3`'s ceilings plus the `I17f` evaluation interval, which is undeclared — a smaller instance of TA-02. Recorded here rather than as a separate finding because the repair is TA-06's `max_age`.

---

### TA-13 — forge an attestation head for a prefix the control plane did not produce

**DEFEATED** · claimed property: `30 §5.4` — *"`I17e` … independently recomputes `head_hash`."*

**Path.** Attest a `head_hash` that does not correspond to the rows the audit store holds, to make a mirror-side insertion or a substitution appear consistent.

**Why it fails.** The audit store re-chains over the transmitted `ACOS-JCS-1` bytes under its own trigger (`I17d`, `I41`, `30 §5.3`) and recomputes the head itself. A forged head diverges. This is `30 §5.5` case 6 and it holds. `ACOS-JCS-1` is what makes it hold, and SR-A3 was a precondition for SR-A1 in a way the ledger does not state but which is real.

---

### TA-14 — suppress a single attestation to conceal a row

**DEFEATED** · claimed property: `30 §5.5` case 2 in the honest-attester case.

**Path.** Push rows normally, suppress the one attestation whose `max_journal_seq` would reveal a withheld row.

**Why it fails.** The **next** attestation's `max_journal_seq` still exceeds the withheld row's sequence, so the row presents as a gap under `I17`. Suppressing every subsequent attestation converts the attack into TA-01's frozen prefix — which is why TA-01 is the finding and this is not.

---

### TA-15 — declare `UNCORROBORATED_STALL` to obtain a halt

**DEFEATED WITH RESIDUAL** · claimed property: `30 §5.6`'s inversion, attacked in the direction A4 names — attacker goal is a halt, not a dispatch.

**Path.** The attacker's objective is denial of service, owner-decision manufacture, or statutory-deadline pressure rather than unauthorised dispatch. Declare a stall; row 3 suspends; refunds inside live FTC clocks stop; clocks run; the owner is driven to the override.

**Why the inversion survives.** `UNCORROBORATED_STALL` suspends **only** row 3. Rows 1, 2, 4 and 5 are unchanged from `NORMAL`'s degraded table, and the company does not halt. A model-reachable approval flood is separately closed: `30 §5.1` item 5 removed blanket `REQUIRE_APPROVAL` and `I17c` makes saturation an incident. So the DoS surface is one precedence row, and the inversion is nonetheless the correct trade — a self-declared *stricter* state is a far smaller lever than a self-declared *looser* one, which is what v1.1 had.

**Residual, and it is real.** The attack does succeed at converting an unauthorised-dispatch risk into an **owner-manipulation** risk, exactly as A3 frames it: manufacture the stall, run the clock, present the owner with a statutory breach in progress, and obtain the override. Since the override is unspecified (TA-05), the value of what the attacker obtains is undefined and potentially larger than the dispatch it was denied. **The inversion is the right trade and its residual is entirely concentrated in TA-05.** That is the strongest argument for treating TA-05 as BLOCKING rather than MATERIAL.

---

## 3. Mechanism B — findings

### TB-01 — `24 §3` K5's `window_balance` `CHECK` omits the standing term

**BLOCKING** · Mechanism B · `24 §3` K5, against registry `I3`; `36 §2` VC-L2, `51 §5` · **S1 blocking: yes** · in scope via B4

**Claimed property.** Registry `I3`: enforcement is *"DB — `window_balance(company_id, window_id, reserved, **standing**, presumed_settled, realised, ceiling_monetary, ceiling_count, ceiling_irrecoverable)` with a `CHECK` on the sum."*

**Constructed path.** `24 §3` K5 prints the mechanism:

```
window_balance(window_id PK, reserved_monetary, presumed_monetary, realised_monetary,
               reserved_count, realised_count, reserved_irrecoverable, ...)
  CHECK (reserved_monetary + presumed_monetary + realised_monetary <= max_monetary)
```

Three disagreements with the registry: **no standing column**, **no standing term in the `CHECK`**, and a different primary key (`window_id` versus `(company_id, window_id)`). `26 §10.1`'s `Standing(w)` is a *display* quantity computed over the authorisation table; `I3` term 2 is an *enforcement* quantity that must be in the row. If the printed `CHECK` is implemented, term 2 is enforced by nothing.

**Result.** **Succeeded, and it inverts Mechanism B's only claimed property.** Mechanism B exists so that a paused authorisation's forward exposure continues to occupy the window. Under the printed `CHECK`, it does not, and STD-02's path reopens with no invariant firing: pause, headroom apparently free, a second authorisation acquires it, and the retained-exposure property was never enforced. Registry rule 2 resolves inconsistent *citation* of an identifier; it does not repair a schema, and S1 builds the schema from `24 §3` K5.

**Remediation.** Correct `24 §3` K5's column set and `CHECK` to match registry `I3` exactly — four monetary terms, and the same for the count and irrecoverable ledgers — and add the standing term to `36 §2` VC-L2's database-level assertion, which currently asserts only that the over-commit is rejected at the database and does not assert which terms participate. Add a consistency condition asserting that every printed `CHECK` expression matches the registry's operand list.

---

### TB-02 — forward exposure's window-instance scoping is undeclared

**BLOCKING** · Mechanism B · `24 §3.1` transition table, `24 §3` K5, `26 §10.1`, `26 §10.5`, `51 §3.2`, registry `I3`, `I54` · **S1 blocking: yes** · in scope

**Claimed property.** `I54`'s conservative default: *"forward exposure is held until the last referenced window closes."* `51 §3.2`: *"the headroom returns when the window closes."* `24 §3.1`: forward exposure **Retained** in every non-`REVOKED` status.

**Constructed path.** B2's walk, taken to the boundary and past it.

1. Day 1 of a 31-day January. `campaign.budget.set` at `$6.00/day`. `standing_cap(W_MONTH_ADSPEND) = $186.00`.
2. Day 3: the campaign is paused. `PAUSE_PENDING`, then `PAUSED` on the verification read. `realised_spend = $18.00`. `forward_exposure = max(0, 186 − 18) = $168.00`. Retained. Correct.
3. `cessation_lag` is `UNMEASURED`, so no `REVOKED` transition exists. The authorisation is permanently non-`REVOKED`.
4. **1 February, 00:00, company timezone, database clock.** `W_MONTH_ADSPEND` is `DISCRETE`, so the balance row resets. Now evaluate term 2 for the February instance:

   `forward_exposure(s, W_MONTH_ADSPEND, t_feb) = max(0, standing_cap(s, W_MONTH_ADSPEND) − realised_spend(s, W_MONTH_ADSPEND, t_feb))`
   `= max(0, $182.40 − $0.00) = $182.40`

   The formula's operands are the *named* window and the authorisation's realised spend *in that window instance*. Nothing in the formula, the transition table or `I3` scopes the computation to window instances at or before `s.expires_at`.

**Result.** **Succeeded.** Two implementations diverge completely:

- **Literal reading.** The dead January authorisation consumes `$182.40` of February's `$186.00` ceiling, and March's, and every month thereafter, because it can never reach `REVOKED`. A second paused authorisation exhausts the window permanently. **Advertising can never restart, and B2's constructed worse-failure is the actual specified behaviour.**
- **Intended reading.** Exposure lapses with the window instance, per the prose. Then *"retained in every non-`REVOKED` status"* means *retained within the current window instance*, and `26 §10.5`'s commercial statement is exactly right.

*"The last referenced window"* is the phrase the whole thing turns on and it is defined nowhere. For a recurring named window with an unbounded series of instances, it has no referent.

This is LIM-02's exact signature — an operand a mechanism needs that no artifact declares — in the mechanism this review exists to attack, deciding whether the company can advertise at all.

**Remediation.** (a) Declare: `forward_exposure(s, w_instance, t) = 0` for every instance of `w` beginning after `s.expires_at`, and for every instance in which `s` was non-`LIVE` throughout. (b) Declare that the window-boundary re-reservation job (`24 §3` K5 *Inputs*) re-reserves only for `status = LIVE`. (c) Replace *"the last referenced window"* with *"the last instance of any referenced window that overlaps `[created_at, expires_at + cessation_grace]`"* or an equivalent with a referent. (d) Add the boundary case to `36 §2` VC-S2: pause mid-month, cross the boundary, assert the next month's headroom is **full** and that a new authorisation succeeds — a case no current verification case covers.

---

### TB-03 — no declared handoff between the rate class's reservation and the standing forward exposure

**BLOCKING** · Mechanism B · `26 §2.1` `exposure` block, `26 §8` advertising policy, `24 §3` K5, registry `I2`, `I3`, `I18b` · **S1 blocking: yes** · in scope via B4

**Claimed property.** `I18b`: *"`reservation.amount == exposure.total_exposure`, exactly, in the single ledger currency. **No tolerance.**"* `I2`: every PERMIT has a `Reservation` or belongs to a documented zero-exposure class. `I3` term 1 is the reservation ledger; term 2 is non-`REVOKED` standing forward exposure.

**Constructed path.** Authorise the first `campaign.budget.set`. `26 §2.1`'s `exposure` block carries **both** `total_exposure` (*"THIS is the reserved quantity"*) and a separate `forward_integral` (*"rate classes: `forward_exposure(s, w, t)`, §10.1"*). `26 §8`'s policy tests `context.exposure.forward_integral <= exposure.window("W_MONTH_ADSPEND").headroom`. Step R reserves `total_exposure`. The authorising effect creates the `StandingAuthorization`, whose forward exposure enters term 2. Enumerate the readings:

| Reading | `total_exposure` | Term 1 | Term 2 | `I3` sum vs `$186.00` |
|---|---|---|---|---|
| A — `total_exposure` is the vendor field only | `$6.00` | `$6.00` | `$186.00` | `$192.00` → **deny** |
| B — `total_exposure` includes the forward integral as *"class-specific economically bounded loss"* | `$186.00` | `$186.00` | `$186.00` | `$372.00` → **deny** |
| C — the reservation is released when the standing authorisation takes over | `$186.00` → 0 | `$0.00` | `$186.00` | `$186.00` → permit |

Reading C is the only workable one and **nothing states it.** `26 §7` item 8 declares exactly one reservation-release path — the idempotency duplicate at steps T–V — and `26 §10.3`'s Path A remediation is emphatic in the opposite direction: *"Releasing the reservation does not release the exposure."* `I2` requires the row to exist for every PERMIT; whether it may be released, converted or zeroed on standing creation is undeclared.

**Result.** **Succeeded.** Under both stated readings the **first** advertising authorisation in the company's life denies `WINDOW_EXHAUSTED`, because `W_MONTH_ADSPEND.max_monetary` equals `standing_cap` exactly and the same economic quantity is counted in two of `I3`'s four terms. B4's question — whether the four terms are checkable at one commit point — has a sharper answer than expected: they are checkable, and two of them describe the same money.

**Remediation.** Declare `total_exposure` for rate classes explicitly in `26 §2.1` and state the handoff: either (i) the rate class is a **documented zero-monetary-exposure class** under `I2` whose economic consequence is carried entirely by term 2 — which is coherent, because `26 §7.1` already establishes a zero-monetary-reservation precedent for the `StandingRevocationAuthority` — or (ii) the reservation is converted to the standing forward exposure in the authorising transaction, with the conversion declared as the third reservation-terminal state alongside release and `PRESUMED_SETTLED`. Then add the arithmetic to `51 §4` so `I7`'s oracle covers it, and add a VC asserting that the first `campaign.budget.set` **permits** — which no current verification case asserts.

---

### TB-04 — the realised/standing joint update has no declared atomicity or lock

**BLOCKING** · Mechanism B · `24 §3` K5, `26 §10.1`, `30 §5.2` lock order, registry `I3` · **S1 blocking: yes** · in scope via B4

**Claimed property.** `I3` holds *"always"*, enforced by a `CHECK` on the `window_balance` row taken `SELECT … FOR UPDATE` inside the authorising transaction, ascending `window_id`, before the journal counter.

**Constructed path.** `forward_exposure = max(0, standing_cap − realised_spend)`, and `realised_spend` arrives asynchronously from the audit plane's and the finance ingest's vendor reads. So term 2 is a **function of term 4**, and the two must move in opposite directions by equal amounts. The `window_balance` row materialises both. Ask who updates them and under what lock — nothing declares it. Two orderings, both broken:

- **Realised first.** `realised += $12` while `standing` still holds the pre-update figure. The sum transiently exceeds the ceiling by `$12`, the `CHECK` refuses the `UPDATE`, and **the spend cannot be recorded.** The financial-truth path is blocked by the authority ledger.
- **Standing first.** `standing -= $12` before `realised += $12`. Headroom of `$12` exists transiently. A concurrent authorisation taking `FOR UPDATE` on the row in the declared order sees it and consumes it, without ever touching the standing authorisation or any lock associated with it. B4's question — *can it create headroom without acquiring the same lock?* — answers **yes**.

**Result.** **Succeeded.** The interleaving is not exotic: the spend reconciler and an authorisation contending for one `window_balance` row is the ordinary daily case for a live campaign.

**Remediation.** Make `standing_monetary` a **generated column** over `(standing_cap, realised_monetary)` so that no interleaving can separate them and one row update moves both — which also removes an independently writable authority quantity from the control plane's reach. Alternatively declare the joint update as a single statement under the same `FOR UPDATE` in the declared lock order. Separately, per TB-08, move an over-ceiling realised figure out of the `CHECK`. Add the interleaving to `36 §14`'s targeted-interleaving set with its mandatory `REPEATABLE READ` negative control.

---

### TB-05 — `charge.standing_authorization_id`'s provenance is undeclared and not vendor-carried

**BLOCKING** · Mechanism B · `51 §3.2` `reconciler_match_rule`, registry `I22`, `I54`, `24 §3.1` property 3 · **S1 blocking: yes (fixture), S3 (live)** · in scope

**Claimed property.** `51 §3.2`: *"The last conjunct is the SR-S2 repair: a successor authorisation can never absorb a predecessor's charges, because the match is scoped to a single `standing_authorization_id`."* `I22`: *"A successor authorisation never absorbs a predecessor's charges."*

**Constructed path.** B6, and the brief's instruction not to accept `charge.standing_authorization_id == s.id` unless the field's source is specified and trustworthy. It is not specified anywhere. Then ask which vendor read produces `charge`, and check the rule's six conjuncts against each candidate:

| Conjunct | Google Ads spend report | Processor card line |
|---|---|---|
| `payment_instrument` | absent | present |
| `merchant_identifier` | absent | present |
| `resource_ref` (campaign) | present | **absent** — one aggregate line |
| `amount <= standing_cap` | present | present |
| `window_of(charge.date)` | delivery date | posting date |
| `standing_authorization_id` | **absent** | **absent** |

**No single source carries all six**, and the identifying conjunct is carried by neither. So the field is ACOS-derived, and any derivation reduces to `(vendor, resource_ref, date)` — the v1.1 rule SR-S2 replaced — plus a rule for choosing among authorisations that governed that resource. Construct the failure:

1. January authorisation `s1` on campaign C, paused day 3, `PAUSED`, non-`REVOKED`.
2. February authorisation `s2` on campaign C (possible once TB-02's boundary lapse is declared).
3. Google Ads posts delayed January spend during February.
4. If the derivation keys on *delivery date* → `s1`, correct, and `STANDING_SPEND_AFTER_EXPIRY` fires per `24 §3.1` property 3. If it keys on *the authorisation live at posting time* → `s2`, and the predecessor's spend is absorbed by the successor with `I22` silent. **STD-02's defect, reached through the derivation layer rather than the match rule.**

Which timestamp is authoritative is TB-07's undeclared operand, so the two cases are not distinguishable from the specification.

**Result.** **Succeeded.** The scoping is a self-assertion. `51 §5`'s fixture requires *"one crafted charge authored by someone other than the match rule's author"* — good discipline, and it tests the rule, not the derivation, so it would pass against a wrong derivation.

**Remediation.** (a) Declare the charge record's source per adapter, with its field set, and mark absent conjuncts as such rather than writing a predicate over fields that do not exist. (b) Declare the derivation of `standing_authorization_id` explicitly as a derivation, with the authoritative timestamp named. (c) Declare the ambiguity rule and make it directional: where two non-`REVOKED` authorisations could match, attribute to the **earliest** and raise an incident — never to the successor. (d) Extend `I22`'s fixture with a predecessor/successor pair across a window boundary and a late-posted charge, with the crafted case authored independently of the *derivation*, not only of the rule.

---

### TB-06 — no invariant asserts the `StandingAuthorization` transition set, and `any → EXPIRED` includes `REVOKED`

**BLOCKING** · Mechanism B · `24 §3.1` transition table, registry `I23`, `I54`, `I55`, `§2.8` · **S1 blocking: yes** · in scope

**Claimed property.** `24 §3.1` declares five states and a transition table. `REVOKED` is declared *"Terminal"*.

**Constructed path.** Two defects in one place.

1. **No enforcement identifier.** Grep the registry's twenty-one enumerated DB-enforced rows. `I23` is a generated status; `I55` is an FK plus a generated status; neither constrains the *transition*. The Approval machine received `I60` — *"every `Approval` transition is in the declared transition set … DB (CHECK on the transition …)"* — for exactly this reason, in the same release, at RES-09's prompting. The state machine that gates money release received nothing. So an illegal transition is a prose violation with no detector, in the mechanism whose single property is that release happens in exactly one state.
2. **`any` includes `REVOKED`.** The table's fourth row reads `any | EXPIRED | expires_at reached | Retained`. Taken literally, an authorisation that reached `REVOKED` — released exposure, `StandingRevocationAuthority` destroyed per the ledger's SR-S3 entry — transitions to `EXPIRED` at `expires_at` and **re-acquires forward exposure it had already released**, while `I55` immediately fires `STANDING_UNREVOCABLE` at CRITICAL because no revocation authority exists for a non-`REVOKED` authorisation. Every authorisation revoked before its expiry produces a guaranteed CRITICAL incident and a resurrection of released exposure.

**Result.** **Succeeded.** Defect 2 is unreachable at MVP because `REVOKED` is unreachable, which is the only thing keeping it out of the BLOCKING-for-a-different-reason column; it becomes live the moment `cessation_lag` is measured, which is `58 §12` item 9 at S3. Defect 1 is live at S1, because S1 builds the state machine.

**Remediation.** Add an identifier — `I62` — with the same shape as `I60`: *"Every `StandingAuthorization` transition is in the declared transition set of `24 §3.1`, DB-enforced by a `CHECK` on `(old_status, new_status)`, and `REVOKED` has no outbound transition."* Add it to registry `§2.8`'s enumeration and correct the count. Rewrite the fourth transition row as `LIVE | PAUSE_PENDING | PAUSED → EXPIRED`. Add the illegal-transition assertions to `36 §2` VC-S2 the way VC-R1c asserts them for approvals.

---

### TB-07 — `I54`'s verification operands are undeclared, so `58 §12` item 9 is not executable

**MATERIAL** · Mechanism B · registry `I54`, `51 §3.2`, `58 §12` item 9 · **S1 blocking: no; blocks the S3 measurement** · in scope

**Claimed property.** `I54`: *"a verification read from the audit plane's own vendor credential showing **zero incremental platform spend attributable to that `standing_authorization_id`** across the adapter's declared `cessation_lag` interval."*

**Constructed path.** Attack every word, as the prompt's B5 requires.

- **zero** — over which reporting surface, and at what reporting completeness? Google Ads spend figures are not final on retrieval; a zero read is consistent with unreported spend.
- **incremental** — relative to which prior observation, and what happens when the prior observation is itself revised downward?
- **attributable** — TB-05. The attribution is undeclared and the identifier is not vendor-carried.
- **across `cessation_lag`** — when does the interval **begin**? Pause request, vendor acknowledgement, last observed spend, or first zero-spend observation? These differ by hours and the choice determines whether the interval ever completes: *first zero-spend observation* restarts on every late-posted charge and may never complete.
- **verification read** — no freshness requirement. No behaviour declared for stale reporting, eventual consistency, missing periods, API rate limits, or an account timezone differing from the company timezone the windows are evaluated in.

**Result.** **Succeeded, with a consequence beyond the specification gap.** `58 §12` item 9 says to measure *"how long after a pause the platform's spend reporting settles"*. That measurement is undefined without an authoritative timestamp and an interval start. **The S3 obligation as written is not executable**, so the parameter that gates `REVOKED` cannot be measured, so the conservative default is permanent for a reason that is procedural rather than empirical. This changes what `58 §13` condition 3 is waiting for.

**And a structural answer to the prompt's B5 closing question.** `cessation_lag` should not be one scalar. The quantity that matters is a tuple per adapter: reporting settlement latency, the authoritative timestamp kind, the revision window during which a posted figure may still change, and the minimum observation count. A single scalar cannot express *"zero across an interval"* when the interval's own endpoints are vendor-defined.

**Remediation.** Replace `cessation_lag` with a declared per-adapter **cessation specification** carrying those four fields with individual provenance. Restate `I54` against it. Rewrite `58 §12` item 9 to require declaring the specification *before* measuring, and make the declaration an S1 artifact so the S3 measurement has a target.

---

### TB-08 — zero slack between `standing_cap` and the window ceiling, and `realised` inside the `CHECK`

**MATERIAL** · Mechanism B · `51 §2` `W_MONTH_ADSPEND`, `51 §3.2`, `26 §10.1`, `24 §3` K5, registry `I3`, `I18d` · **S1 blocking: yes (schema)** · in scope via B8

**Claimed property.** `51 §2`: *"`W_MONTH_ADSPEND`'s `$186.00`. This is the annual worst case of `standing_cap(month)`."* `I3` on violation: *"**Security incident** — the control model itself has been breached. All effects reserving against the window halt."*

**Constructed path.** `standing_cap(31-day) = $186.00` and `W_MONTH_ADSPEND.max_monetary = $186.00`. Slack is exactly zero. The `30.4` basis is `DOCUMENTED` from Google's *monthly spending limit*, which is a billing commitment and not a delivery guarantee, and it is recomputed when the budget changes mid-month. So a delivered `$186.50` — a vendor-side event ACOS did not authorise and cannot prevent — produces:

1. `realised_monetary = $186.50 > $186.00`.
2. `realised` is a term **inside** the `CHECK`, so the reconciler's own `UPDATE` violates it and **the true figure cannot be written.** The financial-truth path is unable to record reality because reality exceeds an authority ceiling.
3. If it could be written, `I3` fires as a **security incident** — *"the control model itself has been breached"* — for a vendor overdelivery, and halts every effect reserving against the window.

The multiplicative form `57 §2` specified carried `(1 + overdelivery_allowance)` and would have created the slack. v1.2's deviation removes it. This is the deviation's cost, and it is the only cost this review found — TB-15 records that the deviation is otherwise strictly stronger.

**Result.** **Succeeded.** Registry `§3` item 3 already concedes that `I3` bounds the ledger and not the loss, and that settled cost may exceed the ceiling. It does not notice that its enforcement mechanism makes the excess **unrecordable**.

**Remediation.** (a) Set `W_MONTH_ADSPEND.max_monetary` above `standing_cap` by a declared overdelivery band with provenance, so the documented worst case fits under the ceiling with margin — this recomputes `MAL_total` upward and requires re-signature under `26 §10.3`, which is correct because the band is authorised loss. (b) Remove `realised` from the `CHECK`'s refusal path: the `CHECK` should bound what ACOS *commits* (reserved + standing + presumed), while a realised figure exceeding the ceiling is recorded unconditionally and raises a distinct `WINDOW_CEILING_BREACHED` event. (c) Introduce `STANDING_OVERDELIVERY` as the incident type for a vendor-caused excess, distinct from `I3`'s security path, so a vendor billing artefact does not read as a control-model breach.

---

### TB-09 — `36 §12`'s `I7` oracle specification and `37 §5` state the superseded standing basis

**MATERIAL** · Mechanism B · `36 §12`, `37 §5`, against `51 §4.1` and `analysis/v1.2-consistency-audit.md` C5/C6 · **S1 blocking: yes** · in scope via B (the quantity is `Standing`)

**Claimed property.** `36 §12`, specifying `I7`'s oracle: *"`51 §4` displays the arithmetic — Stage-2 `MAL_total(month)` = $600 from a $300 monetary component, **$180 standing** and $120 irrecoverable cost, with `MAL_total(day)` = $173.50."* `37 §5` repeats it and adds `$5,205`.

**Constructed path.** `51 §4.1` computes `Standing(month) = $182.40 / $186.00` under the exposure-remainder form and `MAL_total(month) p95 = $756.00`, `MAL_total(day) p95 = $329.50`, `30 ×` daily `= $9,885.00`. `$180.00` is `30 × $6.00` — the **v1.1 multiplicative basis v1.2 explicitly deviated from**. So the artifact that specifies `I7`'s differential oracle names Mechanism B's superseded forward-exposure basis and a `MAL_total` that no longer exists.

Then check the gate. `analysis/v1.2-consistency-audit.md` C5 — *"`MAL_total` signature basis stated as $756.00 consistently"* — **PASS**. `$756.00` appears in exactly one deliverable. C6 — *"`Standing(month)` 31-day stated as $186.00 consistently"* — **PASS**. Two deliverables state `$180` as standing. **Both PASSes are false.**

**Result.** **Succeeded.** `54 §2.3` records that v1.1's reviewer reproduced `$300.00` *"only by inferring the convention from the printed answer"*, and `36 §0` exists to prevent exactly that. An oracle specification carrying the superseded figures reproduces the circularity: the S1 oracle author reads `36 §12`, computes `$600`, disagrees with `51`, and resolves the disagreement by adopting the printed answer.

**Remediation.** Correct both sites to the v1.2 figures. Re-run C5 and C6 as *"stated identically wherever stated, and stated nowhere else in a superseded form"* rather than *"stated consistently"* — the current formulation passes when a figure appears once and its predecessor appears twice. Record in the consistency audit that two conditions returned false PASSes, because `21 §2` item 16's finding is that an unrecorded audit failure is more decision-relevant than the defect it concealed.

---

### TB-10 — the commercial statement is incomplete in three ways an owner would notice

**MATERIAL** · Mechanism B · `26 §10.5`, `51 §3.2`, `30 §3` V2 · **S1 blocking: no** · in scope

**Claimed property.** `26 §10.5`: *"Pausing a campaign does not return headroom. Pause-and-reauthorise within one window is not possible. At MVP, advertising is a whole-window commitment."* `30 §3` V2 displays *"the fact that pausing does not return headroom"* so *"the owner should not discover that from a denied re-authorisation."*

**Constructed path.** B3's four cases, against what is actually stated.

| Case | Stated? | Actual consequence |
|---|---|---|
| Mid-month strategy change | **Yes** | Costs the remainder of the month's exposure |
| Mid-month creative failure | No | Same as above, but the owner's mental model is *"pause, fix, resume"* — and **there is no `PAUSED → LIVE` transition**, so resumption is a new authorisation needing headroom the paused one holds |
| Platform policy suspension | No | The platform stops spend; ACOS cannot verify cessation (`cessation_lag` unmeasured); exposure is held to window close; a replacement campaign on another platform is blocked because Meta is not autonomy-eligible for rate classes (`51 §3.2`) |
| Supplier outage requiring an immediate stop | No | The stop works. The headroom does not return, so the company cannot redirect spend for the rest of the window |
| Seasonal peak the day after a pause | No | Unreachable within the window |

Three things are missing and one of them is not a disclosure gap but a capability the owner would assume exists: **no state machine transition resumes a paused authorisation.** `24 §3.1` has no path back to `LIVE` from any state.

**Result.** **Succeeded as an incompleteness.** The trade itself is correct and this review does not propose weakening it — `26 §10.5` is right that releasing on pause dispatch is unsound and right that this is a business-model finding if the measurement returns long.

**Remediation.** Extend `26 §10.5` to state plainly: pausing is one-way; a paused campaign cannot be resumed, only replaced; replacement requires headroom the paused authorisation holds until the window closes; and the window-close behaviour is TB-02's declared rule. Add to V2 the projected date at which each non-`REVOKED` authorisation's exposure lapses, so the owner sees *when* headroom returns and not only *that* it does not return now.

---

### TB-11 — the `PAUSE_PENDING` self-loop's retry bound is undeclared

**MINOR** · Mechanism B · `24 §3.1` transition table · **S1 blocking: no** · in scope

**Claimed property.** *"Pause effect fails or times out → **bounded retry** against the same idempotency key, then `STANDING_PAUSE_FAILED` incident at CRITICAL."*

**Result.** No bound declared. Registry rule 5. The failure direction is safe — exposure is retained throughout — so severity is low, but the retry interacts with `cessation_grace` at 72h: a retry schedule longer than the grace exhausts the `StandingRevocationAuthority`'s lifetime and produces `I55`'s `STANDING_UNREVOCABLE` instead of `STANDING_PAUSE_FAILED`.

**Remediation.** Declare attempts and backoff in `51 §3.2`, with the total bounded strictly below `cessation_grace`, and state that relationship where `cessation_grace` is declared.

---

### TB-12 — the owner of the `PAUSE_PENDING → PAUSED` verification read is undeclared

**MATERIAL** · Mechanism B · `24 §3.1`, registry `I54` · **S1 blocking: no** · in scope via J1

**Claimed property.** `PAUSE_PENDING → PAUSED` on *"Verification read confirms the platform reports the campaign stopped."* `I54`'s read is explicitly *"from the audit plane's own vendor credential"*; this one names no plane.

**Constructed path.** Both readings are consequential and neither is stated. **Control-plane read**: a compromised control plane self-certifies `PAUSED`, which gains it nothing directly because `PAUSED` retains exposure — but it does close the `STANDING_PAUSE_FAILED` incident that would otherwise reach the owner at CRITICAL, so the lever is *suppressing an escalation*, not acquiring headroom. **Audit-plane read**: an audit-plane outage strands the authorisation in `PAUSE_PENDING` indefinitely, retaining exposure (safe) and holding a CRITICAL incident open (noisy but not unsafe).

**Result.** **Succeeded as an undeclared owner.** Registry rule 4 — *"Owner is the plane that computes the check"* — applies to the transition's read as much as to an invariant.

**Remediation.** Declare the read's owner. Recommend the **audit plane**, for consistency with `I54` and because it removes the escalation-suppression lever; state explicitly that its unavailability strands the authorisation in `PAUSE_PENDING` with exposure retained, which is the correct fail-closed direction and is J1's answer.

---

### TB-13 — no declared supersession for a rate change on the same resource

**MATERIAL** · Mechanism B · `24 §3` K5, `26 §8`, `26 §10.5`, registry `I3`, `I22` · **S1 blocking: yes** · in scope

**Claimed property.** `26 §8`'s worked policy is *"CEO may increase an already-approved campaign budget by no more than 15%"*, dispatched as `campaign.budget.set` — an absolute value the kernel computes. `24 §3` K5: *"`standing.required` must hold, so the authorising effect creates a `StandingAuthorization`."*

**Constructed path.** A live campaign at `$6.00/day`. The CEO proposes `$6.90/day`, within the 15% policy. The authorising effect creates a `StandingAuthorization`. Does the existing one become `REVOKED`? It cannot — `cessation_lag` is unmeasured. Does it mutate? Nothing declares mutation, and mutating a rate would change `standing_cap` under a live reservation with no re-signature path. So two non-`REVOKED` authorisations exist on one `resource_ref`, and `Standing(w) = Σ over status ≠ REVOKED` sums both: `$186.00 + $213.90 = $399.90` against a `$186.00` ceiling. **Deny.**

**Result.** **Succeeded.** The ordinary advertising operation — tuning a running campaign's budget — is unavailable within a window, for the same arithmetic reason as pause-and-reauthorise. `26 §10.5` discloses the pause case and not this one, and `26 §8`'s worked policy is the package's own headline example of what the CEO may do. Two artifacts describe an operation the exposure model forbids.

**Remediation.** Declare rate supersession: a `campaign.budget.set` on a resource with a live `StandingAuthorization` **supersedes** it, in one transaction, with the predecessor moving to a declared `SUPERSEDED` status that retains exposure under the successor's `standing_cap` rather than adding to it — `standing_cap` per `(resource_ref, window)` rather than per authorisation, with the maximum over the window's authorisations as the bound. Note that this interacts with TB-05: superseded authorisations are exactly the predecessor/successor attribution case, so the two repairs must be written together. Then add the case to `26 §10.5` and to `36 §2` VC-S2.

---

## 4. Mechanism B — attacks constructed and defeated

### TB-14 — release headroom by reaching `PAUSED`

**DEFEATED** · claimed property: `24 §3.1` — `PAUSED` is a display state, not a release state.

**Path.** Dispatch the pause, obtain a vendor acknowledgement, reach `PAUSED`, expect headroom.

**Why it fails.** The transition table retains forward exposure in `PAUSED`, and the ledger's SR-S2 entry states explicitly that `PAUSED` means *the vendor acknowledged the pause* and is not a release. The strengthening beyond `57`'s two-status retention is sound. `54 §4.2` is closed at the level of the state machine.

---

### TB-15 — under-reserve the remainder form through reporting error

**DEFEATED, and the deviation is vindicated** · claimed property: `51 §4.3` — the remainder form is strictly better than the multiplicative form.

**Path.** B8's mandate. Construct delivery patterns to make `realised_spend + forward_exposure` understate maximum authorised future loss: front-loaded overdelivery, delayed posting, downward spend corrections, negative adjustments, timezone boundary shifts, month crossing, spend reported after pause, a charge reclassified to another day.

**Why they all fail.** `forward = max(0, cap − realised)`, so for `realised ≤ cap`:

`realised + forward ≡ standing_cap`

identically, **for every value of `realised`, however wrong.** Under-reported spend makes `forward` larger by the same amount, so the sum is invariant and the true remaining authorised spend (`cap − true_realised`) is strictly less than the reserved `forward`. The form **over**-reserves under under-reporting. Downward corrections and reclassifications move `realised` and are absorbed identically. Month crossing changes `standing_cap` via `periods_basis` and re-derives the identity in the new window. Timezone shifts move a charge between window instances and are absorbed on both sides.

**Conclusion.** The remainder form is not merely more permissive on day 2 — it is **structurally insensitive to realised-spend reporting error**, which the multiplicative form is not, because `rate × remaining_periods × (1 + allowance)` is independent of `realised` and therefore adds to a wrong `realised` rather than compensating for it. `51 §4.3`'s argument is correct and understates its own case. The deviation from `57 §2` should be **accepted**, with TB-08 as its one cost.

**Residual.** The identity holds only while `realised ≤ cap`. Above the cap it is TB-08.

---

### TB-16 — successor absorbs a predecessor's charges within one window

**DEFEATED WITHIN A WINDOW** · claimed property: `I22`, `51 §3.2`'s last conjunct.

**Path.** STD-02's original construction: pause `s1`, create `s2` on the same campaign, let `s1`'s post-pause charges match `s2`'s rule.

**Why it fails within a window.** `s2` cannot be created, because `s1` holds the headroom and `I3` denies `WINDOW_EXHAUSTED`. The retained-exposure rule closes the attack by making the successor impossible rather than by making the match precise.

**Why this is not a full defeat.** Across a window boundary the successor becomes possible and the attribution question is live — TB-05. So `I22`'s scoping is doing no work *within* a window (there is no successor) and is unverifiable *across* one (the identifier is derived). The defence is `I3`, not the match rule.

---

### TB-17 — exhaust the window with `StandingRevocationAuthority` reservations

**DEFEATED** · claimed property: `26 §7.1`, `I2`, `I55`.

**Path.** The revocation path creates a reservation row at step R. Repeatedly trigger pauses to accumulate reservations against `W_MONTH_ADSPEND` and starve the window.

**Why it fails.** `per_action_max { monetary: 0.00 }`, and `I2`'s v1.2 note is explicit that the path *"creates a zero-amount reservation row, so it is not an exemption."* Zero-amount rows do not consume monetary headroom. `max_count: UNBOUNDED` on the authority is bounded externally by `W_MONTH_UNGATED`'s count of 200. The `I32` reaping interaction is benign because zero-amount rows carry no exposure to attribute.

---

## 5. Joint

### TJ-01 — external effect escapes the claimed record with no invariant firing

**BLOCKING — determining finding** · joint · registry `I17`, `I17e`, `I17f`, `I8`, `30 §5.4`, `30 §5.5`, `30 §5.6` · **S1 blocking: yes** · in scope

Full construction in `59 §1`. Composition of TA-01 (frozen attested prefix undetectable), TA-04 (no dispatch→tag detector), TA-03 (`I8`'s scope ambiguous) and TA-02 (`I8`'s cadence undeclared). The attacker never declares degradation, so the entire three-state machine — the mechanism's strongest element — is bypassed rather than attacked.

**When the invariant fires, and with what.** Under `I8` reading (i) with a declared cadence, the vendor-touching subset is detected at `sweep_cadence + reporting_lag`, **after** the effect, with the vendor's own record available for recovery, and with the authority boundary intact because `I3` bounded the exposure in the control database throughout. That is an acceptable posture and it is what the architecture should claim. Under reading (ii), nothing fires. For the non-vendor-touching subset — authorisations, denials, approvals, reservations, clock creations, override exercises, `DISPATCHED_UNMIRRORED` tags themselves — nothing fires under either reading, and the specification does not say so.

**Remediation.** TA-01 through TA-04, plus registry `§3` item 9.

---

### TJ-02 — Mechanism A's failure weakening Mechanism B's safety property

**DEFEATED** · claimed property: the two mechanisms' composition.

**Path.** The prompt's final-discipline question 3. Make the audit plane unavailable so `I54`'s verification read cannot occur, and use that to obtain a `REVOKED` transition or a headroom release under uncertainty.

**Why it fails.** `I54`'s enforcement is a transition gate: no read, no `REVOKED`, exposure retained, and `I3` keeps counting it. The composition runs in the safe direction — a Mechanism A failure makes Mechanism B **stricter**. J1's answer is therefore bounded: a `PAUSE_PENDING` authorisation during an audit-plane outage stays `PAUSE_PENDING` with exposure retained, subject only to TB-12's undeclared read owner.

**The reverse direction is also safe.** Mechanism B's failure mode is headroom exhaustion, which denies authorisations and creates no audit relaxation.

---

### TJ-03 — the full joint sequence

**BOUNDED; severity inherited from TA-05 and TB-02** · joint · in scope

**Path.** The prompt's joint construction, run end to end: live standing advertising authorisation; anomalous spend triggers a pause; `PAUSE_PENDING`; the audit mirror path fails; the control plane enters `UNCORROBORATED_STALL`; a statutory customer refund arrives concurrently; the owner is unavailable; the window boundary passes; the advertising vendor posts delayed spend.

**Walk.**

| Step | State | Bound |
|---|---|---|
| Pause dispatched, outcome unknown | `PAUSE_PENDING`, exposure retained | `I3` term 2 |
| Audit path fails | `UNCORROBORATED_STALL` (not `CORROBORATED_DEGRADED`, per TA-06) | Row 3 suspends |
| Statutory refund arrives, `I56`-backed clock | Suspended, not dispatched | `I13` escalates; FTC clock runs |
| Owner unavailable | Clock expires | **Statutory breach.** Architecture accepts it |
| Window boundary | **Undeclared** — TB-02 | Either permanent exhaustion or full lapse |
| Delayed spend posts | **Undeclared** — TB-05, TB-07 | Either predecessor or successor |
| Recovery | `ATTESTATION_STALL` fired at ≤15 min; `I17f(b)` raised `ATTESTATION_DIVERGENCE`; `I8` sweeps the tag set | Detection before recovery, after the clock breach |

**Result.** No unauthorised economic exposure: `I3` holds throughout and every failure direction retains rather than releases. No audit escape *in this sequence*, because the control plane declared the stall honestly and the audit plane's `MIRROR_INPUT_STALL` corroborates the tags. The sequence's damage is a **statutory breach plus an undefined window-boundary outcome plus an undefined charge attribution** — two of which are TB-02 and TB-05, and the third of which the architecture chose deliberately and prices at an owner override that does not exist (TA-05).

**Fires before or after damage?** After. `I13`'s clock escalation fires before expiry with urgency derived from remaining time, so the owner has warning; the damage occurs because the owner is absent, not because detection was late.

---

## 6. Out of scope

Recorded with severity, not expanded around, per the brief `§2` and `53 §7`'s discipline.

### TOS-01 — LIM-09's correction applied in one of three sites

**MATERIAL** · `22 §3`, `33 §2.5`, against `26 §12`

`26 §12` correctly restates the pending-approval bound as `min(count_headroom, floor(monetary_headroom / per_action_max))` = **10** for `refund.create`, and explicitly records that v1.1's *"$600 / roughly 24 items"* was wrong twice. `22 §3` and `33 §2.5` still state *"at `MAL_monetary(month)` of $600 with a $25 per-action cap, roughly 24 items"*. The ledger records LIM-09 as closed by *"`26 §12` restated"*, which is accurate and incomplete — the claim appears in three artifacts and was corrected in one.

### TOS-02 — eight deliverables cite the superseded v1.1 registry

**MINOR** · `23`, `28`, `30`, `33`, `34`, `35`, `36`, `37`

Registry rule 1 makes the v1.2 registry the sole definition of every identifier. `37`'s S6 build scope reads *"The **MVP invariant set** as continuous checks (`phase2-v1.1-invariant-registry.md §2`)"* — scoping a build to a superseded set whose composition and count differ. Consistency condition C4 checked version lines in deliverables, not cross-references, and the audit's `§4` item 4 concedes that section references were spot-checked.

### TOS-03 — `30 §6.1`'s audit-ownership count disagrees with itself and with the registry

**MINOR** · `30 §6.1`, registry `§0`

*"Twenty of the registry's fifty-two are owned here"* — in a sentence immediately following a list of **twenty-two** identifiers, against a registry declaring **68** identifiers of which **22** name the audit plane. Three numbers, none agreeing. `analysis/v1.1-internal-consistency-pass.md` found arithmetic errors in a registry's own counts and the v1.2 registry displays its arithmetic for that reason; the artifact enumerating Mechanism A's owner set did not receive the same treatment.

### TOS-04 — `analysis/v1.2-consistency-audit.md` C5 and C6 returned false PASSes

**MATERIAL** · `analysis/v1.2-consistency-audit.md`

Evidence in TB-09. Recorded separately from TB-09 because the finding about the *gate* is distinct from the finding about the *figures*: two of twenty mechanical conditions returned the wrong answer, and the audit's own `§4` disclaimers anticipate that the conditions might be the wrong conditions and not that they might be evaluated wrongly. Per `30 §6.4` and `21 §2` item 16, an unrecorded failure in the audit trail is more decision-relevant than the defect it concealed.

---

## 7. Register summary

| | Findings | Defeated |
|---|---|---|
| Mechanism A | 10 (7 BLOCKING, 2 MATERIAL, 1 MINOR, 1 WORDING — TA-10 counted in both severity columns of `59 §2` as WORDING) | 5 |
| Mechanism B | 13 (6 BLOCKING, 5 MATERIAL, 2 MINOR) | 4 |
| Joint | 1 BLOCKING | 2 |
| Out of scope | 4 (1 MATERIAL, 2 MINOR, 1 MATERIAL) | — |

**Fourteen BLOCKING, zero FATAL.** Every BLOCKING repair is local: a restated sentence, a declared value, a corrected `CHECK` expression, an added invariant, a specified entity, or a scoping rule. None requires abandoning the attestation, the inversion, the five-state machine, the exposure-remainder form, or the conservative default.
