# S1J — Test Matrix

**Branch `feature/s1j-mock-dispatch-outcomes`, from `e5b356a`. MOCK TRANSPORT ONLY.**

Every suite runs against **real PostgreSQL 16.9** on two separate instances (control and
audit), brought up from an empty database and migrated per test file. Nothing is mocked
except the adapter, and the adapter mock is **in-process with no socket**.

---

## 1. S1J's own suites

| File | Mandate sections | Tests |
|---|---|---|
| `tests/gateway/outcome-policy.test.ts` | `§14`, `§15`, `§16`, `§19`, `§40` items 7–9, `§41` | 23 |
| `tests/integration/gateway/gateway-composition.test.ts` | `§4`, `§6`, `§8`, `§10`, `§11`, `§12` | 9 |
| `tests/integration/gateway/fresh-claim.test.ts` | `§5`, `§23`, `§24`, `§34`, `§40` item 1 | 8 |
| `tests/integration/gateway/dispatch-envelope.test.ts` | `§10`, `§11`, `§12`, `§32`, `§40` items 4–6 | 10 |
| `tests/integration/gateway/outcome-classes.test.ts` | `§15`, `§16`, `§18`, `§19`, `§26`, `§27`, `§28`, `§42`, `§40` item 10 | 13 |
| `tests/integration/gateway/outcome-atomicity.test.ts` | `§20`, `§21`, `§25`, `§43`, `§40` item 12 | 9 |
| `tests/integration/gateway/mock-kill-matrix.test.ts` | `§22`, `§23`, `§29`, `§30` | 7 |
| `tests/integration/gateway/dispatch-outcome-journal-rows.test.ts` | `§36`, `§37`, `§38` | 9 |
| `tests/integration/gateway/no-real-transport-boundary.test.ts` | `§7`, `§9`, `§29`, `§31`, `§34`, `§39` | 15 |
| `tests/integration/gateway/gateway-type-boundary.test.ts` | `§5`, `§8`, `§17`, `§32`, `§33`, `§34` | 5 |
| `tests/negative-controls/gateway-controls.test.ts` | `§13`, `§40` items 2, 3, 13 | 7 |
| **Total S1J** | | **115** |

Plus one type-negative fixture, `tests/type-negative/gateway-caller-supplied-authority.ts`,
carrying **14** expected diagnostics owned by `gateway-type-boundary.test.ts`.

---

## 2. Test support added

| File | What it is | Imports from `src/`? |
|---|---|---|
| `tests/support/mockAdapter.ts` | The deterministic in-process mock, with call/accepted counters, an alias-attack mode, and a kill point at its own acceptance point | TYPES ONLY, from `adapterPort.ts` |
| `tests/support/s1jOutcomeTable.ts` | The hand-authored `25 §10` oracle — nine rows, three classes × three outcome kinds, each with its source passage | **NOTHING. No imports at all.** |
| `tests/support/gatewayFixture.ts` | Raw-SQL readers for the outcome row, the outcome journal row, the persisted payload and the persisted tag; the catalogue adapter identities; the test registry builder | `adapterRegistry` (constructor), `adapterPort` (type) |
| `tests/support/jcs1Oracle.ts` | Extended with `dispatchOutcomeFields` — the fourth reading of the field order | **NOTHING** (unchanged property) |

`§41`'s prohibitions, each honoured:

| Forbidden | Why S1J does not do it |
|---|---|
| expected outcome read from production policy | `s1jOutcomeTable.ts` imports nothing and was transcribed from v1.3.4 by hand |
| expected state read from production transition table | same |
| expected MIE amount from a production helper | there is no MIE movement, and the counts asserted (`'0'`, `'2'`) are hand-authored literals |
| expected payload from production re-canonicalisation | both sides of the payload comparison come from outside the envelope builder: the mock's own record, and raw SQL |
| adapter mock importing the production outcome classifier | `mockAdapter.ts` imports `adapterPort.ts` and nothing else; what it returns is what the test wrote |
| production journal canonicaliser as the test oracle | `jcs1Oracle.ts` is the oracle; BOTH database triggers are judged against it, never against each other |

---

## 3. The mandate, section by section

| § | Requirement | Where | Result |
|---|---|---|---|
| 4 | The whole composition, per recoverability class | `gateway-composition.test.ts` | **PASS** — REVERSIBLE at row 5, COMPENSABLE at row 3 under a live clock, IRRECOVERABLE at row 1 in `NORMAL` |
| 5 | Fresh-claim capability, seven properties | `fresh-claim.test.ts`, `no-real-transport-boundary.test.ts` | **PASS** |
| 6 | claim COMMIT precedes invocation | `gateway-composition.test.ts`, `gateway-controls.test.ts` | **PASS** — two event sources, and the unsafe ordering discriminates |
| 7 | Mock only, in-process, no socket | `no-real-transport-boundary.test.ts` | **PASS** — `src/` holds no adapter implementation; `EMPTY_ADAPTER_REGISTRY` is empty |
| 8 | Trusted closed adapter resolution | `gateway-composition.test.ts`, `gateway-controls.test.ts`, type-negative | **PASS** — no parameter exists; substitution unrepresentable |
| 9 | One production external-effect surface | `no-real-transport-boundary.test.ts` | **PASS** — exactly one `.dispatch(` call site |
| 10 | Exact persisted payload | `dispatch-envelope.test.ts` | **PASS** — mutation regression + reconstruction control |
| 11 | Correlation tag crosses the port | `dispatch-envelope.test.ts` | **PASS** — identical, immutable, no second mint |
| 12 | `DISPATCHED_UNMIRRORED` requirement crosses | `dispatch-outcome-journal-rows.test.ts` | **PASS** — and a DB CHECK makes suppression unwritable |
| 13 | EM6 adapter capability eligibility | `gateway-controls.test.ts` | **PASS** — refused before invocation; unsafe path dispatches |
| 14 | Typed adapter outcome, TCB-supplied | `outcome-policy.test.ts`, type-negative | **PASS** — no error string is read; no economic field exists |
| 15 | REVERSIBLE/COMPENSABLE unknown: hold | `outcome-classes.test.ts` | **PASS** — direct SQL before/after, all eleven ledger terms |
| 16 | IRRECOVERABLE unknown | `outcome-classes.test.ts`, `outcome-policy.test.ts` | **PARTIAL — `S1J-C1`.** Refused, nothing written, DB CHECK structural |
| 17 | Recoverability spoof control | `outcome-policy.test.ts`, type-negative | **PASS** — both directions |
| 18 | Confirmed success | `outcome-classes.test.ts` | **PASS** — `DISPATCHED_AWAITING_VERIFICATION`, no economic movement |
| 19 | Confirmed not-sent / rejection | `outcome-classes.test.ts`, `outcome-policy.test.ts` | **PARTIAL — `S1J-C2`.** Not implemented, not invented, `NEVER_SENT` not misused |
| 20 | Atomic outcome transaction | `outcome-atomicity.test.ts` | **PASS** — kill points inside; no lone journal row; gap-free sequence |
| 21 | Money-path lock order | `outcome-atomicity.test.ts` | **PASS (vacuously, and declared)** — no money row is touched |
| 22 | Six-point mock kill matrix | `mock-kill-matrix.test.ts` | **PASS**, and explicitly NOT real `I36` validation |
| 23 | Orphan `CLAIMED` recovery | `fresh-claim.test.ts`, `mock-kill-matrix.test.ts` | **PASS** — remains `CLAIMED`; no sweep exists |
| 24 | Fresh claim token loss | `fresh-claim.test.ts` | **PASS** — the whole seven-step fixture |
| 25 | Double outcome processing | `outcome-atomicity.test.ts` | **PASS** — constructed interleaving, one writer, prior result returned |
| 26 | No new claim after outcome | `outcome-classes.test.ts` | **PASS** — every branch, and at 1/30/365/3650 days |
| 27 | Reservation semantics per class | `outcome-classes.test.ts`, `S1J-result.md §8` | **PASS** — held on every branch, in architecture wording |
| 28 | IRRECOVERABLE MIE exactly once | `outcome-classes.test.ts` | **N/A — `S1J-C1`.** No movement exists to be once |
| 29 | Mock is not a provider oracle | `mock-kill-matrix.test.ts` | **PASS** — asserted as three structural absences |
| 30 | `I20` remains open | `mock-kill-matrix.test.ts` | **PASS** — no provider read, no ESP credential, `reserved_irrecoverable = 0` |
| 31 | No delivery reconciliation | `no-real-transport-boundary.test.ts` | **PASS** — thirteen forbidden patterns absent from `src/` |
| 32 | Immutable request | `dispatch-envelope.test.ts`, type-negative | **PASS** — seven-field alias attack; every scalar throws; bytes copied per read |
| 33 | Adapter chooses no economic quantity | type-negative, `0012`'s schema | **PASS** — no such field exists |
| 34 | Model cannot call adapter | `no-real-transport-boundary.test.ts`, type-negative | **PASS** — coarse result; no capability, attestation, envelope or payload on it |
| 36 | `ACOS-JCS-1` row kind | `dispatch-outcome-journal-rows.test.ts` | **PASS with a DISCLOSED OWED SIGNATURE — `S1J-C5`** |
| 37 | Audit push | `dispatch-outcome-journal-rows.test.ts` | **PASS** — accepted post-COMMIT path; local commit survives an audit outage |
| 38 | Unmirrored tag auditability | `dispatch-outcome-journal-rows.test.ts` | **PASS for the local leg.** Real-provider tag observability OPEN |
| 39 | Strict source gate | `no-real-transport-boundary.test.ts` | **PASS** — 30 patterns over the gateway directory |
| 40 | Vulnerable controls | see `§4` below | **13 controls, all discriminating** |
| 41 | No self-validating tests | see `§2` above | **PASS** |
| 42 | Economic snapshot | `outcome-classes.test.ts`, `outcome-atomicity.test.ts` | **PASS** — direct SQL, `toEqual`, all three ledgers |
| 43 | `40001` / `40P01` | `outcome-atomicity.test.ts` | **PASS (conditional not fired, and asserted)** |

---

## 4. The vulnerable controls — `§40`

**`§40`: "Every control included in the final count must actually discriminate. Do not count
controls that production and vulnerable paths agree on."** Each row below runs both paths
against the same database state.

| # | `§40` item | Control | Unsafe result | Production result | Discriminates |
|---|---|---|---|---|---|
| 1 | any persisted `CLAIMED` row dispatchable after restart | `unsafe-dispatch-claimed.ts` → `unsafeDispatchClaimed` | `DISPATCHED`, mock calls 0→1 | `CLAIM_REFUSED: ALREADY_CLAIMED`, mock calls stay 0 | **YES** |
| 1b | the forbidden startup sweep | `unsafeDispatchAllClaimed` | sweeps and re-invokes; calls 1→2 | no scheduler exists in `src/` at all | **YES** |
| 2 | adapter invoked before claim COMMIT | `unsafe-dispatch-ordering.ts` | `MOCK_ADAPTER_INVOKED` **precedes** `CLAIM_COMMITTED`; a rollback after acceptance leaves the row `ENQUEUED` and re-claimable → 2 accepted requests | `CLAIM_COMMITTED` precedes the invocation, structurally | **YES** |
| 3 | caller chooses the adapter | `unsafe-adapter-selection.ts` → `unsafeDispatchWithChosenAdapter` | the attacker's `mock_commerce` adapter executes with the real payload | `ADAPTER_REFUSED: ADAPTER_NOT_REGISTERED`, attacker never invoked | **YES** |
| 4 | payload rebuilt from live state | `unsafe-dispatch-envelope.ts` → `unsafeReconstructedEnvelope` | carries bytes recomputed after the order line moved `$10.00 → $3.00`, disagreeing with its own hash | the ORIGINAL persisted bytes | **YES** |
| 5 | correlation tag dropped | `unsafeMapperDroppingCorrelationTag` | `correlationTag === ''` | the persisted tag, unchanged | **YES** |
| 6 | unmirrored requirement dropped | `unsafeMapperDroppingUnmirroredTag` | `requiresUnmirroredTag === false`, `overrideId === null` | the claim's recorded requirement, and a DB CHECK refuses the suppressed row | **YES** |
| 7 | caller/adapter spoofs recoverability | `unsafe-outcome-policy.ts` → `unsafePolicyFromClaimedRecoverability` | IRRECOVERABLE→REVERSIBLE takes hold-and-reconcile; money→IRRECOVERABLE consumes an MIE unit | reads `effect.recoverability` in the outcome transaction; no parameter exists | **YES** |
| 8 | money unknown releases the reservation | `unsafePolicyReleasingReservationOnUnknown` | `reservation: 'RELEASED'` | `reservationHeld`, and the transaction issues no ledger statement at all | **YES** |
| 9 | unknown becomes retryable `READY`/`FAILED` | `unsafePolicyCollapsingUnknownToFailed` | `FAILED`, reservation released, redispatch permitted | `DISPATCHED_OUTCOME_UNKNOWN`, held, `redispatchPermitted: false` | **YES** |
| 10 | MIE consumed / consumed twice | `unsafe-mie-consumption.ts` | invents `presumed_irrecoverable += 1`, and twice when called twice | refuses `OUTCOME_POLICY_UNDECLARED`; the ledger is byte-identical; the row is unwritable | **YES** |
| 11 | crash after acceptance → second invocation | `unsafeDispatchAllClaimed` after kill point 3 | re-invokes the mock for a `CLAIMED` row with no outcome | `ALREADY_CLAIMED`; accepted count stays 1 | **YES** |
| 12 | outcome non-atomic with its journal row | `unsafe-outcome-transaction.ts` → `unsafeSplitOutcomeCommit` | `JOURNAL_ONLY`: one chained journal row, zero outcome rows | both roll back together; both counts 0 | **YES** |
| 12b | outcome race without the row lock | `unsafeReadThenWriteOutcome` | both pass the unlocked read; one `INSERTED`, one `REFUSED_BY_KEY` (aborted transaction) | the loser BLOCKS on the row lock and returns `alreadyResolved` — a determinate answer | **YES** |
| 13 | EM6 eligibility ignored | `unsafeDispatchIgnoringCapabilities` | dispatches an IRRECOVERABLE effect to an adapter with zero resolution primitives | `ADAPTER_REFUSED: ADAPTER_INELIGIBLE_FOR_IRRECOVERABLE`, never invoked | **YES** |

**14 discriminating controls** across the 13 numbered items (item 1 and item 12 each carry
two distinct shapes).

**Two of them are unusual and worth the owner's attention:**

- **Item 10 is not a defect — it is the DEFINITION S1J refused to make.** v1.3.4 requires
  the consumption and declares no mutation, so the control is a plausible guess at an
  undeclared rule. Production's refusal is the discrimination.
- **Item 12b's two paths reach the same row count.** What differs is WHICH MECHANISM
  refused: production's row lock returns a determinate `alreadyResolved`, the unsafe path's
  primary key raises `unique_violation` and aborts. `36 §0`'s single-mechanism rule is why
  the second mechanism exists, and this control shows it doing the work when the first is
  absent.

---

## 5. The six kill points — mock only

| Point | Mock calls | Mock accepted | Outbox | Outcome rows | Journal rows | Live capabilities | Recovery | Calls after recovery |
|---|---:|---:|---|---:|---:|---:|---|---:|
| 1 — before claim COMMIT | 0 | 0 | `ENQUEUED` | 0 | 0 | 0 | `OUTCOME_RESOLVED` (a FIRST claim) | 1 |
| 2 — after COMMIT, before invocation | 0 | 0 | `CLAIMED` | 0 | 0 | 0 | `ALREADY_CLAIMED` | 0 |
| 3 — after mock ACCEPTED, before outcome known | 1 | 1 | `CLAIMED` | 0 | 0 | 0 | `ALREADY_CLAIMED` | 1 |
| 4 — after mock RETURNED, before outcome COMMIT | 1 | 1 | `CLAIMED` | 0 | 0 | 0 | `ALREADY_CLAIMED` | 1 |
| 5 — after outcome COMMIT | 1 | 1 | `CLAIMED` | 1 | 1 | 0 | `ALREADY_CLAIMED` | 1 |
| 6 — re-entry at each of 2–5 | — | — | `CLAIMED` | — | — | 0 | `ALREADY_CLAIMED` | unchanged |

**Point 1 is the only row where recovery dispatches, and that is correct**: nothing was
claimed, so the later claim is a FIRST claim. `I36` is about `CLAIMED` rows.

> ## THIS DOES NOT CLOSE REAL-PROVIDER `I36` VALIDATION.
>
> `mock.acceptedCount` is this process's count of times its own in-process function reached
> its own acceptance point. `I36`'s verification leg requires "the six kill points of
> `44 §5.2` against a **real ESP sandbox**, measured by the provider's own accepted count"
> (`37 §2`, SEQ-01), and `35 §12.3` says why a mock cannot substitute: "**a mock with a
> naive idempotency implementation passes while the vendor would not.**"

---

## 6. Amendments to accepted tests — five files, and why each was forced

**`§49`: "no accepted tests weakened".** Every amendment below is either a MECHANICAL
consequence of schema arity, or the conversion of an ABSENCE into a CONFINEMENT for the
exact mechanism this slice is chartered to build — which is the move S1H made when it built
the mirror S1G had asserted absent, and S1I made when it built the outbox S1F had asserted
absent. Each carries the same kind of comment its predecessors wrote.

### 6.1 Mechanical — schema arity and a directory listing

| File | Change | Why it was forced |
|---|---|---|
| `tests/integration/audit/vc-a3-cross-implementation.test.ts` | three `NULL`s appended to each of the two positional `ROW(...)::effect_journal` / `::audit_journal` literals | `0012` and `A0007` add three columns, and a positional composite cast MUST match the table's arity. S1H appended eleven, S1I six, v1.3.4 one. **No assertion, fixture or expected value changed.** |
| `tests/canonicalisation/i21-type-boundary.test.ts` | one filename added to the type-negative directory listing, "sixteen" → "seventeen" | The harness asserts the fixture directory's exact contents. S1D, S1E, S1F and S1I each amended the same line. **The positive control still compiles clean, and "no diagnostic on an unmarked line" now covers the new fixture.** |

### 6.2 Absence → confinement, for the mechanism S1J builds

| File | Change | The property that replaces the absence |
|---|---|---|
| `tests/integration/authority/local-authorisation-boundary.test.ts` | `claimSites` widened by the five gateway files that name `CLAIMED` or `outbox` | **The MONEY PATH clause is untouched.** `kernel/authority`, `kernel/policy`, `kernel/exposure` and `kernel/canonicalisation` still contain no `CLAIMED`, no `outbox` and no `claimForExternalDispatch` — which is the property the case exists for. A composition that could not name the row it dispatches could not read the payload off it. |
| `tests/integration/authority/local-transaction-atomicity.test.ts` | `OUTBOX_FILES` widened by four gateway files | **Every transport pattern stays global and unchanged** — no `fetch`, `XMLHttpRequest`, `node:https`, `node:net`, `node:dgram`, `axios` or `undici` — and the case's own final assertion still reads `localAuthorisation.ts` and requires it to contain neither `outbox` nor `CLAIMED`. |
| `tests/integration/mirror/no-dispatch-boundary.test.ts` | the `/\.dispatch\s*\(/` ABSENCE withdrawn and replaced, in the same case, by a CONFINEMENT assertion: exactly one production file may call it | `36 §7`: "Every adapter method is reachable **only** through the Effect Gateway. Verified by a static check that no adapter method is exported to any other caller." **`/from …adapters?\//`, `/callAdapter/i` and `/adapterClient/i` stay global**, so an adapter module or client anywhere in `src/` still fails. |
| `tests/integration/mirror/no-dispatch-boundary.test.ts` | control relation allowlist widened by `effect_dispatch_outcome`; control column allowlist widened by the three `dispatch_*` journal columns; audit column allowlist likewise | The allowlists remain hand-authored and exact, so a FURTHER relation or column fails. **No adapter or vendor relation exists in either database**, and the audit plane still holds no table matching `outbox|dispatch|adapter|vendor` at all. |

**And two production names were changed because an accepted test was right.** Neither is a
test amendment; both are the accepted assertions doing their job:

| Accepted assertion | What it caught | Fix |
|---|---|---|
| `no-transport-boundary.test.ts`: the literal `'DISPATCHED'` appears nowhere in `src/` | the gateway's success arm was first named `DISPATCHED`, which is exactly the `CLAIMED`/`DISPATCHED` blurring `§41` of the S1I mandate forbids, and v1.3.4 declares no such state | renamed `OUTCOME_RESOLVED`; **the accepted test was not amended** |
| `local-authorisation-boundary.test.ts`: the literal `'CONSUMED'` appears nowhere in `src/` (`26 §12`'s approval resume is deferred) | the capability result arm was first named `CONSUMED`, which made an unrelated mechanism look like the resume path arriving | renamed `CAPABILITY_CONSUMED`; **the accepted test was not amended** |

### 6.3 What was NOT touched

- **`tests/integration/outbox/no-transport-boundary.test.ts` is byte-identical to
  `e5b356a`** — including its assertion that `'DISPATCHED'`, `'EXECUTED'`, `'SETTLED'`,
  `'PRESUMED_EXECUTED'` and `'NEVER_SENT'` appear nowhere in `src/`.
- **`src/kernel/outbox/` is byte-identical to `e5b356a`.**
- **`docs/architecture/` is unmodified.**
- No other file under `tests/` was changed.

## 7. Verification

**Architecture gate: 48 PASS / 0 FAIL. `npm run verify`: GREEN — 136 files, 1965 tests,
1965 passed, 0 failed, 0 skipped, 962.03 s.**

`S1J-result.md §19` carries the full record, including the diff audit.

---

# 8. The v1.3.5 continuation — what was added, and what changed

**Everything in `§1`–`§7` above describes the pass that ended at `f1f849a` and is retained
as the record of it.** This section covers the continuation against the OWNER-ACCEPTED
v1.3.5 package at `81c2939`.

## 8.1 New focused suites

| Suite | `§` of the mandate | What it proves |
|---|---|---|
| `tests/integration/exposure/mie-reservation.test.ts` | `§4`, `§5`, `§6`, `§37` | `51 §2.3`'s table against a hand transcription; step R reserving on **every** referenced instance; the append-only evidence; and `I20`'s denominator surviving `reserved → presumed` |
| `tests/integration/exposure/mie-units-type-boundary.test.ts` | `§4` | a real `tsc` run: six refusals where a unit count is offered as an argument, and three cases that MUST compile so the fixture cannot pass by being broken |
| `tests/integration/exposure/mie-final-unit-concurrency.test.ts` | `§8` | the last unit, raced: exactly one commits, exactly one is denied by the architecture's guard, the ceiling is reached **exactly**, and no `40P01` |
| `tests/integration/gateway/mie-outcome-atomicity.test.ts` | `§13`, `§15` | six kill points each returning the exact pre-outcome state; the seventh proved unreachable by construction; the no-headroom sum; and the four wrong movements |
| `tests/integration/gateway/mie-outcome-duplicate.test.ts` | `§14` | sequential, concurrent and restart-after-commit, each moving the unit exactly once |
| `tests/integration/gateway/not-sent-confirmed.test.ts` | `§17`, `§18`, `§19` | the typed basis; the genuine pre-send failure; the terminal identity; and both releases |
| `tests/integration/gateway/not-sent-vs-unknown.test.ts` | `§20`, `§21` | the false-not-sent attack and the generic-failure retry, each as a two-implementation comparison |
| `tests/integration/gateway/dispatch-gap-revalidation.test.ts` | `§27`, `§28`, `§29` | revalidation under the lease; six precise stale reasons; the coarse outward denial; and that nothing is constructed or minted |
| `tests/integration/gateway/dispatch-lease-continuity.test.ts` | `§23`–`§26`, `§30` | the key equality, the lock-free gap, five held-lock observations across the span, and a real competing mutation |
| `tests/integration/gateway/dispatch-lease-crash.test.ts` | `§31`, `§32` | both crash points, and the required regression: an old `CLAIMED` row plus a newly acquired lease still cannot dispatch |
| `tests/integration/gateway/irrecoverable-outcome-matrix.test.ts` | `§33` | all twelve C4 cells as committed database state, plus the agreement of the two IRRECOVERABLE informative cells |

**Every concurrency, atomicity and authoritative-state property runs against real
PostgreSQL.** The lease observations are made from a **separate session** through
`pg_try_advisory_lock`, never from an application boolean.

## 8.2 New negative-control modules

| Module | Controls |
|---|---|
| `tests/negative-controls/unsafe-mie-movements.ts` | no reservation; state moves and unit does not; release on unknown; `reserved → realised`; two-transaction movement; application-only final-unit admission |
| `tests/negative-controls/unsafe-not-sent-mapping.ts` | the exception-to-not-sent mapper; an adapter that escapes then reports a confirmed non-send; the generic-failure requeue |
| `tests/negative-controls/unsafe-dispatch-epoch.ts` | dispatch that trusts enqueue-time validity; dispatch from a persisted `CLAIMED` row alone |
| `tests/integration/gateway/mieDuplicateSupport.ts` | the duplicate consumption, as one callable |

## 8.3 Accepted assertions that v1.3.5 SUPERSEDED

Each row is an assertion that was **correct under v1.3.4 and is wrong under v1.3.5**. None
was weakened; each was replaced by the property the new declaration makes true.

| File | What it asserted | What replaced it |
|---|---|---|
| `tests/gateway/outcome-policy.test.ts` | two undeclared reasons; one economic movement (`NONE`); two post-dispatch statuses; `(IRRECOVERABLE, OUTCOME_UNKNOWN)` UNDECLARED | one undeclared reason **by declaration**; four movements with **no `REALISED` among them**; four statuses; the cell RESOLVES and the two informative cells are asserted to AGREE |
| `tests/integration/gateway/outcome-classes.test.ts` | the IRRECOVERABLE unknown branch refuses and `PRESUMED_EXECUTED` is unwritable | it resolves, and the movement is asserted on **every bound window** with the three-term sum computed on both sides |
| `tests/integration/gateway/dispatch-envelope.test.ts` | a gap mutation leaves the dispatch proceeding with persisted bytes | the mutation makes the option **stale**, the claim is refused, and the unsafe path is the discriminator |
| `tests/integration/gateway/outcome-atomicity.test.ts` | `outcomeTransaction.ts` contains no `40001`, no `retr`, no `SERIALIZABLE` | the **single lock order** is asserted directly: no `FOR UPDATE` of its own, the accepted acquisition site, the counter last, and `40P01` still never retried |
| `tests/integration/gateway/no-real-transport-boundary.test.ts` | import/export/refusal allow-lists; `'PRESUMED_EXECUTED'` banned in `src/` | widened by name with the declaration that requires each; the literal leaves the provider-evidence sweep because `25 §10.1` makes it a LOCAL state, while `VERIFIED` and `NEVER_SENT` stay banned |
| `tests/integration/outbox/no-transport-boundary.test.ts` | the same literal banned across `src/` | banned in **`src/kernel/outbox/` specifically**, which was always the sharper claim for this suite |
| `tests/integration/outbox/outbox-claim.test.ts` | the irrecoverable ledger is three zeros at enqueue and at claim | the unit **is** reserved at step R, and **neither the enqueue nor the claim moves it** — a property that was untestable while there was nothing to move |
| `tests/integration/authority/local-transaction-atomicity.test.ts` | `OUTBOX_FILES`; `../exposure/ledger.js` forbidden to the gateway | widened by the two Epoch-B modules; the ledger's **movement** functions are admitted and `stepR.ts` stays forbidden — one moves a declared commitment, the other would mint one |
| `tests/integration/gateway/gateway-type-boundary.test.ts` | the gateway's four-argument shape | the `DispatchEnvironment` shape; all fourteen attacks unchanged |

**And one production name survived an accepted assertion unchanged:** the
`'DISPATCHED'`-absence rule still holds, and `25 §7.1`'s new terminal state is
`DISPATCH_NOT_SENT_CONFIRMED` rather than anything containing the bare literal.

## 8.4 What was NOT touched

- **`docs/architecture/` is unmodified** — `git diff HEAD -- docs/architecture/` is empty.
- **The architecture gate is unamended**, and all **29** retained seeds still fail.
- `tests/support/jcs1Oracle.ts` is unchanged; `30 §5.3a`'s field order did not move.
- No accepted test was deleted, and no `.only` exists anywhere.

## 8.5 Verification

**Architecture gate: 64 PASS / 0 FAIL, and all 29 retained seeds still fail their intended
conditions. `npm run verify`: GREEN — 147 files, 2057 tests, 2057 passed, 0 failed, 0
skipped.**

Baseline for comparison: 136 files, 1965 tests. **+11 files, +92 tests, and no accepted test
deleted.**

`S1J-result.md §13a` carries the full record, including the diff audit.
