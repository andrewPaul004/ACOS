# S1A Result

**Issued 2026-09-04.** Architecture input: ACOS Operating Spine v1.3, package issue
v1.3.1, materialised immutably at `docs/architecture/v1.3.1/`.

**Amended 2026-09-04 by S1A.1**, the narrow local hardening pass that followed the owner's
independent review of the actual repository. **The result is unchanged; four findings were
repaired or clarified and the gate was rerun from a genuinely clean environment.** See
`§13` for the S1A.1 record. **S1B is not authorised by this document.**

**Substrate:** PostgreSQL 16.9. **Suite:** **18 files, 155 tests, all passing.** Typecheck
clean. Lint clean at `--max-warnings 0`. Migrations apply from an empty database and are
torn down and recreated on every test file.

**The run above is a clean-environment run** — `npm run db:down` → `npm run db:up` →
`npm test`, **with no manual SQL of any kind**. The original S1A figure was 14 files / 139
tests and, as the owner independently reproduced, it required a manual
`CREATE DATABASE acos_dbos_sys` on the audit server. That is recorded as **S1A-H1**, was
repaired, and is **not** erased from this record.

---

## The twelve questions, answered exactly

### 1. Did the four-term commitment guard work?

**Yes.**

`24 §3` K5's printed `BEFORE UPDATE` trigger is installed on `window_balance` and enforces
`I3` per ledger. Sixteen cases pass, all written in raw SQL through `pg` with no
application-level check in the path: each term alone to the ceiling, all four together
summing exactly to it, the exact boundary, one cent below, one cent above via each of the
three commitment terms independently, and the case where every term is individually within
the ceiling but the **sum** exceeds it by one cent.

The operand set was verified **mechanically against the installed object** — the trigger
body read back from `pg_proc.prosrc`, the summed expression parsed, and the operands
compared one by one. Monetary: `reserved + standing + presumed + realised`, exactly four.
Count: the same four. Irrecoverable: the three the printed K5 schema declares, which has no
`standing_irrecoverable` column (see `S1A-implementation-log.md §3` — this is the
architecture's own schema, not a dropped term).

**S1A.1 makes the irrecoverable reading explicit rather than inferred — S1A-H3.** The owner
clarification in `S1A-owner-clarifications.md §2` records that for the irrecoverable-units
ledger the conceptual standing term is **definitionally `0`** under the current
`StandingAuthorization` model, so the guard has three stored operands **plus an implicit
zero**. `standing_irrecoverable` was **not** added and the guard arithmetic was **not**
changed. `tests/integration/exposure/irrecoverable-standing-zero.test.ts` pins it: the
exact set of every `%irrecoverable%` column in the schema, the fact that
`standing_window_exposure` carries only monetary forward exposure, and the behavioural
consequence that the three stored terms may consume the **whole** ceiling — which is what
an implicit zero fourth term means. A future `StandingAuthorization` type introducing
irrecoverable-unit forward exposure would have nowhere to store it and would require an
**architecture** change.

**And a guard omitting the standing term was shown to fail the same fixture**: it admitted
`$186.00` into a window already fully committed to `$186.00` of standing exposure, for a
sum of `$372.00` against a `$186.00` ceiling. The four-term result is therefore
discriminating.

### 2. Did the first rate authorization permit?

**Yes. PERMIT.**

VC-S7, in a clean 31-day January with `W_MONTH_ADSPEND` and `W_DAY_ADSPEND` empty, at
`$6.00/day`:

```
reservation.amount = 0.00      total_exposure = 0.00      vendor_amount = NULL

monthly:  0 reserved + 186.00 standing + 0 presumed + 0 realised = 186.00 ≤ 186.00
daily:    0 reserved +  12.00 standing + 0 presumed + 0 realised =  12.00 ≤  12.00
```

`I18b` holds exactly. `forward_integral` is recorded as a **separate field** carrying
`$186.00` while `amount` is `0.00`. The zero-amount reservation row and the
`standing_window_exposure` rows are written in one transaction; an independent observer on
another backend sees neither before the commit and both after, so no interleaving observes
standing absent.

Every figure was compared against a hand-transcribed constant table that imports nothing
from `src/`, and that table was itself checked against `26 §2.1.3`'s printed working and
`phase2-v1.3.1-verification.md §10`'s recomputation.

**TB-03 was not reintroduced**, and the negative control proves the test can see it: the
double-counted path denies `WINDOW_EXHAUSTED` at `372.00 > 186.00`.

### 3. Did realised/standing atomicity survive both interleavings?

**Yes, in both orderings.**

VC-S8, with deterministic barriers placing two real PostgreSQL backends at named
instruction boundaries and a third read-only backend sampling throughout:

- **Ordering A** — spend reconciler begins while the authorisation attempts to acquire
  headroom: PASS.
- **Ordering B** — authorisation begins while the reconciler records realised spend: PASS.

In both: no transient unauthorised headroom at any sampled point, no lost realised update,
no dropped standing update, no deadlock, financial truth exactly what the vendor reported,
and headroom conservative. Final state in both orderings: `reserved 86.00 + standing 60.00
+ presumed 0.00 + realised 40.00 = 186.00 ≤ 186.00`.

The mechanism is the one `24 §3` K5 specifies and it removes the choice rather than making
it correctly: `forward_monetary` is `GENERATED ALWAYS`, the reconciler writes **one column
on one row**, and a trigger in that same statement recomputes
`window_balance.standing_monetary` as `Σ forward_monetary WHERE instance_in_scope` and
moves `realised_monetary` by the same delta. There is no code path — production or
otherwise — that can move one without the other.

An over-commit of one cent above the true headroom was refused **across the interleaving**,
in both orderings.

### 4. Did the unsafe negative control fail as expected?

**Yes.**

```
safe implementation:      PASS
unsafe negative control:  EXPECTED FAILURE OBSERVED
TRANSIENT UNAUTHORISED HEADROOM: an observer saw a four-term sum of
226.00 against a ceiling of 186.00
```

The unsafe path is test-only, lives in its own PostgreSQL schema, and is never imported by
`src/`. It removes three things by name: the commitment guard (the TB-01 shape), the
generated column and the in-statement sync trigger (the TB-04 shape), and the row lock plus
`SERIALIZABLE`, replaced by `REPEATABLE READ`.

It reproduces the exact interleaving `24 §3` K5 names — *"standing-first transiently
created headroom a concurrent authorisation could consume without touching any lock
associated with the standing authorisation"*. Measured: a phantom headroom of `$126.00`
where the true headroom is `$86.00`, consumed by a concurrent authorisation, leaving a
four-term sum of `$226.00` — over the ceiling by exactly the `$40.00` that briefly
vanished between the two transactions.

The **same** assertion battery that passes against production fails against it, and a third
test shows the battery accepts a correctly-applied observation, so the failure is caused by
the interleaving and not by the assertions.

**Production code was not weakened to perform this.**

Two further negative controls fail as expected: the three-term guard (§1 above) and the
`forward_integral`-as-reservation double count (§2 above). A fourth demonstrates that
reversed lock acquisition **does** deadlock, so the no-deadlock result is discriminating.

**S1A.1 adds a fifth.** `spikes/durable-execution/external-step-race.test.ts` shows the
step journal's generic step wrapper admitting **two** concurrent executions of an unclaimed
external effect — `dispatch = 2`, both workers `fulfilled`, one checkpoint row. It is a
negative control on a **spike**, not on the money path, and its lesson is that external
exactly-once belongs to the ACOS-owned dispatch outbox. See `§9` and `ADR-IMP-002 §7`.

### 5. Was any transient unauthorized headroom observed?

**No — in the production path.**

An independent observer on its own backend sampled the four-term sum at every barrier in
both orderings and at every point it was within the ceiling. The reason is structural: the
aggregate is recomputed inside the same statement that changes the primitive, under a lock
a concurrent authorisation must also hold.

**Yes — in the deliberately unsafe negative control**, which is the point of having one.
`$126.00` of phantom headroom where `$86.00` existed.

### 6. Could financial truth be recorded above the authority ceiling?

**Yes.**

A vendor delivery of `$250.00` against a `$100.00` authorised standing cap in a `$186.00`
window was **written**. The four-term sum went to `$250.00`, above the ceiling, and the
write succeeded.

It raised **`WINDOW_CEILING_BREACHED`** and, because the excess was attributable to a
standing authorisation's overdelivery, **`STANDING_OVERDELIVERY`**. Both carry
`incident_path = 'FINANCIAL_TRUTH'`; the test asserts neither is `SECURITY`, per `24 §3`
K5: *"A vendor billing artefact is not evidence that the control model was breached."*

The bound still binds what may be newly committed: after the overage, every commitment
against the window was refused — reserved, standing and presumed independently — while a
further `$50.00` of realised spend was still written. The mandate's instruction not to
classify ordinary vendor overdelivery as an `I3` control-plane-security breach is honoured
and is a column value, not a convention.

### 7. Did the window-instance boundary test pass?

**Yes**, for every clause S1A implements.

January, `$6.00/day`, paused on day 3 and reaching `PAUSED`: `realised = $18.00`,
`forward = $168.00`, **retained** for the January instance. A second January authorisation
denied `WINDOW_EXHAUSTED` with `standing=354.00 realised=18.00` against `ceiling=186.00`.

Crossing into February: `standing_monetary = $0.00`, headroom the full `$186.00`, **no
`standing_window_exposure` row created**, and a legitimate successor permitted at `$182.40`
(28 days: `max(28, 30.4) = 30.4`; `$6.00 × 30.4`).

The `LIVE`-only re-reservation rule was asserted directly and status by status: `LIVE`
**does** acquire a February row; `PAUSE_PENDING`, `PAUSED` and `EXPIRED` do **not**. The
in-scope interval was asserted independently of status — a `LIVE` authorisation whose
`[created_at, expires_at + cessation_grace)` has ended acquires no row either.

**TB-13 respected**: the successor is a distinct fixture authorisation created through the
ordinary rate-class path. No `SUPERSEDED` status and no max-over-instance `standing_cap`
exists anywhere in the repository.

**Two VC-S5 clauses are deferred with named reasons** (`S1A-contract.md §5.3`): the
delayed-January-delivery attribution clause, which requires `I22` and `51 §3.2.2`'s
`derive_sa_id` and is VC-S6; and the `I55` exemption clauses, which require the
`StandingRevocationAuthority` sweep. Both are S1, not substrate.

### 8. Did the declared lock order deadlock?

**No.**

Twelve concurrent transactions against the same window instance, each supplying its windows
in reverse and each having the order imposed by the single helper, produced **zero**
`40P01`. Asserted **without** any retry in the path, so a deadlock could not be absorbed
and counted as a success.

The reversed-order negative control **does** deadlock, so the test can observe one.

There is exactly **one** lock-acquisition site in `src/`, enforced by a test that walks the
source tree with comments stripped. Rows are locked one statement at a time in the sorted
order, because PostgreSQL does not guarantee that a multi-row `ORDER BY … FOR UPDATE`
acquires locks in the `ORDER BY`'s order under concurrency.

**But an empirical finding attaches to this answer, and it is not a deadlock.** At
`SERIALIZABLE` the declared order produces `40001 could not serialize access due to
concurrent update` rather than blocking: 9 of the 12 aborted. That is fail-closed and
leaves no journal gap, and the architecture already anticipates it — registry `I42`
requires that *"a serialisation-failure retry regenerates the same key (SR-A4)"*. What S1A
adds is the measurement that the retry is **required, not optional**. With a bounded
ACOS-owned retry all twelve commit and the arithmetic is exact. Recorded in
`S1A-implementation-log.md §8` as an S1 obligation.

**Amended by S1A.1 — S1A-H2.** `40001` and `40P01` are now handled differently, and they
must be. `40001` is expected `SERIALIZABLE` contention and is retried within the bounded
policy. **`40P01` propagates immediately, unretried**, because a deadlock means the
declared lock order has failed or an undeclared lock-taking path exists — an
invariant/implementation defect, not a condition to wait out. Retrying it would usually
succeed on the second attempt and would erase the only signal that the ordering claim the
deadlock proof rests on is no longer true. `retry.ts` previously retried both and claimed
the deadlock count was surfaced in the outcome; **it was not**, and now there is no count
because there is no retry. Proven by
`tests/integration/exposure/retry-deadlock-not-retried.test.ts`: a `40P01` is attempted
exactly once and propagates as itself, including a real reversed-order deadlock driven
through the helper. Recorded in `S1A-implementation-log.md §17`. No production escalation
system was chosen; that is the next S1 increment's decision.

### 9. Which durable-execution candidate won?

**SELECT ACOS POSTGRES STEP JOURNAL FOR S1.**

`34 ADR-002`'s reconsider trigger **(e)** fired: *"the S1 spike shows the hand-rolled
journal is simpler to attack and equally correct."*

**Both candidates were correct for the S1A application-transaction/checkpoint property
under test** — the claim is exactly that narrow, and `ADR-IMP-002 §7` states its limit.
DBOS Transact 4.27.6 with
`@dbos-inc/node-pg-datasource` 4.27.6 survived every kill point tested, applied the ledger
delta exactly once across crash and recovery, preserved the TB-04 coupling, kept
`journal_seq` gap-free, and — importantly — writes `dbos.transaction_completion` into the
**application** database inside the user's own transaction, so ACOS's Postgres transaction
semantics are genuinely preserved. Raw `pg` client, real `FOR UPDATE`, real
`SERIALIZABLE`, K5 triggers untouched; the spike ran the **same** `stepApplyLedger`
function under both candidates.

**What decided it was coupling, measured directly.** DBOS keeps durable state in two
stores whose lifecycles are not tied to the ledger's: `dbos.transaction_completion` in the
application database but in a schema that `DROP SCHEMA public CASCADE` does not touch, and
workflow status plus step outputs in a **separate system database**. The decisive
measurement:

1. Run the work item to completion under DBOS — the ledger moves to `$40.00`.
2. Restore **only** the application database.
3. Re-run the same workflow id.

**The work is not re-executed, the process reports success, and the ledger stays at
`$0.00`.**

DBOS is correct by its own contract. But for a money path whose safety argument is *one
database, one transaction, one commit point*, a second durable store that can disagree with
the first about whether money moved is a coupling cost. The step journal keeps every
durable fact in one database with one lifecycle, is about ninety lines, has no admin
surface to close (`31 §3.4`'s `fork` obligation disappears), and for candidate B *"after
the checkpoint"* and *"before the commit"* are the **same instant** — a kill there leaves
no ledger movement, no sequence allocation and no checkpoint.

**A version finding, recorded:** `34 ADR-002` pins DBOS v2.23.0. The shipped version is
4.27.6 — two majors on, with the transaction API relocated to a data-source package that
did not exist under the pinned version.

**What ACOS now owns, and what it still owes:** full division of responsibility and four
named S1 obligations (scheduler/dequeuer, recovery detection, step-output serialisation
discipline, work-item claim concurrency) in `ADR-IMP-002-durable-execution.md §5`. None is
on the money path.

**Not Temporal.** `31 §3.2`/`§3.3` place it outside this spike; taking it would be an
explicit return to Option B.

**Two things the spike does not claim.**

1. `31 §3.3` asks for the comparison to run against a vendor sandbox for `refundCreate` and
   the ESP rather than mocks (VAL-04). S1A prohibits those adapters, so step 3 is a mock. No
   conclusion about vendor idempotency is drawn, and
   `phase2-v1.3-implementation-brief.md §6` obligations 7 and 11 remain unmet.
2. **S1A-H4 — the ACOS step journal alone does NOT provide external-effect exactly-once
   semantics.** Its generic step wrapper reads a checkpoint, performs the step and records
   the checkpoint, so for a nontransactional or external effect two concurrent workers can
   both pass the read before either records. A deterministic barrier-driven negative
   control measures it: **two dispatches, two `fulfilled` workers, one checkpoint row** —
   the journal reports one dispatch where two happened. The same race against the ledger
   step commits **exactly once**, with the loser refused `40001` and no `40P01`, so the
   property this ADR selected on is intact and **the winner does not change**. External
   exactly-once is the ACOS-owned dispatch outbox's job (`23 §6` B8, `25 §7`, `33 §1.1`)
   and is S1 work.

### 10. Did any architecture PASS-revocation condition trigger?

**No. None of the ten.**

| # | Condition | Reachable in S1A | Result |
|---|---|---|---|
| 1 | A remediation weakening the invariant — specifically dropping the standing term from `I3` | **Yes** | **Not triggered.** Four operands verified from the installed trigger; the three-term variant demonstrably fails |
| 2 | The audit plane's input path requires a control-DB read | No | Not reachable — no audit plane in S1A |
| 3 | The cessation specification proves undeclarable | No | Not attempted. TB-07 blocked, and no code sets `cessation_verified_at` |
| 4 | **The concurrency harness cannot produce a failing negative control at `REPEATABLE READ`** | **Yes** | **Not triggered.** `EXPECTED FAILURE OBSERVED`, sum `226.00` vs ceiling `186.00` |
| 5 | Independent re-chaining cannot agree across two instances | No | No chain in S1A |
| 6 | `I18` divergence persists | Partially (the `I18b` rate leg) | **Not triggered.** `reservation.amount == total_exposure == 0.00` exactly |
| 7 | More than one additional action class proves non-canonicalisable | No | No canonicaliser in S1A |
| 8 | **The standing term cannot be made atomic with the realised term** without serialising every vendor observation behind authorisation, or admitting transient headroom | **Yes — the decisive one** | **Not triggered.** Atomic in one statement; no observer saw transient headroom in either ordering; vendor observations are not serialised behind the authorisation path |
| 9 | `charge.standing_authorization_id` cannot be derived unambiguously | No | `I22`/VC-S6 out of S1A |
| 10 | The override's aggregate bound cannot be both safe and usable | No | `I63` out of S1A |

The three additional conditions the S1A mandate adds also did not trigger: `I3` **is** a
real single-commit bound; the lock order permits no transient unauthorised headroom;
realised and standing move atomically **without** blocking financial truth; the first rate
authorisation permits **without** weakening the ceiling; **no new architecture disagreement
was found on the money path**; and neither durability candidate requires abandoning the
Postgres-centric transaction property.

### 11. Does Option A survive S1A?

**Yes.**

`58 §8`'s decisive property for Option A — that `I3`'s four-term bound is enforceable at
one commit point — was implemented, attacked in both TB-04 orderings, and held. The
architecture's own framing (`phase2-v1.3-implementation-brief.md §7` condition 8) is that
failure here *"would be the first finding in four passes to bear on the substrate choice"*.
It did not fail.

`33 §1.1`'s narrowing is confirmed in the strongest available way: Option A does not depend
on DBOS, and S1A selects a durability layer that is not DBOS while leaving every Option A
property intact. Reservation, standing exposure, presumed exposure, realised spend, the
gap-free counter and the step journal are all in one database, reachable in one
transaction, on one connection.

**One qualification, stated plainly.** Option A survives *as a substrate*. S1A proves the
exposure ledger and nothing downstream of it. The canonicaliser, Cedar, the journal chain,
`ACOS-JCS-1`, the audit plane and `I8` are all untested, and `phase2-v1.3-implementation-brief.md §9`'s
warning against describing S1's gates as proving source completeness applies here too:
**S1A proves the money row, not the system.**

### 12. Is it safe to proceed to the next S1 increment?

**Yes**, with the obligations below carried forward.

The `phase2-v1.3-implementation-brief.md §2` sequencing rationale is satisfied: the row
everything else sits downstream of has been built and attacked first, and it held.

Outstanding obligations created or confirmed by S1A, none of them blockers:

1. **The serialisation retry is required, not optional** (log `§8`). Its bound,
   escalation on exhaustion, and interaction with `I32`'s reservation TTL are S1 design.
2. **Four step-journal responsibilities** ACOS now owns (ADR-IMP-002 `§5`):
   scheduler/dequeuer, recovery detection, step-output serialisation discipline, and a
   work-item claim that does not surface as a process failure.
3. **Two VC-S5 clauses deferred** to VC-S6 and the `I55` sweep.
4. **`PRESUMED_SETTLED` is schema-only.** Term 3 and its guard operand exist and are
   tested; the state machine, the `I32` override and VC-L4 are S1.
5. **The four scheduled blocks remain in force**: TB-07 (cessation), TB-08(a) (production
   `W_MONTH_ADSPEND` seeding), TB-11 (`PAUSE_PENDING` retry), TB-13 (supersession). S1A
   implemented none of them and the repository contains no path to any of them.

---

## 13. S1A.1 — the owner review repairs

**Issued 2026-09-04**, after the owner's independent review of the actual repository. The
core S1A money-path substrate was **accepted in shape**. This was a narrow local hardening
pass: no architecture redesign, no change to authority ceilings or MAL, no Effect
Canonicaliser, no Cedar, no S1B.

**The immutable architecture package under `docs/architecture/v1.3.1/` was not modified in
any respect, and no historical artefact was rewritten.**

| ID | Finding | Kind | Outcome |
|---|---|---|---|
| **S1A-H1** | DBOS spike clean-environment bootstrap defect | Test-harness defect | **Repaired.** Provisioning creates `acos_dbos_sys` on both providers and returns its URL; the spike reads it. Clean-environment run with no manual SQL. Regression assertion added. `log §16` |
| **S1A-H2** | `40001` is retryable; `40P01` is pass-revoking | Production defect | **Repaired.** `40P01` propagates immediately, unretried, unconverted. Three tests, including a real reversed-order deadlock driven through the helper. `log §17` |
| **S1A-H3** | The irrecoverable standing term is explicitly zero | Owner clarification | **Recorded.** No behaviour change; the implicit zero is now mechanical. `clarifications §2` |
| **S1A-H4** | Durable journal selected for in-database checkpointing, not external exactly-once | Claim narrowing | **Narrowed.** ADR-IMP-002's winner unchanged; negative control added. `ADR-IMP-002 §7` |
| — | The money-path lock order | Owner clarification | **Recorded.** `30 §5.2` contains a literal contradiction; the clarification records the order S1A already implemented and tested. `clarifications §1` |

### 13.1 The clean-environment gate, rerun in full

```
npm run db:down          → containers and volumes removed; acos_dbos_sys destroyed
npm run db:up            → acos_control and acos_audit only; acos_dbos_sys ABSENT
npm run typecheck        → clean
npm run lint             → clean at --max-warnings 0
npm test                 → 18 files, 155 tests, ALL PASSING
```

**No manual `CREATE DATABASE acos_dbos_sys` was performed at any point.** The database was
absent from `pg_database` immediately after `db:up` and present immediately after the run,
created by `tests/support/localPostgres.ts` over a `pg` connection to the maintenance
database — never by shelling out to `psql`.

| Property re-verified on the clean run | Result |
|---|---|
| First clean rate authorisation (VC-S7) | **PERMIT**, unchanged |
| Unsafe headroom negative control (VC-S8, `REPEATABLE READ`) | **EXPECTED FAILURE OBSERVED** — sum `226.00` against ceiling `186.00` |
| `SERIALIZABLE` contention is real | **Yes** — real `40001`s under N=12; the retry test still requires at least one |
| Reversed lock order deadlocks | **Yes** — real `40P01`, one victim, asserted |
| `40001` retried by the production helper | **Yes** — all 12 commit, `$0.12` exact |
| `40P01` propagated by the production helper | **Yes** — attempted exactly once, propagates as itself |
| Three-term guard negative control | **EXPECTED FAILURE OBSERVED** |
| `forward_integral`-as-reservation negative control | **EXPECTED FAILURE OBSERVED** |
| Unclaimed external step negative control (new) | **EXPECTED DUPLICATE OBSERVED** — `dispatch = 2` |
| **Any authority quantity changed** | **No.** No ceiling, rate, `standing_cap`, MAL figure, `51 §2` cell or `51 §3` grant altered |

### 13.2 What S1A.1 did NOT do

- **No Effect Canonicaliser.** Not started, not designed, not stubbed.
- **No Cedar.**
- **No S1B.**
- **No architecture redesign**, and no edit to any file under `docs/architecture/`.
- **No change to any authority ceiling, rate, standing cap or MAL figure.**
- **No production escalation system for `40P01`.** The required S1A behaviour is to fail
  immediately, and that is all that was built. Choosing the escalation mechanism belongs to
  the next S1 increment.
- **No production dispatch outbox.** S1A-H4's lesson is that the raw step journal plus an
  unclaimed external step is insufficient — **not** that `runStep` should become the
  production dispatcher.
- **No history rewritten.** The original S1A run's dependence on a manually created
  `acos_dbos_sys` is recorded in three places (`log §16`, `ADR-IMP-002 §1`, this document's
  header) rather than erased.

### 13.3 Obligations carried forward unchanged

The five S1 obligations from `ADR-IMP-002 §5` stand, with two now stated explicitly because
S1A-H4 makes them load-bearing rather than merely tidy:

1. Scheduler/dequeuer.
2. Recovery detection.
3. Step-output serialisation discipline.
4. **Exclusive work-item claim / lease semantics.**
5. **The ACOS-owned dispatch outbox** — the thing that actually provides external-effect
   exactly-once, with vendor idempotency.

Plus the S1A obligations already recorded in `§12` above, unchanged: the serialisation
retry's bound and escalation, the two deferred VC-S5 clauses, `PRESUMED_SETTLED` being
schema-only, and the four scheduled blocks (TB-07, TB-08(a), TB-11, TB-13).

### 13.4 Result of S1A.1

# S1A.1 PASS — S1A ACCEPTED

**No pass-revocation condition triggered by any S1A.1 finding.**

- **S1A-H1** was a test-harness reproducibility defect, not a money-path or DBOS semantic
  failure. It is repaired and asserted.
- **S1A-H2** was a real production defect in the retry helper's classification, repaired
  and asserted in both the synthetic and the real-deadlock direction. It made the money
  path **stricter**, not looser.
- **S1A-H3** and the lock-order clarification change **no implemented behaviour**; both
  document what S1A already tested.
- **S1A-H4** narrowed a claim in a decision record. The property the decision rested on —
  the application-transaction/checkpoint single commit point — was re-attacked with the
  same race that breaks the generic external step, and **held**.

**ADR-IMP-002's winner is unchanged: `SELECT ACOS POSTGRES STEP JOURNAL FOR S1`.**

**It is safe for the owner to authorise the Effect Canonicaliser increment.** Nothing in
this document authorises anything beyond it: not production deployment, real customers,
real money, real advertising, supplier commitments, a public storefront, or autonomous
operation. **S1B remains unauthorised.**

---

## Final result

# S1A PASS — PROCEED

**The substrate holds.** `I3`'s four-term bound is a real single-commit database bound.
The first rate authorisation permits. Realised and standing move atomically in both
interleavings without blocking financial truth. The mandatory negative control fails as
required, so the concurrency result is discriminating rather than vacuous. The declared
lock order does not deadlock. The durable-execution question has been decided on measured
evidence rather than on the architecture's provisional preference.

No pass-revocation condition triggered. No new money-path architecture disagreement was
found.

**And after S1A.1, the gate is reproducible.** The result above was re-earned from a
genuinely clean environment — `db:down`, `db:up`, `typecheck`, `lint`, `test` — with **no
manual SQL**, 18 files and 155 tests passing. Two textual contradictions in the
architecture were found on re-reading and are recorded rather than erased or explained
away: `30 §5.2`'s lock-order list contradicting the sentence beneath it, and `I3`'s
four-term statement against K5's three-column irrecoverable schema. **Neither changes any
implemented behaviour**, and neither is an architecture amendment — both are owner
implementation clarifications in `S1A-owner-clarifications.md`. **No authority quantity
changed.**

# S1A.1 PASS — S1A ACCEPTED

**What this does not authorise.** Nothing beyond the next S1 increment. Not production
deployment, real customers, real money, real advertising, supplier commitments, a public
storefront, or autonomous operation. The owner's independent review of S1A stands between
this result and any further code.
