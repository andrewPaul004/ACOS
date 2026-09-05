# S1B Implementation Log

A record of what was done, in order, with the decisions that were not mechanical and the
one thing that went wrong.

**Amended by S1B.1, the conditional gate repair pass.** Two of the seven decisions below did
not survive owner review: `S1B-C3` was **withdrawn** because it invented an economic rule
the architecture does not establish, and `S1B-C5` was **superseded** because catalogue
membership is not matching-grant resolution. Both are marked in place rather than rewritten,
and §12 records the repair pass in full. **S1B found the VC-S8 harness race rather than
hiding it**; S1B.1 repaired it as `S1A-H5`.

---

## 1. Baseline verification, before any edit

| Check | Result |
|---|---|
| `git status` | **clean** |
| HEAD | `c1ae9f0620eeb114c6b69f0dc1f578e1fbf5d7d2` — *chore(git): ignore the generated NEXT_STEPS.md session note* |
| Branch created | `feature/s1b-effect-canonicaliser`, from `master` |
| `npm run typecheck` | **clean** |
| `npm test` | **18 files, 157 tests, all passing**, 160.30 s |

The accepted S1A baseline was green, so S1B proceeded. Had it not been, the mandate
required a stop.

---

## 2. Architecture read, before any production code

Read in full or in the named sections: `24` (K4, K5, §3.1, §8), `26` (§1, §2, §2.0,
§2.0.1, §2.1, §2.1.1, §2.1.2, §2.1.3, §2.2, §2.3, §5, §7, §7.1, §8, §11.2), `25` (§7, §8),
`30` (§5.3), `33` (§3.2), `34` (ADR-006, ADR-021), `35` (§4), `36` (§0, §1, §2, VC-C1–C4),
`37` (S1), `50` (§2 classes 19 and 20), `51` (§2, §3.1, §5.1), and the invariant registry
rows for `I18a`, `I18b`, `I18c`, `I21`, `I41`, `I42`, `I53`, `I61`.

`docs/implementation/S1B-contract.md` was written **before** the first line of production
code, and every requirement in it names its architecture source.

---

## 3. The seven decisions that were not mechanical

Each is recorded in `S1B-owner-clarifications.md` with the architecture text quoted
verbatim. Summarised here with the reasoning:

| ID | Decision | Why not mechanical |
|---|---|---|
| **S1B-C1** | `rationale` may enter only the opaque `intent_hash` lineage commitment | `I21` and `26 §2.1`'s `intent_hash` field are in literal tension. Resolved by the owner clarification, and made structural rather than conventional |
| **S1B-C2** | An unverifiable `ConstructorVersionRecord` denies `NOT_CANONICALISABLE` | The architecture names `CONSTRUCTOR_SEMANTIC_CHANGE` for the **resume** path and "a build failure" for the **missing** case; it names no runtime denial for *present but invalid* |
| ~~**S1B-C3**~~ | ~~The retained fee is `round_half_away(amount × 2.9%) + $0.30`~~ | **WITHDRAWN IN S1B.1.** The derivation reproduced the printed `$1.03` exactly, and that was the trap: the architecture establishes a retained fee as an authoritative cost component and prints one figure. It establishes no rate, no fixed charge, no rounding rule and no schedule. Replaced by **S1B-C3a** — a kernel-owned authoritative **amount** |
| **S1B-C4** | `refund.create` has `counterparty = null`; the destination is a computed parameter | `26 §2.1` types the field as present while `26 §11.2` row 3 prints `n/a`, and `26 §1` Corollary 1 says why conflating payer with counterparty is the error |
| ~~**S1B-C5**~~ | ~~`window_refs` comes from the catalogue at S1B~~ | **SUPERSEDED IN S1B.1.** "Superset-safe" argued about the direction of the error, not about whether the catalogue was the right object — and it is not. Replaced by **S1B-C5a** — a kernel-owned grant/window-resolution boundary |
| **S1B-C6** | A closed five-member `reason_code` set is declared | The architecture requires the enum to be closed and never enumerates it |
| **S1B-C7** | An `option_id` mismatch denies `SELECTOR_INVALID`, not `SELECTOR_STALE` | `SELECTOR_STALE` is a property of live re-enumeration under the C′ lock, which S1B does not perform. Emitting it would claim a check nobody ran |

---

## 4. How `I21` was made structural

The requirement is that a violation **must not compile**. Three things were needed.

**Three separate input types.** `PermittedIntentFields`, `AuthoritativeCanonicalisationContext`
and `SelectedAuthoritativeOption` are passed to a constructor as three properties of a
closed input type. They are deliberately not merged: merged, nothing in the type system
would distinguish "the model chose this" from "the kernel resolved this", and `I21` reverts
to a code-review property.

**Three nominal brands.**

- `PermittedIntentField<T>` — the four fields `I21` permits to cross.
- `KernelComputed<T>` — every other authority-bearing field. Minted only by `computed()`.
- `OpaqueRationale` — **not a `string`**. It has no character accessor of any kind.

The asymmetry is the mechanism: `KernelComputed<string>` is assignable to `string`, so
*reading* a computed value stays ordinary, but a raw `string` is not assignable to
`KernelComputed<string>`, so *writing* a model-chosen value into an authority position is a
type error.

**`sealRationale` discards the text.** `rationale.ts` computes a SHA-256 commitment over
the UTF-8 NFC bytes at parse time and keeps only the digest and the byte length. After
sealing, the characters the model submitted are **not recoverable by any code path in the
process**. That is stronger than "never parsed": it is "unparseable". The journal's own
retention of the text (`26 §2.0`, "journaled for the audit record") belongs to the journal
slice and is written from the transport boundary, not from here.

**And the harness has a positive control.** `tests/type-negative/positive-control.ts` must
compile with **zero** diagnostics. Without it the five negative files could be failing for
an unrelated reason — a typo, a bad import — and the test would still pass. The harness
also asserts that no diagnostic appears on an unmarked line, so a fixture that stops
testing what it claims fails rather than quietly passing on some other error.

`tests/type-negative/**` is excluded from the root `tsconfig.json` and from ESLint, because
its files are required to fail type checking; including them would make `npm run typecheck`
fail by design.

---

## 5. The retained fee — WITHDRAWN REASONING, retained as the record

> **S1B.1: everything in this section is superseded.** It is kept because the record should
> show what was claimed. The reasoning below is exactly the error: it treated *"this rule
> reproduces the printed figure"* as authority for the rule. It is not. See §12 and
> `S1B-owner-clarifications.md` **S1B-C3a** for what is in force.

`26 §2.1.1` and `51 §3.1` both print `$1.03` on a `$25.00` refund and neither prints the
schedule that produces it. `36 §12`'s oracle row requires the fixture to be authored "from
the processor's published fee schedule", so the schedule had to be identified rather than
the figure hard-coded.

The Stripe-family standard card rate reproduces it exactly:

```text
$25.00 × 29/1000 = $0.725  →  round half away from zero at scale 2  →  $0.73
$0.73 + $0.30                                                        =  $1.03
$25.00 + $1.03                                                       =  $26.03
```

The schedule is an authoritative RECORD-grade value on the context
(`ProcessorFeeSchedule`), not a constant inside the constructor, so a later slice that
fetches it from a real processor record changes the fixture rather than the money path.
Rounding uses S1A's `money.mulByRational`, which already rounds half away from zero — the
convention S1A tested for the `30.4` monthly basis multiplier.

The independent oracle carries `2500`, `29`, `1000`, `30`, `103` and `2603` as hand-authored
minor-unit integers, does its own three-line arithmetic, and imports **nothing at all**.

*(End of the withdrawn reasoning. Under `S1B-C3a` the oracle carries `2500`, `103`, `2603`,
`110` and `2610`, performs one addition, and carries no rate, no fixed charge and no
rounding primitive.)*

---

## 6. The negative control, and why the fixture — not the kernel — is the detector

`tests/negative-controls/unsafe-retained-fee-escape.ts` is a deliberately wrong
constructor differing from the correct one in exactly two lines: `costComponents` is empty
and `totalExposure` is `vendorAmount`. Everything else — the dispatch payload, the
idempotency key, the option identity, `I18a` — is identical and correct, which is precisely
why `26 §2.1.1` treats this defect as the dangerous one rather than the obvious one.

The test asserts **first** that the hand-authored VC-C1 fixture rejects it: `$25.00` is not
`$26.03`, and the expected retained-fee component is absent. That is the mandate's
requirement, and it is what proves the fixture can detect the escape it exists for.

It asserts **second**, as defence in depth, that the canonicaliser's own `I18c` guard also
refuses it — a class the catalogue does not declare cost-component-free may not emit
`total_exposure == vendor_amount`. The ordering matters: if the kernel guard were asserted
first, a reader could conclude the fixture was never exercised.

The unsafe code is test-only. A test asserts no module under `src/` imports the
negative-control tree.

---

## 7. Canonical bytes: what was built and what was deliberately not

`src/kernel/canonicalisation/canonicalBytes.ts` implements the `30 §5.3` rules for the
canonicaliser's own structures: declared field order per structure kind, 4-byte big-endian
length framing, per-column decimal scale, RFC 3339 UTC at six fractional digits, a one-byte
null sentinel distinct from a zero-length empty string, UTF-8 NFC, and RFC 8785 for
structured values.

Two choices worth recording.

**Non-integer numbers in JSON values are refused, not serialised.** RFC 8785 defines an ES6
double serialisation for them, but no money value in this codebase is ever a `number`, so a
float appearing in a canonicalised payload is a defect. Failing closed at canonicalisation
is cheaper than discovering it at settlement.

**RFC 8785 string escaping is written out rather than delegated to `JSON.stringify`.**
`JSON.stringify` would have been correct for that one narrow job, but the package asserts
"no `JSON.stringify` on a hashing path" as a source rule, and a rule with one memorised
exception is a rule that erodes. `source-rules.test.ts` rule 2 enforces it.

**VC-A3 is not claimed.** That gate is cross-implementation byte-identity between the
control trigger and the audit trigger — two independent implementations, neither of which
S1B builds.

---

## 8. What the canonicaliser core does, in order

1. **Step C2.** Registry lookup. A miss denies `NOT_CANONICALISABLE`.
2. **`I61`.** The `ConstructorVersionRecord` is resolved and its Ed25519 signature verified
   **before the constructor body runs**. A constructor cannot choose an unsigned version.
3. **Input agreement.** The authoritative option's action class and resource must match; the
   selector's `enumeration_id` must be the resolved one; the selector's `option_id` must
   equal `H(action_class ‖ resource_id ‖ semantic_option_digest)` recomputed from the
   authoritative option. Any mismatch denies `SELECTOR_INVALID` and **no effect is
   constructed** — the kernel never substitutes.
4. **Construct.** The class constructor computes parameters, exposure and the final dispatch
   payload from kernel-owned inputs only.
5. **`I18a` and `I18c`.** Asserted by the core as kernel invariants. These `throw` rather
   than deny: no `ProposedIntent` can cause them, so they are internal defects, and both
   invariants' on-violation column reads *"Critical incident. The action class is suspended
   pending investigation."*
6. **Emit.** The request and the payload together, bound by
   `dispatch_payload_hash = H(canonical bytes of DispatchPayload)`.

`I18b` is **not** asserted in the core — it is an equality against `reservation.amount` and
S1B takes no reservation. `I18d` is a settlement assertion with no settlement path.

---

## 9. Files added

**Production — `src/kernel/canonicalisation/` (11 files):** `brands.ts`, `rationale.ts`,
`errors.ts`, `canonicalBytes.ts`, `actionCatalogue.ts`, `intent.ts`, `lineage.ts`,
`constructorVersion.ts`, `types.ts`, `optionDigest.ts`, `idempotency.ts`, `registry.ts`,
`canonicaliser.ts`, `constructors/refundCreate.ts`, `ports/reservationHandoff.ts`.

**Tests (13 files, 200 tests):** `tests/canonicalisation/` × 10, `tests/type-negative/` ×
6 fixtures plus a tsconfig, `tests/negative-controls/retained-fee-escape.test.ts` and its
`unsafe-retained-fee-escape.ts`, `tests/support/canonicalisationOracle.ts` and
`tests/support/canonicalisationFixture.ts`.

**Repository files changed (2):** `tsconfig.json` and `eslint.config.js`, both only to
exclude `tests/type-negative/**`.

**Files NOT changed:** everything under `src/kernel/exposure/`, everything under `src/db/`,
every S1A test, every architecture document.

---

## 10. Four things that went wrong during implementation, and how they were resolved

**1. A fixture that could not sign a malformed record.** The constructor-version negative
cases originally built a record with `nonSemanticMinor: 1.5` and signed it; the canonical
integer encoding refuses a non-integer, so the *fixture* threw before the *resolver* could.
Resolved by patching the record **after** signing, which also makes the test sharper: the
resolver runs structural checks before signature verification, so each case now asserts its
own structural reason rather than falling through to "signature does not verify".

**2. A source rule that was too broad.** A first draft asserted that no file under `src/`
contains `per_action_max`. S1A's `0003__standing.sql` legitimately carries a
`per_action_max_monetary` column, because `24 §3` K5 prints `per_action_max { monetary:
0.00 }` on the `StandingRevocationAuthority` — a signed authority bound, not a policy
evaluation. The rule was narrowed to `src/kernel/canonicalisation/`, which is everything
S1B added, and widened in content to `PER_ACTION`, `per_action_max`, `permit(`, `cedar`,
`Cedar` and `WINDOW_EXHAUSTED`.

**3. A second over-broad rule, same shape.** "No file under `src/` mentions
`negative-controls`" failed on an S1A migration comment that names the directory. Narrowed
to an *import* match over `.ts` files, which is the property that actually matters.

**4. The rationale source rule and `errors.ts`.** `errors.ts` names the deny detail
`RATIONALE_TOO_LONG` — a schema-validation outcome, not a read of content. Rather than
rename the code, `errors.ts` joins the permitted list **with a second assertion pinning its
only match to that exact token**, so the exemption cannot quietly widen.

---

## 11. The one defect found and NOT repaired

`tests/integration/exposure/vc-s8-realised-standing-atomicity.test.ts` → *"an over-commit
racing a spend observation is refused, in both orderings"* is **load-sensitively flaky**.
Observed 3 failures in 14 runs, all three under machine load; 11 passes otherwise,
including a final clean full-suite run of 31 files and 357 tests.

It is a race in the **test harness**, not in production code. `Conductor.release` resolves
a promise; it does not wait for the released participant's next statement to reach the
database. The case releases the reconciler and then immediately releases the authorisation,
with no barrier guaranteeing the reconciler took the `window_balance` row first. When the
authorisation wins that race it parks at `AFTER_LOCK` holding the row, the reconciler blocks
on the lock and can never reach `AFTER_WRITE`, and the conductor's 20-second timeout fires.
The recorded failing timeline shows exactly that. The same file's ORDERING A and ORDERING B
cases exercise the same production code and passed in every run, including the runs in which
this case timed out.

**S1B does not repair it**, per the mandate: *"Do not repair unrelated S1A behavior inside
S1B."* Full analysis in `S1B-test-matrix.md §5`; it is the sole reason the S1B result is
**CONDITIONAL** rather than **PASS**.

---

## 12. Gate at the end of S1B

| Check | Result |
|---|---|
| `npm run typecheck` | **clean** |
| `npm run lint` | **clean**, `--max-warnings 0` |
| S1B tests | **200 passing** across 13 files |
| S1A tests | **157 passing**, unmodified — with the §11 intermittent |
| Total | **31 files, 357 tests** |
| Architecture package | **unmodified** |
| Authority quantities | **unchanged** — no migration added, no edit under `src/kernel/exposure/` |
| S1 pass-revocation conditions | **none triggered** |

---

## 12. S1B.1 — the conditional gate repair pass

S1B was returned **CONDITIONAL — LOCAL REPAIR REQUIRED** on three findings. No
enumeration/selector work was begun, no Cedar was implemented, and S1B scope was not
expanded.

### Repair 1 — VC-S8 deterministic ordering (S1A-H5)

**A test-harness repair. No production money-path source was changed, and no money-path
semantics were changed to make a test deterministic.**

The reconciler participant announced only `AFTER_BEGIN` and `AFTER_WRITE`, and the conductor
released the competing authorisation on the strength of `AFTER_BEGIN`. That barrier proves a
snapshot was taken; it proves nothing about who owns the `window_balance` row. Under load
the authorisation sometimes reached the row first, parked at `AFTER_LOCK` holding it, and
the reconciler could then never reach `AFTER_WRITE` — a harness deadlock, observed as three
Conductor timeouts in fourteen runs.

The reconciler now takes the declared locks itself, through the one declared
`acquireMoneyPathLocks` helper in the one declared order, and announces `AFTER_LOCK` only
after `SELECT … FOR UPDATE` returns. `recordRealisedSpend` re-acquires the same rows inside
the same transaction, which PostgreSQL satisfies from the locks already held. The
authorisation is released only after that barrier is observed.

Applied to **every** case sharing the race — `ORDERING A`, the over-commit case, and
`ORDERING B`'s reconciler side — not only the one that happened to fail. The reversed-order
negative control that deliberately produces a real `40P01` is retained unchanged in
`lock-order.test.ts`. Full detail: `S1A-implementation-log.md` §20.

### Repair 2 — the invented refund fee schedule removed

`ProcessorFeeSchedule` is gone from the tree. The context now carries
`AuthoritativeRetainedFee` — an **amount**, the `source_ref` of the record it was read from,
and a currency (`src/kernel/canonicalisation/authoritativeCost.ts`). The refund constructor
adds it as a `RETAINED_PROCESSING_FEE` cost component and performs no multiplication and no
rounding; `mulByRational` is no longer imported there. An absent fee for a class the
catalogue does not declare cost-component-free **throws** rather than emitting zero cost
components, which is the defect `26 §2.1.1` names.

The fee was **not** moved into `ProposedIntent`, was **not** made model-controlled, fetches
**no** real processor, and selects **no** real fee model. Selecting one belongs to
adapter/state ingestion.

The discriminating pair is `tests/canonicalisation/retained-fee-provenance.test.ts`: the
`$25.00 / $1.03 / $26.03` fixture, and the same semantic option at `$1.10`, where the
dispatched effect, the vendor payload, the `option_id` and the idempotency key are all
unchanged while `total_exposure`, the reservation-handoff amount and the authority
commitment over exposure all move. That is the distinction between the **identity** of the
vendor effect and the **current authoritative cost** of performing it.

**One new hash.** `dispatch_payload_hash` covers the payload only and so cannot move when
the economics move without the vendor request moving. S1B.1 added
`authorizationRequestCanonicalHash` — the request's canonical byte form, over both exposure
figures, every cost component and the window refs. It is a **function, not a request
field**: `26 §2.1` declares no `request_hash`, and adding one would be the same class of
error this pass is repairing.

> **WITHDRAWN BY S1B.2, finding 5.** Both functions are **deleted**. The reasoning above is
> retained as the record and was wrong in one respect that mattered: a helper covering only
> *some* authority-relevant fields cannot support the inference "the hash moved, therefore
> the authority moved" in either direction, and calling it "the authority commitment"
> invited exactly that reading. `26 §2.1` declares no `request_hash` and S1B does not
> pre-design one; the normative row commitment belongs to the journal/audit slice. The
> assertions that used it now read the authoritative **fields** directly. See
> `S1B-result.md §S1B.2` question 10.


### Repair 3 — `window_refs` provenance

`ActionCatalogueEntry.declaredWindows` was **removed**, so no reader can mistake catalogue
membership for grant resolution. `window_refs` now arrive through
`AuthoritativeGrantWindowContext` (`src/kernel/canonicalisation/grantWindows.ts`), a type
declaration with no executable statement in the file, and the canonicaliser **carries**
them.

No Cedar was implemented. Nothing claims the carried values are actual matching-grant
resolution; the fixture's `resolvedBy` says `fixture:` in the value itself. The four
required properties are proved in `tests/canonicalisation/window-ref-provenance.test.ts`.

### What was deliberately not touched

`S1B-C4` was **not** revisited. For `refund.create` the architecture distinguishes the
original payer from a counterparty meaning a payee, supplier or settlement destination; a
refund to the original instrument is `INBOUND_ORIGINAL_INSTRUMENT` and is governed by
customer novelty and `P4a` rather than counterparty novelty. A null counterparty remains
consistent with the canonical type, and the review of `S1B-C3`/`S1B-C5` is not a reason to
redesign it.

Also unchanged: the architecture-declared refund `semantic_option_digest`; every authority
ceiling and MAL quantity; the accepted S1A exposure ledger under `src/kernel/exposure/`;
and the immutable architecture package under `docs/architecture/v1.3.1/`.

### The two source rules that keep it true

Both in `tests/canonicalisation/source-rules.test.ts`, because a rule written only as a
comment is a rule a future edit breaks silently:

- **rule 5** — no fee-schedule type, no rate constant, no rounding primitive anywhere on the
  S1B surface, and no `mulByRational` in the refund constructor;
- **rule 6** — the catalogue declares no windows, no module reads a catalogue window field
  into `window_refs`, and the grant/window boundary resolves nothing.

---

## 13. S1B.2 — the independent implementation review repair pass

An independent code review of the S1B/S1B.1 repository returned:

```text
S1B NOT YET ACCEPTED — LOCAL IMPLEMENTATION REPAIRS REQUIRED
```

Eight findings, all local. Not an architecture return, not a red-team pass, not the
enumeration/selector increment, not Cedar. The architecture package is unmodified.

### 13.1 What the review found, in one line each

| # | Finding | Class of defect |
|---|---|---|
| 1 | Four authoritative input relationships unchecked | the canonicaliser could construct from contradictory inputs |
| 2 | The recorded selected option dropped the refund policy's operands | a later policy slice would have to re-derive them |
| 3 | `destinationInstrumentRef` was an effect dimension outside option identity | dispatch destination could change without `option_id` changing |
| 4 | `ACOS-JCS-1` canonical text was not injective in three ways | distinct accepted values could hash identically |
| 5 | A non-normative generic `AuthorizationRequest` hash had been invented | an accidental protocol, and it did not cover what it claimed |
| 6 | The canonicaliser core owned the refund digest | the declared extension point was not the real one |
| 7 | Kill point 7 in the durable spike contradicted S1A-H4 | a stale test expectation |
| 8 | Duplicate `ConstructorVersionRecord` input resolved by registration order | a silent, order-dependent selection of a signed artifact |

### 13.2 The decisions that were not mechanical

**Throw or deny?** Findings 1A, 1B and 1C are contradictions between two **kernel-owned**
inputs. No `ProposedIntent` can produce any of them, and `26 §7` is explicit that denial
detail returned to a model is coarse. Returning a model-visible category for a condition no
model can cause would be a misreport, so they throw — the same reasoning
`assertI18aAndI18c` already used.

Finding 1D is different, and this took the longest to settle. `reason_code` **is** one of the
four fields `I21` lets the model supply, so a model genuinely can propose a valid code
against a validly content-addressed option from another scope. That is model-reachable, so it
must deny. The code is `SELECTOR_INVALID`, detail `REASON_CODE_SCOPE_MISMATCH`: both halves
are individually well-formed and it is their combination that is inadmissible, which is
exactly what "the selector does not index a permissible option for this intent" means. **No
new denial code was invented** — `26 §7` declares the set.

**Removal, not validation (finding 1B).** The first draft validated
`context.catalogueEntry` against `ACTION_CATALOGUE[intent.actionClass]`. That was rejected as
a repair: a validated field is still a field, and the review's own standard — *"the test
should become structurally impossible if the field is removed from context"* — asks for the
stronger thing. The field is gone. The consequence is that the negative test cannot be
written as a runtime fixture at all, so it is written three ways: a compile-negative under
the real `tsc` project, a structural assertion on the type and the source, and a behavioural
assertion that the four substitutable fields track the catalogue.

**Removal, not digest widening (finding 3).** Adding `destination_instrument_ref` to
`semantic_option_digest` would have closed the hole and changed an **architecture-declared**
digest, which is not an implementation's call — the same error class as inventing a fee
schedule (S1B-C3a). The architecture already supplies the alternative: `26 §11.2` row 3's
destination is derived from the RECORD-grade parent transaction, and that transaction is
content-addressed by `parent_transaction_id` with `instrument`, both digest members. The
second identifier was redundant with them **and** unbound by them, which is the worst
combination. It is deleted.

**Deleting a helper that worked (finding 5).** `authorizationRequestHash` was genuinely
useful in the two S1B.1 provenance tests, and deleting it made those tests longer. It was
still right to delete: `26 §2.1` declares no `request_hash`, the helper did not cover every
authority-relevant field, and it described itself as "the authority commitment" — an
invitation to read "the hash moved" as "the authority moved" in both directions, which it
could not support. The replacement is not another hash; it is asserting the authoritative
fields directly, which is both stronger and closer to what the findings were about.

**Where the per-class digest lives (finding 6).** Moving `refundSemanticOptionDigest` into
`constructors/refundCreate.ts` is a one-line change with a real consequence: the digest
definition and the constructor that computes the effect are now in one file, which is what
`26 §2.1.2` requires when it makes a digest change semantic **by definition**. The digest
itself is byte-for-byte unchanged — it moved file, not fields, and
`refund-semantic-digest.test.ts` still passes without an edit to a single assertion.

**Separating two properties, not weakening one (finding 7).** The spike's `invariantVerdict`
counted `dispatchCount > 1` as a weakened S1A substrate invariant. S1A-H4 had already
established the opposite and narrowed ADR-IMP-002 to say so. The repair is to **separate**
the application-transaction/checkpoint property (asserted, must never weaken) from the
external-dispatch observation (recorded, not a verdict). Kill point 7 now asserts the ledger
moved exactly once, the coupling held, the journal sequence was allocated once, and the
ceiling was respected — and records the dispatch count rather than requiring it to be 1.
Exact-once dispatch assertions are **retained** in every sequential case, where no concurrent
external-step race exists, and the deterministic S1A-H4 negative control that forces and
observes two dispatches is untouched. The outbox was not built.

### 13.3 The canonical-text repair, in detail (finding 4)

The three hazards, and why each is real rather than theoretical:

1. **`U+0000` versus the null sentinel.** `30 §5.3` encodes `null` as one `0x00` byte; a text
   value containing `U+0000` UTF-8-encodes to the same byte. `canonical-text-injectivity.test.ts`
   demonstrates this against Node before asserting the rule.
2. **Unpaired UTF-16 surrogates.** Node substitutes `U+FFFD` for every lone surrogate. The
   test shows `String.fromCharCode(0xd800)` and `String.fromCharCode(0xd801)` — distinct
   strings — encoding to the identical three bytes `efbfbd`. RFC 8785 §3.2.2.2 requires
   malformed Unicode data to fail; ACOS now rejects before NFC and before encoding.
3. **NFC key collisions.** ACOS adds an NFC rule RFC 8785 does not have, so two distinct keys
   can normalise to one canonical name. The order is now fixed: validate, normalise, reject a
   collision, sort the **normalised** names, serialise the **normalised** names.

`isWellFormedUnicode` is written out rather than delegated to `String.prototype.isWellFormed`,
which is not in the declared `ES2022` lib — the rule belongs to the specification, not to the
runtime.

Model-supplied strings fail closed **at the wire**, with `NOT_CANONICAL_TEXT`, before the
rationale seal. That ordering matters: the rationale commitment is taken over UTF-8 NFC
bytes, so two rationales carrying different lone surrogates would have committed
**identically** — a silent collision in the one field whose entire purpose is auditability.

Every rule has a positive control. A valid supplementary character (`U+1F600`) is accepted
and hashes to four real bytes; a single canonically-equivalent key serialises normally; `null`
and the empty string stay distinct. Without those, the rules would be satisfiable by refusing
everything.

### 13.4 One test had to change for a reason worth recording

`idempotency-key.test.ts` mutated `reasonCodeScope` to `BILLING_ERROR` while the intent still
proposed `CUSTOMER_REPORTED_DAMAGE`. Under finding 1D that pair now denies, so the case
stopped reaching the key at all.

The fix moves the proposed reason code into the mutated scope. That is **not** masking one
relationship with another: `reason_code` is not an input to the idempotency key —
`25 §7`'s key is over the semantic **parameters**, and `reason_code_scope` is a member while
`reason_code` is not. A control was added asserting exactly that: varying only the reason
code, within scope, leaves the key identical. So the row still attributes the key change to
the scope alone.

### 13.5 Files added

| File | What |
|---|---|
| `tests/canonicalisation/canonicalisation-cohesion.test.ts` | the table-driven cohesion suite, one relationship per case, with a positive control and a constructor call counter |
| `tests/canonicalisation/catalogue-entry-provenance.test.ts` | finding 1B, structurally and behaviourally |
| `tests/canonicalisation/selected-option-projection.test.ts` | finding 2, including the discriminating pair and its contrast |
| `tests/canonicalisation/destination-provenance.test.ts` | finding 3, source and behaviour |
| `tests/canonicalisation/canonical-text-injectivity.test.ts` | finding 4, with the hazard demonstrated against Node first |
| `tests/type-negative/catalogue-entry-into-context.ts` | finding 1B as a compile error |
| `tests/type-negative/destination-into-option.ts` | finding 3 as a compile error |

### 13.6 Files changed

`canonicalBytes.ts` (canonical-text admissibility, NFC key ordering) · `intent.ts` and
`rationale.ts` (the wire boundary and the seal) · `errors.ts` (two deny details) ·
`types.ts` (catalogue entry and destination removed; typed recorded option) · `registry.ts`
(two new registered-constructor members) · `optionDigest.ts` (reduced to `computeOptionId`) ·
`idempotency.ts` (destination dropped from the param digest) · `canonicaliser.ts` (cohesion,
catalogue lookup, registration-routed identity, request hash deleted) ·
`constructors/refundCreate.ts` (owns the digest and the cohesion checks; typed projection) ·
`constructorVersion.ts` (duplicate id fails closed) · the oracle and the shared fixture · the
five existing tests that referenced removed API · `spikes/durable-execution/spike.test.ts`
(finding 7).

### 13.7 What was deliberately not touched

No architecture file. No architecture-declared digest. No S1A production source. No Cedar, no
C′ live enumeration, no entity advisory lock, no real adapter, no outbox, no FX, no version
history or storage. `SELECTOR_STALE` and `SELECTOR_ENUMERATION_STALE` are still unemitted —
S1B-C7 is unchanged.

### 13.8 The observation from §11 and S1B.1, now closed

`S1B-result.md` recorded, honestly and unresolved, that kill point 7 had once observed
`dispatchCount == 2` and that it was "not claimed as repaired". Finding 7 identifies what it
actually was: a **stale test expectation**, contradicting the accepted S1A-H4 result, not a
failure of the ledger checkpoint property. The prior observation is retained in this record
rather than erased, and the assertion is repaired.
