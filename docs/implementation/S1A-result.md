# S1A Result

**Issued 2026-09-04.** Architecture input: ACOS Operating Spine v1.3, package issue
v1.3.1, materialised immutably at `docs/architecture/v1.3.1/`.

**Substrate:** PostgreSQL 16.9. **Suite:** 14 files, 139 tests, all passing. Typecheck
clean. Lint clean at `--max-warnings 0`. Migrations apply from an empty database and are
torn down and recreated on every test file.

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

### 9. Which durable-execution candidate won?

**SELECT ACOS POSTGRES STEP JOURNAL FOR S1.**

`34 ADR-002`'s reconsider trigger **(e)** fired: *"the S1 spike shows the hand-rolled
journal is simpler to attack and equally correct."*

**Both candidates were correct.** DBOS Transact 4.27.6 with
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

**One thing the spike does not claim.** `31 §3.3` asks for the comparison to run against a
vendor sandbox for `refundCreate` and the ESP rather than mocks (VAL-04). S1A prohibits
those adapters, so step 3 is a mock. No conclusion about vendor idempotency is drawn, and
`phase2-v1.3-implementation-brief.md §6` obligations 7 and 11 remain unmet.

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

**What this does not authorise.** Nothing beyond the next S1 increment. Not production
deployment, real customers, real money, real advertising, supplier commitments, a public
storefront, or autonomous operation. The owner's independent review of S1A stands between
this result and any further code.
