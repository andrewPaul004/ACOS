# S1J — Result

**VERDICT: PASS.**

**Baseline `81c2939` (the OWNER-ACCEPTED v1.3.5 architecture checkpoint). Branch
`feature/s1j-mock-dispatch-outcomes`. Package issue `v1.3.5`, unmodified.**

**MOCK TRANSPORT ONLY. NO REAL ADAPTER, NO NETWORK, NO VENDOR CREDENTIAL, NO PROVIDER
OUTCOME, NO EXTERNAL EXACTLY-ONCE.**

---

## 0. What this document supersedes, and what it does not

**The previous edition of this file recorded `PARTIAL`.** It is superseded in full, and the
reason is worth stating precisely because it is the point of the whole exercise.

S1J's first pass reported three open architecture points and refused to route around any of
them:

| Then | Now |
|---|---|
| **`S1J-C1`** — `25 §10` row 2 required `PRESUMED_EXECUTED` *and* "consume the irrecoverable unit" as one act, no artifact said what the movement was, and **no slice reserved a unit for it to consume** | **CLOSED by MIE-01.** `25 §10.1` declares the five-transition lifecycle, `51 §2.3` declares the per-class unit counts, `24 §3` K5 prints the transition table, and `I20` is rebased on the immutable historical basis |
| **`S1J-C2`** — `24 §3` K4 declared a RESPONSE to an adapter failure with no state, and the response contradicted `25 §7` OBX-01 outright | **CLOSED by OBX-04/OBX-05.** K4's retry is corrected to pre-claim workflow failures; `ADAPTER_FAILED` is declared to reach no state; `NOT_SENT_CONFIRMED` is declared for the case it was reaching for |
| **`S1J-C6`** — `25 §14`'s propose→authorise→**execute** lease span is not achievable across `25 §7`'s own asynchronous outbox | **CLOSED by SER-01.** `25 §14.1` supersedes it with two serialization epochs, an explicitly lock-free gap, and mandatory dispatch-time revalidation |

**Every one of the three was closed by a DECLARATION rather than by a decision this
implementation made.** `phase2-v1.3.5-errata.md §1` records the first in those words: "the
S1J implementation returned PARTIAL rather than inventing a counter." What changed between
the two editions of this file is the architecture, not the implementation's appetite.

**What is NOT superseded.** Every safety property the PARTIAL edition asserted still holds
and is still asserted, unchanged: "never re-dispatch" is enforced by the committed `CLAIMED`
row on every branch; no local quantity substitutes for a provider-reported count; there is no
network, no credential and no vendor anywhere under `src/`.

---

## 1. Verdict

**PASS**, against `§45`'s thirty-one criteria. Each is answered in `§13` below.

**No owner decision remains unresolved**, and **no new normative omission was found.** Four
implementation decisions were required and all four are recorded in
`S1J-owner-clarifications.md` as decisions rather than as readings — `S1J-C7` through
`S1J-C12`.

---

## 2. Baseline

| | |
|---|---|
| Required HEAD | `81c2939` |
| Actual HEAD at start | `81c2939` |
| Branch | `feature/s1j-mock-dispatch-outcomes` |
| Worktree at start | clean |
| Implementation predecessor | `f1f849a` |
| Continuation implementation commit | `7e22ae8` |
| `src/` and `tests/` at `81c2939` vs `f1f849a` | **identical** — `git diff f1f849a..81c2939 -- src tests` is empty |
| Architecture gate at baseline | **64 PASS / 0 FAIL** |
| `npm run verify` at baseline | **136 files, 1965 tests, 1965 passed, 0 failed, 0 skipped** (688s) |

The baseline verify was run from a **stashed clean tree** at `81c2939`, so the figures above
are the accepted state's and not a partially-edited one's.

---

## 3. Architecture

| | |
|---|---|
| Package | `docs/architecture/v1.3.5/`, issue v1.3.5 |
| v1.3.5 modified? | **NO.** `git status --porcelain docs/architecture/` is empty and `git diff HEAD -- docs/architecture/` is empty |
| Architecture gate after implementation | **64 PASS / 0 FAIL** |
| Retained seeds | **all 29 re-run; every one still fails its intended conditions** (16 pre-v1.3.5 seeds plus v1.3.5's 13) |
| New architecture condition required? | **NO** |
| New normative conflict found? | **NO** |

**No seed was disarmed and no condition was added.** The thirteen v1.3.5 seeds that exist
precisely to catch this slice's defects — `--seed-no-mie-reservation`,
`--seed-unknown-releases-mie`, `--seed-unknown-to-realised`, `--seed-caller-mie-units`,
`--seed-i20-current-balance`, `--seed-returned-awaiting-irrecoverable`,
`--seed-not-sent-as-never-sent`, `--seed-known-failure-requeues`, `--seed-old-one-session`,
`--seed-optional-dispatch-lease`, `--seed-no-dispatch-revalidation`,
`--seed-gap-mutation-dispatches`, `--seed-swap-outcome-fields` — each still fail.

---

## 4. MIE reservation

| | |
|---|---|
| Catalogue unit | `ActionCatalogueEntry.irrecoverableUnits: bigint`, `51 §2.3`'s table transcribed. `1` for `fulfilment.reship`; `0` for `campaign.pause`, `refund.create`, `campaign.budget.set`. A load-time coherence check refuses any other pairing |
| Not caller-supplied | `irrecoverableUnitsFor(actionClass)` takes one `ActionClass` and nothing else. No request type on the reservation or dispatch path carries the field — `tests/type-negative/mie-units-as-argument.ts` asserts six refusals and three compiling cases |
| No implicit default | an uncatalogued class **throws**; a catalogued class with no value cannot compile |
| Step-R writer | `reserveOrdinary` → `applyIrrecoverableReservation`, inside the accepted S1F transaction, in the SAME loop as the monetary/count reservation over the SAME `request.windows` |
| Applicable windows | **every referenced instance**, because the loop is the same one — there is no second window set and no filter between them |
| Reservation evidence | `reservation_window_instance.irrecoverable_units`, append-only against `UPDATE` (`0013`) |
| `I20` denominator | `i20_authorised_irrecoverable_units`, a view over committed immutable rows only. It reads **no balance column**, so it is invariant under PRESUME, REALISE and RELEASE |
| Final-unit race | **exactly one commits, exactly one is denied**, the ceiling is reached **exactly**, no oversubscription, no `40P01` |
| Lock order | the accepted `acquireMoneyPathLocks`, unchanged. No second acquisition site exists — `lock-order.test.ts` reads the source tree and would fail if one appeared |
| S1F atomicity | the accepted kill-point matrix is unchanged and green; the MIE outcome transaction has its own six-point matrix (`§13` below) |

**One pre-existing field is disclosed rather than folded in.**
`26 §2.1`'s exposure block has carried `irrecoverableUnits: KernelComputed<number>` since
S1B — "COMPUTED from the class, not supplied" — and `refundCreate.ts` writes `computed(0)`
into it, which agrees with `51 §2.3`'s `0` for a COMPENSABLE class. **Step R does not read
it.** The reservation resolves the count from the closed catalogue by action class, because
`51 §2.3` makes the catalogue the owner and a figure travelling on a per-request block is a
second place it could disagree with itself. The field is kernel-branded, so no caller can
set it either way; it is recorded here so a reader does not mistake it for an unnoticed
second source.

---

## 5. IRRECOVERABLE outcome

| | |
|---|---|
| `OUTCOME_UNKNOWN` state | **`PRESUMED_EXECUTED`** |
| `ADAPTER_RETURNED` state | **`PRESUMED_EXECUTED`** — `25 §7.1`'s correction, NOT `DISPATCHED_AWAITING_VERIFICATION` |
| Movement | `MIE_RESERVED_TO_PRESUMED`, on every bound window instance |
| Statement shape | **ONE `UPDATE` moving both terms.** `25 §10.1`: "no transaction may expose transient headroom" |
| Headroom | **NONE.** The three-term sum is asserted equal before and after, per window, as a computed value |
| Duplicate | sequential, concurrent, and restart-after-commit all move the unit **exactly once** |
| Kill points | six reachable points, every one returning the exact pre-outcome state. The seventh is unreachable **by construction** and that is asserted over the source |
| Isolation | `SERIALIZABLE`, asserted at the connection before the first balance lock |

**The two informative cells agree exactly**, which is the property OBX-04's second correction
is about: `irrecoverable-outcome-matrix.test.ts` asserts the equality of the two results
rather than asserting each independently.

---

## 6. `NOT_SENT_CONFIRMED`

| | |
|---|---|
| Adapter proof | a **closed two-member typed enum** (`NOT_SENT_BASES`), transcribed from `25 §7.2`. No message, no error, no code, no detail field exists on the outcome |
| Genuine basis | the mock's `failBeforeSend` returns **before its acceptance point**, so `acceptedCount` stays at 0 — the control-flow proof `25 §7.2` requires |
| Resulting state | **`DISPATCH_NOT_SENT_CONFIRMED`**, for every recoverability class |
| Money release | `RESERVATION_RELEASED` — the same two terms step R moved, by the same amounts, on the same bound instances; **nothing is realised** |
| MIE release | `MIE_RESERVED_RELEASED` — `reserved -= units`, **no presumed and no realised increment** |
| Evidence | `exposure_reservation.released_at` / `released_reason`, one-way by trigger |
| Same-row retry | **impossible.** The row stays `CLAIMED`, a second claim is `ALREADY_CLAIMED` at any later instant, and a second dispatch reaches no adapter |
| `NEVER_SENT` | **not the state, and not writable** — the schema refuses it |
| False-not-sent control | discriminates: escaped-then-mapped releases the commitment; production presumes it and the sum holds |

---

## 7. Async serialization

### Epoch A

| | |
|---|---|
| Lease | unchanged. The accepted session-scoped `EntityLeaseManager` |
| Span | C′ → pre-reservation authority → local authorisation → COMMIT |
| Regression | every accepted lease-continuity test is green and unamended |

### The gap

| | |
|---|---|
| Lease held? | **NO — and that is the declared property.** Asserted from a separate PostgreSQL session: `pg_try_advisory_lock` SUCCEEDS between the authorising COMMIT and the dispatch |
| Renewal daemon | none. No connection is held, no handover token exists |
| Immutable protections | the canonical effect; the persisted payload, bound to the authorised hash and never rebuilt; content-addressed option identity; non-reclaimable outbox semantics; mandatory dispatch revalidation |

### Epoch B

| | |
|---|---|
| Entity key | `entityKeyForResourceRef`, derived from the committed `resource_ref`. **Proved equal to Epoch A's** by `advisoryLockKey` equality, and proved non-vacuous by a different resource |
| Name | `dispatch lease` — a distinct type with `epoch: 'B'`. An Epoch-A `HeldEntityLease` is not accepted anywhere on the dispatch path |
| Revalidation | mandatory, before the claim, under the lease. Takes a `HeldDispatchLease` so it **cannot** be called outside one |
| Claim | the accepted S1I service, on the lease's own connection |
| Adapter | invoked outside every transaction, after the claim COMMIT |
| Outcome | on the lease's own connection, `SERIALIZABLE` where it moves the ledger |
| Continuous-lease proof | the lock is observed **HELD from a separate session at five points** — after revalidation, after the claim COMMIT, inside the adapter, inside the outcome transaction, and after the outcome COMMIT — and **FREE afterwards** |

### Attacks

| Attack | Result |
|---|---|
| Stale gap mutation | production refuses before the claim, **zero adapter invocations**, row still `ENQUEUED`, commitment untouched. The unsafe path claims and invokes |
| Competing entity mutation | a real competitor blocking on the same advisory lock acquires it **only after the outcome COMMIT**, measured by ordering rather than by timing |
| Crash after claim COMMIT | row stays `CLAIMED`, capability gone, lease released by the database, nothing dispatched, unit still reserved |
| Crash after the adapter | the request may have escaped; nothing recorded; no reclaim at any later instant |
| Old `CLAIMED` + new lease | the lease **is** reacquirable (half one) and grants **nothing** (half two). The unsafe path dispatches from the persisted row alone |

---

## 8. Outcome matrix

| Adapter result | REVERSIBLE | COMPENSABLE | IRRECOVERABLE |
|---|---|---|---|
| `ADAPTER_RETURNED` | `DISPATCHED_AWAITING_VERIFICATION` / `NONE` | `DISPATCHED_AWAITING_VERIFICATION` / `NONE` | **`PRESUMED_EXECUTED`** / `MIE_RESERVED_TO_PRESUMED` |
| `OUTCOME_UNKNOWN` | `DISPATCHED_OUTCOME_UNKNOWN` / `NONE` | `DISPATCHED_OUTCOME_UNKNOWN` / `NONE` | **`PRESUMED_EXECUTED`** / `MIE_RESERVED_TO_PRESUMED` |
| `NOT_SENT_CONFIRMED` | `DISPATCH_NOT_SENT_CONFIRMED` / `RESERVATION_RELEASED` | `DISPATCH_NOT_SENT_CONFIRMED` / `RESERVATION_RELEASED` | `DISPATCH_NOT_SENT_CONFIRMED` / `MIE_RESERVED_RELEASED` |
| `ADAPTER_FAILED` | UNDECLARED — no state | UNDECLARED — no state | UNDECLARED — no state |

**Same-row redispatch: NO, on every cell.** The type of `redispatchPermitted` is the literal
`false`, so a branch that permitted one would not compile.

All twelve cells are exercised **twice**: as a pure function against the hand-authored table,
and as committed database state after a real claim, a real invocation and a real outcome
transaction.

---

## 9. C3 / C4 / C5

| | |
|---|---|
| **C3** | **Confirmed still aligned, no work required.** `25 §7.1`: "the post-dispatch status is carried by the outcome row". `outcomeTransaction.ts` writes no `effect` row on any branch, and the append-only trigger would refuse it |
| **C4** | **Implemented exactly**, with the database's own biconditionals per cell. `ADAPTER_FAILED` cannot be paired with **any** status |
| **C5** | **Complete.** `30 §5.3a`'s twenty-field order was already transcribed in both planes at `f1f849a` and is unchanged by v1.3.5; the domains widened in both planes independently |
| Owner decisions remaining | **none** |

---

## 10. JCS / audit

| | |
|---|---|
| Outcome row kind | `acos.journal.dispatch_outcome.v1` |
| Field order | twenty fields, positional, no map and no insertion-order dependence |
| Control plane | `0013` widens the two domain CHECKs and **redefines no canonical-bytes function**, so every chained row recomputes to the `row_hash` it holds |
| Audit plane | `A0008`, written from `25 §7.1`'s table and **not** from the control migration, with two biconditionals of its own |
| Oracle | `tests/support/jcs1Oracle.ts`, hand-authored, unchanged |
| Swapped-order negative | retained and green — fields 15/16 |
| Audit outage / replay | the accepted S1G post-COMMIT replication path is unchanged and green |
| MIE quantity on the row | **none, and none may be** — `25 §10.1`: "the outcome row records the state that implies the movement; the ledger records the movement" |

---

## 11. `I20` / `I36` / VC-C3

| Item | Status |
|---|---|
| **`I20` ACOS-side denominator** | **STRUCTURALLY IMPLEMENTED.** Reconstructable from committed immutable evidence, invariant under `reserved → presumed`, proved by a fixture that reserves one unit, moves it, observes `reserved_irrecoverable = 0`, and reads the same denominator |
| **`I20` runtime comparison** | **OPEN.** No provider-side audit read exists. **No mock `acceptedCount` is used as `I20` evidence anywhere**, and `no-real-transport-boundary.test.ts` asserts the identifier's absence from `src/` |
| **`I36` enforcement leg** | closed and unchanged — no claimed identity is ever retried, on any outcome |
| **`I36` verification leg** | **OPEN.** `44 §5.2`'s six kill points against a real ESP sandbox, measured by the provider's own accepted count |
| **VC-C3(a)** | closed and unchanged — content-addressed selector non-substitution |
| **VC-C3(b)** | **closed by this slice** — both epochs' exclusions and the no-stale-effect-across-the-gap clause, each measured from a separate session |
| **VC-C3(c)** | **closed by this slice** — the MIE lifecycle's atomicity and its must-fail seeds |
| **VAL-04** | **UNDISCHARGED.** Duplicate prevention at the dispatch boundary is a vendor property |

---

## 12. Negative controls

All fourteen accepted S1J controls are **retained and still discriminating**. The v1.3.5
controls are added in three new modules.

| # | Attack | Vulnerable | Production | Discriminates? |
|---|---|---|---|---|
| 1 | IRRECOVERABLE authorised without reserving | ledger says nothing committed | evidence still proves one authorised unit | **YES** — the two diverge |
| 2 | Unknown changes state, unit stays reserved | three-term sum RISES | sum UNCHANGED | **YES** |
| 3 | Unknown RELEASES the unit | sum FALLS; headroom appears | sum UNCHANGED | **YES** |
| 4 | Unknown moves `reserved → realised` | asserts provider truth nothing established | `reserved → presumed` | **YES** |
| 5 | Duplicate outcome consumes twice | 3 presumed units for one effect | exactly 1 | **YES** |
| 6 | Two-transaction movement | transient headroom **observed from another session** | one statement, no interval | **YES** |
| 7 | Application-only final-unit admission | both racers admit | the DB guard admits one | **YES** |
| 8 | False `NOT_SENT` after the request escaped | commitment RELEASED | `reserved → presumed`, sum holds | **YES** |
| 9 | Generic claimed failure → requeue | **two adapter invocations for one effect** | second claim `ALREADY_CLAIMED`, one invocation | **YES** |
| 10 | Stale effect dispatched across the gap | claims and invokes | refuses before the claim, zero invocations | **YES** |
| 11 | Old `CLAIMED` + new dispatch lease | dispatches from the persisted row | `CLAIM_REFUSED`, zero invocations | **YES** |
| 12 | C4 wrong IRRECOVERABLE state | — | refused by the database's biconditional | **YES** |
| 13 | C5 wrong row order | — | membership passes, positional/hash fails | **YES** |

**Control 9 needed to defeat THREE independent database controls to run**, and the third one
held: the outbox state-machine trigger and the outcome table's append-only trigger were both
disabled by hand, the outcome record was erased, and `0002`'s non-negativity CHECK still
refused the second accounting. `36 §0`'s single-mechanism rule, earning its keep.

---

## 13. `§45`'s thirty-one criteria

| # | Criterion | Answer |
|---|---|---|
| 1 | HEAD began at `81c2939` | YES |
| 2 | v1.3.5 authoritative and unchanged | YES |
| 3 | IRRECOVERABLE step R reserves MIE | YES |
| 4 | Final-unit race cannot oversubscribe | YES |
| 5 | Unknown IRRECOVERABLE reaches `PRESUMED_EXECUTED` | YES |
| 6 | Adapter-returned IRRECOVERABLE reaches `PRESUMED_EXECUTED` | YES |
| 7 | `reserved → presumed` is atomic | YES — one statement, one transaction |
| 8 | No headroom on unknown | YES — asserted as a computed sum |
| 9 | Duplicate outcome does not double consume | YES — three ways |
| 10 | `NOT_SENT_CONFIRMED` exists and is narrowly derived | YES — closed typed enum, control-flow proof |
| 11 | Unknown cannot masquerade as not-sent | YES |
| 12 | `NOT_SENT` releases the appropriate commitment | YES — per class |
| 13 | Claimed outbox identity is never requeued | YES |
| 14 | Epoch A intact | YES |
| 15 | Async gap holds no session lock | YES — observed from a separate session |
| 16 | Epoch B reacquires the SAME entity lock key | YES — equality proved |
| 17 | Revalidation occurs before the claim | YES — structurally, and by event order |
| 18 | Stale authorised option refuses the claim | YES |
| 19 | Dispatch lease spans through the outcome COMMIT | YES — five observations |
| 20 | Entity mutation cannot intervene during Epoch B | YES — real competitor |
| 21 | Old `CLAIMED` + new lease still cannot dispatch | YES |
| 22 | Fresh claim capability still required | YES |
| 23 | C4 matrix matches v1.3.5 | YES |
| 24 | C5 row order proved independently | YES |
| 25 | `I20` denominator structurally available | YES |
| 26 | `I20` provider comparison remains OPEN | YES |
| 27 | Real-provider `I36` remains OPEN | YES |
| 28 | No real network exists | YES |
| 29 | Architecture gate 64/64 | YES |
| 30 | `npm run verify` green | YES |
| 31 | No owner decisions remain unresolved | YES |

**None of `§45`'s five FAIL conditions holds:** claimed work is not retryable; unknown
IRRECOVERABLE does not release MIE; a stale async-gap effect does not dispatch; two workers
cannot oversubscribe MIE; a persisted old `CLAIMED` row cannot be dispatched after a restart.

---

## 13a. Verification

| | |
|---|---|
| Architecture gate | **64 PASS / 0 FAIL** |
| Retained seeds | **29 run, every one still failing its intended conditions** |
| `npm run typecheck` | GREEN |
| `npm run lint` | GREEN, zero warnings |
| Test files | **147** (baseline 136, **+11**) |
| Tests | **2057** (baseline 1965, **+92**) |
| Passed | **2057** |
| Failed | **0** |
| Skipped | **0** |
| `.only` | none |
| Focused S1J suites | 11 new, plus every accepted S1J suite retained |
| Real PostgreSQL | every concurrency, atomicity and authoritative-state property |

**No accepted test was deleted.** Nine accepted assertions were SUPERSEDED by v1.3.5 and
each was replaced by the property the new declaration makes true — the full list, with what
replaced what, is `S1J-test-matrix.md §8.3`.

**Two accepted assertions caught real defects in this pass and neither was weakened:** the
bare-`COMMIT` sweep caught prose in an error message, and the gateway's forbidden-import list
caught the distinction between the ledger's MOVEMENT functions (admitted) and `stepR.ts`
(still forbidden — one moves a declared commitment, the other would mint one).

**One accepted refusal literal was renamed** because it collided with `26 §12`'s
approval-resume vocabulary: `MIE_RESERVATION_ABSENT` became `MIE_UNITS_NOT_RESERVED`. The
sweep was right and was not amended.

---

## 14. No real execution

| | |
|---|---|
| HTTP | **NO** |
| Real adapter | **NO** — `src/` contains no `ExternalEffectAdapter` implementation |
| Credentials | **NO** |
| Provider sandbox | **NO** |
| Provider query / webhook | **NO** |
| Reconciliation | **NO** |
| External exactly-once claimed | **NO** |
| `VERIFIED` / `NEVER_SENT` in `src/` | **NO** — and no schema arm admits either |

---

## 15. Remaining obligations

Carried forward unchanged, none of them discharged by this slice:

| Item | Status |
|---|---|
| `I20` runtime comparison | **OPEN** — requires the audit plane's own ESP read credential |
| `I36` verification leg | **OPEN** — six kill points against a real sandbox |
| Provider resolution (`VERIFIED`, `NEVER_SENT`) | **UNBUILT BY DECLARATION** |
| `I8` | **OPEN** |
| Control-artifact class 3 signature | **OWED** (from v1.3.3) |
| Control-artifact class 17 signature | **OWED, extended by `51 §2.3`** |
| Control-artifact class 20 signature | **OWED, extended a third time** |
| Control-artifact class 27 signature | **OWED** (from v1.3.3) |
| Runtime `I19` | **OPEN** — no production owner-signing mechanism |
| `O4` | **OPEN** |
| Production key management | **OPEN** |
| VAL-04 | **UNDISCHARGED** |

**The pre-live gate remains mandatory.** No real transport may be enabled.

---

## 16. Recommended next slice

**S1K.**
