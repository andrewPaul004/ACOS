# S1F — Result

## Verdict — `PASS`

**The determining reason.** `33 §1`'s decisive property is implemented and measured: the
exposure reservation, the authorisation decision, the effect journal row with its gap-free
sequence and local chain hash, and the local state transition commit or fail together in ONE
PostgreSQL transaction. There is exactly one `withSerialisationRetry` call on the money path
and exactly one `work` function inside it, and the property is proved by ABORTING that
transaction at eleven declared points and reading the database from a separate connection —
not by a return value.

Everything the mandate requires as a PASS condition holds, with real-PostgreSQL evidence:
ordinary reservations carry `total_exposure`; runtime `I18b` is asserted from committed rows;
every referenced applicable window is derived, locked in the declared order and evaluated by
the accepted S1A four-term guard, with total rollback if any lacks headroom; the rate class
writes a real `$0.00` reservation row and puts its whole economics in `I3` term 2; the
`StandingAuthorization` and its `StandingRevocationAuthority` are created atomically; the
first rate authorisation in a clean January window PERMITS; local `I42` is enforced by the
database and a duplicate cannot consume exposure twice; the journal is gap-free under
rollback, concurrency and `40001`; `40P01` is never retried; the entity lease is held from
before C′ to after `COMMIT`; and nothing anywhere dispatches.

`npm run verify` is green: **76 test files, 1047 tests, 1047 passed, 0 failed, 0 skipped**,
exit code 0.

---

## 1. Baseline

| | |
|---|---|
| Required baseline | `5d289ab` |
| Actual starting commit | `5d289ab1fb1aae7f2db9b8d0a1f6690cb3d5504a` — verified `git rev-parse HEAD` before any edit |
| Baseline worktree | clean (`git status --porcelain` empty) |
| Baseline verify | **green**, exit 0 — 66 test files, 901 tests, 901 passed, 0 failed, 0 skipped |
| Branch | `feature/s1f-atomic-authorisation-commit`, created from `5d289ab` |
| Architecture files modified | **0** (`git diff 5d289ab --name-only -- docs/architecture/` is empty) |

---

## 2. Where S1F begins and stops

**Begins** at the accepted S1E `PRE_RESERVATION_PASS`, under the SAME session-scoped entity
lease, on the SAME PostgreSQL connection.

**Implements** `26 §7` steps **R, S, T, U, V, W** plus the control-database journal row.

**Stops** at `COMMIT`. `26 §7` step X — the audit write — is not implemented and cannot be
inside this transaction: `30 §5.1`, verbatim, *"cross-database atomicity is not attempted,
because it does not exist"*, and its own ordering block puts the audit push and the dispatch
AFTER `COMMIT`.

Why each included step belongs in the atomic transaction is in `S1F-contract.md` §1 and §4.
The short form: `33 §1` names four things, `33 §6` names the five schemas they live in, and
`24 §3` K5 states it as an invariant — *"Reservation is atomic with the authorisation decision
(SR5)."*

---

## 3. Ordinary reservation evidence — read from committed PostgreSQL

Canonical exposure, hand-authored: `$9.41` vendor `+ $0.59` retained fee `= $10.00` total.

```
exposure_reservation
  amount            10.00      <- I18b
  vendor_amount      9.41      <- a DIFFERENT quantity
  forward_integral   NULL
  is_rate_class      false

authorisation
  total_exposure    10.00      <- I18b's other operand, also PERSISTED
  vendor_amount      9.41
  autonomy_level    L3_OPERATIONAL     gate_class  UNGATED_LOGGED

reservation_window_instance          authorisation_window_instance
  W_DAY_REFUND:2026-09-05   10.00      W_DAY_REFUND:2026-09-05
  W_MONTH_REFUND:2026-09    10.00      W_MONTH_REFUND:2026-09

window_balance
  W_DAY_REFUND    reserved 10.00  standing 0.00  presumed 0.00  realised 0.00  ceiling  50.00  count 1/2
  W_MONTH_REFUND  reserved 10.00  standing 0.00  presumed 0.00  realised 0.00  ceiling 250.00  count 1/10

authorisation_decision
  verdict PERMIT   approval_requirement NONE   reservation_id <the row above>   signature 64 bytes

effect
  status AUTHORISED   idempotency_key 49571738…7996   adapter mock_processor   recoverability COMPENSABLE

effect_journal
  journal_seq 1   kind EFFECT_AUTHORISATION   verdict PERMIT   total_exposure 10.00
  prev_hash 0000…0000 (32 zero bytes)   row_hash 95f40dff…c6cd   mirrored_at NULL

journal_counter.next_seq  2
```

**`I18b` result: PASS.** `reservation.amount == authorisation.total_exposure == 10.00`,
exactly, and `!= vendor_amount`. Both operands are persisted rows; neither expected value
comes from production code.

**Every referenced window:** both, from the grant UNION, derived inside the transaction from
`window_registry.period` and `company.timezone`. The two record sets — what the AUTHORITY
named and what the RESERVATION moved — are equal, asserted set-wise.

**Lock order observed on the live path**, de-duplicated to first acquisition:
`W_DAY_REFUND → W_MONTH_REFUND → journal_counter`. The expected sequence is transcribed in
the test from `30 §5.2`, not read from `declaredOrder`.

---

## 4. Rate-class evidence — read from committed PostgreSQL

`26 §2.1.3`'s worked January, `$6.00/day`, 31 days, an empty window.

```
exposure_reservation
  amount             0.00     <- I18b:  reservation.amount == total_exposure == 0.00
  vendor_amount      NULL     <- the dispatched request carries a RATE, not money
  forward_integral 186.00     <- a SEPARATE FIELD, not a component of total_exposure
  is_rate_class      true

window_balance                                     term1  term2   term3  term4  ceiling
  W_DAY_ADSPEND:2026-01-01                          0.00   12.00   0.00   0.00   12.00
  W_MONTH_ADSPEND:2026-01                           0.00  186.00   0.00   0.00  186.00

standing_window_exposure          standing_cap   forward_monetary   in_scope
  W_DAY_ADSPEND:2026-01-01             12.00             12.00        true
  W_MONTH_ADSPEND:2026-01             186.00            186.00        true

standing_authorization
  status LIVE   revocation_effect_class campaign.pause
  expires_at 2026-01-31T12:00:00Z   cessation_grace_hours 72

standing_revocation_authority
  action_class_selector    campaign.pause          <- a SINGLETON, not the class it revokes
  resource_selector        campaign:CMP-S1F-1      <- an EQUALITY on one resource_ref
  per_action_max_monetary  0.00                    <- ZERO monetary authority
  created_by               KERNEL                  <- never model-proposable
  expires_at               2026-02-03T12:00:00Z    <- grant expiry + 72h cessation grace

effect_journal
  journal_seq 1   total_exposure 0.00   forward_integral 186.00   is_rate_class true
```

**TERM 1 contribution: `$0.00`.** **TERM 2 contribution: `$186.00` / `$12.00`.** The
four-term sum equals the ceiling exactly on both instances — `26 §2.1.3`'s *"Σ = $186.00 ≤
max_monetary = $186.00 → PERMIT"*.

**First-authorisation result: PERMIT**, end to end through the S1F transaction.

### Did `forward_integral` ever enter the ordinary reservation amount?

**NO.** Asserted three ways against DATA rather than prose, all zero-count:

* no `exposure_reservation` row with `is_rate_class AND amount <> 0.00`;
* no `reservation_window_instance` row with `amount <> 0.00`;
* no `effect_journal` row with `is_rate_class AND total_exposure <> 0.00`.

And the accepted S1A schema refuses the shape structurally:
`rate_class_zero_reservation` and `e1_forward_integral_is_not_the_reservation` on
`exposure_reservation`, plus S1F's `authorisation_rate_class_fields` and
`authorisation_non_rate_carries_no_forward_integral` on the request row.

### Boundary reported honestly

`campaign.budget.set` reaches step R with a KERNEL-SUPPLIED exposure block, not through C′,
because it has no registered constructor and `26 §7` step C2 would deny it
`NOT_CANONICALISABLE`. Same boundary accepted VC-S7 drew. Full statement:
`S1F-owner-clarifications.md` §S1F-C3.

---

## 5. Multi-window / multi-grant evidence

| Case | Result |
|---|---|
| DAY has headroom, MONTH does not (`$241.00` realised of `$250.00`) | `WINDOW_EXHAUSTED` at step R; ELEVEN tables empty; every balance term `0.00`; `journal_counter.next_seq` still `1` |
| MONTH has headroom, DAY does not (`$41.00` realised of `$50.00`) | identical |
| a SECOND matching grant naming `W_MONTH_CREDIT` | the effect is bound by **three** instances, and `$10.00` moves on all three — window sets compose by UNION |
| that unioned window pre-loaded to `$41.00` of its `$50.00` | `WINDOW_EXHAUSTED`, nothing persisted — **adding a grant never widens** |
| a second grant at `recoverability_max = REVERSIBLE` | `DENIED` at step **J**, `RECOVERABILITY`, before R is reached — the INTERSECTION narrows |
| exact boundary: `$40.00` realised, `$10.00` of headroom | **PERMIT**; the four-term sum is exactly `$50.00` |
| one minimum currency unit over: `$40.01` realised | `WINDOW_EXHAUSTED`, total rollback |
| realised term participates | `$39.99` permits, `$40.01` denies — same proposal, one term different |
| count ledger participates | `realised_count = 2` against `W_DAY_REFUND.max_count = 2` denies a monetarily-affordable refund |

**The S1E owner ruling is intact.** `per_action_max` intersection was NOT asserted through
step M, because the accepted S1D/S1E boundary puts the binding cap in the hash-committed Cedar
artifact and not on the grant row (`grants.ts`: *"Moving the binding figure into a database row
would put the money cap somewhere a compromised writer could raise"*). A test asserting
otherwise would have asserted a defect. `recoverability_max` — which IS a grant-row operand —
is used instead, so "never widens" is proved on a dimension where it is actually enforced.
Recorded in `S1F-implementation-log.md` §16.3.

---

## 6. Atomicity / kill-point evidence

Eleven declared points, from the production sequence's own list. After every forced abort the
database is read from a SEPARATE connection.

| Kill point | Persisted reservation? | decision / effect? | standing state? | journal / checkpoint? | gap? |
|---|---|---|---|---|---|
| `AFTER_ISOLATION_ASSERTED` | no | no | no | no | no |
| `AFTER_FIRST_WINDOW_LOCK` | no | no | no | no | no |
| `AFTER_ALL_WINDOW_LOCKS` | no | no | no | no | no |
| `AFTER_AUTHORISATION_ROW` | no | no | no | no | no |
| `AFTER_RESERVATION_ROW` | no | no | no | no | no |
| `AFTER_STANDING_ROWS` (rate) | no | no | **no** | no | no |
| `AFTER_EFFECT_ROW` | no | no | no | no | no |
| `AFTER_APPROVAL_ROW` (tier) | no | no (nor approval) | no | no | no |
| `AFTER_DECISION_ROW` | no | no | no | no | no |
| `AFTER_JOURNAL_SEQ_ALLOCATED` | no | no | no | no | **no — `next_seq` back to `1`** |
| `AFTER_JOURNAL_ROW` | no | no | no | no | no |

"no" means: the table is empty, `reserved_monetary`, `standing_monetary` and
`presumed_monetary` are `0.00`, `reserved_count` is `0`, and `journal_counter.next_seq` is `1`.

**No orphan** reservation, `StandingAuthorization`, `StandingRevocationAuthority`,
`standing_window_exposure` row, authorisation-without-reservation, reservation-without-decision,
committed journal gap or duplicated economic exposure survives any abort.

**And the matrix discriminates.** With no kill, the same fixtures write every row: 1
authorisation, 2 authorisation-window rows, 1 reservation, 2 reservation-window rows, 1 effect,
1 decision, 1 journal row — plus, on the rate branch, 1 standing authorisation, 1 revocation
authority and 2 standing-window rows.

**The two-transaction shape is absent from `src/`.** A source scan asserts that `BEGIN` and
`COMMIT` appear only in `pool.ts`, `retry.ts` and the migration runner, that
`localAuthorisation.ts` calls `withSerialisationRetry` exactly once, and that it calls
`inTransaction` zero times.

---

## 7. Idempotency

| | |
|---|---|
| Architecture step | `26 §7` steps **T–V**; enforcement `33 §6`; registry **`I42`** |
| In scope for S1F? | **YES** — `33 §6` puts the unique constraint in the SAME schema the reservation commits to, and `26 §7` property 8 puts the check inside the same sequence |
| DB uniqueness | `PRIMARY KEY (company_id, idempotency_key)` on `effect`; `idempotency_key` is NOT NULL |
| Key inputs | `H(task_id ‖ action_class ‖ resource_id ‖ semantic_param_digest)` — the ACCEPTED S1B `idempotency.ts`, unchanged |
| `journal_seq` included? | **NO.** Source scan: `idempotency.ts` contains no `journal_seq`, `journalSeq`, `journal_counter`, `allocateJournalSeq`, `Date.now`, `new Date`, `randomUUID`, `randomBytes`, `Math.random`, `attempt` or `retry` |
| Sequential duplicate | `DUPLICATE_PRIOR_RESULT`, naming the prior effect, authorisation, decision, reservation and `journal_seq = 1`. Local trace `['R','S','T','U','V']` — step W never ran |
| Concurrent duplicate | the entity lease serialises them (`25 §14`); outcomes are exactly one `LOCAL_AUTHORISATION_COMMITTED` and one `DUPLICATE_PRIOR_RESULT`; ONE effect row, ONE reservation row |
| The constraint as backstop | with the lease BYPASSED, two RAW concurrent inserts of the same key both fail `23505`; one effect row remains |
| `40001` retry | injected by a targeted interleaving: the transaction is parked after its snapshot and before its first lock, a second connection commits a change to a row it is about to lock, then it is released. Outcome commits, `journal_seq = 1`, `next_seq = 2`, one effect row, no gap |
| Duplicate economic consumption | **impossible.** After the duplicate, `reserved_monetary` is `$10.00` on each window — one exposure, twice bound — one reservation row, one journal row, `next_seq = 2` |
| Duplicate + no headroom | denies `WINDOW_EXHAUSTED` at step R, because `26 §7` puts R before T. Local trace `['R']` |
| Semantically distinct effect | does NOT collide: two effects, two reservations, two journal rows at `1` and `2`, two distinct keys |
| Stranded state after a duplicate | none — the savepoint release takes the duplicate's own authorisation row with it |

**External exactly-once remains OPEN, and is not claimed anywhere.** `25 §7` names four
layers; S1F closes ONE. The ingress dedup key, the work-item key and the outbox claim (`I36`)
are unbuilt, and duplicate prevention at the dispatch boundary rests on vendor idempotency, a
vendor query or the outbox — none of which exists.

---

## 8. Lock / isolation evidence

| | |
|---|---|
| Isolation observed | `serializable`, read back from `current_setting('transaction_isolation')` INSIDE the production transaction. The production path throws and reserves nothing if it reads anything else |
| The assertion is capable of failing | the same read returns `serializable`, `repeatable read` and `read committed` in the three respective transactions |
| No caller override | `LocalAuthorisationOptions` has no `isolation` member; the level is hard-coded `'SERIALIZABLE'` |
| Window order | `window_balance` rows `FOR UPDATE`, ascending `(window_id, window_instance_key)` — observed first-acquisition sequence `W_DAY_REFUND → W_MONTH_REFUND` |
| Standing lock position | slot 2, `standing_window_exposure` for those instances (rate branch), per `24 §3` K5 and S1A owner clarification §1 |
| Journal counter position | slot **3 — LAST** among locks. Acquired before any row write, consumed at the journal insert |
| Single acquisition site | `exposure/lockOrder.ts`. The accepted source scan confirms no other module in `src/` issues `FOR UPDATE` against a money-path table |
| Legitimate `40P01` count | **0.** Two concurrent authorisations on different orders, same windows, same order — no deadlock |
| `40P01` retry implemented? | **NO.** `retry.ts` names `DEADLOCK_DETECTED` and returns `false` for it; `localAuthorisation.ts` contains neither `40P01` nor `DEADLOCK` |
| Reversed-order control | `unsafeJournalCounterFirst` acquires the counter FIRST; against a declared-order transaction under a targeted two-participant interleaving, PostgreSQL raises exactly one `40P01` |
| Weaker-isolation negative control | the framework-wrapper case (`33 §6`, MAL-08) fails CLOSED at PostgreSQL — `SET TRANSACTION ISOLATION LEVEL must be called before any query` — and nothing is written. The accepted S1A `REPEATABLE READ` control (`tests/negative-controls/repeatable-read-race.test.ts`) remains green as regression evidence, and the S1F read-then-write duplicate control demonstrably fails under a targeted interleaving AT `SERIALIZABLE`, which is the stronger statement |

---

## 9. Entity lease — **VC-C3 PARTIAL ONLY**

| | |
|---|---|
| Mechanism | `pg_advisory_lock(int, int)` on `(company_id, entity_type, entity_id)`, session-scoped, on the lease's own connection — the ACCEPTED S1C `entityLease.ts`, unchanged |
| Backend pid at C′ | sampled via `pg_backend_pid()` on the lease's client |
| Backend pid inside the S1F transaction | read from `pg_locks` by an OBSERVER connection at `AFTER_ALL_WINDOW_LOCKS`: exactly ONE granted holder |
| Backend pid after `COMMIT` | sampled again on the lease's client, and asserted EQUAL to the holder observed inside the transaction |
| Backend pid after the span | the advisory lock has ZERO holders — released, not leaked |
| Competitor behaviour | a second backend's `pg_try_advisory_lock` returns **false** at `AFTER_DECISION_ROW`, and the granted holder is not the competitor's pid. After the span the same call returns **true** |
| Release / reacquire | **none.** `localAuthorisation.ts` contains no `withEntityLease`, `EntityLeaseManager`, `pg_advisory_lock`, `pg_advisory_unlock` or `pg_try_advisory_lock`, and runs its transaction on `lease.client`. `authoriseLocallyUnderLease` takes the lease as a PARAMETER |
| Lease released mid-span | `commitLocalAuthorisation` throws `has been released` and writes nothing |
| `assertHeld` call sites | three or more inside the transaction: at entry, after the isolation check, and before the commit returns |

**`VC-C3 — PARTIAL: continuous propose→local-authorisation span proven; execute/dispatch
remains unimplemented.`**

Full VC-C3 is not claimed. There is no execute step to span.

---

## 10. Invariant status

| Invariant | Status | Evidence |
|---|---|---|
| **I2** | **CLOSED for the implemented local path** | `authorisation_decision.reservation_id` NOT NULL + FK to `exposure_reservation`, read from `information_schema` and `pg_constraint`. `26 §2.1.3` removed the last candidate exemption, so no exempt class exists at S1 |
| **I3** | **INTEGRATED** — the guard is the ACCEPTED S1A one and the live S1E→S1F path reaches it | boundary, one-cent-over, realised participation, count ledger, standing participation, both windows, concurrent authorisations |
| **I18a** | unchanged (S1B); the rate branch's null case asserted | rate reservation `vendor_amount IS NULL` |
| **I18b** | **CLOSED at runtime, from committed PostgreSQL rows** | ordinary `10.00 == 10.00 != 9.41`; rate `0.00 == 0.00`; mutation control proves the committed figure derives from the FROZEN effect |
| **I18c** | unchanged, and re-asserted on the new request row | `authorisation_i18c_total_ge_vendor` |
| **I18d** | **OPEN** — settlement | S3 synthetic, T3 real money |
| **I31** | **CLOSED for initial reservation uniqueness** | `UNIQUE (authorisation_id)` on `exposure_reservation`; one-decision / one-effect / one-reservation uniqueness on `authorisation_decision`; sequential and concurrent duplicate attempts |
| **I42** | **CLOSED — LOCAL DB half** | §7 above. External exactly-once OPEN |
| **I51** | **PARTIAL — schema only**, as before S1F | the `reservation_no_increase` trigger is the ACCEPTED S1A one; no runtime resume path exists to exercise it |
| **I55** | **CLOSED for creation**; the revocation EXECUTION path DEFERRED | both rows committed atomically; the authority's scoping asserted field by field — singleton class, equality on one resource, zero monetary, `created_by KERNEL`, `expires_at = grant expiry + 72h`; no `'REVOKED'` or `cessation_verified_at` write path exists in `src/` |
| **I60** | **PARTIAL — first clause only** | the unique partial index on `RESUMING` is installed as declared and read back from `pg_indexes`; the transition trigger is deferred with the transitions it constrains |
| **I17d** | **CLOSED for the control journal** | the trigger refuses a caller-supplied `prev_hash` or `row_hash` with `ACS17`; the row hash equals an INDEPENDENTLY framed `ACOS-JCS-1` digest |
| gap-free `journal_seq` | **CLOSED for the live authorisation path** | rollback after allocation leaves `next_seq = 1`; two concurrent authorisations land on `1` and `2`; a non-contiguous insert is refused; the chain links row 2's `prev_hash` to row 1's `row_hash` |
| **I17 / I17b / I17c / I17e / I41 / I8** | **OPEN** | no audit store, no push, no attestation, no two-sided diff |
| **I36** | **OPEN** | no outbox |
| **I19 / I52 / I63** | **OPEN** | unchanged |

---

## 11. Adversarial controls

| # | Attack | Vulnerable result | Production result | Discriminates? |
|---|---|---|---|---|
| 1 | reserve `vendor_amount` not `total_exposure` | **COMMITS** — reserves `$9.41`, balance reaches `$49.91` of `$50.00` | `WINDOW_EXHAUSTED`, eleven tables empty | **YES** |
| 2 | check only ONE referenced window (month exhausted) | **COMMITS** — `$10.00` on the day window, `$0.00` on the month window | `WINDOW_EXHAUSTED`, nothing persisted | **YES** |
| 2b | the same, roles reversed (day exhausted) | **COMMITS** — `$10.00` on the month window | `WINDOW_EXHAUSTED`, nothing persisted | **YES** |
| 3 | rate class reserves `forward_integral` as term 1 AND writes the standing row | **`WINDOW_EXHAUSTED`** — the TB-03 double count denies the first authorisation | **PERMIT** | **YES** |
| 4 | rate class omits the zero-amount reservation row | **COMMITS** standing state with no reservation, breaking `I2` | writes the row; and a decision over the omission is refused by a NOT NULL FK | **YES** |
| 5 | reservation and decision in SEPARATE transactions, crash between | **strands** a reservation and an authorisation with no decision, no effect and no journal row, and `$10.00` of consumed headroom | the same crash point leaves **NOTHING** | **YES** |
| 6 | journal counter acquired FIRST | exactly one **`40P01`** against a declared-order transaction | the declared order produces **0** `40P01` under contention | **YES** |
| 7 | duplicate detected by `SELECT` instead of by the key | **both attempts COMMIT** — two reservations, `$20.00` of reservation rows for ONE intent | the second returns the prior result; ONE reservation row | **YES** |
| 8 | a mutable canonical effect changes amount between S1E and R | — (the request is FROZEN; a write to `exposure.totalExposure` THROWS) | authoritative state mutated at the edge into R (`$9.41 → $99.00`, fee `$0.59 → $40.00`) and the committed reservation is still `$10.00` on the reservation row, the authorisation row and the journal row | **YES** |
| 9 | a weaker-isolation money path | PostgreSQL refuses the framework-wrapper shape; nothing written | the production path also asserts the level and throws | fail-closed both ways |

Every economic control also has a **not-broken** case — a fixture on which the control and
production AGREE — so none of the discriminations can be satisfied by a control that always
commits or a production path that always denies.

The seven controls live in `tests/negative-controls/unsafe-local-authorisation.ts`, each with
its defect NAMED and the single differing expression marked `THE DEFECT:`. A source scan
asserts nothing under `src/` imports them.

---

## 12. Real-PostgreSQL suites

| Suite | Tests | Proves |
|---|---|---|
| `local-authorisation-pipeline.test.ts` | 10 | `26 §7` D–W end to end; the four `33 §1` records committed; runtime `I18b`; every instance bound; the guard moved; the signature covers the economics; SERIALIZABLE observed; the coarse projection |
| `local-transaction-atomicity.test.ts` | 26 | the eleven-point kill matrix across ordinary, rate and approval branches; one transaction in `src/`; no transport |
| `multi-window-binding.test.ts` | 15 | both failure directions; total rollback; the single-window control; boundary and one-cent-over; realised and count ledgers; UNION; a unioned window denying; intersection before R; the observed lock order; no deadlock |
| `local-idempotency.test.ts` | 10 | the key's inputs; the same intent twice; a distinct effect not colliding; one exposure per intent; no stranded authorisation; R before T; lease serialisation; the constraint as backstop; the read-then-write control |
| `journal-sequencing.test.ts` | 12 | the chain and its genesis; the independently framed digest; `I17d`; immutability except `mirrored_at`; contiguity; gap-freedom under rollback, concurrency and `40001`; `40P01` never retried; the reversed-order control |
| `rate-class-local-authorisation.test.ts` | 14 | VC-S7 through S1F; the real `$0.00` row; `forward_integral` never in term 1; the four terms per instance; `I55` creation and scoping; no revocation path; the two rate controls; a rate denial leaving no orphan |
| `lease-continuity-s1f.test.ts` | 6 | VC-C3 PARTIAL — one backend across the span, the lock held during the transaction, the competitor refused then admitted, a released lease refusing, no reacquire |
| `local-authorisation-boundary.test.ts` | 23 | the two step tables compose; `I2`/`I31`/`I42`/`I60` enforced by the DATABASE; money scale; the rate CHECK; the effect status set; append-only, exercised; no resume, audit, settlement or second Cedar path |
| `local-authorisation-controls.test.ts` | 13 | the vendor-amount and two-transaction controls; the frozen-effect controls; the controls are test-only and each names its defect; the isolation assertion |
| **total real-Postgres** | **129** | |

Plus **11** in `tests/authority/decision-signature.test.ts` and **6** added to the accepted
`tests/authority/authority-type-boundary.test.ts` (the compile-negative harness). Focused S1F
tests: **146**.

---

## 13. Accepted regression state

| Slice | Status |
|---|---|
| S1A | **GREEN** — window balance, four-term guard, standing, lock order, retry/deadlock, schema conformance, VC-L2, VC-S5, VC-S7, VC-S8, I62, generated column, oracle self-check |
| S1B | **GREEN** — canonicalisation, canonical bytes, injectivity, hash binding, constructor version, `I21` type boundary, idempotency key, rationale, VC-C1 construction |
| S1C | **GREEN** — live enumeration, content-addressed selectors, entity lease, context-spec projection, enumeration scope, VC-C3/CAN-03 reordering |
| S1D | **GREEN** — one Cedar path, VC-C1 `PER_ACTION` denial, fail-closed, per-action boundary, policy artifacts, policy set gap analysis |
| S1E | **GREEN** — the full pre-reservation pipeline, denial ordering, lease continuity, authoritative-state integrity, authority controls |
| Accepted tests **deleted** | **0** |
| Accepted tests **skipped** | **0** |
| Accepted assertions **weakened** | **0** |
| Accepted lists widened | 2, both additively and both with the reason stated in place — `i21-type-boundary.test.ts`'s fixture list (fourteen → fifteen, exactness preserved) and a new `describe` block in `authority-type-boundary.test.ts`. Details in `S1F-owner-clarifications.md` §S1F-C9 |
| Accepted-test comment rewordings | 2 source-rule greps flagged prose in migration `0007`; the COMMENTS were reworded and the rules left untouched |

---

## 14. Verification

| | |
|---|---|
| `npm run verify` | **GREEN**, exit code 0 |
| `typecheck` | clean |
| `lint` | zero warnings (`eslint . --max-warnings 0`) |
| Test files | **76** (baseline 66) |
| Tests | **1047** (baseline 901) |
| Passed | **1047** |
| Failed | **0** |
| Skipped | **0** |
| `.only` / focused filtering | none |
| Focused S1F tests | **146** |
| Real-Postgres S1F tests | **129** |
| Vulnerable negative controls | **7** named defects, 9 attack rows discriminated |
| Worktree clean at the S1F commit | yes |

---

## 15. Scope escape audit

`git diff 5d289ab...HEAD`, audited for each item the mandate names.

| Audited for | Result |
|---|---|
| external HTTP / vendor call | **NO** — a source scan over all of `src/` rejects bare `fetch(`, `XMLHttpRequest`, `node:http(s)`, `node:net`, `node:dgram`, `axios` and `undici` |
| outbox dispatch | **NO** — the same scan rejects `outbox` case-insensitively |
| external effect claim | **NO** — no `CLAIMED`, `outboxClaim` or `vendorQuery` in `src/` |
| approval RESUME | **NO** — no `'APPROVED'`, `'RESUMING'`, `'CONSUMED'`, `'SUPERSEDED'`, `verifyMode`, `RemedyObligation`, `EXPOSURE_EXCEEDS_RESERVATION`, `RESERVATION_ABSENT` or the resume constructor denial in `src/` |
| audit-plane implementation | **NO** — no `auditUrl(` outside the accepted S1A `pool.ts` helper, no `JournalAttestation`, no mirror state, no `DegradedModeOverride`, no anchor, no `mirrored_at` write |
| AI worker / CEO | **NO** — no such code exists |
| symcc | **NO** |
| architecture package modified | **NO** — zero files under `docs/architecture/` |
| model-controlled monetary fields | **NO** — the exposure block reaching step R is the FROZEN S1E one; there is no monetary parameter on the S1F boundary, and the mutation control proves the committed figure survives authoritative state moving |
| vendor amount as reservation amount | **NO** — `I18b` asserted from committed rows; the vendor-amount control discriminates |
| rate forward integral in the ordinary reservation | **NO** — three zero-count data assertions plus four schema CHECKs |
| partial multi-window commits | **NO** — both failure directions leave eleven tables empty |
| lock-order violation | **NO** — one acquisition site, observed order matches the declared one |
| journal counter acquired before the money rows | **NO** — slot 3, after `window_balance` and `standing_window_exposure` |
| two-transaction reservation/decision pattern | **NO** — `BEGIN`/`COMMIT` only in `pool.ts`, `retry.ts` and the migration runner; one `withSerialisationRetry`, zero `inTransaction` in the S1F module |
| second Cedar path | **NO** — one `cedar.isAuthorized` call site; `PER_ACTION` producible only from the accepted policy module |
| adapter / network code | **NO** |

---

## 16. Open obligations — explicitly deferred

| Obligation | Status | Why |
|---|---|---|
| **VC-C2** journaling / quota half | **OPEN** | `enumerate_effects`' journal row and its rate limit; no journal row kind for READ exists |
| **I52** CI / spec-review half | **OPEN** | unchanged |
| **VC-C3** full propose→authorise→execute span | **PARTIAL** | no execute step exists |
| **VC-C4** approval resume / constructor-change semantics | **OPEN** | resume is deferred |
| **R′** verify-mode resume | **OPEN** | `26 §12.1`–`§12.3` |
| **I51** resume no-top-up runtime path | **OPEN** (DB trigger present as accepted S1A schema safety) | no resume to exercise |
| **I60** transition clause | **OPEN** (the `RESUMING` index is installed) | deferred with the transitions |
| **VC-A3** independent cross-instance canonical re-chaining | **OPEN** | needs a second implementation — the audit trigger |
| **`ACOS-JCS-1`** generally | **OPEN for VC-A3**; the null representation needed no resolution — `30 §5.3` plus S1B-C8 already covered every nullable column in the journal row kind, and no new encoding was invented. `S1F-owner-clarifications.md` §S1F-C7 |
| **I18d** settlement tolerance | **OPEN** | S3 / T3 |
| external **outbox** | **OPEN** | `25 §7` layer 4 |
| exclusive external claim (**I36**) | **OPEN** | |
| vendor idempotency / query | **OPEN** | `36 §7` requires empirical verification |
| external exactly-once | **OPEN** | rests on all of the above |
| reconciliation | **OPEN** | `25 §8` |
| audit plane, transport, attestation, mirror, anchor, two-sided diff | **OPEN** | `30 §5.4`–`§5.10` |
| **O4** Cedar owner signing | **OPEN** | no key management anywhere; the decision signer takes a test key |
| **I19** continuous artifact checking | **OPEN** | |
| symcc | **OPEN** | deferred out of S1 by `37 §2` |
| real adapters | **OPEN** | S3 |
| AI CEO / workers | **OPEN** | S2+ |
| additional catalogue classes, and a `campaign.budget.set` constructor | **OPEN** | |
| **KERNEL_SERVICE standing revocation EXECUTION** | **OPEN** — the authority ENTITY is now created atomically; exercising the pause is not built | `26 §7.1` |
| the reservation **reaper**, TTL expiry, `I32` starvation metric | **OPEN** — the TTL is recorded on the approval row and read by nothing | `26 §12.1`, S5 |
| `24 §3.1`'s **database clock** | **RESIDUAL, unchanged from S1A** — the timezone and the period are read from the database; the instant is the kernel's injected clock. `S1F-owner-clarifications.md` §S1F-C6 | live clocks are S5 |

---

## 17. Architecture conflicts

**One difference found, reconciled from the passages themselves, no owner disposition
required.** `30 §5.1`'s write order puts the effect row before the reservation row;
`26 §7` property 8 puts step R before steps T–V and states the consequence — a *released*
reservation. Under one commit the intermediate order is unobservable except at denial
precedence, where `26 §7` decides the case explicitly. Full statement, the observable
difference, the economic impact and the single test that would move under a different ruling:
`S1F-owner-clarifications.md` §S1F-C1.

**No genuine mechanism conflict was found** affecting atomicity, monetary quantity,
reservation identity, standing exposure, lock order, authorisation state, idempotency or
journal/checkpoint state. Nothing was returned PARTIAL for want of a normatively justified
implementation.

Eight further clarifications record where S1F chose something the architecture does not state
— the local state transition, the rate class's C′ boundary, `I60`'s redundant index,
append-only by trigger, the database clock, the `ACOS-JCS-1` null question, the module
placement, and the two widened accepted lists. All are in
`S1F-owner-clarifications.md`.

---

## 18. Residual risk

**What S1F genuinely establishes.** The point at which a policy-qualified proposal becomes
durable economic state is one `BEGIN`, and that is measured by breaking it eleven times rather
than asserted. The economic quantity that reaches the ledger is the total exposure, the
windows that bound it are all of them, the rate class's economics live in the standing term
and nowhere else, and a duplicate cannot take headroom twice.

**What it does not establish, and the largest of them.** Everything after `COMMIT`. There is
no audit plane, so `30 §5.1`'s unsuppressibility property has no mechanism behind it yet and
`I17`, `I41` and `I8` are undetected. There is no outbox and no adapter, so a committed local
authorisation has no path to the world and no exactly-once story. And `50 §2`'s owner-signing
obligations — the constructor record and now the decision — are still test keys.

**The specific thing to watch.** The journal chain is now IN USE. `30 §5.3` makes
`ACOS-JCS-1` a control artifact versioned in its name, and *"a change is a chain break by
construction and requires a declared migration with a re-anchor."* The declared field order
for `acos.journal.effect_authorisation.v1` is now load-bearing, and the audit trigger that
`VC-A3` will compare against must implement exactly it. The oracle in
`journal-sequencing.test.ts` is a hand-written third reading of `30 §5.3` and is the thing that
makes that comparison meaningful when it happens.

---

## 19. Recommended next slice

**The audit plane's control-side half: `26 §7` step X and `30 §5.1`'s push.**

It is the architecture-derived next step for three reasons. `26 §7` property 9 — *"Every path
writes an audit record, including every denial"* — is now the only step of the sequence with
no implementation. `30 §5.1`'s dispatch-precedence table is what decides whether a committed
authorisation may be dispatched at all, so it must exist before dispatch does. And `37 §2`
puts `VC-A3` and `VC-A1` in S1 precisely because *"neither can be retrofitted onto a chain
already in use without a re-anchor"* — and after S1F the chain is in use.

Not implemented here. **STOP.**
