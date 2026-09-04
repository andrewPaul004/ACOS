# S1A Implementation Log

Choices, surprises, and the architecture references behind them. Written as the work
happened; nothing here is a summary of the result (`S1A-result.md`) or of the contract
(`S1A-contract.md`).

---

## 1. The v1.3.1 precedence note, recorded as required

`phase2-v1.3-implementation-brief.md §5` still contains a stale sentence describing
**TOS-02** and **TOS-03** as outstanding:

> Also outstanding and mechanical: **TOS-02** (eight deliverables cite the superseded v1.1
> registry — `37`'s S6 build scope is the one that matters) and **TOS-03** (`30 §6.1`'s
> audit-ownership count, correct to 22 of 70). Both `S1 BEFORE IMPLEMENTING RELATED
> COMPONENT`.

**That sentence is superseded by package issue v1.3.1.** The authoritative status is:

| Finding | Status | Recorded in |
|---|---|---|
| TOS-02 | **APPLIED in v1.3.1** | `phase2-v1.3.1-errata.md §3`; `phase2-v1.3.1-verification.md §4` (E3 PASS, 0 normative references to a superseded registry) |
| TOS-03 | **APPLIED in v1.3.1** | `phase2-v1.3.1-errata.md §6`; `phase2-v1.3.1-verification.md §7` (E6 PASS, 23 of 70) |

Neither was treated as a blocker. **The architecture archive under
`docs/architecture/v1.3.1/` was not modified** to hide the historical inconsistency — the
stale sentence is still there, and a reader who finds it will find this note.

Note also that the brief's own §5 sentence carries the *pre-correction* figure "22 of 70",
which erratum 6 corrects to 23. The registry and `30 §6.1` are the corrected artifacts; the
brief's summary line was not reissued. This is a second instance of the same stale-summary
pattern and is recorded, not corrected.

---

## 2. No new architecture disagreement was found on the money path

The Architecture Conflict Rule requires a STOP and a precise record if a **new**
disagreement is found affecting money/exposure, transaction semantics, authority,
state-transition legality, audit ordering or lock ordering.

**None was found.** Everything S1A implemented resolved cleanly against the normative set.
Two things that *looked* like disagreements on first reading are not, and both are
explained below (§3 and §7) so a later reader does not re-raise them.

`phase2-v1.3-implementation-brief.md §7` condition 1 and condition 6 are therefore **not**
triggered.

---

## 3. The irrecoverable ledger's guard has three operands, not four

**This looks like TB-01 reintroduced and is not.** Recorded prominently because it is the
single most likely thing for a reviewer to flag.

`24 §3` K5's printed `window_balance` schema declares:

```
  reserved_monetary,      standing_monetary,      presumed_monetary,      realised_monetary,
  reserved_count,         standing_count,         presumed_count,         realised_count,
  reserved_irrecoverable,                         presumed_irrecoverable, realised_irrecoverable,
```

The irrecoverable row has **no `standing_irrecoverable` column** — note the gap in the
printed alignment, which appears deliberate. The guard for that ledger is therefore
three-operand.

This is not a term dropped from `I3`. Registry `§1.2` `I3` defines term 2 as *"Σ forward
exposure of every StandingAuthorization not in status REVOKED and in scope for i"*, and
its operand row materialises that from `standing_window_exposure.forward_monetary` — which
is **monetary**. The count ledger's standing term (`standing_count`) is declared and the
guard carries it. There is no irrecoverable-units standing quantity anywhere in the
architecture to carry.

**Implemented as printed.** `tests/integration/exposure/schema-conformance.test.ts` asserts
the *absence* of `standing_irrecoverable`, so a later increment that adds one has to
reconcile it against K5 rather than drift into it. `vc-l2-guard-operands.test.ts` asserts
the three-operand irrecoverable sum explicitly and separately from the four-operand
monetary and count sums.

---

## 4. `UNBOUNDED` is a companion boolean, not a sentinel and not a null

`26 §10.1`, verbatim:

> `window.max_monetary : Money | UNBOUNDED`, **not nullable.** `min(UNBOUNDED, x) = x`.
> `0.00` means the window admits no monetary exposure and every reservation against it
> denies. **`null` is a schema violation, rejected at catalogue validation.**

`UNBOUNDED` is a member of a sum type. Three representations were available:

| Option | Rejected because |
|---|---|
| `NULL` | Explicitly forbidden by the quoted sentence |
| A large sentinel (`999999999999999.99`) | Keeps the printed guard byte-identical, but puts a fictitious money value in a column that `50 §2` class 17 makes a **control artifact**. V2 would display it as a ceiling |
| **A per-ledger boolean** (selected) | Adds a column the printed schema does not name |

Selected: `max_monetary_unbounded BOOLEAN NOT NULL`, and likewise per ledger. The guard
reads:

```sql
AND NOT NEW.max_monetary_unbounded
AND (NEW.reserved_monetary + NEW.standing_monetary
   + NEW.presumed_monetary + NEW.realised_monetary) > NEW.max_monetary
```

**The flag is not an operand of the sum.** It decides whether the bound applies at all,
which is what `min(UNBOUNDED, x) = x` means. VC-L2's requirement — *"the guard's operand
set is exactly `I3`'s four terms per ledger"* — is asserted against the **summed
expression**, parsed out of the installed `pg_proc.prosrc`, and it holds with exactly four
operands.

`51 §2` needs this for real: `W_DAY_ADSPEND.max_count`, `W_MONTH_MIE.max_monetary` and
five other cells are `UNBOUNDED`.

---

## 5. Money is a bigint of minor units; `NUMERIC` never becomes a `number`

`30 §5.3` (`ACOS-JCS-1`), verbatim: *"Per-column declared decimal scale, serialised as a
string at that exact scale. `25.0` and `25.00` are **different bytes**, deliberately — a
scale change is a semantic change in a money field."*

- Every money column is `NUMERIC(18,2)`.
- `pg` returns `NUMERIC` as a string by default. `src/db/pool.ts` **asserts that at module
  load** and throws if a type parser has been changed to produce a JavaScript number.
- `src/kernel/exposure/money.ts` parses to a bigint of minor units and renders at exactly
  scale 2. `fromDb('25.001')` throws rather than rounding — silently accepting a third
  decimal is how a money field acquires a scale nobody declared.
- `tests/support/oracle.ts` duplicates the arithmetic **deliberately**, in its own local
  functions, so the oracle shares no code with the production money module.

---

## 6. `PRESUMED_SETTLED` and `I32`'s override are schema-only in S1A

`24 §3` K5 gives `presumed_monetary` as `I3` term 3, and `36 §2` VC-L4 specifies the
behaviour: an `I32` override releases the workflow hold and **not** the exposure.

S1A implements the **column and the guard's third operand**, and exercises them in
`commitment-guard.test.ts` cases 3, 5, 6 and 8c. It does **not** implement `PRESUMED_SETTLED`
as a state machine, the `I32` override, `W_MONTH_REFUND_OVERRIDE` raising, or VC-L4's
Path A end-to-end. Those need the effect lifecycle, which is downstream of the
canonicaliser and out of S1A.

---

## 7. The lock order: two passages, one order, and one implementation tie-break

`30 §5.2` declares three positions; `24 §3` K5 declares four for the reconciler. They are
consistent, and the reconciliation is written out in `S1A-contract.md §7.2`:
`30 §5.2`'s *"3. Everything else"* is the slot K5 names `standing_window_exposure` into,
and K5 keeps the counter last, which `30 §5.2` already requires.

**One implementation tie-break was added and is not an architecture claim.** `30 §5.2`
orders by `window_id`. A transaction touching **two instances of one window** — which
VC-S5's cross-boundary case does — has no order under that rule alone. `lockOrder.ts`
therefore sorts by `(window_id, window_instance_key)`. This narrows an ambiguity; it does
not contradict anything.

**Two consequential implementation choices inside the helper:**

1. **One row per statement, not one multi-row statement.** PostgreSQL does not guarantee
   that `SELECT … ORDER BY … FOR UPDATE` acquires locks in the `ORDER BY`'s order — under
   concurrency it may re-fetch and lock in physical order. A lock order that holds only
   when nothing is contending is not a deadlock proof, so the helper issues one locking
   statement per row in the sorted order. At S1A volumes the extra round trips are not the
   constraint.
2. **A single acquisition site, enforced by a test.** `tests/integration/exposure/lock-order.test.ts`
   walks `src/`, strips comments (so a passage *quoting* the architecture's lock order is
   not mistaken for a second acquisition site) and fails if `FOR UPDATE` appears against
   `window_balance`, `standing_window_exposure` or `journal_counter` anywhere but
   `lockOrder.ts`.

---

## 8. SURPRISE — at `SERIALIZABLE` the declared lock order yields `40001`, not blocking

**The most consequential empirical finding in S1A, and it is not a defect.**

Registry `§1.2` `I3`'s enforcement column declares both *"the row taken `SELECT … FOR
UPDATE` inside the authorising transaction"* **and** *"TX at serialisable"*. Measured
against real PostgreSQL 16.9, those two together do **not** produce a queue.

At `SERIALIZABLE` (and at `REPEATABLE READ`), a `SELECT … FOR UPDATE` that reaches a row a
concurrent transaction has already updated and committed raises

```
40001  could not serialize access due to concurrent update
```

rather than re-reading the new version. Under N-way contention on one window instance,
most transactions abort. Measured: **12 concurrent commitments against one
`W_MONTH_REFUND` instance produced 0 deadlocks and 9 serialisation failures.**

**Why this is safe.** An aborted transaction commits nothing, takes no headroom, and —
because `journal_counter` is a row rather than a PostgreSQL sequence (`30 §5.2`) — leaves
**no gap**. It is fail-closed in the correct direction. The property the declared lock
order claims is the absence of **deadlock**, and that holds: `lock-order.test.ts` asserts
zero `40P01` without any retry in the path, so a deadlock cannot be absorbed and counted as
a success.

**Why it matters anyway.** The architecture's declared enforcement is only *usable* behind
a retry, and the retry is ACOS-owned. That is not an accommodation invented here — the
architecture already anticipates it, in the one place where getting it wrong would be
dangerous. Registry `§1.1` `I42`, verbatim:

> v1.2: assert `journal_seq` is not an input to the key, so a **serialisation-failure
> retry** regenerates the same key (SR-A4).

What S1A adds is the measurement that the retry is **required rather than optional**, and a
bound on it: `src/kernel/exposure/retry.ts`, default 10 attempts, linear backoff with
jitter. With it, all 12 concurrent commitments land and the arithmetic is exact
(`0.12` from twelve `0.01` commitments).

**Recorded as an obligation for S1, not resolved here.** The retry's bound, its escalation
on exhaustion, and its interaction with `I32`'s reservation TTL are S1 work. `26 §7`'s step
R says nothing about retry, and nothing in S1A required it to.

**A deliberate consequence for the concurrency harness.** `tests/support/barrier.ts` had to
be made retry-aware: a barrier point that has been released once is left **open**, so a
retried attempt passes through instead of parking at a barrier the conductor has already
stepped past. Gating the first attempt is what the interleaving needs; the retry is a
consequence of the interleaving, not a second one to orchestrate.

---

## 9. SURPRISE — the commitment guard fires on the sync trigger's own UPDATE

Creating a `standing_window_exposure` row raises `window_balance.standing_monetary` through
the `standing_exposure_sync` trigger, and that `UPDATE` passes through
`i3_commitment_guard`. So **creating standing exposure is treated as a commitment** and is
refused when it would breach the ceiling — which is correct, and is exactly how VC-S5's
"a second January authorisation denies `WINDOW_EXHAUSTED`" is enforced.

Symmetrically, a **realised** increase reduces `forward_monetary`, so `standing_monetary`
falls and the guard's `IF` sees no commitment term increase. The financial-truth path is
never refused.

This was found by writing a test fixture that was economically impossible — two standing
caps summing to `$286.00` in a `$186.00` window — and having the guard correctly refuse it.
The fixture was wrong; the guard was right. The test was rewritten to reach the overrun the
way an overrun actually arrives: two authorisations that fit, then realised spend through
the reconciler.

---

## 10. Two `standing_authorization` details the architecture requires and S1A honours

**`status` is a stored column, not generated.** `24 §3.1`, verbatim: *"`status` is
therefore a **stored** column, not a generated one; `I23`'s expiry property is enforced by
the scheduled sweep."* Implemented as stored, with `I62`'s `BEFORE UPDATE` trigger over
`(OLD.status, NEW.status)`.

**`REVOKED` is structurally unreachable, and that is the architecture's own default.**
`51 §3.2`: *"Cessation specification undeclared → no `REVOKED` transition exists."* T7 and
T8 are **declared** in `standing_transition_set` — so `I62`'s transition set is complete and
testable — and are gated by
`CHECK (status <> 'REVOKED' OR cessation_verified_at IS NOT NULL)`. **No code path in
`src/` sets `cessation_verified_at`**, and a test walks the source tree to assert it, so
`62 §9` prohibition 3 is enforced rather than promised.

---

## 11. TB-13 compliance: the VC-S5 successor is a distinct fixture, not a supersession

`phase2-v1.3-implementation-brief.md §5` blocks *"any `campaign.budget.set` supersession
path"* pending TB-13. VC-S5 requires asserting that *"a successor authorisation permits"*
in February.

Implemented with a **distinct fixture authorisation** (`sa_feb`, its own id, its own
`StandingRevocationAuthority`) created through the ordinary rate-class path. There is no
`SUPERSEDED` status in the schema, no max-over-instance `standing_cap` anywhere, and no
code that relates a successor to a predecessor.

---

## 12. Test infrastructure: PostgreSQL provider

`docker-compose.yml` is the documented environment and is the primary path. On the
machine S1A was implemented on, the Docker engine would not start — the WSL distro came up
but the engine never responded on its named pipe.

Rather than weaken the substrate requirement, `tests/support/localPostgres.ts` adds a
second provider: the **PostgreSQL project's own Windows x64 server binaries**, run by
`pg_ctl` in a scratch data directory outside the repository, with the same server settings
`docker-compose.yml` declares (`deadlock_timeout=200ms`, `log_lock_waits=on`, UTC). The
suite prefers `external` whenever `ACOS_CONTROL_PG_URL` is reachable, so a working Docker
environment always wins.

**The whole S1A suite ran against PostgreSQL 16.9.** Nothing was emulated, no lock was
mocked, and SQLite appears nowhere.

One incidental portability note: `pg_ctl start` must be spawned with `stdio: 'ignore'`,
because the postmaster inherits and holds the pipes for the life of the server and a piped
`spawnSync` waits forever for them.

**The two local containers are not the audit plane.** `phase2-v1.3-implementation-brief.md §4`
requires production audit separation to be a separately provisioned account on a separate
provider. Two PostgreSQL servers on one laptop are not that, `docker-compose.yml` says so
in a comment, and the spike reuses the second one only as a convenient host for DBOS's
system database.

---

## 13. Errors: SQLSTATE codes must be exactly five characters

`ACOS62` and `ACOS51` were rejected by PostgreSQL at raise time —
`unrecognized exception condition "ACOS62"`. SQLSTATE is a five-character value. Normalised
to `ACS03` (`I3`), `ACS62` (`I62`) and `ACS51` (`I51`), declared once in
`src/kernel/exposure/errors.ts` as the contract between the trigger bodies and the
application.

Worth noting because the failure mode is quiet in the wrong direction: `RAISE … USING
ERRCODE` with an over-long code raises a *different* error than the one intended, so an
error-code assertion fails for a reason unrelated to the property under test.

---

## 14. `WindowExhausted` wraps the SQLSTATE; both are asserted

`stepR.ts` translates `ACS03` into `26 §7`'s denial vocabulary (`DENY: WINDOW_EXHAUSTED`)
via `asDenial()`. Tests that call `stepR` assert the **denial** and the SQLSTATE
underneath it; tests that write raw SQL assert the SQLSTATE directly. `asDenial()` is
deliberately narrow — only `I3`'s guard becomes a denial. An illegal transition, a
generated-column write or a reservation increase propagates as itself, because softening
any of those into a plausible denial would hide a defect or an attack.

---

## 15. What S1A deliberately did not build

Beyond the S1A mandate's own prohibition list, three things were within arm's reach and
were left alone:

- **The journal row and the local chain.** `journal_counter` exists and takes its declared
  position in the lock order, so the ordering relationship and the deadlock proof are real.
  The journal row, `ACOS-JCS-1`, the trigger-computed chain and the audit push are S1.
- **The `StandingRevocationAuthority`'s dispatch path.** The **row** is created atomically
  with the `StandingAuthorization` because `I55` requires it and omitting it would make the
  first fixture violate an invariant. `26 §7.1`'s `KERNEL_SERVICE` branch, the pause
  dispatch and `I55`'s sweep are not built.
- **The expiry sweep.** `I23` needs one. S1A drives status transitions from tests so that
  `I62` and the boundary rule can be exercised; it does not schedule anything.
