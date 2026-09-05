# S1B Owner Implementation Clarifications

**Issued 2026-09-05, at the opening of S1B. Amended 2026-09-05 by the S1B.1 conditional
gate repair pass.**

**S1B.1 withdrew one clarification and superseded another.** Neither is erased. `S1B-C3` is
marked **WITHDRAWN** because the implementation invented an economic rule the architecture
does not establish, and `S1B-C5` is marked **SUPERSEDED** because catalogue membership is
not matching-grant resolution. Their replacements are `S1B-C3a` and `S1B-C5a`, below. The
original text of both is retained in full, so the record shows what was claimed and not
only what survived.

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
| ~~**S1B-C3**~~ | ~~The retained-processing-fee derivation that reproduces the printed `$1.03`~~ — **WITHDRAWN IN S1B.1** | **No** |
| **S1B-C3a** | Retained processing fee provenance — a kernel-owned authoritative **amount** | **No** |
| **S1B-C4** | `counterparty` for `refund.create` is `null`, and the destination is a parameter | **No** |
| ~~**S1B-C5**~~ | ~~`window_refs` at S1B come from the catalogue, because grants are a later slice~~ — **SUPERSEDED IN S1B.1** | **No** |
| **S1B-C5a** | `window_refs` provenance before Cedar — a kernel-owned resolution boundary | **No** |
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

> ### `WITHDRAWN IN S1B.1 — implementation invented an economic rule not established by architecture`
>
> The clarification below is retained verbatim as the historical record of what S1B
> claimed. It is **not in force**. It is replaced by **S1B-C3a**.
>
> **Why it was withdrawn.** The architecture establishes three things: that refunds may
> carry retained processing fees; that a retained processing fee is an authoritative cost
> component; and that the discriminating fixture is vendor amount `$25.00`, retained fee
> `$1.03`, total exposure `$26.03`. It establishes **no** universal 2.9% rate, **no**
> universal `$0.30` fixed charge, **no** rounding formula and **no** processor fee schedule.
> The derivation below reproduced the printed `$1.03` exactly, and that is precisely the
> trap: an implementation agent may not invent an economic rule because the rule reproduces
> a fixture. Agreement with one data point is not authority for a schedule.

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

*(End of the withdrawn S1B-C3. The oracle no longer carries `29`, `1000` or `30`, and no
longer carries a rounding primitive — see S1B-C3a.)*

---

## S1B-C3a — retained processing fee provenance

**In force from S1B.1. Replaces the withdrawn S1B-C3.**

For S1B, the retained fee is a **kernel-owned authoritative input to canonicalisation**. The
fixture value is `$1.03`. **S1B defines no fee schedule and no derivation formula.**

### What that means in the implementation

| | |
|---|---|
| Where it arrives | `AuthoritativeCanonicalisationContext.retainedProcessingFee`, typed `AuthoritativeRetainedFee` or `null` (`src/kernel/canonicalisation/authoritativeCost.ts`) |
| What it carries | an **amount**, the **`source_ref`** of the authoritative record it was read from, and a currency |
| What the constructor does | **adds** it as a `RETAINED_PROCESSING_FEE` cost component. No multiplication, no rounding, no rate |
| If it is absent | for a class the catalogue does not declare cost-component-free the constructor **throws**. It does not emit zero cost components — `26 §2.1.1` names that as the defect `R1` exists to close |
| Model reachability | none. It is `KernelComputed`, it is not a `ProposedIntent` field, and `tests/type-negative/model-windows-into-request.ts` is a compile-negative proving a plain value cannot be assigned into it |

`26 §2.2`'s declared `semantic_option_digest` for `refund.create` is
`line_id · parent_transaction_id · amount · instrument · reason_code_scope`. **The retained
fee is not a member, and S1B.1 did not modify that declaration.** The consequence is the
distinction `tests/canonicalisation/retained-fee-provenance.test.ts` exists to document:

| Change only the authoritative retained fee, `$1.03` to `$1.10` | |
|---|---|
| dispatch `monetary_effect` | **unchanged**, `$25.00` |
| vendor payload, field for field | **unchanged** |
| `option_id`, `semantic_option_digest` | **unchanged** |
| idempotency key | **unchanged** |
| `total_exposure` | **`$26.03` to `$26.10`** |
| reservation-handoff amount (`I18b`) | **`$26.03` to `$26.10`** |
| authority commitment over exposure | **changes** |
| `rationale` | irrelevant throughout |

That is the separation between the **identity of the vendor effect** and the **current
authoritative economic cost of performing it**.

### The authority commitment

`26 §2.1` declares `dispatch_payload_hash` and it covers the payload only, so it cannot move
when the economics move without the vendor request moving — which is exactly this case. S1B.1
therefore states the request's canonical byte form as a function,
`authorizationRequestCanonicalHash`, covering both exposure figures, every cost component and
the window refs. It is a **function and not a request field**: `26 §2.1` declares no
`request_hash`, and inventing one would be the same class of error this pass is repairing.

> **WITHDRAWN BY S1B.2, finding 5.** Both functions are **deleted**. The reasoning above is
> retained as the record and was wrong in one respect that mattered: a helper covering only
> *some* authority-relevant fields cannot support the inference "the hash moved, therefore
> the authority moved" in either direction, and calling it "the authority commitment"
> invited exactly that reading. `26 §2.1` declares no `request_hash` and S1B does not
> pre-design one; the normative row commitment belongs to the journal/audit slice. The
> assertions that used it now read the authoritative **fields** directly. See
> `S1B-result.md §S1B.2` question 10.


### What S1B still does not know

Selecting a real processor's fee model — Stripe's, Shopify's, anyone's — is
adapter/state-ingestion work. That slice populates the same field from a real record and
changes no money-path code. **No passage in the S1B tree — production, test or
documentation — now claims that ACOS knows a universal `2.9% + $0.30` schedule.**
`tests/canonicalisation/source-rules.test.ts` rule 5 asserts it: no fee-schedule type, no
rate constant, no rounding primitive, and no multiplication in the refund constructor.

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
- The **destination is still kernel-derived and still recorded**. S1B.2 finding 3 removed the
  separate `destination_instrument_ref`: the destination is the RECORD-grade parent
  transaction and the instrument it is refunded to, carried as the computed parameters
  `parent_transaction_id` and `instrument` — both members of `26 §2.2`'s declared semantic
  option identity — and never taken from the intent, which is exactly what `26 §11.2`'s cell
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

> ### `SUPERSEDED IN S1B.1`
>
> The clarification below is retained verbatim as the historical record. It is **not in
> force**. It is replaced by **S1B-C5a**.
>
> **Why it was superseded.** It is too strong to become production semantics. The
> architecture defines `window_refs` as the windows the **matching grants** reference, and
> the action catalogue alone does not determine the complete active grant set.
> "Superset-safe" was an argument about the direction of the error, not a claim that the
> source was the right object — and it was not the right object. Cedar/policy/grant
> integration is deliberately not part of S1B, so the honest position is that S1B **does not
> resolve** the set at all: it carries one it was given.

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

*(End of the superseded S1B-C5. The catalogue no longer declares windows at all — see
S1B-C5a.)*

---

## S1B-C5a — window-ref provenance before Cedar

**In force from S1B.1. Supersedes S1B-C5.**

`window_refs` are supplied by a **kernel-owned authoritative grant/window-resolution
boundary**. S1B fixtures provide that boundary directly. **Catalogue membership alone is not
grant resolution.** Actual matching-grant derivation remains **open** to the Cedar/policy
slice.

### What that means in the implementation

| | |
|---|---|
| The boundary | `AuthoritativeGrantWindowContext` (`src/kernel/canonicalisation/grantWindows.ts`) — a type declaration and its rationale, with no executable statement in the file |
| Where it arrives | `AuthoritativeCanonicalisationContext.grantWindows`, `KernelComputed` |
| What the canonicaliser does | **carries** the values into `request.window_refs`, and into the reservation offer |
| What it does **not** do | consult the catalogue. `ActionCatalogueEntry` **no longer declares windows at all** — the field was removed rather than left in place for the wrong reader |
| S1B fixture provenance | kernel/test-controlled, never model-supplied, never inferred from `rationale`; `resolvedBy` records in the value itself that it is a fixture and not a resolution |

### The four properties, and where they are proved

`tests/canonicalisation/window-ref-provenance.test.ts`:

1. **raw/model intent cannot supply `window_refs`** — `MALFORMED / EXTRA_FIELD` at the top
   level, `SELECTOR_MALFORMED / EXTRA_FIELD` nested inside the selector, and the parsed
   intent carries no window key at all. Reinforced by the compile-negative
   `tests/type-negative/model-windows-into-request.ts`;
2. **changing the authoritative grant/window context changes `request.window_refs`** —
   narrowing narrows, an empty grant set yields an empty list, and a window the catalogue
   never mentioned is carried verbatim;
3. **changing `rationale` cannot change them** — identical window refs and an identical
   authority commitment across an innocuous and an injection-shaped rationale;
4. **the action catalogue alone is insufficient** — no catalogue entry carries a window
   field, the catalogue source names no window identifier, the constructor reads
   `context.grantWindows.windowRefs` and nothing catalogue-shaped, and two canonicalisations
   of the *same class, resource and option* produce different window sets.

**No Cedar was implemented to solve this**, and nothing in S1B claims the carried values are
actual matching-grant resolution.

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

---

# S1B.2 — clarifications added by the independent implementation review

The independent review of the S1B/S1B.1 repository returned
`S1B NOT YET ACCEPTED — LOCAL IMPLEMENTATION REPAIRS REQUIRED` with eight findings. Two of
them turn on architecture silences and are recorded here as clarifications; the rest are
mechanical repairs and are recorded in `S1B-implementation-log.md §13` and
`S1B-result.md §S1B.2`.

## S1B-C6a — a `reason_code` must belong to the selected option's `reason_code_scope`

**Extends S1B-C6. Fixture-level, not a production-policy claim.**

### The two passages, quoted

`26 §2.0`, on the model-facing surface:

> `reason_code       // from a closed enum`

`26 §2.2`, the declared semantic option identity for this class:

> `refund.create | line_id · parent_transaction_id · amount · instrument · reason_code_scope`

### The silence

The architecture closes the `reason_code` enum and makes `reason_code_scope` part of the
option's semantic identity. It never states the relation between them. S1B-C6 supplied the
fixture enumeration; it did not supply the mapping's consequence.

### The owner clarification

`reason_code_scope` is part of `refund.create`'s **semantic option identity**. A proposed
`reason_code` must therefore belong to the scope of the option the selector addressed:

```text
REASON_CODE_SCOPES[intent.reason_code] == option.reason_code_scope
```

Otherwise the emitted `AuthorizationRequest` records a reason that contradicts the effect it
selected, and `26 §8`'s refund policy — which reads `context.reason_code in ApprovedReasons`
— evaluates a reason code against a scope the model did not choose.

The fixture mapping, from S1B-C6:

```text
CUSTOMER_REPORTED_DAMAGE       -> GOODS_FAULT
CUSTOMER_REPORTED_NOT_RECEIVED -> GOODS_FAULT
ITEM_RETURNED                  -> GOODS_RETURNED
DUPLICATE_CHARGE               -> BILLING_ERROR
PRICING_ERROR                  -> BILLING_ERROR
```

### The denial, and why it is not a new code

`DENY: SELECTOR_INVALID`, detail `REASON_CODE_SCOPE_MISMATCH`.

Both halves are individually well-formed — the reason code is in the closed enum and the
option is authoritative — and it is their **combination** that is inadmissible. That is what
`26 §7`'s `SELECTOR_INVALID` says: the selector does not index a permissible option **for
this intent**. No new denial code was invented; `26 §7` declares the set and S1B.2 does not
extend it.

It **denies** rather than throwing, because the model can produce the pair: a valid reason
code, and a validly content-addressed option from another scope.

### The scope of this rule

**A fixture-level consistency rule tied to S1B-C6.** It is *not* a claim that this enum,
this grouping, or this mapping is universal production policy. Selecting the production
reason-code taxonomy belongs to the policy slice, exactly as selecting a processor fee model
belongs to the adapter slice (S1B-C3a). What S1B.2 asserts is narrower and unavoidable: for
whatever mapping is in force, the proposed code and the selected option's scope must agree.

The **semantic option digest is unchanged.** `reason_code_scope` was already a declared
member; `reason_code` is not one and does not become one.

### Where it is proved

`tests/canonicalisation/canonicalisation-cohesion.test.ts` — the table row, plus the
exhaustive pair sweep against `VC_C1_REASON_CODE_SCOPES`, which the oracle transcribes by
hand and which imports nothing from `src/`.

---

## S1B-C8 — `ACOS-JCS-1` canonical text must be injective over accepted strings

### The passage, quoted

`30 §5.3`, the hazard table's rules column:

> **Nulls vs empty strings** — "Single `0x00` sentinel byte for null; an empty string is a
> zero-length value."
> **Unicode form** — "UTF-8, NFC."
> **JSON-valued columns** — "RFC 8785 (JCS), applied to the field's value."

### The silence

The specification says how each accepted value is encoded. It does not say **which strings
are accepted**, and three classes of input make the encoding non-injective — two distinct
values producing identical bytes:

1. **`U+0000` versus the null sentinel.** `null` encodes as one `0x00` byte. A text value
   containing `U+0000` UTF-8-encodes to the same byte. At a nullable text position they are
   indistinguishable.
2. **Unpaired UTF-16 surrogates.** A JavaScript string may hold a lone surrogate, which is
   not a Unicode scalar value. Node's UTF-8 encoder substitutes `U+FFFD` for each one, so a
   string holding only `U+D800` and a string holding only `U+D801` — distinct values —
   encode to the same three bytes.
3. **NFC-normalised JSON key collisions.** ACOS adds an NFC rule that RFC 8785 does not
   have, so two distinct source keys can normalise to one canonical name. RFC 8785 never had
   to answer this because it never normalises.

### The owner clarification

ACOS canonical text — text fields, the structure kind, JSON string values and JSON object
keys — admits only **well-formed Unicode scalar sequences containing no `U+0000`**.

* `U+0000` is forbidden. PostgreSQL `text` cannot store it, so nothing is lost, and
  excluding it restores injectivity: `null` is one `0x00` byte, an empty string is a
  zero-length value, and no accepted text can imitate either.
* A string that is not a well-formed scalar sequence is **rejected before NFC normalisation
  and before any UTF-8 encoding**. RFC 8785 §3.2.2.2 already requires malformed Unicode data
  to fail rather than be substituted; this states where in the pipeline that happens.
* For JSON objects the order is fixed: **validate every key, normalise every key to NFC,
  REJECT if two normalise alike, sort the NORMALISED keys per the declared JCS ordering,
  serialise the NORMALISED keys.** Sorting pre-normalised keys and normalising while writing
  would emit an object carrying one canonical name twice, which is not a JSON object; and
  silently picking one spelling would map two distinct objects onto one canonical form.

Rejection, not repair. An object whose canonical form would be ill-formed **has no canonical
form**.

### Where it fails closed

At the **wire boundary** for anything model-supplied — `resource_ref`, both selector
components and `rationale` deny `MALFORMED` / `SELECTOR_MALFORMED` with detail
`NOT_CANONICAL_TEXT`, before the rationale seal and therefore before any hash. In the
**byte layer** it throws, because reaching it means an inadmissible string was assembled
internally.

`rationale` matters here specifically: its lineage commitment is taken over UTF-8 NFC bytes,
so two distinct rationales carrying different lone surrogates would commit **identically** —
a silent collision in the one field whose entire purpose is auditability.

### What this does not change

Money encoding, timestamp precision and field framing are untouched. NFC normalisation of
*values* is unchanged: two Unicode forms of the same string still hash alike, which is the
existing rule and remains correct.

### Where it is proved

`tests/canonicalisation/canonical-text-injectivity.test.ts`, which first demonstrates the
hazard against Node itself — two distinct lone surrogates encoding to identical bytes — and
then proves each rule, each with a positive control (a valid supplementary character is
accepted; a single canonically-equivalent key serialises normally).
