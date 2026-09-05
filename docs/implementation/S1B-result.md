# S1B Result — Effect Canonicaliser Core + `refund.create`

**Branch:** `feature/s1b-effect-canonicaliser`, from `c1ae9f0`.
**Architecture package:** `docs/architecture/v1.3.1/` — **unmodified in every respect**.

---

## Verdict

```text
S1B.2 PASS — S1B READY FOR OWNER ACCEPTANCE
```

**Superseded verdicts, retained as the record:**

```text
S1B CONDITIONAL — LOCAL REPAIR REQUIRED                        (the original S1B result)
S1B.1 PASS — S1B ACCEPTED                                      (this repository's own claim)
S1B NOT YET ACCEPTED — LOCAL IMPLEMENTATION REPAIRS REQUIRED   (the independent review)
```

**Read §S1B.2 at the end of this document before relying on anything above it.** The
independent review of the S1B/S1B.1 repository found eight local defects, two of them
introduced by S1B.1 itself, and the *"S1B.1 PASS — S1B ACCEPTED"* line above was therefore
premature when it was written. The reasoning that produced each superseded verdict is left in
place throughout: the record should show what was got wrong as well as what was got right.

S1B was returned conditional on three local repairs. All three are done, the complete suite
is green, and the S1B.1 evidence is in **§S1B.1** below. The original S1B verdict and the
reasoning that produced it are left in place throughout this document: **S1B found the VC-S8
harness race rather than hiding it, invented an economic rule it was not entitled to, and
called catalogue membership grant resolution.** Two of those were defects and the record
should say so.

| PASS criterion, from the S1B mandate | Status |
|---|---|
| Existing S1A gate still green | **YES** — 157/157. The load-sensitive S1A **test harness** race is repaired as `S1A-H5`; no S1A production source changed |
| All S1B tests green | **YES** — 236/236 (229 canonicalisation + 7 negative control) |
| Independent fixture discriminates `$26.03` from `$25.00` | **YES** — and the oracle now reaches it by one addition over two hand-authored figures, not by a schedule |
| `I21` demonstrated structurally | **YES** — a real `tsc --noEmit` compile-negative project, six negative files and a positive control |
| Rationale demonstrated non-authoritative | **YES** |
| Constructor signing / version identity works | **YES** — real Ed25519 |
| No hidden policy engine added | **YES** — asserted by test |
| No architecture invariant weakened | **YES** |

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
carries hand-authored minor-unit integers and does its own arithmetic.

**S1B.1 correction.** This previously read *"the fee derivation is owner clarification
S1B-C3 and reproduces the architecture's printed `$1.03` exactly"*. `S1B-C3` is
**withdrawn**: reproducing the printed figure was not authority for the rule that reproduced
it. Under `S1B-C3a` the `$1.03` is a kernel-owned authoritative **amount**, the oracle
carries it as a hand-authored `103n` and performs one addition, and there is no schedule
anywhere in the tree.

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

> **S1B.1: REPAIRED.** Exactly that barrier was added, to all three cases sharing the race,
> as finding `S1A-H5`. 50 consecutive repetitions — 25 idle, 25 under deliberate CPU load —
> with **zero** harness timeouts and **zero** `40P01`. No production money-path source
> changed. See §S1B.1 and `S1A-implementation-log.md` §20.

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

> **S1B.1: the §11 repair has landed**, together with the two provenance repairs the owner
> review raised. That discharges the procedural condition. It does **not** by itself
> authorise the next slice — see the closing note of §S1B.1.

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

## The condition on this result — DISCHARGED IN S1B.1

The original condition, retained as written:

> Add a barrier between the reconciler's `AFTER_BEGIN` and its `window_balance` lock
> acquisition in `tests/integration/exposure/vc-s8-realised-standing-atomicity.test.ts`, so
> the conductor awaits lock ownership rather than assuming it. Apply it to all three cases
> that share the race — the over-commit case, ORDERING A and ORDERING B.

**Done**, together with two further repairs the owner review raised. See §S1B.1.

---

# S1B.1 — the conditional gate repair pass

**Verdict: `S1B.1 PASS — S1B ACCEPTED`.**

Three repairs. No enumeration/selector work begun, no Cedar implemented, no S1B scope
expanded.

## Repair 1 — VC-S8 deterministic ordering (`S1A-H5`)

**A test-harness repair only.** `src/kernel/exposure/reconciler.ts`, `lockOrder.ts` and
`retry.ts` are byte-identical to their accepted S1A form.

The reconciler participant now takes the declared locks itself — through the one declared
`acquireMoneyPathLocks` helper, in the one declared order — and announces `AFTER_LOCK` only
after `SELECT … FOR UPDATE` has returned. The competing authorisation is released only once
that barrier is observed:

```text
reconciler BEGIN
    |
reconciler acquires the required window_balance lock
    |
test observes the explicit AFTER_LOCK barrier          <- ownership ESTABLISHED
    |
ONLY NOW release the competing authorisation
```

Applied to **every** case sharing the race — `ORDERING A`, the over-commit case, and
`ORDERING B`'s reconciler side — not only the one that happened to fail. Full detail:
`S1A-implementation-log.md` §20.

### The stress verification

| Requirement | Required | Measured |
|---|---|---|
| consecutive repetitions of the affected file | ≥ 25 | **50** — 25 serial on an idle machine, then **25 more under deliberate CPU load** (six busy workers), because load is the condition the original failure needed |
| harness timeouts | 0 | **0** |
| repetitions passing | all | **50 / 50**, 6 tests each, 300 test executions |
| required real `40001` still observable | yes | **asserted, not assumed** — `ORDERING A` now asserts the authorisation absorbed **≥ 1** serialisation retry, because the reconciler commits underneath it; `ORDERING B` asserts **exactly 0**, because the authorisation takes the row first. The two orderings are now distinguished rather than presumed alike |
| real `40P01` on the correct lock-order path | none | **0** — zero occurrences of the SQLSTATE across all 50 runs |
| reversed-order `40P01` negative control retained | yes | unchanged in `lock-order.test.ts`, still deliberately producing a real deadlock |

That last pair is the point: the deadlock detector is demonstrably able to fire, and it does
not fire on the declared order.

## Repair 2 — the invented refund fee schedule removed

`S1B-C3` is **WITHDRAWN**; `S1B-C3a` is in force.

| | |
|---|---|
| removed | `ProcessorFeeSchedule`, the 2.9% rate, the `$0.30` fixed charge, the rounding formula, the `mulByRational` call in the refund constructor, and the oracle's `divideRoundHalfAway` |
| added | `AuthoritativeRetainedFee` — an **amount**, a `source_ref` naming the record it was read from, and a currency |
| where it lives | `AuthoritativeCanonicalisationContext.retainedProcessingFee`, `KernelComputed`. **Not** on `ProposedIntent`, not model-controlled, no real processor fetched, no real fee model selected |
| when absent | the constructor **throws** for a class the catalogue does not declare cost-component-free. It does not emit zero cost components — `26 §2.1.1` names that as the defect `R1` exists to close |

### The discriminating pair

`tests/canonicalisation/retained-fee-provenance.test.ts`, 14 tests, all passing.

| Change only the authoritative retained fee, `$1.03` to `$1.10` | Required | Result |
|---|---|---|
| dispatch monetary effect | stays `$25.00` | **PASS** |
| vendor payload, semantically | unchanged | **PASS** — and its hash is unchanged |
| `option_id` | unchanged | **PASS** — the refund `semantic_option_digest` does not include the retained fee, and S1B.1 did not modify that declaration |
| total exposure | `$26.03` to `$26.10` | **PASS** |
| reservation-handoff amount | changes accordingly | **PASS** |
| ~~the authority/request hash committing to exposure~~ | changes | **PASS**, but **WITHDRAWN by S1B.2 finding 5** — replaced by direct assertions on `total_exposure`, the cost component and the reservation offer |
| rationale | irrelevant | **PASS** |

The commitment is `authorizationRequestCanonicalHash`, added in S1B.1 because
`dispatch_payload_hash` covers the payload only and so cannot move when the economics move
without the vendor request moving. It is a **function, not a request field**: `26 §2.1`
declares no `request_hash`, and inventing one would repeat the error this pass is repairing.

> **WITHDRAWN BY S1B.2, finding 5.** Both functions are **deleted**. The reasoning above is
> retained as the record and was wrong in one respect that mattered: a helper covering only
> *some* authority-relevant fields cannot support the inference "the hash moved, therefore
> the authority moved" in either direction, and calling it "the authority commitment"
> invited exactly that reading. `26 §2.1` declares no `request_hash` and S1B does not
> pre-design one; the normative row commitment belongs to the journal/audit slice. The
> assertions that used it now read the authoritative **fields** directly. See
> `S1B-result.md §S1B.2` question 10.


## Repair 3 — `window_refs` provenance

`S1B-C5` is **SUPERSEDED**; `S1B-C5a` is in force.

`ActionCatalogueEntry.declaredWindows` was **removed** — the field is gone, not merely
unread, so catalogue membership cannot be mistaken for grant resolution. `window_refs` now
arrive through `AuthoritativeGrantWindowContext`, a type declaration with no executable
statement in its file, and the canonicaliser **carries** them.

`tests/canonicalisation/window-ref-provenance.test.ts`, 14 tests, all passing.

| Required proof | Result |
|---|---|
| raw/model intent cannot supply `window_refs` | **PASS** — `MALFORMED / EXTRA_FIELD` at the top level, `SELECTOR_MALFORMED / EXTRA_FIELD` nested in the selector, no window key on the parsed intent, plus the compile-negative `model-windows-into-request.ts` |
| changing the authoritative grant/window context changes `window_refs` | **PASS** — narrowing narrows, an empty grant set empties it, a window outside catalogue scope is carried verbatim |
| changing `rationale` cannot change them | **PASS** — an injection-shaped rationale naming other windows leaves both the refs and the authority commitment identical |
| the catalogue alone cannot manufacture a different set | **PASS** — no catalogue entry has a window field, the catalogue source names no window id, and the same class/resource/option yields different sets |

**No Cedar was implemented**, and nothing claims the carried values are actual matching-grant
resolution — the fixture's `resolvedBy` says `fixture:` in the value itself.

## S1B-C4 deliberately unchanged

For `refund.create` the architecture distinguishes the original payer/customer from a
`counterparty` meaning a payee, supplier or settlement destination. A refund to the original
instrument is `INBOUND_ORIGINAL_INSTRUMENT` and is governed by customer novelty and `P4a`
rather than counterparty novelty, so a null counterparty remains consistent with the
canonical type. The review of `S1B-C3` and `S1B-C5` is not a reason to redesign it, and it
was not redesigned.

## The gate

```text
npm run db:down     container and volume removed
npm run db:up       control + audit containers healthy
npm run typecheck   clean
npm run lint        clean, --max-warnings 0
npm test            33 files, 393 tests, ALL PASSING
```

| Requirement | Result |
|---|---|
| complete suite green | **YES** — 33 files, 393 tests |
| VC-S8 repeated ≥ 25 times, zero harness timeouts | **YES** — 50 runs, 0 timeouts |
| S1B canonicaliser suite repeated for determinism | **YES** — 10 consecutive runs, **244 / 244 every time**, identical results |
| accepted S1A behaviour still green | **YES** — 157/157; no S1A production source edited |
| no authority ceiling or MAL quantity changed | **YES** |
| the `$25.00 / $1.03 / $26.03` fixture still passes | **YES**, and still independently discriminates against the retained-fee escape |

### One honest observation, recorded rather than smoothed over

`spikes/durable-execution/spike.test.ts` → *"kill point 7 — a CONCURRENT retry of the same
work item applies it once"* **failed once**, in the first full-suite run of the gate, on
`dispatchCount <= 1` (observed 2). It passed on the immediately following full-suite run and
in **5 / 5** isolated repetitions.

What this is, and is not:

- **it is not S1A or S1B code.** `spikes/` is the ADR-IMP-002 durable-execution
  investigation. No S1B.1 change touches it, directly or transitively;
- **the money invariant held in the failing run.** `realised_monetary` equalled the delta
  and `journal_next_seq` was `2` — the ledger moved **exactly once**. What duplicated was the
  spike's own mock external dispatch, which is the candidate-B property the spike exists to
  measure;
- **it is load-sensitive**, in the same way the VC-S8 harness was before `S1A-H5`.

It is recorded here because the S1B mandate's standard is that a defect found is a defect
reported. It is **not** claimed as repaired, and it is a candidate for a bounded spike pass
if the owner wants the spike's own concurrency claim tightened.

> **CLOSED BY S1B.2, finding 7 — see §S1B.2 question 13 and `ADR-IMP-002 §7.5`.** The
> independent review identified what this observation actually was: a **stale test
> expectation**, contradicting the accepted S1A-H4 result, rather than an unexplained spike
> defect. The assertion `dispatchCount <= 1` at kill point 7, and the classification of
> `dispatchCount > 1` as a weakened S1A substrate invariant, both predate S1A-H4 and were
> never brought into line with it. Ten clean spike runs after the correction observed
> `dispatch=2` **twice**, each time with the ledger at `realised=40.00 standing=60.00
> nextSeq=2` — applied exactly once. The paragraph above is retained unedited; the
> assertion is repaired.

## What S1B.1 added to the tree

| File | What |
|---|---|
| `src/kernel/canonicalisation/authoritativeCost.ts` | `AuthoritativeRetainedFee` — the fee as an authoritative amount |
| `src/kernel/canonicalisation/grantWindows.ts` | `AuthoritativeGrantWindowContext` — the grant/window-resolution boundary |
| ~~`authorizationRequestCanonicalHash` in `canonicaliser.ts`~~ | the authority commitment over exposure. **WITHDRAWN BY S1B.2, finding 5 — both functions are deleted; see §16.5 / §S1B.2 question 10.** |
| `tests/canonicalisation/retained-fee-provenance.test.ts` | 14 tests — fixture A and mutation B |
| `tests/canonicalisation/window-ref-provenance.test.ts` | 14 tests — the four provenance properties |
| `tests/type-negative/model-windows-into-request.ts` | a sixth compile-negative: model-supplied windows, grant context, retained fee |
| `source-rules.test.ts` rules 5 and 6 | no fee schedule survives; no catalogue-derived windows survive |

## What S1B.1 removed

`ProcessorFeeSchedule` · the 2.9% + `$0.30` derivation · `ActionCatalogueEntry.declaredWindows`
· the oracle's `divideRoundHalfAway` and its rate constants · the `$40.00 → $1.46` fixture
row that the withdrawn schedule produced.

## Still open, unchanged by S1B.1

**Full VC-C1 remains PARTIAL** — the construction half passes and `DENY: PER_ACTION` is a
policy result S1B does not produce. VC-C2, VC-C3, VC-A3, the resume half of VC-C4, `I18b`'s
runtime equality, `I18d` and `I42`'s database uniqueness all remain **OPEN**, exactly as
`S1B-test-matrix.md §3` records.

**Do not begin the enumeration / selector increment on the strength of this document alone.**
S1B.1 discharges the S1B conditions; it does not authorise the next slice.

---

# S1B.2 — the independent implementation review repair pass

**Verdict:**

```text
S1B.2 PASS — S1B READY FOR OWNER ACCEPTANCE
```

**Superseded verdict, retained as the record:**

```text
S1B NOT YET ACCEPTED — LOCAL IMPLEMENTATION REPAIRS REQUIRED   (the independent review)
S1B.1 PASS — S1B ACCEPTED                                      (this repository's own claim)
```

The independent review was right and the S1B.1 self-assessment was premature. S1B.1 said
*"S1B ACCEPTED"* while the canonicaliser could still construct from mutually contradictory
inputs, could still dispatch to a destination outside option identity, had invented a
non-normative `request_hash`, and carried a byte layer that was not injective. Two of those
were introduced **by S1B.1 itself**. The record should say so, and does.

Eight findings. All eight applied. **No architecture file modified. No architecture-declared
digest modified.** No Cedar, no C′ live enumeration, no adapter, no outbox, no FX.

---

## The sixteen questions the mandate requires this document to answer

### 1. Can a mismatched resolved resource be canonicalised under another model `resource_ref`?

**No. It throws before the constructor runs.**

`26 §2.1` defines the resource as "resolved **from** `resource_ref`", so the model-named ref
and the resolved resource are two views of one fact and must agree. The original
canonicaliser checked `option.resourceId == context.resource.resourceId` and stopped there —
which is satisfied by the review's discriminating fixture:

```text
intent.resource_ref              = order:A
context.resource.resourceRef     = order:B
context.resource.resourceId      = B
option.resourceId                = B          <- agrees with the resolved resource
```

Every prior check passes and the emitted request names order A while acting on order B.

The check is now:

```ts
if (intent.resourceRef !== context.resource.resourceRef) { throw ... }
```

It **throws** rather than denying. Both operands are outside the model's reach once the
kernel has resolved, so no `ProposedIntent` can produce the pair; `26 §7` returns coarse
categories to the model, and returning one here would report a model-visible category for a
condition no model can cause.

**Proof:** `canonicalisation-cohesion.test.ts`, row 1 — with the review's exact fixture, an
assertion that the failure is *not* a `CanonicalisationDenied`, and a constructor call
counter proving nothing was constructed.

**The C′ advisory lock was not implemented.** This is a cohesion check on already-resolved
inputs.

### 2. Can an arbitrary catalogue entry affect a refund?

**No. The field does not exist.**

`context.catalogueEntry` is **removed** from `AuthoritativeCanonicalisationContext`. The
canonicaliser reads `ACTION_CATALOGUE[intent.actionClass]` itself, after `action_class` has
passed the closed-catalogue check, and passes the row to the constructor on
`ConstructorInput`.

The repair is removal, not validation. The review's own standard — *"the test should become
structurally impossible if the field is removed from context"* — is met literally: there is
nothing to populate, so the negative test cannot be written as a runtime fixture. It is
written three ways instead:

| Form | Where |
|---|---|
| compile error, under a real `tsc --noEmit` project | `tests/type-negative/catalogue-entry-into-context.ts` → TS2353 |
| structural, on the type, the fixture and the source | `catalogue-entry-provenance.test.ts` §1 |
| behavioural, on all four substitutable fields | `catalogue-entry-provenance.test.ts` §2 |

A `refund.create` request cannot acquire `campaign.pause`'s **recoverability** (COMPENSABLE,
not REVERSIBLE), its **value_direction** (INBOUND_ORIGINAL_INSTRUMENT, not NONE), its
**adapter** (`mock_processor`, not `mock_ads`) or its **method** (`refundCreate`, not
`campaignPause`) — and the suite first asserts that those four *differ between the two
classes*, so the four rows are not vacuous.

### 3. Can option currency be silently reinterpreted into ledger currency?

**No. It throws before an effect is emitted.**

`SelectedAuthoritativeRefundOption.currency` existed and `refundCreate` ignored it, writing
`context.ledgerCurrency` into the parameters and the payload. A EUR option was therefore
dispatched as USD at the same numeral.

```ts
if (option.currency !== context.ledgerCurrency) { throw ... }
```

For the single-currency MVP the two must be equal — `51 §5.1`: "Single currency only", and
`26 §11.2` excludes cross-currency monetary classes. **No FX was implemented**: no conversion
is performed, no rate is read, `fxRateRef` remains `null`.

**Proof:** `canonicalisation-cohesion.test.ts`, row 4 — `option.currency = EUR`,
`ledgerCurrency = USD`, throws, constructor never ran.

### 4. Can a reason code be used against a different reason-code scope?

**No. It denies `SELECTOR_INVALID` / `REASON_CODE_SCOPE_MISMATCH`.**

`reason_code_scope` is a declared member of `26 §2.2`'s `semantic_option_digest` for this
class, so it is part of the option's semantic identity. `reason_code` is one of the four
fields `I21` permits the model to supply. A model can therefore propose a valid code against
a validly content-addressed option from another scope — and did, until now.

```text
REASON_CODE_SCOPES[intent.reason_code] == option.reason_code_scope
```

This **denies** rather than throwing, because it is model-reachable. **No new denial code was
invented**: `SELECTOR_INVALID` is `26 §7`'s own code for a selector that does not index a
permissible option, and both halves here are individually well-formed — it is their
combination that is inadmissible.

**Recorded as a fixture-level consistency rule tied to S1B-C6** (now **S1B-C6a**), not as a
claim that this enum or this grouping is universal production policy. Selecting the
production reason-code taxonomy belongs to the policy slice.

**The semantic option digest is unchanged.**

**Proof:** `canonicalisation-cohesion.test.ts`, row 5, plus an exhaustive pair sweep — every
code accepted against its own scope, every code refused against a different one — checked
against `VC_C1_REASON_CODE_SCOPES`, hand-transcribed in the oracle, which imports nothing
from `src/`.

### 5. Does the `AuthorizationRequest` retain current `line_refundable_remaining` for later policy?

**Yes, and `option_id` does not move with it.**

`26 §8`'s worked refund policy reads:

```text
context.selected_option.line_refundable_remaining >= context.selected_option.amount
context.selected_option.instrument == "original"
```

`RecordedSelectedOption` carried `option_id`, the digest and a description, and dropped every
one of those operands. It is now a typed per-class projection carrying, for `refund.create`:

```text
action_class · option_id · semantic_option_digest · description
line_id · parent_transaction_id · amount · instrument · reason_code_scope
line_refundable_remaining
```

**`line_refundable_remaining` was NOT added to `semantic_option_digest`.** Its omission is
intentional and the mandate is explicit about why: it is current policy state, the next C′
slice re-enumerates it under the entity lock, and the policy evaluates the current value.

The five required properties, all in `selected-option-projection.test.ts`:

| # | Property | Result |
|---|---|---|
| 1 | `lineRefundableRemaining` reaches the request's selected option | `$40.00`, and the full operand set asserted by exact key list |
| 2 | amount and instrument agree with the canonical parameters | identity comparison; the amount is also the dispatched vendor amount |
| 3 | changing only refundable remaining changes the recorded state | `$40.00 → $18.00` |
| 4 | changing only refundable remaining does NOT change `option_id` | `option_id` and digest identical; payload, payload hash, idempotency key and exposure byte-identical |
| 5 | rationale cannot affect any of those fields | two rationales, one recorded option; length is not an operand |

Plus two things that keep the pair honest: the mutation is **decision-relevant** (`40 >= 25`
permits, `18 >= 25` does not), and a **contrast** shows a declared digest member *does* move
`option_id` — without which property 4 would be satisfiable by an id that never moves.

**No Cedar comparison was implemented.**

### 6. Can any independently mutable destination field change dispatch without changing option identity?

**No. There is no such field anywhere on the money path.**

`26 §2.2` declares this class's identity as exactly
`line_id · parent_transaction_id · amount · instrument · reason_code_scope`, and requires the
digest to "cover every field whose change would make the option a different effect". An
independently supplied `destinationInstrumentRef` broke that: `A → B` changed where the money
went while `option_id` stayed identical. An approval bound to that `option_id` would have
authorised one destination and dispatched another.

**The repair is removal, not digest widening.** Widening would change an
architecture-declared digest — the same error class as inventing a fee schedule (S1B-C3a).
The architecture already supplies the alternative: `26 §11.2` row 3's destination is "derived
by the canonicaliser from the RECORD-grade transaction, never from the intent", and that
transaction is content-addressed by `parent_transaction_id` with `instrument` — the
architecture's two-dimensional refund enumeration, **both of which are digest members**. The
second identifier was redundant with them *and* unbound by them.

Removed from the selected option, `RefundParameters`, `refundSemanticParamDigest`, the mock
vendor payload, the oracle's expected payload, and the fixture mutation rows that treated it
as an independent effect dimension.

**The architecture's rule is retained:** destination comes from the RECORD-grade original
transaction, never from intent — asserted directly (`destination_instrument_ref` on the wire
denies `MALFORMED`/`EXTRA_FIELD`; prose naming a destination changes nothing dispatched).

**Proof:** `destination-provenance.test.ts` — no destination key on the option, the
parameters, the recorded option or the payload; no executable line in the canonicaliser names
one; every remaining vendor parameter is identity-bearing with none left over; and
`tests/type-negative/destination-into-option.ts` makes it a compile error in two positions.

**No second destination identifier was invented.** Which vendor fields a real processor needs
for the enumerated parent transaction is the adapter slice's question.

### 7. Can `U+0000` collide with `null` in accepted canonical input?

**No. `U+0000` is inadmissible in canonical text.**

`30 §5.3` encodes `null` as a single `0x00` byte; a text value containing `U+0000`
UTF-8-encodes to the same byte, so at a nullable text position they were the same bytes.
PostgreSQL `text` cannot store `U+0000`, so excluding it costs nothing and restores
injectivity.

The rule applies to text fields, the structure kind, JSON string values and JSON object keys.
Model-supplied strings fail closed **at the wire** with `MALFORMED` (or `SELECTOR_MALFORMED`)
detail `NOT_CANONICAL_TEXT`; the byte layer throws, because reaching it means an inadmissible
string was assembled internally.

**`null` and the empty string remain distinct and both remain valid** — `000000016b0000000100`
versus `000000016b00000000`, asserted byte-for-byte, so the repair did not narrow the existing
rule.

Recorded as **S1B-C8**.

### 8. Can lone surrogates reach a hash?

**No. They are rejected before NFC normalisation and before any UTF-8 encoding.**

The test demonstrates the hazard against Node first: `String.fromCharCode(0xd800)` and
`String.fromCharCode(0xd801)` are distinct strings that both encode to `efbfbd` — Node
substitutes `U+FFFD`. RFC 8785 §3.2.2.2 requires malformed Unicode data to fail rather than be
substituted.

`isWellFormedUnicode` is written out rather than delegated to `String.prototype.isWellFormed`,
which is not in the declared `ES2022` lib — the rule belongs to the specification, not the
runtime.

Applied to text fields, the structure kind, JSON string values, JSON object keys, **and
`rationale` before its lineage commitment**. That last one matters most: the commitment is
taken over UTF-8 NFC bytes, so two rationales carrying different lone surrogates would have
committed **identically** — a silent collision in the one field whose entire purpose is
auditability.

**Multiple distinct lone surrogates are each rejected**, and the rule is not "reject
surrogates": a valid supplementary character `U+1F600` is **accepted** and encodes to four
real bytes, and two distinct supplementary characters hash differently.

### 9. Can two NFC-equivalent JSON keys coexist?

**No. The object is rejected — it has no canonical form.**

ACOS adds an NFC rule RFC 8785 does not have, which creates a case RFC 8785 never had to
answer. The order is now fixed and is exactly the mandate's:

1. validate keys;
2. normalise each key to NFC;
3. **reject** if two originals normalise to the same key;
4. sort the **normalised** keys per the declared JCS ordering (UTF-16 code unit);
5. serialise the **normalised** keys.

Rejection, not deduplication: emitting the canonical name twice is not a JSON object, and
silently picking one spelling maps two distinct objects onto one canonical form.

**Proof:** `canonical-text-injectivity.test.ts` §4C — a decomposed/composed accented key pair
is rejected in either insertion order and at any nesting depth; a **single**
canonically-equivalent key serialises normally, in its normalised form; and the
sort-after-normalisation ordering is discriminated against sort-before-normalisation using a
third key that sorts between the two spellings.

**Money encoding, timestamp precision and framing are unchanged**, asserted explicitly.

### 10. Does any non-architecture `request_hash` remain in production?

**No. Both functions are deleted and nothing invented replaces them.**

`authorizationRequestCanonicalHash` and `authorizationRequestHash` are gone. `26 §2.1` declares
`dispatch_payload_hash` and declares no `request_hash`. The helper described itself as "the
AUTHORITY commitment" while not covering every authority-relevant field — an invitation to
read "the hash moved" as "the authority moved", in both directions, which it could not
support. Left in the tree it would have become an accidental protocol the journal/audit slice
inherited.

The two S1B.1 tests now assert the authoritative **fields** directly:

| Mutation | Now asserted |
|---|---|
| authoritative retained fee `$1.03 → $1.10` | `total_exposure` `$26.03 → $26.10`; the cost component's amount `$1.10`, kind `RETAINED_PROCESSING_FEE` and `record:` source; the reservation offer moves; `dispatch_payload_hash` **unchanged**, because the vendor effect is unchanged |
| grant/window set narrowed | `request.windowRefs` changes; model and rationale cannot supply them; under a malicious rationale the offer, exposure, parameters, selected option and payload hash are all identical |

**`dispatchPayloadHash` stays** — `26 §2.1` declares that field explicitly, and
`source-rules.test.ts` rule 7 asserts it survives, so the rule is not a purge.

The normative commitment of the `AuthorizationRequest` row under `ACOS-JCS-1` is left to the
journal/audit slice, which owns `30 §5.3`'s row-kind declaration and `36 §2`'s VC-A3.
**S1B does not pre-design it.**

### 11. Does `EffectCanonicaliser` contain refund-specific digest logic?

**No — and it contains no `refund`-specific identifier at all in executable code.**

`RegisteredConstructor` gains two members, so the per-class operations hang off the
registration:

```text
computeSemanticOptionDigest(option)   26 §2.2's per-class option identity
assertInputCohesion(input)            the per-class checks of questions 3 and 4
```

`refundSemanticOptionDigest` moved from `optionDigest.ts` into
`constructors/refundCreate.ts`; `optionDigest.ts` keeps only the class-agnostic
`computeOptionId`.

The five mandatory properties, asserted by `source-rules.test.ts` rule 8:

| Property | Result |
|---|---|
| `EffectCanonicaliser` contains no import of `refundSemanticOptionDigest` | **YES** — nor any `./constructors/` import |
| the refund constructor/registration owns the refund digest definition | **YES** — the function and its `acos.semantic_option_digest.refund.create.v1` domain |
| a class with no constructor still denies `NOT_CANONICALISABLE` | **YES** — `registry.test.ts`, unchanged, three classes |
| no generic fallback exists | **YES** — asserted by source rule |
| a second constructor needs no refund-specific branch in the core | **YES** — the core names no class; `RegisteredConstructor` declares exactly five members, so a new class must supply both new ones |

**The architecture-declared refund digest is byte-for-byte unchanged.** It moved file, not
fields: `refund-semantic-digest.test.ts` still passes with no assertion edited.

### 12. Does duplicate constructor-version input fail closed?

**Yes, at resolver construction.**

Two records for one `constructor_id` meant registration order silently decided which signed
record won — and both may verify, so the signature check cannot separate them. `26 §2.1.2`
makes the record the thing an approval binds to and `50 §2` class 19 makes it an owner-signed
control artifact; "whichever was loaded last" is not a resolution rule either can rest on.

**This is not version history or storage.** It is only: one active resolver input may identify
one constructor id exactly once. It is a build/configuration failure, so it throws at
construction rather than denying per request.

**Proof:** `constructor-version.test.ts` — with two separately valid signed records for the
same id, in either order, identical records too, and a **positive control** showing each
record resolves and verifies alone with different `recordHash`es, so the refused ambiguity is
a real one. Different constructor ids still coexist.

### 13. Is kill point 7 now consistent with S1A-H4?

**Yes.** And the repair is demonstrably load-bearing.

S1A-H4 established that a raw step journal plus an unclaimed external step is insufficient for
external exactly-once, and narrowed ADR-IMP-002 to say so. The spike was never updated: it
asserted `dispatchCount <= 1` at kill point 7 and classified `dispatchCount > 1` inside
`invariantVerdict()` as a weakened S1A substrate invariant. Both contradict the accepted
result.

The two properties are now separated:

| | Status |
|---|---|
| realised delta exactly once | **ASSERTED** |
| standing coupling `standing == max(0, cap − realised)` | **ASSERTED** |
| journal sequence exactly once, gap-free | **ASSERTED** |
| four-term sum within the window ceiling | **ASSERTED** |
| external dispatch count | **RECORDED**, named as a known result under S1A-H4 |

Kill point 7 is **not** made to nondeterministically require one dispatch. It asserts
`1 ≤ dispatchCount ≤ 2` — the lower bound so a run in which neither process reached the step
cannot be recorded as evidence, the upper bound because two workers can dispatch at most once
each.

**Ten consecutive clean runs measured it directly:**

```text
run  1  dispatch=2   realised=40.00 standing=60.00 nextSeq=2
run  2  dispatch=1   realised=40.00 standing=60.00 nextSeq=2
run  3  dispatch=1   ...
run  4  dispatch=2   realised=40.00 standing=60.00 nextSeq=2
runs 5-10 dispatch=1
```

**Two of ten runs duplicated the external dispatch, and in both the ledger moved exactly
once.** Under the old assertion those two runs would have FAILED. That is the finding,
measured: the old expectation was flaky by construction, and the property it was pointed at
was never in doubt.

**Retained, not erased:** the once-observed `dispatchCount == 2` recorded in the S1B.1 result
is now correctly classified as a stale test expectation rather than an unexplained
observation. **Retained, unchanged:** the deterministic S1A-H4 negative control in
`external-step-race.test.ts`, which forces the interleaving with a barrier and observes two
dispatches every run; and exact-once dispatch assertions in every sequential case.

**The outbox was not built.** It remains S1 work — `23 §6` B8, `25 §7`, `33 §1.1`.

Recorded in `ADR-IMP-002 §7.5` and `S1A-implementation-log.md` as **S1A-H4a**. **No S1A
production source was changed.**

### 14. Did `$25` / `$1.03` / `$26.03` remain unchanged?

**Yes, unchanged and still independently discriminating.**

| Figure | Value | Source |
|---|---|---|
| vendor amount (I18a) | `$25.00` | authoritative option |
| retained processing fee | `$1.03` | authoritative record, S1B-C3a — no schedule, no rate, no rounding |
| total exposure (I18b) | `$26.03` | `$25.00 + $1.03`, by the oracle's own single addition |

The oracle still imports nothing from `src/`. The retained-fee escape negative control still
detects the defect: the unsafe constructor produces `$25.00`, the fixture expects `$26.03`,
and `I18c` throws independently. `$26.03 > $25.00` still exceeds the per-action cap while
`$25.00` does not — the discriminating point of the whole fixture.

`refundSemanticParamDigest` lost `destinationInstrumentRef`, which changes the idempotency key
**value** for the fixture. No architecture-declared figure changed; the key was never a
declared constant, and its declared inputs (`25 §7`) are unchanged.

### 15. Is full VC-C1 still PARTIAL?

**Yes. PARTIAL, unchanged.**

The construction half passes. `DENY: PER_ACTION` is a **policy** result and S1B implements no
policy engine. `vc-c1-refund-construction.test.ts` still reports the cap comparison as
arithmetic over independently authored figures and explicitly does not claim a denial, and
still asserts by source scan that no `PER_ACTION`, `per_action_max`, `permit(`, `cedar` or
`WINDOW_EXHAUSTED` appears anywhere in the canonicalisation tree.

VC-C2, VC-C3, VC-A3, the resume half of VC-C4, `I18b`'s runtime equality, `I18d` and `I42`'s
database uniqueness all remain **OPEN**, exactly as `S1B-test-matrix.md §3` records.

### 16. Did any architecture pass-revocation condition trigger?

**No. None of the ten.**

| # | Condition | Status |
|---|---|---|
| 1 | a remediation answering a BLOCKING finding by weakening the invariant | **NOT TRIGGERED** — every repair supplied a mechanism or removed a field. Nothing was relaxed: no tolerance added to `I18b`, no standing term dropped from `I3`, no forward exposure retained in fewer statuses, no `I54` relaxation. Findings 1B and 3 were resolved by **removing** the offending field rather than by validating it, which is the strict direction |
| 2 | the audit plane's independent input path requiring a control-database read | **NOT REACHED** — no audit-plane work in S1B.2 |
| 3 | cessation undeclarable, or latency too long | **NOT REACHED** |
| 4 | the S1 concurrency harness cannot produce a failing negative control at `REPEATABLE READ` | **NOT TRIGGERED** — `tests/negative-controls/repeatable-read-race.test.ts` still fails as designed |
| 5 | independent re-chaining cannot agree across two instances | **NOT REACHED** — VC-A3 is OPEN and S1B builds no second implementation. Finding 4 **strengthens** the `ACOS-JCS-1` position by making the encoding injective |
| 6 | `I18` divergence persists after SR-C1's field split | **NOT TRIGGERED** — `$25.00` and `$26.03` are carried in two fields, neither overloaded |
| 7 | more than one additional action class proves non-canonicalisable | **NOT TRIGGERED** — no class was reclassified; the registry is unchanged |
| 8 | the standing term cannot be made atomic with the realised term | **NOT TRIGGERED** — VC-S8 passed 25/25 with zero harness timeouts and no `40P01` on the correct path |
| 9 | `charge.standing_authorization_id` underivable | **NOT REACHED** |
| 10 | the override's aggregate bound | **NOT REACHED** — an owner decision, unchanged |

No prohibited production capability was added. No categorically prohibited class was
registered. No real adapter, no real money, no live advertising.

---

## The gate

Run from **destroyed local infrastructure**.

```text
npm run db:down     containers and volumes removed
npm run db:up       recreated, both containers healthy
npm run typecheck   clean
npm run lint        clean, --max-warnings 0
npm test            38 files, 490 tests, ALL PASSING
```

| Suite | Tests |
|---|---|
| `tests/canonicalisation/` | 326 |
| `tests/negative-controls/` | 15 (7 S1B retained-fee escape + 8 S1A) |
| `tests/integration/` | 130 |
| `spikes/durable-execution/` | 19 |
| **total** | **490** |
| of which **S1B** | **333** |
| of which **S1A**, unchanged | **157** |

### Repetition

| Gate | Requirement | Result |
|---|---|---|
| complete canonicalisation suite | 10 consecutive runs | **10 / 10**, 341 tests each run, identical results |
| VC-S8 | ≥ 25 runs, no harness timeout | **25 / 25**, **0 timeouts**, no `40P01` on the correct path |
| durable-execution spike, after the kill-point-7 correction | ≥ 10 runs | **10 / 10** |

| Required outcome | Result |
|---|---|
| zero unexpected failures | **YES** |
| no VC-S8 harness timeout | **YES** — 25/25 |
| correct path produces no `40P01` | **YES** |
| the known raw external-step duplicate stays demonstrated by the deterministic H4 negative control | **YES** — `external-step-race.test.ts` forces and observes two dispatches every run, unchanged |
| all accepted S1A monetary tests remain green | **YES** — 157/157, no S1A production source edited |

### One process error, recorded rather than smoothed over

The first attempt at the spike repetition gate reported 7 failures in 10, with
`42P07 relation "company" already exists` and
`23505 duplicate key … pg_type_typname_nsp_index`. **This was operator error, not a code
defect:** a second `vitest` run had been started against the same PostgreSQL instance while
the gate was running, and the spike's `resetForRun` migrates the database down and up. Two
concurrent migrations of one database collide.

Re-run in isolation, with no other process touching the database: **10 / 10 pass**. It is
recorded because the standard is that what happened is reported, including when the cause was
the operator.

---

## What S1B.2 added to the tree

| File | What |
|---|---|
| `tests/canonicalisation/canonicalisation-cohesion.test.ts` | the table-driven cohesion suite — one relationship per case, a positive control, a constructor call counter |
| `tests/canonicalisation/catalogue-entry-provenance.test.ts` | finding 1B, structurally and behaviourally, with a discrimination check |
| `tests/canonicalisation/selected-option-projection.test.ts` | finding 2 — five properties plus the decision-relevance and contrast controls |
| `tests/canonicalisation/destination-provenance.test.ts` | finding 3 — source and behaviour |
| `tests/canonicalisation/canonical-text-injectivity.test.ts` | finding 4 — the hazard demonstrated against Node first, then every rule with a positive control |
| `tests/type-negative/catalogue-entry-into-context.ts` | finding 1B as a compile error |
| `tests/type-negative/destination-into-option.ts` | finding 3 as a compile error, in two positions |
| `source-rules.test.ts` rules 7 and 8 | no non-architecture request hash survives; the core owns no per-class logic |
| `RegisteredConstructor.computeSemanticOptionDigest` / `.assertInputCohesion` | the real extension point |
| `canonicalText` / `isCanonicalText` / `isWellFormedUnicode` | the `ACOS-JCS-1` admissibility rule |
| `RecordedRefundSelectedOption` | the typed per-class projection |
| `externalDispatchNote()` in the spike | the observation, separated from the verdict |
| S1B-C6a, S1B-C8 | two owner clarifications |

## What S1B.2 removed

`AuthoritativeCanonicalisationContext.catalogueEntry` ·
`SelectedAuthoritativeRefundOption.destinationInstrumentRef` ·
`RefundParameters.destinationInstrumentRef` · `destination_instrument_ref` from the vendor
payload and from `refundSemanticParamDigest` · `authorizationRequestCanonicalHash` and
`authorizationRequestHash` · `refundSemanticOptionDigest` from `optionDigest.ts` (moved, not
deleted) · the `dispatchCount > 1` clause from the spike's invariant verdict · two fixture
mutation rows that treated the destination as an independent effect dimension.

## Still open, unchanged by S1B.2

**Full VC-C1 remains PARTIAL.** VC-C2, VC-C3, VC-A3, the resume half of VC-C4, `I18b`'s
runtime equality, `I18d` and `I42`'s database uniqueness remain **OPEN**.

`SELECTOR_STALE` and `SELECTOR_ENUMERATION_STALE` are still unemitted — S1B-C7 unchanged. The
C′ entity advisory lock, live enumeration, `I53`'s no-substitution rule and the mandatory
positional-selector negative control all belong to the next increment. No Cedar. No adapter.
No outbox. No FX.

**Do not begin the enumeration / selector increment on the strength of this document.**
S1B.2 discharges the independent review's findings; it does not authorise the next slice.
