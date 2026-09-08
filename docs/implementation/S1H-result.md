# S1H — Result

**Verdict: PASS**, after the v1.3.3 owner-resolution pass.

The three-state mirror machine, the inversion, the authenticated and fresh corroboration
signal, the bounded owner override with its composition bound, `I56`'s provenance leg and
the deterministic pre-dispatch classifier were built, tested and closed in `b524637`. That
candidate was **PARTIAL** because three quantities the architecture needs were absent from
v1.3.2 and `§42` directed the affected parts to stop rather than guess. **The owner declared
all three under architecture package issue v1.3.3, and the three legs are now built:**

1. **The per-action approval floor** (`S1H-C1`) — `51 §3.7`: **USD 20.00**, compared
   **strictly** against `effect.request.exposure.total_exposure`. The caller-supplied boolean
   is REMOVED; the predicate is derived by trusted code.
2. **The mirror-lag and prolonged-unreachability thresholds** (`S1H-C10`) — `51 §3.8`:
   **PT15M** and **PT30M**, both inclusive at the threshold. The FULL-HALT POSTURE of
   `30 §5.1` item 5 is implemented, over every recoverability class including REVERSIBLE.
3. **`STORE_WRITE_REJECTED`'s derivation** (`S1H-C8`) — `30 §5.7.1a`: a closed
   ten-condition AUDIT-OWNED predicate over the semantic class
   `AUDIT_STORE_WRITE_UNAVAILABLE`, with quota saturation and every security or integrity
   failure excluded normatively.

**No unilateral control-side state can unlock relaxed authority**, which is the FAIL
condition, and it is proven over the whole cross-product with a discriminating control —
through the DECLARED operand now, rather than through a caller-supplied boolean.
**`OWNER DECISION STILL REQUIRED`: ZERO.** Dispositions in
`S1H-owner-resolution.md`; the questions as they were asked are unchanged in
`S1H-owner-clarifications.md`.

---

## 1. Baseline

| | |
|---|---|
| Required | `e47a437` |
| Actual at start | `e47a4375268b9fb953bafb93deb90c7fc5f9f09e` |
| Branch | `feature/s1h-mirror-state-machine`, created from `e47a437` |
| Worktree clean at start | yes |
| Baseline `npm run verify` | exit 0 |
| Baseline files / tests / passed / failed / skipped | 86 / 1204 / 1204 / 0 / 0 |
| Implementation commit | `ea7f60e02c3a6aff9a509616838710525126a147` — all source, migrations, tests and the four S1H documents |
| PARTIAL candidate | `b5246378b9bbe4f9f758c03cdc9447ab4dd801d7` — the documentation commit that closed the first pass |
| **v1.3.3 owner-resolution pass** | reviewed `b524637`; baseline re-verified before any edit at **104 / 1544 / 1544 / 0 / 0**, `npm run verify` exit 0 |
| — architecture commit | `e5ca7b1` — package issue **v1.3.3**: errata APF-01, MLT-01, FHT-01, SWR-01; gate conditions G1–G10; six seeded negative controls |
| — implementation commit | the `feat(s1h)` commit carrying the three completed legs, their migrations, their negative controls and their tests |
| — final commit | the `docs(s1h)` commit that adds this line and `§14`'s totals, and which cannot name its own sha. `git log --oneline -4` on `feature/s1h-mirror-state-machine` shows all four |
| Worktree clean at end | yes |
| `b524637` rewritten? | **NO.** Three commits sit on top of it |

---

## 2. Architecture

| | |
|---|---|
| Architecture | Operating Spine v1.3 — **unchanged** |
| Authoritative package issue | **v1.3.3** |
| Directory | `docs/architecture/v1.3.3/` — a NEW immutable package directory |
| `docs/architecture/v1.3.2/` modified? | **NO.** `git diff --stat` reports zero changed files and `git ls-files -s` hashes are unchanged. `v1.3.1/` likewise |
| Normative additions | new `30 §5.1a` (the three quantities, the boundaries, the FULL-HALT POSTURE, the override composition); new `30 §5.7.1a` (`STORE_WRITE_REJECTED`'s closed derivation, the semantic class, the exclusions); new `51 §3.7` and `§3.8`; new `50 §2` class 27; new `36` `VC-A2g` and `VC-A2h`. Edits: `30 §5.1` items 4–5, `30 §5.6`'s reachability table (two rows), `50 §2` class 3 and its counts, `22 §3.1`, `35 §12.1`, `36`'s `VC-A6` fixture, the registry's `§0` and `I63`'s operand block |
| Unrelated architecture changes | **none.** No mechanism introduced, no invariant added, removed, restated or weakened, no authority quantity moved, MAL unchanged, no Step ordering changed, no audit cadence changed |
| Mirror-state sources | `30 §5.1`, **`§5.1a`**, `§5.4`, `§5.5`, `§5.6`, `§5.7`, `§5.7.1`, **`§5.7.1a`**, `§5.7.2`, `§9.1`; `22 §3.1`; `24 §3` K10/K11; `25 §13`; `35 §12.1`; `36 §6`, `§9`, `§14`, `§15`; `50 §2` classes 3, 20, 24, 25, **27**; `51 §3.1`, `§3.6`, **`§3.7`**, **`§3.8`**, `§4.1`, `§5`; `37` S1; registry `I8`, `I17`, `I17e`, `I17f`, `I56`, `I63`, `§3` items 7/9/10; `phase2-v1.3-lower-severity-register.md` TA-08 |
| Conflicts with either mandate | none. Where a mandate's shorthand differs from the package, the package was followed and the difference recorded. Both of the owner-resolution mandate's STOP conditions (`§3`'s timer semantics, `§16`'s override-versus-halt question) were checked and **neither triggers** — the architecture states both, and the quoted text is in `S1H-owner-resolution.md §7` |
| Conflicts within the package | one, and it is an ambiguity rather than a contradiction: `30 §5.6`'s three entry conditions are not disjoint as written (`S1H-C2`). The stricter partition reading was taken, and `§17` below records that it is authority-equivalent for every precedence outcome |

---

## 3. What is CLOSED

| Item | Evidence |
|---|---|
| The three-state mirror machine, exactly `30 §5.6`'s names | `mirror-state-transitions.test.ts` |
| A control declaration alone reaches only the stricter state | `vc-a2-inversion.test.ts` + `vc-a2-self-declared-degradation.test.ts` (discriminating) |
| **`VC-A2`'s inversion, over all 24 operand combinations** | `vc-a2-inversion.test.ts` |
| `VC-A2`'s corroboration relaxation — only the declared rows relax | same |
| `VC-A2d` — the signal contract, all eight adversarial artifacts, real Ed25519 | `corroboration-signal-contract.test.ts` |
| `VC-A2d` — `30 §5.6`'s reachability table, every row | `vc-a2d-signal-authenticity.test.ts` |
| Staleness and replay cannot unlock authority | `vc-a2d-signal-replay.test.ts` (discriminating) |
| The signal is audit-owned; every forbidden operation refused | `audit-signal-ownership.test.ts` |
| `VC-A2e` — the override, every declared bound | `vc-a2e-override.test.ts` |
| `VC-A2f` / `I63(b)` — composition cannot become unbounded | `vc-a2f-override-composition.test.ts` + `...-unbounded.test.ts` (discriminating) |
| `I63(a)` — the per-override bound, including the concurrent final-count race | `vc-a2e-override.test.ts`, `override-count-race.test.ts` |
| The override changes no ceiling — schema, source, cryptography, behaviour | `override-cannot-widen-ceilings.test.ts` |
| The second-approver rule, including the shared-credential attack | `vc-a2e-override.test.ts` |
| `I56` — clock provenance; a model cannot create a clock | `i56-clock-provenance.test.ts` |
| `I17f(b)` — `ATTESTATION_DIVERGENCE`, attributing nothing | `i17f-attestation-divergence.test.ts` |
| `VC-A6` — the precedence is an ordered first-match list | `first-match-order.test.ts` (discriminating) |
| `VC-A3` extended to the three new row kinds, both planes | `mirror-journal-rows.test.ts` |
| Durability and `§38`'s crash/restart cases | `mirror-state-durability.test.ts` |
| `§29` — no canonical-format regression; no JSON column on either plane | `mirror-journal-rows.test.ts` |
| **`S1H-C4`** — an S1G immutability hole found and closed | `mirror-journal-rows.test.ts` |
| **`S1H-C1`** — the approval floor DERIVED from `51 §3.7`'s `$20.00` against `total_exposure`; the boolean escape hatch removed | `dispatch-precedence-approval-floor.test.ts`, `degraded-mode-thresholds.test.ts` |
| **`S1H-C10`** — `30 §5.1a`'s FULL-HALT POSTURE, every class, both boundaries, the timer's declared start and every declared non-reset | `full-halt-posture.test.ts` (discriminating) |
| **`S1H-C10`** — the mirror-lag CRITICAL condition, and all four of its declared non-effects over the durable tables | `mirror-lag-critical.test.ts` |
| **`S1H-C8`** — `STORE_WRITE_REJECTED`'s closed audit-owned derivation, its closed PostgreSQL mapping, its four exclusions and its POSITIVE control | `store-write-availability.test.ts` (discriminating) |

---

## 4. `VC-A2` — the inversion, stated as the owner asked

**Does a unilateral control-side stall declaration EVER increase dispatch eligibility?**

# NO.

Proven over the full cross-product — 3 recoverability classes × clock-bearing ×
above-floor × recorded-approval = 24 combinations, in each of the 3 states, 72 rows —
against a hand-authored disposition table that imports nothing from `src/`. Not one row
becomes more permissive in `UNCORROBORATED_STALL` than in `NORMAL`, and the suite
additionally asserts that at least one row becomes STRICTLY stricter, so the proof is not
vacuous.

**v1.3.3: the above-floor dimension is now the DECLARED OPERAND.** `OracleCase` carries
`total_exposure` as a decimal literal on either side of `51 §3.7`'s floor, and the oracle
derives the predicate from its own hand-transcribed `2000n`. So the same 72 rows now prove
the DERIVATION as well as the table, and `dispatch-precedence-approval-floor.test.ts`
additionally counts the rows that reach row 2 and fails if none does. **The hand-authored
table's row-by-row logic is otherwise unchanged**, which is `§13`'s requirement.

**The model and the caller cannot influence it.** `PrecedenceOperands.aboveApprovalFloor` is
GONE; `totalExposure: Money` replaces it; `isAboveDegradedApprovalFloor` is the one
comparison site in `src/`; and no TEST-ONLY seam re-admits the boolean — asserted as a source
property over executable lines, together with the absence of `vendorAmount`, `vendor_amount`,
`dispatchAmount` and `rationale` from the classifier's executable lines.

Representative rows (the full 72 are enumerated by the suite):

| Case | `NORMAL` | `UNCORROBORATED_STALL` | `CORROBORATED_DEGRADED` |
|---|---|---|---|
| IRRECOVERABLE, any clock/approval | HALT (row 1) | HALT (row 1) | HALT (row 1) |
| above floor, no clock, unapproved | HALT (row 2) | HALT (row 2) | HALT (row 2) |
| COMPENSABLE, live clock, approved | DISPATCH (row 3) | **SUSPEND (row 3)** | DISPATCH + tag (row 3) |
| COMPENSABLE, live clock, above floor, approved | DISPATCH (row 3) | **SUSPEND (row 3)** | DISPATCH + tag (row 3) |
| COMPENSABLE, discretionary | SUSPEND (row 4) | SUSPEND (row 4) | SUSPEND (row 4) |
| COMPENSABLE, discretionary, approved, above floor | SUSPEND (row 4) | SUSPEND (row 4) | SUSPEND (row 4) |
| REVERSIBLE | DISPATCH (row 5) | DISPATCH (row 5) | DISPATCH + tag (row 5) |
| REVERSIBLE, above floor, unapproved | HALT (row 2) | HALT (row 2) | HALT (row 2) |

**Which rows relax in `CORROBORATED_DEGRADED`, relative to `UNCORROBORATED_STALL`:** row 3
only, and only when clock-bearing and COMPENSABLE. Nothing else. `CORROBORATED_DEGRADED`'s
dispositions are otherwise IDENTICAL to `NORMAL`'s, which is `36 §6`'s "as `NORMAL`, with
every dispatch tagged".

---

## 5. The corroboration signal

| | |
|---|---|
| Audit source | `audit_journal` holdings via the ACCEPTED `evaluateTransportCompleteness`, plus the audit store's own reachability probe. **No control read, no `mirrored_at`, no caller boolean, no model claim** |
| Fields | `30 §5.7.1`'s ten, verbatim |
| Signature | **real Ed25519** (`node:crypto`), 64 bytes, over `ACOS-JCS-1` canonical bytes of the nine non-signature fields |
| Key | generated on the audit-plane side by the harness; the private half is a parameter of `src/audit/` only, the public half a parameter of the control-side verifier. **No file outside `src/audit/` can produce a signature** — asserted as a source property |
| Canonicalisation | audit SQL (`audit_jcs1_*`), control TypeScript, and a hand-authored oracle. All three agree; the oracle judges |
| Bytes bound to fields | `audit_mirror_signal_bind_bytes` refuses a row whose `signed_bytes` are not the store's own construction. **The control plane never reads `signed_bytes`** |
| `max_age` | **5 minutes**, transcribed from `30 §5.7.1`, and asserted `< cadence × k = 15 minutes` as arithmetic |
| Transport | pull only, one method, over `acos_audit_signal_reader` — SELECT on two tables and nothing else |
| Freshness boundary | just inside → accepted; **exactly at `observed_at + max_age` → REFUSED** (the second conjunct is strict); one ms past → refused; future-dated → refused (`S1H-C6`) |
| Replay | a consumed `signal_id` cannot re-enter, at the application AND at the primary key; a genuine signal replayed at 4× `max_age` is `SIGNAL_STALE`, where the unsafe machine enters the relaxed state |
| Wrong signer | `SIGNAL_SIGNATURE_INVALID`. A substituted public key makes the state **unreachable rather than forgeable** |
| Transport failure | `UNAVAILABLE`, which is treated exactly as "no signal". Proven against a real closed TCP port as well as an injected partition |

**PARTIAL on this item:** the HTTP endpoint (`GET /audit/v1/mirror-input-stall`), the
bearer-credential issuer and the provisioned signing key are OPEN — `30 §5.7.1`'s
Provisioning note puts them outside the S1 build.

**`STORE_WRITE_REJECTED` is now DERIVED** (`S1H-C8`, v1.3.3). `30 §5.7.1a`'s closed
ten-condition predicate, over the semantic class `AUDIT_STORE_WRITE_UNAVAILABLE`, from the
audit plane's own append-only `audit_store_write_failure` observations and nothing else. The
PostgreSQL mapping is a closed three-code allowlist (`53100`, `58030`, `25006`), each
justified at the point of implementation, transcribed independently in `A0004`'s handler and
asserted against the DEPLOYED function definition; twenty-one codes are excluded by name and
everything else FAILS CLOSED. **Quota saturation cannot emit it**, and neither can a
collision, a canonical mismatch, a hash mismatch, a chain break or an unknown error.

---

## 6. The override

| | |
|---|---|
| Entity | `degraded_mode_override`, `30 §5.7.2`'s field set |
| Owner authority | a real Ed25519 signature by an ACTIVE `kind = 'OWNER'` principal over the grant's canonical bytes, verified against `principal_key`. **No `isOwner` parameter exists anywhere in the slice** |
| Grantable classes | `{COMPENSABLE, REVERSIBLE}` — `IRRECOVERABLE` has no grant path, structurally |
| Grantable rows | `{3, 4}` — rows 1 and 2 are unreachable |
| Max duration | 24 hours; 24 h admitted, 24 h + 1 ms refused |
| Count cap | 5 per override; zero / first / at cap / one above cap all asserted |
| Monetary cap | $50.00 per override |
| Composition bound | `I63(b)`: 3 overrides, 72 hours, 8 effects, $100.00 per rolling 30 days, over **every** candidate window |
| Second approver | required from the 2nd override in 30 days; distinct row, distinct kind, **distinct registered key** |
| Expiry target | re-derived from the underlying operands. **`NORMAL` is unreachable from an expiry**, because expiring an override does not close a declaration |
| Journal representation | `DEGRADED_MODE_OVERRIDE_EVENT`, one row per event, all seven of `30 §5.7.2` item 7's events |
| **Ceiling mutation possible?** | **NO.** No schema field, no foreign key, no source statement, and a maximum override leaves every ceiling, every `I3` term, the grant set and `MAL_monetary` = `$300.00` byte-identical |

**`51 §3.6`'s honest limitation is preserved rather than engineered around.** The fixture
registers exactly ONE OWNER-tier principal by default, so overrides 2 and 3 are
structurally unavailable and the practically reachable escape is 24 hours, 5 effects and
$50.00. The composition tests register a second owner EXPLICITLY, which is the owner
decision `51 §3.6` describes.

---

## 7. Override abuse tests — `§31` / `VC-A2d`

| Attack | Vulnerable result | Production result | Discriminates? |
|---|---|---|---|
| Repeatedly recreate maximum-valid overrides | 10 admitted → 240 h, 50 effects, $500.00; 60 → 1440 h | 3 admitted; the 4th refused `I63_COMPOSITION_COUNT` | **YES** |
| Same approver as "second" approver | — | `override_second_approver_is_distinct` | n/a (DB) |
| Same credential under another display name | — | `OVERRIDE_SECOND_APPROVER_SHARES_CREDENTIAL` | n/a (DB) |
| Rotate recoverability / action classes | admitted (class-blind aggregate absent) | refused; the aggregate is class-blind | **YES** |
| Expire then immediately recreate | admitted | refused; every candidate window is checked | **YES** |
| Forged or stale signal combined with an override | relaxed state entered | the signal is refused before any override is consulted | **YES** |
| Override naming `IRRECOVERABLE` | — | `OVERRIDE_SCOPE_OUTSIDE_GRANT_PATH`, and a CHECK | n/a |
| Override naming rows 1, 2 or 5 | — | same | n/a |
| Override attempts to modify a ceiling | — | no field, no FK, no statement, and the signature covers the scope | n/a |
| A model requests an override | — | `OVERRIDE_PRINCIPAL_NOT_OWNER` | n/a |
| Widen the grant after the owner signed | — | `OVERRIDE_SIGNATURE_INVALID` | n/a |
| Reset a consumed counter | — | `OVERRIDE_CONSUMPTION_DECREASED` | n/a |
| Delete an override to refund the aggregate | — | `APPEND_ONLY_TABLE_degraded_mode_override` | n/a |

---

## 8. `I56` / clocks

| | |
|---|---|
| `source_record` kinds | `PROCESSOR_DISPUTE_WEBHOOK`, `RETAINED_RAW_INBOUND_MESSAGE`, `CARRIER_OR_REGULATOR_RECORD`, `SIGNED_OWNER_ACTION` — `I56`'s own closed set; all four asserted to resolve and to back a clock |
| Model influence | **NONE.** `createStatutoryClock` accepts a `sourceRecordId` and nothing that could stand in for one. No `reason`, `classification`, `confidence`, `rationale`, `statuteGuess` or `hasClock` parameter exists |
| Negative control | a triage worker classifying 50 cases as clock-bearing refunds creates **ZERO** clocks, and nothing is clock-bearing afterwards |
| Enforcement | TWO mechanisms — the application refusal and the NOT NULL foreign key — each exercised on its own |
| Grade | `retained_source_record` admits `provenance = 'RECORD'` and nothing else, so an OBSERVATION, CLAIM or `DECISION_DELEGATED` fact is UNSTORABLE rather than merely rejected |
| Liveness | `closed_at IS NULL` and `now < deadline_at`; asserted at, inside and past the deadline |
| Uniqueness | **DEFERRED.** TA-08 schedules "at most one live clock per `(case_ref, statute)`" as **LATER MVP SLICE (S5)**, with "`I56`'s schema leg is S1 and is unaffected" |
| Duplicate handling | **DEFERRED** with the same citation (source-content collapse) |
| Volume / anomaly bound | **DEFERRED** with the same citation |
| Status | **CLOSED for the schema and provenance leg. The volume leg is DEFERRED BY THE ARCHITECTURE**, and the suite asserts the current behaviour — two live clocks on one `(case_ref, statute)` ARE admitted — so the residual is recorded rather than implied |

---

## 9. `I17f`, clause by clause

| Clause | Kind | Status | Why |
|---|---|---|---|
| **(a)** no `DISPATCHED_UNMIRRORED` without a covering published stall interval | INVARIANT | **OPEN** | quantifies over dispatched effects. None exist; `§35` forbids manufacturing them. **What IS delivered:** the audit plane's own record of the intervals it published, immutable and audit-owned, which is (a)'s other operand |
| **(b)** a published stall with no journaled declaration raises `ATTESTATION_DIVERGENCE` | DETECTOR | **CLOSED** | both operands exist. All four of `§13`'s cases asserted; the finding attributes NOTHING, and the suite asserts that it says so |
| **(c)** every effect dispatched inside a published interval carries the tag | INVARIANT | **OPEN** | same reason as (a) |
| the STRUCTURAL rule — a future dispatch outside `NORMAL` must carry the tag | — | **CLOSED as a deterministic property** | `requiresUnmirroredTag`, which `§35` explicitly permits. It tags nothing, because nothing is dispatched |

**The (b)/detector distinction is preserved.** Registry `I17f` reclassified (b) as a
DETECTOR under TA-09 *"because its violation raises the condition that satisfies it"*. The
implementation refuses nothing and halts nothing, and
`i17f-attestation-divergence.test.ts` asserts that no authority changes when it fires — an
implementation that refused here would halt the company every time the push path went down.

---

## 10. Crash / restart — durable-state cases

| Case | Result |
|---|---|
| Crash after the declaration, before any signal arrives | reconstructs `UNCORROBORATED_STALL` |
| Crash after a valid signal is persisted, before the state row | reconstructs `CORROBORATED_DEGRADED` from the operands; the cache was never the authority |
| Failure during the transition transaction | neither the journal row nor the corroboration survives |
| Restart while the held signal is stale | reconstructs `UNCORROBORATED_STALL` |
| Restart with an active bounded override | the override is read from PostgreSQL on every classification |
| Restart after override expiry | `EXPIRED`; the state re-derives to the restrictive one |
| Restart after the count cap is exhausted | `EXHAUSTED`; `activeOverrideOn` returns `null` |
| Two concurrent declarations | impossible — `mirror_declaration_one_open_per_company` |

**No process-local mirror state exists.** There is no module-level `let` or `var` in any
S1H source file, asserted by inspection and structurally true: every function takes a pool
or a client.

---

## 11. PostgreSQL / concurrency

| | |
|---|---|
| Real-PostgreSQL S1H test files | **13 of 18.** The other five are pure — the four under `tests/mirror/` and `vc-a2-self-declared-degradation.test.ts` — and need none |
| Dual-PostgreSQL S1H test files | **6** — `vc-a2d-signal-authenticity`, `audit-signal-ownership`, `i17f-attestation-divergence`, `mirror-journal-rows`, `no-dispatch-boundary`, `vc-a2d-signal-replay` |
| Final-count race | two real backends, barrier-driven at the `FOR UPDATE` boundary. Exactly one of two concurrent claims succeeds; ten claimants against a cap of 5 yield exactly 5; the ledger reads 5 |
| The race is REAL | the second claimant's lock wait is observed in `pg_locks` as an ungranted `transactionid`/`tuple` wait while the first holds the row |
| Backstop under the lock | `override_effects_within_cap` and `override_monetary_within_cap` refuse an over-cap counter even with the application check bypassed |
| Repeated overrides | the constraint trigger evaluates every candidate rolling window in the granting AND the dispatching transaction |
| Journal evidence | every mirror transition and every override event is an `effect_journal` row on the same counter, the same chain and the same transport; the chain links across all five row kinds |
| In-memory mutexes | **none.** No mock database, no simulated lock. The one injected delay is a test-only barrier hook, which is `36 §14`'s own prescription |

---

## 12. No dispatch — explicit confirmation

| | |
|---|---|
| External call | **NO** — no `globalThis.fetch`, no `node:http`/`https`/`net`/`dgram`, no axios/undici, no WebSocket anywhere in `src/` |
| Adapter | **NO** — no adapter module import, no `callAdapter`, no `.dispatch(` |
| Outbox | **NO** — no outbox table, no outbox claim |
| External-effect exclusive claim | **NO** — `I36` unbuilt; the override outcome is named `ALLOWANCE_TAKEN` so the literal `CLAIMED` remains the outbox's alone |
| `DISPATCHED` state created | **NO** — no `'DISPATCHED'` literal, no `dispatched_at` column, no `DISPATCHED` member in any CHECK on `effect`, and zero effect rows in the S1H suite |
| `DISPATCHED_UNMIRRORED` tag written | **NO** — `requiresUnmirroredTag` is a boolean on a decision object |
| Vendor read / `I8` sweep | **NO** |
| External anchor (`I17b`) | **NO** |
| Fake dispatch rows manufactured | **NO** |
| Architecture package modified | **NO** for `v1.3.1/` and `v1.3.2/`, which are byte-identical. `v1.3.3/` is a NEW package directory, which is the convention v1.3.1 established |
| Fake dispatch created by the FULL-HALT POSTURE | **NO** — the posture only ever reduces a disposition to `HALT`, and `full-halt-posture.test.ts` asserts monotonicity toward `HALT` over `PERMISSIVENESS` for every class |

---

## 13. Accepted regression

| Slice | Status |
|---|---|
| S1A | green |
| S1B | green |
| S1C | green |
| S1D | green |
| S1E | green |
| S1F | green |
| S1G | green |

**Two accepted test files were amended in the first pass, both additively, and no accepted
test was deleted or weakened.** The v1.3.3 pass amended nine more, every amendment
MECHANICAL — the approval-floor operand's type changed from `boolean` to `Money` and the
posture operand was added, so every construction site changed.
`S1H-implementation-log.md §19` lists all nine with the change in each.

1. `vc-a1d-adversarial-attester.test.ts` — the audit evaluator's visible-table list goes
   from 3 to 5, **and to 6 under v1.3.3**. All three new tables are written by the audit
   plane's own evaluator or by its own ingress from its own observation, none is an input
   ABOUT the control journal, and none settles the `§5.5` case 2b residual — a store-write
   failure records that a row the control plane SENT could not be stored and says nothing
   about a row it WITHHELD, which is the attack this suite builds. The property is unchanged
   and still asserted.
2. `local-authorisation-boundary.test.ts` — the mirror-absence assertion is replaced. S1H
   builds the mirror machine, which `37` S1 puts in this slice. The mirror half MOVES to
   `no-dispatch-boundary.test.ts` as CONFINEMENT to four named directories, `I17b`'s anchor
   absence STAYS, and a NEW stricter assertion is added: the pre-R authority path cannot
   reach the mirror at all.

**Three further accepted files needed mechanical widening**, not a change of property:

3. `plane-independence.test.ts` — `inTransaction` added to the permitted `db/pool.js`
   import set, which the test's own comment already describes as generic infrastructure.
   `controlUrl`, `ACOS_CONTROL_PG_URL` and every control repository remain absent.
4. `vc-a3-cross-implementation.test.ts` — the positional `ROW(...)::effect_journal` and
   `::audit_journal` casts gain the eleven new columns as explicit `NULL`s, because a
   positional cast must match the table's arity. Every assertion is unchanged and the
   framed-field counts are still 23.
5. `rate-class-local-authorisation.test.ts` — the standing-revocation rule is narrowed:
   `src/kernel/mirror/` is exempt from the bare `'REVOKED'` literal, which
   `30 §5.7.2` declares as a `DegradedModeOverride` status, and is held to a SHARPER rule
   instead — it may not name `'REVOKED'` together with any standing relation.

**Four S1H identifiers were named to avoid colliding with accepted source rules**, and each
choice is documented at the point of use:

* `explanation` rather than `rationale` — `26 §2.0` reserves the latter for the model's free
  text, and `source-rules.test.ts` rule 1 forbids the word outside three named modules;
* `SIGNAL_CONSUMED` rather than `CONSUMED` — `26 §12.2`'s approval lifecycle owns it;
* `ALLOWANCE_TAKEN` rather than `CLAIMED`, for the claim OUTCOME; and
* `ALLOWANCE_TAKEN` rather than `EFFECT_CLAIMED`, for the journal EVENT — both because
  `25 §7` layer 4's outbox owns the `CLAIMED` literal until `I36` exists.

**The renames strengthen the accepted rules rather than amending them**, and each is a
place S1H could have quietly widened an accepted absence and did not.

---

## 14. Verification

### Architecture mechanical verification

| | |
|---|---|
| Gate | `docs/architecture/v1.3.3/analysis/consistency-v1.3.py` |
| Conditions | **35** — C1–C29 (v1.3), E1–E7 (v1.3.1), F1–F3 (v1.3.2), **G1–G10 (v1.3.3)** |
| Result | **35 PASS / 0 FAIL**, exit 0. Recorded run: `analysis/consistency-v1.3.3-output.txt` |
| Seeded negative controls | **9** — the two v1.3.2 controls, retained and still failing, plus six new ones. Each exits non-zero |
| Every G condition failed by at least one seed? | **YES.** G1 ← `floor-25`, `vendor-amount` · G2 ← `floor-25` · G3 ← `floor-25` · G4 ← `vendor-amount` · G5 ← `lag-10m` · G6 ← `full-halt-15m` · G7 ← `full-halt-15m` · G8 ← `quota-as-cause` · G9 ← `quota-as-cause`, `generic-insert-fail` · G10 ← `quota-as-cause`, `generic-insert-fail` |
| `recompute-v1.3.py` | reproduces `recompute-v1.3-output.txt` **line for line identically**. `MAL_total(month)` at the signature basis = **$756.00**, unchanged |

The ten conditions, in `§12`'s own order:

| `§12` | Condition | Gate |
|---|---|---|
| 1 | `$20.00` appears in the authoritative quantity location | **G1** |
| 2 | every operational reference resolves to that declared operand | **G2** |
| 3 | no operational passage equates the floor with `$25.00 per_action_max` | **G3** (a denylist over every line, plus required positives) |
| 4 | the degraded comparison uses `total_exposure` | **G4** |
| 5 | the mirror-lag threshold is exactly 15 minutes everywhere | **G5** (required statements + a numeric sweep over every stating line) |
| 6 | the full-halt threshold is exactly 30 minutes everywhere | **G6** (same) |
| 7 | 30 minutes is strictly greater than 15 minutes | **G7** (parsed arithmetic, both notations) |
| 8 | quota saturation remains incident-only | **G8** |
| 9 | `STORE_WRITE_REJECTED` requires an audit-observed, otherwise-valid, in-quota attempt | **G9** (all ten conjuncts individually) |
| 10 | canonical / hash / security failures are excluded from that cause | **G10** (the exclusion list is parsed; all seventeen members looked up) |

### Repository verification

| | |
|---|---|
| `npm run verify` | **exit 0** — typecheck green, lint zero warnings, all tests passing |
| Test files | **109** (104 at the `b524637` baseline + 5 new) |
| Tests | **1679** (1544 at the baseline; the increase is additive) |
| Passed | 1679 |
| Failed | **0** |
| Skipped | **0** |
| `.only` / `.skip` / `.todo` | none |
| Hidden filters | none — `vitest.config.ts` is unchanged by this pass |
| Focused S1H suite (the 18 accepted files + the 5 new) | 23 files / 475 tests / 475 passed |
| Accepted tests deleted | **0** |
| Accepted assertions weakened | **0.** Nine accepted test files were amended and every amendment is MECHANICAL — the operand's type changed, so every construction site changed. `S1H-implementation-log.md §19` lists all nine with the change in each. No assertion was deleted and no property narrowed; the one case where the posture would have changed an accepted expectation — `vc-a2e-override.test.ts`'s "expiry restores NOTHING" — keeps its assertion and gains an ADDITIVE stricter counterpart in `full-halt-posture.test.ts` |
| Vulnerable controls | **7** (five accepted + two new). All 7 discriminate except the one accepted non-discriminating control, which is still reported as non-discriminating rather than counted |

**The focused tests `§22` requires, each named:**

| Required | File |
|---|---|
| approval-floor boundaries | `degraded-mode-thresholds.test.ts`, `dispatch-precedence-approval-floor.test.ts` |
| `VC-A2` cross-product with the derived floor operand | `dispatch-precedence-approval-floor.test.ts`, `vc-a2-inversion.test.ts` |
| 15m lag boundaries | `degraded-mode-thresholds.test.ts` (pure), `mirror-lag-critical.test.ts` (durable) |
| 30m full-halt boundaries | `degraded-mode-thresholds.test.ts` (pure), `full-halt-posture.test.ts` (durable, every class) |
| `STORE_WRITE_REJECTED` derivation | `store-write-availability.test.ts` |
| quota negative control | same, `§8` A |
| collision / integrity negative controls | same, `§8` B and C — including the ordering under simultaneous injection |
| prolonged-unreachability vulnerable control | `full-halt-posture.test.ts` + `unsafe-prolonged-unreachability.ts` |

### Accepted regression

S1A–S1G all green. `S1H-C4`'s repair re-verified: the three attestation columns refuse
`UPDATE` with `JOURNAL_ROW_IMMUTABLE`, `mirrored_at` is still the one permitted mutation and
affects exactly one row, `DELETE` is still refused, and the S1G chain, `VC-A3` and
attestation suites are unchanged and green.

## 15. `§43`'s diff audit

`git diff e47a437...HEAD` and `git diff b524637...HEAD` were both read in full. Findings:

| Audited for | Result |
|---|---|
| External calls | none |
| Outbox | none |
| Adapter | none |
| Arbitrary self-declared corroboration | impossible — `resolveMirrorState` has no branch from a declaration to the relaxed state, and the discriminating control shows the unsafe machine does |
| Stale-signal acceptance | impossible — freshness is evaluated at every state evaluation, and the discriminating control shows the unsafe machine accepts |
| Unsigned signal | refused — real Ed25519, 64-byte length check first |
| Model-created clocks | impossible — no classification argument exists |
| Override changing ceilings | impossible — schema, source, cryptography and behaviour |
| In-memory-only state | none — no module-level mutable state |
| Actual or fake dispatch | none |
| Architecture-package modification | none to `v1.3.1/` or `v1.3.2/`; `v1.3.3/` is a new directory |
| **v1.3.3 additions, audited under `§23`** | |
| new dispatch code, adapter, outbox, external claim | **none.** A grep over this pass's source additions for `outbox`, `exclusive`, `I36`, `vendorIdempotency`, `adapter`, `.dispatch(`, `fetch(`, `node:http`, `axios`, `undici`, `WebSocket`, `reconcil` and `settlement` returns zero hits |
| caller-controlled `aboveApprovalFloor` | **removed.** The field does not exist; a source assertion forbids it and any `ForTest` seam |
| use of `vendor_amount` | **none** in the classifier's executable lines, asserted |
| quota saturation unlocking degradation | **impossible.** It fails conjunct 8 and returns an OUTCOME rather than reaching the handler; asserted directly, and the unsafe mapper is shown to differ |
| generic DB errors unlocking degradation | **impossible.** A three-code allowlist, fail-closed by construction; two unsafe mappers are shown to differ |
| stale signal acceptance | unchanged — freshness is still evaluated at every state evaluation, and the store-write observation additionally ages out at `cadence × k` |
| owner override changing ceilings | **impossible**, unchanged. The posture changes what an override may be needed FOR, never what it may DO; every `51 §3.6` quantity is asserted unchanged |
| unrelated architecture changes | none |

---

## 16. Open obligations

**Carried forward from S1A–S1G, unchanged:**

* actual external dispatch; the adapter; the HTTP call; vendor idempotency and vendor
  query; the outbox and `I36`'s exclusive claim; external exactly-once
* `I8` — the audit plane's own vendor credentials and the inverse sweep. `37` S1: **"`I8`
  proves nothing at S1"**, so `30 §5.5` cases 2b and 4 have no operative detector
* `I17b` — external anchoring; `I17c`'s SCHEDULED leg
* reconciliation, settlement, `I18d`
* approval resume, `R′`, `I51`'s runtime leg, `I58`, `I60`, full `VC-C3`, `VC-C4`
* standing-revocation execution; the reaper and `I32`
* `I19`'s runtime control-artifact hash verification; **the class-20 owner-signature
  residual stays OPEN**, and S1H used no production-style control-artifact integrity
  mechanism, so nothing here claims it
* the audit plane's separate provider or separate account (`30 §5`'s disqualifying
  criterion). Two containers on one machine are not that, and `A0001` has said so since S1A
* Cedar `O4`, symcc, `I19`, AI CEO and AI workers
* the owner briefing, the independent appendix, V6/V7

**New from S1H:**

* **`I17f(a)` and `I17f(c)`** — operands are dispatched effects. OPEN until the execution
  slice. `§35`'s instruction was followed: no `DISPATCHED` rows were manufactured
* ~~The FULL-HALT POSTURE~~ — **CLOSED by v1.3.3** (`51 §3.8`, `30 §5.1a`)
* ~~The per-action approval-floor derivation~~ — **CLOSED by v1.3.3** (`51 §3.7`)
* ~~`STORE_WRITE_REJECTED`'s derivation~~ — **CLOSED by v1.3.3** (`30 §5.7.1a`)
* **`I19` on control artifact class 3** (whose `content_hash` moves because the approval-floor
  field finally has a value) **and on the new class 27** (the degraded-mode threshold set).
  **Two owner signatures are newly owed and neither is discharged**, and no production
  owner-signing mechanism and no runtime `I19` verification exist. **The class-20 residual
  carried from v1.3.2 is unaffected and remains owed**
* **`STORE_WRITE_REJECTED`'s narrowness, recorded rather than engineered around.** The
  derivation is reachable only where the audit storage layer is unavailable for the JOURNAL
  HOLDINGS while the audit plane's own tables remain writable. Where the whole store is
  unavailable, nothing is published and the answer is `UNCORROBORATED_STALL` plus the
  override — `30 §5.6`'s reachability table's new last row
* **The `mirror_lag` operand is control-derived and control-forgeable**, because `mirrored_at`
  is advisory (`30 §5.2`). Admissible in this direction only: `30 §5.1a` makes the condition
  an escalation, understating it suppresses an alarm rather than obtaining authority, and the
  unforgeable detector for the understated case is the audit plane's attestation-absence check
  and `I17f(b)`. `mirror-lag-critical.test.ts` proves the direction and nothing more
* **`mirror_declaration` carries no immutability trigger.** `opened_at` is the FULL-HALT
  operand and a direct `UPDATE` as the control role is admitted by the schema, so the
  operand's integrity rests on the migration-principal boundary (`49 §3.11`) and not on a
  trigger. What IS asserted is that no production path moves it, over every production path
  that touches the declaration. Recorded rather than claimed away
* **`30 §5.7.1`'s HTTP endpoint and the provisioned signing key** — realised as a scoped
  PostgreSQL role and a harness-generated keypair. `§5.7.1`'s Provisioning note puts both
  outside the S1 build
* **`I19` on control artifact class 24** (the audit public key) **and class 25** (the
  override limit set plus the registered approver set). Both are read; neither is
  hash-verified at runtime
* **`I8`'s additive verification list for override dispatches** (`30 §5.7.2` item 6,
  `36 §9` VC-A2e). Cannot be populated at S1 (`S1H-C12`)
* **TA-08's clock uniqueness, source-content collapse and volume anomaly bound** —
  scheduled S5 by the architecture
* **A tension inside `30 §5.7.2` item 5, reported rather than resolved** (`S1H-C11`).
  Item 5 requires EVERY override dispatch to carry `DISPATCHED_UNMIRRORED`, unqualified.
  `I17f(a)` requires the tag to have a covering audit-published interval. In the two-sided
  outage the override exists for, the audit plane may have published nothing. Not reachable
  at S1H, because nothing is dispatched
* **A residual of `S1H-C2`'s reading.** A control plane holding a fresh valid signal while
  declaring nothing resolves to `NORMAL`, and a row-3 dispatch there would carry no tag. If
  the audit plane published a covering interval, that is an `I17f(c)` exposure whose only
  detector is `I8`. The combination is reported as the
  `SIGNAL_HELD_WITHOUT_DECLARATION` anomaly and is `I17f(b)`'s own condition

---

## 17. Architecture conflicts and owner clarifications

Twelve items, in full in `S1H-owner-clarifications.md`, each now carrying its
`OWNER RESOLUTION` block. The dispositions, the evidence and the two STOP conditions that
were checked are in `S1H-owner-resolution.md`.

| Item | Issue | Final classification | Owner disposition | Code change |
|---|---|---|---|---|
| `S1H-C1` | the per-action approval floor has no declared value | **OWNER CLARIFICATION — ACCEPTED** | `51 §3.7`: **USD 20.00** vs `total_exposure`, strict | **YES** — the boolean removed, the predicate derived |
| `S1H-C2` | `30 §5.6`'s three entry conditions are not disjoint | **OWNER CLARIFICATION — ACCEPTED, CONSERVATIVE PARTITION** | authority-equivalent for every precedence outcome; no counterexample | none |
| `S1H-C3` | `I63(b)`'s "all records" includes revoked and expired | **DIRECT ARCHITECTURE REQUIREMENT** | the literal and fail-closed reading | none |
| `S1H-C4` | the S1G journal-immutability guard had a hole | **DEFECT FOUND AND REPAIRED** | accepted subject to regression; **not reverted** | already in `b524637`; re-verified |
| `S1H-C5` | `last_attestation_received_at`'s nullability | **IMPLEMENTATION DETAIL — NON-SEMANTIC** | the declaration stands | none |
| `S1H-C6` | `§5.7.1`'s conjunction admits a future-dated signal | **OWNER CLARIFICATION — ACCEPTED** | the refusal stands; strictly stricter | none |
| `S1H-C7` | "rows 3 or 5" is imprecise | **OWNER CLARIFICATION — ACCEPTED** | "never row 2" is operative | none; one assertion added |
| `S1H-C8` | `STORE_WRITE_REJECTED` has no derivation | **OWNER CLARIFICATION — ACCEPTED** | `30 §5.7.1a`: a closed ten-condition audit-owned derivation | **YES** — `A0003`, `A0004`, the classifier, the derivation |
| `S1H-C9` | the byte order for the three new row kinds | **IMPLEMENTATION DETAIL — NON-SEMANTIC** | the declarations stand | none |
| `S1H-C10` | the two timing thresholds are undeclared | **OWNER CLARIFICATION — ACCEPTED** | `51 §3.8`: **PT15M** and **PT30M**, both inclusive | **YES** — the posture, the lag condition, both operands |
| `S1H-C11` | whether an override applies in `NORMAL` / `CORROBORATED_DEGRADED` | **OWNER CLARIFICATION — ACCEPTED**; the item-5 / `I17f(a)` tension stays a **DEFERRED RESIDUAL** | the row-scoped reading stands; `30 §5.1a` resolves the posture leg | none |
| `S1H-C12` | `I8`'s additive verification list at S1 | **DEFERRED RESIDUAL** | the architecture itself defers it | none |

**`OWNER DECISION STILL REQUIRED`: ZERO**, which is `§19`'s expected count. No new
load-bearing ambiguity appeared.

**`§3`'s and `§16`'s STOP conditions were both checked and neither triggers.** The
architecture defines the full-halt timer's start and reset — the `AUDIT_MIRROR_DEGRADED`
declaration's lifecycle, plus `mirror_declaration_one_open_per_company` — and `30 §5.1`
item 5 does state that the override reaches the halt, in the same sentence that says
"either the halt". Both are recorded with the quoted text in `S1H-owner-resolution.md §7`,
and neither was assumed.

**One item is a defect found in accepted code and closed:** `S1H-C4`.

**The architecture package was extended, not modified.** Four normative declarations
required a new package issue; `v1.3.1/` and `v1.3.2/` are byte-identical.

## 18. Recommended next slice

**S1I — the outbox and `I36`'s exclusive claim.**

Named only. **Not implemented, and nothing in this pass touches it.** `§20` of the
owner-resolution mandate forbids the outbox, the exclusive external claim, `I36`, vendor
idempotency, the adapter, HTTP or vendor execution, reconciliation, settlement, approval
resume, standing-revocation execution and AI, and `§14`'s audit over this pass's source
additions returns zero hits for every one of them.
