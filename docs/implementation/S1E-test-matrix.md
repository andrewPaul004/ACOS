# S1E — Test Matrix

Baseline `0054e5f`: 58 files, 756 tests. After S1E: **66 files, 901 tests**, all passing.
S1E contributes **8 files and 145 tests**; the accepted 756 are all present and unchanged.

---

## 1. The S1E suites

| File | Real PG | Tests | What it proves |
|---|---|---|---|
| `tests/integration/authority/pre-reservation-pipeline.test.ts` | **yes** | 61 | `26 §7` D–N end to end from real rows; per-gate denials; per-gate positive controls; the coarse worker surface |
| `tests/integration/authority/denial-ordering.test.ts` | **yes** | 11 | Multi-failure fixtures; the earlier gate determines; the worker surface stays coarse under multi-failure |
| `tests/integration/authority/lease-continuity.test.ts` | **yes** | 3 | One backend holds the advisory lock across the whole sequence; a competing session parked in the lock queue cannot pass; the lock is released at the end |
| `tests/integration/authority/authoritative-state-integrity.test.ts` | **yes** | 14 | `I5` generated-column grade derivation; the schema's CHECK constraints; canonical-effect immutability under aliased mutation |
| `tests/negative-controls/authority-controls.test.ts` | **yes** | 17 | Five attacks, each run through a vulnerable implementation that ACCEPTS it and the production one that REJECTS it |
| `tests/authority/authority-channel-attacks.test.ts` | no | 22 | Source rules: no authority bag, no caller-supplied operand, one Cedar path, no step-R/audit/outbox/network code, coarse worker surface, `26 §7` order, `26 §6` list |
| `tests/authority/authority-type-boundary.test.ts` | no | 8 | A real `tsc` run: no caller-supplied authority operand compiles; an S1E pass is not dispatchable |
| `tests/authority/evidence-independence.test.ts` | no | 9 | `24 §13` independence against a hand-counted oracle |

**Real-PostgreSQL S1E tests: 106 of 145.** Every property that depends on authoritative
persisted state, on grade derivation, on identity, on locking or on cross-session observation
runs against the real database. Nothing is mocked: no in-memory map, no SQLite, no mocked SQL,
no fake advisory lock, no JavaScript mutex, no sequential promises standing in for
concurrency.

---

## 2. The fail-closed attack matrix

The mandate's nineteen required cases, with where each is proven and whether a discriminating
vulnerable control exists.

| # | Attack | Test | Discriminating control |
|---|---|---|---|
| 1 | Caller-supplied / spoofed principal | `authority-controls.test.ts` attack 1 (4) | **yes** — `unsafe-caller-supplied-principal.ts` |
| 2 | Categorical prohibition, every other operand favourable | `authority-controls.test.ts` attack 4 (3) | **yes** — `unsafe-appealable-prohibition.ts` |
| 3 | Active kill switch | `pre-reservation-pipeline.test.ts` §step F | positive control (same fixture passes with the switch clear) |
| 4 | Missing authoritative platform status | §step F | positive control; indistinguishable at the worker from an engaged switch |
| 5 | Model-supplied precondition value overriding stored state | §steps G–H″ "fetched for the KERNEL-RESOLVED resource"; type-negative `authority-operand-supplied.ts` | compile failure |
| 6 | Asserted high grade from an untrusted origin | `authority-controls.test.ts` attack 2 (3); `authoritative-state-integrity.test.ts` `I5` (4) | **yes** — `unsafe-precondition-evaluator.ts`, plus PostgreSQL itself refusing an asserted grade |
| 7 | Open contradiction | `authority-controls.test.ts` attack 2 (2); §steps G–H″ (3) | **yes** — `unsafe-precondition-evaluator.ts` |
| 8 | Delegated decision laundering into monetary authority | §steps G–H″ (2, with the DECISION_OWNER sibling) | schema CHECK + the owner-decided sibling that PASSES |
| 9 | Missing grant | §step I | positive control |
| 10 | Expired grant | §step I | positive control |
| 11 | Grant scope mismatch (resource, role) | §step I (2) | positive control |
| 12 | Narrower grant restriction vs broader concurrent grant | §step I (2); `authority-controls.test.ts` attack 3 (3) | **yes** — `unsafe-permissive-grant-union.ts` |
| 13 | Counterparty / value-direction / novelty attack | `counterparty.ts` fails closed in both directions; happy path asserts applicability from the catalogue | structural (no `destination_id` exists to attack) |
| 14 | Missing required evidence | §step L (6) | positive control (two independent sources PASS) |
| 15 | Autonomy authority exhausted | §step N (7) | positive control |
| 16 | Cedar `PER_ACTION` denial after all earlier gates pass | §step M (2) | the accepted S1D `unsafe-vendor-amount-policy.ts`, still green |
| 17 | Multiple simultaneous denials — deterministic ordering | `denial-ordering.test.ts` (10) | mirrored pairs (H-before-H′ and H′-before-H″ both asserted) |
| 18 | Malformed / missing authoritative state | `authoritative-state-integrity.test.ts` (6); §steps F, G, I, N | PostgreSQL CHECK constraints |
| 19 | Release / reacquire lease bug | `authority-controls.test.ts` attack 5 (2); `lease-continuity.test.ts` (3) | **yes** — `unsafe-lease-reacquire.ts` + `pg_locks` + `pg_backend_pid()` |

**Vulnerable controls: 5 new** (`unsafe-caller-supplied-principal.ts`,
`unsafe-precondition-evaluator.ts`, `unsafe-permissive-grant-union.ts`,
`unsafe-appealable-prohibition.ts`, `unsafe-lease-reacquire.ts`), joining the 4 accepted ones
(`unsafe-positional-selector.ts`, `unsafe-retained-fee-escape.ts`, `unsafe-schema.ts`,
`unsafe-vendor-amount-policy.ts`). **Total 9.** None is reachable from `src/`.

---

## 3. Deterministic denial ordering — the multi-failure cases

Expected order transcribed in the test file from `26 §7`'s flowchart, not read from
`steps.ts`:

`D → E → F → G → H → H′ → H″ → I → J → K → L → M → N → P`

| Simultaneous failures | Expected first gate | Asserted |
|---|---|---|
| suspended principal + kill switch | **D** | step `D`, `stepsEvaluated = ['D']` |
| kill switch + failing precondition | **F** | step `F`, `stepsEvaluated = ['D','E','F']` |
| open contradiction + delegated grade | **H′** | step `H′`, code `PRECONDITION_CONTRADICTED` |
| failing precondition + open contradiction | **H** | step `H` — the mirror, so the order is real in both directions |
| expired grant + exhausted autonomy | **I** | step `I`, and the outcome is a DENIAL rather than `REQUIRE_APPROVAL` |
| narrowed recoverability + unmeetable evidence | **J** | step `J` |
| unmeetable evidence + over-cap exposure | **L** | step `L`, and `lineage === null` because Cedar never ran |
| over-cap exposure + exhausted autonomy | **M** | step `M`, code `PER_ACTION` |
| widened delegation subset + kill switch + expired grant | **D** | step `D`, detail `DELEGATION_SUBSET_WIDENED` |
| all eight broken at once | **D** | step `D`, `stepsEvaluated = ['D']` |

Worker-facing output for each remains one frozen field carrying one `26 §7` category, with
no step, no detail, no lineage, no grant id, no fact id and no session id.

---

## 4. Entity-lease evidence

| Observation | Mechanism | Result |
|---|---|---|
| Advisory-lock primitive | `pg_advisory_lock(int, int)` — SESSION scope, on the lease's own checked-out connection (accepted S1C `entityLease.ts`, unchanged) | held |
| Backend identity at three points | `pg_backend_pid()` on `lease.client`: at acquisition, inside the post-step-P barrier, after the sequence | all three equal |
| Lock holder at the barrier | `pg_locks` read from a THIRD connection | exactly one GRANTED row, pid = the lease's backend |
| Competing session | a second connection parked in a BLOCKING `pg_advisory_lock` from before the first gate | UNGRANTED at the barrier; granted only after the span ends |
| Release / reacquire | sampled INSIDE the span: had A released at any instant, B — already queued — would have been granted | `competitorAcquiredByBarrier === false` |
| One lease id across the span | `leaseIdAtStart === leaseIdAtEnd` | equal; the unsafe control produces two distinct ids |
| Released afterwards | `isEntityLockFree` from a separate session | `false` during, `true` after |

---

## 5. Accepted regression state

| Slice | Status |
|---|---|
| S1A — exposure ledger, four-term guard, lock order, `40P01`, standing | all green, untouched |
| S1B — `I21` type boundary, constructor versioning, canonicalisation | all green; two fixture literals corrected for `26 §3`'s principal kinds |
| S1C — live enumeration, content-addressed selectors, CAN-03, entity lease | all green, untouched |
| S1D — real Cedar, VC-C1 `PER_ACTION`, `vendor_amount` negative control | all green, untouched; the policy artifacts and their digest are byte-identical |

Accepted tests deleted: **0**. Skipped: **0**. Weakened: **0**. `.only`: **0**.
The single accepted-test edit is the type-negative directory listing in
`i21-type-boundary.test.ts`, widened by exactly two filenames — the same, documented device
S1D used when it added three.
