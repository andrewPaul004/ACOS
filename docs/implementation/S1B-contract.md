# S1B Contract — Architecture → Mechanism → Test → Status

**Scope: S1B only.** The second S1 increment: the **Effect Canonicaliser core** and the
**first money-bearing constructor, `refund.create`**.

S1B proves one arrow:

```text
model intent  →  authoritative construction
```

It does **not** prove:

```text
authoritative construction  →  policy  →  reservation  →  decision
```

**Authoritative architecture input:** `docs/architecture/v1.3.1/` (ACOS Operating Spine
v1.3, package issue v1.3.1). Treated as immutable. **The architecture package was not
modified by S1B in any respect.** Every clause below is extracted from it; where this
document paraphrases, it names the section it paraphrases, and where the architecture is
silent or ambiguous the reading is recorded in `S1B-owner-clarifications.md` rather than
resolved silently.

**Accepted baseline this increment builds on:** S1A + S1A.1 at `c1ae9f0`, 18 test files,
157 tests passing, `tsc --noEmit` clean, `eslint --max-warnings 0` clean, working tree
clean. Verified before the first S1B edit; recorded in `S1B-implementation-log.md §1`.

---

## 0. The oracle discipline this document is written under

`36 §0`, verbatim, in force unchanged from S1A:

> **Independent validation must not call the same production function twice and call
> agreement proof.**

`36 §0`'s oracle table, exposure-construction row, verbatim:

> Exposure construction (**I18a–I18d**, v1.2 — I18 retired) | Hand-computed fixture table
> **plus** the settled-cost reconciliation at the bank line. VC-C1's negative case
> ($26.03 against a $25.00 cap → DENY) is the discriminating fixture

`ADR-021`, Testing paragraph, verbatim:

> Per-class construction tests whose expected values are computed **independently of the
> production constructor** — a second implementation or a hand-computed fixture table.
> `46 R1` is explicit: a test that calls the same function twice proves nothing.

| Rule | S1B implementation |
|---|---|
| No test computes its expected value with the production function | `tests/support/canonicalisationOracle.ts` imports **nothing** from `src/`. It carries hand-authored minor-unit integers and its own arithmetic helpers. A test reads its source and fails on any `src/` import |
| The oracle may do elementary arithmetic itself | It multiplies, rounds half-away-from-zero, and adds. Those three operations are written out in the oracle file |
| A negative control must prove the fixture discriminates | `tests/negative-controls/retained-fee-escape.test.ts` carries a **test-only** wrong constructor that sets `total_exposure = vendor_amount`. The suite asserts the VC-C1 fixture **rejects** it. Without this, a passing VC-C1 is indistinguishable from a fixture that cannot detect the escape |
| I21 must be structural, not a runtime key check | `tests/type-negative/` is a separate TypeScript project compiled by `tsc --noEmit`. Violating files must produce a **specific** diagnostic; a positive-control file in the same project must compile clean, proving the harness discriminates |

---

## 1. `ProposedIntent` — the exact model-facing write surface

### 1.1 Architecture source

`26 §2.0`, verbatim:

```text
ProposedIntent {
  action_class      // from the closed catalogue (SR7)
  resource_ref      // must resolve to a RECORD-grade entity inside the task's context_spec scope
  selector {                         // v1.2: content-addressed, never positional
    enumeration_id                   // names one EnumeratedOptionSet the kernel computed
    option_id                        // = H(action_class ‖ resource_id ‖ semantic_option_digest)
  }
  reason_code       // from a closed enum
  rationale         // free text; journaled for the audit record; NEVER parsed, NEVER interpreted as authority
}
```

`26 §7` step B, verbatim: `Schema valid? only 5 fields present?` → `no` → `DENY: MALFORMED`.

`26 §2.0`, the boxed rule, verbatim:

> **Model output may propose intent and select among kernel-enumerated options. It may
> never supply an authoritative precondition, an exposure figure, or any field of the
> dispatched request.**

### 1.2 Mechanism

`src/kernel/canonicalisation/intent.ts` — `parseProposedIntent(raw: unknown)`.

Exactly five top-level keys; exactly two selector keys. **Fail closed on every deviation**,
including an extra field carrying a plausible name. Accept-and-ignore is prohibited: an
ignored `amount` field is indistinguishable at the boundary from an honoured one, and the
whole point of `26 §2`'s rewrite is that the money-bounding fields are *not expressible*.

| Rejection | Deny |
|---|---|
| Not an object; an array; null | `MALFORMED` |
| Any missing required field | `MALFORMED` |
| Any extra top-level field | `MALFORMED` |
| `selector` not an object, or extra/missing selector fields | `SELECTOR_MALFORMED` |
| `action_class` outside the closed catalogue | `UNKNOWN_ACTION` |
| `reason_code` outside the closed enum | `MALFORMED` |
| `rationale` not a string, or over the declared byte bound | `MALFORMED` |

`26 §7` orders schema (B) before catalogue (C), so an intent that is *both* malformed and
carries an unknown class denies `MALFORMED`.

### 1.3 Test

`tests/canonicalisation/intent-boundary.test.ts`,
`tests/canonicalisation/adversarial-intent.test.ts`.

---

## 2. `I21` as a real type boundary

### 2.1 Architecture source

Registry `§1.2` `I21`, statement and test columns, verbatim:

> No `AuthorizationRequest` field is populated from `ProposedIntent` other than
> `action_class`, `resource_ref`, `selector` and `reason_code`.

> Type-level property; a test constructing an `AuthorizationRequest` from a fifth
> `ProposedIntent` field must not compile. **v1.2: `selector` is
> `{enumeration_id, option_id}` and remains one field.**

`36 §2`, verbatim:

> A test attempting to construct a request from any other intent field **must not
> compile**.

### 2.2 Mechanism — three separate input types, and three nominal brands

The constructor never receives a `ProposedIntent`. It receives three kernel-owned inputs
that are not interconvertible:

| Type | Owner | Carries |
|---|---|---|
| `PermittedIntentFields` | derived from the intent by `intent.ts` alone | the four permitted fields, and nothing else — **the type has no `rationale` key at all** |
| `AuthoritativeCanonicalisationContext` | kernel | resolved resource, principal, ledger currency, catalogue entry, clock, the **authoritative retained processing fee amount** (**S1B-C3a**), and the **authoritative grant/window-resolution boundary** (**S1B-C5a**) |
| `SelectedAuthoritativeOption` | kernel | the semantic fields of the selected refund option |

They are **not merged into one convenience object**, and the constructor signature accepts
them as three separate properties, so widening one to carry the others is a type change a
reviewer sees.

Three nominal brands make the boundary load-bearing rather than conventional:

- **`OpaqueRationale`** — `rationale`'s type. It is **not** a `string` and is not
  assignable to one. It exposes `byteLength` and nothing else. There is no accessor that
  returns its characters, so no production function *can* parse it; the only operation
  defined on it is inclusion in the lineage commitment.
- **`KernelComputed<T>`** — the type of every authority-bearing field on
  `AuthorizationRequest` and `DispatchPayload` other than the four permitted intent
  fields. It is minted only by `brands.ts`'s `computed()`, which is not re-exported
  outside `src/kernel/canonicalisation/`. A raw value taken from an intent is not
  assignable to it.
- **`PermittedIntentField<T>`** — the type of the four fields that *are* permitted to
  cross. The type system therefore distinguishes "this came from the intent, and is
  permitted to" from "this was computed".

### 2.3 Test — a real compile-negative fixture, with a positive control

`tests/type-negative/` is a second TypeScript project. `tests/canonicalisation/i21-type-boundary.test.ts`
shells `tsc --noEmit -p tests/type-negative/tsconfig.json`, parses the diagnostics, and
asserts:

| File | Assertion |
|---|---|
| `positive-control.ts` | **compiles clean** — zero diagnostics. Without this the negative files could be failing for an unrelated reason (a typo, a bad import) and the test would still pass |
| `rationale-into-request.ts` | assigning `intent.rationale` into a request field is an error |
| `rationale-parsed.ts` | calling a string method on `rationale` is an error |
| `fifth-field-request.ts` | constructing an `AuthorizationRequest` from a fifth intent field is an error |
| `intent-as-context.ts` | passing a `ProposedIntent` where `AuthoritativeCanonicalisationContext` is expected is an error |
| `model-amount-into-exposure.ts` | assigning a model-supplied amount into `exposure.vendorAmount` is an error |

The test asserts an error **on the expected line of the expected file**, not merely that
the project failed to compile.

**And a second, independent enforcement.** `tests/canonicalisation/no-rationale-parser.test.ts`
reads the `src/` tree and fails if `rationale` is referenced anywhere outside
`intent.ts` and `lineage.ts` — the same source-reading technique
`tests/integration/exposure/lock-order.test.ts` already uses for the lock order.

---

## 3. The canonicaliser framework and the constructor registry

### 3.1 Architecture source

`26 §7`, step C2, verbatim:

> `Registered canonical constructor for this class?` → `no` →
> `DENY: NOT_CANONICALISABLE — class not autonomy-eligible`

`36 §2`, verbatim:

> **Selector rejection** (v1.1, superseded in detail by VC-C2/VC-C3): an action class with
> no registered constructor must produce `DENY: NOT_CANONICALISABLE`.

`ADR-021`, verbatim:

> **Where an action class cannot be deterministically canonicalised, it is not eligible for
> autonomous execution** — the same disqualifier logic `25 §7` applies to idempotency.

### 3.2 Mechanism

`src/kernel/canonicalisation/registry.ts` and `canonicaliser.ts`.

- The registry is keyed by closed `action_class`. There is **no default constructor and no
  fallback**; a lookup miss denies.
- A class **present in the closed catalogue** but **absent from the registry** denies
  `NOT_CANONICALISABLE`. A class absent from the catalogue denies `UNKNOWN_ACTION`
  earlier, at step C. The two are distinct and are asserted separately.
- Each registered constructor declares its `constructor_id`. It cannot choose an unsigned
  arbitrary version string: the `ConstructorVersionRecord` is resolved and its signature
  verified **before** the constructor body runs.
- A constructor's parameter type is closed. It cannot reach the raw intent, cannot reach
  `rationale`, and cannot reach unparsed input.

The closed action catalogue (`src/kernel/canonicalisation/actionCatalogue.ts`) is the
extension point, per SR7 and ADR-006. S1B registers **exactly one** constructor. The
framework is generic over the closed catalogue; it builds **no speculative vendor
abstraction**.

### 3.3 Test

`tests/canonicalisation/registry.test.ts`.

---

## 4. Constructor version records — the S1B portion of `I61`

### 4.1 Architecture source

`26 §2.1.2`, verbatim:

```text
ConstructorVersionRecord {
  constructor_id, action_class,
  semantic_major, non_semantic_minor,
  changed_fields[], semantic_change: bool,
  signed_at, signature
}
```

and, verbatim:

> **The semantic/non-semantic line is declared, not asserted per deploy.** A bump is
> **semantic by definition** — and cannot be declared otherwise — if it changes any of:
> exposure computation, `cost_components` membership, enumeration membership, the
> `semantic_option_digest`, counterparty derivation, `value_direction`, recoverability, or
> the dispatch payload's field set.

Registry `§1.2` `I61`, verbatim:

> Every `AuthorizationRequest`, `AuthorizationDecision`, journal row and approval binding
> records a `constructor_version` resolving to a **signed** `ConstructorVersionRecord`, and
> no approval resumes under a constructor whose `semantic_major` differs from the bound
> one.

`50 §2` class 19 — constructors are owner-signed control artifacts.

### 4.2 Mechanism

`src/kernel/canonicalisation/constructorVersion.ts`.

- **Real signature verification** using Node's built-in `node:crypto`, **Ed25519**, over
  the `ACOS-JCS-1`-shaped canonical bytes of the record's fields excluding `signature`.
  `30 §5.3` already specifies Ed25519 over `ACOS-JCS-1` canonical bytes for the journal
  attestation, so the primitive is the package's own.
- Test keys are used. **No production key management is built** — the resolver takes the
  verifying public key as an argument.
- Canonicalisation **fails closed** when the referenced record is: missing; carries a
  different `action_class`; carries a different `constructor_id`; has an invalid
  signature; or is structurally malformed (negative or non-integer version numbers,
  `semantic_change: false` while `changed_fields` intersects the semantic-by-definition
  set, unknown `changed_fields` member, duplicate `changed_fields`).
- The **complete version identity** — `constructor_id`, `action_class`, `semantic_major`,
  `non_semantic_minor`, `semantic_change`, `changed_fields`, `signed_at` and the
  `record_hash` — is recorded on the canonical output.
- **Not implemented in S1B:** approval-resume semantic-version behaviour, which needs the
  approval state machine. The representation carries `semantic_major` and
  `non_semantic_minor` as separate integers precisely so the later slice can enforce
  `semantic_major` differs → refuse, `non_semantic_minor` differs → replay-compatible;
  `replayCompatibility()` is provided and **is not called by any S1B decision path**.

### 4.3 Test

`tests/canonicalisation/constructor-version.test.ts`.

---

## 5. Canonical bytes — the `ACOS-JCS-1` rules, applied to canonicaliser structures

### 5.1 Architecture source

`30 §5.3`, the hazard table, verbatim in the rules column:

| Hazard | `ACOS-JCS-1` rule |
|---|---|
| `NUMERIC` scale: `25.0` vs `25.00` | **Per-column declared decimal scale**, serialised as a string at that exact scale. `25.0` and `25.00` are **different bytes**, deliberately |
| Timestamp precision and zone | RFC 3339, **UTC**, exactly 6 fractional digits, `Z` suffix |
| Column order | **Fixed, declared per row kind**, in the specification — never the physical column order |
| Nulls vs empty strings | Single `0x00` sentinel byte for null; an empty string is a zero-length value |
| Unicode form | **UTF-8, NFC** |
| JSON-valued columns | **RFC 8785 (JCS)**, applied to the field's value |
| Field framing | Every field prefixed with its **4-byte big-endian byte length** |

### 5.2 Mechanism

`src/kernel/canonicalisation/canonicalBytes.ts`.

- A structure is serialised against a **declared field order for its kind**, never against
  JavaScript object key order. Insertion order is therefore structurally incapable of
  changing the bytes.
- Money is emitted as a decimal string at the declared scale 2, reusing S1A's
  `src/kernel/exposure/money.ts` — so `25.0` and `25.00` remain different bytes because
  the type cannot express `25.0`.
- Structured (JSON) values — `vendor_parameters` — go through an RFC 8785 canonicaliser.
  **Non-integer `number`s are rejected**, not rounded: money is a decimal string in this
  codebase, and ES6 double serialisation on a money path is exactly the hazard the
  specification exists to close.
- `JSON.stringify` is **never** used as an authority-bearing byte representation. A test
  reads `src/kernel/canonicalisation/` and fails on any `JSON.stringify` there.

### 5.3 What S1B does and does not claim

**Claims:** the canonicaliser's own structures hash deterministically under the
`ACOS-JCS-1` rules, with golden byte fixtures.

**Does not claim:** `VC-A3`, `ACOS-JCS-1` cross-implementation byte-identity. That gate
requires a **second independent implementation** — the audit-store trigger — which is later
S1 audit work. `36 §2` VC-A3 is **OPEN** after S1B and is reported as such.

### 5.4 Test

`tests/canonicalisation/canonical-bytes.test.ts` (golden bytes and hazards),
`tests/canonicalisation/hash-binding.test.ts` (the six required hash properties).

---

## 6. Canonical output — `AuthorizationRequest` and `DispatchPayload`

### 6.1 Architecture source

`26 §2.1`, both structures printed verbatim in the deliverable, and:

> `AuthorizationRequest` and `DispatchPayload` are emitted **together and hashed
> together**. The adapter receives the payload verbatim and **constructs nothing**.

`26 §2.1.1`, the four invariants, verbatim:

| Invariant | Assertion |
|---|---|
| **I18a** | Where the vendor request carries a monetary field, `dispatch_payload.monetary_effect == exposure.vendor_amount`. Where it does not, both are NULL |
| **I18b** | `reservation.amount == exposure.total_exposure`, **exactly, always, no tolerance** |
| **I18c** | Where `vendor_amount` is non-null, `total_exposure ≥ vendor_amount`, with equality only for classes the catalogue declares cost-component-free |
| **I18d** | At settlement, `settled_cost` is within the class's declared `settlement_tolerance` **of `total_exposure`** |

### 6.2 Mechanism

`src/kernel/canonicalisation/types.ts`, `canonicaliser.ts`.

- Every authority-bearing field is `KernelComputed<T>`.
- `exposure.vendorAmount` and `exposure.totalExposure` are **two fields**. Neither is
  overloaded with the other's meaning: `vendorAmount` is the money in the dispatched
  request, `totalExposure` is the economic loss.
- The two structures are emitted together by one call and bound by
  `request.dispatchPayloadHash = H(canonical bytes of DispatchPayload)`, which is the
  binding `26 §2.1` declares.
- `dispatchPayload.vendorParameters` already contains the **final** vendor parameters. A
  future adapter consumes it verbatim. **No adapter is implemented in S1B.**
- **I18d is not implemented** — it is a settlement-side assertion and there is no
  settlement path in S1B.

### 6.3 Test

`tests/canonicalisation/vc-c1-refund-construction.test.ts`.

---

## 7. `refund.create` — the first production constructor

### 7.1 Architecture source

`26 §2.2`, `semantic_option_digest` table, verbatim row:

| Class | `semantic_option_digest` covers |
|---|---|
| `refund.create` | `line_id` · `parent_transaction_id` · `amount` · `instrument` · `reason_code_scope` |

and, verbatim:

> `option_id = H(action_class ‖ resource_id ‖ semantic_option_digest)`, and the digest must
> cover every field whose change would make the option a *different effect*.

`26 §11.2` row 3, verbatim: `refund.create` · `INBOUND_ORIGINAL_INSTRUMENT` · counterparty
*"n/a — destination derived by the canonicaliser from the RECORD-grade transaction, never
from the intent"* · customer novelty `NEW`, `RETURNING`.

`26 §5`: `refund.create` is **COMPENSABLE**.
`51 §2`: the class's named windows are `W_DAY_REFUND` and `W_MONTH_REFUND`.
`51 §5.1`: settlement tolerance is `EXACT`, because *"Settled cost is fully determined
pre-dispatch: refund amount plus the processor's published retained fee."*

### 7.2 Mechanism

`src/kernel/canonicalisation/constructors/refundCreate.ts`.

**Nothing in the table below is read from `ProposedIntent`. It is not expressible there.**

| Output field | Source |
|---|---|
| `parameters.amount` | `SelectedAuthoritativeOption.amount` |
| `parameters.lineId`, `parentTransactionId`, `instrument` | the authoritative option |
| ~~`parameters.destinationInstrumentRef`~~ | derived from the authoritative parent transaction. **WITHDRAWN BY S1B.2, finding 3 — see §16.3.** It was an effect dimension outside `26 §2.2`'s declared option identity; the destination is now carried by the content-addressed `parent_transaction_id` and `instrument` |
| `exposure.vendorAmount` | `= parameters.amount` |
| `exposure.costComponents[]` | the retained processing fee **amount** on the authoritative context, added — not derived (clarification **S1B-C3a**) |
| `exposure.totalExposure` | `vendorAmount + Σ costComponents` |
| `exposure.currency` | the single ledger currency, from context |
| `recoverability` | `COMPENSABLE`, from the action catalogue |
| `valueDirection` | `INBOUND_ORIGINAL_INSTRUMENT`, from the action catalogue |
| `counterparty` | `null` — `26 §11.2` prints `n/a` for this class (clarification **S1B-C4**) |
| `customerNovelty` | the authoritative customer record |
| `windowRefs` | carried from `context.grantWindows`, the authoritative grant/window-resolution boundary (clarification **S1B-C5a**). **Not** the catalogue — `ActionCatalogueEntry` declares no windows |
| `dispatchPayload.vendorParameters` | computed; final; adapter-consumable verbatim |
| `dispatchPayload.monetaryEffect` | `= exposure.vendorAmount`, **I18a** |

**There is no retained-fee derivation.** S1B.1 withdrew `S1B-C3`, which asserted a
`round_half_away(amount × 2.9%) + $0.30` schedule on the strength of the architecture's
printed `$1.03`. The architecture establishes that refunds may carry a retained fee, that
the fee is an authoritative cost component, and that the fixture is
`$25.00 / $1.03 / $26.03` — and no rate, no fixed charge, no rounding rule and no schedule.
`S1B-C3a` is in force: the fee is a kernel-owned authoritative **amount**, carried with the
`source_ref` of the record it was read from, and the constructor performs no multiplication
and no rounding.

Two S1B.1 rules keep that true rather than intended:

- `tests/canonicalisation/source-rules.test.ts` **rule 5** — no fee-schedule type, no rate
  constant, no rounding primitive anywhere on the S1B surface, and no `mulByRational` in the
  refund constructor;
- `tests/canonicalisation/source-rules.test.ts` **rule 6** — the catalogue declares no
  windows, and no module reads a catalogue window field into `window_refs`.

### 7.3 Test

`tests/canonicalisation/refund-semantic-digest.test.ts` — one-at-a-time mutation over all
five declared digest fields; each must change `semantic_option_digest` **and** `option_id`.

---

## 8. VC-C1 — the discriminating fixture, and exactly what S1B may claim

### 8.1 Architecture source

`36 §2`, verbatim:

> **VC-C1** additionally asserts the *negative* case the retirement was about: a $25.00
> line refund with a $1.03 retained fee computes `total_exposure = $26.03` and **denies
> `PER_ACTION`** against a $25.00 cap.

### 8.2 What S1B proves

```text
refund amount visible to vendor: $25.00
retained processing fee:          $1.03

vendor_amount:                    $25.00
total_exposure:                   $26.03
```

| Assertion | Invariant | S1B |
|---|---|---|
| `dispatch monetary effect == vendor_amount == $25.00` | **I18a** | **PROVEN** |
| the quantity offered to the reservation layer `== total_exposure == $26.03` | **I18b**, construction half | **PROVEN** — offered through the `ExposureReservationHandoff` port. **No reservation is taken**, because S1B has not entered the money transaction |
| `$26.03 >= $25.00` | **I18c** | **PROVEN** |
| `$26.03 > $25.00` per-action cap → `DENY: PER_ACTION` | — | **OPEN.** Requires Cedar/per-action policy, which S1B does not implement |

### 8.3 The claim S1B is permitted to make

```text
VC-C1 construction half:      PASS
VC-C1 policy-denial half:     OPEN — Cedar slice
Full VC-C1:                   PARTIAL
```

**No temporary duplicate policy engine is built to make a test say DENY.** An independent
oracle shows that `$26.03 > $25.00` and therefore that a correct policy must deny
`PER_ACTION`; that is an arithmetic fact about the constructed exposure, reported as such
and not as a policy result.

---

## 9. Idempotency key

### 9.1 Architecture source

`25 §7`, effect layer, verbatim:

> `H(task_id ‖ action_class ‖ resource_id ‖ semantic_param_digest)`

and, verbatim:

> **The effect key is deterministic, not random.** [...] A UUID minted at attempt time
> provides no protection against exactly the failure that matters.

> **`semantic_param_digest` excludes non-semantic fields** — timestamps, request ids, retry
> counters — so a functionally identical retry produces an identical key.

`24 §3` K4, verbatim:

> Idempotency key is a deterministic function of `(task_id, action_class, resource_id,
> semantic_parameter_digest)` computed by the kernel over the **canonicalised** parameters
> — never a random UUID, and **never including `journal_seq`**, which is allocated after
> the key is computed.

Registry `I42`, test column, verbatim:

> **v1.2: assert `journal_seq` is not an input to the key, so a serialisation-failure retry
> regenerates the same key** (SR-A4).

### 9.2 Mechanism

`src/kernel/canonicalisation/idempotency.ts`. The four inputs, in the declared order,
under `ACOS-JCS-1` framing. `rationale` is not an input and **cannot be** — its type is
`OpaqueRationale`, which the key function does not accept. There is no clock read, no
random source and no sequence read anywhere in the module.

### 9.3 Test

`tests/canonicalisation/idempotency-key.test.ts`.

**Not implemented in S1B:** dispatch, the outbox claim, duplicate-send reconciliation, and
the `I42` database unique constraint.

---

## 10. The S1A integration boundary

`26 §2.1.1` **I18b**, verbatim: `reservation.amount == exposure.total_exposure`,
**exactly, always, no tolerance.**

S1B defines the port and **does not wire the transaction**:

```ts
// src/kernel/canonicalisation/ports/reservationHandoff.ts
export interface ExposureReservationOffer {
  readonly offeredAmount: Money;      // === request.exposure.totalExposure, by I18b
  readonly currency: string;
  readonly windowRefs: readonly string[];
}
```

`offerForReservation(request)` returns that shape and asserts `offeredAmount ===
request.exposure.totalExposure` at the boundary. For the VC-C1 fixture the offered amount
is **`$26.03`**, and `windowRefs` are the ones the authoritative grant/window boundary
supplied — never the catalogue's (**S1B-C5a**).

Changing only the authoritative retained fee moves the offered amount with it
(`$26.03` to `$26.10`) while leaving the dispatched vendor request and the `option_id`
untouched. `tests/canonicalisation/retained-fee-provenance.test.ts` asserts the whole pair.

**The accepted S1A exposure ledger is not modified by S1B.** No file under
`src/kernel/exposure/` is edited; no migration is added; no authority quantity changes.
S1A's `money.ts` is *imported*, not altered.

---

## 11. Requirement → mechanism → test → status

| # | Requirement | Architecture source | Mechanism | Test | Status |
|---|---|---|---|---|---|
| 1 | Exact five-field `ProposedIntent` parsing | `26 §2.0`, `26 §7` step B | `intent.ts` | `intent-boundary.test.ts` | **S1B** |
| 2 | Unknown/extra fields reject, never ignored | `26 §7` step B | `intent.ts` | `intent-boundary.test.ts`, `adversarial-intent.test.ts` | **S1B** |
| 3 | `rationale` has zero authority effect | ADR-006, `26 §2.3`, clarification **S1B-C1** | `OpaqueRationale`, `lineage.ts` | `rationale-non-authoritative.test.ts` | **S1B** |
| 4 | `I21` compile-negative boundary | `I21`, `36 §2` | three input types, three brands | `i21-type-boundary.test.ts` + `tests/type-negative/` | **S1B** |
| 5 | Unregistered constructor → `NOT_CANONICALISABLE` | `26 §7` step C2, `36 §2` | `registry.ts` | `registry.test.ts` | **S1B** |
| 6 | Signed constructor version verifies | `26 §2.1.2`, `I61` | `constructorVersion.ts`, Ed25519 | `constructor-version.test.ts` | **S1B** |
| 7 | Invalid version signature fails closed | `I61` | `constructorVersion.ts` | `constructor-version.test.ts` | **S1B** |
| 8 | Digest changes for every declared semantic field | `26 §2.2` | `optionDigest.ts` | `refund-semantic-digest.test.ts` | **S1B** |
| 9 | `$25.00 + $1.03` constructs `$26.03` | `26 §2.1.1`, `36 §2` VC-C1 | `refundCreate.ts` | `vc-c1-refund-construction.test.ts` | **S1B** |
| 10 | Dispatch monetary amount stays `$25.00` (I18a) | `I18a` | `refundCreate.ts` | `vc-c1-refund-construction.test.ts` | **S1B** |
| 11 | Wrong `total_exposure = vendor_amount` is caught | `36 §0` | test-only unsafe constructor | `negative-controls/retained-fee-escape.test.ts` | **S1B** |
| 12 | Idempotency key excludes rationale and sequencing | `25 §7`, `24 §3` K4, `I42` | `idempotency.ts` | `idempotency-key.test.ts` | **S1B** |
| 13 | Semantic change alters the idempotency key | `25 §7` | `idempotency.ts` | `idempotency-key.test.ts` | **S1B** |
| 14 | Dispatch hash deterministic; order-independent | `30 §5.3` | `canonicalBytes.ts` | `canonical-bytes.test.ts`, `hash-binding.test.ts` | **S1B** |
| 15 | Rationale-only mutation cannot alter the dispatch hash | clarification **S1B-C1** | `lineage.ts` | `rationale-non-authoritative.test.ts` | **S1B** |
| 16 | S1A's 157 tests remain green; no authority quantity changes | — | no edit under `src/kernel/exposure/` | full suite | **S1B** |
| — | `enumerate_effects`, `context_spec` projection, enumeration rate limit | `26 §2.0.1`, VC-C2 | — | — | **DEFERRED** |
| — | C′ advisory lock, live re-enumeration, `SELECTOR_STALE`, `SELECTOR_ENUMERATION_STALE`, positional negative control | `26 §7` C′, `I53`, VC-C3 | — | — | **DEFERRED** |
| — | Cedar, per-action cap, `DENY: PER_ACTION` | `26 §8`, VC-C1 policy half | — | — | **DEFERRED** |
| — | Approval state machine, `CONSTRUCTOR_SEMANTIC_CHANGE` on resume | `26 §12`, VC-C4 | representation only | — | **DEFERRED** |
| — | Reservation transaction integration, `I18b` runtime equality | `26 §7` step R | port only | — | **DEFERRED** |
| — | Adapters, vendor HTTP, outbox, dispatch | `25 §7`, `48` | — | — | **DEFERRED** |
| — | Journal, audit mirror, `ACOS-JCS-1` cross-implementation (VC-A3) | `30 §5`, `I41` | — | — | **DEFERRED** |
| — | `I18d` settlement tolerance | `I18d` | — | — | **DEFERRED** |
| — | AI CEO, any LLM | `27` | — | — | **DEFERRED** |

---

## 12. Explicit non-goals of S1B

Recorded so a later reader does not mistake absence for oversight. S1B does **not**
implement, and does **not** claim: the full Effect Gateway; Cedar or any policy engine;
`enumerate_effects` as a model capability; the C′ stale-selector/concurrency protocol; any
real adapter; the audit plane; the AI CEO or any LLM. **No hidden or temporary policy
engine was added anywhere in the tree** — a test asserts that no file under `src/`
contains a per-action-cap comparison or the string `PER_ACTION`.

---

## 15. S1B.1 — what the conditional gate repair changed in this contract

S1B was accepted **CONDITIONAL** on three local repairs. Two of them changed the contract
above; the third changed no production source at all.

| Repair | Contract effect |
|---|---|
| **1 — VC-S8 harness ordering (S1A-H5)** | none. A test-harness rendezvous at actual `window_balance` lock ownership. No production money-path source changed, no money-path semantics changed, and the reversed-order `40P01` negative control retained |
| **2 — retained fee (S1B-C3 withdrawn, S1B-C3a in force)** | the context carries an authoritative fee **amount**, not a schedule. `ProcessorFeeSchedule` is removed from the tree. The constructor adds; it does not derive |
| **3 — `window_refs` (S1B-C5 superseded, S1B-C5a in force)** | the context carries an authoritative grant/window-resolution boundary. `ActionCatalogueEntry.declaredWindows` is **removed**, so the catalogue cannot be read as a grant set |

### New surface

| File | What it is |
|---|---|
| `src/kernel/canonicalisation/authoritativeCost.ts` | `AuthoritativeRetainedFee` — an amount, a `source_ref`, a currency |
| `src/kernel/canonicalisation/grantWindows.ts` | `AuthoritativeGrantWindowContext` — window refs and the boundary that resolved them. A type declaration with no executable statement |
| ~~`authorizationRequestCanonicalHash` / `authorizationRequestHash` in `canonicaliser.ts`~~ | the request's canonical byte form, committing to **both** exposure figures, every cost component and the window refs. A **function**, not a request field — `26 §2.1` declares no `request_hash`. **WITHDRAWN BY S1B.2, finding 5 — both functions are deleted; see §16.5 / §S1B.2 question 10.** |

### What S1B.1 did NOT change

- **S1B-C4 stands.** For `refund.create` the counterparty is `null`: `26 §11.2` row 3 prints
  `n/a`, the value direction is `INBOUND_ORIGINAL_INSTRUMENT`, and `26 §1` Corollary 1 is
  explicit that a customer receiving their own refund to their own instrument is not a
  counterparty. The review of `S1B-C3`/`S1B-C5` is not a reason to redesign it.
- The architecture-declared `refund.create` `semantic_option_digest` is **untouched**.
- No authority ceiling, no MAL quantity, no `per_action_max`, no window ceiling changed.
- No Cedar, no policy engine, no grant matching was added.
- The immutable architecture package under `docs/architecture/v1.3.1/` was not modified.

---

## 16. S1B.2 — what the independent implementation review changed in this contract

The independent review of the S1B/S1B.1 repository returned
`S1B NOT YET ACCEPTED — LOCAL IMPLEMENTATION REPAIRS REQUIRED`, with eight findings. All
eight are applied. This section records what moved in the contract itself; the reasoning is
in `S1B-implementation-log.md §13` and the evidence in `S1B-result.md §S1B.2`.

**No architecture file was modified. No architecture-declared digest was modified.**

### 16.1 Canonicalisation input cohesion (finding 1)

The canonicaliser validated three relationships between its three inputs. Four more are
authoritative and were unchecked, so it could emit an internally contradictory request if
its caller wired state incorrectly.

| Relationship | Rule | Failure | Where |
|---|---|---|---|
| `intent.resource_ref` ↔ `context.resource.resourceRef` | must be equal (`26 §2.1`: the resource is "resolved from resource_ref") | **throws** — both are outside the model's reach once the kernel has resolved | `canonicaliser.ts` |
| the action catalogue entry | read from `ACTION_CATALOGUE[intent.actionClass]`, never supplied | the field is **removed** from the context type | `types.ts`, `canonicaliser.ts` |
| `option.currency` ↔ `context.ledgerCurrency` | must be equal (`51 §5.1`: "Single currency only") | **throws** | `constructors/refundCreate.ts` |
| `REASON_CODE_SCOPES[reason_code]` ↔ `option.reasonCodeScope` | must be equal (S1B-C6a) | **denies** `SELECTOR_INVALID` / `REASON_CODE_SCOPE_MISMATCH` — the model can produce this pair | `constructors/refundCreate.ts` |

**Throw versus deny.** A contradiction between two kernel-owned inputs throws: no
`ProposedIntent` can produce it, and `26 §7` returns coarse categories to the model, so
returning one would report a model-visible category for a condition no model can cause. A
contradiction between a permitted intent field and the authoritative option denies, under a
code `26 §7` already declares. No new denial code was invented.

**No C′ advisory lock was taken.** Finding 1A is a cohesion check on inputs already
resolved, not the live re-enumeration the next increment adds.

**Test:** `tests/canonicalisation/canonicalisation-cohesion.test.ts` — table-driven, exactly
one relationship corrupted per case, a positive control, and a call counter proving the
constructor never ran.

### 16.2 The recorded selected option is a typed per-class projection (finding 2)

`26 §8`'s worked refund policy reads its operands off `context.selected_option`:

> `context.selected_option.line_refundable_remaining >= context.selected_option.amount`
> `context.selected_option.instrument == "original"`

`RecordedSelectedOption` carried three fields and dropped every one of those operands.
`RecordedRefundSelectedOption` now carries:

```text
action_class · option_id · semantic_option_digest · description
line_id · parent_transaction_id · amount · instrument · reason_code_scope
line_refundable_remaining
```

`line_refundable_remaining` is **NOT** added to `semantic_option_digest`, and its omission is
intentional: it is current policy state, the next C′ slice re-enumerates it under the entity
lock, and the policy evaluates the current value. Adding it to identity would make every
change to a line's balance a different `option_id` for the same effect.

**Test:** `tests/canonicalisation/selected-option-projection.test.ts` — five properties,
including the discriminating pair (changing only the refundable remaining moves the recorded
state and does not move `option_id`) and its contrast (a declared digest member does move
it).

### 16.3 `destinationInstrumentRef` removed (finding 3)

`26 §2.2` declares this class's semantic identity as exactly
`line_id · parent_transaction_id · amount · instrument · reason_code_scope`, and requires the
digest to cover every field whose change makes a different effect. An independently supplied
`destinationInstrumentRef` broke that: changing it changed the dispatched destination while
`option_id` stayed identical.

The repair is **removal, not digest widening** — widening would change an
architecture-declared digest. `26 §11.2` row 3's destination is "derived by the canonicaliser
from the RECORD-grade transaction, never from the intent", and that transaction is already
content-addressed by `parent_transaction_id` with `instrument`, both of which **are** digest
members.

Removed from: the selected option, `RefundParameters`, `refundSemanticParamDigest`, the mock
vendor payload, the oracle's expected payload, and the fixture mutation rows that treated it
as an independent effect dimension.

§7.2's parameter table row `parameters.destinationInstrumentRef` is **withdrawn**. Which
concrete vendor fields a real processor requires for the enumerated parent transaction is the
adapter / state-resolution slice's question; S1B invents no second destination identifier to
answer it early.

**Test:** `tests/canonicalisation/destination-provenance.test.ts` (source and behaviour) plus
`tests/type-negative/destination-into-option.ts` (compile-negative).

### 16.4 `ACOS-JCS-1` canonical text is injective (finding 4)

Section 5 gains an admissibility rule — see **S1B-C8**. Canonical text (text fields, the
structure kind, JSON string values, JSON object keys) admits only well-formed Unicode scalar
sequences containing no `U+0000`, and a JSON object whose keys collide under NFC is
**rejected**. Model-supplied strings fail closed at the wire with
`MALFORMED`/`SELECTOR_MALFORMED` detail `NOT_CANONICAL_TEXT`; the byte layer throws.

Money encoding, timestamp precision and framing are unchanged.

### 16.5 The generic `AuthorizationRequest` hash is removed (finding 5)

S1B.1's `authorizationRequestCanonicalHash` and `authorizationRequestHash` are **deleted**,
and nothing invented replaces them. `26 §2.1` declares no `request_hash`, and a helper
covering only some authority-relevant fields cannot support the inference it invited in
either direction. Left in the tree it would have become an accidental protocol the
journal/audit slice inherited.

The tests that used it assert the authoritative **fields** directly — `total_exposure`, the
cost component's amount and source, the reservation offer, `window_refs` — and that the
declared `dispatch_payload_hash` does not move when the vendor effect does not.

`dispatchPayloadHash` **stays**: `26 §2.1` declares that field explicitly.

The normative commitment of the `AuthorizationRequest` row under `ACOS-JCS-1` belongs to the
journal/audit slice, which owns `30 §5.3`'s row-kind declaration and `36 §2`'s VC-A3.

### 16.6 The registration owns per-class option identity (finding 6)

§3.2's statement that the closed catalogue plus a registered constructor is the extension
point is now true of the code. `RegisteredConstructor` gains two members:

```text
computeSemanticOptionDigest(option)   26 §2.2's per-class digest
assertInputCohesion(input)            the per-class checks of §16.1, run BEFORE construction
```

`refundSemanticOptionDigest` moved from `optionDigest.ts` into
`constructors/refundCreate.ts`. `optionDigest.ts` keeps only the class-agnostic
`computeOptionId`. `EffectCanonicaliser` imports no per-class digest and contains no
refund-specific identifier in executable code; a class with no constructor still denies
`NOT_CANONICALISABLE`; there is still no generic fallback.

**The refund digest definition is byte-for-byte unchanged.** It moved file, not fields.

**Test:** `source-rules.test.ts` rule 8.

### 16.7 `ConstructorVersionResolver` duplicate input (finding 8)

Two records for one `constructor_id` meant registration order silently decided which signed
record won — and both may verify, so the signature check cannot separate them. The resolver
now **fails at construction**. This is not version history or storage: one active resolver
input may identify one constructor id exactly once.

**Test:** `constructor-version.test.ts` — with a positive control showing each record
resolves alone, so the ambiguity being refused is a real one.

### 16.8 Preserved without weakening

The exact five-field `ProposedIntent` parser · unknown-field rejection · the opaque rationale
· the `I21` branded boundary and its real `tsc` compile-negative project (now **eight**
negative files) · signed Ed25519 `ConstructorVersionRecord` verification · the refund
semantic digest's five declared fields · `$25.00` vendor / `$26.03` economic exposure ·
authoritative retained-fee provenance (S1B-C3a) · the authoritative grant/window boundary
(S1B-C5a) · `I18a`/`I18c` construction checks · the deterministic idempotency key ·
`dispatch_payload_hash` · full VC-C1 reported **PARTIAL** · no Cedar · no C′ live enumeration
· no real adapter · no outbox · accepted S1A production code.

### 16.9 Outside this contract

Finding 7 is a stale assertion in `spikes/durable-execution/spike.test.ts`, which is the
ADR-IMP-002 investigation and not S1B. It is recorded in `ADR-IMP-002 §7.5` and
`S1A-implementation-log.md`.
