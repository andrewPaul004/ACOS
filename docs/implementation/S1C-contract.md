# S1C Contract — Live Enumeration + Content-Addressed Selector Integrity

**Branch:** `feature/s1c-live-enumeration`, from `17a6fdd` (accepted S1B HEAD).
**Architecture package:** `docs/architecture/v1.3.1/` — **unmodified in every respect.**
**Baseline gate at branch creation:** `npm run verify` — **490/490 green, exit 0.**

This document is written **before** production code, as the S1C mandate requires. It states
what S1C builds, what it deliberately does not build, and which of its values are
implementation fixtures rather than architecture claims.

---

## 0. The one-sentence statement

S1C makes the selector's content address **load-bearing**: it builds the real
`enumerate_effects` READ surface over authoritative RECORD-grade commerce state in
PostgreSQL, and it makes step C′ **re-enumerate the live option set under a held entity
execution lease** so that `53 §1`'s CAN-03 reordering attack denies `SELECTOR_STALE`
instead of dispatching a different line.

S1B proved that the model's `option_id` must equal the one recomputed from an authoritative
option the kernel was **handed**. That is necessary and, as the S1B result says in as many
words, **not sufficient**. S1C closes the gap.

---

## 1. Baseline

| Item | Value |
|---|---|
| Working tree at start | clean |
| Recorded HEAD | `17a6fddfb005834fffcd6b4cb46d5d6b9b52bfb4` |
| Branch created | `feature/s1c-live-enumeration` |
| Baseline gate | `npm run typecheck && npm run lint && npm run test` — **38 files, 490 tests, exit 0** |

No S1A or S1B production source is weakened. Where an S1B file changes, the change is
**additive at a boundary** and is named in §9 below with its justification.

---

## 2. Architecture read for this increment

Read in full before writing this contract:

- `26-authority-and-policy-model.md` §2.0, §2.0.1, §2.1, §2.1.1, §2.1.2, §2.1.3, §2.2, §7 (C′ row and
  the coarse-denial paragraph), §7.1, §8 (the worked refund policy)
- `25-workflow-and-event-architecture.md` §14 (concurrency and ordering), §4 (the task contract)
- `24-company-state-and-evidence-model.md` §3 K4 (the canonicaliser and `enumerate_effects`)
- `36-architecture-validation-plan.md` VC-C2, VC-C3
- `phase2-v1.3-invariant-registry.md` — I52, I53, I21, I61
- `docs/implementation/S1B-contract.md`, `S1B-owner-clarifications.md`, `S1B-result.md`

### 2.1 The governing quotations

`26 §2.0.1`, the capability:

> ```
> enumerate_effects(action_class, resource_ref)
>   → EnumeratedOptionSet {
>         enumeration_id            // opaque, journaled
>         computed_at               // for the class's max_age check at C′
>         constructor_version       // the constructor that produced this set
>         options [ {
>             option_id             // = H(action_class ‖ resource_id ‖ semantic_option_digest)
>             description           // projected through the task's context_spec — see I52
>         } ]
>     }
> ```

`26 §2.0.1`, the field-visibility rule:

> Governed by the task's `context_spec`. **No field appears in any option `description` that
> the `context_spec` does not admit** (`I52`), enforced by a projection filter at runtime and
> by spec review in CI.

`26 §7`, the C′ row:

> The Effect Canonicaliser fetches authoritative state under the entity advisory lock,
> **re-enumerates** the permissible effects for `(action_class, resource)`, resolves
> `selector.option_id` against the **live** set […] **v1.2 denials:** `SELECTOR_STALE` if the
> `option_id` is absent from the live set; `SELECTOR_ENUMERATION_STALE` if
> `enumeration_id.computed_at` exceeds the class's `max_age`; `SELECTOR_MALFORMED` if the
> pair does not parse; `NOT_CANONICALISABLE` if no constructor is registered for the class.
> **The kernel never substitutes another option** (I53).

`25 §14`, the lock:

> Advisory lock on `(company_id, entity_type, entity_id)` **for the duration of the
> propose→authorise→execute span.** Second item waits or defers; it does not proceed on
> stale state.

`36 §2` VC-C2, the existence-oracle rule:

> a resource outside the `context_spec` returns an **empty set** rather than a denial that
> leaks existence

`24 §3` K4, the enumeration dimensionality:

> for a refund, the refundable line items and the remaining maximum per item

and `26 §8`:

> The refund enumeration is two-dimensional over `(line, parent_transaction)` with
> content-addressed `option_id`s

---

## 3. What S1C builds

### 3.1 The entity execution lease — `src/kernel/enumeration/entityLease.ts`

`25 §14` requires the advisory lock to be held **for the duration of the
propose→authorise→execute span**. That span crosses transaction boundaries in the finished
system (step S waits on a human approval; step W dispatches after it). A helper that takes a
transaction-scoped lock, re-enumerates, commits and returns a canonical request **cannot**
hold that span, and the S1C mandate forbids claiming the concurrency property from one.

S1C therefore represents the lock lifetime explicitly, as a **session-level** PostgreSQL
advisory lock on a dedicated connection:

```
EntityExecutionLease
  key      = (company_id, entity_type, entity_id)      // 25 §14, verbatim
  acquire  = pg_advisory_lock(k1, k2)   on a dedicated client, NOT pg_advisory_xact_lock
  release  = pg_advisory_unlock(k1, k2) — explicit, in a finally
```

Session-level and not transaction-level **deliberately**: `pg_advisory_xact_lock` is released
by `COMMIT`, so it is structurally incapable of spanning authorise→execute. A session lock
survives an arbitrary number of transactions on the same connection, which is the shape the
future gateway needs.

The type carries the proof obligations:

- `withEntityLease(key, fn)` acquires, runs `fn(lease)`, and releases in a `finally`.
- Every operation that must occur under the lock takes a `HeldEntityLease` **argument** and
  calls `lease.assertHeld()`. It is not possible to call the live C′ boundary without one.
- `lease.assertHeld()` throws once the lease is released, so a retained reference is inert.
- The lease exposes its own client, so downstream work runs on the connection that holds the
  lock rather than on an unrelated one.

**What is proven, and what is not.** S1C proves the lock is held across re-enumeration and
across a **fake downstream callback** standing in for later policy/dispatch, and that a
second session cannot take the same lock until release. It does **not** prove the finished
propose→authorise→execute span, because steps M, R, S and W do not exist. `S1C-result.md`
states this in those terms; it does not claim VC-C3's lock clause is fully closed.

**No policy is implemented inside the callback.** The callback exists solely to demonstrate
lock lifetime.

### 3.2 Authoritative RECORD-grade commerce state — migration `0005__commerce_state.sql`

Real PostgreSQL. No commerce vendor, no vendor SDK, no HTTP.

| Table | Purpose |
|---|---|
| `commerce_order` | the resource: `resource_ref`, `resource_id`, `grade`, `currency`, `customer_novelty` |
| `commerce_order_line` | line items with `refundable_remaining` |
| `commerce_parent_transaction` | parent transactions with `instrument` and `refundable_remaining` |
| `commerce_refund_retained_fee` | the authoritative retained processing fee per `(line, parent_transaction)`, with the `source_ref` of the record it came from |

`commerce_refund_retained_fee` is a **stored amount with a source reference**, never a rate,
a percentage or a formula. That is S1B-C3a held to exactly: *"ACOS does not know a fee
schedule […] It knows a fee AMOUNT, supplied by the kernel from an authoritative record."*
S1C makes that record real; it does not invent an economic rule.

The model supplies **none** of: amount, transaction, instrument, refundable remaining, fee,
currency, description field. The only model inputs remain `ProposedIntent`'s four permitted
fields plus the sealed rationale.

### 3.3 Two-dimensional refund enumeration — `src/kernel/enumeration/refundEnumeration.ts`

`26 §8` and `24 §3` K4: two-dimensional over `(line, parent_transaction)`.

```
for each line with refundable_remaining > 0            (ordered by line_id)
  for each parent_transaction with refundable_remaining > 0   (ordered by parent_transaction_id)
    if a retained-fee record exists for the pair:
      amount = min(line.refundable_remaining, parent_transaction.refundable_remaining)
      emit the authoritative option
```

**Array position is never identity.** Ordering exists only so the returned list is
deterministic for tests and for the enumeration digest; nothing reads an index, and the
production selector has no integer field in which one could be expressed.

### 3.4 `enumerate_effects` — `src/kernel/enumeration/enumerateEffects.ts`

The deterministic core, in the mandate's declared order:

1. `action_class` must be in the closed catalogue;
2. a constructor must be registered for it, else `NOT_CANONICALISABLE`;
3. the resource resolves from authoritative state;
4. RECORD grade is required;
5. the current permissible refund effects are enumerated;
6. each `option_id` is computed **through the registered constructor's
   `computeSemanticOptionDigest`** — the same code path C′ uses, so there is no second refund
   digest anywhere in the tree;
7. an opaque `enumeration_id` is produced;
8. `computed_at` is stamped from an **injected clock**;
9. the **verified** `constructor_version` is stamped (resolved through
   `ConstructorVersionResolver`, so `I61` holds on the READ as well as on the request).

It is a READ. It reserves nothing, dispatches nothing and writes no effect row.

`enumeration_id` is opaque to the model and is content-addressed over
`(company, task, principal, action_class, resource_ref, constructor_version, computed_at,
the ordered option ids)`. It is **recorded in an `enumeration_record` table** so that C′ can
resolve `computed_at` from kernel state rather than from anything the model supplies. That
table is the **staleness and lineage substrate**. It is explicitly **not** the VC-C2 READ
journal: it has no `journal_seq`, no chain hash, no mirror and no quota, and §7 below says so
in the result's own words.

### 3.5 Context-spec projection — `src/kernel/enumeration/contextSpec.ts`

One authoritative projection, used by both paths, as the mandate requires.

```
TaskContextSpec {
  taskId, principalId, companyId,
  admittedResourceRefs      // the resource scope
  admittedDescriptionFields // the closed admitted-field set (I52)
  reasonCodeScope           // see §6.2 — an S1C fixture decision
}
```

The registered constructor declares the option's **candidate description fields** as a
labelled list; `projectOptionDescription` filters that list against
`admittedDescriptionFields` and renders it deterministically. The constructor does not author
a description string, and there is no second rendering path.

`26 §2.1`'s `selected_option […] with its full description` therefore records **the same
projected string the model saw**, because both are produced by the same pure function from
the same authoritative option and the same `context_spec`. The live C′ boundary additionally
asserts equality against the description carried on the live enumerated option, so a future
edit that reintroduces an ad-hoc description fails a test rather than drifting silently.

`I52` **runtime half only.** The CI spec-review half is not implemented and is not claimed.

### 3.6 Out-of-scope resources — VC-C2's external behaviour

The model-facing enumeration returns an **empty set**, never a denial that leaks existence,
for every one of:

- a `resource_ref` outside the task's `context_spec` scope;
- a `resource_ref` that does not exist;
- a resource that exists but is not RECORD grade.

All three collapse, because distinguishing any pair of them **is** the existence oracle. The
internal result carries a precise reason for the later audit/journal layer; the model-facing
projection carries the option list and nothing else. `ORDER_EXISTS_BUT_OUT_OF_SCOPE`, or any
equivalent, appears nowhere on the worker surface.

### 3.7 Enumeration age

`refund.create`'s `max_age` is declared as an **S1C implementation fixture**:

```
REFUND_CREATE_ENUMERATION_MAX_AGE = 120 seconds
```

`26 §2.0.1` requires the class to *have* a `max_age` and requires C′ to check it. It does not
select a duration, and neither `51-limits-fixture.md` nor `36 §2` prints one. S1C therefore
declares a control fixture and records its provenance as exactly that — see
`S1C-owner-clarifications.md` S1C-C4. It is not an architecture claim and no document in this
increment states that the architecture chose 120 seconds.

At C′:

```
now - enumeration_ref.computed_at > max_age   →   DENY: SELECTOR_ENUMERATION_STALE
```

`now` comes from an **injected clock**. The enumeration is never silently reissued. There are
no wall-clock sleeps in any S1C test.

### 3.8 C′ live re-enumeration — `src/kernel/enumeration/liveSelector.ts`

The boundary around the accepted S1B canonicaliser core. Under a **held** lease:

1. assert the lease covers `(company_id, 'order', resource_id)`;
2. resolve the enumeration record for `selector.enumeration_id`, and check it belongs to this
   task, principal, action class and resource — an enumeration for one resource may not be
   paired with an option for another;
3. check `computed_at` against `max_age` → `SELECTOR_ENUMERATION_STALE`;
4. resolve the resource again, from authoritative state, under the lease;
5. **re-enumerate the live option set**;
6. locate the exact `selector.option_id` in it; absent → `SELECTOR_STALE`;
7. canonicalise using the **exact live authoritative option found**, through the unchanged
   S1B `EffectCanonicaliser`;
8. assert the emitted `selected_option.option_id` equals the selector's — `I53`, asserted
   rather than assumed.

**The caller cannot hand C′ a different option.** The boundary method takes no option
parameter. Its inputs are the intent, the task context spec and the held lease; the option is
found, not supplied.

**The S1B core is preserved, not weakened.** Its types do not widen, its `option_id` equality
check stays, and its denial ordering is unchanged. Live option resolution sits *around* it.

### 3.9 Worker-facing denial projection — `src/kernel/enumeration/workerFacingDenial.ts`

`26 §7`: *"Denial detail returned to the model is coarse. The audit record holds the full
reason; the worker receives a category and no near-miss information."*
`26 §2.0.1`: *"A single `DENY: SELECTOR` category covers out-of-range, stale and downstream
denial, so cardinality is not recoverable by binary search (CAN-05)."*

```
SELECTOR_MALFORMED           ┐
SELECTOR_INVALID             ├→  { deny: 'SELECTOR' }
SELECTOR_STALE               │
SELECTOR_ENUMERATION_STALE   ┘

MALFORMED           →  { deny: 'MALFORMED' }          // 26 §7 step B, a declared category
UNKNOWN_ACTION      →  { deny: 'UNKNOWN_ACTION' }     // 26 §7 step C
NOT_CANONICALISABLE →  { deny: 'NOT_CANONICALISABLE' }// 26 §7 step C2
```

The projection returns a **frozen object with exactly one field**. It carries no `detail`, no
`auditNote`, no `message`, no count, no nearest valid option, no index range and no
"exceeded by X". A test asserts the raw `CanonicalisationDenied` and the worker-facing value
are different objects and that the worker-facing serialisation contains none of the audit
strings. This closes S1B's carried-forward denial-transport note.

Only the selector family is collapsed. The mandate is explicit that S1C does not implement
every policy denial mapping, and it does not.

### 3.10 The mandatory positional negative control

`tests/negative-controls/unsafe-positional-selector.ts` — **test-only, never imported by
`src/`**, mirroring the shape of S1A's `unsafe-schema.ts` and S1B's
`unsafe-retained-fee-escape.ts`.

It reconstructs v1.1's ordinal selector: an integer index into the live set. On the CAN-03
fixture it must select **B** after A is exhausted, and the test asserts
`EXPECTED SUBSTITUTION OBSERVED`. If it does not substitute, the CAN-03 test does not
discriminate and the negative control fails loudly.

**No production code is weakened to produce it.**

---

## 4. New denial codes

`errors.ts` gains exactly the two the architecture already declares for C′:

```
SELECTOR_STALE               26 §7 C′ row, I53
SELECTOR_ENUMERATION_STALE   26 §7 C′ row
```

S1B's `errors.ts` header says these are *"deliberately absent […] added by the
enumeration/selector increment together with I53 and the mandatory positional negative
control."* That comment is updated to record that this is that increment. No denial code is
invented; `26 §7` declares the set.

New `DenyDetail` members are audit-side only and are never returned to a worker.

---

## 5. Tests

| # | Test | File |
|---|---|---|
| 1 | valid refund enumeration over real PostgreSQL | `enumerate-effects.test.ts` |
| 2 | no positional identity — reordering the underlying rows does not change any `option_id` | `enumerate-effects.test.ts` |
| 3 | exact `option_id` computation against an independent oracle | `option-identity.test.ts` |
| 4 | `context_spec` field projection — an omitted field cannot appear in any description | `context-spec-projection.test.ts` |
| 5 | out-of-scope / absent / non-RECORD resource returns an empty set, indistinguishably | `enumeration-scope.test.ts` |
| 6 | stale enumeration age denies `SELECTOR_ENUMERATION_STALE`, injected clock | `live-selector.test.ts` |
| 7 | live option disappears → `SELECTOR_STALE` | `vc-c3-can03-reordering.test.ts` |
| 8 | **no option substitution** — B is never selected, no effect constructed | `vc-c3-can03-reordering.test.ts` |
| 9 | CAN-03 positional negative control substitutes B | `can03-positional-substitution.test.ts` |
| 10 | recorded description === the authoritative projected enumeration description | `context-spec-projection.test.ts` |
| 11 | semantic option mutation matrix — five fields, each moves `option_id` | `refund-semantic-digest.test.ts` (extended) |
| 12 | non-semantic current-state mutation leaves `option_id` unchanged | `refund-semantic-digest.test.ts` (extended) |
| 13 | resource RECORD-grade requirement | `enumeration-scope.test.ts` |
| 14 | enumeration `constructor_version` === canonicalisation `constructor_version` | `live-selector.test.ts` |
| 15 | worker-facing selector denial is coarse; raw audit detail is a different surface | `worker-facing-denial.test.ts` |
| 16 | re-enumeration occurs while the entity lock is held; release is explicit | `entity-lease.test.ts` |
| 17 | the lease survives a fake downstream callback across a transaction boundary | `entity-lease.test.ts` |
| 18 | `selector: 4` and `selector: {index: 4}` are malformed (runtime + type-negative) | `positional-selector-rejected.test.ts`, `tests/type-negative/positional-selector.ts` |
| 19 | every accepted S1A/S1B test still green | the whole suite |

Deterministic barriers (`tests/support/barrier.ts`) and clock injection throughout. **No
sleeps as synchronisation.**

---

## 6. Fixture-only decisions

Every value below is an **S1C implementation fixture**. None is an architecture claim. Each
is recorded again in `S1C-owner-clarifications.md`.

| Id | Decision |
|---|---|
| S1C-C1 | The commerce-state schema shape. The architecture names the dimensions `(line, parent_transaction)` and the fields the digest covers; it prints no DDL. |
| S1C-C2 | `commerce_refund_retained_fee` stores an **amount plus a source reference** per `(line, parent_transaction)`. No rate, no formula — S1B-C3a held to. |
| S1C-C3 | The `context_spec` admitted-field set for `refund.create` descriptions. The architecture requires the filter; it enumerates no field set. |
| S1C-C4 | `max_age = 120s` for `refund.create`. A control fixture. The architecture requires a `max_age` per class and selects no duration. |
| S1C-C5 | The enumeration is two-dimensional over `(line, parent_transaction)`, and `reason_code_scope` is taken from the **task's** `context_spec`, not enumerated as a third dimension. |
| S1C-C6 | The `enumeration_id` digest inputs. The architecture says "opaque"; the exact preimage is an implementation choice. |
| S1C-C7 | `26 §2.0.1`'s `EnumeratedOptionSet` and `24 §3` K4's differ: `24` additionally prints `action_class`, `resource_ref` and `max_age`. S1C returns `26 §2.0.1`'s narrower shape to the model and holds `max_age` kernel-side. |

### 6.2 On S1C-C5, because it is the one worth arguing

`refund.create`'s `semantic_option_digest` includes `reason_code_scope` (`26 §2.2`), but
`enumerate_effects(action_class, resource_ref)` takes no reason code. Enumerating the cross
product over every scope would make the enumeration three-dimensional, which contradicts
`26 §8`'s *"two-dimensional over `(line, parent_transaction)`"*.

S1C resolves it by taking `reason_code_scope` from the **task's** `context_spec` — a
kernel-owned property of the task contract, never a model input. S1B's existing cohesion
check then does exactly the work it was written for: a proposed `reason_code` whose scope
differs from the selected option's denies `SELECTOR_INVALID`.

This is recorded as a fixture decision and not as a reading of the architecture, because the
architecture does not say where the scope comes from at enumeration time.

---

## 7. Scope honesty — what S1C does NOT claim

### VC-C2

S1C implements the enumeration **semantics**: the real READ surface, `context_spec`
projection (runtime half of `I52`), resource-scope behaviour that does not leak existence,
and content-addressed options.

It does **not** implement:

- a durable READ journal row with `journal_row_kind = READ`;
- `journal_seq` allocation, gap-freedom or chaining;
- the audit mirror;
- a per-principal quota or rate limit.

Those belong to a journal/control slice. **No in-memory journal is built to print PASS.** The
result therefore reports:

```
VC-C2 enumeration semantics: PASS
VC-C2 journaling/quota: OPEN
Full VC-C2: PARTIAL
```

The `enumeration_record` table is named in the result as the **staleness/lineage substrate**
and is explicitly disclaimed as a journal.

### VC-C3

S1C targets the core: exact content-addressed identity, C′ live re-enumeration, stale option
denies, no substitution, stale enumeration denies, malformed pair denies, and the positional
negative control substituting.

The lock clause — *"held for the duration of the propose→authorise→execute span"* — is proven
only as far as the span exists. The result states exactly what is proven and does not claim
VC-C3 fully closed on a span whose later steps are unbuilt.

---

## 8. Explicitly out of scope

Not built, not stubbed, not partially wired: Cedar · grants and policy matching ·
`per_action_max` · reservation integration · real effect dispatch · the outbox ·
Shopify/Stripe or any real vendor · the approval state machine · the audit mirror · AI agents ·
the AI CEO · production enumeration quota · a production READ journal.

Adjacency is not a reason. S1C stops at the end of S1C.

---

## 9. Changes to accepted S1B files, and why each is admissible

| File | Change | Justification |
|---|---|---|
| `errors.ts` | add `SELECTOR_STALE`, `SELECTOR_ENUMERATION_STALE`, new audit-side details | S1B's own header names this increment as the one that adds them; both are declared by `26 §7`'s C′ row |
| `registry.ts` | `RegisteredConstructor` gains `optionDescriptionFields` | the per-class description projection must hang off the registration for the same reason the digest does — S1B.2 finding 6. The core stays class-agnostic |
| `types.ts` | `AuthoritativeCanonicalisationContext` gains `contextSpec` | the projection is `context_spec`-governed (`I52`) and the spec is kernel-owned. It is a `KernelComputed` field like every other one; `I21` does not move |
| `constructors/refundCreate.ts` | the ad-hoc `description` template is replaced by the shared projection | the mandate forbids two description paths. The five digest fields are **untouched** |
| `canonicaliser.ts` | none to its checks or ordering | live resolution is a boundary around it, not a change to it |

No field is added to `ProposedIntent`. No field crosses `I21` that did not cross it before.
The declared five-field `refund.create` digest is unchanged.

---

## 10. Result form

`S1C-result.md` returns exactly one of `S1C PASS — LIVE SELECTOR CORE ACCEPTED`,
`S1C CONDITIONAL — LOCAL REPAIR REQUIRED`, or `S1C FAIL — RETURN TO ARCHITECTURE`, and
answers the mandate's fifteen questions explicitly.
