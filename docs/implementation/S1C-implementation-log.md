# S1C Implementation Log

What was built, what was got wrong on the way, and what each repair cost. The two findings in
§2 and §3 were produced by S1C's own tests failing on first run; the record shows them rather
than quietly presenting the repaired code as the first draft.

---

## 1. What was built

| Component | File |
|---|---|
| the injected clock | `src/kernel/enumeration/clock.ts` |
| the task `context_spec` and the ONE description projection | `contextSpec.ts` |
| the entity execution lease — `25 §14`'s lock, session-scoped | `entityLease.ts` |
| the per-class enumeration port | `port.ts` |
| authoritative RECORD-grade commerce state | `commerceState.ts`, `src/db/migrations/0005__commerce_state.sql` |
| two-dimensional `refund.create` enumeration | `refundEnumeration.ts` |
| `EnumeratedOptionSet` | `enumeratedOptionSet.ts` |
| the staleness/lineage substrate | `enumerationRecord.ts` |
| the class `max_age` fixture | `enumerationMaxAge.ts` |
| the `enumerate_effects` READ core | `enumerateEffects.ts` |
| step C′'s live-selector boundary | `liveSelector.ts` |
| the coarse worker-facing denial projection | `workerFacingDenial.ts` |

Five S1B files changed, each additively and each named in `S1C-contract.md` §9:
`errors.ts` (the two C′ denial codes S1B recorded as absent), `registry.ts` (two per-class
operations moved off a core), `types.ts` (`contextSpec` on the authoritative context),
`constructors/refundCreate.ts` (the ad-hoc description replaced by the shared projection, five
digest fields untouched), and — in tests — three guards that S1C's additions were supposed to
move.

`canonicaliser.ts` was **not** touched. Live resolution is a boundary around the accepted core,
not a change to it.

---

## 2. FINDING — the refusal path's `enumeration_id` was an existence oracle

**Found by:** `enumeration-scope.test.ts`, "all three are byte-identical at the model-facing
surface", failing on its first run.

**What was wrong.** `computeEnumerationId` committed to the resolved `resource_id`. That value
does not exist when the resource does not resolve, so the refusal path substituted empty
strings for the fields it could not fill. The consequence:

- an **out-of-scope, absent or non-RECORD** resource produced ONE shared `enumeration_id`, the
  same for every such reference;
- an **in-scope, RECORD-grade, legitimately empty** resource produced a per-resource one.

Two probes and a comparison therefore separated "exists, in scope, nothing currently
refundable" from "out of scope, absent, or not RECORD grade". `36 §2` VC-C2 requires an empty
set *"rather than a denial that leaks existence"* — and the leak had simply moved out of the
option list and into the identifier beside it.

**Why the first test would not have caught it.** The original assertion compared three
*different* `resource_ref`s against each other. The model chose those refs, so of course it can
tell them apart; comparing them proves nothing. The property VC-C2 actually needs is that for
**one** reference the model cannot tell which condition it is in.

**The repair, in two parts.**

1. `resource_id` is out of the `enumeration_id` preimage. `resource_ref` — a value the model
   supplied, known on every path — takes its place. Nothing is lost: `resource_ref` is UNIQUE
   per order by constraint, the resolved `resource_id` is still on the `enumeration_record` row,
   and C′ still checks it there.
2. `#empty` builds its id from the **real** company, task, principal, class and `resource_ref`,
   a real `computed_at` and the real verified `constructor_version`. Nothing on that path is a
   sentinel any more.

**The test was rewritten to the stronger form.** One order is driven through all four
conditions — legitimately empty, absent, not RECORD grade, out of scope — and every returned
field must match.

**Cost.** One field out of a digest preimage; no behaviour change on the success path.

**What it says about the class of defect.** The empty list was never the whole control. Every
*other* field of a refusal has to be what a legitimate empty enumeration would have produced,
or the refusal is distinguishable by something adjacent to the list. That generalises beyond
the id, and it is why `#empty` now carries a comment saying so.

---

## 3. FINDING — the description equality was a recomputation compared with itself

**Found by:** `context-spec-projection.test.ts`, "a description difference is a THROWN DEFECT",
failing on its first run — the boundary did **not** throw.

**What was wrong.** The mandate requires that *"the AuthorizationRequest must record the exact
projected authoritative description corresponding to the option the model saw"* and that *"no
separately reconstructed description may drift from it."*

The first implementation satisfied the letter of that by having one projection function and
calling it from both places. But both calls take the same authoritative option **and the same
`context_spec`**, so:

- the constructor's description and the live re-projection are equal **by construction**;
- a `context_spec` that changed between the READ and C′ moves **both halves together**;
- the request then records a description the model never saw, and the check cannot notice.

`context_spec`s are versioned control artifacts (`23 §5` B9). A deploy between a worker's read
and its proposal is exactly how they change under a running system, so this is not an exotic
scenario.

**The repair.** The projected descriptions are **recorded** at enumeration time. The
`enumeration_record` row stores `[{option_id, description}]` rather than `[option_id]`, the
`enumeration_id` commits to both halves, and C′ compares the emitted description against the
**stored** string — the one the model actually read.

The assertion now spans three provenances rather than two:

| String | Comes from |
|---|---|
| `effect.request.selectedOption.description` | the CONSTRUCTOR, through the shared projection |
| `modelFacing.description` | the LIVE re-enumeration's projection |
| `recorded.description` | the kernel's record of what was RETURNED |

The first two share inputs; only the third is independent, and it is the one that makes this an
assertion rather than a tautology.

**A second check fell out of it.** Because the record now lists the options it returned, C′ can
also refuse an `option_id` that is live but was **not** in the enumeration the selector names —
`SELECTOR_INVALID` / `OPTION_NOT_IN_NAMED_ENUMERATION`. Before the repair the enumeration and
the option were only weakly related; now the pair is checked in both directions.

**Cost.** One JSONB column shape; one extra lookup at C′.

---

## 4. The lock-duration decision, written out

The S1C mandate rejects a specific shape:

> Do NOT implement a helper that: acquires the advisory lock; re-enumerates; releases it
> immediately; returns a canonical request; and then claim the complete concurrency property.

A transaction-scoped advisory lock **is** that helper under a different name.
`pg_advisory_xact_lock` is released by `COMMIT`, and `26 §7` puts step S — which may wait on a
human for hours — and step W after C′. So a component taking one and claiming
propose→authorise→execute would be asserting a property its own mechanism forbids.

The lease is therefore a **session** lock on a dedicated pooled connection, released explicitly
in a `finally`, with the lease's own client handed to the callback so downstream work runs on
the connection that holds it.

Two things make the lifetime a property of the *type* rather than of call-site ordering:

- there is no `acquire()` that returns a lease for the caller to release — the only way to hold
  one is `withEntityLease`, whose `finally` releases it;
- every operation that must happen under the lock takes a `HeldEntityLease` **argument** and
  calls `assertHeld(key)`, which checks both that it is still held and that it covers **this**
  entity. Without the key check, any lease at all would satisfy every assertion in the tree.

`entity-lease.test.ts` asserts both directions — held during C′, free after release — because a
test asserting only "held" would pass against an implementation that never releases.

**What is proven and what is not** is stated plainly in `S1C-result.md` question 6. The finished
span does not exist yet; the shape that can carry it does.

---

## 5. Keeping the cores class-agnostic

S1B.2 finding 6 moved the per-class digest and the per-class cohesion checks onto the
registration so that adding a class would not edit `EffectCanonicaliser`. S1C had two chances
to undo that and took neither:

| Per-class thing | Reached through |
|---|---|
| `semantic_option_digest` | `registered.computeSemanticOptionDigest` (S1B) |
| input cohesion | `registered.assertInputCohesion` (S1B) |
| description candidate fields | `registered.optionDescriptionFields` (S1C) |
| state resolution + enumeration | `registered.liveEnumerator` (S1C) |

`enumerateEffects.ts` and `liveSelector.ts` import no refund module, name no commerce table and
contain no `refund.create` branch. `source-rules.test.ts` already asserts the equivalent for the
canonicaliser core.

The description split is worth naming separately: a constructor declares **candidate fields**
and never renders a string. A constructor that returned finished prose could embed a field the
`context_spec` withholds, and `I52`'s *"enforced by a projection filter at runtime"* would then
be enforced by that file remembering to consult the spec.

---

## 6. Things deliberately NOT done

| Not done | Why |
|---|---|
| the per-action-cap bound on enumeration (`26 §2.1.1`: `per_action_max − Σ cost_components`) | `per_action_max` comes from a matching grant; grant matching is Cedar; the mandate excludes Cedar, grants and `per_action_max` by name. A fixture cap here would invent the input the exclusion defers. `26 §8`'s cap is a POLICY denial, not an enumeration filter. |
| a READ journal row, `journal_seq`, chaining, the mirror | the mandate: "Do not build a fake in-memory journal merely to print PASS." Reported OPEN. |
| a per-principal enumeration quota | same. No deterministic substrate for it already exists, so building one would be scope expansion. |
| the `I52` CI spec-review half | not implemented, and the result says so rather than claiming `I52` whole. |
| an index compatibility layer | the mandate forbids it; its absence is asserted three ways (wire, type, source scan). |
| widening the five-field `refund.create` digest | `26 §2.1.2` makes a digest change semantic by definition. Untouched. |
| `CONSTRUCTOR_SEMANTIC_CHANGE` | the approval-resume denial; there is no approval state machine. |

---

## 7. Where the S1C tree would break first

Honest answers, for whoever takes the next increment.

1. **The `enumeration_record` table is not the journal, and something will eventually treat it
   as one.** It has the columns a lineage reader wants and none of the guarantees a journal
   gives. The module header and the migration comment both say so; the risk is that a later
   slice adds `journal_seq` to it rather than building the real row.

2. **`resolveResource` is per class, and resource resolution across classes is unexplored.**
   `refund.create` resolves an order. A campaign class resolves a campaign. Whether those share
   an entity-key namespace — the lease's `entityType` — is not settled by S1C, and the lease
   key would need it to be.

3. **A `context_spec` change between the READ and C′ THROWS.** That is fail-closed and correct
   for S1C, but a running system with versioned `context_spec`s will hit it, and the right
   answer is probably a denial with a `RemedyObligation` like `26 §12`'s
   `CONSTRUCTOR_SEMANTIC_CHANGE` rather than an internal defect. S1C does not invent that
   because `I58`'s `RemedyObligation` machinery does not exist yet.

4. **The advisory-key space is 64 bits with no collision handling.** A collision costs mutual
   exclusion between two unrelated entities — availability, never correctness — and the
   alternative adds a second money-path lock order. Recorded rather than solved.

5. **`enumerate_effects` takes the entity lease.** For a READ that is stronger than necessary
   and will serialise enumeration behind any in-flight span for the same entity. It is the safe
   direction and it matches `24 §3` K4's "under the existing entity advisory lock", but a
   throughput-shaped slice may want to revisit it.
