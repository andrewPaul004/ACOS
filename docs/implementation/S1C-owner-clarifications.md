# S1C Owner Clarifications

Decisions S1C had to make that the architecture package does **not** determine. Each is
recorded as an **implementation fixture**, not as a reading of the architecture. None of them
appears anywhere in this increment as an architecture claim.

The same discipline S1B applied to S1B-C3a (the retained fee) and S1B-C6 (the reason-code
enum): where the package establishes that a thing must exist and does not say what its value
is, the implementation declares a fixture and says so.

---

## S1C-C1 — the commerce-state schema shape

**What the architecture determines.** `26 §8` and `24 §3` K4 fix the *dimensions* a refund
enumeration reads: `(line, parent_transaction)`, the "remaining maximum per item", the
instrument, and the RECORD grade of the order. `26 §2.2` fixes the five fields the semantic
option digest covers.

**What it does not.** It prints no DDL, no column names, no key structure and no table count.

**S1C's fixture.** `src/db/migrations/0005__commerce_state.sql`:

| Table | Holds |
|---|---|
| `commerce_order` | `resource_ref`, `order_id`, `grade`, `currency`, `customer_novelty` |
| `commerce_order_line` | `line_id`, `refundable_remaining` |
| `commerce_parent_transaction` | `parent_transaction_id`, `instrument`, `refundable_remaining` |
| `commerce_refund_retained_fee` | `amount`, `currency`, `source_ref` per `(line, parent_transaction)` |

This is the **minimum** authoritative state the architecture's own enumeration reads. It is
not a commerce model, not a Shopify or Stripe schema, and not a claim about what a real
integration needs. A real adapter slice will populate these same fields from a vendor record
without touching the money path.

---

## S1C-C2 — the retained fee is a STORED AMOUNT, per `(line, parent_transaction)`

**Why it is not derived.** S1B-C3a, verbatim:

> The architecture establishes that a refund may carry a retained processing fee and that the
> discriminating fixture is `$25.00 / $1.03 / $26.03`. It establishes no rate, no fixed
> charge, no rounding rule and no processor fee schedule, and an implementation may not
> invent an economic rule because the rule reproduces a fixture.

S1C holds to that exactly. `commerce_refund_retained_fee` stores an **amount** and the
**source reference** of the record it came from. There is no rate, no percentage and no
rounding rule anywhere in the S1C tree.

**The consequence, and it is deliberate.** A `(line, parent_transaction)` pair with **no** fee
record is **not enumerated at all** — rather than enumerated with a zero fee. `26 §2.1.1`:

> a developer resolving the contradiction by driving `cost_components` to zero silently
> restores the v1.0 defect R1 exists to close

The catalogue does not declare `refund.create` cost-component-free, so an option whose
authoritative fee is unknown is an option whose `total_exposure` is unknown. The honest
treatment of an unknown economic exposure is to refuse to offer the effect.

**Fixture values.** `$0.59` on line A and `$0.88` on line B — deliberately *different*, so a
test cannot pass by symmetry against an implementation that reads the wrong row.

---

## S1C-C3 — the `context_spec` admitted description-field set

**What the architecture determines.** `26 §2.0.1` and `I52` require the projection filter and
require that no field outside the admitted set appear in any description.

**What it does not.** It enumerates no field set for any class.

**S1C's fixture.** The candidate fields `refund.create` offers are declared in
`refundOptionDescriptionFields`:

```
amount · currency · line · parent_transaction · instrument · refundable_remaining
```

and the S1C task fixture admits all six. `refundable_remaining` is admitted **and** withheld
by a narrowed fixture spec, because `I52`'s runtime half is only testable against a spec that
withholds something the candidate list offers.

**A closed default.** A class absent from a `context_spec`'s admitted map admits **nothing**,
so a spec that forgot to declare a class produces empty descriptions rather than full ones.
That is the direction a field-visibility control must fail in.

---

## S1C-C4 — `max_age = 120 seconds` for `refund.create`

**What the architecture determines.** `26 §2.0.1` puts `computed_at` on the option set "for
the class's `max_age` check at C′". `26 §7`'s C′ row requires `SELECTOR_ENUMERATION_STALE`
when it is exceeded. `36 §2` VC-C3 requires the denial to be asserted.

**What it does not.** No document in the package selects a duration. `51-limits-fixture.md`
prints none.

**S1C's fixture.** `ENUMERATION_MAX_AGE_SECONDS['refund.create'] = 120`, declared in
`src/kernel/enumeration/enumerationMaxAge.ts` with the provenance written into the module
header. **Nothing in S1C states that the architecture chose 120 seconds.**

Selecting the production duration is a real trade-off — too long and a model reasons about a
world that has moved; too short and every proposal denies behind ordinary latency — and it
belongs to whoever owns `51-limits-fixture.md`.

**A total table, deliberately.** All four catalogue classes carry a value even though three
have no registered constructor. A lookup that could return `undefined` would make the
staleness check silently unbounded for a class someone later registers, and *"the check was
skipped because the table had no row"* is the shape of failure a staleness control must not
have.

---

## S1C-C5 — `reason_code_scope` comes from the TASK, not from a third enumeration dimension

**The tension.** `refund.create`'s `semantic_option_digest` includes `reason_code_scope`
(`26 §2.2`), but `enumerate_effects(action_class, resource_ref)` takes no reason code
(`26 §2.0.1`). Enumerating the cross product over every scope would make the enumeration
three-dimensional, contradicting `26 §8`'s *"two-dimensional over `(line,
parent_transaction)`"*.

**S1C's fixture.** The scope is a field of the task's `context_spec` — kernel-owned, part of a
control artifact (`23 §5` B9), never a model input. S1B's existing cohesion check then does
exactly the work it was written for: a proposed `reason_code` whose scope differs from the
selected option's denies `SELECTOR_INVALID` (S1B.2 finding 1D).

**Why this is recorded rather than asserted.** The architecture does not say where the scope
comes from at enumeration time. A different resolution — a per-scope enumeration, or a scope
carried on the `resource_ref` — would also be defensible. S1C picks one, records it, and does
not claim the package chose it.

---

## S1C-C6 — the `enumeration_id` preimage

**What the architecture determines.** `26 §2.0.1`: `enumeration_id` is *"opaque, journaled"*
and *"names one EnumeratedOptionSet the kernel computed"*.

**What it does not.** How the kernel derives it.

**S1C's fixture.** Content-addressed over
`(company, task, principal, action_class, resource_ref, computed_at, constructor_version,
ordered [option_id, description] pairs)`.

Opacity is a property of what the *model* can do with the value, not of how the kernel derives
it, so a deterministic derivation is admissible and is strictly better than a random id: an id
cannot be transplanted between tasks, principals, classes or resources, and a recorded
enumeration whose option set or whose rendered descriptions were altered no longer hashes to
its own id.

**It is not a capability token, and is not treated as one.** Presenting a well-formed id
proves nothing: C′ looks the row up and checks every bound field against the intent.

**One field is deliberately absent, and S1C found out why by test.** The resolved
`resource_id` is **not** in the preimage. See `S1C-implementation-log.md` §2 — including it
made an unenumerable resource's id structurally different from a legitimately-empty one's,
which rebuilt the existence oracle VC-C2 exists to close, inside the identifier.

---

## S1C-C7 — the returned `EnumeratedOptionSet` shape

**The architecture prints two.** `26 §2.0.1`:

```
EnumeratedOptionSet { enumeration_id, computed_at, constructor_version,
                      options[{ option_id, description }] }
```

`24 §3` K4 additionally prints `action_class`, `resource_ref` and `max_age`.

**S1C returns the narrower one** — `26 §2.0.1`'s, which is also the shape the S1C mandate
declares — and holds `max_age` kernel-side in `enumerationMaxAge.ts`.

This is strictly *less* information at the model boundary, which is the safe direction for a
capability `26 §2.0.1` itself calls *"the highest-value surface in the architecture — the one
that tells a compromised model exactly what is currently permitted against which resource"*.
The difference is recorded here rather than resolved silently.

---

## S1C-C8 — the entity lock is SESSION-scoped, not transaction-scoped

**What the architecture determines.** `25 §14`: an advisory lock on
`(company_id, entity_type, entity_id)` **"for the duration of the propose→authorise→execute
span"**.

**What it does not.** Which PostgreSQL advisory-lock family to use.

**S1C's decision, and it is forced by the requirement rather than chosen.**
`pg_advisory_xact_lock` is released by `COMMIT`, so it is structurally incapable of spanning
propose→authorise→execute: `26 §7` puts step S (approval, which may wait on a human) and step
W (dispatch) after C′. A component taking a transaction lock and claiming that span would be
asserting a property its own mechanism forbids — the exact shape the S1C mandate names and
rejects.

So the lease is `pg_advisory_lock(k1, k2)` on a dedicated pooled connection, released
explicitly in a `finally`. `tests/integration/enumeration/entity-lease.test.ts` proves it
survives a `COMMIT`, which is the property that distinguishes the two.

**The key derivation** is a SHA-256 over the three key components with 4-byte length framing,
read as two signed int32s. The framing prevents `('co','order','X')` colliding with
`('co','orderX','')`. A 64-bit space is not collision-free and S1C does not pretend it is: a
collision costs mutual exclusion between two unrelated entities — availability, never
correctness — and the alternative (a lock table with its own rows and its own ordering) would
add a second money-path lock order, which `30 §5.2` is emphatic there must not be.

---

## S1C-C9 — `enumeration_record` is the staleness/lineage substrate, NOT the READ journal

**Why the table exists at all.** `26 §7` C′ must check `computed_at` against `max_age`. The
only two places that figure can come from are kernel state and the proposer, and `26 §1`
Corollary 3 settles it: *"the request must be built by the ceiling's enforcer, not by its
subject."* A staleness check reading a timestamp its subject supplied is not a staleness
check.

**What it deliberately is not.** `26 §2.0.1`'s journaling row requires a READ journal row that
*"takes a `journal_seq`, it chains, it mirrors"*. The table has none of that: no `journal_seq`,
no chain hash, no audit mirror, no quota.

The S1C mandate: *"Do not build a fake in-memory journal merely to print PASS."* A durable
table wearing journal column names without the sequence, the chain and the mirror would be the
same mistake with a longer half-life, so the columns are absent and the module header says so
in as many words. `S1C-result.md` reports **VC-C2 journaling/quota: OPEN**.

---

## S1C-C10 — the projected descriptions are STORED on the enumeration record

Not a fixture decision so much as a repair, recorded here because it changed a stored shape.

`26 §2.1` requires the request to record *"the enumerated option whose `option_id` the selector
names, **with its full description**"*. "The enumerated option" means the one the model
actually read.

The record therefore stores `[{option_id, description}]`, not `[option_id]`, and C′ compares
the emitted description against the **stored** string. Comparing against a live re-projection
instead would have been a recomputation compared with itself: both halves share the same
`context_spec` and the same option, so a spec that changed between the READ and C′ would move
both together and record a description the model never saw.

The full account, including the test that drove it, is in `S1C-implementation-log.md` §3.
