# S1B Result — Effect Canonicaliser Core + `refund.create`

**Branch:** `feature/s1b-effect-canonicaliser`, from `c1ae9f0`.
**Architecture package:** `docs/architecture/v1.3.1/` — **unmodified in every respect**.

---

## Verdict

```text
S1B CONDITIONAL — LOCAL REPAIR REQUIRED
```

**Every S1B-specific criterion is met.** The single condition is a **pre-existing,
test-only race in the S1A test harness**, found during S1B's full-suite runs and
deliberately **not repaired here**, because the S1B mandate says: *"Do not repair unrelated
S1A behavior inside S1B."*

| PASS criterion, from the S1B mandate | Status |
|---|---|
| Existing S1A gate still green | **CONDITIONAL** — 157/157 pass on an idle machine; one case is load-sensitively flaky. See §11 and `S1B-test-matrix.md §5` |
| All S1B tests green | **YES** — 200/200 |
| Independent fixture discriminates `$26.03` from `$25.00` | **YES** |
| `I21` demonstrated structurally | **YES** — a real `tsc --noEmit` compile-negative project with a positive control |
| Rationale demonstrated non-authoritative | **YES** |
| Constructor signing / version identity works | **YES** — real Ed25519 |
| No hidden policy engine added | **YES** — asserted by test |
| No architecture invariant weakened | **YES** |

The required repair is **test-only**, touches no production code, and changes no authority
quantity. It is a bounded S1A.2.

---

## The fourteen questions the mandate requires this document to answer

### 1. Can a model supply any economic amount?

**No, and it is not expressible.**

`ProposedIntent` has exactly five fields and the parser rejects everything else. Fourteen
plausible economic field names — `amount`, `exposure`, `total_exposure`, `parameters`,
`vendor_parameters`, `recoverability`, `counterparty`, `value_direction`,
`constructor_version`, `idempotency_key`, `irrecoverable_units`, `customer_novelty`,
`window_refs`, `principal` — are each tested and each denies `MALFORMED`/`EXTRA_FIELD`.
**Nothing is accepted and ignored.** An ignored field is expressible at the boundary and
relies on something downstream having dropped it, which is the weaker position `35 §4`
describes v1.0 as occupying.

Beyond the wire, `KernelComputed<T>` makes it a type error to write a model-supplied value
into an authority-bearing field, so a future code path that somehow obtained one still
cannot place it (`tests/type-negative/model-amount-into-exposure.ts`).

### 2. Can rationale alter economic or dispatch semantics?

**No.** Same authoritative state, same four permitted fields, an innocuous rationale versus
one instructing the system to ignore the fee, lower the amount, change the customer and
rewrite the vendor payload:

| Quantity | Result |
|---|---|
| `intent_hash` | **differs** — the permitted lineage commitment, per owner clarification S1B-C1 |
| computed parameters | identical |
| exposure, every field including `cost_components` | identical |
| `option_id`, `semantic_option_digest` | identical |
| dispatch payload, field for field | identical |
| `dispatch_payload_hash` | identical |
| idempotency key | identical |
| recoverability, value direction, counterparty, customer novelty | identical |
| constructor version identity | identical |
| the quantity offered to the reservation layer | identical, `$26.03` |
| **the whole request minus `intent_hash`** | **identical** |

**No production function parses rationale, and none can.** `OpaqueRationale` is not a
string and exposes no character accessor; `sealRationale` computes the commitment digest and
**discards the text**, so after parsing the characters are not recoverable by any code path
in the process. Enforced three ways: by the type, by a compile-negative fixture
(`rationale-parsed.ts`), and by a source rule over the whole `src/` tree.

### 3. Does `I21` fail at compile time when intentionally violated?

**Yes.** `tests/type-negative/` is a second TypeScript project compiled by a real
`tsc --noEmit`. Five violations, each producing a specific diagnostic on a specific line:

| Violation | Diagnostic |
|---|---|
| `rationale` assigned into an authority-bearing request field | TS2322 |
| `rationale` parsed — `.includes`, `.toLowerCase`, assignment to `string` | TS2339 ×2, TS2322 |
| a request constructed from a fifth `ProposedIntent` field | TS2353 |
| a `ProposedIntent` passed where the authoritative context is expected | TS2345 |
| a model-supplied `Money` assigned into `exposure` | TS2322, TS2375 |

**The harness discriminates in both directions.** `positive-control.ts` must compile with
**zero** diagnostics, so the negative files cannot be failing for an unrelated reason; and
no diagnostic may appear on an unmarked line, so a fixture that stops testing what it claims
fails rather than passing on some other error.

This is not the runtime key check `36 §2` deleted as a tautology — `expect(request).not.toHaveProperty('rationale')`
would pass against a design with no type boundary at all.

### 4. Does an unknown or unregistered constructor fail closed?

**Yes, and the two conditions are distinct.**

- A class **outside** the closed catalogue denies `UNKNOWN_ACTION` at step C.
- A class **inside** the catalogue with no registered constructor denies
  `NOT_CANONICALISABLE` at step C2 — tested for all three such classes
  (`campaign.pause`, `fulfilment.reship`, `campaign.budget.set`).

There is no default constructor and no fallback: an empty registry denies rather than
degrading to a generic path, and duplicate registration for one class is a build failure
rather than last-writer-wins.

### 5. Is constructor version identity verified?

**Yes, with real Ed25519 from `node:crypto`**, over `ACOS-JCS-1`-shaped canonical bytes of
the record, resolved **before the constructor body runs**. Test keys; no production key
management was built.

Fails closed on: a missing record; a wrong action class; a signature from another key; a
field tampered with after signing; a record validly signed for a *different* constructor;
and five structural malformations. And `26 §2.1.2`'s "semantic by definition, and cannot be
declared otherwise" is enforced for **all eight** declared fields — a validly signed record
claiming a money-affecting change is non-semantic is still refused, because the signature
proves who said it, not that it is admissible.

The complete identity — `constructor_id`, `action_class`, `semantic_major`,
`non_semantic_minor`, `semantic_change`, `changed_fields`, `signed_at` and a `record_hash`
of the signed bytes — is recorded on the canonical output.

**Approval-resume semantics are NOT implemented** — they need the approval state machine.
The representation carries the two version numbers separately so the later slice can enforce
*semantic-major → refuse, non-semantic-minor → replay-compatible*; `replayCompatibility()`
computes that verdict and **is called by no S1B decision path**. `CONSTRUCTOR_SEMANTIC_CHANGE`
appears nowhere in `src/`, asserted by test.

### 6. Does `refund.create` produce vendor amount `$25.00` and total exposure `$26.03`?

**Yes.**

```text
refund amount visible to vendor:   $25.00
retained processing fee:            $1.03
─────────────────────────────────────────
exposure.vendor_amount:            $25.00
exposure.total_exposure:           $26.03
dispatch_payload.monetary_effect:  $25.00
offered to the reservation layer:  $26.03
```

| Invariant | Assertion | Result |
|---|---|---|
| **I18a** | `monetary_effect == vendor_amount == $25.00` | **PASS** |
| **I18b**, construction half | the quantity offered to reservation `== total_exposure == $26.03` | **PASS** |
| **I18c** | `$26.03 >= $25.00`, strictly, since the catalogue does not declare this class cost-component-free | **PASS** |

Every expected value comes from `tests/support/canonicalisationOracle.ts`, which imports
**nothing at all** — not the constructor, not the exposure calculator, not `money.ts`. It
carries hand-authored minor-unit integers and does its own three-line arithmetic. The fee
derivation is owner clarification S1B-C3 and reproduces the architecture's printed `$1.03`
exactly.

**No reservation is taken.** The `$26.03` is offered through
`ports/reservationHandoff.ts`, a port that opens no transaction and takes no lock. Faking a
reservation would be claiming the second arrow S1B does not prove.

### 7. Does the retained-fee negative control fail as expected?

**Yes.** `tests/negative-controls/unsafe-retained-fee-escape.ts` is a deliberately wrong
constructor differing in exactly two lines: `costComponents` empty, `totalExposure =
vendorAmount`. It produces `$25.00`.

**The hand-authored fixture rejects it** — that assertion comes first, because it is what
proves the fixture can detect the escape VC-C1 exists for. The escape passes every check
that does not look at `total_exposure`: `I18a` holds, the dispatched amount is right, the
vendor request is right. Only the quantity that bounds economic loss is wrong, and it is
wrong in the permissive direction:

```text
correct   $26.03 >  $25.00 cap  →  a correct policy must DENY PER_ACTION
escaped   $25.00 <= $25.00 cap  →  the same policy PERMITS
```

As defence in depth — asserted **second** — the canonicaliser's own `I18c` guard also
refuses it. The unsafe code is test-only and no `src/` module imports the negative-control
tree.

### 8. Is the dispatch hash stable under non-semantic object ordering?

**Yes, structurally.** Canonical bytes are taken over a **declared field order per structure
kind**, never over JavaScript object key order, and structured values go through RFC 8785.
`JSON.stringify` is used nowhere on a hashing path, asserted by source rule.

Proven: a `vendor_parameters` object rebuilt with keys inserted in reverse order hashes
identically; a `DispatchPayload` literal written with its properties in a different order
hashes identically; two independent canonicalisations agree. And it moves when it should —
a changed vendor parameter, an added vendor parameter, a different authoritative amount, and
a mutated `monetary_effect` each change the hash.

The primitive hazards are asserted individually: `25.0` versus `25.00` (unexpressible, since
the `Money` type refuses the scale), six-digit UTC timestamps, null sentinel versus empty
string, NFC, RFC 8785 key ordering, 4-byte BE framing, and a refusal to serialise
non-integer numbers.

### 9. Does a semantic option mutation change `option_id`?

**Yes, for all five declared fields.** `26 §2.2` declares `refund.create`'s
`semantic_option_digest` as `line_id · parent_transaction_id · amount · instrument ·
reason_code_scope`. One-at-a-time mutation of each changes both the digest and the
`option_id`, and the five mutations plus the baseline produce six distinct ids. The
`resource_id` and the `action_class` also participate, per
`option_id = H(action_class ‖ resource_id ‖ semantic_option_digest)`.

Selection is content-addressed, not positional: the id is a 32-byte hash. A selector whose
`option_id` does not address the authoritative option denies `SELECTOR_INVALID` and **no
effect is constructed** — the kernel does not substitute.

### 10. Does rationale leave idempotency and dispatch hashes unchanged?

**Yes.** A rationale-only change leaves the idempotency key and the dispatch payload hash
byte-identical. The key cannot be made to depend on rationale without a type change, since
`OpaqueRationale` is accepted by no function in `idempotency.ts`; a source rule asserts the
module reads no clock, no random source and no journal sequence. A simulated crash-and-retry
regenerates the same key, and six semantic mutations produce six pairwise-distinct keys.

### 11. Did any S1A invariant regress?

**No invariant regressed. No production code under `src/kernel/exposure/` or `src/db/` was
edited, and no migration was added.** A source rule asserts the canonicaliser's only import
from the exposure tree is `money.js`, and that the reservation-handoff port opens no
transaction and takes no lock.

**One pre-existing S1A test-harness defect was observed and is the reason for the
CONDITIONAL verdict.**

`tests/integration/exposure/vc-s8-realised-standing-atomicity.test.ts` → *"an over-commit
racing a spend observation is refused, in both orderings"* is **load-sensitively flaky**:
3 failures in 14 runs, all three under machine load; 11 passes otherwise, including the
final clean full-suite run.

It is a race in the **test harness**, not in production code. `Conductor.release` resolves a
promise; it does not wait for the released participant's next statement to reach the
database. The case releases the reconciler and then immediately releases the authorisation,
with no barrier guaranteeing the reconciler took the `window_balance` row first. When the
authorisation wins that race it parks at `AFTER_LOCK` **holding the row**, the reconciler
blocks on the lock and can never reach `AFTER_WRITE`, and the conductor's own 20-second
timeout fires.

**The production property under test is not in doubt.** ORDERING A and ORDERING B in the
same file exercise the same production code and passed in every run, including the runs in
which this case timed out. No authority quantity is involved.

S1B did not repair it, per the mandate. The repair is test-only — a barrier between the
reconciler's `AFTER_BEGIN` and its lock acquisition, so the conductor awaits lock ownership
rather than assuming it — and the same latent race exists in ORDERING A and ORDERING B.
Full analysis: `S1B-test-matrix.md §5`.

### 12. Did any architecture conflict emerge?

**No contradiction of the kind S1A.1 found in `30 §5.2`.** Seven places where the
architecture is silent or admits two literal readings were resolved and recorded verbatim in
`S1B-owner-clarifications.md` (S1B-C1 … S1B-C7). None changes an authority quantity, a MAL
figure, or any behaviour S1A implemented.

The one genuine **wording edge** is S1B-C1: `I21` says no `AuthorizationRequest` field is
populated from `ProposedIntent` beyond the four, and `26 §2.1` prints `intent_hash // hash
of the ProposedIntent, for lineage` as a request field. Read at maximum literalness they are
in tension. The owner clarification resolves it — rationale may participate **only** in an
opaque lineage commitment — and the implementation makes the distinction structural rather
than conventional.

**The architecture package was not modified.**

### 13. Is full VC-C1 passed, partially passed, or still open?

```text
VC-C1 construction half:      PASS
VC-C1 policy-denial half:     OPEN — Cedar slice

Full VC-C1: PARTIAL — construction half proven; actual PER_ACTION denial remains open
```

Cedar did **not** already exist in the accepted baseline, so the unexpected state the
mandate asks about did not arise. No policy engine, no per-action cap comparison and no
grant evaluation exists anywhere in `src/`, asserted by a test that scans the S1B tree for
`PER_ACTION`, `per_action_max`, `permit(`, `cedar`, `Cedar` and `WINDOW_EXHAUSTED`.

**No temporary duplicate policy engine was built to make a test say DENY.** The independent
oracle shows `$26.03 > $25.00`, and therefore that a correct policy must deny `PER_ACTION`.
That is an arithmetic fact about the constructed exposure, and it is reported as exactly
that — not as a policy result.

Other gates, stated so absence is not mistaken for oversight:

| Gate | Status |
|---|---|
| VC-C2 — `enumerate_effects` | **OPEN** |
| VC-C3 — content-addressed selectors never substitute | **OPEN** |
| VC-C4 — constructor versioning | **PARTIAL** — signing and identity PASS; resume behaviour OPEN |
| VC-A3 — `ACOS-JCS-1` cross-implementation | **OPEN** |
| `I18b` runtime equality against `reservation.amount` | **OPEN** |
| `I18d` settlement tolerance | **OPEN** |
| `I42` database uniqueness | **OPEN** |

### 14. Is it safe to proceed to the enumeration / content-addressed-selector increment?

**Yes, technically — and only after the §11 repair, procedurally.**

The boundary the next increment needs is in place and is the right shape:

- `option_id = H(action_class ‖ resource_id ‖ semantic_option_digest)` exists, is proven
  field by field, and is already the thing the selector must address.
- The canonicaliser already **denies rather than substitutes** on a selector mismatch,
  which is the behaviour `I53` strengthens rather than introduces.
- `enumeration_ref` is carried on the request for lineage, so adding `computed_at` staleness
  is a check on an existing field rather than a new one.
- The constructor input type is closed, so adding live re-enumeration under the C′ entity
  advisory lock does not widen what a constructor can read, and `I21` does not erode.

**What the next increment must not treat as already done.** S1B's `option_id` check is
**necessary and not sufficient**. It compares the model's selector against an authoritative
option the kernel was handed; it does **not** re-enumerate the live set under the entity
advisory lock. `53 §1`'s reordering attack — the one where a concurrent partial refund
exhausts line A and a positional selector silently dispatches line B — is **not** closed by
S1B and must be closed by that increment, together with `SELECTOR_STALE`,
`SELECTOR_ENUMERATION_STALE`, `I53`'s no-substitution rule, and the **mandatory positional
negative control** that must reproduce the substitution.

---

## What S1B built

| Component | File |
|---|---|
| The three nominal brands that make `I21` structural | `src/kernel/canonicalisation/brands.ts` |
| `OpaqueRationale` and the seal that discards the text | `rationale.ts` |
| The denial codes, and the deliberate absences | `errors.ts` |
| `ACOS-JCS-1`-shaped canonical bytes and RFC 8785 | `canonicalBytes.ts` |
| The closed action catalogue and closed reason-code enum | `actionCatalogue.ts` |
| The exact five-field `ProposedIntent` parser | `intent.ts` |
| The `intent_hash` lineage commitment | `lineage.ts` |
| Ed25519 `ConstructorVersionRecord` verification | `constructorVersion.ts` |
| `AuthorizationRequest`, `DispatchPayload`, and the three kernel inputs | `types.ts` |
| `semantic_option_digest` and `option_id` | `optionDigest.ts` |
| The effect idempotency key | `idempotency.ts` |
| The constructor registry | `registry.ts` |
| The canonicaliser core, and the `I18a`/`I18c` guards | `canonicaliser.ts` |
| `refund.create` — the first money-bearing constructor | `constructors/refundCreate.ts` |
| The reservation handoff port | `ports/reservationHandoff.ts` |

## What S1B deliberately did not build

The full Effect Gateway · Cedar or any policy engine · `enumerate_effects` as a model
capability · `context_spec` projection · enumeration rate limiting · the C′ entity advisory
lock · live re-enumeration · `SELECTOR_STALE` · `SELECTOR_ENUMERATION_STALE` · the
positional-selector negative control · the approval state machine · the reservation
transaction · any real adapter · vendor HTTP · the dispatch outbox · the journal or audit
mirror · the AI CEO or any LLM · any other production action constructor.

---

## The condition on this result

One repair, test-only, bounded:

> Add a barrier between the reconciler's `AFTER_BEGIN` and its `window_balance` lock
> acquisition in `tests/integration/exposure/vc-s8-realised-standing-atomicity.test.ts`, so
> the conductor awaits lock ownership rather than assuming it. Apply it to all three cases
> that share the race — the over-commit case, ORDERING A and ORDERING B.

No production code changes. No authority quantity changes. No architecture change.

**Do not begin the enumeration / selector increment until that repair lands and the full
suite is green.**
