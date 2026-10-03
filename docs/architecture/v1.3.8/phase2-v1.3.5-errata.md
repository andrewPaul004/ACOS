# ACOS Operating Spine v1.3.5 — Normative Errata

**Phase 2.5e. Issued 2026-09-09. Two architecture defects resolved, three declarations made, and one implementation sequence corrected, applied to Operating Spine v1.3.**

This is not an architecture phase, a red-team pass, a redesign or an implementation. **No new mechanism was introduced, no authority ceiling was changed, MAL was not changed, no Step ordering was changed, no audit cadence was changed, and the selected architecture (Option A) was not changed.** Six items are recorded below. All six were found during S1J implementation; two are genuine architecture defects that the implementation reported and refused to route around, and four are declarations or re-sequencings of load-bearing points the artifacts left open.

**Versioning convention, as v1.3.1 established it and v1.3.2, v1.3.3 and v1.3.4 followed it.** The numbered deliverables continue to declare `Operating Spine v1.3` in their version lines, because the *architecture* is v1.3 and unchanged. `v1.3.5` names the **issue** of the package. **`docs/architecture/v1.3.4/` is not modified by this pass** and remains on disk as the previous issue, byte for byte; `v1.3.1`, `v1.3.2` and `v1.3.3` likewise. Every prior errata and verification document is carried forward unmodified as history.

**What this pass changes about control artifacts.** **Two signature obligations are extended and none is discharged.** **Class 20**, whose signed content is *"column order per row kind"*, gains a declared order for `acos.journal.dispatch_outcome.v1` — the **third** time that obligation has grown, and it has been owed since v1.3.2. **Class 17**, the named exposure windows, gains `51 §2.3`'s per-action-class `irrecoverable_units` table, because a unit count is an authority quantity. **Classes 3 and 27 remain owed from v1.3.3, unchanged.** No production owner-signing mechanism and no runtime `I19` verification exist in the accepted implementation, and nothing in this pass claims otherwise. **No new control-artifact class is created.**

**What this pass does NOT do.** It enables no real external call. There is no adapter, no HTTP client, no vendor SDK, no credential, no provider sandbox, no provider query, no delivery-event webhook and no reconciliation in it. The provider-evidenced half of the irrecoverable-unit lifecycle — `presumed → realised` at `VERIFIED`, and the presumed release at a proven `NEVER_SENT` — is **declared so the lifecycle is complete and is deliberately left unbuilt**. **`I20` remains OPEN, `I36`'s verification leg remains OPEN, and the pre-live gate remains mandatory.**

---

## Summary

| # | Defect | Behaviour changed | Authority quantities changed |
|---|---|---|---|
| **MIE-01** | *"Consume the irrecoverable unit"* was stated in **four** places — `25 §10` row 2, `24 §3` K4, `34` ADR-026 item 3, `35 §12.3` — always as one inseparable act with the `PRESUMED_EXECUTED` transition, and **none of the four said what the movement is**. `24 §3` K5 declared three irrecoverable terms and **no transition between them**; the invariant registry bound `I3`'s term 3 to `PRESUMED_SETTLED`, which is `I32`'s *money* override state; `I20` bounded against *"reserved"* units with a test column wanting a window *"including a `PRESUMED_EXECUTED` row"*, which reads as the reserved term surviving the consumption; and `26 §7` step R's prose reserved into `I3` term 1 while its flowchart node said *"money · irrecoverable-count"*. **And no artifact declared any reservation of an irrecoverable unit at all, so there was no unit to consume** | **Yes.** An authorised IRRECOVERABLE effect **reserves** its catalogue-declared `irrecoverable_units` at local authorisation, on **every** applicable MIE window instance. `PRESUMED_EXECUTED` moves them **`reserved → presumed`**, exactly once, atomically, **leaving the three-term sum unchanged so no headroom is created**. Provider evidence later moves `presumed → realised` or releases | **NO CHANGE.** Every IRRECOVERABLE class declares `1`, which is the figure `51 §2.2`'s count sub-ceilings and `51 §4`'s `MIE_cost` already assume. `recompute-v1.3.py` reproduces line for line |
| **SER-01** | `25 §14` required one advisory lock *"for the duration of the propose→authorise→**execute** span"*, and `24 §3` K4 and `26 §7` C′ both read state *"under the existing entity advisory lock"*. **That span is not achievable across `25 §7`'s own asynchronous outbox.** The lease that can span propose→authorise is session-scoped — a transaction-scoped lock is released by `COMMIT` and cannot outlive step R, and step S may wait on a human for hours — and a session lock lives in one process's connection. The outbox exists precisely so a row may be claimed later, after a restart, by a different worker. **No mechanism hands a live session lock across that gap** | **Yes.** Superseded by **two serialization epochs**: an **authority lease** held continuously C′→authorising COMMIT, an **explicitly lock-free asynchronous gap**, and a **dispatch lease** — a new session, never called the same lease — held continuously across **dispatch-time revalidation → claim → COMMIT → adapter → outcome → COMMIT**. **Dispatch-time revalidation of the originally authorised effect is mandatory and precedes the claim** | **NO CHANGE.** The protocol decides *when* a decision may be acted on; it reserves nothing and denies no quantity |
| **OBX-04** | `24 §3` K4 declared *"On adapter failure, bounded retry with jitter against the same idempotency key"*, and `25 §5`'s lifecycle had **no edge out of `EXECUTING` for a known failure and no effect state for one**. **The declared retry contradicted `25 §7`'s OBX-01 outright**: a retry against the same idempotency key needs a second dispatch of a row that is `CLAIMED`, and OBX-01 admits *"no transition out of `CLAIMED`, and no second transition into it"*. The conflict was latent while nothing dispatched | **No — declared, and K4 corrected.** A closed four-member taxonomy; retry is scoped to workflow and internal failures **before** an external-effect claim; **a claimed external-effect identity is never retried or re-dispatched, on any outcome.** `ADAPTER_RETURNED` on an IRRECOVERABLE effect reaches `PRESUMED_EXECUTED` rather than an awaiting-verification state | **NO CHANGE** |
| **OBX-05** | There was no state for a failure a trusted adapter *knows* did not leave the process, and `35 §4`'s own rule — *"conflating 'failed' with 'unknown' is what produces double execution"* — has a mirror image the artifacts did not name: labelling a possible escape as a confirmed non-send would release a commitment for an effect that happened | **No — declared.** **`NOT_SENT_CONFIRMED`**, admissible only on positive trusted-adapter proof from control flow or typed provider semantics and **never from an error-message string**, reaching the terminal **`DISPATCH_NOT_SENT_CONFIRMED`** and releasing the commitment atomically. **Semantically distinct from the later provider-reconciled `NEVER_SENT`.** Anything that may have escaped is `OUTCOME_UNKNOWN` | **NO CHANGE** |
| **JCS-03** | `30 §5.3a` (v1.3.4, JCS-02) declared a field order for `acos.journal.outbox_claimed.v1` and said *"a row kind in service without a declared order here is a defect of this class"*. S1J puts a second kind in service | **No — declared.** `30 §5.3a` declares `acos.journal.dispatch_outcome.v1`'s twenty fields, with the independence and insertion-order obligations, and names fields 15/16 as the adjacent same-typed pair a seeded swap must fail on | **NO CHANGE** |
| **SEQ-02** | v1.3.4's SEQ-01 assigned *"the unknown-outcome runtime transition and `PRESUMED_EXECUTED`"* and *"MIE consumption at the execution/outcome point"* to the later vendor slice as **one undivided item each**. Both have a **local half needing no vendor** and a **resolution half needing one**, and the local half is a **precondition** for enabling any real send | **No — re-sequenced.** The adapter port, step R's unit reservation, the outcome taxonomy, the `reserved → presumed` movement, `NOT_SENT_CONFIRMED`, the two-epoch protocol and the new journal row kind land at **S1** against a deterministic in-process mock. The provider query, webhook, reconciliation, `VERIFIED` and `NEVER_SENT` stay **later** | **NO CHANGE** |

**Authority quantities, restated and reverified.** `MAL_monetary(month)` = **$300.00**. `Standing(month)` = **$182.40 / $186.00**. `MIE_cost(month)` p95 = **$270.00**. `MAL_total(month)` at the signature basis = **$756.00**. `refund.create`'s `per_action_max` = **$25.00**. `degraded_per_action_approval_floor_monetary` = **$20.00**. `mirror_lag_critical_threshold` = **PT15M**; `audit_unreachable_full_halt_threshold` = **PT30M**. Every `51 §3.6` override quantity unchanged. `attestation_cadence` = 5 minutes, `k` = 3, anchor interval = 60 minutes, signal `max_age` = 5 minutes — all unchanged. **`analysis/recompute-v1.3.py` reproduces `analysis/recompute-v1.3-output.txt` line for line after this pass. No owner re-signature of the MAL basis is required.**

---

## 1. MIE-01 — the irrecoverable-unit lifecycle is declared

### Defect

Four artifacts stated the consumption as one inseparable act with the state transition. `25 §10` row 2, verbatim:

> | IRRECOVERABLE (send, post, reship) | **Assume it happened. Never re-dispatch.** Mark `PRESUMED_EXECUTED`, **consume the irrecoverable unit**, and resolve later from the provider's delivery event matched on the correlation tag. |

`24 §3` K4, `34` ADR-026 item 3 and `35 §12.3` print the same sentence. **None of the four says what the movement is**, and five further facts pulled in different directions:

- `24 §3` K5 — *"the single authoritative schema specification for `window_balance`"* — gave the irrecoverable ledger **three terms and no transitions**;
- the invariant registry bound `I3`'s **term 3** to the **`PRESUMED_SETTLED`** state, which is `I32`'s liquidity-override state for a **MONEY** reservation (`26 §10.3`) and not `PRESUMED_EXECUTED`, so moving `presumed_irrecoverable` would put a second, undeclared producer into that term;
- `I20` bounded provider-accepted messages against *"Σ **reserved** irrecoverable units"*, with a test column wanting a window *"including a `PRESUMED_EXECUTED` row"* — which reads as the reserved term **surviving** the consumption, and would make `I20`'s bound *tighten* as presumptions accumulated;
- `26 §7` step R's **prose** reserved into `I3` **term 1** while its **flowchart** node reserved *"money · irrecoverable-count"*, and `51 §2` gave the MIE windows **both** a `max_count` and a `max_irrecoverable_units` at the same figures (13 and 43), so which ledger held `MIE_discretionary` headroom was undecided;
- **and no artifact declared a reservation of an irrecoverable unit anywhere.** `reserved_irrecoverable` had no declared contributor, so under any reading that decremented it the consumption would drive a non-negative term negative.

**A requirement stated four times had no declared subject.** That is an architecture incompleteness, not a transcription slip, and the S1J implementation returned PARTIAL rather than inventing a counter.

### The declaration

`25 §10.1` is new and carries the lifecycle; `24 §3` K5 prints the transition table; `26 §7` step R carries the reservation; `51 §2.3` declares the unit counts; `I67` and `I68` are new invariants.

**Every authorised IRRECOVERABLE external effect reserves its irrecoverable units before execution**, at local authorisation, in step R's transaction, against **every applicable MIE window instance the effect's authority and grants reference** — not the first, not a primary, not the most permissive. The five declared movements are:

| Transition | Movement | Three-term sum |
|---|---|---|
| **RESERVE**, at local authorisation | `reserved += units` | rises |
| **PRESUME**, at `PRESUMED_EXECUTED` | `reserved -= units`, `presumed += units` | **unchanged** |
| **REALISE**, at provider-evidenced `VERIFIED` | `presumed -= units`, `realised += units` | unchanged |
| **RELEASE**, at `DISPATCH_NOT_SENT_CONFIRMED` | `reserved -= units` | falls |
| **RELEASE**, at provider-proven `NEVER_SENT` | `presumed -= units` | falls |

**"Consume the irrecoverable unit" is the PRESUME row and nothing else.** It is performed **exactly once** per outbox identity, in one serializable transaction with the effect state, the outbox outcome state, the outcome journal row and the claim/outcome evidence. **The sum does not fall, so an unknown outcome creates no headroom**, and the unit does **not** move directly to `realised` because a presumption is not a realisation.

### The three sub-decisions the defect required, and how each is resolved

**(a) Which ledger holds `MIE_discretionary` headroom.** **Ledger 3.** Both ceilings bind and they bind different quantities: `max_count` with `51 §2.2`'s per-class sub-ceilings is the effect count every governed action moves, and `max_irrecoverable_units` is the ceiling this lifecycle runs against. An IRRECOVERABLE effect moves both ledgers; a REVERSIBLE or COMPENSABLE effect moves the count ledger only.

**(b) `I3`'s term 3.** It has **exactly one producer per ledger, and they do not interact.** `presumed_monetary` ← `PRESUMED_SETTLED`; `presumed_irrecoverable` ← `PRESUMED_EXECUTED`. **No transition writes both**, and neither state is reachable for the other's ledger. The registry's operand row is corrected accordingly. No fourth term is declared.

**(c) `I20`'s basis.** The **immutable historical authorisation basis** — the set of legitimately committed irrecoverable reservation units evidenced by the committed reservation, effect and window rows — and **not** the current value of `reserved_irrecoverable`. The reason is mechanical: PRESUME and REALISE move units out of that column while leaving the commitment unchanged, so a bound written against the live column tightens as presumptions accumulate and **inverts the invariant's own direction**.

### `irrecoverable_units` is catalogue-owned

`51 §2.3` declares it per action class — **`1` for every current IRRECOVERABLE class, `0` for every REVERSIBLE and COMPENSABLE class.** It is a property of the class in exactly the sense `26 §5`'s recoverability is: *"Assigned per action class in the catalogue, not per request, and never by a model."* **There is no generic caller parameter and no request field carries one.** A class needing another value declares it, and **no implicit default may widen authority** — a catalogued class with no declared value is a catalogue-validation failure, not a class with a value of one. The table is signed control-artifact class 17 content, because a unit count is an authority quantity.

---

## 2. SER-01 — two serialization epochs, and mandatory dispatch revalidation

### Defect

`25 §14`'s concurrency table, verbatim as issued:

> | Two work items touching the same entity | Advisory lock on `(company_id, entity_type, entity_id)` **for the duration of the propose→authorise→execute span.** Second item waits or defers; it does not proceed on stale state. |

The lease **must** be session-scoped: a transaction-scoped advisory lock is released by `COMMIT`, so it is structurally incapable of spanning a span whose step S may wait on a human for hours. **And a session-scoped lock lives in one process's connection.** `25 §7`'s outbox exists precisely so authorisation and dispatch can be separated in time and in process — a row is enqueued and claimed later, possibly after a restart, possibly by a different worker. **No mechanism hands a live session-scoped advisory lock across that gap**, and a later reacquisition is not the same lease.

**The two accepted declarations are incompatible as written**, and this is the report S1J was required to make rather than route around. What made it measurable is that S1J is the first slice in which "execute" exists at all.

### The replacement, and why it is not a weakening

The property the span existed to provide is `25 §14`'s own: *"it does not proceed on stale state."* `25 §14.1` preserves it by holding the lease continuously across **each interval in which a decision is made and acted on**, and by **revalidating the authorised effect at the start of the second interval** — rather than by pretending the first interval never ended.

**Epoch A, the authority lease.** Unchanged accepted behaviour: one session-scoped lease held continuously across C′ → pre-reservation authority → local authorisation → COMMIT, with no release or reacquisition inside it. **No entity mutation can intervene between C′ and the authorising COMMIT.** This is what S1C, S1E and S1F already prove.

**The gap.** **No database session lock is held, and that is an explicit architecture property rather than a missing lock.** Safety derives from five mechanisms, each independently stated elsewhere: the immutable canonical effect; the immutable persisted dispatch payload, bound to the authorised hash and never rebuilt; content-addressed option identity; non-reclaimable outbox semantics; and mandatory dispatch-time revalidation before claim.

**Epoch B, the dispatch lease.** The **same entity advisory-lock key**, reacquired — **in a new PostgreSQL session, because execution is asynchronous.** It is called the **dispatch lease** and **no artifact and no implementation may describe it as the same lease as Epoch A's.** It is held continuously across **dispatch-time revalidation → claim-time authority evaluation → CLAIM → CLAIM COMMIT → adapter invocation → outcome transaction → OUTCOME COMMIT**, released only afterwards, with no release or reacquisition inside the epoch. **No ACOS-authorised entity mutation can intervene between dispatch revalidation and the attempted external effect, or between the external effect and its recorded outcome.**

### Dispatch-time revalidation

**Mandatory, and a claim may not occur before it.** Under the dispatch lease and before the claim, the **originally authorised effect** is revalidated against **current authoritative resource state**, using the original `action_class`, resource identity, enumeration/option identity and constructor/version identity. It is the **equivalent of step C′'s content-addressed non-substitution check performed one epoch later**, and `I53` is the invariant it discharges at the dispatch boundary.

**The question is only whether the originally authorised effect is still a valid current effect.** **No new payload is constructed, no different option is substituted, and the persisted payload remains the exact authorised payload.** If the authorised option or effect is no longer valid the **claim is refused**: nothing is dispatched, nothing is substituted, **the economic reservation remains held** pending the cancellation and expiry paths declared elsewhere — leaving it held is the safe direction and **no release semantics are invented at this boundary** — and the model-facing denial is coarse under `26 §2.2`'s probing rule.

### VC-C3 is restated, not weakened

`36 §2.3`'s VC-C3 in v1.3.4 was **entirely about content-addressed selectors** and is unchanged as `VC-C3(a)`, with its reordering fixture retained. What is added is `VC-C3(b)`, which states the guarantee in three separable parts — the authority epoch's exclusion, the dispatch epoch's exclusion, and no stale or substituted effect across the gap — and says plainly that **the old one-continuous-session wording is not the guarantee and is not to be asserted by any implementation.** `VC-C3(c)` carries the MIE lifecycle's atomicity and its five must-fail seeds.

### Crash inside Epoch B is not a recovery path

A process lost after the `CLAIM` COMMIT releases the dispatch lease **by the database** — but the row remains `CLAIMED`, the fresh claim capability is gone, and **no restart may acquire a dispatch lease for the purpose of redispatching that row.** The same holds for a loss after the adapter and before the outcome. **Reacquiring the dispatch lease is not a recovery mechanism**, and OBX-01's no-reclaim rule is unaffected by the lease's lifetime. **`I9`'s detection of an orphan `CLAIMED` row is unchanged, and no elapsed time converts it to anything.**

---

## 3. OBX-04 — the adapter outcome taxonomy is closed, and K4's retry is corrected

`25 §7.1` declares four typed outcomes and their recoverability-keyed local states. The correction with the widest reach is that **`24 §3` K4's *"bounded retry with jitter against the same idempotency key"* is scoped to retryable workflow and internal failures occurring BEFORE an external-effect claim.** **Once a row is `CLAIMED`, the same outbox identity is never retried or redispatched, on any outcome.** `25 §9`'s retry budget, `25 §11`'s dead-letter and K4's Incident all remain, and none of them re-claims.

`ADAPTER_FAILED` is retained in the taxonomy **for diagnostics only and carries no local outcome policy and reaches no local state**, because a failure the adapter cannot classify as confirmed-not-sent is a failure whose request may have escaped.

**The recoverability qualification on `ADAPTER_RETURNED` is the second correction.** v1.3.4 applied one unqualified answer to all three classes. An adapter outcome indicating the request was accepted is **at least as strong as the unknown case for duplicate-prevention purposes**, and `25 §10`'s reason for assuming execution applies more forcefully when the adapter believes the call succeeded. So **IRRECOVERABLE reaches `PRESUMED_EXECUTED`** and performs the `reserved → presumed` movement exactly once, on whichever of the two outcomes arrives; REVERSIBLE and COMPENSABLE keep `DISPATCHED_AWAITING_VERIFICATION`. **An adapter response is never independent verification**, and every state in the taxonomy still awaits the read-back `25 §5` describes.

---

## 4. OBX-05 — `NOT_SENT_CONFIRMED` and known-not-sent local state

`25 §7.2` declares it. **It may be returned only by a trusted adapter that can positively establish, from its own control flow or from typed provider semantics, that no external write crossed the transport boundary** — a failure raised before the request was opened or sent, or a provider rejection whose declared adapter contract guarantees no external mutation. **The classification may not be made from arbitrary error-message strings**, for the reason `30 §5.7` already gives about string-classified causes: a string is a vendor's prose, and an economic release decided by prose is a release decided by the vendor's changelog. **Anything for which the request may have escaped is `OUTCOME_UNKNOWN`.**

**The state is `DISPATCH_NOT_SENT_CONFIRMED` and is deliberately not `NEVER_SENT`.** The two are kept distinct because their evidence differs in kind: one is **immediate trusted-adapter proof at the dispatch attempt**, the other is **later independent provider reconciliation after a possible or presumed execution**. Conflating them would let one literal carry two evidentiary meanings, and `35 §4`'s own lesson about conflating states applies.

**The commitment is released in the same atomic outcome transaction** — money under existing semantics, `reserved_irrecoverable -= units` with no presumed and no realised increment for the irrecoverable ledger. **No presumed unit is touched**, because the outcome is admissible only before an uncertain or executed classification. **Nothing is released on `OUTCOME_UNKNOWN`.**

**The old outbox identity is terminal and non-reclaimable.** It may not return to `ENQUEUED`, become `READY`, enter a retry state or be claimed again. **A further attempt requires a new proposal, a new authorisation and a new effect/outbox identity** — the same safety model `25 §12.3` already uses for `NEVER_SENT`.

---

## 5. JCS-03 — `acos.journal.dispatch_outcome.v1`'s field order

`30 §5.3a` declares the twenty fields, in the position and with the obligations JCS-02 established: two independent transcriptions that may not read each other or a shared helper, no dependence on any map's insertion order, and a hand-authored third reading as oracle.

**Fields 15 and 16 — `dispatch_outcome_kind` and `dispatch_effect_status` — are adjacent, same-typed and semantically distinct**, and `36 §2.6`'s byte-identity fixture must fail on a seeded swap of exactly that pair. A membership check would pass such a swap, which is why the order is compared element-wise.

**No MIE quantity is a field of this row.** `25 §10.1`'s movement is evidenced by the committed `window_balance` and reservation rows under the guard; a movement recorded a second time in the chain would be a second place the accounting could disagree with itself. **The outcome row records the state that implies the movement; the ledger records the movement.**

**Control-artifact consequence, disclosed and not discharged.** Class 20's signed content is *"column order per row kind"*, so declaring an order for a kind that had none moves its `content_hash` — **for the third time.** Owed since v1.3.2, extended by v1.3.4, extended again here, and **not signed.**

---

## 6. SEQ-02 — the local execution semantics move to S1

v1.3.4's SEQ-01 argued that the durable outbox foundation is a **precondition** for the vendor half and re-sequenced it to S1 on that basis. **The same argument applies one level down to two of the items it left at S4.**

*"The unknown-outcome runtime transition and `PRESUMED_EXECUTED`"* and *"MIE consumption at the execution/outcome point"* each have a local half that needs no vendor and a resolution half that needs one. **An implementation that reserved no irrecoverable unit and had no declared consumption would have nothing for a provider's accepted count to be bounded against**, so the local half must exist before any real send can be enabled. `37 §2` therefore places at **S1**: the adapter port and gateway boundary with no adapter under production code; step R's unit reservation; the outcome taxonomy and its local states; the `reserved → presumed` movement with its kill-point matrix; `NOT_SENT_CONFIRMED` and its release; the two-epoch protocol with its async-gap and mutation-exclusion proofs; and the new journal row kind cross-implemented in both planes.

**The provider query, the delivery-event webhook, the reconciliation, `VERIFIED` and `NEVER_SENT` stay later**, together with `I36`'s six-kill-point verification against a real sandbox and `I20`.

**A mock's acceptance count is not a provider accepted count.** `I20`'s left-hand side is *"provider-reported accepted"* and it is the **audit plane's** own independent provider read. **No local quantity may be substituted for it** — not an outbox row count, not a claim count, not an outcome row count, and not the number of times an in-process mock reached its own acceptance point. **`I20` remains OPEN after S1**, and what S1 makes true is only that its right-hand side is structurally present.

---

## 7. What remains open after this pass

**Nothing in this pass discharges any of these, and nothing in it enables a real external call.**

| Item | Status |
|---|---|
| **`I20`** | **OPEN.** The ACOS-side denominator is structurally implemented; the provider-reported left-hand side requires the audit plane's own ESP read credential, which does not exist |
| **`I36` verification leg** | **OPEN.** The six kill points of `44 §5.2` against a **real ESP sandbox**, measured by the provider's own accepted count. The enforcement leg and the local composition are S1's |
| **Provider resolution** | **UNBUILT by declaration.** `25 §10.1`'s REALISE and never-sent RELEASE transitions are declared so the lifecycle is complete and are reached only from provider evidence |
| **`I8`** | **OPEN.** All classes run against mocks, so there is no vendor side for the inverse sweep to enumerate (v1.3, TA-02) |
| **Class 20 signature** | **OWED, and enlarged a third time.** Not discharged |
| **Class 17 signature** | **OWED, enlarged by `51 §2.3`.** Not discharged |
| **Class 3 signature** | **OWED from v1.3.3.** Unchanged |
| **Class 27 signature** | **OWED from v1.3.3.** Unchanged |
| **Runtime `I19`** | **OPEN.** No production owner-signing mechanism exists |
| **`O4`** | **OPEN** |
| **Production key management** | **OPEN** |
| **VAL-04** | **UNDISCHARGED.** Duplicate prevention at the dispatch boundary is a vendor property; a mock with a naive idempotency implementation passes where the vendor would not |

**The pre-live gate remains mandatory.**
