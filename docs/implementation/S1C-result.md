# S1C Result — Live Enumeration + Content-Addressed Selector Integrity

**Branch:** `feature/s1c-live-enumeration`, from `17a6fdd` (accepted S1B HEAD).
**Architecture package:** `docs/architecture/v1.3.1/` — **unmodified in every respect.**

---

## Verdict

```text
S1C PASS — LIVE SELECTOR CORE ACCEPTED
```

| Gate | Result |
|---|---|
| Baseline at branch creation | **490/490, exit 0** — clean tree, HEAD `17a6fdd` |
| `npm run verify` at S1C HEAD | **590/590, 46 files, exit 0** |
| Accepted S1A/S1B tests | **490/490, none removed, none weakened** |
| VC-C3 core | **PROVEN** — denies, never substitutes |
| Mandatory positional negative control | **SUBSTITUTES**, as required |

Two defects were found by S1C's own tests failing on first run — an existence oracle in the
`enumeration_id`, and a description equality that was a recomputation compared with itself.
Both are repaired, both repairs are tested, and both are written up in
`S1C-implementation-log.md` §2 and §3 rather than presented as first drafts.

---

## The fifteen questions, answered

### 1. Is enumeration genuinely content-addressed?

**Yes.**

`option_id = H(action_class ‖ resource_id ‖ semantic_option_digest)`, computed through the
**registered constructor's** digest — the same call `EffectCanonicaliser` makes, so there is
exactly one `refund.create` digest in the tree. The five declared fields (`26 §2.2`) are
unchanged from S1B and asserted field by field.

The discriminating evidence is not that the ids are hashes but that **position is not
identity**: `enumerate-effects.test.ts` §3 deletes the line and fee rows and reinserts them in
the opposite physical order — changing the heap order, which would move any position-derived
identity — and every `option_id` is unchanged.

And the second dimension is real: a 2×2 order yields **four** options, and the same line
against two parent transactions yields two **different** `option_id`s at the same amount
(`26 §8`: "instrument is enumerated, not asserted").

### 2. Can a positional selector be expressed in production?

**No — at three layers, and the absence is asserted rather than assumed.**

| Layer | Evidence |
|---|---|
| wire | `selector: 4`, `selector: {index: 4}`, `selector: '4'`, `selector: ['a','b']`, and a well-formed pair *carrying* an index all deny `SELECTOR_MALFORMED`. Accept-and-ignore is prohibited: the extra field is rejected, never dropped. |
| type | `tests/type-negative/positional-selector.ts` — an ordinal is not a `ProposedSelector` (TS2322); `index` has no position on the pair (TS2353); neither can be smuggled onto a `ProposedIntent` (TS2322). |
| source | no `src/` module reads `selector[n]`, `selector.index`, `Number(selector)` or `parseInt(selector)`; `ProposedSelector` declares exactly two string members. |

**No index compatibility layer exists**, as the mandate requires.

CAN-05's `O(log n)` binary search is closed at the response as well: the probes `2^k` for
k ∈ {0,1,2,4,8,16,1024, 2²⁰} produce **one** distinct worker-facing value, and an ordinal is
indistinguishable from a well-formed but wrong pair.

### 3. Does CAN-03 substitute under the unsafe positional negative control?

**Yes. Observed:**

```
EXPECTED SUBSTITUTION OBSERVED — positional selector 0 dispatched line:ORD-123:B at 20.00
after line:ORD-123:A at 10.00 was selected
```

`tests/negative-controls/unsafe-positional-selector.ts` uses the **same** enumerator, the
**same** entity lease, the **same** enumeration record, the **same** `max_age` check and the
**same** accepted S1B canonicaliser. **One line differs**:
`live.authoritative[intent.selector]`.

v1.1's bounds check is retained faithfully — and a second test shows it firing for index 1,
which is `26 §2.0.1`'s "benign case" and precisely why v1.1 looked adequate.

The substitution occurs with **every other control intact**: `I18a` holds (the dispatched
monetary effect equals `vendor_amount` — for the wrong line), a complete
`dispatch_payload_hash` is emitted, `$10.00` was selected and `$20.00` was dispatched. That is
`26 §2.0.1`'s finding reproduced: *"The executed effect was economically different from the
selected one and no invariant fired."*

**No production code was weakened to produce it.**

### 4. Does production deny rather than substitute?

**Yes.** `DENY: SELECTOR_STALE` / `OPTION_ABSENT_FROM_LIVE_SET`, **no effect constructed**, no
reservation row, journal counter unmoved. B's `option_id`, line id and amount appear nowhere in
the denial.

Three controls stop that being "denies everything":

- with A still live, the same intent canonicalises **A**, at `$10.00`, `total_exposure`
  `$10.59`;
- selecting **B** after A is exhausted **succeeds** — so the denial is about IDENTITY, not
  about the set having changed;
- the live set is asserted to have genuinely become `[B: $20.00]` before C′ runs, so the denial
  cannot come from an empty set or a failed read.

`I53` is asserted rather than assumed: the boundary **throws** if the emitted
`selected_option.option_id` is not the selected one — registry `I53` calls that a critical
incident, and no `ProposedIntent` can cause it.

### 5. Is the selected option re-enumerated under the entity lock?

**Yes, and proven from a second session.**

`canonicaliseUnderLease` takes a `HeldEntityLease` and asserts it — first for the company, then
for the **full** `(company, entity_type, entity_id)` key the moment the resource id is known,
before a single option is read. Re-enumeration runs on the **lease's own client**, so
`25 §14`'s "fetches authoritative state under the entity advisory lock" is a property of the
call rather than of call-site ordering.

`entity-lease.test.ts` §16 parks the holder immediately after re-enumeration and takes a
non-blocking reading from a separate session: the lock is **not free** during C′ and **is free**
after release. Both directions, because a test asserting only "held" would pass against an
implementation that never releases.

**The caller cannot hand C′ an option.** `canonicaliseUnderLease` has no option parameter, no
overload and no optional argument. The option is found in the live set by its own content
address, or the call denies.

### 6. Is the lock lifetime compatible with the future propose→authorise→execute span?

**Compatible in shape — and NOT claimed as the finished span.**

The lease is a **session-level** `pg_advisory_lock`, not `pg_advisory_xact_lock`, precisely
because the latter is released by `COMMIT` and is therefore structurally incapable of spanning
`26 §7`'s step S (which may wait on a human) and step W.

**Proven:**

- the lease survives a real `BEGIN … COMMIT` on its own connection — the property a
  transaction lock cannot have;
- it is still held inside a **fake downstream callback** standing in for authorise/execute,
  which receives the lease and the lease's client;
- a second work item **waits** rather than proceeding on stale state (`25 §14`), while a
  different entity is not blocked;
- release is **explicit**, happens even when the span throws, and a released lease is inert —
  `assertHeld` throws and re-enumeration through it is refused.

**Not proven:** the finished span, because steps M, R, S and W do not exist. **No policy runs
in the callback**, as the mandate requires.

So: the lease can carry the span; S1C has not carried it, and does not say it has.

### 7. Can an out-of-scope resource leak its existence through enumeration?

**No — and the first implementation could, which is why this answer is worth reading.**

`36 §2` VC-C2 requires an empty set "rather than a denial that leaks existence". S1C extends
that to all three unenumerable conditions, because distinguishing any **pair** rebuilds the
oracle: out-of-scope · absent · not-RECORD-grade all return an empty set, and the internal
reason is retained only for the later audit layer.

**The first version leaked through the identifier.** `enumeration_id` committed to the resolved
`resource_id`, which does not exist on a refusal — so refusals shared one id while a
legitimately-empty enumeration got a per-resource one, and two probes separated them. Found by
`enumeration-scope.test.ts` failing; repaired by dropping `resource_id` from the preimage and
building the refusal id from the same real inputs the success path uses.
`S1C-implementation-log.md` §2.

**The discriminating test** drives ONE order through all four conditions — legitimately empty,
absent, not RECORD grade, out of scope — and asserts an identical `enumeration_id`, option
list, `constructor_version` and `computed_at`. Comparing different `resource_ref`s, as the
first test did, proves nothing: the model chose them.

`ORDER_EXISTS_BUT_OUT_OF_SCOPE` or any equivalent appears **nowhere** on the worker surface,
and `EnumeratedOptionSet` has no field that could carry it.

Residual, and it is the architecture's own: `26 §2.0.1` says the enumeration "remains an
information channel" bounded by the `context_spec` **plus the quota**. S1C has the
`context_spec`. **It does not have the quota** — see question 12.

### 8. Can `context_spec`-hidden fields appear in descriptions?

**No.** `I52`'s runtime half, enforced by one projection filter with no per-class branch.

- a constructor declares **candidate fields** and never renders a string, so it cannot render
  past the filter;
- a withheld field's **name and value** both disappear — no placeholder marks the absence,
  because "this option has a field you may not see" is itself information;
- the structural assertion is that emitted field names ⊆ admitted set, taken from the same
  filter the renderer uses rather than by re-parsing the output, across four different specs;
- the default is **closed**: a class absent from a spec's admitted map produces empty
  descriptions, not full ones;
- rendering order is the constructor's declared order, so a spec edit that reorders a set
  cannot reorder a description.

**The CI spec-review half of `I52` is NOT implemented and is NOT claimed.**

### 9. Is the description recorded on the AuthorizationRequest the same authoritative projected description the model saw?

**Yes — and the first implementation only appeared to guarantee it.**

The mandate requires the recorded description to be the one **the model saw**. Having a single
projection function called from both places does not achieve that: both calls take the same
option and the same `context_spec`, so a spec that changed between the READ and C′ moves both
halves together and records a description the model never saw.

**The repair:** the projected descriptions are **stored** on the enumeration record —
`[{option_id, description}]` — the `enumeration_id` commits to both halves, and C′ compares
against the **stored** string. The assertion now spans three provenances, only one of which is
independent, and that one is the model's actual read.

A changed `context_spec` between the READ and C′ now **throws** rather than silently recording
a different description. Found by `context-spec-projection.test.ts` failing;
`S1C-implementation-log.md` §3.

A second check fell out of it: an `option_id` that is live but was **not** in the enumeration
the selector names denies `SELECTOR_INVALID` / `OPTION_NOT_IN_NAMED_ENUMERATION`.

And a description is **not** part of option identity (`26 §2.1.2` classes `description_string`
non-semantic), so narrowing a spec changes descriptions and moves no `option_id` — otherwise
every `context_spec` deploy would invalidate every outstanding selector.

### 10. Does stale enumeration age deny?

**Yes.** `SELECTOR_ENUMERATION_STALE` / `ENUMERATION_PAST_MAX_AGE`, from an **injected clock**.
No sleeps anywhere in the S1C tests.

- one second past `max_age` denies;
- **exactly at** `max_age` still permits — the boundary is `>`, asserted, so the test cannot
  pass against an implementation that denies everything older than zero;
- the enumeration is **not silently reissued**: no new record appears and the stored
  `computed_at` is unmoved. A successful C′ writes no second record either — `reEnumerate` mints
  no `enumeration_id`.

`computed_at` comes from the kernel's own record, never from the proposal — `26 §1` Corollary 3.

`max_age = 120s` is an **S1C implementation fixture** (S1C-C4), declared as one in the module
header and in the clarifications. **Nothing in this increment claims the architecture chose it.**

### 11. Can raw audit detail leak to the worker?

**No.** This closes S1B's carried-forward denial-transport note.

`projectDenialToWorker` returns a **frozen object with exactly one field**, built from `code`
alone. All 4 × 13 selector code/detail combinations produce **one** distinct response,
`{ deny: 'SELECTOR' }`.

- the returned value is a different object, and not an `Error`;
- neither `message` nor `auditNote` nor `detail` survives — asserted by string, including the
  audit note's own text, which `Error.message` embeds by construction;
- no near-miss word (`count`, `index`, `nearest`, `exceeded`, `remaining`, `options`) appears;
- the object is frozen, so a caller cannot decorate it on the way out;
- the audit detail is still **intact on the exception** — coarseness at the worker is not
  information loss at the audit layer;
- structurally: nothing in `src/` outside `workerFacingDenial.ts` reads `.auditNote` or a
  denial `.message`, and the projection reads **only** `code`.

An **internal defect** (an `I18a`/`I18c` violation, a cohesion throw) is **rethrown**, not
swallowed into `DENY: SELECTOR` — registry `I18a` calls those critical incidents, and hiding one
behind the commonest denial in the system would be the wrong kind of coarseness.

Only the selector family collapses. `MALFORMED`, `UNKNOWN_ACTION` and `NOT_CANONICALISABLE`
stay distinct, as `26 §7` declares them. **S1C does not implement every policy denial mapping.**

### 12. Is VC-C2 FULL or PARTIAL?

```text
VC-C2 enumeration semantics: PASS
VC-C2 journaling/quota: OPEN
Full VC-C2: PARTIAL
```

**Implemented:** the real READ surface over authoritative RECORD-grade state; `context_spec`
projection (`I52` runtime half); resource-scope behaviour that does not leak existence;
content-addressed options; the coarse `DENY: SELECTOR` category that closes CAN-05's probing
oracle; verified `constructor_version` on the READ.

**Not implemented:** a durable READ journal row with `journal_row_kind = READ`; `journal_seq`
allocation, gap-freedom and chaining; the audit mirror; a per-principal rate limit.

**`enumeration_record` is NOT that journal, and S1C does not claim it is.** It is the
staleness/lineage substrate: `26 §7` C′ must check `computed_at`, the only alternative source
is the proposer, and `26 §1` Corollary 3 forbids that. It has no `journal_seq`, no chain hash,
no mirror and no quota; the module header and the migration comment both say so. No in-memory
journal was built to print PASS.

### 13. Is VC-C3 FULL or PARTIAL?

```text
VC-C3 selector integrity core: PASS
VC-C3 lock clause (propose→authorise→execute span): PARTIAL
Full VC-C3: PARTIAL
```

**Proven, item by item against the mandate's §17 list:**

| VC-C3 core requirement | Status |
|---|---|
| exact content-addressed identity | **PASS** |
| C′ live re-enumeration | **PASS**, under a held lease, from the lease's own connection |
| stale option denies | **PASS** — `SELECTOR_STALE` |
| no substitution | **PASS** — no effect constructed, B never selected |
| stale enumeration denies | **PASS** — `SELECTOR_ENUMERATION_STALE`, injected clock |
| malformed pair denies | **PASS** — `SELECTOR_MALFORMED`, every ordinal form |
| positional negative control substitutes | **PASS** — `EXPECTED SUBSTITUTION OBSERVED` |
| `semantic_option_digest` changes per declared field | **PASS** — S1B's matrix retained, extended |

**Partial only in the lock clause**, and the mandate anticipates exactly this: *"If the lock
cannot be retained in a shape compatible with the future propose→authorise→execute span, do not
claim VC-C3 fully closed. Report exactly what is proven."*

The lock **can** be retained in that shape — session-scoped, surviving `COMMIT`, surviving a
downstream callback, explicitly released — and the span itself does not exist to be held,
because steps M, R, S and W are unbuilt. That is the whole of the gap.

### 14. Did any S1A/S1B property regress?

**No.** 490/490 accepted tests green, unchanged.

Three accepted **test guards** were widened, each one a guard S1C's additions were supposed to
move, and each an exact-set assertion whose purpose is to make such a widening visible:

| Guard | Change |
|---|---|
| `source-rules.test.ts` registration contract | expected field set widened by exactly two — `optionDescriptionFields`, `liveEnumerator` |
| `i21-type-boundary.test.ts` fixture inventory | eight negative files → nine |
| `i21-type-boundary.test.ts` expected violations | one row added for the new fixture |

`refund-semantic-digest.test.ts` was **extended, not altered** — the five-field matrix is
byte-identical and a §13 section was appended.

Properties specifically re-checked:

- **`I21`** — no new field crosses. `contextSpec` is `KernelComputed`, kernel-owned, and has no
  `ProposedIntent` path. The type-negative suite grew rather than shrank.
- **the five-field digest** — untouched. Asserted against the source, so a sixth member would be
  a visible edit and (`26 §2.1.2`) a semantic constructor bump.
- **`I18a`/`I18c`** — unchanged and still asserted at construction; the CAN-03 control test
  observes them holding for the wrong line, which is the finding rather than a regression.
- **the retained-fee escape control** — still green; S1C's enumerator strengthens the same
  property by refusing to enumerate a pair with no authoritative fee record at all.
- **`canonicaliser.ts`** — not modified.

### 15. Did any architecture conflict emerge?

**One shape difference, and one gap. Neither is a contradiction; both are recorded rather than
resolved silently.**

**(a) Two printed shapes for `EnumeratedOptionSet`.** `26 §2.0.1` prints
`{enumeration_id, computed_at, constructor_version, options[{option_id, description}]}`;
`24 §3` K4 prints the same plus `action_class`, `resource_ref` and `max_age`. S1C returns
`26 §2.0.1`'s narrower shape — also the one the S1C mandate declares — and holds `max_age`
kernel-side. That is strictly less information at a surface `26 §2.0.1` itself calls *"the
highest-value surface in the architecture"*. Recorded as **S1C-C7**.

**(b) `reason_code_scope` has no declared source at enumeration time.** It is a member of
`refund.create`'s `semantic_option_digest` (`26 §2.2`), but `enumerate_effects` takes no reason
code and `26 §8` fixes the enumeration as two-dimensional. Something must supply the scope and
the package does not say what. S1C takes it from the task's `context_spec` — kernel-owned, a
control artifact, never a model input — and records that as **S1C-C5**, a fixture decision, not
a reading.

**Not a conflict, but worth flagging to the architecture owner:** `26 §2.0.1`'s resource-scope
row says an out-of-scope reference *"denies"*, while `36 §2` VC-C2 says it *"returns an empty
set rather than a denial that leaks existence"*. These are the same requirement stated from two
sides — internal denial, external empty set — and S1C implements both. The wording is worth
reconciling in a future errata because a reader taking `26 §2.0.1` literally would build the
oracle.

---

## What S1C built

| Component | File |
|---|---|
| the injected clock | `src/kernel/enumeration/clock.ts` |
| the task `context_spec` and the ONE description projection | `contextSpec.ts` |
| `25 §14`'s entity execution lease, session-scoped | `entityLease.ts` |
| the per-class enumeration port | `port.ts` |
| authoritative RECORD-grade commerce state | `commerceState.ts`, `0005__commerce_state.sql` |
| two-dimensional `refund.create` enumeration | `refundEnumeration.ts` |
| `EnumeratedOptionSet` | `enumeratedOptionSet.ts` |
| the staleness/lineage substrate | `enumerationRecord.ts` |
| the class `max_age` fixture | `enumerationMaxAge.ts` |
| the `enumerate_effects` READ core | `enumerateEffects.ts` |
| step C′'s live-selector boundary | `liveSelector.ts` |
| the coarse worker-facing denial projection | `workerFacingDenial.ts` |
| the mandatory positional negative control | `tests/negative-controls/unsafe-positional-selector.ts` |

---

## Invariant status after S1C

| Invariant | Status |
|---|---|
| **I53** | **RUNTIME half PROVEN** — `option_id` absent from the C′-lock enumeration denies `SELECTOR_STALE`, no substitution, asserted with its mandatory negative control. DB half (`option_id` not-null on the effect row) OPEN — there is no effect row. |
| **I52** | **RUNTIME projection filter PROVEN.** CI spec-review half **OPEN**. |
| **I21** | **HOLDS**, unchanged. Type-negative suite extended by one fixture. |
| **I61** | **HOLDS** on the READ as well as the request — the same verified `ConstructorVersionRecord` governs both, asserted including `recordHash`. Resume gate OPEN (no approval state machine). |
| **I18a / I18c** | **HOLD**, unchanged from S1B. |
| **I18b / I18d** | **OPEN** — no reservation, no settlement. |
| **I42** | **OPEN** — no effect row, no database uniqueness. |

---

## Scope compliance

Not built, not stubbed, not partially wired: **Cedar · grants and policy matching ·
`per_action_max` · reservation integration · real effect dispatch · the outbox ·
Shopify/Stripe or any real vendor · the approval state machine · the audit mirror · AI agents ·
the AI CEO · a production enumeration quota · a production READ journal.**

The architecture package is unmodified. No S1A or S1B production check was weakened.

---

## STOP

S1C ends here. The next increment is not begun.

Carried forward, with the honest labels above: **VC-C2 journaling and quota**, **VC-C3's lock
clause once the propose→authorise→execute span exists**, **`I52`'s CI spec-review half**, and
the two architecture-owner items in question 15.
