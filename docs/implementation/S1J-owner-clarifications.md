# S1J — Owner Clarifications

**Package issue `v1.3.4` is authoritative. Six items. `OWNER DECISION REQUIRED = 3`
(`S1J-C1`, `S1J-C2`, `S1J-C6`).**

Each item states the passages, what the implementation did, and what the consequence is if
the owner disposes of it differently.

---

## 0. Summary

| Id | Subject | Kind | Owner decision required? |
|---|---|---|---|
| **S1J-C1** | "Consume the irrecoverable unit" has no declared ledger mutation | **ARCHITECTURE INCOMPLETENESS** | **YES** |
| **S1J-C2** | Known adapter failure: a declared response with no state, contradicting OBX-01 | **ARCHITECTURE CONFLICT** | **YES** |
| **S1J-C3** | No declared mechanism for a post-dispatch status on an append-only effect ledger | Implementation declaration | No |
| **S1J-C4** | No declared identifier for the state between "adapter returned" and `VERIFIED` | Implementation declaration | No |
| **S1J-C5** | `ACOS-JCS-1` declares a field order for one row kind; S1J puts a second in service | Implementation declaration | No |
| **S1J-C6** | `25 §14`'s entity lease spans propose→authorise→**execute**; OBX-03's async claim cannot | **ARCHITECTURE CONFLICT** | **YES** |

---

## S1J-C1 — "consume the irrecoverable unit" is not a declared ledger mutation

### The requirement, stated four times and always as one inseparable act

`25 §10`'s recoverability-keyed table, row 2:

> | IRRECOVERABLE (send, post, reship) | **Assume it happened. Never re-dispatch.** Mark
> `PRESUMED_EXECUTED`, **consume the irrecoverable unit**, and resolve later from the
> provider's delivery event matched on the correlation tag. |

`24 §3` K4, Failure behaviour:

> "On ambiguous outcome, status by recoverability class: money holds and the reconciler
> resolves; **irrecoverable assumes executed, marks `PRESUMED_EXECUTED`, consumes the
> irrecoverable unit and never re-dispatches**"

`34` ADR-026 item 3 prints the same sentence. `35 §12.3`:

> "It is marked `PRESUMED_EXECUTED`, **the irrecoverable unit is consumed**, and the
> provider's delivery event — matched on the correlation tag — resolves it to `VERIFIED` or
> `NEVER_SENT`."

**All four state a state transition AND a ledger movement as one act.** None of the four
says what the movement is.

### What v1.3.4 leaves undecided, item by item

**(a) Which of three terms moves, and to which.** `24 §3` K5 is "the single authoritative
schema specification for `window_balance`" and gives the irrecoverable ledger three terms
and no transitions:

```
reserved_irrecoverable,   presumed_irrecoverable,   realised_irrecoverable
```

Four candidate readings of "consume", and the artifacts pull in different directions:

| Candidate | Argued for by | Argued against by |
|---|---|---|
| `reserved` −1, `presumed` +1 | `25 §10`'s word "consume" | `I3` term 3 is bound to `PRESUMED_SETTLED`; `I20` counts RESERVED units |
| `reserved` −1, `realised` +1 | "consume" | `I20`; and a presumption is not a realisation |
| `presumed` +1, `reserved` unchanged | `I20`'s test column | `I3` term 3's binding; and it is not a consumption |
| `realised` +1, `reserved` unchanged | `I20`'s test column | a presumption is not a realisation |

**(b) `I3`'s term 3 is bound to a DIFFERENT state.** `phase2-v1.3-invariant-registry.md`
`I3`'s operand row: *"Term 3 from `24 §3` K5's **`PRESUMED_SETTLED`** state."* And
`PRESUMED_SETTLED` is `I32`'s liquidity-override state for a MONEY reservation — *"the
owner override is a liquidity remedy that releases the workflow hold and moves the
reservation to `PRESUMED_SETTLED`"* (`I32`, `26 §10.3`) — not `PRESUMED_EXECUTED`. So
moving `presumed_irrecoverable` on a `PRESUMED_EXECUTED` transition would put a second,
undeclared producer into `I3`'s term 3.

**(c) `I20` reads as though the reserved term SURVIVES the consumption.** `I20`:
*"`Σ provider-reported accepted messages per window ≤ Σ **reserved** irrecoverable units per
window`"*, with its own test column: *"Compare provider accepted counts to reserved units
across a fixture window **including a `PRESUMED_EXECUTED` row**."* If a consumption
decremented `reserved_irrecoverable`, a window containing a `PRESUMED_EXECUTED` row would
have a SMALLER right-hand side than one without — and `I20`'s bound would tighten as
presumptions accumulate, which inverts the invariant's own direction.

**(d) The reservation SITE is not declared either.** `26 §7`'s step-R PROSE reserves
*"`exposure.total_exposure` into the ordinary reservation term — `I3` term 1"*, and its
FLOWCHART node reserves *"money · **irrecoverable-count**"*. `51 §2` gives the MIE windows
BOTH a `max_count` (per class, `§2.2`) AND a `max_irrecoverable_units`, at the same figures
(13 and 43). So whether `MIE_discretionary` headroom is ledger 2 (count) or ledger 3
(irrecoverable) is not decided, and a consumption cannot be written without deciding it.

**(e) AND THE DECIDING FACT: NO ACCEPTED SLICE RESERVES AN IRRECOVERABLE UNIT.**
`src/kernel/exposure/ledger.ts`'s `applyReservation` — the only writer of a reservation
term in the whole repository — moves `reserved_monetary` and `reserved_count`.
`reserved_irrecoverable` has **no production writer in any accepted slice**, and
`mock-kill-matrix.test.ts` asserts it reads `0` for every window instance after a real
IRRECOVERABLE authorisation and dispatch.

**So under candidates (a) or (b) the consumption would drive a `BIGINT` term negative and
trip `window_balance_irrecoverable_non_negative`. THERE IS NO RESERVED UNIT TO CONSUME.**

### What S1J did

**RETURNED PARTIAL, and made the refusal structural.**

`§2` of the S1J mandate: *"If v1.3.4 does not define the answer sufficiently: RETURN
PARTIAL. Implement unaffected S1J paths if safely possible, but do not create a new MIE
accounting scheme."* `§16`: *"If the current architecture does not define the MIE movement:
RETURN PARTIAL. Do not invent a counter."*

| Layer | What it does |
|---|---|
| `outcomePolicyFor('IRRECOVERABLE', 'OUTCOME_UNKNOWN')` | returns `UNDECLARED` with reason `IRRECOVERABLE_UNKNOWN_MIE_TRANSITION_UNDECLARED`, citing the passages |
| `processAdapterOutcomeOn` | refuses `OUTCOME_POLICY_UNDECLARED` and writes **nothing** — no outcome row, no journal row, no ledger statement |
| `0012`'s `dispatch_outcome_irrecoverable_unknown_undeclared` CHECK | makes the row **unwritable even by a direct INSERT**, so a future code path cannot quietly add it |
| `A0007`'s domain CHECKs | the audit plane refuses a pushed row asserting `PRESUMED_EXECUTED` too |

### What the PARTIAL costs, and what it does NOT cost

**IT DOES NOT COST THE SAFETY PROPERTY.** `25 §10` row 2's first sentence is "Never
re-dispatch", and that half is closed by the committed `CLAIMED` row rather than by the
accounting: `0010`'s trigger admits no UPDATE, the claim API returns `ALREADY_CLAIMED` to
every path, and `outcome-classes.test.ts` asserts a reclaim refused at 1, 30, 365 and 3650
days. An IRRECOVERABLE effect with an unknown outcome is never sent twice.

**IT COSTS THE ACCOUNTING AND THE RESOLUTION PATH.** The effect reaches no durable outcome
state, so:

- `I9` — "no effect is in a non-terminal state past its SLA" — will fire on it, correctly;
- `PRESUMED_EXECUTED` does not exist, so `25 §10`'s delivery-event resolution has no state
  to resolve FROM (that resolution is a later slice anyway);
- `MIE_discretionary` is not decremented for a presumed execution, so the count ceiling does
  not yet bound presumptions — which is only a live exposure once a real vendor exists,
  since at S1J no send occurs.

### THE OWNER DECISION

**Declare the ledger mutation, or declare that there is none.** The decision needs three
parts:

1. **Which ledger holds `MIE_discretionary` headroom** — ledger 2 (`*_count`) or ledger 3
   (`*_irrecoverable`) — and therefore which term step R must reserve into. `51 §2`'s MIE
   windows carry both at the same figures, so this is a choice and not a derivation.
2. **What "consume the irrecoverable unit" moves**, from the four candidates above, and
   whether `I3`'s term 3 gains a second producer (`PRESUMED_EXECUTED` alongside
   `PRESUMED_SETTLED`) or whether a fourth term is declared.
3. **Whether `I20`'s right-hand side is the reserved term before or after consumption**, so
   its direction is unambiguous.

Until then, S1J's refusal stands and the IRRECOVERABLE unknown-outcome branch is
**PARTIAL**.

---

## S1J-C2 — a known adapter failure has a declared RESPONSE, no declared STATE, and the
response contradicts OBX-01

### The passages

`24 §3` K4, Failure behaviour:

> "On **adapter failure**, bounded retry with jitter against the same idempotency key, then
> dead-letter to an Incident."

`25 §5`'s work-item lifecycle has exactly two edges out of `EXECUTING`:

```
EXECUTING --> VERIFYING: adapter returned
EXECUTING --> ATTEMPT_UNRESOLVED: timeout / ambiguous
```

**There is no edge for a known failure, and no effect status for one.** `24 §3` K4's
terminal set is `VERIFIED`, `FAILED`, `COMPENSATED`, `PRESUMED_EXECUTED`,
`UNRESOLVED_DISCREPANCY`; `FAILED` is in it, and nothing declares it reachable from an
immediate adapter result rather than from `25 §8.3`'s reconciler.

### The conflict

`25 §7` (v1.3.4, OBX-01):

> **"Exactly two states: `ENQUEUED` and `CLAIMED`. Exactly one transition:
> `ENQUEUED → CLAIMED`. No transition out of `CLAIMED`, and no second transition into
> it.**"

**A bounded retry against the same idempotency key needs a second dispatch of a row that is
`CLAIMED`, and OBX-01 admits none.** The two passages cannot both be followed: K4's retry
requires a claimable row, and OBX-01 says the row is never claimable again.

The conflict was latent before S1J because nothing dispatched. It becomes live the moment
an adapter can report a known failure.

### What S1J did

`§19` of the mandate: *"Only implement this branch if current v1.3.4 declares one for the
immediate adapter result. [...] If no immediate known-not-sent state exists, do not invent
one. Report the omission as architecture-driven."*

- `ADAPTER_FAILED` **is** a member of the typed `AdapterOutcome` union, because an adapter
  that genuinely knows its call was refused must be able to SAY so rather than misreport it
  as unknown — `35 §4`: "conflating 'failed' with 'unknown' is what produces double
  execution", and the converse mislabelling is the same defect mirrored.
- `outcomePolicyFor(*, 'ADAPTER_FAILED')` returns `UNDECLARED` with reason
  `KNOWN_FAILURE_STATE_UNDECLARED` for **all three** classes.
- The outcome transaction writes **nothing**, and `0012`'s
  `dispatch_outcome_kind_declared` CHECK has no arm for it.
- **`NEVER_SENT` IS NOT REUSED.** `25 §10` reserves it for delivery-event evidence AFTER a
  presumption, and `35 §12.3` makes "a `NEVER_SENT` row [...] a new proposal requiring fresh
  authorisation, never a retry". `§19` forbids the misuse explicitly, and
  `outcome-classes.test.ts` asserts the string appears in no refusal.

### THE OWNER DECISION

Three coherent dispositions, and the implementation is prepared for any of them:

1. **K4's retry is corrected to "no retry".** A known failure resolves to a declared
   terminal state (`FAILED`?) with the reservation released, and the remedy is `26 §12.3`'s
   `RemedyObligation` plus a NEW proposal under fresh authorisation — the shape `35 §12.3`
   already uses for `NEVER_SENT`. This is the reading most consistent with OBX-01.
2. **OBX-01 gains a narrow exception** for a *provably not accepted* result. This is the
   dangerous reading: "provably not accepted" is a claim about a vendor, made by an adapter,
   which `49 §3.1` makes a TCB member, and `36 §7` requires such claims to be measured
   empirically rather than trusted.
3. **A known failure is declared out of scope for the adapter contract**, so an adapter must
   return `OUTCOME_UNKNOWN` for anything it cannot distinguish, and `ADAPTER_FAILED` is
   removed from the union. Safest, and it discards real information.

Until then, the known-failure branch is **PARTIAL**.

---

## S1J-C3 — an append-only effect ledger has no declared mechanism for a post-dispatch
status

### The passages

`24 §3` K4: *"**Every effect has a terminal status**: `VERIFIED`, `FAILED`, `COMPENSATED`,
`PRESUMED_EXECUTED` (irrecoverable, unknown outcome, never re-dispatched), or
`UNRESOLVED_DISCREPANCY`. Effects never silently disappear."*

`33 §6` makes a correction *"a new row with supersedes"*, and `0007`'s `effect` table carries
`acos_append_only` with `CHECK (status IN ('AUTHORISED', 'AWAITING_APPROVAL'))`. **There is
no UPDATE path to `effect.status` for any role**, and `0007`'s own comment records why: "The
status is not updated in place — the table is append-only".

So K4 requires every effect to REACH a terminal status, and the schema that holds effects
admits no status change. v1.3.4 does not say how the two compose.

### The declaration

**The outcome row carries the post-dispatch status.** One row per outbox identity, in
`effect_dispatch_outcome`, append-only itself, key-bound to the committed claim. An effect's
EFFECTIVE status is `effect.status` until an outcome row exists for its identity, and that
row's `effect_status` afterwards.

**Why not `33 §6`'s supersede-row shape.** A superseding `effect` row would need a new
`effect_id` or a mutable primary key, and `(company_id, idempotency_key)` IS `25 §7`'s
deterministic effect key — a second row under the same key is not representable, and a
second key would break the identity the whole idempotency argument rests on.

**What this costs:** a reader wanting an effect's current status must join. `S1J-result.md`
records it, and the shape is the same one `24 §3` K6 already uses for settled figures.

### If the owner disposes otherwise

The alternative is a status projection table or a declared supersede chain on `effect`.
Either is a migration and a schema declaration; nothing in S1J's dispatch logic changes,
because no S1J code path reads `effect.status` as an authority operand — the outcome
transaction reads `effect.recoverability` and nothing else from that row.

---

## S1J-C4 — no identifier is declared for the state between "adapter returned" and
`VERIFIED`

### The passages

`25 §5`'s lifecycle moves the WORK ITEM to `VERIFYING` when the adapter returns, and its own
note is the load-bearing part:

> **`VERIFYING`.** A 200 from an API is not evidence that the world changed. Verification is
> an independent read-back — and for money, it is the settlement reconciliation, not the API
> response.

`24 §3` K4 reaches `VERIFIED` only from that read-back. **So there IS a declared interval —
adapter returned, world not yet confirmed — and v1.3.4 declares no identifier for the
EFFECT ROW's state during it.** `35 §4` declares one for the unknown case
(`DISPATCHED_OUTCOME_UNKNOWN`) and none for this one, and there is no `DISPATCHED` state
anywhere in the package: the ACCEPTED `no-transport-boundary.test.ts` asserts its absence.

### The declaration

**`DISPATCHED_AWAITING_VERIFICATION`.**

- The SEMANTICS are v1.3.4's, quoted above. Only the IDENTIFIER is not.
- It shares `35 §4`'s prefix, so the two post-dispatch statuses form one domain.
- It is deliberately NOT `VERIFIED` (K4's terminal literal, unreachable without a read-back
  S1J does not perform), NOT `DISPATCHED` (declared nowhere, and asserted absent), and NOT
  `VERIFYING` (which `25 §5` places on the WORK-ITEM lifecycle; reusing a literal across two
  state domains is its own defect).

This is the same position `S1I-C2` occupied for `ENQUEUED`: the STRUCTURE is architecture —
a non-terminal post-dispatch state, reached from a returned adapter call, exited only by an
independent read-back — and only the name is an implementation declaration.

---

## S1J-C5 — `ACOS-JCS-1` declares a field order for one row kind, and S1J puts a second in
service

### The passage

`30 §5.3a` (v1.3.4, JCS-02, resolving `S1I-C4`):

> "**This section is that specification for the outbox claim row.** The remaining kinds are
> declared as they are cross-implemented; **a row kind in service without a declared order
> here is a defect of this class.**"

S1J introduces `acos.journal.dispatch_outcome.v1`. `§36` of the mandate requires the
declaration to be updated "exactly", and `§47` forbids the implementation from issuing
v1.3.5 on its own.

### What S1J did

**Declared the order in `S1J-contract.md §5`, in the position `S1I-C4` occupied**, and
discharged every obligation `§5.3a` attaches to a declared order:

| Obligation | Discharged by |
|---|---|
| declared field by field, numbered, in a specification | `S1J-contract.md §5`, twenty fields |
| two independent transcriptions, neither reading the other | `0012` branch 7 (control), `A0007` branch 7 (audit) |
| a hand-authored third reading as oracle | `jcs1Oracle.ts`'s `dispatchOutcomeFields` |
| both planes judged against the oracle, never against each other | `dispatch-outcome-journal-rows.test.ts` |
| no dependence on insertion order | positional concatenations; no map, no row-to-JSON, no column reflection |
| a seeded field swap must fail the byte-identity fixture | fields 15 and 16 swapped — same type, same framing, adjacent |

**Control-artifact consequence, disclosed and not discharged.** Class 20's signed content is
"column order per row kind", so declaring an order for a kind that had none moves its
`content_hash`. That signature has been owed since v1.3.2, v1.3.4 extended it for
`OUTBOX_CLAIMED`, and **S1J extends the same owed obligation again.** No deployed chain
exists, so no re-anchor is triggered.

### THE OWNER ACTION

Confirm the order into `30 §5.3a` (or rename fields / reorder), exactly as the owner did for
`S1I-C4`. **The class-20 signature obligation grows either way and is not discharged by
this slice.**

---

## S1J-C6 — `25 §14`'s entity lease spans propose→authorise→EXECUTE, and OBX-03's
asynchronous claim structurally cannot hold it

### The passages, and why they collide

`25 §14`'s concurrency table, verbatim:

> | Two work items touching the same entity | Advisory lock on
> `(company_id, entity_type, entity_id)` **for the duration of the
> propose→authorise→execute span.** Second item waits or defers; it does not proceed on
> stale state. |

`24 §3` K4's canonicaliser reads authoritative state *"under the existing entity advisory
lock (`25 §14`)"*, and `26 §7` step C′ says the same.

`25 §7` (v1.3.4, OBX-03) declares the asynchronous boundary:

> current claim-time authority evaluation → **exclusive durable claim** → COMMIT → transport
>
> **The claim is the last committed local transaction before an effect can leave**

**And the accepted implementation of the lease is a SESSION-level advisory lock on a
dedicated connection.** `src/kernel/enumeration/entityLease.ts` records why it cannot be
transaction-scoped: *"A transaction-scoped advisory lock [...] is released by `COMMIT`, so
it is STRUCTURALLY INCAPABLE of spanning propose→authorise→execute."*

**A session lock lives in one process's connection.** The accepted S1I outbox exists
precisely so that authorisation and dispatch can be separated in time and in process — a
row is enqueued, and claimed later, possibly after a restart, possibly by a different
worker. **No mechanism can hand a live session-scoped advisory lock across that gap**, and
`§3` of the S1J mandate forbids the two evasions:

> "Do NOT: pretend a newly acquired lease is the same lease; hold a PostgreSQL session open
> indefinitely merely to make a test pass; claim full VC-C3 because an outbox row is
> unique."

### What VC-C3 currently is, and what it is not

**`36 §2.3`'s VC-C3 in v1.3.4 is NOT the lease clause.** Its text is entirely about
content-addressed selectors: *"VC-C3 — content-addressed selectors never substitute. The
reordering fixture, directly [...] **Assert `DENY: SELECTOR_STALE` and assert no effect was
dispatched.**"* That clause is CLOSED and stays closed — the accepted
`tests/integration/enumeration/vc-c3-can03-reordering.test.ts` proves it, and S1J does not
touch it.

**The clause at issue is `25 §14`'s span**, which `S1C-result.md` already reported as
partially open in its own words: *"NOT PROVEN: the finished propose→authorise→execute span,
because steps M, R, S and W do not exist in S1C."* S1J is the first slice in which "execute"
exists, so the gap is now measurable rather than deferred.

### What S1J did — and what it deliberately did not

**It did not silently redefine anything.** S1J:

- does **not** acquire an entity lease in the dispatch path. `no-real-transport-boundary.
  test.ts` asserts the gateway directory imports no lease module at all, so no newly
  acquired lock is passed off as the original one;
- does **not** hold a session open across the gap;
- does **not** claim VC-C3's lease clause, and does not claim the `25 §14` span.

**What actually holds the property the span was for, and how much of it.** `25 §14`'s stated
purpose is that a second item "does not proceed on stale state". Across the asynchronous
boundary that purpose is served by three ACCEPTED mechanisms, and the composition is
strictly weaker than a held lock in one identifiable respect:

| Concern | Mechanism | Held? |
|---|---|---|
| the dispatched request reflecting stale state | the payload is a PERSISTED SNAPSHOT bound to the authorised hash (`0010`), never rebuilt | **Yes, and more strongly than a lock** |
| authority decided on stale state | claim-time re-evaluation of every `30 §5.1` item 4 operand against CURRENT state, in the claim transaction (S1I) | **Yes** |
| two dispatches of one intent | the exclusive non-reclaimable claim, `I36` | **Yes** |
| **two CONCURRENT EFFECTS on one entity, one authorised while another is mid-dispatch** | **nothing** | **NO** |

The fourth row is the residual. Two effects against the same order can be authorised and
claimed independently, and nothing serialises their dispatch against each other. `25 §14`'s
lock would have; the outbox does not, because the outbox's uniqueness is per EFFECT
IDENTITY, not per ENTITY.

### THE OWNER DECISION

`§3` of the mandate: *"Determine whether current v1.3.4 STILL normatively requires the
original SAME session-scoped lease to span propose → authorise → external execute. [...] If
the old same-session requirement and the accepted asynchronous outbox are genuinely
incompatible: RETURN PARTIAL AND REPORT THE CONFLICT."*

**They are incompatible as written, and this is the report.** Three dispositions:

1. **`25 §14`'s span is corrected to propose→authorise.** The lease covers C′ through the
   authorising COMMIT — which is exactly what the accepted S1C/S1E/S1F implementation
   does — and the dispatch stage's staleness concern is declared to be served by the
   persisted payload snapshot plus claim-time re-evaluation. **This is the disposition the
   accepted architecture already behaves as if it had made**, and it requires declaring the
   fourth-row residual above rather than closing it.
2. **A per-entity dispatch serialisation is declared** — a second, entity-scoped exclusion
   taken in the claim transaction. This is buildable (an advisory lock on the entity key,
   taken inside the claim, released at its COMMIT) and it would close the fourth row, at the
   cost of a second lock in `30 §5.2`'s order and a new deadlock argument against the
   authorising transaction. **S1J did not build it, because `§3` forbids inventing a
   concurrency rule.**
3. **The asynchronous outbox is reconsidered.** Not credible: OBX-03 is v1.3.4's own
   declaration and `I36` depends on it.

Until the owner disposes of it, **`25 §14`'s propose→authorise→execute span is OPEN and
VC-C3's selector clause remains CLOSED.** `S1J-result.md §13` states both separately.
