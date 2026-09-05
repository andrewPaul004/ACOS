# S1C Test Matrix

**Gate:** `npm run verify` — typecheck, lint (`--max-warnings 0`), full suite.
**Result:** **46 files, 590 tests, exit 0.**
**Baseline at branch creation (`17a6fdd`):** 38 files, 490 tests, exit 0.
**Added by S1C:** 8 files, 100 tests. **No accepted S1A or S1B test was removed or weakened.**

Real PostgreSQL 16.9 throughout. Deterministic barriers (`tests/support/barrier.ts`) and an
injected clock (`src/kernel/enumeration/clock.ts`). **No sleeps as synchronisation.**

---

## 1. The mandate's required tests, one row each

| # | Required by the S1C mandate §19 | Where | Status |
|---|---|---|---|
| 1 | valid refund enumeration | `enumerate-effects.test.ts` §1 | **PASS** |
| 2 | no positional identity | `enumerate-effects.test.ts` §3 | **PASS** |
| 3 | exact `option_id` computation | `enumerate-effects.test.ts` §3 | **PASS** |
| 4 | `context_spec` field projection | `context-spec-projection.test.ts` §4 | **PASS** |
| 5 | out-of-scope resource does not leak existence | `enumeration-scope.test.ts` §5 | **PASS** |
| 6 | stale enumeration age | `live-selector.test.ts` §6 | **PASS** |
| 7 | live option disappears → `SELECTOR_STALE` | `vc-c3-can03-reordering.test.ts` | **PASS** |
| 8 | no option substitution | `vc-c3-can03-reordering.test.ts` | **PASS** |
| 9 | CAN-03 positional negative control | `vc-c3-can03-reordering.test.ts` §12 | **SUBSTITUTES, as required** |
| 10 | recorded description == authoritative projected description | `context-spec-projection.test.ts` §10 | **PASS** |
| 11 | semantic option mutation matrix | `refund-semantic-digest.test.ts` (S1B, retained) | **PASS** |
| 12 | non-semantic current-state mutation leaves `option_id` unchanged | `refund-semantic-digest.test.ts` §13 (S1C) | **PASS** |
| 13 | resource RECORD-grade requirement | `enumeration-scope.test.ts` §13 | **PASS** |
| 14 | enumeration `constructor_version` == canonicalisation `constructor_version` | `live-selector.test.ts` §14 | **PASS** |
| 15 | worker-facing selector denial is coarse | `worker-facing-denial.test.ts` | **PASS** |
| 16 | raw audit detail is not returned to worker | `worker-facing-denial.test.ts` | **PASS** |
| 17 | accepted S1A/S1B tests remain green | whole suite | **490/490, unchanged** |

Plus two the mandate requires in §3 and §14 rather than §19:

| # | Required | Where | Status |
|---|---|---|---|
| 18 | re-enumeration occurs under the held entity lock; release is explicit | `entity-lease.test.ts` §16–17 | **PASS** |
| 19 | `selector: 4` / `selector: {index: 4}` are malformed; no index layer | `positional-selector-rejected.test.ts`, `tests/type-negative/positional-selector.ts` | **PASS** |

---

## 2. File by file

### `tests/integration/enumeration/enumerate-effects.test.ts` — 14 tests

The `enumerate_effects` READ surface over real PostgreSQL.

| Group | Asserts |
|---|---|
| 1 — a valid enumeration | both refundable lines returned; every amount COMPUTED and bounded by BOTH dimensions; the authoritative retained fee carried per pair with its `source_ref`; `computed_at` from the injected clock; the VERIFIED `constructor_version` (`I61`); the enumeration recorded in kernel state with its ordered options; **it is a READ** — no reservation row, journal counter unmoved |
| 2 — two-dimensional | a 2×2 order yields FOUR options; the same line against two transactions yields two DIFFERENT `option_id`s (`26 §8`, instrument enumerated not asserted) |
| 3 — content address | `option_id` equals `H(action_class ‖ resource_id ‖ semantic_option_digest)` recomputed independently; stable across enumerations; **physically reordering the rows moves no `option_id`** |
| 4 — the gates | a class outside the closed catalogue denies `UNKNOWN_ACTION`; a catalogued class with no constructor denies `NOT_CANONICALISABLE` |

The reordering test is the discriminating one: the rows are deleted and reinserted in the
opposite physical order, which changes the heap order and would move any position-derived
identity.

### `tests/integration/enumeration/enumeration-scope.test.ts` — 8 tests

VC-C2's external behaviour.

| Asserts |
|---|
| an EXISTING order outside the `context_spec` returns an EMPTY SET, not a denial |
| an ABSENT resource returns the same empty set |
| a NON-RECORD-grade resource returns the same empty set |
| **THE DISCRIMINATOR** — for ONE `resource_ref`, all four conditions (legitimately empty · absent · not RECORD grade · out of scope) return an identical `enumeration_id`, option list, `constructor_version` and `computed_at` |
| the model-facing set has no field that could carry the internal reason; `ORDER_EXISTS…` appears nowhere |
| no `enumeration_record` row is written for an unenumerable resource |
| §13 — promoting the CLAIM-grade order to RECORD makes it enumerable (the control) |
| §13 — OBSERVATION and DECISION_DELEGATED are equally unenumerable |

The discriminator drives the whole order through all four conditions, so nothing but the
condition varies. **It failed on first run and found a real leak** — see
`S1C-implementation-log.md` §2.

### `tests/integration/enumeration/entity-lease.test.ts` — 9 tests

`25 §14`'s lock, and its lifetime. Every interleaving driven by the conductor.

| Asserts |
|---|
| §16 — a second session cannot take the lock DURING C′ re-enumeration, and CAN after release (both directions) |
| §17 — the lease survives a `COMMIT` on its own connection — the property `pg_advisory_xact_lock` cannot have |
| §17 — the lease is still held inside a FAKE DOWNSTREAM CALLBACK standing in for authorise/execute |
| §17 — a second work item WAITS rather than proceeding on stale state |
| §17 — a DIFFERENT entity is NOT blocked (the control against a global lock) |
| a RELEASED lease is inert: `assertHeld` throws and re-enumeration through it is refused |
| a lease for ANOTHER entity does not satisfy `assertHeld` for this one |
| the lock is released even when the span throws |
| the advisory key is deterministic, length-framed, and int4-representable in both halves |

No policy runs in the callback. The mandate forbids it and none is written.

### `tests/integration/enumeration/vc-c3-can03-reordering.test.ts` — 6 tests

VC-C3, and the mandatory negative control, in one file.

| Asserts |
|---|
| **PRODUCTION**: the live set really becomes `[B: $20.00]`; C′ denies `SELECTOR_STALE` / `OPTION_ABSENT_FROM_LIVE_SET`; **no effect is constructed**; B's id, line and amount appear nowhere; no reservation; journal counter unmoved |
| CONTROL — with A still live, the same intent canonicalises A, at `$10.00`, `total_exposure = $10.59` |
| CONTROL — selecting **B** after A is exhausted still works, so the denial is about IDENTITY and not about the set having changed |
| the worker sees `{ deny: 'SELECTOR' }` and nothing else |
| **NEGATIVE CONTROL**: under a positional selector, index 0 denotes A before and **B after** — `EXPECTED SUBSTITUTION OBSERVED`, `$10.00` selected and `$20.00` dispatched, with `I18a` holding for the wrong line |
| and the same shrink IS benign for v1.1's actual guard — index 1 is out of range and refuses, which is why v1.1 looked adequate |

Observed output:

```
EXPECTED SUBSTITUTION OBSERVED — positional selector 0 dispatched line:ORD-123:B at 20.00
after line:ORD-123:A at 10.00 was selected
```

### `tests/integration/enumeration/live-selector.test.ts` — 12 tests

| Group | Asserts |
|---|---|
| 6 — enumeration age | one second past `max_age` denies `SELECTOR_ENUMERATION_STALE`; **exactly at `max_age` still permits** (the boundary is `>`); the enumeration is NOT silently reissued — no new record, and the stored `computed_at` is unmoved; a successful C′ writes no second record either |
| the `enumeration_id` carries information | a fabricated id denies; an enumeration taken against ANOTHER resource cannot be paired with this option; an enumeration taken by ANOTHER task cannot be reused |
| 14 — `constructor_version` | the enumeration's and the request's are equal field for field, including `recordHash`; the `enumeration_record` row agrees; the request records the `enumeration_ref` the KERNEL holds |
| C′ requires a held lease | a released lease cannot canonicalise; a lease for another COMPANY is refused; a lease for another ENTITY is refused once the resource resolves |

### `tests/integration/enumeration/context-spec-projection.test.ts` — 11 tests

`I52`, runtime half.

| Group | Asserts |
|---|---|
| 4 — projection | the full spec renders every candidate (the positive control); withholding `refundable_remaining` removes its name AND its value; **the structural form** — emitted field names ⊆ admitted set, over four different specs; a spec admitting no field for the class produces EMPTY descriptions, not full ones; the admitted set is per action class; rendering order is the CONSTRUCTOR-declared order, not the admitted set's |
| 10 — recorded == seen | `AuthorizationRequest.selected_option.description` equals the enumeration option's description; the recorded description obeys the SAME `context_spec` restriction; **a `context_spec` that changed between the READ and C′ is a THROWN DEFECT**; the recorded description is the STORED one; a description change does NOT move `option_id` |

The changed-`context_spec` test **found a real weakness and drove a repair** — see
`S1C-implementation-log.md` §3.

### `tests/canonicalisation/worker-facing-denial.test.ts` — 18 tests

| Group | Asserts |
|---|---|
| the family collapses | each of the four selector codes → `{ deny: 'SELECTOR' }`; **all 4 × 13 code/detail combinations produce ONE distinct response**; STALE and ENUMERATION_STALE are indistinguishable; the three non-selector categories stay distinct as `26 §7` declares them |
| different surfaces | the projection returns a different object, not an `Error`; EXACTLY ONE field; neither `message` nor `auditNote` nor `detail` survives; the audit detail is still INTACT on the exception; the returned object is FROZEN; no near-miss word (`count`, `index`, `nearest`, `exceeded`, `remaining`, `options`) appears |
| `denialProjected` | a denial becomes the coarse category; a success passes through; **an INTERNAL DEFECT is RETHROWN**, not swallowed into `DENY: SELECTOR` |
| structural | nothing in `src/` outside `workerFacingDenial.ts` reads `.auditNote` or a denial `.message`; the projection reads ONLY `code` |

### `tests/canonicalisation/positional-selector-rejected.test.ts` — 17 tests

| Group | Asserts |
|---|---|
| the wire form | `selector: 4` malformed; `selector: {index: 4}` malformed; a well-formed pair CARRYING an index malformed (accept-and-ignore prohibited); the CAN-05 probes `2^k` for k ∈ {0,1,2,4,8,16,1024} each malformed; **every probe indistinguishable at the worker — the oracle returns one bit**; an ordinal is indistinguishable from a wrong pair; a string ordinal is not coerced; an array selector is not an option list |
| no compatibility layer | no `src/` module reads `selector[n]`, `selector.index`, `Number(selector)` or `parseInt(selector)`; `ProposedSelector` declares exactly two string members; the parser declares exactly the two wire keys |

### `tests/type-negative/positional-selector.ts` — compile-time

Three `EXPECT_ERROR` markers, verified by `i21-type-boundary.test.ts`: a bare integer is not a
`ProposedSelector` (TS2322); an `index` member has no position on the pair (TS2353); a
positional selector cannot be smuggled onto a whole `ProposedIntent` (TS2322).

### `tests/negative-controls/unsafe-positional-selector.ts` — the control implementation

TEST-ONLY, never imported from `src/`. Uses the SAME enumerator, the SAME lease, the SAME
enumeration record, the SAME `max_age` check and the SAME accepted S1B canonicaliser. **One
line differs**: `live.authoritative[intent.selector]`. v1.1's bounds check is retained
faithfully, so the test cannot be dismissed as having removed a guard the architecture had.

---

## 3. Accepted tests changed by S1C, and why each change is admissible

Three, all of them guards that S1C's own additions were *supposed* to move.

| Test | Change | Why |
|---|---|---|
| `source-rules.test.ts` — "the registered-constructor contract declares them" | expected field set widened by exactly two: `optionDescriptionFields`, `liveEnumerator` | This assertion is an EXACT set precisely so that widening the registration contract is a visible decision. Both additions are per-class operations moved OFF a core (S1B.2 finding 6's discipline), not new powers granted to a constructor. |
| `i21-type-boundary.test.ts` — fixture inventory | eight negative files → nine | `positional-selector.ts` added. The inventory assertion exists so a fixture cannot be added or removed silently. |
| `i21-type-boundary.test.ts` — expected violations | one row added | The new fixture's expected diagnostics are declared like every other. |

`refund-semantic-digest.test.ts` was **extended, not altered**: the five-field matrix is
byte-identical and a new `§13` section was appended.

No S1A test changed. No production check was weakened to make a test pass.

---

## 4. Determinism

| Mechanism | Used for |
|---|---|
| `Conductor` / `Participant` (`tests/support/barrier.ts`) | every lease-lifetime interleaving; the observer takes its reading at a named instant, never after a delay |
| `FixedClock` (`src/kernel/enumeration/clock.ts`) | every `computed_at` and every `max_age` comparison |
| a second pooled connection + `pg_try_advisory_lock` | observing lock state without perturbing it |
| a separate connection for the CAN-03 mutation | so the concurrent partial refund is genuine state change, not the test rewriting its own snapshot |

`grep -rn "setTimeout\|sleep" tests/integration/enumeration` returns nothing.
