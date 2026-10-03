# ACOS Operating Spine v1.3.3 — Normative Errata

**Phase 2.5c. Issued 2026-09-08. Three normative declarations and one closed derivation, applied to Operating Spine v1.3.**

This is not an architecture phase, a red-team pass, a redesign or an implementation. **No mechanism was introduced, no authority ceiling was changed, MAL was not changed, no Step ordering was changed, no audit cadence was changed, and the selected architecture (Option A) was not changed.** Four defects of one shape are recorded below. All four were found during S1H implementation, all four were reported PARTIAL rather than guessed, and all four are the same defect class `52 §3` named: **a quantity or a rule that the mechanism needs, that the artifact declaring quantities does not declare.**

**Versioning convention, as v1.3.1 established it and v1.3.2 followed it.** The numbered deliverables continue to declare `Operating Spine v1.3` in their version lines, because the *architecture* is v1.3 and unchanged. `v1.3.3` names the **issue** of the package. **`docs/architecture/v1.3.2/` is not modified by this pass** and remains on disk as the previous issue, byte for byte; `docs/architecture/v1.3.1/` likewise. `phase2-v1.3.1-errata.md`, `phase2-v1.3.1-verification.md`, `phase2-v1.3.2-errata.md` and `phase2-v1.3.2-verification.md` are carried forward unmodified as history.

**What this pass changes about control artifacts.** Two signatures are newly owed and neither is discharged: **class 3**, whose `approval floor` field gains a declared value for the first time, and **class 27**, which is new. **The class-20 signature residual carried from v1.3.2 is unaffected and remains owed.** No production owner-signing mechanism and no runtime `I19` verification exist in the accepted implementation, and nothing in this pass claims otherwise.

---

## Summary

| # | Defect | Behaviour changed | Authority quantities changed |
|---|---|---|---|
| **APF-01** | `30 §5.1` item 4 row 2 compares against *"the per-action approval floor"*, a quantity **no artifact declared**. `50 §2` class 3 listed it as a signed catalogue field with no value; `§5.1`'s own AUD-05 narrative, `22 §3.1` and `36`'s `VC-A6` stated it in prose as the same `$25` figure as `refund.create`'s `per_action_max`, which is a **DENY** boundary of a different kind. At a floor equal to `per_action_max` row 2 is unreachable for the entire S1 catalogue | **Yes** — row 2's operand becomes a declared monetary predicate on `total_exposure` at `$20.00`, strict. Row 2's own behaviour is unchanged | **NO CHANGE.** The floor gates dispatch, never exposure |
| **MLT-01** | `30 §5.1` item 5's *"Mirror lag above threshold"* CRITICAL condition had **no declared threshold** and no declared operand | **Yes** — a declared, inclusive `PT15M` condition on a declared operand. It raises an escalation and nothing else | **NO CHANGE** |
| **FHT-01** | `30 §5.1` item 5's *"Mirror unreachable beyond a longer threshold halts **all** classes including REVERSIBLE"* had **no declared threshold**, **no declared operand** and **no declared timer semantics**, so the FULL-HALT POSTURE was unimplementable. `24 §3` K11 and `35 §12.1` repeated the rule in the same undeclared words | **Yes** — a declared, inclusive `PT30M` posture on a declared, single-valued operand with declared start and reset semantics. It only ever makes dispatch **less** eligible | **NO CHANGE** |
| **SWR-01** | `30 §5.7.1` declares `reason enum { …, STORE_WRITE_REJECTED }` and declared **no derivation**. The one reading a reader reaches for — insert-quota saturation — is explicitly forbidden as a mode change by `§5.1` item 5 and by `§5.6`'s table, so the member was either dead or a route by which a refusal became a relaxation | **Yes** — a closed ten-condition audit-owned derivation over one semantic failure class, with quota saturation and every security or integrity failure excluded **normatively** | **NO CHANGE** |

**Authority quantities, restated and reverified.** `MAL_monetary(month)` = **$300.00**. `Standing(month)` = **$182.40 / $186.00**. `MIE_cost(month)` p95 = **$270.00**. `MAL_total(month)` at the signature basis = **$756.00**. `refund.create`'s `per_action_max` = **$25.00**, unchanged. Every `51 §3.6` override quantity unchanged. `attestation_cadence` = 5 minutes, `k` = 3, anchor interval = 60 minutes, signal `max_age` = 5 minutes — all unchanged. `analysis/recompute-v1.3.py` reproduces the recorded `analysis/recompute-v1.3-output.txt` **line-for-line identically** after this pass. **No owner re-signature of the MAL basis is required.**

---

## 1. APF-01 — the per-action approval floor

### Defect

`30 §5.1` item 4 row 2, verbatim:

> | **2** | Above the per-action approval floor **and not** clock-bearing | **Halt.** […] |

Three artifacts referred to the quantity and none declared it.

- `50 §2` class 3 listed *"approval floor"* among the owner-signed action catalogue's fields — a **field name with no value**, which is rule 6's exact shape.
- `26 §12`'s tier table gives `NONE | TIER_1 | TIER_2 | OWNER` against triggers stated in words and **no monetary thresholds at all**, so the catalogue's `approval_requirement` is a *tier* and cannot be a *floor*.
- `51` declared no `approval_floor` row anywhere.

And `§5.1`'s own AUD-05 narrative, `22 §3.1` and `36`'s `VC-A6` each stated the floor in prose as `$25` — the same figure as `refund.create`'s `per_action_max`. **They are different quantities of different kinds.** `26 §8` makes `per_action_max` a DENY boundary — `context.exposure.total_exposure <= 25.00`, above which the action *"denies `PER_ACTION`"* — and **a denied effect never reaches item 4's precedence list at all.** So `per_action_max` cannot be row 2's operand, and if the floor were nevertheless `$25.00` the band in which row 2 is reachable would be **empty** and row 2 would be dead code presenting as a live control.

**Provenance.** Reported during S1H as `S1H-owner-clarifications.md` S1H-C1, which implemented row 2's behaviour over both values of the predicate, reported the predicate's *derivation* PARTIAL, and refused to invent the quantity under `§42` of the S1H mandate.

### Affected files

`deliverables/30-observability-audit-and-escalation.md` `§5.1` item 4 row 2 and the AUD-05 narrative, new `§5.1a` · `deliverables/51-limits-fixture.md` new `§3.7` · `deliverables/50-control-artifact-manifest.md` `§2` class 3 · `deliverables/22-architecture-principles.md` `§3.1` · `deliverables/36-architecture-validation-plan.md` `VC-A6` · `phase2-v1.3-invariant-registry.md` `§0` · `analysis/consistency-v1.3.py` conditions G1–G4

### Exact correction

> **`degraded_per_action_approval_floor_monetary` = USD 20.00**, declared in `51 §3.7`, provenance **OWNER DECISION / v1.3.3**.
>
> **Operand: `effect.request.exposure.total_exposure`.** Not `vendor_amount`, not a dispatch amount, not a model-supplied amount, not a `rationale` figure, not grant prose.
>
> **Strict comparison:** `total_exposure > 20.00` is ABOVE. `$20.00` is **not** above; `$20.01` is.
>
> **Kind:** a degraded-mode dispatch-precedence approval floor. Not `per_action_max`, not a Cedar DENY ceiling, not MAL, not a window ceiling, not a reservation amount, not an override cap.

`30 §5.1a` states this, prints the boundary table across `$19.99 … $25.01`, and records that `$20.01 … $25.00` is the whole band in which row 2 is reachable for `refund.create`.

### Control-artifact and version effect

The floor is a field of **class 3**, which already enumerated it. Giving it a value **moves class 3's `content_hash`** and a fresh owner signature with a second factor is owed before any deployment. No new class is created for it, because inventing one would duplicate a class the manifest already has.

### Authority effect

**None.** The floor gates *dispatch*, never *exposure*: an effect that passes row 2 still reserves and is still bound by `I3`. `MAL_total` is unchanged and no re-signature of the MAL basis is triggered.

---

## 2. MLT-01 and FHT-01 — the two degraded-mode timing thresholds

### Defect

`30 §5.1` item 5, verbatim:

> **Degradation.** Mirror lag above threshold raises `AUDIT_MIRROR_DEGRADED` at **CRITICAL** urgency, owner-visible immediately. Mirror unreachable beyond a longer threshold halts **all** classes including REVERSIBLE — the point at which the company stops.

`24 §3` K11 and `35 §12.1` repeat both in the same words. **Neither threshold had a declared numeric value anywhere in v1.3.2**, neither had a declared operand, and the second had no declared timer semantics — so *"unreachable beyond"* could not be evaluated even given a number. `51` declared `attestation_cadence`, `k`, the anchor interval, the signal `max_age` and every override quantity, and declared neither of these.

The consequence is recorded in `S1H-result.md`: the three-state machine and the five-row precedence do not depend on either threshold — `30 §5.6` enters `UNCORROBORATED_STALL` on an **observation**, not on a threshold — so **the FULL-HALT POSTURE is a fourth behaviour outside the three states and it was not implemented at all.**

**Provenance.** `S1H-owner-clarifications.md` S1H-C10, disposition *ARCHITECTURE ABSENT, leg NOT IMPLEMENTED*.

### Affected files

`deliverables/30-observability-audit-and-escalation.md` `§5.1` item 5, new `§5.1a` · `deliverables/51-limits-fixture.md` new `§3.8` · `deliverables/50-control-artifact-manifest.md` `§2` new class 27, `§1` and `§4` counts · `deliverables/35-failure-scenario-walkthroughs.md` `§12.1` · `deliverables/36-architecture-validation-plan.md` new `VC-A2g`, `VC-A2e`'s composition leg · `phase2-v1.3-invariant-registry.md` `§0` and `I63`'s operand block · `analysis/consistency-v1.3.py` conditions G5–G7

### Exact correction — MLT-01

> **`mirror_lag_critical_threshold` = 15 minutes (`PT15M`)**, declared in `51 §3.8`, provenance **OWNER DECISION / v1.3.3**.
>
> **Operand:** `mirror_lag = now() − min(occurred_at)` over the company's `effect_journal` rows whose `mirrored_at` is null; **control database clock** (`36 §6`).
>
> **Inclusive boundary:** `mirror_lag >= PT15M` is at or over the threshold. `14:59.999999` under, `15:00.000000` at, `15:00.000001` over, at `ACOS-JCS-1`'s 6-fractional-digit timestamp precision.
>
> **Kind:** escalation and state input **only**. It creates no state, fabricates no signal, grants no override and moves no monetary limit.

`mirrored_at` is advisory (`30 §5.2`), so this operand is control-derived and control-forgeable. That is admissible **in this direction only**, because the condition it raises is an escalation: a control plane understating its own lag suppresses an alarm rather than obtaining authority, and the unforgeable detector for the understated case is the audit plane's own attestation-absence check and `I17f(b)`. Recorded rather than glossed.

### Exact correction — FHT-01

> **`audit_unreachable_full_halt_threshold` = 30 minutes (`PT30M`)**, declared in `51 §3.8`, provenance **OWNER DECISION / v1.3.3**.
>
> **Operand and timer semantics.** The timer is the **open control-side `AUDIT_MIRROR_DEGRADED` declaration** `30 §5.7` already requires. `continuous_unreachability = now() − declaration.opened_at` for the open declaration, and `0` when none is open. **At most one declaration is open per company**, so the interval is single-valued. **The timer starts on declaration open and resets only on declaration close.** It is **not** reset by a state change between `UNCORROBORATED_STALL` and `CORROBORATED_DEGRADED`, by a signal arriving, expiring or being re-issued, or by a restart of either plane, because none of those closes a declaration. Control database clock; no elapsed interval is ever inferred from model input.
>
> **Inclusive boundary:** `continuous_unreachability >= PT30M` enters the posture. `29:59.999999` outside, `30:00.000000` inside.
>
> **`PT30M > PT15M`** is required by item 5's own *"a longer threshold"* and is asserted mechanically rather than assumed.

**The POSTURE, specified.** A **fourth behaviour over the three states, not a fourth state** — `30 §5.6` declares three and there is no fourth. It applies in **both** degraded states, `CORROBORATED_DEGRADED` included, because item 5 qualifies the halt by no state and because corroboration proves the stall rather than curing it. In the posture, item 4's ordered list is evaluated and every disposition is then reduced to **Halt**, for every class, REVERSIBLE included.

**The override composition, resolved from the architecture's own two sentences rather than assumed.** Item 5 says *"the only escape from **either the halt** or `UNCORROBORATED_STALL`'s row-3 suspension is a `DegradedModeOverride`"* — so the override does reach the halt — and, one sentence later, *"an override restores precedence rows **3 and 4 only**, never rows 1 or 2"*, with `51 §3.6` making `{3, 4}` structural. **Composed: rows 3 and 4 are restorable in the posture; rows 1, 2 and 5 are not.** Row 5's REVERSIBLE dispatch, which the posture is what halts, has no override path, because `precedence_rows` cannot hold `5`. This is determinate and no assumption was needed; it is recorded here because it is the one place the two sentences must be read together. **No override quantity moved.**

### Control-artifact and version effect

The two thresholds are **control artifact class 27**, new in v1.3.3, Owner + second factor, halt scope **all effects**. A first owner signature is owed. **They are a new class rather than an extension of class 25** because class 25's subject is the override *limit set* and its halt scope is *the grant of a new override* — the wrong scope for a quantity that governs every effect, and the manifest's `§3` property 4 makes halt scope per class deliberately. The manifest's counts move from *twenty-six rows for twenty-four signed classes* to **twenty-seven rows for twenty-five**, and `§4`'s second-factor tier reads `19–27`.

### Authority effect

**None.** Both thresholds only ever make dispatch **less** eligible. `MAL_total` is unchanged and no re-signature of the MAL basis is triggered.

### Relationship to attestation, stated because it is easy to conflate

`attestation_cadence` = 5 minutes and `k` = 3 give an existing **15-minute attestation-silence bound** (`30 §5.4`), and `I17f`'s own evaluation interval is separately declared at 15 minutes (`30 §5.10`). `mirror_lag_critical_threshold` is **aligned** with those deliberately, so a 15-minute stall detection is not fed into a slower degradation check. **The concepts are not merged.** Attestation staleness, mirror lag and audit-endpoint unreachability remain three distinct operands, owned by different planes, and none of them is the signal's `max_age`. **A timer alone does not create `CORROBORATED_DEGRADED`**; that state still requires a fresh, valid, audit-signed `MirrorInputStallSignal` and *"nothing else will do"*.

---

## 3. SWR-01 — `STORE_WRITE_REJECTED`'s derivation

### Defect

`30 §5.7.1` declares the signal's `reason` as `enum { ATTESTATION_STALL, PUSH_PATH_UNREACHABLE, STORE_WRITE_REJECTED }` and declares an issuance rule for the first two only. The third had none.

The one candidate reading is insert-quota saturation, and it is **explicitly forbidden as a mode transition** in two places:

- `30 §5.1` item 5: *"**Audit-store saturation is an incident, not a mode change (I17c).**"*
- `30 §5.6`'s reachability table: *"Audit insert quota saturated (`I17c`) | Yes | Yes | Yes | **Yes**, but `§5.1` item 5 declares saturation *an incident, not a mode change*."*

So the member was either dead, or — worse — a route by which a **refusal** could be converted into the architecture's only dispatch **relaxation**, arriving through the audit plane's own enum rather than through the control plane. An implementation that mapped a generic database failure into it would have made every `INSERT` failure a corroboration source.

**Provenance.** `S1H-owner-clarifications.md` S1H-C8, disposition *ARCHITECTURE ABSENT, leg reported PARTIAL*. The S1H implementation never returns the member and asserts that a saturated quota produces `AUDIT_QUOTA_SATURATED` and no signal.

### Affected files

`deliverables/30-observability-audit-and-escalation.md` new `§5.7.1a`, the `reason` enum annotation, `§5.6`'s reachability table (two rows) · `deliverables/36-architecture-validation-plan.md` new `VC-A2h` · `analysis/consistency-v1.3.py` conditions G8–G10

### Exact correction

The member is **kept** and given a closed, audit-owned, narrow derivation. `30 §5.7.1a` declares it in three parts.

**The predicate — ten conjuncts, all required, of one replication attempt:** it reached audit ingress; identity and authentication succeeded; the structured record is admissible; `ACOS-JCS-1` reconstruction succeeded; every transmitted / canonical / row-hash check required before storage succeeded; it is not a conflicting sequence collision; it is not an exact benign duplicate; insertion quota is available; the audit-store write was attempted; and that write could not commit because of a store-write availability failure. **Conditions 1–8 are the conditions under which the store would otherwise have accepted the row**, so the member names exactly one situation: an otherwise-valid, authenticated, in-quota row the audit storage layer could not durably accept.

**The semantic failure class — `AUDIT_STORE_WRITE_UNAVAILABLE`.** The architecture declares the **semantic** class; the storage implementation declares which of its **concrete** failures map into it, as a **closed enumeration**, documented, tested, and **fail-closed for every unknown or unenumerated storage error**. The architecture does not depend on and must not restate a vendor-specific error-code list, and no implementation may widen the class beyond the definition. Each mapped failure must be justified as a store-availability failure rather than a security, integrity or policy failure.

**The exclusions — normative, not advisory.** Audit insert-quota saturation · malformed payload · unsupported row kind · `ACOS-JCS-1` canonical mismatch · row-hash mismatch · predecessor / hash-chain mismatch · sequence collision · exact benign duplicate · invalid credentials · invalid signature · insufficient privilege or unauthorised principal · policy rejection · caller cancellation · a control-side timeout before audit ingress observed the attempt · a retryable serialization failure · a deadlock · any unknown or unclassified storage error. **Existing security and integrity incidents remain incidents and do not become a route to degraded-mode relaxation.**

> **AUDIT QUOTA SATURATION REMAINS INCIDENT-ONLY AND MUST NEVER CHANGE MIRROR MODE.**

### What the correction does not create

**No new state and no new relaxation.** A `STORE_WRITE_REJECTED` signal is an ordinary `MirrorInputStallSignal`: it enters the state machine only if genuinely signed by the audit key, fresh under `max_age`, bound to this company and held against an open control-side declaration. It confers exactly what `ATTESTATION_STALL` confers.

**And it is narrow, honestly.** The audit plane must be able to write its own interval and signal rows to publish anything, so the derivation is reachable only where the storage layer is unavailable for the **journal holdings** while the audit plane's own tables remain writable — a per-tablespace or per-relation write failure. Where the whole store is unavailable for writes, nothing is published and the answer is `UNCORROBORATED_STALL` plus the override. `§5.6`'s reachability table gains a row for each of the two cases.

### Control-artifact and version effect

**None.** `STORE_WRITE_REJECTED`'s derivation is audit-plane logic and is not a control artifact; the audit signing key remains class 24, unchanged. The concrete storage-error mapping is implementation-side and is covered by review and by `VC-A2h`, not by a manifest class.

---

## 4. What this pass deliberately did not do

- **It did not edit `docs/architecture/v1.3.2/`.** That directory is byte-identical to its state at issue, and `phase2-v1.3.3-verification.md` condition W1 asserts it.
- **It did not redesign the mirror state machine.** `30 §5.6`'s three states, three entry conditions and reachability semantics are unchanged; the table gains two rows describing cases it did not enumerate.
- **It did not redesign the override.** Every quantity in `51 §3.6` is unchanged and no grantable set was widened.
- **It did not touch `ACOS-JCS-1`.** Class 20's residual is carried, not discharged, and no canonicalisation rule moved.
- **It did not introduce dispatch, an outbox, an external claim, an adapter, vendor execution, reconciliation or `I36`.** Those remain scheduled outside this issue.
- **It did not claim a signing or `I19` mechanism exists.** Two signatures are owed and recorded as owed.
