# S1F — Owner Resolution

The owner's dispositions on `S1F-C1`…`S1F-C9`, the evidence each was checked against, and
the two conformance additions the review required.

**Baseline reviewed:** `5d23faa` — the S1F implementation candidate.
**Predecessor baseline:** `5d289ab`.
**Architecture files modified by this pass:** **0**. Nothing under `docs/architecture/`
is touched, and no architecture amendment is recorded here or anywhere else in S1F.

Every disposition below ends in exactly one category:

* **DIRECT ARCHITECTURE REQUIREMENT**
* **OWNER CLARIFICATION — ACCEPTED**
* **IMPLEMENTATION DETAIL — NON-SEMANTIC**
* **DEFERRED RESIDUAL**
* **OWNER DECISION STILL REQUIRED**
* **DEFECT**

---

## 0. Summary

| Item | Category | Production change |
|---|---|---|
| `S1F-C1` write/gate order | OWNER CLARIFICATION — ACCEPTED | none |
| `S1F-C2` the resulting state transition | OWNER CLARIFICATION — ACCEPTED (classification **B**) | none |
| `S1F-C3` rate class reaches R without C′ | OWNER CLARIFICATION — ACCEPTED, **TEST SEAM ONLY** | none; **five tests added** |
| `S1F-C4` `I60`'s redundant index | IMPLEMENTATION DETAIL — NON-SEMANTIC; `I60` remains **PARTIAL** | none |
| `S1F-C5` append-only by trigger | IMPLEMENTATION DETAIL — NON-SEMANTIC | none |
| `S1F-C6` the database clock | DEFERRED RESIDUAL — `24 §3.1` remains **OPEN** | none |
| `S1F-C7` `ACOS-JCS-1` nulls | OWNER CLARIFICATION — ACCEPTED; `VC-A3` remains **OPEN** | none |
| `S1F-C8` module placement | IMPLEMENTATION DETAIL — NON-SEMANTIC | none |
| `S1F-C9` widened exactness lists | IMPLEMENTATION DETAIL — NON-SEMANTIC | none |

**No item resolved to DEFECT. No item resolved to OWNER DECISION STILL REQUIRED.**

No production source file and no migration changed in this pass. The only code added is
test code, and it only asserts properties the candidate already had.

---

## 1. `S1F-C1` — the write/gate order

### `OWNER CLARIFICATION — ACCEPTED`

The owner accepts the current logical order. For S1:

* `26 §7` determines authority/gate/denial precedence, so R occurs logically before T–V;
* all architecture-required local records still commit or roll back in ONE PostgreSQL
  transaction;
* the physical `INSERT` order inside that transaction is not itself an authority rule;
* `30 §5.1` continues to govern the single transaction, the lock discipline, the journal
  sequencing and the post-`COMMIT` audit/dispatch boundary.

**Production change: none.** The implementation already conforms.

**Evidence checked.** `localAuthorisation.ts` runs one `withSerialisationRetry` with one
`work` function; the lock order is `30 §5.2`'s, taken through the single acquisition site
`exposure/lockOrder.ts`, with `journal_counter` last among locks. The observable
consequence the owner preserved is asserted directly:
`tests/integration/authority/local-idempotency.test.ts` — *"a duplicate that ALSO lacks
headroom denies `WINDOW_EXHAUSTED`, because R precedes T"*. That test is unchanged and
still green.

The eleven-point kill matrix in `local-transaction-atomicity.test.ts` is what establishes
the single commit point, and it is unchanged.

---

## 2. `S1F-C2` — the local "resulting state transition"

### `OWNER CLARIFICATION — ACCEPTED` — classification **B, minimal representation**

`33 §1`: *"The exposure reservation, the authorisation decision, the effect journal row with
its gap-free sequence and local chain hash, and **the resulting state transition** commit or
fail together."*

### What S1F implemented, exactly

| Question | Answer |
|---|---|
| Exact table/entity | `effect` — `24 §3` K4's effect row (`src/db/migrations/0007__local_authorisation.sql`) |
| Exact old state | **none.** There is no prior row and no prior status |
| Exact new state | `status = 'AUTHORISED'`, or `status = 'AWAITING_APPROVAL'` where step S found an approval tier |
| Exact columns/values | one column, `status TEXT NOT NULL`, constrained by `effect_status_is_a_local_authorisation_status CHECK (status IN ('AUTHORISED','AWAITING_APPROVAL'))` |
| `INSERT` or `UPDATE` | **`INSERT`.** It is the row's initial value. `effect` carries an `acos_append_only()` trigger, so no `UPDATE` of the column is possible at all |
| Is it a `state_fact`? | **No.** No `state_fact` row is written anywhere in the transaction |
| Does it change external execution eligibility? | **No.** Nothing in `src/` reads the column to decide dispatch; there is no dispatcher, no outbox and no adapter |
| Does it change approval state? | **No.** The approval row's own `state` is `'PENDING'`, written separately, and the effect status merely *reflects* step S's requirement. The two cannot disagree — `26 §4`'s requirement decides both in one expression |
| Does it change reservation state? | **No.** `exposure_reservation` is untouched by it |
| Does it change effect status? | It **is** the effect status — as an initial value, not as a transition out of one |
| Does any later code read it? | **Once, and only for `26 §7` step V:** the prior-result `SELECT` in `localAuthorisation.ts` reads `e.status` to report `priorStatus` on a `DUPLICATE_PRIOR_RESULT`. No other reader exists in `src/` |
| Architecture passage relied on | `30 §5.1` item 3's ordering block, which names *"effect row (status = AUTHORISED)"* verbatim, on the line before *"state transition"* |
| Same-transaction evidence | kill point `AFTER_EFFECT_ROW` in `local-transaction-atomicity.test.ts`: after a forced abort at that point, read from a SEPARATE connection, `effect` is empty, `exposure_reservation` is empty, `authorisation_decision` is empty, `effect_journal` is empty, every `window_balance` term is `0.00` and `journal_counter.next_seq` is back to `1` |

### Why **B** and not **C**

`30 §5.1` names the status value in as many words, so the value itself is architecture-given.
What the architecture does not prescribe is the STORAGE REPRESENTATION of the separate
*"state transition"* line — and S1F does not invent one. It writes no new table, no
`state_fact`, no `effect_status_transition` row and no work-item transition. It records the
committed decision in the column `30 §5.1` already names, and the CHECK constraint forbids
every terminal status (`VERIFIED`, `FAILED`, `COMPENSATED`, `PRESUMED_EXECUTED`,
`UNRESOLVED_DISCREPANCY`), which are `24 §3` K4's post-dispatch set.

So the local authority surface is not widened: no new business or authority transition
exists that the architecture does not already describe, and nothing downstream is made
eligible for anything.

### Why **B** and not **A**

`30 §5.1` lists *"effect row (status = AUTHORISED)"* and *"state transition"* as SEPARATE
lines. S1F maps the second onto the first rather than committing a second artifact. That
mapping is a reading, not a transcription, so it is recorded as a clarification rather than
claimed as a direct requirement.

**Production change: none.** An owner ruling that the transaction must ALSO append a
`state_fact` or transition a work item would be additive — one more row inside the same
transaction and one more kill point — and is not taken here.

---

## 3. `S1F-C3` — the rate-class C2/C′ boundary

### `RATE C′ BOUNDARY — TEST SEAM ONLY / SAFE`

The seam is accepted as a bounded test/internal step-R seam. The review verified that it
creates no production authority bypass, and added the negative proof the owner required.

### Production entry points inspected

Every path in `src/` capable of reaching the S1F local-authorisation transaction:

| Entry point | Reachability | Constraint |
|---|---|---|
| `PreReservationPipeline.authoriseLocallyUnderLease` | the composed public method — the most public production-reachable S1F API | calls `evaluateUnderLease` and returns a non-`PRE_RESERVATION_PASS` outcome VERBATIM. The economics come from the module-scoped `SEALED_CONTINUATIONS` `WeakMap`, keyed by the frozen S1E result. Its own signature carries no `exposure`, no `ExposureBlock`, no `windowRefs`, no `Money`, no `RateClassFacts` and no `lineage` |
| `commitLocalAuthorisation` | the internal primitive | exactly ONE module in `src/` imports it — `authority/preReservation.ts` — and exactly one call site exists, guarded by the `PRE_RESERVATION_PASS` check and the sealed continuation |

Both facts are now asserted from the source, in
`tests/integration/authority/local-authorisation-boundary.test.ts` §*"the local
authorisation transaction has exactly ONE production entry point"*, because both are
refactor-reachable: a second importer, or a call that stopped being gated, would turn the
seam into a bypass without failing any behavioural test.

### The seven required proofs

1. **A worker/model cannot construct an arbitrary rate-class exposure and call step R.**
   There is no worker-facing surface in S1 at all — no HTTP, no RPC, no adapter and no
   dispatch — and the only production route into the transaction is the gated method above.
2. **A normal worker-originated rate action cannot bypass B, C, C2, C′, D–N or the accepted
   S1E `PRE_RESERVATION` boundary.** Proved at both doors, below.
3. **No exported/general production API accepts a caller-created economic structure and
   treats it as an authenticated S1E result.** `authoriseLocallyUnderLease` accepts no
   economic structure of any kind; it re-derives everything from the sealed continuation,
   which only it can read. `commitLocalAuthorisation` is the primitive, not a general API:
   one importer, one call site, gated.
4. **No `as`, structural cast, generic object, deserialised JSON or test-fixture type has
   become a runtime authority credential.** `authoriseLocallyUnderLease` accepts no
   `PreReservationQualified` parameter at all — it PRODUCES one by running the gates itself —
   so there is no place to present a forged result. Internally the continuation is held in a
   `WeakMap` keyed by object IDENTITY, so even a structurally identical object would retrieve
   nothing and the method would throw rather than proceed. `tests/type-negative/`'s
   `prereservation-as-dispatchable.ts` and `local-authorisation-as-dispatchable.ts` hold the
   compile-time half.
5. **The rate fixture is TEST-ONLY.** `rateFacts`, `rateExtension`, `RATE_CONSTRUCTOR_VERSION`
   and `authoriseRateLocally` all live in `tests/support/localAuthorisationFixture.ts`.
   Nothing under `src/` imports anything under `tests/`.
6. **`campaign.budget.set` remains NOT CANONICALISABLE in the real worker path.** Asserted
   through the live pipeline, not only at the registry unit level — see the negative proof.
7. **No implicit general `KERNEL_SERVICE` bypass is created.** S1F creates the
   `StandingRevocationAuthority` ENTITY and nothing else: `created_by = 'KERNEL'`, a
   singleton `action_class_selector`, an equality `resource_selector` and
   `per_action_max_monetary = 0.00`. No `'REVOKED'` write path and no
   `cessation_verified_at` write path exists in `src/`, asserted by source scan. When the
   revocation EXECUTION path is built it must obey its own C/C2/C′ semantics; S1F neither
   provides nor presumes an exemption.

### The negative proof, as required

Attempted through the most public production-reachable S1F API. Added as
`tests/integration/authority/rate-class-local-authorisation.test.ts` §*"THE RATE C′
BOUNDARY — `campaign.budget.set` is unreachable on the worker path"*.

**Door 1 — `enumerate_effects`.** `26 §11.2`: *"Any class with no registered constructor |
DENY: `NOT_CANONICALISABLE` at step C2"*. The call is made with a `context_spec` that
ADMITS the campaign resource, so the denial is the constructor registry's and not a scope
artifact. Result: `CanonicalisationDenied`, code `NOT_CANONICALISABLE`, detail
`NO_REGISTERED_CONSTRUCTOR`, and `enumeration_record` holds zero rows for the class — so no
`EnumeratedOptionSet` for it can exist in kernel state.

**Door 2 — the propose path.** `authoriseLocallyUnderLease` is called with a fabricated
selector — a plausible `(enumeration_id, option_id)` pair no kernel enumeration produced,
which is exactly the shape a forged rate step-R input would have to take. Result:
`DENIED`, step **`C′`**, code `SELECTOR_INVALID`. `stepsEvaluated` is `['D']` — the
pipeline's trace begins at D, B and C are `parseProposedIntent`'s and both PASSED because
the class IS in the closed catalogue — and it contains no `I`, `M`, `N`, `R`, `S`, `T`,
`U`, `V` or `W`. No grant was matched, no Cedar decision was taken, and no step of the
local sequence was entered.

**Persisted rows after the fabricated attempt**, read from PostgreSQL:

| Table | Rows |
|---|---|
| `exposure_reservation` | **0** |
| `standing_authorization` | **0** |
| `standing_window_exposure` | **0** |
| `standing_revocation_authority` | **0** |
| `authorisation` | **0** |
| `authorisation_window_instance` | **0** |
| `reservation_window_instance` | **0** |
| `approval` | **0** |
| `authorisation_decision` | **0** |
| `effect` | **0** |
| `effect_journal` | **0** |

And on both rate window instances: `reserved_monetary`, `standing_monetary`,
`presumed_monetary` and `realised_monetary` are all `0.00`, and `reserved_count` is `0`.

**Verdict: `RATE C′ BOUNDARY — TEST SEAM ONLY / SAFE`.**

**Production change: none.** No constructor for `campaign.budget.set` was implemented, and
none is implied. It remains an OPEN obligation.

---

## 4. `S1F-C4` — `I60`'s redundant partial index

### `IMPLEMENTATION DETAIL — NON-SEMANTIC` — `OWNER CLARIFICATION — ACCEPTED; I60 REMAINS PARTIAL`

Verified against the conditions:

* it creates no new transition — the index constrains nothing that is written today;
* it widens no approval authority — `approval.state` is written once, as `'PENDING'`, and
  no transition out of it exists in `src/`;
* the documentation continues to call `I60` **PARTIAL** — `S1F-result.md` §10 and §16, and
  `S1F-test-matrix.md` §4;
* the transition-state enforcement remains deferred with the transitions it constrains.

Installed as `26 §12.2` declares it, read back from `pg_indexes` in
`local-authorisation-boundary.test.ts`. **Production change: none.**

---

## 5. `S1F-C5` — append-only enforced by a trigger

### `IMPLEMENTATION DETAIL — NON-SEMANTIC`

Accepted as the S1 local enforcement mechanism, not as an architecture amendment. Verified
against the conditions:

* the architecture-required mutable exception is exactly scoped — `effect_journal`'s
  `effect_journal_immutable_except_mirrored_at()` permits `mirrored_at` and refuses every
  other column change and every `DELETE`, per `30 §5.2`'s *"advisory only"* and *"on first
  successful acknowledgement"*;
* no authority or economic field can be rewritten — `acos_append_only()` refuses every
  `UPDATE` and `DELETE` on `authorisation`, `authorisation_window_instance`, `effect`,
  `authorisation_decision`, and the refusal applies to the privileged role too;
* the trigger behaviour is exercised against real PostgreSQL, by issuing the statements and
  asserting `SQLSTATE ACS33`, not by reading the migration file;
* it claims no audit-plane independence, and no `VC-A3`/`I41`.

**Production change: none.**

---

## 6. `S1F-C6` — the database clock

### `DEFERRED RESIDUAL` — `24 §3.1`'s database-clock residual remains **OPEN**

Accepted for S1F in its current conservative form. No new external clock mechanism is
invented in this pass.

The timestamp source S1F uses, precisely:

| Use | Source |
|---|---|
| **window-instance derivation** | the COMPANY TIMEZONE (`company.timezone`) and the WINDOW PERIOD (`window_registry.period`) are read from the DATABASE; the INSTANT is the kernel-owned injected `Clock`. `referencedWindows.ts` states it, and there is no `windowInstance` parameter anywhere on the S1F boundary, so neither a caller nor a model can choose the instance a commitment lands in |
| **reservation creation** | `options.clock.now()`, sampled ONCE per call as `at` in `commitLocalAuthorisation`, and used for every `created_at` the transaction writes |
| **reservation expiry** | `reservationTtl(tier, at)` — `26 §12.1`'s `tier.sla + reaper_grace` arithmetic over the same `at`. Recorded on the approval row and read by nothing; the reaper, TTL expiry and `I32`'s starvation metric are all unbuilt |
| **approval timestamps** | the same `at` for `created_at`; `reservation_expires_at` as above |
| **standing-authorisation timestamps** | `created_at` from the same `at`; `expires_at` and `cessation_grace_hours` from the S1E-derived grant, and the revocation authority's `expires_at` is `grant expiry + cessation_grace` computed in `stepR.ts` |

**No `SELECT now()`, `CURRENT_TIMESTAMP`, `clock_timestamp()` or `transaction_timestamp()`
appears anywhere on the money path.** In production the injected clock is `systemClock` —
the control plane's wall clock, not PostgreSQL's — and the two can differ. Closing that
needs either a `now()` read on the money path or a declared clock-skew bound, and both are
S5's `I56` work.

**The residual is OPEN. It is not claimed closed anywhere. Production change: none.**

---

## 7. `S1F-C7` — `ACOS-JCS-1` and the null representation

### `OWNER CLARIFICATION — ACCEPTED` — `VC-A3` remains **OPEN**

**S1F uses the existing specification; it does not close `VC-A3`.**

* **Representation used.** `30 §5.3`'s declared rules, transcribed into the control
  database's `acos_jcs1_*` functions: a single `0x00` sentinel byte for null, a zero-length
  value for an empty string, per-column declared decimal scale as a string, RFC 3339 UTC
  with exactly six fractional digits, UTF-8 NFC, and a 4-byte big-endian length prefix on
  every field.
* **Any representation invented? NO.** The journal row kind's nullable columns are
  `approval_id` (text), `vendor_amount` and `forward_integral` (money). All three are
  covered by the existing rule, and owner clarification `S1B-C8` already closed the
  injectivity gap: ACOS canonical text admits no `U+0000`, and PostgreSQL `text` cannot
  store one, so no accepted value can imitate the sentinel.
* **No JSON-valued column was put in the row kind, deliberately**, so `30 §5.3`'s RFC 8785
  rule is not exercised and no SQL-side JCS implementation exists.

Retained as **OPEN** until the dedicated audit validation slice:

* `VC-A3` independent cross-implementation / cross-instance re-chaining;
* proof over structured fields;
* null versus empty representation at BOTH independent implementations;
* any generic nullable `bytes` / JSON literal-null integration issue not independently
  exercised.

The oracle in `journal-sequencing.test.ts` is a third READING of `30 §5.3`, hand-written in
the test file — not a second independent implementation. **No architecture edit. Production
change: none.**

---

## 8. `S1F-C8` — module placement

### `IMPLEMENTATION DETAIL — NON-SEMANTIC`

Accepted: no authority surface changed. Verified:

* **no model-facing export was added** — `26 §7`'s coarse projection is extended past R in
  `workerFacingLocalDenial.ts` and remains a projection; the accepted
  `PreReservationQualified` type is unchanged, and the adapter and idempotency key reach the
  transaction through the module-scoped `WeakMap` rather than through any result type;
* **no worker-facing authority field was added** — the S1F boundary carries no monetary
  parameter, no `windowInstances`, no `reservationAmount`, no `journalSeq` and no
  `approvalRequirement` override;
* **no alternate Cedar route exists** — one `cedar.isAuthorized` call site
  (`policy/cedarEngine.ts`), and `'PER_ACTION'` is producible only from the accepted policy
  module;
* **no alternate DB credential or path bypasses the effect-path discipline** — the
  transaction runs on `lease.client`; `BEGIN`/`COMMIT` appear only in `pool.ts`, `retry.ts`
  and the migration runner; `FOR UPDATE` against a money-path table is issued only by
  `exposure/lockOrder.ts`;
* **test helpers are not imported into production** — no file under `src/` imports anything
  under `tests/`; the three references to `tests/negative-controls/…` in `src/` are prose
  inside comments.

The accepted `tests/authority/authority-channel-attacks.test.ts` assertion — that
`src/kernel/authority/` contains no `window_balance`, `exposure_reservation`, `FOR UPDATE`,
`INSERT INTO` or `UPDATE ` — is unchanged and still green, because the money path is K4/K5
work in `src/kernel/authorisation/`. **Production change: none.**

---

## 9. `S1F-C9` — widened exactness lists

### `IMPLEMENTATION DETAIL — NON-SEMANTIC`

Accepted: strictly additive. Verified against `git diff 5d289ab`:

* **every previously enumerated fixture remains.** The `i21-type-boundary.test.ts` diff is
  two hunks — the title's *fourteen → fifteen*, and one sorted insertion of
  `local-authorisation-as-dispatchable.ts` with the reason in place. No entry was removed
  or reordered;
* **the new file exists because S1F legitimately added a new negative fixture** — the
  compile-time half of the S1F terminal boundary;
* **no previous negative source rule stopped executing.** No accepted source-rule test file
  changed at all; the two greps that flagged prose were satisfied by rewording COMMENTS in
  the NEW migration `0007`, and the rules' exemption lists are untouched;
* **the widening does not turn an exact allowlist into a broad glob.** The assertion is
  still `expect(files).toEqual([…])` over the sorted directory listing.

`authority-type-boundary.test.ts` gains one `describe` block owning the new fixture's
expected diagnostics. Every existing block is untouched. **Production change: none.**

---

## 10. Conformance additions made by this pass

Two test additions, no production change.

| File | Addition | Why it was required |
|---|---|---|
| `tests/integration/authority/rate-class-local-authorisation.test.ts` | `THE RATE C′ BOUNDARY` — 3 tests: door 1, door 2, and the persisted-row sweep | the owner's required negative proof for `S1F-C3`. Without it, "test seam only" rested on prose |
| `tests/integration/authority/local-authorisation-boundary.test.ts` | `the local authorisation transaction has exactly ONE production entry point` — 2 tests | the seam's safety depends on the primitive having one gated caller, which is refactor-reachable and was asserted nowhere |

Both assert properties `5d23faa` ALREADY had. Neither weakens an existing assertion, and
no accepted test was modified, deleted or skipped by this pass.

---

## 11. Obligations carried forward

Unchanged from `S1F-result.md` §16, and none of them is closed by this pass:

`VC-C2` journaling/quota half · `I52` CI half · `VC-C3` full span (**PARTIAL**) · `VC-C4`
approval-resume semantics · `R′` verify mode · `I51` runtime path · `I60` transition clause
(**PARTIAL**) · `VC-A3` cross-instance re-chaining · `ACOS-JCS-1` for `VC-A3` · `I18d`
settlement · the outbox · `I36` exclusive external claim · vendor idempotency/query ·
external exactly-once · reconciliation · the audit plane, transport, attestation, mirror,
anchor and two-sided diff (`I17`, `I17b`, `I17c`, `I17e`, `I41`, `I8`) · `O4` Cedar owner
signing · `I19` · symcc · real adapters · AI CEO/workers · additional catalogue classes and
a `campaign.budget.set` constructor · `KERNEL_SERVICE` standing-revocation EXECUTION · the
reservation reaper, TTL expiry and `I32` · `24 §3.1`'s database clock.
