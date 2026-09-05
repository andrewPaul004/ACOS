# S1B Test Matrix

Every row names the architecture clause it tests, the file that tests it, and its status.
A row marked **OPEN** is not tested by S1B and is not claimed by S1B.

**Suite shape after S1B.** 31 test files, 357 tests. S1A's 18 files and 157 tests are
unchanged and still pass; S1B adds 13 files and 200 tests.

| Area | Files | Tests |
|---|---|---|
| S1A, accepted baseline, unmodified | 18 | 157 |
| S1B canonicalisation | 12 | 194 |
| S1B negative control | 1 | 6 |
| **Total** | **31** | **357** |

---

## 1. The eighteen requirements the S1B mandate lists

| # | Requirement | Where | Status |
|---|---|---|---|
| 1 | Exact five-field `ProposedIntent` parsing | `intent-boundary.test.ts` | **PASS** |
| 2 | Unknown fields reject | `intent-boundary.test.ts`, `adversarial-intent.test.ts` | **PASS** |
| 3 | Rationale has zero authority effect | `rationale-non-authoritative.test.ts` | **PASS** |
| 4 | `I21` compile-negative boundary works | `i21-type-boundary.test.ts` + `tests/type-negative/` | **PASS** |
| 5 | Unregistered constructor fails `NOT_CANONICALISABLE` | `registry.test.ts` | **PASS** |
| 6 | Signed constructor version verifies | `constructor-version.test.ts` | **PASS** |
| 7 | Invalid version signature fails closed | `constructor-version.test.ts` | **PASS** |
| 8 | Refund semantic digest changes for every declared semantic field | `refund-semantic-digest.test.ts` | **PASS** |
| 9 | `$25.00 + $1.03` constructs `$26.03` | `vc-c1-refund-construction.test.ts` | **PASS** |
| 10 | Dispatch monetary amount remains `$25.00` | `vc-c1-refund-construction.test.ts` | **PASS** |
| 11 | Wrong `$25.00` `total_exposure` negative control is caught | `negative-controls/retained-fee-escape.test.ts` | **PASS** |
| 12 | Idempotency key excludes rationale and sequencing | `idempotency-key.test.ts` | **PASS** |
| 13 | Semantic changes alter the idempotency key | `idempotency-key.test.ts` | **PASS** |
| 14 | Dispatch hash is deterministic | `hash-binding.test.ts` | **PASS** |
| 15 | Property insertion order cannot alter the canonical hash | `canonical-bytes.test.ts`, `hash-binding.test.ts` | **PASS** |
| 16 | Rationale-only mutation cannot alter the dispatch hash | `hash-binding.test.ts`, `rationale-non-authoritative.test.ts` | **PASS** |
| 17 | Existing S1A 157 tests remain green | full suite | **PASS**, with one load-sensitive intermittent failure in a **pre-existing S1A test harness** — see §5 |
| 18 | No authority quantity changes | `source-rules.test.ts` rule 4; no migration added; no edit under `src/kernel/exposure/` | **PASS** |

---

## 2. Architecture clause → test

### `26 §2.0` — the model-facing write surface

| Clause | Test | File |
|---|---|---|
| Exactly five fields | the five declared fields parse; every missing field denies | `intent-boundary.test.ts` |
| `26 §7` step B — "only 5 fields present?" | 14 forbidden extra fields, each denying `EXTRA_FIELD` | `intent-boundary.test.ts` |
| `selector` is a content-addressed pair | non-object, missing member, extra member, empty `option_id` | `intent-boundary.test.ts` |
| `reason_code` from a closed enum | an unlisted code denies `REASON_CODE_NOT_IN_CLOSED_ENUM` | `intent-boundary.test.ts` |
| `26 §7` orders B before C | malformed + unknown class denies `MALFORMED` | `intent-boundary.test.ts` |
| `35 §4` — "the $5,000 is not expressible" | the whole v1.0 proposal shape rejects; one field at a time rejects | `adversarial-intent.test.ts` |
| `26 §2.3` — "the engine reads no prose" | no model SDK, HTTP client or prose primitive under `src/kernel/canonicalisation/` | `adversarial-intent.test.ts` |

### `I21` — the type boundary

| Clause | Test | File |
|---|---|---|
| "a test constructing an `AuthorizationRequest` from a fifth `ProposedIntent` field must not compile" | real `tsc --noEmit` over `tests/type-negative/`, five negative files | `i21-type-boundary.test.ts` |
| the harness must discriminate | `positive-control.ts` must compile with **zero** diagnostics | `i21-type-boundary.test.ts` |
| the harness must not pass on the wrong error | every diagnostic must land on an `EXPECT_ERROR TSxxxx` line, and no diagnostic may appear on an unmarked line | `i21-type-boundary.test.ts` |
| the four permitted fields, and only those | `PermittedIntentFields`'s member list, read out of the source | `i21-type-boundary.test.ts` |
| nothing in `src/` parses rationale | source-reading rule over the whole `src/` tree | `source-rules.test.ts` rule 1 |

The five compile-negative cases:

| File | Violation | Diagnostic |
|---|---|---|
| `rationale-into-request.ts` | `rationale` assigned into an authority-bearing field | TS2322 |
| `rationale-parsed.ts` | `.includes`, `.toLowerCase`, assignment to `string` | TS2339 ×2, TS2322 |
| `fifth-field-request.ts` | a request built from a fifth intent field | TS2353 |
| `intent-as-context.ts` | a `ProposedIntent` passed as the authoritative context | TS2345 |
| `model-amount-into-exposure.ts` | a model-supplied `Money` written into `exposure` | TS2322, TS2375 |

### `26 §7` C2 / ADR-021 — the registry

| Clause | Test | File |
|---|---|---|
| "an action class with no registered constructor must produce `DENY: NOT_CANONICALISABLE`" | three catalogued classes with no constructor, each denying | `registry.test.ts` |
| `NOT_CANONICALISABLE` ≠ `UNKNOWN_ACTION` | a class outside the catalogue denies `UNKNOWN_ACTION` at step C | `registry.test.ts` |
| no fallback constructor | an empty registry denies rather than degrading | `registry.test.ts` |
| one constructor per class | duplicate registration is a build failure | `registry.test.ts` |

### `26 §2.1.2` / `I61` — constructor versioning

| Clause | Test | File |
|---|---|---|
| resolves to a **signed** record | Ed25519 verification; the full identity is stamped on the request | `constructor-version.test.ts` |
| missing record | denies `NOT_CANONICALISABLE` / `CONSTRUCTOR_VERSION_UNVERIFIABLE` | `constructor-version.test.ts` |
| wrong action class | denies | `constructor-version.test.ts` |
| invalid signature — foreign key | denies | `constructor-version.test.ts` |
| invalid signature — post-signing tamper | denies | `constructor-version.test.ts` |
| a record signed for another constructor | denies — substitution is what the signature prevents | `constructor-version.test.ts` |
| structurally malformed | five cases, each naming its structural reason | `constructor-version.test.ts` |
| "semantic by definition, and cannot be declared otherwise" | all **eight** declared fields, each refused as non-semantic | `constructor-version.test.ts` |
| a correctly declared semantic bump, and a purely non-semantic bump | both verify | `constructor-version.test.ts` |
| the representation a later slice enforces | `replayCompatibility` pinned; **called by no production path** | `constructor-version.test.ts` |
| `CONSTRUCTOR_SEMANTIC_CHANGE` is emitted nowhere in S1B | source scan over `src/` | `constructor-version.test.ts` |

### `30 §5.3` — `ACOS-JCS-1` rules

| Hazard | Test | File |
|---|---|---|
| 4-byte BE framing | golden bytes; a forged content boundary changes the hash | `canonical-bytes.test.ts` |
| declared per row kind | the kind is a framed field; two kinds do not collide | `canonical-bytes.test.ts` |
| `25.0` vs `25.00` | `money('25.000')` throws; scale 2 is the only byte form | `canonical-bytes.test.ts` |
| null vs empty string | one-byte sentinel vs zero-length; null/empty/`0.00` all differ | `canonical-bytes.test.ts` |
| timestamps | exactly six fractional digits, UTC, `Z`; an offset normalises | `canonical-bytes.test.ts` |
| UTF-8 NFC | NFC and NFD forms of one string hash identically | `canonical-bytes.test.ts` |
| RFC 8785 for JSON | key order irrelevant; array order significant; nested sorting; escaping; **a non-integer number is refused** | `canonical-bytes.test.ts` |
| declared field order | a different declared order hashes differently | `canonical-bytes.test.ts` |
| `I41`'s two-insertion-order fixture | the same structured field built two ways hashes identically | `canonical-bytes.test.ts`, `hash-binding.test.ts` |
| no `JSON.stringify` on a hashing path | source rule over `src/kernel/canonicalisation/` | `source-rules.test.ts` rule 2 |

### `26 §2.2` — `semantic_option_digest` and `option_id`

| Clause | Test | File |
|---|---|---|
| `line_id` | mutation changes the digest and the id | `refund-semantic-digest.test.ts` |
| `parent_transaction_id` | mutation changes both | `refund-semantic-digest.test.ts` |
| `amount` | mutation changes both | `refund-semantic-digest.test.ts` |
| `instrument` | mutation changes both | `refund-semantic-digest.test.ts` |
| `reason_code_scope` | mutation changes both | `refund-semantic-digest.test.ts` |
| all five distinct | five mutations, six distinct ids | `refund-semantic-digest.test.ts` |
| `H(action_class ‖ resource_id ‖ digest)` | resource and class both participate; the id is a 32-byte hash, not an ordinal | `refund-semantic-digest.test.ts` |
| the selector must content-address the option | four denial cases, all `SELECTOR_INVALID` | `refund-semantic-digest.test.ts` |

### `36 §2` VC-C1 — construction

| Assertion | Expected | Oracle | File |
|---|---|---|---|
| retained fee | `$1.03` | hand-authored `103n` | `vc-c1-refund-construction.test.ts` |
| `vendor_amount` | `$25.00` | hand-authored `2500n` | `vc-c1-refund-construction.test.ts` |
| `total_exposure` | `$26.03` | hand-authored `2603n` | `vc-c1-refund-construction.test.ts` |
| **I18a** dispatch `monetary_effect == vendor_amount` | `$25.00` | — | `vc-c1-refund-construction.test.ts` |
| **I18b** construction half — offered to reservation | `$26.03` | hand-authored | `vc-c1-refund-construction.test.ts` |
| **I18c** `total_exposure >= vendor_amount` | strict, since the class is not cost-component-free | — | `vc-c1-refund-construction.test.ts` |
| the dispatch payload | field-for-field against a hand-authored payload | hand-authored | `vc-c1-refund-construction.test.ts` |
| a second amount | `$40.00 → $1.46 → $41.46` | hand-computed in the test | `vc-c1-refund-construction.test.ts` |
| **`DENY: PER_ACTION`** | — | — | **OPEN — Cedar slice** |

### `36 §0` — the oracle discipline and the negative control

| Rule | Test | File |
|---|---|---|
| the oracle imports nothing from `src/` | source rule; the oracle has **no imports at all** | `source-rules.test.ts` rule 3 |
| the oracle agrees with itself | its own arithmetic reproduces `103n` and `2603n` | `source-rules.test.ts` rule 3 |
| the negative control reproduces the escape | `total_exposure = vendor_amount = $25.00`, no cost components | `negative-controls/retained-fee-escape.test.ts` |
| the escape passes every check that ignores `total_exposure` | I18a holds; the vendor request is correct | `negative-controls/retained-fee-escape.test.ts` |
| **the fixture catches it** | `$25.00 ≠ $26.03`; the fee component is absent | `negative-controls/retained-fee-escape.test.ts` |
| the escape flips the per-action outcome | `$26.03 > $25.00` and `$25.00 ≤ $25.00` | `negative-controls/retained-fee-escape.test.ts` |
| the kernel also refuses it | `I18c` throws when the unsafe constructor is registered | `negative-controls/retained-fee-escape.test.ts` |
| the unsafe code is test-only | no `src/` module imports the negative-control tree | `negative-controls/retained-fee-escape.test.ts` |

### `25 §7` / `24 §3` K4 / `I42` — the idempotency key

| Clause | Test | File |
|---|---|---|
| deterministic, not random | two runs agree; a 32-byte hash | `idempotency-key.test.ts` |
| excludes rationale | rationale-only change leaves the key identical | `idempotency-key.test.ts` |
| cannot be made to include rationale | source rule over `idempotency.ts` | `idempotency-key.test.ts` |
| never includes `journal_seq`, a clock or randomness | source rule over `idempotency.ts` | `idempotency-key.test.ts` |
| a crash-and-retry regenerates the same key | two independent canonicalisations agree | `idempotency-key.test.ts` |
| a semantic change moves it | six mutations, pairwise distinct | `idempotency-key.test.ts` |
| `task_id` participates | a different task, a different key | `idempotency-key.test.ts` |
| framing | a moved content boundary changes the key | `idempotency-key.test.ts` |

### S1B-C1 — `rationale` is non-authoritative

| Quantity | Expectation | File |
|---|---|---|
| `intent_hash` | **differs** — the permitted lineage commitment | `rationale-non-authoritative.test.ts` |
| parameters, exposure, cost components | identical | `rationale-non-authoritative.test.ts` |
| `option_id`, `semantic_option_digest` | identical | `rationale-non-authoritative.test.ts` |
| dispatch payload and its hash | identical | `rationale-non-authoritative.test.ts` |
| idempotency key | identical | `rationale-non-authoritative.test.ts` |
| recoverability, value direction, counterparty, customer novelty | identical | `rationale-non-authoritative.test.ts` |
| constructor version identity | identical | `rationale-non-authoritative.test.ts` |
| the quantity offered to the reservation layer | identical, `$26.03` | `rationale-non-authoritative.test.ts` |
| **the whole request minus `intent_hash`** | identical | `rationale-non-authoritative.test.ts` |
| four malicious injections | every authority output identical to the innocuous run | `adversarial-intent.test.ts` |
| rationale text is unrecoverable | only `byteLength` is observable | `rationale-non-authoritative.test.ts` |
| byte length does not reach any output | 1-byte vs 4096-byte rationale, identical outputs | `rationale-non-authoritative.test.ts` |

---

## 3. What S1B tests and does NOT claim

| Gate | Status after S1B | Why |
|---|---|---|
| **VC-C1** | **PARTIAL** — construction half PASS, `DENY: PER_ACTION` **OPEN** | No policy engine. The oracle shows `$26.03 > $25.00`; that is arithmetic, not a policy result |
| **VC-C2** — `enumerate_effects` | **OPEN** | Not implemented; no `context_spec` projection, no quota, no journal row |
| **VC-C3** — content-addressed selectors never substitute | **OPEN** | Needs C′ re-enumeration under the entity advisory lock, `I53`, and the positional negative control |
| **VC-C4** — constructor versioning, resume half | **PARTIAL** — signing and identity PASS; resume behaviour **OPEN** | Needs the approval state machine |
| **VC-A3** — `ACOS-JCS-1` cross-implementation | **OPEN** | Requires a second independent implementation (the audit trigger). S1B builds neither trigger |
| **I18b** runtime equality against `reservation.amount` | **OPEN** | Construction half proven through the port; no reservation is taken |
| **I18d** settlement tolerance | **OPEN** | No settlement path |
| **I42** database uniqueness | **OPEN** | No effect table in S1B |
| **I8** | **OPEN**, as `37 §2` S1 already records for the whole slice | No vendor side |

---

## 4. The S1A suite, unchanged

No file under `src/kernel/exposure/` or `src/db/` was edited by S1B. No migration was
added. `source-rules.test.ts` rule 4 asserts that the canonicaliser's only import from the
exposure tree is `money.js`, and that the reservation-handoff port opens no transaction and
takes no lock.

The two repository-wide files S1B did change are `tsconfig.json` and `eslint.config.js`,
both to exclude `tests/type-negative/**` — a directory whose files are **required** to fail
type checking. Neither change affects runtime behaviour or any authority quantity.

---

## 5. One observed defect, in the S1A test harness, NOT repaired by S1B

**`tests/integration/exposure/vc-s8-realised-standing-atomicity.test.ts` → "no
interleaving exposes headroom acquirable without the `window_balance` lock" is
load-sensitively flaky.** Observed **3 failures in 14 runs**. All three were under machine
load, clustered in three consecutive runs made during and immediately after a full-suite
run. The other 11 runs passed — eight consecutive isolated runs on an idle machine, and a
final clean full-suite run of 31 files and 357 tests.

**It is a race in the test harness, not in production code.** The case runs:

```ts
await conductor.step('recon', POINT.AFTER_BEGIN);   // releases the reconciler
await conductor.step('auth',  POINT.AFTER_BEGIN);   // releases the authorisation
await conductor.step('recon', POINT.AFTER_WRITE);   // waits
```

`Conductor.release` resolves a promise; it does not wait for the released participant's
next statement to reach the database. So between the first and second lines there is no
barrier guaranteeing the reconciler has taken the `window_balance` row. When the
authorisation wins that race it parks at `AFTER_LOCK` **holding the row**, the reconciler
blocks on the lock and can never reach `AFTER_WRITE`, and the conductor's own 20-second
timeout fires. The recorded timeline of the failing run shows exactly that:

```text
arrive auth:AFTER_BEGIN
release recon:AFTER_BEGIN
resume  recon:AFTER_BEGIN
release auth:AFTER_BEGIN
resume  auth:AFTER_BEGIN
arrive  auth:AFTER_LOCK        <- the authorisation won the lock race
(timeout waiting for recon:AFTER_WRITE)
```

**The production property under test is not in doubt.** The same file's ORDERING A and
ORDERING B cases, which exercise the same interleaving with the same production code, pass
in every run — including the runs in which this case timed out. Nothing in `src/` is
implicated, and no authority quantity is involved.

**S1B does not repair it**, per the S1B mandate: *"Do not repair unrelated S1A behavior
inside S1B."* The repair is test-only — a barrier between the reconciler's `AFTER_BEGIN`
and its lock acquisition, so the conductor can await lock ownership rather than assume it —
and it belongs in a bounded S1A.2 alongside the same latent race in ORDERING A and
ORDERING B.

This is the single reason the S1B result is **CONDITIONAL** rather than **PASS**.
