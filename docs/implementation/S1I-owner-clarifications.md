# S1I — Owner Clarifications

Package issue **v1.3.3** is authoritative. Baseline commit **`8ce0d41`**.

Every item below is a place where the S1I mandate names a load-bearing point and v1.3.3
does not declare it. `§51` of the mandate is the rule these follow:

> "Stop and return PARTIAL rather than guessing if v1.3.3 does not specify a required
> load-bearing point [...] Quote exact passages and observable implications. Do not write a
> convenient queue design and call it architecture."

Each item states the exact passages, what they do and do not settle, what S1I did, and what
the owner is being asked to confirm.

| Id | Subject | Disposition |
|---|---|---|
| **S1I-C1** | No declared binding from an effect to a `statutory_clock.case_ref` | **STOPPED — the row-3 claim-time leg is PARTIAL and fails closed** |
| **S1I-C2** | v1.3.3 names `CLAIMED` and no pre-claim state | **IMPLEMENTED under a declared name; owner confirmation requested** |
| **S1I-C3** | "the dispatching transaction" is undefined in a slice with no dispatcher | **IMPLEMENTED under the only sound reading; owner confirmation requested** |
| **S1I-C4** | No declared byte order for a record of the claim | **IMPLEMENTED as an implementation declaration, per the S1H precedent** |
| **S1I-C5** | The outbox is scoped to "irrecoverable sends" in three places | **WIDENED to every catalogue class; strictly stronger; owner confirmation requested** |
| **S1I-C6** | `30 §5.1` row 1 halts IRRECOVERABLE in `NORMAL` too, so the class ADR-026 is titled for cannot be claimed at S1 | **REPORTED as a finding; nothing invented** |
| **S1I-C7** | `37` schedules the outbox at S4 | **OWNER SEQUENCING DECISION, recorded** |

---

## S1I-C1 — v1.3.3 declares no binding from an effect to a `statutory_clock.case_ref`

**STATUS: STOPPED. The affected leg is reported PARTIAL and reads FAIL-CLOSED.**

### What row 3 needs

`30 §5.1` item 4 row 3, verbatim:

> | **3** | Clock-bearing (a live statutory clock citing a RECORD-grade fact, `§9.1`) and
> `recoverability == COMPENSABLE` | **Dispatch**, in `NORMAL` and `CORROBORATED_DEGRADED`
> only. Journal `DISPATCHED_UNMIRRORED` and raise it in V6. **In `UNCORROBORATED_STALL`,
> suspend** […] |

`30 §9.1` gives the clock's shape, verbatim:

> ```
> Clock { id, statute, case_ref, started_at, deadline_at,
>         source_record_ref }          // MANDATORY, RECORD grade
> ```

The accepted `isClockBearingOn` answers *"is there a live RECORD-backed clock for THIS
`case_ref`"*, which is the only question the schema can answer. **So the operand is keyed on
`case_ref`.**

### What is missing

**No artifact in v1.3.3 relates a `case_ref` to an effect, an authorisation, a
`resource_ref` or a `task_id`.** Checked: `30 §9.1`, `30 §5.1`, `26 §5`, `26 §2.1`'s
`AuthorizationRequest` field list, `24 §3` K10, `24 §4`'s ERD, `51`. `case_ref` is a free
`TEXT` identifier in `statutory_clock` and nothing in the package resolves one from an
effect.

### Why this is not cosmetic

`30 §9.1` states the security property itself:

> "`§5.1`'s precedence row 3 privileges clock-bearing COMPENSABLE effects over the mirror,
> so **the statutory clock is a lever on the audit plane** and its provenance is a security
> property rather than a compliance detail. […] Without this, a model that can cause a clock
> to exist can manufacture the row-3 exemption it wants."

A COMPENSABLE discretionary effect **suspends** at row 4. The same effect, declared
clock-bearing, **dispatches** at row 3 in `NORMAL` and `CORROBORATED_DEGRADED`. So a
claim-time `case_ref` chosen by a caller — or guessed by the kernel from `resource_ref` —
is the same lever `§9.1` closes, reached from the other end: a model that can make the
kernel look up the WRONG clock obtains the exemption without needing to create one.

S1H did not surface this because `classifyDispatchPrecedence` is pure and its tests hand it
the operand. **S1I is the first slice that has to derive it from state.**

### What S1I did

`src/kernel/outbox/claim.ts` exports `clockBearingAtClaim()`, which **takes no arguments and
returns `false`**. A parameter would be the escape hatch; a lookup on a guessed `case_ref`
would be the lever. Neither exists.

**Observable consequences, all asserted:**

* Row 3 is unreachable at claim time. A COMPENSABLE effect falls to row 4 and SUSPENDS
  unless an in-scope `DegradedModeOverride` restores it.
* Row 2 becomes reachable, because it requires `not clock-bearing`, and its HALT is
  asserted at `$20.01` against a non-match at `$20.00`.
* No relaxation is obtained that the architecture has not authorised. The failure direction
  is strictly toward refusal.

### What the owner is asked to decide

One of:

**(a)** Declare the binding. The natural candidates are a `case_ref` on the
`AuthorizationRequest` computed by the constructor from authoritative state, or a
`statutory_clock.resource_ref` FK. Either makes the operand derivable and row 3 reachable.

**(b)** Confirm that row 3 is intentionally unreachable until the case model exists, in
which case `S1I-result.md §9`'s PARTIAL becomes the settled position for S1.

---

## S1I-C2 — v1.3.3 names `CLAIMED` and declares no pre-claim state

**STATUS: IMPLEMENTED as `ENQUEUED`. The STRUCTURE is architecture; the IDENTIFIER is not.**

`25 §7`, verbatim: *"The row **transitions to** `CLAIMED` in a committed transaction before
the HTTP call."* ADR-026 decision item 2 uses the same words.

A transition has a prior state. The six places the outbox appears — `25 §7`, `34` ADR-026,
`24 §4`'s ERD, `33 §6`, `35 §4`, registry `I36` — declare **`CLAIMED` and nothing else**.

**What S1I treats as architecture:** one pre-claim state, one claimed state, exactly one
transition between them, and **no transition out of `CLAIMED`** (`25 §7`: "never
re-dispatched by any path"). All four are enforced by `dispatch_outbox_state_machine` in
`0010`.

**What S1I declared:** the identifier `ENQUEUED`. `§22` of the mandate forbids inventing
`RETRY_READY`, `EXPIRED_CLAIM`, `RECLAIMABLE` and `AUTO_RETRY`, and none exists — the status
domain is a two-value `CHECK`, read out of the running catalogue by
`outbox-immutability.test.ts`.

**Asked of the owner:** confirm `ENQUEUED`, or name the pre-claim state.

---

## S1I-C3 — "the dispatching transaction" is undefined in a slice with no dispatcher

**STATUS: IMPLEMENTED as the CLAIM transaction. The only sound reading, and it is proved.**

`30 §5.7.2` item 3, verbatim:

> "**Count-capped and monetary-capped.** `effects_dispatched` and `monetary_dispatched` are
> incremented in the **dispatching transaction**; reaching either cap moves the override to
> `EXHAUSTED` immediately."

`§31` of the mandate makes it conditional — *"If claim consumes one override effect-count
unit, perform that consumption atomically with the outbox CLAIM"* — and `§51` lists
*"whether override count is consumed at claim or later"* as a stop condition.

**The reading is forced, not chosen.** The claim is IRREVERSIBLE: no path returns a
`CLAIMED` row to `ENQUEUED`, so after the claim commits the effect *will* be handed to
whatever builds transport. If the counter were incremented later, N rows could each be
claimed against a cap of one and `I63(a)`'s cap would bound nothing. There is also exactly
one committed transaction before the hypothetical HTTP call, and `25 §7` says the claim is
it.

**And the ACCEPTED S1H code already reads it this way.** `claimOverrideAllowanceOn`'s own
comment: *"This function increments `effects_dispatched` and `monetary_dispatched`, which is
`30 §5.7.2` item 3's 'incremented in the dispatching transaction' — the transaction that
WOULD dispatch, in a slice that has no dispatcher."* S1I **composes that accepted function
into the claim** rather than reimplementing a counter.

**Proof:** `override-backed-claim-race.test.ts` races two distinct outbox rows for one
remaining allowance against real PostgreSQL and asserts exactly one claim, `effects_dispatched
= 1` and `status = EXHAUSTED`; the negative control `unsafe-non-atomic-override-claim.ts`
issues two under the same interleaving.

**Asked of the owner:** confirm that the claim transaction is `§5.7.2` item 3's dispatching
transaction, or name a later one — noting that a later one admits N+1.

---

## S1I-C4 — no declared byte order for a record of the claim

**STATUS: IMPLEMENTED as an implementation declaration, exactly as S1H's three kinds were.**

`23 §6` B8 requires that no effect reach the outside without a committed record, and the
claim is the last local record before one could. `30 §5.3` requires a hashed row's field
order to be *"declared per row kind, **in the specification**"* — and v1.3.3 declares no
order for a claim record, because it declares no claim record.

This is the same gap `S1H-C9` recorded for `AUDIT_MIRROR_DEGRADED`,
`MIRROR_CORROBORATION_CONSUMED` and `DEGRADED_MODE_OVERRIDE_EVENT`, and it is resolved the
same way: the order is **declared in `S1I-contract.md §5`**, implemented independently on
both planes (`0010` and `A0005`), and judged by BOTH against a hand-authored fourth reading
in `tests/support/jcs1Oracle.ts`.

**CONTROL-ARTIFACT CONSEQUENCE, DISCLOSED.** `50 §2` class 20 is the *"Journal
canonicalisation specification — `ACOS-JCS-1`: column order per row kind"*. A new row kind
adds a column order and therefore **moves class 20's `content_hash`**. That signature was
already owed at v1.3.2 and is still owed; S1I extends the same obligation and claims nothing
signed. `S1I-result.md §18` carries it.

**Asked of the owner:** confirm the declared order, and note the class-20 signature
obligation now covers one further row kind.

---

## S1I-C5 — the outbox is scoped to "irrecoverable sends" in three places

**STATUS: WIDENED to every catalogue class. Strictly stronger. Confirmation requested.**

Three passages scope it narrowly:

* `24 §4` ERD: `EFFECT ||--o| OUTBOX_ROW : "claims (irrecoverable sends)"`
* `33 §6`: *"the **outbox claim** for irrecoverable sends (I36, v1.1)"*
* `35 §4` item 3: *"**Outbox claim** for irrecoverable sends (v1.1, I36)"*
* `34` ADR-026's title: *"**Irrecoverable dispatch** goes through an ACOS-owned outbox"*

Two passages present it generally:

* `25 §7`'s idempotency-layer table lists it as the **fourth layer**, beside the ingress
  dedup key, the effect-key constraint and the vendor's own key — none of which is
  class-scoped.
* `31 §2`, `33 §1` and `34` ADR-002: *"Duplicate prevention at the dispatch boundary rests
  on vendor idempotency, a vendor query, or **ACOS's own outbox claim**"* — stated of the
  dispatch boundary as such.

**S1I applies the outbox uniformly to every class in `37` S1's closed catalogue.** The
reasons: `§7` and `§15` of the mandate require one row per intended external effect and
claim tests across all recoverability classes; a uniform boundary is strictly safer than a
class-scoped one; and no passage forbids it. Nothing is weakened — an IRRECOVERABLE effect
still gets a row, and it is still halted at row 1.

**Asked of the owner:** confirm the widening, or restrict the outbox to IRRECOVERABLE
classes — noting `S1I-C6`, which makes that restriction produce an outbox with no claimable
subject at S1.

---

## S1I-C6 — the class ADR-026 is titled for cannot reach a claim at S1

**STATUS: A FINDING, reported. Nothing invented and nothing worked around.**

`30 §5.1` item 4 row 1, verbatim: *"`recoverability == IRRECOVERABLE` | **Halt.** No send,
no reship, no public post, no address edit. Unmirrored and unundoable is the combination the
mirror exists for."*

`22 §3.1`'s state-qualified table prints row 1 across all three states:

| Precedence row | Class | `NORMAL` | `UNCORROBORATED_STALL` | `CORROBORATED_DEGRADED` |
|---|---|---|---|---|
| 1 | IRRECOVERABLE | **Halt** | **Halt** | **Halt** |

`30 §5.1` item 5: *"An override restores precedence rows **3 and 4 only**, never rows 1 or
2."* `51 §3.6` makes `recoverability_classes[] ⊆ {COMPENSABLE, REVERSIBLE}` a DATABASE
CHECK.

**Therefore, under v1.3.3 as issued, an IRRECOVERABLE effect is never dispatch-eligible —
in any mirror state, with or without an owner override.** The class ADR-026 exists for
(*"Irrecoverable dispatch goes through an ACOS-owned outbox"*, and `email.send` is its
worked case) cannot be claimed at all.

This is not an S1I defect and S1I does not route around it: `outbox-claim-eligibility.test.ts`
asserts the HALT in all three states and under a valid override, and the ACCEPTED S1H
classifier is the thing producing the answer.

**Two readings are possible and only the owner can choose:**

**(a)** Row 1's `NORMAL` column is correct as printed, and IRRECOVERABLE dispatch is gated
by something outside `30 §5.1` — an approval tier, `26 §5`'s count gate — that a later slice
supplies. In that case the outbox's irrecoverable subject arrives with that mechanism.

**(b)** `22 §3.1`'s `NORMAL` column for row 1 is a transcription artefact of a table
originally written about degraded states only, and IRRECOVERABLE should dispatch in `NORMAL`.
`30 §5.1`'s own framing supports the question: the whole of item 4 is introduced as
*"Dispatch precedence **while the mirror is unreachable**"*, and row 1's rationale
(*"Unmirrored and unundoable"*) is a statement about being unmirrored.

**S1I implements (a)** — the printed table — because it is what the artifact says and it is
the fail-closed direction.

---

## S1I-C7 — `37` schedules the outbox at S4, and S1I builds it now

**STATUS: RECORDED. An owner sequencing decision, not an architecture conflict.**

`37 §2` S4's Build list, verbatim: *"**The ACOS-owned outbox** with at-most-once `CLAIMED`,
provider-visible correlation tag, recoverability-keyed unknown-outcome policy and
delivery-event reconciliation (I36, I20)."* Registry `I36`'s slice column reads **S4**.

The S1I mandate directs the slice now and bounds it to the claim: no adapter, no ESP, no
reconciliation, no unknown-outcome runtime transition. So S1I builds **one of S4's four
listed components** and defers the other three, which is a re-sequencing within a declared
slice rather than a departure from it.

**Consequence for `I36`'s verification:** the registry's declared test is *"Kill at each of
the six points in `44 §5.2` against the **real ESP sandbox** and assert exactly one accepted
message."* That test cannot run at S1I and is reported OPEN. `S1I-result.md §11` states the
split.
