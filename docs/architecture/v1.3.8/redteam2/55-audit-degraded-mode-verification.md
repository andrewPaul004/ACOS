# 55 — Audit Ordering and Degraded Mode Verification

**ACOS Operating Spine v1.1. Second red team. Issued 2026-09-03.**
Dedicated verification of R3: `30 §5`, `§5.1`, `§5.2` · `24 §3` K11 · `25 §12` · `33 §2.2`, `§3.2`, `§6` · `36 §6`, `§13` · `35 §12.1` · `22 §3.1` · ADR-013 · `49 §3.2`, `§3.6`, `§3.11`, `§3.12`. Findings registered in `53 §3`.

---

## 1. The trade-off is correct. Attack it anyway.

`22 §3.1` records the EM15↔EM16 conflict as a **selected trade-off** rather than a resolution, and the brief calls it the single most arguable decision in v1.1.

**I endorse the trade.** Dispatching a statutory-clock-bearing compensable effect against a locally committed, locally chained, gap-free journal row, rather than breaching an FTC 7-working-day deadline to protect a mirror, is the better of two bad options. The reasoning in `22 §3.1` is sound and its concessions are honest: halt moved the unaudited window rather than closing it, and the divergence it produced was indistinguishable from suppression.

**Is the trade correct, and if not, which invariant should be renegotiated?** The trade is correct and **neither invariant needs renegotiating** — but the boundary is in the wrong place by one row, and the table has no precedence rule, which matters more than the boundary.

- **IRRECOVERABLE is the right boundary.** What the mirror adds is unsuppressibility, and unsuppressibility matters most where no compensator exists. Moving the boundary to COMPENSABLE would reinstate the EM15 breach for the most common statutory case. Moving it to the approval floor makes an audit outage block approved refunds, which is the same breach with an extra step.
- **The defect is that the table's fifth row already does that**, and nothing says which row wins (AUD-10).

So the answer to the brief's question is: the trade is right, the table is wrong, and the fix is a precedence order rather than a renegotiation.

---

## 2. Ordering

`30 §5.1` item 3's protocol, evaluated boundary by boundary.

```
BEGIN
  (1) authorisation row
  (2) effect row (AUTHORISED)
  (3) reservation row
  (4) state transition
  (5) journal row (journal_seq, prev_hash, row_hash)
COMMIT
  (6) push to audit store (async, retried, quota-bounded)
  (7) dispatch, by recoverability class
```

| Kill point | Resulting state | Presents as | Verdict |
|---|---|---|---|
| Inside the transaction | Nothing committed | Nothing | **Sound.** This is why the single transaction is the right shape and why R18's finding that Temporal destroys it is correct |
| After COMMIT, before push | Local row *N*; audit lacks *N* | Sequence gap on the audit side, on the next diff | **Sound**, contingent on §3's diff being evaluable |
| During push, audit committed, ack lost | Audit holds *N*; `mirrored_at` null; retry re-pushes | **Duplicate `journal_seq`** → `I17`'s *"exactly one audit row"* fails → CRITICAL → halt by class → poisoned `row_count` anchor | **AUD-05. Ordinary crash produces a tamper signature** |
| After push acknowledged, before dispatch | Both sides hold *N*; effect status `AUTHORISED`; nothing dispatched | Non-terminal effect past SLA → `I9` escalation → reconciler resolves as a gateway-dispatched effect | **Sound** |
| During dispatch | `OUTCOME_UNKNOWN`; reservation held | `35 §4`'s path | **Sound**, and see LIM-04 for what the *resolution* of that state costs |

**Is any state ambiguous rather than presenting as a gap?** One: the duplicate-push case above, where the ambiguity runs in the dangerous direction — a benign retry is indistinguishable from an insertion attack on the same sequence value. Fixed by `UNIQUE (company_id, journal_seq)` with a hash comparison on conflict, so that *same seq, same hash* is a duplicate and *same seq, different hash* is tampering.

**Sequence allocation** is the unstated mechanism the whole scheme rests on (AUD-04). Postgres sequences are non-transactional and gap on rollback, so gap-freedom requires a per-company counter row locked inside the authorising transaction. That imposes a company-scoped serialisation point on the effect path, creates a DoS surface on the hot path, and introduces a lock-ordering requirement against the window balance row that no document states. `I17`'s *"a missing `journal_seq` has exactly one interpretation"* is true only if this is implemented one specific way.

---

## 3. Completeness

### 3.1 `I17` is not evaluable by its declared owner

`I17` is owned by **Audit** and states *"for every `journal_seq` in the control journal there exists exactly one audit row"*. `24 §3` K11 enumerates the audit plane's inputs exhaustively and **none of them is the control journal** — R10 removed the replica deliberately, on the correct grounds that reading the audited system's database is arithmetic rather than evidential independence.

So the audit plane can establish:

- gap-freedom **of the range it received** — detects mid-range omission;
- `row_hash` agreement for rows it holds — detects alteration in transit.

It cannot establish:

- **tail truncation.** Control journal at seq 1,000, push stops at 900: the audit side is gap-free, every hash matches, and `I17b`'s `row_count` reports 900 consistently with itself. The anchor bounds retroactive rewriting of held rows; it says nothing about rows never received. The brief asks for the residual in the amended version and this is it — `row_count` closed the *head-only* residual and not the *never-sent* one.

**Remediation.** A periodic control-plane **attestation carried as a journal row**: `{company_id, max_journal_seq, row_count, head_hash, attested_at}` occupying its own sequence value, pushed on the same path. Then a stopped writer is a sequence gap rather than a silence, and truncation contradicts the last attestation the audit plane holds. Attestation cadence must be shorter than the anchor interval. New invariant `I17e` for attestation continuity; `I17` restated as *"gap-free and consistent with the latest received attestation"*.

### 3.2 Defeating the diff, given §3.1's remediation

With attestation in place, omission requires the control plane to omit **from both sides** — dispatch an effect and write no local journal row. Then:

- the chain is intact;
- the diff agrees;
- the anchor agrees;
- **B8 is violated and nothing internal detects it.**

The only detector is `I8`'s inverse sweep from the audit plane's own vendor reads, whose limits `README` states: it cannot audit what never touched a vendor, and its silence is indistinguishable from correctness. This is not a new finding — the registry's §3 items 1 and 2 concede it — but `30 §5`'s row heading is *"Completeness"* and `36 §1` lists the property as testable without qualification (AUD-09). The honest restatement is **transport completeness**, with the unqualified claim relocated to `I8` and its coverage limits attached at every citation.

### 3.3 Can audit lag be hidden?

**Yes, and this is the finding that most changes the picture (AUD-02).** `25 §13` lists the audit-mirror lag check among **control-plane scheduled triggers**; the push, the `mirrored_at` column and the degraded-mode flag are all control-plane state. From the audit side, "provider outage" and "writer declining to push" are the same observation, and the audit plane's hourly anchor continues to publish the same internally consistent tuple in both cases.

So the mode that relaxes the audit guarantee is **entered on the word of the component the guarantee protects against**, and the same component classifies each effect into the row of the halt table that determines its treatment. A compromised control plane declares degradation, marks its compensable effects clock-bearing (AUD-06), and dispatches with only a local chain — the exact case `22 §3.1` names as unauditable.

§3.1's attestation closes the detection half. The remaining half requires that degraded mode be **corroborated**: the audit plane publishes `MIRROR_INPUT_STALL` through its own read endpoint, and `30 §3` V7's client-side diff shows both declarations. Any effect dispatched under degradation is tagged `DISPATCHED_UNMIRRORED` so `I8`'s next sweep has a specific set to reconcile rather than a period to search.

---

## 4. Hash-chain semantics

| Property | Verdict |
|---|---|
| Non-alteration of held rows under an `INSERT`-only principal | **Sound**, and `I17d`'s role separation is the right mechanism. A trigger function fires regardless of the caller's `EXECUTE` privilege, and `ALTER TABLE ... DISABLE TRIGGER` requires ownership, so an `INSERT`-only principal cannot bypass it |
| Independent recomputation on the audit side (`I41`) | **Not achievable as specified.** The canonical form is undefined and Postgres `jsonb` does not preserve key order or numeric representation, so two independent triggers over the same logical row can produce different bytes — and, in the other direction, two logically different rows can canonicalise identically (AUD-03) |
| Completeness | Not a chain property; `30 §5.2` says so correctly |
| Bound on retroactive rewrite | One hour, stated. Correct and honest |

**AUD-03 is the operationally likely failure.** Benign byte divergence produces continuous `I41` critical incidents on ordinary traffic, and the response to a continuously-firing critical is to widen or disable it. The fix is to define the canonical byte string (fixed field order, RFC 8785-style canonicalisation for structured fields, fixed numeric scale, UTC at fixed precision), **transmit that byte string**, and hash the transmitted bytes on both sides rather than re-serialising from `jsonb`. The canonicalisation specification becomes a control artifact under B9, because changing it silently reinterprets every historical hash.

---

## 5. Anchoring

| Question | Answer |
|---|---|
| Is one hour the right number? | **Defensible.** Under joint control-plane and audit-plane compromise it bounds erasure to one hour of effects; under single-sided compromise the two-sided diff detects it regardless of the interval. The interval's value is therefore about the joint case, which is `49`'s residual, and one hour against MVP volumes is a small number of effects. Shortening it buys little; lengthening it buys nothing |
| What does a compromised DDL principal achieve inside one hour? | Rewrite or erase audit rows inserted since the last anchor and publish a consistent successor anchor. The **control side still holds them**, so the diff detects it — unless the control plane is also compromised, which is `49 §3.11`/`§3.12`'s stated residual. Correctly disclosed |
| Is the medium adequate? | **Unassessable — it is not named** (AUD-08). "A medium the operator cannot rewrite" is a property of a specific medium. Name the candidates and the selection before S6 |
| Is the owner's copy independent? | **No.** It is delivered by a notification path the control plane operates, so a compromised control plane suppresses the copy while the anchor itself is fine. Deliver from the audit plane's own egress |

---

## 6. Recoverability classes and the halt table

### 6.1 Misclassification lands an action on the wrong row

The brief asks for this. The table keys on the action catalogue's `recoverability`, assigned per class and *"never by a model"* (`26 §5`) — so misclassification is a catalogue defect, not a runtime attack, and the catalogue is a control artifact under B9 with a manifest hash (`I19`). That path is closed.

**The open path is the clock-bearing attribute**, which is not a catalogue property. It is per-case state derived, for the FTC refund clock, from a triage classification (AUD-06). A compromised triage worker moves the whole compensable-discretionary class from *suspend* to *dispatch* during degradation. Loss is bounded at `MAL_monetary(month)`; auditability is not. The fix is that a clock must reference a RECORD-grade external artifact — a processor dispute webhook, a retained raw inbound message with its content hash, or an owner action — via a not-null `clock.source_record_ref`.

### 6.2 Two rows match one effect (AUD-10)

A $30 refund inside a live FTC clock, above the per-action autonomous floor, matches *"COMPENSABLE inside a live statutory clock — dispatch"* and *"anything above the per-action approval floor — halt"*. No precedence statement exists in `30 §5.1`, `24 §3` K11, `36 §6`, `22 §3.1` or `35 §12.1`, and `35 §12.1` walks precisely this scenario while assuming the first row wins.

**This is AUDA-01's defect signature reproduced inside the remediation written to remove it** — two behaviours for one condition, in documents of equal standing, with no supersession note. It is the highest-value R3 finding after AUD-01 because it lands on the case the trade-off exists to serve.

Recommended precedence, ordered:

1. IRRECOVERABLE → **halt**
2. Above the approval floor **and not clock-bearing** → **halt**
3. Clock-bearing, any class except IRRECOVERABLE → **dispatch**, tagged `DISPATCHED_UNMIRRORED`
4. COMPENSABLE discretionary → **suspend**
5. REVERSIBLE → **dispatch**

And a stated rule for resumed approvals: an effect carrying a recorded approval is evaluated at row 3 or 5, not at row 2, because the approval floor's purpose is already satisfied.

### 6.3 Statutory-clock interaction, summarised

| Scenario | Behaviour | Verdict |
|---|---|---|
| Mirror delayed but reachable | Dispatch normally; lag metric rising | Sound |
| Mirror briefly unavailable | Split halt as tabled | Sound, subject to AUD-10 |
| Mirror unavailable through a statutory deadline | Clock-bearing compensable dispatches | **Correct, and the reason the trade is right** |
| Control journal commits, mirror does not | Local chain durable; gap detectable | Sound, subject to AUD-01 |
| Mirror acknowledges, dispatch dies | `OUTCOME_UNKNOWN`; reconciler resolves under the original authorisation | Sound |
| Irreversible action during degradation | Halt | Sound. This is the boundary and it is in the right place |
| Compensable statutory action during degradation | Dispatch | Sound; the classification is attackable (AUD-06) |
| Audit recovers with a sequence gap | Single interpretation → `AUDIT_COMPLETENESS_GAP` | Sound, subject to AUD-05's duplicate case |
| External anchor delayed or missing | Missing anchor is an incident; mismatched is critical | Sound; the medium is unnamed |

---

## 7. Operator override as an escape hatch

`30 §5.1` item 5: prolonged unreachability halts all classes *"with an owner override recorded as a decision"*.

**Manufacture the conditions:** AUD-02 — the control plane declares unreachability and nothing external contradicts it.
**Manufacture the pressure:** the owner sees a total company halt with statutory clocks running and real customers waiting. `README` already names approval fatigue as the failure mode most likely to actually occur.
**Result:** one owner action unlocks IRRECOVERABLE — the class the boundary was placed at — with no declared scope, no expiry and no cap (AUD-07).

**Remediation.** The override is per recoverability class, time-boxed to a declared maximum duration, and count-capped to a declared maximum number of effects, auto-expiring to halt. Every effect dispatched under it is tagged and the tag set is a mandatory input to `I8`'s next sweep. A second override within a declared interval requires a distinct approver. This keeps the escape hatch — which the company needs — and stops it being a mode change.

---

## 8. Does a locally committed, locally chained, gap-free journal row satisfy EM16's purpose, or only its letter?

**Its purpose, under two conditions, and only its letter without them.**

EM16's purpose is that no effect escapes the record and that the audited system cannot suppress it. A local row satisfies the first unconditionally. It satisfies the second only if:

1. **the stopped-writer case is positively detectable** — which requires §3.1's attestation, without which the audited system suppresses by declining to push and calling it an outage; and
2. **the local chain is independently recomputable** — which requires §4's canonical form, without which `I41`'s mirror side cannot verify anything and the local chain is self-attested.

With both, the answer is yes and the trade-off is coherent. Without them, the design has the letter — a committed row, a chain, a sequence — and the property it exists to deliver is held by the party it protects against. That is why AUD-01 and AUD-02 are the two items in `52 §4` requiring a third review pass, and why the remaining R3 findings do not.
