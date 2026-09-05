# S1B Owner Implementation Clarifications

**Issued 2026-09-05, at the opening of S1B.**

This document records **owner implementation clarifications**. It is not an architecture
amendment and it is not a correction of the architecture record.

**The immutable architecture package under `docs/architecture/v1.3.1/` was not modified by
S1B, in any respect**, and no historical artefact was rewritten. Where the architecture is
silent, or where two passages could each be read literally, the passage is **quoted
verbatim** below and the reading S1 implementation uses is stated. **No clarification below
changes any authority quantity, any MAL figure, or any behaviour S1A implemented.**

| ID | Clarification | Changes an authority quantity? |
|---|---|---|
| **S1B-C1** | `rationale`, `intent_hash` and `I21` — the lineage edge | **No** |
| **S1B-C2** | The deny code for an unverifiable `ConstructorVersionRecord` | **No** |
| **S1B-C3** | The retained-processing-fee derivation that reproduces the printed `$1.03` | **No** |
| **S1B-C4** | `counterparty` for `refund.create` is `null`, and the destination is a parameter | **No** |
| **S1B-C5** | `window_refs` at S1B come from the catalogue, because grants are a later slice | **No** |
| **S1B-C6** | The closed `reason_code` set for the S1B fixture catalogue | **No** |
| **S1B-C7** | The deny code for an `option_id` mismatch **before** enumeration exists | **No** |

---

## S1B-C1 — `rationale`, `intent_hash`, and `I21`

### The wording edge, quoted

`26 §2.0` lists five model-visible fields and says of the fifth, verbatim:

> `rationale         // free text; journaled for the audit record; NEVER parsed, NEVER interpreted as authority`

`ADR-006`, verbatim:

> The capability becomes **`propose_intent(ProposedIntent)`** with five fields —
> `action_class`, `resource_ref`, `selector`, `reason_code`, `rationale` — of which **four
> reach the authorisation request and one is journaled and never parsed.**

Registry `§1.2` `I21`, verbatim:

> **No `AuthorizationRequest` field is populated from `ProposedIntent` other than
> `action_class`, `resource_ref`, `selector` and `reason_code`.**

And `26 §2.1` prints, as a field of `AuthorizationRequest`, verbatim:

> `intent_hash          // hash of the ProposedIntent, for lineage`

**The edge is real and it is worth stating rather than glossing.** `intent_hash` is a field
of the `AuthorizationRequest`. It is a hash *of the `ProposedIntent`*, and the
`ProposedIntent` contains `rationale`. Read at maximum literalness, `I21` and the
`intent_hash` line are in tension: a hash over all five fields is, in one sense, a request
field "populated from" a fifth intent field.

### The owner clarification

**`rationale` may participate only in an opaque lineage/audit commitment such as the
full-intent hash.**

It may not affect — directly, indirectly, or by any code path — any of:

- computed parameters;
- exposure, in either `vendor_amount` or `total_exposure` or any `cost_component`;
- the selected effect or `option_id`;
- the counterparty or the destination;
- recoverability or `value_direction`;
- the dispatch payload or any vendor parameter;
- the idempotency key;
- any policy operand;
- the constructor version identity;
- any other authority-bearing semantic field.

Consequently:

- Changing **only** `rationale` **MAY** change the full-intent lineage hash. S1B's
  implementation commits to `rationale` there, so in this implementation it **does**.
- Changing **only** `rationale` **MUST** leave every economic, dispatch and authority
  semantic output **byte-identical**.

**`I21` is not weakened by this.** The property `I21` protects is that no *authority-bearing*
request field takes a value the model chose. A one-way commitment to the bytes the model
submitted is the opposite of that: it is what makes the model's submission auditable. The
implementation makes the distinction structural rather than conventional — `rationale`'s
type is `OpaqueRationale`, which is not a `string`, exposes no character accessor, and is
accepted by exactly one function in the tree (`lineage.ts`'s intent-hash builder).

### The discriminating test this requires

`tests/canonicalisation/rationale-non-authoritative.test.ts`. Same authoritative state,
same four permitted intent fields, different `rationale`. Asserts:

| Quantity | Expectation |
|---|---|
| `intent_hash` | **differs** |
| computed parameters | identical |
| `exposure` (every field, including `cost_components`) | identical |
| selected effect / `option_id` / `semantic_option_digest` | identical |
| dispatch payload, byte for byte | identical |
| `dispatch_payload_hash` | identical |
| idempotency key | identical |
| recoverability, `value_direction`, counterparty, `customer_novelty` | identical |
| constructor version identity | identical |

**No production function parses `rationale`.** Enforced twice: by the type
(`OpaqueRationale` has no string surface) and by a source-reading test that fails if
`rationale` is referenced anywhere in `src/` outside `intent.ts` and `lineage.ts`.

---

## S1B-C2 — the deny code for an unverifiable `ConstructorVersionRecord`

### The silence, quoted

Registry `§1.2` `I61`, on-violation column, verbatim:

> `DENY: CONSTRUCTOR_SEMANTIC_CHANGE`, with a `RemedyObligation` per `I58`. **A missing
> `constructor_version` is a build failure.**

`26 §7`'s step-C′ denial list, verbatim:

> **v1.2 denials:** `SELECTOR_STALE` [...]; `SELECTOR_ENUMERATION_STALE` [...];
> `SELECTOR_MALFORMED` [...]; `NOT_CANONICALISABLE` if no constructor is registered for the
> class.

`CONSTRUCTOR_SEMANTIC_CHANGE` is the **resume-path** denial and needs the approval state
machine, which S1B does not implement. *"A missing `constructor_version` is a build
failure"* covers the omission case. **The architecture names no runtime denial for a
constructor whose version record is present but fails verification** — wrong action class,
invalid signature, structurally malformed.

### The owner clarification

A constructor whose `ConstructorVersionRecord` cannot be resolved and verified is, for the
purposes of step C2/C′, **a class with no usable registered constructor**. It denies:

```text
DENY: NOT_CANONICALISABLE
```

with a distinct non-model-visible detail (`CONSTRUCTOR_VERSION_UNVERIFIABLE`, plus the
specific structural reason) recorded for the audit path.

**Rationale.** `ADR-021` is explicit that *"where an action class cannot be
deterministically canonicalised, it is not eligible for autonomous execution."* An
unverifiable constructor version is exactly that condition: `I61` requires the recorded
version to resolve to a **signed** record, so a constructor that cannot produce one cannot
emit a conforming `AuthorizationRequest` at all. Denying `NOT_CANONICALISABLE` is
fail-closed, uses an existing declared code, and keeps model-visible denial detail coarse
per `26 §7`.

**This does not pre-empt the approval slice.** `CONSTRUCTOR_SEMANTIC_CHANGE` remains
reserved for the resume path and is not emitted anywhere in S1B.

---

## S1B-C3 — the retained-processing-fee derivation

### What the architecture prints

`26 §2.1.1`, verbatim:

> For a $25.00 refund carrying a $1.03 retained processing fee [...]

`51 §3.1` note, verbatim:

> For a $25.00 line refund carrying a $1.03 retained processing fee, `total_exposure =
> $26.03` and the action **denies** `PER_ACTION`.

`36 §12`'s oracle table, verbatim:

> A hand-computed fixture table per class, **including one null-`vendor_amount` class and
> one with non-zero cost components**, authored from the **processor's published fee
> schedule**

`51 §5.1`, verbatim:

> Settled cost is fully determined pre-dispatch: **refund amount plus the processor's
> published retained fee.** Single currency only.

**The architecture prints the figure `$1.03` and names its source as "the processor's
published fee schedule". It does not print the schedule.**

### The owner clarification

The S1 fixture processor's published schedule is the Stripe-family standard card rate:

```text
retained_fee = round_half_away_from_zero(vendor_amount × 2.9%) + $0.30
```

For the VC-C1 fixture:

```text
$25.00 × 0.029 = $0.725   →  round half away from zero at scale 2  →  $0.73
$0.73 + $0.30                                                       =  $1.03
$25.00 + $1.03                                                      =  $26.03
```

which **reproduces the architecture's printed `$1.03` and `$26.03` exactly**.

**The schedule is authoritative kernel input, not a constant in the constructor.** It
arrives on `AuthoritativeCanonicalisationContext` as a RECORD-grade
`ProcessorFeeSchedule { percentage_numerator, percentage_denominator, fixed, currency }`,
so a later slice that fetches it from a real processor record changes the fixture and not
the constructor. The rounding convention is S1A's `money.mulByRational`, which already
rounds half away from zero and is the convention S1A tested for the `30.4` monthly basis
multiplier.

**The independent oracle does not import this.** `tests/support/canonicalisationOracle.ts`
carries `2500`, `29`, `1000`, `30` and `103` as hand-authored minor-unit integers and does
its own three-line arithmetic.

---

## S1B-C4 — `counterparty` for `refund.create`

### The two passages, quoted

`26 §2.1` prints `counterparty { id, novelty }` as an `AuthorizationRequest` field, and
`26 §7` step K evaluates `counterparty.novelty ≤ grant limit`.

`26 §11.2`, the hand-proof table, row 3, counterparty column, verbatim:

> **n/a** — destination derived by the canonicaliser from the RECORD-grade transaction,
> never from the intent

`26 §1` Corollary 1, verbatim:

> **v1.1: "counterparty" means a payee, supplier or settlement destination** — not a
> customer. A first-time buyer receiving their own refund to their own original instrument
> is not a novel counterparty, and conflating the two produced a formal property (P4) that
> either forbade refunding a new customer or was misdescribed.

### The owner clarification

For `refund.create`:

- `counterparty` is **`null`**. The class creates no payee, supplier or settlement
  destination; `26 §11.2` prints `n/a` and `26 §1` says why conflating the payer with a
  counterparty is the error to avoid.
- The **destination is still kernel-derived and still recorded**, as the computed parameter
  `destination_instrument_ref`, resolved from the authoritative RECORD-grade parent
  transaction and never from the intent — which is exactly what `26 §11.2`'s cell
  describes.
- `customer_novelty` carries `NEW | RETURNING` from the authoritative customer record, and
  is **not** a counterparty test.

**Consequence for step K, recorded rather than discovered.** With `counterparty === null`,
`26 §7` step K has no operand for this class and is vacuous for it. That is the reading
`26 §11.2` states directly (`n/a`), and it is why `P4a` — not `P4` — is the property the
hand proof assigns to this row. Step K is not implemented in S1B in any case; this
clarification exists so the later policy slice does not read `null` as a construction
defect.

---

## S1B-C5 — `window_refs` at S1B

### The passage, quoted

`26 §2.1`, verbatim:

> `window_refs[]        // every named window the matching grants reference`

### The owner clarification

Grants, grant matching and subset intersection are **step I**, which is policy and is not
implemented in S1B. The canonicaliser cannot read "the matching grants" because no grant is
matched yet.

For S1B, `window_refs` is populated from the **closed action catalogue's declared windows
for the class** — `W_DAY_REFUND` and `W_MONTH_REFUND`, which is what `51 §2` scopes to
`refund.create`.

This is a **superset-safe** placeholder in the only direction that matters: the catalogue
declares every window the class can touch, and grant matching can only narrow it. The
policy slice replaces this source with the grant intersection, and the contract records it
as a **DEFERRED** row rather than a completed one. No S1B assertion depends on
`window_refs` being the grant-derived set.

---

## S1B-C6 — the closed `reason_code` set

### The silence, quoted

`26 §2.0`, verbatim: `reason_code       // from a closed enum`.
`26 §8`'s refund policy sketch, verbatim: `context.reason_code in ApprovedReasons &&`.

**The architecture requires the enum to be closed and never enumerates its members.**

### The owner clarification

S1B declares a closed set for the implemented fixture catalogue, on the closed-catalogue
principle of SR7 — the point being that the field is **not free text**, which is what makes
`rationale` the only free text on the model-facing surface:

```text
CUSTOMER_REPORTED_DAMAGE
CUSTOMER_REPORTED_NOT_RECEIVED
ITEM_RETURNED
DUPLICATE_CHARGE
PRICING_ERROR
```

Each carries a declared `reason_code_scope`, which is the field the `semantic_option_digest`
covers. A `reason_code` outside the set denies `MALFORMED` at schema validation, before the
catalogue check.

**This set is a fixture, not an architecture claim.** It is declared in
`src/kernel/canonicalisation/actionCatalogue.ts` alongside the closed action classes, and a
later slice extending it is a deliberate act with a policy consequence, exactly as ADR-006
requires of the action catalogue itself.

---

## S1B-C7 — the deny code for an `option_id` mismatch before enumeration exists

### The passages, quoted

`26 §7`'s flowchart, verbatim:

> `C3 -->|selector does not index a live option| DC2[DENY: SELECTOR_INVALID]`

`26 §7`'s C′ row, verbatim:

> **v1.2 denials:** `SELECTOR_STALE` if the `option_id` is absent from the live set;
> `SELECTOR_ENUMERATION_STALE` if `enumeration_id.computed_at` exceeds the class's
> `max_age`; `SELECTOR_MALFORMED` if the pair does not parse

### The owner clarification

`SELECTOR_STALE` and `SELECTOR_ENUMERATION_STALE` are properties of **live re-enumeration
under the C′ entity advisory lock**, which S1B explicitly excludes. Emitting either in S1B
would claim a check S1B does not perform.

S1B checks one thing: that the `option_id` the model submitted equals the `option_id`
recomputed from the **authoritative selected option** via
`H(action_class ‖ resource_id ‖ semantic_option_digest)`. A mismatch denies:

```text
DENY: SELECTOR_INVALID
```

which is the flowchart's own code for *"selector does not index a live option"*.

**The enumeration/selector increment replaces this check, and must not merely extend it.**
That slice adds the live re-enumeration under the lock, the `max_age` check, `I53`'s
no-substitution rule, and the mandatory positional-selector negative control. S1B's check
is necessary and is **not sufficient**, and the result document says so.
