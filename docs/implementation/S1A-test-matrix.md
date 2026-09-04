# S1A Test Matrix

Every test in the S1A suite, and what it does: **PROVES** a property, **ATTACKS** it, or
**NEGATIVELY CONTROLS** it (deliberately fails, to show the assertion can see the defect).

**Run result: 14 files, 139 tests, all passing, against real PostgreSQL 16.9.**
`npm run verify` = typecheck + lint + full suite. Typecheck clean, lint clean at
`--max-warnings 0`.

Legend:

| Kind | Meaning |
|---|---|
| **PROVE** | Asserts the property holds in the production path |
| **ATTACK** | Tries to break the property and asserts the refusal |
| **NEG-CTL** | A deliberately defective path that MUST fail the assertion battery. If it passes, the corresponding PROVE test proves nothing |
| **ORACLE** | Checks the independent oracle itself, against the architecture's printed answers |

---

## 1. `tests/integration/exposure/schema-conformance.test.ts` — 10 tests

Everything read from the **running database** via `information_schema` and `pg_constraint`,
never from the migration files.

| # | Test | Kind | Architecture |
|---|---|---|---|
| 1 | `window_balance` is keyed `(company_id, window_id, window_instance_key)` | PROVE | `24 §3` K5, TB-02 |
| 2 | the four monetary terms exist, `NUMERIC`, `NOT NULL` | PROVE | `24 §3` K5 |
| 3 | the four count terms exist | PROVE | `24 §3` K5 |
| 4 | the three irrecoverable terms exist and **`standing_irrecoverable` does NOT** | PROVE | `24 §3` K5; log `§3` |
| 5 | the per-ledger non-negativity `CHECK` is installed | PROVE | `24 §3` K5 |
| 6 | no money ceiling is nullable | PROVE | `26 §10.1` |
| 7 | `standing_window_exposure` is keyed `(sa_id, window_id, instance_key)` | PROVE | `24 §3` K5 |
| 8 | the two authoritative primitives and `instance_in_scope` are `NOT NULL` | PROVE | `24 §3` K5 |
| 9 | the registry **refuses** a `ROLLING` window | ATTACK | `51 §2.1`, VC-S1 |
| 10 | every fixture window is `DISCRETE` | PROVE | `51 §2`, VC-S1 |

## 2. `tests/integration/exposure/vc-s7-first-rate-authorisation.test.ts` — 9 tests

**VC-S7. A stop condition: a denial here is TB-03 reintroduced and S1A halts.**

| # | Test | Kind | Architecture |
|---|---|---|---|
| 1 | **the first `campaign.budget.set` in a clean 31-day January PERMITS** | PROVE | `36 §2` VC-S7, TB-03 |
| 2 | the window was empty before it — the "clean" precondition | PROVE | VC-S7 |
| 3 | `reservation.amount == total_exposure == 0.00`, `I18b` exact | PROVE | `26 §2.1.3`, `I18b` |
| 4 | `vendor_amount IS NULL`; fixture `dispatch_payload.monetary_effect IS NULL` | PROVE | `I18a` null branch |
| 5 | `forward_integral` is a separate field, never the reservation amount | PROVE | v1.3.1 E1 |
| 6 | four-term sum on MONTH = **$186.00 ≤ $186.00** | PROVE | `26 §2.1.3` worked example |
| 7 | four-term sum on DAY = **$12.00 ≤ $12.00** | PROVE | `26 §2.1.3` worked example |
| 8 | an independent observer never sees standing absent — both rows in ONE transaction | ATTACK | `26 §2.1.3` |
| 9 | the `StandingRevocationAuthority` exists at zero monetary, created by `KERNEL` | PROVE | `I55`, `24 §3` K5 |

## 3. `tests/integration/exposure/commitment-guard.test.ts` — 16 tests

**Every case writes raw SQL through `pg`. `src/kernel/exposure` is not called**, which is
the strongest available form of VC-L2's *"at the database, not in application code"*.

| # | Test | Kind | S1A-8 item |
|---|---|---|---|
| 1 | ordinary reservation alone, to the ceiling | PROVE | 1 |
| 2 | standing exposure alone, to the ceiling | PROVE | 2 |
| 3 | `PRESUMED_SETTLED` alone, to the ceiling | PROVE | 3 |
| 4 | realised alone — not gated by the commitment predicate | PROVE | 4 |
| 5 | all four together, summing exactly to the ceiling | PROVE | 5 |
| 6 | exact boundary: a commitment landing on the ceiling permits | PROVE | 6 |
| 7 | one cent below the ceiling permits | PROVE | 7 |
| 8 | one cent above via **reserved** — REFUSED | ATTACK | 8 |
| 8b | one cent above via **standing** alone — REFUSED | ATTACK | 8, TB-01 |
| 8c | one cent above via **presumed** alone — REFUSED | ATTACK | 8 |
| 8d | each term within the ceiling, the SUM over by one cent — REFUSED | ATTACK | 8 |
| 9 | a realised observation **above** the ceiling is RECORDED; `WINDOW_CEILING_BREACHED` raised on the `FINANCIAL_TRUTH` path, not `SECURITY` | PROVE | 9, `24 §3` K5 |
| 10 | after a realised overage every commitment is refused, and financial truth stays writable | ATTACK + PROVE | 10 |
| 11 | the count ledger binds independently of the monetary ledger | ATTACK | per-ledger guard |
| 12 | an `UNBOUNDED` ceiling admits any commitment | PROVE | `26 §10.1` |
| 13 | a `$0.00` ceiling admits no monetary exposure at all | ATTACK | `26 §10.1`, `51 §2` |

## 4. `tests/integration/exposure/vc-l2-guard-operands.test.ts` — 5 tests

The trigger body is read back out of **`pg_proc.prosrc`** — the source PostgreSQL
compiled — and the summed expression is parsed and compared operand by operand.

| # | Test | Kind | Architecture |
|---|---|---|---|
| 1 | the monetary guard sums **exactly** reserved + standing + presumed + realised | PROVE | VC-L2, TB-01 |
| 2 | the count guard sums exactly the same four | PROVE | VC-L2 |
| 3 | the irrecoverable guard sums the three K5 declares; no `standing_irrecoverable` | PROVE | `24 §3` K5; log `§3` |
| 4 | the commitment predicate names the three commitment terms and **never realised** | PROVE | `24 §3` K5, TB-04 |
| 5 | it is a `BEFORE UPDATE` **row** trigger on `window_balance` | PROVE | `24 §3` K5 |

**This file is the detector for `phase2-v1.3-implementation-brief.md §7` condition 1**
("dropping the standing term from `I3`").

## 5. `tests/integration/exposure/generated-column.test.ts` — 7 tests

| # | Test | Kind | Architecture |
|---|---|---|---|
| 1 | the catalogue reports `GENERATED ALWAYS` with the K5 expression | PROVE | `24 §3` K5, VC-S8 |
| 2 | a direct `INSERT` naming `forward_monetary` FAILS | ATTACK | `24 §3` K5 |
| 3 | a direct `UPDATE` of `forward_monetary` FAILS | ATTACK | `24 §3` K5 |
| 4 | changing the realised primitive moves it: `max(0, 186−18) = 168.00` | PROVE | `24 §3` K5 |
| 5 | it floors at zero when realised exceeds the cap | PROVE | `24 §3` K5 |
| 6 | `Σ max(0, cap−realised) = 60.00` ≠ `max(0, Σcap−Σrealised) = 40.00` | PROVE | `24 §3` K5's rejected transformation |
| 7 | the **database** produces the conservative form, not the collapsed one | PROVE | `24 §3` K5 |

## 6. `tests/integration/exposure/vc-s8-realised-standing-atomicity.test.ts` — 6 tests

**The load-bearing concurrency file.** Deterministic barriers; two real PostgreSQL
backends; a third read-only observer.

| # | Test | Kind | Architecture |
|---|---|---|---|
| 1 | one reconciler statement moves both terms; no intermediate state visible | PROVE | `24 §3` K5, TB-04 |
| 2 | **ORDERING A** — reconciler begins while the authorisation acquires headroom | ATTACK | VC-S8 |
| 3 | **ORDERING B** — authorisation begins while the reconciler records spend | ATTACK | VC-S8 |
| 4 | one cent above the true headroom is refused **across the interleaving** | ATTACK | VC-S8 |
| 5 | realised above `max_monetary` is WRITTEN; `WINDOW_CEILING_BREACHED` **and** `STANDING_OVERDELIVERY`, both on `FINANCIAL_TRUTH`, neither on `SECURITY` | PROVE | `24 §3` K5, VC-S8 |
| 6 | the next commitment against the over-delivered window is refused; truth stays writable | ATTACK + PROVE | `24 §3` K5 |

Tests 2 and 3 each assert all six required properties: no transient headroom (sampled by
an independent observer at every barrier), no lost realised update, no dropped standing
update, no deadlock, correct financial truth, conservative headroom.

## 7. `tests/integration/exposure/vc-s5-window-instance-boundary.test.ts` — 9 tests

| # | Test | Kind | Architecture |
|---|---|---|---|
| 1 | pause on day 3: realised `$18.00`, forward `$168.00`, **retained** for January | PROVE | VC-S5, `24 §3.1` |
| 2 | a **second January** authorisation denies `WINDOW_EXHAUSTED` (`standing=354.00`) | ATTACK | VC-S5, `54 §4.2` |
| 3 | February `standing_monetary = $0.00`, headroom the full `$186.00`, no February row | PROVE | VC-S5, TB-02 |
| 4 | a legitimate **successor** PERMITS in February at `$182.40` (28 days) | PROVE | VC-S5 |
| 5 | a `LIVE` authorisation **does** acquire a February row | PROVE | `24 §3.1` |
| 6 | `PAUSE_PENDING` acquires **no** February row | PROVE | `24 §3.1` |
| 7 | `PAUSED` acquires **no** February row | PROVE | `24 §3.1` |
| 8 | `EXPIRED` acquires **no** February row | PROVE | `24 §3.1` |
| 9 | a `LIVE` authorisation whose in-scope interval has ended acquires no row | PROVE | `24 §3.1` |

**Deferred, with reasons in `S1A-contract.md §5.3`:** the delayed-January-delivery
attribution clause (needs `I22` / `derive_sa_id`, i.e. VC-S6) and the `I55` exemption
clauses (need the revocation-authority sweep).

## 8. `tests/integration/exposure/i62-standing-transitions.test.ts` — 26 tests

| # | Tests | Kind | Architecture |
|---|---|---|---|
| 1–8 | every declared transition T1–T8 succeeds | PROVE | `24 §3.1`, `I62` |
| 9–25 | every **undeclared** `(from, to)` pair is refused by the database | ATTACK | `I62` |
| — | **`REVOKED → EXPIRED` must fail** — called out by name | ATTACK | TB-06, VC-S2 |
| — | `REVOKED` has zero outbound rows in the declared set | PROVE | `I62` |
| — | the refusal comes from the trigger; there is no application check to disable | PROVE | `I62` enforcement |
| 26 | a transition to `REVOKED` without `cessation_verified_at` is refused | ATTACK | `I54`, `51 §3.2` |
| — | **no code path in `src/` sets `cessation_verified_at`** — asserted by walking the source | PROVE | `62 §9` prohibition 3, TB-07 |

## 9. `tests/integration/exposure/lock-order.test.ts` — 6 tests

| # | Test | Kind | Architecture |
|---|---|---|---|
| 1 | **exactly one** `FOR UPDATE` acquisition site in `src/` (source-tree walk, comments stripped) | PROVE | S1A-6, AUD-04 |
| 2 | `declaredOrder` sorts ascending `window_id` then instance key | PROVE | `30 §5.2` |
| 3 | the acquisition sequence issued at the database is the declared one, even when supplied reversed | PROVE | `30 §5.2`, `24 §3` K5 |
| 4 | N=12 concurrent same-window transactions produce **NO deadlock** (asserted with no retry, so a deadlock cannot be absorbed) | PROVE | VC-L2 |
| 5 | with the ACOS-owned retry all 12 commit and the arithmetic is exact (`$0.12`) | PROVE | log `§8`, `I42`/SR-A4 |
| 6 | **reversed acquisition order DOES deadlock** | **NEG-CTL** | registry `I3` test column |

## 10. `tests/integration/exposure/oracle-self-check.test.ts` — 20 tests

The oracle imports nothing from `src/`. This file checks it twice: against the
architecture's printed answers, and differentially against production.

| Group | Tests | Kind |
|---|---|---|
| agrees with `26 §2.1.3`'s worked first authorisation | 1 | ORACLE |
| agrees with `phase2-v1.3.1-verification.md §10`'s recomputation ($186.00 / $182.40) | 1 | ORACLE |
| agrees with `51 §2`'s `$6.00 × 31` worst-case rationale | 1 | ORACLE |
| differential pair vs `standingCap()` for 31/30/29/28-day months and DAY | 5 | ORACLE |
| `51 §3.2` — `meta_ads` UNMEASURED is not autonomy-eligible; `standingCap` refuses it | 3 | PROVE |
| the cessation specification is literally `null`; `cessation_grace = 72 h` | (in above) | PROVE |
| scale-2 arithmetic exact; `0.10 + 0.20 = 0.30`; `fromDb('25.001')` throws | 4 | PROVE |
| window instance keys: `W_MONTH_ADSPEND:2026-01`, DAY form, **company timezone** (UTC vs Tokyo), **DST day is 23 hours**, `W_LIABILITY_OUTSTANDING:LIFETIME` | 5 | PROVE |

---

## 11. The negative controls — `tests/negative-controls/`

**These are the tests that make the rest of the suite mean something.** Each demonstrates
that the assertion battery can see the defect it claims to exclude.

### `repeatable-read-race.test.ts` — 3 tests. **THE MANDATORY ONE.**

The unsafe path (`unsafe-schema.ts`, own PostgreSQL schema, never imported by `src/`) removes
three things by name: the commitment guard (TB-01 shape), the generated column and the
in-statement sync trigger (TB-04 shape), and the row lock plus `SERIALIZABLE` (replaced by
`REPEATABLE READ`).

| # | Test | Kind | Result |
|---|---|---|---|
| 1 | the unsafe path transiently exposes headroom no authorisation created | NEG-CTL | phantom headroom **$126.00** where the true headroom is **$86.00** |
| 2 | **the assertion battery FAILS against the unsafe path** | **NEG-CTL** | `TRANSIENT UNAUTHORISED HEADROOM: … four-term sum of 226.00 against a ceiling of 186.00` — over by exactly the $40.00 that briefly vanished |
| 3 | the SAME battery PASSES when the observation is applied atomically | PROVE | the battery is not simply broken |

```
safe implementation:      PASS
unsafe negative control:  EXPECTED FAILURE OBSERVED
```

**`phase2-v1.3-implementation-brief.md §7` condition 4 is NOT triggered.**

### `three-term-guard.test.ts` — 2 tests

| # | Test | Kind | Result |
|---|---|---|---|
| 1 | a guard omitting the standing term admits a commitment into a fully-committed window | **NEG-CTL** | committed `$186.00` into a window already holding `$186.00` of standing → sum **$372.00** against a `$186.00` ceiling |
| 2 | the **production** four-term guard refuses the identical write | PROVE | `ACS03`, nothing moved |

### `forward-integral-as-reservation.test.ts` — 3 tests

| # | Test | Kind | Result |
|---|---|---|---|
| 1 | double-counting `forward_integral` DENIES the first rate authorisation | **NEG-CTL** | `term 1 186.00 + term 2 186.00 = 372.00 > 186.00` — TB-03 reproduced, so VC-S7's PERMIT is discriminating |
| 2 | nothing was committed by the denied transaction | PROVE | both terms `0.00` |
| 3 | the schema itself refuses a rate-class row whose amount is the forward integral | ATTACK | `rate_class_zero_reservation` / `e1_forward_integral_is_not_the_reservation` |

---

## 12. `spikes/durable-execution/spike.test.ts` — 16 tests

Real OS child processes, `SIGKILL`, both candidates over the same work item. Full matrix in
`ADR-IMP-002-durable-execution.md §2`.

| # | Test | Kind |
|---|---|---|
| 1 | candidate B baseline, no kill | PROVE |
| 2–6 | candidate B: kills at `BEFORE_TX`, `AFTER_LOCKS`, `AFTER_ROWS_BEFORE_COMMIT`, `AFTER_CHECKPOINT`, `AFTER_COMMIT`, each followed by recovery | ATTACK |
| 7 | candidate B: concurrent retry of the same work item | ATTACK |
| 8–9 | **TB-04 interleaving through the durability layer, both orderings** | ATTACK |
| 10 | candidate A baseline, and what DBOS requires to run | PROVE |
| 11–13 | candidate A: kills at `AFTER_ROWS_BEFORE_COMMIT`, `AFTER_CHECKPOINT`, `AFTER_COMMIT`, each followed by recovery | ATTACK |
| 14 | **MEASURED FINDING: the two databases have independent lifecycles** | ATTACK |
| 15 | where the DBOS checkpoint lives (structural) | PROVE |
| 16 | `journal_seq` is gap-free across rollback — **and a PostgreSQL `SEQUENCE` demonstrably is not** | PROVE + NEG-CTL |

Every kill row asserts the same five properties: no partial ledger write, the TB-04
coupling `standing == max(0, cap − realised)` intact, the four-term sum within the ceiling,
`journal_seq` gap-free, and the ledger delta applied **exactly once** across crash and
recovery.

---

## 13. Coverage against the S1A mandate

| Mandate item | Where | Status |
|---|---|---|
| S1A-1 window model | §1, §7 | done |
| S1A-2 `standing_window_exposure`, generated `forward_monetary` | §5 | done |
| S1A-3 realised/standing atomicity | §6 | done |
| S1A-4 rate-class handoff; **VC-S7** | §2 | done — **PERMITS** |
| S1A-5 window-instance boundary; **VC-S5** | §7 | done, 2 clauses deferred with reasons |
| S1A-6 lock order | §9 | done |
| S1A-7 concurrency, **VC-S8** + mandatory negative control | §6, §11 | done — **EXPECTED FAILURE OBSERVED** |
| S1A-8 commitment guard, 10 combinations | §3 | done, 16 cases |
| S1A-9 DBOS vs step journal spike | §12 | done — see ADR-IMP-002 |

## 14. Verification cases NOT covered, and why

| Case | Why not in S1A |
|---|---|
| VC-C1..C4 | Effect Canonicaliser — excluded by the S1A mandate and by `phase2-v1.3-implementation-brief.md §2` ("Do not start with the canonicaliser") |
| VC-S2 (full) | Partially covered by §8. Its `reconciler_match_rule` half needs `I22` |
| VC-S3 | `StandingRevocationAuthority` dispatch and the STD-03 deadlock fixture — S1 |
| VC-S4 | The day-2 fixture and `periods_basis` provenance — partially covered by §10's differential pair; the re-reservation half is S1 |
| VC-S6 | `derive_sa_id`, authored independently twice — S1/S3 |
| VC-A1..A5 | Audit plane, attestation, mirror machine, `ACOS-JCS-1` — S1 |
| VC-L1 | `I7`'s independent-implementation MAL recomputation — S1 |
| VC-L3, VC-L4 | Order-driven cost; `PRESUMED_SETTLED` lifecycle and the `I32` override — S1 |
| VC-R1..R4 | Approval and resume semantics — S1 |
