# S1D — Cedar Policy Enforcement + `PER_ACTION` Denial · implementation contract

**Slice:** S1D
**Branch:** `feature/s1d-cedar-policy`
**Based on:** `ee9c518` (S1C ACCEPTED), which is based on `17a6fdd` (S1B ACCEPTED)
**Architecture:** ACOS Operating Spine v1.3, package issue v1.3.1, `docs/architecture/v1.3.1/` — **unmodified**
**Pre-S1D baseline:** 590 tests across 46 files, `npm run verify` green

---

## 1. The one thing S1D exists to prove

`26 §2.1.1`, verbatim:

> **And the consequence that matters most: no policy cap intended to bound economic loss may
> compare only against `vendor_amount`.** `§8`'s refund policy therefore tests
> `context.exposure.total_exposure <= 25.00`, so a $25.00 line refund carrying a $1.03
> retained fee **denies** `PER_ACTION`.

S1B proved the **construction** half of VC-C1: the canonicaliser computes
`vendor_amount = $25.00`, `retained_processing_fee = $1.03`, `total_exposure = $26.03`, and
dispatches `$25.00`. S1B's own `errors.ts` records the gap in as many words:

> `PER_ACTION` is a POLICY denial and no code path here can produce it. `36 §2` VC-C1's
> denial half is open until the Cedar slice.

**S1D closes it.** A real Cedar evaluator, in-process, evaluating an authoritative
`$26.03` against the `51 §3.1` per-action bound of `$25.00`, returning `DENY: PER_ACTION`.

---

## 2. Normative sources, transcribed

### 2.1 The per-action limit

`51 §3.1`, the Stage-2 monetary grant table, verbatim row:

| Action class | `per_action_max` | `W_DAY` count | `W_MONTH` count | `value_direction` | Recoverability | `settlement_tolerance` |
|---|---|---|---|---|---|---|
| `refund.create` | **$25.00** | 2 | **10** | `INBOUND_ORIGINAL_INSTRUMENT` | COMPENSABLE | `EXACT` |

and, immediately following it, verbatim:

> `per_action_max.monetary` is compared against **`exposure.total_exposure`**, not
> `exposure.vendor_amount` (SR-C1, `26 §8`).

**S1D invents no limit.** `$25.00` is `51 §3.1`'s figure and it appears in exactly one place
in the tree: the owner-signed Cedar policy artifact.

### 2.2 The comparison semantics

`26 §8`, the worked refund policy, verbatim:

```
context.exposure.total_exposure <= 25.00            // v1.2: TOTAL, incl. retained fee (I18b, SR-C1)
```

`26 §11.2` row 3, verbatim: *"Bounded by `total_exposure ≤ $25.00`"*.

The rule is **`<=`, not `<`**. The boundary is therefore:

| `total_exposure` | Expected |
|---|---|
| `$24.99` | PERMIT |
| **`$25.00`** | **PERMIT** — at the limit is inside it |
| `$25.01` | DENY `PER_ACTION` |
| **`$26.03`** | **DENY `PER_ACTION`** — VC-C1 |

### 2.3 The `refund.create` policy, verbatim from `26 §8`

```
permit(principal in Role::"support_reasoner",
       action == Action::"refund.create",
       resource is Order)
when {
  resource.exists && resource.grade == "RECORD" &&
  context.exposure.total_exposure <= 25.00 &&
  context.selected_option.line_refundable_remaining >=
      context.selected_option.amount &&
  context.selected_option.instrument == "original" &&
  context.reason_code in ApprovedReasons &&
  context.customer_novelty in [NEW, RETURNING] &&
  exposure.window("W_DAY_REFUND").count_headroom > 0 &&
  exposure.window("W_MONTH_REFUND").count_headroom > 0 &&
  exposure.window("W_DAY_REFUND").monetary_headroom >=
      context.exposure.total_exposure &&
  exposure.window("W_MONTH_REFUND").monetary_headroom >=
      context.exposure.total_exposure
};
```

and the sentence that governs every operand in it, verbatim:

> **v1.1: every operand below is a kernel-computed field.** [...] The `context.exposure.*`
> and `context.selected_option.*` values here are produced by the Effect Canonicaliser
> (§2.1) from authoritative state, and I21 makes it a type-level property that they cannot
> come from anywhere else.

### 2.4 `P1`, which is why the cap is a `forbid`

`26 §11`, property table, verbatim:

> **P1** — No policy path permits `refund.create` whose **`exposure.total_exposure`**
> exceeds the configured per-action cap. *(v1.2: the operand is `total_exposure`, not the
> vendor amount — SR-C1.)*

"No policy path permits" is a statement about the whole policy set, not about one `permit`.
In Cedar, a `forbid` is the only construct that holds regardless of what permits exist or are
later added. **S1D therefore expresses the cap as a `forbid`**, and additionally keeps the
`<= 25.00` term inside the `§8` `permit` exactly as the architecture writes it. The two are
belt and braces, and the `forbid` is what makes P1 structural rather than a review property.

The `forbid` is also what makes the denial **attributable**: Cedar's
`diagnostics.reason` names the determining policy, so `acos.refund.create.per_action_max`
maps deterministically onto `26 §7` step M's `DENY: PER_ACTION` terminal (`D11`).

---

## 3. Where the seam sits

```
authoritative RECORD-grade state
        ↓
enumeration  (S1C, enumerate_effects)
        ↓
C′ live re-enumeration + selector resolution under the entity lease   (S1C, liveSelector.ts)
        ↓
Effect Canonicaliser                                                  (S1B, canonicaliser.ts)
        ↓
CanonicalEffect  { AuthorizationRequest, DispatchPayload }
        ↓
deterministic Cedar request construction                              (S1D, cedarRequest.ts)
        ↓
real Cedar, in-process                                                (S1D, cedarEngine.ts)
        ↓
PolicyDecision  PERMIT | DENY: PER_ACTION | DENY: NO_GRANT
```

**The canonicaliser supplies `$26.03`. Cedar tests it. Cedar computes nothing.**
`cedarRequest.ts` performs no arithmetic on money — the digest test in
`tests/policy/source-rules-s1d.test.ts` asserts that structurally: no `add`, no `sub`, no
`mulByRational`, no `+` on a `Money` anywhere under `src/kernel/policy/`.

### 3.1 One call, no gap

`AuthorisationPipeline.authoriseUnderLease` runs C′ and the policy evaluation in a single
call and **the `CanonicalEffect` never becomes a caller-visible value between them**. That is
the structural answer to *"is the policy decision tied to the canonical effect produced after
S1C selector revalidation?"*: there is no separately reconstructed object, and no window in
which a caller could mutate one.

---

## 4. The closed policy boundary

### 4.1 What the Cedar request is built from

**Exactly one argument: the `CanonicalEffect`.** `buildRefundCreateCedarRequest` takes no
second parameter, no options object, no overrides bag and no `context` map. Every operand
is read off `effect.request`, whose every authority-bearing field is `KernelComputed<T>` and
whose only four intent-derived fields are the `I21` four.

There is therefore no argument position in which a caller could place a company id, a
resource id, an action identity, a limit, a grant, a window, an amount or a policy attribute.
Attacks 5, 6, 7 and 11 in `§7` are answered by the absence of a parameter rather than by a
check.

### 4.2 The Cedar schema is the closure

`src/kernel/policy/artifacts/acos.cedarschema` declares the context record **exactly** and
Cedar rejects an unknown attribute at request-parse time:

```
while parsing context, record attribute `evil` should not exist according to the schema
```

So *"populate a generic policy context with $25.00"* is not a check S1D performs — it is a
shape the request cannot take. There is no `Record<string, unknown>` anywhere on the policy
surface.

### 4.3 `rationale`

`rationale` is sealed at `intent.ts` into an opaque handle with `byteLength` as its only
observable, and `26 §2.0` says it is *"NEVER parsed, NEVER interpreted as authority"*.

S1D adds two properties:

1. **No file under `src/kernel/policy/` references `rationale` in executable code** — the
   accepted `tests/canonicalisation/source-rules.test.ts` rule 1 already walks all of `src/`
   and enforces this, and S1D adds no exemption to its permitted list.
2. **`intentHash` — the lineage commitment that *does* commit to `rationale` — is not a
   Cedar context attribute.** Two effects differing only in `rationale` must produce
   **byte-identical** Cedar requests, asserted directly.

---

## 5. Scope

### 5.1 In scope

| # | Item |
|---|---|
| 1 | Real Cedar (`@cedar-policy/cedar-wasm@4.11.2`) linked in-process; ADR-IMP-003 records the binding decision |
| 2 | Deterministic, fail-closed loading of the Cedar schema and policy set as control artifacts, with a content digest recorded on every decision (`26 §11`, `50 §2` class 2) |
| 3 | `refund.create`: the `§8` grant `permit`, and the `51 §3.1` `per_action_max` `forbid` |
| 4 | Deterministic Cedar request construction from the `CanonicalEffect`, and nothing else |
| 5 | `DENY: PER_ACTION` attribution from Cedar's determining policy |
| 6 | Coarse worker-facing policy denial, one field, no diagnostics |
| 7 | `AuthorisationPipeline` — C′ and policy in one call |
| 8 | The mandatory vulnerable negative control binding `vendor_amount` |
| 9 | Boundary, fail-closed, authority-channel-attack and gap-analysis suites |

### 5.2 Deliberately NOT in scope — and the four that are policy-shaped

Out of scope by the S1D mandate: `cedar-policy-symcc` · approvals and resume · VC-C4 · OWNER
approval workflow · the complete propose→authorise→execute lifecycle · runtime reservation
handoff · `I18b` · `I18d` · the outbox · external-effect claim · `I42` · real adapters ·
vendor HTTP · the audit mirror · audit quota · AI CEO · AI workers · standing-authorisation
lifecycle · additional business action classes.

Four exclusions are **policy-shaped** and are recorded here so no reader mistakes S1D's
policy set for a complete implementation of `26 §8`:

| Excluded | Why, with the normative basis |
|---|---|
| **The four window-headroom terms of `26 §8`** | `26 §7` places window headroom at **step R** (`DENY: WINDOW_EXHAUSTED`), not step M, and step R is reservation, which the S1D mandate excludes by name. ADR-005 and `36 §4` item 2 both state that *"numeric aggregation over time windows lives in the exposure ledger, not in policy"*. S1D declares **no window attribute in the Cedar schema at all**, so no fixture-supplied headroom can masquerade as a policy operand. **OPEN obligation, recorded in `S1D-result.md`.** |
| **Steps D, E, F, G, H, H′, H″, I, J, K, L, N** of `26 §7` | Principal chain, prohibitions, platform status, precondition fetch/grade/contradiction/delegation, grant matching, recoverability, novelty, evidence, autonomy ledger. None is required to prove VC-C1 and each is its own slice. S1D's `PolicyDecision` is named a **step-M decision** and never claims to be an `AuthorizationDecision`. |
| **The other three catalogue classes** | `campaign.pause`, `fulfilment.reship`, `campaign.budget.set` have no constructor (S1B) and no Cedar policy (S1D). `36 §3`'s gap analysis requires this be **explicit rather than silent**, and `tests/policy/policy-set-gap-analysis.test.ts` makes it so: each is asserted to fail closed, by execution. |
| **Owner signing of the policy artifact** | `50 §3`'s manifest carries `{class, artifact_id, version, content_hash, signed_at, signature}`. S1D computes and binds the **content hash**; it builds no signing infrastructure, because the mandate forbids inventing one. **OPEN.** |

---

## 6. Denial codes S1D can emit, and the ones it cannot

| Code | `26 §7` step | Emitted when |
|---|---|---|
| `PER_ACTION` | M (`D11`) | Cedar denies with `acos.refund.create.per_action_max` determining |
| `NO_GRANT` | I (`D7`) | Cedar denies and **no** `forbid` was determining — i.e. no policy path admitted this request |

**No code is invented.** Both are `26 §7` flowchart terminals.

`NO_GRANT` is the correct category for an unsatisfied `§8` grant: `36 §3` says *"An action
class with no policy is a deny by default (SR7)"*, and step I is the flowchart's node for
*"Matching grant exists after subset intersection?" → no*.

### 6.1 Internal defects are NOT denials

A `PolicyEvaluationDefect` is thrown, never returned, for: an unloadable or malformed policy
artifact; a missing, unexpected or duplicate artifact; a Cedar request the schema rejects; a
Cedar authorization error; an action class with no Cedar action; an entity the schema rejects.

This follows the **accepted S1C asymmetry** in `enumeration/workerFacingDenial.ts`, verbatim:

> a non-`CanonicalisationDenied` error is RETHROWN, not projected. Those are internal
> defects [...] Swallowing an internal defect into `DENY: SELECTOR` would hide a critical
> incident behind a routine category.

`26 §7` returns coarse categories **to denials**. A defect is not a denial. Every defect path
is asserted to be non-`PERMIT`, which is the property that actually matters.

---

## 7. The attack plan, written before the implementation

| # | Attack | Expected outcome | Proof form |
|---|---|---|---|
| A1 | Smuggle `total_exposure` through an unknown `ProposedIntent` field | `DENY: MALFORMED` at step B | runtime (accepted S1B) + this suite re-asserts it never reaches policy |
| A2 | Smuggle a policy amount through `rationale` | Two effects differing only in `rationale` produce **byte-identical** Cedar requests | runtime, byte equality |
| A3 | Populate a generic policy context with `$25.00` | No such parameter exists; Cedar's schema rejects an unknown context attribute | type-level (no parameter) + runtime (Cedar parse failure) |
| A4 | Mutate the canonical effect after C′ to reduce exposure | Assignment does not compile; and `authoriseUnderLease` gives no caller-visible gap | compile-failure fixture + structural |
| A5 | Supply an alternate action / resource identity to policy evaluation | No parameter; every entity is derived from the effect | type-level (`TS2554`) |
| A6 | Substitute another grant / policy limit | The limit is a literal inside the owner-signed artifact and is not a request field; a substituted artifact fails the digest | runtime (digest) + type-level |
| A7 | Call the policy engine directly with model-originated operands | A raw `Money` is not assignable to `KernelComputed<Money>` | compile-failure fixture |
| A8 | Bind `vendor_amount` instead of `total_exposure` | The vulnerable control **permits** VC-C1 while production **denies** | isolated unsafe implementation, real Cedar |
| A9 | Vary the fee only, holding `vendor_amount` fixed | The decision flips across the boundary ⇒ the operand is not `vendor_amount` | runtime, discriminating pair |
| A10 | Vary `vendor_amount` only, holding `total_exposure` fixed | The decision does **not** move ⇒ `vendor_amount` is not an operand | runtime, discriminating pair |
| A11 | Reach a permit through an unknown action class | Cedar's schema has no such action; evaluation fails closed | runtime, per catalogue class |
| A12 | Leak Cedar diagnostics, policy text or entity dumps to a worker | The worker-facing value is frozen with exactly one field | runtime + source scan |

---

## 8. Validation obligations S1D discharges

| Obligation | Source | Form |
|---|---|---|
| **VC-C1 denial half** | `36 §2`, `37 §3` | Real Cedar, `$26.03` vs `$25.00`, `DENY: PER_ACTION` |
| Layer 1 — policy unit tests, **boundary values at every numeric limit and one value past each** | `36 §3` | `$24.99` / `$25.00` / `$25.01` / `$26.03` |
| Layer 2 — request construction fails closed rather than defaulting | `36 §3` | Each context operand omitted or nulled in turn; none yields `PERMIT` |
| Policy-set gap analysis | `36 §3` | Every catalogue class asserted, by execution, to have a governing policy **or** to fail closed |
| P1, as a runtime property | `26 §11` | A `forbid`, plus the boundary suite |
| P6 reachability for `refund.create` | `26 §11.2` | The below-limit case **permits** — a policy set that denies everything is an outage, not a control |
| Mandatory negative control | `36 §0`, `46 R1` | The `vendor_amount` binding defect is **observed**, not asserted |

---

## 9. Regression rules S1D binds itself to

1. No accepted S1A/S1B/S1C test deleted, skipped, weakened or trivialised.
2. `vendor_amount = $25.00`, `retained_processing_fee = $1.03`, `total_exposure = $26.03`,
   dispatch amount `$25.00` — unchanged.
3. `option_id`'s meaning and composition — unchanged.
4. No generic `AuthorizationRequest` a model can populate — reintroduced nowhere.
5. `docs/architecture/v1.3.1/` — byte-identical.
6. The accepted exact-set tripwire in `source-rules.test.ts` rule 8
   (`RegisteredConstructor`'s field list) is **not widened**: policy hangs off no
   constructor registration.
7. One accepted type is extended by exactly one field — `ResolvedPrincipal.role` — because
   `26 §3` declares `role` on the principal and `26 §8` reads
   `principal in Role::"support_reasoner"`. It is required, not optional, so an absent role
   cannot default.
