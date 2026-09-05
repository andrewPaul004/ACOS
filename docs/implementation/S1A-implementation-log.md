# S1A Implementation Log

Choices, surprises, and the architecture references behind them. Written as the work
happened; nothing here is a summary of the result (`S1A-result.md`) or of the contract
(`S1A-contract.md`).

**Sections 1–15 are the original S1A log.** Sections 16–19 were added during **S1A.1**, the
narrow local hardening pass that followed the owner's independent review of the repository.
**Nothing in 1–15 was rewritten and no defect recorded there was removed**; §7 and §8 each
carry an **appended amendment note** where S1A.1 found the original wording too generous,
and the original wording is still there above it. Two of the S1A.1 findings are owner clarifications rather than repairs and
live in `S1A-owner-clarifications.md`; one is a scope narrowing and lives in
`ADR-IMP-002 §7`.

| ID | Finding | Where |
|---|---|---|
| **S1A-H1** | DBOS spike clean-environment bootstrap defect | §16 |
| **S1A-H2** | `40001` is retryable; `40P01` is pass-revoking | §17 |
| **S1A-H3** | The irrecoverable standing term is explicitly zero | `S1A-owner-clarifications.md §2` |
| **S1A-H4** | Durable journal selected for in-database checkpointing, not external exactly-once | `ADR-IMP-002 §7` |
| **S1A-H4a** | The spike's kill point 7 still asserted external exactly-once, contradicting S1A-H4 — corrected during S1B.2 | `ADR-IMP-002 §7.5` |
| — | The money-path lock order, resolving `30 §5.2`'s internal contradiction | `S1A-owner-clarifications.md §1` |

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

**AMENDED BY S1A.1 — this section understated the problem.** Calling the two passages
simply *"consistent"* glossed over the fact that **`30 §5.2` contradicts itself**: its
numbered list places `journal_counter` at position **2** with *"everything else"* at
**3**, and the sentence printed immediately beneath it requires the counter to be
**last**. Both cannot be followed as printed. That contradiction **is present in the
architecture**, and S1A.1 does not claim otherwise. `24 §3` K5 and registry `§1.2` `I3`'s
enforcement column both resolve it the same way, and the resolution is the order S1A
already implemented and tested. Recorded as an owner clarification in
`S1A-owner-clarifications.md §1`. **No implemented behaviour changes.**

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

**AMENDED BY S1A.1 — §17.** As originally written, `retry.ts` treated `40P01` as retryable
alongside `40001`, and its comment claimed the deadlock count was "surfaced in the
outcome". **It was not** — `RetryOutcome` has one counter and it does not distinguish the
two SQLSTATEs. Since S1A.1 a `40P01` is not retried at all, so there is no deadlock count
to surface and no claim that there is. `40001` retries exactly as measured above; nothing
in this section's measurements changes.

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

---

# S1A.1 — the owner review repairs

Everything above is the original S1A log. Everything below was added after the owner's
independent review of the actual repository. **S1A's core money-path substrate was accepted
in shape; S1B is not authorised.** No architecture artefact was modified, no authority
quantity changed, and no historical record was rewritten.

---

## 16. S1A-H1 — DBOS spike clean-environment bootstrap defect

**A TEST-HARNESS DEFECT. Not a money-path defect and not a DBOS semantic failure.**

**Reproduced independently by the owner**, and reproducible from a clean Docker
environment. `docker compose up` creates:

- `acos_control` on the control server, and
- `acos_audit` on the audit server.

It creates nothing else. But `spikes/durable-execution/spike.test.ts` derived

```
ACOS_DBOS_SYS_PG_URL   from   ACOS_AUDIT_PG_URL
```

by string substitution, and expected the database `acos_dbos_sys` to **already exist** on
the audit PostgreSQL server. It does not. The result was **five failing DBOS spike tests**:

```
3D000: database "acos_dbos_sys" does not exist
```

**The owner created that database by hand in `acos-s1a-audit`, after which all 139 tests
passed.** That is the fact this section exists to preserve: **the original S1A run required
a manual `CREATE DATABASE` and its result did not say so.** The repository was not
reproducible from a clean clone, and a green suite on one machine was not evidence of a
green suite anywhere.

### The repair

**No manual database creation is required, on either provider.**

`tests/support/localPostgres.ts`:

- `DBOS_SYSTEM_DATABASE = 'acos_dbos_sys'` is declared as a constant, alongside
  `CONTROL.database` and `AUDIT.database`, in a `TRUSTED_DATABASES` set.
- `withDatabase(url, database)` rewrites a PostgreSQL URL to name a different database on
  the **same server**, preserving host, port, credentials and query parameters. Both the
  system-database URL and the maintenance-database URL go through it, so the two providers
  cannot disagree about where the system database lives.
- `ensureDatabase(serverUrl, database)` connects to the **maintenance database**
  (`postgres`) over `pg`, checks `pg_database`, and issues `CREATE DATABASE` only if the
  row is absent. It tolerates `42P04 duplicate_database` if it loses a race, so the
  postcondition it promises — *the database exists* — holds under concurrency.
- **It does not shell out to `psql` or `createdb`.** The CLI would add an argument-parsing
  surface for no benefit, and `pg` is already a dependency of the thing under test.
- The interpolated identifier is checked **twice** before it reaches the statement: it must
  be a member of `TRUSTED_DATABASES` — static, in-repository constants — and it must match
  `^[a-z_][a-z0-9_]*$`. A name arriving from an edited environment variable cannot become
  DDL.
- `ensureDbosSystemDatabase(auditUrl)` wraps that for the system database and is called by
  `provision()` on **both** the Docker/external provider and the local
  PostgreSQL-binary provider.

**Provisioning now NAMES what it CREATES.** `ProvisionResult` gained `dbosSystemUrl`, and
`tests/support/globalSetup.ts` publishes it as `ACOS_DBOS_SYS_PG_URL`. The spike **reads**
that variable and throws a directed error if it is unset. It no longer derives
infrastructure that provisioning does not know exists — which was the actual defect, more
than the missing `CREATE DATABASE` was.

### The regression assertion

`tests/integration/harness/dbos-system-database.test.ts`, six assertions:

1. `ACOS_DBOS_SYS_PG_URL` is published and names `acos_dbos_sys`.
2. It is a **different database on the same server** as the audit URL.
3. **The prerequisite itself** — connecting to it succeeds and `current_database()` is
   `acos_dbos_sys`. This is the exact connection that raised `3D000` before the repair.
4. `pg_database` on the audit server lists it.
5. Provisioning is **idempotent** and returns the same URL twice.
6. An untrusted database name is **refused** rather than interpolated.

### The clean reproduction

```
npm run db:down   →   npm run db:up   →   npm test
```

with **no manual SQL**. The two containers use `tmpfs` for their data directories and
`db:down` passes `-v`, so `db:down` genuinely destroys the manually created database and
the run that follows is a real clean-environment run.

**The two local containers are still not the audit plane.** `docker-compose.yml` says so,
§12 says so, and hosting the DBOS system database on the audit *server* does not change it.
`phase2-v1.3-implementation-brief.md §4` requires a separately provisioned account on a
separate provider, and nothing in S1A or S1A.1 satisfies that.

---

## 17. S1A-H2 — `40001` is retryable; `40P01` is pass-revoking

`src/kernel/exposure/retry.ts` originally treated **both**
`40001 SERIALIZATION_FAILURE` and `40P01 DEADLOCK_DETECTED` as retryable, with a comment
asserting that a retried deadlock's count was *"surfaced in the outcome"*.

**Two things were wrong with that, and the second is worse than the first.**

1. **The count was not surfaced.** `RetryOutcome` carries one `retries` counter and does
   not distinguish the two SQLSTATEs. A retried deadlock was indistinguishable from
   ordinary contention.
2. **A deadlock is not a condition to wait out.** `40001` and `40P01` are not two flavours
   of one event:

| SQLSTATE | What it means on the ACOS money path | Handling |
|---|---|---|
| `40001` | **Expected `SERIALIZABLE` contention** on a correctly ordered path. §8 measured that it is required rather than optional, and registry `§1.1` `I42` already anticipates the retry (*"a serialisation-failure retry regenerates the same key (SR-A4)"*). | **Bounded retry** |
| `40P01` | **The declared money-path lock order has failed, or an undeclared lock-taking path exists.** `30 §5.2` declares the order once; `24 §3` K5: *"there is one lock order in the system and both writers of the money row obey it"*; `lockOrder.ts` is the single acquisition site. A deadlock contradicts that claim. It is an invariant/implementation defect. | **Propagate immediately** |

Retrying a deadlock is worse than failing on one: it would usually succeed on the second
attempt and so would **erase the only signal** that the ordering claim the whole deadlock
proof rests on is no longer true.

### The change

`isRetryable()` now returns `false` for `40P01` before considering anything else, and
`true` only for `40001`. `40P01` is **not caught, not converted and not hidden** — in
particular it is never wrapped in `SerialisationRetriesExhausted`, which would have
replaced the SQLSTATE with a plausible-looking retry-exhaustion error. The exclusion is
written as an explicit branch rather than an omission, so a later edit has to argue with a
comment instead of quietly "fixing" a gap.

**No production escalation system was chosen.** That belongs to the next S1 increment. The
required S1A behaviour is to fail immediately, and that is all this does.

### The tests

`tests/integration/exposure/retry-deadlock-not-retried.test.ts`:

| Test | Asserts |
|---|---|
| A `40P01` raised by PostgreSQL inside the work function | the work ran **exactly once** against `maxAttempts: 10`; the `40P01` reached the caller **as itself**; it is **not** a `SerialisationRetriesExhausted` |
| A `40001` raised twice then succeeding | **retried**, `retries === 2`, work ran 3 times — so the test above is discriminating rather than proving the helper retries nothing |
| **A real reversed-order deadlock driven THROUGH the helper**, two real backends held at the dangerous boundary by `tests/support/barrier.ts` | exactly one real `40P01` occurred (else the test proves nothing); the helper attempted its work **exactly once** whichever backend PostgreSQL chose as victim; if the helper's side was the victim, the `40P01` propagated unchanged |

**Retained, unmodified:** `lock-order.test.ts`'s real reversed-order deadlock negative
control, its zero-`40P01`-under-the-declared-order assertion with no retry in the path, and
its `SERIALIZABLE` contention test proving `40001` retries succeed and that twelve `$0.01`
commitments still sum to exactly `$0.12`.

### Documentation corrected

Any statement that deadlock retry counts are surfaced is now wrong twice over — they were
never surfaced, and deadlocks are no longer retried. `retry.ts`'s comment is rewritten and
§8 above carries an amendment note. No other document made the claim.

---

## 18. The two owner clarifications, and where they live

Two S1A.1 findings are **owner implementation clarifications**, not repairs, and neither
changes implemented behaviour. They are recorded in
`docs/implementation/S1A-owner-clarifications.md` rather than here because they are
readings the owner issued, not choices this implementation made:

- **The money-path lock order.** `30 §5.2` prints a numbered list placing
  `journal_counter` at position 2 with *"everything else"* at 3, and then states in the
  next sentence that *"the counter is taken last"*. **That is a literal contradiction and
  it is present in the architecture.** `24 §3` K5 and registry `I3`'s enforcement column
  both resolve it the same way, and the clarification records the order S1A already
  implemented and tested: `window_balance` → `standing_window_exposure` →
  `journal_counter` **last** → other non-money-path state.
- **S1A-H3, the irrecoverable standing term.** `I3` describes four conceptual terms per
  ledger; K5's authoritative `window_balance` schema declares three for the irrecoverable
  ledger and deliberately no `standing_irrecoverable`. The clarification: that term is
  **definitionally `0`** under the current `StandingAuthorization` model, so the implemented
  guard has three stored operands plus an implicit zero. `standing_irrecoverable` is **not**
  added and the guard arithmetic is **not** changed;
  `tests/integration/exposure/irrecoverable-standing-zero.test.ts` makes the implicit zero
  explicit and mechanical so a future `StandingAuthorization` type carrying
  irrecoverable-unit forward exposure cannot silently reuse this schema.

**S1A-H4** — that the durable journal was selected for in-database checkpointing and not
for external exactly-once — is a narrowing of a decision record and lives in
`ADR-IMP-002 §7`, with its negative control in
`spikes/durable-execution/external-step-race.test.ts`.

**S1A-H4a**, recorded 2026-09-05 during the S1B.2 independent-review repair pass, is the
loose end S1A-H4 left behind. S1A-H4 narrowed the ADR's language but did not update the
spike, which continued to assert `dispatchCount <= 1` at kill point 7 and to classify
`dispatchCount > 1` inside `invariantVerdict()` as a weakened S1A substrate invariant. Both
contradict the accepted S1A-H4 result: with no exclusive work-item claim, a duplicate
external dispatch under concurrent retry is a known possible outcome of the generic step
shape, not a failure of the application-transaction/checkpoint property.

The single observed `dispatchCount == 2` recorded in `S1B-result.md` — reported honestly at
the time and explicitly not claimed as repaired — is therefore a **stale test expectation**,
not evidence of a ledger defect. In that run the delta was applied exactly once and the
journal sequence was allocated exactly once. The observation is retained in the record; the
assertion is corrected.

The correction separates the two properties: the application-transaction/checkpoint invariant
stays asserted, and the external-dispatch count is recorded as an observation. Exact-once
dispatch assertions are **retained** in every sequential case, and the deterministic S1A-H4
negative control that forces and observes two dispatches is untouched. The outbox was not
built — it remains S1 work. Full detail in `ADR-IMP-002 §7.5`.

**No S1A production source was changed by this correction.** It is confined to
`spikes/durable-execution/spike.test.ts`, and the S1A suite remains 157/157.

---

## 19. An incidental finding S1A.1 did NOT act on: a raw NUL byte in `lockOrder.ts`

Found while reviewing the S1A.1 diffs, reported rather than repaired because it is outside
the four authorised findings.

`src/kernel/exposure/lockOrder.ts`'s `dedupe()` builds its key with a **literal NUL
character** as the separator:

```
const key = `${instance.windowId}<NUL>${instance.windowInstanceKey}`;
```

The technique is sound — `U+0000` cannot occur in a window id or an instance key, so it is
an unambiguous separator, and it is a standard way to build a composite map key.

**The problem is the byte, not the idea.** The NUL is written as a raw control character
rather than as the two-character escape `\0`, which makes **git classify the file as binary**. A change
to this file therefore shows as `Bin 8277 -> 8862 bytes` instead of a reviewable diff. That
matters here specifically: `lockOrder.ts` is the single money-path lock-acquisition site,
and it is the one file in `src/` whose changes an owner most needs to be able to read.

**Not changed by S1A.1.** Replacing the raw byte with that escape is byte-identical at
runtime and would restore diffability, but it is a money-path source edit outside Findings A–E, and the
S1A.1 mandate is a narrow pass. It is recorded here for the owner to authorise or decline.

The S1A.1 change to this file **is comment-only**, and can be verified as such with:

```
git diff --text -- src/kernel/exposure/lockOrder.ts
```

`--text` forces git to diff a file it has classified as binary.

---

## 20. S1A-H5 — the VC-S8 ordering harness waits for actual lock ownership

**Found by S1B, repaired by S1B.1. A test-harness repair only: no production money-path
source was changed, and no money-path semantics were changed to make a test deterministic.**

### The symptom

`tests/integration/exposure/vc-s8-realised-standing-atomicity.test.ts` failed **3 times in
14 runs under load**. Every failure was a **Conductor timeout**, not a property violation:

- no interleaving ever exposed unauthorised headroom;
- no realised update was lost and no standing update was dropped;
- the four-term sum was correct in every run that completed;
- `src/kernel/exposure/reconciler.ts` and `lockOrder.ts` behaved exactly as `24 §3` K5
  requires.

The production logic did not violate the property. **The harness could not establish the
interleaving it claimed to be testing.**

### The defect

The reconciler participant announced only two barrier points, `AFTER_BEGIN` and
`AFTER_WRITE`. The conductor released the competing authorisation immediately after
`AFTER_BEGIN`:

```text
release recon at AFTER_BEGIN        <- transaction open, snapshot taken
release auth   at AFTER_BEGIN       <- ASSUMED the reconciler already held the row
```

**`AFTER_BEGIN` proves a snapshot was taken. It proves nothing about who owns the
`window_balance` row.** `recordRealisedSpend` takes its locks *inside* the call, so between
the reconciler's release and its `SELECT … FOR UPDATE` there is a scheduling window. Under
load the authorisation sometimes reached the row first. The reconciler then blocked behind
an authorisation parked at `AFTER_LOCK` — a barrier the conductor would not release until
the reconciler had reached `AFTER_WRITE`, which it now never could.

That is a **harness deadlock**, and the test's own comment (*"Because the reconciler is
inside `recordRealisedSpend` it already holds the `window_balance` row"*) was the assumption
that failed. The comment asserted the ordering; nothing established it.

### The repair — a rendezvous at actual lock ownership

The reconciler participant now takes the declared locks itself, **through the one declared
helper, in the one declared order**, and announces `AFTER_LOCK` only once
`SELECT … FOR UPDATE` has returned. `recordRealisedSpend` then re-acquires the same rows in
the same order inside the same transaction, which PostgreSQL satisfies from the locks already
held — a no-op re-acquisition, not a second acquisition site. The conductor's sequence
becomes:

```text
reconciler BEGIN
    |
reconciler acquires the required window_balance lock
    |
test observes the explicit AFTER_LOCK barrier          <- ownership ESTABLISHED
    |
ONLY NOW release the competing authorisation
```

**Applied to every case sharing the race, not only the one that failed:**

| Case | Change |
|---|---|
| `ORDERING A` | wait for `recon:AFTER_LOCK` before releasing `auth:AFTER_BEGIN` |
| `no interleaving exposes headroom …` (the over-commit case) | same rendezvous — this case shared the race and had not yet been observed to fail |
| `ORDERING B` | already correct on the authorisation side (`auth:AFTER_LOCK` was always a post-acquisition barrier); the reconciler's new `AFTER_LOCK` is stepped after the authorisation commits, and reaching it only there is itself evidence the reconciler was blocked |
| `the NEXT commitment …` | single participant, no race, unchanged |

### What was deliberately NOT done

- **No production source changed.** `src/kernel/exposure/reconciler.ts`,
  `lockOrder.ts` and `retry.ts` are byte-identical to their accepted S1A form.
- **No money-path semantics relaxed** to make the test deterministic. The ordering the
  harness now establishes is the ordering the S1A test already claimed.
- **No second lock-acquisition site.** `tests/integration/exposure/lock-order.test.ts` reads
  `src/` and fails if a second `FOR UPDATE` site appears there; the rendezvous is in the
  test and calls the same `acquireMoneyPathLocks` helper.
- **The reversed-order negative control is retained**, unchanged, in
  `tests/integration/exposure/lock-order.test.ts` — it still deliberately produces a real
  `40P01`, which is what keeps the no-deadlock claim falsifiable.

### The verification

The repaired file was run **25 consecutive times**, serially, against real PostgreSQL. The
required result and the actual result are recorded in
`docs/implementation/S1B-result.md` §S1B.1: zero harness timeouts, the required real `40001`
behaviour still observable on the retry path, and no real `40P01` on the correct lock-order
path.
