# S1B Implementation Log

A record of what was done, in order, with the decisions that were not mechanical and the
one thing that went wrong.

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
| **S1B-C3** | The retained fee is `round_half_away(amount × 2.9%) + $0.30` | The architecture prints `$1.03` and names "the processor's published fee schedule" without printing the schedule. This derivation reproduces the printed figure exactly |
| **S1B-C4** | `refund.create` has `counterparty = null`; the destination is a computed parameter | `26 §2.1` types the field as present while `26 §11.2` row 3 prints `n/a`, and `26 §1` Corollary 1 says why conflating payer with counterparty is the error |
| **S1B-C5** | `window_refs` comes from the catalogue at S1B | `26 §2.1` sources it from "the matching grants", and grant matching is step I — policy — which S1B does not implement. The catalogue set is a superset grant matching can only narrow |
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

## 5. The retained fee, and why $1.03 is not a magic number

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
