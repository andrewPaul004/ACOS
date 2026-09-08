# S1I — Contract

**DURABLE OUTBOX & EXCLUSIVE DISPATCH CLAIM.**

Baseline **`8ce0d41`** (S1H ACCEPTED). Authoritative architecture: package issue
**v1.3.3**, `docs/architecture/v1.3.3/`. Branch `feature/s1i-durable-outbox-claim`.

---

## 1. Where the slice begins and ends

```
LOCAL AUTHORISATION COMMITTED        the ACCEPTED S1F transaction, untouched
  ↓
push to audit store                  the ACCEPTED S1G transport, extended by one row kind
  ↓
audit / mirror state                 the ACCEPTED S1H state machine, read not written
  ↓
S1H pre-dispatch classifier          `classifyDispatchPrecedence`, IMPORTED not reimplemented
  ↓
durable OUTBOX row                   ← S1I
  ↓
exclusive durable CLAIM              ← S1I
  ↓
STOP
```

**The strongest terminal state is `CLAIMED`** — `25 §7`'s own literal. It means exactly:

> ACOS has durably committed that this exact outbox row is claimed for one external dispatch
> attempt.

It does **not** mean request sent, vendor accepted, effect executed, verified, reconciled,
settled, or externally exactly-once. **S1I DOES NOT PROVIDE EXTERNAL EXACTLY-ONCE.**

### What S1I does NOT build

No HTTP, no adapter, no vendor SDK, no credential, no endpoint. No poller, no scheduler, no
background worker, no automatic claim. No `PRESUMED_EXECUTED`, `VERIFIED` or `NEVER_SENT`
transition. No provider query, no delivery-event reconciliation, no settlement. No approval
resume, no `R′`, no `VC-C4`. No `I18d`, no `I8`, no `I20`. No lease, no visibility timeout,
no reclaim.

`tests/integration/outbox/no-transport-boundary.test.ts` asserts each as an absence over
`src/`, over both database schemas, and over the outbox modules' own exported surface.

---

## 2. Architecture → implementation → validation

| Architecture | Requirement | Implementation | Validation |
|---|---|---|---|
| `25 §7` layer 4 | One outbox row per intended message, unique on the effect idempotency key | `dispatch_outbox` PRIMARY KEY `(company_id, idempotency_key)` | `outbox-enqueue.test.ts` — sequential, concurrent, two distinct effects, rollback, restart |
| `25 §7`, ADR-026 (1) | A unique provider-visible correlation tag | `correlation_tag` + `dispatch_outbox_correlation_tag_unique` | `outbox-enqueue.test.ts`, `outbox-immutability.test.ts` |
| `25 §7`, ADR-026 (2), `I36` | Transition to `CLAIMED` in a committed transaction before the HTTP call | `claimForExternalDispatch` — `FOR UPDATE`, re-read, `UPDATE`, `COMMIT` | `outbox-claim.test.ts` |
| `I36` enforcement: "DB (state machine constraint)" | A `CLAIMED` row is never re-dispatched by any path | `dispatch_outbox_state_machine` trigger | `outbox-immutability.test.ts` — direct SQL |
| `26 §2.1` | The request binds to exactly one dispatch payload by hash | `dispatch_outbox_payload_binds_hash` CHECK + composite FK to `authorisation` | `outbox-enqueue.test.ts`, `payload-mutation-attack.test.ts` |
| `33 §1` | The adapter receives the payload VERBATIM and constructs nothing | `payload_canonical_bytes`, immutable | `payload-mutation-attack.test.ts` |
| `26 §5` | Recoverability is catalogue-assigned, never per request | composite FK to `effect (... recoverability ...)`; no API parameter | `outbox-controls.test.ts`, `outbox-caller-supplied-authority.ts` |
| `30 §5.1` item 4 | Dispatch, per the ordered first-match precedence list | the accepted classifier, called in the claim transaction | `outbox-claim-eligibility.test.ts` |
| `30 §5.1a` | The FULL-HALT POSTURE reduces every disposition to Halt | derived from `mirror_declaration.opened_at`, read at claim | `outbox-claim-eligibility.test.ts`, `outbox-controls.test.ts` |
| `30 §5.7.2` (3) | The override counters increment in the dispatching transaction | `claimOverrideAllowanceOn`, composed into the claim | `override-backed-claim-race.test.ts` |
| `30 §5.7.2` (5) | Every dispatch under an override is tagged and carries `override_id` | `claim_requires_unmirrored_tag`, `claim_override_id`, both CHECK-coupled | `outbox-claim-eligibility.test.ts` |
| `23 §6` B8 | No external effect without a committed record | journal row kind `OUTBOX_CLAIMED`, same chain, same counter | `outbox-journal-rows.test.ts` |
| `30 §5.1` item 2, `I17` | The audit store holds every `journal_seq` | `A0005`, and the transport extended by six columns | `outbox-journal-rows.test.ts` |
| `30 §5.1` item 3, `23 §6` B8 | "dispatch follows the commit" | the outbox row is a POST-COMMIT derivative; S1F is untouched | `outbox-crash-matrix.test.ts` |

---

## 3. The outbox state machine

Two states. The transition table is total.

| State | Meaning | External request may have happened? | Can claim again? |
|---|---|---|---|
| **`ENQUEUED`** | One intended external effect has a durable row bound to a committed authorisation and to the exact authorised payload bytes. Nothing has been claimed. | **NO.** Nothing has been claimed, and S1I has no transport at all. | **YES** — subject to `30 §5.1` item 4 evaluated at claim time against CURRENT state. A row may be refused now and claimable later, and the reverse. |
| **`CLAIMED`** | ACOS has durably committed that this exact row is claimed for ONE external dispatch attempt. | **UNKNOWN IN GENERAL — NO in this slice's test harness.** In general the claim exists precisely so that the window between the claim's commit and a request leaving the process is a window in which the answer is unknown. In S1I there is no transport, so in this harness the answer is NO — but that is a property of the harness and **must not be read as a property of the state**. | **NO.** Not by another worker, not by the same worker, not after a restart, not after any elapsed time, not by a timeout, not by a manual replay, not by a direct `UPDATE`. `dispatch_outbox_state_machine` admits no `UPDATE` to a `CLAIMED` row at all. |

**Transitions:** exactly one, `ENQUEUED → CLAIMED`. `DELETE` is refused on both states.
`ENQUEUED → ENQUEUED` is admitted for no column: an enqueued row's identity, payload and
correlation tag are as immutable as a claimed row's.

**States deliberately absent:** `RETRY_READY`, `EXPIRED_CLAIM`, `RECLAIMABLE`, `AUTO_RETRY`
— v1.3.3 declares none, and each would be a path out of `CLAIMED`. `PRESUMED_EXECUTED`,
`VERIFIED` and `NEVER_SENT` — architecture literals, placed by `25 §5` on the WORK-ITEM
lifecycle and by ADR-026 item 4 on the outcome of a request that was actually made, and all
three reachable only from provider evidence. There is no provider.

**What resolves a `CLAIMED` row is deferred and named.** `35 §4`: *"It is marked
`PRESUMED_EXECUTED`, the irrecoverable unit is consumed, and the provider's delivery event —
matched on the correlation tag — resolves it to `VERIFIED` or `NEVER_SENT`. A `NEVER_SENT`
row is a new proposal requiring fresh authorisation, never a retry."* None of that is in
S1I, and `§23`/`§24` of the mandate forbid manufacturing any of it.

---

## 4. The outbox row

| Field | Source | Mutable? | Authority role |
|---|---|---|---|
| `company_id` | `INSERT … SELECT` from `effect` | No | `33 §6`: every table carries it |
| `idempotency_key` | `effect.idempotency_key` | No | **`25 §7`'s deterministic semantic effect identity. The PRIMARY KEY half that decides duplication.** |
| `outbox_id` | caller (surrogate) | No | Names the row in the journal and the claim. **Does not decide duplication.** |
| `effect_id` | `effect.effect_id` | No | FK member. The one effect this row is for. |
| `authorisation_id` | `effect.authorisation_id` | No | FK member. Binds to the committed authority. |
| `action_class` | `effect.action_class` | No | FK member. |
| `recoverability` | `effect.recoverability` | No | **FK member. `26 §5`: catalogue-assigned, never per request. Row 1's operand.** |
| `adapter` | `effect.adapter` | No | FK member. A mock name at S1; no adapter exists. |
| `resource_ref` | `effect.resource_ref` | No | FK member. |
| `effect_status` | `effect.status`, CHECK `= 'AUTHORISED'` | No | FK member. **An `AWAITING_APPROVAL` effect has no enqueue path.** |
| `dispatch_payload_hash` | `authorisation.dispatch_payload_hash` | No | **FK member to `authorisation (authorisation_id, dispatch_payload_hash)`. `26 §2.1`'s binding.** |
| `payload_canonical_bytes` | caller, CHECKED | No | **The exact authorised payload, across the async boundary. `dispatch_outbox_payload_binds_hash` refuses bytes that do not hash to the committed hash.** |
| `correlation_tag` | `mintCorrelationTag()`, kernel | No | **`25 §7`'s provider-visible correlation identity. Globally UNIQUE. Minted once, reused on every duplicate enqueue.** |
| `status` | kernel | `ENQUEUED → CLAIMED` only | The state machine. |
| `enqueued_at` | caller's instant | No | |
| `claim_id` | kernel, at claim | No, ever | A LABEL on the one claim. **Not what makes it exclusive.** |
| `claimed_at`, `claimed_by` | kernel, at claim | No, ever | Audit trail. Neither is an authority operand. |
| `claim_matched_row` | `PrecedenceDecision.matchedRow`, CHECK ∈ {3,4,5} | No, ever | **WHY the effect was eligible.** Rows 1 and 2 halt in every state and are unreachable by override, so no claim can record one. |
| `claim_mirror_state` | `30 §5.6`'s state at the claim | No, ever | |
| `claim_requires_unmirrored_tag` | `PrecedenceDecision.requiresUnmirroredTag` | No, ever | **`§16`. `30 §5.7.2` item 5 / `36 §6`'s requirement, preserved so the execution slice cannot forget the dispatch was authorised outside `NORMAL`. NOT a tag on a dispatched effect.** |
| `claim_override_id` | `PrecedenceDecision.overrideId`, FK | No, ever | **`§31`. The exact authority, not a boolean.** |

**There is no eligibility column, no `claim_expires_at`, no lease column, no attempt
counter and no `dispatched_at`.** `outbox-immutability.test.ts` asserts each absence against
`information_schema`.

### The reference targets that make the binding structural

```sql
CREATE UNIQUE INDEX effect_outbox_identity
  ON effect (effect_id, company_id, idempotency_key, authorisation_id,
             action_class, recoverability, adapter, resource_ref, status);

CREATE UNIQUE INDEX authorisation_payload_binding
  ON authorisation (authorisation_id, dispatch_payload_hash);
```

Both are unique over a SUPERSET of an already-unique column, so neither adds a constraint to
an accepted table — they add a reference TARGET. `§8`'s attack (`outbox(effect_id = X,
payload = payload-for-Y)`) has no INSERT: the CHECK refuses bytes that do not hash to the
row's own hash, and the FK refuses a hash that is not the one THAT authorisation bound.
Neither alone would suffice.

---

## 5. `acos.journal.outbox_claimed.v1` — THE DECLARED FIELD ORDER

`30 §5.3` requires a hashed row's order to be *"declared per row kind, in the
specification"*. **This section is that specification.** `S1I-C4` records that v1.3.3
declares no order for a claim record and that the order is therefore an implementation
declaration, exactly as S1H's three kinds were.

Implemented independently in `src/db/migrations/0010__dispatch_outbox.sql` (control) and
`src/audit/db/migrations/A0005__outbox_claim.sql` (audit). Judged by BOTH against
`outboxClaimedFields` in `tests/support/jcs1Oracle.ts`, hand-authored, importing nothing
from `src/`. Never compared to each other.

| # | Field | JCS-1 type | Note |
|---|---|---|---|
| 1 | `'acos.journal.outbox_claimed.v1'` | text | domain tag |
| 2 | `company_id` | text | |
| 3 | `journal_seq` | int | `30 §5.2`'s gap-free company-scoped sequence |
| 4 | `'OUTBOX_CLAIMED'` | text | the row kind |
| 5 | `outbox_id` | text | |
| 6 | `outbox_claim_id` | text | |
| 7 | `outbox_correlation_tag` | text | what a future delivery event matches on |
| 8 | `effect_id` | text | joins to the `EFFECT_AUTHORISATION` row |
| 9 | `authorisation_id` | text | |
| 10 | `idempotency_key` | text | |
| 11 | `action_class` | text | |
| 12 | `resource_ref` | text | |
| 13 | `dispatch_payload_hash` | text | |
| 14 | `outbox_matched_row` | int | `30 §5.1` item 4's row |
| 15 | `outbox_mirror_state` | text | `30 §5.6`'s state at the claim |
| 16 | `outbox_requires_unmirrored_tag` | bool | `§16`'s requirement |
| 17 | `override_id` | text, **NULLABLE** | `30 §5.7.2` item 5. NULL carried in the framing word (v1.3.2, JCS-01) |
| 18 | `occurred_at` | ts | RFC 3339, UTC, 6 fractional digits |
| 19 | `prev_hash` | bytes | what makes it a chain |

**Required-absent on this kind:** `decision_id`, `reservation_id`, `approval_id`, `verdict`,
`vendor_amount`, `total_exposure`, `forward_integral`, `is_rate_class`, the constructor
version, `policy_version`, the attestation triple, the mirror/corroboration columns,
`override_event`, `override_actor`. Every one is a fact about the AUTHORISATION and is
already in the chained row that authorised the effect; duplicating an authority-bearing
value into a second chained row creates a second place it could disagree with itself.

**EVERY COLUMN IS A SCALAR.** `ACOS-JCS-1`'s RFC-8785 leg is engaged on neither plane, so
the S1G/S1H position stands: no production journal row carries a JSON column. `§42` of the
mandate requires a STOP if it were otherwise.

**What is NOT journaled, and why.** The ENQUEUE: it moves no authority, creates no
reservation, changes no exposure and makes nothing eligible; its subject is already in a
committed, chained `EFFECT_AUTHORISATION` row. A REFUSED CLAIM: the accepted S1H override
path already establishes that a refusal is not an event, and a refused claim writes nothing
at all — which is what makes `§14`'s reverse case possible.

---

## 6. The claim transaction

```
BEGIN ISOLATION LEVEL READ COMMITTED
  SELECT … FROM dispatch_outbox WHERE (company_id, idempotency_key) FOR UPDATE
  -- re-read status UNDER THE LOCK → 'CLAIMED' means ALREADY_CLAIMED, deterministically
  SELECT action_class, recoverability, total_exposure, (approval exists)
    FROM effect JOIN authorisation LEFT JOIN approval
  mirrorDispatchOperandsOn(...)            -- mirror_declaration + mirror_corroboration
  activeOverrideOn(...)                    -- degraded_mode_override
  classifyDispatchPrecedence(...)          -- THE ACCEPTED S1H CLASSIFIER
  [ if overrideId → claimOverrideAllowanceOn(...) ]   -- override row FOR UPDATE; journals
  emit_outbox_claimed(...)                 -- journal_counter FOR UPDATE, last
  UPDATE dispatch_outbox SET status='CLAIMED', … WHERE … AND status='ENQUEUED'
COMMIT                                     -- durable BEFORE the claim is returned
```

**Lock order** — `30 §5.2`, as resolved once in `src/kernel/exposure/lockOrder.ts`:
`window_balance` (not touched — the claim moves no money), `standing_window_exposure` (not
touched), `dispatch_outbox` row, `degraded_mode_override` row, `journal_counter` last. No
inversion against the S1F authorising transaction exists, because that transaction never
touches `dispatch_outbox`.

**Why `READ COMMITTED`.** At `REPEATABLE READ` or `SERIALIZABLE` the loser's `FOR UPDATE`
raises `40001` instead of reading the new row version — also safe, but it converts a
determinate `ALREADY_CLAIMED` into a retryable error a caller must interpret. `33 §6` scopes
the serialisable requirement to the exposure ledger, *"the only table with a
serialisable-isolation requirement"*, and the claim moves no money.

**Exclusivity does not depend on `claim_id`.** What makes the claim exclusive is the row's
own identity, `(company_id, idempotency_key)` — `25 §7`'s deterministic key. `claim_id` is
minted after exclusion has already been decided; a retry that lost mints nothing and writes
nothing (`§43`).

**Refusals**, all data rather than exceptions: `OUTBOX_ROW_NOT_FOUND`, `ALREADY_CLAIMED`,
`PRE_DISPATCH_SUSPENDED`, `PRE_DISPATCH_HALTED`, `OVERRIDE_ALLOWANCE_REFUSED`. Every refusal
writes NOTHING, so the row stays `ENQUEUED` and remains claimable if the state legitimately
changes.

---

## 7. `clockBearingAtClaim()` — the one leg that fails closed

`30 §5.1` row 3's operand is keyed on `statutory_clock.case_ref`, and **v1.3.3 declares no
binding from an effect to a `case_ref`**. `S1I-C1` carries the passages and the argument.

The function **takes no arguments and returns `false`**. A parameter would be the escape
hatch `26 §1` Corollary 3 forbids; a lookup on a guessed `case_ref` would be the very lever
`30 §9.1` exists to close, reached from the other end.

Consequences, all asserted: row 3 is unreachable at claim time; a COMPENSABLE effect falls
to row 4 and SUSPENDS unless an in-scope override restores it; row 2 becomes reachable and
its strict `$20.00` boundary is asserted from both sides. **The row-3 claim-time leg is
reported PARTIAL.**

---

## 8. Owner clarifications, restated

| Id | Subject | S1I's position |
|---|---|---|
| S1I-C1 | No effect → `case_ref` binding | **STOPPED.** Fail-closed; row-3 claim leg PARTIAL |
| S1I-C2 | No declared pre-claim state name | `ENQUEUED`; structure is architecture |
| S1I-C3 | "the dispatching transaction" undefined | the CLAIM transaction; the only sound reading |
| S1I-C4 | No declared claim byte order | declared in `§5`; class-20 signature obligation extended |
| S1I-C5 | Outbox scoped to "irrecoverable sends" | widened uniformly; strictly stronger |
| S1I-C6 | Row 1 halts IRRECOVERABLE in `NORMAL` too | reported as a finding; the printed table implemented |
| S1I-C7 | `37` schedules the outbox at S4 | owner sequencing decision, recorded |

---

## 9. What the accepted suites lost, exactly

Two accepted boundary assertions are NARROWED, and nothing else is:

**`tests/integration/authority/local-authorisation-boundary.test.ts`** — its
`/CLAIMED/` and `/outboxClaim/i` absences over all of `src/` become a CONFINEMENT against a
HAND-AUTHORED FILE LIST, plus a re-assertion that the money path (`kernel/authority`,
`kernel/policy`, `kernel/exposure`, `kernel/canonicalisation`) still knows nothing about
either. `settled_total` and `vendorQuery` remain absent globally. The accepted file's own
comment said the absence held *"until the outbox exists"*.

**`tests/integration/mirror/no-dispatch-boundary.test.ts`** — three patterns removed from
its mechanism-absence list (`/\boutbox\b/i`, `/outboxClaim/i`, `/exclusiveClaim/i`);
`kernel/outbox` added to the mirror-confinement allow list, because `30 §5.1` item 3 puts
the precedence evaluation at *"dispatch, per (4)"* and the claim is its first durable step;
and the control-schema relation check narrowed from "no relation matching `outbox|dispatch`"
to a hand-authored allowlist of the two S1I relations, with `adapter|vendor` still forbidden
globally.

No other accepted assertion is touched, no accepted test is deleted, and no accepted
expectation is weakened.
