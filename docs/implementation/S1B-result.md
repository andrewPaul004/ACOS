# S1B Result — Effect Canonicaliser Core + `refund.create`

**Branch:** `feature/s1b-effect-canonicaliser`, from `c1ae9f0`.
**Architecture package:** `docs/architecture/v1.3.1/` — **unmodified in every respect**.

---

## Verdict

```text
S1B.1 PASS — S1B ACCEPTED
```

**Superseded verdict, retained as the record:**

```text
S1B CONDITIONAL — LOCAL REPAIR REQUIRED     (the original S1B result)
```

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
| the authority/request hash committing to exposure | changes | **PASS** |
| rationale | irrelevant | **PASS** |

The commitment is `authorizationRequestCanonicalHash`, added in S1B.1 because
`dispatch_payload_hash` covers the payload only and so cannot move when the economics move
without the vendor request moving. It is a **function, not a request field**: `26 §2.1`
declares no `request_hash`, and inventing one would repeat the error this pass is repairing.

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

## What S1B.1 added to the tree

| File | What |
|---|---|
| `src/kernel/canonicalisation/authoritativeCost.ts` | `AuthoritativeRetainedFee` — the fee as an authoritative amount |
| `src/kernel/canonicalisation/grantWindows.ts` | `AuthoritativeGrantWindowContext` — the grant/window-resolution boundary |
| `authorizationRequestCanonicalHash` in `canonicaliser.ts` | the authority commitment over exposure |
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
