# S1B Test Matrix

Every row names the architecture clause it tests, the file that tests it, and its status.
A row marked **OPEN** is not tested by S1B and is not claimed by S1B.

**Suite shape after S1B.1.** See §6 for the counts and for what the repair pass added.
S1A's 18 files and 157 tests still pass; S1B.1 changed one S1A **test harness**
(`vc-s8-realised-standing-atomicity.test.ts`, finding **S1A-H5**) and no S1A production
source.

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
| 9 | `$25.00 + $1.03` constructs `$26.03` | `vc-c1-refund-construction.test.ts`, `retained-fee-provenance.test.ts` | **PASS** |
| 10 | Dispatch monetary amount remains `$25.00` | `vc-c1-refund-construction.test.ts` | **PASS** |
| 11 | Wrong `$25.00` `total_exposure` negative control is caught | `negative-controls/retained-fee-escape.test.ts` | **PASS** |
| 12 | Idempotency key excludes rationale and sequencing | `idempotency-key.test.ts` | **PASS** |
| 13 | Semantic changes alter the idempotency key | `idempotency-key.test.ts` | **PASS** |
| 14 | Dispatch hash is deterministic | `hash-binding.test.ts` | **PASS** |
| 15 | Property insertion order cannot alter the canonical hash | `canonical-bytes.test.ts`, `hash-binding.test.ts` | **PASS** |
| 16 | Rationale-only mutation cannot alter the dispatch hash | `hash-binding.test.ts`, `rationale-non-authoritative.test.ts` | **PASS** |
| 17 | Existing S1A 157 tests remain green | full suite | **PASS**. The load-sensitive S1A harness race S1B found is **repaired in S1B.1** — see §5 and §6 |
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
| "a test constructing an `AuthorizationRequest` from a fifth `ProposedIntent` field must not compile" | real `tsc --noEmit` over `tests/type-negative/`, **six** negative files | `i21-type-boundary.test.ts` |
| the harness must discriminate | `positive-control.ts` must compile with **zero** diagnostics | `i21-type-boundary.test.ts` |
| the harness must not pass on the wrong error | every diagnostic must land on an `EXPECT_ERROR TSxxxx` line, and no diagnostic may appear on an unmarked line | `i21-type-boundary.test.ts` |
| the four permitted fields, and only those | `PermittedIntentFields`'s member list, read out of the source | `i21-type-boundary.test.ts` |
| nothing in `src/` parses rationale | source-reading rule over the whole `src/` tree | `source-rules.test.ts` rule 1 |

The compile-negative cases — six at S1B.1, **eight after S1B.2** (§7 adds
`catalogue-entry-into-context.ts` and `destination-into-option.ts`):

| File | Violation | Diagnostic |
|---|---|---|
| `rationale-into-request.ts` | `rationale` assigned into an authority-bearing field | TS2322 |
| `rationale-parsed.ts` | `.includes`, `.toLowerCase`, assignment to `string` | TS2339 ×2, TS2322 |
| `fifth-field-request.ts` | a request built from a fifth intent field | TS2353 |
| `intent-as-context.ts` | a `ProposedIntent` passed as the authoritative context | TS2345 |
| `model-amount-into-exposure.ts` | a model-supplied `Money` written into `exposure` | TS2322, TS2375 |
| `model-windows-into-request.ts` **(S1B.1)** | model-supplied `window_refs`, a model-supplied grant/window context, a model-supplied retained fee | TS2322 ×3 |

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
| a second amount, same authoritative fee | `$40.00 + $1.03 = $41.03` | hand-computed in the test | `vc-c1-refund-construction.test.ts` |
| **`DENY: PER_ACTION`** | — | — | **OPEN — Cedar slice** |

**S1B.1 note on the second-amount row.** It previously read `$40.00 → $1.46 → $41.46`,
produced by the withdrawn `S1B-C3` schedule. S1B knows no rate, so a larger refund does not
scale the fee: the amount is authoritative and so is the fee, and neither is derived from
the other.

### S1B-C3a — retained-fee provenance (S1B.1)

`tests/canonicalisation/retained-fee-provenance.test.ts`.

| Assertion | Expected | Oracle | Result |
|---|---|---|---|
| **A** — fixture: amount `$25.00`, authoritative fee `$1.03` | `total_exposure = $26.03` | hand-authored `2500n`, `103n`, `2603n` | **PASS** |
| the cost component names the RECORD it came from | `source_ref` is a `record:` reference, never a schedule | — | **PASS** |
| **B** — authoritative fee `$1.03 → $1.10`, option unchanged | | hand-authored `110n`, `2610n` | |
| dispatch `monetary_effect` | unchanged, `$25.00` | — | **PASS** |
| vendor payload, and its hash | unchanged | hand-authored | **PASS** |
| `option_id`, `semantic_option_digest` | unchanged — the fee is not a digest member (`26 §2.2`) | — | **PASS** |
| idempotency key | unchanged | — | **PASS** |
| `total_exposure` | `$26.03 → $26.10` | hand-authored `2610n` | **PASS** |
| reservation-handoff amount | `$26.03 → $26.10` | — | **PASS** |
| authority commitment over exposure | **changes** | — | **PASS** |
| `rationale` | irrelevant throughout | — | **PASS** |
| an absent fee for a non-cost-component-free class | throws; does not emit zero components | — | **PASS** |
| a fee in another currency | throws | — | **PASS** |
| a larger refund does not scale the fee | `$40.00 + $1.03 = $41.03` | — | **PASS** |

### S1B-C5a — `window_refs` provenance (S1B.1)

`tests/canonicalisation/window-ref-provenance.test.ts`.

| Required property | Test | Result |
|---|---|---|
| raw/model intent cannot supply `window_refs` | `MALFORMED / EXTRA_FIELD` at the top level; `SELECTOR_MALFORMED / EXTRA_FIELD` nested in the selector; the parsed intent has no window key; plus the compile-negative `model-windows-into-request.ts` | **PASS** |
| changing the authoritative grant/window context changes `window_refs` | narrowing narrows; an empty grant set empties it; a window outside catalogue scope is carried verbatim; the authority commitment moves with it | **PASS** |
| changing `rationale` cannot change them | injection-shaped rationale naming other windows leaves both the refs and the authority commitment identical | **PASS** |
| the catalogue alone cannot manufacture a different set | no catalogue entry carries a window field; the catalogue source names no window id; the constructor reads `context.grantWindows.windowRefs`; the same class/resource/option yields different sets | **PASS** |
| S1B claims no grant resolution | `resolvedBy` says `fixture:`; `grantWindows.ts` has no executable statement | **PASS** |

### `36 §0` — the oracle discipline and the negative control

| Rule | Test | File |
|---|---|---|
| the oracle imports nothing from `src/` | source rule; the oracle has **no imports at all** | `source-rules.test.ts` rule 3 |
| the oracle agrees with itself | its own arithmetic reproduces `103n`, `2603n` and `2610n` | `source-rules.test.ts` rule 3 |
| **S1B knows no fee schedule** (S1B.1) | no fee-schedule type, rate constant or rounding primitive on the S1B surface; no multiplication in the refund constructor | `source-rules.test.ts` rule 5 |
| **`window_refs` are not catalogue-derived** (S1B.1) | the catalogue declares no windows; no module reads a catalogue window field; the grant boundary resolves nothing | `source-rules.test.ts` rule 6 |
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

## 5. One observed defect, in the S1A test harness — found by S1B, REPAIRED IN S1B.1

**Status: REPAIRED.** The section below is the S1B finding as originally written, retained
because S1B found the race rather than hiding it and the record should show that. The repair
is `S1A-H5`, described in §6 and in `S1A-implementation-log.md` §20.

---

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

---

## 6. S1B.1 — the conditional gate repair pass

S1B was accepted **CONDITIONAL** on three local repairs. All three are done.

### Suite shape after S1B.1

| Area | Files | Tests |
|---|---|---|
| S1A, accepted baseline — production unmodified, one **test harness** repaired (S1A-H5) | 18 | 157 |
| S1B canonicalisation, including the two S1B.1 provenance files | 14 | 229 |
| S1B negative control (`retained-fee-escape`) | 1 | 7 |
| **Total** | **33** | **393** |

Measured, per area: `tests/canonicalisation` 14 files / 229 tests; `tests/integration`
13 / 130; `tests/negative-controls` 4 / 15; `spikes/durable-execution` 2 / 19.

Compile-negative fixtures: **six** negative files plus the positive control, compiled as a
real `tsc --noEmit` project.

### Repair 1 — VC-S8 deterministic ordering (S1A-H5)

**Test-harness only. No production money-path source changed.**

| Requirement | Result |
|---|---|
| rendezvous at ACTUAL reconciler lock ownership, not `AFTER_BEGIN` | `AFTER_LOCK` announced after `SELECT … FOR UPDATE` returns |
| applied to every case sharing the race | `ORDERING A`, the over-commit case, and `ORDERING B`'s reconciler side |
| existing hook machinery reused | `Conductor` / `POINT.AFTER_LOCK`, and the one declared `acquireMoneyPathLocks` helper |
| ≥25 consecutive repetitions, zero harness timeouts | see `S1B-result.md` §S1B.1 |
| real `40001` still observable where expected | the authorisation still retries through `withSerialisationRetry` after the reconciler commits |
| no real `40P01` on the correct lock-order path | `lock-order.test.ts` VC-L2, unchanged |
| reversed-order `40P01` negative control retained | `lock-order.test.ts`, unchanged |

### Repair 2 — the invented refund fee schedule removed

| Requirement | Result |
|---|---|
| `S1B-C3` marked **WITHDRAWN**, history retained | `S1B-owner-clarifications.md` |
| `S1B-C3a` in force — kernel-owned authoritative amount, fixture `$1.03`, no schedule | `authoritativeCost.ts` |
| fee **not** moved into `ProposedIntent`, not model-controlled, no real processor fetched | `model-windows-into-request.ts`, `intent-boundary.test.ts` |
| discriminating tests A and B | `retained-fee-provenance.test.ts`, 14 tests |
| every passage implying a universal `2.9% + $0.30` schedule updated | production, tests and docs; asserted by `source-rules.test.ts` rule 5 |
| the architecture-declared refund `semantic_option_digest` untouched | `refund-semantic-digest.test.ts`, unchanged |

### Repair 3 — `window_refs` provenance

| Requirement | Result |
|---|---|
| `S1B-C5` marked **SUPERSEDED**, history retained | `S1B-owner-clarifications.md` |
| `S1B-C5a` in force — kernel-owned grant/window-resolution boundary | `grantWindows.ts` |
| canonicalisation stays separated from policy; no Cedar added | `grantWindows.ts` has no executable statement; the tree still fails on the token `cedar` |
| the four required proofs | `window-ref-provenance.test.ts`, 14 tests |
| catalogue can no longer be read as a grant set | `ActionCatalogueEntry.declaredWindows` **removed** |

### Deliberately unchanged

`S1B-C4` (counterparty `null` for `refund.create`, governed by customer novelty / `P4a`
rather than counterparty novelty) was **not** revisited. `S1B-C1`, `S1B-C2`, `S1B-C6` and
`S1B-C7` stand as written. §3's gate table is unchanged: **VC-C1 remains PARTIAL**.

---

## 7. S1B.2 — the independent implementation review repair pass

Eight findings from an independent code review of the S1B/S1B.1 repository. This section
adds the tests; §2's existing rows are unchanged except where noted.

### Suite shape after S1B.2

```text
tests/canonicalisation/           19 files
tests/negative-controls/           4 files  (retained-fee escape + the three S1A controls)
tests/type-negative/               9 files  (1 positive control + 8 negatives)
tests/integration/                12 files  (S1A, untouched)
spikes/durable-execution/          2 files  (ADR-IMP-002; kill point 7 repaired)

npm test                          38 files, 490 tests, all passing
```

### Finding 1 — canonicalisation input cohesion

`tests/canonicalisation/canonicalisation-cohesion.test.ts`

| Relationship corrupted | Fails how | Assertion |
|---|---|---|
| `resource_ref` / resolved resource | throws | `intent resource_ref … is not the resolved resource` |
| option / resolved resource | denies | `SELECTOR_INVALID` / `OPTION_RESOURCE_MISMATCH` |
| option action class / intent action class | denies | `SELECTOR_INVALID` / `OPTION_ACTION_CLASS_MISMATCH` |
| option currency / ledger currency | throws | `denominated in EUR, not the ledger currency USD` |
| `reason_code` / `reason_code_scope` | denies | `SELECTOR_INVALID` / `REASON_CODE_SCOPE_MISMATCH` |

Structural properties the suite also asserts:

* **exactly one relationship per case** — every other relationship is left intact, so no case
  can be passing because a different one failed first;
* **a positive control** — the ordinary VC-C1 fixture canonicalises through the same
  instrumented registry;
* **fail closed before an effect is emitted** — the registered constructor is wrapped in a
  call counter and every failing case asserts it never ran;
* **the throw cases are not denials** — a coarse model-visible category for a condition no
  `ProposedIntent` can produce would be a misreport;
* **the table is complete and has no duplicate row.**

Plus the S1B-C6a pair sweep: every reason code is **accepted** against an option declaring its
own scope, and **refused** against one declaring a different scope, checked against
`VC_C1_REASON_CODE_SCOPES` in the oracle, which imports nothing from `src/`.

### Finding 1B — the action catalogue entry is not context

`tests/canonicalisation/catalogue-entry-provenance.test.ts` ·
`tests/type-negative/catalogue-entry-into-context.ts`

| Property | Test |
|---|---|
| the context type declares no catalogue entry field | structural, on `types.ts` |
| the shared fixture has no override that could supply one | structural, on the fixture |
| nothing in the canonicaliser reads one off the context | source rule over the whole package |
| the canonicaliser reads `ACTION_CATALOGUE[intent.actionClass]` | source rule |
| a refund cannot acquire `campaign.pause`'s recoverability | behavioural |
| … nor its value_direction, adapter or method | behavioural |
| the four fields differ between the two classes | **discrimination check** — without it the four rows above would be vacuous |
| the catalogue and each row are frozen; each row names its own class | structural |
| the substitution does not compile | `tsc --noEmit`, TS2353 |

### Finding 2 — the refund policy operands survive onto `selected_option`

`tests/canonicalisation/selected-option-projection.test.ts`

| # | Property | Test |
|---|---|---|
| 1 | `lineRefundableRemaining` reaches the request's selected option | `$40.00` recorded |
| 1 | the projection carries every operand `26 §8` reads | exact key set asserted |
| 2 | amount and instrument agree with the canonical parameters | identity comparison, not equality of copies |
| 2 | the recorded amount is also the dispatched vendor amount | I18a's operand |
| 3 | changing only the refundable remaining changes the recorded state | `$40.00 → $18.00` |
| 3 | and the mutation is decision-relevant | `40 >= 25` permits, `18 >= 25` does not |
| 4 | changing only the refundable remaining does NOT change `option_id` | `option_id` and digest identical |
| 4 | the vendor effect is byte-identical | payload, payload hash, idempotency key, exposure |
| 4 | **contrast** — a declared digest member DOES move `option_id` | without it, row 4 is satisfiable by an id that never moves |
| 5 | rationale cannot affect any recorded field | two rationales, one recorded option; length is not an operand either |

### Finding 3 — no independently mutable destination

`tests/canonicalisation/destination-provenance.test.ts` ·
`tests/type-negative/destination-into-option.ts`

| Property | Test |
|---|---|
| no destination field on the option, the parameters, the recorded option or the payload | key inspection on all four |
| no executable line in the canonicaliser names one | source rule |
| the semantic param digest names none, and still covers what it should | source rule with a non-vacuity check |
| the payload's destination IS the parent transaction and instrument | behavioural |
| changing either moves `option_id` | so no destination dimension is unbound |
| every vendor parameter is identity-bearing, with none left over | exact key set, cross-checked |
| a destination on the wire denies `MALFORMED` / `EXTRA_FIELD` | the architecture rule retained |
| prose naming a destination changes nothing dispatched | injection control |
| no independent destination compiles | `tsc --noEmit`, TS2353 ×2 |

**Withdrawn from §2:** the `idempotency-key.test.ts` row *"a different destination
instrument"*. It treated the destination as an independent effect dimension, which is the
defect finding 3 removes.

### Finding 4 — canonical-byte negative controls

`tests/canonicalisation/canonical-text-injectivity.test.ts`

| Case | Expected | Result |
|---|---|---|
| the hazard itself: two distinct lone surrogates under Node's UTF-8 encoder | identical bytes | demonstrated, `efbfbd` both |
| null vs empty string | **distinct**, both valid | PASS |
| `U+0000` in text | **rejected** | PASS |
| `U+0000` in a JSON string value / object key | **rejected** | PASS |
| lone high surrogate | **rejected** | PASS |
| a second, different lone surrogate | **rejected** | PASS |
| lone low surrogate | **rejected** | PASS |
| high surrogate followed by a non-low unit | **rejected** | PASS |
| valid supplementary character `U+1F600` | **accepted**, four real bytes | PASS |
| two distinct supplementary characters | hash differently | PASS |
| composed / decomposed NFC **values** | canonical as specified — hash alike | PASS |
| two object keys colliding under NFC | **rejected**, in either insertion order, at any depth | PASS |
| a single canonically-equivalent key | serialises in its **normalised** form | PASS |
| keys sorted **after** normalisation | order discriminated against the pre-normalised order | PASS |
| rationale holding a lone surrogate / `U+0000` | denies `MALFORMED` / `NOT_CANONICAL_TEXT` **before the seal** | PASS |
| `resource_ref`, `enumeration_id`, `option_id` | deny `NOT_CANONICAL_TEXT` at the wire | PASS |
| an ordinary rationale with a supplementary character | **accepted** | PASS |
| money scale, framing, boundary forging | unchanged | PASS |

### Finding 5 — no non-architecture request hash

`source-rules.test.ts` rule 7:

* no module in `src/` defines or names `authorizationRequestHash`,
  `authorizationRequestCanonicalHash`, `request_hash` or `requestHash`;
* no test imports one, so the concept is gone rather than merely unexported;
* `dispatchPayloadHash` and `dispatchPayloadCanonicalHash` **remain** — `26 §2.1` declares
  that field — and the request still records it. The rule is not a purge.

Rewritten to assert authoritative fields directly:

| File | Now asserts |
|---|---|
| `retained-fee-provenance.test.ts` | `total_exposure` moves; the cost component's amount, kind and `record:` source; the reservation offer moves; `dispatch_payload_hash` does **not** move; the same fee reproduces the same exposure exactly |
| `window-ref-provenance.test.ts` | `request.windowRefs` moves; and under a malicious rationale the offer, exposure, parameters, selected option and payload hash are all identical |

### Finding 6 — the core owns no per-class logic

`source-rules.test.ts` rule 8:

* `EffectCanonicaliser` imports no per-class digest and no `./constructors/` module;
* its executable code contains **no `refund`-specific identifier at all**;
* the per-class operations are reached as `registered.computeSemanticOptionDigest(option)`
  and `registered.assertInputCohesion(input)`;
* `RegisteredConstructor` declares exactly five members, so a new class must supply both new
  ones;
* the refund constructor owns `refundSemanticOptionDigest` and its
  `acos.semantic_option_digest.refund.create.v1` domain;
* `optionDigest.ts` keeps `computeOptionId` and names no class;
* no generic fallback constructor exists anywhere.

`registry.test.ts` is unchanged and still proves a class with no constructor denies
`NOT_CANONICALISABLE`, and `refund-semantic-digest.test.ts` still passes with no assertion
edited — the digest moved file, not fields.

### Finding 7 — kill point 7 (ADR-IMP-002 spike, not S1B)

`spikes/durable-execution/spike.test.ts`

| | Before | After |
|---|---|---|
| `invariantVerdict` | counted `dispatchCount > 1` as a weakened S1A invariant | counts only the application-transaction/checkpoint properties |
| kill point 7 | `expect(dispatchCount).toBeLessThanOrEqual(1)` | asserts realised delta once, coupling, journal sequence once, ceiling; **records** the dispatch count |
| the matrix | `dispatch=N` | `externalDispatchNote(o, concurrent)` — names a concurrent duplicate as KNOWN under S1A-H4 |
| sequential cases | exact-once dispatch asserted | **unchanged** — still asserted |
| the S1A-H4 negative control | forces and observes two dispatches | **unchanged** |

Kill point 7 additionally asserts `1 <= dispatchCount <= 2`, so a run in which neither
process reached the step cannot be recorded as evidence.

### Finding 8 — duplicate constructor-version input

`constructor-version.test.ts`

| Property | Test |
|---|---|
| both records are individually valid, and different | **positive control** — the ambiguity being refused is real |
| two records for one constructor id fail resolver initialisation | PASS |
| in either order | PASS |
| two identical records fail too | the rule is about the id, not about disagreement |
| different constructor ids coexist | the rule is not over-broad |
| it throws, and is not a `CanonicalisationDenied` | a build defect is not a model-visible category |
| no version history or storage was added | source rule |

### Repetition and determinism

| Gate | Requirement | Result |
|---|---|---|
| canonicalisation suite | 10 consecutive runs | **10 / 10**, 341 tests each |
| VC-S8 | ≥ 25 runs, no harness timeout | **25 / 25**, 0 timeouts |
| durable-execution spike | ≥ 10 runs after the kill-point-7 correction | **10 / 10** |

### Deliberately unchanged

The exact five-field parser · unknown-field rejection · the opaque rationale · `I21`'s real
compile-negative project · Ed25519 verification · the five declared digest fields ·
`$25.00 / $1.03 / $26.03` · S1B-C3a · S1B-C5a · `I18a`/`I18c` · the idempotency key ·
`dispatch_payload_hash` · full VC-C1 **PARTIAL** · the S1A suite (157/157) · no Cedar · no
enumeration · no adapter · no outbox.
