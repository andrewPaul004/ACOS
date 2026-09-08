# S1H — Result

**Verdict: PARTIAL.**

The three-state mirror machine, the inversion, the authenticated and fresh corroboration
signal, the bounded owner override with its composition bound, `I56`'s provenance leg and
the deterministic pre-dispatch classifier are all built, tested and closed. **PARTIAL
rather than PASS because three quantities the architecture needs are absent from v1.3.2**,
and `§42` of the S1H mandate directs that the affected parts stop rather than guess:

1. **The per-action approval floor has no declared numeric value** (`S1H-C1`). Precedence
   row 2's behaviour is implemented and tested over both values of the operand; the
   operand's derivation is PARTIAL.
2. **The mirror-lag and prolonged-unreachability thresholds have no declared values**
   (`S1H-C10`). The FULL-HALT POSTURE of `30 §5.1` item 5 — all classes halting, including
   REVERSIBLE — is therefore NOT IMPLEMENTED.
3. **`STORE_WRITE_REJECTED` has no declared derivation rule** (`S1H-C8`), and the one
   candidate reading is explicitly forbidden as a mode change. The audit plane never issues
   it.

None of the three is a failure of the security properties. **No unilateral control-side
state can unlock relaxed authority**, which is the FAIL condition, and it is proven over
the whole cross-product with a discriminating control.

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

---

## 2. Architecture

| | |
|---|---|
| Architecture | Operating Spine v1.3 |
| Authoritative package issue | **v1.3.2** |
| Directory | `docs/architecture/v1.3.2/` — **unmodified.** `git status` reports zero changes under `docs/architecture/` |
| Mirror-state sources | `30 §5.1`, `§5.4`, `§5.5`, `§5.6`, `§5.7`, `§5.7.1`, `§5.7.2`, `§9.1`; `22 §3.1`; `24 §3` K10/K11; `25 §13`; `36 §6`, `§9`, `§14`, `§15`; `50 §2` classes 3, 20, 24, 25; `51 §3.1`, `§3.6`, `§4.1`, `§5`; `37` S1; registry `I8`, `I17`, `I17e`, `I17f`, `I56`, `I63`, `§3` items 7/9/10; `phase2-v1.3-lower-severity-register.md` TA-08 |
| Conflicts with the mandate | none. Where the mandate's shorthand differs from v1.3.2, v1.3.2 was followed and the difference recorded |
| Conflicts within v1.3.2 | one, and it is an ambiguity rather than a contradiction: `30 §5.6`'s three entry conditions are not disjoint as written (`S1H-C2`). The stricter partition reading was taken |

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
Provisioning note puts them outside the S1 build. And `STORE_WRITE_REJECTED` is never
issued (`S1H-C8`).

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
| Architecture package modified | **NO** — zero changes under `docs/architecture/` |

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

**Two accepted test files were amended, both additively, and no accepted test was
deleted or weakened.**

1. `vc-a1d-adversarial-attester.test.ts` — the audit evaluator's visible-table list goes
   from 3 to 5. Both new tables are written by the audit plane's own evaluator from its own
   holdings, neither is an input ABOUT the control journal, and neither settles the
   `§5.5` case 2b residual. The property is unchanged and still asserted.
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

| | |
|---|---|
| `npm run verify` | **exit 0** — typecheck green, lint zero warnings, all tests passing |
| Test files | **104** (86 accepted + 18 S1H) |
| Tests | **1544** (1204 accepted + 340 S1H) |
| Passed | 1544 |
| Failed | 0 |
| Skipped | **0** |
| `.only` / `.skip` / `.todo` | none |
| Hidden filters | none — `vitest.config.ts` is unchanged |
| Focused S1H suite | 18 files / 340 tests / 340 passed |
| Real-Postgres S1H files | 13 |
| Dual-Postgres S1H files | 6 |
| Vulnerable controls | **5** (three files, five entry points); 4 discriminate, and the 1 that does not is reported as non-discriminating rather than counted |
| Accepted tests deleted | 0 |
| Accepted assertions weakened | **0 in property.** Stated precisely, because "weakened" deserves a precise answer: two accepted assertions admit one more thing than they did, and both are named in `§13`. `plane-independence.test.ts`'s permitted `db/pool.js` import set gains ONE symbol, `inTransaction`, which the test's own comment already calls generic infrastructure — the property it protects, that the audit plane opens no CONTROL connection, is untouched. `rate-class-local-authorisation.test.ts` exempts ONE directory from a bare `'REVOKED'` literal and holds that directory to a stricter rule instead. Every other accepted assertion is byte-identical |

---

## 15. `§43`'s diff audit

`git diff e47a437...HEAD` was read in full. Findings:

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
| Architecture-package modification | none |

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
* **The FULL-HALT POSTURE of `30 §5.1` item 5** — NOT IMPLEMENTED. Both thresholds are
  undeclared in v1.3.2 (`S1H-C10`). **Owner decision required**
* **The per-action approval-floor derivation** (`S1H-C1`). The row-2 behaviour is closed;
  the operand is supplied. **Owner decision required**
* **`STORE_WRITE_REJECTED`'s derivation** (`S1H-C8`). Never issued. **Owner decision
  required**
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

Twelve items, in full in `S1H-owner-clarifications.md`. **Three require an owner decision:**

| Item | Decision asked |
|---|---|
| `S1H-C1` | Declare the numeric per-action approval floor, or declare that row 2's operand is the catalogue's `approval_requirement` tier rather than a monetary threshold |
| `S1H-C8` | Declare when `STORE_WRITE_REJECTED` is issued, or delete the enum member |
| `S1H-C10` | Declare the mirror-lag threshold and the prolonged-unreachability threshold, or state that the full-halt posture is a later slice |

**One is a defect found in accepted code and closed here:** `S1H-C4`, the journal
immutability guard's hole, which left the attested prefix of a chained row mutable in the
control database.

**Six are readings or declarations, taken and recorded:** `S1H-C2` (the stricter partition
reading of `30 §5.6`), `S1H-C3` (`I63(b)` counts revoked and expired records),
`S1H-C5` (nullable attestation instant), `S1H-C6` (a future-dated signal is refused — an
addition strictly stricter than the declared rule), `S1H-C7` ("never row 2" is the
operative half), `S1H-C9` (the three new byte orders).

**Two are deferrals the architecture itself makes:** `S1H-C11` (the item-5/`I17f(a)`
tension) and `S1H-C12` (`I8` proves nothing at S1).

**The architecture package was not modified.** No conflict required an erratum.

---

## 18. Recommended next slice

**S1I — the outbox and `I36`'s exclusive claim.**

Named only. Not implemented.
